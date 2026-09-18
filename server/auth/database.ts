import { Pool } from 'pg';
import { Kysely, PostgresDialect, CompiledQuery } from 'kysely';

// Better Auth owns its generated tables in iharu_auth. This role must never own child tables.
export type AuthDatabase = Kysely<Record<string, never>>;
export function openAuthDatabase(url: string): AuthDatabase {
  const local = ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
  const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 20000, ssl: local ? false : { rejectUnauthorized: true } });
  pool.on('error', () => console.error('AUTH_DATABASE_CONNECTION_ERROR'));
  return new Kysely({ dialect: new PostgresDialect({ pool }) });
}
export async function query<T>(db: AuthDatabase, statement: string, parameters: unknown[] = []): Promise<T[]> {
  return (await db.executeQuery<T>(CompiledQuery.raw(statement, parameters))).rows;
}
