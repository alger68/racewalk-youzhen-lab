/** One in-flight request per model. The deadline lives on the UI thread so it
 * can terminate even a worker stuck inside synchronous WASM / GPU code. */
export interface WorkerPort {
 postMessage(message:unknown,transfer?:Transferable[]):void;
 terminate():void;
 addEventListener(type:string,listener:EventListener):void;
 removeEventListener(type:string,listener:EventListener):void;
}
export class WorkerChannel {
 private nextId=0;
 private closed:Error|null=null;
 private pending?:{id:number;resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
 private onMessage:EventListener=(event)=>{
  const response=(event as MessageEvent).data,pending=this.pending;
  if(!pending||response?.id!==pending.id)return;
  if(typeof response.progress==="string"){this.onProgress?.(response.progress);return;}
  if(response.error){this.close(new Error(String(response.error)));return;}
  clearTimeout(pending.timer);this.pending=undefined;pending.resolve(response.result);
 };
 private onError:EventListener=()=>this.close(new Error("背景分析無法執行，請重試或改用手動圈選。"));
 private onAbort=()=>this.close(this.signal.reason instanceof Error?this.signal.reason:new DOMException("已停止分析。","AbortError"));
 constructor(private worker:WorkerPort,private signal:AbortSignal,private onProgress?:(stage:string)=>void){
  worker.addEventListener("message",this.onMessage);worker.addEventListener("error",this.onError);worker.addEventListener("messageerror",this.onError);
  signal.addEventListener("abort",this.onAbort,{once:true});if(signal.aborted)this.onAbort();
 }
 call<T>(payload:object,transfer:Transferable[]=[],timeoutMs=10000,label="人物偵測"):Promise<T>{
  if(this.closed)return Promise.reject(this.closed);
  if(this.pending)return Promise.reject(new Error("請等目前背景工作結束。"));
  const id=++this.nextId;
  return new Promise<T>((resolve,reject)=>{
   const timer=setTimeout(()=>this.close(new Error(`${label}逾時，已停止等待。可以重試或手動圈選。`)),timeoutMs);
   this.pending={id,resolve:value=>resolve(value as T),reject,timer};
   try{this.worker.postMessage({...payload,id},transfer);}catch{this.close(new Error("無法傳送影格至背景分析，請重試。"));}
  });
 }
 close(error:Error=new Error("背景工作已結束。")){
  if(this.closed)return;this.closed=error;
  this.worker.terminate();this.worker.removeEventListener("message",this.onMessage);this.worker.removeEventListener("error",this.onError);this.worker.removeEventListener("messageerror",this.onError);this.signal.removeEventListener("abort",this.onAbort);
  const pending=this.pending;this.pending=undefined;if(pending){clearTimeout(pending.timer);pending.reject(error);}
 }
}
export function boundedOperation(parent:AbortSignal,timeoutMs:number,message:string){
 const controller=new AbortController(),forward=()=>controller.abort(parent.reason);
 parent.addEventListener("abort",forward,{once:true});if(parent.aborted)forward();
 const timer=setTimeout(()=>controller.abort(new Error(message)),timeoutMs);
 return {signal:controller.signal,dispose:()=>{clearTimeout(timer);parent.removeEventListener("abort",forward);}};
}
