import {useEffect,useState,type ReactNode} from 'react';
import {Link,NavLink,Navigate,useSearchParams} from 'react-router-dom';
import {useApi} from '../api';
import {sessionSchema} from '../auth';
import {familiesSchema,childSessionSchema,type Family} from '../../../shared/family';
import {calendarResponse,seriesResponse,scheduleChildrenResponse,koreaToday,addDays,type Occurrence,type ScheduleSeries,type CalendarData} from '../../../shared/schedules';
import {Icon,type IconName} from '../components/Icon';
import {Loading,ErrorState} from '../components/Common';
import {AuthLayout,FormNotice} from '../components/AuthLayout';
import {NewScheduleDialog,EditScheduleDialog,ClosureDialog,weekLabels} from '../components/ScheduleForms';
import {scheduleRequest,useScheduleAction} from '../schedules';

function ScheduleLayout({children,mode}:{children:ReactNode;mode:'calendar'|'repeats'}){
 const [large,setLarge]=useState(()=>{try{return localStorage.getItem('iharu:large-type')==='true';}catch{return false;}});
 useEffect(()=>{document.documentElement.classList.toggle('large-type',large);try{localStorage.setItem('iharu:large-type',String(large));}catch{/* preference only */}},[large]);
 useEffect(()=>{document.title=`${mode==='calendar'?'우리 가족 달력':'반복 일정'} · 아이하루`;document.getElementById('schedule-main')?.focus();},[mode]);
 const nav:[string,string,IconName][]=[['/today/calendar','오늘','home'],['/location','아이 위치','pin'],['/chat','가족 대화','chat'],['/records','기록','book']];
 const links=(className:string)=><nav className={className} aria-label={className==='bottom-nav'?'모바일 주 메뉴':'주 메뉴'}>{nav.map(([url,label,icon],i)=><Link className={i===0?'active':''} aria-current={i===0?'page':undefined} key={url} to={url}><Icon name={icon}/><span>{label}</span></Link>)}</nav>;
 return <div className="app schedule-app"><a className="skip-link" href="#schedule-main">본문 바로가기</a><aside className="sidebar"><Link to="/today/calendar" className="brand"><span className="brandmark"><Icon name="sun"/></span>아이하루</Link><p className="tagline">가족의 하루를 잇다</p><p className="sidebar-caption">우리 가족</p>{links('side-nav')}<div className="sidebar-bottom"><Link to="/family"><Icon name="home"/>가족과 아이 관리</Link><Link to="/account"><Icon name="settings"/>내 계정</Link></div></aside><div className="app-content"><header className="topbar"><Link to="/today/calendar" className="brand mobile-brand">아이하루</Link><span className="desktop-context">가족의 하루를 잇다</span><div className="top-actions"><button className="font-toggle" aria-pressed={large} onClick={()=>setLarge(v=>!v)}><Icon name="type"/><span>큰 글씨</span></button><Link className="icon-button" to="/family" aria-label="가족과 아이 관리"><Icon name="home"/></Link></div></header><main id="schedule-main" className="main" tabIndex={-1}><nav className="schedule-subnav" aria-label="오늘 하위 메뉴"><Link to="/today">한눈에</Link><NavLink to="/today/calendar">월간 일정</NavLink><Link to="/tuition">학원비</Link><NavLink to="/today/repeats">반복 일정</NavLink></nav>{children}</main><footer className="page-footer">아이하루 · 가족의 하루를 잇다<span>일정 기준 · 한국 시간</span></footer></div>{links('bottom-nav')}</div>;
}
export function SchedulePage({mode='calendar'}:{mode?:'calendar'|'repeats'}){
 const session=useApi('/api/account/session',sessionSchema);
 if(session.loading)return <AuthLayout wide><Loading label="계정을 확인하고 있어요"/></AuthLayout>;
 if(session.error)return <AuthLayout wide><ErrorState message={session.error} retry={session.retry}/></AuthLayout>;
 if(!session.data?.authenticated)return <Navigate to="/login" replace/>;
 if(session.data.assurance==='LOW')return <Navigate to="/account" replace/>;
 return <ScheduleLayout mode={mode}><ScheduleWorkspace mode={mode}/></ScheduleLayout>;
}
function ScheduleWorkspace({mode}:{mode:'calendar'|'repeats'}){
 const families=useApi('/api/v1/me',familiesSchema);const [search,setSearch]=useSearchParams();
 const selected=families.data?.families.find(f=>f.id===search.get('family'))||families.data?.families[0];
 return <><div className="schedule-heading"><div><span className="eyebrow">{mode==='calendar'?'반복 일정과 공휴일을 함께':'매주 이어지는 우리 가족의 일정'}</span><h1>{mode==='calendar'?'우리 가족 달력':'반복 일정을 한곳에'}</h1><p>{mode==='calendar'?'날짜를 고르고, 그날의 일정을 차분히 확인하세요.':'학교·학원 시간과 휴무 기간을 함께 관리하세요.'}</p></div><span className="schedule-heading-icon" aria-hidden="true"><Icon name="calendar"/></span></div>
 {families.loading?<Loading/>:families.error?<><ErrorState message={families.error} retry={families.retry}/><Link className="button" to="/family">가족 연결 확인</Link></>:!selected?<section className="card schedule-empty"><Icon name="home"/><h2>함께할 가족을 먼저 연결해 주세요</h2><p>승인된 아이의 일정만 이곳에 표시돼요.</p><Link className="button primary" to="/family">우리 가족 연결</Link></section>:<>
 <div className="schedule-family"><label htmlFor="schedule-family-choice">가족</label><select id="schedule-family-choice" value={selected.id} onChange={e=>setSearch({family:e.target.value})}>{families.data!.families.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
 <FamilySchedules key={`${selected.id}:${mode}`} family={selected} mode={mode}/></>}</>;
}
function FamilySchedules({family,mode}:{family:Family;mode:'calendar'|'repeats'}){
 const children=useApi(`/api/v1/families/${family.id}/schedule-children`,scheduleChildrenResponse);
 const [search,setSearch]=useSearchParams();const selected=search.get('child')||'';const child=children.data?.children.some(c=>c.id===selected)?selected:'';
 const today=children.data?.serverToday||koreaToday();const [revision,setRevision]=useState(0);
 const [create,setCreate]=useState<{date:string;makeup?:Occurrence}|null>(null),[edit,setEdit]=useState<Occurrence|null>(null),[closure,setClosure]=useState<ScheduleSeries|null>(null),[notice,setNotice]=useState('');
 const saved=()=>{setCreate(null);setEdit(null);setClosure(null);setRevision(v=>v+1);setNotice('일정을 저장했어요.');};
 if(children.loading)return <Loading label="일정을 공유받은 아이를 확인하고 있어요"/>;
 if(children.error)return <ErrorState message={children.error} retry={children.retry}/>;
 if(!children.data?.children.length)return <section className="card schedule-empty"><Icon name="calendar"/><h2>일정을 공유받은 아이가 없어요</h2><p>아이의 보호자에게 일정 공유를 요청하거나 가족 연결을 확인해 주세요.</p><Link className="button primary" to="/family">공유 범위 확인</Link></section>;
 return <><div className="schedule-filterbar"><div className="schedule-child-filter"><label htmlFor="schedule-child-choice">아이</label><select id="schedule-child-choice" value={child} onChange={e=>{setSearch({family:family.id,...(e.target.value?{child:e.target.value}:{})});setNotice('');}}><option value="">모든 아이</option>{children.data.children.map(c=><option key={c.id} value={c.id}>{c.nickname}</option>)}</select></div><button className="button primary" onClick={()=>setCreate({date:today})}><Icon name="plus"/>일정 추가</button></div><FormNotice message={notice}/>
 {mode==='calendar'?<CalendarPanel key={`${child}:${revision}`} familyId={family.id} childId={child} today={today} initialDay={search.get('day')||today} edit={setEdit} create={(date,makeup)=>setCreate({date,makeup})} changed={()=>setRevision(v=>v+1)}/>:<RepeatsPanel key={`${child}:${revision}`} familyId={family.id} childId={child} today={today} closeDates={setClosure} changed={()=>setRevision(v=>v+1)}/>}
 {create&&<NewScheduleDialog childrenOptions={children.data.children} childId={child} today={today} date={create.date} makeup={create.makeup} close={()=>setCreate(null)} saved={saved}/>}
 {edit&&<EditScheduleDialog item={edit} close={()=>setEdit(null)} saved={saved}/>}{closure&&<ClosureDialog series={closure} today={today} close={()=>setClosure(null)} saved={saved}/>}
 </>;
}

function CalendarPanel({familyId,childId,today,initialDay,edit,create,changed}:{familyId:string;childId:string;today:string;initialDay:string;edit:(o:Occurrence)=>void;create:(date:string,makeup?:Occurrence)=>void;changed:()=>void}){
 const min=addDays(today,-90),max=addDays(today,55),initial=/^\d{4}-\d{2}-\d{2}$/.test(initialDay)&&initialDay>=min&&initialDay<=max?initialDay:today;
 const [,setSearch]=useSearchParams();
 const [month,setMonth]=useState(initial.slice(0,7)),[day,setDay]=useState(initial);const [year,m]=month.split('-').map(Number),count=new Date(Date.UTC(year,m,0)).getUTCDate(),first=new Date(`${month}-01T00:00:00Z`).getUTCDay();
 const from=month+'-01'>min?month+'-01':min,to=month+`-${count}`<max?month+`-${count}`:max;
 const url=`/api/v1/families/${familyId}/calendar?${new URLSearchParams({from,to,...(childId?{childId}:{})})}`;
 function select(date:string,focus=false){if(date<min||date>max)return;setDay(date);setMonth(date.slice(0,7));setSearch(old=>{const next=new URLSearchParams(old);next.set('day',date);return next;},{replace:true});if(focus)requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`[data-schedule-date="${date}"]`)?.focus());}
 function moveMonth(delta:number){const date=new Date(Date.UTC(year,m-1+delta,1)).toISOString().slice(0,10);select(date<min?min:date>max?max:date);}
 return <CalendarContents key={url} url={url} month={month} day={day} today={today} min={min} max={max} count={count} first={first} select={select} moveMonth={moveMonth} edit={edit} create={create} changed={changed}/>;
}
const statusLabels={SCHEDULED:'정상 진행',NEEDS_CONFIRMATION:'확인 필요',SKIPPED:'휴강',CANCELLED:'취소'};
function CalendarContents({url,month,day,today,min,max,count,first,select,moveMonth,edit,create,changed}:{url:string;month:string;day:string;today:string;min:string;max:string;count:number;first:number;select:(d:string,focus?:boolean)=>void;moveMonth:(n:number)=>void;edit:(o:Occurrence)=>void;create:(date:string,makeup?:Occurrence)=>void;changed:()=>void}){
 const data=useApi(url,calendarResponse),action=useScheduleAction();const [extra,setExtra]=useState<Occurrence[]>([]),[cursor,setCursor]=useState<string|null|undefined>();
 const items=[...(data.data?.occurrences||[]),...extra],next=cursor===undefined?data.data?.nextCursor:cursor;const selected=items.filter(o=>o.date===day);
 const holidayNames=data.data?.holidays.filter(h=>h.date===day).map(h=>h.name)||[];
 return <div className="schedule-calendar-layout"><section className="card schedule-calendar"><div className="calendar-toolbar"><h2>{Number(month.slice(0,4))}년 {Number(month.slice(5))}월</h2><div className="calendar-arrows"><button className="icon-button" aria-label="이전 달" disabled={month===min.slice(0,7)} onClick={()=>moveMonth(-1)}><Icon name="chevron" className="flip"/></button><button className="button quiet compact" onClick={()=>select(today)}>오늘</button><button className="icon-button" aria-label="다음 달" disabled={month===max.slice(0,7)} onClick={()=>moveMonth(1)}><Icon name="chevron"/></button></div></div>
 {data.loading?<Loading label="가족 일정을 불러오고 있어요"/>:data.error?<ErrorState message={data.error} retry={data.retry}/>:<><div className="calendar-grid" aria-label="달력 날짜 선택">{weekLabels.map(d=><span key={d} className="weekday">{d}</span>)}{Array.from({length:first},(_,i)=><span key={`empty-${i}`}/>)}{Array.from({length:count},(_,i)=>{
  const date=month+'-'+String(i+1).padStart(2,'0'),holiday=data.data?.holidays.filter(h=>h.date===date).map(h=>h.name).join(' · '),n=data.data?.dayCounts.find(d=>d.date===date)?.count||0;
  return <button key={date} data-schedule-date={date} disabled={date<min||date>max} tabIndex={date===day?0:-1} className={`calendar-day ${day===date?'selected':''} ${holiday?'holiday':''}`} aria-pressed={day===date} aria-label={`${date}${holiday?' '+holiday:''}, 일정 ${n}개`} onClick={()=>select(date)} onKeyDown={e=>{const delta:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};if(e.key in delta){e.preventDefault();select(addDays(date,delta[e.key]),true);}}}><span>{i+1}</span><small className="calendar-holiday-name">{holiday||''}</small><small className="calendar-count">{n?`${n}개`:''}</small></button>;
 })}</div><p className="account-caption">지난 90일부터 앞으로 56일까지 조회해요. 상세 일정은 선택 날짜에서 확인하세요.</p><HolidayNotice data={data.data!}/></>}
 </section><section className="card schedule-day"><div className="day-heading"><h2>{Number(day.slice(5,7))}월 {Number(day.slice(8))}일</h2><div><button className="icon-button" aria-label="이전 날짜" disabled={day<=min} onClick={()=>select(addDays(day,-1))}><Icon name="chevron" className="flip"/></button><button className="icon-button" aria-label="다음 날짜" disabled={day>=max} onClick={()=>select(addDays(day,1))}><Icon name="chevron"/></button></div></div>{holidayNames.length>0&&<p className="schedule-holiday-label">{holidayNames.join(' · ')}<small>기관 휴강 여부는 별도로 확인해 주세요.</small></p>}<FormNotice error={action.error}/>
 {!data.loading&&!data.error&&<>{selected.map(o=><OccurrenceCard key={o.id} item={o} busy={action.busy} edit={()=>edit(o)} makeup={()=>create(today,o)} decide={decision=>action.run(async keyFor=>{const body={decision,expectedVersion:o.resourceVersion};await scheduleRequest(`/api/v1/occurrences/${o.id}/holiday-decision`,body,'POST',keyFor({id:o.id,...body}));changed();})}/>)}{!selected.length&&<div className="schedule-empty"><Icon name="calendar"/><strong>{next?'불러온 일정에 이 날짜의 항목이 없어요':'이날 등록된 일정이 없어요'}</strong><p>{next?'아래에서 일정을 더 불러와 주세요.':'한 번의 일정도, 매주 반복되는 일정도 등록할 수 있어요.'}</p></div>}{next&&<button className="button full" disabled={action.busy} onClick={()=>action.run(async()=>{const r=calendarResponse.parse(await scheduleRequest(`${url}&cursor=${next}`));setExtra(old=>[...new Map([...old,...r.occurrences].map(o=>[o.id,o])).values()]);setCursor(r.nextCursor);})}>이달 일정 더 불러오기</button>}{day>=today&&<button className="button primary full" onClick={()=>create(day)}><Icon name="plus"/>이날 일정 추가</button>}</>}
 </section></div>;
}
function HolidayNotice({data}:{data:CalendarData}){return <div className="schedule-source">{data.holidayYears.map(h=><div key={h.year}><span className={`badge ${h.state==='READY'?'green':'amber'}`}>{h.year}년 공휴일 · {h.state==='READY'?'갱신됨':h.state==='STALE'?'갱신 확인 필요':'정보 미수집'}</span><p>{h.state==='READY'?'공휴일 표시는 휴강 확정을 뜻하지 않아요.':h.state==='STALE'?'마지막으로 받은 공휴일 정보를 표시하고 있어요. 진행 여부를 확인해 주세요.':'공휴일 정보를 아직 불러오지 못했어요. 일정을 확정하기 전에 확인해 주세요.'}</p>{h.lastSuccessAt&&<small>마지막 수집 {new Date(h.lastSuccessAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</small>}</div>)}</div>;}
function OccurrenceCard({item:o,busy,edit,makeup,decide}:{item:Occurrence;busy:boolean;edit?:()=>void;makeup?:()=>void;decide?:(d:'KEEP'|'SKIP')=>void}){return <article className={`schedule-occurrence ${o.status==='CANCELLED'?'cancelled':''}`}><div className="schedule-occurrence-top"><span className="schedule-time">{o.startTime}–{o.endTime}</span><span className={`badge ${o.status==='SCHEDULED'?'green':o.status==='NEEDS_CONFIRMATION'?'amber':'neutral'}`}>{statusLabels[o.status]}</span></div><small>{o.childName}{o.makeupForOccurrenceId?' · 보강':''}{o.override?' · 개별 확인·변경':''}</small><h3>{o.title}</h3>{o.place&&<p><Icon name="pin"/>{o.place}</p>}{o.reason&&<p className="account-caption">{o.reason}</p>}<div className="schedule-card-actions">{edit&&o.allowedActions.includes('EDIT')&&<button className="button compact" disabled={busy} onClick={edit}>일정 수정</button>}{decide&&o.status!=='CANCELLED'&&o.allowedActions.includes('DECIDE')&&<><button className={`button compact ${o.status==='NEEDS_CONFIRMATION'?'primary':''}`} disabled={busy} onClick={()=>decide('KEEP')}>정상 진행</button><button className="button compact" disabled={busy} onClick={()=>decide('SKIP')}>휴강</button></>}{makeup&&['CANCELLED','SKIPPED'].includes(o.status)&&o.allowedActions.includes('MAKEUP')&&<button className="button compact" disabled={busy} onClick={makeup}>보강 등록</button>}</div>{o.locked&&<small>지난·연결 기록 보존</small>}</article>;}

function RepeatsPanel({familyId,childId,today,closeDates,changed}:{familyId:string;childId:string;today:string;closeDates:(s:ScheduleSeries)=>void;changed:()=>void}){
 const path=`/api/v1/families/${familyId}/schedule-series${childId?'?childId='+childId:''}`;
 const data=useApi(path,seriesResponse),action=useScheduleAction();const [more,setMore]=useState<ScheduleSeries[]>([]),[cursor,setCursor]=useState<string|null|undefined>();
 const next=cursor===undefined?data.data?.nextCursor:cursor;const series=[...(data.data?.series||[]),...more];
 if(data.loading)return <Loading label="반복 일정을 불러오고 있어요"/>;
 if(data.error)return <ErrorState message={data.error} retry={data.retry}/>;
 return <><FormNotice error={action.error}/><div className="schedule-repeat-grid">{!series.length&&<section className="card schedule-empty"><Icon name="calendar"/><h2>등록된 일정이 없어요</h2><p>일정 추가에서 한 번 또는 매주 반복을 선택해 보세요.</p></section>}{series.map(s=>{
  const current=s.versions.find(v=>v.fromDate<=today&&v.untilDate>=today)||s.versions.find(v=>v.fromDate>today)||s.versions.at(-1)!;
  return <article className="card repeat-plan" key={s.id}><div className="card-title"><span className="badge green">{current.frequency==='WEEKLY'?'매주 반복':'한 번의 일정'}</span><small>{s.childName}</small></div><h2>{current.title}</h2><p>{current.place||'장소 미입력'}</p><strong className="repeat-time">{current.startTime}–{current.endTime}</strong><p>{current.frequency==='WEEKLY'?current.weekdays.map(d=>weekLabels[d]).join(' · '):current.fromDate}</p><p className="account-caption">{s.fromDate} ~ {s.untilDate}</p><span className="badge neutral">공휴일 {current.holidayPolicy==='ASK'?'확인 필요':current.holidayPolicy==='KEEP'?'정상 진행':'휴강'}</span><div className="schedule-card-actions"><Link className="button compact" to={`/today/calendar?family=${familyId}&child=${s.childId}&day=${s.fromDate<today?today:s.fromDate}`}>달력에서 수정</Link><button className="button compact" disabled={s.untilDate<today} onClick={()=>closeDates(s)}>휴강·방학 등록</button></div>
  <details className="repeat-versions"><summary>적용 기간과 변경 예약 · {s.versions.length}개</summary>{s.versions.map(v=><p key={v.fromDate}><strong>{v.fromDate} ~ {v.untilDate}</strong><br/>{v.title} · {v.startTime}–{v.endTime}<br/>{v.frequency==='WEEKLY'?v.weekdays.map(d=>weekLabels[d]).join(' · '):'한 번만'}</p>)}</details>
  {s.closures.map(c=><div className="schedule-closure" key={c.id}><div><strong>{c.kind==='VACATION'?'방학':'휴강'} · {c.reason}</strong><small>{c.from} ~ {c.to}</small></div><button className="button compact" disabled={action.busy} onClick={()=>{if(window.confirm('이 기관 휴무를 해제할까요? 지난 일정과 개별 확인은 유지돼요.'))void action.run(async keyFor=>{const body={expectedVersion:s.resourceVersion};await scheduleRequest(`/api/v1/schedule-series/${s.id}/closures/${c.id}`,body,'DELETE',keyFor({closure:c.id,...body}));changed();});}}>해제</button></div>)}
  </article>;
 })}</div>{next&&<button className="button full" disabled={action.busy} onClick={()=>action.run(async()=>{const r=seriesResponse.parse(await scheduleRequest(`${path}${childId?'&':'?'}cursor=${next}`));setMore(v=>[...v,...r.series]);setCursor(r.nextCursor);})}>일정 더 불러오기</button>}</>;
}
export function ChildSchedulePage(){
 const child=useApi('/api/v1/child-session',childSessionSchema);
 return <AuthLayout wide><nav className="family-nav"><Link to="/child/connected">내 하루</Link><Link to="/child/schedules" aria-current="page">내 일정</Link></nav><h1>오늘은 어떤 하루일까?</h1><p>학교와 학원 일정을 확인해 봐요.</p>{child.loading?<Loading/>:child.error?<><ErrorState message={child.error} retry={child.retry}/><Link className="button" to="/device/connect">기기 연결 확인</Link></>:child.data&&<ChildScheduleList childId={child.data.childId}/>}</AuthLayout>;
}
function ChildScheduleList({childId}:{childId:string}){
 const [day,setDay]=useState(koreaToday());const data=useApi(`/api/v1/children/${childId}/schedules?from=${day}&to=${day}`,calendarResponse);
 return <section className="child-schedule-list"><div className="calendar-toolbar"><button className="button" onClick={()=>setDay(addDays(day,-1))} disabled={day<=addDays(koreaToday(),-7)}>이전 날</button><strong>{Number(day.slice(5,7))}월 {Number(day.slice(8))}일</strong><button className="button" onClick={()=>setDay(addDays(day,1))} disabled={day>=addDays(koreaToday(),7)}>다음 날</button></div>{data.loading?<Loading/>:data.error?<ErrorState message={data.error} retry={data.retry}/>:data.data?.occurrences.length?data.data.occurrences.map(o=><OccurrenceCard key={o.id} item={o} busy={false}/>):<p className="auth-notice">등록된 일정이 없어요.</p>}<p className="account-caption">‘확인 필요’ 일정은 보호자에게 물어봐 주세요.</p></section>;
}
