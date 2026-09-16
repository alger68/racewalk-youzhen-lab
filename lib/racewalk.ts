import type { PoseVerification } from "./wholebody";
export const ENGINE = "rw-2.9.2-contact-status";
export type Side = "L" | "R";
export type View = "side-left" | "side-right" | "front" | "rear";
export type Verdict = "pending" | "clear" | "watch" | "concern" | "unknown";
export type Point = { x: number; y: number; v: number };
export type TargetSelection = { id: string; time: number; anchor?: Point };
export type FrameTrack = { targetId: string; state: "locked" | "searching" | "lost" | "manual"; box?: [Point, Point]; note?: string; withheld?:Partial<Record<Side,string>>; continuity?:number; tentative?:boolean; verification?:PoseVerification; recovered?:Partial<Record<Side,{confirmedAt:number}>> };
export type TrackingRun = { method: "target-lock-v1" | "target-lock-v2"; targetId: string; status: "complete" | "lost" | "cancelled" | "partial"; lastTime: number; reason?: string; pipeline?:"full-rtmpose-v1"; identity?:"appearance-reid-v1" };
export type PoseFrame = { t: number; exact: boolean; points: Point[]; reason?: string; manual?: boolean; track?: FrameTrack };
export type EventKind = "IC" | "VERTICAL" | "TO" | "FLIGHT" | "NOTE";
export type WalkEvent = { id: string; t: number; side: Side; kind: EventKind; status: "pending" | "confirmed" | "rejected"; origin: "auto" | "manual"; note: string };
export type Settings = {
  athlete: string; date: string; view: View; direction: "right" | "left";
  pace: number | null; speed: "easy" | "race" | "fast";
  fps: number; sampleFps: number; slow: number; timingVerified: boolean;
  pain: "unknown" | "none" | "yes"; clearFeet: boolean;
  start: number; end: number; ground: [Point, Point] | null;
  roi: [Point, Point] | null; target?: TargetSelection; reviewer: string;
  groundStable?: boolean; contactMethod?: "hmm-ground-v1";
  smoothAngles?: boolean; uncertaintyEnabled?: boolean; pointSigmaPx?: number;
};
export type Report = {
  schema: 1; engine: string; id: string; version: number; created: string;
  settings: Settings; file: { name: string; size: number; duration: number; width: number; height: number; sha256: string };
  frames: PoseFrame[]; events: WalkEvent[];
  judge: { contact: Verdict; left: Verdict; right: Verdict };
  notes: string; complete: boolean; tracking?: TrackingRun;
};
export const VIEW_LABEL: Record<View, string> = { "side-left": "側面・左腳近鏡頭", "side-right": "側面・右腳近鏡頭", front: "正面", rear: "後面" };
export const EVENT_LABEL: Record<EventKind, string> = { IC: "首次接地", VERTICAL: "垂直位置", TO: "離地", FLIGHT: "雙腳離地疑慮", NOTE: "動作備註" };
export const VERDICT_LABEL: Record<Verdict, string> = { pending: "待人工複查", clear: "未見明顯疑慮", watch: "需要複查", concern: "明顯疑慮", unknown: "資料不足" };
export const SPEED_LABEL = { easy: "Easy 輕鬆", race: "Race 比賽", fast: "Fast 加速" };
export function defaults(): Settings {
  return { athlete: "陳宥蓁", date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()), view: "side-left", direction: "right", pace: null, speed: "easy", fps: 60, sampleFps: 30, slow: 1, timingVerified: false, pain: "unknown", clearFeet: false, start: 0, end: 15, ground: null, roi: null, reviewer: "", groundStable:false, contactMethod:"hmm-ground-v1", smoothAngles:false, uncertaintyEnabled:false, pointSigmaPx:2 };
}
export const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
// Retain timestamps as gaps, never bridge another target's observations.
export function scopeFrame(f: PoseFrame, s: Settings): PoseFrame {
  if (s.target && (f.track?.targetId !== s.target.id || f.t < s.target.time - s.slow / s.fps || f.track.state === "lost" || f.track.state === "searching"))
    return { ...f, points: [], reason: f.reason ?? "此幀不屬於目前追蹤目標" };
  if(f.track?.withheld)return {...f,points:f.points.map((p,i)=>i>=23&&f.track!.withheld![i%2?"L":"R"]?{...p,v:0}:p)};
  return f;
}
export function targetFrames(r: Report) { return r.frames.map(f => scopeFrame(f, r.settings)); }
export function selectTarget(r: Report, box: [Point,Point], time: number, targetId: string, reportId: string): Report {
  const separate=r.frames.length>0||r.events.length>0;
  return { ...r, engine:ENGINE, id:separate?reportId:r.id, version:separate?0:r.version,
    created:separate?new Date().toISOString():r.created, frames:[],events:[],tracking:undefined,complete:false,
    judge:{contact:"pending",left:"pending",right:"pending"},notes:separate?"":r.notes,
    settings:{...r.settings,start:time,end:r.settings.end>time+.05?r.settings.end:Math.min(r.file.duration,time+15),roi:box,target:{id:targetId,time},clearFeet:false,groundStable:false} };
}
export function trackingNotice(r: Report) {
  if (!r.settings.target) return r.frames.length ? "舊版未鎖定選手，可能混入他人資料。請載入原片，重新圈選分析；原紀錄保留供比對。" : "先暫停影片，圈選一位選手的全身，再開始追蹤。";
  if (r.tracking?.status === "lost") {
    if(r.tracking.method==="target-lock-v2")return `處理未完成（${timeText(r.tracking.lastTime)}）：${r.tracking.reason??"影片或模型無法繼續執行"}。已保留完成的影格，可重試分析。`;
    if(!hasAcquiredTarget(r))return `尚未鎖定目標（${timeText(r.tracking.lastTime)}）：${r.tracking.reason ?? "起始辨識未成功"}。目前沒有可用的目標量測；請調整圈選或換一個起始畫面。`;
    return `追蹤中斷於 ${timeText(r.tracking.lastTime)}：${r.tracking.reason ?? "無法確認同一位選手"}。中斷後不取值，請重新圈選建立下一片段。`;
  }
  if (r.tracking?.status === "cancelled") return "已停止分析，只保留停止前同一目標的資料。";
  if (r.tracking?.status === "complete") {
    const missing=r.frames.filter(f=>Object.keys(f.track?.withheld??{}).length).length,gaps=r.frames.filter(f=>f.track?.state==="searching").length;
    return `${r.tracking.method==="target-lock-v2"?"已掃描完整區間。":"此區間已完成目標追蹤。"}${gaps?`${gaps} 格搜尋／核對中，沒有取值。`:""}${missing?`${missing} 格有腿部缺值，未補算角度。`:""}請回看移動框與骨架，確認始終為同一選手。`;
  }
  if(r.tracking?.method==="target-lock-v2"&&r.tracking.status==="partial")return `已掃描至 ${timeText(r.tracking.lastTime)}；${r.frames.filter(f=>f.track?.state==="searching").length} 格搜尋／核對中，未取值。可繼續分析完整區間。`;
  return `已圈選 ${timeText(r.settings.target.time)} 的目標；從此畫面開始追蹤。`;
}
export function hasAcquiredTarget(r:Report){return !!r.settings.target&&r.frames.some(f=>f.track?.targetId===r.settings.target!.id&&f.track.state==="locked"&&!f.reason&&f.points.length===33);}
export function trackingBox(f:PoseFrame|null,s:Settings,time:number):{box:[Point,Point];label:string;warning:boolean;dashed:boolean}|null{
 const active=f?.track&&s.target&&f.track.targetId===s.target.id?f.track:null;
 if(active?.state==="searching"&&active.box)return {box:active.box,label:active.tentative?"核對目標・暫不取值":"搜尋中・最後確認位置",warning:true,dashed:true};
 if(active?.box)return {box:active.box,label:active.state==="lost"?"中斷・最後可靠位置":Object.keys(active.withheld??{}).length?"持續追蹤・腿部暫不取值":"追蹤目標",warning:active.state==="lost",dashed:active.state==="lost"};
 if(s.roi&&s.target&&Math.abs(time-s.target.time)<=Math.max(.05,s.slow/s.fps))return {box:s.roi,label:active?.state==="lost"?"圈選範圍・尚未鎖定":"圈選起點・等待辨識",warning:active?.state==="lost",dashed:true};
 return null;
}
function trackedWindow(r: Report, a: number, b: number, measurementSides:Side[]=[]) {
  if (!r.settings.target) return true; // Legacy reports are explicitly labelled, not rewritten.
  const step = r.settings.slow / Math.min(r.settings.fps, r.settings.sampleFps);
  const fs = targetFrames(r).filter(f => f.t >= a - step * .6 && f.t <= b + step * .6);
  return fs.length > 0 && fs[0].t <= a + step * .6 && fs[fs.length-1].t >= b - step * .6 && fs.every((f,i) => !f.reason && f.track?.state === "locked" && f.track.continuity===fs[0].track?.continuity && !measurementSides.some(side=>f.track?.withheld?.[side]) && (!i || f.t - fs[i-1].t <= step * 1.8));
}
export const isSide = (v: View) => v.startsWith("side-");
export const nearSide = (v: View): Side | null => v === "side-left" ? "L" : v === "side-right" ? "R" : null;
export function validPoint(p: Point | undefined) { return !!p && finite(p.x) && finite(p.y) && finite(p.v) && p.v >= .65 && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1; }
export function angle(a: Point, b: Point, c: Point, width: number, height: number): number | null {
  if (![a,b,c].every(validPoint) || !(width > 0 && height > 0)) return null;
  const ux=(a.x-b.x)*width, uy=(a.y-b.y)*height, vx=(c.x-b.x)*width, vy=(c.y-b.y)*height;
  const un=Math.hypot(ux,uy), vn=Math.hypot(vx,vy);
  if (un < 5 || vn < 5) return null;
  return Math.acos(Math.max(-1,Math.min(1,(ux*vx+uy*vy)/(un*vn))))*180/Math.PI;
}
export function knee(f: PoseFrame, side: Side, w: number, h: number, view: View): number | null {
  if (f.reason || f.track?.state==="searching" || f.track?.state==="lost" || f.track?.withheld?.[side] || nearSide(view) !== side || f.points.length !== 33) return null;
  const i=side==="L"?23:24;
  return angle(f.points[i],f.points[i+2],f.points[i+4],w,h);
}
export function torso(f: PoseFrame,w:number,h:number): number|null {
  const p=f.points; if(f.reason || f.track?.state==="searching" || f.track?.state==="lost" || ![p[11],p[12],p[23],p[24]].every(validPoint)) return null;
  const dx=((p[11].x+p[12].x)-(p[23].x+p[24].x))*w/2;
  const dy=((p[23].y+p[24].y)-(p[11].y+p[12].y))*h/2;
  return Math.atan2(dx,dy)*180/Math.PI;
}
export function pelvicTilt(f:PoseFrame,w:number,h:number,view:View):number|null {
  const p=f.points; if(isSide(view)||f.reason||f.track?.state==="searching"||f.track?.state==="lost"||![p[23],p[24]].every(validPoint))return null;
  const dx=Math.abs((p[24].x-p[23].x)*w); if(dx<10)return null;
  return Math.atan2((p[24].y-p[23].y)*h,dx)*180/Math.PI;
}
export function groundY(x:number,ground:[Point,Point]) {
  const [a,b]=ground; if(Math.abs(a.x-b.x)<.02)return null;
  return a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);
}
export function contactCandidate(f:PoseFrame, side:Side, s:Settings):"contact"|"air"|"unknown" {
  f = scopeFrame(f, s);
  if (!s.ground || !s.clearFeet || !isSide(s.view) || f.reason) return "unknown";
  const heel=f.points[side==="L"?29:30], toe=f.points[side==="L"?31:32];
  if(!validPoint(heel)||!validPoint(toe))return "unknown";
  const hy=groundY(heel.x,s.ground),ty=groundY(toe.x,s.ground);
  if(hy===null||ty===null)return "unknown";
  const dh=hy-heel.y, dt=ty-toe.y;
  if(dh<-.025||dt<-.025)return "unknown";
  if(Math.min(Math.abs(dh),Math.abs(dt))<=.015)return "contact";
  if(dh>.025&&dt>.025)return "air";
  return "unknown";
}
const median=(a:number[])=> {if(!a.length)return null;const b=[...a].sort((x,y)=>x-y);return b.length%2?b[(b.length-1)/2]:(b[b.length/2-1]+b[b.length/2])/2;};
export function candidateEvents(frames:PoseFrame[],s:Settings):WalkEvent[] {
  frames = frames.map(f => scopeFrame(f, s));
  if(!isSide(s.view)||frames.length<7)return [];
  const out:WalkEvent[]=[]; const sign=s.direction==="right"?1:-1;
  const add=(i:number,side:Side,kind:EventKind,note:string)=>out.push({id:`auto-${side}-${kind}-${i}`,t:frames[i].t,side,kind,status:"pending",origin:"auto",note});
  // Local maxima of heel relative to hip propose IC. This is kinematic localization,
  // never shoe-ground contact evidence. Only the near leg is used for knee windows.
  for(const side of ["L","R"] as Side[]){
    const hip=side==="L"?23:24,heel=side==="L"?29:30,ankle=side==="L"?27:28;
    const xs=frames.map(f=>!f.reason&&validPoint(f.points[hip])&&validPoint(f.points[heel])?sign*(f.points[heel].x-f.points[hip].x):null);
    let last=-Infinity;
    for(let i=2;i<frames.length-3;i++){
      const x=xs[i];if(x===null||x<.02||frames[i].t-last<.3*s.slow)continue;
      const around=[xs[i-2],xs[i-1],xs[i+1],xs[i+2]];
      if(frames.slice(i-2,i+3).some(f=>f.track?.continuity!==frames[i].track?.continuity))continue;
      if(around.some(v=>v===null)||!around.every(v=>x>=(v as number))||!(x>(xs[i-2] as number)||x>(xs[i+2] as number)))continue;
      add(i,side,"IC","足跟前伸極值候選；必須回看鞋底確認首次接地。");last=frames[i].t;
      let best=-1,bestD=Infinity,back=-1,backX=Infinity;
      for(let j=i+1;j<frames.length&&frames[j].t-frames[i].t<.65*s.slow;j++){
        const f=frames[j];if(f.reason||f.track?.withheld?.[side]||f.track?.continuity!==frames[i].track?.continuity)break;if(!validPoint(f.points[hip])||!validPoint(f.points[ankle]))continue;
        const d=Math.abs(f.points[hip].x-f.points[ankle].x);
        if(d<bestD){bestD=d;best=j;}
        if(xs[j]!==null&&(xs[j] as number)<backX){backX=xs[j] as number;back=j;}
      }
      if(best>i&&bestD<.05)add(best,side,"VERTICAL","髖踝對位候選；並非正式規則的自動判定。");
      if(back>best&&backX<-.015)add(back,side,"TO","足部後伸極值候選；必須確認最後接地幀。");
    }
  }
  let flight=false;
  for(let i=0;i<frames.length;i++){
    const both=contactCandidate(frames[i],"L",s)==="air"&&contactCandidate(frames[i],"R",s)==="air";
    if(both&&!flight)add(i,"L","FLIGHT","兩腳關鍵點高於已標地面；只是候選，需看原片鞋底。");
    flight=both;
  }
  return out.sort((a,b)=>a.t-b.t).slice(0,500);
}
export function nearestFrame(frames:PoseFrame[],t:number) {
  if(!frames.length)return null;
  let lo=0,hi=frames.length-1;
  while(lo<hi){const m=Math.floor((lo+hi)/2);if(frames[m].t<t)lo=m+1;else hi=m;}
  return lo>0&&Math.abs(frames[lo-1].t-t)<Math.abs(frames[lo].t-t)?frames[lo-1]:frames[lo];
}
export function kneeWindows(r:Report,confirmed=true) {
  const ev=r.events.filter(e=>e.status!==(confirmed?"pending":"rejected")&&e.status!=="rejected").sort((a,b)=>a.t-b.t);
  const result:{side:Side;start:number;end:number;min:number;valid:number;total:number;confirmed:boolean}[]=[];
  for(const ic of ev.filter(e=>e.kind==="IC")){
    const v=ev.find(e=>e.side===ic.side&&e.kind==="VERTICAL"&&e.t>ic.t&&e.t-ic.t<1*r.settings.slow);
    const nextIC=ev.find(e=>e.side===ic.side&&e.kind==="IC"&&e.t>ic.t);
    if(!v ||(nextIC&&v.t>=nextIC.t))continue;
    if(!trackedWindow(r,ic.t,v.t,[ic.side]))continue;
    const fs=targetFrames(r).filter(f=>f.t>=ic.t&&f.t<=v.t);
    const values=fs.map(f=>knee(f,ic.side,r.file.width,r.file.height,r.settings.view)).filter(finite);
    if(values.length<2||values.length/fs.length<.7)continue;
    result.push({side:ic.side,start:ic.t,end:v.t,min:Math.min(...values),valid:values.length,total:fs.length,confirmed:ic.status==="confirmed"&&v.status==="confirmed"});
  }
  return result;
}
export function cadence(r:Report):number|null {
  if(!r.settings.timingVerified)return null;
  const es=r.events.filter(e=>e.kind==="IC"&&e.status==="confirmed").sort((a,b)=>a.t-b.t);
  if(es.length<3||es.some((e,i)=>i>0&&(e.side===es[i-1].side||(e.t-es[i-1].t)/r.settings.slow<.15||(e.t-es[i-1].t)/r.settings.slow>1.2)))return null;
  if(!trackedWindow(r,es[0].t,es[es.length-1].t,["L","R"]))return null;
  const span=(es[es.length-1].t-es[0].t)/r.settings.slow;
  return span>0?60*(es.length-1)/span:null;
}
export function flights(r:Report) {
  if(!r.settings.timingVerified)return [];
  const es=r.events.filter(e=>e.status==="confirmed"&&(e.kind==="IC"||e.kind==="TO")).sort((a,b)=>a.t-b.t);
  const result:{start:number;end:number;direction:string;ms:number;uncertainty:number}[]=[];
  for(let i=0;i<es.length-1;i++){
    const a=es[i],b=es[i+1];
    if(a.kind!=="TO"||b.kind!=="IC"||a.side===b.side||b.t<=a.t||(b.t-a.t)/r.settings.slow>.15)continue;
    if(!trackedWindow(r,a.t,b.t,["L","R"]))continue;
    const fa=nearestFrame(targetFrames(r),a.t),fb=nearestFrame(targetFrames(r),b.t);
    if(!fa?.exact||!fb?.exact||Math.abs(fa.t-a.t)>r.settings.slow/r.settings.fps*.6||Math.abs(fb.t-b.t)>r.settings.slow/r.settings.fps*.6)continue;
    // Effective extraction resolution, never the phone's nominal FPS alone.
    const dts=r.frames.slice(1).map((f,j)=>f.t-r.frames[j].t).filter(t=>t>0);
    const local=r.frames.slice(1).map((f,j)=>({a:r.frames[j].t,b:f.t,dt:f.t-r.frames[j].t})).filter(g=>g.a<=b.t&&g.b>=a.t).map(g=>g.dt);
    const dt=Math.max(median(dts)??r.settings.slow/r.settings.fps,r.settings.slow/r.settings.fps,...local);
    result.push({start:a.t,end:b.t,direction:`${a.side}→${b.side}`,ms:1000*(b.t-a.t)/r.settings.slow,uncertainty:2000*dt/r.settings.slow});
  }
  return result;
}
export function summarize(r:Report) {
  const windows=kneeWindows(r), left=windows.filter(w=>w.side==="L"),right=windows.filter(w=>w.side==="R");
  const usable=targetFrames(r).filter(f=>!f.reason&&f.points.length===33).length;
  return { frames:r.frames.length, usable, coverage:r.frames.length?100*usable/r.frames.length:null,
    leftMin:median(left.map(w=>w.min)),rightMin:median(right.map(w=>w.min)),leftCount:left.length,rightCount:right.length,
    leftReview:left.filter(w=>w.min<170).length,rightReview:right.filter(w=>w.min<170).length,
    cadence:cadence(r),flightCount:flights(r).length,
    pending:r.events.filter(e=>e.status==="pending").length,confirmed:r.events.filter(e=>e.status==="confirmed").length };
}
export function nextSteps(r:Report):{title:string;reason:string;action:string}[] {
  if(r.settings.pain==="yes")return [{title:"停止速度訓練",reason:"本次記錄有髖部不適或疼痛。",action:"暫停競走速度測試，依症狀安排專業評估；不要依此報告加量。"}];
  if(r.settings.pain==="unknown")return [{title:"先補上症狀狀態",reason:"尚未確認活動中是否髖痛或跛行。",action:"請先記錄症狀，再由教練決定下一次練習。"}];
  const a=summarize(r),out:{title:string;reason:string;action:string}[]=[];
  if(a.pending>0||!a.confirmed)out.push({title:"先完成關鍵事件複查",reason:`尚有${a.pending}個候選事件待確認。`,action:"先看正常速度，再確認IC與Vertical；移除錯誤候選，不用為湊數全部確認。"});
  if(a.leftReview+a.rightReview>0)out.push({title:"低速重拍伸膝窗口",reason:"已確認窗口內出現低於170°的二維估計值；門檻未校準。",action:"由教練確認是否屈膝；無痛時練習平順著地與自然伸膝，再以相同速度重拍，不強鎖膝。"});
  if(a.flightCount||r.judge.contact==="watch"||r.judge.contact==="concern")out.push({title:"複查雙腳交替",reason:"接觸事件或正常速度觀察有疑慮。",action:"先降速，檢查跨步與向上推蹬；一次只改一項，再看原片，不以毫秒宣判犯規。"});
  if(!out.length)out.push({title:"保持條件建立基準",reason:"本段尚無足夠證據要求特定動作矯正。",action:"下次維持相同鏡位、配速與鞋款，記錄症狀；不因單次影片自動加速。"});
  return out.slice(0,3);
}
export function paceText(sec:number|null,decimals=false) {if(sec===null||!finite(sec)||sec<=0)return "未記錄";const rounded=Math.round(sec*(decimals?10:1))/(decimals?10:1);const m=Math.floor(rounded/60);return `${m}:${(rounded-m*60).toFixed(decimals?1:0).padStart(decimals?4:2,"0")}`;}
export function parsePace(s:string):number|null {const m=s.trim().match(/^(\d{1,2}):([0-5]\d)(?:\.(\d))?$/);if(!m)return null;const v=Number(m[1])*60+Number(m[2])+Number(m[3]||0)/10;return v>0?v:null;}
export function timeText(t:number) {return `${Math.floor(t/60).toString().padStart(2,"0")}:${(t%60).toFixed(2).padStart(5,"0")}`;}
