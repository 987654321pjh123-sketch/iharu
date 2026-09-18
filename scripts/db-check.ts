import { getAppDatabase } from '../server/adapters/database.js';
async function main() {
  if (!process.env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL 미설정: 실제 DB 연결은 아직 확인되지 않았습니다.');
  const sql = getAppDatabase();
  try {
    const [row] = await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    const [owner] = await sql`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='app' AND pg_has_role(current_user,nspowner,'MEMBER')) AS owns_app`;
    if (!row || row.rolsuper || row.rolbypassrls || owner.owns_app) throw new Error('업무 연결에 관리자·RLS 우회·스키마 소유자 자격을 사용할 수 없습니다.');
    const [policy] = await sql`SELECT pg_has_role(current_user,'iharu_policy','MEMBER') AS unsafe, to_regprocedure('app_private.family_command(text,jsonb)') IS NOT NULL AS installed`;
    const tables = await sql`SELECT relname FROM pg_class WHERE relnamespace='app'::regnamespace AND relkind='r' AND (NOT relrowsecurity OR NOT relforcerowsecurity)`;
    if (policy.unsafe || !policy.installed || tables.length) throw new Error('업무 연결의 P03 RLS·함수·역할 설정을 확인하세요.');
    console.log('DB 역할 및 P03 강제 RLS 설치 검사 통과. 실제 가족 권한 시나리오는 별도로 검증하세요.');
  } finally { await sql.end({ timeout:2 }); }
}
main().catch(error => { console.error(error instanceof Error && (error.message.startsWith('APP_DATABASE_URL') || error.message.startsWith('업무 연결')) ? error.message : 'DB 연결 검사 실패. 접속값·TLS·권한을 확인하세요.'); process.exitCode = 1; });
