import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useApi } from '../api';
import { authPost, methodNames, methodsSchema, providersSchema, sessionSchema, sessionsSchema, startSocial } from '../auth';
import { AuthLayout, FormNotice, PasswordField } from '../components/AuthLayout';
import { ErrorState, Loading } from '../components/Common';
import { Icon } from '../components/Icon';

function useAction() {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  async function run(action:()=>Promise<void>){setBusy(true);setError('');setMessage('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return {busy,error,message,setMessage,run};
}
export function AccountPage(){
  const session=useApi('/api/account/session',sessionSchema);
  if(session.loading)return <AuthLayout wide><Loading label="내 계정을 확인하고 있어요"/></AuthLayout>;
  if(session.error)return <AuthLayout wide><ErrorState message={session.error} retry={session.retry}/></AuthLayout>;
  if(!session.data?.authenticated)return <Navigate to="/login" replace/>;
  return <AuthLayout wide>{session.data.assurance==='LOW'?<LowAccount/>:<VerifiedAccount name={session.data.name||'보호자'} email={session.data.email} emailVerified={session.data.emailVerified}/>}</AuthLayout>;
}
function LowAccount(){
  const action=useAction();
  return <><span className="account-symbol"><Icon name="shield"/></span><div className="auth-title"><span className="eyebrow">추가 확인</span><h1>한 번 더 확인할게요</h1><p>휴대폰 번호 확인을 마쳤어요. 가족 정보는 추가 확인 후 열 수 있어요.</p></div><FormNotice error={action.error} message={action.message}/><div className="low-actions"><Link className="button primary full" to="/account/reauth">기존 이메일 계정으로 확인</Link><Link className="button full" to="/login">연결한 소셜 계정으로 로그인</Link><button className="button full" disabled={action.busy} onClick={()=>action.run(async()=>{const r=await authPost('/api/account/recovery',{});action.setMessage(`복구 요청을 저장했어요. 접수 번호: ${r.caseId}. 확인이 끝나기 전에는 가족 정보가 열리지 않아요.`);})}>기존 방법을 사용할 수 없어요</button><button className="auth-back" disabled={action.busy} onClick={()=>action.run(async()=>{await authPost('/api/account/logout',{sessionId:'current'});window.location.assign('/login');})}>로그아웃</button></div><p className="auth-help">처음 가입했다면 보호자 확인과 가족 연결은 다음 구축 단계에서 지원해요.</p></>;
}
function VerifiedAccount({name,email,emailVerified}:{name:string;email?:string|null;emailVerified?:boolean}){
  const methods=useApi('/api/account/methods',methodsSchema),sessions=useApi('/api/account/sessions',sessionsSchema),providers=useApi('/api/account/providers',providersSchema);
  const action=useAction();const [confirm,setConfirm]=useState<string|null>(null);
  const enabled=(id:string)=>providers.data?.providers.find(p=>p.id===id)?.enabled===true;
  const hasEmail=methods.data?.methods.some(m=>m.provider==='credential');
  return <><div className="account-heading"><div><span className="eyebrow">내 계정</span><h1>로그인 방법과 기기</h1><p>{name}님의 계정을 한곳에서 관리해요.</p></div><span className="account-symbol"><Icon name="shield"/></span></div>
    <FormNotice error={action.error} message={action.message}/>
    <section className="account-overview"><span className="badge green">계정 로그인 완료</span><p>{email||'연락받을 이메일을 연결해 주세요.'}{email&&!emailVerified&&' · 이메일 확인 필요'}</p><small>아이 정보는 보호자 확인·동의·가족 연결 후 사용할 수 있어요. 가족 등록은 다음 단계에서 준비합니다.</small></section>
    <div className="account-grid"><section className="account-card"><h2><Icon name="shield"/>로그인 방법</h2><p>다른 방법을 추가하면 계정을 더 쉽게 찾을 수 있어요.</p>
      <Resource loading={methods.loading} error={methods.error} retry={methods.retry}>{methods.data?.methods.map(m=><div className="account-row" key={m.id}><strong>{methodNames[m.provider]||'연결된 계정'}</strong><button className="button compact" disabled={action.busy} onClick={()=>{if(confirm!==m.id){setConfirm(m.id);return;}void action.run(async()=>{await authPost('/api/account/unlink',{accountId:m.id});setConfirm(null);methods.retry();sessions.retry();action.setMessage('연결을 해제하고 다른 기기를 로그아웃했어요.');});}}>{confirm===m.id?'연결 해제 확인':'해제'}</button></div>)}</Resource>
      <p className="account-caption">연결·해제 전 5분 이내의 본인 확인이 필요해요.</p><Link className="button quiet full" to="/account/reauth">본인 인증 다시 하기 <Icon name="arrow"/></Link>
      <div className="add-methods"><h3>로그인 방법 추가</h3>{!hasEmail&&<Link className="button full" to="/account/email">이메일 · 비밀번호 연결</Link>}{providers.data?.providers.filter(p=>['google','kakao','naver'].includes(p.id)).map(p=><button key={p.id} className="button full" disabled={!p.enabled||action.busy||methods.data?.methods.some(m=>m.provider===p.id)} onClick={()=>action.run(()=>startSocial(p.id,true))}>{p.name} 연결{!p.enabled?' · 준비 중':''}</button>)}
        {enabled('phone')?<Link className="button full" to="/phone?link=1">휴대폰 연결</Link>:<button className="button full" disabled>휴대폰 연결 · 준비 중</button>}
      </div>{hasEmail&&<Link className="auth-back" to="/forgot-password">비밀번호 재설정</Link>}
    </section><section className="account-card"><h2><Icon name="phone"/>로그인한 기기</h2><p>낯선 기기가 있다면 바로 로그아웃해 주세요.</p><Resource loading={sessions.loading} error={sessions.error} retry={sessions.retry}>{sessions.data?.sessions.map(s=><div className="session-row" key={s.id}><div><strong>{s.device}</strong>{s.current&&<span className="badge green">현재 기기</span>}<small>최근 사용 {new Date(s.lastSeenAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</small></div><button className="button compact" disabled={action.busy} onClick={()=>action.run(async()=>{await authPost('/api/account/logout',{sessionId:s.id});if(s.current)window.location.assign('/login');else sessions.retry();})}>로그아웃</button></div>)}</Resource><button className="button full" disabled={action.busy} onClick={()=>action.run(async()=>{await authPost('/api/account/logout',{sessionId:'all'});window.location.assign('/login');})}>모든 기기에서 로그아웃</button></section></div>
  </>;
}
function Resource({loading,error,retry,children}:{loading:boolean;error?:string;retry:()=>void;children:ReactNode}){return loading?<Loading label="불러오고 있어요"/>:error?<ErrorState message={error} retry={retry}/>:<>{children}</>;}

export function ReauthPage(){
  const action=useAction();
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const password=String(new FormData(event.currentTarget).get('password'));await action.run(async()=>{await authPost('/api/account/reauthenticate',{password});window.location.assign('/account');});}
  return <AuthLayout><div className="auth-title"><span className="eyebrow">계정 보호</span><h2>본인 인증 다시 하기</h2><p>현재 계정에 연결한 비밀번호를 입력해 주세요.</p></div><FormNotice error={action.error}/><form className="auth-form" onSubmit={submit}><fieldset disabled={action.busy}><legend className="sr-only">본인 확인</legend><PasswordField/><button className="button primary full">확인하고 계속하기</button></fieldset></form><p className="auth-help">소셜 계정만 사용한다면 연결한 소셜 계정으로 다시 로그인해 주세요.</p><Link className="button full" to="/login">다른 로그인 방법으로 확인</Link><Link className="auth-back" to="/account">계정으로 돌아가기 <Icon name="arrow"/></Link></AuthLayout>;
}
export function EmailLinkPage(){
  const {search}=useLocation();const [token]=useState(()=>new URLSearchParams(search).get('token')||'');const action=useAction();
  useEffect(()=>{if(token)window.history.replaceState(null,'','/account/email');},[token]);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);await action.run(async()=>{await authPost('/api/account/email/start',{email:String(form.get('email')),password:String(form.get('password'))});action.setMessage('같은 브라우저에서 5분 안에 인증 메일을 열어 연결을 확인해 주세요.');});}
  return <AuthLayout><div className="auth-title"><span className="eyebrow">로그인 방법 추가</span><h2>이메일로도 이어가세요</h2><p>확인된 이메일을 로그인과 계정 복구에 사용해요.</p></div><FormNotice error={action.error} message={action.message}/>{token?<button className="button primary full" disabled={action.busy} onClick={()=>action.run(async()=>{await authPost('/api/account/email/confirm',{token});window.location.assign('/account');})}>이 이메일을 계정에 연결</button>:<form className="auth-form" onSubmit={submit}><fieldset disabled={action.busy}><legend className="sr-only">이메일 연결</legend><div className="form-field"><label htmlFor="email">연결할 이메일</label><input id="email" name="email" type="email" autoComplete="email" required maxLength={254}/></div><PasswordField fresh/><button className="button primary full">인증 메일 보내기</button></fieldset></form>}<Link className="auth-back" to="/account/reauth">먼저 본인 인증하기 <Icon name="arrow"/></Link><Link className="auth-back" to="/account">계정으로 돌아가기</Link></AuthLayout>;
}
