import type { Point, Side } from "./racewalk";
import type { TargetCandidate } from "./target-tracker";

export type WholebodyJoint={x:number;y:number;score:number};
export type WholebodyResult={joints:WholebodyJoint[]};
export type PoseVerification={model:"rtmpose-s-wholebody";compared:number[];rejected:number[];unobserved?:number[];conflicts?:number[];retry?:{sides:Side[];recovered:number[]}};
export type AffineRegion={x:number;y:number;width:number;height:number};
export const RTM_WIDTH=192,RTM_HEIGHT=256;
// COCO WholeBody 133 anatomy, not array-order or screen-left matching.
export const COMMON_JOINTS=[[0,0],[7,3],[8,4],[11,5],[12,6],[13,7],[14,8],[15,9],[16,10],[23,11],[24,12],[25,13],[26,14],[27,15],[28,16],[29,19],[30,22]] as const;
export function wholebodyRegion(box:[Point,Point],w:number,h:number,padding:1.25|1.05=1.25):AffineRegion {
 const cx=(box[0].x+box[1].x)*w/2,cy=(box[0].y+box[1].y)*h/2;
 let width=Math.abs(box[1].x-box[0].x)*w*padding,height=Math.abs(box[1].y-box[0].y)*h*padding;
 if(width/height>RTM_WIDTH/RTM_HEIGHT)height=width*RTM_HEIGHT/RTM_WIDTH;else width=height*RTM_WIDTH/RTM_HEIGHT;
 return {x:cx-width/2,y:cy-height/2,width,height};
}

const legIds=(side:Side)=>side==="L"?[23,25,27,29,31]:[24,26,28,30,32];
/** Retry only missing verifier evidence. A confident disagreement never earns
 * a search for a more agreeable crop, and one side cannot supply the other. */
export function wholebodyRetrySides(c:TargetCandidate):Side[]{
 const v=c.verification;
 if(!v||c.torsoConflict||![0,11,12].every(i=>v.compared.includes(i))||Object.values(c.measurementReasons??{}).some(r=>r.includes("左右腿標示衝突")))return [];
 return (["L","R"] as Side[]).filter(side=>{
  const ids=legIds(side);
  return ids.slice(0,3).every(i=>c.points[i].v>=.65)&&ids.some(i=>v.unobserved?.includes(i))&&!ids.some(i=>v.conflicts?.includes(i));
 });
}

/** Combine evidence, not coordinates. The retry uses a predetermined tighter
 * full-body crop of the same original frame. Observed conflicts are sticky;
 * only previously unobserved verifier points can become newly accepted. */
export function verifyWholebodyRetry(raw:TargetCandidate,primary:TargetCandidate,result:WholebodyResult,w:number,h:number):TargetCandidate{
 const sides=wholebodyRetrySides(primary),base=primary.verification;
 if(!sides.length||!base)return primary;
 const fresh=verifyWholebody(raw,result,w,h),check=fresh.verification!;
 const retry={sides,recovered:[] as number[]};
 if(fresh.torsoConflict)return {...primary,torsoConflict:true,verification:{...base,retry}};
 if(Object.values(fresh.measurementReasons??{}).some(r=>r.includes("左右腿標示衝突"))){
  const rejected=[...new Set([...base.rejected,23,24,25,26,27,28,29,30,31,32])];
  return {...primary,measurementReasons:{L:"兩套模型的左右腿標示衝突，等待重新核對",R:"兩套模型的左右腿標示衝突，等待重新核對"},uncertainSides:["L","R"],verification:{...base,compared:base.compared.filter(i=>!rejected.includes(i)),rejected,retry}};
 }
 // A partial/missing head or shoulder in the retry cannot establish that its
 // leg belongs to the selected torso; keep the original decision unchanged.
 if(![0,11,12].every(i=>check.compared.includes(i)))return {...primary,verification:{...base,retry}};
 const compared=new Set(base.compared),rejected=new Set(base.rejected),unobserved=new Set(base.unobserved),conflicts=new Set(base.conflicts);
 const reasons={...primary.measurementReasons},uncertain=new Set(primary.uncertainSides),verified=new Set(primary.verifiedSides);
 for(const side of sides){
  const ids=legIds(side);
  for(const i of ids){
   if(check.conflicts?.includes(i)){compared.delete(i);rejected.add(i);conflicts.add(i);unobserved.delete(i);}
   else if(unobserved.has(i)&&check.compared.includes(i)){unobserved.delete(i);rejected.delete(i);compared.add(i);retry.recovered.push(i);}
  }
  if(ids.slice(0,3).some(i=>conflicts.has(i)))reasons[side]="局部複核後，兩套模型的髖膝踝仍不一致";
  else if(ids.slice(0,3).some(i=>unobserved.has(i)))reasons[side]="局部複核後，髖、膝或踝仍不清楚";
  else delete reasons[side];
  const independentlyVerified=ids.every(i=>compared.has(i)&&!rejected.has(i));
  if(independentlyVerified)verified.add(side);
  if(!reasons[side]&&(!raw.uncertainSides?.includes(side)||(raw.detectionPasses?.includes(0)&&independentlyVerified)))uncertain.delete(side);
  else uncertain.add(side);
 }
 return {...primary,verification:{...base,compared:[...compared],rejected:[...rejected],unobserved:[...unobserved],conflicts:[...conflicts],retry},measurementReasons:reasons,uncertainSides:[...uncertain],verifiedSides:[...verified]};
}
// RGB, NCHW, ImageNet mean/std, matching the released model's pipeline.json.
export function wholebodyTensor(rgba:Uint8ClampedArray):Float32Array {
 if(rgba.length!==RTM_WIDTH*RTM_HEIGHT*4)throw new Error("腳部複核影像尺寸不正確");
 const size=RTM_WIDTH*RTM_HEIGHT,out=new Float32Array(size*3),mean=[123.675,116.28,103.53],std=[58.395,57.12,57.375];
 for(let i=0;i<size;i++)for(let c=0;c<3;c++)out[c*size+i]=(rgba[i*4+c]-mean[c])/std[c];
 return out;
}
export function decodeWholebody(x:Float32Array,y:Float32Array):WholebodyResult {
 if(x.length!==133*384||y.length!==133*512)throw new Error("腳部複核模型輸出格式不正確");
 const joints:WholebodyJoint[]=[];
 for(let i=0;i<133;i++){
  let ix=0,iy=0,mx=-Infinity,my=-Infinity;
  for(let j=0;j<384;j++){const v=x[i*384+j];if(!Number.isFinite(v))throw new Error("腳部複核出現無效數值");if(v>mx){mx=v;ix=j;}}
  for(let j=0;j<512;j++){const v=y[i*512+j];if(!Number.isFinite(v))throw new Error("腳部複核出現無效數值");if(v>my){my=v;iy=j;}}
  // SimCC responses can exceed one. Do not label these as visibility or clamp
  // them into an invented probability; use their own model-specific gate.
  joints.push({x:ix/384,y:iy/512,score:Math.min(mx,my)});
 }
 return {joints};
}
export function restoreWholebody(result:WholebodyResult,r:AffineRegion,w:number,h:number):WholebodyResult {
 return {joints:result.joints.map(p=>({x:(r.x+p.x*r.width)/w,y:(r.y+p.y*r.height)/h,score:p.score}))};
}
const observed=(p:WholebodyJoint|undefined,min=.5)=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.score)&&p.score>=min&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;

/** A different network verifies the intact MediaPipe pose. It can withhold a
 * joint or reject a conflicting torso, but never replaces a coordinate, flips
 * left/right to look plausible, or supplies a hidden foot. */
export function verifyWholebody(c:TargetCandidate,result:WholebodyResult,w:number,h:number):TargetCandidate {
 const compared:number[]=[],rejected:number[]=[],unobserved:number[]=[],conflicts:number[]=[],reasons:Partial<Record<Side,string>>={};
 const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot((a.x-b.x)*w,(a.y-b.y)*h);
 const jointLimit=Math.max(5,c.scale*.2),j=result.joints;
 for(const [mp,rtm] of COMMON_JOINTS){
  const a=c.points[mp],b=j[rtm];
  if(!a||a.v<.65)continue;
  if(!observed(b,[23,24].includes(mp)?.45:.5)){rejected.push(mp);unobserved.push(mp);}
  else if(distance(a,b)>jointLimit){rejected.push(mp);conflicts.push(mp);}else compared.push(mp);
 }
 for(const side of ["L","R"] as const){
  const ids=side==="L"?[23,25,27]:[24,26,28];
  if(ids.some(i=>conflicts.includes(i)))reasons[side]="兩套模型的髖膝踝位置不一致";
  else if(ids.some(i=>unobserved.includes(i)))reasons[side]="複核模型尚未看清髖、膝或踝";
 }
 // When separated legs match only under swapped anatomical labels, reject
 // both sides. Never silently swap labels or average opposing estimates.
 const limbDistance=(swap:boolean)=>([25,26,27,28] as const).map(mp=>{
  const rtm=mp===25?(swap?14:13):mp===26?(swap?13:14):mp===27?(swap?16:15):(swap?15:16);
  return c.points[mp].v>=.65&&observed(j[rtm])?distance(c.points[mp],j[rtm]):null;
 });
 const straight=limbDistance(false),swapped=limbDistance(true);
 if(straight.every(v=>v!==null)&&swapped.every(v=>v!==null)&&straight.reduce((n,v)=>n+v!,0)-swapped.reduce((n,v)=>n+v!,0)>jointLimit*2&&swapped.every(v=>v!<jointLimit)){
  reasons.L=reasons.R="兩套模型的左右腿標示衝突，等待重新核對";
  for(const i of [23,24,25,26,27,28,29,30,31,32])if(!rejected.includes(i))rejected.push(i);
 }
 // Heel/toe visibility remains per-point. A toe is a different anatomical
 // landmark from MediaPipe's foot-index, so compare position only within a
 // foot-sized tolerance; it never creates ground contact from an ankle alone.
 for(const [mp,rtm] of [[31,17],[32,20]] as const){
  if(c.points[mp].v<.65)continue;
  if(!observed(j[rtm])){rejected.push(mp);unobserved.push(mp);}
  else if(distance(c.points[mp],j[rtm])>Math.max(7,c.scale*.25)){rejected.push(mp);conflicts.push(mp);}else compared.push(mp);
 }
 const torsoIds=[[0,0],[11,5],[12,6]] as const;
 const torsoConflict=torsoIds.filter(([mp,rtm])=>c.points[mp].v>=.65&&observed(j[rtm])).some(([mp,rtm])=>distance(c.points[mp],j[rtm])>c.scale*.45);
 const independentlyVerified=(["L","R"] as Side[]).filter(side=>!torsoConflict&&torsoIds.every(([mp,rtm])=>c.points[mp].v>=.65&&observed(j[rtm])&&distance(c.points[mp],j[rtm])<=jointLimit)&&(side==="L"?[23,25,27,29,31]:[24,26,28,30,32]).every(i=>compared.includes(i)&&!rejected.includes(i)));
 // The high-resolution focused pose may be corroborated by a different
 // network even when the smaller scene estimate disagrees. Rival collision
 // and temporal checks still run afterwards. Never waive an RTMPose conflict.
 const cropUncertain=(c.uncertainSides??[]).filter(side=>!c.detectionPasses?.includes(0)||!independentlyVerified.includes(side));
 return {...c,verification:{model:"rtmpose-s-wholebody",compared:[...new Set(compared.filter(i=>!rejected.includes(i)))],rejected:[...new Set(rejected)],unobserved,conflicts},measurementReasons:reasons,torsoConflict,
  verifiedSides:[...new Set([...(c.verifiedSides??[]),...independentlyVerified])],
  uncertainSides:[...new Set([...cropUncertain,...Object.keys(reasons) as Side[]])]};
}
