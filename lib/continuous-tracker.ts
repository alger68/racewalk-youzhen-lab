import { TargetTracker, appearanceDistance, type TargetCandidate } from "./target-tracker";
import type { Point, PoseFrame, TargetSelection } from "./racewalk";
import { confirmObservedPrevious } from "./observed-recovery";

type Box=[Point,Point];
type Reference=NonNullable<ReturnType<TargetTracker["reference"]>>;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));

/** Processing continues through uncertainty. Each observed frame is either a
 * measurement, a missing-value search, or a provisional identity check. Only
 * three unique, corroborated observations can start a new measured interval.
 * Long absence cannot establish identity from matching clothes alone. */
export class ContinuousTargetTracker {
 private active:TargetTracker;
 private trusted:Reference|null=null;
 private searching=false;
 private probe:{candidate:TargetCandidate;t:number;start:number;count:number}|null=null;
 private continuity=0;
 private unresolvedCrossing=false;
 constructor(private selection:TargetSelection,private seed:Box,private width:number,private height:number,private slow=1){this.active=new TargetTracker(selection,seed,width,height,slow);}
 confirmPrevious(previous:PoseFrame,current:PoseFrame){return confirmObservedPrevious(previous,current,this.active.takeLimbConfirmations(),this.slow);}
 private distance(a:Point,b:Point){return Math.hypot((a.x-b.x)*this.width,(a.y-b.y)*this.height);}
 private rememberCrossing(candidates:TargetCandidate[]){
  const r=this.trusted;if(!r)return;
  const similar=candidates.filter(c=>this.distance(c.center,r.candidate.center)/r.candidate.scale<1.5&&Math.min(...r.appearances.map(a=>appearanceDistance(c.appearance,a)))<.25);
  // Two separately detected, near-identical uniforms crossing cannot be
  // disambiguated when just one reappears. Keep scanning, but never let the
  // disappearing competitor manufacture uniqueness or a new identity.
  this.unresolvedCrossing ||= similar.some((a,i)=>similar.slice(i+1).some(b=>(!a.detectionPasses||!b.detectionPasses||a.detectionPasses.some(p=>b.detectionPasses!.includes(p)))&&this.distance(a.center,b.center)<Math.min(a.scale,b.scale)*.9&&appearanceDistance(a.appearance,b.appearance)<.15));
 }
 private measured(frame:PoseFrame){
  this.trusted=this.active.reference();
  return {...frame,track:{...frame.track!,continuity:this.continuity}};
 }
 private missing(t:number,exact:boolean,reason:string):PoseFrame{
  const box=this.probe?.candidate.box??this.trusted?.box;
  return {t,exact,points:[],reason,track:{targetId:this.selection.id,state:"searching",continuity:this.continuity,...(box?{box}:{}),...(this.probe?{tentative:true}:{}),note:"影片持續掃描，這一格不取值。"}};
 }
 suspend(t:number,exact:boolean,reason:string){
  this.searching=true;this.probe=null;
  return this.missing(t,exact,reason);
 }
 // A real decoder/worker failure remains explicit; it is not an identity loss.
 stop(t:number,exact:boolean,reason:string):PoseFrame{return {...this.missing(t,exact,reason),track:{targetId:this.selection.id,state:"lost",continuity:this.continuity,...(this.trusted?{box:this.trusted.box}:{})}};}
 regionAt(t:number):Box{
  if(!this.searching)return this.trusted?.box??this.seed;
  if(this.probe)return this.probe.candidate.box;
  if(!this.trusted)return this.seed;
  const r=this.trusted,dt=Math.min(.5,Math.max(0,(t-r.t)/this.slow)),pad=r.candidate.scale*Math.min(.8,dt);
  return r.box.map((p,i)=>({x:clamp(p.x+r.velocity.x*dt+(i?pad:-pad)/this.width),y:clamp(p.y+r.velocity.y*dt+(i?pad:-pad)/this.height),v:1})) as Box;
 }
 update(candidates:TargetCandidate[],t:number,exact:boolean,detectedPoses?:number):PoseFrame{
  if(!this.searching){
   const frame=this.active.update(candidates,t,exact,detectedPoses);
   if(frame.track?.state!=="locked")this.rememberCrossing(candidates);
   return frame.track?.state==="locked"?this.measured(frame):this.suspend(t,exact,frame.reason??"本格尚未確認目標");
  }
  const reference=this.trusted;
  if(!reference)return this.suspend(t,exact,"起始畫面尚未建立可靠目標，繼續掃描並保留缺值。");
  if(this.unresolvedCrossing)return this.suspend(t,exact,"相似衣著的人物曾交錯，仍無法區分身分；持續掃描並保留缺值。");
  const gap=(t-reference.t)/this.slow;
  if(gap<=0||gap>1.5)return this.suspend(t,exact,"目標身分仍無法確認，繼續掃描；不依相似衣著自動認定同一人。");
  const last=reference.candidate,dt=Math.min(gap,.35);
  const predicted={x:last.center.x+reference.velocity.x*dt,y:last.center.y+reference.velocity.y*dt,v:1};
  // Rank every spatial/appearance competitor first. A poorly observed rival
  // cannot disappear from the ambiguity check just because it lacks consensus.
  const ranked=candidates.map(c=>{
   const colour=Math.min(...reference.appearances.map(a=>appearanceDistance(c.appearance,a))),d=this.distance(c.center,predicted)/last.scale,size=c.scale/last.scale;
   return {c,colour,score:d+colour*1.5,valid:colour<=.25&&size>=.75&&size<=1.33&&d<=.35+6*dt&&this.distance(c.center,last.center)/last.scale<=.4+6*dt};
  }).filter(r=>r.valid).sort((a,b)=>a.score-b.score);
  if(!ranked.length)return this.suspend(t,exact,"尚未找到與原目標位置及衣著相符的骨架，持續搜尋。");
  if(ranked.length>1&&ranked[1].score-ranked[0].score<.3){this.rememberCrossing(ranked.map(r=>r.c));return this.suspend(t,exact,"有多個相似目標，持續搜尋並暫不取值。");}
  const candidate=ranked[0].c;
  if(!candidate.torsoVerified||![0,11,12,23,24].every(i=>candidate.points[i].v>=.75))return this.suspend(t,exact,"已找到可能目標，等待不同辨識範圍確認軀幹。");
  const trial=new TargetTracker({...this.selection,time:t,anchor:candidate.center},candidate.box,this.width,this.height,this.slow);
  trial.resetMeasurements();
  const checked=trial.update(candidates,t,exact,detectedPoses);
  if(checked.track?.state!=="locked")return this.suspend(t,exact,"附近仍有遮擋或目標歧義，持續搜尋並暫不取值。");
  const p=this.probe,elapsed=p?(t-p.t)/this.slow:0;
  const consistent=p&&elapsed>0&&elapsed<=.2&&this.distance(candidate.center,p.candidate.center)/p.candidate.scale<=.3+6*elapsed&&appearanceDistance(candidate.appearance,p.candidate.appearance)<=.15&&candidate.scale/p.candidate.scale>=.85&&candidate.scale/p.candidate.scale<=1.18;
  this.probe={candidate:structuredClone(candidate),t,start:consistent?p.start:t,count:consistent?p.count+1:1};
  if(this.probe.count<3||(t-this.probe.start)/this.slow<.05)return this.missing(t,exact,`正在核對原目標 ${Math.min(3,this.probe.count)}/3，暫不取值。`);
  this.active=trial;this.searching=false;this.probe=null;this.continuity++;
  return this.measured({...checked,track:{...checked.track!,note:`已重新確認目標；${checked.track?.note??"關節量測重新確認中。"}`}});
 }
}
