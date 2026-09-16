const {test}=require('node:test');
const assert=require('node:assert/strict');
const {angle,knee,defaults,kneeWindows,cadence,flights,candidateEvents,contactCandidate,nextSteps,summarize,parsePace,paceText}=require('../.qa/racewalk.js');
const {reportSchema}=require('../.qa/report-schema.js');
const {htmlReport,csvReport}=require('../.qa/export-report.js');
const point=(x,y,v=1)=>({x,y,v});
function frame(t=0){const points=Array.from({length:33},()=>point(.5,.5,0));points[23]=point(.4,.2);points[25]=point(.4,.5);points[27]=point(.4,.8);return {t,exact:true,points};}
function report(){return {schema:1,engine:'test',id:'6218e496-3a8b-469d-99ca-eb046b5b26f2',version:0,created:'2026-09-14T00:00:00Z',settings:{...defaults(),end:2},file:{name:'test.mp4',size:100,duration:2,width:1920,height:1080,sha256:'a'.repeat(64)},frames:[],events:[],judge:{contact:'pending',left:'pending',right:'pending'},notes:'',complete:false};}
function event(t,kind,side='L',status='confirmed'){return {id:`${side}-${kind}-${t}`,t,kind,side,status,origin:'manual',note:''};}

test('angle uses pixel aspect ratio, rejects low visibility and degenerate limbs',()=>{
 assert.ok(Math.abs(angle(point(.4,.2),point(.4,.5),point(.4,.8),1920,1080)-180)<1e-8);
 assert.equal(angle(point(.4,.2,.3),point(.4,.5),point(.4,.8),1920,1080),null);
 assert.equal(angle(point(.4,.5),point(.4,.5),point(.4,.8),1920,1080),null);
 const measured=angle(point(.5,.2),point(.5,.5),point(.7,.7),1920,1080);
 const expected=Math.acos(-216/Math.hypot(384,216))*180/Math.PI;
 assert.ok(Math.abs(measured-expected)<1e-8);
});
test('far leg, non-side views and unreliable frames never produce knee degrees',()=>{
 assert.equal(knee(frame(),'R',1920,1080,'side-left'),null);
 assert.equal(knee(frame(),'L',1920,1080,'front'),null);
 assert.equal(knee({...frame(),reason:'occluded'},'L',1920,1080,'side-left'),null);
});
test('pending candidates cannot enter confirmed knee windows; missing-point denominator enforced',()=>{
 const r=report();r.frames=[frame(.2),frame(.3),frame(.4)];r.events=[event(.2,'IC','L','pending'),event(.4,'VERTICAL','L','pending')];
 assert.equal(kneeWindows(r).length,0);r.events.forEach(e=>e.status='confirmed');assert.equal(kneeWindows(r).length,1);
 r.frames[1].points[25].v=.2;assert.equal(kneeWindows(r).length,0);
});
test('a vertical event from the next stride cannot close an earlier window',()=>{
 const r=report();r.frames=[frame(.1),frame(.3),frame(.5),frame(.7)];r.events=[event(.1,'IC'),event(.5,'IC'),event(.7,'VERTICAL')];
 const windows=kneeWindows(r);assert.equal(windows.length,1);assert.equal(windows[0].start,.5);
});
test('cadence needs verified timing and continuous alternating events; uses N-1 intervals',()=>{
 const r=report();r.events=[event(0,'IC','L'),event(.3,'IC','R'),event(.6,'IC','L')];assert.equal(cadence(r),null);
 r.settings.timingVerified=true;assert.equal(cadence(r),200);r.settings.slow=2;assert.equal(cadence(r),400);
 r.events[1].side='L';assert.equal(cadence(r),null);r.events[1].side='R';r.events[2].t=1.99;r.settings.slow=1;assert.equal(cadence(r),null);
});
test('possible flight uncertainty uses sampled resolution, not nominal 240fps',()=>{
 const r=report();r.settings.fps=240;r.settings.timingVerified=true;r.frames=[frame(0),frame(1/30),frame(2/30),frame(3/30)];r.events=[event(1/30,'TO','L'),event(2/30,'IC','R')];
 const f=flights(r)[0];assert.ok(Math.abs(f.ms-1000/30)<1e-8);assert.ok(f.uncertainty>66);
 r.frames[1].exact=false;assert.equal(flights(r).length,0);
 r.frames[1].exact=true;r.settings.timingVerified=false;assert.equal(flights(r).length,0);
});
test('uncalibrated or unclear feet remain unknown, not green contact',()=>{
 const s=defaults(),f=frame();f.points[29]=point(.4,.9);f.points[31]=point(.45,.9);
 assert.equal(contactCandidate(f,'L',s),'unknown');s.ground=[point(0,.9),point(1,.9)];assert.equal(contactCandidate(f,'L',s),'unknown');s.clearFeet=true;assert.equal(contactCandidate(f,'L',s),'contact');
 f.points[31].v=.1;assert.equal(contactCandidate(f,'L',s),'unknown');
 assert.deepEqual(candidateEvents([f],s),[]);
});
test('pain guard replaces drills; unknown symptoms request information',()=>{
 const r=report();r.settings.pain='yes';assert.equal(nextSteps(r).length,1);assert.match(nextSteps(r)[0].title,/停止速度/);r.settings.pain='unknown';assert.match(nextSteps(r)[0].title,/症狀/);
 assert.equal(summarize(r).leftMin,null);assert.equal(summarize(r).coverage,null);
});
test('report schema rejects duplicated ids, unsorted frames, out-of-bounds ROI and malformed fingerprints',()=>{
 const r=report();assert.equal(reportSchema.safeParse(r).success,true);
 r.events=[event(.2,'IC'),event(.2,'IC')];assert.equal(reportSchema.safeParse(r).success,false);r.events=[];
 r.frames=[frame(.3),frame(.2)];assert.equal(reportSchema.safeParse(r).success,false);r.frames=[];
 r.settings.roi=[point(-.2,0),point(1,1)];assert.equal(reportSchema.safeParse(r).success,false);r.settings.roi=null;
 r.file.sha256='not-a-hash';assert.equal(reportSchema.safeParse(r).success,false);
});
test('exported HTML escapes coach input, CSV neutralizes spreadsheet formulas',()=>{
 const r=report();r.notes='<script>alert(1)</script>';r.settings.athlete='=HYPERLINK("https://example.com")';r.events=[{...event(.2,'IC'),note:'@SUM(1,2)'}];
 const html=htmlReport(r);assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));const csv=csvReport(r);assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes("'@SUM"));
});
test('pace parsing and rounding preserve mm:ss and reject impossible seconds',()=>{
 assert.equal(parsePace('6:19'),379);assert.equal(parsePace('6:79'),null);assert.equal(paceText(359.99),'6:00');assert.equal(parsePace(''),null);
});

const {observeKnee,bilateralInspection,angleSegments,missingIntervals,contactIntervals}=require('../.qa/inspection.js');
function bothFrame(t=0){const f=frame(t);f.points[24]=point(.6,.2);f.points[26]=point(.6,.5);f.points[28]=point(.6,.8);return f;}
test('bilateral display allows a far-side reference but assessment still rejects the far leg',()=>{
 const f=bothFrame();assert.equal(observeKnee(f,'L',1920,1080,'side-left').role,'near');
 const far=observeKnee(f,'R',1920,1080,'side-left');assert.equal(far.role,'reference');assert.equal(far.value,180);
 assert.equal(knee(f,'R',1920,1080,'side-left'),null);
 assert.equal(observeKnee(f,'R',1920,1080,'side-right').role,'near');
 assert.equal(observeKnee(f,'L',1920,1080,'front').value,null);
 const r=report();r.frames=[bothFrame(.1),bothFrame(.2),bothFrame(.3)];r.events=[event(.1,'IC','R'),event(.3,'VERTICAL','R')];assert.equal(kneeWindows(r).length,0);
});
test('bilateral missingness counts each side independently, with useful reasons',()=>{
 const r=report();r.frames=[bothFrame(.1),bothFrame(.2),bothFrame(.3)];r.frames[1].points[26].v=.1;r.frames[2].reason='畫面有多位選手，請圈選目標';
 const [left,right]=bilateralInspection(r);assert.equal(left.valid,2);assert.equal(right.valid,1);assert.equal(right.total,3);
 assert.match(right.reasons.map(x=>x.reason).join(' '),/膝點位信心不足/);
 assert.match(right.reasons.map(x=>x.reason).join(' '),/多位選手/);
 assert.equal(right.reasons.reduce((n,x)=>n+x.count,0),right.total-right.valid);
 assert.equal(observeKnee(null,'L',1920,1080,'side-left').reason,'此時間沒有對齊的分析幀');
});
test('angle paths preserve missing samples, temporal gaps and isolated points',()=>{
 const samples=[{t:0,value:175},{t:.03,value:null},{t:.06,value:170},{t:.09,value:168},{t:.7,value:177}];
 const seg=angleSegments(samples,.06);assert.deepEqual(seg.map(x=>x.length),[1,2,1]);assert.equal(seg[2][0].t,.7);
 const gaps=missingIntervals(samples,0,1,.03);assert.ok(gaps.some(g=>g.start>.09&&g.end>.6));assert.ok(gaps.some(g=>g.end===1));
 assert.deepEqual(missingIntervals([],0,1,.03),[{start:0,end:1}]);
});
test('contact bands occupy time intervals and do not stretch sparse samples across gaps',()=>{
 const bands=contactIntervals([{t:0,state:'contact'},{t:.1,state:'contact'},{t:.2,state:'unknown'},{t:.8,state:'air'}],0,1,.1);
 assert.equal(bands.length,2);assert.ok(Math.abs(bands[0].end-.15)<1e-8);assert.ok(Math.abs(bands[1].start-.75)<1e-8);assert.ok(Math.abs(bands[1].end-.85)<1e-8);
});
