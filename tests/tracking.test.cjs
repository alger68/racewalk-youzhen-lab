const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TargetTracker,candidateGeometry,colourSignature}=require('../.qa/target-tracker.js');
const {defaults,scopeFrame,selectTarget,summarize,trackingNotice,trackingBox,hasAcquiredTarget,angle,cadence,contactCandidate,kneeWindows,flights}=require('../.qa/racewalk.js');
const {poseRegion,restorePose,combinePosePasses}=require('../.qa/pose-region.js');
const {peopleRegions,personChoices,selectDetectedTarget,detectedPerson}=require('../.qa/people.js');
const {observeKnee,bilateralInspection}=require('../.qa/inspection.js');
const {reportSchema}=require('../.qa/report-schema.js');
const {htmlReport,csvReport}=require('../.qa/export-report.js');
const id='6218e496-3a8b-469d-99ca-eb046b5b26f2',otherId='7218e496-3a8b-469d-99ca-eb046b5b26f2';
const p=(x,y,v=1)=>({x,y,v}),seed=[p(.1,.05),p(.4,.98)];
const colour=rgb=>colourSignature(Array.from({length:30},()=>rgb).flat());
function person(x=.25,rgb=[20,30,180]){
 const points=Array.from({length:33},()=>p(x,.5,0));
 for(const [i,dx,y] of [[0,0,.12],[11,-.04,.28],[12,.04,.28],[23,-.035,.53],[24,.035,.53],[25,-.05,.70],[26,.05,.70],[27,-.05,.87],[28,.05,.87],[29,-.06,.88],[30,.06,.88],[31,-.02,.89],[32,.10,.89]])points[i]=p(x+dx,y);
 const c=candidateGeometry(points,1000,1000);assert.ok(c);c.appearance=colour(rgb);return c;
}
const tracker=()=>new TargetTracker({id,time:0},seed,1000,1000,1);
function base(){return {schema:1,engine:'test',id,version:1,created:'2026-09-14T00:00:00Z',settings:{...defaults(),end:2},file:{name:'test.mp4',size:100,duration:2,width:1000,height:1000,sha256:'a'.repeat(64)},frames:[],events:[],judge:{contact:'pending',left:'pending',right:'pending'},notes:'',complete:false};}

test('one seed follows the same moving person even when detector result order changes',()=>{
 const tr=tracker();let last;
 for(let i=0;i<35;i++){
  const target=person(.25+i*.004),rival=person(.76,[200,30,30]);
  const f=tr.update(i%2?[rival,target]:[target,rival],i/30,true);
  assert.equal(f.track.state,'locked');assert.equal(f.track.targetId,id);assert.equal(f.points[0].x,target.points[0].x);last=f;
 }
 assert.ok(last.track.box[0].x>.3);assert.notDeepEqual(last.track.box,seed);
});
test('ambiguous initial selection is rejected, never assigned to array item zero',()=>{
 const f=tracker().update([person(.25),person(.34)],0,true);
 assert.equal(f.track.state,'lost');assert.equal(f.points.length,0);assert.match(f.reason,/多個/);
});
test('loss is latched: another athlete entering, or the original returning, cannot resume the run',()=>{
 const tr=tracker();tr.update([person()],0,true);
 const lost=tr.update([person(.7)],1/30,true);assert.equal(lost.track.state,'lost');assert.equal(lost.points.length,0);
 const returned=tr.update([person()],2/30,true);assert.equal(returned.track.state,'lost');assert.equal(returned.points.length,0);
});
test('appearance mismatch blocks a different athlete at the same position',()=>{
 const tr=tracker();tr.update([person()],0,true);
 const f=tr.update([person(.25,[220,220,20])],1/30,true);assert.equal(f.track.state,'lost');assert.equal(f.points.length,0);
});
test('crossing similarly dressed athletes stops before uncertain identities are accepted',()=>{
 const tr=tracker();tr.update([person(.25),person(.65)],0,true);
 const f=tr.update([person(.26),person(.30)],1/30,true);assert.equal(f.track.state,'lost');assert.equal(f.points.length,0);
});
test('large position jumps, long gaps and a wrong anchor frame stop association',()=>{
 for(const [x,t] of [[.65,1/30],[.26,.5]]){const tr=tracker();tr.update([person()],0,true);assert.equal(tr.update([person(x)],t,true).track.state,'lost');}
 assert.equal(tracker().update([person()],1,true).track.state,'lost');
});
test('leg-only occlusion with distinct torsos masks the affected side and keeps the selected identity',()=>{
 const selected=person(.25),rival=person(.6,[220,20,20]);rival.points[25]=p(selected.points[25].x+.01,selected.points[25].y);
 const f=tracker().update([selected,rival],0,true);assert.equal(f.track.state,'locked');assert.match(f.track.withheld.L,/交錯遮擋/);assert.equal(observeKnee(f,'L',1000,1000,'side-left').value,null);assert.notEqual(observeKnee(f,'R',1000,1000,'side-left').value,null);
});
test('occluded joints and abrupt leg replacements remain unavailable without losing a clear torso',()=>{
 const tr=tracker();tr.update([person()],0,true);const hidden=person(.254);hidden.points[25].v=.1;
 const f=tr.update([hidden],1/30,true);assert.equal(f.track.state,'locked');assert.equal(observeKnee(f,'L',1000,1000,'side-left').value,null);assert.notEqual(observeKnee(f,'R',1000,1000,'side-left').value,null);
 const tr2=tracker();tr2.update([person()],0,true);const jumped=person(.254);jumped.points[27]=p(.8,.88);
 const bad=tr2.update([jumped],1/30,true);assert.equal(bad.track.state,'locked');assert.match(bad.track.withheld.L,/跳動/);assert.equal(bad.points[27].v,0);assert.equal(bad.points[28].v,1);
});
test('reselection isolates frames, events and judgments without changing the previous report',()=>{
 const old=base();old.frames=[tracker().update([person()],0,true)];old.events=[{id:'old',t:0,side:'L',kind:'IC',status:'confirmed',origin:'manual',note:'old'}];old.judge.left='concern';
 const next=selectTarget(old,seed,1,otherId,otherId);
 assert.equal(next.id,otherId);assert.equal(next.version,0);assert.equal(next.settings.start,1);assert.equal(next.settings.target.id,otherId);
 assert.equal(next.frames.length,0);assert.equal(next.events.length,0);assert.equal(next.judge.left,'pending');assert.equal(next.file.sha256,old.file.sha256);assert.equal(old.frames.length,1);assert.equal(old.judge.left,'concern');
 assert.equal(reportSchema.safeParse(next).success,true);
});
test('schema and every displayed data series reject foreign targets and post-loss measurements',()=>{
 const r=selectTarget(base(),seed,0,id,id),tr=tracker();const good=tr.update([person()],0,true);
 r.frames=[good,{...good,t:.033,track:{...good.track,targetId:otherId}}];
 assert.equal(reportSchema.safeParse(r).success,false);assert.equal(summarize(r).usable,1);assert.equal(scopeFrame(r.frames[1],r.settings).points.length,0);
 assert.equal(bilateralInspection(r)[0].valid,1);
 r.frames=[good,tr.stop(.033,true,'遮擋'),{...good,t:.066}];assert.equal(reportSchema.safeParse(r).success,false);
 r.frames=r.frames.slice(0,2);r.tracking={method:'target-lock-v1',targetId:id,status:'lost',lastTime:.033,reason:'遮擋'};assert.equal(reportSchema.safeParse(r).success,true);
 assert.match(htmlReport(r),/追蹤中斷/);assert.match(csvReport(r),/追蹤中斷/);
 r.complete=true;assert.equal(reportSchema.safeParse(r).success,false);
});
test('confirmed contact labels across a lost interval cannot create cadence',()=>{
 const r=selectTarget(base(),seed,0,id,id),tr=tracker();r.settings.timingVerified=true;r.frames=[tr.update([person()],0,true),tr.stop(.1,true,'遮擋')];
 r.events=[0,.3,.6].map((t,i)=>({id:String(i),t,side:i%2?'R':'L',kind:'IC',status:'confirmed',origin:'manual',note:''}));
 assert.equal(cadence(r),null);
});
test('legacy reports remain readable and are explicitly flagged in reports and exports',()=>{
 const r=base();r.frames=[{t:0,exact:true,points:person().points}];assert.equal(reportSchema.safeParse(r).success,true);
 assert.match(trackingNotice(r),/舊版未鎖定/);assert.match(htmlReport(r),/舊版未鎖定/);assert.match(csvReport(r),/舊版未鎖定/);
});

test('initial detection failure is never presented as a last tracked position or a gait verdict',()=>{
 const r=selectTarget(base(),seed,0,id,id),f=tracker().update([],0,true,0);
 r.frames=[f];r.tracking={method:'target-lock-v1',targetId:id,status:'lost',lastTime:0,reason:f.reason};
 assert.equal(hasAcquiredTarget(r),false);assert.equal(summarize(r).usable,0);
 assert.match(trackingNotice(r),/尚未鎖定/);assert.doesNotMatch(trackingNotice(r),/追蹤中斷/);
 assert.match(trackingBox(f,r.settings,0).label,/尚未鎖定/);assert.doesNotMatch(trackingBox(f,r.settings,0).label,/最後/);
 assert.equal(trackingBox(f,r.settings,.5),null);
 assert.match(htmlReport(r),/尚未鎖定/);assert.match(csvReport(r),/尚未鎖定/);
 assert.equal(reportSchema.safeParse(r).success,true);
});
test('a real tracking loss preserves the last acquired box, not the seed rectangle',()=>{
 const r=selectTarget(base(),seed,0,id,id),tr=tracker();r.frames=[tr.update([person()],0,true),tr.update([person(.255)],1/30,true),tr.stop(2/30,true,'遮擋')];
 r.tracking={method:'target-lock-v1',targetId:id,status:'lost',lastTime:2/30,reason:'遮擋'};
 assert.equal(hasAcquiredTarget(r),true);assert.match(trackingNotice(r),/追蹤中斷/);
 const box=trackingBox(r.frames[2],r.settings,2/30);assert.match(box.label,/最後可靠位置/);assert.deepEqual(box.box,r.frames[1].track.box);assert.notDeepEqual(box.box,seed);
});
test('initial diagnostics distinguish no detector output, unusable bodies, and candidates outside selection',()=>{
 assert.match(tracker().update([],0,true,0).reason,/均未偵測到骨架/);
 assert.match(tracker().update([],0,true,2).reason,/肩、髖或身體大小/);
 assert.match(tracker().update([person(.7)],0,true,1).reason,/軀幹落在圈選內/);
});
test('focus and context regions preserve pixel alignment at video edges and reversed selections',()=>{
 for(const box of [[p(.95,.96),p(.85,.55)],[p(.02,.01),p(.15,.4)]]){
  const focused=poseRegion(box,1920,1080),context=poseRegion(box,1920,1080,true);
  for(const region of [focused,context])for(const q of region){assert.ok(q.x>=0&&q.x<=1&&q.y>=0&&q.y<=1);assert.ok(Math.abs(q.x*1920-Math.round(q.x*1920))<1e-8);assert.ok(Math.abs(q.y*1080-Math.round(q.y*1080))<1e-8);}
  assert.ok(context[0].x<=focused[0].x&&context[1].x>=focused[1].x);
 }
});
test('cropped coordinates restore the same knee angle in a non-square original video',()=>{
 const region=[p(.2,.15),p(.6,.9)],original=[p(.3,.3),p(.33,.5),p(.4,.65)];
 const local=original.map(q=>p((q.x-.2)/.4,(q.y-.15)/.75));
 const restored=restorePose(local,region);
 assert.ok(Math.abs(angle(...restored,1920,1080)-angle(...original,1920,1080))<.01);
 const outside=restorePose([p(1.1,.5)],region)[0];assert.ok(outside.x<1);assert.equal(outside.v,0);
});
test('focused acquisition succeeds when full-scene detection misses the selected person',()=>{
 const focused=person(),rival=person(.7,[200,30,30]);
 const merged=combinePosePasses([[focused],[person(),rival],[]],1000,1000);
 assert.equal(merged.reason,undefined);assert.equal(merged.candidates.length,2);
 const f=tracker().update(merged.candidates,0,true,3);assert.equal(f.track.state,'locked');assert.deepEqual(f.points,focused.points);
});
test('cross-pass leg disagreement withholds that entire side and retains one intact target pose',()=>{
 const focused=person(),context=person();context.points[26]=p(.4,.70);
 const merged=combinePosePasses([[focused],[context]],1000,1000),f=tracker().update(merged.candidates,0,true,2);
 assert.equal(f.track.state,'locked');assert.deepEqual(f.points[25],focused.points[25]);
 assert.notEqual(observeKnee(f,'L',1000,1000,'side-left').value,null);assert.equal(observeKnee(f,'R',1000,1000,'side-right').value,null);
 for(const i of [24,26,28,30,32])assert.equal(f.points[i].v,0);
 assert.match(f.track.note,/右腳.*不一致/);assert.equal(focused.points[26].v,1);
 const r=selectTarget(base(),seed,0,id,id);r.frames=[f];assert.equal(reportSchema.parse(r).frames[0].track.note,f.track.note);
});
test('duplicate reconciliation never collapses two people detected within the same pass',()=>{
 const merged=combinePosePasses([[person()],[person(.25),person(.26)]],1000,1000);
 assert.match(merged.reason,/多個重疊目標/);assert.equal(merged.candidates.length,0);
 const samePass=combinePosePasses([[person(.25),person(.27)]],1000,1000);
 assert.equal(samePass.candidates.length,2);assert.equal(tracker().update(samePass.candidates,0,true,2).track.state,'lost');
});
test('withholding uncertain measurements cannot hide raw cross-athlete leg collisions',()=>{
 const focused=person(),context=person(),rival=person(.7,[220,20,20]);
 context.points[26]=p(.4,.7);rival.points[25]={...focused.points[26]};
 const merged=combinePosePasses([[focused],[context,rival]],1000,1000);
 const f=tracker().update(merged.candidates,0,true,3);assert.equal(f.track.state,'locked');assert.match(f.track.withheld.R,/交錯遮擋/);for(const i of [24,26,28,30,32])assert.equal(f.points[i].v,0);assert.equal(f.points[25].v,1);
});

test('high-confidence inverted torso and a head below the hips are not additional race walkers',()=>{
 const inverted=person().points.map(q=>({...q}));
 for(const i of [11,12])inverted[i].y=.6;
 for(const i of [23,24])inverted[i].y=.39;
 inverted[0].y=.62;
 assert.equal(candidateGeometry(inverted,1000,1000),null);
 const headBelow=person().points.map(q=>({...q}));headBelow[0].y=.7;
 assert.equal(candidateGeometry(headBelow,1000,1000),null);
 const leaning=person().points.map(q=>({...q}));for(const i of [0,11,12])leaning[i].x+=.10;
 assert.ok(candidateGeometry(leaning,1000,1000));
});
test('an inverted full-scene hallucination cannot interrupt two agreeing views of one moving athlete',()=>{
 const tr=tracker();
 for(let i=0;i<35;i++){
  const x=.25+i*.003,focused=person(x),context=person(x),phantom=person(x).points.map(q=>({...q}));
  for(const j of [11,12])phantom[j].y=.6;for(const j of [23,24])phantom[j].y=.39;phantom[0].y=.62;
  const scene=candidateGeometry(phantom,1000,1000);
  const m=combinePosePasses([[focused],[context],scene?[scene]:[]],1000,1000);
  assert.equal(m.candidates.length,1);assert.deepEqual(m.candidates[0].detectionPasses,[0,1]);
  const f=tr.update(m.candidates,i/30,true,3);assert.equal(f.track.state,'locked');assert.equal(f.points[0].x,focused.points[0].x);
 }
});
test('invalid target observations still stop the run and cannot be used to reattach another athlete',()=>{
 const tr=tracker();tr.update([person()],0,true);
 const invalid=person().points.map(q=>({...q}));for(const i of [11,12])invalid[i].y=.7;
 const c=candidateGeometry(invalid,1000,1000),f=tr.update(c?[c]:[],1/30,true,1);
 assert.equal(f.track.state,'lost');assert.equal(f.points.length,0);
 assert.equal(tr.update([person()],2/30,true).track.state,'lost');
});
test('pass provenance distinguishes repeated estimates from independently detected people',()=>{
 const m=combinePosePasses([[person()],[person(),person(.7,[200,20,20])],[person()]],1000,1000);
 assert.equal(m.candidates.length,2);assert.deepEqual(m.candidates[0].detectionPasses,[0,1,2]);assert.deepEqual(m.candidates[1].detectionPasses,[1]);
 const f=tracker().update(m.candidates,0,true,4);assert.equal(f.track.state,'locked');assert.equal(f.track.detectionPasses,undefined);
});
function shiftedTorso(){
 const c=person(.25,[220,20,20]),points=c.points.map(q=>({...q}));
 for(const i of [0,11,12,23,24])points[i].y+=.1;
 const changed=candidateGeometry(points,1000,1000);assert.ok(changed);changed.appearance=c.appearance;return changed;
}
test('unresolved estimates from separate passes stop values without claiming another athlete overlaps',()=>{
 const tr=tracker();tr.update([person()],0,true);
 const m=combinePosePasses([[person()],[shiftedTorso()]],1000,1000),f=tr.update(m.candidates,1/30,true,2);
 assert.equal(f.track.state,'lost');assert.equal(f.points.length,0);assert.match(f.reason,/未能合併的骨架/);assert.doesNotMatch(f.reason,/選手的軀幹疑似重疊/);
});
test('two upright people detected together retain the torso-overlap stop',()=>{
 const tr=tracker();tr.update([person()],0,true);
 const m=combinePosePasses([[person()],[person(),shiftedTorso()]],1000,1000),f=tr.update(m.candidates,1/30,true,3);
 assert.equal(m.candidates.length,2);assert.equal(f.track.state,'lost');assert.equal(f.points.length,0);assert.match(f.reason,/不同選手的軀幹疑似重疊/);
});

test('whole-frame discovery regions cover the full image and retain overlapping person context',()=>{
 const regions=peopleRegions(1920,1080);assert.equal(regions.length,10);
 for(let x=0;x<=1;x+=.05)for(let y=0;y<=1;y+=.05)assert.ok(regions.slice(0,-1).some(([a,b])=>x>=a.x&&x<=b.x&&y>=a.y&&y<=b.y));
 for(const region of regions)for(const q of region){assert.ok(q.x>=0&&q.x<=1&&q.y>=0&&q.y<=1);assert.ok(Math.abs(q.x*1920-Math.round(q.x*1920))<1e-8);assert.ok(Math.abs(q.y*1080-Math.round(q.y*1080))<1e-8);}
});
test('all-person preview offers each discovered body once and keeps left-to-right choices stable',()=>{
 const choices=personChoices([[person(.7),person(.25)],[person(.254),person(.702)],[person(.5)]],1000,1000);
 assert.equal(choices.length,3);assert.deepEqual(choices.map(c=>c.id),['person-1','person-2','person-3']);
 assert.ok(choices[0].box[0].x<choices[1].box[0].x&&choices[1].box[0].x<choices[2].box[0].x);
});
test('preview never collapses two distinct detections in the same image pass',()=>{
 const choices=personChoices([[person(.25),person(.27)]],1000,1000);assert.equal(choices.length,2);
});
test('head and torso agreement merges stride-dependent rectangles for arbitrary person counts',()=>{
 for(const count of [1,2,4,6])for(const factor of [.5,1,2]){
  const people=Array.from({length:count},(_,i)=>person(.10+i*.15));
  const second=people.map(c=>({...structuredClone(c),box:[p(c.box[0].x-.15,0),p(c.box[1].x+.15,1)]}));
  const out=personChoices([people,second],1000*factor,1000*factor);
  assert.equal(out.length,count);assert.ok(out.every(c=>!c.review&&c.support===2));
  for(let i=0;i<count;i++)assert.deepEqual(out[i].points,people[i].points);
 }
});
test('overlapping rectangles cannot merge contradictory heads or co-occurring people',()=>{
 const a=person(.25),b=person(.31);b.box=structuredClone(a.box);
 assert.equal(personChoices([[a],[b]],1000,1000).length,2);
 assert.equal(personChoices([[person(.25),person(.27)],[person(.255),person(.275)]],1000,1000).length,2);
});
test('a chain of individually nearby heads does not join distant endpoints',()=>{
 const out=personChoices([[person(.25)],[person(.28)],[person(.31)]],1000,1000);
 assert.equal(out.length,2);
});
test('one object box joins only its unique anatomical body and never supplies joints',()=>{
 const c=person(.25),object={box:structuredClone(c.box),center:p(.25,.4),scale:.23,points:[],score:.9};
 const out=personChoices([[c],[object]],1000,1000);assert.equal(out.length,1);assert.equal(out[0].review,undefined);assert.deepEqual(out[0].points,c.points);
 const partial={...object,box:[p(.15,.54),p(.40,.98)]};
 const uncertain=personChoices([[c],[partial]],1000,1000);assert.equal(uncertain.length,2);assert.ok(uncertain.find(p=>p.points.length===0).review);
});
test('a broad object detection covering two bodies remains a separate review region',()=>{
 const a=person(.25),b=person(.55),box={box:[p(.10,.07),p(.70,.98)],center:p(.4,.4),scale:.25,points:[],score:.9};
 const choices=personChoices([[a,b],[structuredClone(a),structuredClone(b)],[box]],1000,1000);
 assert.equal(choices.filter(p=>!p.review).length,2);assert.equal(choices.filter(p=>p.review).length,1);
 assert.match(choices.find(p=>p.review).review,/涵蓋/);assert.deepEqual(choices.filter(p=>!p.review).map(p=>p.label),['候選 1','候選 2']);assert.equal(choices.find(p=>p.review).label,'待確認 1');
});
test('a focused recheck can confirm an object-only choice while unsupported regions stay reviewable',()=>{
 const c=person(.25),object={box:structuredClone(c.box),center:p(.25,.4),scale:.23,points:[],score:.9};
 assert.ok(personChoices([[object]],1000,1000)[0].review);
 const checked=personChoices([[object],[c]],1000,1000);assert.equal(checked.length,1);assert.equal(checked[0].review,undefined);
 const r=base(),scan={videoSha:r.file.sha256,time:0,exact:true,people:personChoices([[object]],1000,1000),limited:false};
 const selected=selectDetectedTarget(r,scan,scan.people[0].id,0,id,id);assert.equal(selected.frames.length,0);
});
test('selecting from multiple people seeds only the chosen box and imports no bystander measurements',()=>{
 const r=base(),people=personChoices([[person(.25),person(.7)]],1000,1000),scan={videoSha:r.file.sha256,time:.5,exact:true,people,limited:false};
 const selected=selectDetectedTarget(r,scan,'person-2',.5,otherId,otherId);
 assert.deepEqual(selected.settings.roi,people[1].box);assert.equal(selected.settings.start,.5);assert.equal(selected.settings.target.id,otherId);
 assert.equal(selected.frames.length,0);assert.equal(selected.events.length,0);assert.equal(selected.judge.left,'pending');assert.equal(selected.people,undefined);assert.equal(reportSchema.safeParse(selected).success,true);
});
test('person choices cannot be applied to another video, another timestamp or an unknown person',()=>{
 const r=base(),scan={videoSha:r.file.sha256,time:.5,exact:true,people:personChoices([[person()]],1000,1000),limited:false};
 assert.throws(()=>selectDetectedTarget(r,{...scan,videoSha:'b'.repeat(64)},'person-1',.5,id,id),/不屬於目前影片/);
 assert.throws(()=>selectDetectedTarget(r,scan,'person-1',.8,id,id),/畫面已改變/);
 assert.throws(()=>selectDetectedTarget(r,scan,'person-9',.5,id,id),/找不到/);assert.equal(r.settings.target,undefined);
});
test('choosing a new person from preview preserves the old report and starts a separate segment',()=>{
 const r=base();r.frames=[tracker().update([person()],0,true)];r.notes='old';r.judge.left='concern';
 const scan={videoSha:r.file.sha256,time:.5,exact:true,people:personChoices([[person(.7)]],1000,1000),limited:false};
 const next=selectDetectedTarget(r,scan,'person-1',.5,otherId,otherId);
 assert.notEqual(next.id,r.id);assert.equal(next.frames.length,0);assert.equal(next.notes,'');assert.equal(next.judge.left,'pending');assert.equal(r.frames.length,1);assert.equal(r.judge.left,'concern');assert.equal(r.notes,'old');
});

test('a clicked person uses her torso anchor even if the whole-body box contains another torso',()=>{
 const r=base(),people=personChoices([[person(.25),person(.7)]],1000,1000);people[1].box=[p(.1,.05),p(.9,.98)];
 const scan={videoSha:r.file.sha256,time:0,exact:true,people,limited:false},selected=selectDetectedTarget(r,scan,'person-2',0,otherId,otherId);
 const saved=reportSchema.parse(selected);assert.deepEqual(saved.settings.target.anchor,people[1].center);
 const tr=new TargetTracker(saved.settings.target,saved.settings.roi,1000,1000),f=tr.update([person(.25),person(.7)],0,true,2);
 assert.equal(f.track.state,'locked');assert.equal(f.points[0].x,.7);assert.equal(f.track.targetId,otherId);
});
test('a saved person anchor cannot point outside the selected body region',()=>{
 const r=selectTarget(base(),seed,0,id,id);r.settings.target.anchor=p(.8,.5);
 assert.equal(reportSchema.safeParse(r).success,false);
});

test('object person boxes restore to video coordinates without inventing skeleton points',()=>{
 const c=detectedPerson({originX:100,originY:100,width:100,height:300},.8,[p(.2,.1),p(.7,.9)],500,800,1000,1000);
 assert.ok(c);assert.ok(Math.abs(c.box[0].x-.3)<1e-9);assert.ok(Math.abs(c.box[0].y-.2)<1e-9);assert.ok(Math.abs(c.box[1].x-.4)<1e-9);assert.ok(Math.abs(c.box[1].y-.5)<1e-9);assert.equal(c.points.length,0);
 assert.ok(c.center.y>c.box[0].y&&c.center.y<c.box[1].y);
});
test('an object-only person can be selected when no usable pose has been found yet',()=>{
 const r=base(),c=detectedPerson({originX:600,originY:100,width:180,height:700},.8,[p(0,0),p(1,1)],1000,1000,1000,1000);
 const scan={videoSha:r.file.sha256,time:0,exact:true,people:personChoices([[c]],1000,1000),limited:false};
 assert.equal(scan.people.length,1);assert.equal(scan.people[0].points.length,0);
 const selected=selectDetectedTarget(r,scan,'person-1',0,id,id);assert.equal(selected.frames.length,0);assert.equal(selected.judge.left,'pending');assert.equal(reportSchema.safeParse(selected).success,true);
});
test('tile-clipped half bodies are rejected while genuine video-edge candidates remain selectable',()=>{
 const b={originX:0,originY:20,width:100,height:300};
 assert.equal(detectedPerson(b,.8,[p(.25,0),p(.75,.65)],500,650,1000,1000),null);
 assert.ok(detectedPerson(b,.8,[p(0,0),p(1,1)],1000,1000,1000,1000));
 assert.equal(detectedPerson({...b,width:0},.8,[p(0,0),p(1,1)],1000,1000,1000,1000),null);
});


test('a 0.06-second leg jump cannot drag the tracking box toward a rival or produce that side angles',()=>{
 const tr=tracker();tr.update([person()],0,true);tr.update([person(.254)],.03,true);
 const raw=person(.258);raw.points[27]=p(.8,.88);
 const bad=candidateGeometry(raw.points,1000,1000);bad.appearance=raw.appearance;
 const f=tr.update([bad],.06,true);
 assert.equal(f.track.state,'locked');assert.equal(f.reason,undefined);assert.equal(f.track.targetId,id);
 assert.ok(bad.box[1].x>.8);assert.ok(f.track.box[1].x<.5);
 for(const i of [23,25,27,29,31])assert.equal(f.points[i].v,0);
 assert.equal(observeKnee(f,'L',1000,1000,'side-left').value,null);assert.notEqual(observeKnee(f,'R',1000,1000,'side-left').value,null);
 const settings={...defaults(),roi:seed,target:{id,time:0},ground:[p(0,.89),p(1,.89)],clearFeet:true};
 assert.equal(contactCandidate(f,'L',settings),'unknown');assert.match(trackingBox(f,settings,.06).label,/持續追蹤/);assert.equal(trackingBox(f,settings,.06).dashed,false);
});
test('brief joint uncertainty needs two clean observations to recover and never backfills old frames',()=>{
 const tr=tracker();const first=tr.update([person()],0,true),bad=person(.254);bad.points[27]=p(.8,.88);
 const gap=tr.update([bad],1/30,true),checking=tr.update([person(.258)],2/30,true),recovered=tr.update([person(.262)],3/30,true);
 assert.equal(gap.track.state,'locked');assert.equal(checking.points[27].v,0);assert.match(checking.track.withheld.L,/連續兩格/);
 assert.equal(recovered.points[27].v,1);assert.equal(recovered.track.withheld,undefined);
 assert.equal(first.points[27].v,1);assert.equal(gap.points[27].v,0);assert.equal(checking.points[27].v,0);assert.equal(bad.points[27].v,1);
});
test('a persistent bad leg is never adopted as the new reference while the torso continues moving',()=>{
 const tr=tracker();const start=tr.update([person()],0,true);let last;
 for(let i=1;i<25;i++){
  const raw=person(.25+i*.003);raw.points[27]=p(raw.center.x+.55,.88);
  last=tr.update([raw],i/30,true);assert.equal(last.track.state,'locked');assert.equal(last.points[27].v,0);assert.notEqual(last.track.withheld.L,undefined);assert.equal(last.points[28].v,1);
 }
 assert.ok(last.track.box[0].x>start.track.box[0].x+.06);
});
test('long missing leg intervals need fresh cross-crop agreement before two-frame recovery',()=>{
 const tr=tracker();tr.update([person()],0,true);
 for(let i=1;i<=10;i++){const c=person(.25+i*.002);c.points[25].v=.1;assert.equal(tr.update([c],i/30,true).points[25].v,0);}
 const alone=tr.update([person(.272)],11/30,true);assert.equal(alone.points[25].v,0);assert.match(alone.track.withheld.L,/不同辨識範圍/);
 const a=person(.274),b=person(.276);a.verifiedSides=['L'];b.verifiedSides=['L'];
 assert.equal(tr.update([a],12/30,true).points[25].v,0);assert.equal(tr.update([b],13/30,true).points[25].v,1);
});
test('identity loss during a leg gap is still latched and cannot resume on a returning person',()=>{
 const tr=tracker();tr.update([person()],0,true);const bad=person(.254);bad.points[27]=p(.8,.88);tr.update([bad],1/30,true);
 const lost=tr.update([person(.258,[230,230,20])],2/30,true);assert.equal(lost.track.state,'lost');assert.equal(lost.points.length,0);
 const returned=tr.update([person(.262)],3/30,true);assert.equal(returned.track.state,'lost');assert.equal(returned.points.length,0);
});
test('fresh cross-crop confirmation requires visible agreeing hip knee and ankle points',()=>{
 const a=person(),b=person();b.points[26].v=.1;
 const m=combinePosePasses([[a],[b]],1000,1000);assert.deepEqual(m.candidates[0].verifiedSides,['L']);
 assert.deepEqual(combinePosePasses([[person()]],1000,1000).candidates[0].verifiedSides,[]);
});
test('leg measurement gaps cannot create knee windows, cadence or flight intervals across the gap',()=>{
 const r=selectTarget(base(),seed,0,id,id),tr=tracker();r.settings.timingVerified=true;
 for(let i=0;i<=18;i++){const c=person(.25+i*.002);if(i===2)c.points[27]=p(.8,.88);r.frames.push(tr.update([c],i/30,true));}
 const ev=(t,kind,side)=>({id:`${side}-${kind}-${t}`,t,kind,side,status:'confirmed',origin:'manual',note:''});
 r.events=[ev(0,'IC','L'),ev(.3,'IC','R'),ev(.6,'IC','L')];assert.equal(cadence(r),null);
 r.events=[ev(0,'IC','L'),ev(4/30,'VERTICAL','L')];assert.equal(kneeWindows(r).length,0);
 r.settings.view='side-right';r.events=[ev(0,'IC','R'),ev(4/30,'VERTICAL','R')];assert.equal(kneeWindows(r).length,1);
 r.events=[ev(2/30,'TO','L'),ev(3/30,'IC','R')];assert.equal(flights(r).length,0);
});
test('saved and displayed partial data stay missing and are not labelled as a lost person',()=>{
 const r=selectTarget(base(),seed,0,id,id),tr=tracker();r.frames=[tr.update([person()],0,true)];const c=person(.254);c.points[27]=p(.8,.88);r.frames.push(tr.update([c],1/30,true));
 r.complete=true;r.tracking={method:'target-lock-v1',targetId:id,status:'complete',lastTime:1/30};
 assert.equal(reportSchema.safeParse(r).success,true);assert.match(trackingNotice(r),/1 格有腿部缺值/);assert.doesNotMatch(trackingNotice(r),/追蹤中斷/);
 assert.match(htmlReport(r),/腿部缺值/);assert.match(observeKnee(r.frames[1],'L',1000,1000,'side-left').reason,/跳動/);
 r.frames[1].points[27].v=1;assert.equal(reportSchema.safeParse(r).success,false);assert.equal(scopeFrame(r.frames[1],r.settings).points[27].v,0);
});

const upperBodyFixtures=require('./fixtures/upper-body-duplicates.json');
function recordedCandidates(fixture){
 return fixture.passes.map(pass=>pass.map(points=>{const c=candidateGeometry(points,fixture.width,fixture.height);assert.ok(c);c.appearance=colour([20,30,180]);return c;}));
}
test('recorded 8.16s duplicate with displaced hips cannot veto two agreeing crops of the same head and shoulders',()=>{
 const f=upperBodyFixtures.repeated,passes=recordedCandidates(f),original=JSON.stringify(passes);
 const merged=combinePosePasses(passes,f.width,f.height);
 assert.equal(merged.reason,undefined);assert.equal(merged.candidates.length,1);assert.deepEqual(merged.candidates[0].detectionPasses,[0,1,2]);
 assert.deepEqual(merged.candidates[0].points,passes[0][0].points);assert.equal(JSON.stringify(passes),original);
 const tr=new TargetTracker({id,time:f.previousTime},f.seed,f.width,f.height,1),previous=candidateGeometry(f.previous,f.width,f.height);previous.appearance=colour([20,30,180]);
 assert.equal(tr.update([previous],f.previousTime,true).track.state,'locked');
 const frame=tr.update(merged.candidates,f.time,true);
 assert.equal(frame.track.state,'locked');
 for(const side of ['L','R'])assert.equal(observeKnee(frame,side,f.width,f.height,'side-left').value,null);
});
test('the broader duplicate rule requires two prior agreeing crops and never collapses same-pass people',()=>{
 const f=upperBodyFixtures.repeated,passes=recordedCandidates(f);
 const insufficient=combinePosePasses([passes[0],passes[2]],f.width,f.height);assert.equal(insufficient.candidates.length,2);
 const simultaneous=combinePosePasses([passes[0],passes[1],[passes[2][0],structuredClone(passes[2][0])]],f.width,f.height);
 assert.match(simultaneous.reason,/多個重疊目標/);assert.equal(simultaneous.candidates.length,0);
});
test('head disagreement and the recorded collapsed shoulder near a staff member remain ambiguous',()=>{
 const f=upperBodyFixtures.repeated,passes=recordedCandidates(f);
 for(const i of [0,7,8])passes[2][0].points[i].x+=.035;
 assert.equal(combinePosePasses(passes,f.width,f.height).candidates.length,2);
 const mixed=upperBodyFixtures.ambiguous,merged=combinePosePasses(recordedCandidates(mixed),mixed.width,mixed.height);
 assert.equal(merged.candidates.length,2);
 const tr=new TargetTracker({id,time:mixed.previousTime},mixed.seed,mixed.width,mixed.height,1),previous=candidateGeometry(mixed.previous,mixed.width,mixed.height);previous.appearance=colour([20,30,180]);
 assert.equal(tr.update([previous],mixed.previousTime,true).track.state,'locked');
 const stopped=tr.update(merged.candidates,mixed.time,true);assert.equal(stopped.track.state,'lost');assert.equal(stopped.points.length,0);
});
for(const key of ['aligned','sideProjection'])test(`recorded ${key} head and shoulder agreement merges the duplicate while preserving the staff member`,()=>{
 const f=upperBodyFixtures[key],passes=recordedCandidates(f),merged=combinePosePasses(passes,f.width,f.height);
 assert.equal(merged.candidates.length,2);assert.deepEqual(merged.candidates[0].detectionPasses,[0,1]);assert.deepEqual(merged.candidates[1].detectionPasses,[1]);
 assert.deepEqual(merged.candidates[0].points,passes[0][0].points);assert.deepEqual(merged.candidates[1].points,passes[1][0].points);
 const tr=new TargetTracker({id,time:f.previousTime},f.seed,f.width,f.height,1),previous=candidateGeometry(f.previous,f.width,f.height);previous.appearance=colour([20,30,180]);tr.update([previous],f.previousTime,true);
 const frame=tr.update(merged.candidates,f.time,true);assert.equal(frame.track.state,'locked');
 for(const side of ['L','R'])assert.equal(observeKnee(frame,side,f.width,f.height,'side-left').value,null);
});
test('confirmed gradual clothing changes remain tracked without admitting an abrupt different person',()=>{
 const tr=tracker(),a=colour([20,30,180]),b=colour([160,110,50]);
 for(let i=0;i<=60;i++){
  const c=person(.25+i*.001),fraction=i/60;c.detectionPasses=[0,1];c.appearance=a.map((v,j)=>v*(1-fraction)+b[j]*fraction);
  assert.equal(tr.update([c],i/30,true).track.state,'locked');
 }
 assert.equal(tr.update([person(.311,[255,255,255])],61/30,true).track.state,'lost');
 const returned=person(.311);returned.appearance=b;returned.detectionPasses=[0,1];assert.equal(tr.update([returned],62/30,true).track.state,'lost');
});
test('unconfirmed changes cannot extend clothing memory beyond the original identity guard',()=>{
 const tr=tracker(),a=colour([20,30,180]),b=colour([160,110,50]);let stopped=false;
 for(let i=0;i<=60;i++){
  const c=person(.25+i*.001);c.appearance=a.map((v,j)=>v*(1-i/60)+b[j]*i/60);
  const f=tr.update([c],i/30,true);if(f.track.state==='lost'){assert.equal(f.points.length,0);stopped=true;break;}
 }
 assert.equal(stopped,true);
});
