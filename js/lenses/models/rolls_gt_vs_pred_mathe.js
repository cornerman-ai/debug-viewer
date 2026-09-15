// Rolls GT vs Pred (Mathe) — the punch classifier's GT-vs-Pred lens, for rolls:
// labeled rolls (the run's GT, or any labeler's live tab) against the ST-GCN roll
// detector's HELD-OUT predictions (video 5-fold), with the per-frame p(roll) graph
// and live decode sliders.
//
// Data: lens_data/roll_detector_mathe/ (index.json + one JSON per round), written by
//   cd ~/code/cornerman-backend && .venv/bin/python \
//     ml/research/defense/roll_detector_mathe/evaluate_roll_detector_mathe.py \
//     --run v1 --lens-out ~/code/cornerman-debug-viewer/lens_data/roll_detector_mathe
//
// Schema:
//   index.json  { generated, run, labels_sha1, metrics: { pooled, fold_mean_std },
//                 geometric, videos: { <stem>: { <ri>: { file, gt, tp, fp, fn, fold } } } }
//   <i>.json    { round_id, stem, ri, fold, training_type, stance, src_fps, t0, dt, n,
//                 decode: { threshold, min_event_s, gap_s, delta },  the fold's LOFO decode
//                 probs: [n],                                  p(roll) at t0 + i·dt (30 fps)
//                 probs_lead: [n] | null,                      the side head's p(lead roll); rear = probs − lead
//                 gt:   [{ s, e, label, verdict, peak }],      the evaluator's verdicts
//                 pred: [{ s, e, score, verdict, side }],
//                 other: [{ s, e, label }],                    John's ducks / slips / pull_backs
//                 baseline: [{ s, e, score }],                 the geometric rule's events
//                 counts: { gt, tp, fp, fn } }
// Times are SOURCE-VIDEO seconds (the caches' `_pts` clock), whatever fps the loaded
// cache has: everything maps through the viewer's clock (secToFrame / frameToSec) the
// way the impact spotter lens does, and the timeline runs in viewer frames like the
// punch lens.
//
// The video and round dropdowns show ONLY footage that has held-out predictions
// (`requiresVideo` / `requires`, answered from index.json; the viewer re-filters when the
// index lands via the lens-filter-changed event, and shows everything if it failed to load).
//
// Decode is re-run HERE from the probabilities, with the fold's LOFO decode as the
// sliders' default — the same runs-above-threshold / gap-fill / valley-split / min-event
// rule as the evaluator (roll_model_mathe.decode_events; δ fixed at the fold's value), run
// PER SIDE when the run is the side head (lead and rear curves decoded on their own and
// merged, each bar tagged L / R — roll_model_mathe.decode_any), and the same one-to-one matching
// (IoU ≥ 0.5, then center-hit, greedy by score), so at the defaults the round stats
// are the evaluator's numbers, and moving a slider shows what a different operating
// point would do on this round.
//
// GT sources (the "GT rolls" checkboxes): the export's own GT — John's reviewed rolls
// frozen at the run, the evaluator's numbers — or, live, any combination of the
// labelers' tabs (John / Arianne / Mathe), read through the labeler web app
// (sheet-labels.js fetchLabelerRowsForStem: `listForeign` as admin walks every
// `Labeled Data <name>` tab; unreviewed rows included; ~15 s per video, then cached
// for the session). Each checked labeler is its own GT lane, matched to the same
// predictions on its own; a prediction is a false alarm only when no checked labeler
// has a roll there; the round stats list one value per lane. The rounds offered stay
// the held-out ones (the run's pool), whoever labels them.

import { fetchLabelerRowsForStem } from "../../sheet-labels.js";

import { createRangeSelection } from "../shared/timeline_selection.js";

const DATA_DIR = "./lens_data/roll_detector_mathe/";
const GRID_FPS = 30;
const IOU_MATCH = 0.5;
const ROLL_LABELS = new Set(["lead_roll", "rear_roll"]);
const OTHER_DEFENSE = new Set(["duck", "lead_slip", "rear_slip", "pull_back", "step_back"]);
const LIVE_LABELERS = ["John", "Arianne", "Mathe"];   // the tabs offered; a further tab seen on the video is added
const BTN_CSS = "background:var(--bg-elev);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:2px 9px;cursor:pointer;font:inherit;font-size:12px";

const COLORS = {
  gtHit:        "#5fd97a",
  gtCenter:     "#b9d95f",           // matched by center-hit only (IoU < 0.5)
  gtMiss:       "#e85a5a",
  gtMissStripe: "#7a2424",
  pred:         "#f5a23c",
  predCenter:   "#d9c15f",
  predFAStripe: "rgba(0,0,0,0.4)",
  other:        "rgba(126,200,255,0.45)",
  baseline:     "#b48cff",
  prob:         "#8ab4f8",
  probFill:     "rgba(138,180,248,0.25)",
  probLead:     "#ff8fa3",           // the side head's two curves over the summed area
  probRear:     "#7ee0c0",
  thr:          "rgba(255,255,255,0.45)",
  playhead:     "rgba(255,255,255,0.85)",
  rowBg:        "#1d222b",
};

let host = null;
let index = null, indexError = null;
let doc = null, docKey = null, docError = null, docFile = null;
let signals = null;            // decoded + matched events for the scoped round
let cfg = { threshold: 0.5, minEventS: 0.27, gapS: 0.17 };
let showOther = true, showBase = false;
let gtSources = ["run"];       // ["run"] = the export's GT, else the checked labelers (LIVE_LABELERS order)
let live = { key: null, status: "idle", rows: null, labelers: [], error: null, source: null };  // one video's tabs
let liveToken = 0;
let latestState = null;
let view = null;               // zoom window in viewer frames; null = whole round
let lastFrame = 0, lastDrawnFrame = -1, lastZoomLabel = "";
let selection = null;         // drag-selected frame range (shared/timeline_selection.js)

// ── clock helpers (same convention as the impact spotter lens) ──────────────
function stripStem(s) { return String(s || "").replace(/_h264$/, ""); }
function poseOf(state) { return state.poseV6 || state.pose || null; }
function startSec(state) { const p = poseOf(state); return (p && (p.start_sec || 0)) || 0; }
function secToFrame(state, tSrc) {
  const fps = state.fps || 30;
  return Math.floor(tSrc * fps + 1e-6) - Math.floor(startSec(state) * fps + 1e-6);
}
function secToFrameF(state, tSrc) {      // fractional, for the graph
  const fps = state.fps || 30;
  return tSrc * fps - Math.floor(startSec(state) * fps + 1e-6) - 0.5;
}
function frameToSec(state, f) {
  const fps = state.fps || 30;
  return (Math.floor(startSec(state) * fps) + f + 0.5) / fps;
}
function nFrames(state) { const p = poseOf(state); return p ? p.n_frames : 0; }
function seekHack(f) {
  const slider = document.getElementById("scrubber");
  if (!slider) return;
  slider.value = Math.max(0, Math.round(f));
  slider.dispatchEvent(new Event("input", { bubbles: true }));
}
function fmt(v, d = 3) { return Number.isFinite(v) ? v.toFixed(d) : "—"; }
function pct(v) { return v == null || !Number.isFinite(v) ? "—" : (v * 100).toFixed(0) + "%"; }
function fmtTime(sec, withTenths = false) {
  if (withTenths) { const m = Math.floor(sec / 60); return `${m}:${(sec - m * 60).toFixed(1).padStart(4, "0")}`; }
  const t = Math.round(sec), m = Math.floor(t / 60);
  return `${m}:${String(t - m * 60).padStart(2, "0")}`;
}

// ── decode + matching (ports of roll_model_mathe.decode_events / roll_metrics_mathe) ──
// the punch pipeline's valley split (punch_detector._split_at_valleys): cut [s, e) at its
// deepest internal minimum when that dip is at least `delta` below the lower flanking peak
function splitAtValleys(probs, s, e, delta) {
  if (delta == null || e - s < 3) return [[s, e]];
  let m = s + 1, mv = probs[m];
  for (let i = s + 2; i < e - 1; i++) if (probs[i] < mv) { mv = probs[i]; m = i; }
  let left = -Infinity, right = -Infinity;
  for (let i = s; i < m; i++) left = Math.max(left, probs[i]);
  for (let i = m + 1; i < e; i++) right = Math.max(right, probs[i]);
  if (Math.min(left, right) - mv < delta) return [[s, e]];
  return [...splitAtValleys(probs, s, m + 1, delta), ...splitAtValleys(probs, m + 1, e, delta)];
}
function decodeEvents(probs, thr, minEventS, gapS, delta = null) {
  const gap = Math.round(gapS * GRID_FPS);
  const minLen = Math.max(1, Math.round(minEventS * GRID_FPS));
  let runs = [];
  let i = 0;
  const n = probs.length;
  while (i < n) {
    if (probs[i] >= thr) {
      let j = i;
      while (j < n && probs[j] >= thr) j++;
      if (runs.length && i - runs[runs.length - 1][1] <= gap) runs[runs.length - 1][1] = j;
      else runs.push([i, j]);
      i = j;
    } else i++;
  }
  if (delta != null) runs = runs.flatMap(([s, e]) => splitAtValleys(probs, s, e, delta));
  const out = [];
  for (const [s, e] of runs) {
    if (e - s < minLen) continue;
    let sum = 0;
    for (let k = s; k < e; k++) sum += probs[k];
    out.push({ sf: s, ef: e, score: sum / (e - s) });
  }
  return out;
}
// the run's events under the sliders: per side for the side head (roll_model_mathe.decode_any),
// the summed curve otherwise; δ is the fold's, not a slider
function decodePred(d, c) {
  const delta = d.decode && d.decode.delta != null ? d.decode.delta : null;
  if (!d.probs_lead) return decodeEvents(d.probs, c.threshold, c.minEventS, c.gapS, delta);
  const rear = d.probs.map((v, i) => Math.max(0, v - d.probs_lead[i]));
  const lead = decodeEvents(d.probs_lead, c.threshold, c.minEventS, c.gapS, delta).map(p => ({ ...p, side: "lead_roll" }));
  const rr = decodeEvents(rear, c.threshold, c.minEventS, c.gapS, delta).map(p => ({ ...p, side: "rear_roll" }));
  return [...lead, ...rr].sort((a, b) => a.sf - b.sf);
}
function sideWord(p) { return p && p.side === "lead_roll" ? "lead roll" : p && p.side === "rear_roll" ? "rear roll" : "roll"; }
function sideTag(p) { return p && p.side === "lead_roll" ? "L " : p && p.side === "rear_roll" ? "R " : ""; }
function spanIou(a0, a1, b0, b1) {
  const inter = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const union = (a1 - a0) + (b1 - b0) - inter;
  return union > 0 ? inter / union : 0;
}
function matchEvents(gt, pred, mode) {
  const order = pred.map((_, i) => i).sort((a, b) => pred[b].score - pred[a].score);
  const taken = new Set(), pairs = new Map();      // gi -> pi
  for (const pi of order) {
    const p = pred[pi];
    let best = null, bestV = null;
    gt.forEach((g, gi) => {
      if (taken.has(gi)) return;
      let v;
      if (mode === "iou") {
        v = spanIou(p.sf, p.ef, g.sf, g.ef);
        if (v < IOU_MATCH) return;
      } else {
        const mid = 0.5 * (g.sf + g.ef);
        if (!(p.sf <= mid && mid < p.ef)) return;
        v = -Math.abs(0.5 * (p.sf + p.ef) - mid);
      }
      if (bestV === null || v > bestV) { best = gi; bestV = v; }
    });
    if (best !== null) { taken.add(best); pairs.set(best, pi); }
  }
  return pairs;
}

// ── data ────────────────────────────────────────────────────────────────────
// Every fetch carries a version so a CDN (GitHub Pages caches for minutes) can never
// hand back an old index.json next to new round files, or the reverse; the round files
// are named by a hash of the round id, so a stale pair can only ever be the SAME round.
let indexLoading = null;
function ensureIndex() {
  if (index || indexError) return Promise.resolve();
  if (!indexLoading) {
    indexLoading = (async () => {
      try {
        const res = await fetch(`${DATA_DIR}index.json?v=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        index = await res.json();
      } catch (e) { indexError = String(e); }
      // the dropdowns asked requiresVideo() before the index was in — re-filter them now
      window.dispatchEvent(new Event("lens-filter-changed"));
    })();
  }
  return indexLoading;
}

// index.videos entry for a cache basename: exact stem first, then substring either way
// (a cache stem may carry _h264 or differ by a suffix from the export's stem).
// a round is worth opening when it has a labeled roll or a predicted one (Mathe, 2026-09-15):
// the all-background rounds where nothing fired stay out of the dropdowns
function hasRolls(e) { return !!e && (e.gt > 0 || e.tp + e.fp > 0); }
function videoEntry(base) {
  if (!index || !base) return null;
  const want = stripStem(base);
  const pick = (k) => {
    const rounds = Object.fromEntries(Object.entries(index.videos[k]).filter(([, e]) => hasRolls(e)));
    return Object.keys(rounds).length ? { stem: k, rounds } : null;
  };
  if (index.videos[want]) return pick(want);
  const hit = Object.keys(index.videos).find(k => want.includes(k) || k.includes(want));
  return hit ? pick(hit) : null;
}

async function loadDoc(file, key, expect = null) {
  docKey = key; doc = null; docError = null; docFile = file; signals = null; view = null;
  selection?.clear();
  try {
    const v = encodeURIComponent(index?.generated || Date.now());
    const res = await fetch(`${DATA_DIR}${file}?v=${v}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (docKey !== key) return;
    if (expect && (stripStem(d.stem) !== stripStem(expect.stem) || Number(d.ri) !== Number(expect.ri))) {
      throw new Error(`file ${file} holds ${d.stem} r${d.ri}, not ${expect.stem} r${expect.ri} — ` +
        `stale cached data; hard-reload the page (Cmd/Ctrl+Shift+R)`);
    }
    doc = d;
    cfg = { threshold: d.decode.threshold, minEventS: d.decode.min_event_s, gapS: d.decode.gap_s };
    syncSliders();
  } catch (e) { if (docKey === key) docError = String(e); }
  if (docKey !== key) return;
  derive();
  renderAll();
}

function entryFor(state) {
  if (!state || state.cacheRound == null) return null;
  const v = videoEntry(state.cacheBasename);
  const e = v && v.rounds[String(state.cacheRound)];
  return e ? { ...e, stem: v.stem, ri: state.cacheRound } : null;
}

function refreshScope(state) {
  if (isLive()) ensureLive();
  const entry = entryFor(state);
  const key = entry ? entry.file : `none:${state?.cacheBasename}|${state?.cacheRound}`;
  if (key === docKey) return;
  if (!entry) {
    docKey = key; doc = null; docFile = null; signals = null; view = null;
    selection?.clear();
    renderAll();
    return;
  }
  const sel = host?.querySelector("#rg-round");
  if (sel) sel.value = entry.file;
  loadDoc(entry.file, key, { stem: entry.stem, ri: entry.ri });
}

// ── derive: decode with the sliders, match each GT lane, tag ────────────────
function isLive() { return gtSources[0] !== "run"; }
function initialOf(src) { return src === "run" ? "run" : src.charAt(0).toUpperCase(); }
function knownLabelers() { return [...LIVE_LABELERS, ...live.labelers.filter(l => !LIVE_LABELERS.includes(l))]; }
function inRound(r) { const t1 = doc.t0 + doc.n * doc.dt; return r.start_sec < t1 && r.end_sec > doc.t0; }
function liveRows(labeler, keep) {
  return (live.rows || []).filter(r => r.labeler === labeler && keep(r.label) && inRound(r))
    .map(r => ({ s: r.start_sec, e: r.end_sec, label: r.label }));
}
// A source's GT rolls + its other defense labels: the export's (run) or a labeler's live rows.
function sourceEvents(src) {
  if (src === "run") return { gt: doc.gt, other: doc.other || [], pending: false };
  if (live.status !== "ok") return { gt: [], other: [], pending: true };
  return { gt: liveRows(src, l => ROLL_LABELS.has(l)), other: liveRows(src, l => OTHER_DEFENSE.has(l)), pending: false };
}

function derive() {
  if (!doc || !latestState) { signals = null; return; }
  const st = latestState;
  const toGrid = (sec) => Math.round((sec - doc.t0) / doc.dt);
  const vf = (ev) => ({ vf0: secToFrame(st, ev.s), vf1: Math.max(secToFrame(st, ev.s), secToFrame(st, ev.e) - 1) });
  const pred = decodePred(doc, cfg).map(p => ({
    ...p, s: doc.t0 + p.sf * doc.dt, e: doc.t0 + p.ef * doc.dt }));
  // every lane is matched to the same predictions on its own; a prediction is
  // "correct" when any lane claims it, a false alarm when none does
  const predIou = new Set(), predCenter = new Set();
  const lanes = gtSources.map(src => {
    const ev = sourceEvents(src);
    const gt = ev.gt.map(g => ({ ...g, sf: toGrid(g.s), ef: Math.max(toGrid(g.s) + 1, toGrid(g.e)) }));
    const iou = matchEvents(gt, pred, "iou");
    const center = matchEvents(gt, pred, "center");
    for (const pi of iou.values()) predIou.add(pi);
    for (const pi of center.values()) predCenter.add(pi);
    const tagged = gt.map((g, gi) => ({
      ...g, status: iou.has(gi) ? "hit" : center.has(gi) ? "center" : "miss", ...vf(g) }));
    const tp = iou.size, fp = pred.length - tp, fn = gt.length - tp;
    const p = tp + fp ? tp / (tp + fp) : null, r = gt.length ? tp / gt.length : null;
    let sErr = 0, eErr = 0;
    for (const [gi, pi] of iou) { sErr += Math.abs(pred[pi].sf - gt[gi].sf); eErr += Math.abs(pred[pi].ef - gt[gi].ef); }
    return {
      src, name: src === "run" ? "GT rolls" : `GT ${src}`, initial: initialOf(src), pending: ev.pending,
      gt: tagged, other: ev.other,
      stats: { nGt: gt.length, nPred: pred.length, tp, fp, fn, precision: p, recall: r,
               f1: p != null && r != null && p + r ? 2 * p * r / (p + r) : (gt.length || pred.length ? 0 : null),
               centerRecall: gt.length ? center.size / gt.length : null,
               startMae: tp ? sErr / tp : null, endMae: tp ? eErr / tp : null },
    };
  });
  const predTagged = pred.map((p, pi) => ({
    ...p, status: predIou.has(pi) ? "correct" : predCenter.has(pi) ? "center" : "fa", ...vf(p) }));
  // the lanes' other defense labels share one thin row (named by lane when there are several)
  const other = [];
  for (const lane of lanes) for (const o of lane.other) other.push({ ...o, lane, ...vf(o) });
  const base = (doc.baseline || []).map(b => ({ ...b, ...vf(b) }));
  signals = {
    lanes, pred: predTagged, other, base,
    atDefault: cfg.threshold === doc.decode.threshold && cfg.minEventS === doc.decode.min_event_s && cfg.gapS === doc.decode.gap_s,
  };
}

function findEvent(events, f) {
  for (const e of events) if (f >= e.vf0 && f <= e.vf1) return e;
  return null;
}
function probAtFrame(state, f) {
  if (!doc) return NaN;
  const i = Math.round((frameToSec(state, f) - doc.t0) / doc.dt);
  return i >= 0 && i < doc.n ? doc.probs[i] : NaN;
}
function sideProbsAtFrame(state, f) {        // { lead, rear } for the side head, else null
  if (!doc || !doc.probs_lead) return null;
  const i = Math.round((frameToSec(state, f) - doc.t0) / doc.dt);
  if (i < 0 || i >= doc.n) return null;
  return { lead: doc.probs_lead[i], rear: Math.max(0, doc.probs[i] - doc.probs_lead[i]) };
}

// ── mount / template ────────────────────────────────────────────────────────
export const RollsGtVsPredMatheRule = {
  id: "rolls_gt_vs_pred_mathe",
  label: "Rolls GT vs Pred (Mathe)",

  // Only videos / rounds with held-out predictions AND at least one labeled or predicted
  // roll are offered. Before the index is in: nothing (the load re-filters the dropdowns);
  // if it failed to load: everything.
  requiresVideo(base) {
    if (indexError) return true;
    if (!index) { ensureIndex(); return false; }
    return !!videoEntry(base);
  },
  requires(slot, { base, round } = {}) {
    if (indexError) return true;
    if (!index) { ensureIndex(); return false; }
    const v = videoEntry(base);
    return !!(v && v.rounds[String(round)]);
  },

  mount(_host, state) {
    host = _host;
    latestState = state;
    host.innerHTML = template();
    mountStageTimeline();
    wireControls();
    renderSourcePicker();
    ensureIndex().then(() => {
      const sel = document.getElementById("rule-select");
      if (sel && sel.value && sel.value !== "rolls_gt_vs_pred_mathe") return;
      renderRun();
      populateRoundPicker();
      docKey = null;
      refreshScope(latestState);
      renderAll();
    });
  },

  update(state) {
    latestState = state;
    lastFrame = state.frame;
    if (!index) return;
    refreshScope(state);
    if (!signals) return;
    drawTimeline(document.getElementById("rg-timeline"), state.frame);
    renderFrameLine(state);
  },

  draw(ctx, state) {
    if (!signals) return;
    drawCanvasHud(ctx, state);
  },
};

function template() {
  return `
    <h2>Rolls — GT vs Pred (Mathe)</h2>
    <p class="hint">Labeled rolls against the roll detector's held-out predictions
      for this round (video 5-fold; the model never trained on this video), with the
      per-frame p(roll) graph. Auto-scopes to the loaded video + round.</p>

    <h3>Run</h3>
    <p class="hint" id="rg-run">loading…</p>

    <h3>Round</h3>
    <select id="rg-round" disabled><option value="">— loading —</option></select>
    <p class="hint" id="rg-round-hint"></p>

    <h3>GT rolls</h3>
    <div id="rg-src" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:2px 0 4px"></div>
    <p class="hint" id="rg-src-hint"></p>

    <h3>Decode</h3>
    <label class="slider">
      <span>threshold = <output id="rg-thr-out">0.50</output></span>
      <input type="range" id="rg-thr" min="0.05" max="0.95" step="0.05" value="0.5">
    </label>
    <label class="slider">
      <span>min event = <output id="rg-min-out">0.27</output> s</span>
      <input type="range" id="rg-min" min="0" max="0.8" step="0.033" value="0.27">
    </label>
    <label class="slider">
      <span>gap fill = <output id="rg-gap-out">0.17</output> s</span>
      <input type="range" id="rg-gap" min="0" max="0.5" step="0.033" value="0.17">
      <span class="muted small" id="rg-decode-note"></span>
    </label>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0 8px">
      <button type="button" id="rg-reset" style="background:var(--bg-elev);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:2px 9px;cursor:pointer;font:inherit;font-size:12px">reset to the fold's decode</button>
      <label class="muted small" style="cursor:pointer"><input type="checkbox" id="rg-other"> other defense labels</label>
      <label class="muted small" style="cursor:pointer"><input type="checkbox" id="rg-base"> geometric baseline</label>
    </div>

    <h3>Round stats</h3>
    <div class="metric-grid">
      <div class="metric"><div class="metric-label">Recall</div><div class="metric-val" id="rg-recall">—</div><div class="metric-sub muted">found / GT rolls, IoU ≥ 0.5</div></div>
      <div class="metric"><div class="metric-label">Precision</div><div class="metric-val" id="rg-precision">—</div><div class="metric-sub muted">true / predicted rolls</div></div>
      <div class="metric"><div class="metric-label">F1</div><div class="metric-val" id="rg-f1">—</div></div>
      <div class="metric"><div class="metric-label">Center-hit recall</div><div class="metric-val" id="rg-center">—</div><div class="metric-sub muted">prediction contains the roll's midpoint</div></div>
      <div class="metric"><div class="metric-label">N rolls (GT / Pred)</div><div class="metric-val" id="rg-counts">—</div></div>
      <div class="metric"><div class="metric-label">Boundary MAE</div><div class="metric-val" id="rg-mae">—</div><div class="metric-sub muted">start / end, 30 fps frames, matched rolls</div></div>
    </div>
    <p class="hint" id="rg-stat-line"></p>
    <p class="hint" id="rg-frame-line"></p>

    <h3>Timeline</h3>
    <p class="hint">Below the video: GT rolls, one lane per checked source (green = found ·
      yellow-green = center-hit only · red striped = missed), a thin row of the sources'
      OTHER defense labels (blue: duck, slip, step back, pull back — not rolls, shown so a
      false alarm can be read against them), predicted rolls (orange = true · hatched =
      false alarm, no checked source has a roll there · yellow = center-hit only), and the
      p(roll) graph with the threshold line. Click to seek · drag to select a range (then Export /
      Zoom to in the timeline header) · shift-drag to pan · wheel to zoom · double-click to fit.</p>
  `;
}

function wireControls() {
  const bind = (id, outId, key, fmtv) => {
    const input = host.querySelector("#" + id), out = host.querySelector("#" + outId);
    input.addEventListener("input", () => {
      cfg[key] = parseFloat(input.value);
      out.textContent = fmtv(cfg[key]);
      derive();
      renderAll();
      if (window.__viewerRedraw) window.__viewerRedraw();
    });
  };
  bind("rg-thr", "rg-thr-out", "threshold", v => v.toFixed(2));
  bind("rg-min", "rg-min-out", "minEventS", v => v.toFixed(2));
  bind("rg-gap", "rg-gap-out", "gapS", v => v.toFixed(2));
  host.querySelector("#rg-reset").addEventListener("click", () => {
    if (!doc) return;
    cfg = { threshold: doc.decode.threshold, minEventS: doc.decode.min_event_s, gapS: doc.decode.gap_s };
    syncSliders(); derive(); renderAll();
    if (window.__viewerRedraw) window.__viewerRedraw();
  });
  const other = host.querySelector("#rg-other"), base = host.querySelector("#rg-base");
  other.checked = showOther; base.checked = showBase;
  other.addEventListener("change", () => { showOther = other.checked; redrawTimelineNow(); });
  base.addEventListener("change", () => { showBase = base.checked; redrawTimelineNow(); });
  host.querySelector("#rg-src").addEventListener("change", (e) => {
    const box = e.target;
    if (box instanceof HTMLInputElement && box.dataset.src) setSources(box.dataset.src, box.checked);
  });
  host.querySelector("#rg-src").addEventListener("click", (e) => {
    if (e.target.id === "rg-live-refresh") { ensureLive(true); renderSourcePicker(); renderAll(); }
  });
  host.querySelector("#rg-round").addEventListener("change", (e) => {
    const file = e.target.value;
    if (!file) return;
    const o = e.target.selectedOptions[0];
    loadDoc(file, file, o?.dataset.stem ? { stem: o.dataset.stem, ri: o.dataset.ri } : null);
  });
}

// ── GT sources: the run's GT, or the labelers' live tabs ────────────────────
function setSources(src, checked) {
  let next;
  if (src === "run") next = checked ? ["run"] : gtSources.filter(s => s !== "run");
  else {
    const set = new Set(gtSources.filter(s => s !== "run"));
    if (checked) set.add(src); else set.delete(src);
    next = [...set];
  }
  if (!next.length) next = ["run"];                 // never nothing: back to the run's GT
  const order = ["run", ...knownLabelers()];
  gtSources = next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (isLive()) ensureLive();
  renderSourcePicker();
  derive(); renderAll();
  if (window.__viewerRedraw) window.__viewerRedraw();
}

// One fetch per video (its rounds share it); `force` re-reads the tabs.
function ensureLive(force = false) {
  const key = latestState?.cacheBasename || null;
  if (!key) { live = { key: null, status: "error", rows: null, labelers: [], error: "load a video first", source: null }; return; }
  if (!force && live.key === key && live.status !== "idle") return;
  const t = ++liveToken;
  live = { key, status: "loading", rows: null, labelers: [], error: null, source: null };
  fetchLabelerRowsForStem(key, { force }).then(res => {
    if (t !== liveToken) return;                     // another video was loaded meanwhile
    live = res.error
      ? { key, status: "error", rows: null, labelers: [], error: res.error, source: null }
      : { key, status: "ok", rows: res.rows, labelers: res.labelers, error: null, source: res.source_video };
    renderSourcePicker();
    derive(); renderAll();
    if (window.__viewerRedraw) window.__viewerRedraw();
  });
}

function renderSourcePicker() {
  const box = host?.querySelector("#rg-src");
  if (!box) return;
  const items = [["run", "run GT (John, frozen)"], ...knownLabelers().map(l => [l, l])];
  box.innerHTML = items.map(([src, text]) =>
    `<label class="muted small" style="cursor:pointer"><input type="checkbox" data-src="${src}"` +
    `${gtSources.includes(src) ? " checked" : ""}> ${text}</label>`).join("") +
    (isLive() ? `<button type="button" id="rg-live-refresh" title="Re-read the labelers' tabs for this video" style="${BTN_CSS}">re-pull</button>` : "");
}

function renderSourceHint() {
  const el = host?.querySelector("#rg-src-hint");
  if (!el) return;
  if (!isLive()) {
    el.innerHTML = `the run's GT: John's reviewed rolls on the pool videos, frozen at the run` +
      (index?.labels_sha1 ? ` <span class="muted">(labels ${index.labels_sha1})</span>` : "") + ` — the evaluator's verdicts`;
    return;
  }
  if (live.status === "loading") {
    el.innerHTML = `reading the labelers' tabs for this video… <span class="muted">(~15 s; unreviewed rows included)</span>`;
    return;
  }
  if (live.status !== "ok") { el.innerHTML = `<span style="color:${COLORS.gtMiss}">live labels: ${live.error || "not loaded"}</span>`; return; }
  const counts = doc ? knownLabelers().map(l => `${l} ${liveRows(l, x => ROLL_LABELS.has(x)).length}`) : [];
  el.innerHTML = `live tabs of <code>${live.source}</code>` +
    (counts.length ? ` · rolls in this round: ${counts.join(" · ")}` : "") +
    ` <span class="muted">(${live.rows.length} rows on the video; one lane and one stats value per checked name)</span>`;
}

function syncSliders() {
  if (!host) return;
  const set = (id, outId, v, d) => {
    const i = host.querySelector("#" + id), o = host.querySelector("#" + outId);
    if (i) i.value = v; if (o) o.textContent = Number(v).toFixed(d);
  };
  set("rg-thr", "rg-thr-out", cfg.threshold, 2);
  set("rg-min", "rg-min-out", cfg.minEventS, 2);
  set("rg-gap", "rg-gap-out", cfg.gapS, 2);
}

function renderRun() {
  const el = host.querySelector("#rg-run");
  if (!el) return;
  if (indexError) {
    el.innerHTML = `<span style="color:${COLORS.gtMiss}">${DATA_DIR}index.json failed to load (${indexError}).</span> ` +
      `Write it with <code>evaluate_roll_detector_mathe.py --run v1 --lens-out …/lens_data/roll_detector_mathe</code>`;
    return;
  }
  const m = index.metrics?.pooled || {}, f = index.metrics?.fold_mean_std || {}, g = index.geometric;
  const pm = (k) => f[k] ? `${fmt(f[k][0])} ± ${fmt(f[k][1])}` : "—";
  el.innerHTML = `run <code>${index.run}</code> · ${index.n_rounds} rounds held out · ` +
    `<span class="muted">${String(index.generated || "").slice(0, 16)} · labels ${index.labels_sha1}</span><br>` +
    `<b>F1 ${fmt(m.f1)}</b> · recall ${fmt(m.recall)} · precision ${fmt(m.precision)} ` +
    `<span class="muted">(IoU ≥ 0.5, pooled; per fold ${pm("f1")})</span><br>` +
    `center-hit F1 ${fmt(m.center_f1)} · boundary MAE ${fmt(m.start_mae_frames, 1)} / ${fmt(m.end_mae_frames, 1)} frames · ` +
    `frame PR-AUC ${fmt(m.frame_pr_auc)}` +
    (g ? `<br><span style="color:${COLORS.baseline}">geometric baseline F1 ${fmt(g.f1[0])} ± ${fmt(g.f1[1])}</span>` : "");
}

function populateRoundPicker() {
  const sel = host.querySelector("#rg-round");
  if (!sel) return;
  sel.innerHTML = "";
  if (!index) { sel.innerHTML = `<option value="">— no data —</option>`; sel.disabled = true; return; }
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = "— pick a round —";
  sel.appendChild(ph);
  const rows = [];
  for (const [stem, rounds] of Object.entries(index.videos)) {
    for (const [ri, e] of Object.entries(rounds)) if (hasRolls(e)) rows.push({ stem, ri: Number(ri), ...e });
  }
  rows.sort((a, b) => a.stem.localeCompare(b.stem) || a.ri - b.ri);
  for (const r of rows) {
    const o = document.createElement("option");
    o.value = r.file;
    o.dataset.stem = r.stem; o.dataset.ri = String(r.ri);
    const p = r.tp + r.fp ? r.tp / (r.tp + r.fp) : 0, rc = r.gt ? r.tp / r.gt : 0;
    const f1 = p + rc ? 2 * p * rc / (p + rc) : 0;
    o.textContent = `${r.stem} · r${r.ri} · F1 ${(f1 * 100).toFixed(0)}% (${r.gt} GT / ${r.tp + r.fp} pred) · fold ${r.fold}`;
    sel.appendChild(o);
  }
  sel.disabled = false;
}

function renderAll() {
  if (!host) return;
  renderStats();
  renderRoundHint();
  renderSourceHint();
  const st = latestState;
  if (st) { drawTimeline(document.getElementById("rg-timeline"), st.frame); renderFrameLine(st); }
}

function renderRoundHint() {
  const el = host.querySelector("#rg-round-hint");
  if (!el) return;
  if (docError) { el.innerHTML = `<span style="color:${COLORS.gtMiss}">round data failed to load (${docError})</span>`; return; }
  if (!doc) {
    el.innerHTML = latestState?.cacheBasename
      ? `no held-out predictions for <code>${latestState.cacheBasename}</code> r${latestState.cacheRound} — ` +
        `not in the pool (John's finished videos) or its fold is not trained yet. Pick a round above to browse.`
      : `load a video so the lens can auto-match a round, or pick one above.`;
    return;
  }
  const d = doc.decode;
  el.innerHTML = `scoped to <code>${doc.stem} · r${doc.ri}</code> · fold ${doc.fold} · ${doc.training_type || "?"} · ` +
    `${doc.stance} · ${doc.src_fps} fps source · fold decode thr ${d.threshold} / min ${d.min_event_s} s / gap ${d.gap_s} s`;
  const note = host.querySelector("#rg-decode-note");
  if (note) note.textContent = !signals?.atDefault ? "changed — stats below are this round re-decoded"
    : isLive() ? "= the evaluator's decode for this fold (GT: the live tabs, not the run's)"
    : "= the evaluator's decode for this fold (its verdicts)";
}

function renderStats() {
  const set = (id, html) => { const el = host.querySelector("#" + id); if (el) el.innerHTML = html; };
  if (!signals) {
    for (const id of ["rg-recall", "rg-precision", "rg-f1", "rg-center", "rg-counts", "rg-mae"]) set(id, "—");
    set("rg-stat-line", "");
    return;
  }
  // one value per GT lane, prefixed with the lane's initial when there are several
  const L = signals.lanes, many = L.length > 1;
  const val = (fn) => L.map(ln => (many ? `<span class="muted small">${ln.initial}</span> ` : "") +
                                  (ln.pending ? "…" : fn(ln.stats))).join(" · ");
  set("rg-recall", val(s => pct(s.recall))); set("rg-precision", val(s => pct(s.precision))); set("rg-f1", val(s => pct(s.f1)));
  set("rg-center", val(s => pct(s.centerRecall))); set("rg-counts", val(s => `${s.nGt} / ${s.nPred}`));
  set("rg-mae", val(s => s.startMae == null ? "—" : `${s.startMae.toFixed(1)} / ${s.endMae.toFixed(1)}`));
  set("rg-stat-line", L.map(ln => `<span class="muted small">${many ? ln.initial + ": " : ""}` +
    (ln.pending ? "loading…" : `true ${ln.stats.tp} · missed ${ln.stats.fn} · false+ ${ln.stats.fp}`) + `</span>`).join(" · "));
}

function firstGt(f) {
  for (const ln of signals.lanes) { const g = findEvent(ln.gt, f); if (g) return g; }
  return null;
}

function renderFrameLine(state) {
  const el = host.querySelector("#rg-frame-line");
  if (!el || !signals) return;
  const f = state.frame;
  const p = probAtFrame(state, f);
  const pr = findEvent(signals.pred, f), g0 = firstGt(f);
  const many = signals.lanes.length > 1;
  const gt = signals.lanes.map(ln => {
    const g = findEvent(ln.gt, f), o = findEvent(ln.other, f);
    return (many ? `${ln.initial} ` : "") + (g ? `<span style="color:${gtColor(g)}">${g.label} (${g.status})</span>`
      : o ? `<span style="color:#7ec8ff">${o.label}</span> <span class="muted">(not a roll)</span>`
      : `<span class="muted">${ln.pending ? "loading…" : "idle"}</span>`);
  }).join(" · ");
  const sp = sideProbsAtFrame(state, f);
  el.innerHTML = `f${f} · t ${fmtTime(frameToSec(state, f), true)} · p(roll) <b>${fmt(p, 2)}</b>` +
    (sp ? ` <span class="muted">(lead ${fmt(sp.lead, 2)} · rear ${fmt(sp.rear, 2)})</span>` : "") + ` · GT ${gt} · ` +
    `pred ${pr ? `<span style="color:${predColor(pr, g0)}">${sideWord(pr)} · ${pr.status} · ${fmt(pr.score, 2)}</span>` : "<span class=\"muted\">idle</span>"}`;
}

// ── stage timeline (zoom / pan / seek machinery mirrors the punch lens) ──────
const LABEL_W = 64, PAD_R = 4, MIN_SPAN_FRAMES = 30;
const TL_TOP = 4, TL_GAP = 4, BAR_H = 18, OTHER_H = 12, GRAPH_H = 86, AXIS_H = 16;   // 166 px with one GT lane
const ZOOM_HINT = "click = seek · drag = select · shift-drag = pan · wheel = zoom · double-click = fit";

function mountStageTimeline() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.id = "rg-timeline-wrap";
  wrap.style.cssText = "margin-top:12px;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px";
  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px";
  const label = document.createElement("div");
  label.id = "rg-tl-label";
  label.className = "muted small";
  label.style.cssText = "flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  label.textContent = `Rolls GT vs Pred timeline — ${ZOOM_HINT}`;
  header.appendChild(label);
  const btnCss = "background:var(--bg-elev);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:2px 9px;cursor:pointer;font:inherit;font-size:12px;line-height:1.4";
  const mkBtn = (text, title, onClick) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = text; b.title = title; b.style.cssText = btnCss;
    b.addEventListener("click", onClick); header.appendChild(b);
  };
  mkBtn("−", "Zoom out", () => zoomStep(0.5));
  mkBtn("+", "Zoom in on the playhead", () => zoomStep(2));
  mkBtn("Fit", "Show the whole round", () => { view = null; redrawTimelineNow(); });
  selection = createRangeSelection({
    header, frameToX, xToFrame,
    frameToSec: f => frameToSec(latestState, f), nFrames: () => nFrames(latestState),
    seek: f => seekHack(f), zoomTo: zoomToRange, redraw: redrawTimelineNow,
  });
  wrap.appendChild(header);
  const canvas = document.createElement("canvas");
  canvas.id = "rg-timeline";
  canvas.style.cssText = "display:block;width:100%;height:166px";
  canvas.width = 800; canvas.height = 166;
  wrap.appendChild(canvas);
  slot.appendChild(wrap);

  canvas.addEventListener("wheel", e => {
    if (!signals) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { panBy(e.deltaX * framesPerPx(rect.width)); return; }
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(Math.exp(-dy * 0.002), xToFrame(e.clientX - rect.left, rect.width));
  }, { passive: false });
  canvas.addEventListener("mousedown", e => {
    if (!signals || e.button !== 0) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    if (!e.shiftKey) { selection.beginDrag(e, rect); return; }   // drag = select a range · click = seek
    // shift-drag = pan the zoom window
    const fpp = framesPerPx(rect.width);
    let lastX = e.clientX;
    const onMove = ev => { panBy((lastX - ev.clientX) * fpp); lastX = ev.clientX; };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
  canvas.addEventListener("dblclick", e => { e.preventDefault(); view = null; redrawTimelineNow(); });
}

function viewRange() {
  const N = Math.max(2, nFrames(latestState) || 2);
  if (!view) return { v0: 0, v1: N - 1 };
  return { v0: view.start, v1: view.end };
}
function frameToX(f, cssW) { const { v0, v1 } = viewRange(); return LABEL_W + ((f - v0) / Math.max(1e-6, v1 - v0)) * (cssW - LABEL_W - PAD_R); }
function xToFrame(x, cssW) { const { v0, v1 } = viewRange(); return v0 + ((x - LABEL_W) / Math.max(1, cssW - LABEL_W - PAD_R)) * (v1 - v0); }
function framesPerPx(cssW) { const { v0, v1 } = viewRange(); return (v1 - v0) / Math.max(1, cssW - LABEL_W - PAD_R); }
function zoomAt(factor, anchorFrame) {
  if (!signals) return;
  const full = Math.max(1, nFrames(latestState) - 1);
  const { v0, v1 } = viewRange();
  const span = Math.max(Math.min(MIN_SPAN_FRAMES, full), Math.min(full, (v1 - v0) / factor));
  if (span >= full) { view = null; redrawTimelineNow(); return; }
  let start = anchorFrame - (anchorFrame - v0) * (span / (v1 - v0));
  start = Math.max(0, Math.min(full - span, start));
  view = { start, end: start + span };
  redrawTimelineNow();
}
// Fit the zoom window to a frame range (the selection toolbar's "Zoom to").
function zoomToRange(a, b) {
  if (!signals) return;
  const full = Math.max(1, nFrames(latestState) - 1);
  const span = Math.max(Math.min(MIN_SPAN_FRAMES, full), Math.min(full, b - a + 1));
  if (span >= full) { view = null; redrawTimelineNow(); return; }
  const start = Math.max(0, Math.min(full - span, a - (span - (b - a + 1)) / 2));
  view = { start, end: start + span };
  redrawTimelineNow();
}
function zoomStep(factor) {
  if (!signals) return;
  const { v0, v1 } = viewRange();
  zoomAt(factor, (lastFrame >= v0 && lastFrame <= v1) ? lastFrame : (v0 + v1) / 2);
}
function panBy(dFrames) {
  if (!signals || !view || !dFrames) return;
  const full = Math.max(1, nFrames(latestState) - 1);
  const span = view.end - view.start;
  const start = Math.max(0, Math.min(full - span, view.start + dFrames));
  view = { start, end: start + span };
  redrawTimelineNow();
}
function redrawTimelineNow() { drawTimeline(document.getElementById("rg-timeline"), lastFrame); }
function updateZoomLabel() {
  const el = document.getElementById("rg-tl-label");
  if (!el) return;
  let text = `Rolls GT vs Pred timeline — ${ZOOM_HINT}`;
  if (view && latestState) {
    const full = Math.max(1, nFrames(latestState) - 1), fps = latestState.fps || 30;
    const zoom = full / (view.end - view.start);
    text = `showing ${fmtTime(view.start / fps)}–${fmtTime(view.end / fps)} of ${fmtTime(full / fps)} · ` +
      `${zoom >= 10 ? zoom.toFixed(0) : zoom.toFixed(1)}× — ${ZOOM_HINT}`;
  }
  if (text !== lastZoomLabel) { lastZoomLabel = text; el.textContent = text; }
}

function drawTimeline(canvas, frame) {
  if (!canvas) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const laneN = signals ? signals.lanes.length : 1;
  const wantH = TL_TOP + laneN * (BAR_H + TL_GAP) + (OTHER_H + TL_GAP) + (BAR_H + TL_GAP) + GRAPH_H + AXIS_H;
  if (canvas.style.height !== `${wantH}px`) canvas.style.height = `${wantH}px`;
  const cssW = Math.max(1, canvas.getBoundingClientRect().width);
  const cssH = Math.max(1, canvas.getBoundingClientRect().height);
  if (canvas.width !== Math.round(cssW * dpr)) canvas.width = Math.round(cssW * dpr);
  if (canvas.height !== Math.round(cssH * dpr)) canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssH;
  ctx.clearRect(0, 0, W, H);
  if (!signals || !latestState) {
    ctx.fillStyle = "#666"; ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(doc ? "" : "rolls: no held-out predictions for this round", LABEL_W, 20);
    return;
  }
  const full = Math.max(1, nFrames(latestState) - 1);
  if (view && frame !== lastDrawnFrame && (frame < view.start || frame > view.end)) {
    const span = view.end - view.start;
    const start = Math.max(0, Math.min(full - span, frame - span / 2));
    view = { start, end: start + span };
  }
  lastDrawnFrame = frame;
  updateZoomLabel();
  const { v0, v1 } = viewRange();
  const trackW = W - LABEL_W - PAD_R;
  const gap = TL_GAP, trackTop = TL_TOP, barH = BAR_H, otherH = OTHER_H;
  let y = trackTop;
  const gtRows = signals.lanes.map(lane => { const r = { y, h: barH, label: lane.name, lane }; y += barH + gap; return r; });
  const otherRow = { y, h: otherH, label: "other" }; y += otherH + gap;   // the lanes' ducks / slips / …
  const predRow = { y, h: barH, label: "Pred" }; y += barH + gap;
  const graphRow = { y, h: GRAPH_H, label: "p(roll)" };
  const rowsBottom = graphRow.y + graphRow.h;
  ctx.font = "10px ui-monospace, monospace";
  for (const r of [...gtRows, otherRow, predRow, graphRow]) {
    ctx.fillStyle = COLORS.rowBg; ctx.fillRect(LABEL_W, r.y, trackW, r.h);
    ctx.fillStyle = "#8a93a3"; ctx.fillText(r.label, 4, r.y + Math.min(r.h - 4, 14));
  }
  const clip = (r, fn) => { ctx.save(); ctx.beginPath(); ctx.rect(LABEL_W, r.y, trackW, r.h); ctx.clip(); fn(); ctx.restore(); };
  const barX = (ev) => {
    const x1 = Math.max(frameToX(ev.vf0, W), LABEL_W - 2);
    const x2 = Math.min(Math.max(x1 + 2, frameToX(ev.vf1 + 1, W)), W - PAD_R + 2);
    return [x1, x2];
  };
  // GT lanes: each checked source's labeled rolls
  for (const r of gtRows) clip(r, () => {
    if (r.lane.pending) {
      ctx.fillStyle = "#8a93a3"; ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(live.status === "error" ? `no live labels — ${live.error}` : "reading the labelers' tabs…", LABEL_W + 6, r.y + 13);
      return;
    }
    for (const g of r.lane.gt) {
      if (g.vf1 < v0 - 1 || g.vf0 > v1 + 1) continue;
      const [x1, x2] = barX(g);
      drawEventBar(ctx, x1, r.y, x2 - x1, r.h, gtColor(g), g.status === "miss", COLORS.gtMissStripe,
                   g.label.replace(/_roll$/, ""));
    }
  });
  // other defense labels (duck / slip / step_back / pull_back): one thin row, named
  clip(otherRow, () => {
    if (!showOther) return;
    const many = signals.lanes.length > 1;
    for (const o of signals.other) {
      if (o.vf1 < v0 - 1 || o.vf0 > v1 + 1) continue;
      const [x1, x2] = barX(o);
      ctx.fillStyle = COLORS.other; ctx.fillRect(x1, otherRow.y + 1, x2 - x1, otherRow.h - 2);
      if (x2 - x1 > 30) {
        ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.font = "8px ui-monospace, monospace";
        ctx.fillText((many ? `${o.lane.initial} ` : "") + o.label.replace("_", " "), x1 + 3, otherRow.y + otherRow.h / 2 + 3);
      }
    }
  });
  // Pred track (+ the geometric baseline, dashed)
  clip(predRow, () => {
    for (const p of signals.pred) {
      if (p.vf1 < v0 - 1 || p.vf0 > v1 + 1) continue;
      const [x1, x2] = barX(p);
      drawEventBar(ctx, x1, predRow.y, x2 - x1, predRow.h, predColor(p, null), p.status === "fa", COLORS.predFAStripe,
                   p.status === "fa" ? `false+ ${sideTag(p)}${p.score.toFixed(2)}` : `${sideTag(p)}${p.score.toFixed(2)}`);
    }
    if (showBase) for (const b of signals.base) {
      if (b.vf1 < v0 - 1 || b.vf0 > v1 + 1) continue;
      const [x1, x2] = barX(b);
      ctx.save(); ctx.setLineDash([3, 2]); ctx.strokeStyle = COLORS.baseline; ctx.lineWidth = 1.5;
      ctx.strokeRect(x1 + 0.5, predRow.y + 2.5, Math.max(1, x2 - x1 - 1), predRow.h - 5); ctx.restore();
    }
  });
  // p(roll) graph: area + line, threshold, y ticks
  clip(graphRow, () => {
    const gy = (v) => graphRow.y + graphRow.h - 2 - v * (graphRow.h - 6);
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
    for (const v of [0.25, 0.5, 0.75]) { ctx.beginPath(); ctx.moveTo(LABEL_W, gy(v)); ctx.lineTo(W - PAD_R, gy(v)); ctx.stroke(); }
    const fps = latestState.fps || 30;
    // one sample per CSS pixel: the max of the grid samples that land on it
    const f0 = Math.max(0, Math.floor((frameToSec(latestState, v0) - doc.t0) / doc.dt) - 1);
    const f1 = Math.min(doc.n - 1, Math.ceil((frameToSec(latestState, v1) - doc.t0) / doc.dt) + 1);
    const perPx = Math.max(1, Math.floor((f1 - f0) / Math.max(1, trackW)));
    ctx.beginPath();
    let first = true;
    const pts = [];
    for (let i = f0; i <= f1; i += perPx) {
      let v = doc.probs[i];
      for (let k = 1; k < perPx && i + k <= f1; k++) v = Math.max(v, doc.probs[i + k]);
      const x = frameToX(secToFrameF(latestState, doc.t0 + i * doc.dt), W);
      pts.push([x, gy(v)]);
      if (first) { ctx.moveTo(x, gy(v)); first = false; } else ctx.lineTo(x, gy(v));
    }
    ctx.strokeStyle = COLORS.prob; ctx.lineWidth = 1.2; ctx.stroke();
    if (pts.length > 1) {
      ctx.lineTo(pts[pts.length - 1][0], gy(0)); ctx.lineTo(pts[0][0], gy(0)); ctx.closePath();
      ctx.fillStyle = COLORS.probFill; ctx.fill();
    }
    if (doc.probs_lead) {                        // the side head: lead and rear over the summed area
      for (const [color, at] of [[COLORS.probLead, (i) => doc.probs_lead[i]],
                                 [COLORS.probRear, (i) => Math.max(0, doc.probs[i] - doc.probs_lead[i])]]) {
        ctx.beginPath(); let f = true;
        for (let i = f0; i <= f1; i += perPx) {
          let v = at(i);
          for (let k = 1; k < perPx && i + k <= f1; k++) v = Math.max(v, at(i + k));
          const x = frameToX(secToFrameF(latestState, doc.t0 + i * doc.dt), W);
          if (f) { ctx.moveTo(x, gy(v)); f = false; } else ctx.lineTo(x, gy(v));
        }
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillStyle = COLORS.probLead; ctx.fillText("lead", LABEL_W + 4, graphRow.y + 10);
      ctx.fillStyle = COLORS.probRear; ctx.fillText("rear", LABEL_W + 32, graphRow.y + 10);
    }
    ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = COLORS.thr; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(LABEL_W, gy(cfg.threshold)); ctx.lineTo(W - PAD_R, gy(cfg.threshold)); ctx.stroke(); ctx.restore();
    ctx.fillStyle = "#8a93a3"; ctx.font = "9px ui-monospace, monospace";
    ctx.fillText(`thr ${cfg.threshold.toFixed(2)}`, W - PAD_R - 46, gy(cfg.threshold) - 3);
    ctx.fillText("1", LABEL_W - 10, gy(1) + 4); ctx.fillText("0", LABEL_W - 10, gy(0) + 2);
    void fps;
  });
  drawTimeAxis(ctx, W, trackTop, rowsBottom);
  selection?.draw(ctx, W, LABEL_W, W - PAD_R, trackTop, rowsBottom);
  if (frame >= v0 - 0.5 && frame <= v1 + 0.5) {
    const ph = frameToX(frame, W);
    ctx.strokeStyle = COLORS.playhead; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ph, 0); ctx.lineTo(ph, rowsBottom + 4); ctx.stroke();
  }
}

function drawTimeAxis(ctx, W, gridTop, top) {
  const fps = latestState.fps || 30;
  const { v0, v1 } = viewRange();
  const spanSec = Math.max(1e-6, (v1 - v0) / fps);
  const target = Math.max(3, Math.floor((W - LABEL_W) / 90));
  const intervals = [0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const tick = intervals.find(iv => spanSec / iv <= target) || 600;
  ctx.save();
  ctx.font = "9px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.lineWidth = 1;
  for (let k = Math.ceil(v0 / fps / tick - 1e-9); k * tick <= v1 / fps + 1e-9; k++) {
    const x = frameToX(k * tick * fps, W);
    if (x < LABEL_W - 1 || x > W - PAD_R + 1) continue;
    ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.beginPath(); ctx.moveTo(x, gridTop); ctx.lineTo(x, top); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + 3); ctx.stroke();
    ctx.fillStyle = "#8a93a3"; ctx.fillText(fmtTime(k * tick, tick < 1), x, top + 12);
  }
  ctx.restore();
}

function drawEventBar(ctx, x, y, w, h, color, hatched, stripe, name) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y + 1, w, h - 2);
  if (hatched) {
    ctx.save(); ctx.beginPath(); ctx.rect(x, y + 1, w, h - 2); ctx.clip();
    ctx.strokeStyle = stripe; ctx.lineWidth = 1;
    for (let k = -h; k < w + h; k += 4) { ctx.beginPath(); ctx.moveTo(x + k, y + 1); ctx.lineTo(x + k + h, y + h - 1); ctx.stroke(); }
    ctx.restore();
  }
  ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 1.5, Math.max(1, w - 1), h - 3);
  if (name && w > 34) {
    ctx.save(); ctx.beginPath(); ctx.rect(x + 2, y + 1, w - 4, h - 2); ctx.clip();
    ctx.font = "9px ui-monospace, monospace"; ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillText(name, x + 4, y + h / 2 + 3.5); ctx.restore();
  }
}

function gtColor(g) { return g.status === "miss" ? COLORS.gtMiss : g.status === "center" ? COLORS.gtCenter : COLORS.gtHit; }
function predColor(p, g) {
  if (!p) return g ? COLORS.gtMiss : "#888888";
  return p.status === "center" ? COLORS.predCenter : COLORS.pred;
}

// ── on-video HUD (the punch lens's box, one hand → one roll) ────────────────
function drawCanvasHud(ctx, state) {
  const f = state.frame, s = state.renderScale || 1;
  const p = findEvent(signals.pred, f), g = firstGt(f);
  const prob = probAtFrame(state, f);
  const fontPx = Math.round(13 * s);
  ctx.save();
  ctx.font = `bold ${fontPx}px ui-monospace, "SF Mono", monospace`;
  const predText = !p ? (g ? "MISS" : "idle")
    : p.status === "correct" ? `${sideWord(p)} ${p.score.toFixed(2)} ✓`
    : p.status === "center" ? `${sideWord(p)} ${p.score.toFixed(2)} (center-hit)`
    : `${sideWord(p)} ${p.score.toFixed(2)} (false+)`;
  const many = signals.lanes.length > 1;
  const gtLines = signals.lanes.map((ln, i) => {       // one line per GT lane
    const lg = findEvent(ln.gt, f), o = findEvent(ln.other, f);
    const what = lg ? `${lg.label}${lg.status === "miss" ? " (missed)" : ""}`
      : o ? `${o.label} (not a roll)` : ln.pending ? "loading…" : "idle";
    return { text: `${i ? "     " : "GT:  "} ${many ? ln.initial + " " : ""}${what}`,
             color: lg ? gtColor(lg) : o ? "#7ec8ff" : "#888888" };
  });
  const lines = [
    { text: `Roll  p=${fmt(prob, 2)}  thr ${cfg.threshold.toFixed(2)}`, color: prob >= cfg.threshold ? COLORS.pred : "#dddddd" },
    ...gtLines,
    { text: `Pred: ${predText}`, color: predColor(p, g) },
  ];
  const pad = 5 * s, lineH = fontPx + 4 * s;
  let width = 0;
  for (const ln of lines) width = Math.max(width, ctx.measureText(ln.text).width);
  const boxW = width + pad * 2, boxH = lineH * lines.length + pad * 2;
  const x = 8 * s, y = 8 * s;
  ctx.fillStyle = "rgba(0,0,0,0.65)"; ctx.fillRect(x, y, boxW, boxH);
  let ty = y + pad + fontPx;
  for (const ln of lines) { ctx.fillStyle = ln.color; ctx.fillText(ln.text, x + pad, ty); ty += lineH; }
  ctx.restore();
}
