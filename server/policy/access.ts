import type { Principal } from '../auth/principal.js';
export function isAuthenticated(principal: Principal | null): principal is Principal {
  return principal !== null;
}
// Per-child grants and consent will be implemented in P03 before business data is served.
