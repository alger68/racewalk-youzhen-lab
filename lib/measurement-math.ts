import { angle, scopeFrame, type Point, type PoseFrame, type Settings, type Side } from "./racewalk";
import { observeKnee, type AngleSample } from "./inspection";

// 1 Euro adaptive low-pass filter, implemented from Casiez et al. (CHI 2012).
// Applied only to a separate display curve; source points and report minima are
// immutable. Units here are degrees and real seconds, not file playback seconds.
export function smoothAngles(samples: (AngleSample & { continuity?: number })[], s: Settings) {
  let last: { t: number; raw: number; filtered: number; velocity: number; continuity?: number } | null = null;
  const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  const step = s.slow / Math.min(s.fps, s.sampleFps);
  return samples.map(p => {
    if (p.value === null || !Number.isFinite(p.value)) { last = null; return { ...p, value: null }; }
    if (!last || p.t <= last.t || p.t - last.t > step * 1.8 || p.continuity !== last.continuity) {
      last = { t: p.t, raw: p.value, filtered: p.value, velocity: 0, continuity: p.continuity }; return { ...p };
    }
    const dt = (p.t - last.t) / s.slow, ad = alpha(1, dt), velocity = ad * (p.value - last.raw) / dt + (1 - ad) * last.velocity;
    const a = alpha(1.5 + .04 * Math.abs(velocity), dt), value = a * p.value + (1 - a) * last.filtered;
    last = { t: p.t, raw: p.value, filtered: value, velocity, continuity: p.continuity }; return { ...p, value };
  });
}

// Deterministic Monte Carlo sensitivity, conditional on an explicitly assumed
// isotropic independent Gaussian pixel sigma. It is NOT a calibrated confidence
// interval and excludes projection, anatomy, identity and systematic model bias.
export function angleSensitivity(points: [Point, Point, Point], width: number, height: number, sigma: number) {
  const value = angle(...points, width, height);
  if (value === null || !Number.isFinite(sigma) || sigma < 0 || sigma > 20) return null;
  if (!sigma) return { value, low: value, high: value, sigma, trials: 1024 };
  let seed = 17419;
  const uniform = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + .5) / 4294967296; };
  const normal = () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
  const results: number[] = [];
  for (let n = 0; n < 1024; n++) {
    // Work in unconstrained image coordinates: clipping simulated points to the
    // image boundary would artificially shrink the resulting uncertainty.
    const p = points.map(p => ({ x: p.x * width + sigma * normal(), y: p.y * height + sigma * normal() }));
    const ux = p[0].x - p[1].x, uy = p[0].y - p[1].y, vx = p[2].x - p[1].x, vy = p[2].y - p[1].y;
    const un = Math.hypot(ux, uy), vn = Math.hypot(vx, vy);
    if (un < 1e-8 || vn < 1e-8) continue;
    results.push(Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (un * vn)))) * 180 / Math.PI);
  }
  if (results.length < 1000) return null;
  results.sort((a, b) => a - b);
  const quantile = (q: number) => { const f = q * (results.length - 1), i = Math.floor(f); return results[i] + (results[Math.min(i + 1, results.length - 1)] - results[i]) * (f - i); };
  return { value, low: quantile(.025), high: quantile(.975), sigma, trials: results.length };
}

export function kneeSensitivity(frame: PoseFrame | null, side: Side, width: number, height: number, s: Settings) {
  if (frame) frame = scopeFrame(frame,s);
  if (!s.uncertaintyEnabled || !frame || observeKnee(frame, side, width, height, s.view).value === null) return null;
  const i = side === "L" ? 23 : 24;
  return angleSensitivity([frame.points[i], frame.points[i + 2], frame.points[i + 4]], width, height, s.pointSigmaPx ?? 2);
}

export function measurementNotes(s: Settings) {
  return [
    s.contactMethod === "hmm-ground-v1" ? "接觸候選採前後幀核對，仍須回看原片鞋底；內部支持分數不代表準確率。" : "此紀錄尚未設定新版接觸方法，舊版事件保留供原片複查。",
    s.groundStable ? "使用者已確認固定鏡頭與整段有效地面線。" : "地面線尚未確認整段有效，接觸分析保留未知。",
    s.smoothAngles ? "已開啟平滑趨勢顯示；報告窗口最低值仍由原始角度計算。" : "曲線顯示原始角度，未開啟平滑趨勢。",
    s.uncertaintyEnabled ? `角度敏感度：假設各座標獨立高斯誤差 σ=${s.pointSigmaPx ?? 2} px；中央 95% 模擬範圍尚未校準，不納入伸膝判讀與報告摘要。` : "未開啟點位誤差敏感度模擬；目前沒有經校準的角度誤差範圍。",
  ];
}
