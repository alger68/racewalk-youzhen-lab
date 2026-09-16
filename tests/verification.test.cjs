const {test}=require('node:test');
const assert=require('node:assert/strict');
const {COMMON_JOINTS,verifyWholebody,decodeWholebody,wholebodyRegion,restoreWholebody,wholebodyTensor,wholebodyRetrySides,verifyWholebodyRetry}=require('../.qa/wholebody.js');
const {confirmObservedPrevious,manuallyCorrectKnee}=require('../.qa/observed-recovery.js');
const {candidateGeometry,colourSignature}=require('../.qa/target-tracker.js');
const {ContinuousTargetTracker}=require('../.qa/continuous-tracker.js');
const {defaults,selectTarget,knee,contactCandidate}=require('../.qa/racewalk.js');
const {reportSchema}=require('../.qa/report-schema.js');
const id='6218e496-3a8b-469d-99ca-eb046b5b26f2',p=(x,y,v=1)=>({x,y,v});
const seed=[p(.1,.05),p(.4,.98)];
function athlete(){
 const ps=Array.from({length:33},()=>p(.25,.5,0));
 for(const [i,x,y] of [[0,.25,.12],[11,.21,.28],[12,.29,.28],[13,.18,.40],[14,.33,.40],[15,.17,.49],[16,.34,.49],[23,.215,.53],[24,.285,.53],[25,.20,.70],[26,.30,.70],[27,.17,.87],[28,.33,.87],[29,.16,.88],[30,.34,.88],[31,.2,.89],[32,.38,.89]])ps[i]=p(x,y);
 const c=candidateGeometry(ps,1000,1000);c.appearance=colourSignature(Array.from({length:30},()=>[20,30,80]).flat());c.detectionPasses=[0,1];c.torsoVerified=true;c.verifiedSides=['L','R'];return c;
}
function second(c){
 const joints=Array.from({length:133},()=>({x:.5,y:.5,score:0}));
 for(const [mp,rtm] of [...COMMON_JOINTS,[31,17],[32,20]])joints[rtm]={x:c.points[mp].x,y:c.points[mp].y,score:.85};
 return {joints};
}
const tracker=()=>new ContinuousTargetTracker({id,time:0},seed,1000,1000,1);
test('anatomically matched second-model evidence retains the intact primary pose',()=>{
 const c=athlete(),v=verifyWholebody(c,second(c),1000,1000),f=tracker().update([v],0,true);
 assert.equal(f.track.state,'locked');assert.deepEqual(f.points,c.points);assert.deepEqual(f.track.verification.rejected,[]);
 assert.equal(f.track.verification.model,'rtmpose-s-wholebody');assert.notEqual(knee(f,'L',1000,1000,'side-left'),null);
});

test('missing verifier observations and confident spatial conflicts remain distinct',()=>{
 const c=athlete(),missing=second(c),conflict=second(c);missing.joints[15].score=.1;conflict.joints[15].x+=.2;
 const a=verifyWholebody(c,missing,1000,1000),b=verifyWholebody(c,conflict,1000,1000);
 assert.deepEqual(a.verification.unobserved,[27]);assert.deepEqual(a.verification.conflicts,[]);
 assert.deepEqual(b.verification.conflicts,[27]);assert.match(a.measurementReasons.L,/尚未看清/);assert.match(b.measurementReasons.L,/位置不一致/);
 assert.deepEqual(wholebodyRetrySides(a),['L']);assert.deepEqual(wholebodyRetrySides(b),[]);
});

test('one bounded crop retry can corroborate a missing point without changing any primary coordinate',()=>{
 const c=athlete(),missing=second(c);missing.joints[15].score=.1;
 const a=verifyWholebody(c,missing,1000,1000),b=verifyWholebodyRetry(c,a,second(c),1000,1000),f=tracker().update([b],0,true);
 assert.deepEqual(b.points,c.points);assert.deepEqual(b.verification.retry,{sides:['L'],recovered:[27]});assert.equal(f.points[27].v,1);assert.deepEqual(b.verification.rejected,[]);
 const old=wholebodyRegion(c.box,1000,1000),tight=wholebodyRegion(c.box,1000,1000,1.05);assert.ok(tight.width<old.width);assert.ok(Math.abs(tight.width/tight.height-.75)<1e-9);
});

test('a retry never overwrites an existing observed conflict or promotes low-confidence primary joints',()=>{
 const c=athlete(),r=second(c);r.joints[13].x+=.2;r.joints[15].score=.1;
 const a=verifyWholebody(c,r,1000,1000);assert.deepEqual(wholebodyRetrySides(a),[]);assert.deepEqual(verifyWholebodyRetry(c,a,second(c),1000,1000),a);
 const low=athlete();low.points[25].v=.2;const missing=second(low);missing.joints[15].score=.1;
 assert.deepEqual(wholebodyRetrySides(verifyWholebody(low,missing,1000,1000)),[]);
});

test('retry conflicts, another torso, and contradictory anatomical labels cannot restore measurements',()=>{
 for(const change of [r=>{r.joints[15].x+=.2},r=>{r.joints[0].x+=.2},r=>{for(const [a,b] of [[13,14],[15,16],[19,22],[17,20]])[r.joints[a],r.joints[b]]=[r.joints[b],r.joints[a]]}]){
  const c=athlete(),missing=second(c);missing.joints[15].score=.1;
  const retry=second(c);change(retry);const v=verifyWholebodyRetry(c,verifyWholebody(c,missing,1000,1000),retry,1000,1000),f=tracker().update([v],0,true);
  assert.equal(knee(f,'L',1000,1000,'side-left'),null);
 }
});

function delayedSequence(){
 const tr=tracker(),frames=[],raw=[];
 for(let i=0;i<4;i++){
  const c=athlete(),r=second(c);if(i===1)c.points[25].v=.1;
  const candidate=verifyWholebody(c,r,1000,1000);raw.push(candidate);
  const f=tr.update([candidate],i/30,true);if(frames.length)frames[frames.length-1]=tr.confirmPrevious(frames.at(-1),f);frames.push(f);
 }
 return {frames,raw,tr};
}
function recoveryReport(frames){
 const r=selectTarget({schema:1,engine:'rw-2.8.0-observed-recovery',id,version:0,created:'2026-09-14T00:00:00Z',settings:{...defaults(),end:1},file:{name:'test.mov',size:10,duration:1,width:1000,height:1000,sha256:'a'.repeat(64)},frames:[],events:[],judge:{contact:'pending',left:'pending',right:'pending'},notes:'',complete:false},seed,0,id,id);
 return {...r,frames,complete:true,tracking:{method:'target-lock-v2',pipeline:'full-rtmpose-v1',targetId:id,status:'complete',lastTime:frames.at(-1).t}};
}

test('second clean frame confirms the first observed recovery frame but never the actual occlusion',()=>{
 const {frames,raw}=delayedSequence();
 assert.equal(frames[1].points[25].v,0);assert.ok(frames[1].track.withheld.L);
 assert.equal(frames[2].track.recovered.L.confirmedAt,frames[3].t);assert.equal(frames[2].track.withheld,undefined);
 for(const i of [23,25,27,29,31])assert.deepEqual(frames[2].points[i],raw[2].points[i]);
 assert.equal(reportSchema.safeParse(recoveryReport(frames)).success,true);
});

test('a single returning observation, changed identity, gap, bad timing, or unverified point stays missing',()=>{
 const tr=tracker(),c=athlete(),good=verifyWholebody(c,second(c),1000,1000);tr.update([good],0,true);
 const bad=athlete();bad.points[25].v=.1;tr.update([verifyWholebody(bad,second(bad),1000,1000)],1/30,true);
 const pending=tr.update([good],2/30,true);assert.equal(pending.points[25].v,0);
 const next=tr.update([good],3/30,true),confirmation=[{side:'L',t:pending.t,points:c.points}];
 for(const change of [f=>{f.track.targetId='other'},f=>{f.track.continuity++},f=>{f.track.state='searching';f.reason='gap';f.points=[]},f=>{f.exact=false},f=>{f.t=pending.t},f=>{f.t=1},f=>{f.track.withheld={L:'occluded'}},f=>{f.track.verification.compared=[]}]){
  const changed=structuredClone(next);change(changed);assert.deepEqual(confirmObservedPrevious(pending,changed,confirmation,1),pending);
 }
 assert.deepEqual(confirmObservedPrevious(pending,next,[],1),pending);
});

test('recovery cannot promote a rejected heel, join the opposite leg, or persist a fabricated confirmation',()=>{
 const {frames,raw}=delayedSequence(),a=structuredClone(frames[2]),b=frames[3];
 a.track.withheld={L:'點位重新出現，等待連續兩格穩定'};a.track.verification.rejected=[29];a.track.verification.compared=a.track.verification.compared.filter(i=>i!==29);a.points[29].v=0;
 const confirmed=confirmObservedPrevious(a,b,[{side:'L',t:a.t,points:raw[2].points}],1);assert.equal(confirmed.points[29].v,0);assert.deepEqual(confirmed.points[28],a.points[28]);
 const report=recoveryReport(frames);report.frames[2].track.recovered.L.confirmedAt=.9;assert.equal(reportSchema.safeParse(report).success,false);
});

test('manual corrections clear superseded model evidence and retract only the dependent prior measurement',()=>{
 const {frames}=delayedSequence(),report=recoveryReport(frames),coords=[p(.21,.53),p(.2,.71),p(.18,.87)];
 const changed=manuallyCorrectKnee(report,frames[3].t,'L',coords);
 assert.equal(changed.frames[3].manual,true);assert.equal(changed.frames[3].track.verification.compared.includes(25),false);
 assert.equal(changed.frames[2].points[25].v,0);assert.match(changed.frames[2].track.withheld.L,/人工修改/);assert.deepEqual(changed.frames[2].points[26],frames[2].points[26]);
 assert.equal(reportSchema.safeParse(changed).success,true);assert.ok(report.frames[2].points[25].v>=.65);
 const corrected=manuallyCorrectKnee(report,frames[2].t,'L',coords);assert.equal(corrected.frames[2].track.recovered,undefined);assert.equal(reportSchema.safeParse(corrected).success,true);
});
test('opposite anatomical legs are withheld instead of automatically swapped',()=>{
 const c=athlete(),r=second(c);
 for(const [a,b] of [[13,14],[15,16],[19,22],[17,20]])[r.joints[a],r.joints[b]]=[r.joints[b],r.joints[a]];
 const v=verifyWholebody(c,r,1000,1000),f=tracker().update([v],0,true);
 assert.equal(f.track.state,'locked');assert.ok(f.track.withheld.L);assert.ok(f.track.withheld.R);
 assert.equal(knee(f,'L',1000,1000,'side-left'),null);assert.deepEqual(v.points,c.points);
});
test('one occluded leg stops only its measurements and does not stop the moving target',()=>{
 const c=athlete(),r=second(c);r.joints[15].score=.2;
 const f=tracker().update([verifyWholebody(c,r,1000,1000)],0,true);
 assert.equal(f.track.state,'locked');assert.equal(knee(f,'L',1000,1000,'side-left'),null);
 assert.notEqual(knee(f,'R',1000,1000,'side-right'),null);assert.equal(f.points[27].v,0);
});
test('a hidden heel or toe cannot create ground contact from a visible ankle',()=>{
 const c=athlete(),r=second(c);r.joints[19].score=.1;r.joints[17].score=.1;
 const f=tracker().update([verifyWholebody(c,r,1000,1000)],0,true);
 assert.equal(f.points[29].v,0);assert.equal(f.points[31].v,0);assert.notEqual(knee(f,'L',1000,1000,'side-left'),null);
 assert.equal(contactCandidate(f,'L',{...defaults(),ground:[p(0,.89),p(1,.89)],clearFeet:true}),'unknown');
});
test('a rejected toe never becomes a temporal reference or drags the tracking crop',()=>{
 const tr=tracker(),c=athlete();tr.update([verifyWholebody(c,second(c),1000,1000)],0,true);
 for(let i=1;i<5;i++){
  const next=athlete(),r=second(next);next.points[31].x=i%2?.85:.05;
  next.box=[p(.05,.08),p(.90,.97)];
  const f=tr.update([verifyWholebody(next,r,1000,1000)],i/30,true);
  assert.equal(f.track.state,'locked');assert.equal(f.points[31].v,0);assert.notEqual(knee(f,'L',1000,1000,'side-left'),null);assert.ok(f.track.box[1].x<.5);
 }
});
test('a wrist from another athlete is hidden without joining it to the target arm',()=>{
 const c=athlete(),r=second(c);r.joints[9].x+=.22;
 const f=tracker().update([verifyWholebody(c,r,1000,1000)],0,true);
 assert.equal(f.points[15].v,0);assert.equal(f.points[16].v,1);assert.equal(f.track.state,'locked');
});
test('another head inside the crop cannot verify the selected torso',()=>{
 const c=athlete(),r=second(c);for(const i of [0,5,6])r.joints[i].x+=.18;
 const f=tracker().update([verifyWholebody(c,r,1000,1000)],0,true);
 assert.equal(f.track.state,'searching');assert.deepEqual(f.points,[]);
});
test('independent model agreement resolves a coarse-crop disagreement but not a real rival collision',()=>{
 const c=athlete();c.uncertainSides=['L'];
 const v=verifyWholebody(c,second(c),1000,1000);assert.deepEqual(v.uncertainSides,[]);
 const bad=second(c);bad.joints[13].x+=.15;
 assert.ok(verifyWholebody(c,bad,1000,1000).uncertainSides.includes('L'));
});
test('SimCC decoding preserves left heel and right heel indices and rejects malformed tensors',()=>{
 const x=new Float32Array(133*384),y=new Float32Array(133*512);
 x[19*384+100]=.8;y[19*512+440]=.9;x[22*384+300]=1.1;y[22*512+450]=1.2;
 const r=decodeWholebody(x,y);assert.equal(r.joints[19].x,100/384);assert.equal(r.joints[22].x,300/384);assert.ok(r.joints[22].score>1);
 assert.throws(()=>decodeWholebody(x.subarray(0,100),y));x[2]=NaN;assert.throws(()=>decodeWholebody(x,y));
});
test('padded affine mapping retains out-of-frame positions rather than clamping them into visible joints',()=>{
 const r=wholebodyRegion([p(0,0),p(.1,.5)],1920,1080);assert.ok(r.x<0);assert.ok(Math.abs(r.width/r.height-.75)<1e-9);
 const restored=restoreWholebody({joints:[{x:0,y:0,score:.9}]},r,1920,1080);assert.ok(restored.joints[0].x<0);
 const rgba=new Uint8ClampedArray(192*256*4);rgba[0]=255;rgba[1]=128;
 const t=wholebodyTensor(rgba);assert.ok(Math.abs(t[0]-(255-123.675)/58.395)<1e-6);assert.ok(Math.abs(t[192*256]-(128-116.28)/57.12)<1e-6);
});
test('report validation preserves rejected joints and cannot drop second-model evidence from new measurements',()=>{
 const c=athlete(),q=second(c);q.joints[9].x+=.22;
 const f=tracker().update([verifyWholebody(c,q,1000,1000)],0,true);
 const r=selectTarget({schema:1,engine:'test',id,version:0,created:'2026-09-14T00:00:00Z',settings:{...defaults(),end:1},file:{name:'test.mov',size:10,duration:1,width:1000,height:1000,sha256:'a'.repeat(64)},frames:[],events:[],judge:{contact:'pending',left:'pending',right:'pending'},notes:'',complete:false},seed,0,id,id);
 r.frames=[f];r.complete=true;r.tracking={method:'target-lock-v2',pipeline:'full-rtmpose-v1',targetId:id,status:'complete',lastTime:0};
 assert.equal(reportSchema.safeParse(r).success,true);
 const forged=structuredClone(r);forged.frames[0].points[15].v=1;assert.equal(reportSchema.safeParse(forged).success,false);
 const missing=structuredClone(r);delete missing.frames[0].track.verification;assert.equal(reportSchema.safeParse(missing).success,false);
});
