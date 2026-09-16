const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ContinuousTargetTracker}=require('../.qa/continuous-tracker.js');
const {candidateGeometry,colourSignature}=require('../.qa/target-tracker.js');
const {combinePosePasses}=require('../.qa/pose-region.js');
const {defaults,scopeFrame,selectTarget,trackingNotice,trackingBox,knee,kneeWindows,cadence,flights,torso,pelvicTilt}=require('../.qa/racewalk.js');
const {observeKnee,bilateralInspection,trackingIntervals,angleSegments}=require('../.qa/inspection.js');
const {reportSchema}=require('../.qa/report-schema.js');
const {htmlReport,csvReport}=require('../.qa/export-report.js');
const id='6218e496-3a8b-469d-99ca-eb046b5b26f2';
const p=(x,y,v=1)=>({x,y,v}),seed=[p(.1,.05),p(.4,.98)];
function person(x=.25,rgb=[20,30,180],verified=true){
 const points=Array.from({length:33},()=>p(x,.5,0));
 for(const [i,dx,y] of [[0,0,.12],[11,-.04,.28],[12,.04,.28],[23,-.035,.53],[24,.035,.53],[25,-.05,.70],[26,.05,.70],[27,-.05,.87],[28,.05,.87],[29,-.06,.88],[30,.06,.88],[31,-.02,.89],[32,.10,.89]])points[i]=p(x+dx,y);
 const c=candidateGeometry(points,1000,1000);assert.ok(c);
 c.appearance=colourSignature(Array.from({length:30},()=>rgb).flat());
 return verified?combinePosePasses([[c],[structuredClone(c)]],1000,1000).candidates[0]:c;
}
const tracker=()=>new ContinuousTargetTracker({id,time:0},seed,1000,1000,1);
function report(frames){
 const r=selectTarget({schema:1,engine:'test',id,version:1,created:'2026-09-14T00:00:00Z',settings:{...defaults(),end:2,timingVerified:true},file:{name:'test.mp4',size:100,duration:2,width:1000,height:1000,sha256:'a'.repeat(64)},frames:[],events:[],judge:{contact:'pending',left:'pending',right:'pending'},notes:'',complete:false},seed,0,id,id);
 return {...r,frames,complete:true,tracking:{method:'target-lock-v2',targetId:id,status:'complete',lastTime:frames.at(-1).t}};
}
function recovery(){
 const tr=tracker(),frames=[tr.update([person()],0,true),tr.update([],1/30,true)];
 for(let i=2;i<8;i++)frames.push(tr.update([person(.25+i*.002)],i/30,true));
 return {tr,frames};
}

test('continuous tracking follows one moving target independent of detector order',()=>{
 const tr=tracker();
 for(let i=0;i<45;i++){
  const c=person(.25+i*.003),other=person(.8,[200,30,30]);
  const f=tr.update(i%2?[c,other]:[other,c],i/30,true);
  assert.equal(f.track.state,'locked');assert.equal(f.track.continuity,0);assert.equal(f.track.targetId,id);assert.deepEqual(f.points[0],c.points[0]);
 }
 assert.ok(tr.regionAt(1.5)[0].x>seed[0].x);
});
test('a missing observation continues processing and needs three corroborated frames before recovery',()=>{
 const {frames}=recovery();
 assert.deepEqual(frames.map(f=>f.track.state),['locked','searching','searching','searching','locked','locked','locked','locked']);
 for(const f of frames.slice(1,4)){assert.deepEqual(f.points,[]);assert.equal(f.track.continuity,0);assert.ok(f.reason);}
 assert.equal(frames[2].track.tentative,true);assert.equal(frames[3].track.tentative,true);
 assert.equal(frames[4].track.continuity,1);assert.ok(frames[4].track.withheld.L);assert.ok(frames[4].track.withheld.R);
 assert.equal(observeKnee(frames[4],'L',1000,1000,'side-left').value,null);
 assert.notEqual(observeKnee(frames[5],'L',1000,1000,'side-left').value,null);
 assert.deepEqual(frames[1].points,[]); // Later recovery must not backfill it.
});
test('each later interruption creates a separate measured interval while the target id stays fixed',()=>{
 const {tr,frames}=recovery();frames.push(tr.suspend(8/30,true,'different crop ambiguity'));
 for(let i=9;i<15;i++)frames.push(tr.update([person(.25+i*.002)],i/30,true));
 assert.equal(frames.at(-1).track.continuity,2);
 assert.ok(frames.every(f=>f.track.targetId===id));
 assert.equal(reportSchema.safeParse(report(frames)).success,true);
});
test('matching clothes without cross-crop torso confirmation do not restore measurements',()=>{
 const tr=tracker();tr.update([person()],0,true);tr.update([],1/30,true);
 for(let i=2;i<12;i++){const f=tr.update([person(.25,undefined,false)],i/30,true);assert.equal(f.track.state,'searching');assert.deepEqual(f.points,[]);}
 for(let i=12;i<15;i++){const c=person();c.points[0].v=.4;assert.equal(tr.update([c],i/30,true).track.state,'searching');}
});
test('a different uniform at the previous position is never adopted during search',()=>{
 const tr=tracker();tr.update([person()],0,true);tr.update([],1/30,true);
 for(let i=2;i<25;i++){const f=tr.update([person(.25,[240,220,20])],i/30,true);assert.equal(f.track.state,'searching');assert.equal(f.points.length,0);}
});
test('a similar-uniform crossing stays unresolved when only one of the competitors returns',()=>{
 const tr=tracker();tr.update([person()],0,true);
 assert.equal(tr.update([person(.25),person(.30)],1/30,true).track.state,'searching');
 for(let i=2;i<35;i++){const f=tr.update([person()],i/30,true);assert.equal(f.track.state,'searching');assert.match(f.reason,/交錯/);assert.equal(f.points.length,0);}
});
test('duplicate estimates from separate passes do not masquerade as a permanent two-person crossing',()=>{
 const tr=tracker();tr.update([person()],0,true);
 const a=person(),b=person(.30);a.detectionPasses=[0];b.detectionPasses=[1];
 assert.equal(tr.update([a,b],1/30,true).track.state,'searching');
 let f;for(let i=2;i<6;i++)f=tr.update([person()],i/30,true);
 assert.equal(f.track.state,'locked');
});
test('long absence remains a sampled gap through the end instead of adopting a similar arrival',()=>{
 const tr=tracker();const frames=[tr.update([person()],0,true)];
 for(let i=1;i<60;i++)frames.push(tr.update(i<50?[]:[person()],i/30,true));
 assert.equal(frames.length,60);assert.equal(frames.at(-1).track.state,'searching');
 assert.equal(frames.at(-1).t,59/30);assert.equal(frames.at(-1).points.length,0);
 assert.match(trackingNotice(report(frames)),/已掃描完整區間.*59 格/);
 assert.equal(reportSchema.safeParse(report(frames)).success,true);
});
test('failed initial acquisition cannot pick a later intruder from a static selection',()=>{
 const tr=tracker();assert.equal(tr.update([],0,true).track.state,'searching');
 for(let i=1;i<20;i++){
  const f=tr.update([person()],i/30,true);assert.equal(f.track.state,'searching');assert.equal(f.track.box,undefined);assert.deepEqual(f.points,[]);
 }
});
test('repeated timestamps and broken verification sequences do not count as three unique observations',()=>{
 const tr=tracker();tr.update([person()],0,true);tr.update([],1/30,true);
 for(let i=0;i<5;i++)assert.equal(tr.update([person()],2/30,true).track.state,'searching');
 tr.suspend(3/30,true,'ambiguous');
 assert.equal(tr.update([person()],4/30,true).track.state,'searching');
 assert.equal(tr.update([person()],5/30,true).track.state,'searching');
 assert.equal(tr.update([person()],6/30,true).track.state,'locked');
});
test('a moving provisional box is visibly tentative and never becomes a skeleton or angle',()=>{
 const {frames}=recovery(),r=report(frames),f=frames[2];
 assert.deepEqual(trackingBox(f,r.settings,f.t).box,f.track.box);
 assert.match(trackingBox(f,r.settings,f.t).label,/核對.*不取值/);
 assert.ok(trackingBox(f,r.settings,f.t).dashed);
 const forged={...f,reason:undefined,points:person().points};
 assert.equal(scopeFrame(forged,r.settings).points.length,0);
 assert.equal(observeKnee(forged,'L',1000,1000,'side-left').value,null);
 assert.equal(knee(forged,'L',1000,1000,'side-left'),null);
 assert.equal(torso(forged,1000,1000),null);assert.equal(pelvicTilt(forged,1000,1000,'front'),null);
});
test('reports and exports retain search gaps and reject measurements or reused continuity across them',()=>{
 const {frames}=recovery(),r=report(frames);assert.equal(reportSchema.safeParse(r).success,true);
 assert.match(htmlReport(r),/搜尋／核對/);assert.match(csvReport(r),/搜尋／核對/);
 const forged=structuredClone(r);forged.frames[1].points=person().points;
 assert.equal(reportSchema.safeParse(forged).success,false);
 const bridged=structuredClone(r);for(const f of bridged.frames)f.track.continuity=0;
 assert.equal(reportSchema.safeParse(bridged).success,false);
 const provisional=structuredClone(r);provisional.frames[4].track.tentative=true;
 assert.equal(reportSchema.safeParse(provisional).success,false);
 const foreign=structuredClone(r);foreign.frames[4].track.targetId='7218e496-3a8b-469d-99ca-eb046b5b26f2';
 assert.equal(reportSchema.safeParse(foreign).success,false);
});
test('identity gaps cannot become knee windows, cadence, flight or joined angle curves',()=>{
 const {frames}=recovery(),r=report(frames);
 r.events=[{id:'a',t:0,side:'L',kind:'IC'},{id:'b',t:7/30,side:'L',kind:'VERTICAL'},{id:'c',t:5/30,side:'R',kind:'IC'},{id:'d',t:7/30,side:'L',kind:'IC'},{id:'e',t:0,side:'L',kind:'TO'}].map(e=>({...e,status:'confirmed',origin:'manual',note:''}));
 assert.deepEqual(kneeWindows(r),[]);assert.equal(cadence(r),null);assert.deepEqual(flights(r),[]);
 const data=bilateralInspection(r)[0],lines=angleSegments(data.samples,.06);
 assert.equal(lines.length,2);assert.equal(lines[0].length,1);assert.ok(lines[1][0].t>=5/30);
});
test('the tracking strip keeps sparse unsampled time gray and distinguishes identity from leg availability',()=>{
 const {frames}=recovery(),r=report(frames);r.settings.end=1;
 const strips=trackingIntervals(r);
 assert.deepEqual(strips.map(s=>s.state),['locked','searching','locked']);
 assert.ok(strips.at(-1).end<.3);
 assert.ok(strips[2].start<5/30); // Identity is known before the leg gate clears.
});
test('real processing failure stays distinct from a recoverable identity gap',()=>{
 const tr=tracker();const good=tr.update([person()],0,true),bad=tr.stop(1/30,false,'decoder unavailable');
 assert.equal(bad.track.state,'lost');assert.deepEqual(bad.points,[]);
 const r={...report([good,bad]),complete:false,tracking:{method:'target-lock-v2',targetId:id,status:'lost',lastTime:bad.t,reason:bad.reason}};
 assert.equal(reportSchema.safeParse(r).success,true);assert.match(trackingNotice(r),/處理未完成.*重試分析/);
});
