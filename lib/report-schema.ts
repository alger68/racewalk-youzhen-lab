import { z } from "zod";
import { COMMON_JOINTS } from "./wholebody";
const jointIds=z.array(z.number().int().min(0).max(32)).max(33);
const verification=z.object({model:z.literal("rtmpose-s-wholebody"),compared:jointIds,rejected:jointIds,unobserved:jointIds.optional(),conflicts:jointIds.optional(),retry:z.object({sides:z.array(z.enum(["L","R"])).min(1).max(2),recovered:jointIds}).optional()});
const recovery=z.object({confirmedAt:z.number().finite().min(0).max(7200)});
const point=z.object({x:z.number().finite().min(-2).max(3),y:z.number().finite().min(-2).max(3),v:z.number().min(0).max(1)});
export const reportSchema=z.object({
 schema:z.literal(1),engine:z.string().max(80),id:z.string().uuid(),version:z.number().int().min(0),created:z.string().max(50),
 settings:z.object({athlete:z.string().trim().min(1).max(80),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),view:z.enum(["side-left","side-right","front","rear"]),direction:z.enum(["right","left"]),pace:z.number().positive().max(3600).nullable(),speed:z.enum(["easy","race","fast"]),fps:z.number().min(1).max(480),sampleFps:z.number().min(1).max(240),slow:z.number().min(.25).max(16),timingVerified:z.boolean(),pain:z.enum(["unknown","none","yes"]),clearFeet:z.boolean(),start:z.number().min(0).max(7200),end:z.number().min(0).max(7200),ground:z.tuple([point,point]).nullable(),roi:z.tuple([point,point]).nullable(),target:z.object({id:z.string().uuid(),time:z.number().finite().min(0).max(7200),anchor:point.optional()}).optional(),reviewer:z.string().max(100),groundStable:z.boolean().optional(),contactMethod:z.literal("hmm-ground-v1").optional(),smoothAngles:z.boolean().optional(),uncertaintyEnabled:z.boolean().optional(),pointSigmaPx:z.number().finite().min(0).max(20).optional()}),
 file:z.object({name:z.string().max(250),size:z.number().min(0).max(104857600),duration:z.number().positive().max(7200),width:z.number().positive().max(10000),height:z.number().positive().max(10000),sha256:z.string().max(64)}),
 frames:z.array(z.object({t:z.number().finite().min(0).max(7200),exact:z.boolean(),points:z.array(point).max(33),reason:z.string().max(160).optional(),manual:z.boolean().optional(),track:z.object({targetId:z.string().uuid(),state:z.enum(["locked","searching","lost","manual"]),box:z.tuple([point,point]).optional(),note:z.string().max(160).optional(),continuity:z.number().int().min(0).max(3000).optional(),tentative:z.boolean().optional(),verification:verification.optional(),recovered:z.object({L:recovery.optional(),R:recovery.optional()}).optional(),withheld:z.object({L:z.string().min(1).max(100).optional(),R:z.string().min(1).max(100).optional()}).optional()}).optional()})).max(3000),
 events:z.array(z.object({id:z.string().max(100),t:z.number().finite().min(0).max(7200),side:z.enum(["L","R"]),kind:z.enum(["IC","VERTICAL","TO","FLIGHT","NOTE"]),status:z.enum(["pending","confirmed","rejected"]),origin:z.enum(["auto","manual"]),note:z.string().max(500)})).max(1000),
 judge:z.object({contact:z.enum(["pending","clear","watch","concern","unknown"]),left:z.enum(["pending","clear","watch","concern","unknown"]),right:z.enum(["pending","clear","watch","concern","unknown"])}),notes:z.string().max(10000),complete:z.boolean(),tracking:z.object({identity:z.literal("appearance-reid-v1").optional(),pipeline:z.literal("full-rtmpose-v1").optional(),method:z.enum(["target-lock-v1","target-lock-v2"]),targetId:z.string().uuid(),status:z.enum(["complete","lost","cancelled","partial"]),lastTime:z.number().finite().min(0).max(7200),reason:z.string().max(160).optional()}).optional()
}).superRefine((r,c)=>{
 if(r.settings.end<=r.settings.start||r.settings.end>r.file.duration+.1)c.addIssue({code:"custom",message:"分析區間超出影片。"});
 if(r.frames.some((f,i)=>f.t>r.file.duration+.1||(i>0&&f.t<=r.frames[i-1].t)||(f.points.length!==0&&f.points.length!==33)))c.addIssue({code:"custom",message:"影格時間或骨架資料格式不正確。"});
 if(r.events.some(e=>e.t>r.file.duration+.1))c.addIssue({code:"custom",message:"事件超出影片時間。"});
 if(new Set(r.events.map(e=>e.id)).size!==r.events.length)c.addIssue({code:"custom",message:"事件識別碼重複。"});
 for(const key of ["ground","roi"] as const){const box=r.settings[key];if(box&&box.some(p=>p.x<0||p.x>1||p.y<0||p.y>1))c.addIssue({code:"custom",message:"人工標記超出影片範圍。"});}
 if(r.settings.ground&&Math.abs(r.settings.ground[0].x-r.settings.ground[1].x)<.02)c.addIssue({code:"custom",message:"地面參考線不可垂直。"});
 if(r.settings.groundStable&&!r.settings.ground)c.addIssue({code:"custom",message:"需先標記地面線，才能確認整段適用。"});
 if(r.settings.target){
  const target=r.settings.target;
  if(target.anchor){const a=target.anchor,box=r.settings.roi;if(!box||a.x<Math.min(box[0].x,box[1].x)||a.x>Math.max(box[0].x,box[1].x)||a.y<Math.min(box[0].y,box[1].y)||a.y>Math.max(box[0].y,box[1].y))c.addIssue({code:"custom",message:"人物選擇錨點必須位於圈選範圍內。"});}
  if(!r.settings.roi||Math.abs(target.time-r.settings.start)>.0001)c.addIssue({code:"custom",message:"選手圈選時間必須與分析起點一致。"});
  if(r.frames.some(f=>!f.track||f.track.targetId!==target.id||f.t<target.time-r.settings.slow/r.settings.fps||f.t>r.settings.end+r.settings.slow/r.settings.fps))c.addIssue({code:"custom",message:"骨架包含其他目標或圈選區間外的資料。"});
  if(r.tracking&&r.tracking.targetId!==target.id)c.addIssue({code:"custom",message:"追蹤紀錄與選手不一致。"});
  if(r.complete&&r.tracking?.status!=="complete")c.addIssue({code:"custom",message:"追蹤未完成，不可標記完整分析。"});
  if(r.events.some(e=>e.t<target.time-r.settings.slow/r.settings.fps||e.t>r.settings.end+r.settings.slow/r.settings.fps))c.addIssue({code:"custom",message:"事件超出目前目標的分析區間。"});
 }else if(r.tracking||r.frames.some(f=>f.track))c.addIssue({code:"custom",message:"缺少選手圈選資料。"});
 if(r.frames.some(f=>f.track?.state==="lost"&&(f.points.length>0||!f.reason)))c.addIssue({code:"custom",message:"追蹤中斷幀不得含有量測點位。"});
 if(r.frames.some(f=>f.track?.state==="searching"&&(f.points.length>0||!f.reason||r.tracking?.method!=="target-lock-v2")))c.addIssue({code:"custom",message:"搜尋／核對幀必須保留缺值，並使用持續掃描紀錄。"});
 if(r.frames.some(f=>f.track?.tentative&&f.track.state!=="searching"))c.addIssue({code:"custom",message:"尚未確認的目標不能標記為已鎖定。"});
 if(r.tracking?.method==="target-lock-v2"){
  let continuity=0,gap=false,acquired=false;
  for(const f of r.frames){
   if(f.track?.state==="locked"&&gap&&acquired){continuity++;gap=false;}
   if(f.track?.continuity!==continuity)c.addIssue({code:"custom",message:"量測區間不可跨越身分核對缺口。"});
   if(f.track?.state==="searching")gap=true;
   if(f.track?.state==="locked"){acquired=true;gap=false;}
  }
 }
 if(r.frames.some(f=>f.points.some((p,i)=>i>=23&&f.track?.withheld?.[i%2?"L":"R"]&&p.v!==0)))c.addIssue({code:"custom",message:"暫停量測的腿部不得包含有效點位。"});
 const lostAt=r.frames.find(f=>f.track?.state==="lost")?.t;
 if(lostAt!==undefined&&r.frames.some(f=>f.t>lostAt&&f.points.length>0))c.addIssue({code:"custom",message:"追蹤中斷後須另建片段，不可自動接續點位。"});
 for(const f of r.frames){
 const v=f.track?.verification;
  if(v&&(new Set(v.compared).size!==v.compared.length||new Set(v.rejected).size!==v.rejected.length||v.compared.some(i=>v.rejected.includes(i))))c.addIssue({code:"custom",message:"模型複核的點位清單不正確。"});
  if(v&&v.rejected.some(i=>f.points[i]?.v!==0))c.addIssue({code:"custom",message:"模型複核未通過的點位不可用於量測。"});
  if(v&&((v.unobserved??[]).some(i=>!v.rejected.includes(i))||(v.conflicts??[]).some(i=>!v.rejected.includes(i))||(v.retry?.recovered??[]).some(i=>!v.compared.includes(i)||!v.retry!.sides.includes(i%2?"L":"R")||i<23)))c.addIssue({code:"custom",message:"局部複核的證據與量測點位不一致。"});
  if(r.tracking?.pipeline==="full-rtmpose-v1"&&f.track?.state==="locked"&&!f.manual&&(!v||[...COMMON_JOINTS.map(([i])=>i),31,32].some(i=>f.points[i]?.v>=.65&&!v.compared.includes(i))))c.addIssue({code:"custom",message:"本版自動量測必須保留第二套模型的複核結果。"});
 }
 for(const [index,f] of r.frames.entries())for(const side of ["L","R"] as const){
  const recovered=f.track?.recovered?.[side];if(!recovered)continue;
  const next=r.frames[index+1],ids=side==="L"?[23,25,27]:[24,26,28];
  if(!next||recovered.confirmedAt!==next.t||!f.exact||!next.exact||f.reason||next.reason||f.track?.state!=="locked"||next.track?.state!=="locked"||f.track.targetId!==next.track.targetId||f.track.continuity!==next.track.continuity||(next.t-f.t)/r.settings.slow>.2||f.track.withheld?.[side]||next.track.withheld?.[side]||!ids.every(i=>f.points[i]?.v>=.65&&next.points[i]?.v>=.65&&f.track?.verification?.compared.includes(i)&&next.track?.verification?.compared.includes(i)))c.addIssue({code:"custom",message:"恢復量測必須保留相鄰影格、同一身分與雙模型確認依據。"});
 }
 if(r.file.sha256&&!/^[a-f0-9]{64}$/i.test(r.file.sha256))c.addIssue({code:"custom",message:"原片指紋格式不正確。"});
});
