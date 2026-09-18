import { getAppDatabase } from '../server/adapters/database.js';
async function main() {
  if (!process.env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL 미설정: 실제 DB 연결은 아직 확인되지 않았습니다.');
  const sql = getAppDatabase();
  try {
    const [row] = await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    const [owner] = await sql`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='app' AND pg_has_role(current_user,nspowner,'MEMBER')) AS owns_app`;
    if (!row || row.rolsuper || row.rolbypassrls || owner.owns_app) throw new Error('업무 연결에 관리자·RLS 우회·스키마 소유자 자격을 사용할 수 없습니다.');
    console.log('DB 연결 및 업무 계정 기본 검사 통과. 자녀별 RLS는 P03에서 검증합니다.');
  } finally { await sql.end({ timeout:2 }); }
}
main().catch(error => { console.error(error instanceof Error && (error.message.startsWith('APP_DATABASE_URL') || error.message.startsWith('업무 연결')) ? error.message : 'DB 연결 검사 실패. 접속값·TLS·권한을 확인하세요.'); process.exitCode = 1; });
