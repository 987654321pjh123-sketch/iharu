import { Pool } from 'pg';
import { Kysely,PostgresDialect } from 'kysely';
import { query } from '../auth/database.js';
import { FamilyService } from './service.js';
let service:Promise<FamilyService|null>|undefined;
export function getFamilyRuntime():Promise<FamilyService|null>{
 if(service)return service;
 service=(async()=>{
  const url=process.env.APP_DATABASE_URL,secret=process.env.BETTER_AUTH_SECRET;
  if(!url||!secret||secret.length<32)return null;
  if(url===process.env.AUTH_DATABASE_URL||url===process.env.MIGRATION_DATABASE_URL||url===process.env.WORKER_DATABASE_URL)throw new Error('DATABASE_ROLES_MUST_DIFFER');
  const local=['localhost','127.0.0.1'].includes(new URL(url).hostname);
  const pool=new Pool({connectionString:url,max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:20000,ssl:local?false:{rejectUnauthorized:true}});
  pool.on('error',()=>console.error('FAMILY_DATABASE_CONNECTION_ERROR'));
  const db=new Kysely<Record<string,never>>({dialect:new PostgresDialect({pool})});
  try{
   const [r]=await query<{safe:boolean}>(db,`SELECT NOT rolsuper AND NOT rolbypassrls AND NOT pg_has_role(current_user,'iharu_policy','MEMBER') AND pg_has_role(current_user,'app_runtime','MEMBER') AND NOT has_table_privilege(current_user,'iharu_auth.members','UPDATE') AND to_regprocedure('app_private.expire_family_secrets()') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='app'::regnamespace AND pg_has_role(current_user,relowner,'MEMBER')) AS safe FROM pg_roles WHERE rolname=current_user`);
   if(!r?.safe)throw new Error('UNSAFE_APP_DATABASE_ROLE');
   return new FamilyService(db,secret);
  }catch(e){await db.destroy();throw e;}
 })().catch(()=>{service=undefined;console.error('FAMILY_RUNTIME_UNAVAILABLE');return null;});
 return service;
}
