// PIVOT-014 — journal lifecycle service.
//
// Business rules only: no SQL, no HTTP, no session handling. The service receives a
// verified context (tenant, actor, request correlation) from the application layer and
// a transactional repository port, and it decides the order of every durable effect.
//
// Ordering contract enforced here (S4/S8):
//   1. Validate the whole request inside the business transaction (balance, accounts,
//      period) BEFORE any allocator is touched.
//   2. Reserve exactly one document number under the scoped row lock.
//   3. Persist the accepted receipt and its number row.
// A refusal at step 1 must leave no journal, no line, no audit row and no consumed
// number. Gaps after a *persisted* allocation are permitted and are never back-filled.

import {createHash} from 'node:crypto';
import {
  SliceError, refuse, assertEnvelope, canonicalJson, minorUnits, CANONICAL_ACTIONS,
} from './ports.mjs';

const KINDS = Object.freeze({journal: 'JRN'});

/** Accepted bytes are stored as decimal strings: exact, portable and re-validatable. */
export function storedJournal(journal) {
  return {
    company: journal.company,
    branch: journal.branch,
    postingDate: journal.postingDate,
    narrative: journal.narrative,
    lines: journal.lines.map(line => ({
      account: line.account, debit: line.debit.toString(), credit: line.credit.toString(),
    })),
  };
}

/** Stable, non-guessable-enough request digest over accepted bytes and authority. */
export function requestDigest(parts) {
  return createHash('sha256').update(canonicalJson(parts), 'utf8').digest('hex');
}

/** Raw SQLSTATE-free mapping of the accepted 042 primitive's error codes. */
const VOID_ERRORS = Object.freeze({
  VOID_ENTRY_NOT_FOUND: () => refuse.entryUnavailable(null),
  VOID_ENTRY_NOT_POSTED: () => refuse.entryNotPosted(),
  ENTRY_ALREADY_VOIDED: () => refuse.alreadyVoided(),
  VOID_IDEMPOTENCY_CONFLICT: () => refuse.idempotencyConflict(),
  VOID_PERIOD_LOCKED: () => refuse.periodLocked(),
  VOID_ACTION_DENIED: () => refuse.permissionDenied(CANONICAL_ACTIONS.delete),
  VOID_ACTION_REQUIRED: () => refuse.permissionDenied(CANONICAL_ACTIONS.delete),
  VOID_SOURCE_UNBALANCED: () => refuse.unbalanced(),
  VOID_DEPENDENCY_UNSUPPORTED: () => refuse.unsupportedLinked('linked document dependencies'),
  VOID_LINKED_CORRECTION: () => refuse.unsupportedLinked('corrected entries'),
  VOID_APPROVAL_REQUIRED: () => new SliceError(409, 'APPROVAL_REQUIRED',
    'This void needs independent approval; direct void is not permitted for this authority.'),
});

export function createJournalService({repository, actions = CANONICAL_ACTIONS, kinds = KINDS} = {}) {
  if (!repository || typeof repository.transaction !== 'function') {
    throw new Error('createJournalService requires a repository with transaction().');
  }

  /** One journal per idempotency key; the key is also the durable journal id. */
  function requireKey(value, label = 'Idempotency-Key') {
    if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,200}$/.test(value)) {
      throw refuse.invalidEntry(`${label} must be 8..200 characters of [A-Za-z0-9._:-].`);
    }
    return value;
  }

  /**
   * Create-and-post in one authorized direct-posting transition, or create only.
   * `post: false` leaves an ACCEPTED_PENDING source (draft) distinct from POSTED.
   *
   * Allocation happens in its own short transaction (after validation) so a failure in
   * the business transaction can never rewind the identity. A refusal before that point
   * leaves no number consumed, which S4 asserts.
   */
  async function create(ctx, {payload, idempotencyKey, post = false}) {
    const id = requireKey(idempotencyKey);
    const journal = assertEnvelope(payload);
    const digest = requestDigest({kind: 'create', id, actor: ctx.actor, tenant: ctx.tenantId, journal: storedJournal(journal)});

    const replay = await repository.transaction(ctx, async tx => {
      const existing = await tx.findCommand(id);
      if (!existing) return null;
      // Same key: identical accepted bytes replay; different content is a conflict.
      if (existing.digest !== digest || existing.actor !== ctx.actor) throw refuse.idempotencyConflict();
      const number = await tx.findNumber(id);
      return {
        id, number: number ? number.number : null, state: existing.state, replayed: true,
        digest: existing.digest,
      };
    });
    if (replay) return replay;

    // Validation before allocation, inside a business transaction.
    await repository.transaction(ctx, async tx => {
      if (post) await requireDirectPostAuthority(ctx, tx, journal);
      else await tx.requireAuthority({...authorityInput(ctx, journal), action: actions.prepare});
      await tx.requireOpenPeriod(journal);
      await tx.requireAccounts(journal);
      return true;
    });

    const allocated = await repository.reserveNumber(ctx, {
      id, company: journal.company, kind: kinds.journal, requestDigest: digest,
    });

    try {
      return await repository.transaction(ctx, async tx => {
        const raced = await tx.findCommand(id);
        if (raced) {
          if (raced.digest !== digest || raced.actor !== ctx.actor) throw refuse.idempotencyConflict();
          return {id, number: allocated.number, state: raced.state, replayed: true, digest: raced.digest};
        }
        // Revalidate on the accepted bytes inside the transaction that mutates: an
        // allocation reservation never carries authorization forward, and a period lock
        // or role/denial change that won after the pre-allocation pass is observed here.
        if (post) await requireDirectPostAuthority(ctx, tx, journal);
        else await tx.requireAuthority({...authorityInput(ctx, journal), action: actions.prepare});
        await tx.requireOpenPeriod(journal);
        await tx.requireAccounts(journal);

        // Revalidate on the accepted bytes in the transaction that mutates: a reservation
        // never carries authorization forward, so a period lock or role/denial change that
        // won after the pre-allocation pass is observed here and rolls the write back.
        if (post) await requireDirectPostAuthority(ctx, tx, journal);
        else await tx.requireAuthority({...authorityInput(ctx, journal), action: actions.prepare});
        await tx.requireOpenPeriod(journal);
        await tx.requireAccounts(journal);

        await tx.insertCommand({
          id, actor: ctx.actor, digest, payload: JSON.stringify(storedJournal(journal)), state: 'ACCEPTED_PENDING',
          at: ctx.now,
        });
        await tx.insertDocumentRegistry({
          documentId: id, status: post ? 'posted' : 'draft', company: journal.company,
          branch: journal.branch, sourceCommandId: id, actor: ctx.actor,
        });
        await tx.logLifecycle({commandId: id, event: 'JOURNAL_ACCEPTED', detail: {
          number: allocated.number, sequence: allocated.sequence, company: journal.company,
          branch: journal.branch, lines: journal.lines.length, debit: journal.debit.toString(),
          origin: 'human', idempotencyKey: id,
        }});
        if (post) return await applyPost(ctx, tx, {id, journal, digest, number: allocated.number, at: ctx.now});
        return {id, number: allocated.number, state: 'ACCEPTED_PENDING', replayed: false};
      });
    } catch (error) {
      if (error?.code === '23505') {
        // A concurrent identical create won the command insert; its receipt is the truth.
        return repository.transaction(ctx, async tx => {
          const existing = await tx.findCommand(id);
          if (!existing) throw error;
          if (existing.digest !== digest || existing.actor !== ctx.actor) {
        if (process.env.PIVOT014_DEBUG) console.error('[conflict]', inspect({existing, digest, actor: ctx.actor}, {depth: 3}));
        throw refuse.idempotencyConflict();
      }
          return {id, number: allocated.number, state: existing.state, replayed: true, digest: existing.digest};
        });
      }
      throw error;
    }
  }

  /** Post an existing accepted source. Replaying a posted command adds nothing. */
  function post(ctx, {id, idempotencyKey}) {
    const key = requireKey(idempotencyKey ?? `${id}:post`);
    return repository.transaction(ctx, async tx => {
      const command = await tx.lockCommand(id);
      if (!command) throw refuse.tenantResourceDenied(id);
      if (command.actor !== ctx.actor) throw refuse.tenantResourceDenied(id);
      const number = await tx.findNumber(id);
      if (!number) throw new SliceError(409, 'NUMBER_MISSING', 'The accepted source has no allocation.');
      if (command.state === 'POSTED' || command.state === 'VOIDED') {
        // The first post binds its idempotency key and request digest. A replay with that
        // key returns the receipt; a different key on the same target is a conflict.
        const receipt = await tx.postingReceiptKey(id);
        if (receipt?.idempotencyKey && receipt.idempotencyKey !== key) throw refuse.idempotencyConflict();
        if (receipt?.requestDigest && receipt.requestDigest !== command.digest) throw refuse.idempotencyConflict();
        return {id, number: number.number, state: command.state, replayed: true, digest: command.digest};
      }
      if (command.state !== 'ACCEPTED_PENDING') {
        throw new SliceError(409, 'COMMAND_NOT_POSTABLE', 'This source is not in a postable state.');
      }
      // Re-validate the immutable accepted bytes at the transition: a tampered or
      // incomplete source can never be posted through this path.
      const journal = assertEnvelope(JSON.parse(command.payload));
      await requireDirectPostAuthority(ctx, tx, journal);
      await tx.requireOpenPeriod(journal);
      await tx.requireAccounts(journal);
      const receipt = await applyPost(ctx, tx, {id, journal, digest: command.digest, number: number.number, at: ctx.now, idempotencyKey: key});
      return {...receipt, replayed: false};
    });
  }

  /** Terminal void through the accepted 042 primitive; never a delete. */
  function voidEntry(ctx, {id, reason, idempotencyKey}) {
    const key = requireKey(idempotencyKey);
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (!text || text.length > 1000) throw refuse.invalidEntry('A reason of 1..1000 characters is required.');
    return repository.transaction(ctx, async tx => {
      const command = await tx.lockCommand(id);
      if (!command) throw refuse.tenantResourceDenied(id);
      if (command.actor !== ctx.actor) throw refuse.tenantResourceDenied(id);
      try {
        const voidCommandId = await tx.callVoid({entry: id, reason: text, idempotencyKey: key});
        return {id, voidCommandId, state: 'VOIDED', replayed: command.state === 'VOIDED'};
      } catch (error) {
        const code = typeof error?.message === 'string' ? error.message.split(/[: ]/)[0] : '';
        const mapped = VOID_ERRORS[code];
        if (mapped) throw mapped();
        throw error;
      }
    });
  }

  function read(ctx, {id, tenantId, company, branch}) {
    if (tenantId && tenantId !== ctx.tenantId) throw refuse.auditTenantDenied(tenantId);
    return repository.transaction(ctx, async tx => {
      const journal = await tx.readJournal(id);
      if (!journal) throw refuse.tenantResourceDenied(id);
      // Read is authority, not authorship: any principal with module/company/branch scope
      // may read the entry; a scoped reader may not read outside that scope.
      await tx.requireAuthority({
        actor: ctx.actor, action: actions.read,
        company: journal.company, branch: journal.branch, accounts: [],
      });
      if (company && company !== journal.company) throw refuse.permissionDenied(actions.read);
      if (branch && branch !== journal.branch) throw refuse.permissionDenied(actions.read);
      return journal;
    }, {readOnly: true});
  }

  function list(ctx, {tenantId, company, branch} = {}) {
    if (tenantId && tenantId !== ctx.tenantId) throw refuse.auditTenantDenied(tenantId);
    return repository.transaction(ctx, async tx => {
      await tx.requireAuthority({actor: ctx.actor, action: actions.read, company, branch, accounts: []});
      return tx.listJournals({company, branch});
    }, {readOnly: true});
  }

  /** Canonical logical stream and the physical change stream, independently. */
  function audit(ctx, {tenantId, commandId, sinceId, company, branch} = {}) {
    if (tenantId && tenantId !== ctx.tenantId) throw refuse.auditTenantDenied(tenantId);
    const since = Number.isSafeInteger(Number(sinceId)) ? Number(sinceId) : 0;
    return repository.transaction(ctx, async tx => {
      // Audit read is a module-resource decision, separate from authentication and from
      // journal authorship.
      await tx.requireAuthority({actor: ctx.actor, action: actions.read, company, branch, accounts: []});
      return {
        lifecycle: await tx.listLifecycle(commandId),
        changes: await tx.listChangeEvents({commandId: commandId ?? null, sinceId: since}),
      };
    }, {readOnly: true});
  }

  async function applyPost(ctx, tx, {id, journal, digest, number, at, idempotencyKey}) {
    await tx.insertJournal({id, journal, at});
    await tx.insertLines({id, lines: journal.lines, at});
    // The accepted receipt guard requires the canonical posting event to exist before
    // the command may become POSTED, so the audit row is written first.
    await tx.logLifecycle({commandId: id, event: 'JOURNAL_POSTED', detail: {
      number, company: journal.company, branch: journal.branch, lines: journal.lines.length,
      debit: journal.debit.toString(), credit: journal.credit.toString(),
      origin: 'human', requestDigest: digest, idempotencyKey: idempotencyKey ?? `${id}:post`,
    }});
    // Outbox row precedes the POSTED transition: the accepted receipt guard requires
    // both the posting audit row and the outbox effect to exist first.
    await tx.insertOutbox({id, event: 'JOURNAL_POSTED'});
    await tx.updateCommandState({id, state: 'POSTED', actor: ctx.actor, at});
    await tx.updateDocumentStatus({documentId: id, status: 'posted', actor: ctx.actor});
    return {id, number, state: 'POSTED', digest};
  }

  async function requireDirectPostAuthority(ctx, tx, journal) {
    const decision = await tx.requireAuthority({...authorityInput(ctx, journal), action: actions.post});
    // Direct posting is the default when authorized; a review-required authority is
    // refused here instead of silently posting without the approval workflow, which
    // this slice does not implement.
    if (decision.review) {
      throw new SliceError(409, 'APPROVAL_REQUIRED',
        'This authority requires review; direct posting is refused by this slice.');
    }
    return decision;
  }

  function authorityInput(ctx, journal) {
    return {
      actor: ctx.actor,
      company: journal.company,
      branch: journal.branch,
      accounts: journal.lines.map(line => line.account),
      amountMinor: journal.debit,
    };
  }

  return Object.freeze({create, post, voidEntry, read, list, audit, actions, kinds});
}

export {minorUnits};
