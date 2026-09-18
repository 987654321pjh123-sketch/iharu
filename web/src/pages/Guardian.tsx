import { Link, useLocation } from 'react-router-dom';
import { dashboardSchema, envelope, type ChildFilter, type Dashboard } from '../../../shared/contracts';
import { useApi } from '../api';
import { copy } from '../copy';
import { Icon } from '../components/Icon';
import { Card, Loading, ErrorState } from '../components/Common';
import { Calendar } from '../components/Calendar';
const schema = envelope(dashboardSchema);
const won = (n:number) => new Intl.NumberFormat('ko-KR').format(n);
export const children = [ {id:'all',name:'모든 아이'}, {id:'demo-seoyun',name:'서윤'}, {id:'demo-doyun',name:'도윤'} ] as const;

export function Guardian({ child, setChild, onPreview }: { child:ChildFilter; setChild:(child:ChildFilter) => void; onPreview:(title:string) => void }) {
  const location = useLocation();
  const view = location.pathname;
  const { data, loading, error, retry } = useApi(`/api/demo/dashboard?child=${child}&month=2026-09`, schema);
  return <>
    <div className="page-heading"><div><p className="eyebrow">우리 가족의 하루</p><h1>{view==='/calendar'?'함께 챙기는 가족 일정':view==='/tuition'?'한눈에 보는 학원비':copy.guardianTitle}</h1><p className="page-subtitle">{view==='/calendar'?'학교와 학원, 가족의 약속을 모아 보세요.':view==='/tuition'?'이달의 계획과 납부 기록을 함께 확인하세요.':copy.guardianSubtitle}</p></div><button className="button primary add-top" onClick={() => onPreview('가족 일정 추가')}><Icon name="plus"/>일정 추가</button></div>
    <div className="family-filter"><div className="filter-buttons" aria-label="아이 선택">{children.map(c => <button key={c.id} aria-pressed={child===c.id} className={`child-chip ${child===c.id?'active':''}`} onClick={() => setChild(c.id)}>{c.id!=='all' && <span aria-hidden="true" className={`avatar small ${c.id==='demo-seoyun'?'mint':'peach'}`}>{c.name[0]}</span>}{c.name}</button>)}</div><span className="sample-date"><Icon name="calendar"/>2026. 9. 17. 목요일 · 예시</span></div>
    <nav className="subnav" aria-label="오늘 화면 보기">{[['/today','한눈에'],['/calendar','월간 일정'],['/tuition','학원비'],['/repeats','반복 일정']].map(([url,label]) => <Link key={url} to={url} aria-current={view===url?'page':undefined}>{label}</Link>)}</nav>
    {view==='/calendar' ? <Card title={copy.calendar} icon="calendar" className="standalone-calendar"><Calendar child={child} onPreview={onPreview}/></Card> : loading ? <Loading/> : error ? <ErrorState message={error} retry={retry}/> : data ? view==='/tuition' ? <Tuition data={data.data} onPreview={onPreview}/> : <>
      <div className="dashboard-grid">
        <Card title={copy.attendance} icon="bag" className="attendance-card" action={<span className="badge soft">예시 일정 {data.data.events.filter(e=>e.date==='2026-09-17').length}개</span>}>
          <p className="section-description">오늘의 이동 일정</p><div className="attendance-list">{data.data.events.filter(e => e.date==='2026-09-17').map(e => { const kid=data.data.children.find(c=>c.id===e.childId)!; return <div className="attendance-row" key={e.id}>
            <div className="attendance-time"><strong>{e.start}</strong><span>{e.end}</span></div><div className={`timeline-marker ${e.status==='completed'?'complete':''}`}><span/></div>
            <div className="attendance-content"><div><span className={`child-label ${kid.color}`}>{kid.name}</span><strong>{e.title}</strong></div><p>{e.place}</p></div><span className={`badge ${e.status==='completed'?'green':'soft'}`}>{e.status==='completed'?'도착 예시':'예정'}</span>
          </div>; })}</div>
          <div className="card-actions"><button className="button primary" onClick={() => onPreview('도착·출발 기록')}><Icon name="check"/>도착·출발 기록</button><Link className="button" to="/chat"><Icon name="chat"/>가족에게 말하기</Link></div>
        </Card>
        <Card title={copy.calendar} icon="calendar" className="family-calendar" action={<Link to="/calendar" className="text-link">크게 보기<Icon name="chevron"/></Link>}><Calendar child={child} onPreview={onPreview}/></Card>
        <div className="location-column">
          <Card title={copy.location} icon="pin" className="location-card" action={<span className="badge soft">연결 준비</span>}>
            <div className="location-illustration" aria-hidden="true"><span className="location-ring ring-2"/><span className="location-ring ring-1"/><span className="location-pin"><Icon name="pin"/></span><span className="location-house"><Icon name="home"/></span><span className="location-tree"><Icon name="sun"/></span></div>
            <h3>{copy.emptyLocation}</h3><p className="section-description">아이가 직접 보낸 마지막 위치를<br className="desktop-br"/> 이곳에서 확인할 수 있어요.</p>
            <Link className="button full" to="/location">위치 공유 알아보기<Icon name="arrow"/></Link><p className="location-note"><Icon name="shield"/>자동으로 위치를 추적하지 않아요.</p>
          </Card>
          <section className="gentle-note"><span><Icon name="chat"/></span><div><h3>짧은 한마디도, 함께</h3><p>글 대신 그림으로도<br/>가족에게 마음을 전해요.</p><Link to="/chat">가족 대화 보기<Icon name="arrow"/></Link></div></section>
        </div>
      </div><Tuition data={data.data} onPreview={onPreview}/>
    </> : null}
  </>;
}
function Tuition({ data, onPreview }: { data:Dashboard; onPreview:(s:string)=>void }) {
  const total=data.tuition.reduce((s,t)=>s+t.amount,0); const paid=data.tuition.filter(t=>t.paid).reduce((s,t)=>s+t.amount,0);
  return <Card title="이달의 학원비" icon="wallet" className="tuition-card" action={<span className="badge soft">9월 예시</span>}>
    <div className="fee-overview"><div><p>이번 달 계획</p><strong className="fee-total">{won(total)}<span>원</span></strong></div><div><p>납부 기록</p><strong>{won(paid)}원</strong></div><div><p>남은 금액</p><strong className="amber-text">{won(total-paid)}원</strong></div></div>
    <div className="fee-items">{data.tuition.map(t=><button key={t.title} className="fee-item" onClick={()=>onPreview(`${t.title} 납부 기록`)}><span><strong>{t.title}</strong><small>{data.children.find(c=>c.id===t.childId)?.name}</small></span><span><strong>{won(t.amount)}원</strong><small className={t.paid?'green-text':'amber-text'}>{t.paid?'납부 기록 예시':'납부 예정'}</small></span><Icon name="chevron"/></button>)}</div>
    <p className="fine-print">가족이 직접 기록하는 장부예요. 실제 결제는 진행되지 않아요.</p>
  </Card>;
}
