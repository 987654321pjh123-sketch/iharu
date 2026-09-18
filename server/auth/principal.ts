import { currentSession } from './routes.js';
import type { AuthService } from './service.js';
export type Principal = { id: string; type: 'guardian' | 'child'; sessionId: string; assurance: 'LOW' | 'HIGH'; emailVerified: boolean; accessReady: boolean };
export async function resolvePrincipal(request: Request, svc: AuthService | null): Promise<Principal | null> {
  if (!svc) return null;
  const s = await currentSession(svc, request);
  if (!s) return null;
  return { id: s.guard.member_id, type: 'guardian', sessionId: s.session.id,
    assurance: s.guard.assurance, emailVerified: s.user.emailVerified && !s.user.email.endsWith('@identity.iharu.invalid'), accessReady: s.guard.access_ready };
}
