import { access, HttpError, json, readJson, routeError } from "@/lib/storage";
import { reportSchema } from "@/lib/report-schema";
import { summarize } from "@/lib/racewalk";
export async function GET(request:Request){try{
 const {owner,db}=access(request);
 const rows=await db.prepare("SELECT id,athlete,session_date,view,speed,pace,file_name,summary,version,video_key,created_at,updated_at FROM sessions WHERE owner_id = ? ORDER BY session_date DESC, updated_at DESC LIMIT 200").bind(owner).all();
 return json({sessions:rows.results.map(r=>({...r,summary:JSON.parse(String(r.summary)),archived:!!r.video_key,video_key:undefined}))});
}catch(e){return routeError(e);}}
export async function POST(request:Request){try{
 const {owner,db,bucket}=access(request);const parsed=reportSchema.safeParse(await readJson(request));
 if(!parsed.success)throw new HttpError(400,parsed.error.issues[0]?.message||"資料格式不正確。");
 const report=parsed.data;const existing=await db.prepare("SELECT owner_id,version,result_key FROM sessions WHERE id = ?").bind(report.id).first<{owner_id:string;version:number;result_key:string}>();
 if(existing&&(existing.owner_id!==owner||existing.version!==report.version))throw new HttpError(409,"這筆紀錄已有另一個版本。請先匯出目前JSON，重新載入紀錄後再修改。");
 if(!existing&&report.version!==0)throw new HttpError(409,"原紀錄已不存在，請匯出JSON後以新紀錄匯入。");
 const version=(existing?.version??0)+1;const now=new Date().toISOString();
 const resultKey=`reports/${report.id}/${crypto.randomUUID()}.json`;
 await bucket.put(resultKey,JSON.stringify({...report,version}),{httpMetadata:{contentType:"application/json"}});
 const summary=JSON.stringify(summarize(report));let success=false;
 try{
  if(existing){const result=await db.prepare("UPDATE sessions SET athlete=?, session_date=?, view=?, speed=?, pace=?, file_name=?, result_key=?, summary=?, version=?, updated_at=? WHERE id=? AND owner_id=? AND version=?").bind(report.settings.athlete,report.settings.date,report.settings.view,report.settings.speed,report.settings.pace,report.file.name,resultKey,summary,version,now,report.id,owner,report.version).run();success=result.meta.changes===1;}
  else{await db.prepare("INSERT INTO sessions (id,owner_id,athlete,session_date,view,speed,pace,file_name,result_key,summary,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(report.id,owner,report.settings.athlete,report.settings.date,report.settings.view,report.settings.speed,report.settings.pace,report.file.name,resultKey,summary,version,now,now).run();success=true;}
 }finally{if(!success)await bucket.delete(resultKey);}
 if(!success)throw new HttpError(409,"紀錄同時被更新，請先匯出JSON保留修改。");
 // Immutable result objects keep prior edits reproducible; deletion removes their prefix.
 return json({id:report.id,version,updated_at:now});
}catch(e){return routeError(e);}}
