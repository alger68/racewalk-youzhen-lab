import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync,rmSync} from "node:fs";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
// Corresponding project source; omit user/runtime data, credentials and binary
// dependencies. Pinned model sources and licenses are in models/MODELS.md.
const files=execFileSync("git",["ls-files","-z","--cached","--others","--exclude-standard"],{cwd:root,encoding:"utf8"}).split("\0").filter(Boolean).filter(p=>!p.startsWith("public/source/")&&!/^(\.env|\.git\/|\.wrangler\/|\.sites-runtime\/)/.test(p)&&!/^public\/(onnx|mediapipe)\//.test(p)&&!/^public\/models\/.*\.(bin|task|tflite|onnx)$/.test(p));
mkdirSync(new URL("../public/source/",import.meta.url),{recursive:true});
const list=new URL("../public/source/.file-list",import.meta.url);writeFileSync(list,files.join("\0")+"\0");
try{execFileSync("tar",["-czf","public/source/racewalk-source.tar.gz","--null","-T",fileURLToPath(list)],{cwd:root});}finally{rmSync(list);}
