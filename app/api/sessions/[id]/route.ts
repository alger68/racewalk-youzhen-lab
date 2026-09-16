import { access, HttpError, json, owned, routeError } from "@/lib/storage";
type Ctx={params:Promise<{id:string}>};
export async function GET(request:Request,context:Ctx){try{
 const {id}=await context.params;const {owner,db,bucket}=access(request);const row=await owned(db,owner,id);
 const data=await bucket.get(String(row.result_key));if(!data)throw new HttpError(503,"分析檔案暫時無法讀取。");
 return json({report:await data.json(),archived:!!row.video_key});
}catch(e){return routeError(e);}}
export async function DELETE(request:Request,context:Ctx){try{
 const {id}=await context.params;const {owner,db,bucket}=access(request);const row=await owned(db,owner,id);
 const keys:string[]=[];let cursor:string|undefined;
 do{const list=await bucket.list({prefix:`reports/${id}/`,cursor,limit:1000});keys.push(...list.objects.map(o=>o.key));cursor=list.truncated?list.cursor:undefined;}while(cursor);
 if(row.video_key)keys.push(String(row.video_key));for(let i=0;i<keys.length;i+=1000)await bucket.delete(keys.slice(i,i+1000));
 // Keep the owned row until object cleanup succeeds so a failed deletion is retryable.
 await db.prepare("DELETE FROM sessions WHERE id=? AND owner_id=?").bind(id,owner).run();
 return json({deleted:true});
}catch(e){return routeError(e);}}
