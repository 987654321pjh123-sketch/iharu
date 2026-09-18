import {useState,useEffect} from 'react';
import {Link,Navigate} from 'react-router-dom';
import {AuthLayout,FormNotice} from '../components/AuthLayout';
import {Icon} from '../components/Icon';
import {Loading} from '../components/Common';
import {useApi} from '../api';
import {childSessionSchema} from '../../../shared/family';
import {familyRequest} from '../family';
type Pairing={id:string;code:string;expiresAt:string;serverNow:string;exchangeKey:string};
export function DeviceConnectPage(){
 const [pair,setPair]=useState<Pairing|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[connected,setConnected]=useState(false),[remaining,setRemaining]=useState(600);
 useEffect(()=>{if(!pair)return;const offset=Date.now()-Date.parse(pair.serverNow);const update=()=>setRemaining(Math.max(0,Math.ceil((Date.parse(pair.expiresAt)-(Date.now()-offset))/1000)));update();const timer=setInterval(update,1000);return()=>clearInterval(timer);},[pair]);
 async function act(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function start(){await act(async()=>{const p=await familyRequest<Omit<Pairing,'exchangeKey'>>('/api/v1/device-pairings',{label:'아이 기기'});setPair({...p,exchangeKey:crypto.randomUUID()});});}
 async function check(){if(!pair)return;await act(async()=>{const status=await familyRequest<{status:string}>(`/api/v1/device-pairings/${pair.id}/status`,{});if(['APPROVED','EXCHANGED'].includes(status.status)){await familyRequest(`/api/v1/device-pairings/${pair.id}/exchange`,{exchangeKey:pair.exchangeKey});setConnected(true);}else if(status.status==='WAITING')setMessage('보호자가 아직 확인하고 있어요. 잠깐만 기다려 주세요.');else{setRemaining(0);setMessage('번호가 만료됐어요. 새 번호를 받아 주세요.');}});}
 if(connected)return <Navigate to="/child/connected" replace/>;
 return <AuthLayout wide><div className="device-connect"><Link className="auth-back" to="/login">보호자 로그인</Link><span className="device-hero"><Icon name="device"/></span><span className="eyebrow">내 기기로 시작해요</span><h1>{pair?'이 번호를 보여 주세요':'가족과 연결해 볼까요?'}</h1><p>{pair?'보호자가 가족 화면에서 번호를 확인해 줄 거예요.':'보호자가 로그인하지 않은 아이 기기에서 시작해 주세요.'}</p><FormNotice error={error} message={message}/>{pair?<><div className="pairing-code" role="status" aria-label={`연결 번호 ${pair.code.split('').join(' ')}`}>{pair.code.slice(0,3)} <span>{pair.code.slice(3)}</span></div><p className="pairing-time">{remaining>0?`${Math.floor(remaining/60)}분 ${String(remaining%60).padStart(2,'0')}초 안에 연결해 주세요`:'사용 시간이 끝났어요'}</p><button className="button primary full child-cta" disabled={busy||remaining<=0} onClick={check}><Icon name="check"/>보호자 확인이 끝났어요</button><button className="button full child-cta" disabled={busy} onClick={start}>새 번호 받기 <Icon name="repeat"/></button><p className="account-caption">새 번호를 받으면 이전 번호는 사용할 수 없어요.<br/>이 화면을 닫지 말고 보호자의 확인을 기다려 주세요.</p></>:<><div className="device-steps"><span><Icon name="device"/>번호 받기</span><Icon name="arrow"/><span><Icon name="shield"/>보호자 확인</span></div><button className="button primary full child-cta" disabled={busy} onClick={start}>연결 번호 받기 <Icon name="arrow"/></button><Link className="button full" to="/child/connected">이미 연결한 기기로 들어가기</Link></>}</div></AuthLayout>;
}
export function ConnectedChildPage(){
 const session=useApi('/api/v1/child-session',childSessionSchema),[error,setError]=useState('');
 useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')session.retry();};document.addEventListener('visibilitychange',refresh);return()=>document.removeEventListener('visibilitychange',refresh);},[session.retry]);
 if(session.loading)return <AuthLayout wide><Loading label="내 기기를 확인하고 있어요"/></AuthLayout>;
 if(session.error)return <AuthLayout wide><div className="device-connect"><span className="device-hero"><Icon name="device"/></span><h1>연결을 확인해 주세요</h1><p>보호자에게 기기 연결 상태를 확인해 달라고 해 주세요.</p><button className="button primary full child-cta" onClick={session.retry}>다시 확인하기</button><Link className="button full child-cta" to="/device/connect">기기 연결하기</Link></div></AuthLayout>;
 return <AuthLayout wide><div className="device-connect"><span className="device-hero"><Icon name="sun"/></span><span className="badge green">가족 연결 완료</span><h1>{session.data?.nickname}, 반가워요</h1><p>이제 이 기기가 가족과 연결됐어요.<br/>오늘 일정을 확인해 보세요.</p><div className="child-ready-grid"><div><Icon name="chat"/><strong>가족에게 말하기</strong><small>곧 만나요</small></div><Link className="button child-cta" to="/child/schedules"><Icon name="calendar"/><strong>내 일정 보기</strong></Link></div><FormNotice error={error}/><button className="button full" onClick={async()=>{try{await familyRequest('/api/v1/child-session/logout',{});window.location.assign('/device/connect');}catch(e){setError((e as Error).message);}}}>이 기기 연결 끝내기</button></div></AuthLayout>;
}
