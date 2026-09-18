import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApi } from '../api';
import { providersSchema, authPost, startSocial } from '../auth';
import { AuthLayout, FormNotice, PasswordField } from '../components/AuthLayout';
import { Loading, ErrorState } from '../components/Common';
import { Icon } from '../components/Icon';

export function LoginPage() {
  const { pathname, search } = useLocation(); const navigate = useNavigate();
  const providers = useApi('/api/account/providers',providersSchema);
  const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const [message,setMessage] = useState('');
  const [token] = useState(() => new URLSearchParams(search).get('token') || '');
  useEffect(()=>{ if (token) window.history.replaceState(null,'',pathname); },[token,pathname]);
  const mode = pathname === '/signup' ? 'signup' : pathname === '/forgot-password' ? 'forgot' : pathname === '/verify-email' ? 'verify' : pathname === '/reset-password' ? 'reset' : 'login';
  const titles = { login:'다시 만나 반가워요', signup:'아이하루 시작하기', forgot:'비밀번호를 잊으셨나요?', verify:'이메일을 확인해 주세요', reset:'새 비밀번호 설정' };
  const subtitles = { login:'로그인하고 가족의 하루를 이어 보세요.', signup:'이메일 확인부터 차근차근 시작해요.', forgot:'가입한 이메일로 재설정 링크를 보내드려요.', verify:'인증 메일이 보이지 않으면 다시 요청할 수 있어요.', reset:'앞으로 사용할 비밀번호를 입력해 주세요.' };
  const enabled = providers.data?.providers.find(p=>p.id==='email')?.enabled === true;
  const waiting = providers.data?.providers.every(p=>!p.enabled) === true;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true);setError('');setMessage('');
    try {
      const email = String(form.get('email') || '').trim(); const password = String(form.get('password') || '');
      if (mode === 'login') { await authPost('/api/auth/sign-in/email',{email,password}); navigate('/account'); }
      if (mode === 'signup') { await authPost('/api/auth/sign-up/email',{email,password,name:String(form.get('name')).trim(),callbackURL:'/login?verified=1'});setMessage('가입을 진행할 수 있는 이메일이면 인증 메일이 도착해요. 메일함과 스팸함을 확인해 주세요.'); }
      if (mode === 'forgot') { await authPost('/api/auth/request-password-reset',{email,redirectTo:'/reset-password'});setMessage('일치하는 이메일 계정이 있으면 재설정 링크를 보내드려요. 메일함을 확인해 주세요.'); }
      if (mode === 'verify') { await authPost('/api/auth/send-verification-email',{email,callbackURL:'/login?verified=1'});setMessage('인증이 필요한 계정이면 메일을 보내드려요. 메일함과 스팸함을 확인해 주세요.'); }
      if (mode === 'reset') { await authPost('/api/auth/reset-password',{token,newPassword:password});setMessage('비밀번호가 바뀌었어요. 모든 기기에서 로그아웃했으니 새 비밀번호로 로그인해 주세요.'); }
    } catch (e) {setError(e instanceof Error?e.message:'연결을 확인해 주세요.');} finally {setBusy(false);}
  }
  async function social(id:string) { setBusy(true);setError('');try {await startSocial(id);}catch(e){setError((e as Error).message);setBusy(false);} }
  return <AuthLayout><div className="auth-title"><span className="eyebrow">보호자 계정</span><h2>{titles[mode]}</h2><p>{subtitles[mode]}</p></div>
    {mode==='login'&&<nav className="auth-tabs" aria-label="계정 시작"><Link to="/login" aria-current="page">로그인</Link><Link to="/signup">회원가입</Link></nav>}
    {providers.loading?<Loading label="로그인 방법을 확인하고 있어요"/>:providers.error?<ErrorState message={providers.error} retry={providers.retry}/>:<>
      {waiting&&<div className="auth-notice setup-notice"><Icon name="clock"/><div><strong>로그인 연결을 준비하고 있어요</strong><p>준비가 끝나면 여기서 가족의 하루를 시작할 수 있어요.</p></div></div>}
      {mode==='login'&&new URLSearchParams(search).has('verified')&&<FormNotice message="이메일 확인을 마쳤어요. 로그인해 주세요."/>}
      {mode==='login'&&new URLSearchParams(search).has('error')&&<FormNotice error="로그인을 마치지 못했어요. 기존에 사용한 방법으로 다시 로그인해 주세요."/>}
      <FormNotice error={error} message={message}/>
      {mode==='reset'&&!token?<div className="auth-notice">재설정 메일의 링크를 다시 열어 주세요.</div>:<form onSubmit={submit} className="auth-form">
        <fieldset disabled={busy||!enabled}><legend className="sr-only">{titles[mode]}</legend>
          {mode==='signup'&&<div className="form-field"><label htmlFor="name">이름</label><input id="name" name="name" required minLength={2} maxLength={30} autoComplete="name" placeholder="이름을 입력해 주세요"/></div>}
          {mode!=='reset'&&<div className="form-field"><label htmlFor="email">이메일</label><input id="email" name="email" required type="email" maxLength={254} autoComplete="email" placeholder="hello@example.com" autoCapitalize="none" spellCheck={false}/></div>}
          {['login','signup','reset'].includes(mode)&&<PasswordField fresh={mode!=='login'}/>}
          {mode==='login'&&<div className="form-links"><Link to="/verify-email">이메일 인증 안내</Link><Link to="/forgot-password">비밀번호 찾기</Link></div>}
          <button className="button primary full" type="submit">{busy?'잠시만 기다려 주세요':!enabled?'이메일 로그인 준비 중':mode==='login'?'로그인':mode==='signup'?'인증 메일 보내기':mode==='reset'?'새 비밀번호 저장':'링크 다시 받기'}</button>
        </fieldset>
      </form>}
      {mode==='login'?<><div className="auth-divider"><span>다른 방법으로 이어가기</span></div><div className="social-buttons">{providers.data?.providers.filter(p=>['google','kakao','naver'].includes(p.id)).map(p=><button key={p.id} className={`button social-${p.id}`} disabled={!p.enabled||busy} onClick={()=>social(p.id)}>{p.name}로 계속하기{!p.enabled&&<span className="provider-state">준비 중</span>}</button>)}</div><Link className="button full phone-login" to="/phone"><Icon name="phone"/>휴대폰 번호로 로그인</Link><p className="auth-help">아이 기기 연결은 보호자의 가족 등록 후 진행해요.</p></>:<Link className="auth-back" to="/login">로그인으로 돌아가기 <Icon name="arrow"/></Link>}
    </>}
  </AuthLayout>;
}

export function PhonePage() {
  const providers = useApi('/api/account/providers',providersSchema); const navigate=useNavigate();
  const link = new URLSearchParams(useLocation().search).get('link') === '1';
  const [phone,setPhone]=useState('');const [code,setCode]=useState('');const [sent,setSent]=useState(false);const [seconds,setSeconds]=useState(0);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const enabled=providers.data?.providers.find(p=>p.id==='phone')?.enabled===true;
  useEffect(()=>{if(seconds<=0)return; const timer=window.setTimeout(()=>setSeconds(s=>s-1),1000);return()=>clearTimeout(timer);},[seconds]);
  async function send(){setBusy(true);setError('');try{await authPost('/api/auth/phone-number/send-otp',{phoneNumber:phone});setSent(true);setSeconds(60);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function verify(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{await authPost('/api/auth/phone-number/verify',{phoneNumber:phone,code,...(link?{updatePhoneNumber:true}:{})});navigate('/account');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <AuthLayout><div className="auth-title"><span className="eyebrow">휴대폰 인증</span><h2>{link?'휴대폰 연결하기':'번호로 간편하게 시작해요'}</h2><p>휴대폰 번호 확인 후, 보호자 본인확인을 별도로 진행해요.</p></div><FormNotice error={error}/>
    {providers.error?<ErrorState message={providers.error} retry={providers.retry}/>:providers.loading?<Loading label="휴대폰 인증을 확인하고 있어요"/>:<>
      {!enabled&&<FormNotice message="휴대폰 인증은 준비 중이에요. 다른 로그인 방법을 이용해 주세요."/>}
      <form className="auth-form" onSubmit={verify}><fieldset disabled={!enabled||busy}><legend className="sr-only">휴대폰 인증</legend><div className="form-field"><label htmlFor="phone">휴대폰 번호</label><input id="phone" autoComplete="tel" type="tel" inputMode="tel" required value={phone} onChange={e=>{setPhone(e.target.value);setSent(false);setCode('');}} placeholder="010 1234 5678" maxLength={18}/></div><button className="button full" type="button" disabled={seconds>0||!phone} onClick={send}>{seconds>0?`${seconds}초 후 다시 받기`:sent?'인증번호 다시 받기':'인증번호 받기'}</button>
        {sent&&<><div className="form-field"><label htmlFor="otp">문자로 받은 인증번호</label><input id="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} aria-describedby="otp-hint"/><small id="otp-hint">3분 안에 입력해 주세요. 5회 틀리면 새 번호가 필요해요.</small></div><button className="button primary full" type="submit">인증하고 계속하기</button></>}
      </fieldset></form></>}
    <Link className="auth-back" to={link?'/account':'/login'}>{link?'계정 설정으로':'다른 방법으로 로그인'} <Icon name="arrow"/></Link>
  </AuthLayout>;
}
