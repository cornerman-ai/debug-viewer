// Chin depth — the x axis: how well each source finds the chin, left-right.
//
// The sibling lens `chin_sources` is the HEIGHT axis. This one is the same
// three chin estimates measured along x instead of y:
//
//   height rule   chin tip  vs  the TOP of the lead shoulder    -> dy
//   depth rule    chin tip  vs  the lead shoulder's FRONT       -> dx
//
// What gets drawn:
//
//   ◯ red ring      the labelers' median chin click — the target
//   ● purple        the skeleton formula's chin
//   ● cyan          the face pipeline's chin (orange below the score gate)
//   ◯ amber ring    the labelers' median SHOULDER-FRONT click
//   ■ lime          the BlazePose lead-shoulder KEYPOINT
//   | x guides      a vertical line at each x, because on this axis the y
//                   positions are context and the x positions are the measurement
//
// EVERYTHING HERE IS UNSIGNED — |dx|, a distance, never a direction.
//
// That is a deliberate retreat, not an oversight. The depth rule's actual
// question ("is the chin ahead of the shoulder, or tucked behind it?") needs
// to know which way the boxer is working, and the geometric facing estimate
// this lens used to draw — lead-vs-rear shoulder separation, nose fallback —
// was checked against real footage on 2026-08-22 and found unreliable. Until
// a model can call the direction, anything signed would be decorated noise.
//
// So the lens answers the question that survives without direction: WHICH
// CHIN IS CLOSER TO THE HUMAN CLICK, and by how much. That is a pure
// distance, so a broken facing sign cannot touch it. The shoulder marks stay
// drawn as context — you can see the gap the rule will eventually read — but
// no gap number is computed, because its sign is the whole point of it.
//
// Units: TORSO (shoulder-mid to hip-mid). Shoulder width is the projection
// of the very line depth is measured along, so it collapses side-on and
// every number divided by it inflates.
//
// Data: ./lens_data/chin_depth/<stem>.json + index.json, built by the
// backend's chin_depth_lens_data.py. Only labeled frames carry data, so
// this is a frame-by-frame inspector: the sidebar lists them, the timeline
// marks them.
//
// Alignment is BY TIME, exactly as in chin_sources: each entry's `t` is
// SOURCE-VIDEO seconds off the cache _pts clock, mapped with
// round(t*fps) - floor(start_sec*fps). ROUND, not floor.

const DATA_DIR = "./lens_data/chin_depth/";

const C = {
  gt:       "#ff2f45",   // red — the labelers' chin
  gtSh:     "#ffc233",   // amber — the labelers' shoulder front
  proxy:    "#b45cff",   // purple — the skeleton formula's chin
  ext:      "#3ad9e0",   // cyan — the face pipeline's chin
  gated:    "#ff9e64",   // an extractor chin below the score gate
  kp:       "#7ee787",   // lime — the shoulder KEYPOINT
  tie:      "#8a8a8a",   // the two chins land equally close
  mark:     "#d3b136",
  playhead: "#3ad9e0",
  text:     "#aaa",
};

const SNAP_FRAMES = 2;

let host = null;
let latestState = null;
let index = null, indexError = null, indexPromise = null;
let data = {};
let dataError = {};
let activeStem = null;
let activeData = null;
let byViewer = null;
let mapsKey = "";

// ---------------------------------------------------------------- helpers
function stripStem(s) { return String(s || "").replace(/_h264$/, ""); }
function poseOf(state) { return state.poseV6 || state.pose || null; }
function startSec(state) { return (poseOf(state)?.start_sec) || 0; }

function secToFrame(state, tSrc) {
  const fps = state.fps || 30;
  return Math.round(tSrc * fps) - Math.floor(startSec(state) * fps + 1e-6);
}

function fmt(v, d = 3) { return Number.isFinite(v) ? v.toFixed(d) : "—"; }
function signed(v, d = 3) {
  return Number.isFinite(v) ? (v >= 0 ? "+" : "") + v.toFixed(d) : "—";
}

function seekFrame(f) {
  const slider = document.getElementById("scrubber");
  if (!slider) return;
  slider.value = Math.max(0, Math.round(f));
  slider.dispatchEvent(new Event("input", { bubbles: true }));
}

function refresh() {
  document.getElementById("video")?.dispatchEvent(new Event("seeked"));
}

// ---------------------------------------------------------------- data
function ensureIndex() {
  if (index || indexError || indexPromise) return indexPromise;
  indexPromise = fetch(DATA_DIR + "index.json")
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(j => { index = j; })
    .catch(e => { indexError = String(e); })
    .finally(() => {
      mapsKey = "";
      if (host) {
        if (latestState) rebuildMaps(latestState);
        buildSidebar();
        refresh();
      }
    });
  return indexPromise;
}
ensureIndex();

function indexStemFor(base) {
  if (!index?.videos) return null;
  for (const c of [base, stripStem(base)]) if (index.videos.includes(c)) return c;
  return null;
}

// A missing index shows every video rather than none: a broken fetch should
// look like a broken lens, not an empty corpus.
function requiresVideo(base) {
  if (indexError) return true;
  if (!index) return false;
  return indexStemFor(base) != null;
}

async function ensureData(stem) {
  if (!stem || data[stem] || dataError[stem]) return;
  const name = indexStemFor(stem) || stripStem(stem);
  try {
    const r = await fetch(DATA_DIR + encodeURIComponent(name) + ".json");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data[stem] = await r.json();
  } catch (e) {
    dataError[stem] = String(e);
  }
  mapsKey = "";              // memoized "no data" while the fetch was in flight
  if (host) {
    if (latestState) rebuildMaps(latestState);
    buildSidebar();
    refresh();
  }
}

// ---------------------------------------------------------------- geometry
function ctxW(state) { return activeData?.wh?.[0] || poseOf(state)?.width || 1; }
function ctxH(state) { return activeData?.wh?.[1] || poseOf(state)?.height || 1; }
function scoreGate() { return activeData?.score_gate ?? 0.7; }
function gatedOut(entry) {
  return entry?.ext != null && entry.score != null && entry.score < scoreGate();
}

// |dx| between two points, in TORSO units. UNSIGNED on purpose — see the
// header: the facing estimate that would give this a direction is not
// trustworthy, and a distance needs no direction to be correct.
function dx(entry, a, b, W) {
  if (!a || !b || !entry?.torso_px) return NaN;
  return Math.abs(a[0] - b[0]) * W / entry.torso_px;
}

function errorsOf(entry, W) {
  if (!entry) return null;
  return {
    // each chin estimate against the clicked chin, on the depth axis
    proxy: dx(entry, entry.proxy, entry.gt, W),
    ext: dx(entry, entry.ext, entry.gt, W),
    // the shoulder end: keypoint against the clicked front. Context only —
    // the rule reads the SIGNED gap, which is on hold.
    kp: dx(entry, entry.kp, entry.gt_sh, W),
    // how far apart the two clicked points are. The magnitude the rule will
    // eventually threshold, minus the sign that gives it meaning.
    span: dx(entry, entry.gt, entry.gt_sh, W),
  };
}

function rebuildMaps(state) {
  const stem = state.cacheBasename || "";
  const key = `${stem}|${state.fps}|${startSec(state)}|${poseOf(state)?.n_frames}`;
  if (key === mapsKey) return;
  mapsKey = key;
  activeStem = stem;
  activeData = data[stem] || data[stripStem(stem)] || null;
  byViewer = new Map();
  if (!activeData) { ensureData(stem); return; }
  const n = poseOf(state)?.n_frames || 0;
  for (const entry of activeData.frames) {
    const f = secToFrame(state, entry.t);
    if (f >= 0 && f < n) byViewer.set(f, entry);
  }
}

function entryAt(f) {
  if (!byViewer) return null;
  if (byViewer.has(f)) return byViewer.get(f);
  for (let d = 1; d <= SNAP_FRAMES; d++) {
    if (byViewer.has(f - d)) return byViewer.get(f - d);
    if (byViewer.has(f + d)) return byViewer.get(f + d);
  }
  return null;
}

function labeledFrames() {
  return byViewer ? [...byViewer.keys()].sort((a, b) => a - b) : [];
}

function median(a) {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

// Which chin lands closer to the human click on this frame. With the gap
// on hold this IS the question the lens exists to answer, and it is a pure
// distance comparison — no direction anywhere in it.
function winnerOf(entry, W) {
  const e = errorsOf(entry, W);
  const p = e.proxy, x = e.ext;
  if (!Number.isFinite(p) && !Number.isFinite(x)) return "none";
  if (!Number.isFinite(x) || gatedOut(entry)) return "proxy-only";
  if (!Number.isFinite(p)) return "ext-only";
  if (Math.abs(x - p) < 1e-6) return "tie";
  return x < p ? "ext" : "proxy";
}

const WIN_COLOR = {
  ext: C.ext, proxy: C.proxy, "ext-only": C.ext, "proxy-only": C.proxy,
  tie: C.tie, none: "#666",
};

// ---------------------------------------------------------------- toggles
const SHOW_KEY = "cornerman.chin_depth.show.v1";
const show = { gt: true, gtSh: true, proxy: true, ext: true, kp: true,
               guides: true };
try {
  Object.assign(show, JSON.parse(localStorage.getItem(SHOW_KEY) || "null") || {});
} catch { /* private mode, or a value another build wrote */ }

function setShow(k, v) {
  show[k] = v;
  try { localStorage.setItem(SHOW_KEY, JSON.stringify(show)); } catch { /* ditto */ }
  refresh();
}

// ---------------------------------------------------------------- sidebar
function summary(state) {
  const W = ctxW(state);
  const out = { n: 0, proxy: [], ext: [], kp: [], span: [],
                noFace: 0, gated: 0, cameraBad: 0,
                extWins: 0, paired: 0 };
  for (const f of labeledFrames()) {
    const entry = byViewer.get(f);
    const e = errorsOf(entry, W);
    out.n++;
    if (entry.camera_bad) out.cameraBad++;
    if (entry.ext == null) out.noFace++;
    else if (gatedOut(entry)) out.gated++;
    if (Number.isFinite(e.proxy)) out.proxy.push(e.proxy);
    if (Number.isFinite(e.ext) && !gatedOut(entry)) out.ext.push(e.ext);
    if (Number.isFinite(e.kp)) out.kp.push(e.kp);
    if (Number.isFinite(e.span)) out.span.push(e.span);
    // head to head on the frames where BOTH answered — the honest count,
    // since the extractor declines on some frames and the formula never does
    if (Number.isFinite(e.proxy) && Number.isFinite(e.ext) && !gatedOut(entry)) {
      out.paired++;
      if (e.ext < e.proxy) out.extWins++;
    }
  }
  return out;
}

function buildSidebar() {
  if (!host) return;
  const st = latestState;
  const sum = activeData && byViewer ? summary(st) : null;
  const gate = scoreGate();
  const toggles = [
    ["gt", "chin (clicked)", C.gt], ["gtSh", "shoulder (clicked)", C.gtSh],
    ["kp", "shoulder keypoint", C.kp], ["proxy", "formula chin", C.proxy],
    ["ext", "extractor chin", C.ext], ["guides", "x guides", C.text],
  ];

  host.innerHTML = `
    <h2>Chin depth</h2>
    <p class="hint">
      How close each chin estimate lands to
      <span style="color:${C.gt}">◯ the human click</span>, measured left-right.
      Every number here is <strong>|dx|, a distance</strong> — no direction.
      The <span style="color:${C.gtSh}">◯ clicked shoulder front</span> and the
      <span style="color:${C.kp}">■ keypoint</span> are drawn as context, but no
      gap is computed: the gap only means something once you know which way the
      boxer faces, and that estimate is on hold pending a model. Units are torso.
    </p>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 0" id="cd-show">
      ${toggles.map(([k, label, col]) => `
        <label class="small" style="display:flex;align-items:center;gap:4px;cursor:pointer">
          <input type="checkbox" data-show="${k}" ${show[k] ? "checked" : ""}>
          <span style="color:${col}">${label}</span>
        </label>`).join("")}
    </div>
    ${indexError ? `<p class="hint" style="color:#ff5d6c">index.json failed: ${indexError}</p>` : ""}
    ${dataError[activeStem] ? `<p class="hint" style="color:#ff5d6c">no data for this video: ${dataError[activeStem]}</p>` : ""}

    <div style="display:flex;gap:6px;margin:6px 0;flex-wrap:wrap">
      <button id="cd-prev" class="btn small">◀ prev</button>
      <button id="cd-next" class="btn small">next ▶</button>
      <button id="cd-worst" class="btn small"
        title="the frames where the extractor chin is furthest from the click">
        next worst ▶</button>
    </div>

    <div id="cd-frame" class="small" style="margin:8px 0"></div>

    ${sum ? `
    <h3 style="margin-top:10px">This video</h3>
    <table class="small" style="width:100%;border-collapse:collapse">
      <tr><th style="text-align:left">what</th><th style="text-align:right">n</th>
          <th style="text-align:right">median</th></tr>
      <tr><td style="color:${C.proxy}">|dx| formula chin</td>
          <td style="text-align:right">${sum.proxy.length}</td>
          <td style="text-align:right">${fmt(median(sum.proxy), 3)}</td></tr>
      <tr><td style="color:${C.ext}">|dx| extractor chin</td>
          <td style="text-align:right">${sum.ext.length}</td>
          <td style="text-align:right">${fmt(median(sum.ext), 3)}</td></tr>
      <tr><td style="color:${C.kp}">|dx| keypoint vs clicked front</td>
          <td style="text-align:right">${sum.kp.length}</td>
          <td style="text-align:right">${fmt(median(sum.kp), 3)}</td></tr>
      <tr><td class="muted">chin↔shoulder span (unsigned)</td>
          <td style="text-align:right">${sum.span.length}</td>
          <td style="text-align:right">${fmt(median(sum.span), 3)}</td></tr>
    </table>
    <p class="hint">${sum.n} labeled frames ·
      extractor closer on ${sum.paired ? `${(100 * sum.extWins / sum.paired).toFixed(0)}% of ${sum.paired}` : "—"}
      frames where both answered ·
      ${sum.noFace} no face · ${sum.gated} below the ${gate} gate ·
      ${sum.cameraBad} camera_bad</p>` : ""}

    <h3 style="margin-top:10px">Labeled frames</h3>
    <div id="cd-list" style="max-height:260px;overflow:auto"></div>
    ${activeData ? `<p class="hint" style="margin-top:8px">
      labels ${activeData.labels_snapshot} · variant ${activeData.variant} ·
      ruler ${activeData.ruler}</p>` : ""}
  `;

  host.querySelector("#cd-prev")?.addEventListener("click", () => step(-1));
  host.querySelector("#cd-next")?.addEventListener("click", () => step(+1));
  host.querySelector("#cd-worst")?.addEventListener("click", () => stepWorst());
  host.querySelectorAll("#cd-show input[data-show]").forEach(cb => {
    cb.addEventListener("change", () => setShow(cb.dataset.show, cb.checked));
  });
  buildList();
}

function step(dir) {
  const frames = labeledFrames();
  if (!frames.length || !latestState) return;
  const cur = latestState.frame;
  const next = dir > 0 ? frames.find(f => f > cur)
                       : [...frames].reverse().find(f => f < cur);
  seekFrame(next != null ? next : (dir > 0 ? frames[0] : frames[frames.length - 1]));
}

// The worst decile by extractor error. With the gap on hold these are the
// frames worth looking at: where the face pipeline puts the chin somewhere
// a human would not, which is the only way to learn WHY it misses.
function stepWorst() {
  if (!latestState) return;
  const W = ctxW(latestState);
  const scored = labeledFrames()
    .map(f => ({ f, e: errorsOf(byViewer.get(f), W).ext }))
    .filter(r => Number.isFinite(r.e))
    .sort((a, b) => b.e - a.e);
  if (!scored.length) return;
  const worst = scored.slice(0, Math.max(1, Math.ceil(scored.length / 10)))
    .map(r => r.f).sort((a, b) => a - b);
  const cur = latestState.frame;
  seekFrame(worst.find(f => f > cur) ?? worst[0]);
}

function buildList() {
  const box = host?.querySelector("#cd-list");
  if (!box) return;
  const frames = labeledFrames();
  if (!frames.length) {
    box.innerHTML = `<p class="hint">no labeled frames in this round</p>`;
    return;
  }
  const W = ctxW(latestState);
  box.innerHTML = frames.map(f => {
    const entry = byViewer.get(f);
    const e = errorsOf(entry, W);
    const win = winnerOf(entry, W);
    const cur = latestState && latestState.frame === f;
    return `<div class="cd-row small" data-f="${f}" style="
        display:flex;justify-content:space-between;gap:8px;padding:2px 4px;
        cursor:pointer;border-left:3px solid ${WIN_COLOR[win]};
        background:${cur ? "rgba(58,217,224,0.12)" : "transparent"}">
      <span>f${f}${entry.camera_bad ? " ⚑" : ""}</span>
      <span style="color:${C.proxy}" title="|dx| formula chin vs the click">${fmt(e.proxy, 3)}</span>
      <span style="color:${C.ext}" title="|dx| extractor chin vs the click">${
        entry.ext == null ? "—" : fmt(e.ext, 3)}</span>
    </div>`;
  }).join("");
  box.querySelectorAll(".cd-row").forEach(el =>
    el.addEventListener("click", () => seekFrame(Number(el.dataset.f))));
}

function updateFrameBox(state) {
  const box = host?.querySelector("#cd-frame");
  if (!box) return;
  const entry = entryAt(state.frame);
  if (!entry) {
    box.innerHTML = `<span class="muted">no labeled frame here — jump with the list or ◀ ▶</span>`;
    return;
  }
  const W = ctxW(state);
  const e = errorsOf(entry, W);
  const gate = scoreGate();
  const gated = gatedOut(entry);
  const [scoreText, verdict, scoreColor] =
    entry.score == null
      ? ["no face", "nothing detected — formula only", C.gated]
      : gated
        ? [entry.score.toFixed(2), `below gate ${gate.toFixed(2)} — dropped`, C.gated]
        : [entry.score.toFixed(2), `at or above gate ${gate.toFixed(2)} — used`, C.ext];
  const better = Number.isFinite(e.ext) && Number.isFinite(e.proxy) && !gated
    ? (e.ext < e.proxy ? "extractor" : "formula") : null;

  box.innerHTML = `
    <table class="small" style="width:100%;border-collapse:collapse">
      <tr><th style="text-align:left">distance to the click (torso)</th>
          <th style="text-align:right">|dx|</th></tr>
      <tr><td style="color:${C.proxy}">formula chin</td>
          <td style="text-align:right">${fmt(e.proxy, 3)}</td></tr>
      <tr><td style="color:${C.ext}">extractor chin</td>
          <td style="text-align:right">${fmt(e.ext, 3)}</td></tr>
    </table>
    ${better ? `<p class="hint" style="margin:4px 0 0">
      closer here: <strong style="color:${better === "extractor" ? C.ext : C.proxy}">
      the ${better}</strong></p>` : ""}
    <table class="small" style="width:100%;border-collapse:collapse;margin-top:6px">
      <tr><th style="text-align:left">context (not the rule's number)</th>
          <th style="text-align:right">|dx|</th></tr>
      <tr><td style="color:${C.kp}">keypoint vs clicked shoulder front</td>
          <td style="text-align:right">${fmt(e.kp, 3)}</td></tr>
      <tr><td class="muted">chin ↔ shoulder span</td>
          <td style="text-align:right">${fmt(e.span, 3)}</td></tr>
    </table>
    <p class="hint" style="margin:6px 0 0">
      The span is a magnitude only. Whether the chin sits AHEAD of the
      shoulder (the fault) or behind it (the tuck) needs the facing
      direction, which is on hold — so this lens does not claim it.</p>
    ${entry.camera_bad ? `<p class="hint" style="color:${C.gated};margin:6px 0 0">
      ⚑ a labeler flagged this frame as not usable side-on footage. The
      comparison drops these; this lens keeps them.</p>` : ""}
    <div style="display:flex;align-items:baseline;gap:8px;margin-top:6px">
      <span class="small">face score</span>
      <strong style="color:${scoreColor};font-size:1.15em">${scoreText}</strong>
      <span class="muted small">${verdict}</span>
    </div>
    <span class="muted">t ${entry.t}s · r${entry.round} f${entry.frame} ·
      ${entry.clicks.length} chin / ${entry.sh_clicks?.length ?? 0} shoulder click(s)</span>`;
}

// ---------------------------------------------------------------- lifecycle
function mount(_host, state) {
  host = _host;
  latestState = state;
  mapsKey = "";
  ensureIndex();
  if (state) rebuildMaps(state);
  buildSidebar();
  mountStageTimeline();
}

function update(state) {
  latestState = state;
  rebuildMaps(state);
  updateFrameBox(state);
  buildList();
  drawTimeline(state);
}

// ---------------------------------------------------------------- canvas
// The marks, drawn through whatever mapping `P` gives — once on the frame,
// once more inside the zoom inset.
function drawMarks(ctx, entry, P, s, zoomed) {
  const R = 1.5, RING = 3.0, GTDOT = 0.7;

  const tick = (x, y, color, w) => {
    if (!zoomed) return;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(x + dx * 3.6 * s, y + dy * 3.6 * s);
      ctx.lineTo(x + dx * 8.0 * s, y + dy * 8.0 * s);
    }
    ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = (w + 1.0) * s; ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = w * s; ctx.stroke();
  };

  const dot = (x, y, color) => {
    ctx.beginPath(); ctx.arc(x, y, R * s, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 0.5 * s; ctx.stroke();
    tick(x, y, color, 1.1);
  };

  // The keypoint is a SQUARE, not a dot: it is a different kind of thing
  // from an estimate of a clicked point — a joint centre standing in for a
  // surface — and at 3px across a shape reads faster than a hue.
  const square = (x, y, color) => {
    const r = R * s * 1.15;
    ctx.beginPath(); ctx.rect(x - r, y - r, 2 * r, 2 * r);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 0.5 * s; ctx.stroke();
    tick(x, y, color, 1.1);
  };

  const ring = (x, y, color) => {
    ctx.beginPath(); ctx.arc(x, y, RING * s, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 2.0 * s; ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 1.3 * s; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, GTDOT * s, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = 0.8 * s; ctx.stroke();
    ctx.fillStyle = color; ctx.fill();
    tick(x, y, color, 1.4);
  };

  if (show.proxy && entry.proxy) { const p = P(entry.proxy); dot(p[0], p[1], C.proxy); }
  if (show.ext && entry.ext) {
    const p = P(entry.ext);
    dot(p[0], p[1], gatedOut(entry) ? C.gated : C.ext);
  }
  if (show.kp && entry.kp) { const p = P(entry.kp); square(p[0], p[1], C.kp); }
  if (show.gtSh && entry.gt_sh) { const p = P(entry.gt_sh); ring(p[0], p[1], C.gtSh); }
  if (show.gt) { const p = P(entry.gt); ring(p[0], p[1], C.gt); }
}

// The x guides — the part that makes this a DEPTH lens rather than a second
// chin lens. A vertical line at each x position, because on this axis the y
// positions are context and the x positions are the measurement.
//
// The signed gap bar this used to draw is gone with the facing estimate: an
// arrow pointing "ahead" is a claim about direction, and drawing one from an
// estimate we do not trust would be the most confident-looking thing here.
function drawAxis(ctx, entry, W, H, view, s) {
  const yA = entry.gt[1] * H, yB = (entry.gt_sh ? entry.gt_sh[1] : entry.gt[1]) * H;
  const top = Math.min(yA, yB), bot = Math.max(yA, yB);
  const pad = Math.max(12 * s, (bot - top) * 0.25);

  if (show.guides) {
    const guide = (x, color, dash) => {
      if (!Number.isFinite(x)) return;
      ctx.setLineDash(dash ? [3 * s, 3 * s] : []);
      ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 2.0 * s;
      ctx.beginPath(); ctx.moveTo(x, top - pad); ctx.lineTo(x, bot + pad); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 0.9 * s;
      ctx.beginPath(); ctx.moveTo(x, top - pad); ctx.lineTo(x, bot + pad); ctx.stroke();
      ctx.setLineDash([]);
    };
    if (show.gt) guide(entry.gt[0] * W, C.gt, false);
    if (show.gtSh && entry.gt_sh) guide(entry.gt_sh[0] * W, C.gtSh, false);
    if (show.kp && entry.kp) guide(entry.kp[0] * W, C.kp, true);
    if (show.proxy && entry.proxy) guide(entry.proxy[0] * W, C.proxy, true);
    if (show.ext && entry.ext) guide(entry.ext[0] * W, C.ext, true);
  }

}

function draw(ctx, state) {
  const entry = entryAt(state.frame);
  if (!entry) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const view = state.view || { zoom: 1, x0: 0, y0: 0, x1: W, y1: H };
  // `s` divides out the ctrl+scroll zoom, so magnifying pulls the marks
  // apart instead of inflating them together. Same reasoning as
  // chin_sources — see its draw() for the long version.
  const s = Math.max((state.renderScale || 1) / (view.zoom || 1), 0.4);
  const P = p => [p[0] * W, p[1] * H];
  const chrome = (view.zoom || 1) <= 2.5;
  const e = errorsOf(entry, ctxW(state));

  ctx.save();

  // ZOOM INSET — copied BEFORE the marks go down, so it shows footage.
  // Centred on the midpoint of the two clicked points rather than on the
  // chin: on this axis the pair is the subject, and a crop centred on the
  // chin can push the shoulder out of frame entirely.
  const a = P(entry.gt), b = entry.gt_sh ? P(entry.gt_sh) : a;
  const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
  const reach = [entry.proxy, entry.ext, entry.kp, entry.gt_sh]
    .reduce((m, pt) => {
      if (!pt) return m;
      const q = P(pt);
      return Math.max(m, Math.hypot(q[0] - cx, q[1] - cy));
    }, 0);
  const src = Math.max(48, Math.min(W, H, reach * 2.8));
  const visW = Math.max(1, view.x1 - view.x0), visH = Math.max(1, view.y1 - view.y0);
  const box = Math.min(visW, visH) * 0.32;
  const zoom = box / src;
  const sx = Math.max(0, Math.min(W - src, cx - src / 2));
  const sy = Math.max(0, Math.min(H - src, cy - src / 2));
  const ix = view.x1 - box - 10 * s, iy = view.y0 + 10 * s;
  if (chrome && Number.isFinite(sx) && Number.isFinite(sy) && box > 24 * s) {
    ctx.drawImage(ctx.canvas, sx, sy, src, src, ix, iy, box, box);
    ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1.5 * s;
    ctx.strokeRect(ix, iy, box, box);
    ctx.setLineDash([4 * s, 4 * s]);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.strokeRect(sx, sy, src, src);
    ctx.setLineDash([]);
    ctx.fillStyle = C.text;
    ctx.font = `${Math.round(11 * s)}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    ctx.fillText(`${zoom.toFixed(1)}x`, ix + 4 * s, iy + box + 2 * s);
    ctx.save();
    ctx.beginPath(); ctx.rect(ix, iy, box, box); ctx.clip();
    drawMarks(ctx, entry, p => [ix + (p[0] * W - sx) * zoom,
                                iy + (p[1] * H - sy) * zoom], s, false);
    ctx.restore();
  }

  drawAxis(ctx, entry, W, H, view, s);
  drawMarks(ctx, entry, P, s, (view.zoom || 1) > 1.5);

  if (!chrome) { ctx.restore(); return; }
  const fsz = Math.round(13 * s), lineH = fsz + 4 * s;
  const lines = [
    show.gt ? ["○ chin (clicked)", C.gt, ""] : null,
    show.gtSh && entry.gt_sh ? ["○ shoulder (clicked)", C.gtSh, ""] : null,
    show.kp && entry.kp ? ["■ shoulder keypoint", C.kp, fmt(e.kp, 3)] : null,
    show.proxy ? ["● formula chin", C.proxy, fmt(e.proxy, 3)] : null,
    !show.ext ? null
      : [entry.ext ? "● extractor chin" : "○ extractor chin",
         entry.ext ? (gatedOut(entry) ? C.gated : C.ext) : C.gated,
         entry.ext ? fmt(e.ext, 3) : "no face"],
    ["|dx| to the click, torso", C.text, ""],
  ].filter(Boolean);
  const padX = 10 * s, padY = 8 * s, boxW = 235 * s;
  const boxH = lines.length * lineH + padY * 2 - 4 * s;
  const bx = view.x0 + 10 * s, by = view.y0 + 10 * s;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 6 * s); ctx.fill();
  ctx.font = `${fsz}px ui-monospace, monospace`;
  ctx.textBaseline = "top";
  lines.forEach(([label, cc, value], i) => {
    const y = by + padY + i * lineH;
    ctx.fillStyle = cc;
    ctx.fillText(label, bx + padX, y);
    if (value) {
      ctx.textAlign = "right";
      ctx.fillText(value, bx + boxW - padX, y);
      ctx.textAlign = "left";
    }
  });
  ctx.restore();
}

// ---------------------------------------------------------------- timeline
function mountStageTimeline() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:12px;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px";
  const label = document.createElement("div");
  label.className = "muted small";
  label.style.cssText = "margin-bottom:6px";
  label.textContent = "Labeled frames (click to seek) — colored by which chin lands closer to the human click";
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = "cd-timeline";
  canvas.style.cssText = "display:block;width:100%;height:34px";
  canvas.width = 800; canvas.height = 34;
  wrap.appendChild(canvas);
  slot.appendChild(wrap);
  canvas.addEventListener("click", ev => {
    const n = poseOf(latestState)?.n_frames;
    if (!n) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = (ev.clientX - rect.left) / Math.max(1, rect.width);
    const target = Math.round(ratio * (n - 1));
    const frames = labeledFrames();
    if (!frames.length) return seekFrame(target);
    seekFrame(frames.reduce((a, b) =>
      Math.abs(b - target) < Math.abs(a - target) ? b : a));
  });
}

function drawTimeline(state) {
  const cv = document.getElementById("cd-timeline");
  if (!cv) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.max(1, cv.getBoundingClientRect().width);
  const cssH = Math.max(1, cv.getBoundingClientRect().height);
  if (cv.width !== Math.round(cssW * dpr)) cv.width = Math.round(cssW * dpr);
  if (cv.height !== Math.round(cssH * dpr)) cv.height = Math.round(cssH * dpr);
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, cssW, cssH);
  const n = poseOf(state)?.n_frames;
  if (!n) return;
  const x = f => (f / Math.max(1, n - 1)) * cssW;
  const W = ctxW(state);
  for (const f of labeledFrames()) {
    const entry = byViewer.get(f);
    ctx.fillStyle = WIN_COLOR[winnerOf(entry, W)] || C.mark;
    ctx.fillRect(x(f) - 1.5, 6, 3, cssH - 14);
    // camera_bad frames get a cap, so "a human said this footage is wrong"
    // is visible without hunting the list for the flag.
    if (entry.camera_bad) {
      ctx.fillStyle = C.gated;
      ctx.fillRect(x(f) - 2.5, 2, 5, 4);
    }
  }
  ctx.strokeStyle = C.playhead;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x(state.frame), 0); ctx.lineTo(x(state.frame), cssH); ctx.stroke();
}

export const ChinDepthRule = {
  id: "chin_depth",
  label: "Chin depth (chin accuracy on x)",
  requiresVideo,
  mount,
  update,
  draw,
};
