// Foot stagger on the SIDE set — HORIZONTAL ankle distance in torso lengths.
//
// The question is how far in FRONT of the other one foot is, so the metric is
// strictly the horizontal component:
//
//     |ankle_L.x − ankle_R.x| / torso height     (shoulder mid → hip mid)
//
// Horizontal only, on purpose. Side-on, the boxer's fore-aft axis lies along
// image-x, so Δx is the stagger and Δy is just one foot sitting lower in frame
// (ground plane, perspective, a heel lifting). The shipped stance_width rule
// takes the full euclidean ankle distance, which folds that Δy in; here it is
// dropped rather than measured. Both numbers are shown per frame so the
// difference is visible.
//
// Not re-derived: the torso denominator and the horizontal component both come
// from ./stance_width.js (`computeDxDy`), and the frame-validity pipeline is
// that lens's shipped one — confidence gate → temporal cleanup → knee/ankle
// sanity. Only the choice of numerator is this lens's own.
//
// The v5 foreshortening correction is not applied and could not be: it exists
// because a stance line pointing AT the camera is seen end-on and undercounts,
// and the fix for that is to stop measuring such footage, not to scale it. The
// panel still reports how many counted frames the v5 gate WOULD have flagged as
// depth-aligned — on genuinely side-on footage that should be ~0, and if it is
// not, Δx is undercounting the stagger and the numbers are not trustworthy.
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

  // The shipped pipeline, run for its frame-validity mask (confidence gate →
  // temporal cleanup → knee/ankle sanity) and, for comparison only, its full
  // euclidean ankle ratio.
  const out = detectStanceWidth(pose.skeleton, pose.conf, n, fps,
                                { ...DEFAULT_CONFIG, minConfidence: cfg.minConfidence });
  const valid = out.debug.validMask;
  const euclid = out.debug.sepRatios;

  // dx / dy are the ankle line's components, already divided by the same torso
  // height. dx IS this lens's metric — the horizontal stagger.
  const { dx, dy } = computeDxDy(pose);
  const sep = dx;
  const rawRatio = dx.map((v, f) =>
    Number.isFinite(v) && Number.isFinite(dy[f])
      ? Math.min(dy[f] / Math.max(v, 1e-6), CORR.ratioCap) : NaN);
  const axisRatio = rollingMedian(rawRatio, Math.max(1, Math.round(CORR.smoothSeconds * fps)),
                                  CORR.minWindowValid);
  // ^ smoothed exactly as v5 smooths it, and used only to warn that a stretch
  //   is depth-aligned. It never changes `sep`.

  const entry = matchEntry(basename);
  const { inSpan, ranges, nIn } = entry
    ? resolveRanges(entry.spans, { n, fps, startSec: Number(pose.start_sec || 0),
                                   roundIdx: state.cacheRound })
    : { inSpan: new Uint8Array(n), ranges: [], nIn: 0 };

  mc = { pose, basename, round: state.cacheRound, fps, minConf: cfg.minConfidence,
         n, sep, euclid, valid, dx, dy, axisRatio, entry, inSpan, ranges, nIn };
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
  label: "Foot stagger — side set (horizontal)",

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
      <h2>Foot stagger — side set</h2>
      <p class="hint">
        <code>|Δx ankles| / torso height</code> — <strong>horizontal only</strong>:
        how far in front of the other one foot is, in torso lengths. Side-on the
        fore-aft axis lies along image-x, so Δy is just one foot lower in frame
        and is dropped, not measured. The shipped <code>stance_width</code> rule
        uses the full euclidean distance instead; both are shown per frame. The
        torso denominator and Δx come from that lens, so they cannot drift.
        <span style="color:${C_SEP}">wide</span> ·
        <span style="color:${C_NARROW}">below the threshold</span> ·
        <span style="color:${C_TORSO}">torso (the denominator)</span>.
      </p>

      <label class="slider-row" style="display:block; font-size:12px">
        narrow below = <output id="sws-thr-out">${cfg.narrowThreshold.toFixed(2)}</output>
        <span class="muted">torso lengths (rule ships ${DEFAULT_CONFIG.narrowThreshold})</span>
        <input type="range" id="sws-thr" min="0.10" max="1.20" step="0.01"
               value="${cfg.narrowThreshold}"></label>
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
      <canvas id="sws-hist" style="display:block; width:100%; height:120px"></canvas>

      <h3>Current frame</h3>
      <div id="sws-frame" style="font-size:13px; line-height:1.7"></div>`;

    mountStageTimeline();

    // The threshold is display-only — it recolors and recounts, it never feeds
    // the metric — so nothing needs recomputing when it moves.
    host.querySelector("#sws-thr").addEventListener("input", e => {
      cfg.narrowThreshold = parseFloat(e.target.value);
      host.querySelector("#sws-thr-out").textContent = cfg.narrowThreshold.toFixed(2);
      updateTimelineLegend();
      refresh();
    });

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
           Horizontal distance is only the stagger when the camera is side-on.
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
           below ${cfg.narrowThreshold.toFixed(2)}
           <span class="muted">(raw frames — no sustained-duration logic here)</span></div>
         <div class="muted small" style="margin-top:3px">
           depth-aligned (v5 gate)
           <code style="color:${r.nBoost ? C_BOOST : "inherit"}">${r.nBoost}</code>
           of them${r.nBoost
             ? ` — <span style="color:${C_BOOST}">expected ~0 on side-on footage;
                 Δx is undercounting the stagger there</span>`
             : " — as expected: nothing here is pointing at the camera"}</div>`;

    drawHistogram(host.querySelector("#sws-hist"), r);

    const f = state.frame;
    if (frameEl) {
      const inSpan = !!c.inSpan[f];
      const on = counted(c, f);
      const th = frameTorsoPx(c.pose, f);
      frameEl.innerHTML = `
        <div><strong>stagger</strong>
          <code style="color:${!Number.isFinite(c.sep[f]) ? C_OUT
                             : c.sep[f] < cfg.narrowThreshold ? C_NARROW : C_SEP}">
            ${fmt(c.sep[f])}</code>
          <span class="muted">= Δx ${fmt(c.sep[f] * th, 0)}px / torso ${fmt(th, 0)}px</span></div>
        <div class="muted small">dropped Δy <code>${fmt(c.dy[f], 2)}</code>
          <span class="muted">(one foot lower in frame)</span> ·
          full euclidean <code>${fmt(c.euclid[f], 2)}</code>
          <span class="muted">= what the rule uses</span></div>
        <div class="muted small">smoothed Δy/Δx
          <code style="color:${c.axisRatio[f] > CORR.ratioGate ? C_BOOST : "inherit"}">
            ${fmt(c.axisRatio[f], 2)}</code>
          <span class="muted">(above ${CORR.ratioGate} ⇒ depth-aligned, Δx undercounts)</span></div>
        <div class="muted small">
          <span style="color:${inSpan ? C_SPAN : C_OUT}">${inSpan ? "in span" : "outside span"}</span> ·
          <span style="color:${c.valid[f] ? C_SEP : C_OUT}">${c.valid[f] ? "pose valid" : "gated out"}</span> ·
          ${on ? "counted" : "not counted"}</div>`;
    }

    drawTimeline(document.getElementById("sws-timeline"), c, f);
  },

  // Draw what the ratio is made of, so the number is checkable against the
  // picture: the HORIZONTAL gap between the ankles (the numerator) with its
  // value over it, the direct ankle line behind it so the dropped Δy is
  // visible, and the torso segment (the denominator).
  //
  // Drawn on EVERY frame of a side-set video, spans or not. The spans decide
  // what gets counted into the statistics, not what you are allowed to look at
  // — a frame you cannot see a number on is a frame you cannot judge. Frames
  // outside a span (or below the confidence gate) are tagged instead of hidden.
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
    const color = c.sep[f] < cfg.narrowThreshold ? C_NARROW : C_SEP;

    ctx.save();

    // denominator
    ctx.strokeStyle = C_TORSO;
    ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.moveTo(shx, shy); ctx.lineTo(hpx, hpy); ctx.stroke();

    // the ankle-to-ankle line the rule would measure — faint, because the Δy
    // in it is exactly what this lens throws away
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1.5 * s;
    ctx.setLineDash([4 * s, 3 * s]);
    ctx.beginPath(); ctx.moveTo(lax, lay); ctx.lineTo(rax, ray); ctx.stroke();
    ctx.setLineDash([]);

    // the horizontal gap: a baseline under the lower foot, with drop lines from
    // each ankle so the projection onto image-x is explicit
    const gy = Math.max(lay, ray) + 22 * s;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 * s;
    ctx.setLineDash([3 * s, 3 * s]);
    ctx.beginPath(); ctx.moveTo(lax, lay); ctx.lineTo(lax, gy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rax, ray); ctx.lineTo(rax, gy); ctx.stroke();
    ctx.setLineDash([]);

    ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.moveTo(lax, gy); ctx.lineTo(rax, gy); ctx.stroke();
    ctx.lineWidth = 2 * s;
    for (const x of [lax, rax]) {
      ctx.beginPath(); ctx.moveTo(x, gy - 5 * s); ctx.lineTo(x, gy + 5 * s); ctx.stroke();
    }

    // value over the gap
    const label = `${c.sep[f].toFixed(2)} torso`;
    const fsz = Math.round(13 * s);
    ctx.font = `600 ${fsz}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    const w = ctx.measureText(label).width + 12 * s;
    const lx = (lax + rax) / 2 - w / 2, ly = gy - fsz - 16 * s;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath(); ctx.roundRect(lx, ly, w, fsz + 10 * s, 5 * s); ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(label, lx + 6 * s, ly + 5 * s);

    // why this frame is not in the stats, said plainly rather than by fading
    if (!counted(c, f)) {
      const why = !c.valid[f] ? "below confidence gate"
                : (cfg.spansOnly && !c.inSpan[f]) ? "outside curated span" : "not counted";
      const sm = Math.round(10 * s);
      ctx.font = `${sm}px ui-monospace, monospace`;
      const ww = ctx.measureText(why).width + 10 * s;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath(); ctx.roundRect((lax + rax) / 2 - ww / 2, gy + 8 * s, ww, sm + 8 * s, 4 * s); ctx.fill();
      ctx.fillStyle = C_OUT;
      ctx.fillText(why, (lax + rax) / 2 - ww / 2 + 5 * s, gy + 12 * s);
    }
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

// Shared full-scale for both charts, so a height on the timeline and a position
// on the histogram mean the same separation. Beyond 1.5 torso lengths is a pose
// failure rather than a stance, so it is the top of the axis.
const SEP_MAX = 1.5;
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
    const i = Math.min(HIST_BINS - 1, Math.max(0, Math.floor(v / SEP_MAX * HIST_BINS)));
    bins[i]++;
  }
  const peak = Math.max(...bins);
  const bw = W / HIST_BINS;
  const axisH = 13;
  const xOf = v => (v / SEP_MAX) * W;

  // same quarter-torso ticks as the timeline's y axis, so the two charts read
  // against one scale
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "center";
  for (let v = 0; v <= SEP_MAX + 1e-9; v += TICK_STEP) {
    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xOf(v), 0); ctx.lineTo(xOf(v), H - axisH); ctx.stroke();
    ctx.fillStyle = C_OUT;
    const x = Math.min(W - 12, Math.max(12, xOf(v)));
    ctx.fillText(v.toFixed(2), x, H - 2);
  }
  ctx.textAlign = "left";

  for (let i = 0; i < HIST_BINS; i++) {
    const v = (i + 0.5) / HIST_BINS * SEP_MAX;
    const h = peak ? (bins[i] / peak) * (H - axisH) : 0;
    ctx.fillStyle = v < cfg.narrowThreshold ? C_NARROW : C_SEP;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(i * bw, H - axisH - h, Math.max(1, bw - 1), h);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = C_NARROW;
  ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(xOf(cfg.narrowThreshold), 0);
  ctx.lineTo(xOf(cfg.narrowThreshold), H - axisH); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "#fff";
  ctx.beginPath(); ctx.moveTo(xOf(r.med), 0); ctx.lineTo(xOf(r.med), H - axisH); ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.fillText(`med ${fmt(r.med, 2)}`, Math.min(W - 54, xOf(r.med) + 3), 9);
}

// ── below-video timeline ────────────────────────────────────────────────────

// Wide enough for a "1.25" tick label plus its tick mark.
const TL_LABEL_W = 46;
// Tall enough that the gridlines are far enough apart to read a value off the
// trace by eye — the point of the axis.
const TL_HEIGHT = 170;
// Gridline every quarter torso length: the granularity you can actually judge
// a stance at, and it puts a line on the shipped 0.5 threshold.
const TICK_STEP = 0.25;

function updateTimelineLegend() {
  const el = document.getElementById("sws-tl-legend");
  if (!el) return;
  el.innerHTML = `Foot stagger (horizontal Δx) —
    <span style="color:${C_SEP}">torso lengths</span> on the y axis,
    <span style="color:${C_NARROW}">below ${cfg.narrowThreshold.toFixed(2)}</span>,
    faded outside a <span style="color:${C_SPAN}">curated span</span> · click to seek`;
}

function mountStageTimeline() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:12px;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px";
  const label = document.createElement("div");
  label.className = "muted small";
  label.id = "sws-tl-legend";
  label.style.cssText = "margin-bottom:6px";
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = "sws-timeline";
  canvas.style.cssText = `display:block;width:100%;height:${TL_HEIGHT}px`;
  canvas.width = 800; canvas.height = TL_HEIGHT;
  wrap.appendChild(canvas);
  slot.appendChild(wrap);
  updateTimelineLegend();
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
  const top = 8, barH = H - 16 - spanH;
  const yOf = v => top + barH - Math.min(1, v / SEP_MAX) * barH;

  ctx.font = "10px ui-monospace, monospace";

  // y axis FIRST, under the trace: a gridline + value every quarter torso
  // length, so a bar's height reads straight off as a separation.
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (let v = 0; v <= SEP_MAX + 1e-9; v += TICK_STEP) {
    const y = yOf(v);
    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(TL_LABEL_W, y); ctx.lineTo(W - 4, y); ctx.stroke();
    ctx.fillStyle = C_OUT;
    ctx.fillText(v.toFixed(2), TL_LABEL_W - 5, y);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  for (let f = 0; f < N; f++) {
    const v = c.sep[f];
    if (!Number.isFinite(v)) continue;
    const on = counted(c, f);
    ctx.fillStyle = v < cfg.narrowThreshold ? C_NARROW : C_SEP;
    ctx.globalAlpha = on ? 0.9 : 0.18;
    ctx.fillRect(xOf(f), yOf(v), colW + 0.5, top + barH - yOf(v));
  }
  ctx.globalAlpha = 1;

  // threshold line, drawn over the trace and labelled, so "narrow" is readable
  // without counting gridlines
  const ty = yOf(cfg.narrowThreshold);
  ctx.strokeStyle = C_NARROW;
  ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(TL_LABEL_W, ty); ctx.lineTo(W - 4, ty); ctx.stroke();
  ctx.setLineDash([]);
  const tLabel = `narrow < ${cfg.narrowThreshold.toFixed(2)}`;
  ctx.font = "600 10px ui-monospace, monospace";
  const tw = ctx.measureText(tLabel).width;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(W - 8 - tw - 4, ty - 11, tw + 6, 12);
  ctx.fillStyle = C_NARROW;
  ctx.fillText(tLabel, W - 8 - tw - 1, ty - 2);
  ctx.font = "10px ui-monospace, monospace";

  // current value as a dot on the trace — the anchor between the picture on
  // screen and a height on this axis
  const cv = c.sep[frame];
  if (Number.isFinite(cv)) {
    ctx.fillStyle = C_FRAME;
    ctx.beginPath(); ctx.arc(xOf(frame), yOf(cv), 3, 0, Math.PI * 2); ctx.fill();
    const lbl = cv.toFixed(2);
    const lw = ctx.measureText(lbl).width;
    const lx = Math.min(W - lw - 6, Math.max(TL_LABEL_W + 2, xOf(frame) + 6));
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(lx - 2, yOf(cv) - 13, lw + 4, 12);
    ctx.fillStyle = C_FRAME;
    ctx.fillText(lbl, lx, yOf(cv) - 4);
  }

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
