import type { Point, PoseFrame, Side, TargetSelection } from "./racewalk";
import { LimbQuality } from "./limb-quality";
import type { PoseVerification } from "./wholebody";

type Box = [Point, Point];
export type TargetCandidate = {
  points: Point[]; box: Box; torsoBox: Box;
  center: Point; shoulder: Point; hip: Point; scale: number;
  appearance: number[];
  verification?:PoseVerification;
  measurementReasons?:Partial<Record<Side,string>>;
  torsoConflict?:boolean;
  uncertainSides?: Side[];
  verifiedSides?: Side[];
  torsoVerified?: boolean;
  // Pass provenance is kept in memory to distinguish two detections in one
  // image from inconsistent estimates of one body across different crops.
  detectionPasses?: number[];
};
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const usable = (p: Point | undefined) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.v >= .55 && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
const mean = (ps: Point[]): Point => ({ x: ps.reduce((s,p) => s+p.x,0)/ps.length, y: ps.reduce((s,p) => s+p.y,0)/ps.length, v: 1 });
const distance = (a: Point, b: Point, w: number, h: number) => Math.hypot((a.x-b.x)*w,(a.y-b.y)*h);
const inside = (p: Point, box: Box) => p.x >= box[0].x && p.x <= box[1].x && p.y >= box[0].y && p.y <= box[1].y;
export const orderedBox = (b: Box): Box => [{x:Math.min(b[0].x,b[1].x),y:Math.min(b[0].y,b[1].y),v:1},{x:Math.max(b[0].x,b[1].x),y:Math.max(b[0].y,b[1].y),v:1}];

export function candidateGeometry(points: Point[], w: number, h: number): TargetCandidate | null {
  if (points.length !== 33) return null;
  const shoulderPoints = [points[11],points[12]].filter(usable), hipPoints = [points[23],points[24]].filter(usable);
  if (!shoulderPoints.length || !hipPoints.length || shoulderPoints.length+hipPoints.length < 3) return null;
  const shoulder=mean(shoulderPoints), hip=mean(hipPoints), center=mean([shoulder,hip]);
  const scale=distance(shoulder,hip,w,h), good=points.filter(usable);
  // A race-walking target is upright in the video. The detector can hallucinate
  // a high-confidence inverted body on the athlete/shadow in a distant view.
  // Such a result must not become a second person or veto a clear focused pose.
  if ((hip.y-shoulder.y)*h < Math.max(12,scale*.4)) return null;
  const head=[points[0],points[7],points[8]].filter(usable);
  if(head.length&&mean(head).y>hip.y+scale*.1/h)return null;
  const ys=good.map(p=>p.y), xs=good.map(p=>p.x);
  if (scale < 25 || (Math.max(...ys)-Math.min(...ys))*h < 160) return null;
  const box: Box=[{x:clamp(Math.min(...xs)-.012),y:clamp(Math.min(...ys)-.016),v:1},{x:clamp(Math.max(...xs)+.012),y:clamp(Math.max(...ys)+.016),v:1}];
  const torsoWidth=Math.max(scale*.25,...[shoulderPoints,hipPoints].map(ps=>ps.length===2?distance(ps[0],ps[1],w,h):0));
  const torsoBox: Box=[{x:clamp(center.x-torsoWidth/w/2),y:clamp(Math.min(shoulder.y,hip.y)),v:1},{x:clamp(center.x+torsoWidth/w/2),y:clamp(Math.max(shoulder.y,hip.y)),v:1}];
  return {points,box,torsoBox,center,shoulder,hip,scale,appearance:[]};
}

// Small shirt-colour descriptor. It supplements motion; it is not face recognition,
// a biometric ID, or a calibrated identity probability. Kept in memory only.
export function colourSignature(rgb: number[]): number[] {
  if (rgb.length < 18 || rgb.length % 3 || rgb.some(v=>!Number.isFinite(v)||v<0||v>255)) return [];
  const bins=Array(12).fill(0) as number[];
  for(let i=0;i<rgb.length;i++) bins[(i%3)*4+Math.min(3,Math.floor(rgb[i]/64))]++;
  return bins.map(v=>v/(rgb.length/3));
}
export function appearanceDistance(a: number[], b: number[]) {
  if(a.length!==12||b.length!==12) return Infinity;
  return a.reduce((n,v,i)=>n+Math.abs(v-b[i]),0)/6;
}
function overlap(a: Box,b: Box) {
  const area=(r:Box)=>Math.max(0,r[1].x-r[0].x)*Math.max(0,r[1].y-r[0].y);
  const intersection=Math.max(0,Math.min(a[1].x,b[1].x)-Math.max(a[0].x,b[0].x))*Math.max(0,Math.min(a[1].y,b[1].y)-Math.max(a[0].y,b[0].y));
  return intersection/Math.max(1e-8,Math.min(area(a),area(b)));
}
function independentlyDetected(a:TargetCandidate,b:TargetCandidate){
  return !a.detectionPasses||!b.detectionPasses||a.detectionPasses.some(pass=>b.detectionPasses!.includes(pass));
}

/** Guard for one measured interval. Loss is latched in this instance; only the
 * outer continuous tracker may seed a fresh interval after verified recovery.
 * Detector array indices are never identities.
 * Thresholds are engineering guards, not a claimed identity accuracy guarantee. */
export class TargetTracker {
  private anchor: TargetCandidate | null=null;
  private last: TargetCandidate | null=null;
  private lastTime: number | null=null;
  private velocity={x:0,y:0};
  private lostReason: string | null=null;
  private seed: Box;
  private box:Box|null=null;
  private appearances:number[][]=[];
  private limbQuality:LimbQuality;
  constructor(private selection: TargetSelection, seed: Box, private width: number, private height: number, private slow=1) { this.seed=orderedBox(seed);this.limbQuality=new LimbQuality(width,height,slow); }
  reference(){return this.last&&this.lastTime!==null&&this.box?structuredClone({candidate:this.last,t:this.lastTime,velocity:this.velocity,box:this.box,appearances:this.appearances}):null;}
  resetMeasurements(){this.limbQuality.beginGap();}
  takeLimbConfirmations(){return this.limbQuality.takeConfirmations();}
  stop(t:number,exact:boolean,reason:string):PoseFrame {
    this.lostReason??=reason;
    return {t,exact,points:[],reason:this.lostReason,track:{targetId:this.selection.id,state:"lost",...(this.box?{box:this.box}:{})}};
  }
  update(candidates: TargetCandidate[], t:number, exact:boolean,detectedPoses?:number):PoseFrame {
    if(this.lostReason) return this.stop(t,exact,this.lostReason);
    let chosen:TargetCandidate;
    if(!this.last){
      if(Math.abs(t-this.selection.time)>Math.max(.05,this.slow*.05))return this.stop(t,exact,"起始畫面與圈選時間不一致，請重新圈選");
      const matches=candidates.filter(c=>inside(c.center,this.seed)&&inside(c.shoulder,this.seed)&&inside(c.hip,this.seed)&&c.appearance.length===12&&(!this.selection.anchor||distance(c.center,this.selection.anchor,this.width,this.height)<c.scale*.4));
      if(matches.length!==1)return this.stop(t,exact,matches.length>1?"圈選範圍內有多個可能目標，請只框住一位選手":detectedPoses===0?"模型在全景、圈選區及周圍均未偵測到骨架；請換一個清楚畫面再圈選":!candidates.length?"已嘗試辨識，但肩、髖或身體大小未通過追蹤檢查；請選全身較清楚的畫面":"有偵測到選手，但沒有唯一的軀幹落在圈選內；請確認圈選的是目標全身");
      chosen=matches[0];
      const bodyRatio=(chosen.box[1].y-chosen.box[0].y)/(this.seed[1].y-this.seed[0].y);
      if(bodyRatio<.55||bodyRatio>1.55)return this.stop(t,exact,"圈選範圍與選手全身大小不符");
    }else{
      const dt=(t-this.lastTime!)/this.slow;
      if(dt<=0||dt>.2)return this.stop(t,exact,"相鄰影格時間差過大，無法保持目標連續性");
      const predicted={x:this.last.center.x+this.velocity.x*dt,y:this.last.center.y+this.velocity.y*dt,v:1};
      const last=this.last,anchor=this.anchor!;
      const ranked=candidates.map(c=>{
        const displacement=distance(c.center,last.center,this.width,this.height)/last.scale;
        const predictedDistance=distance(c.center,predicted,this.width,this.height)/last.scale;
        const size=c.scale/last.scale,anchorSize=c.scale/anchor.scale;
        const colour=Math.min(...this.appearances.map(a=>appearanceDistance(c.appearance,a))),recentColour=appearanceDistance(c.appearance,last.appearance);
        return {c,displacement,score:predictedDistance*.7+displacement*.3+colour*.9+Math.abs(Math.log(size))*.3,
          plausible:displacement<=.3+6*dt&&predictedDistance<=.3+6*dt&&size>=.72&&size<=1.38&&anchorSize>=.45&&anchorSize<=2.25&&colour<=.45&&recentColour<=.35};
      }).filter(v=>v.plausible).sort((a,b)=>a.score-b.score);
      if(!ranked.length)return this.stop(t,exact,"目標消失、被遮擋，或位置／衣著特徵不連續");
      if(ranked.length>1&&ranked[1].score-ranked[0].score<.18)return this.stop(t,exact,"有多組接近的骨架結果，無法確認同一目標，停止取值");
      chosen=ranked[0].c;
    }
    if(chosen.torsoConflict)return this.stop(t,exact,"兩套模型指向不同的頭肩位置，暫停取值並繼續核對身分");
    const overlapping=candidates.find(c=>c!==chosen&&overlap(c.torsoBox,chosen.torsoBox)>.35);
    if(overlapping)return this.stop(t,exact,independentlyDetected(chosen,overlapping)?"偵測到不同選手的軀幹疑似重疊，無法可靠區分目標":"不同辨識範圍對同一位置產生未能合併的骨架，暫停取值；不能據此認定有另一位選手");
    // Keep a bounded set of OBSERVED clothing views during confirmed, gradual
    // continuity. Turning must not be compared forever with the first shirt
    // histogram. Ambiguous/rejected observations never enter this memory.
    // Preserve the original anchor and recent views; no identity reattachment.
    if(!this.appearances.length)this.appearances.push([...chosen.appearance]);
    else if(this.last&&(chosen.detectionPasses?.length??0)>=2&&[0,11,12].every(i=>chosen.points[i].v>=.75)&&appearanceDistance(chosen.appearance,this.last.appearance)<=.12&&distance(chosen.center,this.last.center,this.width,this.height)<this.last.scale*.2&&chosen.scale/this.last.scale>=.85&&chosen.scale/this.last.scale<=1.18&&Math.min(...this.appearances.map(a=>appearanceDistance(chosen.appearance,a)))>=.06){
      this.appearances.push([...chosen.appearance]);if(this.appearances.length>8)this.appearances.splice(1,1);
    }
    const withheld=this.limbQuality.evaluate(chosen,candidates.filter(c=>c!==chosen),t),uncertain=Object.keys(withheld) as Side[];
    // A suspect ankle must not pull the next search crop onto another person.
    // During missing leg data, move only the box envelope using the observed
    // torso. These display/search bounds are never used to invent joint points.
    const box=uncertain.length||chosen.verification?.rejected.some(i=>i>=23)?(this.last&&this.box?this.box.map(p=>({x:clamp(chosen.center.x+(p.x-this.last!.center.x)*chosen.scale/this.last!.scale),y:clamp(chosen.center.y+(p.y-this.last!.center.y)*chosen.scale/this.last!.scale),v:1})) as Box:this.seed):chosen.box;
    if(this.last&&this.lastTime!==null){
      const dt=(t-this.lastTime)/this.slow;
      const vx=(chosen.center.x-this.last.center.x)/dt,vy=(chosen.center.y-this.last.center.y)/dt;
      const speed=Math.hypot(vx*this.width,vy*this.height),cap=chosen.scale*5,ratio=Math.min(1,cap/Math.max(1,speed));
      this.velocity={x:vx*ratio*.6+this.velocity.x*.4,y:vy*ratio*.6+this.velocity.y*.4};
    }
    this.anchor??=chosen;this.last=chosen;this.lastTime=t;this.box=box;
    const points=chosen.points.map((p,i)=>(i>=23&&uncertain.includes(i%2?"L":"R"))||chosen.verification?.rejected.includes(i)?{...p,v:0}:p);
    const note=uncertain.length?`${uncertain.map(s=>`${s==="L"?"左":"右"}腳：${withheld[s]}`).join("；")}。暫停該側取值，追蹤框仍依軀幹移動。`:undefined;
    return {t,exact,points,track:{targetId:this.selection.id,state:"locked",box,...(chosen.verification?{verification:chosen.verification}:{}),...(note?{note,withheld}:{})}};
  }
}
