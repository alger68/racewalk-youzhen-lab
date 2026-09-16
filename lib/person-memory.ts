import type { TargetCandidate } from "./target-tracker";

/** Learned appearance is an association cue, not a calibrated identity probability. */
export function normalizedEmbedding(v: ArrayLike<number>): number[] | null {
 if(v.length!==512)return null;
 const a=Array.from(v);if(a.some(x=>!Number.isFinite(x)))return null;
 const norm=Math.hypot(...a);return norm>1e-8?a.map(x=>x/norm):null;
}
export function cosineDistance(a: number[],b: number[]):number {
 if(a.length!==512||b.length!==512)return Infinity;
 return Math.max(0,Math.min(2,1-a.reduce((s,x,i)=>s+x*b[i],0)));
}
export type PersonObservation={candidate:TargetCandidate;embedding:number[]|null};
type Memory={id:number;candidate:TargetCandidate;t:number;first:number;hits:number;views:number[][];velocity:{x:number;y:number}};
export type PersonMatch={id:number;candidate:TargetCandidate;established:boolean;recovered:boolean};
const distance=(a:TargetCandidate,b:TargetCandidate,w:number,h:number)=>Math.hypot((a.center.x-b.center.x)*w,(a.center.y-b.center.y)*h);
function overlap(a:TargetCandidate,b:TargetCandidate){
 const x=Math.max(0,Math.min(a.torsoBox[1].x,b.torsoBox[1].x)-Math.max(a.torsoBox[0].x,b.torsoBox[0].x));
 const y=Math.max(0,Math.min(a.torsoBox[1].y,b.torsoBox[1].y)-Math.max(a.torsoBox[0].y,b.torsoBox[0].y));
 const area=(c:TargetCandidate)=>(c.torsoBox[1].x-c.torsoBox[0].x)*(c.torsoBox[1].y-c.torsoBox[0].y);
 return x*y/Math.max(1e-9,Math.min(area(a),area(b)));
}

/** All people retain separate, bounded appearance memories, including absent
 * rivals. Mutual unique association makes assignment one-to-one. Ambiguous
 * observations neither update a memory nor spawn a replacement identity.
 * Predicted centres are used only for matching, never joint measurement. */
export class PersonMemory {
 private tracks:Memory[]=[];
 private next=1;
 private lastTime=-Infinity;
 constructor(private width:number,private height:number,private slow=1){}
 has(id:number){return this.tracks.some(m=>m.id===id);}
 update(input:PersonObservation[],t:number):PersonMatch[]{
  if(!Number.isFinite(t)||t<=this.lastTime)return [];
  this.lastTime=t;
  this.tracks=this.tracks.filter(m=>(t-m.t)/this.slow<=3);
  const observations=input.map(o=>({...o,embedding:o.embedding&&normalizedEmbedding(o.embedding)}));
  const quality=observations.map(({candidate:c,embedding},i)=>!!embedding&&!c.torsoConflict&&[0,11,12,23,24].every(j=>c.points[j]?.v>=.75)&&!observations.some((o,j)=>j!==i&&overlap(c,o.candidate)>.35));
  // Keep even low-quality rivals in costs: dropping them would manufacture a
  // unique match. They cannot update memory or produce an accepted assignment.
  const costs=this.tracks.map(m=>observations.map(({candidate:c,embedding})=>{
   if(!embedding)return Infinity;
   const dt=(t-m.t)/this.slow,size=c.scale/m.candidate.scale;
   const d=Math.hypot((c.center.x-m.candidate.center.x-m.velocity.x*Math.min(dt,.5))*this.width,(c.center.y-m.candidate.center.y-m.velocity.y*Math.min(dt,.5))*this.height)/m.candidate.scale;
   const appearance=Math.min(...m.views.map(v=>cosineDistance(embedding,v)));
   if(size<.65||size>1.55||d>.45+3*Math.min(dt,1)||appearance>(dt>.2?.4:.45))return Infinity;
   return appearance*2+d*.12+Math.abs(Math.log(size))*.1;
  }));
  const matches:PersonMatch[]=[];
  observations.forEach((o,j)=>{
   if(!quality[j])return;
   const options=this.tracks.map((m,i)=>({m,i,cost:costs[i][j]})).filter(x=>Number.isFinite(x.cost)).sort((a,b)=>a.cost-b.cost);
   if(!options.length){
    if(this.tracks.length>=64||!o.candidate.torsoVerified)return;
    const m:Memory={id:this.next++,candidate:structuredClone(o.candidate),t,first:t,hits:1,views:[o.embedding!],velocity:{x:0,y:0}};
    this.tracks.push(m);costs.push(observations.map(()=>Infinity));
    matches.push({id:m.id,candidate:o.candidate,established:false,recovered:false});return;
   }
   const best=options[0],other=options[1];
   if(other&&other.cost-best.cost<.08)return;
   const row=costs[best.i].map((cost,k)=>({cost,k})).filter(x=>Number.isFinite(x.cost)).sort((a,b)=>a.cost-b.cost);
   if(row[0]?.k!==j||(row[1]&&row[1].cost-row[0].cost<.08))return;
   const m=best.m,dt=(t-m.t)/this.slow,recovered=dt>.2;
   const vx=(o.candidate.center.x-m.candidate.center.x)/dt,vy=(o.candidate.center.y-m.candidate.center.y)/dt;
   const cap=m.candidate.scale*5,ratio=Math.min(1,cap/Math.max(1,Math.hypot(vx*this.width,vy*this.height)));
   m.velocity={x:m.velocity.x*.5+vx*ratio*.5,y:m.velocity.y*.5+vy*ratio*.5};
   // Never learn a new appearance during re-acquisition. Original anchor stays.
   if(o.candidate.torsoVerified&&!recovered&&distance(o.candidate,m.candidate,this.width,this.height)<m.candidate.scale*.35&&Math.min(...m.views.map(v=>cosineDistance(o.embedding!,v)))>.025){
    m.views.push(o.embedding!);if(m.views.length>8)m.views.splice(1,1);
   }
   m.candidate=structuredClone(o.candidate);m.t=t;m.hits++;
   matches.push({id:m.id,candidate:o.candidate,established:m.hits>=3&&(t-m.first)/this.slow>=.05,recovered});
  });
  return matches;
 }
}
