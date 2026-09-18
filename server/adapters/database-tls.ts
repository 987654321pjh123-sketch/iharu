import { rootCertificates, type ConnectionOptions } from 'node:tls';
import { supabaseProductionCAs } from './supabase-ca.js';

export function databaseConnectionOptions(raw: string): {connectionString: string; ssl: false | ConnectionOptions} {
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('INVALID_DATABASE_PROTOCOL');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (local) return {connectionString: raw, ssl: false};

  // node-postgres lets URL parameters replace the explicit ssl object. Reject
  // weaker modes and remove supported flags so CA/hostname checks stay enabled.
  const mode = url.searchParams.get('sslmode');
  if ((mode && !['require','verify-full'].includes(mode)) ||
      (url.searchParams.has('ssl') && url.searchParams.get('ssl') !== 'true') ||
      ['sslcert','sslkey','sslrootcert','uselibpqcompat'].some(key => url.searchParams.has(key))) {
    throw new Error('UNSAFE_DATABASE_TLS_CONFIGURATION');
  }
  url.searchParams.delete('sslmode'); url.searchParams.delete('ssl');
  const supabase = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) ||
    /^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname);
  return {connectionString:url.toString(), ssl:{rejectUnauthorized:true,
    ...(supabase ? {ca:[...rootCertificates,...supabaseProductionCAs]} : {})}};
}
