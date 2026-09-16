const {test}=require('node:test');
const assert=require('node:assert/strict');
const {estimateCadence}=require('../.qa/video-cadence.js');
const {pinnedModel}=require('../.qa/model-cache.js');
const {sha256Portable}=require('../.qa/browser-crypto.js');
const {analysisDiagnostics}=require('../.qa/analysis-diagnostics.js');
const {defaults}=require('../.qa/racewalk.js');

test('cadence ignores warmup and recovers 30 and 120 fps without rounding to a different standard',()=>{
 for(const fps of [30,120]){
  const frames=Array.from({length:45},(_,i)=>({mediaTime:i<3?i*.15:1+i/fps,presentedFrames:i}));
  assert.equal(estimateCadence(frames),fps);
 }
});
test('cadence refuses sparse, skipped callbacks and unstable timestamps',()=>{
 assert.equal(estimateCadence([]),null);
 assert.equal(estimateCadence(Array.from({length:45},(_,i)=>({mediaTime:i/30,presentedFrames:i*4}))),null);
 let t=0;assert.equal(estimateCadence(Array.from({length:45},(_,i)=>({mediaTime:t+=i%2?.02:.04,presentedFrames:i}))),null);
});
test('model cache checks bytes, repairs corruption, and survives unavailable storage',async()=>{
 const oldFetch=global.fetch,oldCaches=global.caches;
 const bytes=new Uint8Array([1,2,3,4]);const sha=sha256Portable(bytes);let downloaded=0,stored=new Response(new Uint8Array([9]));
 const cache={match:async()=>stored.clone(),delete:async()=>{stored=null;},put:async(_k,r)=>{stored=r;}};
 try{
  global.caches={open:async()=>cache};global.fetch=async()=>{downloaded++;return new Response(bytes);};
  assert.deepEqual(await pinnedModel('https://example.test/model',4,sha),bytes);assert.equal(downloaded,1);
  assert.deepEqual(await pinnedModel('https://example.test/model',4,sha),bytes);assert.equal(downloaded,1);
  global.caches={open:async()=>{throw Error('no storage');}};
  assert.deepEqual(await pinnedModel('https://example.test/model',4,sha),bytes);assert.equal(downloaded,2);
  global.fetch=async()=>new Response(new Uint8Array([8,8,8,8]));
  await assert.rejects(()=>pinnedModel('https://example.test/model',4,sha),/完整性/);
 }finally{global.fetch=oldFetch;global.caches=oldCaches;}
});
test('empty reports and a new default athlete do not imply a normal gait',()=>{
 assert.equal(defaults().athlete,'未命名選手');
 const report={settings:defaults(),frames:[],file:{width:1920,height:1080}};
 assert.match(analysisDiagnostics(report)[0].action,/不代表動作正常/);
});
