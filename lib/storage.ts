import { env } from "cloudflare:workers";
export class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
export function access(request:Request){
 const owner=request.headers.get("oai-authenticated-user-id");
 if(!owner)throw new HttpError(401,"請以網站擁有者的ChatGPT帳號登入後重試儲存。");
 if(request.method!=="GET"&&request.headers.get("sec-fetch-site")==="cross-site")throw new HttpError(403,"請從此網站內操作。");
 if(!env.DB||!env.BUCKET)throw new HttpError(503,"紀錄暫時無法存取，請先匯出JSON備份後重試。");
 return {owner,db:env.DB,bucket:env.BUCKET};
}
export function json(value:unknown,status=200){return Response.json(value,{status,headers:{"Cache-Control":"private, no-store"}});}
export function routeError(error:unknown){if(error instanceof HttpError)return json({error:error.message},error.status);console.error("racewalk storage",error instanceof Error?error.message:"error");return json({error:"儲存服務暫時無法完成，內容仍保留在畫面，請匯出JSON備份。"},503);}
export async function readJson(request:Request){
 if(!request.headers.get("content-type")?.includes("application/json"))throw new HttpError(415,"需要JSON格式。");
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,"沒有資料。");
 const dec=new TextDecoder();let length=0,text="";
 for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>8_000_000){await reader.cancel();throw new HttpError(413,"分析資料太大，請縮短區間後儲存。");}text+=dec.decode(value,{stream:true});}
 try{return JSON.parse(text+dec.decode());}catch{throw new HttpError(400,"JSON格式不正確。");}
}
export function checkId(id:string){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new HttpError(400,"紀錄識別碼不正確。");}
export async function owned(db:D1Database,owner:string,id:string){checkId(id);const row=await db.prepare("SELECT * FROM sessions WHERE id = ? AND owner_id = ?").bind(id,owner).first<Record<string,unknown>>();if(!row)throw new HttpError(404,"找不到這筆紀錄。");return row;}
