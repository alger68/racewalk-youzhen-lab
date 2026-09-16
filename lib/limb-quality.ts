import type { Point, Side } from "./racewalk";
import type { TargetCandidate } from "./target-tracker";

type Snapshot={points:Point[];center:Point;scale:number;t:number;compared:number[]};
export type LimbConfirmation={side:Side;t:number;points:Point[]};
export const RECOVERY_PENDING="點位重新出現，等待連續兩格穩定";
type SideState={trusted:Snapshot|null;held:boolean;clean:number;pending:Snapshot|null};
const sides=["L","R"] as const;
const ids=(side:Side)=>side==="L"?[23,25,27,29,31]:[24,26,28,30,32];
const usable=(p:Point|undefined,confidence=.65)=>!!p&&p.v>=confidence&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;

/** Joint confidence is independent of torso identity. A bad leg never becomes
 * the reference for the next measurement. Only observed points are returned;
 * this gate neither smooths, swaps, nor interpolates joint coordinates. */
export class LimbQuality {
 private states:Record<Side,SideState>={L:{trusted:null,held:false,clean:0,pending:null},R:{trusted:null,held:false,clean:0,pending:null}};
 private confirmations:LimbConfirmation[]=[];
 constructor(private width:number,private height:number,private slow:number){}
 beginGap(){this.confirmations=[];for(const side of sides)this.states[side]={trusted:null,held:true,clean:0,pending:null};}
 takeConfirmations(){const result=this.confirmations;this.confirmations=[];return result;}
 private relative(p:Point,s:{center:Point;scale:number}){return {x:(p.x-s.center.x)*this.width/s.scale,y:(p.y-s.center.y)*this.height/s.scale};}
 private delta(a:Point,ac:{center:Point;scale:number},b:Point,bc:{center:Point;scale:number}){
  const x=this.relative(a,ac),y=this.relative(b,bc);return Math.hypot(x.x-y.x,x.y-y.y);
 }
 private jumps(c:TargetCandidate,old:Snapshot,side:Side,t:number){
  const dt=Math.min(.15,Math.max(0,(t-old.t)/this.slow));
  return ids(side).slice(1).some(i=>!c.verification?.rejected.includes(i)&&usable(c.points[i],.55)&&usable(old.points[i],.55)&&this.delta(c.points[i],c,old.points[i],old)>.55+10*dt);
 }
 private shapeChanged(c:TargetCandidate,old:Snapshot,side:Side){
  const [hip,knee,ankle]=ids(side);
  return [[hip,knee],[knee,ankle]].some(([a,b])=>{
   if(![c.points[a],c.points[b],old.points[a],old.points[b]].every(p=>usable(p)))return true;
   const before=this.delta(old.points[a],old,old.points[b],old),after=this.delta(c.points[a],c,c.points[b],c);
   return before<.04||after<.04||after/before<.4||after/before>2;
  });
 }
 evaluate(c:TargetCandidate,rivals:TargetCandidate[],t:number):Partial<Record<Side,string>>{
  this.confirmations=[];
  const withheld:Partial<Record<Side,string>>={};
  const snapshot=():Snapshot=>({points:c.points.map((p,i)=>({...p,...(c.verification?.rejected.includes(i)?{v:0}:{})})),center:{...c.center},scale:c.scale,t,compared:c.verification?.compared??[]});
  for(const side of sides){
   const state=this.states[side],jointIds=ids(side);
   let reason=c.measurementReasons?.[side]??(c.uncertainSides?.includes(side)?"點位在不同辨識範圍不一致":undefined);
   if(jointIds.slice(0,3).some(i=>!usable(c.points[i])))reason??="髖、膝或踝不清楚";
   // Keep the raw cross-athlete check even if this side was already masked by
   // a disagreement between crops. Only that side is suppressed when torsos
   // are distinct; identity ambiguity is still latched by TargetTracker.
   const collision=rivals.some(r=>jointIds.slice(1,3).some(i=>usable(c.points[i],.55)&&[25,26,27,28].some(j=>usable(r.points[j],.55)&&Math.hypot((c.points[i].x-r.points[j].x)*this.width,(c.points[i].y-r.points[j].y)*this.height)<Math.min(c.scale,r.scale)*.18)));
   if(collision)reason="腿部點位與其他骨架過近，疑似交錯遮擋";
   if(state.trusted&&this.jumps(c,state.trusted,side,t))reason??="腿部點位突然跳動";
   if(state.held&&state.trusted&&this.shapeChanged(c,state.trusted,side))reason??="腿部形狀仍與可靠點位不一致";
   // After a longer missing interval, local smoothness alone is insufficient:
   // require fresh agreement from multiple crops of the same tracked torso.
   if(state.held&&(!state.trusted||(t-state.trusted.t)/this.slow>.2)&&!c.verifiedSides?.includes(side))reason??="等待不同辨識範圍重新確認腿部";
   if(reason){state.held=true;state.clean=0;state.pending=null;withheld[side]=reason;continue;}
   if(state.held){
    if(state.pending&&(t<=state.pending.t||(t-state.pending.t)/this.slow>.2||this.jumps(c,state.pending,side,t)||this.shapeChanged(c,state.pending,side))){state.clean=0;state.pending=null;withheld[side]="重新出現的點位仍不穩定";continue;}
    // Confirm the preceding observed sample only after this second clean
    // sample. No rejected/hidden sample is kept for later reconstruction.
    if(state.pending&&jointIds.slice(0,3).every(i=>state.pending!.compared.includes(i)&&c.verification?.compared.includes(i)))this.confirmations.push({side,t:state.pending.t,points:state.pending.points});
    state.clean++;state.pending=snapshot();
    if(state.clean<2){withheld[side]=RECOVERY_PENDING;continue;}
   }
   state.trusted=snapshot();state.held=false;state.clean=0;state.pending=null;
  }
  return withheld;
 }
}
