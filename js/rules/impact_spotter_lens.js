// Impact spotter — GT vs predicted impact (turnaround) frames per punch, from
// the two-head TCN trained on the "Impact Frames" sheet labels.
//
// Loads ./lens_data/impact_spotter_data.json (committed to this repo). Regenerate:
//   cd ~/code/cornerman-backend && .venv/bin/python impact_spotter/train_impact_spotter.py
//   cp "$HOME/Google Drive/My Drive/Cornerman/data/model_outputs/impact_spotter/impact_spotter_viewer_latest.json" \
//      ~/code/cornerman-debug-viewer/lens_data/impact_spotter_data.json
//
// Schema (times are SOURCE-VIDEO seconds; gt/pred/span are BlazePose cache
// frame indices — the lens maps via *_sec + the viewer's start_sec/fps, so it
// works over whichever pose cache is loaded):
//   { metrics: { model: {overall, per_video, per_mode}, baseline: {...} },
//     videos: { <base>: { mode, rounds: { <ri>: { fps, punches: [
//       { uuid, ptype, hand, gt_sec, pred_sec, gt, pred, base_pred,
//         err_ms, base_err_ms, span:[lo,hi], conf_t0, conf_dt, conf:[...] } ] } } } } }
//
// Tolerance convention (matches the trainer): |err| <= 50 ms counts as +-1
// frame @30fps, <= 83 ms as +-2 (quantization-fair).

const DATA_URL = "./lens_data/impact_spotter_data.json";

const TOL1_MS = 50, TOL2_MS = 83.3;
const C = {
  gt:      "#56d364",   // green — labeled turnaround
  pred:    "#ffa657",   // orange — model prediction
  base:    "#8ab4f8",   // blue — kinematic baseline
  bad:     "#ff5d6c",
  span:    "rgba(255,255,255,0.13)",
  playhead:"#3ad9e0",
  grid:    "#333",
  text:    "#aaa",
};

let host = null;
let dump = null;
let dumpError = null;
let latestState = null;
let activeVideo = null;   // dump.videos[base] for the scoped cache
let activeBase = null;
let activeRound = null;   // {fps, punches} for the scoped round
let showBaseline = false;
let loopOn = false;       // labeler-style punch loop mode
let loopIdx = -1;         // index into chronoPunches()
let keysBound = false;

// ---------------------------------------------------------------- helpers
function stripStem(s) { return String(s || "").replace(/_h264$/, ""); }

function poseOf(state) { return state.poseV6 || state.pose || null; }

function startSec(state) {
  const p = poseOf(state);
  return (p && (p.start_sec || 0)) || 0;
}

function secToFrame(state, tSrc) {
  // viewer convention: cache frame f sits on source frame start_frame + f,
  // start_frame = floor(start_sec * fps). +1e-6 guards the exact-frame-
  // boundary float round-trip (impact_frame/fps*fps can land one ulp low).
  const fps = state.fps || 30;
  return Math.floor(tSrc * fps + 1e-6) - Math.floor(startSec(state) * fps + 1e-6);
}

function frameToSec(state, f) {
  const fps = state.fps || 30;
  return (Math.floor(startSec(state) * fps) + f + 0.5) / fps;
}

function errClass(errMs) {
  const e = Math.abs(errMs);
  return e <= TOL1_MS ? "ok1" : e <= TOL2_MS ? "ok2" : "bad";
}
const ERR_COLOR = { ok1: C.gt, ok2: "#d3b136", bad: C.bad };

function seekFrame(f) {
  const slider = document.getElementById("scrubber");
  if (!slider) return;
  slider.value = Math.max(0, Math.round(f));
  slider.dispatchEvent(new Event("input", { bubbles: true }));
}

function matchRound(state) {
  const prev = activeRound;
  activeVideo = null; activeBase = null; activeRound = null;
  if (!dump || !state || !state.cacheBasename || state.cacheRound == null) return;
  const want = stripStem(state.cacheBasename);
  for (const [base, v] of Object.entries(dump.videos || {})) {
    if (stripStem(base) === want) { activeVideo = v; activeBase = base; break; }
  }
  if (activeVideo) activeRound = activeVideo.rounds[String(state.cacheRound)] || null;
  if (prev && activeRound !== prev) { loopOn = false; loopIdx = -1; }   // new round
}

function punchesSorted() {
  if (!activeRound) return [];
  return [...activeRound.punches].sort((a, b) => Math.abs(b.err_ms) - Math.abs(a.err_ms));
}

function chronoPunches() {
  if (!activeRound) return [];
  return [...activeRound.punches].sort((a, b) => a.gt_sec - b.gt_sec);
}

// Loop window in VIEWER frames: anchor on the viewer-clock gt frame, then
// apply the punch-span extent as BlazePose-clock-relative offsets (the
// offsets cancel any one-frame cross-clock drift), +-3 frames of margin.
function loopWindow(state, p) {
  const gtF = secToFrame(state, p.gt_sec);
  const lo = gtF + (p.span[0] - p.gt) - 3;
  const hi = gtF + (p.span[1] - p.gt) + 3;
  const n = poseOf(state) ? poseOf(state).n_frames : Infinity;
  return [Math.max(0, lo), Math.min(n - 1, Math.max(hi, lo + 6))];
}

function setLoopIdx(i, autoplay = true) {
  const ps = chronoPunches();
  if (!ps.length || !latestState) return;
  loopIdx = ((i % ps.length) + ps.length) % ps.length;   // wrap both directions
  const [lo] = loopWindow(latestState, ps[loopIdx]);
  seekFrame(lo);
  if (autoplay) document.getElementById("video")?.play?.()?.catch?.(() => {});
  renderLoopBar();
}

function renderLoopBar() {
  const cnt = host && host.querySelector("#is-loop-count");
  const btn = host && host.querySelector("#is-loop");
  if (btn) {
    btn.textContent = loopOn ? "⏹ stop loop" : "⟲ loop punches";
    btn.style.background = loopOn ? "#2d4a2f" : "";
  }
  if (cnt) {
    const ps = chronoPunches();
    const p = loopOn && loopIdx >= 0 ? ps[loopIdx] : null;
    cnt.textContent = p ? `${loopIdx + 1}/${ps.length} · ${p.ptype}` : `${ps.length} punches`;
  }
}

function toggleLoop() {
  loopOn = !loopOn;
  if (loopOn) {
    // start from the punch nearest the playhead, else the first
    const ps = chronoPunches();
    let i = 0;
    if (latestState && ps.length) {
      const t = frameToSec(latestState, latestState.frame);
      let bd = Infinity;
      ps.forEach((p, k) => {
        const d = Math.abs(p.gt_sec - t);
        if (d < bd) { bd = d; i = k; }
      });
    }
    setLoopIdx(i);
  } else {
    renderLoopBar();
  }
}

function ensureKeys() {
  if (keysBound) return;
  keysBound = true;
  // capture phase so loop-mode arrows beat the viewer's frame-step binding;
  // inert unless this lens is selected AND loop mode is on
  document.addEventListener("keydown", (e) => {
    if (!loopOn || !activeRound) return;
    const sel = document.getElementById("rule-select");
    if (sel && sel.value !== "impact_spotter") return;
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === "ArrowRight") {
      e.preventDefault(); e.stopPropagation(); setLoopIdx(loopIdx + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault(); e.stopPropagation(); setLoopIdx(loopIdx - 1);
    }
  }, true);
}

function currentPunch(state) {
  if (!activeRound) return null;
  const t = frameToSec(state, state.frame);
  let best = null, bestD = Infinity;
  for (const p of activeRound.punches) {
    const lo = Math.min(p.gt_sec, p.pred_sec) - 0.4;
    const hi = Math.max(p.gt_sec, p.pred_sec) + 0.4;
    const d = t < lo ? lo - t : t > hi ? t - hi : 0;
    if (d < bestD) { bestD = d; best = p; }
  }
  return bestD <= 0.35 ? best : null;
}

// ---------------------------------------------------------------- data load
async function ensureData() {
  if (dump || dumpError) return;
  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    dump = await res.json();
  } catch (e) {
    dumpError = String(e);
  }
}

// ---------------------------------------------------------------- mount
function mount(hostEl, state) {
  host = hostEl;
  latestState = state;
  if (dumpError) { dumpError = null; dump = null; }   // re-mount retries the fetch
  host.innerHTML = `<div style="color:#888">loading impact spotter data…</div>`;
  buildTimelineSlot();
  ensureData().then(() => {
    // if the user switched lenses while the fetch was in flight, don't
    // clobber the other lens's sidebar
    const sel = document.getElementById("rule-select");
    if (sel && sel.value !== "impact_spotter") return;
    buildSidebar(latestState);
    update(latestState);
  });
}

function buildSidebar(state) {
  if (dumpError) {
    host.innerHTML =
      `<div style="color:${C.bad}">impact_spotter_data.json failed to load ` +
      `(${dumpError}).<br>Deploy it with:<br>` +
      `<code style="font-size:11px">cp "$HOME/Google Drive/My Drive/Cornerman/data/model_outputs/` +
      `impact_spotter/impact_spotter_viewer_latest.json" lens_data/impact_spotter_data.json</code></div>`;
    return;
  }
  host.innerHTML = `
    <div id="is-scope" style="font-size:12px;color:#888;margin-bottom:6px"></div>
    <div id="is-metrics" style="font-size:12px;margin-bottom:8px"></div>
    <label style="font-size:12px;color:#aaa;display:block;margin-bottom:8px">
      <input type="checkbox" id="is-show-base"> show kinematic baseline (blue)
    </label>
    <div id="is-loop-bar" style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
      <button id="is-loop" style="cursor:pointer">⟲ loop punches</button>
      <button id="is-prev" title="previous punch (←)" style="cursor:pointer">◀</button>
      <button id="is-next" title="next punch (→)" style="cursor:pointer">▶</button>
      <span id="is-loop-count" style="font-size:11px;color:#888"></span>
    </div>
    <div style="font-size:10px;color:#666;margin:-4px 0 8px">
      loop mode: ←/→ switch punch · viewer speed dropdown sets loop speed</div>
    <div id="is-current" style="border:1px solid #333;border-radius:6px;
         padding:8px;margin-bottom:8px;min-height:52px;font-size:12px"></div>
    <canvas id="is-conf" style="display:block;width:100%;height:90px;
         border:1px solid #333;border-radius:6px;margin-bottom:8px"></canvas>
    <div style="font-size:11px;color:#888;margin-bottom:4px">
      punches, worst error first — click to jump</div>
    <div id="is-list" style="max-height:260px;overflow-y:auto;font-size:11px"></div>`;
  const cb = host.querySelector("#is-show-base");
  cb.checked = showBaseline;
  cb.addEventListener("change", () => {
    showBaseline = cb.checked;
    document.getElementById("video").dispatchEvent(new Event("seeked"));
  });
  host.querySelector("#is-loop").addEventListener("click", toggleLoop);
  host.querySelector("#is-prev").addEventListener("click", () => {
    if (!loopOn) toggleLoop(); else setLoopIdx(loopIdx - 1);
  });
  host.querySelector("#is-next").addEventListener("click", () => {
    if (!loopOn) toggleLoop(); else setLoopIdx(loopIdx + 1);
  });
  ensureKeys();
  renderLoopBar();
}

function buildTimelineSlot() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:6px";
  const cv = document.createElement("canvas");
  cv.id = "is-timeline";
  cv.style.cssText = "display:block;width:100%;height:110px;cursor:pointer";
  wrap.appendChild(cv);
  slot.appendChild(wrap);
  cv.addEventListener("click", (e) => {
    if (!activeRound || !latestState) return;
    const rect = cv.getBoundingClientRect();
    const { t0, t1 } = timelineRange(latestState);
    const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
    const t = t0 + ratio * (t1 - t0);
    seekFrame(secToFrame(latestState, t));
  });
}

function timelineRange(state) {
  const p = poseOf(state);
  const t0 = startSec(state);
  const dur = p ? p.n_frames / (state.fps || 30) : 60;
  return { t0, t1: t0 + dur };
}

// ---------------------------------------------------------------- update
function update(state) {
  latestState = state;
  if (!dump) return;
  matchRound(state);

  // labeler-style loop: when the playhead runs past the punch window, wrap
  if (loopOn && activeRound && loopIdx >= 0) {
    const ps = chronoPunches();
    const p = ps[loopIdx];
    if (p) {
      const [lo, hi] = loopWindow(state, p);
      if (state.frame > hi || state.frame < lo - 2) seekFrame(lo);
    }
    renderLoopBar();
  }

  const scope = host.querySelector("#is-scope");
  if (scope) {
    scope.innerHTML = activeRound
      ? `scoped: <code>${activeBase}</code> · r${state.cacheRound} · ` +
        `${activeRound.punches.length} labeled punches`
      : `no impact data for <code>${state.cacheBasename || "?"}</code> ` +
        `r${state.cacheRound} — train/deploy first`;
  }
  renderMetrics();
  renderCurrent(state);
  renderList(state);
  drawTimeline(state);
  drawConf(state);
}

function fmtM(m) {
  return m ? `±1f <b>${(m.pce1 * 100).toFixed(0)}%</b> · ` +
             `±2f <b>${(m.pce2 * 100).toFixed(0)}%</b> · ` +
             `MAE <b>${m.mae_ms.toFixed(0)}ms</b> (n=${m.n})` : "—";
}

function renderMetrics() {
  const el = host.querySelector("#is-metrics");
  if (!el) return;
  const M = dump.metrics || {};
  const model = M.model || M;            // tolerate old single-block shape
  const bl = M.baseline || null;
  const pv = activeBase && model.per_video ? model.per_video[activeBase] : null;
  const pvb = activeBase && bl && bl.per_video ? bl.per_video[activeBase] : null;
  el.innerHTML =
    `<div>this video — model: ${fmtM(pv)}</div>` +
    (pvb ? `<div style="color:${C.base}">this video — baseline: ${fmtM(pvb)}</div>` : "") +
    `<div style="color:#888">overall — model: ${fmtM(model.overall)}</div>`;
}

function renderCurrent(state) {
  const el = host.querySelector("#is-current");
  if (!el) return;
  const p = currentPunch(state);
  if (!p) {
    el.innerHTML = `<span style="color:#666">no punch at playhead — click the
      timeline or the list to jump to one</span>`;
    return;
  }
  // all frame numbers go through the VIEWER's clock (secToFrame) so the card,
  // the list seeks, and the on-video flash agree whichever cache is loaded
  const cls = errClass(p.err_ms);
  const gtF = secToFrame(state, p.gt_sec);
  const predF = secToFrame(state, p.pred_sec);
  const baseF = secToFrame(state, p.gt_sec + p.base_err_ms / 1000);
  el.innerHTML =
    `<b>${p.ptype}</b> <span style="color:#888">(${p.hand})</span><br>` +
    `GT <span style="color:${C.gt}">f${gtF}</span> · ` +
    `pred <span style="color:${C.pred}">f${predF}</span> · ` +
    `err <b style="color:${ERR_COLOR[cls]}">${p.err_ms > 0 ? "+" : ""}${p.err_ms}ms</b>` +
    (showBaseline
      ? ` · base <span style="color:${C.base}">f${baseF}</span> ` +
        `(${p.base_err_ms > 0 ? "+" : ""}${p.base_err_ms}ms)`
      : "");
}

function renderList(state) {
  const el = host.querySelector("#is-list");
  if (!el) return;
  if (!activeRound) { el.innerHTML = ""; return; }
  el.innerHTML = punchesSorted().map((p) => {
    const cls = errClass(p.err_ms);
    const gtF = secToFrame(state, p.gt_sec);
    return `<div data-sec="${p.gt_sec}" style="display:flex;gap:6px;padding:2px 4px;
        cursor:pointer;border-left:3px solid ${ERR_COLOR[cls]}">
      <span style="width:34px;color:#888">f${gtF}</span>
      <span style="flex:1">${p.ptype}</span>
      <span style="color:${ERR_COLOR[cls]}">${p.err_ms > 0 ? "+" : ""}${p.err_ms}ms</span>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-sec]").forEach((row) => {
    row.addEventListener("click", () => {
      const sec = parseFloat(row.dataset.sec);
      if (loopOn) {
        const i = chronoPunches().findIndex((p) => p.gt_sec === sec);
        if (i >= 0) { setLoopIdx(i); return; }
      }
      seekFrame(secToFrame(latestState, sec));
    });
  });
}

// ---------------------------------------------------------------- canvases
function sizeCanvas(cv) {
  const rect = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(50, Math.round(rect.width * dpr));
  const h = Math.max(30, Math.round(rect.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return { ctx: cv.getContext("2d"), W: w, H: h, dpr };
}

function drawTimeline(state) {
  const cv = document.getElementById("is-timeline");
  if (!cv) return;
  const { ctx, W, H, dpr } = sizeCanvas(cv);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, W, H);
  if (!activeRound) {
    ctx.fillStyle = "#666";
    ctx.font = `${12 * dpr}px monospace`;
    ctx.fillText("impact spotter: no data for this round", 12 * dpr, 20 * dpr);
    return;
  }
  const { t0, t1 } = timelineRange(state);
  const x = (t) => ((t - t0) / Math.max(1e-6, t1 - t0)) * W;
  const rowY = { lead: H * 0.18, rear: H * 0.58 };
  const rowH = H * 0.24;

  ctx.fillStyle = C.text;
  ctx.font = `${10 * dpr}px monospace`;
  ctx.fillText("lead", 4 * dpr, rowY.lead - 3 * dpr);
  ctx.fillText("rear", 4 * dpr, rowY.rear - 3 * dpr);

  for (const p of activeRound.punches) {
    const y = rowY[p.hand] ?? rowY.lead;
    const sLo = frameSecSpan(state, p)[0], sHi = frameSecSpan(state, p)[1];
    ctx.fillStyle = C.span;
    ctx.fillRect(x(sLo), y, Math.max(2, x(sHi) - x(sLo)), rowH);
    // GT tick
    ctx.strokeStyle = C.gt; ctx.lineWidth = 2 * dpr;
    line(ctx, x(p.gt_sec), y - 2 * dpr, x(p.gt_sec), y + rowH + 2 * dpr);
    // pred tick, colored by correctness
    ctx.strokeStyle = ERR_COLOR[errClass(p.err_ms)];
    line(ctx, x(p.pred_sec), y, x(p.pred_sec), y + rowH);
    if (showBaseline) {
      const bSec = p.gt_sec + p.base_err_ms / 1000;
      ctx.strokeStyle = C.base; ctx.lineWidth = 1 * dpr;
      line(ctx, x(bSec), y + rowH * 0.5, x(bSec), y + rowH + 2 * dpr);
    }
  }
  // playhead
  const tNow = frameToSec(state, state.frame);
  ctx.strokeStyle = C.playhead; ctx.lineWidth = 1.5 * dpr;
  line(ctx, x(tNow), 0, x(tNow), H);
}

function frameSecSpan(state, p) {
  // span is stored as cache frames; map back through the viewer's clock so the
  // bar lines up with whatever cache is loaded
  return [frameToSec(state, p.span[0]) - 0.5 / (state.fps || 30),
          frameToSec(state, p.span[1]) + 0.5 / (state.fps || 30)];
}

function line(ctx, x0, y0, x1, y1) {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

function drawConf(state) {
  const cv = host && host.querySelector("#is-conf");
  if (!cv) return;
  const { ctx, W, H, dpr } = sizeCanvas(cv);
  ctx.clearRect(0, 0, W, H);
  const p = currentPunch(state);
  if (!p || !p.conf || !p.conf.length) {
    ctx.fillStyle = "#555";
    ctx.font = `${11 * dpr}px monospace`;
    ctx.fillText("confidence curve — jump to a punch", 8 * dpr, 18 * dpr);
    return;
  }
  const t0 = p.conf_t0, dt = p.conf_dt, n = p.conf.length;
  const x = (t) => ((t - t0) / Math.max(1e-6, (n - 1) * dt)) * W;
  const y = (v) => H - v * (H - 8 * dpr) - 4 * dpr;
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  line(ctx, 0, y(0.5), W, y(0.5));
  ctx.strokeStyle = "#8ab4f8"; ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const px = x(t0 + i * dt), py = y(p.conf[i]);
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.stroke();
  ctx.strokeStyle = C.gt; ctx.lineWidth = 2 * dpr;
  line(ctx, x(p.gt_sec), 0, x(p.gt_sec), H);
  ctx.strokeStyle = C.pred;
  line(ctx, x(p.pred_sec), 0, x(p.pred_sec), H);
  const tNow = frameToSec(state, state.frame);
  if (tNow >= t0 && tNow <= t0 + (n - 1) * dt) {
    ctx.strokeStyle = C.playhead; ctx.lineWidth = 1 * dpr;
    line(ctx, x(tNow), 0, x(tNow), H);
  }
}

// ---------------------------------------------------------------- on-video
function draw(ctx, state) {
  if (!activeRound) return;
  const s = state.renderScale || 1;
  const p = currentPunch(state);
  if (!p) return;
  const onGt = state.frame === secToFrame(state, p.gt_sec);
  const onPred = state.frame === secToFrame(state, p.pred_sec);
  if (onGt || onPred) {
    // frame-accurate border flash: green = labeled turnaround, orange = pred
    ctx.save();
    ctx.lineWidth = 6 * s;
    ctx.strokeStyle = onGt && onPred ? C.gt : onGt ? C.gt : C.pred;
    ctx.strokeRect(3 * s, 3 * s, ctx.canvas.width - 6 * s, ctx.canvas.height - 6 * s);
    if (onGt && onPred) {
      ctx.setLineDash([12 * s, 12 * s]);
      ctx.strokeStyle = C.pred;
      ctx.strokeRect(3 * s, 3 * s, ctx.canvas.width - 6 * s, ctx.canvas.height - 6 * s);
    }
    ctx.restore();
  }
  // HUD
  ctx.save();
  ctx.font = `${13 * s}px monospace`;
  const cls = errClass(p.err_ms);
  const txt = `${p.ptype} ${p.err_ms > 0 ? "+" : ""}${p.err_ms}ms  ` +
              `GT f${secToFrame(state, p.gt_sec)} → pred f${secToFrame(state, p.pred_sec)}`;
  const w = ctx.measureText(txt).width + 16 * s;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(8 * s, 8 * s, w, 24 * s);
  ctx.fillStyle = ERR_COLOR[cls];
  ctx.fillText(txt, 16 * s, 25 * s);
  ctx.restore();
}

export const ImpactSpotterLensRule = {
  id: "impact_spotter",
  label: "Impact spotter",
  mount,
  update,
  draw,
};
