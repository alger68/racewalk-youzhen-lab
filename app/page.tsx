"use client";
import { probeCadence } from "@/lib/video-cadence";
import { analysisDiagnostics } from "@/lib/analysis-diagnostics";
import { fileHash as hash, randomId } from "@/lib/browser-crypto";
import { manuallyCorrectKnee } from "@/lib/observed-recovery";
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BookOpen, Check, ChevronLeft, ChevronRight, CloudUpload, Crosshair, FileJson, History, ImageDown, LoaderCircle, Pause, Play, Plus, ScanLine, Square, Upload, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { VideoSurface, captureFrame, KneeReadout } from "@/components/racewalk/video-surface";
import { QualityPanel } from "@/components/racewalk/quality-panel";
import { observeKnee } from "@/lib/inspection";
import { MotionPlots } from "@/components/racewalk/plots";
import { SettingsPanel, JudgePanel, EventList, ReportPanel, HistoryPanel, GuidePanel, Field, type HistoryRow } from "@/components/racewalk/panels";
import { scopeFrame, trackingNotice, hasAcquiredTarget, selectTarget, ENGINE, defaults, nearestFrame, pelvicTilt, torso, nearSide, validPoint, summarize, EVENT_LABEL, timeText, type Point, type PoseFrame, type Report, type Settings, type WalkEvent, type EventKind, type Side } from "@/lib/racewalk";
import { analysisEvents, applyAnalysisSettings } from "@/lib/contact-analysis";
import { reportSchema } from "@/lib/report-schema";
import { analyzeVideo, analyzeOne, seekVideo, detectPeople } from "@/lib/vision";
import { selectDetectedTarget, type PeopleScan } from "@/lib/people";
import { download, htmlReport, csvReport } from "@/lib/export-report";

async function api<T>(url:string,init?:RequestInit):Promise<T>{const response=await fetch(url,init);const body=await response.json().catch(()=>({error:"服務回應格式不正確，請重試。"}));if(!response.ok)throw new Error((body as {error?:string}).error||"操作未完成，請重試。");return body as T;}
const message=(e:unknown)=>e instanceof Error?e.message:"操作未完成，請重試。";
const fmt=(n:number|null)=>n===null?"—":`${n.toFixed(1)}°`;
type Confirm={title:string;description:string;action:string;run:()=>void|Promise<void>};

export default function Home(){
 const [tab,setTab]=useState("work"),[setup,setSetup]=useState<Settings>(defaults),[r,setR]=useState<Report|null>(null),[src,setSrc]=useState(""),[ready,setReady]=useState(false),[file,setFile]=useState<File|null>(null),[archived,setArchived]=useState(false);
 const [busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[dirty,setDirty]=useState(false),[progress,setProgress]=useState(0),[notice,setNotice]=useState(""),[error,setError]=useState(""),[confirm,setConfirm]=useState<Confirm|null>(null);
 const [time,setTime]=useState(0),[playing,setPlaying]=useState(false),[mode,setMode]=useState("bio"),[overlay,setOverlay]=useState(true),[reference,setReference]=useState(true),[rate,setRate]=useState(1),[tool,setTool]=useState<"ground"|"roi"|"manual"|null>(null),[liveFrame,setLiveFrame]=useState<PoseFrame|null>(null),[png,setPng]=useState<string|null>(null);
 const [cadence,setCadence]=useState<number|null>(null),[probing,setProbing]=useState(false);
 const queuedTarget=useRef<string|null>(null);
 const [analysisFailure,setAnalysisFailure]=useState("");
 const [focusedEvent,setFocusedEvent]=useState<string|null>(null);
 const [showReviewPeople,setShowReviewPeople]=useState(false);
 const [peopleScan,setPeopleScan]=useState<PeopleScan|null>(null),[scanningPeople,setScanningPeople]=useState(false),autoPeopleScan=useRef(false),manualAfterScan=useRef(false);
 const [operationStage,setOperationStage]=useState(""),[elapsed,setElapsed]=useState(0);
 const videoCard=useRef<HTMLElement|null>(null);
 const [eventSide,setEventSide]=useState<Side>("L"),[eventKind,setEventKind]=useState<EventKind>("IC"),[eventNote,setEventNote]=useState(""),[history,setHistory]=useState<HistoryRow[]>([]),[loadingHistory,setLoadingHistory]=useState(false);
 const video=useRef<HTMLVideoElement>(null),fileInput=useRef<HTMLInputElement>(null),attachInput=useRef<HTMLInputElement>(null),jsonInput=useRef<HTMLInputElement>(null),abort=useRef<AbortController|null>(null),objectUrl=useRef(""),newFile=useRef<{file:File;sha:string}|null>(null),current=useRef(r),isBusy=useRef(false),dirtyRef=useRef(false);
 current.current=r;isBusy.current=busy||saving;dirtyRef.current=dirty;
 const s=r?.settings??setup,locked=busy||saving,hasFrames=!!r?.frames.length;
 const candidate=liveFrame??(r?nearestFrame(r.frames,time):null);
 const frame=!peopleScan&&!scanningPeople&&candidate&&Math.abs(candidate.t-time)<=Math.max(.018,s.slow/s.fps*.6)?scopeFrame(candidate,s):null;
 const referenceSide=nearSide(s.view),referenceHip=referenceSide==="L"?23:24;
 const referenceHint=!referenceSide?"伸膝參考線僅適用側面影片。":!frame?"伸膝參考線等待此幀的目標骨架；可按「追蹤至此幀」。":frame.reason||frame.track?.state==="searching"||frame.track?.state==="lost"?"身分或骨架尚未確認，伸膝參考線暫不顯示。":frame.track?.withheld?.[referenceSide]||!validPoint(frame.points[referenceHip])||!validPoint(frame.points[referenceHip+4])?"此幀近側髖或踝未通過核對，伸膝參考線暫不顯示；可人工標點複查。":"紫色虛線為髖到踝參考軸，不表示應強鎖膝。";
 const offeredPeople=peopleScan?.people.filter(p=>!p.review||showReviewPeople||!peopleScan.people.some(c=>!c.review))??[];
 const visiblePeople=peopleScan&&!locked&&!tool&&mode==="bio"&&Math.abs(peopleScan.time-time)<=Math.max(.025,s.slow/s.fps)?offeredPeople:[];
 const diagnostics=useMemo(()=>r?analysisDiagnostics(r):[],[r]);
 const summary=useMemo(()=>r?summarize(r):null,[r]);
 const focused=r?.events.find(e=>e.id===focusedEvent);
 function change(fn:(old:Report)=>Report){setR(old=>old?fn(old):old);setDirty(true);setPng(null);}
 function patch(p:Partial<Settings>){if(r)change(old=>applyAnalysisSettings(old,p));else setSetup(old=>({...old,...p}));}
 function replaceSource(url:string){setCadence(null);queuedTarget.current=null;setAnalysisFailure("");autoPeopleScan.current=false;setPeopleScan(null);if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current=url.startsWith("blob:")?url:"";setSrc(url);setReady(false);setTime(0);setPlaying(false);setLiveFrame(null);setPng(null);setTool(null);setFocusedEvent(null);}
 function guarded(run:()=>void|Promise<void>){if(locked)return;if(dirty&&r)setConfirm({title:"開啟另一筆內容？",description:"目前有尚未儲存的修改。請先取消並儲存／匯出JSON；繼續會捨棄目前未儲存的畫面。",action:"捨棄修改並繼續",run});else void Promise.resolve(run()).catch(e=>setError(message(e)));}
 async function refresh(){setLoadingHistory(true);try{const data=await api<{sessions:HistoryRow[]}>("/api/sessions");setHistory(data.sessions);}catch(e){setError(message(e));}finally{setLoadingHistory(false);}}
 useEffect(()=>{void refresh();return()=>{abort.current?.abort();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);};},[]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirtyRef.current||isBusy.current){e.preventDefault();e.returnValue="";}};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[]);
 useEffect(()=>{if(video.current){video.current.playbackRate=mode==="judge"&&s.timingVerified?s.slow:rate;}},[mode,rate,s.slow,s.timingVerified,src]);
 useEffect(()=>{if(!src)return;const controller=new AbortController();setProbing(true);setCadence(null);void probeCadence(src,controller.signal).then(value=>{if(!controller.signal.aborted)setCadence(value);}).finally(()=>{if(!controller.signal.aborted)setProbing(false);});return()=>controller.abort();},[src]);
 useEffect(()=>{if(ready&&r&&autoPeopleScan.current&&!locked){autoPeopleScan.current=false;void scanPeople();}},[ready,r?.id,locked]);
 useEffect(()=>{if(!busy)return;const start=Date.now();setElapsed(0);const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-start)/1000)),1000);return()=>clearInterval(timer);},[busy]);
 useEffect(()=>{if(!locked&&manualAfterScan.current){manualAfterScan.current=false;void startTool("roi").catch(e=>setError(message(e)));}},[locked]);
 // Consume once, after React has installed the selected report. Never rerun on
 // cancellation/error, attachment, or unrelated settings changes.
 useEffect(()=>{
  if(!queuedTarget.current||locked||!ready)return;
  const target=queuedTarget.current;queuedTarget.current=null;
  if(r?.settings.target?.id===target)void runAnalysis().catch(()=>{});
 },[r?.settings.target?.id,locked,ready]);
 // Same actions as the visible interface; never automatically confirm a judging event.
 const actions=useRef({seek:(_t:number)=>Promise.resolve(),save:()=>Promise.resolve(null as Report|null),start:()=>Promise.resolve(),open:(_id:string)=>Promise.resolve()});
 useEffect(()=>{
  type Tool={name:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean;untrustedContentHint:boolean};execute:(v:Record<string,unknown>)=>unknown};
  const context=(document as Document&{modelContext?:{registerTool:(t:Tool,o:{signal:AbortSignal})=>unknown}}).modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();
  const tools:Tool[]=[{name:"read_racewalk_session",description:"Read the current report summary and unconfirmed event count; this does not judge or change the video.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>current.current?{id:current.current.id,summary:summarize(current.current),judge:current.current.judge,dirty:dirtyRef.current}:{session:null}},
   {name:"seek_racewalk_video",description:"Navigate the loaded video to a file timestamp in seconds. Does not confirm an event.",inputSchema:{type:"object",properties:{seconds:{type:"number",minimum:0}},required:["seconds"],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async v=>{if(typeof v.seconds!=="number"||!Number.isFinite(v.seconds))throw new Error("seconds must be finite");await actions.current.seek(v.seconds);return {time:video.current?.currentTime};}},
   {name:"start_racewalk_analysis",description:"Run pose extraction on the currently loaded video and configured interval; creates pending candidates and saves the result. Requires no existing frames.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async()=>{if(current.current?.frames.length)throw new Error("Clear existing analysis in the interface first");await actions.current.start();return {status:"analysis finished; inspect summary"};}},
   {name:"save_racewalk_report",description:"Persist the current report, poses, events and symptom settings to this private site's history. Does not upload the original video.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async()=>{const report=await actions.current.save();return {id:report?.id,version:report?.version};}}];
  for(const t of tools)try{void Promise.resolve(context.registerTool(t,{signal:lifecycle.signal})).catch(()=>{});}catch{/* Optional browser capability. */}return()=>lifecycle.abort();
 },[]);
 async function chooseVideo(f:File,attach=false){
  setError("");setNotice("");if(f.size>104857600)throw new Error("單支影片上限100 MB。請保留原始格式，先裁出10～15秒的片段。");if(!/\.(mp4|mov|webm|m4v)$/i.test(f.name))throw new Error("請選MP4、MOV或WebM影片。");
  setBusy(true);try{const sha=await hash(f);if(attach&&r){if(!r.file.sha256||r.file.sha256!==sha)throw new Error("這支影片與報告的原片指紋不同。請選取原始檔，或建立一筆新分析。");newFile.current=null;}else{newFile.current={file:f,sha};setR(null);setDirty(false);setArchived(false);}
   setFile(f);replaceSource(URL.createObjectURL(f));setTab("work");setMode("bio");
  }finally{setBusy(false);}
 }
 function loaded(){const v=video.current;if(!v||!Number.isFinite(v.duration)||v.duration<=0||v.duration>7200){setError("影片長度無法解析或超過2小時，請先裁成短片。");return;}setReady(true);if(newFile.current){const n=newFile.current;newFile.current=null;const settings={...setup,start:0,end:Math.min(v.duration,3000*setup.slow/Math.min(setup.fps,setup.sampleFps)),roi:null,target:undefined,ground:null,groundStable:false,clearFeet:false,pain:"unknown" as const};const report:Report={schema:1,engine:ENGINE,id:randomId(),version:0,created:new Date().toISOString(),settings,file:{name:n.file.name,size:n.file.size,duration:v.duration,width:v.videoWidth,height:v.videoHeight,sha256:n.sha},frames:[],events:[],judge:{contact:"pending",left:"pending",right:"pending"},notes:"",complete:false};setR(report);setDirty(true);setSetup(settings);autoPeopleScan.current=true;setNotice("影片已載入，準備偵測畫面中的人物；也可暫停後手動圈選。");}v.playbackRate=mode==="judge"&&s.timingVerified?s.slow:rate;}
 async function seek(t:number){if(isBusy.current)throw new Error("分析或儲存進行中，請稍候。");const v=video.current;if(!v||!ready)throw new Error("請先載入原片。");if(!Number.isFinite(t)||t<0||t>v.duration)throw new Error("時間超出影片。");v.pause();setPeopleScan(null);setTool(null);setLiveFrame(null);const result=await seekVideo(v,t);setTime(result.t);}
 function jump(t:number){void seek(t).catch(e=>setError(message(e)));}
 function review(t:number,eventId?:string){
  if(locked)return;setTab("work");setMode("bio");setOverlay(true);setReference(true);
  setFocusedEvent(eventId??r?.events.find(e=>Math.abs(e.t-t)<.001)?.id??null);
  void seek(t).then(()=>videoCard.current?.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth",block:"start"})).catch(e=>setError(message(e)));
 }
 async function save(snapshot:Report|null=r){if(!snapshot)throw new Error("尚未建立紀錄。");if(saving)throw new Error("正在儲存，請稍候。");const parsed=reportSchema.safeParse(snapshot);if(!parsed.success)throw new Error(`無法儲存：${parsed.error.issues[0]?.message}`);setSaving(true);try{const result=await api<{version:number}>("/api/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(parsed.data)});const saved={...snapshot,version:result.version};setR(old=>old?.id===saved.id?{...old,version:saved.version}:old);setDirty(false);setNotice("分析與複查紀錄已儲存。原片備份可另外操作。");void refresh();return saved;}finally{setSaving(false);}}
 async function scanPeople(){
  const report=current.current,v=video.current;if(isBusy.current||!report||!v||!ready)return;
  manualAfterScan.current=false;isBusy.current=true;setBusy(true);setScanningPeople(true);setOperationStage("正在讀取影片畫面");setPeopleScan(null);setProgress(0);setError("");setTool(null);setMode("bio");v.pause();
  setNotice("正在偵測本畫面的人物，完成後點選要分析的選手。");
  const controller=new AbortController();abort.current=controller;
  try{
   const result=await detectPeople(v,report.file.sha256,controller.signal,(p,stage)=>{setProgress(p);if(stage)setOperationStage(stage);});
   if(current.current?.file.sha256!==report.file.sha256||manualAfterScan.current)return;
   setTime(result.time);setPeopleScan(result);setShowReviewPeople(false);
   setNotice(result.people.length?`${result.warning?"部分偵測已停止。":""}已核對完成：${result.people.filter(p=>!p.review).length} 個骨架候選、${result.people.filter(p=>p.review).length} 個待確認區域。請選取目標；候選數不是實際人數。`:"此畫面沒有找到可用人物。可換一個清楚畫面再偵測，或手動圈選選手。");
  }catch(e){if(controller.signal.aborted)setNotice("已停止人物偵測，可直接手動圈選。");else{setNotice("");setError(`人物偵測未完成：${message(e)} 仍可使用手動圈選。`);}}
  finally{setBusy(false);setScanningPeople(false);isBusy.current=false;abort.current=null;if(manualAfterScan.current){setPeopleScan(null);setNotice("已停止偵測，請手動圈選一位選手。");}}
 }
 function stopPeopleForManual(){manualAfterScan.current=true;abort.current?.abort();}
 async function choosePerson(personId:string){
  const report=current.current,v=video.current,scan=peopleScan;if(!report||!scan||!v||isBusy.current)return;
  const next=selectDetectedTarget(report,scan,personId,v.currentTime,randomId(),randomId());
  isBusy.current=true;setBusy(true);v.pause();
  try{
   if((report.frames.length||report.events.length)&&(dirty||!report.version))await save(report);
   if(next.id!==report.id)setArchived(false);
   setR(next);setDirty(true);setPeopleScan(null);setLiveFrame(null);setPng(null);setFocusedEvent(null);setError("");setTime(scan.time);queuedTarget.current=next.settings.target!.id;setAnalysisFailure("");
   setNotice(`${next.id!==report.id?"原紀錄已保留，另建新片段。":""}已選定${scan.people.find(p=>p.id===personId)?.label??"候選"}；即將自動追蹤並分析這位選手。`);
  }finally{setBusy(false);isBusy.current=false;}
 }
 async function runAnalysis(){
  const report=current.current,v=video.current;if(isBusy.current||!report||!v||!ready)throw new Error("請先載入影片，並等目前操作完成。");
  isBusy.current=true;setError("");setAnalysisFailure("");setOperationStage("正在載入骨架模型");setNotice("正在載入骨架模型。第一次需要稍候，可隨時取消。");setBusy(true);setProgress(0);setMode("bio");setPeopleScan(null);setTool(null);setPng(null);abort.current=new AbortController();
  try{const result=await analyzeVideo(v,report.settings,abort.current.signal,(p,f,stage)=>{setProgress(p);if(stage)setOperationStage(stage);if(f){setOperationStage(`${f.track?.state==="searching"?"持續掃描・搜尋／核對中":"持續追蹤"} ${timeText(f.t)}`);setLiveFrame(f);setTime(f.t);}});const next={...report,engine:ENGINE,tracking:result.tracking,frames:result.frames,events:analysisEvents(result.frames,report.settings,report.file),judge:{contact:"pending",left:"pending",right:"pending"} as Report["judge"],complete:result.complete};setR(next);setDirty(true);setLiveFrame(null);setNotice(result.complete?`已掃描完整區間，共${result.frames.length}格。請逐一確認關鍵事件。`:`分析已停止，保留${result.frames.length}格。`);
   const first=result.tracking.status==="lost"?result.frames[result.frames.length-1]:result.frames.find(f=>observeKnee(f,nearSide(report.settings.view)??"L",report.file.width,report.file.height,report.settings.view).value!==null)??result.frames.find(f=>!f.reason&&f.points.length===33);
   if(first){const shown=await seekVideo(v,first.t);setTime(shown.t);}
   try{await save(next);}catch(e){setError(`分析已保留在畫面。${message(e)}`);}setNotice(trackingNotice(next));return;
  }catch(e){if(abort.current?.signal.aborted){setNotice("已取消分析，原有紀錄保留。");return;}setNotice("");setAnalysisFailure(message(e));setError(message(e));throw e;}finally{setBusy(false);isBusy.current=false;abort.current=null;}
 }
 async function single(){
  if(!video.current||!r||locked||!ready)return;
  setBusy(true);setError("");setOperationStage("正在載入骨架模型");setMode("bio");setTool(null);setProgress(0);abort.current=new AbortController();
  setNotice("從圈選起點掃描至此幀，保留搜尋缺口；已有分析時另存紀錄。");
  try{const result=await analyzeOne(video.current,s,abort.current.signal,(p,f,stage)=>{setProgress(p);if(stage)setOperationStage(stage);if(f){setOperationStage(`${f.track?.state==="searching"?"持續掃描・搜尋／核對中":"持續追蹤"} ${timeText(f.t)}`);setLiveFrame(f);setTime(f.t);}});
   const separate=r.frames.length>0||r.events.length>0;
   if(separate&&(dirty||!r.version))await save(r);
   const next:Report={...r,engine:ENGINE,...(separate?{id:randomId(),version:0,created:new Date().toISOString()}:{}),frames:result.frames,tracking:result.tracking,complete:result.complete,events:analysisEvents(result.frames,s,r.file),judge:{contact:"pending",left:"pending",right:"pending"}};
   if(separate)setArchived(false);
   setR(next);setDirty(true);setTime(result.frame.t);setPng(null);setFocusedEvent(null);
   try{await save(next);}catch(e){setError(`結果已保留在畫面。${message(e)}`);}
   setNotice(`${separate?"原紀錄已保留，這次重新追蹤另存一筆。":""}${trackingNotice(next)}`);
  }catch(e){setError(message(e));}finally{setLiveFrame(null);setBusy(false);abort.current=null;}
 }
 function markPoints(points:Point[]){
  if(!r||!video.current)return;
  if(tool==="manual"){
   const side=nearSide(s.view);if(!side)return;
   if(!s.target||!frame||frame.reason||frame.track?.targetId!==s.target.id||frame.track.state!=="locked"){setError("先追蹤取得目前選手的這一幀，才能修正髖、膝、踝。");setTool(null);return;}
   change(old=>manuallyCorrectKnee(old,frame.t,side,points));setLiveFrame(null);setNotice("已修正目前目標的髖、膝、踝；角度仍受視角與點選誤差影響。");
  }else if(tool==="ground"){
   if(Math.abs(points[0].x-points[1].x)<.02){setError("兩個地面點太接近垂直，請重新標記。");setTool(null);return;}
   change(old=>applyAnalysisSettings(old,{ground:points as [Point,Point]}));
  }else if(tool==="roi"){
   if(Math.abs(points[0].x-points[1].x)<.04||Math.abs(points[0].y-points[1].y)<.1){setError("範圍太小，請圈出單一選手的全身。");setTool(null);return;}
   if(time>=r.file.duration-.05){setError("請往前選擇還有後續動作的畫面。");setTool(null);return;}
   const next=selectTarget(r,points as [Point,Point],time,randomId(),randomId());
   if(next.id!==r.id)setArchived(false);
   setR(next);setDirty(true);setLiveFrame(null);setPng(null);setFocusedEvent(null);setError("");
   queuedTarget.current=next.settings.target!.id;setAnalysisFailure("");
   setNotice(`${next.id!==r.id?"原紀錄已保留，另建新片段。":""}已圈選 ${timeText(time)} 的目標，即將自動追蹤並分析。`);
  }
  setTool(null);
 }
 function addEvent(){if(!r||!ready||locked)return;if(!s.target||!frame||frame.reason||frame.track?.targetId!==s.target.id){setError("請先追蹤至目前影格，確認這位選手後再新增事件。");return;}video.current?.pause();if(r.events.length>=1000){setError("單筆最多1000個事件，請先整理候選。");return;}change(old=>({...old,events:[...old.events,{id:randomId(),t:time,side:eventSide,kind:eventKind,status:"pending",origin:"manual",note:eventNote||"人工定位，待原片確認。"}].sort((a,b)=>a.t-b.t) as WalkEvent[]}));setEventNote("");}
 async function archive(){if(!file||!r)throw new Error("請先載入相符的原始影片。");const report=dirty||!r.version?await save():r;if(!report)return;setBusy(true);try{await api(`/api/sessions/${report.id}/video`,{method:"PUT",headers:{"Content-Type":file.type||"application/octet-stream"},body:file});setArchived(true);setNotice("原片已備份，之後可從訓練紀錄直接重看。");void refresh();}finally{setBusy(false);}}
 async function openReport(id:string){setBusy(true);try{const data=await api<{report:Report;archived:boolean}>(`/api/sessions/${id}`);const report=reportSchema.parse(data.report);setR(report);setSetup(report.settings);setDirty(false);setArchived(data.archived);setFile(null);newFile.current=null;replaceSource(data.archived?`/api/sessions/${id}/video`:"");setTab("report");setNotice(data.archived?"紀錄與原片已載入。":"紀錄已載入；回工作台重新選取相同原片即可疊圖。");}finally{setBusy(false);}}
 async function remove(id:string){setBusy(true);try{await api(`/api/sessions/${id}`,{method:"DELETE"});if(r?.id===id){setR(null);setDirty(false);setFile(null);replaceSource("");setArchived(false);}await refresh();setNotice("紀錄與備份原片已刪除。");}finally{setBusy(false);}}
 async function importJson(f:File){if(f.size>8_000_000)throw new Error("JSON上限8 MB。");const parsed=reportSchema.safeParse(JSON.parse(await f.text()));if(!parsed.success)throw new Error("JSON不是此系統支援的完整報告格式。");const report={...parsed.data,id:randomId(),version:0,created:new Date().toISOString()};setR(report);setSetup(report.settings);setFile(null);setArchived(false);replaceSource("");setDirty(true);setTab("report");setNotice("已匯入為新紀錄。請按儲存；原片需重新選取同一檔案。");}
 function snap(){if(!video.current||!ready)return;try{const url=captureFrame(video.current,frame,s,reference);setPng(url);download(new Blob([Uint8Array.from(atob(url.split(",")[1]),c=>c.charCodeAt(0))],{type:"image/png"}),`${s.date}_關鍵幀_${time.toFixed(2)}.png`);setNotice("已匯出PNG，這張圖也會加入本次HTML／列印報告。");}catch(e){setError(message(e));}}
 function exportAs(kind:"html"|"csv"|"json"){if(!r)return;download(kind==="html"?htmlReport(r,png??undefined):kind==="csv"?csvReport(r):JSON.stringify(r,null,2),`${s.date}_競走報告.${kind}`,kind==="html"?"text/html;charset=utf-8":kind==="csv"?"text/csv;charset=utf-8":"application/json");}
 actions.current={seek,save:()=>save(),start:runAnalysis,open:openReport};
 const invoke=(fn:()=>void|Promise<unknown>)=>void Promise.resolve().then(fn).catch(e=>setError(message(e)));
 async function startTool(value:typeof tool){
  const v=video.current;if(!v||locked)return;v.pause();setMode("bio");
  if(tool===value){setTool(null);return;}
  setPeopleScan(null);autoPeopleScan.current=false;
  if(value==="roi"){
   if(r&&(r.frames.length||r.events.length)&&(dirty||!r.version))await save();
   const shown=await seekVideo(v,v.currentTime);setTime(shown.t);setLiveFrame(null);
  }
  setError("");setTool(value);
 }
 return <div className="app-shell"><header className="app-header"><a className="brand" href="/" aria-label="RaceWalk Lab首頁"><span className="brand-icon"><Activity/></span><span><strong>RaceWalk <b>Lab</b></strong><small>競走動作分析</small></span></a><div className="header-right"><span className="private-label"><span className="dot"/>私人訓練工作室</span><span className="avatar">RW</span></div></header>
 <main><div className="page-heading"><div><span className="eyebrow">VIDEO ANALYSIS / PERSONAL BASELINE</span><h1>把每一步，看得更清楚。</h1><p>原片、骨架與關鍵幀放在一起，讓下一次練習有明確依據。</p></div><div className="button-row"><Button variant="outline" disabled={locked} onClick={()=>jsonInput.current?.click()}><FileJson/>匯入紀錄</Button><Button disabled={locked} onClick={()=>guarded(()=>fileInput.current?.click())}><Upload/>新增影片</Button></div></div>
 <input ref={fileInput} type="file" accept="video/mp4,video/quicktime,video/webm,.mov,.m4v" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)invoke(()=>chooseVideo(f));}}/>
 <input ref={attachInput} type="file" accept="video/*,.mov" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)invoke(()=>chooseVideo(f,true));}}/>
 <input ref={jsonInput} type="file" accept="application/json,.json" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)guarded(()=>importJson(f));}}/>
 {error&&<div role="alert" className="banner error"><span>{error}</span><Button variant="ghost" size="icon-sm" aria-label="關閉錯誤提示" onClick={()=>setError("")}><X/></Button></div>}
 {notice&&<div role="status" className="banner info"><span>{notice}</span><Button variant="ghost" size="icon-sm" aria-label="關閉提示" onClick={()=>setNotice("")}><X/></Button></div>}
 <Tabs value={tab} onValueChange={v=>{if(!locked){video.current?.pause();setTab(v);if(v==="history")void refresh();}}} className="main-tabs"><div className="nav-row"><TabsList className="app-tabs"><TabsTrigger value="work"><ScanLine/>分析工作台</TabsTrigger><TabsTrigger value="report"><FileJson/>本次報告</TabsTrigger><TabsTrigger value="history"><History/>訓練紀錄</TabsTrigger><TabsTrigger value="guide"><BookOpen/>拍攝指南</TabsTrigger></TabsList><div className="save-group"><span className="meta">{r?(saving?"儲存中…":dirty?"有未儲存修改":`已儲存 · v${r.version}`):"尚無分析紀錄"}</span><Button size="sm" disabled={!r||locked||(!dirty&&r.version>0)} variant="outline" onClick={()=>invoke(()=>save())}>{saving?<LoaderCircle className="spin"/>:<Check/>}儲存</Button></div></div>
 <TabsContent value="work" forceMount className="work-tab"><div className="workspace-grid"><aside><SettingsPanel s={s} patch={patch} locked={locked} hasFrames={hasFrames}/>{src&&<section className="mini-note" aria-label="影片幀率檢查"><div><strong>影片幀率檢查</strong><p>{probing?"正在自動檢查檔案播放幀率…":cadence===null?"未取得穩定的播放幀率，請核對原始檔資訊。":`觀測播放幀率約 ${cadence} fps；目前設定對應 ${(s.fps/s.slow).toFixed(2)} fps。`}</p><p className="meta">這是解碼播放觀測，不能自動辨識原始拍攝速度或慢放倍率。請確認慢放倍率後再套用。</p>{cadence!==null&&cadence*s.slow<=480&&<Button size="sm" variant="outline" disabled={locked||hasFrames} onClick={()=>patch({fps:Math.round(cadence*s.slow*100)/100,timingVerified:false})}>依目前慢放倍率套用</Button>}</div></section>}<section className="mini-note"><Crosshair size={19}/><p>第一次先拍無痛的Easy側面。先建立個人基準，再決定要修哪一個動作。</p></section></aside><div className="workspace-main"><section className="card video-card" ref={videoCard}><div className="section-head"><div><h2>影片與動作點線</h2><p className="meta file-name">{r?.file.name??"匯入原片，開始第一筆分析"}</p></div><div className="mode-toggle"><Button size="sm" variant={mode==="bio"?"secondary":"ghost"} disabled={locked} onClick={()=>setMode("bio")}>動作分析</Button><Button size="sm" variant={mode==="judge"?"secondary":"ghost"} disabled={locked} onClick={()=>{setTool(null);setMode("judge");}}>Judge View</Button></div></div>
 {r&&hasFrames&&<details className="inset" aria-label="自動分析診斷"><summary>自動分析診斷 · {diagnostics.length} 項</summary>{diagnostics.map((d,i)=><div key={i} className="mini-note"><div><strong>{d.title}</strong><p>{d.action}</p>{d.time!==undefined&&<Button size="sm" variant="outline" disabled={!ready||locked} onClick={()=>invoke(()=>jump(d.time!))}>回看 {timeText(d.time)}</Button>}</div></div>)}</details>}
 {focused&&Math.abs(focused.t-time)<=Math.max(.05,s.slow/s.fps)&&<div className="active-event-note"><strong>{timeText(focused.t)} · {focused.side==="L"?"左":"右"}腳 {EVENT_LABEL[focused.kind]}</strong><span>{focused.status==="confirmed"?"人工已確認":"待人工確認"} · 請核對原片鞋底與膝位置</span><div className="button-row"><Button size="sm" variant="outline" disabled={locked||!ready||focused.status==="confirmed"} onClick={()=>change(old=>({...old,events:old.events.map(e=>e.id===focused.id?{...e,status:"confirmed"}:e)}))}>{focused.status==="confirmed"?"此事件已確認":"確認此事件"}</Button><Button size="sm" variant="ghost" disabled={locked||!ready||focused.status==="rejected"} onClick={()=>change(old=>({...old,events:old.events.map(e=>e.id===focused.id?{...e,status:"rejected"}:e)}))}>排除此事件</Button></div></div>}
 {r&&<div className={`tracking-status ${!peopleScan&&!scanningPeople&&(liveFrame?.track?.state==="searching"||r.tracking?.status==="lost"||hasFrames&&!s.target)?"tracking-alert":""}`} role="status"><strong>{peopleScan?"選擇分析目標":s.target?`${busy&&liveFrame?.track?.state==="searching"?"搜尋原目標":hasAcquiredTarget(r)||liveFrame?.track?.state==="locked"?"追蹤目標":"圈選目標"} · ${s.athlete}`:"尚未鎖定選手"}</strong><span>{scanningPeople?operationStage:peopleScan?"請點選一個人物候選，或手動圈選選手。":busy&&liveFrame?(liveFrame.track?.state==="locked"?liveFrame.track?.note??"正在逐幀追蹤圈選選手；不確定的腿部點位會暫停取值。":`${liveFrame.reason??""} ${liveFrame.track?.note??""}`):trackingNotice(r)}</span></div>}
 {busy&&abort.current&&<div className="task-status"><div className="task-status-heading"><strong role="status">{operationStage||"正在分析"}</strong><span>已用 {elapsed} 秒</span></div><Progress value={progress} aria-label={scanningPeople?"人物偵測進度":"動作分析進度"}/><div className="button-row"><Button size="sm" variant="outline" onClick={()=>abort.current?.abort()}><Square/>取消{scanningPeople?"偵測":"分析"}</Button>{scanningPeople&&<Button size="sm" variant="secondary" onClick={stopPeopleForManual}><Crosshair/>停止偵測，改用手動圈選</Button>}</div><p>首次載入需要下載模型。若等待逾時會自動停止，可重試或手動圈選。</p></div>}
 {src?<VideoSurface src={src} time={time} videoRef={video} frame={frame} settings={s} width={r?.file.width??16} height={r?.file.height??9} show={overlay} reference={reference} judge={mode==="judge"} tool={tool} people={visiblePeople} onSelectPerson={id=>invoke(()=>choosePerson(id))} onPoints={markPoints} onTime={setTime} onReady={loaded} onError={()=>{setReady(false);setError("這個瀏覽器無法播放原片。請使用MP4／H.264，或以原拍攝裝置開啟。");}} onPlaying={value=>{setPlaying(value);if(value)setPeopleScan(null);}}/>:<div className="upload-zone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)guarded(()=>chooseVideo(f));}}><div className="upload-icon"><Video/></div><h3>{r?"載入相同原片，即可回看點線":"把競走影片放到這裡"}</h3><p>{r?"報告已保留；請重新選取指紋相同的原始影片。":"MP4／MOV／WebM · 每支100 MB內 · 建議10–15秒"}</p><Button disabled={locked} onClick={()=>r?attachInput.current?.click():fileInput.current?.click()}><Upload/>{r?"選取相同原片":"選擇影片"}</Button><span className="meta">骨架在此裝置分析；原片由你決定是否備份。</span></div>}
 {src&&<>{peopleScan&&<div className="people-picker"><div><strong>{peopleScan.people.length?`骨架候選 ${peopleScan.people.filter(p=>!p.review).length} 個 · 待確認區域 ${peopleScan.people.filter(p=>p.review).length} 個 · ${timeText(peopleScan.time)}`:"此畫面未找到可用人物"}</strong><p>已自動核對重複框。點選目標後只分析一位；待確認區域可能重複或誤偵測，候選編號不代表實際人數。</p>{peopleScan.limited&&<p>部分範圍人數達辨識上限，候選可能不完整。</p>}{peopleScan.warning&&<p>{peopleScan.warning}</p>}</div><div className="button-row">{peopleScan.people.some(p=>p.review)&&peopleScan.people.some(p=>!p.review)&&<Button size="sm" variant={showReviewPeople?"secondary":"outline"} aria-pressed={showReviewPeople} disabled={locked} onClick={()=>setShowReviewPeople(v=>!v)}>{showReviewPeople?"隱藏":"顯示"}待確認區域（{peopleScan.people.filter(p=>p.review).length}）</Button>}{offeredPeople.map(person=><Button key={person.id} size="sm" variant="outline" disabled={locked||!visiblePeople.length} onClick={()=>invoke(()=>choosePerson(person.id))} title={person.review}>{person.label??"候選"}</Button>)}<Button size="sm" variant="ghost" disabled={locked} onClick={()=>setPeopleScan(null)}>關閉候選框</Button></div></div>}<div className="playback-row"><Button size="icon-sm" variant="outline" disabled={!ready||locked||!!tool} aria-label={playing?"暫停":"播放"} onClick={()=>{const v=video.current;if(v){if(v.paused)invoke(()=>v.play());else v.pause();}}}>{playing?<Pause/>:<Play/>}</Button><Button size="icon-sm" variant="ghost" disabled={!ready||locked} aria-label="往前一個原始幀時間" onClick={()=>jump(Math.max(0,time-s.slow/s.fps))}><ChevronLeft/></Button><Button size="icon-sm" variant="ghost" disabled={!ready||locked} aria-label="往後一個原始幀時間" onClick={()=>jump(Math.min(r?.file.duration??0,time+s.slow/s.fps))}><ChevronRight/></Button><span className="time-code">{timeText(time)} <small>/ {timeText(r?.file.duration??0)}</small></span><div className="playback-speed"><NativeSelect aria-label="播放倍率" value={mode==="judge"&&s.timingVerified?s.slow:rate} disabled={locked||mode==="judge"&&s.timingVerified} onChange={e=>setRate(Number(e.target.value))}>{[.25,.5,1,2,4,8,16].map(v=><option key={v} value={v}>{v}×</option>)}</NativeSelect></div></div>
 <div className="video-slider"><Slider aria-label="影片時間" min={0} max={r?.file.duration||1} step={.001} value={[time]} disabled={!ready||locked} onValueChange={v=>jump(v[0])}/></div>
 <div className="overlay-toolbar"><label className="switch-field"><Switch checked={overlay} disabled={locked||mode==="judge"} onCheckedChange={setOverlay}/><span>骨架</span></label><label className="switch-field"><Switch checked={reference} disabled={locked||mode==="judge"||!nearSide(s.view)} onCheckedChange={setReference}/><span>伸膝參考線</span></label><Button variant="ghost" size="sm" disabled={!ready||locked||!s.target} onClick={single}><ScanLine/>追蹤至此幀</Button><Button variant="ghost" size="sm" disabled={!ready||locked} onClick={snap}><ImageDown/>匯出圖示</Button></div>
 {mode==="judge"?<p className="helper inset">{s.timingVerified?`目前以檔案${s.slow}×還原正常速度，僅依肉眼觀察填寫。`:"時間基準尚未確認；請先在左側核對原始fps與慢放倍率。"}</p>:<><div className="live-metrics"><KneeReadout frame={frame} side="L" width={r?.file.width??0} height={r?.file.height??0} settings={s}/><KneeReadout frame={frame} side="R" width={r?.file.width??0} height={r?.file.height??0} settings={s}/><div><span>{nearSide(s.view)?"軀幹投影傾角":"左右髖連線傾角"}</span><strong>{frame&&r?fmt(nearSide(s.view)?torso(frame,r.file.width,r.file.height):pelvicTilt(frame,r.file.width,r.file.height,s.view)):"—"}</strong></div></div><p className="helper inset">{peopleScan?"目前是人物候選，選定一位後才開始量測。":frame?.reason??frame?.track?.note??(frame?`${frame.manual?"含人工標點":"AI點位"} · ${frame.exact?"已取得解碼影格時間":"近似定位，未取得精確影格時間"}`:"此時間沒有對齊的目標骨架，請追蹤至此幀或跳到已分析幀。")}{reference&&` ${referenceHint}`}</p></>}
 <div className="annotation-tools"><Button size="sm" variant="secondary" disabled={!ready||locked} onClick={()=>invoke(scanPeople)}><ScanLine/>偵測畫面所有人物</Button><Button size="sm" variant={tool==="roi"?"secondary":"outline"} disabled={!ready||locked} onClick={()=>invoke(()=>startTool("roi"))}><Crosshair/>{hasFrames?"重新圈選・新片段":"圈選一位選手"}</Button><Button size="sm" variant={tool==="ground"?"secondary":"outline"} disabled={!ready||locked||!nearSide(s.view)} onClick={()=>invoke(()=>startTool("ground"))}>標記地面</Button><Button size="sm" variant={tool==="manual"?"secondary":"outline"} disabled={!ready||locked||!nearSide(s.view)} onClick={()=>invoke(()=>startTool("manual"))}>人工三點量角</Button>{tool&&<Button size="sm" variant="ghost" onClick={()=>setTool(null)}>取消標記</Button>}{!hasFrames&&(s.roi||s.ground)&&<Button variant="ghost" size="sm" disabled={locked} onClick={()=>{patch({roi:null,target:undefined,ground:null});change(old=>({...old,tracking:undefined,complete:false}));}}>清除範圍／地面</Button>}</div>
 <div className="analysis-controls"><div className="trim-fields"><Field label="起點（影片秒）"><Input type="number" min={0} max={r?.file.duration} step={.01} value={s.start} disabled={locked||hasFrames||!!s.target} onChange={e=>patch({start:Number(e.target.value)})}/></Field><Field label="終點（影片秒）"><Input type="number" min={0} max={r?.file.duration} step={.01} value={s.end} disabled={locked||hasFrames} onChange={e=>patch({end:Number(e.target.value)})}/></Field></div><div className="analysis-actions">{busy&&abort.current?<Button variant="outline" onClick={()=>abort.current?.abort()}><Square/>{scanningPeople?"停止人物偵測":"停止分析"}</Button>:<Button disabled={!ready||locked||!s.target||!!peopleScan} onClick={()=>hasFrames?setConfirm({title:"重新分析這個區間？",description:"將重新產生點位與候選事件，取代本次人工標點和複查結果。若要保留，請先匯出JSON。",action:"重新分析",run:()=>runAnalysis()}):invoke(runAnalysis)}><ScanLine/>開始追蹤分析</Button>}<span className="meta">約 {Math.max(0,Math.ceil((s.end-s.start)*Math.min(s.fps,s.sampleFps)/s.slow))} 格 · 上限3000格</span></div></div>
 {busy&&<div className="analysis-progress"><Progress value={progress}/><span role="status">{abort.current?`${scanningPeople?"人物偵測":"分析"} ${progress}% · 請保持分頁開啟`:"處理中…"}</span></div>}
 {r&&hasFrames&&<div className="review-status"><span>已掃描 {r.frames.length} 格 · 搜尋缺值 {r.frames.filter(f=>f.track?.state==="searching").length} 格 · 待確認 {summary?.pending} 個事件</span><Button size="sm" variant="ghost" disabled={locked} onClick={()=>setConfirm({title:"清除本次分析？",description:"清除骨架、候選與人工複查，保留影片及拍攝資料，之後可更改取樣設定重算。",action:"清除分析",run:()=>{change(old=>({...old,frames:[],events:[],tracking:undefined,complete:false,judge:{contact:"pending",left:"pending",right:"pending"}}));setLiveFrame(null);}})}>清除後調整設定</Button></div>}
 {r&&<div className="original-backup"><span className="meta">原片：{archived?"已備份，可跨裝置重看":"目前只在此裝置"}</span><Button size="sm" variant="outline" disabled={!file||locked||archived} onClick={()=>invoke(archive)}><CloudUpload/>{archived?"已備份":"備份原片"}</Button></div>}</>}
 </section>
 {r&&<><section className="card" aria-label="自動分析狀態"><div className="section-head"><h3>AI 自動動作分析</h3><span className="pill">{hasFrames?`${r.frames.length} 格已掃描`:"尚未產生分析結果"}</span></div><p className="helper">選定一位選手後，自動追蹤並計算可辨識的左右膝角與候選事件。無須先填人工複查。</p>{analysisFailure&&<p role="alert">自動分析未完成：{analysisFailure}</p>}{!hasFrames&&<p>{busy?operationStage:!ready?"請先載入這筆紀錄的原始影片。":!s.target?"請在影片圈選一位選手，或點選偵測到的人物；選定後立即開始。":analysisFailure?"尚未取得分析幀，這不代表動作正常。排除上述原因後可重試。":"已選定目標，可以開始自動分析。"}</p>}{!hasFrames&&<Button disabled={!ready||locked} onClick={()=>invoke(s.target?runAnalysis:()=>startTool("roi"))}>{busy?"正在處理…":s.target?"啟動自動分析":"圈選選手並自動分析"}</Button>}<p className="meta">點位遮擋或身分不確定的影格保留未知；分析持續搜尋原選手。</p></section><section className="card"><details><summary>正常速度人工複查（選用，不影響 AI 分析）</summary><JudgePanel r={r} disabled={locked||!s.timingVerified||mode!=="judge"||!ready} change={(key,value)=>change(old=>({...old,judge:{...old.judge,[key]:value}}))}/>{mode!=="judge"&&<p className="meta">切換影片右上方Judge View，再填寫人工觀察。</p>}</details></section><section className="card"><MotionPlots canMarkGround={ready} report={r} time={time} onSeek={jump} onReview={review} onSettings={patch} onGround={()=>invoke(async()=>{await startTool("ground");videoCard.current?.scrollIntoView({behavior:"smooth",block:"start"});})} disabled={locked}/><QualityPanel report={r} onSeek={review} disabled={!ready||locked} unavailableReason={!ready?"請先載入這筆紀錄的原片，才能查看影格。":locked?"目前正在處理資料，完成後即可查看影格。":undefined}/><div className="row-between"><Button variant="ghost" size="sm" disabled={!ready||locked||!r.frames.length} onClick={()=>{const next=r.frames.find(f=>f.t>time+.001)??r.frames[0];jump(next.t);}}>下一個分析幀<ChevronRight/></Button></div></section>
 <section className="card"><div className="section-head"><h3>在目前畫面新增事件</h3><span className="meta">{timeText(time)}</span></div><div className="manual-event"><NativeSelect aria-label="事件腳側" value={eventSide} disabled={locked} onChange={e=>setEventSide(e.target.value as Side)}><option value="L">左腳</option><option value="R">右腳</option></NativeSelect><NativeSelect aria-label="事件階段" value={eventKind} disabled={locked} onChange={e=>setEventKind(e.target.value as EventKind)}>{Object.entries(EVENT_LABEL).map(([v,l])=><option key={v} value={v}>{l}</option>)}</NativeSelect><Input aria-label="事件備註" value={eventNote} disabled={locked} onChange={e=>setEventNote(e.target.value)} maxLength={500} placeholder="原片看到什麼？"/><Button disabled={!ready||locked} variant="outline" onClick={addEvent}><Plus/>新增</Button></div></section><EventList r={r} disabled={locked} onSeek={review} onChange={(id,p)=>change(old=>({...old,events:old.events.map(e=>e.id===id?{...e,...p}:e)}))} onDelete={id=>change(old=>({...old,events:old.events.filter(e=>e.id!==id)}))}/></>}
 </div></div></TabsContent>
 <TabsContent value="report">{r?<fieldset disabled={locked}><ReportPanel r={r} png={png} notes={v=>change(old=>({...old,notes:v}))} reviewer={v=>patch({reviewer:v})} onExport={exportAs} onPrint={()=>window.print()}/></fieldset>:<section className="card empty-large"><FileJson size={38}/><h2>報告會從真實影片開始</h2><p>先匯入影片並分析；未量測的項目會保留空白。</p><Button onClick={()=>setTab("work")}>前往工作台</Button></section>}</TabsContent>
 <TabsContent value="history"><HistoryPanel rows={history} loading={loadingHistory} onRefresh={()=>void refresh()} onOpen={id=>guarded(()=>openReport(id))} onDelete={id=>{if(!locked)setConfirm({title:"刪除這筆訓練紀錄？",description:"會刪除這筆紀錄的報告、歷次儲存與已備份原片。請先匯出需要保留的資料。",action:"刪除紀錄與備份",run:()=>remove(id)});}}/></TabsContent><TabsContent value="guide"><GuidePanel/></TabsContent>
 </Tabs><footer className="app-footer"><span>RACEWALK LAB · 以個人基準追蹤每一步</span><span>AI篩查與教練複查並行 · 非正式裁判判決</span></footer></main>
 <AlertDialog open={!!confirm} onOpenChange={open=>{if(!open)setConfirm(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm?.title}</AlertDialogTitle><AlertDialogDescription>{confirm?.description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={()=>{const run=confirm?.run;setConfirm(null);if(run)invoke(run);}}>{confirm?.action}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </div>;
}
