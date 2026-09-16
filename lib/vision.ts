import type { Point, PoseFrame, Settings, TrackingRun } from "./racewalk";
import { candidateGeometry, colourSignature, type TargetCandidate } from "./target-tracker";
import { ReidTargetTracker } from "./reid-target-tracker";
import { combinePosePasses, poseRegion, restorePose } from "./pose-region";
import { peopleRegions, personChoices, detectedPerson, type PersonDetection, type PeopleScan } from "./people";
import { WorkerChannel, boundedOperation } from "./worker-channel";
import { MAX_POSES, type ModelKind, type PixelFrame, type RawPose, type RawPeople } from "./vision-protocol";
import visionWorkerUrl from "./vision.worker.ts?worker&url";
import wholebodyWorkerUrl from "./wholebody.worker.ts?worker&url";
import reidWorkerUrl from "./reid.worker.ts?worker&url";
import { REID_SIZE } from "./reid";
import { restoreWholebody, verifyWholebody, wholebodyRegion, wholebodyRetrySides, verifyWholebodyRetry, type AffineRegion, type WholebodyResult } from "./wholebody";

import { seekVideo } from "./video-seek";
import { assetBaseUrl } from "./asset-url";
export { seekVideo } from "./video-seek";

async function createModel(kind:ModelKind,signal:AbortSignal){
 if(signal.aborted)throw signal.reason;
 if(typeof Worker==="undefined"||typeof OffscreenCanvas==="undefined")throw new Error("此瀏覽器不支援背景分析，請更新瀏覽器；仍可手動圈選與標點。");
 const channel=new WorkerChannel(new Worker(import.meta.env.DEV?"/__racewalk_worker__/vision.js":visionWorkerUrl),signal);
 try{await channel.call({command:"init",kind,baseUrl:assetBaseUrl(import.meta.env.BASE_URL,window.location.href)},[],25000,kind==="pose"?"骨架模型載入":"人物模型載入");return channel;}
 catch(e){channel.close();throw e;}
}
async function createWholebodyModel(signal:AbortSignal,onProgress:(stage:string)=>void){
 const channel=new WorkerChannel(new Worker(import.meta.env.DEV?"/__racewalk_worker__/wholebody.js":wholebodyWorkerUrl),signal,onProgress);
 try{await channel.call({command:"init",baseUrl:assetBaseUrl(import.meta.env.BASE_URL,window.location.href)},[],90000,"第二套骨架模型載入");return channel;}
 catch(e){channel.close();throw e;}
}
async function createReidModel(signal:AbortSignal,onProgress:(stage:string)=>void){
 const channel=new WorkerChannel(new Worker(import.meta.env.DEV?"/__racewalk_worker__/reid.js":reidWorkerUrl),signal,onProgress);
 try{await channel.call({command:"init",baseUrl:assetBaseUrl(import.meta.env.BASE_URL,window.location.href)},[],90000,"人物外觀模型載入");return channel;}
 catch(e){channel.close();throw e;}
}
function reidPixels(video:HTMLVideoElement,source:ReturnType<typeof sourceCanvas>,c:TargetCandidate):PixelFrame{
 const [a,b]=c.box,x=Math.max(0,Math.floor(a.x*video.videoWidth)),y=Math.max(0,Math.floor(a.y*video.videoHeight));
 const right=Math.min(video.videoWidth,Math.floor(b.x*video.videoWidth)),bottom=Math.min(video.videoHeight,Math.floor(b.y*video.videoHeight));
 source.canvas.width=REID_SIZE;source.canvas.height=REID_SIZE;
 if(right<=x||bottom<=y)throw new Error("人物外觀範圍無效");
 source.ctx.drawImage(video,x,y,right-x,bottom-y,0,0,REID_SIZE,REID_SIZE);return pixels(source);
}
// All passes are restored to video coordinates. Keep full-scene and surrounding
// context detections alongside the focused crop to check nearby competitors.
function sourceCanvas(video:HTMLVideoElement) {
 const canvas=document.createElement("canvas"),scale=Math.min(1,1280/video.videoWidth);
 canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
 const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("此瀏覽器無法建立分析畫面。");
 return {canvas,ctx};
}
function pixels(source:ReturnType<typeof sourceCanvas>):PixelFrame{
 const {width,height}=source.canvas;return {width,height,data:source.ctx.getImageData(0,0,width,height).data};
}
async function detect<T>(model:WorkerChannel,sources:ReturnType<typeof sourceCanvas>[]){
 const images=sources.map(pixels);return model.call<T[]>({command:"detect",images},images.map(image=>image.data.buffer as ArrayBuffer),10000,"影格分析");
}
function drawRegion(video:HTMLVideoElement,source:ReturnType<typeof sourceCanvas>,region:[Point,Point]){
 const [a,b]=region,x=Math.round(a.x*video.videoWidth),y=Math.round(a.y*video.videoHeight),w=Math.round((b.x-a.x)*video.videoWidth),h=Math.round((b.y-a.y)*video.videoHeight);
 if(w<2||h<2)throw new Error("圈選範圍太小，請重新框住選手全身。");
 const scale=Math.min(1,960/Math.max(w,h));
 source.canvas.width=Math.max(1,Math.round(w*scale));source.canvas.height=Math.max(1,Math.round(h*scale));
 source.ctx.drawImage(video,x,y,w,h,0,0,source.canvas.width,source.canvas.height);
}
function wholebodyPixels(video:HTMLVideoElement,source:ReturnType<typeof sourceCanvas>,region:AffineRegion):PixelFrame{
 source.canvas.width=192;source.canvas.height=256;
 source.ctx.fillStyle="#000";source.ctx.fillRect(0,0,192,256);
 // Align canvas pixel centers with OpenMMLab's zero-rotation affine mapping.
 source.ctx.drawImage(video,region.x+.5-region.width/384,region.y+.5-region.height/512,region.width,region.height,0,0,192,256);
 return pixels(source);
}
function shirtAppearance(c:TargetCandidate,source:ReturnType<typeof sourceCanvas>,w:number,h:number){
 const rgb:number[]=[],cw=source.canvas.width,ch=source.canvas.height;
 const dx=(c.hip.x-c.shoulder.x)*w,dy=(c.hip.y-c.shoulder.y)*h,len=Math.hypot(dx,dy);
 const halfWidth=Math.max(3,c.scale*.12);
 // Sample a narrow strip inside the torso, away from the surrounding athletes.
 for(let row=0;row<6;row++)for(let col=0;col<5;col++){
  const along=.22+row*.1,across=(col-2)/2*halfWidth;
  const x=(c.shoulder.x+along*(c.hip.x-c.shoulder.x)+dy/len*across/w)*cw;
  const y=(c.shoulder.y+along*(c.hip.y-c.shoulder.y)-dx/len*across/h)*ch;
  if(x<0||y<0||x>=cw||y>=ch)continue;
  const data=source.ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data;
  rgb.push(data[0],data[1],data[2]);
 }
 return colourSignature(rgb);
}
export async function detectPeople(video:HTMLVideoElement,videoSha:string,signal:AbortSignal,onProgress:(p:number,stage?:string)=>void):Promise<PeopleScan>{
 if(!video.videoWidth||!Number.isFinite(video.duration))throw new Error("請先載入可播放的原片。");
 const operation=boundedOperation(signal,60000,"人物偵測超過60秒，已停止等待。可以使用已找到的人物或手動圈選。");
 video.pause();onProgress(0,"正在讀取影片畫面");
 try{
  const seek=await seekVideo(video,video.currentTime,operation.signal),w=video.videoWidth,h=video.videoHeight;
  const tiled=peopleRegions(w,h),regions=[tiled[tiled.length-1],...tiled.slice(0,-1)],passes:PersonDetection[][]=[],warnings:string[]=[];
  let limited=false;
  // One model at a time. A second model cannot block already-computed choices
  // forever; every load, inference and the entire scan has a hard deadline.
  for(const [phase,kind] of (["pose","people"] as const).entries()){
   let model:WorkerChannel|undefined;
   try{
    if(operation.signal.aborted)throw operation.signal.reason;
    onProgress(phase*40,kind==="pose"?"正在載入骨架模型":"正在載入人物模型，補找未顯示骨架的人物");
    model=await createModel(kind,operation.signal);const source=sourceCanvas(video);
    for(const [i,region] of regions.entries()){
     if(operation.signal.aborted)throw operation.signal.reason;
     if(Math.abs(video.currentTime-seek.t)>.05)throw new Error("畫面已改變，請暫停後重新偵測。");
     drawRegion(video,source,region);
     if(kind==="pose"){
      const [result]=await detect<RawPose>(model,[source]);limited ||= result.landmarks.length>=MAX_POSES;
      passes.push(result.landmarks.map(ps=>candidateGeometry(restorePose(ps,region),w,h)).filter((c):c is TargetCandidate=>!!c));
     }else{
      const [result]=await detect<RawPeople>(model,[source]);limited ||= result.detections.length>=30;
      passes.push(result.detections.map(d=>detectedPerson(d.boundingBox,d.score,region,source.canvas.width,source.canvas.height,w,h)).filter((c):c is PersonDetection=>!!c));
     }
     const found=personChoices(passes,w,h);
     onProgress(Math.round(phase*40+(i+1)/regions.length*40),`正在核對候選 · ${phase*regions.length+i+1}/${regions.length*2} 區域 · ${found.filter(p=>!p.review).length} 個骨架候選、${found.filter(p=>p.review).length} 個待確認區域`);
    }
   }catch(e){warnings.push(signal.aborted?"已停止人物偵測。":e instanceof Error?e.message:"部分區域未完成偵測。");}
   finally{model?.close();}
   if(operation.signal.aborted)break;
  }
  // Recheck uncertain regions automatically on this exact frame. Results join
  // the original evidence, never replace the full-scene rivals or force a count.
  const pending=personChoices(passes,w,h).filter(p=>p.review);
  if(pending.length&&!operation.signal.aborted){
   let model:WorkerChannel|undefined;
   try{
    onProgress(80,"正在自動複核待確認區域");model=await createModel("pose",operation.signal);
    const source=sourceCanvas(video),work=pending.slice(0,MAX_POSES);limited ||= pending.length>MAX_POSES;
    for(const [i,person] of work.entries()){
     if(operation.signal.aborted)throw operation.signal.reason;
     if(Math.abs(video.currentTime-seek.t)>.05)throw new Error("畫面已改變，請重新偵測。");
     const region=poseRegion(person.box,w,h);drawRegion(video,source,region);
     const [result]=await detect<RawPose>(model,[source]);limited ||= result.landmarks.length>=MAX_POSES;
     passes.push(result.landmarks.map(ps=>candidateGeometry(restorePose(ps,region),w,h)).filter((c):c is TargetCandidate=>!!c));
     onProgress(Math.round(80+(i+1)/work.length*20),`正在自動複核待確認區域 · ${i+1}/${work.length}`);
    }
   }catch(e){warnings.push(signal.aborted?"已停止人物複核。":e instanceof Error?e.message:"部分人物複核未完成。");}
   finally{model?.close();}
  }
  if(Math.abs(video.currentTime-seek.t)>.05)throw new Error("畫面已改變，請重新偵測。");
  const people=personChoices(passes,w,h);
  if(!people.length&&warnings.length)throw new Error(warnings[0]);
  onProgress(100,"人物候選核對完成");
  return {videoSha,time:seek.t,exact:seek.exact,people,limited,...(warnings.length?{warning:`${warnings[0]} 以下候選僅包含已完成的區域。`}:{})};
 }finally{operation.dispose();}
}
export function requireTarget(s:Settings){
 if(!s.target||!s.roi)throw new Error("請先暫停影片，圈選一位選手的全身，再開始追蹤。");
 if(Math.abs(s.start-s.target.time)>.0001)throw new Error("分析起點必須是圈選畫面；請移到新的起點重新圈選。");
 if(Math.min(s.fps,s.sampleFps)<10)throw new Error("持續追蹤至少需要每秒10格，請提高掃描幀率。");
}
type TrackingResult={frames:PoseFrame[];complete:boolean;tracking:TrackingRun};
type TrackingProgress=(p:number,frame:PoseFrame|null,stage?:string)=>void;
async function runTracking(video:HTMLVideoElement,s:Settings,signal:AbortSignal,onProgress:TrackingProgress,until?:number):Promise<TrackingResult>{
 requireTarget(s);
 if(!video.videoWidth||!Number.isFinite(video.duration))throw new Error("請先載入可播放的原始影片。");
 if(s.end<=s.start||s.end>video.duration+.05)throw new Error("分析起訖時間超出影片範圍。");
 const stop=until??s.end,step=s.slow/Math.min(s.fps,s.sampleFps);
 if(stop<s.start-.0001||stop>s.end+.0001)throw new Error("請在圈選起點與分析終點之間選擇影格。");
 const count=until===undefined?Math.ceil((stop-s.start)/step):Math.floor((stop-s.start)/step)+1;
 if(count>3000)throw new Error("單次最多分析3000格，請縮短區間。");
 const times=Array.from({length:count},(_,i)=>s.start+i*step);
 if(until!==undefined&&(!times.length||stop-times[times.length-1]>.00001))times.push(stop);
 if(times.length>3000)throw new Error("單次最多分析3000格，請縮短區間。");
 video.pause();onProgress(0,null);
 const tracker=new ReidTargetTracker(s.target!,s.roi!,video.videoWidth,video.videoHeight,s.slow),frames:PoseFrame[]=[];
 let model:WorkerChannel|undefined,wholebodyModel:WorkerChannel|undefined,reidModel:WorkerChannel|undefined;
 try{
  // IMAGE deliberately re-detects the whole scene each time. Identity is managed
  // by observed association and verified recovery, never result-array position.
  onProgress(0,null,"正在載入 Full 骨架模型 1/3");model=await createModel("pose",signal);
  wholebodyModel=await createWholebodyModel(signal,stage=>onProgress(0,null,`${stage} · 2/3`));
  reidModel=await createReidModel(signal,stage=>onProgress(0,null,`${stage} · 3/3`));
  const source=sourceCanvas(video),focus=sourceCanvas(video),context=sourceCanvas(video),detail=sourceCanvas(video);
  for(let i=0;i<times.length&&!signal.aborted;i++){
   let seek:{t:number;exact:boolean};
   try{seek=await seekVideo(video,times[i],signal);}catch(e){
    if(signal.aborted)break;
    if(!frames.length)throw e;
    const stopped=tracker.stop(times[i],false,"影片解碼中斷，保留中斷前的目標資料");frames.push(stopped);onProgress(Math.round((i+1)/times.length*100),stopped);break;
   }
   if(signal.aborted)break;
   if(seek.t<s.start-step*.5||seek.t>s.end+step*.5)continue;
   if(frames.length&&seek.t<=frames[frames.length-1].t+.000001)continue;
   source.ctx.drawImage(video,0,0,source.canvas.width,source.canvas.height);
   const searchBox=tracker.regionAt(seek.t),focusRegion=poseRegion(searchBox,video.videoWidth,video.videoHeight),contextRegion=poseRegion(searchBox,video.videoWidth,video.videoHeight,true);
   drawRegion(video,focus,focusRegion);drawRegion(video,context,contextRegion);
   let focused:RawPose,surrounding:RawPose,scene:RawPose;
   try{[focused,surrounding,scene]=await detect<RawPose>(model,[focus,context,source]);}
   catch(e){
    if(signal.aborted)break;
    if(!frames.length)throw e;
    const stopped=tracker.stop(seek.t,seek.exact,"背景模型無法繼續執行，已保留完成的影格；可重試分析");frames.push(stopped);onProgress(Math.round((i+1)/times.length*100),stopped);break;
   }
   if(signal.aborted)break;
   const allRegion:[Point,Point]=[{x:0,y:0,v:1},{x:1,y:1,v:1}];
   const passes=[{result:focused,region:focusRegion},{result:surrounding,region:contextRegion},{result:scene,region:allRegion}];
   const merged=combinePosePasses(passes.map(({result,region})=>result.landmarks.map(ps=>candidateGeometry(restorePose(ps,region),video.videoWidth,video.videoHeight)).filter((c):c is TargetCandidate=>!!c)),video.videoWidth,video.videoHeight);
   for(const c of merged.candidates)c.appearance=shirtAppearance(c,source,video.videoWidth,video.videoHeight);
   const limited=merged.candidates.length>MAX_POSES||passes.some(p=>p.result.landmarks.length>=MAX_POSES);
   let embeddings:number[][]=[];
   if(!limited&&!merged.reason&&merged.candidates.length){
    try{
     // Every observed rival receives the same checks. Selecting only the best
     // crop here would hide identity competitors from the association guard.
     const regions=merged.candidates.map(c=>wholebodyRegion(c.box,video.videoWidth,video.videoHeight));
     const images=regions.map(region=>wholebodyPixels(video,detail,region));
     const checked=await wholebodyModel.call<WholebodyResult[]>({command:"detect",images},images.map(f=>f.data.buffer as ArrayBuffer),15000,"第二套骨架複核");
     if(checked.length!==merged.candidates.length)throw new Error("模型回覆的影格數不一致");
     const originals=merged.candidates;
     merged.candidates=originals.map((c,j)=>{
      return {...verifyWholebody(c,restoreWholebody(checked[j],regions[j],video.videoWidth,video.videoHeight),video.videoWidth,video.videoHeight)};
     });
     const retries=merged.candidates.flatMap((c,j)=>wholebodyRetrySides(c).length?[{index:j,region:wholebodyRegion(c.box,video.videoWidth,video.videoHeight,1.05)}]:[]);
     if(retries.length){
      onProgress(Math.round(i/times.length*100),null,"正在局部複核不清楚的關節");
      const pixels=retries.map(r=>wholebodyPixels(video,detail,r.region));
      const results=await wholebodyModel.call<WholebodyResult[]>({command:"detect",images:pixels},pixels.map(f=>f.data.buffer as ArrayBuffer),15000,"局部關節複核");
      if(results.length!==retries.length)throw new Error("局部複核回覆的影格數不一致");
      retries.forEach((r,k)=>{merged.candidates[r.index]=verifyWholebodyRetry(originals[r.index],merged.candidates[r.index],restoreWholebody(results[k],r.region,video.videoWidth,video.videoHeight),video.videoWidth,video.videoHeight);});
     }
     const appearances=merged.candidates.map(c=>reidPixels(video,detail,c));
     embeddings=await reidModel.call<number[][]>({command:"detect",images:appearances},appearances.map(f=>f.data.buffer as ArrayBuffer),30000,"人物外觀核對");
     if(embeddings.length!==merged.candidates.length)throw new Error("人物外觀回覆數量不一致");
    }catch(e){
     if(signal.aborted)break;
     if(!frames.length)throw e;
     const stopped=tracker.stop(seek.t,seek.exact,"骨架或外觀核對無法繼續執行，保留已完成影格；請重試");frames.push(stopped);onProgress(Math.round((i+1)/times.length*100),stopped);break;
    }
   }
   if(signal.aborted)break;
   const frame=limited?tracker.suspend(seek.t,seek.exact,`本格達到 ${MAX_POSES} 人的辨識上限，繼續掃描並保留缺值`):merged.reason?tracker.suspend(seek.t,seek.exact,merged.reason):tracker.update(merged.candidates.map((candidate,j)=>({candidate,embedding:embeddings[j]??null})),seek.t,seek.exact,passes.reduce((n,p)=>n+p.result.landmarks.length,0));
   if(frames.length)frames[frames.length-1]=tracker.confirmPrevious(frames[frames.length-1],frame);
   frames.push(frame);onProgress(Math.round((i+1)/times.length*100),frame);
   await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  const last=frames[frames.length-1],lost=last?.track?.state==="lost";
  const tracking:TrackingRun={method:"target-lock-v2",pipeline:"full-rtmpose-v1",identity:"appearance-reid-v1",targetId:s.target!.id,status:lost?"lost":signal.aborted?"cancelled":until===undefined?"complete":"partial",lastTime:last?.t??s.start,...(lost?{reason:last.reason}:{})};
  if(!frames.length&&!signal.aborted)throw new Error("此區間沒有取得可辨識的影格，請換一個起始畫面。");
  return {frames,complete:tracking.status==="complete",tracking};
 }finally{model?.close();wholebodyModel?.close();reidModel?.close();}
}
export async function analyzeVideo(video:HTMLVideoElement,s:Settings,signal:AbortSignal,onProgress:TrackingProgress){
 return runTracking(video,s,signal,onProgress);
}
// A standalone detection at an arbitrary timestamp cannot establish identity.
// Preserve the whole replay, including identity gaps. Keeping only the last
// recovered frame would erase the evidence separating measured intervals.
export async function analyzeOne(video:HTMLVideoElement,s:Settings,signal:AbortSignal,onProgress:TrackingProgress){
 const targetTime=video.currentTime,result=await runTracking(video,s,signal,onProgress,targetTime);
 if(result.tracking.status==="cancelled")throw new Error("已取消追蹤至此幀，沒有加入新點位。");
 const frame=result.frames[result.frames.length-1];
 if(!frame||result.tracking.status!=="lost"&&Math.abs(frame.t-targetTime)>Math.max(.025,s.slow/s.fps))throw new Error("未取得對齊的目標影格，沒有加入新點位。");
 return {...result,frame};
}
