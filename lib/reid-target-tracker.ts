import { TargetTracker, type TargetCandidate } from "./target-tracker";
import { PersonMemory, type PersonObservation } from "./person-memory";
import { confirmObservedPrevious } from "./observed-recovery";
import type { Point, PoseFrame, TargetSelection } from "./racewalk";

/** Identity association and observed-joint validity are independent gates. */
export class ReidTargetTracker {
 private memory:PersonMemory;
 private active:TargetTracker;
 private target?:number;
 private first=true;
 private searching=false;
 private continuity=0;
 private confirmations=0;
 private previousTime=-Infinity;
 private probeStart=0;
 private box:[Point,Point];
 constructor(private selection:TargetSelection,seed:[Point,Point],private w:number,private h:number,private slow=1){
  this.box=seed;this.memory=new PersonMemory(w,h,slow);this.active=new TargetTracker(selection,seed,w,h,slow);
 }
 regionAt(_t:number){return this.box;}
 confirmPrevious(previous:PoseFrame,current:PoseFrame){return confirmObservedPrevious(previous,current,this.active.takeLimbConfirmations(),this.slow);}
 suspend(t:number,exact:boolean,reason:string):PoseFrame{
  this.searching=true;this.confirmations=0;
  return this.missing(t,exact,reason);
 }
 private missing(t:number,exact:boolean,reason:string):PoseFrame{return {t,exact,points:[],reason,track:{targetId:this.selection.id,state:"searching",continuity:this.continuity,box:this.box,note:"持續核對所有人物的外觀與移動紀錄；本格不取值。"}};}
 stop(t:number,exact:boolean,reason:string):PoseFrame{return {...this.missing(t,exact,reason),track:{targetId:this.selection.id,state:"lost",continuity:this.continuity,box:this.box}};}
 update(observations:PersonObservation[],t:number,exact:boolean,detectedPoses?:number):PoseFrame{
  const matches=this.memory.update(observations,t),candidates=observations.map(o=>o.candidate);
  if(this.first){
   this.first=false;
   const f=this.active.update(candidates,t,exact,detectedPoses),reference=this.active.reference();
   const match=reference&&matches.find(m=>m.candidate.center.x===reference.candidate.center.x&&m.candidate.center.y===reference.candidate.center.y);
   if(f.track?.state!=="locked"||!match)return this.suspend(t,exact,f.reason??"圈選畫面尚未建立可靠外觀，請換清楚畫面圈選。");
   this.target=match.id;this.box=f.track.box!;
   return {...f,track:{...f.track,continuity:0}};
  }
  const match=matches.find(m=>m.id===this.target);
  if(this.target!==undefined&&!this.memory.has(this.target))return this.suspend(t,exact,"目標超過三秒未能可靠核對；影片繼續掃描。請在清楚畫面重新圈選建立新片段。");
  if(!match)return this.suspend(t,exact,"目標外觀或移動紀錄尚未唯一匹配，持續搜尋；不混入其他人物。");
  if(this.searching){
   if(!match.established||!match.candidate.torsoVerified)return this.suspend(t,exact,"已找到可能目標，等待連續外觀與軀幹核對。");
   const trial=new TargetTracker({...this.selection,time:t,anchor:match.candidate.center},match.candidate.box,this.w,this.h,this.slow);
   trial.resetMeasurements();
   const checked=trial.update(candidates,t,exact,detectedPoses);
   if(checked.track?.state!=="locked")return this.suspend(t,exact,checked.reason??"軀幹仍有歧義，持續搜尋。");
   const dt=(t-this.previousTime)/this.slow;
   if(dt<=0||dt>.2){this.confirmations=0;this.probeStart=t;}
   this.previousTime=t;this.confirmations++;this.box=checked.track.box!;
   if(this.confirmations<3||(t-this.probeStart)/this.slow<.05)return this.missing(t,exact,`外觀與移動紀錄重新核對 ${Math.min(3,this.confirmations)}/3，暫不取值。`);
   this.active=trial;this.searching=false;this.continuity++;
   return {...checked,track:{...checked.track,continuity:this.continuity,note:`外觀與移動紀錄已重新核對；${checked.track.note??"關節重新確認中。"}`}};
  }
  const frame=this.active.update(candidates,t,exact,detectedPoses),reference=this.active.reference();
  if(frame.track?.state!=="locked")return this.suspend(t,exact,frame.reason??"本格尚未確認目標。");
  if(!reference||reference.candidate.center.x!==match.candidate.center.x||reference.candidate.center.y!==match.candidate.center.y)return this.suspend(t,exact,"外觀模型與位置追蹤指向不同人物，暫不取值。");
  this.box=frame.track.box!;return {...frame,track:{...frame.track,continuity:this.continuity}};
 }
}
