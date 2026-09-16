const test=require('node:test');
const assert=require('node:assert/strict');
const {defaults,selectTarget,summarize}=require('../.qa/racewalk.js');
const {contactAnalysis,contactPosterior,groundDistance,contactBands,analysisEvents,applyAnalysisSettings,refreshContactCandidates}=require('../.qa/contact-analysis.js');
const {smoothAngles,angleSensitivity,kneeSensitivity}=require('../.qa/measurement-math.js');
const {angleSegments}=require('../.qa/inspection.js');
const {reportSchema}=require('../.qa/report-schema.js');
const id='6218e496-3a8b-469d-99ca-eb046b5b26f2',p=(x,y,v=1)=>({x,y,v});
const size={width:1000,height:1000};
function settings(){return {...defaults(),start:0,end:2,ground:[p(.1,.9),p(.9,.9)],groundStable:true,clearFeet:true,timingVerified:true,target:{id,time:0},roi:[p(.2,.1),p(.8,.96)]};}
function frame(t,clearance=0){const points=Array.from({length:33},()=>p(.5,.5));
 for(const [i,x] of [[11,.4],[12,.6]])points[i]=p(x,.3);
 for(const [i,x] of [[23,.4],[24,.6]])points[i]=p(x,.5);
 for(const [i,x] of [[25,.4],[26,.6]])points[i]=p(x,.7);
 for(const [i,x] of [[27,.4],[28,.6]])points[i]=p(x,.87-clearance);
 for(const [i,x] of [[29,.4],[30,.6],[31,.45],[32,.65]])points[i]=p(x,.9-clearance);
 return {t,exact:true,points,track:{state:'locked',targetId:id,continuity:0}};
}
const frames=(n=8)=>Array.from({length:n},(_,i)=>frame(i/30));
function report(fs=frames()){return {schema:1,engine:'test',id,version:0,created:'2026-09-14T00:00:00Z',settings:settings(),file:{...size,name:'test.mov',size:100,duration:2,sha256:'a'.repeat(64)},frames:fs,events:[],judge:{contact:'pending',left:'pending',right:'pending'},notes:'',complete:false};}

test('HMM posterior agrees with an independent exhaustive sum over every state path',()=>{
 const e=[.8,.4,.02,.95],times=[0,.016,.049,.12],num=Array(e.length).fill(0);let total=0;
 for(let mask=0;mask<1<<e.length;mask++){const states=e.map((_,i)=>(mask>>i)&1);let weight=.5;
  for(let i=0;i<e.length;i++){weight*=states[i]?e[i]:1-e[i];if(i){const q=(1-Math.exp(-8*(times[i]-times[i-1])))/2;weight*=states[i]===states[i-1]?1-q:q;}}
  total+=weight;states.forEach((s,i)=>{if(s)num[i]+=weight;});
 }
 contactPosterior(e,times).forEach((v,i)=>assert.ok(Math.abs(v-num[i]/total)<1e-12));
 assert.deepEqual(contactPosterior(e,[0,0,.1,.2]),[]);
});
test('perpendicular ground geometry preserves endpoint order, aspect ratio and image rescaling',()=>{
 const line=[p(.1,.2),p(.9,.6)],point=p(.5,.3);
 const a=groundDistance(point,line,{width:2000,height:1000});
 assert.ok(Math.abs(a-100/Math.sqrt(1+.25**2))<1e-9);
 assert.equal(a,groundDistance(point,[line[1],line[0]],{width:2000,height:1000}));
 assert.ok(Math.abs(a/2-groundDistance(point,line,{width:1000,height:500}))<1e-9);
 const fs=frames();assert.deepEqual(contactAnalysis(fs,settings(),size).map(d=>d.counts),contactAnalysis(fs,settings(),{width:500,height:500}).map(d=>d.counts));
});
test('gray bands distinguish all unmet prerequisites, and stationary ground is never inferred',()=>{
 const s={...settings(),ground:null,groundStable:false,clearFeet:false,timingVerified:false};
 const d=contactAnalysis(frames(),s,size)[0];assert.deepEqual(d.blockers,['ground','ground-moving','feet-unchecked','timing']);
 assert.equal(d.counts.unknown,8);assert.ok(d.samples.every(p=>p.reason==='ground'));
 assert.ok(contactAnalysis(frames(),{...settings(),groundStable:false},size)[0].samples.every(p=>p.reason==='ground-moving'));
});
test('stable near-ground feet gain temporal support while a single near sample stays unknown',()=>{
 const [l,r]=contactAnalysis(frames(),settings(),size);assert.equal(l.counts.contact,8);assert.equal(r.counts.contact,8);
 const one=contactAnalysis([frame(0)],settings(),size)[0];assert.equal(one.samples[0].reason,'temporal');assert.equal(one.counts.unknown,1);
});
test('an isolated near-ground glitch between elevated samples cannot become contact',()=>{
 const fs=frames().map(f=>frame(f.t,.08));fs[3]=frame(fs[3].t,0);
 const d=contactAnalysis(fs,settings(),size)[0];assert.equal(d.samples[3].state,'unknown');assert.equal(d.counts.contact,0);
});
test('one clear elevated sample survives temporal smoothing and creates only a pending review',()=>{
 const fs=frames();fs[4]=frame(fs[4].t,.08);
 const d=contactAnalysis(fs,settings(),size);for(const side of d)assert.equal(side.samples[4].state,'air');
 const ev=analysisEvents(fs,settings(),size).filter(e=>e.kind==='FLIGHT');assert.equal(ev.length,1);assert.equal(ev[0].t,fs[4].t);assert.equal(ev[0].status,'pending');
 assert.deepEqual(report(fs).judge,{contact:'pending',left:'pending',right:'pending'});
});
test('one occluded foot stays unknown independently and cannot create a flight candidate',()=>{
 const fs=frames();fs[3]=frame(fs[3].t,.08);fs[3].points[29].v=0;
 const [l,r]=contactAnalysis(fs,settings(),size);assert.equal(l.samples[3].reason,'feet');assert.equal(r.samples[3].state,'air');
 assert.equal(analysisEvents(fs,settings(),size).filter(e=>e.kind==='FLIGHT').length,0);
});
test('foreign identities, withheld legs and inexact frames never receive inferred values',()=>{
 for(const mutate of [f=>{f.track.targetId='other'},f=>{f.track.state='searching';f.reason='gap'},f=>{f.track.withheld={L:'遮擋'}},f=>{f.exact=false}]){
  const fs=frames();mutate(fs[3]);assert.equal(contactAnalysis(fs,settings(),size)[0].samples[3].state,'unknown');
 }
});
test('time gaps and identity continuity breaks reset inference and remain gaps on the timeline',()=>{
 const fs=[frame(0),frame(1/30),frame(.5)];const d=contactAnalysis(fs,settings(),size)[0];
 assert.equal(d.samples[2].state,'unknown');const bands=contactBands(d.samples,settings());assert.ok(bands[1].start>bands[0].end+.4);
 const cs=frames(4);cs[2].track.continuity=1;cs[3].track.continuity=2;
 assert.equal(contactAnalysis(cs,settings(),size)[0].samples[2].state,'unknown');
});
test('slow-motion time mapping produces the same states and posterior support',()=>{
 const fs=frames();fs[4]=frame(fs[4].t,.08);const slow=fs.map(f=>({...f,t:f.t*4}));
 const a=contactAnalysis(fs,settings(),size),b=contactAnalysis(slow,{...settings(),slow:4,end:8},size);
 for(let side=0;side<2;side++)a[side].samples.forEach((p,i)=>{assert.equal(p.state,b[side].samples[i].state);assert.ok(Math.abs(p.support-b[side].samples[i].support)<1e-12);});
});
test('wrong ground geometry and non-side views give explanatory unknowns',()=>{
 assert.equal(contactAnalysis([frame(0,-.08)],settings(),size)[0].samples[0].reason,'below-ground');
 assert.equal(contactAnalysis(frames(),{...settings(),view:'front'},size)[0].samples[0].reason,'view');
});
test('setting changes regenerate pending automatic flight only, retaining human work',()=>{
 const r=report();r.events=[{id:'manual',t:.1,side:'L',kind:'FLIGHT',status:'pending',origin:'manual',note:'原片複查'},
  {id:'kept',t:.11,side:'L',kind:'FLIGHT',status:'confirmed',origin:'auto',note:'已確認'},
  {id:'rejected',t:.12,side:'L',kind:'FLIGHT',status:'rejected',origin:'auto',note:'已排除'},
  {id:'old',t:.13,side:'L',kind:'FLIGHT',status:'pending',origin:'auto',note:'舊候選'}];
 const updated=applyAnalysisSettings(r,{ground:null});assert.equal(updated.settings.groundStable,false);
 assert.deepEqual(updated.events.map(e=>e.id),['manual','kept','rejected']);assert.strictEqual(updated.frames,r.frames);
 assert.equal(applyAnalysisSettings(r,{end:1}).settings.groundStable,false);
 assert.equal(selectTarget(r,r.settings.roi,0,id,id).settings.groundStable,false);
});
test('adaptive display smoothing reduces stationary jitter without changing raw values or bridging gaps',()=>{
 const samples=Array.from({length:30},(_,i)=>({t:i/30,value:170+(i%2?2:-2),reason:null,continuity:0}));const original=JSON.stringify(samples);
 const out=smoothAngles(samples,settings());const variance=a=>a.slice(10).reduce((n,p)=>n+(p.value-170)**2,0);
 assert.ok(variance(out)<variance(samples)*.25);assert.equal(JSON.stringify(samples),original);
 const gaps=[...samples.slice(0,4),{t:4/30,value:null,reason:'遮擋'},...samples.slice(5,7),{t:7/30,value:120,reason:null,continuity:1}];
 const filtered=smoothAngles(gaps,settings());assert.equal(filtered[4].value,null);assert.equal(filtered[5].value,gaps[5].value);assert.equal(filtered[7].value,120);
 assert.equal(angleSegments(filtered,.06).length,3);
});
test('Monte Carlo sensitivity is deterministic, correctly scaled, and shows increased pixel uncertainty',()=>{
 const points=[p(.4,.3),p(.4,.5),p(.55,.65)];const a=angleSensitivity(points,1000,1000,2),b=angleSensitivity(points,1000,1000,6);
 assert.deepEqual(a,angleSensitivity(points,1000,1000,2));assert.equal(a.trials,1024);assert.ok(a.high>a.low);assert.ok(b.high-b.low>(a.high-a.low)*2.8);
 const scaled=angleSensitivity(points,2000,2000,4);assert.ok(Math.abs(a.low-scaled.low)<1e-10);assert.ok(Math.abs(a.high-scaled.high)<1e-10);
 const zero=angleSensitivity(points,1000,1000,0);assert.equal(zero.low,zero.high);assert.equal(zero.low,zero.value);
 assert.equal(angleSensitivity(points,1000,1000,NaN),null);
});
test('sensitivity does not invent a hidden or foreign knee and never changes report summaries',()=>{
 const r=report(),before=summarize(r);const s={...r.settings,uncertaintyEnabled:true};
 assert.ok(kneeSensitivity(r.frames[0],'L',1000,1000,s));r.frames[0].track.withheld={L:'遮擋'};
 assert.equal(kneeSensitivity(r.frames[0],'L',1000,1000,s),null);delete r.frames[0].track.withheld;
 assert.equal(kneeSensitivity({...r.frames[0],track:{...r.frames[0].track,targetId:'other'}},'L',1000,1000,s),null);
 assert.deepEqual(summarize({...r,settings:s}),before);
});
test('new measurement settings survive report roundtrip and old records remain readable',()=>{
 const r=report();r.settings={...r.settings,uncertaintyEnabled:true,pointSigmaPx:3,smoothAngles:true};
 const result=reportSchema.safeParse(r);assert.equal(result.success,true);assert.equal(result.data.settings.pointSigmaPx,3);
 const old=structuredClone(r);for(const k of ['groundStable','contactMethod','smoothAngles','uncertaintyEnabled','pointSigmaPx'])delete old.settings[k];assert.equal(reportSchema.safeParse(old).success,true);
 assert.equal(reportSchema.safeParse({...r,settings:{...r.settings,pointSigmaPx:-1}}).success,false);
 assert.equal(reportSchema.safeParse({...r,settings:{...r.settings,ground:null}}).success,false);
});
