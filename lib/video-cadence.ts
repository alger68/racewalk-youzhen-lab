export type PresentedFrame={mediaTime:number;presentedFrames:number};
export function estimateCadence(frames:PresentedFrame[]):number|null{
 const gaps:number[]=[];
 for(let i=4;i<frames.length;i++){
  const a=frames[i-1],b=frames[i],dt=b.mediaTime-a.mediaTime;
  // Skipped compositor callbacks cannot establish source frame cadence.
  if(b.presentedFrames-a.presentedFrames===1&&Number.isFinite(dt)&&dt>0&&dt<.2)gaps.push(dt);
 }
 if(gaps.length<10)return null;
 gaps.sort((a,b)=>a-b);const median=gaps[Math.floor(gaps.length/2)];
 if(gaps.filter(g=>Math.abs(g-median)<median*.08).length/gaps.length<.8)return null;
 const fps=1/median;if(fps<5||fps>480)return null;
 const standards=[23.976,24,25,29.97,30,50,59.94,60,100,119.88,120,240];
 const nearest=standards.reduce((a,b)=>Math.abs(a-fps)<Math.abs(b-fps)?a:b);
 return Math.abs(nearest-fps)/fps<.005?nearest:Math.round(fps*100)/100;
}

/** Use a separate decoder so probing never moves the user's playback position. */
export async function probeCadence(src:string,signal:AbortSignal):Promise<number|null>{
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';
 if(!video.requestVideoFrameCallback)return null;
 const frames:PresentedFrame[]=[];let callback=0;
 try{
  return await new Promise<number|null>(resolve=>{
   let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',finish);resolve(signal.aborted?null:estimateCadence(frames));};
   const timer=setTimeout(finish,3500);signal.addEventListener('abort',finish,{once:true});
   if(signal.aborted){finish();return;}
   const next:VideoFrameRequestCallback=(_now,meta)=>{if(done)return;frames.push({mediaTime:meta.mediaTime,presentedFrames:meta.presentedFrames});if(frames.length>=48)finish();else callback=video.requestVideoFrameCallback(next);};
   video.onerror=finish;video.onended=finish;video.src=src;
   callback=video.requestVideoFrameCallback(next);void video.play().catch(finish);
  });
 }finally{video.cancelVideoFrameCallback(callback);video.pause();video.removeAttribute('src');video.load();}
}
