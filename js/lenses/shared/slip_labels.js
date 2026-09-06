// Slip labels + the curated frontal frames of the loaded round — shared by the
// two slips lenses: research/slips.js (the frontal set, labels on the timeline)
// and research/slips_gt.js (one labeled slip at a time, looped). Not a lens.
//
// LABEL SOURCE: the labeler's Apps Script web app, via sheet-labels.js
// fetchCombinedRowsForStem — NOT the viewer's state.labels. That plumbing reads
// the Sheet's public CSV export, dead since the labeling tabs moved to a
// spreadsheet that needs a login (2026-08). The web app reads Combined Data,
// which is rebuilt by hand from the per-labeler tabs, so a re-pull cannot see
// labels newer than the last rebuild. Rows carry no labeler field: two
// labelers' slips on the same footage arrive as two overlapping spans.
//
// TIME BASE: Sheet times are source-video seconds; cache frame =
// floor(t * fps) - floor(start_sec * fps), the viewer's own convention (see
// ./segment_set.js).

import { resolveRanges } from "./segment_set.js";
import { matchEntry } from "./frontal_set.js";
import { fetchCombinedRowsForStem } from "../../sheet-labels.js";

export const COLOR = {
  in: "#7adf7a",      // green — inside a curated span
  out: "#888",        // grey  — outside
  miss: "#ff5d6c",    // red   — this video isn't in the set at all
  frame: "#3ad9e0",   // cyan  — current-frame marker
  accent: "#b48cff",
  lead: "#7ec8ff",    // light blue — lead_slip
  rear: "#ffd95c",    // yellow     — rear_slip
};
export const SLIP_KIND = { lead_slip: "lead", rear_slip: "rear" };

// The Sheet's other rows: defensive moves and round/rest markers. A punch is
// anything that is neither (jab_head, cross_head, lead_hook_head, …).
export const DEFENSE_LABELS = new Set([
  "lead_slip", "rear_slip", "lead_roll", "rear_roll", "pull_back", "duck", "step_back",
]);
const MARKER_LABELS = new Set(["round_start", "round_end", "rest_start", "rest_end"]);
export const isPunchLabel = l =>
  !!l && !MARKER_LABELS.has(l) && !DEFENSE_LABELS.has(l) && l !== "unsure";

// ── curated frames of the loaded round ──────────────────────────────────────

let cur = { pose: null, basename: null, entryStem: undefined };
const pickPose = state => state.poseV6 || state.pose;

// { pose, basename, round, n, fps, startSec, entry, inSpan, ranges, nIn } or
// null without a pose. Recomputed when the manifest lands (entry changes).
export function curatedFrames(state) {
  const pose = pickPose(state);
  if (!pose) return null;
  const basename = state.cacheBasename || null;
  const entry = matchEntry(basename);
  const entryStem = entry?.stem ?? null;
  if (cur.pose === pose && cur.basename === basename
      && cur.round === state.cacheRound && cur.entryStem === entryStem) return cur;

  const n = pose.n_frames;
  const fps = pose.fps || state.fps || 30;
  const startSec = Number(pose.start_sec || 0);
  const { inSpan, ranges, nIn } = entry
    ? resolveRanges(entry.spans, { n, fps, startSec, roundIdx: state.cacheRound })
    : { inSpan: new Uint8Array(n), ranges: [], nIn: 0 };

  cur = { pose, basename, round: state.cacheRound, entryStem,
          n, fps, startSec, entry, inSpan, ranges, nIn };
  return cur;
}

// ── labels ──────────────────────────────────────────────────────────────────

let labels = { key: null, status: "idle", rows: null, error: null, source: null };
let token = 0;

// { key, status: "idle"|"loading"|"ok"|"error", rows, error, source, confidence, nRows }
export function slipLabelState() { return labels; }

// One fetch per cache basename, so a lens remount (or a switch between the two
// slips lenses) does not refetch. `force` re-pulls. Redraws the stage when the
// rows land.
export function ensureSlipLabels(basename, { force = false } = {}) {
  const key = basename || "";
  if (!force && labels.key === key && labels.status !== "idle") return;
  const t = ++token;
  if (!basename) {
    labels = { key, status: "error", rows: null, error: "no cache basename to match", source: null };
    return;
  }
  labels = { key, status: "loading", rows: null, error: null, source: null };
  fetchCombinedRowsForStem(basename, { force }).then(res => {
    if (t !== token) return;   // a newer video was loaded meanwhile
    labels = res.error
      ? { key, status: "error", rows: null, error: res.error, source: null }
      : { key, status: "ok", rows: res.rows, error: null, source: res.source_video,
          confidence: res.match_confidence, nRows: res.n_rows };
    refresh();
  });
}

// ── slip rows → this round's frames ─────────────────────────────────────────

let sc = { pose: null, rows: null, entryStem: undefined };

// { slips: [{kind, s, e, startSec, endSec, uuid, stance, curated}], nLead,
//   nRear, nOut, nVideo } — null while labels are not in. `curated` = the
// slip's midpoint lies inside a curated frontal span.
export function computeSlips(c) {
  if (!c || labels.status !== "ok") return null;
  if (sc.pose === c.pose && sc.rows === labels.rows && sc.entryStem === c.entryStem) return sc;
  const startFrame = Math.floor(c.startSec * c.fps);
  const slips = [];
  let nVideo = 0;
  for (const r of labels.rows) {
    const kind = SLIP_KIND[r.label];
    if (!kind) continue;
    nVideo++;
    const s = Math.floor(r.start_sec * c.fps) - startFrame;
    const e = Math.floor(r.end_sec * c.fps) - startFrame;
    if (e < 0 || s > c.n - 1) continue;          // belongs to another round
    const cs = Math.max(0, Math.min(c.n - 1, s));
    const ce = Math.max(0, Math.min(c.n - 1, e));
    const mid = Math.floor((cs + ce) / 2);
    slips.push({ kind, s: cs, e: ce, startSec: r.start_sec, endSec: r.end_sec,
                 uuid: r.punch_uuid, stance: r.stance,
                 curated: !!(c.entry && c.inSpan[mid]) });
  }
  slips.sort((a, b) => a.s - b.s || a.e - b.e);
  const nLead = slips.filter(x => x.kind === "lead").length;
  sc = { pose: c.pose, rows: labels.rows, entryStem: c.entryStem,
         slips, nLead, nRear: slips.length - nLead,
         nOut: slips.filter(x => !x.curated).length, nVideo };
  return sc;
}

export const slipsAt = (slips, f) => slips.filter(x => x.s <= f && f <= x.e);

let pc = { pose: null, rows: null };

// The video's punch rows → this round's frames, time-ordered:
// { punches: [{ s, e, label, startSec, endSec }], nVideo } — null while labels
// are not in. Same frame convention as computeSlips.
export function computePunches(c) {
  if (!c || labels.status !== "ok") return null;
  if (pc.pose === c.pose && pc.rows === labels.rows) return pc;
  const startFrame = Math.floor(c.startSec * c.fps);
  const punches = [];
  let nVideo = 0;
  for (const r of labels.rows) {
    if (!isPunchLabel(r.label)) continue;
    nVideo++;
    const s = Math.floor(r.start_sec * c.fps) - startFrame;
    const e = Math.floor(r.end_sec * c.fps) - startFrame;
    if (e < 0 || s > c.n - 1) continue;
    punches.push({ s: Math.max(0, s), e: Math.min(c.n - 1, e), label: r.label,
                   startSec: r.start_sec, endSec: r.end_sec });
  }
  punches.sort((a, b) => a.s - b.s || a.e - b.e);
  pc = { pose: c.pose, rows: labels.rows, punches, nVideo };
  return pc;
}

// ── small shared bits ───────────────────────────────────────────────────────

export function fmtTime(sec) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

export function shortStem(s, max = 46) {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

// Force a full redraw now (draw + update are both bound to `seeked`).
export function refresh() {
  document.getElementById("video")?.dispatchEvent(new Event("seeked"));
}

export function seekTo(f) {
  const slider = document.getElementById("scrubber");
  if (!slider) return;
  slider.value = f;
  slider.dispatchEvent(new Event("input"));
}

// ── below-video timeline ────────────────────────────────────────────────────

export const TL_LABEL_W = 56;

// A canvas in #stage-extras (cleared on every lens switch, so build it in
// mount). `onClick(frame)` receives the cache frame under the click.
export function mountTimeline({ id, caption, height = 84, onClick }) {
  const slot = document.getElementById("stage-extras");
  if (!slot) return null;
  slot.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:12px;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px";
  const label = document.createElement("div");
  label.className = "muted small";
  label.style.cssText = "margin-bottom:6px";
  label.textContent = caption;
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = id;
  canvas.style.cssText = `display:block;width:100%;height:${height}px`;
  canvas.width = 800; canvas.height = height;
  wrap.appendChild(canvas);
  slot.appendChild(wrap);

  canvas.addEventListener("click", e => {
    const N = cur?.n;
    if (!N) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - TL_LABEL_W) / Math.max(1, rect.width - TL_LABEL_W - 4);
    onClick(Math.max(0, Math.min(N - 1, Math.round(ratio * (N - 1)))));
  });
  return canvas;
}

// Track 1: curated spans (green / grey). Track 2: slip labels, lead lane over
// rear lane, dimmed outside the curated spans. `highlight` (a slip from
// computeSlips) is drawn bright with an outline and the rest recede.
// `extraLane` = { label, items: [{ s, e, color, alpha }] } adds one more lane
// under the slips (the canvas needs ~22px more height for it).
export function drawSlipTimeline(canvas, c, sl, frame, { highlight = null, extraLane = null } = {}) {
  if (!canvas || !c) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.max(1, canvas.getBoundingClientRect().width);
  const cssH = Math.max(1, canvas.getBoundingClientRect().height);
  if (canvas.width !== Math.round(cssW * dpr))  canvas.width  = Math.round(cssW * dpr);
  if (canvas.height !== Math.round(cssH * dpr)) canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssH;
  ctx.clearRect(0, 0, W, H);
  const N = c.n;
  if (!N) return;

  const xOf = f => TL_LABEL_W + (f / Math.max(1, N - 1)) * (W - TL_LABEL_W - 4);
  const colW = Math.max(1, (W - TL_LABEL_W - 4) / Math.max(1, N - 1));
  ctx.font = "10px ui-monospace, monospace";

  // Track 1 — curated spans.
  const top = 4, barH = 24;
  ctx.fillStyle = c.entry ? COLOR.in : COLOR.miss;
  ctx.fillText(c.entry ? "frontal" : "not in set", 6, top + barH / 2 + 3);
  for (let f = 0; f < N; f++) {
    const on = c.entry && c.inSpan[f];
    ctx.fillStyle = on ? COLOR.in : COLOR.out;
    ctx.globalAlpha = on ? 0.9 : 0.35;
    ctx.fillRect(xOf(f), top, colW + 0.5, barH);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLOR.accent;
  for (const r of c.ranges) {
    ctx.fillText(r.label, Math.min(W - 20, xOf(r.s) + 2), top + barH + 10);
  }

  // Track 2 — slip labels, two lanes.
  const laneH = 16, y2 = top + barH + 14;
  const lanes = { lead: y2, rear: y2 + laneH + 2 };
  for (const [kind, y] of Object.entries(lanes)) {
    ctx.fillStyle = COLOR[kind];
    ctx.fillText(kind, 6, y + laneH / 2 + 3);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(TL_LABEL_W, y, W - TL_LABEL_W - 4, laneH);
  }
  if (sl) {
    for (const x of sl.slips) {
      const w = Math.max(2, xOf(x.e) - xOf(x.s));
      ctx.fillStyle = COLOR[x.kind];
      ctx.globalAlpha = highlight
        ? (x === highlight ? 1 : x.curated ? 0.4 : 0.18)
        : (x.curated ? 0.95 : 0.35);
      ctx.fillRect(xOf(x.s), lanes[x.kind], w, laneH);
    }
    ctx.globalAlpha = 1;
    if (highlight) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(xOf(highlight.s) - 1, lanes[highlight.kind] - 1,
                     Math.max(2, xOf(highlight.e) - xOf(highlight.s)) + 2, laneH + 2);
    }
  } else {
    ctx.fillStyle = "#888";
    ctx.fillText(labels.status === "loading" ? "loading labels…" : "no labels",
                 TL_LABEL_W + 4, y2 + laneH + 4);
  }

  if (extraLane) {
    const y3 = lanes.rear + laneH + 6;
    ctx.fillStyle = "#aaa";
    ctx.fillText(extraLane.label, 6, y3 + laneH / 2 + 3);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(TL_LABEL_W, y3, W - TL_LABEL_W - 4, laneH);
    for (const it of extraLane.items || []) {
      ctx.fillStyle = it.color;
      ctx.globalAlpha = it.alpha ?? 0.9;
      ctx.fillRect(xOf(it.s), y3, Math.max(2, xOf(it.e) - xOf(it.s)), laneH);
    }
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = COLOR.frame;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 1); ctx.lineTo(xOf(frame), H - 1); ctx.stroke();
}
