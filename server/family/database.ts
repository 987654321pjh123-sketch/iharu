import { query, type AuthDatabase } from '../auth/database.js';

export async function assertFamilyDatabaseRole(db: AuthDatabase): Promise<void> {
  // Resolve the protected table through the catalog. Resolving a qualified text
  // name would require USAGE on iharu_auth, which app_runtime intentionally lacks.
  const [row] = await query<{ safe: boolean }>(db, `
    SELECT NOT rolsuper AND NOT rolbypassrls
      AND NOT pg_has_role(current_user,'iharu_policy','MEMBER')
      AND pg_has_role(current_user,'app_runtime','MEMBER')
      AND NOT COALESCE(has_table_privilege(current_user,
        (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='iharu_auth' AND c.relname='members'), 'UPDATE'), true)
      AND to_regprocedure('app_private.expire_family_secrets()') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='app'::regnamespace
        AND pg_has_role(current_user,relowner,'MEMBER')) AS safe
    FROM pg_roles WHERE rolname=current_user`);
  if (!row?.safe) throw new Error('UNSAFE_APP_DATABASE_ROLE');
}
