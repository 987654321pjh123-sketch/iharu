import { useState } from 'react';
import { dashboardSchema, envelope, type ChildFilter, type Dashboard } from '../../../shared/contracts';
import { useApi } from '../api';
import { Icon } from './Icon';
import { Loading, ErrorState } from './Common';
const schema = envelope(dashboardSchema);
const week = ['일', '월', '화', '수', '목', '금', '토'];
const dateKey = (year:number, month:number, day:number) => `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

export function Calendar({ child, onPreview }: { child:ChildFilter; onPreview:(title:string) => void }) {
  const [month, setMonth] = useState('2026-09');
  const [day, setDay] = useState('2026-09-17');
  const { data, loading, error, retry } = useApi(`/api/demo/dashboard?child=${child}&month=${month}`, schema);
  const [year, number] = month.split('-').map(Number);
  const moveMonth = (delta:number) => { const next = new Date(year, number - 1 + delta, 1); const key = dateKey(next.getFullYear(), next.getMonth()+1, 1); setMonth(key.slice(0,7)); setDay(key); };
  const moveDay = (delta:number) => { const [y,m,d] = day.split('-').map(Number); const next = new Date(y,m-1,d+delta); const key = dateKey(next.getFullYear(),next.getMonth()+1,next.getDate()); setDay(key); setMonth(key.slice(0,7)); };
  const first = new Date(year,number-1,1).getDay();
  const count = new Date(year,number,0).getDate();
  const events = data?.data.events || [];
  const holidays = data?.data.holidays || [];
  const selectedEvents = events.filter(e => e.date === day);
  const holiday = holidays.find(h => h.date === day);
  return <div className="calendar">
    <div className="calendar-toolbar"><h3 aria-live="polite">{year}년 {number}월</h3><div className="calendar-arrows">
      <button className="icon-button" aria-label="이전 달" onClick={() => moveMonth(-1)}><Icon name="chevron" className="flip"/></button>
      <button className="button quiet compact" onClick={() => { setMonth('2026-09'); setDay('2026-09-17'); }}>예시 오늘</button>
      <button className="icon-button" aria-label="다음 달" onClick={() => moveMonth(1)}><Icon name="chevron"/></button>
    </div></div>
    <p className="sr-only">날짜 버튼을 선택하면 아래에서 일정을 확인할 수 있어요. 이전·다음 날짜 버튼도 사용할 수 있어요.</p>
    <div className="calendar-grid" aria-label={`${year}년 ${number}월 날짜 선택`}>
      {week.map((v,i) => <span key={v} className={`weekday ${i === 0 ? 'holiday' : ''}`}>{v}</span>)}
      {Array.from({ length:first },(_,i) => <span key={`empty-${i}`}/>)}
      {Array.from({ length:count },(_,i) => { const date = dateKey(year,number,i+1); const h = holidays.find(h => h.date === date); const ev = events.filter(e => e.date === date); return <button key={date} className={`calendar-day ${day===date?'selected':''} ${h || (first+i)%7===0?'holiday':''}`} aria-pressed={day===date} aria-label={`${number}월 ${i+1}일${h ? ' '+h.title : ''}, 예시 일정 ${ev.length}개`} onClick={() => setDay(date)}>
        <span>{i+1}</span><span className="date-markers" aria-hidden="true">{h ? <span className="holiday-dot"/> : ev.slice(0,2).map(e => <span key={e.id} className={e.childId==='demo-seoyun'?'mint-dot':'peach-dot'}/>)}</span>
      </button>; })}
    </div>
    <div className="calendar-legend"><span><i className="mint-dot"/>서윤</span><span><i className="peach-dot"/>도윤</span><span><i className="holiday-dot"/>공휴일 예시</span></div>
    <div className="day-detail"><div className="day-heading"><strong>{Number(day.slice(5,7))}월 {Number(day.slice(8))}일 {holiday && <span className="holiday">· {holiday.title}</span>}</strong><div><button className="icon-button" onClick={() => moveDay(-1)} aria-label="이전 날짜"><Icon name="chevron" className="flip"/></button><button className="icon-button" onClick={() => moveDay(1)} aria-label="다음 날짜"><Icon name="chevron"/></button></div></div>
    {loading ? <Loading label="이달의 예시 일정을 불러오고 있어요"/> : error ? <ErrorState message={error} retry={retry}/> : <>
      {selectedEvents.length ? selectedEvents.map(e => <CalendarItem key={e.id} event={e} childName={data?.data.children.find(c => c.id === e.childId)?.name || ''}/>) : <p className="muted empty-day">등록된 예시 일정이 없어요.</p>}
      {holiday && <p className="holiday-note">공휴일이어도 학원 일정은 따로 확인해 주세요.</p>}
    </>}
    </div><button className="calendar-add" onClick={() => onPreview('가족 일정 추가')}><Icon name="plus"/>일정 추가</button>
  </div>;
}
function CalendarItem({ event, childName }: { event:Dashboard['events'][number]; childName:string }) {
  return <div className="calendar-item"><span className={`event-line ${event.childId==='demo-seoyun'?'mint':'peach'}`}/><span className="event-time">{event.start}</span><div><strong>{childName} · {event.title}</strong><p>{event.place}</p></div>{event.status==='check' && <span className="badge amber">확인 필요</span>}</div>;
}
