import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { query,type AuthDatabase } from '../auth/database.js';
export type FamilyActor={memberId?:string;sessionId?:string;deviceHash?:string;requestId:string};
export class FamilyService {
  constructor(readonly db:AuthDatabase,readonly secret:string,readonly testRole?:string){}
  digest(value:string){return createHmac('sha256',this.secret).update(`p03:${value}`).digest('hex');}
  token(){return randomBytes(32).toString('base64url');}
  seal(token:string){const iv=randomBytes(12),key=createHash('sha256').update(`pairing-response:${this.secret}`).digest();const c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(token,'utf8'),c.final(),c.getAuthTag()]).toString('base64url');}
  unseal(value:string){const b=Buffer.from(value,'base64url'),key=createHash('sha256').update(`pairing-response:${this.secret}`).digest();const d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString('utf8');}
  async command<T=Record<string,unknown>>(actor:FamilyActor,op:string,input:Record<string,unknown>={}):Promise<T>{
    return this.db.transaction().execute(async tx=>{
      // Tests use the exact non-owner runtime role on their isolated connection.
      if(this.testRole){if(this.testRole!=='app_runtime')throw new Error('INVALID_TEST_ROLE');await query(tx,'SET LOCAL ROLE app_runtime');}
      await query(tx,`SELECT set_config('iharu.member_id',$1,true),set_config('iharu.session_id',$2,true),set_config('iharu.device_hash',$3,true),set_config('iharu.request_id',$4,true)`,[actor.memberId||'',actor.sessionId||'',actor.deviceHash||'',actor.requestId]);
      const [row]=await query<{data:T}>(tx,'SELECT app_private.family_command($1,$2::jsonb) AS data',[op,JSON.stringify(input)]);
      return row.data;
    });
  }
}
