// Isolated browser-test entry point. Never imported by the production server or API bundle.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { testDatabase } from './auth-db.js';
import { createAuthService } from '../../server/auth/service.js';
import { createApp } from '../../server/app.js';

const { db,engine }=await testDatabase();
for(const file of ['0001_foundation.sql','0002_better_auth_175.sql','0003_account_policy.sql'])await engine.exec(await readFile(`db/migrations/${file}`,'utf8'));
const outbox:{to:string;url:string;kind:string}[]=[];
const svc=createAuthService({origin:'http://127.0.0.1:4174',secret:'isolated-browser-fixture-never-use-in-production-001',databaseUrl:'unused',mail:{key:'fixture',from:'test@example.test'},sms:null,social:{}},db,{sendMail:async data=>{outbox.push(data);},sendSms:async()=>{throw new Error('NO_SMS_IN_BROWSER_FIXTURE');}});
const app=new Hono();
app.get('/__test__/mail',c=>c.json(outbox));
app.route('/',createApp({environment:'local',demoEnabled:false},()=>svc));
app.use('*',serveStatic({root:'./dist'}));
app.get('*',serveStatic({path:'./dist/index.html'}));
const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:4174});
async function stop(){server.close();await db.destroy();process.exit(0);}
process.on('SIGTERM',()=>{void stop();});process.on('SIGINT',()=>{void stop();});
