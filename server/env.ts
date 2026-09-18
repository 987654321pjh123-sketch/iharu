export type Environment = 'local' | 'preview' | 'production';
export type AppConfig = { environment: Environment; demoEnabled: boolean };

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const deployment = env.VERCEL_ENV;
  const chosen = deployment || env.APP_ENV || 'local';
  if (!['local', 'development', 'preview', 'production'].includes(chosen)) throw new Error('INVALID_APP_ENV');
  const environment = chosen === 'development' ? 'local' : chosen as Environment;
  return { environment, demoEnabled: environment !== 'production' &&
    (env.DEMO_MODE === 'true' || (environment === 'local' && !env.DEMO_MODE)) };
}
