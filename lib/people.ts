import { selectTarget, type Point, type Report } from "./racewalk";
import type { TargetCandidate } from "./target-tracker";

type Box=[Point,Point];
export type PersonDetection=Pick<TargetCandidate,"box"|"center"|"scale"|"points">&{score?:number};
export type PersonChoice={id:string;box:Box;center:Point;points:Point[];review?:string;support?:number;label?:string};
export type PeopleScan={videoSha:string;time:number;exact:boolean;people:PersonChoice[];limited:boolean;warning?:string};

// Overlapping tiles expose small people that a whole-scene detector can miss.
// These regions are used once to offer choices, not as persistent identities.
export function peopleRegions(w:number,h:number):Box[]{
 const regions:Box[]=[];
 for(const y of [0,.175,.35])for(const x of [0,.25,.5])regions.push([
  {x:Math.floor(x*w)/w,y:Math.floor(y*h)/h,v:1},
  {x:Math.min(w,Math.ceil((x+.5)*w))/w,y:Math.min(h,Math.ceil((y+.65)*h))/h,v:1}
 ]);
 regions.push([{x:0,y:0,v:1},{x:1,y:1,v:1}]);
 return regions;
}
export function detectedPerson(b:{originX:number;originY:number;width:number;height:number},score:number,region:Box,cw:number,ch:number,w:number,h:number):PersonDetection|null{
 if(![b.originX,b.originY,b.width,b.height,score].every(Number.isFinite)||b.width<=0||b.height<=0||score<.35)return null;
 // Internal tile edges can manufacture a second, half-body box. Other tiles
 // cover that boundary; keep genuine original-frame edges available to select.
 if(region[0].x>0&&b.originX<2||region[0].y>0&&b.originY<2||region[1].x<1&&b.originX+b.width>cw-2||region[1].y<1&&b.originY+b.height>ch-2)return null;
 const [a,z]=region,clamp=(v:number)=>Math.max(0,Math.min(1,v));
 const box:Box=[{x:clamp(a.x+b.originX/cw*(z.x-a.x)),y:clamp(a.y+b.originY/ch*(z.y-a.y)),v:1},{x:clamp(a.x+(b.originX+b.width)/cw*(z.x-a.x)),y:clamp(a.y+(b.originY+b.height)/ch*(z.y-a.y)),v:1}];
 const bw=(box[1].x-box[0].x)*w,bh=(box[1].y-box[0].y)*h;if(bw<12||bh<80)return null;
 // The center is only a selection hint. No joint coordinates or angles are
 // fabricated from an object box; the selected athlete still needs a pose.
 return {box,center:{x:(box[0].x+box[1].x)/2,y:box[0].y+(box[1].y-box[0].y)*.36,v:1},scale:bh*.3,points:[],score};
}
function boxDuplicate(a:PersonDetection,b:PersonDetection,w:number,h:number){
 const area=(box:Box)=>(box[1].x-box[0].x)*(box[1].y-box[0].y);
 const intersection=Math.max(0,Math.min(a.box[1].x,b.box[1].x)-Math.max(a.box[0].x,b.box[0].x))*Math.max(0,Math.min(a.box[1].y,b.box[1].y)-Math.max(a.box[0].y,b.box[0].y));
 const iou=intersection/Math.max(1e-8,area(a.box)+area(b.box)-intersection);
 const d=Math.hypot((a.center.x-b.center.x)*w,(a.center.y-b.center.y)*h),scale=Math.max(a.scale,b.scale);
 return iou>=.55&&d<scale*.35&&a.scale/b.scale>=.65&&a.scale/b.scale<=1.54?iou-d/scale*.25:0;
}
const visible=(p:Point|undefined)=>!!p&&p.v>=.65&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
const pose=(c:PersonDetection)=>c.points.length===33;
const anchors=(c:PersonDetection)=>[0,11,12,23,24].every(i=>visible(c.points[i]));
const mean=(a:Point,b:Point):Point=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2,v:1});
function poseDuplicate(a:PersonDetection,b:PersonDetection,w:number,h:number){
 // Whole-body rectangles change with the stride or a hallucinated ankle.
 // Compare observed head/torso instead; never use the feet to identify a person.
 if(!anchors(a)||!anchors(b))return boxDuplicate(a,b,w,h);
 const scale=Math.min(a.scale,b.scale),ratio=a.scale/b.scale;
 const distance=(p:Point,q:Point)=>Math.hypot((p.x-q.x)*w,(p.y-q.y)*h)/scale;
 const head=distance(a.points[0],b.points[0]),shoulder=distance(mean(a.points[11],a.points[12]),mean(b.points[11],b.points[12])),hip=distance(mean(a.points[23],a.points[24]),mean(b.points[23],b.points[24]));
 return ratio>=.65&&ratio<=1.54&&head<.18&&shoulder<.18&&hip<.3?2-head-shoulder-hip:0;
}
function objectMatchesPose(object:PersonDetection,body:PersonDetection){
 if(!anchors(body))return false;
 const [a,b]=object.box,bh=b.y-a.y,bw=b.x-a.x,bodyHeight=body.box[1].y-body.box[0].y;
 if(bh<=0||bw<=0||bh/bodyHeight<.6||bh/bodyHeight>1.65)return false;
 const inside=(p:Point)=>p.x>=a.x-bw*.04&&p.x<=b.x+bw*.04&&p.y>=a.y-bh*.05&&p.y<=b.y+bh*.05;
 const head=(body.points[0].y-a.y)/bh,hip=(mean(body.points[23],body.points[24]).y-a.y)/bh;
 return [0,11,12,23,24].every(i=>inside(body.points[i]))&&head>=-.05&&head<=.32&&hip>=.25&&hip<=.8;
}
/** Preview suggestions only. Measurements still require TargetTracker to
 * acquire the explicitly selected person from the selected video frame. */
export function personChoices(passes:PersonDetection[][],w:number,h:number):PersonChoice[]{
 const nodes=passes.flatMap((pass,passIndex)=>pass.map(candidate=>({candidate,passIndex}))),parent=nodes.map((_,i)=>i),groups=nodes.map((_,i)=>[i]);
 const root=(i:number):number=>parent[i]===i?i:(parent[i]=root(parent[i]));
 const compatible=(a:number,b:number)=>groups[a].every(i=>groups[b].every(j=>nodes[i].passIndex!==nodes[j].passIndex));
 const join=(a:number,b:number)=>{parent[b]=a;groups[a].push(...groups[b]);};
 const edges:{a:number;b:number;score:number}[]=[];
 for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++)if(nodes[a].passIndex!==nodes[b].passIndex&&pose(nodes[a].candidate)&&pose(nodes[b].candidate)){
  const score=poseDuplicate(nodes[a].candidate,nodes[b].candidate,w,h);if(score)edges.push({a,b,score});
 }
 // Complete-link agreement stops A≈B≈C from joining distinct A and C.
 // Co-occurring detections are never merged, regardless of box overlap.
 for(const edge of edges.sort((a,b)=>b.score-a.score)){
  const a=root(edge.a),b=root(edge.b);if(a===b||!compatible(a,b)||!groups[a].every(i=>groups[b].every(j=>poseDuplicate(nodes[i].candidate,nodes[j].candidate,w,h)>0)))continue;
  join(a,b);
 }
 const bodyGroups=[...new Set(nodes.flatMap((n,i)=>pose(n.candidate)?[root(i)]:[]))];
 const ambiguous=new Set<number>();
 for(let i=0;i<nodes.length;i++)if(!pose(nodes[i].candidate)){
  const matches=bodyGroups.filter(g=>groups[g].filter(j=>pose(nodes[j].candidate)).every(j=>objectMatchesPose(nodes[i].candidate,nodes[j].candidate)));
  if(matches.length===1&&compatible(matches[0],i))join(matches[0],i);
  else if(matches.length)ambiguous.add(i);
 }
 const boxes=nodes.flatMap((n,i)=>!pose(n.candidate)&&root(i)===i?[i]:[]),boxEdges:{a:number;b:number;score:number}[]=[];
 for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++){
  const score=boxDuplicate(nodes[boxes[a]].candidate,nodes[boxes[b]].candidate,w,h);if(score)boxEdges.push({a:boxes[a],b:boxes[b],score});
 }
 for(const edge of boxEdges.sort((a,b)=>b.score-a.score)){
  const a=root(edge.a),b=root(edge.b);if(a===b||!compatible(a,b)||!groups[a].every(i=>groups[b].every(j=>boxDuplicate(nodes[i].candidate,nodes[j].candidate,w,h)>0)))continue;
  join(a,b);
 }
 const quality=(c:PersonDetection)=>(anchors(c)?100:0)+c.points.reduce((n,p,i)=>n+(p.v>=.65?p.v*([0,27,28,29,30,31,32].includes(i)?2:1):0),0)+(c.score??0);
 const representatives=new Map<number,PersonDetection>();
 nodes.forEach((n,i)=>{const key=root(i),old=representatives.get(key);if(!old||quality(n.candidate)>quality(old))representatives.set(key,n.candidate);});
 let supportedNumber=0,reviewNumber=0;
 return [...representatives.entries()].sort(([,a],[,b])=>a.center.x-b.center.x||a.center.y-b.center.y).map(([key,candidate],i)=>{
  const members=groups[key],support=new Set(members.map(j=>nodes[j].passIndex)).size;
  const review=!anchors(candidate)?members.some(j=>ambiguous.has(j))?"可能涵蓋其他候選，尚未確認獨立人物":"尚未確認頭肩與軀幹":support<2?"目前只有單次骨架結果，待複核":undefined;
  return {id:`person-${i+1}`,label:review?`待確認 ${++reviewNumber}`:`候選 ${++supportedNumber}`,box:candidate.box,center:candidate.center,points:candidate.points,support,...(review?{review}:{})};
 });
}
export function selectDetectedTarget(r:Report,scan:PeopleScan,personId:string,currentTime:number,targetId:string,reportId:string):Report{
 if(scan.videoSha!==r.file.sha256)throw new Error("人物候選不屬於目前影片，請重新偵測。");
 if(Math.abs(currentTime-scan.time)>Math.max(.025,r.settings.slow/r.settings.fps))throw new Error("影片畫面已改變，請重新偵測目前畫面的人物。");
 const person=scan.people.find(p=>p.id===personId);
 if(!person)throw new Error("找不到這個人物候選，請重新偵測。");
 if(scan.time>=r.file.duration-.05)throw new Error("請往前選擇還有後續動作的畫面。");
 const next=selectTarget(r,person.box,scan.time,targetId,reportId);
 next.settings.target={...next.settings.target!,anchor:person.center};
 return next;
}
