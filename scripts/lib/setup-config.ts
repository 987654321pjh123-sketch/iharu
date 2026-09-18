export type SetupFinding={key:string;state:'ready'|'missing'|'invalid';reason?:string};
const providers={email:['RESEND_API_KEY','MAIL_FROM'],google:['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'],kakao:['KAKAO_CLIENT_ID','KAKAO_CLIENT_SECRET'],naver:['NAVER_CLIENT_ID','NAVER_CLIENT_SECRET'],phone:['SOLAPI_API_KEY','SOLAPI_API_SECRET','SMS_FROM','SMS_DAILY_BUDGET']};
function role(url:URL|undefined){try{return url?decodeURIComponent(url.username).split('.')[0]:'';}catch{return '';}}
// Return names and fixed messages only. Never include a URL, username, secret, or raw parser exception.
export function inspectSetup(env:NodeJS.ProcessEnv){
 const findings:SetupFinding[]=[];
 const record=(key:string,valid:boolean,reason:string)=>findings.push({key,state:!env[key]?'missing':valid?'ready':'invalid',...(!valid?{reason}: {})});
 record('APP_ENV',['local','preview','production'].includes(env.APP_ENV||''),'local/preview/production 중 하나가 필요합니다.');
 let origin:URL|undefined;try{origin=new URL(env.APP_ORIGIN!);}catch{/* Report a fixed message below. */}
 record('APP_ORIGIN',!!origin&&origin.origin===env.APP_ORIGIN&&(origin.protocol==='https:'||(env.APP_ENV==='local'&&['localhost','127.0.0.1'].includes(origin.hostname)&&origin.protocol==='http:')),'환경에 맞는 정확한 origin이 필요합니다.');
 record('BETTER_AUTH_SECRET',!!env.BETTER_AUTH_SECRET&&env.BETTER_AUTH_SECRET.length>=32,'32자 이상의 서버 비밀값이 필요합니다.');
 const urls:Record<string,URL>={};
 for(const key of ['APP_DATABASE_URL','AUTH_DATABASE_URL']){
  let url:URL|undefined;try{url=new URL(env[key]!);}catch{/* Avoid printing connection strings. */}
  const local=url&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const unsafeTLS=url&&['disable','allow','prefer','no-verify'].includes(url.searchParams.get('sslmode')||'');
  const user=role(url);
  const valid=!!url&&['postgres:','postgresql:'].includes(url.protocol)&&!!url.password&&url.pathname.length>1&&!['postgres','supabase_admin','service_role','iharu_policy'].includes(user)&&!!user&&!(unsafeTLS&&!local);
  record(key,valid,'비관리자 PostgreSQL 역할과 암호·DB 이름·검증 가능한 TLS가 필요합니다.');if(valid)urls[key]=url!;
 }
 if(urls.APP_DATABASE_URL&&urls.AUTH_DATABASE_URL&&role(urls.APP_DATABASE_URL)===role(urls.AUTH_DATABASE_URL)){
  for(const f of findings.filter(f=>f.key.endsWith('DATABASE_URL'))){f.state='invalid';f.reason='업무와 인증에는 서로 다른 DB 역할이 필요합니다.';}
 }
 if(env.APP_ENV==='production'&&env.VERCEL_ENV&&env.VERCEL_ENV!=='production')findings.push({key:'VERCEL_ENV',state:'invalid',reason:'Preview에 운영 환경을 연결할 수 없습니다.'});
 const providerStatus=Object.entries(providers).map(([name,keys])=>({name,state:keys.every(k=>!!env[k])?'configured':keys.some(k=>!!env[k])?'incomplete':'not-configured',missing:keys.filter(k=>!env[k])}));
 const migration={state:env.MIGRATION_DATABASE_URL&&env.MIGRATION_TARGET===env.APP_ENV?'configured':'not-configured',requiredKeys:['MIGRATION_DATABASE_URL','MIGRATION_TARGET']};
 return {ready:findings.every(f=>f.state==='ready'),findings,providers:providerStatus,migration,notice:'설정 점검이며 실제 연결·메일 수신·보호자 관계 확인 완료를 뜻하지 않습니다.'};
}
