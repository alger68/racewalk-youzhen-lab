import { InferenceSession, Tensor, env } from "onnxruntime-web/wasm";
import { decodeWholebody, wholebodyTensor, type WholebodyResult } from "./wholebody";
import type { PixelFrame } from "./vision-protocol";
import { sha256Portable } from "./browser-crypto";

type Request={id:number}&({command:"init";baseUrl:string}|{command:"detect";images:PixelFrame[]});
const scope=self as unknown as {onmessage:((event:MessageEvent<Request>)=>void)|null;postMessage:(message:unknown)=>void};
let session:InferenceSession|undefined;
scope.onmessage=async({data})=>{
 try{
  if(data.command==="init"){
   env.wasm.numThreads=1;env.wasm.proxy=false;
   // Explicit same-origin paths also work in a bundled classic worker.
   env.wasm.wasmPaths={mjs:new URL("/onnx/ort-wasm-simd-threaded.mjs",data.baseUrl).href,wasm:new URL("/onnx/ort-wasm-simd-threaded.wasm",data.baseUrl).href};
   const sizes=[20971520,12559955],parts:Uint8Array[]=[];
   for(let i=0;i<sizes.length;i++){
    scope.postMessage({id:data.id,progress:`正在下載第二套骨架模型 ${i+1}/${sizes.length}`});
    const response=await fetch(new URL(`/models/rtmpose-s-wholebody-${i}.bin`,data.baseUrl));
    if(!response.ok)throw new Error("第二套骨架模型下載失敗，請重試");
    const part=new Uint8Array(await response.arrayBuffer());if(part.length!==sizes[i])throw new Error("第二套骨架模型下載不完整");parts.push(part);
   }
   const bytes=new Uint8Array(sizes.reduce((a,b)=>a+b,0));bytes.set(parts[0]);bytes.set(parts[1],sizes[0]);
   scope.postMessage({id:data.id,progress:"正在啟動第二套骨架模型"});
   const sha=sha256Portable(bytes);
   if(sha!=="b791032a77010398f95b112f863dbe30ad16e09ff156753fb08484ff5bf8f718")throw new Error("第二套骨架模型完整性檢查未通過");
   session=await InferenceSession.create(bytes,{executionProviders:["wasm"],graphOptimizationLevel:"all"});
   scope.postMessage({id:data.id,result:true});return;
  }
  if(!session)throw new Error("第二套骨架模型尚未就緒");
  const results:WholebodyResult[]=[];
  for(const frame of data.images){
   if(frame.width!==192||frame.height!==256)throw new Error("複核影格尺寸不正確");
   const input=new Tensor("float32",wholebodyTensor(frame.data),[1,3,256,192]);
   const outputs=await session.run({input});
   try{results.push(decodeWholebody(outputs.simcc_x.data as Float32Array,outputs.simcc_y.data as Float32Array));}
   finally{input.dispose();Object.values(outputs).forEach(t=>t.dispose());}
  }
  scope.postMessage({id:data.id,result:results});
 }catch(e){scope.postMessage({id:data.id,error:e instanceof Error?e.message:"第二套骨架複核失敗"});}
};
