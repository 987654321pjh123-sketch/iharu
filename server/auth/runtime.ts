import { authSettings } from './config.js';
import { openAuthDatabase } from './database.js';
import { createAuthService, type AuthService } from './service.js';
let runtime: AuthService | null | undefined;
export function getAuthRuntime(): AuthService | null {
  if (runtime !== undefined) return runtime;
  const settings = authSettings();
  runtime = settings ? createAuthService(settings, openAuthDatabase(settings.databaseUrl)) : null;
  return runtime;
}
