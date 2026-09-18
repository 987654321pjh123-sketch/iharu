import { dashboardSchema, type ChildFilter, type Dashboard } from '../../shared/contracts.js';

const children: Dashboard['children'] = [
  { id: 'demo-seoyun', name: '서윤', grade: '초등학교 2학년', color: 'mint' },
  { id: 'demo-doyun', name: '도윤', grade: '초등학교 1학년', color: 'peach' },
];
// Synthetic fixtures only. This is not recurrence generation, live attendance, or a holiday feed.
const events: Dashboard['events'] = [
  { id:'sample-1', childId:'demo-seoyun', date:'2026-09-17', start:'08:40', end:'13:30', title:'학교', place:'햇살초등학교', kind:'school', status:'completed' },
  { id:'sample-2', childId:'demo-doyun', date:'2026-09-17', start:'08:40', end:'13:00', title:'학교', place:'햇살초등학교', kind:'school', status:'completed' },
  { id:'sample-3', childId:'demo-seoyun', date:'2026-09-17', start:'15:00', end:'16:00', title:'영어 학원', place:'리틀트리 영어', kind:'academy', status:'upcoming' },
  { id:'sample-4', childId:'demo-doyun', date:'2026-09-17', start:'16:00', end:'17:00', title:'태권도', place:'바른 태권도', kind:'academy', status:'upcoming' },
  { id:'sample-5', childId:'demo-seoyun', date:'2026-09-18', start:'15:00', end:'16:00', title:'미술 학원', place:'작은 숲 미술', kind:'academy', status:'upcoming' },
  { id:'sample-6', childId:'demo-seoyun', date:'2026-09-24', start:'15:00', end:'16:00', title:'영어 학원', place:'추석 연휴 · 휴강 여부 확인', kind:'academy', status:'check' },
];
const holidays = [
  { date:'2026-09-24', title:'추석 연휴' }, { date:'2026-09-25', title:'추석' }, { date:'2026-09-26', title:'추석 연휴' },
  { date:'2026-10-03', title:'개천절' }, { date:'2026-10-05', title:'대체공휴일' }, { date:'2026-10-09', title:'한글날' },
];
const tuition: Dashboard['tuition'] = [
  { childId:'demo-seoyun', title:'리틀트리 영어', amount:240000, paid:true },
  { childId:'demo-seoyun', title:'작은 숲 미술', amount:120000, paid:false },
  { childId:'demo-doyun', title:'바른 태권도', amount:150000, paid:true },
];
export function getDemoDashboard(child: ChildFilter, month: string): Dashboard {
  const allowed = (id: string) => child === 'all' || id === child;
  return dashboardSchema.parse({ sampleDate:'2026-09-17', children,
    events:events.filter(e => allowed(e.childId) && e.date.startsWith(month)),
    holidays:holidays.filter(h => h.date.startsWith(month)),
    tuition:month === '2026-09' ? tuition.filter(t => allowed(t.childId)) : [],
  });
}
