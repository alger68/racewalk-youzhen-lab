import { candidateEvents, isSide, scopeFrame, validPoint, type Point, type PoseFrame, type Report, type Settings, type Side, type WalkEvent } from "./racewalk";

export const CONTACT_METHOD = "hmm-ground-v1";
export type ContactState = "contact" | "air" | "unknown";
export type ContactReason = "view" | "target" | "ground" | "ground-moving" | "feet-unchecked" | "timing" | "identity" | "leg" | "feet" | "timestamp" | "scale" | "below-ground" | "boundary" | "temporal" | "near" | "above";
export const CONTACT_REASON: Record<ContactReason, string> = {
  view: "此鏡位不判讀足部與地面的間隙", target: "尚未圈選並追蹤同一選手", ground: "尚未標記有效地面線",
  "ground-moving": "尚未確認地面線在整段影片中有效", "feet-unchecked": "尚未確認鞋底與地面清楚", timing: "尚未確認影片時間設定",
  identity: "選手身分搜尋／核對中", leg: "這側腿部未通過點位檢查", feet: "腳跟或腳尖點位不足",
  timestamp: "此幀缺少精確時間", scale: "人體尺度不足，無法換算相對高度", "below-ground": "足部落在地面線下方，請複查地面與點位",
  boundary: "足部高度接近判讀邊界", temporal: "前後幀接觸證據不足", near: "近地面・前後幀支持", above: "腳跟、腳尖高於地面・待原片複查",
};
export type ContactSample = { t: number; state: ContactState; raw: ContactState; reason: ContactReason; continuity?: number; height?: number; tolerance?: number; support?: number; emission?: number };
type Dimensions = { width: number; height: number };

export function contactPrerequisites(s: Settings): ContactReason[] {
  const missing: ContactReason[] = [];
  if (!isSide(s.view)) missing.push("view");
  if (!s.target) missing.push("target");
  if (!s.ground || s.ground.some(p => !validPoint(p)) || Math.abs(s.ground[1].x - s.ground[0].x) < .02) missing.push("ground");
  if (!s.groundStable) missing.push("ground-moving");
  if (!s.clearFeet) missing.push("feet-unchecked");
  if (!s.timingVerified) missing.push("timing");
  return missing;
}

// Signed perpendicular distance in original image pixels. Reversing the two
// ground points must not reverse "above"; normalized x/y have unequal units.
export function groundDistance(p: Point, ground: [Point, Point], size: Dimensions): number | null {
  const [a, b] = ground[0].x <= ground[1].x ? ground : [ground[1], ground[0]];
  const dx = (b.x - a.x) * size.width, dy = (b.y - a.y) * size.height, length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 5 || Math.abs(dx) < 2) return null;
  return (dy * (p.x - a.x) * size.width - dx * (p.y - a.y) * size.height) / length;
}

function observe(f: PoseFrame, side: Side, s: Settings, size: Dimensions, blocked?: ContactReason): ContactSample {
  f = scopeFrame(f, s);
  const base = { t: f.t, state: "unknown" as const, raw: "unknown" as const, continuity: f.track?.continuity };
  const unknown = (reason: ContactReason): ContactSample => ({ ...base, reason });
  if (blocked) return unknown(blocked);
  if (f.reason || f.track?.state !== "locked" || f.track.targetId !== s.target?.id) return unknown("identity");
  if (f.track.withheld?.[side]) return unknown("leg");
  if (!f.exact) return unknown("timestamp");
  const heel = f.points[side === "L" ? 29 : 30], toe = f.points[side === "L" ? 31 : 32];
  if (!validPoint(heel) || !validPoint(toe)) return unknown("feet");
  const scales = [[11, 23], [12, 24]].flatMap(([a, b]) => validPoint(f.points[a]) && validPoint(f.points[b])
    ? [Math.hypot((f.points[a].x - f.points[b].x) * size.width, (f.points[a].y - f.points[b].y) * size.height)] : []);
  const scale = scales.length ? scales.reduce((a, b) => a + b) / scales.length : 0;
  if (scale < 25 || !Number.isFinite(scale)) return unknown("scale");
  const dh = groundDistance(heel, s.ground!, size), dt = groundDistance(toe, s.ground!, size);
  if (dh === null || dt === null) return unknown("ground");
  // Engineering proximity bands, NOT calibrated shoe clearance or a judging
  // threshold. Body-relative distances avoid the old fixed % of entire image.
  const tolerance = .08 * scale, height = Math.min(dh, dt);
  if (height < -1.5 * tolerance) return unknown("below-ground");
  const near = Math.min(Math.abs(dh), Math.abs(dt)) <= tolerance;
  const above = dh > 2 * tolerance && dt > 2 * tolerance;
  const emission = Math.max(.00001, Math.min(.99999, Math.exp(-.5 * (height / tolerance) ** 2)));
  return { ...base, raw: above ? "air" : near ? "contact" : "unknown", reason: above ? "above" : near ? "temporal" : "boundary", height, tolerance, emission };
}

// Two-state forward/backward inference. Both transitions remain possible at
// every sample; there is no imposed gait cycle, minimum flight time or left/right
// alternation. Scores are internal support, never calibrated probabilities.
export function contactPosterior(emissions: number[], seconds: number[]): number[] {
  if (emissions.length !== seconds.length || !emissions.length) return [];
  if (emissions.some(p => !Number.isFinite(p) || p <= 0 || p >= 1) || seconds.some((t, i) => !Number.isFinite(t) || (i > 0 && t <= seconds[i - 1]))) return [];
  const n = emissions.length, alpha: number[] = [], backward: number[][] = Array.from({ length: n }, () => [1, 1]);
  const transition = (i: number) => .5 * (1 - Math.exp(-8 * (seconds[i] - seconds[i - 1])));
  for (let i = 0; i < n; i++) {
    const q = i ? transition(i) : .5, prior = i ? alpha[i - 1] * (1 - q) + (1 - alpha[i - 1]) * q : .5;
    const c = prior * emissions[i], a = (1 - prior) * (1 - emissions[i]); alpha.push(c / (c + a));
  }
  for (let i = n - 2; i >= 0; i--) {
    const q = transition(i + 1), c = emissions[i + 1] * backward[i + 1][0], a = (1 - emissions[i + 1]) * backward[i + 1][1];
    const bc = (1 - q) * c + q * a, ba = q * c + (1 - q) * a, total = bc + ba;
    backward[i] = [bc / total, ba / total];
  }
  return alpha.map((p, i) => p * backward[i][0] / (p * backward[i][0] + (1 - p) * backward[i][1]));
}

export function contactAnalysis(frames: PoseFrame[], s: Settings, size: Dimensions) {
  const blockers = contactPrerequisites(s), step = s.slow / Math.min(s.fps, s.sampleFps);
  return (["L", "R"] as Side[]).map(side => {
    const samples = frames.filter(f => f.t >= s.start && f.t <= s.end).map(f => observe(f, side, s, size, blockers[0]));
    let run: ContactSample[] = [];
    const finish = () => {
      if (!run.length) return;
      const emissions = run.map((p, i) => {
        const a = run[Math.max(0, i - 1)], b = run[Math.min(run.length - 1, i + 1)];
        if (a === b) return p.emission!;
        // Observed normal velocity relative to the verified stationary ground.
        // Rapid height changes weaken near-ground evidence, never create contact.
        const speed = Math.abs((b.height! - a.height!) / ((b.t - a.t) / s.slow)) / p.tolerance!;
        return p.emission! * (.55 + .45 * Math.exp(-.5 * (speed / 12) ** 2));
      });
      const posterior = contactPosterior(emissions, run.map(p => p.t / s.slow));
      run.forEach((p, i) => {
        p.support = posterior[i];
        // A single clear elevated observation is retained for review even when
        // its neighbours are grounded. Smoothing must not erase brief flight.
        if (p.raw === "air") { p.state = "air"; return; }
        const neighbour = [run[i - 1], run[i + 1]].some(v => v?.raw === "contact");
        if (p.raw === "contact" && neighbour && p.support >= .9) { p.state = "contact"; p.reason = "near"; }
      });
      run = [];
    };
    for (const p of samples) {
      if (p.emission === undefined) { finish(); continue; }
      const prev = run.at(-1);
      if (prev && (p.t <= prev.t || p.t - prev.t > step * 1.8 || p.continuity !== prev.continuity)) finish();
      run.push(p);
    }
    finish();
    const reasons = new Map<ContactReason, { count: number; first: number }>();
    for (const p of samples) if (p.state === "unknown") { const r = reasons.get(p.reason); reasons.set(p.reason, { count: (r?.count ?? 0) + 1, first: r?.first ?? p.t }); }
    const counts = { contact: 0, air: 0, unknown: 0 }; for (const p of samples) counts[p.state]++;
    return { side, samples, counts, blockers, reasons: [...reasons].map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.count - a.count) };
  });
}

export function contactBands(samples: ContactSample[], s: Settings) {
  const step = s.slow / Math.min(s.fps, s.sampleFps), bands: { start:number; end:number; state:ContactState; reason:ContactReason }[] = [];
  for (const p of samples) {
    const start = Math.max(s.start, p.t - step / 2), end = Math.min(s.end, p.t + step / 2);
    if (end <= start) continue;
    const last = bands.at(-1);
    if (last && last.state === p.state && last.reason === p.reason && start <= last.end + .00001) last.end = Math.max(last.end, end);
    else bands.push({ start, end, state:p.state, reason:p.reason });
  }
  return bands;
}

export function analysisEvents(frames: PoseFrame[], s: Settings, size: Dimensions): WalkEvent[] {
  const out = candidateEvents(frames, s).filter(e => e.kind !== "FLIGHT");
  const [left, right] = contactAnalysis(frames, s, size), step = s.slow / Math.min(s.fps, s.sampleFps);
  let previous: ContactSample | null = null;
  left.samples.forEach((p, i) => {
    const both = p.state === "air" && right.samples[i]?.state === "air";
    if (both && (!previous || p.t - previous.t > step * 1.8 || p.continuity !== previous.continuity)) out.push({ id: `auto-hmm-FLIGHT-${i}`, t: p.t, side: "L", kind: "FLIGHT", status: "pending", origin: "auto", note: "雙腳足跟與腳尖高於已確認地面線；保留短暫觀測，須回看鞋底，不代表正式違規。" });
    previous = both ? p : null;
  });
  return out.sort((a, b) => a.t - b.t).slice(0, 500);
}

export function refreshContactCandidates(r: Report, settings: Settings): WalkEvent[] {
  const retained = r.events.filter(e => e.kind !== "FLIGHT" || e.origin !== "auto" || e.status !== "pending");
  const ids = new Set(retained.map(e => e.id));
  return [...retained, ...analysisEvents(r.frames, settings, r.file).filter(e => e.kind === "FLIGHT" && !ids.has(e.id))].sort((a,b) => a.t-b.t);
}

export function applyAnalysisSettings(r: Report, patch: Partial<Settings>): Report {
  const geometryChanged = ["ground","roi","target","view","start","end"].some(key => key in patch);
  const settings: Settings = { ...r.settings, ...patch, contactMethod:CONTACT_METHOD,
    ...(geometryChanged ? { groundStable:false } : {}) };
  const contactChanged = ["clearFeet","groundStable","ground","timingVerified","view","fps","sampleFps","slow","start","end","roi","target"].some(key => key in patch);
  return { ...r, settings, events:contactChanged ? refreshContactCandidates(r,settings) : r.events };
}
