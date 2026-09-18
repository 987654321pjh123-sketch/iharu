import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { copy } from '../copy';
export function ChildHome({ onPreview }: { onPreview:(s:string)=>void }) {
  return <div className="child-home">
    <div className="child-welcome"><div><p className="eyebrow">서윤의 하루 · 예시</p><h1>서윤아, 반가워!</h1><p>오늘도 너의 하루를 들려줘.</p></div><span className="welcome-sun"><Icon name="sun"/></span></div>
    <Link to="/child/chat" className="child-talk"><span className="talk-icon"><Icon name="chat"/></span><span><strong>{copy.talk}</strong><span>그림으로 쉽게 보내요</span></span><Icon name="chevron"/></Link>
    <section className="child-next"><div><p className="eyebrow">다음 일정 · 예시</p><h2>영어 학원</h2><p><Icon name="clock"/>오후 3:00 ~ 4:00</p></div><span className="next-bag"><Icon name="bag"/></span></section>
    <div className="child-actions">{([
      ['arrival','도착했어요','mint'],['departure','출발해요','peach'],['pin','내 위치 보내기','blue'],['phone','연락 부탁하기','lavender'],
    ] as const).map(([icon,label,color])=><button key={label} onClick={()=>onPreview(label)} className={`child-action ${color}`}><span><Icon name={icon}/></span><strong>{label}</strong></button>)}</div>
    <p className="child-help"><Icon name="shield"/>누르기 전에 한 번 더 확인할 수 있어요.</p>
    <section className="child-tasks"><div className="card-heading"><h2>오늘 할 일</h2><span className="badge soft">예시</span></div><button className="task" onClick={()=>onPreview('책가방 챙기기')}><span className="task-circle"/><span><strong>책가방 챙기기</strong><small>영어 책과 물병을 챙겨요</small></span><Icon name="bag"/></button></section>
  </div>;
}
