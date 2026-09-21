// Guard drop — does the RESTING hand drop while the other hand punches?
//
// Per punch, not per frame (2026-09-21 rewrite; the old panel only drew the
// per-frame wrist→nose stack). The punches come from the labelled GT when the
// round has labels, else the classifier's predictions (activeDetections). For
// each punch the punching side is (hand, stance) → L/R and the OTHER hand is
// the one being judged. The number is THE DROP, not the height:
//
//     d(f)   = (wrist_y − nose_y) / torso     image y runs down: bigger = lower
//     base   = mean d over the first start_pct of the punch (where the hand was)
//     lowest = max d inside the punch span (+pad)      (its lowest point)
//     drop   = lowest − base                            (how far it went down)
//
// Verdict per punch is the drop alone (Mathe, 2026-09-21 — where the hand
// started does not enter it): NOT LOWERED at drop <= drop_threshold, LOWERED A
// BIT up to big_drop_threshold, LOWERED A LOT above it. Every punch is scored,
// combos included (Mathe, 2026-09-21: no isolated-only filter) — so in a combo
// the resting hand's drop can be its own punch leaving or coming back.
// The shipped rule's own two numbers (shoulder-anchored delta over the punch,
// end position vs the nose; guard_drop.py) are shown beside it for reference.
//
// Below the video: one timeline per hand. On a hand's strip its own punches
// are the blue spans; the spans where it is the RESTING hand are coloured by
// the verdict, with a tick at the lowest-drop frame. Click to seek. Rows in
// the punch table seek to the punch and loop it (N / P step, M mutes). The
// loop only holds once a punch is picked, and lets go as soon as the paused
// video leaves it (← / → frame steps, the scrubber, a click off the punch).
import { J, torsoHeight } from "../../skeleton.js";
import { activeDetections } from "../shared/punch_detections.js";
import { isPunchLabel } from "../shared/slip_labels.js";

// Defaults match rules_config.json → rules.guard_drop.params (2026-09-21):
// delta_threshold 0.10, guard_low_threshold 0.25, start_pct 0.2,
// min_wrist_confidence 0.4 (0.30 here, the
// viewer's house gate). drop_threshold reuses delta_threshold's value;
// big_drop_threshold is this lens's own (no rule counterpart, unscored).
const DEFAULTS = {
  dropThreshold: 0.10,       // torso units down before it counts as lowered (a bit)
  bigDropThreshold: 0.25,    // torso units down for "lowered a lot"
  guardLowThreshold: 0.25,   // the shipped rule's end-below-nose line (reference numbers only)
  startPct: 0.20,            // fraction of the span that defines "where it was"
  padFrames: 0,              // frames added after the punch end
  minWristConfidence: 0.30,
  minCoverage: 0.6,          // fraction of span frames with a usable metric
  loop: true,
};

const COLORS = {
  nose: "#7ec8ff", l_wrist: "#ff8a5c", r_wrist: "#ffd95c",
  punch: "rgba(126,200,255,0.55)", punchEdge: "#7ec8ff",
  lot: "#ff5d6c", bit: "#f5b945", none: "#7adf7a",
  gated: "#666", marker: "#3ad9e0", base: "rgba(255,255,255,0.8)",
};
const VERDICT_COLOR = {
  lowered_lot: COLORS.lot, lowered_bit: COLORS.bit, not_lowered: COLORS.none,
  gated: COLORS.gated,
};
const VERDICT_LABEL = {
  lowered_lot: "lowered a lot", lowered_bit: "lowered a bit", not_lowered: "not lowered",
  gated: "gated",
};

// (hand, stance) → anatomical side, mirroring guard_drop.py's GUARD_JOINTS.
const SIDE_FOR = { lead: { orthodox: "L", southpaw: "R" }, rear: { orthodox: "R", southpaw: "L" } };
const JOINTS = { L: { wrist: J.L_WRIST, shoulder: J.L_SHOULDER }, R: { wrist: J.R_WRIST, shoulder: J.R_SHOULDER } };
const OTHER = { L: "R", R: "L" };
const TL_LABEL_W = 22;

let host;
let cfg = { ...DEFAULTS };
let cache = null;            // { N, fps, d: {L, R}, dSh: {L, R}, punches, sig }
let latestState = null;
let activeIdx = -1;
let loopArmed = false;       // set by picking a punch; a paused step out of it clears it
let videoEl = null;
let timeupdateHandler = null;
let keydownHandler = null;

export const GuardDropRule = {
  id: "guard_drop",
  label: "Guard drop",

  skeletonStyle() {
    return {
      boneColor: "rgba(255,255,255,0.25)",
      boneWidth: 1.5,
      jointRadius: 3,
      highlightJoints: new Set([J.NOSE, J.L_WRIST, J.R_WRIST]),
    };
  },

  mount(h, state) {
    host = h;
    latestState = state;
    host.innerHTML = `
      <h3>Guard drop — the resting hand, per punch</h3>
      <p class="hint">drop = lowest point of the <b>other</b> hand inside the punch minus where it
        was at the start, in torso heights along the nose line (+ = went down).
        <span style="color:${COLORS.none}">not lowered</span> · <span style="color:${COLORS.bit}">lowered a bit</span> ·
        <span style="color:${COLORS.lot}">lowered a lot</span> ·
        <span style="color:${COLORS.gated}">gated</span> (wrist not tracked).
        On the video: <span style="color:${COLORS.nose}">nose</span> ·
        <span style="color:${COLORS.base}">baseline</span> (dashed — where the resting hand was at the start
        of the punch) · the resting wrist; the gap between the last two is the drop.</p>
      <div class="metric-grid">
        <div><div class="metric-label">punches</div><div class="metric-val" id="gd-n"></div><div class="metric-sub" id="gd-n-sub"></div></div>
        <div><div class="metric-label">lowered a lot</div><div class="metric-val" id="gd-n-lot" style="color:${COLORS.lot}"></div><div class="metric-sub" id="gd-n-lot-sub"></div></div>
        <div><div class="metric-label">lowered a bit</div><div class="metric-val" id="gd-n-bit" style="color:${COLORS.bit}"></div><div class="metric-sub" id="gd-n-bit-sub"></div></div>
        <div><div class="metric-label">not lowered</div><div class="metric-val" id="gd-n-none" style="color:${COLORS.none}"></div><div class="metric-sub" id="gd-n-none-sub"></div></div>
      </div>
      <h3>This frame</h3>
      <div class="metric-grid">
        <div><div class="metric-label">L wrist vs nose</div><div class="metric-val" id="gd-l-now"></div><div class="metric-sub" id="gd-l-now-sub"></div></div>
        <div><div class="metric-label">R wrist vs nose</div><div class="metric-val" id="gd-r-now"></div><div class="metric-sub" id="gd-r-now-sub"></div></div>
      </div>
      <h3>Active punch <span class="hint" id="gd-counter"></span></h3>
      <div id="gd-active" class="hint">—</div>
      <canvas id="gd-spark" width="320" height="90" style="display:block;width:100%;height:90px;margin:6px 0"></canvas>
      <div style="display:flex;gap:6px;margin:4px 0">
        <button id="gd-prev">◀ prev (P)</button><button id="gd-next">next (N) ▶</button>
        <label class="hint" style="margin-left:auto"><input type="checkbox" id="gd-loop" ${cfg.loop ? "checked" : ""}> loop punch</label>
      </div>
      <h3>Thresholds</h3>
      <div class="slider-row"><span>lowered a bit above <output id="gd-drop-out">${cfg.dropThreshold.toFixed(2)}</output> torso</span>
        <input type="range" id="gd-drop" min="0" max="0.5" step="0.01" value="${cfg.dropThreshold}"></div>
      <div class="slider-row"><span>lowered a lot above <output id="gd-big-out">${cfg.bigDropThreshold.toFixed(2)}</output> torso</span>
        <input type="range" id="gd-big" min="0" max="0.8" step="0.01" value="${cfg.bigDropThreshold}"></div>
      <div class="slider-row"><span>guard_low (shipped rule's end-vs-nose line) = <output id="gd-glt-out">${cfg.guardLowThreshold.toFixed(2)}</output></span>
        <input type="range" id="gd-glt" min="-0.3" max="0.8" step="0.01" value="${cfg.guardLowThreshold}"></div>
      <div class="slider-row"><span>start_pct = <output id="gd-sp-out">${cfg.startPct.toFixed(2)}</output> of the span</span>
        <input type="range" id="gd-sp" min="0.05" max="0.5" step="0.05" value="${cfg.startPct}"></div>
      <div class="slider-row"><span>pad after punch = <output id="gd-pad-out">${cfg.padFrames}</output> frames</span>
        <input type="range" id="gd-pad" min="0" max="20" step="1" value="${cfg.padFrames}"></div>
      <div class="slider-row"><span>min_wrist_confidence = <output id="gd-mwc-out">${cfg.minWristConfidence.toFixed(2)}</output></span>
        <input type="range" id="gd-mwc" min="0" max="1" step="0.01" value="${cfg.minWristConfidence}"></div>
      <h3>Punches <span class="hint">(click to seek + loop)</span></h3>
      <div id="gd-table" style="max-height:340px;overflow:auto"></div>
    `;
    ensureStageTimeline();

    const wire = (id, outId, key, fmt = v => v.toFixed(2)) => {
      const el = host.querySelector("#" + id), out = host.querySelector("#" + outId);
      el.addEventListener("input", () => {
        cfg[key] = Number(el.value);
        out.textContent = fmt(cfg[key]);
        cache = null;
        refresh(latestState);
        window.__viewerRedraw?.();
      });
    };
    wire("gd-drop", "gd-drop-out", "dropThreshold");
    wire("gd-big", "gd-big-out", "bigDropThreshold");
    wire("gd-glt", "gd-glt-out", "guardLowThreshold");
    wire("gd-sp", "gd-sp-out", "startPct");
    wire("gd-pad", "gd-pad-out", "padFrames", v => String(Math.round(v)));
    wire("gd-mwc", "gd-mwc-out", "minWristConfidence");
    host.querySelector("#gd-loop").addEventListener("change", (e) => { cfg.loop = e.target.checked; });
    host.querySelector("#gd-prev").addEventListener("click", () => seekToPunch(activeIdx - 1));
    host.querySelector("#gd-next").addEventListener("click", () => seekToPunch(activeIdx + 1));
    host.addEventListener("click", (ev) => {
      const tr = ev.target.closest("tr[data-idx]");
      if (tr) seekToPunch(Number(tr.dataset.idx));
    });
    videoEl = document.getElementById("video");
    installLoop();
    installKeys();
    refresh(state);
  },

  update(state) {
    latestState = state;
    refresh(state);
  },

  draw(ctx, state) {
    latestState = state;
    const data = getData(state);
    const p = pickPose(state);
    if (!p) return;
    const f = state.frame;
    const s = state.renderScale || 1;
    const W = ctx.canvas.width;
    // Three lines, each named at the right edge: the nose, the baseline (where
    // the resting hand was at the start of the punch — the drop is measured from
    // it) and the resting wrist. Baseline + wrist only inside a punch: the picked
    // one when it covers this frame, else the first punch that does.
    const labels = [];
    const nose = jt(p, f, J.NOSE);
    if (nose.c > 0) {
      hline(ctx, nose.y, W, COLORS.nose, 2 * s, 0);
      labels.push({ y: nose.y, text: "nose", color: COLORS.nose });
    }
    const torso = Math.max(1e-6, torsoHeight(p, f));
    const act = data && activeIdx >= 0 ? data.punches[activeIdx] : null;
    const here = act && f >= act.sf && f <= act.ef ? act
      : (data?.punches.find(q => f >= q.sf && f <= q.ef) || null);
    if (here) {
      if (nose.c > 0 && Number.isFinite(here.base)) {
        // on this frame's nose line and torso ruler, so the gap to the wrist line IS the drop
        const yb = nose.y + here.base * torso;
        hline(ctx, yb, W, COLORS.base, 2 * s, 4 * s);
        labels.push({ y: yb, text: "baseline (start of punch)", color: COLORS.base });
      }
      const w = jt(p, f, JOINTS[here.other].wrist);
      if (w.c > 0) {
        const col = here.other === "L" ? COLORS.l_wrist : COLORS.r_wrist;
        hline(ctx, w.y, W, col, 3 * s, 0);
        ctx.save();
        ctx.strokeStyle = col; ctx.lineWidth = 2 * s;
        ctx.beginPath(); ctx.arc(w.x, w.y, 9 * s, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        const dropNow = data.d[here.other][f] - here.base;
        labels.push({ y: w.y, color: col,
                      text: `${here.other} wrist (resting)${Number.isFinite(dropNow) ? ` · drop ${fmt(dropNow)}` : ""}` });
      }
    }
    lineLabels(ctx, labels, W, s);
    // corner HUD
    const lines = [];
    const shown = here || act;
    if (shown) lines.push(`punch ${shown.idx + 1}/${data.punches.length}: ${shown.type} ${shown.hand} → resting ${shown.other} · drop ${fmt(shown.drop)} (${VERDICT_LABEL[shown.verdict]})`);
    if (here) lines.push(`${here.other} wrist now ${fmt(data.d[here.other][f])} · base ${fmt(here.base)} · lowest ${fmt(here.lowest)} @f${here.lowestFrame}`);
    if (lines.length) hud(ctx, lines, s);
  },

  unmount() {
    if (videoEl && timeupdateHandler) videoEl.removeEventListener("timeupdate", timeupdateHandler);
    if (keydownHandler) document.removeEventListener("keydown", keydownHandler, true);
    timeupdateHandler = keydownHandler = null;
    activeIdx = -1;
    loopArmed = false;
  },
};

// ─── compute ───────────────────────────────────────────────────────────────
// The drawn BlazePose skeleton.
function pickPose(state) { return state.pose; }

function jt(pose, f, j) {
  return { x: pose.skeleton[(f * 17 + j) * 2], y: pose.skeleton[(f * 17 + j) * 2 + 1], c: pose.conf[f * 17 + j] };
}

function getData(state) {
  const p = pickPose(state);
  if (!p) return null;
  const dets = activeDetections(state);
  const sig = [p, dets, cfg.dropThreshold, cfg.bigDropThreshold, cfg.guardLowThreshold, cfg.startPct, cfg.padFrames,
               cfg.minWristConfidence, cfg.minCoverage];
  if (cache && cache.sig.length === sig.length && cache.sig.every((v, i) => v === sig[i])) return cache;
  cache = compute(p, dets, state.fps || p.fps || 30);
  cache.sig = sig;
  // keep the active punch valid; start on the first one without moving the
  // scrubber (N / a row click seeks)
  if (activeIdx >= cache.punches.length || activeIdx < 0) activeIdx = cache.punches.length ? 0 : -1;
  return cache;
}

// Per-frame metric per side, then per punch the resting hand's base, lowest
// point and drop. Exported so a node parity check can call it on a flat pose.
export function compute(p, dets, fps) {
  const N = p.n_frames;
  const d = { L: new Float32Array(N).fill(NaN), R: new Float32Array(N).fill(NaN) };
  const dSh = { L: new Float32Array(N).fill(NaN), R: new Float32Array(N).fill(NaN) };
  for (let f = 0; f < N; f++) {
    const nose = jt(p, f, J.NOSE);
    const torso = torsoHeight(p, f);
    if (!(torso > 1) || nose.c < cfg.minWristConfidence) continue;
    for (const side of ["L", "R"]) {
      const w = jt(p, f, JOINTS[side].wrist);
      const sh = jt(p, f, JOINTS[side].shoulder);
      if (w.c < cfg.minWristConfidence) continue;
      d[side][f] = (w.y - nose.y) / torso;
      if (sh.c >= cfg.minWristConfidence) dSh[side][f] = (w.y - sh.y) / torso;
    }
  }
  // The Sheet labels carry defense rows too (lead_roll parses as a lead hand).
  const raw = (dets || []).filter(det => isPunchLabel(det.punch_type)).map((det, i) => {
    const stance = (det.stance === "southpaw" || det.stance === "orthodox") ? det.stance : "orthodox";
    const side = SIDE_FOR[det.hand]?.[stance] || "L";
    return { det, i, side, other: OTHER[side], sf: Math.max(0, det.start_frame),
             ef: Math.min(N - 1, det.end_frame + cfg.padFrames) };
  }).filter(x => x.ef >= x.sf).sort((a, b) => a.sf - b.sf);
  const punches = raw.map((x, idx) => {
    const span = x.ef - x.sf + 1;
    const nStart = Math.max(1, Math.round(span * cfg.startPct));
    const arr = d[x.other];
    const base = meanFinite(arr, x.sf, x.sf + nStart - 1);
    let lowest = -Infinity, lowestFrame = -1, n = 0;
    for (let f = x.sf; f <= x.ef; f++) {
      const v = arr[f];
      if (!Number.isFinite(v)) continue;
      n++;
      if (v > lowest) { lowest = v; lowestFrame = f; }
    }
    if (!n) lowest = NaN;
    const coverage = n / span;
    const drop = lowest - base;
    // the shipped rule's two numbers, for reference (guard_drop.py)
    const nEnd = Math.max(1, Math.round(span * 0.2));
    const shDelta = meanFinite(dSh[x.other], x.ef - nEnd + 1, x.ef) - meanFinite(dSh[x.other], x.sf, x.sf + nEnd - 1);
    const endNose = meanFinite(arr, x.ef - nEnd + 1, x.ef);
    const ruleDrop = shDelta > cfg.dropThreshold && endNose > cfg.guardLowThreshold;
    let verdict;
    if (coverage < cfg.minCoverage || !Number.isFinite(base) || !Number.isFinite(lowest)) verdict = "gated";
    else if (drop > cfg.bigDropThreshold) verdict = "lowered_lot";
    else if (drop > cfg.dropThreshold) verdict = "lowered_bit";
    else verdict = "not_lowered";
    return { idx, sf: x.sf, ef: x.ef, side: x.side, other: x.other, hand: x.det.hand,
             type: x.det.punch_type || "punch", uuid: x.det.punch_uuid || null,
             t: x.det.start_time, base, lowest, lowestFrame, drop, coverage,
             shDelta, endNose, ruleDrop, verdict };
  });
  return { N, fps, d, dSh, punches };
}

function meanFinite(arr, a, b) {
  let s = 0, n = 0;
  for (let f = Math.max(0, a); f <= Math.min(arr.length - 1, b); f++) {
    const v = arr[f];
    if (Number.isFinite(v)) { s += v; n++; }
  }
  return n ? s / n : NaN;
}

// ─── sidebar ───────────────────────────────────────────────────────────────
function refresh(state) {
  if (!host || !state) return;
  const data = getData(state);
  if (!data) return;
  const f = state.frame;
  const pun = data.punches;
  const count = v => pun.filter(p => p.verdict === v).length;
  const scored = pun.filter(p => p.verdict !== "gated").length;
  setText("gd-n", String(pun.length));
  setText("gd-n-sub", `${scored} scored · ${count("gated")} gated`);
  for (const [id, v] of [["lot", "lowered_lot"], ["bit", "lowered_bit"], ["none", "not_lowered"]]) {
    setText(`gd-n-${id}`, String(count(v)));
    setText(`gd-n-${id}-sub`, scored ? `${Math.round(100 * count(v) / scored)}% of scored` : "");
  }
  for (const side of ["L", "R"]) {
    const v = data.d[side][f];
    setText(`gd-${side.toLowerCase()}-now`, fmt(v), Number.isFinite(v) ? null : "#888");
    const inside = pun.find(p => f >= p.sf && f <= p.ef && p.side === side);
    const resting = pun.find(p => f >= p.sf && f <= p.ef && p.other === side);
    setText(`gd-${side.toLowerCase()}-now-sub`, inside ? `punching (${inside.type})` : resting ? `resting during ${resting.type}` : "");
  }
  const act = activeIdx >= 0 ? pun[activeIdx] : null;
  setText("gd-counter", pun.length ? `${activeIdx + 1} / ${pun.length}` : "no punches");
  if (act) {
    const c = VERDICT_COLOR[act.verdict];
    setText("gd-active",
      `<b>${act.type}</b> · ${act.hand} hand (${act.side}) · frames ${act.sf}–${act.ef} · resting hand <b>${act.other}</b><br>` +
      `base ${fmt(act.base)} → lowest ${fmt(act.lowest)} @f${act.lowestFrame} · <b style="color:${c}">drop ${fmt(act.drop)} · ${VERDICT_LABEL[act.verdict]}</b><br>` +
      `<span class="hint">rule: shoulder delta ${fmt(act.shDelta)}, end vs nose ${fmt(act.endNose)} → ${act.ruleDrop ? "drop" : "no drop"} · ` +
      `coverage ${Math.round(100 * act.coverage)}%</span>`);
  } else setText("gd-active", "—");
  drawSpark(host.querySelector("#gd-spark"), data, act, f);
  renderTable(data);
  drawStageTimeline(document.getElementById("gd-stage-timeline"), data, f);
}

function renderTable(data) {
  const el = host.querySelector("#gd-table");
  if (!el) return;
  const rows = data.punches.map(p => {
    const c = VERDICT_COLOR[p.verdict];
    const on = p.idx === activeIdx ? ' style="outline:1px solid #3ad9e0"' : "";
    return `<tr data-idx="${p.idx}"${on}><td>${p.idx + 1}</td><td>${mmss(p.t)}</td><td>${p.type}</td>` +
      `<td>${p.hand}</td><td style="color:${c}"><b>${fmt(p.drop)}</b></td><td>${fmt(p.lowest)}</td>` +
      `<td style="color:${c}">${VERDICT_LABEL[p.verdict]}</td></tr>`;
  }).join("");
  el.innerHTML = `<table class="punch-table"><thead><tr><th>#</th><th>t</th><th>type</th><th>hand</th>` +
    `<th>other drop</th><th>lowest</th><th>verdict</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function drawSpark(canvas, data, act, frame) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!act) return;
  const a = Math.max(0, act.sf - 15), b = Math.min(data.N - 1, act.ef + 15);
  const arr = data.d[act.other];
  let lo = Infinity, hi = -Infinity;
  for (let f = a; f <= b; f++) { const v = arr[f]; if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  if (!Number.isFinite(lo)) return;
  const bitLine = act.base + cfg.dropThreshold, lotLine = act.base + cfg.bigDropThreshold;
  lo = Math.min(lo, act.base) - 0.05; hi = Math.max(hi, Number.isFinite(lotLine) ? lotLine : hi) + 0.05;
  const xOf = f => ((f - a) / Math.max(1, b - a)) * (W - 2) + 1;
  const yOf = v => H - ((v - lo) / (hi - lo)) * (H - 4) - 2;   // bigger d = lower hand = lower on the chart
  ctx.fillStyle = "rgba(126,200,255,0.15)";
  ctx.fillRect(xOf(act.sf), 0, xOf(act.ef) - xOf(act.sf), H);
  const line = (v, color, dash) => {
    if (!Number.isFinite(v)) return;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(0, yOf(v)); ctx.lineTo(W, yOf(v)); ctx.stroke(); ctx.restore();
  };
  line(bitLine, COLORS.bit, [3, 3]);
  line(lotLine, COLORS.lot, [3, 3]);
  line(act.base, COLORS.base, [2, 2]);
  line(act.lowest, VERDICT_COLOR[act.verdict], []);
  ctx.strokeStyle = act.other === "L" ? COLORS.l_wrist : COLORS.r_wrist; ctx.lineWidth = 1.5;
  ctx.beginPath(); let started = false;
  for (let f = a; f <= b; f++) {
    const v = arr[f];
    if (!Number.isFinite(v)) { started = false; continue; }
    if (!started) { ctx.moveTo(xOf(f), yOf(v)); started = true; } else ctx.lineTo(xOf(f), yOf(v));
  }
  ctx.stroke();
  if (frame >= a && frame <= b) {
    ctx.strokeStyle = COLORS.marker; ctx.beginPath(); ctx.moveTo(xOf(frame), 0); ctx.lineTo(xOf(frame), H); ctx.stroke();
  }
  ctx.fillStyle = "#aaa"; ctx.font = "10px ui-monospace, monospace";
  ctx.fillText(`${act.other} wrist vs nose, f${a}–${b}`, 4, 10);
}

// ─── stage timeline: one strip per hand ────────────────────────────────────
function ensureStageTimeline() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "padding:4px 0";
  const label = document.createElement("div");
  label.className = "hint";
  label.innerHTML = `per hand: <span style="color:${COLORS.punchEdge}">its own punches</span> · as the resting hand: ` +
    `<span style="color:${COLORS.none}">not lowered</span> / <span style="color:${COLORS.bit}">lowered a bit</span> / ` +
    `<span style="color:${COLORS.lot}">lowered a lot</span> / <span style="color:${COLORS.gated}">gated</span>, tick = lowest point (click to seek)`;
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = "gd-stage-timeline";
  canvas.style.cssText = "display:block;width:100%;height:64px";
  canvas.width = 800; canvas.height = 64;
  wrap.appendChild(canvas);
  slot.appendChild(wrap);
  canvas.addEventListener("click", (e) => {
    const N = cache?.N;
    if (!N) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - TL_LABEL_W) / Math.max(1, rect.width - TL_LABEL_W - 4);
    const f = Math.max(0, Math.min(N - 1, Math.round(ratio * (N - 1))));
    const hit = cache.punches.find(p => f >= p.sf && f <= p.ef);
    if (hit) { activeIdx = hit.idx; }
    loopArmed = !!hit;
    seek(f);
  });
}

function drawStageTimeline(canvas, data, frame) {
  if (!canvas || !data) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.max(1, canvas.getBoundingClientRect().width);
  const cssH = Math.max(1, canvas.getBoundingClientRect().height);
  if (canvas.width !== Math.round(cssW * dpr)) canvas.width = Math.round(cssW * dpr);
  if (canvas.height !== Math.round(cssH * dpr)) canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssH;
  ctx.clearRect(0, 0, W, H);
  const N = data.N;
  if (!N) return;
  const xOf = f => TL_LABEL_W + (f / Math.max(1, N - 1)) * (W - TL_LABEL_W - 4);
  const top = 4, gap = 6;
  const trackH = Math.floor((H - top * 2 - gap) / 2);
  ctx.font = "11px ui-monospace, monospace";
  ["L", "R"].forEach((side, i) => {
    const y = top + i * (trackH + gap);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(xOf(0), y, xOf(N - 1) - xOf(0), trackH);
    for (const p of data.punches) {
      const x0 = xOf(p.sf), x1 = Math.max(xOf(p.ef), x0 + 2);
      if (p.side === side) {
        ctx.fillStyle = COLORS.punch;
        ctx.fillRect(x0, y + 1, x1 - x0, trackH - 2);
      } else {
        ctx.fillStyle = VERDICT_COLOR[p.verdict];
        ctx.fillRect(x0, y + 1, x1 - x0, trackH - 2);
        if (p.lowestFrame >= 0) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(xOf(p.lowestFrame) - 0.5, y, 1.5, trackH);
        }
      }
      if (p.idx === activeIdx) {
        ctx.strokeStyle = COLORS.marker; ctx.lineWidth = 1;
        ctx.strokeRect(x0 - 0.5, y + 0.5, x1 - x0 + 1, trackH - 1);
      }
    }
    ctx.fillStyle = side === "L" ? COLORS.l_wrist : COLORS.r_wrist;
    ctx.fillText(side, 6, y + trackH / 2 + 4);
  });
  ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 1); ctx.lineTo(xOf(frame), H - 1); ctx.stroke();
}

// ─── seek / loop / keys ────────────────────────────────────────────────────
function seek(f) {
  const slider = document.getElementById("scrubber");
  if (!slider) return;
  slider.value = f;
  slider.dispatchEvent(new Event("input", { bubbles: true }));
}

function seekToPunch(i) {
  const data = latestState ? getData(latestState) : null;
  if (!data || !data.punches.length) return;
  activeIdx = Math.max(0, Math.min(data.punches.length - 1, i));
  loopArmed = true;
  const p = data.punches[activeIdx];
  seek(p.sf);
  if (videoEl && cfg.loop) videoEl.play?.().catch?.(() => {});
  refresh(latestState);
  window.__viewerRedraw?.();
}

function installLoop() {
  if (!videoEl) return;
  if (timeupdateHandler) videoEl.removeEventListener("timeupdate", timeupdateHandler);
  timeupdateHandler = () => {
    if (latestState?.rule?.id !== "guard_drop" || !cfg.loop || !loopArmed || activeIdx < 0 || !latestState.fps) return;
    const p = cache?.punches?.[activeIdx];
    if (!p) return;
    const start = latestState.start_sec || 0;
    const pad = Math.round(0.3 * latestState.fps);          // a little context each side
    const endTime = start + (p.ef + pad + 0.5) / latestState.fps;
    const startTime = start + Math.max(0, p.sf - pad) / latestState.fps;
    if (videoEl.currentTime <= endTime && videoEl.currentTime >= startTime - 1) return;
    if (videoEl.paused) { loopArmed = false; return; }   // stepped out by hand — let go
    videoEl.currentTime = startTime;
  };
  videoEl.addEventListener("timeupdate", timeupdateHandler);
}

function installKeys() {
  if (keydownHandler) document.removeEventListener("keydown", keydownHandler, true);
  keydownHandler = (e) => {
    if (latestState?.rule?.id !== "guard_drop") return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "n" || e.key === "N") { seekToPunch(activeIdx + 1); e.preventDefault(); }
    else if (e.key === "p" || e.key === "P") { seekToPunch(activeIdx - 1); e.preventDefault(); }
    else if ((e.key === "m" || e.key === "M") && videoEl) { videoEl.muted = !videoEl.muted; e.preventDefault(); }
  };
  document.addEventListener("keydown", keydownHandler, true);
}

// ─── small helpers ─────────────────────────────────────────────────────────
function fmt(v) { return Number.isFinite(v) ? (v >= 0 ? "+" : "") + v.toFixed(2) : "—"; }
function mmss(t) {
  if (!Number.isFinite(t)) return "—";
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
function setText(id, value, color) {
  const el = host?.querySelector("#" + id);
  if (!el) return;
  el.innerHTML = value;
  if (color !== undefined) el.style.color = color || "";
}
function hline(ctx, y, w, color, lineWidth, dash) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
  if (dash) ctx.setLineDash([dash * 2, dash * 2]);
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  ctx.restore();
}
// Name each overlay line at the right edge, in its colour; labels are pushed
// apart (downwards) so two close lines never print on top of each other.
function lineLabels(ctx, labels, W, s) {
  if (!labels.length) return;
  ctx.save();
  const fs = Math.round(12 * s), pad = 4 * s, h = fs + pad * 2;
  ctx.font = `${fs}px ui-monospace, monospace`;
  ctx.textBaseline = "middle";
  const placed = labels.map(l => ({ ...l, cy: l.y })).sort((a, b) => a.cy - b.cy);
  for (let i = 1; i < placed.length; i++) placed[i].cy = Math.max(placed[i].cy, placed[i - 1].cy + h + 2 * s);
  for (const l of placed) {
    const tw = ctx.measureText(l.text).width + pad * 2;
    const x = W - tw - 8 * s;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(x, l.cy - h / 2, tw, h);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, x + pad, l.cy);
  }
  ctx.restore();
}
function hud(ctx, lines, s) {
  ctx.save();
  const fs = Math.round(13 * s);
  ctx.font = `${fs}px ui-monospace, monospace`;
  const pad = 6 * s;
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + pad * 2;
  const h = lines.length * (fs + 4 * s) + pad * 2;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(8 * s, 8 * s, w, h);
  ctx.fillStyle = "#fff";
  lines.forEach((l, i) => ctx.fillText(l, 8 * s + pad, 8 * s + pad + (i + 1) * (fs + 4 * s) - 4 * s));
  ctx.restore();
}
