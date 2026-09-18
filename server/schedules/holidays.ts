import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {z} from 'zod';
import {localDate} from '../../shared/schedules.js';

const itemSchema=z.object({locdate:z.coerce.string().regex(/^\d{8}$/),dateName:z.string().trim().min(1).max(100),isHoliday:z.enum(['Y','N'])});
const responseSchema=z.object({response:z.object({header:z.object({resultCode:z.coerce.string()}),body:z.object({totalCount:z.coerce.number().int().min(0).max(1000),items:z.unknown().optional()}).optional()})});
export type HolidayItem={date:string;name:string;isHoliday:boolean};
export function parseHolidays(raw:string,year:number):HolidayItem[]{
 if(Buffer.byteLength(raw)>512000||/<!DOCTYPE|<!ENTITY/i.test(raw))throw new Error('INVALID_HOLIDAYS');
 let value:unknown;
 if(raw.trim().startsWith('{'))value=JSON.parse(raw);
 else{if(XMLValidator.validate(raw)!==true)throw new Error('INVALID_HOLIDAYS');value=new XMLParser({parseTagValue:false,processEntities:true}).parse(raw);}
 const r=responseSchema.parse(value).response;
 if(!['00','0','0000'].includes(r.header.resultCode)||!r.body)throw new Error('HOLIDAY_FETCH_FAILED');
 const items=(r.body.items as {item?:unknown}|null)?.item;
 const rows=items===undefined?[]:Array.isArray(items)?items:[items];
 if(!r.body.totalCount||rows.length!==r.body.totalCount)throw new Error('INCOMPLETE_HOLIDAYS');
 const seen=new Set<string>();return rows.map(row=>{
  const i=itemSchema.parse(row);const date=localDate.parse(`${i.locdate.slice(0,4)}-${i.locdate.slice(4,6)}-${i.locdate.slice(6)}`);
  if(Number(date.slice(0,4))!==year)throw new Error('INVALID_HOLIDAYS');
  return {date,name:i.dateName,isHoliday:i.isHoliday==='Y'};
 }).filter(i=>{const k=i.date+'|'+i.name;if(seen.has(k))return false;seen.add(k);return true;});
}
export async function fetchHolidayYear(year:number,key:string,transport:typeof fetch=fetch){
 const url=new URL('https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo');
 // Use the portal's decoded key; URLSearchParams encodes exactly once.
 url.search=new URLSearchParams({serviceKey:key,solYear:String(year),pageNo:'1',numOfRows:'1000'}).toString();
 const response=await transport(url,{signal:AbortSignal.timeout(4500),redirect:'error',headers:{Accept:'application/xml'}});
 if(!response.ok||Number(response.headers.get('Content-Length')||0)>512000)throw new Error('HOLIDAY_FETCH_FAILED');
 const reader=response.body?.getReader();if(!reader)throw new Error('HOLIDAY_FETCH_FAILED');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>512000)throw new Error('INVALID_HOLIDAYS');chunks.push(r.value);}}finally{await reader.cancel().catch(()=>{});}
 const raw=Buffer.concat(chunks).toString('utf8');
 return {items:parseHolidays(raw,year),hash:createHash('sha256').update(raw).digest('hex')};
}
