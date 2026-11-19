// PIVOT-014 — versioned application handler for the authenticated journal lifecycle.
//
// This is the real request handler of the PostgreSQL accounting application slice, not
// a test double: it performs exact-origin checking, resolves the session through the
// accepted auth store, enforces tenant admission with the accepted membership epoch,
// checks CSRF on every state change, and only then calls the journal service on the
// restricted runtime principal. It returns Web `Response` objects so any server can
// mount it without a framework.
//
// Composition helpers below adapt the *accepted* auth modules (session store, security
// audit writer) to the ports; the test composes the same helpers with a disposable
// database.

import {createHash, timingSafeEqual} from 'node:crypto';
import {
  API_PREFIX, API_VERSION, SLICE_VERSION, SliceError, assertPorts, refuse,
} from './ports.mjs';
import {createJournalService} from './journal-service.mjs';
import {createPgRepository} from './pg-repository.mjs';

const MAX_BODY = 64 * 1024;
const CUSTOMER_REALM = 'customer';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'},
  });
}

function failure(status, code, message) {
  return json(status, {ok: false, error: {code, message}});
}

function digest(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/* ------------------------------------------------------------------ ports */

/**
 * Session port over the accepted AUTH-002 store. The token is read from the cookie the
 * auth routes issued; only its digest is ever compared. `refresh` is not called here —
 * the accounting slice observes the session, it does not extend it.
 */
export function createSessionPort({store, cookieName}) {
  if (!store || typeof store.readSession !== 'function') {
    throw new Error('createSessionPort requires the accepted auth session store.');
  }
  return Object.freeze({
    async verify(request) {
      const header = request.headers.get('cookie') ?? '';
      const pattern = new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`);
      const token = header.match(pattern)?.[1];
      if (!token) throw refuse.authRequired();
      const session = await store.readSession(token, {realm: CUSTOMER_REALM});
      if (!session) throw refuse.sessionInvalid();
      if (session.realm !== CUSTOMER_REALM) throw refuse.sessionInvalid();
      return session;
    },
    csrfMatches(request, session) {
      const provided = request.headers.get('x-csrf-token');
      if (!provided || !session?.csrfTokenHash) return false;
      return constantTimeEqual(digest(provided), session.csrfTokenHash);
    },
  });
}

/**
 * Admission port over the accepted AUTH-006 boundary.
 *
 * `withAdmission` delegates to `createTenantSelection().withAuthority`, which resolves the
 * verified principal, the exact selected role/epoch, assurance/MFA, takes the shared
 * authority gate and keeps the auth transaction (and its locks) open until the business
 * action completes. `assertAdmission` is the accepted pre-commit revalidation hook.
 *
 * `actorFor` only maps an already-verified user id to its tenant-local text id; it takes
 * no admission decision and cannot substitute for the gate above.
 */
export function createAdmissionPort({tenantSelection, authStore}) {
  if (!tenantSelection || typeof tenantSelection.withAuthority !== 'function') {
    throw new Error('createAdmissionPort requires the accepted tenant-selection authority port.');
  }
  if (!authStore || typeof authStore.withTransaction !== 'function') {
    throw new Error('createAdmissionPort requires the accepted auth transaction boundary.');
  }
  return Object.freeze({
    withAdmission(session, action) {
      return tenantSelection.withAuthority(session, action);
    },
    async actorFor(userId) {
      return authStore.withTransaction(async tx => {
        const {rows} = await tx.query('SELECT legacy_id FROM auth.users WHERE id = $1', [userId]);
        if (!rows[0]?.legacy_id) {
          throw new SliceError(403, 'TENANT_ACTOR_UNMAPPED',
            'This identity has no tenant-local principal mapping.');
        }
        return rows[0].legacy_id;
      });
    },
  });
}

/**
 * Security-audit port over the accepted AUTH-009 writer. The catalog version is pinned:
 * a writer reported at a different version fails closed instead of silently asserting
 * against a different event vocabulary.
 */
export function createSecurityAuditPort({writer, pinnedVersion = 1}) {
  if (!writer || typeof writer !== 'function') {
    throw new Error('createSecurityAuditPort requires the accepted security-audit writer.');
  }
  // Read the ACTIVE catalog version from the configured writer itself; a caller-supplied
  // pin is never echoed back as evidence of what the writer will emit.
  const active = typeof writer.catalog === 'function'
    ? writer.catalog()?.catalogVersion
    : typeof writer.stats === 'function' ? writer.stats()?.catalogVersion : writer.catalogVersion;
  if (typeof active !== 'number') {
    throw new SliceError(500, 'AUDIT_CATALOG_UNAVAILABLE',
      'The security-audit writer does not expose its active catalog version.');
  }
  if (active !== pinnedVersion) throw refuse.catalogMismatch(pinnedVersion, active);
  return Object.freeze({
    version: active,
    async record(event) {
      await writer(event);
      return {recorded: true, version: pinnedVersion};
    },
  });
}

/* ------------------------------------------------------------- application */

export function createVerticalSliceApplication(ports) {
  assertPorts(ports);
  const {session, gate, journal, securityAudit, clock} = ports;
  const service = createJournalService({repository: journal, actions: ports.actions});

  // Fail closed: the pinned catalog version must match the active writer's vocabulary.
  if (securityAudit.version !== ports.pinnedCatalogVersion) {
    throw refuse.catalogMismatch(ports.pinnedCatalogVersion, securityAudit.version);
  }

  const trace = [];
  const record = (step, detail = {}) => {
    trace.push({step, at: clock.now(), ...detail});
    if (trace.length > 200) trace.shift();
  };

  function requireOrigin(request) {
    const origin = request.headers.get('origin');
    if (!origin || origin !== ports.customerOrigin) throw refuse.originUnrecognized();
    record('origin.verified');
  }

  async function refuseWith(request, error) {
    // Security-audit evidence for authorization refusals. Business refusals are also
    // recorded here because they are denial decisions that must survive a rollback.
    if (error instanceof SliceError && [401, 403, 409, 421, 422].includes(error.status)) {
      try {
        await securityAudit.record({
          eventType: error.status === 401 ? 'session_denied' : 'access_denied',
          outcome: 'denied',
          actorKind: request._sliceSession ? 'authenticated' : 'unknown',
          realm: CUSTOMER_REALM,
          user: request._sliceSession ? {id: request._sliceSession.userId} : null,
          sessionId: request._sliceSession?.id ?? null,
          request,
          detail: {reason: error.code, route: new URL(request.url).pathname},
        });
        record('securityAudit.recorded', {reason: error.code});
      } catch (auditError) {
        // A denial that cannot be recorded must not become a success, but the denial
        // itself still stands. Surface the audit fault explicitly.
        record('securityAudit.failed', {reason: error.code, fault: String(auditError?.message ?? auditError)});
      }
    }
    return failure(error.status, error.code, error.message);
  }

  async function handle(request) {
    const url = new URL(request.url);
    let resolved = null;
    try {
      requireOrigin(request);
      if (!url.pathname.startsWith(API_PREFIX)) {
        return failure(404, 'ACCOUNTING_ROUTE_UNAVAILABLE', 'Versioned accounting endpoint unavailable.');
      }
      // Session verification is genuine: the accepted session row is re-read for every
      // request, and no header, test principal or direct service call can substitute.
      resolved = await session.verify(request);
      request._sliceSession = resolved;
      record('session.verified', {sessionId: resolved.id});

      const mutation = request.method !== 'GET';
      if (mutation && !session.csrfMatches(request, resolved)) throw refuse.csrfRequired();
      if (mutation) record('csrf.verified');

      const requestId = request.headers.get('x-request-id') || null;
      const tail = url.pathname.slice(API_PREFIX.length);
      const parts = tail.split('/').filter(Boolean);

      // The accepted AUTH-006 boundary owns admission for the whole request: allocation,
      // reads, listing, posting and voiding all run inside it, with the auth transaction
      // and its locks held until the business action completes.
      let response = null;
      await gate.withAdmission(resolved, async ({resolved: admitted, assertAdmission}) => {
        record('tenant.admitted', {tenantId: admitted.tenantId, epoch: admitted.membershipEpoch});
        const actor = await gate.actorFor(admitted.userId);
        const ctx = {
          tenantId: admitted.tenantId,
          userUuid: admitted.userId,
          actor,
          membershipEpoch: admitted.membershipEpoch,
          roleId: admitted.roleId,
          requestId,
          now: clock.now(),
          beforeCommit: assertAdmission,
        };
        record('gate.held', {tenantId: ctx.tenantId});
        response = await (async () => {

      if (request.method === 'POST' && parts.length === 1 && parts[0] === 'journals') {
        const body = await readJson(request);
        const key = request.headers.get('idempotency-key');
        const post = url.searchParams.get('post') === '1' || body.post === true;
        record('service.create');
        const result = await service.create(ctx, {payload: body.journal ?? body, idempotencyKey: key, post});
        return json(201, {ok: true, data: result, meta: {principal: ctx.principal, version: API_VERSION, slice: SLICE_VERSION}});
      }

      if (request.method === 'POST' && parts.length === 3 && parts[0] === 'journals' && parts[2] === 'post') {
        record('service.post');
        const result = await service.post(ctx, {
          id: parts[1], idempotencyKey: request.headers.get('idempotency-key') ?? undefined,
        });
        return json(200, {ok: true, data: result, meta: {principal: ctx.principal, version: API_VERSION, slice: SLICE_VERSION}});
      }

      if (request.method === 'POST' && parts.length === 3 && parts[0] === 'journals' && parts[2] === 'void') {
        const body = await readJson(request);
        record('service.void');
        const result = await service.voidEntry(ctx, {
          id: parts[1], reason: body.reason, idempotencyKey: request.headers.get('idempotency-key'),
        });
        return json(200, {ok: true, data: result, meta: {principal: ctx.principal, version: API_VERSION, slice: SLICE_VERSION}});
      }

      if (request.method === 'GET' && parts.length === 2 && parts[0] === 'journals') {
        const data = await service.read(ctx, {
          id: parts[1],
          tenantId: url.searchParams.get('tenantId') ?? undefined,
          company: url.searchParams.get('company') ?? undefined,
          branch: url.searchParams.get('branch') ?? undefined,
        });
        record('service.read');
        return json(200, {ok: true, data, meta: {version: API_VERSION, slice: SLICE_VERSION}});
      }

      if (request.method === 'GET' && parts.length === 1 && parts[0] === 'journals') {
        const data = await service.list(ctx, {
          tenantId: url.searchParams.get('tenantId') ?? undefined,
          company: url.searchParams.get('company') ?? undefined,
          branch: url.searchParams.get('branch') ?? undefined,
        });
        record('service.list', {count: data.length});
        return json(200, {ok: true, data, meta: {version: API_VERSION, slice: SLICE_VERSION}});
      }

      if (request.method === 'GET' && parts.length === 1 && parts[0] === 'audit') {
        const data = await service.audit(ctx, {
          tenantId: url.searchParams.get('tenantId') ?? undefined,
          commandId: url.searchParams.get('commandId') ?? undefined,
          sinceId: url.searchParams.get('since') ?? undefined,
          company: url.searchParams.get('company') ?? undefined,
          branch: url.searchParams.get('branch') ?? undefined,
        });
        record('service.audit', {lifecycle: data.lifecycle.length, changes: data.changes.length});
        return json(200, {ok: true, data, meta: {version: API_VERSION, slice: SLICE_VERSION}});
      }

      return failure(404, 'ACCOUNTING_ROUTE_UNAVAILABLE', 'Versioned accounting endpoint unavailable.');
        })();
      });
      return response;
    } catch (error) {
      if (error instanceof SliceError || (typeof error?.status === 'number' && typeof error?.code === 'string')) {
        return refuseWith(request, error);
      }
      record('error.unexpected', {message: String(error?.message ?? error)});
      if (process.env.PIVOT014_DEBUG) console.error('[pivot-014]', error);
      return failure(500, 'ACCOUNTING_UNAVAILABLE', 'The accounting request could not be completed.');
    } finally {
      request._sliceSession = null;
    }
  }

  handle.trace = trace;
  handle.service = service;
  handle.version = Object.freeze({api: API_VERSION, slice: SLICE_VERSION});
  return handle;
}

async function readJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new SliceError(415, 'JSON_REQUIRED', 'JSON content is required.');
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) throw new SliceError(413, 'BODY_TOO_LARGE', 'Request too large.');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed;
  } catch {
    throw new SliceError(400, 'JSON_INVALID', 'A JSON object body is required.');
  }
}

/**
 * Production composition root for this slice. It builds the repository on the
 * restricted pool and wires the accepted auth modules. Callers supply the pools;
 * nothing here reads environment secrets.
 */
export function composeVerticalSlice({
  businessPool, authStore, tenantSelection, securityAuditWriter, customerOrigin, cookieName,
  clock = {now: () => Date.now()}, pinnedCatalogVersion = 1, actions,
}) {
  const journal = createPgRepository({pool: businessPool});
  const securityAudit = createSecurityAuditPort({writer: securityAuditWriter, pinnedVersion: pinnedCatalogVersion});
  return createVerticalSliceApplication({
    session: createSessionPort({store: authStore, cookieName}),
    gate: createAdmissionPort({tenantSelection, authStore}),
    journal,
    securityAudit,
    clock,
    customerOrigin,
    pinnedCatalogVersion,
    actions,
  });
}
