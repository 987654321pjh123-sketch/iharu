// Isolated browser-test entry point. Never imported by the production server or API bundle.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { testDatabase } from './auth-db.js';
import { createAuthService } from '../../server/auth/service.js';
import { FamilyService } from '../../server/family/service.js';
import { query } from '../../server/auth/database.js';
import { createApp } from '../../server/app.js';

const { db,engine }=await testDatabase();
for(const file of ['0001_foundation.sql','0002_better_auth_175.sql','0003_account_policy.sql','0004_family.sql','0005_family_commands.sql','0006_family_maintenance.sql'])await engine.exec(await readFile(`db/migrations/${file}`,'utf8'));
const outbox:{to:string;url:string;kind:string}[]=[];
const svc=createAuthService({origin:'http://127.0.0.1:4174',secret:'isolated-browser-fixture-never-use-in-production-001',databaseUrl:'unused',mail:{key:'fixture',from:'test@example.test'},sms:null,social:{}},db,{sendMail:async data=>{outbox.push(data);},sendSms:async()=>{throw new Error('NO_SMS_IN_BROWSER_FIXTURE');}});
const family=new FamilyService(db,svc.settings.secret,'app_runtime');
const app=new Hono();
// PGlite is a single SQL connection. Serialize whole fixture requests, not nested auth hooks.
// Actual multi-connection contention is a separate Supabase integration check.
let queue=Promise.resolve();
app.use('*',async(_c,next)=>{const previous=queue;let unlock!:()=>void;queue=new Promise<void>(r=>{unlock=r;});await previous;try{await next();}finally{unlock();}});
app.post('/__test__/ready',async c=>{const {email}=await c.req.json();if(typeof email!=='string'||!email.endsWith('@example.test'))return c.json({},400);await query(db,'UPDATE iharu_auth.members SET access_ready=true WHERE auth_user_id IN (SELECT id FROM iharu_auth."user" WHERE email=$1)',[email]);return c.json({ok:true});});
app.post('/__test__/verify-draft',async c=>{const {draftId}=await c.req.json();await query(db,"SELECT app_private.record_relationship_result($1,$2,$3,'2018-03-02','virtual-browser-fixture',true)",[draftId,crypto.randomUUID(),crypto.randomUUID()]);return c.json({ok:true});});
app.get('/__test__/mail',c=>c.json(outbox));
app.route('/',createApp({environment:'local',demoEnabled:false},()=>svc,async()=>family));
app.use('*',serveStatic({root:'./dist'}));
app.get('*',serveStatic({path:'./dist/index.html'}));
const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:4174});
async function stop(){server.close();await db.destroy();process.exit(0);}
process.on('SIGTERM',()=>{void stop();});process.on('SIGINT',()=>{void stop();});
