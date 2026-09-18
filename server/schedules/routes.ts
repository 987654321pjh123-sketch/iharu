import {Hono,type Context} from 'hono';
import {getCookie} from 'hono/cookie';
import {z} from 'zod';
import {currentSession} from '../auth/routes.js';
import type {AuthService} from '../auth/service.js';
import type {FamilyActor,FamilyService} from '../family/service.js';
import {ScheduleService} from './service.js';
import {id,version} from '../../shared/family.js';
import {scheduleInput,changeInput,applyChangeInput,decisionInput,closureInput,rangeInput} from '../../shared/schedules.js';
const messages:Record<string,string>={AUTH_REQUIRED:'먼저 로그인해 주세요.',ACCESS_NOT_READY:'보호자 계정 확인과 가족 연결을 먼저 마쳐 주세요.',FORBIDDEN:'보호자만 일정을 변경할 수 있어요.',NOT_FOUND:'조회할 일정이나 공유 권한을 다시 확인해 주세요.',UNAVAILABLE:'일정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',INVALID_INPUT:'날짜·시간과 입력한 내용을 다시 확인해 주세요.',INVALID_RANGE:'지난 90일부터 앞으로 56일까지, 한 번에 56일 이내로 조회해 주세요.',VERSION_CONFLICT:'다른 가족이 일정을 변경했어요. 최신 내용을 불러온 뒤 다시 확인해 주세요.',KEY_REUSED:'다른 내용에 사용한 요청이에요. 내용을 확인하고 새로 요청해 주세요.',REQUEST_IN_PROGRESS:'같은 요청을 처리하고 있어요. 잠시 후 다시 확인해 주세요.',PREVIEW_EXPIRED:'변경 미리보기가 만료되거나 내용이 달라졌어요. 다시 확인해 주세요.',LATER_CHOICE_REQUIRED:'이미 예약한 미래 변경을 유지할지 선택해 주세요.',PAST_RECORD_LOCKED:'지난 일정이나 기록이 연결된 일정은 여기서 바꿀 수 없어요.',INVALID_TARGET:'취소·휴강된 같은 아이의 일정만 보강할 수 있어요.',MAKEUP_EXISTS:'이미 연결된 보강 일정이 있어요. 반복 일정 목록에서 확인해 주세요.',SCHEDULE_LIMIT:'진행 중인 일정은 아이당 100개까지 등록할 수 있어요.',RATE_LIMITED:'요청이 많아요. 잠시 후 다시 시도해 주세요.'};
type Env={Variables:{requestId:string}};
export function scheduleRoutes(auth:()=>AuthService|null,runtime:()=>Promise<FamilyService|null>){
 const app=new Hono<Env>();
 function fail(c:Context<Env>,code:string,status:400|401|403|404|409|422|429|503){if(status===429)c.header('Retry-After','60');return c.json({error:{code,message:messages[code]||messages.INVALID_INPUT},requestId:c.get('requestId')},status);}
 function endpoint(op:string,schema:z.ZodType,params:(c:Context<Env>)=>Record<string,unknown>,write=false){return async(c:Context<Env>)=>{
  const svc=auth();if(!svc)return fail(c,'AUTH_REQUIRED',401);
  const session=await currentSession(svc,c.req.raw);const actor:FamilyActor={requestId:c.get('requestId')};
  const family=await runtime();if(!family)return fail(c,'UNAVAILABLE',503);
  if(session){
   if(session.guard.assurance!=='HIGH'||!session.user.emailVerified||!session.guard.access_ready||session.user.email.endsWith('@identity.iharu.invalid'))return fail(c,'ACCESS_NOT_READY',403);
   actor.memberId=session.guard.member_id;actor.sessionId=session.session.id;
  }else{
   const token=getCookie(c,svc.settings.origin.startsWith('https:')?'__Host-iharu-child':'iharu-child');
   if(!token)return fail(c,'AUTH_REQUIRED',401);
   if(write||!['child.list','occurrence.get'].includes(op))return fail(c,'FORBIDDEN',403);
   actor.deviceHash=family.digest(`device:${token}`);
  }
  if(c.req.method!=='GET'&&c.req.header('Origin')!==svc.settings.origin)return fail(c,'FORBIDDEN',403);
  let input:unknown;try{input=c.req.method==='GET'?c.req.query():await c.req.json();}catch{return fail(c,'INVALID_INPUT',422);}
  const parsed=schema.safeParse(input),path=params(c);
  if(!parsed.success||Object.values(path).some(v=>!id.safeParse(v).success))return fail(c,'INVALID_INPUT',422);
  const key=c.req.header('Idempotency-Key');if(write&&op!=='preview'&&(!key||!/^[-a-zA-Z0-9_]{8,128}$/.test(key)))return fail(c,'INVALID_INPUT',422);
  try{
   if(c.req.method!=='GET')await svc.policy.takeLimits([{key:`schedules:${actor.memberId}`,windowMs:60000,limit:60}]);
   const result=await new ScheduleService(family).command(actor,op,{...(parsed.data as object),...path,...(write&&op!=='preview'?{key}:{})});
   return c.json({...result,serverNow:typeof result.serverNow==='string'?result.serverNow:new Date().toISOString()},op==='create'?201:200);
  }catch(error){
   const e=error as {message?:string;body?:{code?:string}};const code=e.body?.code||e.message||'';
   if(messages[code])return fail(c,code,code==='NOT_FOUND'?404:code==='RATE_LIMITED'?429:code==='ACCESS_NOT_READY'?403:['VERSION_CONFLICT','KEY_REUSED','REQUEST_IN_PROGRESS','PREVIEW_EXPIRED','LATER_CHOICE_REQUIRED','PAST_RECORD_LOCKED','MAKEUP_EXISTS'].includes(code)?409:422);
   console.error(JSON.stringify({code:'SCHEDULE_COMMAND_FAILED',requestId:c.get('requestId')}));return fail(c,'UNAVAILABLE',503);
  }
 };}
 const empty=z.object({}).strict();const family=(c:Context<Env>)=>({familyId:c.req.param('familyId')}),child=(c:Context<Env>)=>({childId:c.req.param('childId')}),occurrence=(c:Context<Env>)=>({occurrenceId:c.req.param('occurrenceId')});
 app.get('/api/v1/families/:familyId/schedule-children',endpoint('children',empty,family));
 app.get('/api/v1/families/:familyId/calendar',endpoint('calendar',rangeInput,family));
 app.get('/api/v1/families/:familyId/schedule-series',endpoint('series.list',z.object({childId:id.optional(),cursor:id.optional()}).strict(),family));
 app.get('/api/v1/children/:childId/schedules',endpoint('child.list',rangeInput,child));
 app.post('/api/v1/children/:childId/schedules',endpoint('create',scheduleInput,child,true));
 app.get('/api/v1/occurrences/:occurrenceId',endpoint('occurrence.get',empty,occurrence));
 app.post('/api/v1/occurrences/:occurrenceId/change-preview',endpoint('preview',changeInput,occurrence,true));
 app.patch('/api/v1/occurrences/:occurrenceId',endpoint('change',applyChangeInput,occurrence,true));
 app.post('/api/v1/occurrences/:occurrenceId/holiday-decision',endpoint('decision',decisionInput,occurrence,true));
 app.post('/api/v1/schedule-series/:seriesId/closures',endpoint('closure.create',closureInput,c=>({seriesId:c.req.param('seriesId')}),true));
 app.delete('/api/v1/schedule-series/:seriesId/closures/:closureId',endpoint('closure.remove',z.object({expectedVersion:version}).strict(),c=>({seriesId:c.req.param('seriesId'),closureId:c.req.param('closureId')}),true));
 return app;
}
