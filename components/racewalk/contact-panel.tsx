"use client";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { contactAnalysis, contactBands, contactPrerequisites, CONTACT_REASON } from "@/lib/contact-analysis";
import { nearSide, timeText, type Report, type Settings } from "@/lib/racewalk";

export function ContactPanel({report:r,onSeek,onSettings,onGround,disabled=false,canMarkGround=true}:{report:Report;onSeek:(t:number)=>void;onSettings:(p:Partial<Settings>)=>void;onGround:()=>void;disabled?:boolean;canMarkGround?:boolean}) {
  const s=r.settings, span=Math.max(.001,s.end-s.start), x=(t:number)=>72+(t-s.start)/span*678;
  const data=useMemo(()=>contactAnalysis(r.frames,s,r.file).map(d=>({...d,bands:contactBands(d.samples,s)})),[r]);
  const blockers=contactPrerequisites(s), sampleCount=data[0].samples.length;
  const measured=data.reduce((n,d)=>n+d.counts.contact+d.counts.air,0);
  const seek=(clientX:number,rect:DOMRect)=>{if(!disabled)onSeek(Math.max(s.start,Math.min(s.end,s.start+((clientX-rect.left)/rect.width*780-72)/678*span)));};
  return <section className="contact-timeline contact-analysis" aria-label="雙腳接觸分析結果">
    <div className="section-head"><h4>雙腳接觸候選・前後幀核對</h4><Button size="sm" variant="outline" disabled={disabled||!canMarkGround||!nearSide(s.view)} onClick={onGround}>{s.ground?"重標地面":"標記地面"}</Button></div>
    <p className="meta">{r.file.name} · {timeText(s.start)}—{timeText(s.end)} · 本區間 {sampleCount} 格</p>
    <div className="contact-setup" role="status"><strong>{!r.frames.length?"尚未取得骨架資料":!sampleCount?"所選區間沒有分析幀":blockers.length?`已取得 ${sampleCount} 格骨架；接觸條件尚未完成`:!measured?`已檢查 ${sampleCount} 格；足部接觸證據仍不足`:`已完成接觸候選計算，共 ${sampleCount} 格`}</strong><p>{!sampleCount?"請先完成這個區間的追蹤分析。":blockers.length?"左右膝角仍可查看。以下未知格數保留所有取樣；完成必要設定後，會直接用已存骨架重新計算，不必重跑人物辨識。":"未知表示無法判斷，不表示腳已接地或動作正常。"}</p></div>
    {!canMarkGround&&<p className="helper">已存骨架與統計可直接查看；標記地面或回看影格前，請先載入這筆紀錄的相同原片。</p>}
    <div className="contact-checks">
      <label className="switch-field"><Switch checked={s.clearFeet} disabled={disabled} onCheckedChange={v=>onSettings({clearFeet:v})}/><span>已確認兩腳鞋底與地面清楚</span></label>
      <label className="switch-field"><Switch checked={s.groundStable??false} disabled={disabled||!s.ground} onCheckedChange={v=>onSettings({groundStable:v})}/><span>鏡頭固定，地面線在整段區間都適用</span></label>
      <label className="switch-field"><Switch checked={s.timingVerified} disabled={disabled} onCheckedChange={v=>onSettings({timingVerified:v})}/><span>已核對原片時間：{s.fps} fps、慢放 {s.slow} 倍</span></label>
      <p className="helper">只有與原片一致才勾選；數值不對時，到「時間與取樣設定」調整並重算。</p>
    </div>
    {blockers.length>0&&<div className="contact-setup" role="status"><strong>接觸分析尚缺：</strong><ul>{blockers.map(code=><li key={code}>{CONTACT_REASON[code]}</li>)}</ul><p>鏡頭追拍、轉彎換道或地面線偏離時，保留未知；可用原片逐幀標記接地／離地事件。</p></div>}
    {sampleCount>0&&data.map(d=><div className="contact-side" key={d.side}>
      <div className="timed-contact-row"><span>{d.side==="L"?"左":"右"}腳</span><svg viewBox="0 0 780 25" preserveAspectRatio="none" role="img" aria-label={`${d.side==="L"?"左":"右"}腳接觸候選，灰色區段可點選複查`} onClick={e=>seek(e.clientX,e.currentTarget.getBoundingClientRect())}>
        <rect x="72" y="4" width="678" height="17" rx="3" fill="#dce2eb"><title>未取樣或資料不足</title></rect>
        {d.bands.map((b,i)=><rect key={i} x={x(b.start)} y="4" width={Math.max(.25,x(b.end)-x(b.start))} height="17" fill={b.state==="contact"?"#358c78":b.state==="air"?"#d0934e":"#dce2eb"}><title>{timeText(b.start)}—{timeText(b.end)} {CONTACT_REASON[b.reason]}</title></rect>)}
      </svg></div>
      <p className="contact-counts">近地面 {d.counts.contact} 格 · 高於地面 {d.counts.air} 格 · 未知 {d.counts.unknown} 格</p>
      {!blockers.length&&d.reasons.length>0&&<ul className="contact-reasons">{d.reasons.slice(0,3).map(v=><li key={v.reason}><span>{CONTACT_REASON[v.reason]} <strong>{v.count} 格</strong></span><Button variant="ghost" size="sm" disabled={disabled} onClick={()=>onSeek(v.first)}>查看 {timeText(v.first)}</Button></li>)}</ul>}
    </div>)}
    <p className="helper">綠：近地面且前後幀支持；棕：足部點高於地面；灰：未知。單格清楚的高於地面觀測也會保留。顏色是待複查候選，不能證明鞋底接觸或正式違規。</p>
    <details className="measurement-options"><summary>曲線顯示與角度誤差模擬</summary>
      <label className="switch-field"><Switch checked={s.smoothAngles??false} disabled={disabled} onCheckedChange={v=>onSettings({smoothAngles:v})}/><span>疊加平滑趨勢線，保留原始角度</span></label>
      <p className="helper">只改善曲線閱讀；骨架、原始角度與伸膝窗口的最低值不變。缺值與身分核對區段不連線。</p>
      <label className="switch-field"><Switch checked={s.uncertaintyEnabled??false} disabled={disabled} onCheckedChange={v=>onSettings({uncertaintyEnabled:v})}/><span>顯示膝角對點位誤差的敏感度</span></label>
      <label className="sigma-field"><span>假設每個座標的標準差 σ（原片像素）</span><Input type="number" min="0" max="20" step="0.5" value={s.pointSigmaPx??2} disabled={disabled||!s.uncertaintyEnabled} onChange={e=>{const n=e.currentTarget.valueAsNumber;if(Number.isFinite(n)&&n>=0&&n<=20)onSettings({pointSigmaPx:n});}}/></label>
      <p className="helper">預設 2 px 只是可調的假設，尚未由人工標記校準。影片下方左右膝會顯示 1,024 次擾動的中央 95% 模擬範圍；這不是實測信賴區間，也不包含鏡位、遮擋與認錯人的誤差。</p>
    </details>
  </section>;
}
