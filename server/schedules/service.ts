import {query} from '../auth/database.js';
import type {FamilyActor,FamilyService} from '../family/service.js';

export class ScheduleService {
 constructor(readonly family:FamilyService){}
 async command<T=Record<string,unknown>>(actor:FamilyActor,op:string,input:Record<string,unknown>={}):Promise<T>{
  return this.family.db.transaction().execute(async tx=>{
   if(this.family.testRole){if(this.family.testRole!=='app_runtime')throw new Error('INVALID_TEST_ROLE');await query(tx,'SET LOCAL ROLE app_runtime');}
   await query(tx,`SELECT set_config('iharu.member_id',$1,true),set_config('iharu.session_id',$2,true),set_config('iharu.device_hash',$3,true),set_config('iharu.request_id',$4,true)`,[actor.memberId||'',actor.sessionId||'',actor.deviceHash||'',actor.requestId]);
   const [row]=await query<{data:T}>(tx,'SELECT app_private.schedule_command($1,$2::jsonb) AS data',[op,JSON.stringify(input)]);
   return row.data;
  });
 }
}
