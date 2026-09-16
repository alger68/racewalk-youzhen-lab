"use client";
import { useMemo } from "react";
import { bilateralInspection, observationRole } from "@/lib/inspection";
import { timeText, type Report } from "@/lib/racewalk";
import { Button } from "@/components/ui/button";

export function QualityPanel({ report,onSeek,disabled=false,unavailableReason }: { report: Report;onSeek?:(t:number)=>void;disabled?:boolean;unavailableReason?:string }) {
  const sides = useMemo(() => bilateralInspection(report), [report]);
  const partial = !report.complete && report.frames.length > 0;
  const verified=report.tracking?.pipeline==="full-rtmpose-v1";
  return <section className="quality-panel" aria-label="左右膝角資料品質">
    <div className="section-head"><h3>這段資料能看多少？</h3><span className="pill">{partial ? "區間尚未分析完成" : "以已分析影格為分母"}</span></div>
    {verified?<p className="helper">本次使用 Full 骨架＋RTMPose 複核，配合軀幹、移動軌跡與衣著連續性追蹤。左右分開核對，分歧點保留空白；模型一致仍需回看原片。</p>:report.frames.length>0?<p className="helper">這筆是舊版分析，尚未經第二套骨架複核。載入原片後可重新分析。</p>:<p className="helper">圈選一次後持續追蹤，兩套骨架模型核對左右關節；暫時遮擋時繼續掃描。</p>}
    {(report.engine.startsWith("rw-2.8.")||report.engine.startsWith("rw-2.9."))&&<p className="helper">複核點不清楚時會自動改用較貼近選手的裁切再辨識。點位重新出現後，由下一格確認前一格的原始量測；未確認的影格仍留白。</p>}
    {report.tracking?.identity==="appearance-reid-v1"&&<p className="helper">已啟用人物外觀輔助追蹤：分別保留畫面中人物的短期紀錄，核對外觀與移動後只分析圈選選手。遮擋後需連續三格確認；身分不明時繼續搜尋、不補角度。外觀相似度不是身分準確率。</p>}
    {unavailableReason&&<p className="helper" role="status">{unavailableReason}</p>}
    <div className="quality-grid">{sides.map(s => <div className="quality-side" key={s.side}>
      <div className="quality-title"><strong><i className={`dot ${s.side === "L" ? "left-dot" : "right-dot"}`} />{s.side === "L" ? "左膝" : "右膝"}</strong><span>{s.percent === null ? "尚無資料" : `${s.valid} / ${s.total} 格可量角`}</span></div>
      <p className="quality-role">{observationRole(s.role)}</p>
      <div className="quality-meter" role="img" aria-label={`${s.side === "L" ? "左" : "右"}膝可量角影格比例 ${s.percent?.toFixed(1) ?? "無資料"}%`}><span style={{ width: `${s.percent ?? 0}%`, background: s.side === "L" ? "#315ed9" : "#c86024" }} /></div>
      <p className="quality-percent">可量角影格 {s.percent?.toFixed(1) ?? "—"}% · 這是資料覆蓋，不是模型準確率</p>
      {(s.recovered>0||s.retried>0)&&<p className="helper">其中 {s.retried} 格由局部複核找回膝角，{s.recovered} 格經相鄰影格確認後保留原始量測。兩項可能重疊。</p>}
      {s.reasons.length > 0 ? <details><summary>未顯示角度的原因（{s.total - s.valid} 格）</summary><ul>{s.reasons.map(x => <li key={x.reason}><span>{x.reason}</span><div className="quality-reason-action"><strong>{x.count} 格</strong>{onSeek&&<Button size="sm" variant="ghost" disabled={disabled} onClick={()=>onSeek(x.firstTime)} aria-label={`查看${s.side==="L"?"左":"右"}膝：${x.reason}`}>看這一格 · {timeText(x.firstTime)}</Button>}</div></li>)}</ul></details> : <p className="helper">{s.total ? "目前取樣皆有可計算點位，仍須看原片核對。" : "分析後會列出缺值原因，不把空白當成正常。"}</p>}
    </div>)}</div>
    <p className="helper">遇到點位不足，先回看人物大小、兩腿遮擋與圈選範圍；可用單幀辨識或人工三點量角。圖上的空白會保留，不補造角度。</p>
  </section>;
}
