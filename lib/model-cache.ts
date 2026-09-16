import { sha256Portable } from './browser-crypto';

/** Cache only public, pinned model bytes. Never cache videos or reports. */
export async function pinnedModel(url:string,size:number,sha:string):Promise<Uint8Array>{
 const valid=(b:Uint8Array)=>b.length===size&&sha256Portable(b)===sha;
 let cache:Cache|undefined;
 const key=new URL(url);key.searchParams.set('sha256',sha);
 try{cache=await caches.open('racewalk-models-v1');}catch{/* Private mode/quota: network fallback. */}
 if(cache){
  try{const hit=await cache.match(key.href);if(hit){const b=new Uint8Array(await hit.arrayBuffer());if(valid(b))return b;await cache.delete(key.href);}}catch{/* A cache failure must not disable inference. */}
 }
 const response=await fetch(url);if(!response.ok)throw new Error('AI 模型下載失敗，請檢查網路後重試。');
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(!valid(bytes))throw new Error('AI 模型完整性檢查未通過，沒有使用這份檔案。');
 try{await cache?.put(key.href,new Response(bytes.slice().buffer,{headers:{'Content-Type':'application/octet-stream'}}));}catch{/* Analysis may continue without persistent cache. */}
 return bytes;
}
