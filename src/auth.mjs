import { hash, token } from './crypto.mjs';
import { requireThat } from './errors.mjs';

export const now = () => Math.floor(Date.now() / 1000);
export function cookieToken(request) {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)saven_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  return value || '';
}
export async function authenticate(db, request) {
  const value = cookieToken(request);
  requireThat(value, 401, 'SIGN_IN_REQUIRED', 'Sign in to your SAVEN account.');
  const sessionHash = await hash(value);
  const user = await db.prepare('SELECT u.id,u.name,u.email,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').bind(sessionHash, now()).first();
  requireThat(user, 401, 'SESSION_EXPIRED', 'This session has expired or your account was opened on another device.');
  return { ...user, sessionHash };
}
export async function redeemGrant(db, value) {
  requireThat(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 401, 'INVALID_INVITATION', 'This invitation is invalid or has expired.');
  const grantHash = await hash(value), claim = crypto.randomUUID(), session = token(), sessionHash = await hash(session);
  const expiresAt = now() + 8 * 60 * 60;
  await db.batch([
    db.prepare('UPDATE login_grants SET claim=? WHERE token_hash=? AND claim IS NULL AND expires_at>? AND user_id IN (SELECT id FROM users WHERE active=1)').bind(claim, grantHash, now()),
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) SELECT ?,user_id,? FROM login_grants WHERE token_hash=? AND claim=? ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at').bind(sessionHash, expiresAt, grantHash, claim),
    db.prepare('DELETE FROM login_grants WHERE token_hash=? AND claim=?').bind(grantHash, claim)
  ]);
  const created = await db.prepare('SELECT user_id FROM sessions WHERE token_hash=?').bind(sessionHash).first();
  requireThat(created, 401, 'INVALID_INVITATION', 'This invitation is invalid, already used, or has expired.');
  return { session, expiresAt };
}
export async function companyAccess(db, actor, companyId) {
  const company = await db.prepare('SELECT c.*,m.role FROM companies c JOIN memberships m ON m.company_id=c.id WHERE c.id=? AND m.user_id=? AND c.status=\'active\'').bind(companyId, actor.id).first();
  requireThat(company, 403, 'COMPANY_DENIED', 'You do not have access to this active company.');
  return company;
}
export function canPrepare(role) { return ['owner','admin','preparer'].includes(role); }
export function canReview(role) { return ['owner','admin','approver'].includes(role); }
