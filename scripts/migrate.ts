import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openDatabase } from '../server/adapters/database.js';
import { readConfig } from '../server/env.js';
async function main() {
  const env = readConfig().environment;
  if (!process.env.MIGRATION_DATABASE_URL || process.env.MIGRATION_TARGET !== env) throw new Error('MIGRATION_DATABASE_URL과 현재 환경에 맞는 MIGRATION_TARGET을 설정하세요.');
  const sql = openDatabase(process.env.MIGRATION_DATABASE_URL);
  try {
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(17091701)`;
      await tx`CREATE SCHEMA IF NOT EXISTS app_private`;
      await tx`REVOKE ALL ON SCHEMA app_private FROM PUBLIC`;
      await tx`CREATE TABLE IF NOT EXISTS app_private.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
      const applied = await tx`SELECT name, checksum FROM app_private.schema_migrations`;
      const files = (await readdir('db/migrations')).filter(n => /^\d+_[a-z0-9_]+\.sql$/.test(n)).sort();
      for (const name of files) {
        const source = await readFile(`db/migrations/${name}`, 'utf8');
        const checksum = createHash('sha256').update(source).digest('hex');
        const previous = applied.find(r => r.name === name);
        if (previous && previous.checksum !== checksum) throw new Error('APPLIED_MIGRATION_CHANGED');
        if (previous) continue;
        await tx.unsafe(source);
        await tx`INSERT INTO app_private.schema_migrations (name,checksum) VALUES (${name},${checksum})`;
        console.log('적용:', name);
      }
    });
  } finally { await sql.end({ timeout:2 }); }
}
main().catch(() => { console.error('마이그레이션 실패: 환경·접속·기존 파일 변경 여부를 확인하세요. 자격 정보는 출력하지 않습니다.'); process.exitCode = 1; });
