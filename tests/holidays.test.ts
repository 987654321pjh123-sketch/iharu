import {describe,it,expect} from 'vitest';
import {parseHolidays,fetchHolidayYear} from '../server/schedules/holidays';
function payload(items:unknown[],total=items.length){return JSON.stringify({response:{header:{resultCode:'00'},body:{totalCount:total,items:{item:items}}}});}
const row={locdate:20260924,dateName:'추석 연휴 예시',isHoliday:'Y'};
describe('KASI yearly adapter',()=>{
 it('preserves provider dates and labels in XML and JSON without calculating lunar holidays',()=>{
  expect(parseHolidays(payload([row]),2026)).toEqual([{date:'2026-09-24',name:'추석 연휴 예시',isHoliday:true}]);
  const xml='<response><header><resultCode>00</resultCode></header><body><totalCount>1</totalCount><items><item><locdate>20260101</locdate><dateName>신정 &amp; 예시</dateName><isHoliday>Y</isHoliday></item></items></body></response>';
  expect(parseHolidays(xml,2026)[0]).toEqual({date:'2026-01-01',name:'신정 & 예시',isHoliday:true});
 });
 it('rejects partial, unpublished, cross-year, invalid-date and error data before replacing a cache',()=>{
  for(const raw of [payload([row],2),payload([]),payload([{...row,locdate:20250230}]),payload([{...row,locdate:20250924}]),JSON.stringify({response:{header:{resultCode:'30'}}})])expect(()=>parseHolidays(raw,2026)).toThrow();
 });
 it('rejects entity declarations and oversized documents',()=>{
  expect(()=>parseHolidays('<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><response>&secret;</response>',2026)).toThrow('INVALID_HOLIDAYS');
  expect(()=>parseHolidays('x'.repeat(512001),2026)).toThrow('INVALID_HOLIDAYS');
 });
 it('uses one encoded server key, a fixed HTTPS endpoint, and bounded response reading',async()=>{
  let called='';const transport:typeof fetch=async(input,init)=>{called=String(input);expect(init?.redirect).toBe('error');return new Response(payload([row]));};
  const result=await fetchHolidayYear(2026,'test+key/=',transport);const url=new URL(called);
  expect(url.origin).toBe('https://apis.data.go.kr');expect(url.pathname.endsWith('/getRestDeInfo')).toBe(true);expect(url.searchParams.get('serviceKey')).toBe('test+key/=');expect(result.hash).toHaveLength(64);
  await expect(fetchHolidayYear(2026,'fixture',async()=>new Response('x'.repeat(512001)))).rejects.toThrow('INVALID_HOLIDAYS');
 });
});
