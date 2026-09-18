import type { Principal } from '../auth/principal.js';
export function isAuthenticated(principal: Principal | null): principal is Principal {
  return principal !== null;
}
// P03 business authorization lives in server/family and the forced-RLS SQL policy helpers.
// Authentication alone never grants access to a family or child.
