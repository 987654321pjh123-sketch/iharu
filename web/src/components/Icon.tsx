import type { CSSProperties } from 'react';
const paths = {
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>,
  home:<><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></>,
  pin:<><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  chat:<><path d="M21 11a8 8 0 0 1-8 8H9l-6 3 1.5-6A8 8 0 0 1 3 11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"/><path d="M8 10h8m-8 4h5"/></>,
  book:<><path d="M12 5v16M3 4c4-1 7 0 9 1 2-1 5-2 9-1v15c-4-1-7 0-9 2-2-2-5-3-9-2Z"/></>,
  calendar:<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h1m6 0h1"/></>,
  arrow:<path d="M5 12h14m-5-5 5 5-5 5"/>,
  chevron:<path d="m9 5 7 7-7 7"/>,
  check:<path d="m5 12 4 4L19 6"/>,
  plus:<path d="M12 5v14M5 12h14"/>,
  bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-9 13h6"/></>,
  settings:<><circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 2-1 4 3 2 3-1 3 4 3-2 1-3 4-2-1-4-3-1-1-4Z"/></>,
  clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  bag:<><rect x="5" y="7" width="14" height="14" rx="3"/><path d="M9 7V5a3 3 0 0 1 6 0v2M5 12h14m-9 0v3h4v-3"/></>,
  phone:<path d="M7 3H4a1 1 0 0 0-1 1c0 10 7 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a15 15 0 0 1-7-7l2-2Z"/>,
  arrival:<><path d="M14 3h6v18h-6M3 12h12m-4-4 4 4-4 4"/></>,
  departure:<><path d="M10 3H4v18h6m0-9h11m-4-4 4 4-4 4"/></>,
  wallet:<><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8V5l14-3v3m4 6h-6v5h6m-3-2.5h.1"/></>,
  type:<><path d="m3 19 6-14 6 14M5 14h8m3-5h6m-3 0v10"/></>,
  close:<path d="m6 6 12 12M6 18 18 6"/>,
  shield:<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></>,
  repeat:<><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/></>,
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, className = '', style }: { name:IconName; className?:string; style?:CSSProperties }) {
  return <svg className={`icon ${className}`} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
