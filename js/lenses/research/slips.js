// Slips lens — the curated frontal footage, grouped, with the Sheet's slip
// labels on the timeline: the starting point for the slip work
// (cornerman-backend/ml/research/defense).
//
// A slip is a lateral head movement OFF the opponent axis, so it is only
// measurable when that axis is the camera axis: the curated frontal set, where
// the boxer works toward the camera and the camera stands where the opponent
// would be. This lens groups exactly that footage — the video dropdown offers
// only the curated videos — and answers two questions about the round you have
// loaded: "which frames of it count?" (curated spans green, everything else
// grey with a red frame on the video) and "where did the labelers see slips?"
// (the Sheet's lead_slip / rear_slip rows, two lanes under the span track).
// A slip outside every curated span is drawn dimmed: it is a label on footage
// the set does not vouch for.
//
// LABEL SOURCE: the labeler's Apps Script web app, via
// sheet-labels.js fetchCombinedRowsForStem — NOT the viewer's state.labels.
// That plumbing reads the Sheet's public CSV export, dead since the labeling
// tabs moved to a spreadsheet that needs a login (2026-08). The web app reads
// Combined Data, which is rebuilt by hand from the per-labeler tabs, so
// Refresh re-pulls but cannot see labels newer than the last rebuild. Rows
// carry no labeler field: two labelers' slips on the same footage appear as
// two overlapping spans.
//
// TIME BASE: Sheet times are source-video seconds; cache frame =
// floor(t * fps) - floor(start_sec * fps), the viewer's own convention (see
// ../shared/segment_set.js). No slip signals yet — those build on this.
//
// ROUNDS: a curated video can have eight rounds and one frontal span, so the
// Round dropdown offers only the rounds that carry frontal footage. Which round
// a time-only span falls in needs each round's `_pts.npy` clock, which the
// backend has and the browser does not — lens_data/frontal_rounds.json is that
// answer, dumped by
//   python -m ml.frontal_spans --rounds-json > \
//     ~/code/cornerman-debug-viewer/lens_data/frontal_rounds.json
// (regenerate with the manifest). Frontal set data + the span conversion:
// ../shared/frontal_set.js and ../shared/segment_set.js. Refresh the manifest
// copy with:
//   cp ~/code/cornerman-backend/ml/frontal_segments.json \
//      ~/code/cornerman-debug-viewer/lens_data/frontal_segments.json

import { normStem, resolveRanges } from "../shared/segment_set.js";
import {
  frontalSetReady, getManifest, getManifestError, isCuratedVideo, matchEntry,
} from "../shared/frontal_set.js";
import { fetchCombinedRowsForStem } from "../../sheet-labels.js";

const COLOR_IN     = "#7adf7a";  // green — inside a curated span
const COLOR_OUT    = "#888";     // grey  — outside
const COLOR_MISS   = "#ff5d6c";  // red   — this video isn't in the set at all
const COLOR_FRAME  = "#3ad9e0";  // cyan  — current-frame marker
const COLOR_ACCENT = "#b48cff";
const COLOR_LEAD   = "#7ec8ff";  // light blue — lead_slip
const COLOR_REAR   = "#ffd95c";  // yellow     — rear_slip

const SLIP_KIND = { lead_slip: "lead", rear_slip: "rear" };
const KIND_COLOR = { lead: COLOR_LEAD, rear: COLOR_REAR };

// ── which rounds carry frontal footage ──────────────────────────────────────

let roundsByStem = null;   // Map<normStem(stem), Set<round>>
let roundsError = null;
fetch("./lens_data/frontal_rounds.json", { cache: "no-store" })
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(j => {
    roundsByStem = new Map();
    for (const [stem, rs] of Object.entries(j.rounds || {})) {
      roundsByStem.set(normStem(stem), new Set(rs));
    }
  })
  .catch(err => { roundsError = err.message || String(err); })
  // The dropdowns filter on requires(), which cannot answer until this lands.
  .finally(() => window.dispatchEvent(new Event("lens-filter-changed")));

// Same engine test as the viewer's default `requires` — any 2D skeleton cache.
const hasSkeleton = slot => !!(slot?.blazepose || slot?.yolo || slot?.vision
  || slot?.vision_glove || slot?.rtmpose || slot?.movenet || slot?.yolo11);

// Pending ⇒ hide (the fetch re-fires the filter). Failed, or a stem the dump
// does not know ⇒ do not filter rounds rather than hide footage silently.
function roundHasFrontal(base, round) {
  if (roundsError) return true;
  if (!roundsByStem) return false;
  const rs = roundsByStem.get(normStem(base || ""));
  if (!rs) return true;
  return round == null || rs.has(round);
}

// ── span → cache-frame mapping ──────────────────────────────────────────────

let cache = { pose: null, basename: null };

const pickPose = state => state.poseV6 || state.pose;

function compute(state) {
  const pose = pickPose(state);
  if (!pose) return null;
  const basename = state.cacheBasename || null;
  if (cache.pose === pose && cache.basename === basename
      && cache.round === state.cacheRound) return cache;

  const n = pose.n_frames;
  const fps = pose.fps || state.fps || 30;
  const startSec = Number(pose.start_sec || 0);
  const entry = matchEntry(basename);

  const { inSpan, ranges, nIn } = entry
    ? resolveRanges(entry.spans, { n, fps, startSec, roundIdx: state.cacheRound })
    : { inSpan: new Uint8Array(n), ranges: [], nIn: 0 };

  cache = { pose, basename, round: state.cacheRound, n, fps, startSec,
            entry, inSpan, ranges, nIn };
  return cache;
}

// ── Sheet slip labels → cache frames ────────────────────────────────────────

// One fetch per cache basename, keyed so a lens remount does not refetch.
let labels = { key: null, status: "idle", rows: null, error: null, source: null };
let labelToken = 0;
let lastBasename = null;

function ensureLabels(basename, { force = false } = {}) {
  const key = basename || "";
  if (!force && labels.key === key && labels.status !== "idle") return;
  const token = ++labelToken;
  labels = { key, status: "loading", rows: null, error: null, source: null };
  if (!basename) {
    labels = { key, status: "error", rows: null, error: "no cache basename to match", source: null };
    return;
  }
  fetchCombinedRowsForStem(basename, { force }).then(res => {
    if (token !== labelToken) return;   // a newer video was loaded meanwhile
    labels = res.error
      ? { key, status: "error", rows: null, error: res.error, source: null }
      : { key, status: "ok", rows: res.rows, error: null,
          source: res.source_video, confidence: res.match_confidence, nRows: res.n_rows };
    slipCache = { pose: null, rows: null };
    refresh();
  });
}

let slipCache = { pose: null, rows: null };

// Slip rows of the matched video → this round's frames. Null while labels are
// not in. `curated` = the slip's midpoint lies inside a curated frontal span.
function computeSlips(c) {
  if (labels.status !== "ok") return null;
  if (slipCache.pose === c.pose && slipCache.rows === labels.rows) return slipCache;
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
  slips.sort((a, b) => a.s - b.s);
  const nLead = slips.filter(x => x.kind === "lead").length;
  slipCache = { pose: c.pose, rows: labels.rows, slips, nLead, nRear: slips.length - nLead,
                nOut: slips.filter(x => !x.curated).length, nVideo };
  return slipCache;
}

const slipsAt = (slips, f) => slips.filter(x => x.s <= f && f <= x.e);

function fmtTime(sec) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

function shortStem(s, max = 46) {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

// ── lens ────────────────────────────────────────────────────────────────────

let host = null;
let mountToken = 0;

export const SlipsRule = {
  id: "slips",
  label: "Slips (curated frontal)",

  skeletonStyle() {
    return { boneColor: "rgba(255,255,255,0.25)", boneWidth: 1.5, jointRadius: 3 };
  },

  // Per-video filter for the Drive dropdown: only the curated frontal videos
  // are selectable while this lens is active. The manual file picker and the
  // Firebase path bypass it, which is why update()/draw() still handle a video
  // that is not in the set.
  requiresVideo: isCuratedVideo,

  // Per-round filter on top of that: only the rounds whose footage a frontal
  // span touches. The viewer hands `{ base, round }` alongside the slot.
  requires: (slot, ctx) => hasSkeleton(slot) && roundHasFrontal(ctx?.base, ctx?.round),

  mount(_host, state) {
    host = _host;
    cache = { pose: null, basename: null };
    host.innerHTML = `<h2>Slips</h2><p class="hint">Loading manifest…</p>`;
    mountStageTimeline();
    if (state?.cacheBasename) ensureLabels(state.cacheBasename);

    const token = ++mountToken;
    frontalSetReady.then(() => {
      if (token !== mountToken || !host) return;   // lens switched mid-fetch
      renderShell();
      refresh();
    });
  },

  update(state) {
    if (!host || !state || (!getManifest() && !getManifestError())) return;
    if (!host.querySelector("#sl-status")) renderShell();

    const c = compute(state);
    const statusEl = host.querySelector("#sl-status");
    const spansEl = host.querySelector("#sl-spans");
    const frameEl = host.querySelector("#sl-frame");
    if (!statusEl) return;

    if (!c) {
      statusEl.innerHTML = `<p class="muted">No pose cache loaded.</p>`;
      if (spansEl) spansEl.innerHTML = "";
      if (frameEl) frameEl.innerHTML = "";
      return;
    }
    lastBasename = c.basename;
    ensureLabels(c.basename);

    if (!c.entry) {
      statusEl.innerHTML =
        `<div style="color:${COLOR_MISS}; font-weight:600">NOT in the curated frontal set</div>
         <div class="muted small" style="margin-top:2px">stem: <code>${c.basename || "—"}</code></div>`;
      if (spansEl) spansEl.innerHTML = `<p class="muted small">Load one of the videos listed below.</p>`;
    } else {
      const pct = c.n ? (100 * c.nIn / c.n) : 0;
      statusEl.innerHTML =
        `<div style="color:${COLOR_IN}; font-weight:600">IN the curated frontal set</div>
         <div class="muted small" style="margin-top:2px">stem: <code>${shortStem(c.entry.stem, 60)}</code></div>
         <div style="margin-top:4px"><code>${c.nIn}</code> / ${c.n} frames curated
           <span class="muted">(${pct.toFixed(1)}% of this round)</span></div>`;
      if (spansEl) {
        spansEl.innerHTML = c.ranges.length
          ? c.ranges.map((r, i) => {
              // Curation notes ride along on the span (`_note`) — the two
              // stems that are in BOTH sets carry the explanation there, and a
              // reading that is flagged unresolved says so rather than looking
              // like settled truth.
              const note = r.span?._note;
              return `<div class="sl-span" data-i="${i}" style="cursor:pointer; padding:3px 0;
                           border-bottom:1px solid var(--border)">
                        <code style="color:${COLOR_ACCENT}">${r.label}</code>
                        <span class="muted small"> src ${fmtTime(r.startSec)} → ${fmtTime(r.endSec)}</span><br>
                        <span class="small">frames <code>${r.s}</code>–<code>${r.e}</code>
                          · ${(r.e - r.s + 1)} fr</span>
                        ${note ? `<div class="muted small" style="margin-top:2px">${note}</div>` : ""}
                      </div>`;
            }).join("")
          : `<p class="muted small">This video is in the set, but none of its spans
             fall inside this round's frame range — try another round.</p>`;
        spansEl.querySelectorAll(".sl-span").forEach(el => {
          el.addEventListener("click", () => seekTo(c.ranges[+el.dataset.i].s));
        });
      }
    }

    const sl = computeSlips(c);
    renderSlipLabels(c, sl);

    const f = state.frame;
    const inNow = c.entry && c.inSpan[f];
    if (frameEl) {
      const here = sl ? slipsAt(sl.slips, f) : [];
      frameEl.innerHTML =
        `<strong>frame ${f}</strong> ·
         <span style="color:${inNow ? COLOR_IN : COLOR_OUT}; font-weight:600">
           ${inNow ? "in span" : "outside"}</span>
         <span class="muted small"> · src ${fmtTime(c.startSec + f / c.fps)}</span>
         ${here.map(x => `<br><span style="color:${KIND_COLOR[x.kind]}; font-weight:600">
             ${x.kind} slip</span>
             <span class="muted small">frames ${x.s}–${x.e}${x.curated ? "" : " · outside the curated spans"}</span>`).join("")}`;
    }

    drawTimeline(document.getElementById("sl-timeline"), c, sl, f);
  },

  draw(ctx, state) {
    const c = compute(state);
    if (!c) return;
    const s = state.renderScale || 1;
    const inNow = c.entry && c.inSpan[state.frame];

    // Frame the video in red whenever you're looking at footage that is NOT
    // part of the curated set — you cannot miss it while scrubbing.
    if (!inNow) {
      ctx.save();
      ctx.strokeStyle = COLOR_MISS;
      ctx.lineWidth = 4 * s;
      ctx.globalAlpha = 0.85;
      ctx.strokeRect(2 * s, 2 * s, ctx.canvas.width - 4 * s, ctx.canvas.height - 4 * s);
      ctx.restore();
    }

    const fsz = Math.round(14 * s);
    const badge = (text, color, y) => {
      ctx.save();
      ctx.font = `600 ${fsz}px ui-monospace, monospace`;
      ctx.textBaseline = "top";
      const w = ctx.measureText(text).width + 20 * s;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath(); ctx.roundRect(10 * s, y, w, fsz + 14 * s, 6 * s); ctx.fill();
      ctx.fillStyle = color;
      ctx.fillText(text, 20 * s, y + 7 * s);
      ctx.restore();
    };
    badge(!c.entry ? "VIDEO NOT IN SET" : inNow ? "IN FRONTAL SPAN" : "OUTSIDE SPAN",
          inNow ? COLOR_IN : COLOR_MISS, 10 * s);

    // A second badge while the frame sits inside a labeled slip.
    const sl = computeSlips(c);
    const here = sl ? slipsAt(sl.slips, state.frame) : [];
    here.forEach((x, i) => {
      badge(`${x.kind.toUpperCase()} SLIP${x.curated ? "" : " (outside span)"}`,
            KIND_COLOR[x.kind], (10 + (i + 1) * (fsz / s + 20)) * s);
    });
  },
};

// ── sidebar shell ───────────────────────────────────────────────────────────

function renderShell() {
  const err = getManifestError();
  if (err) {
    host.innerHTML =
      `<h2>Slips</h2>
       <div style="color:${COLOR_MISS}">frontal_segments.json failed to load — ${err}</div>
       <p class="hint">Refresh it with<br>
         <code>cp ~/code/cornerman-backend/ml/frontal_segments.json
         ~/code/cornerman-debug-viewer/lens_data/frontal_segments.json</code></p>`;
    return;
  }

  const segs = getManifest()?.segments || {};
  const stems = Object.keys(segs);
  const nSpans = stems.reduce((a, k) => a + segs[k].length, 0);

  host.innerHTML = `
    <h2>Slips</h2>
    <p class="hint">
      The curated <strong>frontal</strong> set — the boxer works toward the
      camera, so the camera stands where the opponent would be and the opponent
      axis is the camera axis. A slip moves the head <em>off</em> that axis,
      which is why it can only be read here. Selected on gaze/punch direction,
      not shoulder squareness.
      <span style="color:${COLOR_IN}">green</span> = curated,
      <span style="color:${COLOR_OUT}">grey</span> = outside;
      <span style="color:${COLOR_LEAD}">lead</span> /
      <span style="color:${COLOR_REAR}">rear</span> = the Sheet's slip labels
      (dimmed when outside every curated span).
    </p>

    <h3>This round</h3>
    <div id="sl-status" style="font-size:13px; line-height:1.6"></div>

    <h3>Spans here <span class="muted small">(click to jump)</span></h3>
    <div id="sl-spans" style="font-size:12px"></div>

    <h3>Slip labels <span class="muted small">(Sheet · click to jump)</span>
      <button id="sl-refresh" type="button" style="font-size:11px; margin-left:6px">Refresh</button></h3>
    <div id="sl-lab-status" style="font-size:13px; line-height:1.6"></div>
    <div id="sl-slips" style="font-size:12px; max-height:260px; overflow:auto"></div>

    <h3>Current frame</h3>
    <div id="sl-frame" style="font-size:13px; line-height:1.6"></div>

    <h3>Whole set <span class="muted small">${stems.length} videos · ${nSpans} spans</span></h3>
    <div id="sl-list" style="font-size:11px; line-height:1.5; max-height:260px; overflow:auto">
      ${stems.map(k => `
        <div title="${k.replace(/"/g, "&quot;")}" style="padding:2px 0; border-bottom:1px solid var(--border)">
          <span style="color:${COLOR_ACCENT}">${segs[k].map(s => s.label).join(", ")}</span>
          — ${shortStem(k)}
        </div>`).join("")}
    </div>`;

  host.querySelector("#sl-refresh").addEventListener("click", () => {
    if (lastBasename) ensureLabels(lastBasename, { force: true });
    refresh();
  });
}

function renderSlipLabels(c, sl) {
  const statusEl = host.querySelector("#sl-lab-status");
  const listEl = host.querySelector("#sl-slips");
  if (!statusEl || !listEl) return;

  if (labels.status === "loading") {
    statusEl.innerHTML = `<span class="muted">Fetching Combined Data rows from the labeler web app…</span>`;
    listEl.innerHTML = "";
    return;
  }
  if (labels.status !== "ok") {
    statusEl.innerHTML =
      `<span style="color:${COLOR_MISS}">No Sheet labels — ${labels.error || "not loaded"}</span>`;
    listEl.innerHTML = "";
    return;
  }

  statusEl.innerHTML =
    `<code>${labels.nRows}</code> rows for <code>${shortStem(labels.source, 48)}</code>
     <span class="muted small">(${labels.confidence} match)</span><br>
     <code>${sl.nVideo}</code> slips in the video ·
     <span style="color:${COLOR_LEAD}">${sl.nLead} lead</span> +
     <span style="color:${COLOR_REAR}">${sl.nRear} rear</span> in this round${
       sl.nOut ? ` · <span class="muted">${sl.nOut} outside the curated spans</span>` : ""}`;

  listEl.innerHTML = sl.slips.length
    ? sl.slips.map((x, i) =>
        `<div class="sl-slip" data-i="${i}" style="cursor:pointer; padding:2px 0;
              border-bottom:1px solid var(--border); opacity:${x.curated ? 1 : 0.55}">
           <code style="color:${KIND_COLOR[x.kind]}">${x.kind}</code>
           <span class="muted small"> src ${fmtTime(x.startSec)} → ${fmtTime(x.endSec)}</span>
           <span class="small"> · frames <code>${x.s}</code>–<code>${x.e}</code></span>
           ${x.curated ? "" : `<span class="muted small"> · outside span</span>`}
         </div>`).join("")
    : `<p class="muted small">No slip labels fall inside this round.</p>`;
  listEl.querySelectorAll(".sl-slip").forEach(el => {
    el.addEventListener("click", () => seekTo(sl.slips[+el.dataset.i].s));
  });
}

// ── below-video timeline ────────────────────────────────────────────────────

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
  label.textContent = "Curated frontal spans + Sheet slip labels in this round (click to seek)";
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = "sl-timeline";
  canvas.style.cssText = "display:block;width:100%;height:84px";
  canvas.width = 800; canvas.height = 84;
  wrap.appendChild(canvas);
  slot.appendChild(wrap);

  canvas.addEventListener("click", e => {
    const N = cache?.n;
    if (!N) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - TL_LABEL_W) / Math.max(1, rect.width - TL_LABEL_W - 4);
    seekTo(Math.max(0, Math.min(N - 1, Math.round(ratio * (N - 1)))));
  });
}

// Track 1: curated spans (green / grey). Track 2: slip labels, lead lane over
// rear lane, dimmed outside the curated spans.
function drawTimeline(canvas, c, sl, frame) {
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
  const N = c.n;
  if (!N) return;

  const xOf = f => TL_LABEL_W + (f / Math.max(1, N - 1)) * (W - TL_LABEL_W - 4);
  const colW = Math.max(1, (W - TL_LABEL_W - 4) / Math.max(1, N - 1));
  ctx.font = "10px ui-monospace, monospace";

  // Track 1 — curated spans.
  const top = 4, barH = 24;
  ctx.fillStyle = c.entry ? COLOR_IN : COLOR_MISS;
  ctx.fillText(c.entry ? "frontal" : "not in set", 6, top + barH / 2 + 3);
  for (let f = 0; f < N; f++) {
    const on = c.entry && c.inSpan[f];
    ctx.fillStyle = on ? COLOR_IN : COLOR_OUT;
    ctx.globalAlpha = on ? 0.9 : 0.35;
    ctx.fillRect(xOf(f), top, colW + 0.5, barH);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLOR_ACCENT;
  for (const r of c.ranges) {
    ctx.fillText(r.label, Math.min(W - 20, xOf(r.s) + 2), top + barH + 10);
  }

  // Track 2 — slip labels, two lanes.
  const laneH = 16, y2 = top + barH + 14;
  const lanes = { lead: y2, rear: y2 + laneH + 2 };
  for (const [kind, y] of Object.entries(lanes)) {
    ctx.fillStyle = KIND_COLOR[kind];
    ctx.fillText(kind, 6, y + laneH / 2 + 3);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(TL_LABEL_W, y, W - TL_LABEL_W - 4, laneH);
  }
  if (sl) {
    for (const x of sl.slips) {
      ctx.fillStyle = KIND_COLOR[x.kind];
      ctx.globalAlpha = x.curated ? 0.95 : 0.35;
      ctx.fillRect(xOf(x.s), lanes[x.kind], Math.max(2, xOf(x.e) - xOf(x.s)), laneH);
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = "#888";
    ctx.fillText(labels.status === "loading" ? "loading labels…" : "no labels", TL_LABEL_W + 4, y2 + laneH + 4);
  }

  ctx.strokeStyle = COLOR_FRAME;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 1); ctx.lineTo(xOf(frame), H - 1); ctx.stroke();
}
