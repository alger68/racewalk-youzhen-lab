import type { Point } from "./racewalk";
import { orderedBox, type TargetCandidate } from "./target-tracker";

type Box = [Point, Point];
const point = (x:number,y:number):Point => ({x,y,v:1});
const usable = (p:Point) => p.v>=.65 && Number.isFinite(p.x) && Number.isFinite(p.y);
const distance = (a:Point,b:Point,w:number,h:number) => Math.hypot((a.x-b.x)*w,(a.y-b.y)*h);

// Pixel-aligned regions keep canvas crops and restored video coordinates equal.
// The context pass retains nearby competitors; the focus pass resolves a small
// selected body. Neither region itself establishes or replaces an identity.
export function poseRegion(box:Box,w:number,h:number,context=false):Box {
 const [a,b]=orderedBox(box),bw=(b.x-a.x)*w,bh=(b.y-a.y)*h,cx=(a.x+b.x)*w/2,cy=(a.y+b.y)*h/2;
 const rw=context?Math.max(bw*3,bh*2):bw+2*Math.max(bw*.25,bh*.16),rh=bh*(context?1.4:1.2);
 return [point(Math.max(0,Math.floor(cx-rw/2))/w,Math.max(0,Math.floor(cy-rh/2))/h),point(Math.min(w,Math.ceil(cx+rw/2))/w,Math.min(h,Math.ceil(cy+rh/2))/h)];
}
export function restorePose(points:Point[],region:Box):Point[] {
 const [a,b]=region;
 return points.map(p=>({x:Math.round((a.x+p.x*(b.x-a.x))*100000)/100000,y:Math.round((a.y+p.y*(b.y-a.y))*100000)/100000,
  // Landmarks inferred outside a crop are not visible measurements, even when
  // the restored location happens to fall inside the original video.
  v:p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1?Math.round(p.v*1000)/1000:0}));
}

function sameTorso(a:TargetCandidate,b:TargetCandidate,w:number,h:number){
 const scale=Math.min(a.scale,b.scale),ratio=a.scale/b.scale;
 return ratio>=.75&&ratio<=1.33&&distance(a.center,b.center,w,h)<scale*.25&&distance(a.shoulder,b.shoulder,w,h)<scale*.35&&distance(a.hip,b.hip,w,h)<scale*.35;
}

// A smaller context/scene pose can place the hips too low. Closely agreeing
// head and anatomical shoulder points can still establish a duplicate. If
// shoulder labels disagree, require TWO already-agreeing crops before using
// the unordered silhouette. Never relabel or splice measurement points.
function sameUpperBody(a:TargetCandidate,b:TargetCandidate,w:number,h:number){
 const scale=Math.min(a.scale,b.scale),ratio=a.scale/b.scale;
 if(ratio<.5||ratio>2||distance(a.center,b.center,w,h)>scale*.65)return false;
 const ids=[0,11,12] as const;
 if(!ids.every(i=>usable(a.points[i])&&usable(b.points[i])))return false;
 if(distance(a.points[0],b.points[0],w,h)>scale*.2||distance(a.shoulder,b.shoulder,w,h)>scale*.2)return false;
 if(![7,8].some(i=>usable(a.points[i])&&usable(b.points[i])&&distance(a.points[i],b.points[i],w,h)<scale*.2))return false;
 const aw=distance(a.points[11],a.points[12],w,h),bw=distance(b.points[11],b.points[12],w,h);
 // Side views legitimately project the two shoulders almost onto one point.
 // Only the weaker unordered match needs a measurable shoulder width.
 if([0,7,8].every(i=>usable(a.points[i])&&usable(b.points[i])&&distance(a.points[i],b.points[i],w,h)<scale*.15)&&[11,12].every(i=>distance(a.points[i],b.points[i],w,h)<scale*.2))return true;
 if(Math.min(aw,bw)<scale*.1||aw/bw<.5||aw/bw>2)return false;
 if((a.detectionPasses?.length??0)<2)return false;
 // Unordered geometry may establish a repeated silhouette, but the selected
 // pose's anatomical labels remain unchanged throughout measurement/export.
 return ([[11,12],[12,11]] as const).some(([left,right])=>distance(a.points[11],b.points[left],w,h)<scale*.3&&distance(a.points[12],b.points[right],w,h)<scale*.3);
}

/** Prefer one intact pose from the focused pass; never assemble a skeleton from
 * different people or passes. Duplicate torso detections only cross-check it.
 * Disagreeing legs are withheld, while a certain torso can remain tracked. */
export function combinePosePasses(passes:TargetCandidate[][],w:number,h:number):{candidates:TargetCandidate[];reason?:string}{
 let combined:TargetCandidate[]=[];
 for(const [passIndex,pass] of passes.entries()){
  const previous=[...combined],matched=new Set<TargetCandidate>();
  for(const c of pass){
   const matches=previous.filter(p=>sameTorso(p,c,w,h)||sameUpperBody(p,c,w,h));
   if(matches.length>1||matches.some(p=>matched.has(p)))return {candidates:[],reason:"不同辨識範圍出現多個重疊目標，無法確認同一人"};
   if(!matches.length){combined.push({...c,uncertainSides:[...(c.uncertainSides??[])],verifiedSides:[],torsoVerified:false,detectionPasses:[passIndex]});continue;}
   const original=matches[0];matched.add(original);
   original.torsoVerified ||= sameTorso(original,c,w,h)&&[0,11,12,23,24].every(i=>usable(original.points[i])&&usable(c.points[i]));
   original.detectionPasses!.push(passIndex);
   const uncertain=new Set(original.uncertainSides??[]);
   for(const [side,ids] of [["L",[23,25,27,29,31]],["R",[24,26,28,30,32]]] as const){
    if(ids.some(i=>usable(original.points[i])&&usable(c.points[i])&&distance(original.points[i],c.points[i],w,h)>Math.min(original.scale,c.scale)*.3))uncertain.add(side);
    if(ids.slice(0,3).every(i=>usable(original.points[i])&&usable(c.points[i])&&distance(original.points[i],c.points[i],w,h)<=Math.min(original.scale,c.scale)*.3))original.verifiedSides=[...new Set([...(original.verifiedSides??[]),side])];
   }
   // Retain raw points for collision/jump checks. Only exported measurements
   // are suppressed later by TargetTracker, so uncertainty cannot hide a rival.
   original.uncertainSides=[...uncertain];
  }
 }
 return {candidates:combined};
}
