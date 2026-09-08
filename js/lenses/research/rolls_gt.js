// Rolls GT lens — one labeled roll at a time, looped, to inspect what the
// labelers called a roll. ◀ / ▶ (keys P / N) step through the round's rolls;
// each one plays in a loop with a little context either side, so you can
// watch the head move off the line and come back as many times as it takes.
// Space pauses the loop where it is, ← → then step frames; the stage's speed
// dropdown slows it down. Clicking a roll in the list or on the timeline
// selects it.
//
// The loop itself rides on the viewer's own playback: the video plays, the
// viewer syncs `state.frame` on every displayed frame and calls update(), and
// update() seeks back to the window start once the frame passes the window
// end — frame-accurate, no timers. Same footage scope, labels and drawing as
// the Slips GT lens (./slips_gt.js), just filtered to lead_roll/rear_roll
// instead of lead_slip/rear_slip: ../shared/frontal_set.js, ../shared/slip_labels.js.

import { J } from "../../skeleton.js";
import { isCuratedRound, isCuratedVideo } from "../shared/frontal_set.js";
import {
  COLOR, ROLL_KIND, computeLabelSpans, curatedFrames, drawSlipTimeline, ensureSlipLabels,
  fmtTime, mountTimeline, refresh, seekTo, shortStem, slipLabelState, slipsAt,
} from "../shared/slip_labels.js";

const PAD_KEY = "cornerman.rolls_gt.pad_s";

let host = null;
let activeState = null;     // the viewer's state while this lens is mounted
let idx = -1;               // selected roll (index into computeRolls().slips)
let selectedFor = null;     // pose the selection belongs to — a new round resets it
let looping = true;
let listKey = null;         // what the roll list was last built for
let padS = 0.3;             // context either side of the labeled span, seconds
try { const v = parseFloat(localStorage.getItem(PAD_KEY)); if (Number.isFinite(v)) padS = v; } catch {}

const video = () => document.getElementById("video");
const isActive = () => activeState?.rule === RollsGtRule;
const computeRolls = c => computeLabelSpans(c, ROLL_KIND);

// Loop window in cache frames: the labeled span plus padS either side.
function windowOf(c, roll) {
  const pad = Math.round(padS * c.fps);
  return { ws: Math.max(0, roll.s - pad), we: Math.min(c.n - 1, roll.e + pad) };
}

function current(c) {
  const sl = computeRolls(c);
  if (!sl || !sl.slips.length || idx < 0 || idx >= sl.slips.length) return null;
  return sl.slips[idx];
}

// Select roll i (wrapping), seek to its window start, keep the play state:
// a playing loop keeps playing on the next roll, a paused one stays paused so
// you can step frames from the roll's first context frame.
function select(i, { play = null } = {}) {
  const c = activeState && curatedFrames(activeState);
  const sl = c && computeRolls(c);
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

export const RollsGtRule = {
  id: "rolls_gt",
  label: "Rolls GT (loop one)",

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
      <h2>Rolls GT</h2>
      <p class="hint">
        One labeled roll at a time, looped with <span id="rg-pad-echo">${padS.toFixed(2)}</span> s
        of context either side. <kbd>N</kbd> / <kbd>P</kbd> or the buttons step
        through the round's rolls; <kbd>Space</kbd> pauses the loop where it is,
        <kbd>←</kbd> <kbd>→</kbd> then step frames. Slow it down with the speed
        dropdown under the video.
        <span style="color:${COLOR.lead}">lead</span> /
        <span style="color:${COLOR.rear}">rear</span> = the Sheet's label.
      </p>

      <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin:6px 0">
        <button id="rg-prev" type="button" title="Previous roll (P)">◀ prev</button>
        <button id="rg-next" type="button" title="Next roll (N)">next ▶</button>
        <button id="rg-loop" type="button" title="Loop the selected roll / play through"></button>
        <label style="font-size:12px; display:flex; gap:4px; align-items:center">
          context ±<input id="rg-pad" type="number" min="0" max="3" step="0.05" value="${padS}"
                         style="width:64px"> s
        </label>
        <button id="rg-refresh" type="button" style="font-size:11px" title="Re-pull the Sheet rows">Refresh</button>
      </div>

      <div id="rg-current" style="font-size:13px; line-height:1.6"></div>

      <h3>Rolls in this round <span class="muted small">(click to select)</span></h3>
      <div id="rg-status" style="font-size:12px; line-height:1.5"></div>
      <div id="rg-list" style="font-size:12px; max-height:320px; overflow:auto"></div>`;

    mountTimeline({
      id: "rg-timeline",
      caption: "Sheet roll labels in this round — the selected roll outlined (click a roll to select it, elsewhere to seek)",
      onClick: f => {
        const c = curatedFrames(activeState);
        const sl = c && computeRolls(c);
        const hit = sl ? sl.slips.findIndex(x => x.s <= f && f <= x.e) : -1;
        if (hit >= 0) select(hit); else seekTo(f);
      },
    });

    host.querySelector("#rg-prev").addEventListener("click", () => select(idx - 1));
    host.querySelector("#rg-next").addEventListener("click", () => select(idx + 1));
    host.querySelector("#rg-loop").addEventListener("click", () => {
      looping = !looping;
      if (looping && idx >= 0) select(idx, { play: true });
      else refresh();
    });
    host.querySelector("#rg-pad").addEventListener("change", e => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v) || v < 0) return;
      padS = v;
      try { localStorage.setItem(PAD_KEY, String(padS)); } catch {}
      const echo = host.querySelector("#rg-pad-echo");
      if (echo) echo.textContent = padS.toFixed(2);
      if (idx >= 0) select(idx);
    });
    host.querySelector("#rg-refresh").addEventListener("click", () => {
      if (state?.cacheBasename) ensureSlipLabels(state.cacheBasename, { force: true });
      refresh();
    });

    if (state?.cacheBasename) ensureSlipLabels(state.cacheBasename);
  },

  update(state) {
    if (!host || !state) return;
    activeState = state;
    const c = curatedFrames(state);
    const curEl = host.querySelector("#rg-current");
    const statusEl = host.querySelector("#rg-status");
    const listEl = host.querySelector("#rg-list");
    const loopBtn = host.querySelector("#rg-loop");
    if (loopBtn) loopBtn.textContent = looping ? "⟳ looping" : "⟳ loop off";

    if (!c) {
      curEl.innerHTML = `<p class="muted">No pose cache loaded.</p>`;
      statusEl.innerHTML = ""; listEl.innerHTML = "";
      return;
    }
    ensureSlipLabels(c.basename);
    const labels = slipLabelState();
    const sl = computeRolls(c);

    if (labels.status === "loading") {
      statusEl.innerHTML = `<span class="muted">Fetching Combined Data rows from the labeler web app…</span>`;
      curEl.innerHTML = ""; listEl.innerHTML = "";
      drawSlipTimeline(document.getElementById("rg-timeline"), c, null, state.frame);
      return;
    }
    if (labels.status !== "ok" || !sl) {
      statusEl.innerHTML = `<span style="color:${COLOR.miss}">No Sheet labels — ${labels.error || "not loaded"}</span>`;
      curEl.innerHTML = ""; listEl.innerHTML = "";
      drawSlipTimeline(document.getElementById("rg-timeline"), c, null, state.frame);
      return;
    }

    // A new round (or the labels just landing) starts on the first roll.
    if (selectedFor !== c.pose || idx >= sl.slips.length) {
      idx = -1; selectedFor = c.pose;
      if (sl.slips.length) { select(0, { play: looping }); return; }
    }

    statusEl.innerHTML =
      `<code>${sl.nVideo}</code> rolls in <code>${shortStem(labels.source, 40)}</code> ·
       <span style="color:${COLOR.lead}">${sl.nLead} lead</span> +
       <span style="color:${COLOR.rear}">${sl.nRear} rear</span> in this round${
         sl.nOut ? ` · <span class="muted">${sl.nOut} outside the curated spans</span>` : ""}`;

    const roll = current(c);
    const f = state.frame;
    if (!roll) {
      curEl.innerHTML = `<p class="muted">No roll labels fall inside this round — pick another round or video.</p>`;
    } else {
      const { ws, we } = windowOf(c, roll);
      const inLabel = roll.s <= f && f <= roll.e;
      // Loop: once the frame passes the window end (or was scrubbed ahead of
      // it), go back to the window start. Only while playing — a paused loop
      // is the user stepping frames.
      const v = video();
      if (looping && v && !v.paused && (f >= we || f < ws - 1)) seekTo(ws);

      curEl.innerHTML =
        `<div style="font-size:15px; font-weight:600; color:${COLOR[roll.kind]}">
           roll ${idx + 1} / ${sl.slips.length} — ${roll.kind.toUpperCase()}
           ${roll.curated ? "" : `<span class="muted small" style="font-weight:400">· outside the curated spans</span>`}
         </div>
         <div>src <code>${fmtTime(roll.startSec)}</code> → <code>${fmtTime(roll.endSec)}</code>
           · <code>${((roll.endSec - roll.startSec)).toFixed(2)}</code> s
           · frames <code>${roll.s}</code>–<code>${roll.e}</code> (${roll.e - roll.s + 1} fr)</div>
         <div class="muted small">loop window frames ${ws}–${we} · stance ${roll.stance || "—"}
           · <code>${(roll.uuid || "").slice(0, 8)}</code></div>
         <div style="margin-top:2px"><strong>frame ${f}</strong> ·
           <span style="color:${inLabel ? COLOR[roll.kind] : COLOR.out}; font-weight:600">
             ${inLabel ? "inside the labeled span" : f < roll.s ? "context before" : f > roll.e ? "context after" : ""}</span>
           ${(slipsAt(sl.slips, f).filter(x => x !== roll)).map(x =>
              `<span class="muted small"> · also ${x.kind} roll ${x.s}–${x.e}</span>`).join("")}</div>`;
    }

    // The list only changes with the selection or the round — not per frame.
    const key = `${idx}|${sl.slips.length}|${labels.key}`;
    if (key !== listKey) {
      listKey = key;
      listEl.innerHTML = sl.slips.length
      ? sl.slips.map((x, i) =>
          `<div class="rg-slip" data-i="${i}" style="cursor:pointer; padding:2px 4px;
                border-bottom:1px solid var(--border); opacity:${x.curated ? 1 : 0.55};
                ${i === idx ? "background:rgba(255,255,255,0.08); border-left:3px solid " + COLOR[x.kind] + ";" : "border-left:3px solid transparent;"}">
             <span class="muted small">${i + 1}.</span>
             <code style="color:${COLOR[x.kind]}">${x.kind}</code>
             <span class="muted small"> src ${fmtTime(x.startSec)}</span>
             <span class="small"> · frames <code>${x.s}</code>–<code>${x.e}</code></span>
             ${x.curated ? "" : `<span class="muted small"> · outside span</span>`}
           </div>`).join("")
      : "";
      listEl.querySelectorAll(".rg-slip").forEach(el => {
        el.addEventListener("click", () => select(+el.dataset.i));
      });
      listEl.querySelector(".rg-slip[style*='rgba(255,255,255,0.08)']")
        ?.scrollIntoView({ block: "nearest" });
    }

    drawSlipTimeline(document.getElementById("rg-timeline"), c, sl, f, { highlight: roll });
  },

  draw(ctx, state) {
    const c = curatedFrames(state);
    if (!c) return;
    const roll = current(c);
    const s = state.renderScale || 1;
    const f = state.frame;
    const inNow = c.entry && c.inSpan[f];

    // Red frame on footage outside the curated set, as in the Slips GT lens.
    if (!inNow) {
      ctx.save();
      ctx.strokeStyle = COLOR.miss;
      ctx.lineWidth = 4 * s;
      ctx.globalAlpha = 0.85;
      ctx.strokeRect(2 * s, 2 * s, ctx.canvas.width - 4 * s, ctx.canvas.height - 4 * s);
      ctx.restore();
    }
    if (!roll) return;

    const sl = computeRolls(c);
    const { ws, we } = windowOf(c, roll);
    const inLabel = roll.s <= f && f <= roll.e;
    const fsz = Math.round(15 * s);
    const text = `ROLL ${idx + 1}/${sl.slips.length} · ${roll.kind.toUpperCase()}${inLabel ? "" : " · context"}`;

    ctx.save();
    ctx.font = `600 ${fsz}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    const w = Math.max(ctx.measureText(text).width + 20 * s, 220 * s);
    const x0 = 10 * s, y0 = 10 * s, h = fsz + 26 * s;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath(); ctx.roundRect(x0, y0, w, h, 6 * s); ctx.fill();
    ctx.fillStyle = COLOR[roll.kind];
    ctx.globalAlpha = inLabel ? 1 : 0.55;
    ctx.fillText(text, x0 + 10 * s, y0 + 6 * s);
    ctx.globalAlpha = 1;

    // Loop progress bar: the window, with the labeled span bright and the
    // playhead on top — you can see the label's edges while it plays.
    const bx = x0 + 10 * s, by = y0 + fsz + 14 * s, bw = w - 20 * s, bh = 6 * s;
    const px = fr => bx + ((fr - ws) / Math.max(1, we - ws)) * bw;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = COLOR[roll.kind];
    ctx.fillRect(px(roll.s), by, Math.max(2 * s, px(roll.e) - px(roll.s)), bh);
    ctx.fillStyle = COLOR.frame;
    ctx.fillRect(px(Math.max(ws, Math.min(we, f))) - 1 * s, by - 2 * s, 2 * s, bh + 4 * s);
    ctx.restore();
  },
};
