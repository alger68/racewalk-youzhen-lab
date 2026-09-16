"use client";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { nearSide, validPoint, timeText, trackingBox, type Point, type PoseFrame, type Settings, type Side } from "@/lib/racewalk";
import { observeKnee, observationRole } from "@/lib/inspection";
import { kneeSensitivity } from "@/lib/measurement-math";
import type { PersonChoice } from "@/lib/people";

const LINKS=[[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32]];
const left=new Set([11,13,15,17,19,21,23,25,27,29,31]);
export function drawOverlay(ctx:CanvasRenderingContext2D,w:number,h:number,f:PoseFrame|null,s:Settings,show:boolean,reference:boolean,time=f?.t??0){
 const p=f?.points??[]; const line=Math.max(2,w/380),font=Math.max(15,w/48);
 const segment=(a:Point,b:Point,color:string,dash=false)=>{ctx.strokeStyle=color;ctx.lineWidth=line;ctx.setLineDash(dash?[line*3,line*2]:[]);ctx.beginPath();ctx.moveTo(a.x*w,a.y*h);ctx.lineTo(b.x*w,b.y*h);ctx.stroke();ctx.setLineDash([]);};
 const tracked=trackingBox(f,s,time);
 if(tracked){const [a,b]=tracked.box,lost=tracked.warning;
  ctx.strokeStyle=lost?"#ffbb50":"#65f5cc";ctx.lineWidth=line;ctx.setLineDash(tracked.dashed?[8,6]:[]);
  ctx.strokeRect(Math.min(a.x,b.x)*w,Math.min(a.y,b.y)*h,Math.abs(a.x-b.x)*w,Math.abs(a.y-b.y)*h);ctx.setLineDash([]);
  const text=tracked.label,fontSize=Math.max(14,w/65);
  ctx.font=`600 ${fontSize}px Arial, sans-serif`;const tw=ctx.measureText(text).width;
  const x=Math.max(5,Math.min(w-tw-12,Math.min(a.x,b.x)*w)),y=Math.max(fontSize+8,Math.min(a.y,b.y)*h-7);
  ctx.fillStyle="#132033ed";ctx.fillRect(x-4,y-fontSize-4,tw+8,fontSize+10);ctx.fillStyle=lost?"#ffce88":"#9affe2";ctx.fillText(text,x,y);
 }
 if(s.ground)segment(s.ground[0],s.ground[1],"#56e2b2",true);
 if(!f||f.reason||f.track?.state==="searching"||f.track?.state==="lost")return;
 const near=nearSide(s.view);
 if(reference&&near&&!f.track?.withheld?.[near]){const i=near==="L"?23:24;if(validPoint(p[i])&&validPoint(p[i+4]))segment(p[i],p[i+4],"#e3a9ff",true);}
 if(!show)return;
 for(const [a,b] of LINKS)if(validPoint(p[a])&&validPoint(p[b]))segment(p[a],p[b],left.has(a)&&left.has(b)?"#5984ff":!left.has(a)&&!left.has(b)?"#ff974e":"#edf4ff");
 for(const i of new Set(LINKS.flat()))if(validPoint(p[i])){ctx.beginPath();ctx.arc(p[i].x*w,p[i].y*h,line*1.8,0,Math.PI*2);ctx.fillStyle=left.has(i)?"#5984ff":"#ff974e";ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=line*.55;ctx.stroke();}


}
export function KneeReadout({frame,side,width,height,settings}:{frame:PoseFrame|null;side:Side;width:number;height:number;settings:Settings}){
 const obs=observeKnee(frame,side,width,height,settings.view);
 const ids=side==="L"?[23,25,27]:[24,26,28],verified=frame?.track?.verification&&ids.every(i=>frame.track!.verification!.compared.includes(i));
 const sensitivity=useMemo(()=>kneeSensitivity(frame,side,width,height,settings),[frame,side,width,height,settings.uncertaintyEnabled,settings.pointSigmaPx,settings.view]);
 return <div className="knee-readout"><span><i className={`dot ${side==="L"?"left-dot":"right-dot"}`}/>{side==="L"?"左膝":"右膝"}</span><strong>{obs.value===null?"—":`${obs.value.toFixed(1)}°`}</strong><small className={obs.role==="reference"?"reference-note":""}>{observationRole(obs.role)}</small>{obs.value!==null&&<small>{verified?"已經第二模型複核":frame?.manual?"含人工標點":"單一模型估計"}</small>}{sensitivity&&<small className="angle-sensitivity">95% 模擬範圍 {sensitivity.low.toFixed(1)}–{sensitivity.high.toFixed(1)}°<br/>假設 σ={sensitivity.sigma} px；尚未校準</small>}{obs.reason&&<small>{obs.reason}</small>}</div>;
}
type Props={src:string;time:number;videoRef:RefObject<HTMLVideoElement|null>;frame:PoseFrame|null;settings:Settings;width:number;height:number;show:boolean;reference:boolean;judge:boolean;tool:"ground"|"roi"|"manual"|null;people:PersonChoice[];onSelectPerson:(id:string)=>void;onPoints:(points:Point[])=>void;onTime:(t:number)=>void;onReady:()=>void;onError:()=>void;onPlaying:(b:boolean)=>void};
export function VideoSurface({src,time,videoRef,frame,settings,width,height,show,reference,judge,tool,people,onSelectPerson,onPoints,onTime,onReady,onError,onPlaying}:Props){
 const canvas=useRef<HTMLCanvasElement>(null),clicks=useRef<Point[]>([]),down=useRef<Point|null>(null);
 const [preview,setPreview]=useState<[Point,Point]|null>(null);
 useEffect(()=>{const v=videoRef.current;if(!v)return;let id=0,active=true;
  if(v.requestVideoFrameCallback){const tick=(_now:number,meta:VideoFrameCallbackMetadata)=>{if(!active)return;onTime(meta.mediaTime);id=v.requestVideoFrameCallback(tick);};id=v.requestVideoFrameCallback(tick);return()=>{active=false;v.cancelVideoFrameCallback(id);};}
  const tick=()=>{if(!v.paused)onTime(v.currentTime);id=requestAnimationFrame(tick);};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);
 },[src,videoRef,onTime]);
 useEffect(()=>{clicks.current=[];down.current=null;setPreview(null);},[tool]);
 useEffect(()=>{const c=canvas.current;if(!c)return;const ctx=c.getContext("2d");if(!ctx)return;c.width=width;c.height=height;ctx.clearRect(0,0,width,height);if(!judge&&!people.length)drawOverlay(ctx,width,height,frame,settings,show,reference,time);
  if(preview){const [a,b]=preview;ctx.fillStyle="#6de7c820";ctx.strokeStyle="#9affe2";ctx.lineWidth=Math.max(2,width/380);ctx.fillRect(a.x*width,a.y*height,(b.x-a.x)*width,(b.y-a.y)*height);ctx.strokeRect(a.x*width,a.y*height,(b.x-a.x)*width,(b.y-a.y)*height);}
 },[frame,settings,width,height,show,reference,judge,time,preview,people.length]);
 function position(e:React.PointerEvent<HTMLCanvasElement>):Point {const b=e.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(e.clientY-b.top)/b.height)),v:1};}
 function addPoint(p:Point){clicks.current.push(p);const ctx=canvas.current?.getContext("2d");if(ctx){ctx.fillStyle="#ddadff";ctx.beginPath();ctx.arc(p.x*width,p.y*height,Math.max(5,width/150),0,Math.PI*2);ctx.fill();}if(clicks.current.length===(tool==="manual"?3:2)){onPoints([...clicks.current]);clicks.current=[];setPreview(null);}}
 return <div className={`video-stage ${tool?"is-marking":""}`} style={{aspectRatio:`${width}/${height}`}}>
  <video ref={videoRef} src={src} playsInline muted preload="auto" onLoadedMetadata={onReady} onTimeUpdate={e=>onTime(e.currentTarget.currentTime)} onSeeked={e=>onTime(e.currentTarget.currentTime)} onPlay={()=>onPlaying(true)} onPause={()=>onPlaying(false)} onEnded={()=>onPlaying(false)} onError={onError}/>
  <canvas ref={canvas} aria-label="影片上的骨架量測點線" onPointerDown={e=>{if(!tool)return;const p=position(e);if(tool==="roi"){down.current=p;e.currentTarget.setPointerCapture(e.pointerId);}else addPoint(p);}}
   onPointerMove={e=>{if(tool!=="roi")return;const first=down.current??clicks.current[0];if(first)setPreview([first,position(e)]);}}
   onPointerUp={e=>{if(tool!=="roi"||!down.current)return;const a=down.current,b=position(e);down.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    if(Math.hypot((a.x-b.x)*width,(a.y-b.y)*height)>12){clicks.current=[];setPreview(null);onPoints([a,b]);}else addPoint(b);}}
   onPointerCancel={()=>{down.current=null;clicks.current=[];setPreview(null);}}/>

  {!judge&&!tool&&people.length>0&&<div className="people-overlay" aria-label="本畫面的人物候選，請選擇一位">
   <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">{people.map(person=><g key={person.id} stroke="#eef4ff" strokeOpacity=".75" strokeWidth={Math.max(2,width/550)}>{LINKS.filter(([a,b])=>validPoint(person.points[a])&&validPoint(person.points[b])).map(([a,b])=><line key={`${a}-${b}`} x1={person.points[a].x*width} y1={person.points[a].y*height} x2={person.points[b].x*width} y2={person.points[b].y*height}/>)}</g>)}</svg>
   {people.map((person,i)=><button type="button" key={person.id} className={`person-choice-box${person.review?" person-choice-review":""}`} title={person.review} aria-label={`選擇${person.label??"候選"}為追蹤目標`} style={{left:`${person.box[0].x*100}%`,top:`${person.box[0].y*100}%`,width:`${(person.box[1].x-person.box[0].x)*100}%`,height:`${(person.box[1].y-person.box[0].y)*100}%`}} onClick={()=>onSelectPerson(person.id)}><span>{person.label??"候選"}</span></button>)}
  </div>}
  <div className="video-chip">{judge?"JUDGE VIEW · 原片":people.length?"人物候選 · 尚未量測":"BIOMECHANICS · 二維估計"}</div>
  {tool&&<div className="mark-hint">{tool==="ground"?"依序點地面上的左、右兩點":tool==="roi"?"拖曳框住此刻的一位選手全身，也可依序點左上、右下角":"依序點近側的髖 → 膝 → 踝"}</div>}
 </div>;
}
export function captureFrame(video:HTMLVideoElement,f:PoseFrame|null,s:Settings,reference:boolean){
 const c=document.createElement("canvas");c.width=video.videoWidth;c.height=video.videoHeight+112;const ctx=c.getContext("2d");if(!ctx||!c.width)throw new Error("請先載入原片。");
 ctx.drawImage(video,0,0,c.width,video.videoHeight);drawOverlay(ctx,c.width,video.videoHeight,f,s,true,reference,video.currentTime);
 ctx.fillStyle="#132033";ctx.fillRect(0,video.videoHeight,c.width,112);
 const values=(["L","R"] as Side[]).map(side=>{const o=observeKnee(f,side,c.width,video.videoHeight,s.view);return `${side==="L"?"左膝":"右膝"} ${o.value===null?"無法判讀":o.value.toFixed(1)+"°"} ${o.role==="reference"?"遠側參考":""}`;});
 ctx.font=`600 ${Math.max(14,c.width/55)}px Arial, sans-serif`;ctx.fillStyle="#b1c5ff";ctx.fillText(values[0],18,video.videoHeight+28);ctx.fillStyle="#ffc49a";ctx.fillText(values[1],c.width/2,video.videoHeight+28);
 ctx.fillStyle="#fff";ctx.font=`${Math.max(13,c.width/75)}px Arial, sans-serif`;
 ctx.fillText(`${s.athlete} | ${s.date} | ${timeText(video.currentTime)} | ${f?.track?.state==="locked"?"目標追蹤幀":f?.track?.state==="searching"?"搜尋／核對中・未取值":f?.track?.state==="lost"&&f.track.box?"處理未完成":"未鎖定／未取值"}${f?.manual?"・人工標點":""}`,18,video.videoHeight+59);
 ctx.font=`${Math.max(12,c.width/90)}px Arial, sans-serif`;ctx.fillText("藍：左  橘：右  遠側角度僅參考  紫色虛線：伸膝參考軸（非矯正後動作）",18,video.videoHeight+89);return c.toDataURL("image/png");
}
