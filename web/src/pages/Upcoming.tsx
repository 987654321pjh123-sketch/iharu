import { Link, useLocation } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
const info:Record<string,{title:string;body:string;icon:IconName}> = {
  '/chat':{title:'그림과 글로, 가족 대화',body:'아이별 대화방에서 짧은 글과 그림으로 소식을 주고받아요. 가족 연결 후 대화를 시작할 수 있어요.',icon:'chat'},
  '/child/chat':{title:'그림으로 마음을 전해요',body:'가족과 연결되면 그림을 고르고, 보낼 말을 확인한 뒤 보낼 수 있어요.',icon:'chat'},
  '/location':{title:'공유한 위치를 한눈에',body:'아이가 직접 보낸 마지막 위치와 공유 시각을 보여 드려요. 현재는 기기 연결 전이라 위치를 확인할 수 없어요.',icon:'pin'},
  '/records':{title:'차곡차곡 쌓이는 하루',body:'도착·출발 기록과 학습 메모를 이곳에 모아요. 가족 연결을 마치면 사용할 수 있어요.',icon:'book'},
  '/repeats':{title:'한 번 등록해, 매주 편하게',body:'학교와 학원 일정을 요일별로 반복하고 휴강·보강을 따로 관리할 수 있어요. 지금은 화면을 준비하고 있어요.',icon:'repeat'},
  '/notifications':{title:'가족의 새로운 소식',body:'일정과 대화의 새 소식을 이곳에서 확인해요. 현재는 연결된 알림이 없어요.',icon:'bell'},
  '/settings':{title:'우리 가족에게 맞게',body:'가족 연결, 기기 관리와 알림 설정을 준비하고 있어요. 큰 글씨는 화면 상단에서 바로 바꿀 수 있어요.',icon:'settings'},
};
export function Upcoming() {
  const {pathname}=useLocation(); const item=info[pathname];
  return <div className="upcoming-page"><span className="upcoming-icon"><Icon name={item?.icon || 'home'}/></span><p className="eyebrow">{item?'연결 준비 중':'페이지를 찾을 수 없어요'}</p><h1>{item?.title || '우리 가족의 하루로 돌아갈까요?'}</h1><p>{item?.body || '주소를 다시 확인하거나 홈으로 이동해 주세요.'}</p>
    {pathname.includes('chat') && <div className="sticker-teaser" aria-label="그림 메시지 예시"><span><b aria-hidden="true">👋</b>안녕!</span><span><b aria-hidden="true">🥰</b>사랑해요</span><span><b aria-hidden="true">🏠</b>집에 왔어요</span></div>}
    <Link to={pathname.startsWith('/child')?'/child':'/today'} className="button primary">{pathname.startsWith('/child')?'내 하루로 돌아가기':'오늘 화면으로 돌아가기'}<Icon name="arrow"/></Link>
  </div>;
}
