import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { APIError } from 'better-auth/api';
import { z } from 'zod';
import { query } from './database.js';
import { socialIds } from './config.js';
import { policyError } from './policy.js';
import type { AuthService } from './service.js';
import { getAuthRuntime } from './runtime.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { databaseFailureReason } from '../adapters/database-errors.js';
const checkedDatabases = new WeakSet<AuthService>();

const names = { email: '이메일', google: 'Google', kakao: '카카오', naver: '네이버', phone: '휴대폰' };
const publicPost = new Set(['/sign-up/email','/sign-in/email','/sign-in/social','/send-verification-email','/request-password-reset','/reset-password','/phone-number/send-otp','/phone-number/verify','/sign-out','/link-social','/change-password']);
const publicGet = /^(\/callback\/(google|kakao|naver)|\/verify-email|\/reset-password\/[^/]+|\/error)$/;
const mailPaths = new Set(['/sign-up/email','/sign-in/email','/send-verification-email','/request-password-reset','/reset-password']);
export async function currentSession(svc: AuthService, request: Request) {
  const s = await svc.auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } });
  if (!s) return null;
  const guard = await svc.policy.guard(s.session.id);
  return guard ? { ...s, guard } : null;
}

export function accountRoutes(resolve: () => AuthService | null = getAuthRuntime) {
  const app = new Hono();
  app.use('*', bodyLimit({ maxSize: 16_384, onError: c => c.json({ code: 'BODY_TOO_LARGE' }, 413) }));
  app.use('*', async (c, next) => {
    if (!c.req.path.startsWith('/api/auth/') && !c.req.path.startsWith('/api/account/')) { await next(); return; }
    c.header('Cache-Control', 'private, no-store'); c.header('Referrer-Policy', 'no-referrer');
    const callback = /^\/api\/auth\/callback\/(google|kakao|naver)$/.test(c.req.path);
    if (!['GET','HEAD'].includes(c.req.method) && !callback) {
      const origin = resolve()?.settings.origin || new URL(c.req.url).origin;
      if (c.req.header('Origin') !== origin) return c.json({ code: 'ORIGIN_REJECTED', message: '현재 화면을 새로 열고 다시 시도해 주세요.' }, 403);
    }
    await next();
  });
  app.get('/api/account/providers', async c => {
    const svc = resolve();
    let ready = false;
    if (svc) {
      try {
        await query(svc.db, 'SELECT id FROM iharu_auth.members LIMIT 1'); ready = true;
        if (!checkedDatabases.has(svc)) { console.info('AUTH_DATABASE_CHECK_OK'); checkedDatabases.add(svc); }
      } catch (error) {
        console.error(JSON.stringify({code:'AUTH_DATABASE_CHECK_FAILED',reason:databaseFailureReason(error)}));
        // Public response contains no configuration, schema or connection details.
      }
    }
    return c.json({ providers: (Object.keys(names) as (keyof typeof names)[]).map(id => ({
      id, name: names[id], enabled: ready && Boolean(id === 'email' ? svc?.settings.mail : id === 'phone' ? svc?.settings.sms : svc?.settings.social[id]),
    })) });
  });
  app.get('/api/account/session', async c => {
    const svc = resolve();
    const s = svc ? await currentSession(svc, c.req.raw) : null;
    if (!s) return c.json({ authenticated: false });
    if (s.guard.assurance === 'LOW') return c.json({ authenticated: true, assurance: 'LOW', accessReady: false });
    const contact = !s.user.email.endsWith('@identity.iharu.invalid');
    return c.json({ authenticated: true, assurance: 'HIGH', name: s.user.name,
      email: contact ? s.user.email : null, emailVerified: contact && s.user.emailVerified,
      accessReady: s.guard.access_ready && contact && s.user.emailVerified,
      reauthenticatedAt: s.guard.reauthenticated_at,
    });
  });
  app.all('/api/auth/*', async c => {
    const svc = resolve();
    if (!svc) return c.json({ code: 'AUTH_NOT_READY', message: '로그인 연결을 준비하고 있어요.' }, 503);
    const path = c.req.path.slice('/api/auth'.length);
    if (!(c.req.method === 'POST' && publicPost.has(path)) && !(c.req.method === 'GET' && publicGet.test(path))) return c.json({ code: 'AUTH_ROUTE_BLOCKED' }, 403);
    if (mailPaths.has(path) && !svc.settings.mail) return c.json({ code: 'PROVIDER_NOT_READY' }, 503);
    if (c.req.method === 'GET' && ['/verify-email'].includes(path)) {
      const callback = c.req.query('callbackURL');
      if (callback && new URL(callback, svc.settings.origin).href !== `${svc.settings.origin}/login?verified=1`) policyError('INVALID_CALLBACK', 'BAD_REQUEST');
    }
    if (c.req.method === 'GET' && path.startsWith('/reset-password/')) {
      if (new URL(c.req.query('callbackURL') || '', svc.settings.origin).href !== `${svc.settings.origin}/reset-password`) policyError('INVALID_CALLBACK', 'BAD_REQUEST');
    }
    if (c.req.method === 'POST') {
      const body: Record<string, unknown> = await c.req.raw.clone().json().catch(() => ({}));
      if (path === '/sign-up/email' && typeof body.email === 'string' && body.email.toLowerCase().endsWith('@identity.iharu.invalid')) policyError('INVALID_INPUT', 'BAD_REQUEST');
      const ip = process.env.VERCEL ? c.req.header('x-vercel-forwarded-for') || 'unknown' : 'local';
      await svc.policy.takeLimits([
        { key: `auth:ip:${ip}`, windowMs: 60_000, limit: 60 },
        ...(typeof body.email === 'string' ? [{ key: `auth:email:${path}:${body.email.toLowerCase()}`, windowMs: 60_000, limit: path === '/sign-in/email' ? 10 : 2 }] : []),
      ]);
      // Only fixed, first-party landing routes are accepted, even if a provider supports arbitrary redirects.
      for (const field of ['callbackURL','newUserCallbackURL','errorCallbackURL','redirectTo']) {
        if (body[field] !== undefined) {
          const allowed = field === 'redirectTo' ? '/reset-password' : field === 'errorCallbackURL' ? '/login' : path === '/sign-up/email' || path === '/send-verification-email' ? '/login?verified=1' : '/account';
          if (new URL(String(body[field]), svc.settings.origin).href !== new URL(allowed, svc.settings.origin).href) policyError('INVALID_CALLBACK', 'BAD_REQUEST');
        }
      }
      if (path === '/sign-in/social' || path === '/link-social') {
        if (!socialIds.includes(body.provider as typeof socialIds[number]) || !svc.settings.social[body.provider as typeof socialIds[number]]) return c.json({ code: 'PROVIDER_NOT_READY' }, 503);
        if (body.idToken || body.loginHint) policyError('INVALID_AUTH_FLOW', 'BAD_REQUEST');
      }
      if (path === '/phone-number/verify') {
        if (body.disableSession) policyError('INVALID_AUTH_FLOW', 'BAD_REQUEST');
        if (body.updatePhoneNumber) {
          const s = await currentSession(svc, c.req.raw);
          if (!s) policyError('AUTH_REQUIRED');
          await svc.policy.requireRecent(s.session.id);
          if (s.user.phoneNumberVerified) policyError('UNLINK_PHONE_FIRST');
        }
      }
    }
    const old = ['/sign-in/email','/phone-number/verify'].includes(path) || path.startsWith('/callback/') ? await currentSession(svc, c.req.raw) : null;
    const response = await svc.auth.handler(c.req.raw);
    // Sanitize the library's JSON: session tokens only travel in HttpOnly cookies.
    if (!(response.status >= 300 && response.status < 400) && response.headers.get('content-type')?.includes('application/json')) {
      const result = await response.json() as Record<string, unknown>;
      if (response.ok) {
        const user = result.user as { id?: string } | undefined;
        if (old && user?.id === old.user.id && result.token) await query(svc.db, 'DELETE FROM iharu_auth.session WHERE id=$1', [old.session.id]);
        if (path === '/phone-number/verify' && !result.token) policyError('AUTH_FLOW_FAILED');
        return new Response(JSON.stringify({ status: true, ...(typeof result.url === 'string' ? { url: result.url } : {}) }), { status: response.status, headers: response.headers });
      }
      return new Response(JSON.stringify({ code: String(result.code || 'AUTH_FAILED'), message: '입력한 내용을 확인하고 다시 시도해 주세요.' }), { status: response.status, headers: response.headers });
    }
    return response;
  });
  app.use('/api/account/*', async (c, next) => {
    const svc = resolve();
    if (!svc) return c.json({ code: 'AUTH_NOT_READY' }, 503);
    const s = await currentSession(svc, c.req.raw);
    if (!s) return c.json({ code: 'AUTH_REQUIRED' }, 401);
    const lowAllowed = ['/api/account/reauthenticate','/api/account/recovery','/api/account/logout'];
    if (s.guard.assurance === 'LOW' && !lowAllowed.includes(c.req.path)) return c.json({ code: 'ADDITIONAL_VERIFICATION_REQUIRED' }, 403);
    await next();
  });
  app.get('/api/account/methods', async c => {
    const svc = resolve()!; const s = (await currentSession(svc, c.req.raw))!;
    const accounts = await query<{ id: string; providerId: string }>(svc.db, 'SELECT id,"providerId" FROM iharu_auth.account WHERE "userId"=$1 ORDER BY "createdAt"', [s.user.id]);
    return c.json({ methods: [...accounts.map(a => ({ id: a.id, provider: a.providerId })), ...(s.user.phoneNumberVerified ? [{ id: 'phone', provider: 'phone' }] : [])] });
  });
  app.post('/api/account/unlink', async c => {
    const { accountId } = z.object({ accountId: z.string().min(1).max(100) }).parse(await c.req.json());
    const svc = resolve()!; const s = (await currentSession(svc, c.req.raw))!;
    await svc.policy.unlink(s.user.id, s.session.id, accountId);
    return c.json({ status: true });
  });
  app.post('/api/account/email/start', async c => {
    const { email, password } = z.object({ email: z.email().max(254).transform(v => v.trim().toLowerCase()), password: z.string().min(12).max(128) }).parse(await c.req.json());
    const svc = resolve()!; const s = (await currentSession(svc, c.req.raw))!;
    await svc.policy.requireRecent(s.session.id);
    if (!svc.settings.mail || email.endsWith('@identity.iharu.invalid')) policyError('PROVIDER_NOT_READY');
    await svc.policy.takeLimits([{ key: `email-link:${s.user.id}`, windowMs: 3600_000, limit: 3 }]);
    const credential = await query(svc.db, 'SELECT id FROM iharu_auth.account WHERE "userId"=$1 AND "providerId"=\'credential\'', [s.user.id]);
    if (credential.length) policyError('METHOD_ALREADY_LINKED');
    const token = randomBytes(32).toString('hex');
    const passwordHash = await (await svc.auth.$context).password.hash(password);
    await query(svc.db, `INSERT INTO iharu_auth.email_links (token_hash,session_id,user_id,email,password_hash,expires_at) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,session_id=EXCLUDED.session_id,email=EXCLUDED.email,password_hash=EXCLUDED.password_hash,expires_at=EXCLUDED.expires_at`,
    [svc.policy.digest(token), s.session.id, s.user.id, email, passwordHash, new Date(+svc.policy.now() + 300_000)]);
    await svc.delivery.sendMail({ to: email, url: `${svc.settings.origin}/account/email?token=${token}`, kind: 'verify' });
    return c.json({ status: true });
  });
  app.post('/api/account/email/confirm', async c => {
    const { token } = z.object({ token: z.string().length(64) }).parse(await c.req.json());
    const svc = resolve()!; const s = (await currentSession(svc, c.req.raw))!;
    await svc.policy.requireRecent(s.session.id);
    await svc.db.transaction().execute(async tx => {
      await query(tx, 'SELECT id FROM iharu_auth."user" WHERE id=$1 FOR UPDATE', [s.user.id]);
      const [link] = await query<{ email: string; password_hash: string }>(tx, 'DELETE FROM iharu_auth.email_links WHERE token_hash=$1 AND user_id=$2 AND session_id=$3 AND expires_at>$4 RETURNING email,password_hash', [svc.policy.digest(token), s.user.id, s.session.id, svc.policy.now()]);
      if (!link) policyError('INVALID_TOKEN', 'BAD_REQUEST');
      const conflict = await query(tx, 'SELECT id FROM iharu_auth."user" WHERE email=$1 AND id<>$2', [link.email, s.user.id]);
      if (conflict.length) policyError('EMAIL_UNAVAILABLE');
      const already = await query(tx, 'SELECT id FROM iharu_auth.account WHERE "userId"=$1 AND "providerId"=\'credential\'', [s.user.id]);
      if (already.length) policyError('METHOD_ALREADY_LINKED');
      await query(tx, 'UPDATE iharu_auth."user" SET email=$2,"emailVerified"=true,"updatedAt"=$3 WHERE id=$1', [s.user.id, link.email, svc.policy.now()]);
      await query(tx, 'INSERT INTO iharu_auth.account (id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES ($1,$2,\'credential\',$2,$3,$4,$4)', [randomUUID(), s.user.id, link.password_hash, svc.policy.now()]);
      await query(tx, 'DELETE FROM iharu_auth.session WHERE "userId"=$1 AND id<>$2', [s.user.id, s.session.id]);
    });
    return c.json({ status: true });
  });
  app.get('/api/account/sessions', async c => {
    const svc = resolve()!; const s = (await currentSession(svc, c.req.raw))!;
    const rows = await query<{ id: string; userAgent: string; createdAt: Date; last_seen_at: Date }>(svc.db, `SELECT s.id,s."userAgent",s."createdAt",g.last_seen_at FROM iharu_auth.session s
      JOIN iharu_auth.session_guard g ON g.session_id=s.id WHERE s."userId"=$1 AND s."expiresAt">now() AND g.absolute_expires_at>now()
      AND g.last_seen_at>now()-interval '7 days' ORDER BY s."createdAt" DESC`, [s.user.id]);
    return c.json({ sessions: rows.map(r => ({ id: r.id, current: r.id === s.session.id, device: deviceName(r.userAgent || ''), createdAt: r.createdAt, lastSeenAt: r.last_seen_at })) });
  });
  app.post('/api/account/logout', async c => {
    const svc = resolve()!; const s = (await currentSession(svc, c.req.raw))!;
    const { sessionId } = z.object({ sessionId: z.string().max(100) }).parse(await c.req.json());
    if (s.guard.assurance === 'LOW' && sessionId !== 'current') policyError('ADDITIONAL_VERIFICATION_REQUIRED');
    if (sessionId === 'all') await query(svc.db, 'DELETE FROM iharu_auth.session WHERE "userId"=$1', [s.user.id]);
    else {
      await query(svc.db, 'DELETE FROM iharu_auth.session WHERE "userId"=$1 AND id=$2', [s.user.id, sessionId === 'current' ? s.session.id : sessionId]);
    }
    return c.json({ status: true });
  });
  app.post('/api/account/reauthenticate', async c => {
    const { password } = z.object({ password: z.string().min(1).max(128) }).parse(await c.req.json());
    const svc = resolve()!; const s = (await currentSession(svc, c.req.raw))!;
    await svc.policy.takeLimits([{ key: `reauth:${s.user.id}`, windowMs: 300_000, limit: 5 }]);
    const response = await svc.auth.api.signInEmail({ body: { email: s.user.email, password }, headers: c.req.raw.headers, asResponse: true });
    if (!response.ok) return c.json({ code: 'REAUTH_FAILED' }, 400);
    // A new signed cookie and session ID are issued by Better Auth; the LOW session is destroyed.
    await query(svc.db, 'DELETE FROM iharu_auth.session WHERE id=$1', [s.session.id]);
    return new Response(JSON.stringify({ status: true }), { status: 200, headers: response.headers });
  });
  app.post('/api/account/recovery', async c => {
    const svc = resolve()!; const s = (await currentSession(svc, c.req.raw))!;
    await svc.policy.takeLimits([{ key: `recovery:${s.user.id}`, windowMs: 86400_000, limit: 3 }]);
    const [row] = await query<{ id: string }>(svc.db, `INSERT INTO iharu_auth.recovery_cases (id,member_id) VALUES ($1,$2)
      ON CONFLICT (member_id) WHERE state='OPEN' DO UPDATE SET state='OPEN' RETURNING id`, [crypto.randomUUID(), s.guard.member_id]);
    return c.json({ status: true, caseId: row.id });
  });
  app.onError((error, c) => {
    if (error instanceof z.ZodError) return c.json({ code: 'INVALID_INPUT' }, 400);
    if (error instanceof APIError) return c.json({ code: error.body?.code || 'AUTH_FAILED' }, error.statusCode as 400 | 401 | 403 | 429);
    console.error(JSON.stringify({ code: 'AUTH_REQUEST_FAILED', requestId: c.req.header('x-request-id') || 'unavailable' }));
    return c.json({ code: 'AUTH_UNAVAILABLE', message: '잠시 후 다시 시도해 주세요.' }, 503);
  });
  return app;
}
function deviceName(ua: string) {
  const platform = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'Mac' : '다른 기기';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '브라우저';
  return `${platform} · ${browser}`;
}
