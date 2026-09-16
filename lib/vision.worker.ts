import { pinnedModel } from "./model-cache";
// Bundle as a classic worker: MediaPipe's WASM loader uses importScripts().
// No inference or model initialization runs on the page's UI thread.
import { FilesetResolver, ObjectDetector, PoseLandmarker } from "@mediapipe/tasks-vision";
import { MAX_POSES, type ModelKind, type RawPeople, type RawPose, type VisionRequest } from "./vision-protocol";

const scope=self as unknown as {onmessage:((event:MessageEvent<VisionRequest>)=>void)|null;postMessage:(message:unknown)=>void};
let model:PoseLandmarker|ObjectDetector|undefined,kind:ModelKind;
scope.onmessage=async({data})=>{
 try{
  if(data.command==="init"){
   kind=data.kind;
   if(typeof OffscreenCanvas==="undefined")throw new Error("此瀏覽器不支援背景影像分析，請更新瀏覽器。");
   const canvas=new OffscreenCanvas(1,1);
   if(!canvas.getContext("webgl2"))throw new Error("此瀏覽器的背景 WebGL2 不可用，無法啟動骨架模型。請開啟瀏覽器硬體加速後重新載入網站，或改用支援背景 WebGL2 的瀏覽器再啟動自動分析。");
   const vision=await FilesetResolver.forVisionTasks(new URL("/mediapipe/wasm",data.baseUrl).href);
   // CPU avoids device-specific GPU stalls, including the quantized detector.
   // Each worker owns one model and is discarded on completion or cancellation.
   model=kind==="pose"?await PoseLandmarker.createFromOptions(vision,{canvas,
    baseOptions:{modelAssetBuffer:await pinnedModel(new URL("/models/pose_landmarker_full.task",data.baseUrl).href,9398198,"5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1"),delegate:"CPU"},runningMode:"IMAGE",numPoses:MAX_POSES,minPoseDetectionConfidence:.6,minPosePresenceConfidence:.6,minTrackingConfidence:.6
   }):await ObjectDetector.createFromOptions(vision,{canvas,
    baseOptions:{modelAssetBuffer:await pinnedModel(new URL("/models/efficientdet_lite0_uint8.tflite",data.baseUrl).href,4563519,"2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b"),delegate:"CPU"},runningMode:"IMAGE",categoryAllowlist:["person"],scoreThreshold:.35,maxResults:30
   });
   scope.postMessage({id:data.id,result:true});return;
  }
  if(!model)throw new Error("分析模型尚未就緒。");
  const results:(RawPose|RawPeople)[]=[];
  for(const image of data.images){
   const input=new ImageData(new Uint8ClampedArray(image.data),image.width,image.height);
   if(kind==="pose"){
    const result=(model as PoseLandmarker).detect(input);
    results.push({landmarks:result.landmarks.map(points=>points.map(p=>({x:p.x,y:p.y,v:p.visibility??0})))});
   }else{
    const result=(model as ObjectDetector).detect(input);
    results.push({detections:result.detections.filter(d=>d.boundingBox).map(d=>({boundingBox:d.boundingBox!,score:Math.max(...d.categories.map(c=>c.score))}))});
   }
  }
  scope.postMessage({id:data.id,result:results});
 }catch(e){scope.postMessage({id:data.id,error:e instanceof Error?e.message:"背景分析未完成。"});}
};
