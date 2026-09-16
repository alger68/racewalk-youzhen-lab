import { targetFrames, angle, isSide, nearSide, validPoint, type PoseFrame, type Report, type Settings, type Side, type View } from "./racewalk";

export type KneeObservation = {
  value: number | null;
  role: "near" | "reference" | "unavailable";
  reason: string | null;
};

// Display-only bilateral estimates. Official report windows still call knee(),
// which accepts only the near-camera side. Visibility is not calibrated accuracy.
export function observeKnee(frame: PoseFrame | null, side: Side, width: number, height: number, view: View): KneeObservation {
  if (!isSide(view)) return { value: null, role: "unavailable", reason: "正／後面不估計矢狀面膝角" };
  const role = nearSide(view) === side ? "near" : "reference";
  if (!frame) return { value: null, role, reason: "此時間沒有對齊的分析幀" };
  if (frame.reason) return { value: null, role, reason: frame.reason };
  if (frame.track?.state === "searching" || frame.track?.state === "lost") return { value: null, role, reason: "目標身分尚未確認，暫不量測" };
  if (frame.track?.withheld?.[side]) return { value: null, role, reason:`${frame.track.withheld[side]}；這一側暫不量測` };
  if (frame.points.length !== 33) return { value: null, role, reason: "未取得完整人體點位" };
  const i = side === "L" ? 23 : 24;
  const ids = [i, i + 2, i + 4];
  const missing = ids.map((id, j) => validPoint(frame.points[id]) ? null : ["髖", "膝", "踝"][j]).filter(Boolean);
  if (missing.length) return { value: null, role, reason: `${missing.join("、")}點位信心不足或超出畫面` };
  const value = angle(frame.points[i], frame.points[i + 2], frame.points[i + 4], width, height);
  return { value, role, reason: value === null ? "關節點過近，無法可靠量角" : null };
}

export function observationRole(role: KneeObservation["role"]) {
  return role === "near" ? "近側二維量測" : role === "reference" ? "遠側參考・不納入評估" : "此鏡位不量膝角";
}

export type AngleSample = { t: number; value: number | null; reason: string | null; continuity?:number };
export function bilateralInspection(r: Report) {
  const frames = targetFrames(r).filter(f => f.t >= r.settings.start && f.t <= r.settings.end);
  return (["L", "R"] as Side[]).map(side => {
    const samples: AngleSample[] = frames.map(f => ({ t: f.t, continuity:f.track?.continuity, ...observeKnee(f, side, r.file.width, r.file.height, r.settings.view) }));
    const reasons = new Map<string, number>();
    for (const p of samples) if (p.reason) reasons.set(p.reason, (reasons.get(p.reason) ?? 0) + 1);
    const valid = samples.filter(p => p.value !== null).length;
    return { side, role: observeKnee(null, side, r.file.width, r.file.height, r.settings.view).role,
      samples, valid, total: samples.length, percent: samples.length ? 100 * valid / samples.length : null,
      recovered:frames.filter((f,i)=>samples[i].value!==null&&f.track?.recovered?.[side]).length,
      retried:frames.filter((f,i)=>samples[i].value!==null&&f.track?.verification?.retry?.recovered.some(id=>(side==="L"?[23,25,27]:[24,26,28]).includes(id))).length,
      reasons: [...reasons].map(([reason, count]) => ({ reason, count, firstTime:samples.find(p=>p.reason===reason)!.t })).sort((a, b) => b.count - a.count) };
  });
}

export function samplingStep(s: Settings) { return s.slow / Math.min(s.fps, s.sampleFps); }

// Each cell describes an observed sample only; sparse records must not look
// continuously tracked. Measurement quality is reported separately per leg.
export function trackingIntervals(r: Report) {
  const step=samplingStep(r.settings),out:{start:number;end:number;state:"locked"|"searching"|"lost"}[]=[];
  for(const f of targetFrames(r)){
    const state=f.track?.state;
    if(!state||state==="manual"||f.track?.targetId!==r.settings.target?.id)continue;
    const start=Math.max(r.settings.start,f.t-step/2),end=Math.min(r.settings.end,f.t+step/2);
    if(end<=start)continue;
    const last=out.at(-1);
    if(last&&last.state===state&&start<=last.end+.00001)last.end=Math.max(last.end,end);
    else out.push({start,end,state});
  }
  return out;
}

// Preserve isolated observations, missing frames and temporal gaps. No smoothing
// or interpolation: a joined line must not silently invent a missing knee angle.
export function angleSegments(samples: AngleSample[], maxGap: number) {
  const segments: { t: number; value: number }[][] = [];
  let active: { t: number; value: number }[] | null = null;
  let continuity: number | undefined;
  for (const p of samples) {
    if (p.value === null) { active = null; continue; }
    if (!active || p.t - active[active.length - 1].t > maxGap || p.t <= active[active.length - 1].t || p.continuity !== continuity) {
      active = []; segments.push(active);
    }
    active.push({ t: p.t, value: p.value });
    continuity = p.continuity;
  }
  return segments;
}

export function missingIntervals(samples: AngleSample[], start: number, end: number, step: number) {
  const valid = samples.filter(p => p.value !== null);
  const gaps: { start: number; end: number }[] = [];
  let cursor = start;
  for (const p of valid) {
    const a = Math.max(start, p.t - step / 2), b = Math.min(end, p.t + step / 2);
    if (a > cursor + .00001) gaps.push({ start: cursor, end: a });
    cursor = Math.max(cursor, b);
  }
  if (end > cursor + .00001) gaps.push({ start: cursor, end });
  return gaps;
}

export type TimedState = { t: number; state: "contact" | "air" | "unknown" };
export function contactIntervals(samples: TimedState[], start: number, end: number, step: number) {
  const out: { start: number; end: number; state: TimedState["state"] }[] = [];
  for (const p of samples) {
    if (p.state === "unknown") continue;
    const a = Math.max(start, p.t - step / 2), b = Math.min(end, p.t + step / 2);
    if (b <= a) continue;
    const last = out[out.length - 1];
    if (last && last.state === p.state && a <= last.end + .00001) last.end = Math.max(last.end, b);
    else out.push({ start: a, end: b, state: p.state });
  }
  return out;
}
