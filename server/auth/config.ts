export const socialIds = ['google', 'kakao', 'naver'] as const;
export type SocialId = typeof socialIds[number];
export type AuthSettings = {
  origin: string; secret: string; databaseUrl: string;
  mail: { key: string; from: string } | null;
  sms: { key: string; secret: string; from: string; dailyBudget: number } | null;
  social: Partial<Record<SocialId, { clientId: string; clientSecret: string }>>;
};
export function authSettings(env: NodeJS.ProcessEnv = process.env): AuthSettings | null {
  if (!env.AUTH_DATABASE_URL || !env.APP_ORIGIN || !env.BETTER_AUTH_SECRET) return null;
  const origin = new URL(env.APP_ORIGIN);
  const local = ['localhost', '127.0.0.1'].includes(origin.hostname);
  if ((!local && origin.protocol !== 'https:') || origin.origin !== env.APP_ORIGIN || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error('INVALID_AUTH_CONFIGURATION');
  }
  const social: AuthSettings['social'] = {};
  for (const id of socialIds) {
    const clientId = env[`${id.toUpperCase()}_CLIENT_ID`];
    const clientSecret = env[`${id.toUpperCase()}_CLIENT_SECRET`];
    if (clientId && clientSecret) social[id] = { clientId, clientSecret };
  }
  const budget = Number(env.SMS_DAILY_BUDGET);
  return {
    origin: origin.origin, secret: env.BETTER_AUTH_SECRET, databaseUrl: env.AUTH_DATABASE_URL,
    social,
    mail: env.RESEND_API_KEY && env.MAIL_FROM ? { key: env.RESEND_API_KEY, from: env.MAIL_FROM } : null,
    sms: env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET && env.SMS_FROM && Number.isInteger(budget) && budget > 0
      ? { key: env.SOLAPI_API_KEY, secret: env.SOLAPI_API_SECRET, from: env.SMS_FROM, dailyBudget: budget } : null,
  };
}
