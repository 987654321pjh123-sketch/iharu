// CI-only disposable PostgreSQL. Never run against a Supabase/Preview/production database.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {Kysely,PostgresDialect} from 'kysely';
import {openAuthDatabase,query,type AuthDatabase} from '../../server/auth/database.js';
import {createAuthService} from '../../server/auth/service.js';
import {createApp} from '../../server/app.js';
import {FamilyService,type FamilyActor} from '../../server/family/service.js';

const raw=process.env.IHARU_CI_DATABASE_URL;
if(!raw||process.env.CI!=='true')throw new Error('CI_DATABASE_REQUIRED');
const url=new URL(raw);
if(url.hostname!=='127.0.0.1'||url.pathname!=='/iharu_ci'||url.protocol!=='postgresql:')throw new Error('DISPOSABLE_LOCAL_DATABASE_REQUIRED');
const admin=new Pool({connectionString:raw,max:1,statement_timeout:15000});
const connections:AuthDatabase[]=[];
let passed=0;
async function check(name:string,fn:()=>Promise<void>){await fn();passed++;console.log(`PASS ${name}`);}
function runtimeURL(role:string,password:string){const u=new URL(raw!);u.username=role;u.password=password;return u.toString();}
function openApp(url:string){const pool=new Pool({connectionString:url,max:1,connectionTimeoutMillis:5000,statement_timeout:10000});const db=new Kysely<Record<string,never>>({dialect:new PostgresDialect({pool})});connections.push(db);return db;}
try{
 const existing=await admin.query("SELECT 1 FROM pg_namespace WHERE nspname IN ('app','iharu_auth')");assert.equal(existing.rowCount,0,'Disposable database must be empty; existing schemas are never deleted.');
 const authPassword=randomBytes(24).toString('hex'),appPassword=randomBytes(24).toString('hex');
 await admin.query(`CREATE ROLE auth_runtime LOGIN PASSWORD '${authPassword}' NOSUPERUSER NOBYPASSRLS`);
 // Runtime roles exist before the role-aware migrations; no test connection is a schema owner.
 await admin.query(`CREATE ROLE app_runtime LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOBYPASSRLS`);
 // Match managed Postgres: the DDL caller is not a superuser and only has SET
 // membership in the NOLOGIN function owner. An ACL REVOKE after OWNER changes
 // otherwise emits a warning and can leave PUBLIC execute grants in place.
 await admin.query('CREATE ROLE migration_admin NOLOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE');
 await admin.query('GRANT CREATE ON DATABASE iharu_ci TO migration_admin');
 await admin.query('CREATE ROLE iharu_policy NOLOGIN NOSUPERUSER NOBYPASSRLS');
 await admin.query('GRANT iharu_policy TO migration_admin WITH INHERIT FALSE, SET TRUE');
 const migration=await admin.connect();
 try{
  await migration.query('BEGIN');await migration.query('SET LOCAL ROLE migration_admin');
  for(const name of (await readdir('db/migrations')).filter(n=>/^\d+_[a-z0-9_]+\.sql$/.test(n)).sort())await migration.query(await readFile(`db/migrations/${name}`,'utf8'));
  await migration.query('COMMIT');
 }catch(e){await migration.query('ROLLBACK');throw e;}finally{migration.release();}
 const authdb=openAuthDatabase(runtimeURL('auth_runtime',authPassword));connections.push(authdb);
 const db1=openApp(runtimeURL('app_runtime',appPassword)),db2=openApp(runtimeURL('app_runtime',appPassword));
 const secret=randomBytes(32).toString('hex'),family1=new FamilyService(db1,secret),family2=new FamilyService(db2,secret),origin='http://localhost:4173';
 const svc=createAuthService({origin,secret,databaseUrl:'test-only',mail:{key:'test-only',from:'test@example.test'},sms:null,social:{}},authdb,{sendMail:async()=>{},sendSms:async()=>{}});
 const app=createApp({environment:'local',demoEnabled:false},()=>svc,async()=>family1);
 await check('non-superuser migrations restrict verification and maintenance to their intended roles',async()=>{
  const [acl]=await query<{verify:boolean;maintain:boolean;command:boolean}>(db1,`SELECT has_function_privilege(current_user,'app_private.record_relationship_result(uuid,text,text,date,text,boolean)','EXECUTE') AS verify,has_function_privilege(current_user,'app_private.expire_family_secrets()','EXECUTE') AS maintain,has_function_privilege(current_user,'app_private.family_command(text,jsonb)','EXECUTE') AS command`);
  assert.deepEqual(acl,{verify:false,maintain:false,command:true});
  await assert.rejects(query(db1,'SELECT app_private.record_relationship_result($1,$2,$3,$4,$5,$6)',[randomUUID(),'ci-denied','ci-denied','2018-03-02','ci-denied',true]),{code:'42501'});
  await assert.rejects(query(db1,'SELECT app_private.expire_family_secrets()'),{code:'42501'});
 });
 await check('parallel Better Auth signup uses a real two-connection auth pool',async()=>{
  const requests=['one','two'].map(name=>app.request(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'가상 보호자',email:`${name}@example.test`,password:'integration-fixture-password-2026',callbackURL:'/login?verified=1'})}));
  const results=await Promise.all(requests);for(const r of results)assert.equal(r.status,200,await r.text());
  assert.equal((await admin.query('SELECT id FROM iharu_auth.members')).rowCount,2);
 });
 const actors:FamilyActor[]=[];
 for(const name of ['one','two']){
  await admin.query('UPDATE iharu_auth."user" SET "emailVerified"=true WHERE email=$1',[`${name}@example.test`]);
  const r=await app.request(origin+'/api/auth/sign-in/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:`${name}@example.test`,password:'integration-fixture-password-2026'})});assert.equal(r.status,200);
  const row=(await admin.query('SELECT m.id,s.id AS session FROM iharu_auth.members m JOIN iharu_auth."user" u ON u.id=m.auth_user_id JOIN iharu_auth.session s ON s."userId"=u.id WHERE u.email=$1',[`${name}@example.test`])).rows[0];
  await admin.query('UPDATE iharu_auth.members SET access_ready=true WHERE id=$1',[row.id]);actors.push({memberId:row.id,sessionId:row.session,requestId:randomUUID()});
 }
 const [a,b]=actors;
 const fid=(await family1.command<{id:string}>(a,'family.create',{name:'가상 A'})).id;
 const fidB=(await family2.command<{id:string}>(b,'family.create',{name:'가상 B'})).id;
 async function proof(actor:FamilyActor,familyId:string){
  const draft=await family1.command<{id:string}>(actor,'draft.create',{familyId});
  await admin.query("SELECT app_private.record_relationship_result($1,$2,$3,'2018-03-02','virtual-ci',true)",[draft.id,randomUUID(),randomUUID()]);
  const p=await family1.command<{proofId:string}>(actor,'consent.proof',{draftId:draft.id,policyVersion:'6.1',general:true,location:false});
  return {familyId,draftId:draft.id,proofId:p.proofId,nickname:'가상 아이',birthDate:'2018-03-02'};
 }
 const enroll=await proof(a,fid);let childId='';
 await check('same proof activates exactly one child under concurrent transactions',async()=>{
  const attempts=await Promise.allSettled([family1.command<{id:string}>(a,'child.activate',enroll),family2.command<{id:string}>(a,'child.activate',enroll)]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);const success=attempts.find(r=>r.status==='fulfilled');assert(success?.status==='fulfilled');childId=success.value.id;
  assert.equal((await admin.query('SELECT id FROM app.children WHERE family_id=$1',[fid])).rowCount,1);assert.equal((await admin.query('SELECT id FROM app.rooms WHERE child_id=$1',[childId])).rowCount,1);
 });
 await check('RLS isolates families and clears transaction-local identity on a reused connection',async()=>{
  await family2.command(b,'child.activate',await proof(b,fidB));
  for(const [actor,count] of [[a,1],[b,1]] as const){await db1.transaction().execute(async tx=>{await query(tx,"SELECT set_config('iharu.member_id',$1,true),set_config('iharu.session_id',$2,true)",[actor.memberId,actor.sessionId]);const rows=await query<{family_id:string}>(tx,'SELECT family_id FROM app.children');assert.equal(rows.length,count);assert.equal(rows[0].family_id,actor===a?fid:fidB);});}
  assert.equal((await query(db1,'SELECT id FROM app.children')).length,0);
  await assert.rejects(query(db1,"UPDATE app.children SET nickname='forbidden'"),{code:'42501'});
  await assert.rejects(query(authdb,'SELECT * FROM app.children'),{code:'42501'});
 });
 await check('owner changes reject the second concurrent stale version without granting child access',async()=>{
  const tokenHash=family1.digest('ci-invite');await family1.command(a,'invite.create',{familyId:fid,tokenHash});const pending=await family2.command<{membershipId:string}>(b,'invite.accept',{tokenHash});await family1.command(a,'member.approve',{membershipId:pending.membershipId,expectedVersion:1});
  const results=await Promise.allSettled([family1.command(a,'owner.transfer',{familyId:fid,memberId:b.memberId,expectedVersion:1}),family2.command(a,'owner.transfer',{familyId:fid,memberId:b.memberId,expectedVersion:1})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const list=await family2.command<{children:unknown[]}>(b,'children.list',{familyId:fid});assert.equal(list.children.length,0);
 });
 async function pairing(){const proofHash=family1.digest(randomUUID());const p=await family1.command<{id:string}>({requestId:randomUUID()},'pair.start',{codeHash:family1.digest(randomUUID()),proofHash,label:'가상 기기',previousProofHash:''});await family1.command(a,'pair.approve',{pairingId:p.id,childId,expectedVersion:1});return {pairingId:p.id,proofHash,exchangeKey:randomUUID()};}
 const anonymous={requestId:randomUUID()};
 await check('response-loss exchange races return one device and the same encrypted response',async()=>{
  const p=await pairing();const result=await Promise.all([family1.command<{sealed:string}>(anonymous,'pair.exchange',{...p,deviceHash:family1.digest('device-1'),sealed:family1.seal('cookie-1')}),family2.command<{sealed:string}>(anonymous,'pair.exchange',{...p,deviceHash:family1.digest('device-2'),sealed:family1.seal('cookie-2')})]);assert.equal(result[0].sealed,result[1].sealed);assert.equal((await admin.query('SELECT id FROM app.child_devices WHERE child_id=$1',[childId])).rowCount,1);
 });
 await check('concurrent different pairings cannot exceed two active devices',async()=>{
  const p=await pairing(),q=await pairing();const result=await Promise.allSettled([family1.command(anonymous,'pair.exchange',{...p,deviceHash:family1.digest('device-3'),sealed:family1.seal('cookie-3')}),family2.command(anonymous,'pair.exchange',{...q,deviceHash:family1.digest('device-4'),sealed:family1.seal('cookie-4')})]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);const rejected=result.find(r=>r.status==='rejected');assert(rejected?.status==='rejected');assert.equal(rejected.reason.message,'DEVICE_LIMIT');assert.equal((await admin.query('SELECT id FROM app.child_devices WHERE child_id=$1',[childId])).rowCount,2);
 });
 await check('committed general withdrawal immediately denies both runtime connections and records durable work',async()=>{
  await family1.command(a,'consent.revoke',{childId,purpose:'general',expectedVersion:1});
  const hash=(await admin.query('SELECT token_hash FROM app.child_devices WHERE child_id=$1 LIMIT 1',[childId])).rows[0].token_hash;
  await assert.rejects(family2.command({requestId:randomUUID(),deviceHash:hash},'child.session'),{message:'DEVICE_REQUIRED'});
  assert.equal((await admin.query("SELECT id FROM app_private.outbox WHERE kind='DELETE_CHILD'")).rowCount,1);
  assert.equal((await family2.command<{children:unknown[]}>(a,'children.list',{familyId:fid})).children.length,0);
 });
 console.log(`PostgreSQL integration: ${passed} scenarios passed`);
}finally{for(const db of connections)await db.destroy();await admin.end();}
