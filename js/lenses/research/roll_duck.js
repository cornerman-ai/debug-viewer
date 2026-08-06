// Roll / duck (kinematic) lens — adjudication workbench for the detector
// prototyped in cornerman-backend/roll_duck_experiment.py.
//
// Signals (per frame, torso-normalized — torso = round-median shoulder-mid ↔
// hip-mid distance):
//
//   dip = nose_y drop below its own ~4s rolling-median baseline
//         (NOT nose-below-shoulders: the shoulders drop with the head in a
//         roll — measured median -0.08 torso on 1,270 GT rolls; baseline
//         drop separates at median +0.38)
//   lat = (nose_x - hip_mid_x) / torso   (signed offset from the midline)
//
// Decoder: dip > t_dip sustained ≥ min_s (gaps ≤ 0.15s bridged) → event;
// lateral range within the event ≥ t_trav → roll, else duck.
//
// The lens scores detections against the round's Sheet defense labels live
// (same matching as the experiment: IoU ≥ 0.25 or pred midpoint inside GT)
// and colors detector events by verdict — the point is to click through the
// red (false-alarm) events and decide: unlabeled roll, or junk that needs
// event-shape features. Python parity: experiment runs on BlazePose image-
// normalized coords (x/width, y/height), this lens on COCO-17 pixels — both
// torso-normalized, so thresholds land close but not identically; sweep best
// was t_dip=0.2 t_trav=0.1 min_s=0.15 (F1 0.53, recall 0.73 on frontal).

import { J } from "../../skeleton.js";

const cfg = {
  tDip: 0.20,     // baseline-drop threshold, torso units
  tTrav: 0.10,    // lateral range separating roll from duck, torso units
  minS: 0.15,     // min event duration, seconds
};

const BASELINE_S = 4.0;
const GAP_S = 0.15;
const SMOOTH_K = 5;
const IOU_MATCH = 0.25;

const ROLL_LABELS = new Set(["lead_roll", "rear_roll"]);
const OTHER_DEFENSE = new Set(["lead_slip", "rear_slip", "pull_back", "duck", "step_back"]);

const COLOR_TP    = "#7adf7a";  // detected roll matched to a GT roll
const COLOR_FA    = "#ff5d6c";  // detected roll with no GT — click these!
const COLOR_CONF  = "#ff9e64";  // detected roll landing on other-defense GT
const COLOR_DUCK  = "#ffd95c";  // dip without traverse
const COLOR_GT    = "#2e8b57";  // GT roll span
const COLOR_GT_OTHER = "#7ec8ff"; // GT slip / pull_back / duck span
const COLOR_FRAME = "#3ad9e0";
const COLOR_TRAIL = "#b48cff";  // nose trail

// ── metric core (mirrors roll_duck_experiment.py head_signals) ──────────────

function pickPose(state) {
  return state.poseV6 || state.pose;
}

let metricCache = { pose: null };

function computeMetrics(state) {
  const pose = pickPose(state);
  if (!pose) return null;
  if (metricCache.pose === pose) return metricCache;

  const n = pose.n_frames, sk = pose.skeleton;
  const noseX = new Array(n).fill(NaN), noseY = new Array(n).fill(NaN);
  const torsoArr = [];
  const latRaw = new Array(n).fill(NaN);

  for (let f = 0; f < n; f++) {
    const base = f * 17;
    const nx = sk[(base + J.NOSE) * 2],       ny = sk[(base + J.NOSE) * 2 + 1];
    const sx = 0.5 * (sk[(base + J.L_SHOULDER) * 2]     + sk[(base + J.R_SHOULDER) * 2]);
    const sy = 0.5 * (sk[(base + J.L_SHOULDER) * 2 + 1] + sk[(base + J.R_SHOULDER) * 2 + 1]);
    const hx = 0.5 * (sk[(base + J.L_HIP) * 2]          + sk[(base + J.R_HIP) * 2]);
    const hy = 0.5 * (sk[(base + J.L_HIP) * 2 + 1]      + sk[(base + J.R_HIP) * 2 + 1]);
    if (![nx, ny, sx, sy, hx, hy].every(Number.isFinite)) continue;
    const t = Math.hypot(sx - hx, sy - hy);
    if (t > 1e-6) torsoArr.push(t);
    noseX[f] = nx; noseY[f] = ny;
    latRaw[f] = nx - hx;
  }

  const torso = median(torsoArr);
  if (!Number.isFinite(torso) || torso < 1e-6) {
    metricCache = { pose, n, bad: true };
    return metricCache;
  }

  const fps = pose.fps || state.fps || 30;
  const ny = noseY.map(v => v / torso);
  const basePx = rollingMedian(ny, Math.max(5, Math.round(BASELINE_S * fps)) | 1)
    .map(v => v * torso);
  const dip = smoothArr(ny.map((v, f) => v - basePx[f] / torso), SMOOTH_K);
  const lat = smoothArr(latRaw.map(v => v / torso), SMOOTH_K);

  metricCache = { pose, n, fps, torso, dip, lat, noseX, noseY, basePx };
  return metricCache;
}

function median(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : 0.5 * (v[m - 1] + v[m]);
}

function rollingMedian(xs, k) {
  const n = xs.length, half = Math.floor(k / 2);
  const out = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const win = [];
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      if (Number.isFinite(xs[j])) win.push(xs[j]);
    }
    if (win.length >= 5) out[i] = median(win);
  }
  return out;
}

function smoothArr(xs, k) {
  const n = xs.length, half = Math.floor(k / 2);
  const out = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      if (Number.isFinite(xs[j])) { s += xs[j]; c++; }
    }
    if (c > 0) out[i] = s / c;
  }
  return out;
}

// ── decoder (mirrors detect_events) ─────────────────────────────────────────

let eventCache = { key: null, events: [] };

function computeEvents(m) {
  const key = `${m.pose === metricCache.pose}|${cfg.tDip}|${cfg.tTrav}|${cfg.minS}|${m.n}`;
  if (eventCache.key === key && eventCache.pose === m.pose) return eventCache.events;

  const gap = Math.round(GAP_S * m.fps);
  const minF = Math.max(2, Math.round(cfg.minS * m.fps));
  const events = [];
  let rs = -1, prev = -2;
  const flush = () => {
    if (rs >= 0 && prev - rs + 1 >= minF) {
      let lo = Infinity, hi = -Infinity, depth = -Infinity;
      for (let f = rs; f <= prev; f++) {
        if (Number.isFinite(m.lat[f])) { lo = Math.min(lo, m.lat[f]); hi = Math.max(hi, m.lat[f]); }
        if (Number.isFinite(m.dip[f])) depth = Math.max(depth, m.dip[f]);
      }
      const traverse = hi > lo ? hi - lo : 0;
      events.push({ sf: rs, ef: prev, traverse, depth,
                    kind: traverse >= cfg.tTrav ? "roll" : "duck" });
    }
  };
  for (let f = 0; f < m.n; f++) {
    if (Number.isFinite(m.dip[f]) && m.dip[f] > cfg.tDip) {
      if (rs < 0 || f - prev > gap + 1) { flush(); rs = f; }
      prev = f;
    }
  }
  flush();
  eventCache = { key, pose: m.pose, events };
  return events;
}

// ── GT + matching (mirrors match()) ─────────────────────────────────────────

function gtSpans(state, n) {
  // A failed fetch / failed auto-match leaves {error, detections: []} — an
  // empty ARRAY, which must not render as "GT rolls 0". Treat it as unscored.
  if (!state.labels || state.labels.error) return null;
  const dets = state.labels.detections;
  if (!Array.isArray(dets)) return null;
  const rolls = [], other = [];
  for (const d of dets) {
    const t = String(d.punch_type || "").toLowerCase();
    const span = [Math.max(0, Math.round(d.start_frame)), Math.min(n - 1, Math.round(d.end_frame))];
    if (span[1] <= span[0]) continue;
    if (ROLL_LABELS.has(t)) rolls.push({ span, type: t });
    else if (OTHER_DEFENSE.has(t)) other.push({ span, type: t });
  }
  return { rolls, other };
}

function spanIou(a, b) {
  const inter = Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]) + 1);
  const union = (a[1] - a[0] + 1) + (b[1] - b[0] + 1) - inter;
  return union > 0 ? inter / union : 0;
}

function matchEvents(gt, preds) {
  const pairs = [];
  gt.forEach((g, gi) => preds.forEach((p, pi) => {
    const iou = spanIou(g, [p.sf, p.ef]);
    const mid = (p.sf + p.ef) / 2;
    if (iou >= IOU_MATCH || (g[0] <= mid && mid <= g[1])) pairs.push([iou, gi, pi]);
  }));
  pairs.sort((a, b) => b[0] - a[0]);
  const mg = new Set(), mp = new Set();
  for (const [, gi, pi] of pairs) {
    if (!mg.has(gi) && !mp.has(pi)) { mg.add(gi); mp.add(pi); }
  }
  return { mg, mp };
}

// Full scoring pass: annotates each event with a verdict, returns totals.
function score(state, m) {
  const events = computeEvents(m);
  const gt = gtSpans(state, m.n);
  for (const e of events) e.verdict = e.kind === "duck" ? "duck" : "fa";
  if (!gt) return { events, gt: null };

  const rollPreds = events.filter(e => e.kind === "roll");
  const { mg, mp } = matchEvents(gt.rolls.map(g => g.span), rollPreds);
  rollPreds.forEach((e, i) => { if (mp.has(i)) e.verdict = "tp"; });
  const leftovers = rollPreds.filter((_, i) => !mp.has(i));
  const { mp: mo } = matchEvents(gt.other.map(o => o.span), leftovers);
  leftovers.forEach((e, i) => { if (mo.has(i)) e.verdict = "conf"; });

  const tp = mg.size, preds = rollPreds.length;
  const conf = mo.size, fa = preds - tp - conf;
  const P = preds ? tp / preds : 0, R = gt.rolls.length ? tp / gt.rolls.length : 0;
  return {
    events, gt, tp, fa, conf, preds,
    nGt: gt.rolls.length, missed: gt.rolls.length - tp,
    ducks: events.filter(e => e.kind === "duck").length,
    P, R, F1: P + R > 0 ? 2 * P * R / (P + R) : 0,
  };
}

const VERDICT_COLOR = { tp: COLOR_TP, fa: COLOR_FA, conf: COLOR_CONF, duck: COLOR_DUCK };

function eventAt(events, f) {
  return events.find(e => e.sf <= f && f <= e.ef) || null;
}

function fmt(v, d = 2) { return Number.isFinite(v) ? v.toFixed(d) : "—"; }

// ── lens ────────────────────────────────────────────────────────────────────

let host;

export const RollDuckLensRule = {
  id: "roll_duck_lens",
  label: "Roll / duck (kinematic)",

  skeletonStyle() {
    return {
      boneColor: "rgba(255,255,255,0.25)",
      boneWidth: 1.5,
      jointRadius: 3,
      highlightJoints: new Set([J.NOSE, J.L_SHOULDER, J.R_SHOULDER, J.L_HIP, J.R_HIP]),
    };
  },

  mount(_host, state) {
    host = _host;
    metricCache = { pose: null };
    eventCache = { key: null, events: [] };
    host.innerHTML = `
      <h2>Roll / duck — kinematic</h2>
      <p class="hint">
        Nose drop below its own ~4s baseline (torso units); lateral range while
        dipped splits <span style="color:${COLOR_TP}">roll</span> from
        <span style="color:${COLOR_DUCK}">duck</span>. Detections are scored
        against the Sheet defense labels live:
        <span style="color:${COLOR_TP}">matched</span> ·
        <span style="color:${COLOR_FA}">false alarm</span> ·
        <span style="color:${COLOR_CONF}">hit other defense</span>.
        Click through the red ones — unlabeled roll, or junk?
      </p>

      <label class="slider-row" style="display:block; font-size:12px; margin-top:6px">
        dip threshold = <output id="rd-dip-out">0.20</output>
        <input type="range" id="rd-dip" min="0.05" max="0.60" step="0.01" value="0.20"></label>
      <label class="slider-row" style="display:block; font-size:12px">
        traverse (roll vs duck) = <output id="rd-trav-out">0.10</output>
        <input type="range" id="rd-trav" min="0.02" max="0.50" step="0.01" value="0.10"></label>
      <label class="slider-row" style="display:block; font-size:12px">
        min duration s = <output id="rd-min-out">0.15</output>
        <input type="range" id="rd-min" min="0.05" max="0.80" step="0.05" value="0.15"></label>

      <div style="margin:6px 0">
        <button id="rd-prev" style="font-size:12px">◀ prev event</button>
        <button id="rd-next" style="font-size:12px">next event ▶</button>
      </div>

      <h3>Round vs Sheet</h3>
      <div id="rd-round" style="font-size:13px; line-height:1.6"></div>

      <h3>Current frame</h3>
      <div id="rd-frame" style="font-size:13px; line-height:1.6"></div>

      <h3>Dip over time <span class="muted small">(GT rolls shaded)</span></h3>
      <canvas id="rd-trace" width="320" height="120"></canvas>
    `;
    mountStageTimeline();

    const wire = (id, key, out) => {
      const s = host.querySelector(id), o = host.querySelector(out);
      s.addEventListener("input", () => {
        cfg[key] = parseFloat(s.value);
        o.textContent = cfg[key].toFixed(2);
        refresh();
      });
    };
    wire("#rd-dip", "tDip", "#rd-dip-out");
    wire("#rd-trav", "tTrav", "#rd-trav-out");
    wire("#rd-min", "minS", "#rd-min-out");

    const jump = dir => {
      const m = computeMetrics(state);
      if (!m || m.bad) return;
      const events = computeEvents(m);
      if (!events.length) return;
      const f = state.frame;
      const next = dir > 0
        ? events.find(e => e.sf > f)
        : [...events].reverse().find(e => e.ef < f);
      if (next) seekTo(next.sf);
    };
    host.querySelector("#rd-prev").addEventListener("click", () => jump(-1));
    host.querySelector("#rd-next").addEventListener("click", () => jump(1));
  },

  update(state) {
    if (!host || !state) return;
    const m = computeMetrics(state);
    if (!m || m.bad) {
      host.querySelector("#rd-round").innerHTML = `<p class="muted">No pose cache loaded.</p>`;
      return;
    }
    const s = score(state, m);
    const f = state.frame;

    host.querySelector("#rd-round").innerHTML = s.gt === null
      ? `<span class="muted">Sheet labels unavailable — detections shown unscored
         (<code>${s.events.length}</code> events).<br>${
           state.labels?.error
             ? `Labels: <span class="bad">${state.labels.error}</span>`
             : state.labels ? "No label rows matched this round."
             : "Labels not loaded (yet) — still fetching, or no Sheet source."}</span>`
      : `GT rolls <code>${s.nGt}</code> ·
         <span style="color:${COLOR_TP}">caught ${s.tp}</span> ·
         missed <code>${s.missed}</code><br>
         <span style="color:${COLOR_FA}">FA ${s.fa}</span> ·
         <span style="color:${COLOR_CONF}">other-defense ${s.conf}</span> ·
         <span style="color:${COLOR_DUCK}">ducks ${s.ducks}</span><br>
         P <code>${fmt(s.P)}</code> · R <code>${fmt(s.R)}</code> ·
         F1 <code>${fmt(s.F1)}</code>`;

    const ev = eventAt(s.events, f);
    host.querySelector("#rd-frame").innerHTML = `
      <strong>frame ${f}:</strong>
      dip <code>${fmt(m.dip[f])}</code> · lat <code>${fmt(m.lat[f])}</code><br>
      ${ev
        ? `<span style="color:${VERDICT_COLOR[ev.verdict]}; font-weight:600">
             ${ev.kind.toUpperCase()} (${ev.verdict})</span>
           <span class="muted">frames ${ev.sf}–${ev.ef} ·
           traverse ${fmt(ev.traverse)} · depth ${fmt(ev.depth)}</span>`
        : `<span class="muted">no event</span>`}`;

    drawTrace(host.querySelector("#rd-trace"), m, s, f);
    drawTimeline(document.getElementById("rd-timeline"), m, s, f);
  },

  draw(ctx, state) {
    const m = computeMetrics(state);
    if (!m || m.bad) return;
    const s = score(state, m);
    const f = state.frame;
    const rs = state.renderScale || 1;

    // Nose trail over the trailing ~1.2s — the U shape IS the roll.
    const trail = Math.round(1.2 * m.fps);
    ctx.save();
    ctx.lineWidth = 2.5 * rs;
    ctx.strokeStyle = COLOR_TRAIL;
    ctx.beginPath();
    let started = false;
    for (let g = Math.max(0, f - trail); g <= f; g++) {
      const x = m.noseX[g], y = m.noseY[g];
      if (!Number.isFinite(x) || !Number.isFinite(y)) { started = false; continue; }
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Baseline tick + dip bar at the nose column.
    const nx = m.noseX[f], nyPx = m.noseY[f], by = m.basePx[f];
    if ([nx, nyPx, by].every(Number.isFinite)) {
      const ev = eventAt(s.events, f);
      const col = ev ? VERDICT_COLOR[ev.verdict]
        : (m.dip[f] > cfg.tDip ? COLOR_FA : "rgba(255,255,255,0.6)");
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.5 * rs;
      ctx.setLineDash([4 * rs, 4 * rs]);
      ctx.beginPath(); ctx.moveTo(nx - 30 * rs, by); ctx.lineTo(nx + 30 * rs, by); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3 * rs;
      ctx.beginPath(); ctx.moveTo(nx, by); ctx.lineTo(nx, nyPx); ctx.stroke();
      if (ev) {
        ctx.font = `${Math.round(14 * rs)}px ui-monospace, monospace`;
        ctx.fillStyle = col;
        ctx.fillText(`${ev.kind.toUpperCase()} ${ev.verdict}`, nx + 8 * rs, by - 8 * rs);
      }
    }
    ctx.restore();

    // Top-left GT-vs-Pred box — same idiom as the punch classifier HUD.
    const gtRoll = s.gt?.rolls.find(g => g.span[0] <= f && f <= g.span[1]) || null;
    const gtOther = !gtRoll && s.gt
      ? s.gt.other.find(o => o.span[0] <= f && f <= o.span[1]) || null : null;
    const evNow = eventAt(s.events, f);
    let predText, predCol;
    if (evNow) {
      const mark = evNow.verdict === "tp" ? " ✓"
        : evNow.verdict === "fa" ? " (false+)"
        : evNow.verdict === "conf" ? " (other-def)"
        : gtRoll ? " (miss)" : "";   // duck while a GT roll is active = missed
      predText = evNow.kind.toUpperCase() + mark;
      predCol = VERDICT_COLOR[evNow.verdict];
    } else if (gtRoll) {
      predText = "MISS"; predCol = COLOR_FA;
    } else {
      predText = "idle"; predCol = "#888888";
    }
    drawGtPredBox(ctx,
      s.gt === null ? "no labels" : gtRoll ? gtRoll.type : gtOther ? gtOther.type : "idle",
      s.gt === null ? "#888888" : gtRoll ? COLOR_TP : gtOther ? COLOR_GT_OTHER : "#888888",
      predText, predCol, rs);

    // Corner HUD.
    const fsz = Math.round(13 * rs), lineH = fsz + 4 * rs;
    const lines = [
      [`dip ${fmt(m.dip[f])} / thr ${cfg.tDip.toFixed(2)}`,
       m.dip[f] > cfg.tDip ? COLOR_FA : "#fff"],
      [`lat ${fmt(m.lat[f])}`, COLOR_TRAIL],
      s.gt === null ? [`no sheet labels`, "#888"]
        : [`P ${fmt(s.P)} R ${fmt(s.R)} F1 ${fmt(s.F1)}`, "#fff"],
    ];
    const padX = 10 * rs, padY = 8 * rs, boxW = 175 * rs;
    const boxH = lines.length * lineH + padY * 2 - 4 * rs;
    const bx = ctx.canvas.width - boxW - 10 * rs, by2 = 10 * rs;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath(); ctx.roundRect(bx, by2, boxW, boxH, 6 * rs); ctx.fill();
    ctx.font = `${fsz}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    lines.forEach(([t, col], i) => {
      ctx.fillStyle = col;
      ctx.fillText(t, bx + padX, by2 + padY + i * lineH);
    });
    ctx.restore();
  },
};

// Top-left 3-line HUD (header / GT / Pred), punch-classifier geometry.
function drawGtPredBox(ctx, gtText, gtCol, predText, predCol, scale) {
  const fontPx = Math.round(13 * scale);
  ctx.save();
  ctx.font = `bold ${fontPx}px ui-monospace, "SF Mono", monospace`;
  const lines = [
    { text: "Roll/Duck",        color: "#dddddd" },
    { text: `GT:   ${gtText}`,  color: gtCol },
    { text: `Pred: ${predText}`, color: predCol },
  ];
  const pad = 5 * scale;
  const lineH = fontPx + 4 * scale;
  let width = 0;
  for (const ln of lines) width = Math.max(width, ctx.measureText(ln.text).width);
  const x = 8 * scale, y = 8 * scale;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(x, y, width + pad * 2, lineH * lines.length + pad * 2);
  let ty = y + pad + fontPx;
  for (const ln of lines) {
    ctx.fillStyle = ln.color;
    ctx.fillText(ln.text, x + pad, ty);
    ty += lineH;
  }
  ctx.restore();
}

// ── below-video timeline: GT track + detection track ────────────────────────

function refresh() {
  document.getElementById("video")?.dispatchEvent(new Event("seeked"));
}

function seekTo(f) {
  const slider = document.getElementById("scrubber");
  if (!slider) return;
  slider.value = f;
  slider.dispatchEvent(new Event("input"));
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
  label.textContent = "Roll/duck — Sheet GT vs detections (click to seek)";
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = "rd-timeline";
  canvas.style.cssText = "display:block;width:100%;height:64px";
  canvas.width = 800; canvas.height = 64;
  wrap.appendChild(canvas);
  slot.appendChild(wrap);

  canvas.addEventListener("click", e => {
    const N = metricCache?.n;
    if (!N) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - TL_LABEL_W) / Math.max(1, rect.width - TL_LABEL_W - 4);
    seekTo(Math.max(0, Math.min(N - 1, Math.round(ratio * (N - 1)))));
  });
}

function drawTimeline(canvas, m, s, frame) {
  if (!canvas) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.max(1, canvas.getBoundingClientRect().width);
  const cssH = Math.max(1, canvas.getBoundingClientRect().height);
  if (canvas.width !== Math.round(cssW * dpr))  canvas.width  = Math.round(cssW * dpr);
  if (canvas.height !== Math.round(cssH * dpr)) canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssH;
  ctx.clearRect(0, 0, W, H);
  const N = m.n;
  if (!N) return;

  const xOf = f => TL_LABEL_W + (f / Math.max(1, N - 1)) * (W - TL_LABEL_W - 4);
  const top = 4, gap = 8;
  const trackH = Math.floor((H - top * 2 - gap) / 2);
  ctx.font = "10px ui-monospace, monospace";

  // Track 1: Sheet GT.
  ctx.fillStyle = "#aaa";
  ctx.fillText("GT", 6, top + trackH / 2 + 3);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(TL_LABEL_W, top, W - TL_LABEL_W - 4, trackH);
  if (s.gt) {
    for (const o of s.gt.other) {
      ctx.fillStyle = COLOR_GT_OTHER;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(xOf(o.span[0]), top, Math.max(2, xOf(o.span[1]) - xOf(o.span[0])), trackH);
    }
    for (const g of s.gt.rolls) {
      ctx.fillStyle = COLOR_GT;
      ctx.globalAlpha = 0.95;
      ctx.fillRect(xOf(g.span[0]), top, Math.max(2, xOf(g.span[1]) - xOf(g.span[0])), trackH);
    }
    ctx.globalAlpha = 1;
  }

  // Track 2: detections, colored by verdict.
  const y2 = top + trackH + gap;
  ctx.fillStyle = "#aaa";
  ctx.fillText("det", 6, y2 + trackH / 2 + 3);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(TL_LABEL_W, y2, W - TL_LABEL_W - 4, trackH);
  for (const e of s.events) {
    ctx.fillStyle = VERDICT_COLOR[e.verdict];
    ctx.fillRect(xOf(e.sf), y2, Math.max(2, xOf(e.ef) - xOf(e.sf)), trackH);
  }

  ctx.strokeStyle = COLOR_FRAME;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 1); ctx.lineTo(xOf(frame), H - 1); ctx.stroke();
}

// Sidebar sparkline: dip trace, threshold line, GT roll bands, frame marker.
function drawTrace(canvas, m, s, frame) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const N = m.n;
  if (!N) return;

  let maxV = cfg.tDip * 2;
  for (let f = 0; f < N; f++) {
    if (Number.isFinite(m.dip[f]) && m.dip[f] > maxV) maxV = m.dip[f];
  }
  const minV = -0.3;
  const yOf = v => H - 4 - ((v - minV) / (maxV - minV)) * (H - 12);
  const xOf = f => (f / Math.max(1, N - 1)) * W;

  if (s.gt) {
    ctx.fillStyle = COLOR_GT;
    ctx.globalAlpha = 0.25;
    for (const g of s.gt.rolls) {
      ctx.fillRect(xOf(g.span[0]), 0, Math.max(1.5, xOf(g.span[1]) - xOf(g.span[0])), H);
    }
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(0, yOf(cfg.tDip)); ctx.lineTo(W, yOf(cfg.tDip)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath(); ctx.moveTo(0, yOf(0)); ctx.lineTo(W, yOf(0)); ctx.stroke();

  for (let f = 0; f < N; f++) {
    const v = m.dip[f];
    if (!Number.isFinite(v)) continue;
    const ev = v > cfg.tDip ? eventAt(s.events, f) : null;
    ctx.fillStyle = ev ? VERDICT_COLOR[ev.verdict] : "rgba(255,255,255,0.55)";
    ctx.fillRect(xOf(f) - 0.5, yOf(v) - 1, 2, 2);
  }

  ctx.strokeStyle = COLOR_FRAME;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 0); ctx.lineTo(xOf(frame), H); ctx.stroke();
}
