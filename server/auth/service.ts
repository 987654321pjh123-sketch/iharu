import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { phoneNumber } from 'better-auth/plugins/phone-number';
import { randomUUID } from 'node:crypto';
import type { AuthSettings } from './config.js';
import { query, type AuthDatabase } from './database.js';
import { AuthPolicy, MAX_SESSION_MS, normalizePhone, policyError } from './policy.js';
import { createDelivery, type Delivery } from './delivery.js';

export function createAuthService(settings: AuthSettings, db: AuthDatabase, delivery: Delivery = createDelivery(settings), now: () => Date = () => new Date()) {
  const policy = new AuthPolicy(db, settings.secret, now);
  const synthetic = (provider: string, id: string | number) => `${policy.digest(`${provider}:${id}`)}@identity.iharu.invalid`;
  const options = {
    appName: '아이하루', baseURL: settings.origin, basePath: '/api/auth', secret: settings.secret,
    database: { db, type: 'postgres', schemaName: 'iharu_auth', transaction: true },
    trustedOrigins: [settings.origin],
    logger: { log: () => { /* Never log provider payloads, passwords, OTPs or reset URLs. Hono logs request IDs. */ } },
    onAPIError: { errorURL: `${settings.origin}/login`, onError: () => { console.error('AUTH_PROVIDER_FAILED'); } },
    advanced: { useSecureCookies: settings.origin.startsWith('https:'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      database: { generateId: () => randomUUID() },
    },
    // Distributed, atomic application limits below replace the library's process-local counters.
    rateLimit: { enabled: false },
    session: { expiresIn: 30 * 86400, updateAge: 86400, freshAge: 300, disableSessionRefresh: true, cookieCache: { enabled: false } },
    account: { encryptOAuthTokens: true, storeAccountCookie: false, storeStateStrategy: 'database',
      accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: true, allowUnlinkingAll: false, updateUserInfoOnLink: false },
    },
    user: { deleteUser: { enabled: false }, changeEmail: { enabled: false } },
    emailAndPassword: { enabled: Boolean(settings.mail), minPasswordLength: 12, maxPasswordLength: 128,
      requireEmailVerification: true, autoSignIn: false, resetPasswordTokenExpiresIn: 900, revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        // A recovery email may reset an existing credential, never silently add one to a social-only account.
        const rows = await query(db, 'SELECT id FROM iharu_auth.account WHERE "userId"=$1 AND "providerId"=\'credential\' AND password IS NOT NULL', [user.id]);
        if (rows.length && user.emailVerified) {
          try { await delivery.sendMail({ to: user.email, url, kind: 'reset' }); }
          catch { console.error('AUTH_MAIL_DELIVERY_FAILED'); }
        }
      },
      onPasswordReset: async ({ user }) => {
        await query(db, 'UPDATE iharu_auth.members SET session_epoch=session_epoch+1 WHERE auth_user_id=$1', [user.id]);
      },
    },
    emailVerification: { sendOnSignUp: true, sendOnSignIn: false, autoSignInAfterVerification: false, expiresIn: 1800,
      sendVerificationEmail: async ({ user, url }) => {
        try { await delivery.sendMail({ to: user.email, url, kind: 'verify' }); }
        catch { console.error('AUTH_MAIL_DELIVERY_FAILED'); }
      },
    },
    socialProviders: {
      ...(settings.social.google ? { google: { ...settings.social.google, prompt: 'select_account' as const } } : {}),
      ...(settings.social.kakao ? { kakao: { ...settings.social.kakao, disableDefaultScope: true, scope: ['profile_nickname', 'account_email'],
        mapProfileToUser: (profile: { id: number; kakao_account?: { email?: string } }) => !profile.kakao_account?.email ? { email: synthetic('kakao', profile.id), emailVerified: false, name: '보호자' } : {},
      } } : {}),
      ...(settings.social.naver ? { naver: { ...settings.social.naver,
        mapProfileToUser: (profile: { response: { id: string; email?: string } }) => !profile.response.email ? { email: synthetic('naver', profile.response.id), emailVerified: false, name: '보호자' } : {},
      } } : {}),
    },
    plugins: [phoneNumber({ otpLength: 6, expiresIn: 180, allowedAttempts: 5, requireVerification: true,
      phoneNumberValidator: phone => /^\+8210\d{8}$/.test(phone),
      signUpOnVerification: { getTempEmail: phone => synthetic('phone', phone), getTempName: () => '보호자' },
      sendOTP: async ({ phoneNumber: phone, code }) => {
        if (!settings.sms) policyError('PROVIDER_NOT_READY');
        await policy.saveOtp(phone, code);
        // The plugin-generated plaintext record is not needed by our atomic, hashed verifier.
        await query(db, 'DELETE FROM iharu_auth.verification WHERE identifier=$1', [phone]);
        try { await delivery.sendSms(phone, code); }
        catch { await query(db, 'DELETE FROM iharu_auth.phone_challenges WHERE key=$1', [policy.digest(`phone:${phone}`)]); throw new Error('SMS_DELIVERY_FAILED'); }
      },
      verifyOTP: ({ phoneNumber: phone, code }) => policy.consumeOtp(phone, code),
    })],
    databaseHooks: {
      user: { create: { after: async user => {
        await query(db, 'INSERT INTO iharu_auth.members (id,auth_user_id) VALUES ($1,$2) ON CONFLICT (auth_user_id) DO NOTHING', [randomUUID(), user.id]);
      } } },
      session: { create: { before: async session => {
        const [member] = await query<{ status: string }>(db, 'SELECT status FROM iharu_auth.members WHERE auth_user_id=$1', [session.userId]);
        if (member && member.status !== 'ACTIVE') policyError('ACCOUNT_UNAVAILABLE');
        return { data: session };
      }, after: async (session, ctx) => {
        const high = ctx?.path === '/sign-in/email' || Boolean(ctx?.path?.startsWith('/callback/'));
        const time = now();
        await query(db, `INSERT INTO iharu_auth.session_guard (session_id,assurance,reauthenticated_at,last_seen_at,absolute_expires_at)
          VALUES ($1,$2,$3,$4,$5)`, [session.id, high ? 'HIGH' : 'LOW', high ? time : null, time, new Date(+time + MAX_SESSION_MS)]);
      } } },
      account: { create: { before: async (account, ctx) => {
        // Reuse Better Auth's active transaction. Taking another pooled connection here
        // can deadlock simultaneous signups and cannot see the uncommitted new user.
        const adapter = ctx?.context.internalAdapter ?? (await auth.$context).internalAdapter;
        const existing = await adapter.findAccounts(account.userId);
        const user = await adapter.findUserById(account.userId);
        if (existing.length || (user && 'phoneNumberVerified' in user && user.phoneNumberVerified === true)) {
          const s = ctx?.headers ? await auth.api.getSession({ headers: ctx.headers, query: { disableCookieCache: true, disableRefresh: true } }) : null;
          if (!s || s.user.id !== account.userId) policyError('REAUTH_REQUIRED');
          await policy.requireRecent(s.session.id);
        }
        return { data: account };
      }, after: async (account, ctx) => {
        if (!ctx?.path?.startsWith('/callback/') || !ctx.headers) return;
        const s = await auth.api.getSession({ headers: ctx.headers, query: { disableCookieCache: true, disableRefresh: true } });
        if (s?.user.id === account.userId) await query(db, 'DELETE FROM iharu_auth.session WHERE "userId"=$1 AND id<>$2', [account.userId, s.session.id]);
      } } },
    },
    hooks: { before: createAuthMiddleware(async ctx => {
      // These checks also protect server API calls, not only the Hono gateway.
      const path = ctx.path;
      if (['/unlink-account','/delete-user','/delete-user/callback','/update-user','/change-email','/set-password','/sign-in/phone-number','/phone-number/request-password-reset','/phone-number/reset-password'].includes(path)) policyError('USE_ACCOUNT_SETTINGS');
      if (path === '/phone-number/send-otp' || path === '/phone-number/verify') {
        if (!settings.sms) policyError('PROVIDER_NOT_READY');
        ctx.body.phoneNumber = normalizePhone(ctx.body.phoneNumber);
      }
      if (path === '/phone-number/send-otp') {
        // Vercel overwrites x-vercel-forwarded-for; elsewhere use a shared, conservative bucket.
        const ip = process.env.VERCEL ? ctx.headers?.get('x-vercel-forwarded-for') || 'unknown' : 'local';
        await policy.reserveSms(ctx.body.phoneNumber, ip, settings.sms!.dailyBudget);
      }
      if (path === '/link-social' || path === '/change-password' || (path === '/phone-number/verify' && ctx.body.updatePhoneNumber)) {
        const s = ctx.headers ? await auth.api.getSession({ headers: ctx.headers, query: { disableCookieCache: true, disableRefresh: true } }) : null;
        if (!s) policyError('AUTH_REQUIRED');
        await policy.requireRecent(s.session.id);
        if (path === '/change-password') ctx.body.revokeOtherSessions = true;
      }
      if (path === '/reset-password') {
        const token = ctx.body.token || ctx.query?.token;
        const [v] = await query<{ value: string }>(db, 'SELECT value FROM iharu_auth.verification WHERE identifier=$1', [`reset-password:${token}`]);
        if (v) {
          const existing = await query(db, 'SELECT id FROM iharu_auth.account WHERE "userId"=$1 AND "providerId"=\'credential\' AND password IS NOT NULL', [v.value]);
          if (!existing.length) policyError('EXPLICIT_LINK_REQUIRED');
        }
      }
    }), after: createAuthMiddleware(async ctx => {
      const fresh = ctx.context.newSession;
      if (fresh && ctx.headers) {
        const previous = await auth.api.getSession({ headers: ctx.headers, query: { disableCookieCache: true, disableRefresh: true } });
        if (previous && previous.user.id === fresh.user.id && previous.session.id !== fresh.session.id) await query(db, 'DELETE FROM iharu_auth.session WHERE id=$1', [previous.session.id]);
      }
      if (ctx.path === '/phone-number/verify' && ctx.body?.updatePhoneNumber && ctx.headers && !(ctx.context.returned instanceof Error)) {
        const previous = await auth.api.getSession({ headers: ctx.headers, query: { disableCookieCache: true, disableRefresh: true } });
        if (previous) await query(db, 'DELETE FROM iharu_auth.session WHERE "userId"=$1 AND id<>$2', [previous.user.id, previous.session.id]);
      }
    }) },
  } satisfies BetterAuthOptions;
  const auth = betterAuth(options);
  return { auth, policy, settings, db, delivery };
}
export type AuthService = ReturnType<typeof createAuthService>;
