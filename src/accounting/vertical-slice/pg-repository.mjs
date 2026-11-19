// PIVOT-014 — PostgreSQL repository for the journal lifecycle.
//
// Every statement here runs on a restricted runtime login (`saven_customer_app`), under
// tenant/user transaction context, with row-level security enforced. No administrator
// connection, table ownership, BYPASSRLS or session-level tenant GUC is used.
//
// Allocator protocol (S8):
//   * `reserveNumber` runs in its own short transaction so a rollback of later business
//     work can never rewind an allocated identity (D-016 addendum). A failed business
//     transaction therefore leaves an explainable gap; gaps are never back-filled.
//   * The advance is serialized by `SELECT ... FOR UPDATE` on the scoped counter row
//     (`document_sequences`), one row per (company, kind).
//   * The consumed number is recorded in `document_numbers` in the same short
//     transaction, so permanent allocation evidence survives a later failure.
//   * The identity is never derived from `max(sequence)`, a rowid or a client value.

import {SliceError, refuse} from './ports.mjs';

const SEQ_ROW_LOCK = `
  SELECT next_number FROM tenant_data.document_sequences
   WHERE tenant_id = $1 AND company = $2 AND kind = $3
   FOR UPDATE`;

const AUTHORITY_ROLES = `
  SELECT r.id AS role_id, r.protected, r.permissions::jsonb AS rule
    FROM tenant_data.members m
    JOIN tenant_data.assignments a ON a.tenant_id = m.tenant_id AND a.user_id = m.user_id
    JOIN tenant_data.roles r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
   WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.active
   ORDER BY r.id`;

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function boundedInteger(value, label) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new SliceError(500, 'ACCOUNTING_CONFIG_INVALID', `${label} must be an integer.`);
  }
  return value;
}

/** Canonical permission payload parsing (same rules as the accepted 042 decision). */
function parseRoleRule(role) {
  if (role.protected) return {matches: true, review: false, rule: {protected: true}};
  const rule = role.rule;
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    throw new SliceError(500, 'ACCOUNTING_PERMISSION_INVALID', 'A role has a malformed permission payload.');
  }
  for (const key of ['actions', 'companies', 'branches', 'accounts']) {
    if (!Array.isArray(rule[key]) || rule[key].some(item => typeof item !== 'string')) {
      throw new SliceError(500, 'ACCOUNTING_PERMISSION_INVALID', `A role has a malformed "${key}" array.`);
    }
  }
  if ('review' in rule && typeof rule.review !== 'boolean') {
    throw new SliceError(500, 'ACCOUNTING_PERMISSION_INVALID', 'A role has a non-boolean review rule.');
  }
  if ('maxMinor' in rule) {
    const max = rule.maxMinor;
    if (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 0 || max > 999999999999) {
      throw new SliceError(500, 'ACCOUNTING_PERMISSION_INVALID', 'A role has an invalid maxMinor limit.');
    }
  }
  return {matches: false, review: rule.review ?? true, rule};
}

function roleGrants(parsed, {action, company, branch, accounts, amountMinor}) {
  if (parsed.matches) return true;
  const {rule} = parsed;
  if (!rule.actions.includes(action)) return false;
  if (!(rule.companies.includes('*') || rule.companies.includes(company))) return false;
  if (!(rule.branches.includes('*') || rule.branches.includes(branch))) return false;
  if (!accounts.every(code => rule.accounts.includes('*') || rule.accounts.includes(code))) return false;
  if (rule.maxMinor != null && amountMinor > BigInt(rule.maxMinor)) return false;
  return true;
}

export function createPgRepository({
  pool,
  principalRole = 'saven_customer_app',
  allocator = {sequence: 'document_sequences', kindSeparator: '-'},
  onCleanupFault = () => {},
} = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error('createPgRepository requires a PostgreSQL pool.');
  }

  /**
   * Checkout that pins the restricted principal.
   *
   * AUTH-002/003 discipline on a money-writing path: every checkout is owned exactly
   * once, and an uncertain transaction, rollback or role/context reset destroys it
   * irreversibly instead of returning it to the pool for reuse. Cleanup never erases the
   * primary failure: the original error is always the one propagated.
   */
  async function checkout(run, {readOnly = false} = {}) {
    const client = await pool.connect();
    let entered = false;
    let committed = false;
    let uncertain = false;

    const destroy = () => { uncertain = true; };

    try {
      await client.query(`SET ROLE ${principalRole}`);
      await client.query('BEGIN');
      entered = true;
      if (readOnly) await client.query('SET TRANSACTION READ ONLY');
      const result = await run(client);
      try {
        await client.query('COMMIT');
        committed = true;
        return result;
      } catch (commitError) {
        // The commit outcome is unknown: destroy the checkout, never reuse it.
        destroy();
        throw commitError;
      }
    } catch (error) {
      if (entered && !committed) {
        try {
          await client.query('ROLLBACK');
        } catch {
          destroy();
        }
      }
      throw error;
    } finally {
      // RESET ROLE is only meaningful on a confirmed-clean connection. A failure here
      // means the session state is unknown, so the client is destroyed.
      let resetFailed = false;
      if (!uncertain) {
        try {
          await client.query('RESET ROLE');
        } catch {
          resetFailed = true;
        }
      }
      if (uncertain || resetFailed) {
        // A confirmed COMMIT stays reported as committed; the cleanup fault is surfaced
        // separately so a caller cannot mistake it for a failed business transaction and
        // retry it into a duplicate. The connection itself is never reused.
        if (resetFailed) onCleanupFault(new Error('RESET ROLE failed; connection destroyed'));
        client.release(true);
      } else {
        client.release();
      }
    }
  }

  async function transaction(ctx, fn, options = {}) {
    if (!isUuid(ctx.tenantId) || !isUuid(ctx.userUuid) || typeof ctx.actor !== 'string') {
      throw new SliceError(500, 'ACCOUNTING_CONTEXT_INVALID', 'A verified tenant/actor context is required.');
    }
    return checkout(async client => {
      // Transaction-scoped context only: never a session-level GUC behind a pooler.
      await client.query(
        `SELECT set_config('app.current_tenant_id', $1, true),
                set_config('app.current_user_id', $2, true)`,
        [ctx.tenantId, ctx.userUuid],
      );
      const tx = createTx(client, ctx);
      const result = await fn(tx);
      // Accepted AUTH-006 pre-commit revalidation: a membership/role/assurance change that
      // won during handler execution discards these business effects.
      if (typeof ctx.beforeCommit === 'function') await ctx.beforeCommit();
      // The acting principal is observed on the client that executed the work.
      const identity = await client.query(
        'SELECT current_user AS current_user, session_user AS session_user');
      ctx.principal = identity.rows[0];
      return result;
    }, {readOnly: options.readOnly === true});
  }

  function createTx(client, ctx) {
    const q = (text, params) => client.query(text, params);

    return {
      /** Reads the accepted command row and locks it for a durable transition. */
      async lockCommand(id) {
        const {rows} = await q(
          `SELECT id, actor, digest, payload, state FROM tenant_data.command_inbox
            WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [ctx.tenantId, id]);
        return rows[0] ?? null;
      },
      async findCommand(id) {
        const {rows} = await q(
          `SELECT id, actor, digest, payload, state FROM tenant_data.command_inbox
            WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, id]);
        return rows[0] ?? null;
      },
      async findNumber(id) {
        const {rows} = await q(
          `SELECT sequence, number FROM tenant_data.document_numbers
            WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, id]);
        return rows[0] ?? null;
      },
      async requireAuthority({actor, action, company, branch, accounts, amountMinor}) {
        const denied = await q(
          `SELECT 1 FROM tenant_data.denials
            WHERE tenant_id = $1 AND user_id = $2 AND action IN ($3, '*') LIMIT 1`,
          [ctx.tenantId, actor, action]);
        if (denied.rowCount > 0) throw refuse.permissionDenied(action);
        const {rows} = await q(AUTHORITY_ROLES, [ctx.tenantId, actor]);
        let review = true;
        const roleIds = [];
        for (const role of rows) {
          const parsed = parseRoleRule(role);
          if (!roleGrants(parsed, {action, company, branch, accounts, amountMinor})) continue;
          roleIds.push(role.role_id);
          review = review && parsed.review;
        }
        if (roleIds.length === 0) throw refuse.permissionDenied(action);
        return {allowed: true, review, roleIds};
      },
      async requireOpenPeriod({company, postingDate}) {
        const {rowCount} = await q(
          `SELECT 1 FROM tenant_data.periods
            WHERE tenant_id = $1 AND company = $2 AND locked
              AND start_date <= $3 AND end_date >= $3 LIMIT 1`,
          [ctx.tenantId, company, postingDate]);
        if (rowCount > 0) throw refuse.periodLocked();
      },
      async requireAccounts({lines}) {
        const codes = lines.map(line => line.account);
        const {rows} = await q(
          `SELECT code FROM tenant_data.accounts WHERE tenant_id = $1 AND code = ANY($2::text[])`,
          [ctx.tenantId, codes]);
        const found = new Set(rows.map(row => row.code));
        const missing = codes.filter(code => !found.has(code));
        if (missing.length) throw refuse.invalidEntry(`Unknown account(s): ${missing.join(', ')}.`);
      },
      async insertCommand({id, actor, digest, payload, state, at}) {
        await q(
          `INSERT INTO tenant_data.command_inbox
             (tenant_id, id, actor, digest, payload, state, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [ctx.tenantId, id, actor, digest, payload, state, at]);
      },
      async insertNumber({id, company, kind, sequence, number}) {
        await q(
          `INSERT INTO tenant_data.document_numbers
             (tenant_id, id, company, kind, sequence, number, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [ctx.tenantId, id, company, kind, sequence, number, ctx.now]);
      },
      async insertDocumentRegistry({documentId, status, company, branch, sourceCommandId, actor}) {
        await q(
          `INSERT INTO tenant_data.document_registry
             (tenant_id, document_id, document_type, document_status, current_revision,
              company, branch, source_command_id, origin_type, created_by, updated_by)
           VALUES ($1, $2, 'journal', $3, 1, $4, $5, $6, 'human', $7, $7)`,
          [ctx.tenantId, documentId, status, company, branch, sourceCommandId, actor]);
      },
      async updateDocumentStatus({documentId, status, actor}) {
        await q(
          `UPDATE tenant_data.document_registry
              SET document_status = $3, current_revision = current_revision + 1,
                  updated_at = now(), updated_by = $4
            WHERE tenant_id = $1 AND document_id = $2`,
          [ctx.tenantId, documentId, status, actor]);
      },
      async updateCommandState({id, state, actor, at}) {
        await q(
          `UPDATE tenant_data.command_inbox
              SET state = $3, updated_at = $4, updated_by = $5
            WHERE tenant_id = $1 AND id = $2`,
          [ctx.tenantId, id, state, at, actor]);
      },
      async insertJournal({id, journal, at}) {
        await q(
          `INSERT INTO tenant_data.journals
             (tenant_id, id, company, branch, posting_date, narrative, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [ctx.tenantId, id, journal.company, journal.branch, journal.postingDate, journal.narrative, at]);
      },
      async insertLines({id, lines, at}) {
        for (const [index, line] of lines.entries()) {
          await q(
            `INSERT INTO tenant_data.journal_lines
               (tenant_id, journal_id, line_no, account, debit, credit, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
            [ctx.tenantId, id, index + 1, line.account, line.debit.toString(), line.credit.toString(), at]);
        }
      },
      async insertOutbox({id, event}) {
        await q(
          `INSERT INTO tenant_data.outbox (tenant_id, id, event, state, attempts, created_at, updated_at)
           VALUES ($1, $2, $3, 'READY', 0, $4, $4)`,
          [ctx.tenantId, id, event, ctx.now]);
      },
      async logLifecycle({commandId, event, detail}) {
        await q(
          `INSERT INTO tenant_data.audit
             (tenant_id, command_id, actor, event, detail, happened_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [ctx.tenantId, commandId, ctx.actor, event, JSON.stringify(detail), ctx.now]);
      },
      async callVoid({entry, reason, idempotencyKey}) {
        const {rows} = await q(
          `SELECT tenant_data.void_posted_entry($1::uuid, $2, $3, $4, $5, NULL, $6) AS void_command`,
          [ctx.tenantId, entry, ctx.actor, reason, idempotencyKey, ctx.requestId ?? null]);
        return rows[0].void_command;
      },
      async readJournal(id) {
        const {rows} = await q(
          `SELECT j.id, j.company, j.branch, j.posting_date, j.narrative, c.actor, c.state,
                  n.number, n.sequence
             FROM tenant_data.journals j
             JOIN tenant_data.command_inbox c ON c.tenant_id = j.tenant_id AND c.id = j.id
             LEFT JOIN tenant_data.document_numbers n ON n.tenant_id = j.tenant_id AND n.id = j.id
            WHERE j.tenant_id = $1 AND j.id = $2`, [ctx.tenantId, id]);
        if (!rows[0]) return null;
        const {rows: lines} = await q(
          `SELECT line_no, account, debit, credit FROM tenant_data.journal_lines
            WHERE tenant_id = $1 AND journal_id = $2 ORDER BY line_no`, [ctx.tenantId, id]);
        const {rows: voided} = await q(
          `SELECT void_command_id, reason, voided_at FROM tenant_data.entry_voids
            WHERE tenant_id = $1 AND entry_id = $2`, [ctx.tenantId, id]);
        return {...rows[0], lines, voided: voided[0] ?? null};
      },
      async listJournals({company = null, branch = null} = {}) {
        const {rows} = await q(
          `SELECT j.id, j.company, j.branch, j.posting_date, j.narrative, c.state, n.number
             FROM tenant_data.journals j
             JOIN tenant_data.command_inbox c ON c.tenant_id = j.tenant_id AND c.id = j.id
             LEFT JOIN tenant_data.document_numbers n ON n.tenant_id = j.tenant_id AND n.id = j.id
            WHERE j.tenant_id = $1
              AND ($2::text IS NULL OR j.company = $2)
              AND ($3::text IS NULL OR j.branch = $3)
            ORDER BY j.id`, [ctx.tenantId, company, branch]);
        return rows;
      },
      async listLifecycle(commandId) {
        const params = [ctx.tenantId];
        let filter = '';
        if (commandId) { params.push(commandId); filter = ' AND command_id = $2'; }
        const {rows} = await q(
          `SELECT id, command_id, actor, event, detail, happened_at
             FROM tenant_data.audit WHERE tenant_id = $1${filter} ORDER BY id`, params);
        return rows;
      },
      /**
       * Change events are correlated by entity id where 041 records one (journals,
       * lines, the document registry) and by monotonic id window otherwise (sequence
       * counters and number rows have no single entity id). Both views are exposed so a
       * caller never has to guess which correlation applies.
       */
      async listChangeEvents({commandId = null, sinceId = 0} = {}) {
        const params = [ctx.tenantId, sinceId];
        let filter = ' AND id > $2';
        if (commandId) { params.push(commandId); filter += ' AND entity_id = $3'; }
        const {rows} = await q(
          `SELECT id, entity_type, entity_id, event, actor_id, origin_type, detail_jsonb
             FROM tenant_data.audit_event WHERE tenant_id = $1${filter} ORDER BY id`, params);
        return rows;
      },
      /** First-post key/digest binding, recorded on the canonical posting event. */
      async postingReceiptKey(commandId) {
        const {rows} = await q(
          `SELECT detail FROM tenant_data.audit
            WHERE tenant_id = $1 AND command_id = $2 AND event = 'JOURNAL_POSTED'
            ORDER BY id DESC LIMIT 1`, [ctx.tenantId, commandId]);
        if (!rows[0]) return null;
        try {
          const detail = JSON.parse(rows[0].detail);
          return {idempotencyKey: detail.idempotencyKey ?? null, requestDigest: detail.requestDigest ?? null};
        } catch { return null; }
      },
      async ledger() {
        const {rows} = await q(
          `SELECT journal_id, line_no, account, debit, credit FROM tenant_data.active_general_ledger
            WHERE tenant_id = $1 ORDER BY journal_id, line_no`, [ctx.tenantId]);
        return rows;
      },
      async voided() {
        const {rows} = await q(
          `SELECT entry_id, void_command_id, reason, account, debit, credit
             FROM tenant_data.voided_entries WHERE tenant_id = $1
            ORDER BY entry_id, line_no`, [ctx.tenantId]);
        return rows;
      },
      async identity() {
        const {rows} = await q(`SELECT current_user AS current_user, session_user AS session_user`);
        return rows[0];
      },
    };
  }

  /**
   * Independent, durable number reservation. Deliberately its own transaction.
   *
   * Idempotent on the journal id: a retry after a failed business transaction reuses
   * the number already recorded for that id instead of consuming a second one, so a
   * lost-response retry converges without duplicate identities.
   */
  async function reserveNumber(ctx, {id, company, kind, requestDigest}) {
    if (!isUuid(ctx.tenantId) || !isUuid(ctx.userUuid)) {
      throw new SliceError(500, 'ACCOUNTING_CONTEXT_INVALID', 'A verified tenant context is required.');
    }
    return checkout(async client => {
      await client.query(
        `SELECT set_config('app.current_tenant_id', $1, true),
                set_config('app.current_user_id', $2, true)`,
        [ctx.tenantId, ctx.userUuid],
      );
      await client.query(
        `INSERT INTO tenant_data.document_sequences (tenant_id, company, kind, next_number, updated_by)
         VALUES ($1, $2, $3, 1, $4) ON CONFLICT (tenant_id, company, kind) DO NOTHING`,
        [ctx.tenantId, company, kind, ctx.actor]);
      const locked = await client.query(SEQ_ROW_LOCK, [ctx.tenantId, company, kind]);
      if (locked.rowCount !== 1) throw refuse.allocatorExhausted();

      // Immutable binding: only the identical original request may recover the receipt.
      const receipt = await client.query(
        `SELECT company, kind, sequence, number, actor, request_digest
           FROM tenant_data.document_allocations WHERE tenant_id = $1 AND allocation_id = $2`,
        [ctx.tenantId, id]);
      if (receipt.rowCount === 1) {
        const row = receipt.rows[0];
        if (row.actor !== ctx.actor || row.request_digest !== requestDigest
            || row.company !== company || row.kind !== kind) {
          throw refuse.idempotencyConflict();
        }
        return {sequence: row.sequence, number: row.number, reused: true};
      }
      const existing = await client.query(
        `SELECT sequence, number FROM tenant_data.document_numbers
          WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, id]);
      if (existing.rowCount === 1) {
        // A number exists without a receipt: an allocator-era gap. Refuse to rebind it.
        throw refuse.idempotencyConflict();
      }

      const next = boundedInteger(locked.rows[0].next_number, 'next_number');
      if (next > 999999999) throw refuse.allocatorExhausted();
      await client.query(
        `UPDATE tenant_data.document_sequences SET next_number = next_number + 1,
                updated_at = (extract(epoch FROM now()) * 1000)::bigint, updated_by = $4
          WHERE tenant_id = $1 AND company = $2 AND kind = $3`,
        [ctx.tenantId, company, kind, ctx.actor]);
      const number = `${kind}${allocator.kindSeparator}${String(next).padStart(6, '0')}`;
      await client.query(
        `INSERT INTO tenant_data.document_numbers
           (tenant_id, id, company, kind, sequence, number, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [ctx.tenantId, id, company, kind, next, number, ctx.now]);
      await client.query(
        `INSERT INTO tenant_data.document_allocations
           (tenant_id, allocation_id, company, kind, sequence, number, actor, request_digest)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [ctx.tenantId, id, company, kind, next, number, ctx.actor, requestDigest]);
      return {sequence: next, number, reused: false};
    });
  }

  async function identity() {
    return checkout(async client => {
      const {rows} = await client.query(
        'SELECT current_user AS current_user, session_user AS session_user');
      return rows[0];
    });
  }

  return Object.freeze({transaction, reserveNumber, identity, principalRole});
}

export {parseRoleRule, roleGrants};
