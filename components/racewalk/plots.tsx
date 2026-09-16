"use client";
import { useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { kneeWindows, nearSide, timeText, EVENT_LABEL, type Report, type Side, type Settings } from "@/lib/racewalk";
import { bilateralInspection, angleSegments, missingIntervals, trackingIntervals, samplingStep } from "@/lib/inspection";
import { smoothAngles } from "@/lib/measurement-math";
import { ContactPanel } from "./contact-panel";

const LEFT = 72, RIGHT = 750, TOP = 30, BOTTOM = 200;
const sideName = (side:Side) => side === "L" ? "左" : "右";
export function MotionPlots({ report:r, time, onSeek, onReview, onSettings, onGround, canMarkGround=true, disabled=false }: {report:Report;time:number;onSeek:(t:number)=>void;onReview:(t:number,id?:string)=>void;onSettings:(p:Partial<Settings>)=>void;onGround:()=>void;disabled?:boolean;canMarkGround?:boolean}) {
  const [showLeft,setShowLeft]=useState(true),[showRight,setShowRight]=useState(true),[selected,setSelected]=useState<string|null>(null);
  const s=r.settings, near=nearSide(s.view), span=Math.max(.001,s.end-s.start), step=samplingStep(s);
  const x=(t:number)=>LEFT+(t-s.start)/span*(RIGHT-LEFT);
  const data=useMemo(()=>{
    const sides=bilateralInspection(r);
    return sides.map(side=>({...side, segments:angleSegments(side.samples,samplingStep(r.settings)*1.75),
      gaps:missingIntervals(side.samples,r.settings.start,r.settings.end,samplingStep(r.settings)),
      smoothSegments:r.settings.smoothAngles?angleSegments(smoothAngles(side.samples,r.settings),samplingStep(r.settings)*1.75):[]}));
  },[r]);
  const visible=data.filter(d=>d.side==="L"?showLeft:showRight);
  const values=visible.flatMap(d=>d.samples.flatMap(p=>p.value===null?[]:[p.value]));
  const minimum=Math.max(0,Math.min(90,Math.floor((values.length?Math.min(...values):90)/30)*30));
  const y=(v:number)=>TOP+(180-v)/(180-minimum)*(BOTTOM-TOP);
  const ticks=[...new Set([minimum,...[0,30,60,90,120,150,170,180].filter(v=>v>=minimum)])].sort((a,b)=>b-a);
  const windows=useMemo(()=>kneeWindows(r),[r]);
  const tracking=useMemo(()=>trackingIntervals(r),[r]);
  const events=useMemo(()=>r.events.filter(e=>e.status!=="rejected"&&e.t>=r.settings.start&&e.t<=r.settings.end).sort((a,b)=>a.t-b.t),[r]);
  const chosen=events.find(e=>e.id===selected);
  const primary=data.find(d=>d.side===near);
  const at=Math.max(s.start,Math.min(s.end,time));
  const seekFromX=(clientX:number,rect:DOMRect)=>{if(disabled)return;const t=s.start+((clientX-rect.left)/rect.width*780-LEFT)/(RIGHT-LEFT)*span;onSeek(Math.max(s.start,Math.min(s.end,t)));};
  const selectEvent=(id:string,t:number)=>{if(disabled)return;setSelected(id);onReview(t,id);};
  return <div className="motion-plots upgraded-timeline">
    <div className="section-head"><h3>左右膝角與事件時間軸</h3><span className="meta">影片時間 {timeText(s.start)}—{timeText(s.end)}</span></div>
    <div className="timeline-legend">
      {(["L","R"] as Side[]).map(side=><label className="switch-field" key={side}><Switch checked={side==="L"?showLeft:showRight} onCheckedChange={side==="L"?setShowLeft:setShowRight}/><span><i className={`dot ${side==="L"?"left-dot":"right-dot"}`}/>{sideName(side)}膝 {!near?"此鏡位不量角":near===side?"實線・近側":"虛線・遠側參考"}</span></label>)}
    </div>
    <p className="helper">實線是近側二維量測，虛線是遠側參考；遠側角度不納入伸膝窗口摘要。遮擋或點位不足時保留空白。</p>
    {s.smoothAngles&&<p className="helper">淡線保留原始角度，深線為平滑趨勢；平滑會有延遲，查看短暫屈膝請以原始角度與影片為準。</p>}
    {s.target&&<div className="contact-timeline">
      <h4>同一選手追蹤狀態</h4>
      <div className="timed-contact-row"><span>身分</span><svg viewBox="0 0 780 25" preserveAspectRatio="none" role="img" aria-label="綠色為身分已確認，黃色為搜尋或核對中，灰色未掃描" onClick={e=>seekFromX(e.clientX,e.currentTarget.getBoundingClientRect())}>
        <rect x={LEFT} y="4" width={RIGHT-LEFT} height="17" rx="3" fill="#dce2eb"/>
        {tracking.map((g,i)=><rect key={i} x={x(g.start)} y="4" width={Math.max(.25,x(g.end)-x(g.start))} height="17" fill={g.state==="locked"?"#358c78":g.state==="searching"?"#e0a537":"#b95050"}><title>{timeText(g.start)}—{timeText(g.end)} {g.state==="locked"?"身分已確認；關節仍需品質檢查":g.state==="searching"?"搜尋／核對中・不取值":"處理未完成"}</title></rect>)}
      </svg></div>
      <p className="helper">綠色：身分已確認；黃色：持續搜尋／核對、不取值；灰色：未掃描。身分確認後，左右腿仍各自檢查點位品質。點色帶可回看原片。</p>
    </div>}
    <div className="timeline-chart">
      <svg viewBox="0 0 780 318" aria-label="左右膝角及事件，以影片秒數定位；方向鍵移動時間" role="group" tabIndex={disabled?-1:0} aria-disabled={disabled}
        onClick={e=>seekFromX(e.clientX,e.currentTarget.getBoundingClientRect())}
        onKeyDown={e=>{if(disabled||e.target!==e.currentTarget)return;if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();onSeek(Math.max(s.start,Math.min(s.end,at+(e.key==="ArrowRight"?step:-step))));}}}>
        {primary?.gaps.map((g,i)=><rect key={`gap-${i}`} x={x(g.start)} y={TOP} width={Math.max(0,x(g.end)-x(g.start))} height={BOTTOM-TOP} fill="#f1f3f7"><title>近側沒有可用角度：{timeText(g.start)}—{timeText(g.end)}</title></rect>)}
        {windows.filter(w=>w.side===near&&w.end>=s.start&&w.start<=s.end).map((w,i)=><rect key={`window-${i}`} x={x(Math.max(s.start,w.start))} y={TOP} width={Math.max(0,x(Math.min(s.end,w.end))-x(Math.max(s.start,w.start)))} height={BOTTOM-TOP} fill="#dcebee" opacity=".65"><title>已人工確認的{sideName(w.side)}腳 IC→Vertical 窗口</title></rect>)}
        {ticks.map(a=><g key={a}><line x1={LEFT} x2={RIGHT} y1={y(a)} y2={y(a)} stroke={a===170?"#b88632":"#dfe5ef"} strokeDasharray={a===170?"5 5":undefined}/><text x="8" y={y(a)+5} fontSize="14" fill="#59677a">{a}°</text></g>)}
        {visible.map(d=><g key={d.side} opacity={s.smoothAngles ? .4 : 1}>{d.segments.map((segment,i)=>segment.length===1?<circle key={i} cx={x(segment[0].t)} cy={y(segment[0].value)} r="2.5" fill={d.side==="L"?"#315ed9":"#c86024"}/>:<path key={i} d={segment.map((p,j)=>`${j?"L":"M"}${x(p.t).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ")} fill="none" stroke={d.side==="L"?"#315ed9":"#c86024"} strokeWidth={d.role==="near"?2.6:2} strokeDasharray={d.role==="reference"?"6 5":undefined}/>)}</g>)}
        {visible.map(d=><g key={`smooth-${d.side}`}>{d.smoothSegments.filter(v=>v.length>1).map((segment,i)=><path key={i} d={segment.map((p,j)=>`${j?"L":"M"}${x(p.t).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ")} fill="none" stroke={d.side==="L"?"#315ed9":"#c86024"} strokeWidth="2.6" strokeDasharray={d.role==="reference"?"6 5":undefined}/>)}</g>)}
        {!values.length&&<text x="404" y="119" textAnchor="middle" fontSize="15" fill="#59677a">{!near?"此鏡位不估計矢狀面膝角":!showLeft&&!showRight?"請開啟至少一側曲線":r.frames.length?"目前沒有可用膝角，請查看下方缺值原因":"分析後顯示左右可用角度"}</text>}
        {Array.from({length:6},(_,i)=>{const t=s.start+span*i/5;return <g key={i}><line x1={x(t)} x2={x(t)} y1={BOTTOM} y2={BOTTOM+5} stroke="#8998ad"/><text x={x(t)} y="224" textAnchor={i===0?"start":i===5?"end":"middle"} fontSize="14" fill="#59677a">{t.toFixed(span<2?2:1)}s</text></g>;})}
        {(["L","R"] as Side[]).map((side,i)=><g key={side}><text x="7" y={256+i*29} fontSize="14" fill="#59677a">{sideName(side)}事件</text><line x1={LEFT} x2={RIGHT} y1={251+i*29} y2={251+i*29} stroke="#e2e7f0"/>{events.filter(e=>e.side===side).map(e=><g key={e.id} role="button" tabIndex={disabled?-1:0} aria-label={`${timeText(e.t)} ${sideName(side)}腳 ${EVENT_LABEL[e.kind]} ${e.status==="confirmed"?"已確認":"待確認"}`} className="timeline-event" onClick={ev=>{ev.stopPropagation();selectEvent(e.id,e.t);}} onKeyDown={ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();ev.stopPropagation();selectEvent(e.id,e.t);}}}><title>{timeText(e.t)} {sideName(side)}腳 {EVENT_LABEL[e.kind]} · {e.status==="confirmed"?"已確認":"待確認"}</title><circle cx={x(e.t)} cy={251+i*29} r="10" fill="transparent"/><circle cx={x(e.t)} cy={251+i*29} r={e.id===selected?6:4.5} fill={e.status==="confirmed"?"#267566":"#bb841c"} stroke={e.id===selected?"#203651":"#fff"} strokeWidth="1.3"/></g>)}</g>)}
        <line x1={x(at)} x2={x(at)} y1="22" y2="292" stroke="#14243b" strokeWidth="1.3" pointerEvents="none"/>
      </svg>
    </div>
    <div className="timeline-key"><span><i className="key-box missing"/> 灰底：近側資料不足</span><span><i className="key-box reviewed"/> 淡青：已確認 IC→Vertical</span><span><i className="dot" style={{background:"#bb841c"}}/> 待確認事件</span><span><i className="dot" style={{background:"#267566"}}/> 已確認事件</span></div>
    <p className="helper">170°線僅為未校準的複查提示；擺動期屈膝不以此線判讀。黃點是事件候選，不是犯規。</p>
    {chosen&&<div className="selected-event"><span><strong>{timeText(chosen.t)} · {sideName(chosen.side)}腳 {EVENT_LABEL[chosen.kind]}</strong><small>{chosen.status==="confirmed"?"人工已確認":"尚待人工確認"} · {chosen.note}</small></span><Button size="sm" variant="outline" disabled={disabled} onClick={()=>onReview(chosen.t,chosen.id)}>回原片查看</Button></div>}
    <ContactPanel canMarkGround={canMarkGround} report={r} onSeek={onSeek} onSettings={onSettings} onGround={onGround} disabled={disabled}/>
  </div>;
}
