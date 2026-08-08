// Stance width on the SIDE set — the raw, uncorrected metric.
//
// Same measurement the shipped stance_width rule makes: the ankle-to-ankle
// line, divided by torso height (shoulder midpoint → hip midpoint). Not a
// re-implementation — it imports the rule port from ./stance_width.js, so the
// number here IS the rule's number and cannot drift from it.
//
// What is deliberately NOT here is the v5 foreshortening correction. That boost
// exists because a stance line pointing AT the camera is seen end-on and its 2D
// length undercounts the real width. On this set the camera is side-on: the
// stance line lies across the image plane, at full length, so there is nothing
// to correct — the raw ratio is the true ratio. That is exactly what makes this
// set worth measuring: it is the reference distribution the correction is
// trying to recover on frontal footage.
//
// The panel reports how many counted frames the v5 gate WOULD have boosted, as
// a check rather than an assertion — if that number is not ~0, either the clip
// is not as side-on as curated or the gate is mis-tuned, and both are worth
// knowing before trusting the numbers.
//
// Video list is gated to the side set (../shared/side_set.js).

import { J } from "../../skeleton.js";
import { resolveRanges } from "../shared/segment_set.js";
import { isCuratedVideo, matchEntry, sideSetReady } from "../shared/side_set.js";
import {
  CORR, DEFAULT_CONFIG, computeDxDy, detectStanceWidth, rollingMedian,
} from "./stance_width.js";

const C_SEP    = "#7adf7a";  // the metric
const C_NARROW = "#ff5d6c";  // below the rule's narrow threshold
const C_TORSO  = "#7ec8ff";  // torso segment (the denominator)
const C_SPAN   = "#b48cff";  // curated span
const C_OUT    = "#888";
const C_FRAME  = "#3ad9e0";
const C_BOOST  = "#e08aff";  // frames the v5 gate would have boosted

const cfg = {
  minConfidence: DEFAULT_CONFIG.minConfidence,
  spansOnly: true,
  narrowThreshold: DEFAULT_CONFIG.narrowThreshold,
};

const pickPose = state => state.poseV6 || state.pose;

let host;
let mc = { pose: null };

// ── metrics ─────────────────────────────────────────────────────────────────

function computeMetrics(state) {
  const pose = pickPose(state);
  if (!pose) return null;
  const basename = state.cacheBasename || null;
  if (mc.pose === pose && mc.basename === basename && mc.round === state.cacheRound
      && mc.fps === state.fps && mc.minConf === cfg.minConfidence) return mc;

  const n = pose.n_frames;
  const fps = pose.fps || state.fps || 30;

  // The shipped pipeline, run for its RAW sep ratios and its valid mask:
  // confidence gate → temporal cleanup → knee/ankle sanity. `out.debug.sepRatios`
  // is the uncorrected metric — the correction is applied downstream of this
  // call in stance_width.js, and we simply never apply it.
  const out = detectStanceWidth(pose.skeleton, pose.conf, n, fps,
                                { ...DEFAULT_CONFIG, minConfidence: cfg.minConfidence });
  const sep = out.debug.sepRatios;
  const valid = out.debug.validMask;

  // Δy/Δx of the ankle line, smoothed exactly as v5 smooths it. Only used to
  // report what the correction would have done — never to change `sep`.
  const { dx, dy } = computeDxDy(pose);
  const rawRatio = dx.map((v, f) =>
    Number.isFinite(v) && Number.isFinite(dy[f])
      ? Math.min(dy[f] / Math.max(v, 1e-6), CORR.ratioCap) : NaN);
  const axisRatio = rollingMedian(rawRatio, Math.max(1, Math.round(CORR.smoothSeconds * fps)),
                                  CORR.minWindowValid);

  const entry = matchEntry(basename);
  const { inSpan, ranges, nIn } = entry
    ? resolveRanges(entry.spans, { n, fps, startSec: Number(pose.start_sec || 0),
                                   roundIdx: state.cacheRound })
    : { inSpan: new Uint8Array(n), ranges: [], nIn: 0 };

  mc = { pose, basename, round: state.cacheRound, fps, minConf: cfg.minConfidence,
         n, sep, valid, dx, dy, axisRatio, entry, inSpan, ranges, nIn };
  return mc;
}

// A frame counts when the pose is trustworthy AND (spans-only) it is inside a
// curated span. Everything the panel reports is over counted frames.
function counted(c, f) {
  if (!c.valid[f] || !Number.isFinite(c.sep[f])) return false;
  if (cfg.spansOnly && !(c.entry && c.inSpan[f])) return false;
  return true;
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function rollup(c) {
  const vals = [];
  let nBoost = 0;
  for (let f = 0; f < c.n; f++) {
    if (!counted(c, f)) continue;
    vals.push(c.sep[f]);
    if (c.axisRatio[f] > CORR.ratioGate) nBoost++;
  }
  const sorted = [...vals].sort((a, b) => a - b);
  const nNarrow = vals.filter(v => v < cfg.narrowThreshold).length;
  return {
    n: vals.length, sorted, nBoost, nNarrow,
    med: quantile(sorted, 0.5), p25: quantile(sorted, 0.25), p75: quantile(sorted, 0.75),
    min: sorted[0], max: sorted[sorted.length - 1],
  };
}

const fmt = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "—");

// ── lens ────────────────────────────────────────────────────────────────────

export const StanceWidthSideRule = {
  id: "stance_width_side",
  label: "Stance width — side set (uncorrected)",

  // Only the curated side videos are selectable. The manual picker and the
  // Firebase path bypass the dropdown, so update() refuses those too: the whole
  // claim of this lens is that the camera is side-on.
  requiresVideo: isCuratedVideo,

  skeletonStyle() {
    return {
      boneColor: "rgba(255,255,255,0.2)",
      boneWidth: 1.5,
      jointRadius: 3,
      highlightJoints: new Set([J.L_SHOULDER, J.R_SHOULDER, J.L_HIP, J.R_HIP,
                                J.L_ANKLE, J.R_ANKLE]),
    };
  },

  mount(_host) {
    host = _host;
    mc = { pose: null };
    host.innerHTML = `
      <h2>Stance width — side set</h2>
      <p class="hint">
        <code>‖ankle − ankle‖ / torso height</code>, the shipped
        <code>stance_width</code> metric, imported from that lens so the two
        cannot drift. The v5 foreshortening boost is <strong>off</strong>: on
        side-on footage the stance line lies across the image plane at full
        length, so there is nothing to correct and this is the true ratio.
        <span style="color:${C_SEP}">wide</span> ·
        <span style="color:${C_NARROW}">below ${cfg.narrowThreshold}</span> ·
        <span style="color:${C_TORSO}">torso (the denominator)</span>.
      </p>

      <label class="slider-row" style="display:block; font-size:12px">
        min confidence = <output id="sws-conf-out">${cfg.minConfidence.toFixed(2)}</output>
        <input type="range" id="sws-conf" min="0" max="0.95" step="0.05"
               value="${cfg.minConfidence}"></label>
      <label style="display:block; font-size:12px; margin-top:4px">
        <input type="checkbox" id="sws-spans" ${cfg.spansOnly ? "checked" : ""}>
        curated spans only</label>

      <h3>This round</h3>
      <div id="sws-round" style="font-size:13px; line-height:1.6"></div>

      <h3>Distribution <span class="muted small">(counted frames)</span></h3>
      <canvas id="sws-hist" style="display:block; width:100%; height:90px"></canvas>

      <h3>Current frame</h3>
      <div id="sws-frame" style="font-size:13px; line-height:1.7"></div>`;

    mountStageTimeline();

    const slider = host.querySelector("#sws-conf");
    slider.addEventListener("input", e => {
      cfg.minConfidence = parseFloat(e.target.value);
      host.querySelector("#sws-conf-out").textContent = cfg.minConfidence.toFixed(2);
      mc = { pose: null };            // gate changed ⇒ the valid mask changed
      refresh();
    });
    host.querySelector("#sws-spans").addEventListener("change", e => {
      cfg.spansOnly = e.target.checked; refresh();
    });

    sideSetReady.then(() => { mc = { pose: null }; refresh(); });
  },

  update(state) {
    if (!host || !state) return;
    const c = computeMetrics(state);
    const roundEl = host.querySelector("#sws-round");
    const frameEl = host.querySelector("#sws-frame");
    if (!roundEl) return;
    if (!c) { roundEl.innerHTML = `<p class="muted">No pose cache loaded.</p>`; return; }

    if (!c.entry) {
      roundEl.innerHTML =
        `<div style="color:${C_NARROW}; font-weight:600">Not in the side set</div>
         <div class="muted small" style="margin-top:3px">
           Leaving the correction off is only safe when the camera is side-on.
           <code>${c.basename || "this video"}</code> isn't in
           <code>side_segments.json</code>, so nothing is measured.</div>`;
      if (frameEl) frameEl.innerHTML = `<span class="muted">—</span>`;
      drawHistogram(host.querySelector("#sws-hist"), null);
      drawTimeline(document.getElementById("sws-timeline"), c, state.frame);
      return;
    }

    const r = rollup(c);
    roundEl.innerHTML = r.n === 0
      ? `<span class="muted">No frames counted — ${cfg.spansOnly
           ? "no curated span falls in this round (try another round, or untick spans-only)"
           : "the confidence gate rejected every frame"}.</span>`
      : `<div>median <code style="color:${r.med < cfg.narrowThreshold ? C_NARROW : C_SEP}">
           ${fmt(r.med)}</code>
           <span class="muted">torso lengths</span></div>
         <div class="muted small">IQR ${fmt(r.p25)}–${fmt(r.p75)} ·
           range ${fmt(r.min)}–${fmt(r.max)}</div>
         <div class="muted small">${r.n} frames counted
           (${(100 * r.n / c.n).toFixed(1)}% of the round) ·
           ${cfg.spansOnly ? `${c.nIn} in span` : "whole round"}</div>
         <div class="muted small">
           <code style="color:${r.nNarrow ? C_NARROW : "inherit"}">${r.nNarrow}</code>
           below ${cfg.narrowThreshold}
           <span class="muted">(raw frames — no sustained-duration logic here)</span></div>
         <div class="muted small" style="margin-top:3px">
           v5 gate would have boosted
           <code style="color:${r.nBoost ? C_BOOST : "inherit"}">${r.nBoost}</code>
           of them${r.nBoost
             ? ` — <span style="color:${C_BOOST}">expected ~0 on side-on footage;
                 check the clip really is side-on</span>`
             : " — as expected: nothing here is depth-aligned"}</div>`;

    drawHistogram(host.querySelector("#sws-hist"), r);

    const f = state.frame;
    if (frameEl) {
      const inSpan = !!c.inSpan[f];
      const on = counted(c, f);
      const th = frameTorsoPx(c.pose, f);
      frameEl.innerHTML = `
        <div><strong>sep</strong>
          <code style="color:${!Number.isFinite(c.sep[f]) ? C_OUT
                             : c.sep[f] < cfg.narrowThreshold ? C_NARROW : C_SEP}">
            ${fmt(c.sep[f])}</code>
          <span class="muted">= ankles ${fmt(c.sep[f] * th, 0)}px / torso ${fmt(th, 0)}px</span></div>
        <div class="muted small">Δx <code>${fmt(c.dx[f], 2)}</code> ·
          Δy <code>${fmt(c.dy[f], 2)}</code> ·
          smoothed Δy/Δx <code style="color:${c.axisRatio[f] > CORR.ratioGate ? C_BOOST : "inherit"}">
            ${fmt(c.axisRatio[f], 2)}</code>
          <span class="muted">(v5 gate ${CORR.ratioGate})</span></div>
        <div class="muted small">
          <span style="color:${inSpan ? C_SPAN : C_OUT}">${inSpan ? "in span" : "outside span"}</span> ·
          <span style="color:${c.valid[f] ? C_SEP : C_OUT}">${c.valid[f] ? "pose valid" : "gated out"}</span> ·
          ${on ? "counted" : "not counted"}</div>`;
    }

    drawTimeline(document.getElementById("sws-timeline"), c, f);
  },

  // Draw the two things the ratio is made of, so the number is checkable
  // against the picture: the ankle line (numerator) and the torso segment
  // (denominator).
  draw(ctx, state) {
    const c = computeMetrics(state);
    if (!c || !c.entry) return;
    const f = state.frame;
    if (!Number.isFinite(c.sep[f])) return;
    const s = state.renderScale || 1;
    const sk = c.pose.skeleton, base = f * 17;
    const px = j => [sk[(base + j) * 2] * s, sk[(base + j) * 2 + 1] * s];

    const [lax, lay] = px(J.L_ANKLE), [rax, ray] = px(J.R_ANKLE);
    const [lsx, lsy] = px(J.L_SHOULDER), [rsx, rsy] = px(J.R_SHOULDER);
    const [lhx, lhy] = px(J.L_HIP), [rhx, rhy] = px(J.R_HIP);
    const shx = (lsx + rsx) / 2, shy = (lsy + rsy) / 2;
    const hpx = (lhx + rhx) / 2, hpy = (lhy + rhy) / 2;

    const dim = !counted(c, f);
    ctx.save();
    ctx.globalAlpha = dim ? 0.3 : 1;

    ctx.strokeStyle = C_TORSO;
    ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.moveTo(shx, shy); ctx.lineTo(hpx, hpy); ctx.stroke();

    ctx.strokeStyle = c.sep[f] < cfg.narrowThreshold ? C_NARROW : C_SEP;
    ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.moveTo(lax, lay); ctx.lineTo(rax, ray); ctx.stroke();

    const label = `${c.sep[f].toFixed(2)} torso`;
    const fsz = Math.round(13 * s);
    ctx.font = `600 ${fsz}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    const w = ctx.measureText(label).width + 12 * s;
    const lx = (lax + rax) / 2 - w / 2, ly = (lay + ray) / 2 + 8 * s;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath(); ctx.roundRect(lx, ly, w, fsz + 10 * s, 5 * s); ctx.fill();
    ctx.fillStyle = c.sep[f] < cfg.narrowThreshold ? C_NARROW : C_SEP;
    ctx.fillText(label, lx + 6 * s, ly + 5 * s);
    ctx.restore();
  },
};

function frameTorsoPx(pose, f) {
  const sk = pose.skeleton, base = f * 17;
  const sx = 0.5 * (sk[(base + J.L_SHOULDER) * 2]     + sk[(base + J.R_SHOULDER) * 2]);
  const sy = 0.5 * (sk[(base + J.L_SHOULDER) * 2 + 1] + sk[(base + J.R_SHOULDER) * 2 + 1]);
  const hx = 0.5 * (sk[(base + J.L_HIP) * 2]          + sk[(base + J.R_HIP) * 2]);
  const hy = 0.5 * (sk[(base + J.L_HIP) * 2 + 1]      + sk[(base + J.R_HIP) * 2 + 1]);
  return Math.hypot(sx - hx, sy - hy);
}

function refresh() {
  document.getElementById("video")?.dispatchEvent(new Event("seeked"));
}

function seekTo(f) {
  const sl = document.getElementById("scrubber");
  if (!sl) return;
  sl.value = f;
  sl.dispatchEvent(new Event("input"));
}

function fitCanvas(canvas) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = Math.max(1, canvas.getBoundingClientRect().width);
  const h = Math.max(1, canvas.getBoundingClientRect().height);
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, W: w, H: h };
}

// ── distribution ────────────────────────────────────────────────────────────

const HIST_MAX = 1.5;   // sep beyond 1.5 torso lengths is a pose failure, not a stance
const HIST_BINS = 30;

function drawHistogram(canvas, r) {
  if (!canvas) return;
  const { ctx, W, H } = fitCanvas(canvas);
  if (!r || !r.n) {
    ctx.fillStyle = C_OUT;
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText("no counted frames", 4, H / 2);
    return;
  }
  const bins = new Array(HIST_BINS).fill(0);
  for (const v of r.sorted) {
    const i = Math.min(HIST_BINS - 1, Math.max(0, Math.floor(v / HIST_MAX * HIST_BINS)));
    bins[i]++;
  }
  const peak = Math.max(...bins);
  const bw = W / HIST_BINS;
  const axisH = 12;
  for (let i = 0; i < HIST_BINS; i++) {
    const v = (i + 0.5) / HIST_BINS * HIST_MAX;
    const h = peak ? (bins[i] / peak) * (H - axisH) : 0;
    ctx.fillStyle = v < cfg.narrowThreshold ? C_NARROW : C_SEP;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(i * bw, H - axisH - h, Math.max(1, bw - 1), h);
  }
  ctx.globalAlpha = 1;

  const xOf = v => (v / HIST_MAX) * W;
  ctx.strokeStyle = C_NARROW;
  ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(xOf(cfg.narrowThreshold), 0);
  ctx.lineTo(xOf(cfg.narrowThreshold), H - axisH); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "#fff";
  ctx.beginPath(); ctx.moveTo(xOf(r.med), 0); ctx.lineTo(xOf(r.med), H - axisH); ctx.stroke();

  ctx.fillStyle = C_OUT;
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText("0", 1, H - 2);
  ctx.fillText(`${cfg.narrowThreshold}`, Math.max(8, xOf(cfg.narrowThreshold) - 8), H - 2);
  ctx.fillText(`${HIST_MAX}`, W - 18, H - 2);
  ctx.fillStyle = "#fff";
  ctx.fillText(`med ${fmt(r.med, 2)}`, Math.min(W - 54, xOf(r.med) + 3), 9);
}

// ── below-video timeline ────────────────────────────────────────────────────

const TL_LABEL_W = 44;

function mountStageTimeline() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:12px;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px";
  const label = document.createElement("div");
  label.className = "muted small";
  label.style.cssText = "margin-bottom:6px";
  label.innerHTML = `Stance width (uncorrected) —
    <span style="color:${C_SEP}">sep</span> as a height,
    <span style="color:${C_NARROW}">below ${cfg.narrowThreshold}</span>,
    faded outside a <span style="color:${C_SPAN}">curated span</span> · click to seek`;
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = "sws-timeline";
  canvas.style.cssText = "display:block;width:100%;height:70px";
  canvas.width = 800; canvas.height = 70;
  wrap.appendChild(canvas);
  slot.appendChild(wrap);
  canvas.addEventListener("click", e => {
    const N = mc?.n;
    if (!N) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - TL_LABEL_W) / Math.max(1, rect.width - TL_LABEL_W - 4);
    seekTo(Math.max(0, Math.min(N - 1, Math.round(ratio * (N - 1)))));
  });
}

function drawTimeline(canvas, c, frame) {
  if (!canvas || !c) return;
  const { ctx, W, H } = fitCanvas(canvas);
  const N = c.n;
  if (!N) return;

  const xOf = f => TL_LABEL_W + (f / Math.max(1, N - 1)) * (W - TL_LABEL_W - 4);
  const colW = Math.max(1, (W - TL_LABEL_W - 4) / Math.max(1, N - 1));
  const spanH = 6;
  const top = 4, barH = H - 12 - spanH;
  const yOf = v => top + barH - Math.min(1, v / HIST_MAX) * barH;

  ctx.font = "10px ui-monospace, monospace";
  ctx.fillStyle = C_SEP;
  ctx.fillText("sep", 6, top + barH / 2);

  for (let f = 0; f < N; f++) {
    const v = c.sep[f];
    if (!Number.isFinite(v)) continue;
    const on = counted(c, f);
    ctx.fillStyle = v < cfg.narrowThreshold ? C_NARROW : C_SEP;
    ctx.globalAlpha = on ? 0.9 : 0.18;
    ctx.fillRect(xOf(f), yOf(v), colW + 0.5, top + barH - yOf(v));
  }
  ctx.globalAlpha = 1;

  // threshold line, so "narrow" is readable without reading numbers
  ctx.strokeStyle = C_NARROW;
  ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(TL_LABEL_W, yOf(cfg.narrowThreshold));
  ctx.lineTo(W - 4, yOf(cfg.narrowThreshold));
  ctx.stroke();
  ctx.setLineDash([]);

  // curated spans as a band under the trace
  const sy = top + barH + 3;
  ctx.fillStyle = C_SPAN;
  for (const r of c.ranges) {
    ctx.fillRect(xOf(r.s), sy, Math.max(2, xOf(r.e) - xOf(r.s)), spanH);
  }
  if (!c.ranges.length) {
    ctx.fillStyle = C_OUT;
    ctx.fillText("no span in this round", TL_LABEL_W + 4, sy + spanH);
  }

  ctx.strokeStyle = C_FRAME;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 1); ctx.lineTo(xOf(frame), H - 1); ctx.stroke();
}
