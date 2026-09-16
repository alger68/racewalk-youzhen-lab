import { build, type Plugin } from "vite";
import { resolve } from "node:path";

/** Vite's dev worker URL retains ES imports, but MediaPipe's WASM loader needs
 * a classic worker (importScripts). Serve the same IIFE format used by builds. */
export function classicWorkerDev():Plugin {
 return {name:"racewalk-classic-worker-dev",apply:"serve",configureServer(server){
  server.middlewares.use(async(req,res,next)=>{
   const entries:Record<string,string>={"/__racewalk_worker__/vision.js":"vision.worker.ts","/__racewalk_worker__/wholebody.js":"wholebody.worker.ts","/__racewalk_worker__/reid.js":"reid.worker.ts"};
   const entry=entries[req.url?.split("?")[0]??""];if(!entry)return next();
   try{
    const result=await build({configFile:false,root:server.config.root,publicDir:false,logLevel:"error",build:{write:false,minify:false,lib:{entry:resolve(server.config.root,"lib",entry),name:"RacewalkVisionWorker",formats:["iife"]},rollupOptions:{output:{inlineDynamicImports:true}}}});
    const outputs=(Array.isArray(result)?result:[result]).flatMap(r=>"output" in r?r.output:[]);
    const chunk=outputs.find(o=>o.type==="chunk");if(!chunk||chunk.type!=="chunk")throw new Error("Background bundle unavailable");
    res.setHeader("Content-Type","application/javascript");res.setHeader("Cache-Control","no-store");res.end(chunk.code);
   }catch(e){res.statusCode=500;res.end("Background worker build failed");server.config.logger.error(String(e));}
  });
 }};
}
