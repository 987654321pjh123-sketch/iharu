import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './helpers/auth-db';
import {createAuthService} from '../server/auth/service';
import {createApp} from '../server/app';
import {FamilyService} from '../server/family/service';
import {query} from '../server/auth/database';
const origin='http://localhost:4173',secret='isolated-p03-test-never-use-for-production-001';
let database:Awaited<ReturnType<typeof testDatabase>>,family:FamilyService,app:ReturnType<typeof createApp>;
const mail:{to:string;url:string;kind:string}[]=[];
class Browser{
 cookies=new Map<string,string>(); memberId=''; sessionId='';
 async req(path:string,body?:object,method=body?'POST':'GET',headers:Record<string,string>={}){
 const r=await app.request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; '),...headers},...(body?{body:JSON.stringify(body)}:{})});
 for(const cookie of r.headers.getSetCookie()){const [part]=cookie.split(';'),i=part.indexOf('=');if(part.slice(i+1))this.cookies.set(part.slice(0,i),part.slice(i+1));else this.cookies.delete(part.slice(0,i));}return r;
 }
 async ok(path:string,body?:object,method?:string){const r=await this.req(path,body,method);expect(r.status,await r.clone().text()).toBeLessThan(300);return r.json();}
 actor(){return {memberId:this.memberId,sessionId:this.sessionId,requestId:randomUUID()};}
}
async function parent(email:string,ready=true){const b=new Browser();await b.ok('/api/auth/sign-up/email',{email,password:'p03-parent-fixture-password',name:email.split('@')[0],callbackURL:'/login?verified=1'});const link=[...mail].reverse().find(m=>m.to===email)!;await b.req(link.url.replace(origin,''));await b.ok('/api/auth/sign-in/email',{email,password:'p03-parent-fixture-password'});
 const [row]=await query<{id:string;session:string}>(database.db,'SELECT m.id,s.id AS session FROM iharu_auth.members m JOIN iharu_auth."user" u ON u.id=m.auth_user_id JOIN iharu_auth.session s ON s."userId"=u.id WHERE u.email=$1',[email]);b.memberId=row.id;b.sessionId=row.session;
 if(ready)await query(database.db,'UPDATE iharu_auth.members SET access_ready=true WHERE id=$1',[b.memberId]);return b;}
async function create(b:Browser,name='가상 가족'){return (await b.ok('/api/v1/families',{name})).id as string;}
async function join(owner:Browser,other:Browser,fid:string){const invite=await owner.ok(`/api/v1/families/${fid}/invites`,{});const pending=await other.ok('/api/v1/invites/accept',{token:new URL(invite.inviteUrl).hash.slice(1)});await owner.ok(`/api/v1/memberships/${pending.membershipId}/approve`,{expectedVersion:1});return pending.membershipId as string;}
async function register(b:Browser,fid:string,location=false,nickname='가상 아이'){
 const d=await b.ok(`/api/v1/families/${fid}/child-registration-drafts`,{});
 // Isolated fixture only. The production API exposes no fake verification callback.
 await query(database.db,"SELECT app_private.record_relationship_result($1,$2,$3,'2018-03-02','virtual-fixture',true)",[d.id,randomUUID(),randomUUID()]);
 const proof=await b.ok(`/api/v1/child-registration-drafts/${d.id}/consent-proofs`,{general:true,location,policyVersion:'6.1'});
 const child=await b.ok(`/api/v1/families/${fid}/children`,{draftId:d.id,proofId:proof.proofId,nickname,birthDate:'2018-03-02'});return {id:child.id as string,draftId:d.id,proofId:proof.proofId};
}
async function grant(owner:Browser,childId:string,target:Browser,flags:Record<string,boolean>={},expectedVersion=0){return owner.ok(`/api/v1/children/${childId}/grants/${target.memberId}`,{daily:false,chat:false,location:false,tuitionRead:false,tuitionWrite:false,...flags,expectedVersion},'PUT');}
async function pair(owner:Browser,childId:string,device=new Browser()){
 const p=await device.ok('/api/v1/device-pairings',{label:'아이 태블릿'});const resolved=await owner.ok('/api/v1/device-pairings/resolve',{code:p.code});await owner.ok(`/api/v1/device-pairings/${p.id}/approve`,{childId,expectedVersion:resolved.version});return {device,p,exchangeKey:randomUUID()};}
beforeAll(async()=>{database=await testDatabase();for(const f of ['0001_foundation.sql','0002_better_auth_175.sql','0003_account_policy.sql','0004_family.sql','0005_family_commands.sql','0006_family_maintenance.sql'])await database.engine.exec(await readFile(`db/migrations/${f}`,'utf8'));},30000);
beforeEach(async()=>{await database.engine.exec('TRUNCATE app.families,iharu_auth."user",iharu_auth.verification,iharu_auth.rate_buckets CASCADE');mail.length=0;const svc=createAuthService({origin,secret,databaseUrl:'unused',mail:{key:'fixture',from:'test@example.test'},sms:null,social:{}},database.db,{sendMail:async m=>{mail.push(m);},sendSms:async()=>{}});family=new FamilyService(database.db,secret,'app_runtime');app=createApp({environment:'local',demoEnabled:false},()=>svc,async()=>family);});
afterAll(async()=>{await database.db.destroy();});
describe('P03 family policy under the non-owner app_runtime role',()=>{
 it('does not turn email login, client claims or unconnected verification into child access',async()=>{
  const b=await parent('not-ready@example.test',false);
  expect((await b.req('/api/v1/me')).status).toBe(403);expect((await b.ok('/api/v1/setup')).realChildRegistrationEnabled).toBe(false);
  await query(database.db,'UPDATE iharu_auth.members SET access_ready=true WHERE id=$1',[b.memberId]);const fid=await create(b);
  const d=await b.ok(`/api/v1/families/${fid}/child-registration-drafts`,{});
  expect((await b.req(`/api/v1/child-registration-drafts/${d.id}/verification-sessions`,{})).status).toBe(503);
  expect((await b.req(`/api/v1/child-registration-drafts/${d.id}/consent-proofs`,{general:true,location:false,policyVersion:'6.1'})).status).toBe(400);
  expect((await b.req(`/api/v1/families/${fid}/children`,{state:'VERIFIED',nickname:'forged'})).status).toBe(400);
  expect((await query(database.db,'SELECT * FROM app.children')).length).toBe(0);
  await expect(database.db.transaction().execute(async tx=>{await query(tx,'SET LOCAL ROLE app_runtime');await query(tx,"SELECT app_private.record_relationship_result($1,'forged','forged','2018-03-02','forged',true)",[d.id]);})).rejects.toMatchObject({code:'42501'});
 });
 it('requires participation approval AND child-specific grant; owner transfer never confers child visibility',async()=>{
  const a=await parent('a@example.test'),b=await parent('b@example.test');const fid=await create(a);const first=await register(a,fid),sibling=await register(a,fid,false,'가상 동생');
  const i=await a.ok(`/api/v1/families/${fid}/invites`,{});const accepted=await b.ok('/api/v1/invites/accept',{token:new URL(i.inviteUrl).hash.slice(1)});
  expect((await b.ok('/api/v1/me')).families).toHaveLength(0);expect((await b.req(`/api/v1/families/${fid}/children`)).status).toBe(404);
  await a.ok(`/api/v1/memberships/${accepted.membershipId}/approve`,{expectedVersion:1});expect((await b.ok(`/api/v1/families/${fid}/children`)).children).toEqual([]);
  await a.ok(`/api/v1/families/${fid}/owner`,{memberId:b.memberId,expectedVersion:1});expect((await b.ok(`/api/v1/families/${fid}/children`)).children).toEqual([]);
  await grant(a,first.id,b,{daily:true});const list=await b.ok(`/api/v1/families/${fid}/children`);expect(list.children.map((c:{id:string})=>c.id)).toEqual([first.id]);expect(JSON.stringify(list)).not.toContain(sibling.id);
  expect((await b.req(`/api/v1/children/${first.id}/grants`)).status).toBe(404);
 });
 it('replaces old invitation links, binds acceptance to one member, and rejects stale ownership versions',async()=>{
  const a=await parent('a@example.test'),b=await parent('b@example.test'),c=await parent('c@example.test');const fid=await create(a);
  const old=await a.ok(`/api/v1/families/${fid}/invites`,{}),fresh=await a.ok(`/api/v1/families/${fid}/invites`,{});
  expect((await b.req('/api/v1/invites/accept',{token:new URL(old.inviteUrl).hash.slice(1)})).status).toBe(400);
  await b.ok('/api/v1/invites/accept',{token:new URL(fresh.inviteUrl).hash.slice(1)});
  expect((await c.req('/api/v1/invites/accept',{token:new URL(fresh.inviteUrl).hash.slice(1)})).status).toBe(400);
  expect((await a.req(`/api/v1/families/${fid}/owner`,{memberId:b.memberId,expectedVersion:0})).status).toBe(409);
 });
 it('consumes a proof once, binds birth date and family, and creates room+consents+grant atomically',async()=>{
  const a=await parent('a@example.test');const fid=await create(a),other=await create(a,'가상 다른 가족');
  const d=await a.ok(`/api/v1/families/${fid}/child-registration-drafts`,{});
  await query(database.db,"UPDATE app_private.child_registration_drafts SET state='VERIFIED',subject_ref='virtual-child-1',birth_date='2018-03-02',evidence_ref='virtual' WHERE id=$1",[d.id]);
  const proof=await a.ok(`/api/v1/child-registration-drafts/${d.id}/consent-proofs`,{general:true,location:false,policyVersion:'6.1'});
  const input={draftId:d.id,proofId:proof.proofId,nickname:'가상 아이',birthDate:'2018-03-02'};
  expect((await a.req(`/api/v1/families/${fid}/children`,{...input,birthDate:'2019-01-01'})).status).toBe(400);
  expect((await a.req(`/api/v1/families/${other}/children`,input)).status).toBe(404);
  const ch=await a.ok(`/api/v1/families/${fid}/children`,input);expect((await a.req(`/api/v1/families/${fid}/children`,input)).status).toBe(400);
  expect((await query(database.db,'SELECT * FROM app.rooms WHERE child_id=$1',[ch.id])).length).toBe(1);
  expect((await query(database.db,'SELECT * FROM app.child_consents WHERE child_id=$1',[ch.id])).length).toBe(1);
  expect((await a.ok(`/api/v1/children/${ch.id}/grants`)).grants[0]).toMatchObject({daily:true,chat:true,location:false,tuitionRead:true,tuitionWrite:true});
 });
 it('isolates family A/B in SQL RLS, denies missing context, and enforces composite family foreign keys',async()=>{
  const a=await parent('a@example.test'),b=await parent('b@example.test');const fa=await create(a),fb=await create(b);const ca=await register(a,fa),cb=await register(b,fb);
  await database.db.transaction().execute(async tx=>{await query(tx,'SET LOCAL ROLE app_runtime');expect(await query(tx,'SELECT id FROM app.children')).toEqual([]);await query(tx,"SELECT set_config('iharu.member_id',$1,true),set_config('iharu.session_id',$2,true)",[a.memberId,a.sessionId]);expect((await query<{id:string}>(tx,'SELECT id FROM app.children')).map(c=>c.id)).toEqual([ca.id]);});
  expect((await a.req(`/api/v1/children/${cb.id}/devices`)).status).toBe(404);
  await expect(query(database.db,"INSERT INTO app.child_grants(family_id,child_id,member_id,approved_by) VALUES($1,$2,$3,$3)",[fa,cb.id,a.memberId])).rejects.toMatchObject({code:'23503'});
  await expect(database.db.transaction().execute(async tx=>{await query(tx,'SET LOCAL ROLE app_runtime');await query(tx,"UPDATE app.children SET nickname='stolen'");})).rejects.toBeDefined();
 });
 it('revokes only the affected grant immediately and retains siblings, chat and device access',async()=>{
  const a=await parent('a@example.test'),b=await parent('b@example.test');const fid=await create(a);await join(a,b,fid);const c=await register(a,fid),sibling=await register(a,fid);
  await query(database.db,'UPDATE app.rooms SET last_seq=9 WHERE child_id=$1',[c.id]);
  await grant(a,c.id,b,{daily:true,chat:true});await grant(a,sibling.id,b,{daily:true});
  expect(Number((await query<{starts_seq:string}>(database.db,'SELECT starts_seq FROM app.child_grants WHERE child_id=$1 AND member_id=$2',[c.id,b.memberId]))[0].starts_seq)).toBe(10);
  await grant(a,c.id,b,{chat:true},1);
  await database.db.transaction().execute(async tx=>{await query(tx,'SET LOCAL ROLE app_runtime');await query(tx,"SELECT set_config('iharu.member_id',$1,true),set_config('iharu.session_id',$2,true)",[b.memberId,b.sessionId]);const [r]=await query<{daily:boolean;chat:boolean;sibling:boolean}>(tx,"SELECT app_private.child_allowed($1,'daily') AS daily,app_private.child_allowed($1,'chat') AS chat,app_private.child_allowed($2,'daily') AS sibling",[c.id,sibling.id]);expect(r).toEqual({daily:false,chat:true,sibling:true});});
  expect((await query(database.db,"SELECT * FROM app_private.outbox WHERE kind='INDEPENDENT_JOURNAL'")).length).toBeGreaterThan(0);
 });
 it('requires the starting device proof and returns the same cookie on response-loss retry',async()=>{
  const a=await parent('a@example.test');const fid=await create(a),ch=await register(a,fid);const {device,p,exchangeKey}=await pair(a,ch.id);const attacker=new Browser();
  expect((await attacker.req(`/api/v1/device-pairings/${p.id}/exchange`,{exchangeKey})).status).toBe(403);
  expect((await attacker.req(`/api/v1/device-pairings/${p.id}/status`,{})).status).toBe(403);
  await device.ok(`/api/v1/device-pairings/${p.id}/exchange`,{exchangeKey});const cookie=device.cookies.get('iharu-child');
  await device.ok(`/api/v1/device-pairings/${p.id}/exchange`,{exchangeKey});expect(device.cookies.get('iharu-child')).toBe(cookie);
  expect((await query(database.db,'SELECT id FROM app.child_devices')).length).toBe(1);
  expect(JSON.stringify(await query(database.db,'SELECT * FROM app_private.device_pairings'))).not.toContain(cookie);
  const session=await device.ok('/api/v1/child-session');expect(session).toMatchObject({childId:ch.id,nickname:'가상 아이'});
  expect((await device.req(`/api/v1/children/${ch.id}/grants`)).status).toBe(401);
  const other=await parent('other-parent@example.test');await join(a,other,fid);other.cookies.set('iharu-child',cookie!);
  expect((await other.ok(`/api/v1/families/${fid}/children`)).children).toEqual([]);
  expect((await a.req('/api/v1/device-pairings',{label:'signed-in-adult'})).status).toBe(403);
  await a.ok(`/api/v1/children/${ch.id}/devices/${session.id}`,{},'DELETE');expect((await device.req('/api/v1/child-session')).status).toBe(401);
  expect((await device.req(`/api/v1/device-pairings/${p.id}/exchange`,{exchangeKey})).status).toBe(400);
 });
 it('enforces expiry, changed exchange key, new-code invalidation, and maximum two active devices',async()=>{
  const a=await parent('a@example.test');const fid=await create(a),ch=await register(a,fid);const first=await pair(a,ch.id);
  await first.device.ok(`/api/v1/device-pairings/${first.p.id}/exchange`,{exchangeKey:first.exchangeKey});
  expect((await first.device.req(`/api/v1/device-pairings/${first.p.id}/exchange`,{exchangeKey:randomUUID()})).status).toBe(400);
  const second=await pair(a,ch.id);await second.device.ok(`/api/v1/device-pairings/${second.p.id}/exchange`,{exchangeKey:second.exchangeKey});
  const extra=new Browser(),p=await extra.ok('/api/v1/device-pairings',{label:'세 번째'});expect((await a.req(`/api/v1/device-pairings/${p.id}/approve`,{childId:ch.id,expectedVersion:1})).status).toBe(400);
  await extra.ok('/api/v1/device-pairings',{label:'새 번호'});expect((await extra.req(`/api/v1/device-pairings/${p.id}/status`,{})).status).toBe(400);
  await query(database.db,"UPDATE app_private.device_pairings SET retry_until=now()-interval '1 second' WHERE id=$1",[first.p.id]);expect((await first.device.req(`/api/v1/device-pairings/${first.p.id}/exchange`,{exchangeKey:first.exchangeKey})).status).toBe(400);
 });
 it('location withdrawal retains general access; general withdrawal disables child session and queues deletion+independent journal',async()=>{
  const a=await parent('a@example.test');const fid=await create(a),ch=await register(a,fid,true);const {device,p,exchangeKey}=await pair(a,ch.id);await device.ok(`/api/v1/device-pairings/${p.id}/exchange`,{exchangeKey});
  await a.ok(`/api/v1/children/${ch.id}/consents/revoke`,{purpose:'location',expectedVersion:1});expect((await device.ok('/api/v1/child-session')).locationAllowed).toBe(false);
  expect((await a.ok(`/api/v1/families/${fid}/children`)).children).toHaveLength(1);
  await a.ok(`/api/v1/children/${ch.id}/consents/revoke`,{purpose:'general',expectedVersion:2});expect((await device.req('/api/v1/child-session')).status).toBe(401);expect((await a.ok(`/api/v1/families/${fid}/children`)).children).toEqual([]);
  expect((await query(database.db,'SELECT state FROM app_private.deletion_requests'))[0]).toEqual({state:'REVOKED'});expect((await query(database.db,"SELECT * FROM app_private.outbox WHERE kind='DELETE_CHILD'")).length).toBe(1);
 });
 it('limits adults and children under family locks, rejects writes without read, and rejects untrusted origin',async()=>{
  const a=await parent('a@example.test');const fid=await create(a);for(let i=0;i<5;i++)await register(a,fid,false,`가상${i}`);
  expect((await a.req(`/api/v1/families/${fid}/child-registration-drafts`,{})).status).toBe(400);
  expect((await a.req('/api/v1/families',{name:'CSRF'},'POST',{Origin:'https://evil.example'})).status).toBe(403);
  const b=await parent('b@example.test');await join(a,b,fid);const ch=(await a.ok(`/api/v1/families/${fid}/children`)).children[0];
  expect((await a.req(`/api/v1/children/${ch.id}/grants/${b.memberId}`,{daily:false,chat:false,location:false,tuitionRead:false,tuitionWrite:true,expectedVersion:0},'PUT')).status).toBe(400);
  for(let i=0;i<3;i++){const p=await parent(`extra${i}@example.test`);await join(a,p,fid);}
  expect((await a.req(`/api/v1/families/${fid}/invites`,{})).status).toBe(400);
 });
 it('rechecks session assurance and ready state in SQL independently of HTTP',async()=>{
  const a=await parent('a@example.test');const fid=await create(a);await register(a,fid);
  await query(database.db,"UPDATE iharu_auth.session_guard SET assurance='LOW' WHERE session_id=$1",[a.sessionId]);
  await expect(family.command(a.actor(),'me')).rejects.toMatchObject({message:'ACCESS_NOT_READY'});expect((await a.req('/api/v1/me')).status).toBe(403);
 });
});
