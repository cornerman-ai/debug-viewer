// Stance DEPTH on the side set — how deep the stance is front-to-back, i.e. how
// far in front of the other one foot is, measured as HORIZONTAL ankle distance
// in leg lengths (default) or torso lengths.
//
// Named for the coaching sense of depth (fore-aft extent of the stance), which
// is the opposite axis from stance WIDTH — the shipped rule measures the full
// euclidean ankle distance and calls it width. Do not confuse either with
// "camera-aligned" below, which is about the stance line pointing AT the lens.
//
// It lives in rules/ rather than research/ because it is built on the
// stance_width port and is a workbench for that family; there is no
// ml/research/ topic behind it.
//
// The question is how far in FRONT of the other one foot is, so the numerator is
// strictly the horizontal component, |ankle_L.x − ankle_R.x|. Horizontal only,
// on purpose: side-on, the boxer's fore-aft axis lies along image-x, so Δx is
// the depth and Δy is just one foot sitting lower in frame (ground plane,
// perspective, a heel lifting). The shipped stance_width rule takes the full
// euclidean ankle distance, which folds that Δy in; here it is dropped rather
// than measured, and both are shown per frame so the difference stays visible.
//
// TWO DENOMINATORS, switchable, both always reported:
//
//   torso height   shoulder midpoint → hip midpoint. What the rule ships.
//   leg length     |hip−knee| + |knee−ankle|, averaged over whichever legs
//                  pass the confidence gate. Summed per segment, so knee bend
//                  does not shorten it in 3D.
//
// Leg length is the DEFAULT (0.50, 2026-08-08) and the better denominator in
// principle — the stance is set by the legs, and torso/leg proportion varies
// enough between people that a torso-normalized depth mislabels the
// long-legged. What that choice costs, and none of it is fixed by picking it:
//
//  1. The ankles move into the DENOMINATOR. Torso height is independent of the
//     ankles, so numerator and denominator carry independent errors. With leg
//     length a bad ankle keypoint moves both at once — the ratio can sit still
//     while both are wrong, or jump when the ankle jumps.
//  2. It is articulated, and 2D projection does not care that the segments are
//     rigid. A knee driving toward the camera foreshortens the thigh; the
//     torso, held upright, is far more stable frame to frame. Expect a noisier
//     denominator, especially through steps.
//  3. Left and right legs project differently (different depth, different
//     flexion), so the two legs disagree. Averaging halves the noise but
//     hides the disagreement; `legs` on the frame row says how many
//     contributed.
//  4. Knees are noisier keypoints than hips and shoulders — loose shorts, fast
//     steps — and requiring them drops frames the torso metric would keep.
//  5. Every tuned number in the project (narrow_threshold 0.5, the severity
//     bands, the Swift port, the labeled evaluations) is on the torso ratio.
//     These two do not differ by a constant across people — that is the whole
//     point — so switching is a re-tune, not a rescale.
//  6. It relocates the anthropometric problem rather than removing it: femur
//     and tibia proportions vary too. Coaches usually teach stance width
//     against SHOULDER width, which would be the natural third denominator —
//     and is exactly the one this set cannot supply, because side-on the
//     shoulders are foreshortened to nearly nothing.
//
// One thing genuinely in leg length's favor beyond proportions: with the camera
// above ankle height, the legs sit at roughly the same depth as the ankle gap
// they normalize, while the torso is further away — so the leg ratio has less
// residual perspective bias in it.
//
// The `leg / torso` row is the thing to actually watch: it is this boxer's
// proportion, measured. If it swings clip to clip, that is the variation the
// torso denominator is silently pushing into the metric.
//
// Not re-derived: the torso denominator, the horizontal component and the
// frame-validity pipeline (confidence gate → temporal cleanup → knee/ankle
// sanity) all come from ./stance_width.js. The leg denominator and the choice
// of numerator are this lens's own.
//
// Video list is gated to the side set (../shared/side_set.js).

import { J } from "../../skeleton.js";
import { resolveRanges } from "../shared/segment_set.js";
import { isCuratedVideo, matchEntry, sideSetReady } from "../shared/side_set.js";
import {
  CORR, DEFAULT_CONFIG, computeDxDy, detectStanceWidth, rollingMedian,
} from "./stance_width.js";

const C_SEP    = "#7adf7a";  // the metric
const C_NARROW = "#ff5d6c";  // below the threshold
const C_TORSO  = "#7ec8ff";  // torso segment (denominator)
const C_LEG    = "#ffd95c";  // leg chain (denominator)
const C_SPAN   = "#b48cff";  // curated span
const C_OUT    = "#888";
const C_FRAME  = "#3ad9e0";
const C_BOOST  = "#e08aff";  // frames the v5 gate calls camera-aligned

// Per-denominator axis + threshold. The leg ratio lives on a smaller scale than
// the torso one (legs are the longer segment), so it gets its own full-scale
// rather than being squeezed into the bottom third of the torso axis.
const DENOMS = {
  torso: {
    label: "torso height", short: "torso", color: C_TORSO,
    axisMax: 1.5, tick: 0.25,
    // What the rule ships, and what every tuned number in the project is on.
    defaultThreshold: DEFAULT_CONFIG.narrowThreshold,
  },
  leg: {
    label: "leg length", short: "leg", color: C_LEG,
    axisMax: 1.0, tick: 0.25,
    // The working default as of 2026-08-08, chosen by eye off this lens — NOT
    // a calibration. Nothing has been labeled or tuned on the leg axis, and
    // 0.5 leg is a markedly deeper stance than the rule's 0.5 torso (leg runs
    // ~1.5-2x torso height, so it is a much larger denominator). Read the
    // measured `leg / torso` row before carrying this number anywhere else.
    defaultThreshold: 0.5,
  },
};

// Settings survive a video change, a round change and a page reload — this lens
// is for sweeping a threshold across the set, and re-dialing it every time the
// footage changes would defeat that.
const STORE_KEY = "cornerman.lens.stance_depth_side.v2";

const cfg = {
  // Leg length is the working denominator (2026-08-08). Torso stays one click
  // away because it is what the shipped rule and every tuned number use.
  denom: "leg",
  minConfidence: DEFAULT_CONFIG.minConfidence,
  spansOnly: true,
  // Per denominator: the two axes are not interchangeable, so a threshold set
  // on one must not follow you onto the other.
  thresholds: { torso: DENOMS.torso.defaultThreshold, leg: DENOMS.leg.defaultThreshold },
};

(function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!saved) return;
    if (saved.denom in DENOMS) cfg.denom = saved.denom;
    if (Number.isFinite(saved.minConfidence)) cfg.minConfidence = saved.minConfidence;
    if (typeof saved.spansOnly === "boolean") cfg.spansOnly = saved.spansOnly;
    for (const k of Object.keys(cfg.thresholds)) {
      if (Number.isFinite(saved.thresholds?.[k])) cfg.thresholds[k] = saved.thresholds[k];
    }
  } catch { /* corrupt or unavailable storage ⇒ defaults, never a broken lens */ }
})();

function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch { /* private mode */ }
}

const denomCfg = () => DENOMS[cfg.denom];
const threshold = () => cfg.thresholds[cfg.denom];

const pickPose = state => state.poseV6 || state.pose;

let host;
let mc = { pose: null };

// ── metrics ─────────────────────────────────────────────────────────────────

const LEGS = [
  [J.L_HIP, J.L_KNEE, J.L_ANKLE],
  [J.R_HIP, J.R_KNEE, J.R_ANKLE],
];

function computeMetrics(state) {
  const pose = pickPose(state);
  if (!pose) return null;
  const basename = state.cacheBasename || null;
  if (mc.pose === pose && mc.basename === basename && mc.round === state.cacheRound
      && mc.fps === state.fps && mc.minConf === cfg.minConfidence) return mc;

  const n = pose.n_frames;
  const fps = pose.fps || state.fps || 30;
  const sk = pose.skeleton, conf = pose.conf;

  // The shipped pipeline, for its frame-validity mask (confidence gate →
  // temporal cleanup → knee/ankle sanity) and, for comparison only, its full
  // euclidean ankle ratio.
  const out = detectStanceWidth(sk, conf, n, fps,
                                { ...DEFAULT_CONFIG, minConfidence: cfg.minConfidence });
  const valid = out.debug.validMask;
  const euclid = out.debug.sepRatios;

  // dx / dy are the ankle line's components over torso height, from the same
  // lens. dx IS the torso-normalized depth.
  const { dx, dy } = computeDxDy(pose);

  const dxPx = new Array(n).fill(NaN);
  const torsoPx = new Array(n).fill(NaN);
  const legPx = new Array(n).fill(NaN);
  const legN = new Array(n).fill(0);
  const legRatio = new Array(n).fill(NaN);
  const legOverTorso = new Array(n).fill(NaN);

  for (let f = 0; f < n; f++) {
    const base = f * 17;
    const at = j => [sk[(base + j) * 2], sk[(base + j) * 2 + 1]];
    const cAt = j => conf[base + j];

    dxPx[f] = Math.abs(sk[(base + J.L_ANKLE) * 2] - sk[(base + J.R_ANKLE) * 2]);
    torsoPx[f] = frameTorsoPx(pose, f);

    // Sum the segments rather than measuring hip→ankle: a bent knee shortens
    // the straight line but not the leg.
    let sum = 0, k = 0;
    for (const [hip, knee, ank] of LEGS) {
      if (!(cAt(hip) > cfg.minConfidence && cAt(knee) > cfg.minConfidence
            && cAt(ank) > cfg.minConfidence)) continue;
      const [hx, hy] = at(hip), [kx, ky] = at(knee), [ax, ay] = at(ank);
      const d = Math.hypot(hx - kx, hy - ky) + Math.hypot(kx - ax, ky - ay);
      if (d > 1e-6) { sum += d; k++; }
    }
    if (k) {
      legPx[f] = sum / k;
      legN[f] = k;
      legRatio[f] = dxPx[f] / legPx[f];
      if (torsoPx[f] > 1e-6) legOverTorso[f] = legPx[f] / torsoPx[f];
    }
  }

  // Δy/Δx of the ankle line, smoothed exactly as v5 smooths it, and used only
  // to warn that a stretch is camera-aligned. It never changes the metric.
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
         n, valid, euclid, dx, dy, dxPx, torsoPx, legPx, legN, legRatio, legOverTorso,
         axisRatio, entry, inSpan, ranges, nIn };
  return mc;
}

// The active series — what the charts, the threshold and the overlay read.
const series = c => (cfg.denom === "leg" ? c.legRatio : c.dx);

// A frame counts when the pose is trustworthy, the active metric exists (leg
// needs knees the torso metric does not), and — with spans-only — it sits
// inside a curated span. Everything the panel reports is over counted frames.
function counted(c, f) {
  if (!c.valid[f] || !Number.isFinite(series(c)[f])) return false;
  if (cfg.spansOnly && !(c.entry && c.inSpan[f])) return false;
  return true;
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    n: sorted.length, sorted,
    med: quantile(sorted, 0.5), p25: quantile(sorted, 0.25), p75: quantile(sorted, 0.75),
    min: sorted[0], max: sorted[sorted.length - 1],
  };
}

function rollup(c) {
  const act = series(c);
  const frames = [];
  for (let f = 0; f < c.n; f++) if (counted(c, f)) frames.push(f);
  const active = stats(frames.map(f => act[f]));
  return {
    frames, active,
    // Both denominators over the SAME frames, so the comparison is like for
    // like rather than two different samples.
    leg: stats(frames.map(f => c.legRatio[f])),
    torso: stats(frames.map(f => c.dx[f])),
    ratio: stats(frames.map(f => c.legOverTorso[f])),
    nNarrow: frames.filter(f => act[f] < threshold()).length,
    nBoost: frames.filter(f => c.axisRatio[f] > CORR.ratioGate).length,
  };
}

const fmt = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "—");

// ── lens ────────────────────────────────────────────────────────────────────

export const StanceDepthSideRule = {
  id: "stance_depth_side",
  label: "Stance depth — side set",

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
                                J.L_KNEE, J.R_KNEE, J.L_ANKLE, J.R_ANKLE]),
    };
  },

  mount(_host) {
    host = _host;
    mc = { pose: null };
    host.innerHTML = `
      <h2>Stance depth — side set</h2>
      <p class="hint">
        <code>|Δx ankles| / denominator</code> — <strong>horizontal only</strong>:
        how far in front of the other one foot is. Side-on the fore-aft axis lies
        along image-x, so Δy is just one foot lower in frame and is dropped, not
        measured. Both denominators are always reported; the selected one drives
        the charts, the threshold and the overlay.
        <span style="color:${C_SEP}">wide</span> ·
        <span style="color:${C_NARROW}">below the threshold</span> ·
        <span style="color:${C_LEG}">leg chain</span> ·
        <span style="color:${C_TORSO}">torso</span>.
      </p>

      <label style="display:block; font-size:12px">normalize by
        <select id="sds-denom" style="margin-left:4px">
          <option value="leg">leg length (hip→knee→ankle)</option>
          <option value="torso">torso height (what the rule ships)</option>
        </select></label>

      <label class="slider-row" style="display:block; font-size:12px; margin-top:5px">
        narrow below = <output id="sds-thr-out"></output>
        <span class="muted" id="sds-thr-unit"></span>
        <input type="range" id="sds-thr" min="0.05" max="1.20" step="0.01"></label>
      <label class="slider-row" style="display:block; font-size:12px">
        min confidence = <output id="sds-conf-out">${cfg.minConfidence.toFixed(2)}</output>
        <input type="range" id="sds-conf" min="0" max="0.95" step="0.05"
               value="${cfg.minConfidence}"></label>
      <label style="display:block; font-size:12px; margin-top:4px">
        <input type="checkbox" id="sds-spans" ${cfg.spansOnly ? "checked" : ""}>
        curated spans only</label>

      <h3>This round</h3>
      <div id="sds-round" style="font-size:13px; line-height:1.6"></div>

      <h3>Distribution <span class="muted small">(counted frames)</span></h3>
      <canvas id="sds-hist" style="display:block; width:100%; height:120px"></canvas>

      <h3>Current frame</h3>
      <div id="sds-frame" style="font-size:13px; line-height:1.7"></div>`;

    mountStageTimeline();

    const denomSel = host.querySelector("#sds-denom");
    denomSel.value = cfg.denom;
    denomSel.addEventListener("change", e => {
      cfg.denom = e.target.value;
      persist();
      syncThresholdControl();
      updateTimelineLegend();
      refresh();
    });

    // The threshold is display-only — it recolors and recounts, it never feeds
    // the metric — so nothing needs recomputing when it moves.
    host.querySelector("#sds-thr").addEventListener("input", e => {
      cfg.thresholds[cfg.denom] = parseFloat(e.target.value);
      persist();
      syncThresholdControl();
      updateTimelineLegend();
      refresh();
    });
    syncThresholdControl();

    host.querySelector("#sds-conf").addEventListener("input", e => {
      cfg.minConfidence = parseFloat(e.target.value);
      host.querySelector("#sds-conf-out").textContent = cfg.minConfidence.toFixed(2);
      persist();
      mc = { pose: null };            // gate changed ⇒ valid mask and legs changed
      refresh();
    });
    host.querySelector("#sds-spans").addEventListener("change", e => {
      cfg.spansOnly = e.target.checked; persist(); refresh();
    });

    sideSetReady.then(() => { mc = { pose: null }; refresh(); });
  },

  update(state) {
    if (!host || !state) return;
    const c = computeMetrics(state);
    const roundEl = host.querySelector("#sds-round");
    const frameEl = host.querySelector("#sds-frame");
    if (!roundEl) return;
    if (!c) { roundEl.innerHTML = `<p class="muted">No pose cache loaded.</p>`; return; }

    if (!c.entry) {
      roundEl.innerHTML =
        `<div style="color:${C_NARROW}; font-weight:600">Not in the side set</div>
         <div class="muted small" style="margin-top:3px">
           Horizontal distance is only stance depth when the camera is side-on.
           <code>${c.basename || "this video"}</code> isn't in
           <code>side_segments.json</code>, so nothing is measured.</div>`;
      if (frameEl) frameEl.innerHTML = `<span class="muted">—</span>`;
      drawHistogram(host.querySelector("#sds-hist"), null);
      drawTimeline(document.getElementById("sds-timeline"), c, state.frame);
      return;
    }

    const r = rollup(c);
    const D = denomCfg();
    const row = (key, s) => {
      const on = cfg.denom === key;
      const d = DENOMS[key];
      return `<div style="${on ? "" : "opacity:.72"}">
        <span style="color:${d.color}">${on ? "▸" : " "} ${d.short}</span>
        <code style="color:${on && s.med < threshold() ? C_NARROW : C_SEP}">${fmt(s.med)}</code>
        <span class="muted small">IQR ${fmt(s.p25, 2)}–${fmt(s.p75, 2)} ·
          range ${fmt(s.min, 2)}–${fmt(s.max, 2)}${s.n !== r.frames.length ? ` · n=${s.n}` : ""}</span>
      </div>`;
    };

    roundEl.innerHTML = r.frames.length === 0
      ? `<span class="muted">No frames counted — ${cfg.spansOnly
           ? "no curated span falls in this round (try another round, or untick spans-only)"
           : "the confidence gate rejected every frame"
         }${cfg.denom === "leg" ? ", or the knees never passed the gate" : ""}.</span>`
      : `${row("leg", r.leg)}
         ${row("torso", r.torso)}
         <div class="muted small" style="margin-top:2px">
           leg / torso <code>${fmt(r.ratio.med, 2)}</code>
           <span class="muted">this boxer's proportion — the thing the torso
             denominator varies with (IQR ${fmt(r.ratio.p25, 2)}–${fmt(r.ratio.p75, 2)})</span></div>
         <div class="muted small" style="margin-top:4px">${r.frames.length} frames counted
           (${(100 * r.frames.length / c.n).toFixed(1)}% of the round) ·
           ${cfg.spansOnly ? `${c.nIn} in span` : "whole round"}</div>
         <div class="muted small">
           <code style="color:${r.nNarrow ? C_NARROW : "inherit"}">${r.nNarrow}</code>
           below ${threshold().toFixed(2)} ${D.short}
           <span class="muted">(raw frames — no sustained-duration logic here)</span></div>
         <div class="muted small" style="margin-top:3px">
           camera-aligned (v5 gate)
           <code style="color:${r.nBoost ? C_BOOST : "inherit"}">${r.nBoost}</code>
           of them${r.nBoost
             ? ` — <span style="color:${C_BOOST}">expected ~0 on side-on footage;
                 Δx is undercounting the depth there</span>`
             : " — as expected: nothing here is pointing at the camera"}</div>`;

    drawHistogram(host.querySelector("#sds-hist"), r.active);

    const f = state.frame;
    if (frameEl) {
      const inSpan = !!c.inSpan[f];
      const on = counted(c, f);
      const val = series(c)[f];
      const frameRow = (key, v, denomPx) => {
        const d = DENOMS[key];
        const sel = cfg.denom === key;
        return `<div style="${sel ? "" : "opacity:.72"}">
          <span style="color:${d.color}">${sel ? "▸" : " "} ${d.short}</span>
          <code style="color:${!Number.isFinite(v) ? C_OUT
                             : sel && v < threshold() ? C_NARROW : C_SEP}">${fmt(v)}</code>
          <span class="muted">= Δx ${fmt(c.dxPx[f], 0)}px / ${fmt(denomPx, 0)}px</span></div>`;
      };
      frameEl.innerHTML = `
        ${frameRow("leg", c.legRatio[f], c.legPx[f])}
        ${frameRow("torso", c.dx[f], c.torsoPx[f])}
        <div class="muted small">legs used <code>${c.legN[f]}</code>/2 ·
          leg / torso <code>${fmt(c.legOverTorso[f], 2)}</code></div>
        <div class="muted small">dropped Δy <code>${fmt(c.dy[f], 2)}</code>
          <span class="muted">(one foot lower in frame)</span> ·
          full euclidean <code>${fmt(c.euclid[f], 2)}</code>
          <span class="muted">= what the rule uses</span></div>
        <div class="muted small">smoothed Δy/Δx
          <code style="color:${c.axisRatio[f] > CORR.ratioGate ? C_BOOST : "inherit"}">
            ${fmt(c.axisRatio[f], 2)}</code>
          <span class="muted">(above ${CORR.ratioGate} ⇒ pointing at the camera, Δx undercounts)</span></div>
        <div class="muted small">
          <span style="color:${inSpan ? C_SPAN : C_OUT}">${inSpan ? "in span" : "outside span"}</span> ·
          <span style="color:${c.valid[f] ? C_SEP : C_OUT}">${c.valid[f] ? "pose valid" : "gated out"}</span> ·
          ${on ? "counted" : "not counted"}
          <span class="muted">· ${fmt(val)} ${denomCfg().short}</span></div>`;
    }

    drawTimeline(document.getElementById("sds-timeline"), c, f);
  },

  // Draw what the ratio is made of, so the number is checkable against the
  // picture: the HORIZONTAL gap between the ankles (the numerator) with its
  // value over it, the direct ankle line behind it so the dropped Δy is
  // visible, and the active denominator — the torso segment, or the hip→knee→
  // ankle chain.
  //
  // Drawn on EVERY frame of a side-set video, spans or not. The spans decide
  // what gets counted into the statistics, not what you are allowed to look at
  // — a frame you cannot see a number on is a frame you cannot judge. Frames
  // outside a span (or below the confidence gate) are tagged instead of hidden.
  draw(ctx, state) {
    const c = computeMetrics(state);
    if (!c || !c.entry) return;
    const f = state.frame;
    // The gap is drawn whenever the ankles exist. The active DENOMINATOR may
    // still be missing (leg length needs knees the torso metric does not) — in
    // that case the line stays, with a dash where the number would be, rather
    // than the overlay vanishing on you mid-scrub.
    if (!Number.isFinite(c.dxPx[f])) return;
    const val = series(c)[f];
    const hasVal = Number.isFinite(val);
    const s = state.renderScale || 1;
    const sk = c.pose.skeleton, base = f * 17;
    const px = j => [sk[(base + j) * 2] * s, sk[(base + j) * 2 + 1] * s];

    const [lax, lay] = px(J.L_ANKLE), [rax, ray] = px(J.R_ANKLE);
    const color = !hasVal ? C_OUT : val < threshold() ? C_NARROW : C_SEP;

    ctx.save();

    // the active denominator, drawn so it is obvious which one the number is on
    ctx.lineWidth = 3 * s;
    if (cfg.denom === "leg") {
      ctx.strokeStyle = C_LEG;
      for (const [hip, knee, ank] of LEGS) {
        const [hx, hy] = px(hip), [kx, ky] = px(knee), [ax, ay] = px(ank);
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.lineTo(ax, ay); ctx.stroke();
      }
    } else {
      const [lsx, lsy] = px(J.L_SHOULDER), [rsx, rsy] = px(J.R_SHOULDER);
      const [lhx, lhy] = px(J.L_HIP), [rhx, rhy] = px(J.R_HIP);
      ctx.strokeStyle = C_TORSO;
      ctx.beginPath();
      ctx.moveTo((lsx + rsx) / 2, (lsy + rsy) / 2);
      ctx.lineTo((lhx + rhx) / 2, (lhy + rhy) / 2);
      ctx.stroke();
    }

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

    // value over the gap, naming its denominator — two numbers are in play and
    // an unlabeled one is a number you cannot use
    const label = `${hasVal ? val.toFixed(2) : "—"} ${denomCfg().short}`;
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
      const why = !hasVal ? `no ${denomCfg().short} denominator`
                : !c.valid[f] ? "below confidence gate"
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

function syncThresholdControl() {
  if (!host) return;
  const D = denomCfg();
  const sl = host.querySelector("#sds-thr");
  if (sl) { sl.max = D.axisMax.toFixed(2); sl.value = threshold(); }
  const out = host.querySelector("#sds-thr-out");
  if (out) out.textContent = threshold().toFixed(2);
  const unit = host.querySelector("#sds-thr-unit");
  if (unit) {
    unit.textContent = cfg.denom === "leg"
      ? `${D.short} lengths (working default ${DENOMS.leg.defaultThreshold}, by eye — nothing tuned on this axis)`
      : `${D.short} lengths (rule ships ${DENOMS.torso.defaultThreshold})`;
  }
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

const HIST_BINS = 30;

function drawHistogram(canvas, s) {
  if (!canvas) return;
  const { ctx, W, H } = fitCanvas(canvas);
  if (!s || !s.n) {
    ctx.fillStyle = C_OUT;
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText("no counted frames", 4, H / 2);
    return;
  }
  const D = denomCfg();
  const bins = new Array(HIST_BINS).fill(0);
  for (const v of s.sorted) {
    const i = Math.min(HIST_BINS - 1, Math.max(0, Math.floor(v / D.axisMax * HIST_BINS)));
    bins[i]++;
  }
  const peak = Math.max(...bins);
  const bw = W / HIST_BINS;
  const axisH = 13;
  const xOf = v => (v / D.axisMax) * W;

  // same ticks as the timeline's y axis, so the two charts read against one
  // scale
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "center";
  for (let v = 0; v <= D.axisMax + 1e-9; v += D.tick) {
    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xOf(v), 0); ctx.lineTo(xOf(v), H - axisH); ctx.stroke();
    ctx.fillStyle = C_OUT;
    ctx.fillText(v.toFixed(2), Math.min(W - 12, Math.max(12, xOf(v))), H - 2);
  }
  ctx.textAlign = "left";

  for (let i = 0; i < HIST_BINS; i++) {
    const v = (i + 0.5) / HIST_BINS * D.axisMax;
    const h = peak ? (bins[i] / peak) * (H - axisH) : 0;
    ctx.fillStyle = v < threshold() ? C_NARROW : C_SEP;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(i * bw, H - axisH - h, Math.max(1, bw - 1), h);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = C_NARROW;
  ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(xOf(threshold()), 0); ctx.lineTo(xOf(threshold()), H - axisH); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "#fff";
  ctx.beginPath(); ctx.moveTo(xOf(s.med), 0); ctx.lineTo(xOf(s.med), H - axisH); ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.fillText(`med ${fmt(s.med, 2)}`, Math.min(W - 54, xOf(s.med) + 3), 9);
}

// ── below-video timeline ────────────────────────────────────────────────────

// Wide enough for a "1.25" tick label plus its tick mark.
const TL_LABEL_W = 46;
// Tall enough that the gridlines are far enough apart to read a value off the
// trace by eye — the point of the axis.
const TL_HEIGHT = 170;

function updateTimelineLegend() {
  const el = document.getElementById("sds-tl-legend");
  if (!el) return;
  el.innerHTML = `Stance depth (horizontal Δx) —
    <span style="color:${denomCfg().color}">${denomCfg().label}</span> on the y axis,
    <span style="color:${C_NARROW}">below ${threshold().toFixed(2)}</span>,
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
  label.id = "sds-tl-legend";
  label.style.cssText = "margin-bottom:6px";
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = "sds-timeline";
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
  const D = denomCfg();
  const act = series(c);

  const xOf = f => TL_LABEL_W + (f / Math.max(1, N - 1)) * (W - TL_LABEL_W - 4);
  const colW = Math.max(1, (W - TL_LABEL_W - 4) / Math.max(1, N - 1));
  const spanH = 6;
  const top = 8, barH = H - 16 - spanH;
  const yOf = v => top + barH - Math.min(1, v / D.axisMax) * barH;

  ctx.font = "10px ui-monospace, monospace";

  // y axis FIRST, under the trace: a gridline + value every tick, so a bar's
  // height reads straight off as a separation.
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (let v = 0; v <= D.axisMax + 1e-9; v += D.tick) {
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
    const v = act[f];
    if (!Number.isFinite(v)) continue;
    const on = counted(c, f);
    ctx.fillStyle = v < threshold() ? C_NARROW : C_SEP;
    ctx.globalAlpha = on ? 0.9 : 0.18;
    ctx.fillRect(xOf(f), yOf(v), colW + 0.5, top + barH - yOf(v));
  }
  ctx.globalAlpha = 1;

  // threshold line, drawn over the trace and labelled, so "narrow" is readable
  // without counting gridlines
  const ty = yOf(threshold());
  ctx.strokeStyle = C_NARROW;
  ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(TL_LABEL_W, ty); ctx.lineTo(W - 4, ty); ctx.stroke();
  ctx.setLineDash([]);
  const tLabel = `narrow < ${threshold().toFixed(2)} ${D.short}`;
  ctx.font = "600 10px ui-monospace, monospace";
  const tw = ctx.measureText(tLabel).width;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(W - 8 - tw - 4, ty - 11, tw + 6, 12);
  ctx.fillStyle = C_NARROW;
  ctx.fillText(tLabel, W - 8 - tw - 1, ty - 2);
  ctx.font = "10px ui-monospace, monospace";

  // current value as a dot on the trace — the anchor between the picture on
  // screen and a height on this axis
  const cv = act[frame];
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
