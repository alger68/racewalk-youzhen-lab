const test=require('node:test');
const assert=require('node:assert/strict');
const {Worker}=require('node:worker_threads');
const {WorkerChannel,boundedOperation}=require('../.qa/worker-channel.js');
const {seekVideo}=require('../.qa/video-seek.js');
class FakeWorker extends EventTarget{
 messages=[];terminated=0;
 postMessage(message){this.messages.push(message);}
 terminate(){this.terminated++;}
 answer(result,id=this.messages.at(-1)?.id){this.dispatchEvent(new MessageEvent('message',{data:{id,result}}));}
}
test('a model that never loads is terminated by a deadline and cannot block later work',async()=>{
 const worker=new FakeWorker(),channel=new WorkerChannel(worker,new AbortController().signal);
 await assert.rejects(channel.call({command:'init'},[],15,'模型載入'),/模型載入逾時/);
 assert.equal(worker.terminated,1);
 await assert.rejects(channel.call({command:'detect'}),/逾時/);
 channel.close();assert.equal(worker.terminated,1);
});
test('cancel immediately rejects an in-flight inference and discards late measurements',async()=>{
 const controller=new AbortController(),worker=new FakeWorker(),channel=new WorkerChannel(worker,controller.signal);
 const pending=channel.call({command:'detect'});controller.abort();
 await assert.rejects(pending,{name:'AbortError'});
 worker.answer([{landmarks:['foreign-person']}]);assert.equal(worker.terminated,1);
 await assert.rejects(channel.call({command:'detect'}),{name:'AbortError'});
});
test('worker startup errors unlock the operation and a fresh worker can retry',async()=>{
 const worker=new FakeWorker(),channel=new WorkerChannel(worker,new AbortController().signal);
 const pending=channel.call({command:'init'});worker.dispatchEvent(new Event('error'));
 await assert.rejects(pending,/背景分析無法執行/);assert.equal(worker.terminated,1);
 const retryWorker=new FakeWorker(),retry=new WorkerChannel(retryWorker,new AbortController().signal);
 const result=retry.call({command:'init'});retryWorker.answer(true);assert.equal(await result,true);retry.close();
});
test('an earlier request cannot settle another frame and concurrent inference is rejected',async()=>{
 const worker=new FakeWorker(),channel=new WorkerChannel(worker,new AbortController().signal);
 const first=channel.call({command:'detect'});worker.answer(['frame-1']);assert.deepEqual(await first,['frame-1']);
 const next=channel.call({command:'detect'});worker.answer(['stale-frame'],1);
 await assert.rejects(channel.call({command:'detect'}),/目前背景工作/);
 worker.answer(['frame-2']);assert.deepEqual(await next,['frame-2']);channel.close();
});
test('a real worker stuck in a synchronous loop is terminated while main-thread timers still run',async()=>{
 const thread=new Worker("const {parentPort}=require('node:worker_threads');parentPort.on('message',()=>{while(true){}});",{eval:true});
 await new Promise((resolve,reject)=>{thread.once('online',resolve);thread.once('error',reject);});
 const events=new EventTarget();let exited;
 const port={postMessage:message=>thread.postMessage(message),terminate:()=>{exited=thread.terminate();},addEventListener:(...args)=>events.addEventListener(...args),removeEventListener:(...args)=>events.removeEventListener(...args)};
 const channel=new WorkerChannel(port,new AbortController().signal);let ticks=0;
 const timer=setInterval(()=>ticks++,5);
 try{await assert.rejects(channel.call({command:'detect'},[],60,'影格分析'),/逾時/);await exited;assert.ok(ticks>0);}
 finally{clearInterval(timer);channel.close();}
});
test('the whole-operation budget cannot be reset by repeated short requests',async()=>{
 const budget=boundedOperation(new AbortController().signal,25,'整段偵測逾時'),worker=new FakeWorker(),channel=new WorkerChannel(worker,budget.signal);
 const first=channel.call({command:'detect'});worker.answer([]);await first;
 const second=channel.call({command:'detect'},[],1000);
 await assert.rejects(second,/整段偵測逾時/);assert.equal(worker.terminated,1);budget.dispose();
});
test('a cancelled operation never sends a request to a worker',async()=>{
 const parent=new AbortController();parent.abort();const worker=new FakeWorker(),channel=new WorkerChannel(worker,parent.signal);
 await assert.rejects(channel.call({command:'init'}),{name:'AbortError'});assert.equal(worker.messages.length,0);assert.equal(worker.terminated,1);
});
test('model download progress is visible but cannot settle the request or reset its deadline',async()=>{
 const worker=new FakeWorker(),stages=[],channel=new WorkerChannel(worker,new AbortController().signal,s=>stages.push(s));
 const pending=channel.call({command:'init'},[],20,'模型載入');
 worker.dispatchEvent(new MessageEvent('message',{data:{id:1,progress:'下載第二個模型'}}));
 assert.deepEqual(stages,['下載第二個模型']);await assert.rejects(pending,/逾時/);assert.equal(worker.terminated,1);
});
class FakeVideo extends EventTarget{
 currentTime=0;duration=10;readyState=1;seeking=false;callback=null;cancelled=0;
 requestVideoFrameCallback(callback){this.callback=callback;return 1;}
 cancelVideoFrameCallback(){this.cancelled++;this.callback=null;}
}
test('first-frame acquisition waits for loaded pixels when metadata arrives before the frame',async()=>{
 const video=new FakeVideo();const pending=seekVideo(video,0);
 video.readyState=2;video.dispatchEvent(new Event('loadeddata'));
 assert.deepEqual(await pending,{t:0,exact:false});assert.equal(video.cancelled,1);
});
test('cancelling first-frame loading does not wait for a seek event or the decode timeout',async()=>{
 const video=new FakeVideo(),controller=new AbortController();const pending=seekVideo(video,0,controller.signal);
 controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(video.cancelled,1);
 video.readyState=2;video.dispatchEvent(new Event('canplay'));
});
