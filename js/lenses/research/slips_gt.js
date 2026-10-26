// Slips GT lens — one labeled slip at a time, looped, to inspect what the
// labelers called a slip. ◀ / ▶ (keys P / N) step through the round's slips;
// each one plays in a loop with a little context either side, so you can
// watch the head move off the line and come back as many times as it takes.
// Space pauses the loop where it is, ← → then step frames; the stage's speed
// dropdown slows it down. Clicking a slip in the list or on the timeline
// selects it.
//
// The loop itself rides on the viewer's own playback: the video plays, the
// viewer syncs `state.frame` on every displayed frame and calls update(), and
// update() seeks back to the window start once the frame passes the window
// end — frame-accurate, no timers. Same footage scope, labels and drawing as
// the Slips lens (./slips.js): ../shared/frontal_set.js, ../shared/slip_labels.js.

import { J } from "../../skeleton.js";
import { isCuratedRound, isCuratedVideo } from "../shared/frontal_set.js";
import {
  COLOR, computeSlips, curatedFrames, drawSlipTimeline, ensureSlipLabels, fmtTime,
  mountTimeline, refresh, seekTo, shortStem, slipLabelState, slipsAt,
} from "../shared/slip_labels.js";

const PAD_KEY = "cornerman.slips_gt.pad_s";

let host = null;
let activeState = null;     // the viewer's state while this lens is mounted
let idx = -1;               // selected slip (index into computeSlips().slips)
let selectedFor = null;     // pose the selection belongs to — a new round resets it
let looping = true;
let listKey = null;         // what the slip list was last built for
let padS = 0.3;             // context either side of the labeled span, seconds
try { const v = parseFloat(localStorage.getItem(PAD_KEY)); if (Number.isFinite(v)) padS = v; } catch {}

const video = () => document.getElementById("video");
const isActive = () => activeState?.rule === SlipsGtRule;

// Loop window in cache frames: the labeled span plus padS either side.
function windowOf(c, slip) {
  const pad = Math.round(padS * c.fps);
  return { ws: Math.max(0, slip.s - pad), we: Math.min(c.n - 1, slip.e + pad) };
}

function current(c) {
  const sl = computeSlips(c);
  if (!sl || !sl.slips.length || idx < 0 || idx >= sl.slips.length) return null;
  return sl.slips[idx];
}

// Select slip i (wrapping), seek to its window start, keep the play state:
// a playing loop keeps playing on the next slip, a paused one stays paused so
// you can step frames from the slip's first context frame.
function select(i, { play = null } = {}) {
  const c = activeState && curatedFrames(activeState);
  const sl = c && computeSlips(c);
  if (!sl || !sl.slips.length) return;
  idx = ((i % sl.slips.length) + sl.slips.length) % sl.slips.length;
  selectedFor = c.pose;
  const { ws } = windowOf(c, sl.slips[idx]);
  seekTo(ws);
  const v = video();
  const wantPlay = play == null ? (v && !v.paused) : play;
  if (wantPlay && v?.paused) {
    v.play().catch(() => { /* autoplay policy — Space starts it */ });
  }
  refresh();
}

document.addEventListener("keydown", e => {
  if (!isActive() || !host) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "n" || e.key === "N") { select(idx + 1); e.preventDefault(); }
  if (e.key === "p" || e.key === "P") { select(idx - 1); e.preventDefault(); }
});

export const SlipsGtRule = {
  id: "slips_gt",
  label: "Slips GT (loop one)",

  skeletonStyle() {
    return {
      boneColor: "rgba(255,255,255,0.3)", boneWidth: 1.5, jointRadius: 3,
      highlightJoints: new Set([J.NOSE, J.L_SHOULDER, J.R_SHOULDER]),
    };
  },

  requiresVideo: isCuratedVideo,
  requires: isCuratedRound,

  mount(_host, state) {
    host = _host;
    activeState = state;
    idx = -1; selectedFor = null; looping = true;
    host.innerHTML = `
      <h2>Slips GT</h2>
      <p class="hint">
        One labeled slip at a time, looped with <span id="sg-pad-echo">${padS.toFixed(2)}</span> s
        of context either side. <kbd>N</kbd> / <kbd>P</kbd> or the buttons step
        through the round's slips; <kbd>Space</kbd> pauses the loop where it is,
        <kbd>←</kbd> <kbd>→</kbd> then step frames. Slow it down with the speed
        dropdown under the video.
        <span style="color:${COLOR.lead}">lead</span> /
        <span style="color:${COLOR.rear}">rear</span> = the Sheet's label.
      </p>

      <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin:6px 0">
        <button id="sg-prev" type="button" title="Previous slip (P)">◀ prev</button>
        <button id="sg-next" type="button" title="Next slip (N)">next ▶</button>
        <button id="sg-loop" type="button" title="Loop the selected slip / play through"></button>
        <label style="font-size:12px; display:flex; gap:4px; align-items:center">
          context ±<input id="sg-pad" type="number" min="0" max="3" step="0.05" value="${padS}"
                         style="width:64px"> s
        </label>
        <button id="sg-refresh" type="button" style="font-size:11px" title="Re-pull the Sheet rows">Refresh</button>
      </div>

      <div id="sg-current" style="font-size:13px; line-height:1.6"></div>

      <h3>Slips in this round <span class="muted small">(click to select)</span></h3>
      <div id="sg-status" style="font-size:12px; line-height:1.5"></div>
      <div id="sg-list" style="font-size:12px; max-height:320px; overflow:auto"></div>`;

    mountTimeline({
      id: "sg-timeline",
      caption: "Sheet slip labels in this round — the selected slip outlined (click a slip to select it, elsewhere to seek)",
      onClick: f => {
        const c = curatedFrames(activeState);
        const sl = c && computeSlips(c);
        const hit = sl ? sl.slips.findIndex(x => x.s <= f && f <= x.e) : -1;
        if (hit >= 0) select(hit); else seekTo(f);
      },
    });

    host.querySelector("#sg-prev").addEventListener("click", () => select(idx - 1));
    host.querySelector("#sg-next").addEventListener("click", () => select(idx + 1));
    host.querySelector("#sg-loop").addEventListener("click", () => {
      looping = !looping;
      if (looping && idx >= 0) select(idx, { play: true });
      else refresh();
    });
    host.querySelector("#sg-pad").addEventListener("change", e => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v) || v < 0) return;
      padS = v;
      try { localStorage.setItem(PAD_KEY, String(padS)); } catch {}
      const echo = host.querySelector("#sg-pad-echo");
      if (echo) echo.textContent = padS.toFixed(2);
      if (idx >= 0) select(idx);
    });
    host.querySelector("#sg-refresh").addEventListener("click", () => {
      if (state?.cacheBasename) ensureSlipLabels(state.cacheBasename, { force: true });
      refresh();
    });

    if (state?.cacheBasename) ensureSlipLabels(state.cacheBasename);
  },

  update(state) {
    if (!host || !state) return;
    activeState = state;
    const c = curatedFrames(state);
    const curEl = host.querySelector("#sg-current");
    const statusEl = host.querySelector("#sg-status");
    const listEl = host.querySelector("#sg-list");
    const loopBtn = host.querySelector("#sg-loop");
    if (loopBtn) loopBtn.textContent = looping ? "⟳ looping" : "⟳ loop off";

    if (!c) {
      curEl.innerHTML = `<p class="muted">No pose cache loaded.</p>`;
      statusEl.innerHTML = ""; listEl.innerHTML = "";
      return;
    }
    ensureSlipLabels(c.basename);
    const labels = slipLabelState();
    const sl = computeSlips(c);

    if (labels.status === "loading") {
      statusEl.innerHTML = `<span class="muted">Fetching Combined Data rows from the labeler web app…</span>`;
      curEl.innerHTML = ""; listEl.innerHTML = "";
      drawSlipTimeline(document.getElementById("sg-timeline"), c, null, state.frame);
      return;
    }
    if (labels.status !== "ok" || !sl) {
      statusEl.innerHTML = `<span style="color:${COLOR.miss}">No Sheet labels — ${labels.error || "not loaded"}</span>`;
      curEl.innerHTML = ""; listEl.innerHTML = "";
      drawSlipTimeline(document.getElementById("sg-timeline"), c, null, state.frame);
      return;
    }

    // A new round (or the labels just landing) starts on the first slip.
    if (selectedFor !== c.pose || idx >= sl.slips.length) {
      idx = -1; selectedFor = c.pose;
      if (sl.slips.length) { select(0, { play: looping }); return; }
    }

    statusEl.innerHTML =
      `<code>${sl.nVideo}</code> slips in <code>${shortStem(labels.source, 40)}</code> ·
       <span style="color:${COLOR.lead}">${sl.nLead} lead</span> +
       <span style="color:${COLOR.rear}">${sl.nRear} rear</span> in this round${
         sl.nOut ? ` · <span class="muted">${sl.nOut} outside the curated spans</span>` : ""}`;

    const slip = current(c);
    const f = state.frame;
    if (!slip) {
      curEl.innerHTML = `<p class="muted">No slip labels fall inside this round — pick another round or video.</p>`;
    } else {
      const { ws, we } = windowOf(c, slip);
      const inLabel = slip.s <= f && f <= slip.e;
      // Loop: once the frame passes the window end (or was scrubbed ahead of
      // it), go back to the window start. Only while playing — a paused loop
      // is the user stepping frames.
      const v = video();
      if (looping && v && !v.paused && (f >= we || f < ws - 1)) seekTo(ws);

      curEl.innerHTML =
        `<div style="font-size:15px; font-weight:600; color:${COLOR[slip.kind]}">
           slip ${idx + 1} / ${sl.slips.length} — ${slip.kind.toUpperCase()}
           ${slip.curated ? "" : `<span class="muted small" style="font-weight:400">· outside the curated spans</span>`}
         </div>
         <div>src <code>${fmtTime(slip.startSec)}</code> → <code>${fmtTime(slip.endSec)}</code>
           · <code>${((slip.endSec - slip.startSec)).toFixed(2)}</code> s
           · frames <code>${slip.s}</code>–<code>${slip.e}</code> (${slip.e - slip.s + 1} fr)</div>
         <div class="muted small">loop window frames ${ws}–${we} · stance ${slip.stance || "—"}
           · <code>${(slip.uuid || "").slice(0, 8)}</code></div>
         <div style="margin-top:2px"><strong>frame ${f}</strong> ·
           <span style="color:${inLabel ? COLOR[slip.kind] : COLOR.out}; font-weight:600">
             ${inLabel ? "inside the labeled span" : f < slip.s ? "context before" : f > slip.e ? "context after" : ""}</span>
           ${(slipsAt(sl.slips, f).filter(x => x !== slip)).map(x =>
              `<span class="muted small"> · also ${x.kind} slip ${x.s}–${x.e}</span>`).join("")}</div>`;
    }

    // The list only changes with the selection or the round — not per frame.
    const key = `${idx}|${sl.slips.length}|${labels.key}`;
    if (key !== listKey) {
      listKey = key;
      listEl.innerHTML = sl.slips.length
      ? sl.slips.map((x, i) =>
          `<div class="sg-slip" data-i="${i}" style="cursor:pointer; padding:2px 4px;
                border-bottom:1px solid var(--border); opacity:${x.curated ? 1 : 0.55};
                ${i === idx ? "background:rgba(255,255,255,0.08); border-left:3px solid " + COLOR[x.kind] + ";" : "border-left:3px solid transparent;"}">
             <span class="muted small">${i + 1}.</span>
             <code style="color:${COLOR[x.kind]}">${x.kind}</code>
             <span class="muted small"> src ${fmtTime(x.startSec)}</span>
             <span class="small"> · frames <code>${x.s}</code>–<code>${x.e}</code></span>
             ${x.curated ? "" : `<span class="muted small"> · outside span</span>`}
           </div>`).join("")
      : "";
      listEl.querySelectorAll(".sg-slip").forEach(el => {
        el.addEventListener("click", () => select(+el.dataset.i));
      });
      listEl.querySelector(".sg-slip[style*='rgba(255,255,255,0.08)']")
        ?.scrollIntoView({ block: "nearest" });
    }

    drawSlipTimeline(document.getElementById("sg-timeline"), c, sl, f, { highlight: slip });
  },

  draw(ctx, state) {
    const c = curatedFrames(state);
    if (!c) return;
    const slip = current(c);
    const s = state.renderScale || 1;
    const f = state.frame;
    const inNow = c.entry && c.inSpan[f];

    // Red frame on footage outside the curated set, as in the Slips lens.
    if (!inNow) {
      ctx.save();
      ctx.strokeStyle = COLOR.miss;
      ctx.lineWidth = 4 * s;
      ctx.globalAlpha = 0.85;
      ctx.strokeRect(2 * s, 2 * s, ctx.canvas.width - 4 * s, ctx.canvas.height - 4 * s);
      ctx.restore();
    }
    if (!slip) return;

    const sl = computeSlips(c);
    const { ws, we } = windowOf(c, slip);
    const inLabel = slip.s <= f && f <= slip.e;
    const fsz = Math.round(15 * s);
    const text = `SLIP ${idx + 1}/${sl.slips.length} · ${slip.kind.toUpperCase()}${inLabel ? "" : " · context"}`;

    ctx.save();
    ctx.font = `600 ${fsz}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    const w = Math.max(ctx.measureText(text).width + 20 * s, 220 * s);
    const x0 = 10 * s, y0 = 10 * s, h = fsz + 26 * s;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath(); ctx.roundRect(x0, y0, w, h, 6 * s); ctx.fill();
    ctx.fillStyle = COLOR[slip.kind];
    ctx.globalAlpha = inLabel ? 1 : 0.55;
    ctx.fillText(text, x0 + 10 * s, y0 + 6 * s);
    ctx.globalAlpha = 1;

    // Loop progress bar: the window, with the labeled span bright and the
    // playhead on top — you can see the label's edges while it plays.
    const bx = x0 + 10 * s, by = y0 + fsz + 14 * s, bw = w - 20 * s, bh = 6 * s;
    const px = fr => bx + ((fr - ws) / Math.max(1, we - ws)) * bw;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = COLOR[slip.kind];
    ctx.fillRect(px(slip.s), by, Math.max(2 * s, px(slip.e) - px(slip.s)), bh);
    ctx.fillStyle = COLOR.frame;
    ctx.fillRect(px(Math.max(ws, Math.min(we, f))) - 1 * s, by - 2 * s, 2 * s, bh + 4 * s);
    ctx.restore();
  },
};
