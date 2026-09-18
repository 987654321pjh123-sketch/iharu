import { createHmac, timingSafeEqual } from 'node:crypto';
import { APIError } from 'better-auth/api';
import { query, type AuthDatabase } from './database.js';

export const REAUTH_MS = 5 * 60_000;
export const IDLE_MS = 7 * 86400_000;
export const MAX_SESSION_MS = 30 * 86400_000;
export type Guard = { member_id: string; status: string; access_ready: boolean; assurance: 'LOW' | 'HIGH'; reauthenticated_at: Date | null; last_seen_at: Date; absolute_expires_at: Date };
export function policyError(code: string, status: 'FORBIDDEN' | 'TOO_MANY_REQUESTS' | 'BAD_REQUEST' = 'FORBIDDEN'): never {
  throw new APIError(status, { code, message: code });
}
export function normalizePhone(raw: unknown): string {
  if (typeof raw !== 'string') policyError('INVALID_PHONE', 'BAD_REQUEST');
  const clean = raw.replace(/[\s()-]/g, '');
  const phone = clean.startsWith('010') ? `+82${clean.slice(1)}` : clean;
  if (!/^\+8210\d{8}$/.test(phone)) policyError('INVALID_PHONE', 'BAD_REQUEST');
  return phone;
}
export class AuthPolicy {
  constructor(readonly db: AuthDatabase, readonly secret: string, readonly now: () => Date = () => new Date()) {}
  digest(value: string) { return createHmac('sha256', this.secret).update(value).digest('hex'); }
  async guard(sessionId: string, touch = true): Promise<Guard | null> {
    const [g] = await query<Guard>(this.db, `SELECT m.id member_id,m.status,m.access_ready,g.assurance,g.reauthenticated_at,g.last_seen_at,g.absolute_expires_at
      FROM iharu_auth.session_guard g JOIN iharu_auth.session s ON s.id=g.session_id
      JOIN iharu_auth.members m ON m.auth_user_id=s."userId" WHERE s.id=$1 AND s."expiresAt">$2`, [sessionId, this.now()]);
    if (!g) return null;
    if (g.status !== 'ACTIVE' || +new Date(g.absolute_expires_at) <= +this.now() || +new Date(g.last_seen_at) + IDLE_MS <= +this.now()) {
      await query(this.db, 'DELETE FROM iharu_auth.session WHERE id=$1', [sessionId]);
      return null;
    }
    if (touch) await query(this.db, 'UPDATE iharu_auth.session_guard SET last_seen_at=$2 WHERE session_id=$1', [sessionId, this.now()]);
    return g;
  }
  async requireRecent(sessionId: string) {
    const g = await this.guard(sessionId);
    if (!g || g.assurance !== 'HIGH' || !g.reauthenticated_at || +new Date(g.reauthenticated_at) + REAUTH_MS <= +this.now()) policyError('REAUTH_REQUIRED');
    return g;
  }
  // Row locks serialize every replica. HMAC keys avoid putting addresses, IPs or phone numbers in counters.
  async takeLimits(rules: { key: string; windowMs: number; limit: number }[]) {
    const now = +this.now();
    await this.db.transaction().execute(async tx => {
      for (const r of [...rules].sort((a,b) => a.key.localeCompare(b.key))) {
        const key = this.digest(r.key);
        await query(tx, `INSERT INTO iharu_auth.rate_buckets (key,count,window_start,expires_at) VALUES ($1,0,$2,$3) ON CONFLICT DO NOTHING`, [key, new Date(now), new Date(now + r.windowMs)]);
        const [row] = await query<{ count: number; expires_at: Date }>(tx, 'SELECT count,expires_at FROM iharu_auth.rate_buckets WHERE key=$1 FOR UPDATE', [key]);
        const expired = +new Date(row.expires_at) <= now;
        if (!expired && row.count >= r.limit) policyError('RATE_LIMITED', 'TOO_MANY_REQUESTS');
        await query(tx, `UPDATE iharu_auth.rate_buckets SET count=$2,window_start=CASE WHEN $3 THEN $4 ELSE window_start END,expires_at=CASE WHEN $3 THEN $5 ELSE expires_at END WHERE key=$1`, [key, expired ? 1 : row.count + 1, expired, new Date(now), new Date(now + r.windowMs)]);
      }
      await query(tx, 'DELETE FROM iharu_auth.rate_buckets WHERE expires_at < $1', [new Date(now - 86400_000)]);
    });
  }
  async reserveSms(phone: string, ip: string, dailyBudget: number) {
    await this.takeLimits([
      { key: `sms:cooldown:${phone}`, windowMs: 60_000, limit: 1 },
      { key: `sms:hour:${phone}`, windowMs: 3600_000, limit: 5 },
      { key: `sms:day:${phone}`, windowMs: 86400_000, limit: 10 },
      { key: `sms:ip:${ip}`, windowMs: 3600_000, limit: 20 },
      { key: 'sms:budget', windowMs: 86400_000, limit: dailyBudget },
    ]);
  }
  async saveOtp(phone: string, code: string) {
    const now = this.now();
    await query(this.db, `INSERT INTO iharu_auth.phone_challenges (key,code_hash,attempts,expires_at)
      VALUES ($1,$2,0,$3) ON CONFLICT (key) DO UPDATE SET code_hash=EXCLUDED.code_hash,attempts=0,expires_at=EXCLUDED.expires_at`,
    [this.digest(`phone:${phone}`), this.digest(`${phone}:${code}`), new Date(+now + 180_000)]);
  }
  async consumeOtp(phone: string, code: string): Promise<boolean> {
    return this.db.transaction().execute(async tx => {
      const key = this.digest(`phone:${phone}`);
      const [challenge] = await query<{ code_hash: string; attempts: number; expires_at: Date }>(tx, 'SELECT * FROM iharu_auth.phone_challenges WHERE key=$1 FOR UPDATE', [key]);
      if (!challenge) return false;
      if (+new Date(challenge.expires_at) <= +this.now() || challenge.attempts >= 5) {
        await query(tx, 'DELETE FROM iharu_auth.phone_challenges WHERE key=$1', [key]); return false;
      }
      const valid = timingSafeEqual(Buffer.from(challenge.code_hash, 'hex'), Buffer.from(this.digest(`${phone}:${code}`), 'hex'));
      if (valid || challenge.attempts + 1 >= 5) await query(tx, 'DELETE FROM iharu_auth.phone_challenges WHERE key=$1', [key]);
      else await query(tx, 'UPDATE iharu_auth.phone_challenges SET attempts=attempts+1 WHERE key=$1', [key]);
      return valid;
    });
  }
  async unlink(userId: string, sessionId: string, accountId: string) {
    await this.requireRecent(sessionId);
    await this.db.transaction().execute(async tx => {
      // Serialize all login-method removals for this member, including phone removal.
      const [user] = await query<{ emailVerified: boolean; phoneNumberVerified: boolean }>(tx, 'SELECT * FROM iharu_auth."user" WHERE id=$1 FOR UPDATE', [userId]);
      const accounts = await query<{ id: string; providerId: string; password: string | null }>(tx, 'SELECT id,"providerId",password FROM iharu_auth.account WHERE "userId"=$1', [userId]);
      const usable = accounts.filter(a => a.providerId !== 'credential' || (a.password && user.emailVerified));
      const total = usable.length + (user.phoneNumberVerified ? 1 : 0);
      if (accountId === 'phone' ? !user.phoneNumberVerified : !accounts.some(a => a.id === accountId)) policyError('METHOD_NOT_FOUND', 'BAD_REQUEST');
      const removingUsable = accountId === 'phone' || usable.some(a => a.id === accountId);
      if (removingUsable && total <= 1) policyError('LAST_LOGIN_METHOD');
      if (accountId === 'phone') await query(tx, 'UPDATE iharu_auth."user" SET "phoneNumber"=NULL,"phoneNumberVerified"=false WHERE id=$1', [userId]);
      else await query(tx, 'DELETE FROM iharu_auth.account WHERE id=$1 AND "userId"=$2', [accountId, userId]);
      await query(tx, 'DELETE FROM iharu_auth.session WHERE "userId"=$1 AND id<>$2', [userId, sessionId]);
    });
  }
}
