import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresDialect } from 'kysely';
import type { PostgresPool } from 'kysely';

// Real PostgreSQL SQL/types/constraints in WASM. Only tests import this adapter.
export async function testDatabase() {
  const engine = new PGlite();
  await engine.waitReady;
  const pool = {
    async connect() {
      return { async query(statement: string, args: unknown[] = []) {
        const result = await engine.query(statement, args);
        return { rows: result.rows, rowCount: result.affectedRows ?? 0, command: statement.trim().split(/\s/)[0].toUpperCase() };
      }, release() {} };
    }, async end() { await engine.close(); },
  };
  const db = new Kysely<Record<string, never>>({ dialect: new PostgresDialect({ pool: pool as unknown as PostgresPool }) });
  return { db, engine };
}
