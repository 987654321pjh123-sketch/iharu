// P02 connects real sessions here. Client-side demo tabs never grant authority.
export type Principal = { id: string; type: 'guardian' | 'child'; sessionId: string };
export async function resolvePrincipal(_request: Request): Promise<Principal | null> {
  return null;
}
