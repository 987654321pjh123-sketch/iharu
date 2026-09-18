import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { testDatabase } from './helpers/auth-db';
import { createAuthService } from '../server/auth/service';
import { createApp } from '../server/app';
import { query } from '../server/auth/database';
import { REAUTH_MS, IDLE_MS, normalizePhone } from '../server/auth/policy';
import type { AuthSettings } from '../server/auth/config';

const origin='http://localhost:4173';
const settings:AuthSettings={origin,secret:'p02-isolated-tests-not-a-production-secret-001',databaseUrl:'unused',mail:{key:'test-only',from:'test@example.test'},sms:{key:'test-only',secret:'test-only',from:'01000000000',dailyBudget:100},social:{google:{clientId:'test',clientSecret:'test'},kakao:{clientId:'test',clientSecret:'test'},naver:{clientId:'test',clientSecret:'test'}}};
let database:Awaited<ReturnType<typeof testDatabase>>;
let svc:ReturnType<typeof createAuthService>;
let app:ReturnType<typeof createApp>;
let time:Date;
const mail:{to:string;url:string;kind:string}[]=[];
const sms:{phone:string;code:string}[]=[];
const password='verified-parent-password-24';
class Browser {
  cookies=new Map<string,string>();
  async request(path:string,body?:object,customHeaders:Record<string,string>={}){
    const headers={Origin:origin,'Content-Type':'application/json','User-Agent':'Test Chrome/153',Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; '),...customHeaders};
    const response=await app.request(path.startsWith('http')?path:`${origin}${path}`,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});
    for(const cookie of response.headers.getSetCookie()) {const first=cookie.split(';')[0];const separator=first.indexOf('=');const name=first.slice(0,separator),value=first.slice(separator+1);if(value)this.cookies.set(name,value);else this.cookies.delete(name);}
    return response;
  }
}
async function signup(b:Browser,email='parent@example.test'){
  const r=await b.request('/api/auth/sign-up/email',{email,password,name:'보호자',callbackURL:'/login?verified=1'});
  expect(r.status,await r.clone().text()).toBe(200);
  const link=[...mail].reverse().find(m=>m.to===email&&m.kind==='verify');expect(link).toBeDefined();
  expect((await b.request(link!.url)).status).toBe(302);
  const login=await b.request('/api/auth/sign-in/email',{email,password});
  expect(login.status,await login.clone().text()).toBe(200);
  return login;
}
beforeAll(async()=>{
  database=await testDatabase();
  for(const file of ['0001_foundation.sql','0002_better_auth_175.sql','0003_account_policy.sql'])await database.engine.exec(await readFile(`db/migrations/${file}`,'utf8'));
},30_000);
beforeEach(async()=>{
  await database.engine.exec('TRUNCATE iharu_auth."user",iharu_auth.verification,iharu_auth.rate_buckets,iharu_auth.phone_challenges CASCADE');
  time=new Date();mail.length=0;sms.length=0;
  svc=createAuthService(settings,database.db,{sendMail:async data=>{mail.push(data);},sendSms:async(phone,code)=>{sms.push({phone,code});}},()=>time);
  app=createApp({environment:'local',demoEnabled:true},()=>svc);
});
afterAll(async()=>{await database.db.destroy();});

describe('P02 real Better Auth + PostgreSQL integration',()=>{
  it('requires email verification; sets HttpOnly cookie and never returns token or family data',async()=>{
    const b=new Browser();
    expect((await b.request('/api/auth/sign-up/email',{email:'parent@example.test',password,name:'보호자',callbackURL:'/login?verified=1'})).status).toBe(200);
    const unverified=await b.request('/api/auth/sign-in/email',{email:'parent@example.test',password});
    expect(unverified.status).toBe(403);
    await b.request(mail[0].url);
    const login=await b.request('/api/auth/sign-in/email',{email:'parent@example.test',password});
    expect(login.status,await login.clone().text()).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('HttpOnly');
    expect(login.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(await login.json()).toEqual({status:true});
    const session=await(await b.request('/api/account/session')).json();
    expect(session).toMatchObject({authenticated:true,assurance:'HIGH',emailVerified:true,accessReady:false});
    expect(JSON.stringify(session)).not.toMatch(/token|family|children|notification/);
    expect((await b.request('/api/v1/children')).status).toBe(403);
    expect((await b.request('/api/auth/get-session')).status).toBe(403);
  });
  it('keeps signup and recovery responses uniform for known and unknown addresses',async()=>{
    const b=new Browser();await signup(b);
    const duplicate=await b.request('/api/auth/sign-up/email',{email:'parent@example.test',password,name:'보호자'});
    const fresh=await b.request('/api/auth/sign-up/email',{email:'other@example.test',password,name:'보호자'});
    expect(duplicate.status).toBe(fresh.status);expect(await duplicate.json()).toEqual(await fresh.json());
    const known=await b.request('/api/auth/request-password-reset',{email:'parent@example.test',redirectTo:'/reset-password'});
    const unknown=await b.request('/api/auth/request-password-reset',{email:'missing@example.test',redirectTo:'/reset-password'});
    expect(await known.json()).toEqual(await unknown.json());
  });
  it('resets with a one-use token and revokes every existing session',async()=>{
    const a=new Browser(),b=new Browser();await signup(a);await b.request('/api/auth/sign-in/email',{email:'parent@example.test',password});
    await a.request('/api/auth/request-password-reset',{email:'parent@example.test',redirectTo:'/reset-password'});
    const url=[...mail].reverse().find(m=>m.kind==='reset')!.url;
    const token=new URL(url).pathname.split('/').at(-1);
    expect((await a.request('/api/auth/reset-password',{token,newPassword:'replacement-password-2026'})).status).toBe(200);
    expect((await a.request('/api/auth/reset-password',{token,newPassword:'other-password-2026'})).status).toBe(400);
    expect(await(await a.request('/api/account/session')).json()).toEqual({authenticated:false});
    expect(await(await b.request('/api/account/session')).json()).toEqual({authenticated:false});
  });
  it('rejects direct privileged paths, untrusted origin and arbitrary redirects',async()=>{
    const b=new Browser();await signup(b);
    for(const path of ['update-user','unlink-account','delete-user','set-password','phone-number/reset-password','sign-in/phone-number','list-sessions'])expect((await b.request(`/api/auth/${path}`,{name:'attacker',password})).status).toBe(403);
    expect((await b.request('/api/account/logout',{sessionId:'all'},{Origin:'https://untrusted.example'})).status).toBe(403);
    expect((await b.request('/api/auth/sign-in/social',{provider:'google',callbackURL:'https://untrusted.example'})).status).toBe(400);
    expect(svc.auth.options.account?.accountLinking?.disableImplicitLinking).toBe(true);
  });
  it('cannot unlink the last method; stale proof cannot initiate linking',async()=>{
    const b=new Browser();await signup(b);
    const methods=await(await b.request('/api/account/methods')).json();
    const r=await b.request('/api/account/unlink',{accountId:methods.methods[0].id});
    expect(r.status).toBe(403);expect(await r.json()).toEqual({code:'LAST_LOGIN_METHOD'});
    time=new Date(+time+REAUTH_MS+1);
    expect((await b.request('/api/auth/link-social',{provider:'google',callbackURL:'/account'})).status).toBe(403);
    const before=[...b.cookies.values()].join();
    expect((await b.request('/api/account/reauthenticate',{password:'not-the-password'})).status).toBe(400);
    expect((await b.request('/api/account/reauthenticate',{password})).status).toBe(200);
    expect([...b.cookies.values()].join()).not.toBe(before);
    expect((await query(database.db,'SELECT id FROM iharu_auth.session')).length).toBe(1);
  });
  it('SMS starts LOW and leaks neither own profile nor family metadata through direct routes',async()=>{
    const b=new Browser();
    expect((await b.request('/api/auth/phone-number/send-otp',{phoneNumber:'010-1234-5678'})).status).toBe(200);
    expect(sms[0].phone).toBe('+821012345678');
    expect((await b.request('/api/auth/phone-number/verify',{phoneNumber:'01012345678',code:sms[0].code})).status).toBe(200);
    expect(await(await b.request('/api/account/session')).json()).toEqual({authenticated:true,assurance:'LOW',accessReady:false});
    expect((await b.request('/api/account/logout',{sessionId:'all'})).status).toBe(403);
    for(const path of ['/api/account/methods','/api/account/sessions','/api/auth/get-session','/api/auth/list-accounts','/api/v1/children','/api/v1/notifications'])expect((await b.request(path)).status).toBe(403);
    expect((await b.request('/api/auth/phone-number/verify',{phoneNumber:'01012345678',code:sms[0].code})).status).toBe(400);
  });
  it('OTP hashes, expiry, attempt limit, resend cooldown and daily budget survive separate service instances',async()=>{
    const b=new Browser();const phone='+821099998888';
    await b.request('/api/auth/phone-number/send-otp',{phoneNumber:phone});
    expect((await b.request('/api/auth/phone-number/send-otp',{phoneNumber:phone})).status).toBe(429);
    const stored=JSON.stringify(await query(database.db,'SELECT * FROM iharu_auth.phone_challenges'));
    expect(stored).not.toContain(sms[0].code);expect(stored).not.toContain(phone);
    for(let i=0;i<5;i++)expect(await svc.policy.consumeOtp(phone,'wrong')).toBe(false);
    expect(await svc.policy.consumeOtp(phone,sms[0].code)).toBe(false);
    await svc.policy.saveOtp(phone,'123456');time=new Date(+time+180_001);expect(await svc.policy.consumeOtp(phone,'123456')).toBe(false);
    const second=createAuthService(settings,database.db,{sendMail:async()=>{},sendSms:async()=>{}},()=>time);
    await second.policy.reserveSms('+821011112222','other',2);
    await expect(svc.policy.reserveSms('+821033334444','different',2)).rejects.toMatchObject({body:{code:'RATE_LIMITED'}});
    expect(normalizePhone('010 1234 5678')).toBe('+821012345678');
  });
  it('rechecks suspension, per-device revocation and inactivity on each request',async()=>{
    const a=new Browser(),b=new Browser();await signup(a);await b.request('/api/auth/sign-in/email',{email:'parent@example.test',password});
    const list=await(await a.request('/api/account/sessions')).json();expect(list.sessions).toHaveLength(2);expect(JSON.stringify(list)).not.toContain('token');
    const other=list.sessions.find((s:{current:boolean})=>!s.current);
    expect((await a.request('/api/account/logout',{sessionId:other.id})).status).toBe(200);
    expect(await(await b.request('/api/account/session')).json()).toEqual({authenticated:false});
    time=new Date(+time+IDLE_MS+1);expect(await(await a.request('/api/account/session')).json()).toEqual({authenticated:false});
    await a.request('/api/auth/sign-in/email',{email:'parent@example.test',password});
    await query(database.db,"UPDATE iharu_auth.members SET status='SUSPENDED'");
    expect(await(await a.request('/api/account/session')).json()).toEqual({authenticated:false});
  });
  it('all five methods are reported unavailable when configuration is absent',async()=>{
    const offline=createApp({environment:'production',demoEnabled:false},()=>null);
    const r=await offline.request('/api/account/providers');const result=await r.json();
    expect(result.providers).toHaveLength(5);expect(result.providers.every((p:{enabled:boolean})=>!p.enabled)).toBe(true);
    expect((await offline.request('/api/auth/sign-in/email',{method:'POST',headers:{Origin:'http://localhost'}})).status).toBe(503);
  });
  it('binds explicit email linking to the current session and a one-use proof, without email-based merging',async()=>{
    const b=new Browser();await signup(b);
    // Fixture: this verified user retains an external identity, with no email credential.
    await query(database.db,"UPDATE iharu_auth.account SET \"providerId\"='google',password=NULL");
    const begin=await b.request('/api/account/email/start',{email:'new-contact@example.test',password});
    expect(begin.status,await begin.clone().text()).toBe(200);
    const link=[...mail].reverse().find(m=>m.to==='new-contact@example.test')!;
    const token=new URL(link.url).searchParams.get('token');
    expect((await new Browser().request('/api/account/email/confirm',{token})).status).toBe(401);
    expect((await b.request('/api/account/email/confirm',{token})).status).toBe(200);
    expect((await b.request('/api/account/email/confirm',{token})).status).toBe(400);
    const separate=new Browser();expect((await separate.request('/api/auth/sign-in/email',{email:'new-contact@example.test',password})).status).toBe(200);
    const methods=await(await b.request('/api/account/methods')).json();
    expect(methods.methods.map((m:{provider:string})=>m.provider).sort()).toEqual(['credential','google']);
  });
  it('rotates a LOW session after checking the password of its previously linked account',async()=>{
    const b=new Browser();await signup(b);
    await b.request('/api/auth/phone-number/send-otp',{phoneNumber:'01012345678'});
    const link=await b.request('/api/auth/phone-number/verify',{phoneNumber:'01012345678',code:sms[0].code,updatePhoneNumber:true});
    expect(link.status).toBe(200);
    time=new Date(+time+61_000);
    const phoneBrowser=new Browser();await phoneBrowser.request('/api/auth/phone-number/send-otp',{phoneNumber:'01012345678'});
    await phoneBrowser.request('/api/auth/phone-number/verify',{phoneNumber:'01012345678',code:sms[1].code});
    expect(await(await phoneBrowser.request('/api/account/session')).json()).toMatchObject({assurance:'LOW'});
    const old=[...phoneBrowser.cookies.values()].join();
    expect((await phoneBrowser.request('/api/account/reauthenticate',{password})).status).toBe(200);
    expect([...phoneBrowser.cookies.values()].join()).not.toBe(old);
    expect(await(await phoneBrowser.request('/api/account/session')).json()).toMatchObject({assurance:'HIGH'});
    expect((await query(database.db,"SELECT * FROM iharu_auth.session_guard WHERE assurance='LOW'")).length).toBe(0);
  });
  it('constructs provider redirects with state and fixed first-party callback endpoints',async()=>{
    const b=new Browser();
    for(const provider of ['google','kakao','naver']){
      const r=await b.request('/api/auth/sign-in/social',{provider,callbackURL:'/account',errorCallbackURL:'/login'});
      expect(r.status,await r.clone().text()).toBe(200);
      const url=new URL((await r.json()).url);
      expect(url.searchParams.get('state')).toBeTruthy();
      expect(url.searchParams.get('redirect_uri')).toBe(`${origin}/api/auth/callback/${provider}`);
      if(provider==='google')expect(url.searchParams.get('code_challenge')).toBeTruthy();
    }
  });
});
