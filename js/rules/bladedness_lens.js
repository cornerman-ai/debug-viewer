// Bladedness lens — exploration workbench for "too squared / too bladed".
//
// Bladedness is a rotation about the VERTICAL axis: how far the boxer's
// shoulder line (and foot line) has turned away from lying across your view
// and toward pointing at the camera. 0° = squared (chest to camera),
// 90° = fully side-on. The curated frontal set exists so the camera can stand
// in for the opponent — see frontal_segments_lens.js.
//
// NO DEPTH IS USED. BlazePose z is not reliable enough, so both angles come
// from foreshortening instead:
//
//   SHOULDERS   gap = |L_sh.x − R_sh.x| / torso_height
//               bladed° = arccos(gap / W)          W = their true shoulder
//                                                  width in torso units
//     A shoulder line pointing at the camera looks narrow; one across your
//     view looks full width. Dividing by W recovers the turn. Same machinery
//     hip_rotation already uses on the hips, expressed as the complement
//     (arccos instead of arcsin) because we want the absolute angle, not a
//     peak-minus-trough difference.
//
//   FEET        bladed° = atan2(|dy| · k, |dx|)
//     Stance WIDTH is not anatomically fixed — the boxer changes it at will —
//     so the arccos(gap/W) trick can't work on the ankles. Instead we use the
//     ground-plane trick stance_width v5 already relies on: with the camera
//     above ankle height, image-vertical IS the depth axis, so the ankle
//     vector's (dx, dy) is the stance direction seen from above, up to an
//     unknown scale k set by camera pitch/height. k is a SLIDER, not a
//     constant — read it off the footage.
//
// ── everything here is uncalibrated ────────────────────────────────────────
// W is estimated per-round as the 99th percentile of |gap| — i.e. "they went
// broadside at some point". An over-bladed boxer NEVER does, so W comes out
// too small, gap/W too large, and they measure as MORE SQUARE than they are.
// The bias points the wrong way for exactly the people this rule is meant to
// catch. Hence the W slider, and hence the onboarding calibration pose. The
// band thresholds are guesses pending a coach — do not read them as tuned.

import { J } from "../skeleton.js";
import { activeDetections } from "./_detections.js";
import { curatedInfo, isCuratedVideo } from "./frontal_segments_lens.js";

const cfg = {
  wScale: 1.0,        // multiplies the auto W estimate (1.0 = use it as-is)
  footK: 1.0,         // image-y → ground-depth scale for the ankle vector
  squaredBelow: 25,   // GUESS — below this = too squared
  bladedAbove: 65,    // GUESS — above this = too bladed
  minConfidence: 0.5,
  excludePunches: true,
};

// Curated-only is NOT a toggle. The camera-as-opponent assumption is what makes
// these angles mean anything, and it only holds inside the curated spans — a
// number measured outside them is not a worse measurement, it's a meaningless
// one. So frames outside a span are excluded, and a video that isn't in the set
// gets refused outright rather than silently measured.

const REQ_SH = [J.L_SHOULDER, J.R_SHOULDER, J.L_HIP, J.R_HIP];
const REQ_FT = [J.L_ANKLE, J.R_ANKLE];

const C_SQUARE  = "#ff9e64";   // orange — too squared
const C_OK      = "#7adf7a";   // green
const C_BLADED  = "#ff5d6c";   // red — too bladed
const C_INVALID = "#888";
const C_PUNCH   = "#2e8b57";   // dark green — punch frame, excluded
const C_SH      = "#7ec8ff";   // shoulder accent
const C_FT      = "#ffd95c";   // foot accent
const C_FRAME   = "#3ad9e0";

// ── metric core ─────────────────────────────────────────────────────────────

function torso(sk, f) {
  const b = f * 17;
  const sx = 0.5 * (sk[(b + J.L_SHOULDER) * 2]     + sk[(b + J.R_SHOULDER) * 2]);
  const sy = 0.5 * (sk[(b + J.L_SHOULDER) * 2 + 1] + sk[(b + J.R_SHOULDER) * 2 + 1]);
  const hx = 0.5 * (sk[(b + J.L_HIP) * 2]          + sk[(b + J.R_HIP) * 2]);
  const hy = 0.5 * (sk[(b + J.L_HIP) * 2 + 1]      + sk[(b + J.R_HIP) * 2 + 1]);
  return Math.hypot(sx - hx, sy - hy);
}

const ok = (conf, f, js, min) => js.every(j => conf[f * 17 + j] > min);

let mc = { pose: null };

const pickPose = s => s.poseV6 || s.pose;

function computeMetrics(state) {
  const pose = pickPose(state);
  if (!pose) return null;
  const dets = activeDetections(state);
  if (mc.pose === pose && mc.dets === dets && mc.minConf === cfg.minConfidence) return mc;

  const n = pose.n_frames, sk = pose.skeleton, conf = pose.conf;
  const gap = new Float64Array(n).fill(NaN);   // |shoulder width| / torso
  const fdx = new Float64Array(n).fill(NaN);   // ankle |dx| / torso
  const fdy = new Float64Array(n).fill(NaN);   // ankle |dy| / torso
  const validSh = new Uint8Array(n), validFt = new Uint8Array(n);

  for (let f = 0; f < n; f++) {
    const th = torso(sk, f);
    if (!(th > 1e-6)) continue;
    const b = f * 17;
    if (ok(conf, f, REQ_SH, cfg.minConfidence)) {
      const d = Math.abs(sk[(b + J.L_SHOULDER) * 2] - sk[(b + J.R_SHOULDER) * 2]) / th;
      if (Number.isFinite(d)) { gap[f] = d; validSh[f] = 1; }
    }
    if (ok(conf, f, REQ_FT, cfg.minConfidence)) {
      const dx = Math.abs(sk[(b + J.L_ANKLE) * 2]     - sk[(b + J.R_ANKLE) * 2]) / th;
      const dy = Math.abs(sk[(b + J.L_ANKLE) * 2 + 1] - sk[(b + J.R_ANKLE) * 2 + 1]) / th;
      if (Number.isFinite(dx) && Number.isFinite(dy)) { fdx[f] = dx; fdy[f] = dy; validFt[f] = 1; }
    }
  }

  // Punch frames — bladedness is a RESTING-stance property. You blade on the
  // jab and square up on the cross by design, so averaging across punches
  // measures punch mix, not stance.
  const punch = new Uint8Array(n);
  if (dets) {
    for (const d of dets) {
      const s = Math.max(0, Math.round(d.start_frame));
      const e = Math.min(n - 1, Math.round(d.end_frame));
      for (let f = s; f <= e; f++) punch[f] = 1;
    }
  }

  // W: 99th percentile of |gap| over the round — "they went broadside once".
  // See the header for why this is the weakest link in the whole lens.
  const finite = [...gap].filter(Number.isFinite).sort((a, b) => a - b);
  const wAuto = finite.length ? finite[Math.min(finite.length - 1,
                  Math.floor(0.99 * finite.length))] : NaN;

  mc = { pose, dets, minConf: cfg.minConfidence, n, gap, fdx, fdy,
         validSh, validFt, punch, wAuto };
  return mc;
}

const DEG = 180 / Math.PI;

// Shoulder bladedness: 0° = squared (line across view), 90° = side-on.
function shoulderDeg(c, f) {
  const W = c.wAuto * cfg.wScale;
  if (!c.validSh[f] || !(W > 1e-6) || !Number.isFinite(c.gap[f])) return NaN;
  return Math.acos(Math.max(0, Math.min(1, c.gap[f] / W))) * DEG;
}

// Foot bladedness: 0° = ankle line across view, 90° = pointing at the camera.
function footDeg(c, f) {
  if (!c.validFt[f]) return NaN;
  const dx = c.fdx[f], dy = c.fdy[f] * cfg.footK;
  if (!(dx > 1e-9 || dy > 1e-9)) return NaN;
  return Math.atan2(dy, dx) * DEG;
}

// A frame counts toward the round stats only if it's measurable, inside the
// curated span (when that filter is on), and not mid-punch.
function counted(c, cur, f) {
  if (!cur?.entry || !cur.inSpan[f]) return false;   // curated spans only, always
  if (cfg.excludePunches && c.punch[f]) return false;
  return true;
}

function bandColor(deg) {
  if (!Number.isFinite(deg)) return C_INVALID;
  if (deg < cfg.squaredBelow) return C_SQUARE;
  if (deg > cfg.bladedAbove) return C_BLADED;
  return C_OK;
}

function median(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : 0.5 * (v[m - 1] + v[m]);
}

function iqr(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 4) return NaN;
  const q = p => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return q(0.75) - q(0.25);
}

function rollup(c, cur) {
  const sh = [], ft = [], diff = [];
  let nCounted = 0;
  for (let f = 0; f < c.n; f++) {
    if (!counted(c, cur, f)) continue;
    nCounted++;
    const s = shoulderDeg(c, f), t = footDeg(c, f);
    if (Number.isFinite(s)) sh.push(s);
    if (Number.isFinite(t)) ft.push(t);
    if (Number.isFinite(s) && Number.isFinite(t)) diff.push(s - t);
  }
  return { nCounted, sh, ft,
           medSh: median(sh), medFt: median(ft), medDiff: median(diff),
           iqrSh: iqr(sh), iqrFt: iqr(ft) };
}

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "—");

// ── lens ────────────────────────────────────────────────────────────────────

let host;

export const BladednessRule = {
  id: "bladedness_lens",
  label: "Bladedness (squared vs side-on)",

  // Only the curated frontal videos are selectable. The dropdown filter alone
  // isn't enough — the manual file picker and the Firebase path bypass it — so
  // update()/draw() refuse to measure a non-curated video as well.
  requiresVideo: isCuratedVideo,

  skeletonStyle() {
    return {
      boneColor: "rgba(255,255,255,0.22)",
      boneWidth: 1.5,
      jointRadius: 3,
      highlightJoints: new Set([J.L_SHOULDER, J.R_SHOULDER, J.L_ANKLE, J.R_ANKLE]),
    };
  },

  mount(_host) {
    host = _host;
    mc = { pose: null };
    host.innerHTML = `
      <h2>Bladedness</h2>
      <p class="hint">
        Turn about the vertical axis: <strong>0° = squared</strong> (chest to
        camera), <strong>90° = side-on</strong>. No depth used — shoulders come
        from foreshortening <code>arccos(gap/W)</code>, feet from the ankle
        vector with image-y as the depth axis.
        <span style="color:${C_SQUARE}">too squared</span> ·
        <span style="color:${C_OK}">ok</span> ·
        <span style="color:${C_BLADED}">too bladed</span> ·
        <span style="color:${C_PUNCH}">punch (excluded)</span>.
      </p>
      <p class="hint" style="border-left:2px solid ${C_BLADED}; padding-left:6px">
        <strong>Uncalibrated.</strong> W is guessed as the 99th percentile of
        |gap| — assumes they go broadside at some point. An over-bladed boxer
        never does, so W lands too small and they read as <em>more square than
        they are</em>. Band edges are placeholders, not coach-tuned.
      </p>

      <label class="slider-row" style="display:block; font-size:12px; margin-top:6px">
        W scale = <output id="bl-w-out">1.00</output> <span class="muted" id="bl-w-eff"></span>
        <input type="range" id="bl-w" min="0.6" max="1.6" step="0.01" value="1.0"></label>
      <label class="slider-row" style="display:block; font-size:12px">
        foot depth scale k = <output id="bl-k-out">1.00</output>
        <input type="range" id="bl-k" min="0.2" max="4.0" step="0.05" value="1.0"></label>
      <label class="slider-row" style="display:block; font-size:12px">
        too squared below = <output id="bl-sq-out">25</output>°
        <input type="range" id="bl-sq" min="0" max="60" step="1" value="25"></label>
      <label class="slider-row" style="display:block; font-size:12px">
        too bladed above = <output id="bl-bd-out">65</output>°
        <input type="range" id="bl-bd" min="30" max="90" step="1" value="65"></label>
      <label style="display:block; font-size:12px; margin-top:4px">
        <input type="checkbox" id="bl-pun" checked> exclude punch frames</label>

      <h3>Round</h3>
      <div id="bl-round" style="font-size:13px; line-height:1.6"></div>

      <h3>Current frame</h3>
      <div id="bl-frame" style="font-size:13px; line-height:1.6"></div>

      <h3><span style="color:${C_SH}">shoulders</span> /
          <span style="color:${C_FT}">feet</span> over time</h3>
      <canvas id="bl-trace" width="320" height="130"></canvas>
    `;
    mountStageTimeline();

    const wire = (id, key, dec, out) => {
      const s = host.querySelector(id), o = host.querySelector(out);
      s.addEventListener("input", () => {
        cfg[key] = parseFloat(s.value);
        if (o) o.textContent = cfg[key].toFixed(dec);
        refresh();
      });
    };
    wire("#bl-w", "wScale", 2, "#bl-w-out");
    wire("#bl-k", "footK", 2, "#bl-k-out");
    wire("#bl-sq", "squaredBelow", 0, "#bl-sq-out");
    wire("#bl-bd", "bladedAbove", 0, "#bl-bd-out");
    host.querySelector("#bl-pun").addEventListener("change", e => {
      cfg.excludePunches = e.target.checked; refresh();
    });
  },

  update(state) {
    if (!host || !state) return;
    const c = computeMetrics(state);
    const roundEl = host.querySelector("#bl-round");
    if (!c) { if (roundEl) roundEl.innerHTML = `<p class="muted">No pose cache loaded.</p>`; return; }
    const cur = curatedInfo(state);

    // Not in the curated set ⇒ refuse. Showing an angle here would be showing a
    // number whose reference axis doesn't hold.
    if (!cur?.entry) {
      roundEl.innerHTML =
        `<div style="color:${C_BLADED}; font-weight:600">Not in the curated set</div>
         <div class="muted small" style="margin-top:3px">
           These angles only mean something where the camera stands in for the
           opponent. <code>${state.cacheBasename || "this video"}</code> isn't in
           <code>frontal_segments.json</code>, so nothing is measured.
         </div>`;
      host.querySelector("#bl-frame").innerHTML = `<span class="muted">—</span>`;
      const tl = document.getElementById("bl-timeline");
      if (tl) fitCanvas(tl);
      const tr = host.querySelector("#bl-trace");
      if (tr) tr.getContext("2d").clearRect(0, 0, tr.width, tr.height);
      return;
    }

    const r = rollup(c, cur);
    const f = state.frame;

    host.querySelector("#bl-w-eff").textContent =
      Number.isFinite(c.wAuto) ? `(auto ${c.wAuto.toFixed(3)} → ${(c.wAuto * cfg.wScale).toFixed(3)})` : "";

    const curNote = `curated spans only`;

    roundEl.innerHTML = `
      <div><span style="color:${C_SH}">shoulders</span>
        median <code style="color:${bandColor(r.medSh)}">${fmt(r.medSh)}°</code>
        <span class="muted">IQR ${fmt(r.iqrSh)}° · n=${r.sh.length}</span></div>
      <div><span style="color:${C_FT}">feet</span>
        median <code style="color:${bandColor(r.medFt)}">${fmt(r.medFt)}°</code>
        <span class="muted">IQR ${fmt(r.iqrFt)}° · n=${r.ft.length}</span></div>
      <div style="margin-top:3px">shoulders − feet
        <code>${fmt(r.medDiff)}°</code>
        <span class="muted">(&gt;0 = chest turned further than the feet)</span></div>
      <div class="muted small" style="margin-top:3px">${curNote} · ${r.nCounted} frames counted</div>`;

    const s = shoulderDeg(c, f), t = footDeg(c, f);
    host.querySelector("#bl-frame").innerHTML = `
      <strong>frame ${f}</strong>
      ${c.punch[f] ? `<span style="color:${C_PUNCH}"> punch</span>` : ""}
      ${!cur.inSpan[f] ? `<span style="color:${C_INVALID}"> · outside span, not counted</span>` : ""}<br>
      <span style="color:${C_SH}">sh</span>
        <code style="color:${bandColor(s)}">${fmt(s)}°</code>
        <span class="muted">gap ${fmt(c.gap[f], 3)}</span> ·
      <span style="color:${C_FT}">ft</span>
        <code style="color:${bandColor(t)}">${fmt(t)}°</code>
        <span class="muted">dx ${fmt(c.fdx[f], 3)} dy ${fmt(c.fdy[f], 3)}</span>`;

    drawTrace(host.querySelector("#bl-trace"), c, cur, f);
    drawTimeline(document.getElementById("bl-timeline"), c, cur, f);
  },

  draw(ctx, state) {
    const c = computeMetrics(state);
    if (!c) return;
    const cur = curatedInfo(state);
    const f = state.frame, sc = state.renderScale || 1;

    // Outside the curated set / span: say so and draw nothing else. No angle is
    // better than an angle whose reference axis doesn't hold.
    if (!cur?.entry || !cur.inSpan[f]) {
      const msg = !cur?.entry ? "VIDEO NOT IN CURATED SET" : "OUTSIDE CURATED SPAN";
      const fsz = Math.round(14 * sc);
      ctx.save();
      ctx.strokeStyle = C_INVALID; ctx.lineWidth = 4 * sc; ctx.globalAlpha = 0.8;
      ctx.strokeRect(2 * sc, 2 * sc, ctx.canvas.width - 4 * sc, ctx.canvas.height - 4 * sc);
      ctx.globalAlpha = 1;
      ctx.font = `600 ${fsz}px ui-monospace, monospace`;
      ctx.textBaseline = "top";
      const w = ctx.measureText(msg).width + 20 * sc;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath(); ctx.roundRect(10 * sc, 10 * sc, w, fsz + 14 * sc, 6 * sc); ctx.fill();
      ctx.fillStyle = C_INVALID;
      ctx.fillText(msg, 20 * sc, 17 * sc);
      ctx.restore();
      return;
    }

    const pose = pickPose(state);
    const b = f * 17;
    const P = j => [pose.skeleton[(b + j) * 2], pose.skeleton[(b + j) * 2 + 1]];

    const seg = (aJ, bJ, color) => {
      const [ax, ay] = P(aJ), [bx, by] = P(bJ);
      if (![ax, ay, bx, by].every(Number.isFinite)) return;
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = 4 * sc;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = color;
      for (const [x, y] of [[ax, ay], [bx, by]]) {
        ctx.beginPath(); ctx.arc(x, y, 4 * sc, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    };

    const sDeg = shoulderDeg(c, f), tDeg = footDeg(c, f);
    seg(J.L_SHOULDER, J.R_SHOULDER, bandColor(sDeg));
    seg(J.L_ANKLE, J.R_ANKLE, bandColor(tDeg));

    // Ghost of the shoulder line at full width W, centred on the real one —
    // the gap between ghost and real IS the foreshortening the angle reads.
    const [lx, ly] = P(J.L_SHOULDER), [rx, ry] = P(J.R_SHOULDER);
    const W = c.wAuto * cfg.wScale;
    if ([lx, ly, rx, ry].every(Number.isFinite) && W > 1e-6) {
      const th = torso(pose.skeleton, f);
      const half = (W * th) / 2, cx = (lx + rx) / 2, cy = (ly + ry) / 2;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1.5 * sc; ctx.setLineDash([5 * sc, 5 * sc]);
      ctx.beginPath(); ctx.moveTo(cx - half, cy); ctx.lineTo(cx + half, cy); ctx.stroke();
      ctx.restore();
    }

    const fsz = Math.round(13 * sc), lh = fsz + 4 * sc;
    const lines = [
      [`shoulders ${fmt(sDeg)}°`, bandColor(sDeg)],
      [`feet      ${fmt(tDeg)}°`, bandColor(tDeg)],
      [`W ${fmt(W, 3)}  k ${cfg.footK.toFixed(2)}`, "#fff"],
    ];
    if (c.punch[f]) lines.push([`punch — excluded`, C_PUNCH]);
    const padX = 10 * sc, padY = 8 * sc, boxW = 168 * sc;
    const boxH = lines.length * lh + padY * 2 - 4 * sc;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.roundRect(ctx.canvas.width - boxW - 10 * sc, 10 * sc, boxW, boxH, 6 * sc);
    ctx.fill();
    ctx.font = `${fsz}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    lines.forEach(([t2, col], i) => {
      ctx.fillStyle = col;
      ctx.fillText(t2, ctx.canvas.width - boxW - 10 * sc + padX, 10 * sc + padY + i * lh);
    });
    ctx.restore();
  },
};

// ── below-video timeline ────────────────────────────────────────────────────

function refresh() {
  document.getElementById("video")?.dispatchEvent(new Event("seeked"));
}

const TL_LABEL_W = 56;

function mountStageTimeline() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:12px;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px";
  const label = document.createElement("div");
  label.className = "muted small";
  label.style.cssText = "margin-bottom:6px";
  label.textContent = "Bladedness — shoulders / feet, dimmed outside curated spans (click to seek)";
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = "bl-timeline";
  canvas.style.cssText = "display:block;width:100%;height:72px";
  canvas.width = 800; canvas.height = 72;
  wrap.appendChild(canvas);
  slot.appendChild(wrap);
  canvas.addEventListener("click", e => {
    const N = mc?.n;
    if (!N) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - TL_LABEL_W) / Math.max(1, rect.width - TL_LABEL_W - 4);
    const sl = document.getElementById("scrubber");
    if (!sl) return;
    sl.value = Math.max(0, Math.min(N - 1, Math.round(ratio * (N - 1))));
    sl.dispatchEvent(new Event("input"));
  });
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

function drawTimeline(canvas, c, cur, frame) {
  if (!canvas) return;
  const { ctx, W, H } = fitCanvas(canvas);
  const N = c.n;
  if (!N) return;
  const xOf = f => TL_LABEL_W + (f / Math.max(1, N - 1)) * (W - TL_LABEL_W - 4);
  const colW = Math.max(1, (W - TL_LABEL_W - 4) / Math.max(1, N - 1));

  const tracks = [
    { label: "sh", fn: f => shoulderDeg(c, f), accent: C_SH },
    { label: "ft", fn: f => footDeg(c, f),     accent: C_FT },
  ];
  const gap = 6, top = 4;
  const trackH = Math.floor((H - top * 2 - gap * tracks.length) / tracks.length);
  ctx.font = "10px ui-monospace, monospace";

  tracks.forEach((t, i) => {
    const y = top + i * (trackH + gap);
    ctx.fillStyle = t.accent;
    ctx.fillText(t.label, 6, y + trackH / 2 + 3);
    for (let f = 0; f < N; f++) {
      // Out-of-span frames are drawn flat grey, not a dimmed measurement —
      // there is no measurement there to dim.
      const inSpan = cur?.entry && cur.inSpan[f];
      if (!inSpan) {
        ctx.fillStyle = C_INVALID; ctx.globalAlpha = 0.15;
      } else {
        ctx.fillStyle = (cfg.excludePunches && c.punch[f]) ? C_PUNCH : bandColor(t.fn(f));
        ctx.globalAlpha = 0.9;
      }
      ctx.fillRect(xOf(f), y, colW + 0.5, trackH);
    }
    ctx.globalAlpha = 1;
  });

  ctx.strokeStyle = C_FRAME; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 1); ctx.lineTo(xOf(frame), H - 1); ctx.stroke();
}

// Both angles over the round on a fixed 0–90° axis, with the band edges drawn
// so you can read the cutoffs straight off the distribution.
function drawTrace(canvas, c, cur, frame) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const N = c.n;
  if (!N) return;
  const yOf = d => H - 4 - (d / 90) * (H - 12);
  const xOf = f => (f / Math.max(1, N - 1)) * W;

  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.setLineDash([4, 4]);
  for (const d of [cfg.squaredBelow, cfg.bladedAbove]) {
    ctx.beginPath(); ctx.moveTo(0, yOf(d)); ctx.lineTo(W, yOf(d)); ctx.stroke();
  }
  ctx.setLineDash([]);

  const dots = (fn, color) => {
    for (let f = 0; f < N; f++) {
      if (!counted(c, cur, f)) continue;
      const v = fn(f);
      if (!Number.isFinite(v)) continue;
      ctx.fillStyle = color;
      ctx.fillRect(xOf(f) - 0.5, yOf(v) - 1, 2, 2);
    }
  };
  dots(f => shoulderDeg(c, f), C_SH);
  dots(f => footDeg(c, f), C_FT);

  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "9px ui-monospace, monospace";
  ctx.fillText("90° side-on", 2, 9);
  ctx.fillText("0° squared", 2, H - 2);

  ctx.strokeStyle = C_FRAME; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 0); ctx.lineTo(xOf(frame), H); ctx.stroke();
}
