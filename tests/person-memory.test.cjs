const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PersonMemory,normalizedEmbedding,cosineDistance}=require('../.qa/person-memory.js');
const {ReidTargetTracker}=require('../.qa/reid-target-tracker.js');
const {candidateGeometry,colourSignature}=require('../.qa/target-tracker.js');
const {reidTensor,reidEmbedding,REID_SHA}=require('../.qa/reid.js');
const p=(x,y,v=1)=>({x,y,v});
function observation(x=.25,id=0){
 const points=Array.from({length:33},()=>p(x,.5,0));
 for(const [i,dx,y] of [[0,0,.12],[11,-.04,.28],[12,.04,.28],[23,-.035,.53],[24,.035,.53],[25,-.05,.70],[26,.05,.70],[27,-.05,.87],[28,.05,.87],[29,-.06,.88],[30,.06,.88],[31,-.02,.89],[32,.10,.89]])points[i]=p(x+dx,y);
 const candidate=candidateGeometry(points,1000,1000);candidate.appearance=colourSignature(Array.from({length:30},()=>[20,30,180]).flat());candidate.torsoVerified=true;candidate.verifiedSides=['L','R'];candidate.detectionPasses=[0,1];
 const embedding=Array(512).fill(0);embedding[id]=1;
 return {candidate,embedding};
}
test('embedding vectors reject non-finite, zero and wrong-size outputs',()=>{
 assert.equal(normalizedEmbedding([1,2]),null);assert.equal(normalizedEmbedding(Array(512).fill(0)),null);assert.equal(normalizedEmbedding(Array(512).fill(NaN)),null);
 const a=normalizedEmbedding(Array(512).fill(2));assert.ok(Math.abs(cosineDistance(a,a))<1e-12);
});
test('appearance preprocessing retains RGB channel order and scales exactly to 0–1',()=>{
 const bytes=new Uint8ClampedArray(224*224*4);bytes.set([255,128,64,255]);const x=reidTensor(bytes);
 assert.equal(x[0],1);assert.ok(Math.abs(x[224*224]-128/255)<1e-7);assert.ok(Math.abs(x[2*224*224]-64/255)<1e-7);
 assert.throws(()=>reidTensor(new Uint8ClampedArray(4)));assert.throws(()=>reidEmbedding(Array(512).fill(0)));
});
test('the distributed ReID model matches the pinned official asset',()=>{
 const fs=require('node:fs'),{createHash}=require('node:crypto');const bytes=fs.readFileSync(require('node:path').join(__dirname,'../public/models/yolo26n-reid.onnx'));
 assert.equal(bytes.length,9873245);assert.equal(createHash('sha256').update(bytes).digest('hex'),REID_SHA);
});
test('four observed people keep four identities when detector order changes',()=>{
 const memory=new PersonMemory(1000,1000);let initial;
 for(let i=0;i<12;i++){
  const obs=[.15,.37,.59,.81].map((x,k)=>observation(x+i*.001,k));if(i%2)obs.reverse();
  const m=memory.update(obs,i/30);assert.equal(m.length,4);assert.equal(new Set(m.map(x=>x.id)).size,4);
  const byX=m.sort((a,b)=>a.candidate.center.x-b.candidate.center.x).map(x=>x.id);
  if(i===0)initial=byX;else assert.deepEqual(byX,initial);
 }
});
test('absent rivals remain competitors; identical appearance at a crossing is not assigned',()=>{
 const memory=new PersonMemory(1000,1000);
 for(let i=0;i<4;i++)assert.equal(memory.update([observation(.25),observation(.45)],i/30).length,2);
 const m=memory.update([observation(.35)],4/30);assert.equal(m.length,0);
 assert.equal(memory.update([observation(.35)],5/30).length,0);
});
test('clear distinct appearance can recover the original identity after an occlusion',()=>{
 const memory=new PersonMemory(1000,1000);let id;
 for(let i=0;i<4;i++)id=memory.update([observation(.25,0),observation(.65,1)],i/30)[0].id;
 memory.update([],4/30);
 const m=memory.update([observation(.64,1),observation(.26,0)],.6);
 assert.equal(m.find(x=>x.candidate.center.x===.26).id,id);
});
test('occluded or conflicting observations never update appearance memory',()=>{
 const memory=new PersonMemory(1000,1000);const first=memory.update([observation()],0)[0].id;
 const bad=observation(.25,1);bad.candidate.torsoConflict=true;
 assert.deepEqual(memory.update([bad],.1),[]);
 const good=memory.update([observation()],.2);assert.equal(good[0].id,first);
});
test('repeated timestamps and expired identities cannot produce automatic recovery',()=>{
 const memory=new PersonMemory(1000,1000);const first=memory.update([observation()],0)[0].id;
 assert.deepEqual(memory.update([observation()],0),[]);
 const next=memory.update([observation()],4);assert.notEqual(next[0].id,first);
});
test('selected identity recovery requires three observed frames and preserves missing joints',()=>{
 const tr=new ReidTargetTracker({id:'test',time:0},[p(.1,.05),p(.4,.98)],1000,1000);
 for(let i=0;i<4;i++)assert.equal(tr.update([observation()],i/30,true).track.state,'locked');
 const missing=tr.update([],4/30,true);assert.deepEqual(missing.points,[]);
 const a=tr.update([observation()],5/30,true),b=tr.update([observation()],6/30,true),c=tr.update([observation()],7/30,true);
 assert.equal(a.track.state,'searching');assert.equal(b.track.state,'searching');assert.equal(c.track.state,'locked');assert.equal(c.track.continuity,1);
 assert.deepEqual(missing.points,[]);assert.equal(c.points[25].v,0);
});
