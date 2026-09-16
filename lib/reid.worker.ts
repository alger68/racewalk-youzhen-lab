import { pinnedModel } from "./model-cache";
import { InferenceSession, Tensor, env } from "onnxruntime-web/wasm";
import { REID_SIZE, REID_SHA, reidTensor, reidEmbedding } from "./reid";
import { sha256Portable } from "./browser-crypto";
import type { PixelFrame } from "./vision-protocol";
type Request={id:number}&({command:"init";baseUrl:string}|{command:"detect";images:PixelFrame[]});
const scope=self as unknown as {onmessage:((event:MessageEvent<Request>)=>void)|null;postMessage:(message:unknown)=>void};
let session:InferenceSession|undefined;
scope.onmessage=async({data})=>{
 try{
  if(data.command==="init"){
   env.wasm.numThreads=1;env.wasm.proxy=false;
   env.wasm.wasmPaths={mjs:new URL("onnx/ort-wasm-simd-threaded.mjs",data.baseUrl).href,wasm:new URL("onnx/ort-wasm-simd-threaded.wasm",data.baseUrl).href};
   scope.postMessage({id:data.id,progress:"正在讀取人物外觀模型（優先使用已驗證快取）"});
   const bytes=await pinnedModel(new URL("models/yolo26n-reid.onnx",data.baseUrl).href,9873245,REID_SHA);
   scope.postMessage({id:data.id,progress:"正在啟動人物外觀模型"});
   session=await InferenceSession.create(bytes,{executionProviders:["wasm"],graphOptimizationLevel:"all"});
   scope.postMessage({id:data.id,result:true});return;
  }
  if(!session)throw new Error("人物外觀模型尚未就緒");
  const results:number[][]=[];
  for(const frame of data.images){
   if(frame.width!==REID_SIZE||frame.height!==REID_SIZE)throw new Error("人物外觀影格尺寸不正確");
   const input=new Tensor("float32",reidTensor(frame.data),[1,3,REID_SIZE,REID_SIZE]);
   const outputs=await session.run({images:input});
   try{results.push(reidEmbedding(outputs.embeddings.data as Float32Array));}
   finally{input.dispose();Object.values(outputs).forEach(t=>t.dispose());}
  }
  scope.postMessage({id:data.id,result:results});
 }catch(e){scope.postMessage({id:data.id,error:e instanceof Error?e.message:"人物外觀分析失敗"});}
};
