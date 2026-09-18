import { useEffect, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { copy } from '../copy';

export function Card({ title, icon, children, className = '', action }: { title:string; icon:IconName; children:ReactNode; className?:string; action?:ReactNode }) {
  return <section className={`card ${className}`}><div className="card-heading"><h2><span className="section-icon"><Icon name={icon}/></span>{title}</h2>{action}</div>{children}</section>;
}
export function Loading({ label = '가족의 하루를 불러오고 있어요' }: { label?:string }) {
  return <div className="loading-state" role="status"><span className="loader"/>{label}</div>;
}
export function ErrorState({ message, retry }: { message:string; retry:() => void }) {
  return <div className="error-state" role="alert"><strong>{copy.error}</strong><p>{message}</p><button className="button" onClick={retry}>{copy.retry}</button></div>;
}
export function PreviewDialog({ title, onClose }: { title:string | null; onClose:() => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (title && !ref.current?.open) ref.current?.showModal(); }, [title]);
  return <dialog ref={ref} className="preview-dialog" onClose={onClose} aria-labelledby="dialog-title">
    <button className="icon-button dialog-close" aria-label="안내 닫기" onClick={() => ref.current?.close()}><Icon name="close"/></button>
    <span className="dialog-symbol"><Icon name="sun"/></span><p className="eyebrow">화면 미리보기</p>
    <h2 id="dialog-title">{title}</h2><p>{copy.notSaved}</p>
    <button className="button primary full" autoFocus onClick={() => ref.current?.close()}>알겠어요</button>
  </dialog>;
}
