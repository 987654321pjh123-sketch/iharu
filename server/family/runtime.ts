import { Pool } from 'pg';
import { Kysely,PostgresDialect } from 'kysely';
import { assertFamilyDatabaseRole } from './database.js';
import { databaseFailureReason } from '../adapters/database-errors.js';
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
   await assertFamilyDatabaseRole(db);
   console.info('FAMILY_DATABASE_CHECK_OK');
   return new FamilyService(db,secret);
  }catch(e){await db.destroy();throw e;}
 })().catch(error=>{service=undefined;console.error(JSON.stringify({code:'FAMILY_RUNTIME_UNAVAILABLE',reason:databaseFailureReason(error)}));return null;});
 return service;
}
