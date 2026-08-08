// Side set lens — the curated "camera is side-on" footage.
//
// A BROWSING lens, not a metric lens. It answers one question about the round
// you have loaded: "is this footage part of the curated side set, and if so,
// which frames?" Everything outside a curated span is greyed out and the video
// is framed in red, so you can scrub a whole round and see at a glance which
// parts count.
//
// The set is the mirror of the frontal one: there the camera stands where the
// opponent would be, here it stands at 90° to that and looks along the frontal
// plane, so the frame shows the sagittal plane. That is the view that makes
// fore-aft quantities measurable — reach down the punch line, the path the hand
// returns through, the head riding forward over the lead knee, weight transfer
// — all of which point at the lens on frontal footage and collapse.
//
// Data + the source-second → cache-frame conversion: ../shared/side_set.js and
// ../shared/segment_set.js (which documents the time base). Refresh the copy in
// lens_data with:
//   cp ~/code/cornerman-backend/ml/side_segments.json \
//      ~/code/cornerman-debug-viewer/lens_data/side_segments.json

import { resolveRanges } from "../shared/segment_set.js";
import {
  getManifest, getManifestError, isCuratedVideo, matchEntry, sideSetReady,
} from "../shared/side_set.js";

const COLOR_IN     = "#7adf7a";  // green — inside a curated span
const COLOR_OUT    = "#888";     // grey  — outside
const COLOR_MISS   = "#ff5d6c";  // red   — this video isn't in the set at all
const COLOR_FRAME  = "#3ad9e0";  // cyan  — current-frame marker
const COLOR_ACCENT = "#b48cff";

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

export const SideSetRule = {
  id: "side_set",
  label: "Side set (curated, camera side-on)",

  skeletonStyle() {
    return { boneColor: "rgba(255,255,255,0.25)", boneWidth: 1.5, jointRadius: 3 };
  },

  // Per-video filter for the Drive dropdown: only the curated videos are
  // selectable while this lens is active. The manual file picker and the
  // Firebase path bypass it, which is why update()/draw() still handle a video
  // that is not in the set.
  requiresVideo: isCuratedVideo,

  mount(_host) {
    host = _host;
    cache = { pose: null, basename: null };
    host.innerHTML = `<h2>Side set</h2><p class="hint">Loading manifest…</p>`;
    mountStageTimeline();

    const token = ++mountToken;
    sideSetReady.then(() => {
      if (token !== mountToken || !host) return;   // lens switched mid-fetch
      renderShell();
      refresh();
    });
  },

  update(state) {
    if (!host || !state || (!getManifest() && !getManifestError())) return;
    if (!host.querySelector("#ss-status")) renderShell();

    const c = compute(state);
    const statusEl = host.querySelector("#ss-status");
    const spansEl = host.querySelector("#ss-spans");
    const frameEl = host.querySelector("#ss-frame");
    if (!statusEl) return;

    if (!c) {
      statusEl.innerHTML = `<p class="muted">No pose cache loaded.</p>`;
      if (spansEl) spansEl.innerHTML = "";
      if (frameEl) frameEl.innerHTML = "";
      return;
    }

    if (!c.entry) {
      statusEl.innerHTML =
        `<div style="color:${COLOR_MISS}; font-weight:600">NOT in the curated set</div>
         <div class="muted small" style="margin-top:2px">stem: <code>${c.basename || "—"}</code></div>`;
      if (spansEl) spansEl.innerHTML = `<p class="muted small">Load one of the videos listed below.</p>`;
    } else {
      const pct = c.n ? (100 * c.nIn / c.n) : 0;
      statusEl.innerHTML =
        `<div style="color:${COLOR_IN}; font-weight:600">IN the curated set</div>
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
              return `<div class="ss-span" data-i="${i}" style="cursor:pointer; padding:3px 0;
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
        spansEl.querySelectorAll(".ss-span").forEach(el => {
          el.addEventListener("click", () => seekTo(c.ranges[+el.dataset.i].s));
        });
      }
    }

    const f = state.frame;
    const inNow = c.entry && c.inSpan[f];
    if (frameEl) {
      frameEl.innerHTML =
        `<strong>frame ${f}</strong> ·
         <span style="color:${inNow ? COLOR_IN : COLOR_OUT}; font-weight:600">
           ${inNow ? "in span" : "outside"}</span>
         <span class="muted small"> · src ${fmtTime(c.startSec + f / c.fps)}</span>`;
    }

    drawTimeline(document.getElementById("ss-timeline"), c, f);
  },

  draw(ctx, state) {
    const c = compute(state);
    if (!c) return;
    const s = state.renderScale || 1;
    const inNow = c.entry && c.inSpan[state.frame];

    // Frame the video in red whenever you're looking at footage that is NOT
    // part of the curated set — the whole point of this lens is that you can't
    // miss it while scrubbing.
    if (!inNow) {
      ctx.save();
      ctx.strokeStyle = COLOR_MISS;
      ctx.lineWidth = 4 * s;
      ctx.globalAlpha = 0.85;
      ctx.strokeRect(2 * s, 2 * s, ctx.canvas.width - 4 * s, ctx.canvas.height - 4 * s);
      ctx.restore();
    }

    const label = !c.entry ? "VIDEO NOT IN SET" : inNow ? "IN SIDE SPAN" : "OUTSIDE SPAN";
    const color = inNow ? COLOR_IN : COLOR_MISS;
    const fsz = Math.round(14 * s);
    ctx.save();
    ctx.font = `600 ${fsz}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    const w = ctx.measureText(label).width + 20 * s;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath(); ctx.roundRect(10 * s, 10 * s, w, fsz + 14 * s, 6 * s); ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(label, 20 * s, 17 * s);
    ctx.restore();
  },
};

// ── sidebar shell ───────────────────────────────────────────────────────────

function renderShell() {
  const err = getManifestError();
  if (err) {
    host.innerHTML =
      `<h2>Side set</h2>
       <div style="color:${COLOR_MISS}">side_segments.json failed to load — ${err}</div>
       <p class="hint">Refresh it with<br>
         <code>cp ~/code/cornerman-backend/ml/side_segments.json
         ~/code/cornerman-debug-viewer/lens_data/side_segments.json</code></p>`;
    return;
  }

  const segs = getManifest()?.segments || {};
  const stems = Object.keys(segs);
  const nSpans = stems.reduce((a, k) => a + segs[k].length, 0);

  host.innerHTML = `
    <h2>Side set</h2>
    <p class="hint">
      The curated set shot <strong>completely from the side</strong> — the camera
      looks along the boxer's frontal plane, so the frame is the sagittal plane
      and the opponent axis runs left-right across it. The view for anything
      measured <em>fore-aft</em>: reach down the punch line, the return path, the
      head over the lead knee, weight transfer. Selected on camera angle only.
      <span style="color:${COLOR_IN}">green</span> = curated,
      <span style="color:${COLOR_OUT}">grey</span> = outside.
    </p>

    <h3>This round</h3>
    <div id="ss-status" style="font-size:13px; line-height:1.6"></div>

    <h3>Spans here <span class="muted small">(click to jump)</span></h3>
    <div id="ss-spans" style="font-size:12px"></div>

    <h3>Current frame</h3>
    <div id="ss-frame" style="font-size:13px; line-height:1.6"></div>

    <h3>Whole set <span class="muted small">${stems.length} videos · ${nSpans} spans</span></h3>
    <div id="ss-list" style="font-size:11px; line-height:1.5; max-height:260px; overflow:auto">
      ${stems.map(k => `
        <div title="${k.replace(/"/g, "&quot;")}" style="padding:2px 0; border-bottom:1px solid var(--border)">
          <span style="color:${COLOR_ACCENT}">${segs[k].map(s => s.label).join(", ")}</span>
          — ${shortStem(k)}
        </div>`).join("")}
    </div>`;
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
  label.textContent = "Curated side spans in this round (click to seek)";
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = "ss-timeline";
  canvas.style.cssText = "display:block;width:100%;height:44px";
  canvas.width = 800; canvas.height = 44;
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

function drawTimeline(canvas, c, frame) {
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

  const top = 6, barH = H - 18;
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillStyle = c.entry ? COLOR_IN : COLOR_MISS;
  ctx.fillText(c.entry ? "side" : "not in set", 6, top + barH / 2 + 3);

  for (let f = 0; f < N; f++) {
    const on = c.entry && c.inSpan[f];
    ctx.fillStyle = on ? COLOR_IN : COLOR_OUT;
    ctx.globalAlpha = on ? 0.9 : 0.35;
    ctx.fillRect(xOf(f), top, colW + 0.5, barH);
  }
  ctx.globalAlpha = 1;

  // span labels along the bottom
  ctx.fillStyle = COLOR_ACCENT;
  for (const r of c.ranges) {
    ctx.fillText(r.label, Math.min(W - 20, xOf(r.s) + 2), H - 2);
  }

  ctx.strokeStyle = COLOR_FRAME;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 1); ctx.lineTo(xOf(frame), H - 1); ctx.stroke();
}
