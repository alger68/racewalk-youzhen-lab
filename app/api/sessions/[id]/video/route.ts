import { access, HttpError, json, owned, routeError } from "@/lib/storage";
type Ctx={params:Promise<{id:string}>};
export async function PUT(request:Request,context:Ctx){try{
 const {id}=await context.params;const {owner,db,bucket}=access(request);const row=await owned(db,owner,id);
 const type=request.headers.get("content-type")||"";if(!["video/mp4","video/quicktime","video/webm","application/octet-stream"].includes(type))throw new HttpError(415,"原片格式不支援。");
 const size=Number(request.headers.get("content-length"));if(!size||size>104857600)throw new HttpError(413,"原片備份上限100 MB，請保留10～15秒的短片。");
 const resultObject=await bucket.get(String(row.result_key));if(!resultObject)throw new HttpError(503,"請先重新儲存報告。");
 const report=await resultObject.json<{file:{size:number;sha256:string}}>();
 if(size!==report.file.size||!/^[0-9a-f]{64}$/i.test(report.file.sha256))throw new HttpError(400,"原片大小或指紋與報告不符。");
 if(!request.body)throw new HttpError(400,"沒有影片資料。");
 const key=`videos/${id}/original`;
 await bucket.put(key,request.body,{httpMetadata:{contentType:type},sha256:report.file.sha256});
 const result=await db.prepare("UPDATE sessions SET video_key=? WHERE id=? AND owner_id=?").bind(key,id,owner).run();
 if(result.meta.changes!==1){await bucket.delete(key);throw new HttpError(404,"紀錄已移除。");}
 return json({archived:true});
}catch(e){return routeError(e);}}
export async function GET(request:Request,context:Ctx){try{
 const {id}=await context.params;const {owner,db,bucket}=access(request);const row=await owned(db,owner,id);
 if(!row.video_key)throw new HttpError(404,"這筆紀錄沒有備份原片，請重新選取原始影片。");
 const obj=await bucket.get(String(row.video_key),{range:request.headers});if(!obj)throw new HttpError(404,"影片不存在。");
 const headers=new Headers();obj.writeHttpMetadata(headers);headers.set("Accept-Ranges","bytes");headers.set("Cache-Control","private, no-store");headers.set("ETag",obj.httpEtag);
 const range=obj.range as {offset?:number;length?:number}|undefined;
 if(range&&typeof range.offset==="number"&&typeof range.length==="number"){
  headers.set("Content-Range",`bytes ${range.offset}-${range.offset+range.length-1}/${obj.size}`);headers.set("Content-Length",String(range.length));return new Response(obj.body,{status:206,headers});
 }
 headers.set("Content-Length",String(obj.size));return new Response(obj.body,{headers});
}catch(e){return routeError(e);}}
