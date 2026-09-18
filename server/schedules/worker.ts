import {Pool} from 'pg';
import {Kysely,PostgresDialect} from 'kysely';
import {query,type AuthDatabase} from '../auth/database.js';
import {databaseConnectionOptions} from '../adapters/database-tls.js';
import {databaseFailureReason} from '../adapters/database-errors.js';
import {koreaToday,addDays} from '../../shared/schedules.js';
import {fetchHolidayYear} from './holidays.js';

export async function runScheduleMaintenance(db:AuthDatabase,key:string|undefined,fetchYear=fetchHolidayYear){
 const day=koreaToday(),years=[...new Set([Number(day.slice(0,4)),Number(addDays(day,55).slice(0,4))])];
 const holidayResults:{year:number;state:string}[]=[];
 for(const year of years){
  if(!key){holidayResults.push({year,state:'NOT_CONFIGURED'});continue;}
  const [row]=await query<{token:string|null}>(db,'SELECT app_private.holiday_claim($1) AS token',[year]);
  if(!row.token){holidayResults.push({year,state:'ALREADY_CLAIMED'});continue;}
  try{
   const data=await fetchYear(year,key);
   await query(db,'SELECT app_private.holiday_finish($1,$2,$3::jsonb,$4,NULL)',[year,row.token,JSON.stringify(data.items),data.hash]);
   holidayResults.push({year,state:'READY'});
  }catch{
   await query(db,"SELECT app_private.holiday_finish($1,$2,'[]'::jsonb,'','HOLIDAY_FETCH_FAILED')",[year,row.token]);
   holidayResults.push({year,state:'FAILED'});
  }
 }
 const [result]=await query<{data:{processed:number;done:boolean;state?:string}}>(db,'SELECT app_private.schedule_maintenance() AS data');
 return {expansion:result.data,holidays:holidayResults};
}

let connection:Promise<AuthDatabase|null>|undefined;
export function getScheduleWorker(){
 if(connection)return connection;
 connection=(async()=>{
  const raw=process.env.WORKER_DATABASE_URL;if(!raw)return null;
  if([process.env.APP_DATABASE_URL,process.env.AUTH_DATABASE_URL,process.env.MIGRATION_DATABASE_URL].includes(raw))throw new Error('DATABASE_ROLES_MUST_DIFFER');
  const pool=new Pool({...databaseConnectionOptions(raw),max:1,connectionTimeoutMillis:4000,idleTimeoutMillis:20000});pool.on('error',()=>console.error('SCHEDULE_WORKER_CONNECTION_ERROR'));
  const db=new Kysely<Record<string,never>>({dialect:new PostgresDialect({pool})});
  try{
   const [role]=await query<{safe:boolean}>(db,`SELECT NOT rolsuper AND NOT rolbypassrls AND pg_has_role(current_user,'worker_runtime','MEMBER')
    AND NOT pg_has_role(current_user,'app_runtime','MEMBER') AND NOT pg_has_role(current_user,'iharu_policy','MEMBER')
    AND NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname='auth_runtime' AND pg_has_role(current_user,r.oid,'MEMBER'))
    AND NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace IN ('app'::regnamespace,'iharu_auth'::regnamespace) AND pg_has_role(current_user,c.relowner,'MEMBER')) AS safe FROM pg_roles WHERE rolname=current_user`);
   if(!role?.safe)throw new Error('UNSAFE_WORKER_ROLE');return db;
  }catch(e){await db.destroy();throw e;}
 })().catch(e=>{connection=undefined;console.error(JSON.stringify({code:'SCHEDULE_WORKER_UNAVAILABLE',reason:databaseFailureReason(e)}));return null;});
 return connection;
}
