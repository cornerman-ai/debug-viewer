// Slips lens — the curated frontal footage, grouped, with the Sheet's slip
// labels on the timeline and the center-line-vs-slips measurement: the starting
// point for the slip work (cornerman-backend/ml/research/defense).
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
// CENTER LINE VS SLIPS — the measurement (2026-09-06). Can the head-off-center-
// line quantity, read at the right TIMES, find slips? The quantity is the one
// the head-off-center-line lens (./head_offcenter.js) reads, computed in
// ../shared/center_line.js (head extent midpoint vs the hip line, median-torso
// units, 5-frame smoothing). The times are PUNCH-ANCHORED WINDOWS: the gaps between consecutive
// punch labels, trimmed to `window` seconds from the nearest punch on each
// side. Inside a punch the head is MEANT to leave the line (that is the
// center-line rule), so punch frames are left out. A window is a slip window
// when a labeled slip touches it. Per window one number — the offset's RANGE
// inside the window (a move out and back), or its PEAK distance from the
// round's median line — and the lens reports how well that number separates
// slip windows from the rest (AUC) and what a threshold buys: slips caught,
// false-alarm windows, precision, F1, with the best-F1 threshold named. The
// defense research measured this signal round-wide three ways and it did not
// find slips (S1: +0.007 recall for +349 FAs; `lat_stable`: worse); the timing
// prior is the untested part, and only 48% of the frontal set's slips overlap
// a punch label, 23% are more than 1 s from any punch (measured 2026-09-06,
// 261 slips), so "reachable" is shown next to recall as its ceiling.
//
// Where the labels come from, the time base, and the shared drawing:
// ../shared/slip_labels.js. Which videos and rounds count:
// ../shared/frontal_set.js (refresh commands for both data files there).

import { J } from "../../skeleton.js";
import {
  frontalSetReady, getManifest, getManifestError, isCuratedRound, isCuratedVideo,
} from "../shared/frontal_set.js";
import {
  COLOR, computePunches, computeSlips, curatedFrames, drawSlipTimeline, ensureSlipLabels,
  fmtTime, mountTimeline, refresh, seekTo, shortStem, slipLabelState, slipsAt,
} from "../shared/slip_labels.js";
import { computeCenterLine } from "../shared/center_line.js";

const COLOR_TP   = "#7adf7a";   // slip window that fired
const COLOR_FA   = "#ff5d6c";   // no-slip window that fired
const COLOR_MISS = "#ff9e64";   // slip window that stayed quiet
const COLOR_NEG  = "#666";      // no-slip window, quiet
const VERDICT_COLOR = { tp: COLOR_TP, fa: COLOR_FA, miss: COLOR_MISS, neg: COLOR_NEG };

let host = null;
let mountToken = 0;
let lastBasename = null;

// ── center line: per-frame head offset from the hip line ────────────────────

const CL_KEY = "cornerman.slips.centerline.v1";
const cl = { winS: 1.0, metric: "range", thr: 0.10, minConf: 0.3 };
try { Object.assign(cl, JSON.parse(localStorage.getItem(CL_KEY) || "{}")); } catch {}
function saveCl() { try { localStorage.setItem(CL_KEY, JSON.stringify(cl)); } catch {} }

// The per-frame offset itself lives in ../shared/center_line.js (shared with
// the Frontal (angle model) player); this lens adds the windows and the stats.
const centerLine = state => computeCenterLine(state.poseV6 || state.pose, { minConf: cl.minConf });

// ── punch-anchored windows ──────────────────────────────────────────────────

let winCache = { key: null };

// Gaps between consecutive punch labels, trimmed to cl.winS seconds from the
// nearest punch on each side (a gap under 2·winS is one window; the stretch
// before the first punch / after the last gets one side). Each window carries
// its metric value and the slips touching it.
function computeWindows(c, m, sl, pun) {
  const key = `${cl.winS}|${cl.metric}`;
  if (winCache.pose === c.pose && winCache.sl === sl && winCache.pun === pun && winCache.key === key) return winCache;
  const W = Math.max(1, Math.round(cl.winS * c.fps));
  const gaps = [];
  let prevEnd = -1;
  for (const p of pun.punches) {
    if (p.s > prevEnd + 1) gaps.push({ gs: prevEnd + 1, ge: p.s - 1, after: prevEnd >= 0, before: true });
    prevEnd = Math.max(prevEnd, p.e);
  }
  if (prevEnd >= 0 && prevEnd < c.n - 1) gaps.push({ gs: prevEnd + 1, ge: c.n - 1, after: true, before: false });

  const spans = [];
  for (const g of gaps) {
    if (g.after && g.before && g.ge - g.gs + 1 > 2 * W) {
      spans.push({ s: g.gs, e: g.gs + W - 1, side: "after" });
      spans.push({ s: g.ge - W + 1, e: g.ge, side: "before" });
    } else if (g.after && g.before) {
      spans.push({ s: g.gs, e: g.ge, side: "between" });
    } else if (g.after) {
      spans.push({ s: g.gs, e: Math.min(g.ge, g.gs + W - 1), side: "after" });
    } else {
      spans.push({ s: Math.max(g.gs, g.ge - W + 1), e: g.ge, side: "before" });
    }
  }

  const windows = spans.map(w => {
    let lo = Infinity, hi = -Infinity, peak = -Infinity, k = 0;
    for (let f = w.s; f <= w.e; f++) {
      const v = m.off[f];
      if (!Number.isFinite(v)) continue;
      k++; lo = Math.min(lo, v); hi = Math.max(hi, v);
      peak = Math.max(peak, Math.abs(v - m.offMed));
    }
    const exc = k >= 3 ? (cl.metric === "range" ? hi - lo : peak) : NaN;
    const slipIdx = [];
    sl.slips.forEach((x, i) => { if (x.s <= w.e && x.e >= w.s) slipIdx.push(i); });
    return { ...w, exc, slipIdx };
  }).filter(w => Number.isFinite(w.exc));

  winCache = { pose: c.pose, sl, pun, key, windows, W };
  return winCache;
}

// Rank-based AUC of exc for slip windows vs the rest (ties share ranks).
function auc(pos, neg) {
  if (!pos.length || !neg.length) return NaN;
  const all = [...pos.map(v => [v, 1]), ...neg.map(v => [v, 0])].sort((a, b) => a[0] - b[0]);
  let i = 0, rankSumPos = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (all[k][1]) rankSumPos += r;
    i = j + 1;
  }
  return (rankSumPos - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length);
}

// Verdict per window at cl.thr, slip-level recall, and the best-F1 threshold.
function scoreWindows(win, sl) {
  const windows = win.windows;
  const reachable = new Set(), caught = new Set();
  let tp = 0, fa = 0, miss = 0, neg = 0;
  for (const w of windows) {
    const pos = w.slipIdx.length > 0;
    w.slipIdx.forEach(i => reachable.add(i));
    const fired = w.exc >= cl.thr;
    if (fired && pos)  { tp++;  w.verdict = "tp";  w.slipIdx.forEach(i => caught.add(i)); }
    else if (fired)    { fa++;  w.verdict = "fa"; }
    else if (pos)      { miss++; w.verdict = "miss"; }
    else               { neg++; w.verdict = "neg"; }
  }
  const P = tp + fa ? tp / (tp + fa) : 0, R = tp + miss ? tp / (tp + miss) : 0;
  const F1 = P + R ? 2 * P * R / (P + R) : 0;
  const pos = windows.filter(w => w.slipIdx.length).map(w => w.exc);
  const negs = windows.filter(w => !w.slipIdx.length).map(w => w.exc);

  // Best F1 over the observed values, for the "what would a threshold buy" line.
  let best = { thr: NaN, F1: 0, P: 0, R: 0 };
  const cands = [...new Set(windows.map(w => +w.exc.toFixed(3)))].sort((a, b) => a - b);
  for (const t of cands) {
    let tpi = 0, fai = 0, mi = 0;
    for (const w of windows) {
      const f = w.exc >= t, p = w.slipIdx.length > 0;
      if (f && p) tpi++; else if (f) fai++; else if (p) mi++;
    }
    const Pi = tpi + fai ? tpi / (tpi + fai) : 0, Ri = tpi + mi ? tpi / (tpi + mi) : 0;
    const Fi = Pi + Ri ? 2 * Pi * Ri / (Pi + Ri) : 0;
    if (Fi > best.F1) best = { thr: t, F1: Fi, P: Pi, R: Ri };
  }

  return {
    windows, nPos: pos.length, nNeg: negs.length, tp, fa, miss, neg, P, R, F1,
    auc: auc(pos, negs), reachable: reachable.size, caught: caught.size, nSlips: sl.slips.length,
    best,
    items: windows.map(w => ({ s: w.s, e: w.e, color: VERDICT_COLOR[w.verdict],
                               alpha: w.verdict === "neg" ? 0.35 : 0.9 })),
  };
}

const windowAt = (windows, f) => windows.find(w => w.s <= f && f <= w.e) || null;
const fmt = (v, d = 2) => Number.isFinite(v) ? v.toFixed(d) : "—";

// ── lens ────────────────────────────────────────────────────────────────────

export const SlipsRule = {
  id: "slips",
  label: "Slips (curated frontal)",

  skeletonStyle() {
    return {
      boneColor: "rgba(255,255,255,0.25)", boneWidth: 1.5, jointRadius: 3,
      highlightJoints: new Set([J.NOSE, J.L_HIP, J.R_HIP]),
    };
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
      id: "sl-timeline", height: 106,
      caption: "Curated frontal spans · Sheet slip labels · punch-anchored windows by verdict (click to seek)",
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

    const m = centerLine(state);
    const pun = computePunches(c);
    const win = (m && !m.bad && sl && pun) ? computeWindows(c, m, sl, pun) : null;
    const sc = win ? scoreWindows(win, sl) : null;
    const f = state.frame;
    renderCenterLine(c, m, sl, pun, win, sc, f);

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

    drawSlipTimeline(document.getElementById("sl-timeline"), c, sl, f,
      { extraLane: { label: "windows", items: sc ? sc.items : [] } });
  },

  draw(ctx, state) {
    const c = curatedFrames(state);
    if (!c) return;
    const s = state.renderScale || 1;
    const f = state.frame;
    const inNow = c.entry && c.inSpan[f];

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
    const here = sl ? slipsAt(sl.slips, f) : [];
    here.forEach((x, i) => {
      badge(`${x.kind.toUpperCase()} SLIP${x.curated ? "" : " (outside span)"}`,
            COLOR[x.kind], (10 + (i + 1) * (fsz / s + 20)) * s);
    });

    // The center line on the body: the hip line, the head point, and the
    // offset between them, colored by what this frame is.
    const m = centerLine(state);
    if (!m || m.bad) return;
    const pun = computePunches(c);
    const win = (sl && pun) ? computeWindows(c, m, sl, pun) : null;
    const w = win ? windowAt(win.windows, f) : null;
    if (w && win) scoreWindows(win, sl);           // refresh verdicts at the current threshold
    const hx = m.hipX[f], hy = m.hipY[f], hxHead = m.headX[f], hyHead = m.headY[f];
    if (![hx, hy, hxHead, hyHead].every(Number.isFinite)) return;
    const col = here.length ? COLOR[here[0].kind]
      : w ? (w.verdict === "fa" ? COLOR_FA : w.verdict === "tp" ? COLOR_TP : "rgba(255,255,255,0.75)")
      : "rgba(255,255,255,0.45)";
    ctx.save();
    ctx.strokeStyle = COLOR.frame;
    ctx.lineWidth = 1.5 * s;
    ctx.setLineDash([6 * s, 6 * s]);
    ctx.beginPath(); ctx.moveTo(hx, hy + 20 * s); ctx.lineTo(hx, hyHead - 60 * s); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = col;
    ctx.lineWidth = 4 * s;
    ctx.beginPath(); ctx.moveTo(hx, hyHead); ctx.lineTo(hxHead, hyHead); ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(hxHead, hyHead, 5 * s, 0, Math.PI * 2); ctx.fill();
    ctx.font = `${Math.round(13 * s)}px ui-monospace, monospace`;
    ctx.textBaseline = "bottom";
    ctx.fillText(`${m.off[f] >= 0 ? "+" : ""}${fmt(m.off[f])} torso`, Math.max(hx, hxHead) + 10 * s, hyHead - 4 * s);
    ctx.restore();

    // Corner HUD: the offset, and what window (if any) this frame sits in.
    const lines = [
      [`off ${m.off[f] >= 0 ? "+" : ""}${fmt(m.off[f])} · med ${fmt(m.offMed)}`, "#fff"],
      w ? [`${w.side} window · ${cl.metric} ${fmt(w.exc)} ${w.exc >= cl.thr ? "≥" : "<"} ${cl.thr.toFixed(2)}`,
           VERDICT_COLOR[w.verdict] || "#fff"]
        : [pun ? "not in a punch window" : "no punch labels", "#888"],
    ];
    const hs = Math.round(13 * s), lineH = hs + 4 * s, padX = 10 * s, padY = 8 * s;
    ctx.save();
    ctx.font = `${hs}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    const boxW = Math.max(...lines.map(l => ctx.measureText(l[0]).width)) + padX * 2;
    const boxH = lines.length * lineH + padY * 2 - 4 * s;
    const bx = ctx.canvas.width - boxW - 10 * s, by = 10 * s;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 6 * s); ctx.fill();
    lines.forEach(([t, colr], i) => { ctx.fillStyle = colr; ctx.fillText(t, bx + padX, by + padY + i * lineH); });
    ctx.restore();
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
    <div id="sl-slips" style="font-size:12px; max-height:200px; overflow:auto"></div>

    <h3>Center line vs slips <span class="muted small">(punch-anchored windows)</span></h3>
    <p class="hint">
      Head offset from the vertical through the <span style="color:${COLOR.frame}">hip center</span>,
      in torso heights — the head-off-center-line quantity. Windows are the
      gaps between punch labels, trimmed to the seconds below on each side of a
      punch; frames inside a punch are left out (there the head is meant to
      move). A window is a slip window when a labeled slip touches it.
      <span style="color:${COLOR_TP}">fired, slip</span> ·
      <span style="color:${COLOR_FA}">fired, no slip</span> ·
      <span style="color:${COLOR_MISS}">quiet, slip</span> ·
      <span style="color:${COLOR_NEG}">quiet</span>.
    </p>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; font-size:12px">
      <label>window <input id="sl-cl-win" type="number" min="0.2" max="3" step="0.1" value="${cl.winS}" style="width:58px"> s</label>
      <label>metric
        <select id="sl-cl-metric" style="font-size:12px">
          <option value="range" ${cl.metric === "range" ? "selected" : ""}>range in window</option>
          <option value="peak" ${cl.metric === "peak" ? "selected" : ""}>peak |offset − median|</option>
        </select></label>
    </div>
    <label style="display:block; font-size:12px; margin-top:4px">
      threshold = <output id="sl-cl-thr-out">${cl.thr.toFixed(2)}</output> torso
      <input type="range" id="sl-cl-thr" min="0" max="0.8" step="0.01" value="${cl.thr}" style="width:100%"></label>
    <div id="sl-cl-stats" style="font-size:13px; line-height:1.6; margin-top:4px"></div>
    <canvas id="sl-cl-trace" width="320" height="130" style="display:block; margin-top:6px"></canvas>
    <div class="muted small" id="sl-cl-legend">offset trace · slips shaded in their color · punches grey · window verdicts along the bottom</div>

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
  host.querySelector("#sl-cl-win").addEventListener("change", e => {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v) && v > 0) { cl.winS = v; saveCl(); refresh(); }
  });
  host.querySelector("#sl-cl-metric").addEventListener("change", e => {
    cl.metric = e.target.value; saveCl(); refresh();
  });
  host.querySelector("#sl-cl-thr").addEventListener("input", e => {
    cl.thr = parseFloat(e.target.value);
    host.querySelector("#sl-cl-thr-out").textContent = cl.thr.toFixed(2);
    saveCl(); refresh();
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

// ── center line section: stats + trace ──────────────────────────────────────

function renderCenterLine(c, m, sl, pun, win, sc, f) {
  const statsEl = host.querySelector("#sl-cl-stats");
  const canvas = host.querySelector("#sl-cl-trace");
  if (!statsEl) return;

  if (!m || m.bad) {
    statsEl.innerHTML = `<span class="muted">No usable torso in this cache — cannot measure the center line.</span>`;
    drawTrace(canvas, c, m, sl, pun, null, f);
    return;
  }
  if (!sl || !pun) {
    statsEl.innerHTML = `<span class="muted">Waiting for the Sheet rows (slips + punches) to place the windows.</span>`;
    drawTrace(canvas, c, m, null, null, null, f);
    return;
  }
  if (!pun.punches.length) {
    statsEl.innerHTML = `<span class="muted">No punch labels in this round — nothing to anchor windows to.</span>`;
    drawTrace(canvas, c, m, sl, pun, null, f);
    return;
  }

  statsEl.innerHTML =
    `<code>${sc.windows.length}</code> windows ·
     <span style="color:${COLOR_TP}">${sc.nPos} with a slip</span> /
     <span style="color:${COLOR_NEG}">${sc.nNeg} without</span> ·
     AUC <code>${fmt(sc.auc, 3)}</code><br>
     at <code>${cl.thr.toFixed(2)}</code>: slips caught <code>${sc.caught}</code> / ${sc.nSlips}
       <span class="muted small">(${sc.reachable} reachable by a window)</span> ·
     <span style="color:${COLOR_FA}">FA ${sc.fa}</span> ·
     <span style="color:${COLOR_MISS}">quiet slip windows ${sc.miss}</span><br>
     P <code>${fmt(sc.P)}</code> · window R <code>${fmt(sc.R)}</code> · F1 <code>${fmt(sc.F1)}</code>
     <span class="muted small">· best F1 <code>${fmt(sc.best.F1)}</code> at <code>${fmt(sc.best.thr)}</code>
       (P ${fmt(sc.best.P)}, R ${fmt(sc.best.R)})</span>`;

  drawTrace(canvas, c, m, sl, pun, sc, f);
}

// Sidebar trace: the offset over the round, slips and punches shaded, window
// verdicts along the bottom, the median line, ±threshold for the peak metric.
function drawTrace(canvas, c, m, sl, pun, sc, frame) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!m || m.bad) return;
  const N = m.n;
  const xOf = f => (f / Math.max(1, N - 1)) * W;
  const stripH = 6, plotH = H - stripH - 4;

  let lo = Infinity, hi = -Infinity;
  for (let f = 0; f < N; f++) { const v = m.off[f]; if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  if (!Number.isFinite(lo)) return;
  const pad = 0.1 * Math.max(0.2, hi - lo);
  lo -= pad; hi += pad;
  const yOf = v => plotH - 2 - ((v - lo) / (hi - lo)) * (plotH - 4);

  if (pun) {
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    for (const p of pun.punches) ctx.fillRect(xOf(p.s), 0, Math.max(1, xOf(p.e) - xOf(p.s)), plotH);
  }
  if (sl) {
    ctx.globalAlpha = 0.3;
    for (const x of sl.slips) {
      ctx.fillStyle = COLOR[x.kind];
      ctx.fillRect(xOf(x.s), 0, Math.max(1.5, xOf(x.e) - xOf(x.s)), plotH);
    }
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(0, yOf(m.offMed)); ctx.lineTo(W, yOf(m.offMed)); ctx.stroke();
  if (cl.metric === "peak") {
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    for (const sgn of [-1, 1]) {
      const y = yOf(m.offMed + sgn * cl.thr);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  let started = false;
  for (let f = 0; f < N; f++) {
    const v = m.off[f];
    if (!Number.isFinite(v)) { started = false; continue; }
    if (!started) { ctx.moveTo(xOf(f), yOf(v)); started = true; } else ctx.lineTo(xOf(f), yOf(v));
  }
  ctx.stroke();

  if (sc) {
    for (const w of sc.windows) {
      ctx.fillStyle = VERDICT_COLOR[w.verdict];
      ctx.globalAlpha = w.verdict === "neg" ? 0.4 : 0.95;
      ctx.fillRect(xOf(w.s), H - stripH, Math.max(1.5, xOf(w.e) - xOf(w.s)), stripH);
    }
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = COLOR.frame;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 0); ctx.lineTo(xOf(frame), H); ctx.stroke();
}
