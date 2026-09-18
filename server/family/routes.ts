import { Hono,type Context } from 'hono';
import { getCookie,setCookie,deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { currentSession } from '../auth/routes.js';
import type { AuthService } from '../auth/service.js';
import { id,version,familyName,grantsInput,childInput } from '../../shared/family.js';
import { FamilyService,type FamilyActor } from './service.js';
const message:Record<string,string>={PAIRING_SEPARATE_DEVICE:'보호자가 로그인하지 않은 아이 기기에서 연결을 시작해 주세요.',AUTH_REQUIRED:'먼저 로그인해 주세요.',ACCESS_NOT_READY:'보호자 계정 확인을 마친 뒤 이용할 수 있어요.',FAMILY_UNAVAILABLE:'가족 연결을 준비하고 있어요. 잠시 후 다시 확인해 주세요.',VERIFICATION_NOT_CONNECTED:'보호자 관계 확인을 준비하고 있어요. 아직 실제 아이 정보를 입력하지 마세요.',NOT_FOUND:'접근할 수 없는 정보예요.',FORBIDDEN:'이 작업을 할 수 있는 권한이 없어요.',REAUTH_REQUIRED:'계정에서 본인 인증을 다시 해 주세요.',VERSION_CONFLICT:'다른 가족이 먼저 변경했어요. 새로고침 후 다시 확인해 주세요.',INVITE_INVALID:'사용할 수 없는 초대예요. 새 초대를 요청해 주세요.',CODE_INVALID:'연결 번호를 다시 확인해 주세요.',PAIRING_INVALID:'연결 시간이 지났거나 사용할 수 없는 번호예요.',PAIRING_RESTART:'연결 시간이 지났어요. 보호자에게 연결된 기기를 확인하고 다시 시작해 달라고 해 주세요.',DEVICE_REQUIRED:'아이 기기를 다시 연결해 주세요.',DEVICE_LIMIT:'아이 한 명당 기기는 2대까지 연결할 수 있어요.',ADULT_LIMIT:'가족은 보호자 5명까지 함께할 수 있어요.',CHILD_LIMIT:'가족당 아이는 5명까지 등록할 수 있어요.',FAMILY_LIMIT:'참여할 수 있는 가족 수를 초과했어요.',DRAFT_LIMIT:'진행 중인 등록을 먼저 확인해 주세요.',VERIFICATION_REQUIRED:'보호자 관계 확인을 먼저 마쳐 주세요.',PROOF_INVALID:'등록 확인이 만료되었어요. 동의를 다시 확인해 주세요.',CONSENT_REQUIRED:'필수 동의를 확인해 주세요.',LOCATION_CONSENT_REQUIRED:'아이 위치 공유 동의가 필요해요.',CONSENTER_REQUIRED:'아이의 동의권자는 여기서 제외할 수 없어요.',OWNER_REQUIRED:'운영권을 먼저 다른 보호자에게 이전해 주세요.',INVALID_TARGET:'함께하는 가족을 다시 선택해 주세요.',ALREADY_MEMBER:'이미 함께하는 가족이에요.',INVALID_STATE:'진행 상태를 다시 확인해 주세요.',RATE_LIMITED:'잠시 후 다시 시도해 주세요.',INVALID_INPUT:'입력한 내용을 다시 확인해 주세요.'};
const anonymous=new Set(['pair.start','pair.status','pair.exchange','child.session','child.logout']);
type FamilyEnv={Variables:{requestId:string;actor:FamilyActor}};
export function familyRoutes(auth:()=>AuthService|null,runtime:()=>Promise<FamilyService|null>){
 const app=new Hono<FamilyEnv>();
 app.use('/api/v1/*',bodyLimit({maxSize:8192,onError:c=>c.json({error:{code:'INVALID_INPUT',message:message.INVALID_INPUT},requestId:c.get('requestId')},413)}));
 async function run(c:Context<FamilyEnv>,op:string,input:Record<string,unknown>={},recent=false){
  const svc=auth();
  const fail=(code:string,status:400|401|403|404|409|429|503=400)=>c.json({error:{code,message:message[code]||message.INVALID_INPUT},requestId:c.get('requestId')},status);
  if(!anonymous.has(op)){
   if(!svc)return fail('AUTH_REQUIRED',401);
   const s=await currentSession(svc,c.req.raw);if(!s)return fail('AUTH_REQUIRED',401);
   if(s.guard.assurance!=='HIGH'||!s.user.emailVerified||!s.guard.access_ready||s.user.email.endsWith('@identity.iharu.invalid'))return fail('ACCESS_NOT_READY',403);
   c.set('actor',{memberId:s.guard.member_id,sessionId:s.session.id,requestId:c.get('requestId')});
   if(recent){try{await svc.policy.requireRecent(s.session.id);}catch{return fail('REAUTH_REQUIRED',403);}}
  }else c.set('actor',{requestId:c.get('requestId')});
  if(!svc)return fail('FAMILY_UNAVAILABLE',503);
  if(c.req.method!=='GET' && c.req.header('Origin')!==svc.settings.origin)return fail('FORBIDDEN',403);
  const db=await runtime();if(!db)return fail('FAMILY_UNAVAILABLE',503);
  const secure=!!svc?.settings.origin.startsWith('https:');
  const pairName=secure?'__Host-iharu-pair':'iharu-pair',deviceName=secure?'__Host-iharu-child':'iharu-child';
  const cookieOptions={httpOnly:true,secure,sameSite:'strict' as const,path:'/'};
  const proof=getCookie(c,pairName),childToken=getCookie(c,deviceName);
  if(['pair.start','pair.exchange'].includes(op)&&await currentSession(svc,c.req.raw))return fail('PAIRING_SEPARATE_DEVICE',403);
  const actor={...c.get('actor'),...(anonymous.has(op)&&childToken?{deviceHash:db.digest(`device:${childToken}`)}:{})};
  try{
   // Distributed counters never trust arbitrary X-Forwarded-For. Vercel overwrites x-vercel-forwarded-for.
   const ip=process.env.VERCEL?c.req.header('x-vercel-forwarded-for')||'unknown':'local';
   if(svc&&c.req.method!=='GET')await svc.policy.takeLimits([{key:`family:${actor.memberId||ip}`,windowMs:60000,limit:60}]);
   if(op==='pair.start'){
    if(svc)await svc.policy.takeLimits([{key:`pair:start:${ip}`,windowMs:600000,limit:10}]);
    const raw=db.token();let response:Record<string,unknown>|undefined;let code='';
    for(let attempt=0;attempt<3;attempt++){
     code=String(randomInt(1000000)).padStart(6,'0');
     try{response=await db.command(actor,op,{...input,codeHash:db.digest(`code:${code}`),proofHash:db.digest(`proof:${raw}`),previousProofHash:proof?db.digest(`proof:${proof}`):''});break;}
     catch(e){if((e as {code?:string}).code!=='23505'||attempt===2)throw e;}
    }
    setCookie(c,pairName,raw,{...cookieOptions,maxAge:720});return c.json({...response,code,serverNow:new Date().toISOString()},201);
   }
   if(op==='pair.resolve'){
    if(svc)await svc.policy.takeLimits([{key:`pair:resolve:${actor.memberId}`,windowMs:600000,limit:5},{key:`pair:resolve-ip:${ip}`,windowMs:600000,limit:30}]);
    input={codeHash:db.digest(`code:${input.code}`)};
   }
   if(op==='pair.status'||op==='pair.exchange'){
    if(!proof)return fail('PAIRING_INVALID',403);
    input={...input,proofHash:db.digest(`proof:${proof}`)};
   }
   if(op==='pair.exchange'){
    const raw=db.token();const r=await db.command<{sealed:string}>(actor,op,{...input,deviceHash:db.digest(`device:${raw}`),sealed:db.seal(raw)});
    setCookie(c,deviceName,db.unseal(r.sealed),{...cookieOptions,maxAge:30*86400});return c.json({status:'CONNECTED'});
   }
   if(op==='invite.create'){
    const token=db.token();const r=await db.command(actor,op,{...input,tokenHash:db.digest(`invite:${token}`)});
    return c.json({...r,inviteUrl:`${svc!.settings.origin}/family/invite#${token}`});
   }
   if(op==='invite.accept')input={tokenHash:db.digest(`invite:${input.token}`)};
   if(op==='child.logout')deleteCookie(c,deviceName,cookieOptions);
   const result=await db.command(actor,op,input);return c.json({...result,serverNow:new Date().toISOString()});
  }catch(e){
   const error=e as {message?:string;code?:string;body?:{code?:string}};const code=error.body?.code||error.message||'';
   if(message[code])return fail(code,code==='RATE_LIMITED'?429:code==='DEVICE_REQUIRED'?401:['FORBIDDEN','REAUTH_REQUIRED','ACCESS_NOT_READY'].includes(code)?403:code==='NOT_FOUND'?404:code==='VERSION_CONFLICT'?409:400);
   console.error(JSON.stringify({code:'FAMILY_COMMAND_FAILED',requestId:c.get('requestId')}));return fail('FAMILY_UNAVAILABLE',503);
  }
 }
 // All mutation fields are strict; roles, VERIFIED state, family membership, or proof evidence cannot be submitted.
 type C=Parameters<typeof run>[0];
 function endpoint(op:string,schema:z.ZodType,params:(c:C)=>Record<string,unknown>=()=>({}),recent=false){return async(c:C)=>{
  let input:unknown;try{input=c.req.method==='GET'?{}:await c.req.json();}catch{input=null;}
  const parsed=schema.safeParse(input),p=params(c);
  if(!parsed.success||Object.entries(p).some(([k,v])=>k.endsWith('Id')&&!id.safeParse(v).success))return c.json({error:{code:'INVALID_INPUT',message:message.INVALID_INPUT},requestId:c.get('requestId')},400);
  return run(c,op,{...(parsed.data as object),...p},recent);
 };}
 const empty=z.object({}).strict(),expected=z.object({expectedVersion:version}).strict();
 const family=(c:C)=>({familyId:c.req.param('familyId')}),child=(c:C)=>({childId:c.req.param('childId')}),draft=(c:C)=>({draftId:c.req.param('draftId')}),pair=(c:C)=>({pairingId:c.req.param('pairingId')});
 app.get('/api/v1/setup',async c=>{
  const svc=auth();const s=svc?await currentSession(svc,c.req.raw):null;
  if(!s)return c.json({error:{code:'AUTH_REQUIRED',message:message.AUTH_REQUIRED},requestId:c.get('requestId')},401);
  if(s.guard.assurance!=='HIGH')return c.json({error:{code:'ACCESS_NOT_READY',message:message.ACCESS_NOT_READY},requestId:c.get('requestId')},403);
  return c.json({accountReady:s.guard.access_ready&&s.user.emailVerified,databaseReady:!!(await runtime()),relationshipVerification:'NOT_CONNECTED',realChildRegistrationEnabled:false});
 });
 app.get('/api/v1/me',endpoint('me',empty));
 app.post('/api/v1/families',endpoint('family.create',z.object({name:familyName}).strict(),()=>({}),true));
 app.get('/api/v1/families/:familyId/members',endpoint('family.members',empty,family));
 app.post('/api/v1/families/:familyId/invites',endpoint('invite.create',empty,family,true));
 app.post('/api/v1/invites/accept',endpoint('invite.accept',z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict()));
 app.post('/api/v1/families/:familyId/owner',endpoint('owner.transfer',expected.extend({memberId:id}),family,true));
 for(const [suffix,op] of [['approve','member.approve'],['revoke','member.revoke']])app.post(`/api/v1/memberships/:membershipId/${suffix}`,endpoint(op,expected,c=>({membershipId:c.req.param('membershipId')}),true));
 app.get('/api/v1/families/:familyId/children',endpoint('children.list',empty,family));
 app.post('/api/v1/families/:familyId/child-registration-drafts',endpoint('draft.create',empty,family));
 app.get('/api/v1/child-registration-drafts/:draftId',endpoint('draft.get',empty,draft));
 app.post('/api/v1/child-registration-drafts/:draftId/verification-sessions',async c=>{
  // No verifier has been selected. Never turn a client checkbox, SMS, or adult identity result into relationship evidence.
  const r=await run(c,'draft.get',{draftId:c.req.param('draftId')},true);
  if(r.status!==200)return r;
  return c.json({error:{code:'VERIFICATION_NOT_CONNECTED',message:message.VERIFICATION_NOT_CONNECTED},requestId:c.get('requestId')},503);
 });
 app.post('/api/v1/child-registration-drafts/:draftId/consent-proofs',endpoint('consent.proof',z.object({policyVersion:z.literal('6.1'),general:z.literal(true),location:z.boolean()}).strict(),draft,true));
 app.post('/api/v1/families/:familyId/children',endpoint('child.activate',childInput,family,true));
 app.get('/api/v1/children/:childId/grants',endpoint('grants.get',empty,child));
 app.put('/api/v1/children/:childId/grants/:memberId',endpoint('grants.put',grantsInput,c=>({...child(c),memberId:c.req.param('memberId')}),true));
 app.get('/api/v1/children/:childId/devices',endpoint('devices.list',empty,child));
 app.delete('/api/v1/children/:childId/devices/:deviceId',endpoint('device.revoke',empty,c=>({...child(c),deviceId:c.req.param('deviceId')}),true));
 app.get('/api/v1/children/:childId/consents',endpoint('consents.get',empty,child));
 app.post('/api/v1/children/:childId/consents/revoke',endpoint('consent.revoke',expected.extend({purpose:z.enum(['general','location'])}),child,true));
 app.post('/api/v1/device-pairings',endpoint('pair.start',z.object({label:familyName}).strict()));
 app.post('/api/v1/device-pairings/resolve',endpoint('pair.resolve',z.object({code:z.string().regex(/^\d{6}$/)}).strict()));
 app.post('/api/v1/device-pairings/:pairingId/approve',endpoint('pair.approve',expected.extend({childId:id}),pair,true));
 app.post('/api/v1/device-pairings/:pairingId/status',endpoint('pair.status',empty,pair));
 app.post('/api/v1/device-pairings/:pairingId/exchange',endpoint('pair.exchange',z.object({exchangeKey:id}).strict(),pair));
 app.get('/api/v1/child-session',endpoint('child.session',empty));
 app.post('/api/v1/child-session/logout',endpoint('child.logout',empty));
 return app;
}
