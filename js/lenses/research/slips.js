// Slips lens — the curated frontal footage, grouped, with the Sheet's slip
// labels on the timeline: the starting point for the slip work
// (cornerman-backend/ml/research/defense).
//
// A slip is a lateral head movement OFF the opponent axis, so it is only
// measurable when that axis is the camera axis: the curated frontal set, where
// the boxer works toward the camera and the camera stands where the opponent
// would be. This lens groups exactly that footage — the video dropdown offers
// only the curated videos, the round dropdown only the rounds that carry the
// span — and answers two questions about the round you have loaded: "which
// frames of it count?" (curated spans green, everything else grey with a red
// frame on the video) and "where did the labelers see slips?" (the Sheet's
// lead_slip / rear_slip rows, two lanes under the span track). A slip outside
// every curated span is drawn dimmed: it is a label on footage the set does
// not vouch for. To step through the slips one at a time, looped, use the
// Slips GT lens (./slips_gt.js).
//
// Where the labels come from, the time base, and the shared drawing:
// ../shared/slip_labels.js. Which videos and rounds count:
// ../shared/frontal_set.js (refresh commands for both data files there).
// No slip signals yet — those build on this.

import {
  frontalSetReady, getManifest, getManifestError, isCuratedRound, isCuratedVideo,
} from "../shared/frontal_set.js";
import {
  COLOR, computeSlips, curatedFrames, drawSlipTimeline, ensureSlipLabels, fmtTime,
  mountTimeline, refresh, seekTo, shortStem, slipLabelState, slipsAt,
} from "../shared/slip_labels.js";

let host = null;
let mountToken = 0;
let lastBasename = null;

export const SlipsRule = {
  id: "slips",
  label: "Slips (curated frontal)",

  skeletonStyle() {
    return { boneColor: "rgba(255,255,255,0.25)", boneWidth: 1.5, jointRadius: 3 };
  },

  // Only the curated frontal videos in the video dropdown, and of those only
  // the rounds a frontal span touches. The manual file picker and the Firebase
  // path bypass both, which is why update()/draw() still handle footage that
  // is not in the set.
  requiresVideo: isCuratedVideo,
  requires: isCuratedRound,

  mount(_host, state) {
    host = _host;
    host.innerHTML = `<h2>Slips</h2><p class="hint">Loading manifest…</p>`;
    mountTimeline({
      id: "sl-timeline",
      caption: "Curated frontal spans + Sheet slip labels in this round (click to seek)",
      onClick: seekTo,
    });
    if (state?.cacheBasename) ensureSlipLabels(state.cacheBasename);

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

    const c = curatedFrames(state);
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
    ensureSlipLabels(c.basename);

    if (!c.entry) {
      statusEl.innerHTML =
        `<div style="color:${COLOR.miss}; font-weight:600">NOT in the curated frontal set</div>
         <div class="muted small" style="margin-top:2px">stem: <code>${c.basename || "—"}</code></div>`;
      if (spansEl) spansEl.innerHTML = `<p class="muted small">Load one of the videos listed below.</p>`;
    } else {
      const pct = c.n ? (100 * c.nIn / c.n) : 0;
      statusEl.innerHTML =
        `<div style="color:${COLOR.in}; font-weight:600">IN the curated frontal set</div>
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
                        <code style="color:${COLOR.accent}">${r.label}</code>
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
    renderSlipLabels(sl);

    const f = state.frame;
    const inNow = c.entry && c.inSpan[f];
    if (frameEl) {
      const here = sl ? slipsAt(sl.slips, f) : [];
      frameEl.innerHTML =
        `<strong>frame ${f}</strong> ·
         <span style="color:${inNow ? COLOR.in : COLOR.out}; font-weight:600">
           ${inNow ? "in span" : "outside"}</span>
         <span class="muted small"> · src ${fmtTime(c.startSec + f / c.fps)}</span>
         ${here.map(x => `<br><span style="color:${COLOR[x.kind]}; font-weight:600">
             ${x.kind} slip</span>
             <span class="muted small">frames ${x.s}–${x.e}${x.curated ? "" : " · outside the curated spans"}</span>`).join("")}`;
    }

    drawSlipTimeline(document.getElementById("sl-timeline"), c, sl, f);
  },

  draw(ctx, state) {
    const c = curatedFrames(state);
    if (!c) return;
    const s = state.renderScale || 1;
    const inNow = c.entry && c.inSpan[state.frame];

    // Frame the video in red whenever you're looking at footage that is NOT
    // part of the curated set — you cannot miss it while scrubbing.
    if (!inNow) {
      ctx.save();
      ctx.strokeStyle = COLOR.miss;
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
          inNow ? COLOR.in : COLOR.miss, 10 * s);

    // A second badge while the frame sits inside a labeled slip.
    const sl = computeSlips(c);
    const here = sl ? slipsAt(sl.slips, state.frame) : [];
    here.forEach((x, i) => {
      badge(`${x.kind.toUpperCase()} SLIP${x.curated ? "" : " (outside span)"}`,
            COLOR[x.kind], (10 + (i + 1) * (fsz / s + 20)) * s);
    });
  },
};

// ── sidebar shell ───────────────────────────────────────────────────────────

function renderShell() {
  const err = getManifestError();
  if (err) {
    host.innerHTML =
      `<h2>Slips</h2>
       <div style="color:${COLOR.miss}">frontal_segments.json failed to load — ${err}</div>
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
      <span style="color:${COLOR.in}">green</span> = curated,
      <span style="color:${COLOR.out}">grey</span> = outside;
      <span style="color:${COLOR.lead}">lead</span> /
      <span style="color:${COLOR.rear}">rear</span> = the Sheet's slip labels
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
          <span style="color:${COLOR.accent}">${segs[k].map(s => s.label).join(", ")}</span>
          — ${shortStem(k)}
        </div>`).join("")}
    </div>`;

  host.querySelector("#sl-refresh").addEventListener("click", () => {
    if (lastBasename) ensureSlipLabels(lastBasename, { force: true });
    refresh();
  });
}

function renderSlipLabels(sl) {
  const statusEl = host.querySelector("#sl-lab-status");
  const listEl = host.querySelector("#sl-slips");
  if (!statusEl || !listEl) return;
  const labels = slipLabelState();

  if (labels.status === "loading") {
    statusEl.innerHTML = `<span class="muted">Fetching Combined Data rows from the labeler web app…</span>`;
    listEl.innerHTML = "";
    return;
  }
  if (labels.status !== "ok" || !sl) {
    statusEl.innerHTML =
      `<span style="color:${COLOR.miss}">No Sheet labels — ${labels.error || "not loaded"}</span>`;
    listEl.innerHTML = "";
    return;
  }

  statusEl.innerHTML =
    `<code>${labels.nRows}</code> rows for <code>${shortStem(labels.source, 48)}</code>
     <span class="muted small">(${labels.confidence} match)</span><br>
     <code>${sl.nVideo}</code> slips in the video ·
     <span style="color:${COLOR.lead}">${sl.nLead} lead</span> +
     <span style="color:${COLOR.rear}">${sl.nRear} rear</span> in this round${
       sl.nOut ? ` · <span class="muted">${sl.nOut} outside the curated spans</span>` : ""}`;

  listEl.innerHTML = sl.slips.length
    ? sl.slips.map((x, i) =>
        `<div class="sl-slip" data-i="${i}" style="cursor:pointer; padding:2px 0;
              border-bottom:1px solid var(--border); opacity:${x.curated ? 1 : 0.55}">
           <code style="color:${COLOR[x.kind]}">${x.kind}</code>
           <span class="muted small"> src ${fmtTime(x.startSec)} → ${fmtTime(x.endSec)}</span>
           <span class="small"> · frames <code>${x.s}</code>–<code>${x.e}</code></span>
           ${x.curated ? "" : `<span class="muted small"> · outside span</span>`}
         </div>`).join("")
    : `<p class="muted small">No slip labels fall inside this round.</p>`;
  listEl.querySelectorAll(".sl-slip").forEach(el => {
    el.addEventListener("click", () => seekTo(sl.slips[+el.dataset.i].s));
  });
}
