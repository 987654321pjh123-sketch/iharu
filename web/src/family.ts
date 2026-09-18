export async function familyRequest<T=Record<string,unknown>>(path:string,body:object={},method='POST'):Promise<T>{
 let response:Response;
 try{response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});}catch{throw new Error('연결이 잠시 끊겼어요. 입력한 내용은 그대로 두고 다시 시도해 주세요.');}
 const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'잠시 후 다시 시도해 주세요.');return result as T;
}
