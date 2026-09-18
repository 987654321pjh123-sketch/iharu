import { useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { envelope, healthSchema, type ChildFilter } from '../../shared/contracts';
import { useApi } from './api';
import { copy } from './copy';
import { Icon, type IconName } from './components/Icon';
import { PreviewDialog, ErrorState, Loading } from './components/Common';
import { Guardian } from './pages/Guardian';
import { ChildHome } from './pages/ChildHome';
import { Upcoming } from './pages/Upcoming';
const healthResponse=envelope(healthSchema);
const guardianNav: {to:string;label:string;icon:IconName}[]=[{to:'/today',label:'오늘',icon:'home'},{to:'/location',label:'아이 위치',icon:'pin'},{to:'/chat',label:'가족 대화',icon:'chat'},{to:'/records',label:'기록',icon:'book'}];
const childNav:typeof guardianNav=[{to:'/child',label:'내 하루',icon:'home'},{to:'/child/chat',label:'가족 대화',icon:'chat'}];
function Shell() {
  const {pathname}=useLocation(); const isChild=pathname.startsWith('/child');
  const [child,setChild]=useState<ChildFilter>('all');
  const [dialog,setDialog]=useState<string|null>(null);
  const [large,setLarge]=useState(()=>{try{return localStorage.getItem('iharu:large-type')==='true';}catch{return false;}});
  const health=useApi('/api/health',healthResponse);
  useEffect(()=>{ document.documentElement.classList.toggle('large-type',large); try{localStorage.setItem('iharu:large-type',String(large));}catch{/* Preference can remain in memory. */} },[large]);
  useEffect(()=> { document.title=`${isChild?'내 하루':'가족의 하루'} · 아이하루`; window.scrollTo(0,0); document.getElementById('main')?.focus({preventScroll:true}); },[pathname,isChild]);
  const demo=health.data?.data.demoEnabled===true;
  const nav=isChild?childNav:guardianNav;
  const todayActive=['/today','/calendar','/tuition','/repeats'].includes(pathname);
  function navigation(className:string) { return <nav className={className} aria-label={className==='bottom-nav'?'모바일 주 메뉴':'주 메뉴'}>{nav.map(item=><NavLink key={item.to} end to={item.to} className={()=>((item.to==='/today'?todayActive:pathname===item.to)?'active':'')} aria-current={(item.to==='/today'?todayActive:pathname===item.to)?'page':undefined}><Icon name={item.icon}/><span>{item.label}</span></NavLink>)}</nav>; }
  return <div className={`app ${isChild?'child-mode':''}`}>
    <a className="skip-link" href="#main">본문 바로가기</a>
    {!isChild && <aside className="sidebar"><Link to="/today" className="brand"><span className="brandmark"><Icon name="sun"/></span>{copy.brand}</Link><p className="tagline">{copy.tagline}</p><p className="sidebar-caption">우리 가족</p>{navigation('side-nav')}<div className="sidebar-bottom"><Link to="/settings"><Icon name="settings"/>설정</Link><div className="family-profile"><span className="avatar mint">가</span><span><strong>우리 가족</strong><small>가상 가족 · 미리보기</small></span></div></div></aside>}
    <div className="app-content"><header className="topbar">{isChild?<Link to="/child" className="brand"><span className="brandmark"><Icon name="sun"/></span>{copy.brand}</Link>:<><Link className="brand mobile-brand" to="/today"><span className="brandmark"><Icon name="sun"/></span>{copy.brand}</Link><span className="desktop-context">가족의 하루를 잇다</span></>}
      <div className="top-actions"><button className="font-toggle" aria-pressed={large} onClick={()=>setLarge(v=>!v)}><Icon name="type"/><span>큰 글씨</span></button>{!isChild&&<><Link className="icon-button" to="/notifications" aria-label="알림함"><Icon name="bell"/></Link><Link className="profile-button" to="/settings" aria-label="가족 설정">가</Link></>}</div></header>
      {demo && <div className="demo-bar"><span><span className="demo-dot"/>{copy.demo}</span><div className="preview-toggle" aria-label="미리보기 화면 선택"><Link to="/today" aria-current={!isChild?'page':undefined}>보호자 화면</Link><Link to="/child" aria-current={isChild?'page':undefined}>아이 화면</Link></div></div>}
      <main id="main" tabIndex={-1} className="main">
        {health.loading?<Loading label="아이하루를 열고 있어요"/>:health.error?<ErrorState message="서버 연결을 확인하고 다시 시도해 주세요." retry={health.retry}/>:!demo?<div className="upcoming-page"><span className="upcoming-icon"><Icon name="sun"/></span><h1>아이하루를 준비하고 있어요</h1><p>가족과 함께할 하루를 곧 만나 보세요.</p></div>:<Routes>
          <Route path="/" element={<Navigate to="/today" replace/>}/>
          {['/today','/calendar','/tuition'].map(path=><Route key={path} path={path} element={<Guardian child={child} setChild={setChild} onPreview={setDialog}/>}/>)}
          <Route path="/child" element={<ChildHome onPreview={setDialog}/>}/><Route path="*" element={<Upcoming/>}/>
        </Routes>}
      </main><footer className="page-footer">아이하루 · 가족의 하루를 잇다<span>화면 미리보기 · 실제 전송 및 저장 없음</span></footer>
    </div>{demo&&navigation('bottom-nav')}{dialog&&<PreviewDialog title={dialog} onClose={()=>setDialog(null)}/>}
  </div>;
}
export default function App(){return <BrowserRouter><Shell/></BrowserRouter>;}
