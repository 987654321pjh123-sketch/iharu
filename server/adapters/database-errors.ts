const transportCodes = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_INVALID_URL',
]);
const configurationCodes = new Set([
  'DATABASE_ROLES_MUST_DIFFER', 'UNSAFE_APP_DATABASE_ROLE', 'INVALID_AUTH_CONFIGURATION',
  'UNSAFE_DATABASE_TLS_CONFIGURATION', 'INVALID_DATABASE_PROTOCOL',
]);

// Never serialize database errors: messages/stacks can contain credentials,
// connection URLs, SQL parameters or user data. Only fixed codes are logged.
export function databaseFailureReason(error: unknown): string {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const code = 'code' in error ? error.code : undefined;
  if (typeof code === 'string') {
    if (transportCodes.has(code)) return code;
    if (/^[0-9A-Z]{5}$/.test(code)) return `POSTGRES_${code}`;
  }
  if (error instanceof Error && configurationCodes.has(error.message)) return error.message;
  return 'UNKNOWN';
}
