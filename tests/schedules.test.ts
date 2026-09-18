import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './helpers/auth-db';
import {createAuthService} from '../server/auth/service';
import {createApp} from '../server/app';
import {FamilyService} from '../server/family/service';
import {query} from '../server/auth/database';
import {calendarResponse,seriesResponse,addDays,koreaToday,type ScheduleInput,type Occurrence} from '../shared/schedules';
import {runScheduleMaintenance} from '../server/schedules/worker';
const origin='http://localhost:4173',secret='isolated-p04-schedules-fixture-never-production-001';
let database:Awaited<ReturnType<typeof testDatabase>>,family:FamilyService,app:ReturnType<typeof createApp>;
const mail:{to:string;url:string}[]=[];
const today=koreaToday(),base=addDays(today,(8-new Date(today+'T00:00:00Z').getUTCDay())%7||7);
class Browser{
 cookies=new Map<string,string>();memberId='';sessionId='';
 async req(path:string,body?:object,method=body?'POST':'GET',key:string=randomUUID()){
  const r=await app.request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':key,Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ')},...(body?{body:JSON.stringify(body)}:{})});
  for(const cookie of r.headers.getSetCookie()){const [part]=cookie.split(';'),i=part.indexOf('=');this.cookies.set(part.slice(0,i),part.slice(i+1));}return r;
 }
 async ok(path:string,body?:object,method?:string,key?:string){const r=await this.req(path,body,method,key);expect(r.status,await r.clone().text()).toBeLessThan(300);return r.json();}
}
async function parent(email:string){const b=new Browser();await b.ok('/api/auth/sign-up/email',{email,password:'p04-fixture-parent-password',name:'가상 보호자',callbackURL:'/login?verified=1'});await b.req(mail.find(m=>m.to===email)!.url.replace(origin,''));await b.ok('/api/auth/sign-in/email',{email,password:'p04-fixture-parent-password'});
 const [row]=await query<{id:string;sid:string}>(database.db,'SELECT m.id,s.id sid FROM iharu_auth.members m JOIN iharu_auth."user" u ON u.id=m.auth_user_id JOIN iharu_auth.session s ON s."userId"=u.id WHERE u.email=$1',[email]);b.memberId=row.id;b.sessionId=row.sid;await query(database.db,'UPDATE iharu_auth.members SET access_ready=true WHERE id=$1',[row.id]);return b;}
async function setup(email='schedule-a@example.test'){
 const b=await parent(email),fid=(await b.ok('/api/v1/families',{name:'가상 가족'})).id;
 const draft=await b.ok(`/api/v1/families/${fid}/child-registration-drafts`,{});
 await query(database.db,"SELECT app_private.record_relationship_result($1,$2,$3,'2018-03-02','p04-fixture',true)",[draft.id,randomUUID(),randomUUID()]);
 const proof=await b.ok(`/api/v1/child-registration-drafts/${draft.id}/consent-proofs`,{general:true,location:false,policyVersion:'6.1'});
 const cid=(await b.ok(`/api/v1/families/${fid}/children`,{draftId:draft.id,proofId:proof.proofId,nickname:'가상 아이',birthDate:'2018-03-02'})).id as string;
 return {b,fid,cid};
}
const input:ScheduleInput={title:'영어 학원',place:'가상 교실',date:base,untilDate:addDays(base,40),startTime:'15:00',endTime:'16:00',frequency:'WEEKLY',weekdays:[1,3,5],holidayPolicy:'ASK'};
async function calendar(b:Browser,fid:string,cid?:string){return calendarResponse.parse(await b.ok(`/api/v1/families/${fid}/calendar?from=${today}&to=${addDays(today,55)}${cid?'&childId='+cid:''}`));}
async function cache(){for(const y of new Set([Number(today.slice(0,4)),Number(addDays(today,55).slice(0,4))]))await query(database.db,"INSERT INTO app_private.holiday_years(year,state,version,last_success_at) VALUES($1,'READY',1,now())",[y]);}
async function change(b:Browser,o:Occurrence,changes:object,scope='ONE',effectiveDate=o.anchorDate,laterVersions?:string){const body={scope,changes,effectiveDate,expectedVersion:o.resourceVersion,...(laterVersions?{laterVersions}:{})};const preview=await b.ok(`/api/v1/occurrences/${o.id}/change-preview`,body);return b.ok(`/api/v1/occurrences/${o.id}`,{...body,previewToken:preview.previewToken},'PATCH');}
beforeAll(async()=>{database=await testDatabase();for(const name of (await readdir('db/migrations')).sort())await database.engine.exec(await readFile('db/migrations/'+name,'utf8'));},30000);
beforeEach(async()=>{await database.engine.exec('TRUNCATE app.families,iharu_auth."user",iharu_auth.verification,iharu_auth.rate_buckets,app_private.holiday_years,app_private.holiday_sync_runs,app_private.schedule_jobs,app_private.schedule_idempotency CASCADE');mail.length=0;const auth=createAuthService({origin,secret,databaseUrl:'unused',mail:{key:'fixture',from:'test@example.test'},sms:null,social:{}},database.db,{sendMail:async m=>{mail.push(m);},sendSms:async()=>{}});family=new FamilyService(database.db,secret,'app_runtime');app=createApp({environment:'local',demoEnabled:false},()=>auth,async()=>family);});
afterAll(async()=>{await database.db.destroy();});
describe('P04 schedules with real SQL and non-owner runtime role',()=>{
 it('creates weekly Korean-time occurrences once, binds idempotency, and enforces input horizons',async()=>{
  const {b,cid,fid}=await setup();await cache();const key=randomUUID();const first=await b.ok(`/api/v1/children/${cid}/schedules`,input,'POST',key);expect(await b.ok(`/api/v1/children/${cid}/schedules`,input,'POST',key)).toMatchObject(first);
  expect((await b.req(`/api/v1/children/${cid}/schedules`,{...input,title:'다른 제목'},'POST',key)).status).toBe(409);
  const list=await calendar(b,fid);expect(list.occurrences.length).toBeGreaterThan(10);expect(list.occurrences.every(o=>[1,3,5].includes(new Date(o.date+'T00:00:00Z').getUTCDay()))).toBe(true);
  expect(new Date(list.occurrences[0].startsAt).toISOString()).toContain('T06:00:00.000Z');expect(list.occurrences[0].status).toBe('SCHEDULED');
  expect((await calendar(b,fid)).occurrences.map(o=>o.id)).toEqual(list.occurrences.map(o=>o.id));
  for(const override of [{untilDate:addDays(base,367)},{endTime:'14:00'},{frequency:'ONCE'},{date:addDays(today,-1)}])expect((await b.req(`/api/v1/children/${cid}/schedules`,{...input,...override})).status).toBe(422);
  expect((await b.req(`/api/v1/families/${fid}/calendar?from=${today}&to=${addDays(today,56)}`)).status).toBe(422);
  expect((await b.req(`/api/v1/families/${fid}/calendar?from=${addDays(today,60)}&to=${addDays(today,61)}`)).status).toBe(422);
 });
 it('preserves cancellation, removed-weekday exceptions, stable IDs and protected references on future changes',async()=>{
  const {b,cid,fid}=await setup();await cache();await b.ok(`/api/v1/children/${cid}/schedules`,input);
  let rows=(await calendar(b,fid)).occurrences;const cancelled=rows.find(o=>o.date===addDays(base,9))!,protectedRow=rows.find(o=>o.date===addDays(base,14))!;
  await change(b,cancelled,{cancelled:true,reason:'가족 일정'});
  await query(database.db,'UPDATE app.occurrences SET protected_at=now() WHERE id=$1',[protectedRow.id]);
  await database.engine.exec('CREATE TABLE public.p04_reference(occurrence_id uuid REFERENCES app.occurrences(id))');await query(database.db,'INSERT INTO p04_reference VALUES($1)',[protectedRow.id]);
  rows=(await calendar(b,fid)).occurrences;const anchor=rows.find(o=>o.date===addDays(base,7))!;
  await change(b,anchor,{startTime:'17:00',endTime:'18:00',weekdays:[1,5]},'FUTURE',anchor.anchorDate);
  const after=(await calendar(b,fid)).occurrences;expect(after.find(o=>o.id===cancelled.id)).toMatchObject({status:'CANCELLED',reason:'가족 일정',startTime:'15:00',override:true});
  expect(after.find(o=>o.id===protectedRow.id)).toMatchObject({startTime:'15:00',locked:true});expect(after.find(o=>o.date===base)?.startTime).toBe('15:00');expect(after.find(o=>o.id===anchor.id)?.startTime).toBe('17:00');
  expect((await query(database.db,'SELECT * FROM p04_reference'))).toHaveLength(1);
 });
 it('requires explicit future-version choice and expires or rejects changed previews',async()=>{
  const {b,cid,fid}=await setup();await cache();await b.ok(`/api/v1/children/${cid}/schedules`,input);
  let rows=(await calendar(b,fid)).occurrences;await change(b,rows[0],{startTime:'18:00',endTime:'19:00'},'FUTURE',addDays(base,28));
  rows=(await calendar(b,fid)).occurrences;const o=rows[0],body={scope:'FUTURE',effectiveDate:addDays(base,7),expectedVersion:o.resourceVersion,changes:{startTime:'16:00',endTime:'17:00'}};
  const preview=await b.ok(`/api/v1/occurrences/${o.id}/change-preview`,body);expect(preview).toMatchObject({requiresLaterChoice:true,laterVersions:1});
  expect((await b.req(`/api/v1/occurrences/${o.id}`,{...body,previewToken:preview.previewToken},'PATCH')).status).toBe(409);
  expect((await b.req(`/api/v1/occurrences/${o.id}`,{...body,laterVersions:'KEEP',previewToken:preview.previewToken},'PATCH')).status).toBe(409);
  await change(b,o,body.changes,'FUTURE',body.effectiveDate,'KEEP');rows=(await calendar(b,fid)).occurrences;
  expect(rows.find(o=>o.date===addDays(base,7))?.startTime).toBe('16:00');expect(rows.find(o=>o.date===addDays(base,28))?.startTime).toBe('18:00');
  await change(b,rows[0],{startTime:'19:00',endTime:'20:00'},'FUTURE',addDays(base,14),'REPLACE');rows=(await calendar(b,fid)).occurrences;expect(rows.find(o=>o.date===addDays(base,28))?.startTime).toBe('19:00');
  const one={scope:'ONE',effectiveDate:rows[0].anchorDate,expectedVersion:rows[0].resourceVersion,changes:{title:'수정'}};const stale=await b.ok(`/api/v1/occurrences/${rows[0].id}/change-preview`,one);
  await query(database.db,"UPDATE app_private.schedule_previews SET expires_at=now()-interval '1 second' WHERE id=$1",[stale.previewToken]);expect((await b.req(`/api/v1/occurrences/${rows[0].id}`,{...one,previewToken:stale.previewToken},'PATCH')).status).toBe(409);
 });
 it('keeps unknown and failed holiday data unconfirmed, preserves explicit decisions, and prompts on new holidays',async()=>{
  const {b,cid,fid}=await setup();await b.ok(`/api/v1/children/${cid}/schedules`,{...input,holidayPolicy:'KEEP'});
  let data=await calendar(b,fid);expect(data.occurrences.every(o=>o.status==='NEEDS_CONFIRMATION'&&o.missingAttendanceSuppressed)).toBe(true);
  await b.ok(`/api/v1/occurrences/${data.occurrences[0].id}/holiday-decision`,{decision:'KEEP',expectedVersion:data.occurrences[0].resourceVersion});
  await cache();let rows=(await calendar(b,fid)).occurrences;const first=rows[0],second=rows[1];
  await query(database.db,'INSERT INTO app_private.holidays(year,local_date,name,is_holiday) VALUES($1,$2,$3,true),($1,$4,$5,true)',[Number(base.slice(0,4)),first.date,'추가 공휴일 예시',second.date,'공휴일 예시']);await query(database.db,'UPDATE app_private.holiday_years SET version=version+1');
  rows=(await calendar(b,fid)).occurrences;expect(rows[0]).toMatchObject({status:'SCHEDULED'});expect(rows[1]).toMatchObject({status:'NEEDS_CONFIRMATION',missingAttendanceSuppressed:true});
  await query(database.db,"UPDATE app_private.holiday_years SET state='FAILED'");data=await calendar(b,fid);expect(data.holidays).toHaveLength(2);expect(data.holidayYears[0].state).toBe('STALE');expect(data.occurrences[0].status).toBe('SCHEDULED');expect(data.occurrences[2].status).toBe('NEEDS_CONFIRMATION');
 });
 it('refreshes a moved future occurrence even after its original anchor date has passed',async()=>{
  const {b,cid,fid}=await setup();await cache();await b.ok(`/api/v1/children/${cid}/schedules`,input);
  const original=(await calendar(b,fid)).occurrences[0],movedDate=addDays(base,3);await change(b,original,{date:movedDate});
  // Represent the next day after an earlier occurrence was explicitly moved forward.
  await query(database.db,'UPDATE app.occurrences SET local_date=$1 WHERE id=$2',[addDays(today,-1),original.id]);
  await query(database.db,'INSERT INTO app_private.holidays(year,local_date,name,is_holiday) VALUES($1,$2,$3,true)',[Number(movedDate.slice(0,4)),movedDate,'변경된 휴일 예시']);await query(database.db,'UPDATE app_private.holiday_years SET version=version+1');
  expect((await calendar(b,fid)).occurrences.find(o=>o.id===original.id)).toMatchObject({date:movedDate,status:'NEEDS_CONFIRMATION',holidayNames:['변경된 휴일 예시']});
 });
 it('separates institutional closures from holidays and creates a linked makeup without erasing the original',async()=>{
  const {b,cid,fid}=await setup();await cache();const series=await b.ok(`/api/v1/children/${cid}/schedules`,input);let rows=(await calendar(b,fid)).occurrences;
  await b.ok(`/api/v1/schedule-series/${series.id}/closures`,{from:base,to:addDays(base,2),kind:'VACATION',reason:'가상 학원 방학',expectedVersion:rows[0].resourceVersion});rows=(await calendar(b,fid)).occurrences;
  expect(rows[0]).toMatchObject({status:'SKIPPED',holidayNames:[]});expect(rows[1].status).toBe('SKIPPED');
  await b.ok(`/api/v1/children/${cid}/schedules`,{...input,date:addDays(base,3),untilDate:addDays(base,3),frequency:'ONCE',makeupForOccurrenceId:rows[0].id});
  const after=(await calendar(b,fid)).occurrences;expect(after.find(o=>o.id===rows[0].id)?.status).toBe('SKIPPED');expect(after.find(o=>o.makeupForOccurrenceId===rows[0].id)?.date).toBe(addDays(base,3));
  const plans=seriesResponse.parse(await b.ok(`/api/v1/families/${fid}/schedule-series`));const plan=plans.series.find(s=>s.id===series.id)!;expect(plan.closures).toHaveLength(1);
  await b.ok(`/api/v1/schedule-series/${series.id}/closures/${plan.closures[0].id}`,{expectedVersion:plan.resourceVersion},'DELETE');expect((await calendar(b,fid)).occurrences.find(o=>o.id===rows[0].id)?.status).toBe('SCHEDULED');
 });
 it('enforces guardian, child-device, RLS and revocation boundaries for schedule data',async()=>{
  const a=await setup(),b=await setup('schedule-b@example.test');await cache();await a.b.ok(`/api/v1/children/${a.cid}/schedules`,input);await b.b.ok(`/api/v1/children/${b.cid}/schedules`,{...input,title:'비공개 일정'});
  expect((await a.b.req(`/api/v1/children/${b.cid}/schedules?from=${today}&to=${addDays(today,55)}`)).status).toBe(404);
  const token='isolated-child-token';await query(database.db,"INSERT INTO app.child_devices(family_id,child_id,label,token_hash) VALUES($1,$2,'가상 기기',$3)",[a.fid,a.cid,family.digest('device:'+token)]);const child=new Browser();child.cookies.set('iharu-child',token);
  expect((await child.req(`/api/v1/children/${a.cid}/schedules?from=${today}&to=${addDays(today,55)}`)).status).toBe(200);expect((await child.req(`/api/v1/children/${a.cid}/schedules`,input)).status).toBe(403);
  expect((await child.req(`/api/v1/children/${b.cid}/schedules?from=${today}&to=${addDays(today,55)}`)).status).toBe(404);
  await database.db.transaction().execute(async tx=>{await query(tx,'SET LOCAL ROLE app_runtime');expect(await query(tx,'SELECT id FROM app.occurrences')).toEqual([]);await query(tx,"SELECT set_config('iharu.member_id',$1,true),set_config('iharu.session_id',$2,true)",[a.b.memberId,a.b.sessionId]);expect((await query<{child_id:string}>(tx,'SELECT child_id FROM app.occurrences')).every(o=>o.child_id===a.cid)).toBe(true);});
  await expect(database.db.transaction().execute(async tx=>{await query(tx,'SET LOCAL ROLE app_runtime');await query(tx,'SELECT app_private.holiday_claim(2026)');})).rejects.toMatchObject({code:'42501'});
  await query(database.db,'UPDATE app.child_grants SET daily=false WHERE child_id=$1',[a.cid]);expect((await a.b.req(`/api/v1/children/${a.cid}/schedules?from=${today}&to=${addDays(today,55)}`)).status).toBe(404);
  await query(database.db,"UPDATE app.child_consents SET revoked_at=now() WHERE child_id=$1 AND purpose='general'",[a.cid]);expect((await child.req(`/api/v1/children/${a.cid}/schedules?from=${today}&to=${addDays(today,55)}`)).status).toBe(404);
 });
 it('uses yearly leases and daily jobs, retaining the last successful data on supplier failure',async()=>{
  const calls:number[]=[];const supplier=async(y:number)=>{calls.push(y);return {items:[{date:`${y}-01-01`,name:'신정',isHoliday:true}],hash:'a'.repeat(64)};};
  await runScheduleMaintenance(database.db,'fixture',supplier);await runScheduleMaintenance(database.db,'fixture',supplier);expect(new Set(calls).size).toBe(calls.length);
  expect((await query(database.db,'SELECT * FROM app_private.holidays')).length).toBeGreaterThan(0);
  await query(database.db,"UPDATE app_private.holiday_sync_runs SET state='FAILED',retry_after=now()-interval '1 second'");
  const failed=await runScheduleMaintenance(database.db,'fixture',async()=>{throw new Error('fixture upstream failure');});expect(failed.holidays.every(h=>h.state==='FAILED')).toBe(true);expect((await query(database.db,'SELECT * FROM app_private.holidays')).length).toBeGreaterThan(0);
  expect((await query<{state:string}>(database.db,'SELECT state FROM app_private.holiday_years')).every(h=>h.state==='FAILED')).toBe(true);
 });
});
