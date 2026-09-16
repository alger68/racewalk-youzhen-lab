import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
 root:"pages",
 base:"/racewalk-youzhen-lab/",
 publicDir:"../public",
 plugins:[react()],
 resolve:{alias:{"@":path.resolve(__dirname)}},
 define:{"import.meta.env.VITE_STATIC_MODE":JSON.stringify("true")},
 build:{outDir:"../pages-dist",emptyOutDir:true,target:"es2022"},
});
