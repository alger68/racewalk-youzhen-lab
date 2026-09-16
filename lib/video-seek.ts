export async function seekVideo(video:HTMLVideoElement,t:number,signal?:AbortSignal):Promise<{t:number;exact:boolean}> {
 if(signal?.aborted)throw signal.reason;
 const target=Math.max(0,Math.min(t,video.duration-.001));
 return new Promise((resolve,reject)=>{
  let done=false,callback:number|undefined;let settleTimer:ReturnType<typeof setTimeout>|undefined;
  const finish=(value:{t:number;exact:boolean},error?:Error)=>{if(done)return;done=true;clearTimeout(timeout);if(settleTimer)clearTimeout(settleTimer);video.removeEventListener("seeked",onSeek);video.removeEventListener("loadeddata",onData);video.removeEventListener("canplay",onData);video.removeEventListener("error",onError);signal?.removeEventListener("abort",onAbort);if(callback!==undefined)video.cancelVideoFrameCallback?.(callback);if(error)reject(error);else resolve(value);};
  const onError=()=>finish({t:target,exact:false},new Error("無法解碼這段影片，請改用MP4／H.264原片。"));
  const onAbort=()=>finish({t:target,exact:false},signal?.reason instanceof Error?signal.reason:new DOMException("已停止分析。","AbortError"));
  const onSeek=()=>{if(video.readyState<2||video.seeking)return;if(settleTimer)clearTimeout(settleTimer);settleTimer=setTimeout(()=>finish({t:video.currentTime,exact:false}),120);};
  const onData=()=>{if(Math.abs(video.currentTime-target)<.025)onSeek();};
  const timeout=setTimeout(()=>finish({t:target,exact:false},new Error("讀取影格逾時，請縮短影片或換用支援此格式的瀏覽器。")),7000);
  video.addEventListener("seeked",onSeek);video.addEventListener("loadeddata",onData);video.addEventListener("canplay",onData);video.addEventListener("error",onError);signal?.addEventListener("abort",onAbort,{once:true});
  if(video.requestVideoFrameCallback)callback=video.requestVideoFrameCallback((_now,meta)=>finish({t:meta.mediaTime,exact:true}));
  if(Math.abs(video.currentTime-target)<.00001&&video.readyState>=2){onSeek();}else video.currentTime=target;
 });
}
