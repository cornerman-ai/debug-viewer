// The head-off-center-line quantity, shared by the lenses that read it on the
// frontal set (research/slip_exploration.js). Not a lens.
//
// Per frame: the head's horizontal offset from a vertical line through the hip
// center, in torso heights — what research/head_offcenter.js reads on the full
// BlazePose-33 cache, here on the COCO-17 remap every pose path provides. Head
// x = the midpoint of the visible head landmarks' horizontal extent (nose,
// eyes, ears), which holds up under head rotation better than a centroid.
// Reference = the hip center, because the hips stay planted in a slip while the
// shoulder-hip midpoint drifts with the bend. Unit = the round's MEDIAN torso
// height, so a crouch does not shrink it. Smoothed over 5 frames like the
// defense research's `lat`. Sign is image-space, + = head to the right.
//
// The rule on top of it (head_offcenter's): at a straight punch the head should
// come OFF the line — the score is the head's furthest offset in the punch
// window through the house sigmoid, 0 on the line, 100 at 0.25 torso.

import { J } from "../../skeleton.js";
export { isStraightType } from "./punch_detections.js";

export const HEAD_JOINTS = [J.NOSE, J.L_EYE, J.R_EYE, J.L_EAR, J.R_EAR];
export const SMOOTH_K = 5;
export const SCORE = { target: 0.25, k: 10 };   // head_offcenter's scoreTarget / scoreSteepness

export function median(xs) {
  const v = Array.from(xs).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : 0.5 * (v[m - 1] + v[m]);
}

export function smooth(xs, k) {
  const n = xs.length, half = Math.floor(k / 2), out = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      if (Number.isFinite(xs[j])) { s += xs[j]; c++; }
    }
    if (c) out[i] = s / c;
  }
  return out;
}

const memo = new WeakMap();   // pose → { minConf, result }

// `pose`: { n_frames, skeleton (flat px, n*17*2), conf (flat n*17) | null }.
// Returns { n, torso, off (torso units, smoothed), offMed, headX, headY, hipX,
// hipY } in the pose's pixel space, { bad: true } when no torso can be
// measured, null without a pose. Memoized on the pose object.
export function computeCenterLine(pose, { minConf = 0.3 } = {}) {
  if (!pose) return null;
  const hit = memo.get(pose);
  if (hit && hit.minConf === minConf) return hit.result;

  const n = pose.n_frames, sk = pose.skeleton, cf = pose.conf;
  const raw = new Float64Array(n).fill(NaN);
  const headX = new Float64Array(n).fill(NaN), headY = new Float64Array(n).fill(NaN);
  const hipX = new Float64Array(n).fill(NaN), hipY = new Float64Array(n).fill(NaN);
  const torsos = [];
  for (let f = 0; f < n; f++) {
    const base = f * 17;
    const jx = j => sk[(base + j) * 2], jy = j => sk[(base + j) * 2 + 1];
    const ok = j => (!cf || cf[base + j] >= minConf) && Number.isFinite(jx(j)) && Number.isFinite(jy(j));
    if (!(ok(J.L_HIP) && ok(J.R_HIP) && ok(J.L_SHOULDER) && ok(J.R_SHOULDER))) continue;
    const hx = 0.5 * (jx(J.L_HIP) + jx(J.R_HIP)), hy = 0.5 * (jy(J.L_HIP) + jy(J.R_HIP));
    const sx = 0.5 * (jx(J.L_SHOULDER) + jx(J.R_SHOULDER)), sy = 0.5 * (jy(J.L_SHOULDER) + jy(J.R_SHOULDER));
    const t = Math.hypot(sx - hx, sy - hy);
    if (t > 1e-6) torsos.push(t);
    let minX = Infinity, maxX = -Infinity, ys = 0, k = 0;
    for (const j of HEAD_JOINTS) {
      if (!ok(j)) continue;
      minX = Math.min(minX, jx(j)); maxX = Math.max(maxX, jx(j)); ys += jy(j); k++;
    }
    if (!k) continue;
    headX[f] = 0.5 * (minX + maxX); headY[f] = ys / k; hipX[f] = hx; hipY[f] = hy;
    raw[f] = headX[f] - hx;
  }
  const torso = median(torsos);
  let result;
  if (!Number.isFinite(torso) || torso < 1e-6) result = { bad: true };
  else {
    const off = smooth(Array.from(raw, v => v / torso), SMOOTH_K);
    result = { n, torso, off, offMed: median(off), headX, headY, hipX, hipY };
  }
  memo.set(pose, { minConf, result });
  return result;
}

// 0–100 quality from how far the head is off the line: 0 on the line (worst),
// 100 at `target` torso, the house sigmoid in between. `mistake` = 100 − quality.
function sigmoid01(x, k) {
  const L = t => 1 / (1 + Math.exp(-k * (t - 0.5)));
  return (L(x) - L(0)) / (L(1) - L(0));
}
export function scoreOffCenter(offTorso, { target = SCORE.target, k = SCORE.k } = {}) {
  const x = Math.max(0, Math.min(1, Math.abs(offTorso) / target));
  const quality = 100 * sigmoid01(x, k);
  return { quality, mistake: 100 - quality };
}

// The rule per straight punch: the head's furthest offset from the line inside
// the punch window [s, e] (frames of `m`), and its score.
export function straightVerdict(m, s, e) {
  let peak = NaN, peakF = -1;
  for (let f = Math.max(0, s); f <= Math.min(m.n - 1, e); f++) {
    const v = m.off[f];
    if (Number.isFinite(v) && (!Number.isFinite(peak) || Math.abs(v) > Math.abs(peak))) { peak = v; peakF = f; }
  }
  if (!Number.isFinite(peak)) return null;
  const sc = scoreOffCenter(peak);
  return { peak, peakF, quality: sc.quality, ok: sc.quality >= 50 };
}

// ── the three formulations of "slip" on that offset ─────────────────────────
//
// Which quantity says slip is the open question the Slip exploration lens puts
// on screen: the head's POSITION relative to the hip line (`off`), its
// DEVIATION from the boxer's own resting position (`dev` = off minus its
// rolling 3-s median — a bladed stance sits off-center all round), or its
// MOVEMENT (`travel` = the range of off inside a centered 0.5-s window, an
// out-and-back; `vel` = |change over 0.1 s|). Measured on the hand-curated
// frontal set against the Sheet's slips (ml/research/defense/slip_rule/):
// position wins, movement alone is weak — see that script's docstring for the
// numbers.

export function rollingMedian(arr, win) {
  const n = arr.length, half = Math.floor(win / 2), out = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const w = [];
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) if (Number.isFinite(arr[j])) w.push(arr[j]);
    if (w.length >= Math.min(15, win)) { w.sort((a, b) => a - b); const m = w.length >> 1; out[i] = w.length % 2 ? w[m] : 0.5 * (w[m - 1] + w[m]); }
  }
  return out;
}

export function rollingRange(arr, win) {
  const n = arr.length, half = Math.floor(win / 2), out = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    let lo = Infinity, hi = -Infinity, k = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      const v = arr[j]; if (!Number.isFinite(v)) continue; k++; if (v < lo) lo = v; if (v > hi) hi = v;
    }
    if (k >= 5) out[i] = hi - lo;
  }
  return out;
}

const sigMemo = new WeakMap();   // center-line result → { fps, signals }

// { dev, travel, vel } for a computeCenterLine() result, at `fps`. Memoized.
export function centerLineSignals(m, fps = 30) {
  if (!m || m.bad) return null;
  const hit = sigMemo.get(m);
  if (hit && hit.fps === fps) return hit.signals;
  const off = m.off;
  const dev = new Float64Array(off.length);
  const base = rollingMedian(off, Math.round(3 * fps) | 1);
  for (let i = 0; i < off.length; i++) dev[i] = off[i] - base[i];
  const lag = Math.max(1, Math.round(0.1 * fps));
  const vel = new Float64Array(off.length).fill(NaN);
  for (let i = lag; i < off.length; i++) vel[i] = Math.abs(off[i] - off[i - lag]);
  const signals = { dev, travel: rollingRange(off, Math.round(0.5 * fps) | 1), vel };
  sigMemo.set(m, { fps, signals });
  return signals;
}
