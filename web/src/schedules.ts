import {useRef,useState} from 'react';
export class ScheduleError extends Error{constructor(message:string,readonly code:string){super(message);}}
export async function scheduleRequest<T>(path:string,body?:object,method=body?'POST':'GET',key?:string):Promise<T>{
 let response:Response;
 try{response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});}
 catch{throw new ScheduleError('연결이 잠시 끊겼어요. 입력한 내용은 그대로예요. 다시 시도해 주세요.','NETWORK');}
 const data=await response.json();if(!response.ok)throw new ScheduleError(data.error?.message||'잠시 후 다시 시도해 주세요.',data.error?.code||'UNKNOWN');return data as T;
}
export function useScheduleAction(){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[code,setCode]=useState('');const lock=useRef(false),previous=useRef<{body:string;key:string}|null>(null);
 return {busy,error,code,clear(){setError('');setCode('');},async run(fn:(keyFor:(body:object)=>string)=>Promise<void>){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setCode('');
  try{await fn(body=>{const value=JSON.stringify(body);if(previous.current?.body!==value)previous.current={body:value,key:crypto.randomUUID()};return previous.current.key;});}
  catch(e){setError((e as Error).message);setCode(e instanceof ScheduleError?e.code:'UNKNOWN');}
  finally{lock.current=false;setBusy(false);}
 }};
}
