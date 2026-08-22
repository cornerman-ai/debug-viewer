// Chin depth — the x axis: the chin against the front of the lead shoulder.
//
// The sibling lens `chin_sources` is the HEIGHT axis and draws three
// estimates of one point. This one is a different measurement, not a
// different colour scheme:
//
//   height rule   chin tip  vs  the TOP of the lead shoulder    -> dy
//   depth rule    chin tip  vs  the lead shoulder's FRONT       -> dx
//
// So depth has TWO clicked points, not one, and everything about it is
// signed by which way the boxer is working. What gets drawn:
//
//   ◯ red ring      the labelers' median chin click
//   ◯ amber ring    the labelers' median SHOULDER-FRONT click
//   ● purple        the skeleton formula's chin
//   ● cyan          the face pipeline's chin (orange below the score gate)
//   ■ lime          the BlazePose lead-shoulder KEYPOINT — the stand-in the
//                   rule actually uses for that amber ring
//   ↔ the gap       a bar between the two x positions, which IS the number
//                   the rule reads
//
// Why the keypoint gets equal billing with the chins: the backend's
// chin_depth_compare.py measured that the gap error is dominated by the
// SHOULDER end, not the chin (see FACE_PIPELINE.md, "The other axis: chin
// depth"). The keypoint sits a median 0.058 torso BEHIND the clicked
// surface, and on 31% of frames it reads in FRONT of it — which a joint
// centre inside the deltoid should not be able to do. Those frames are
// flagged SUSPECT here and are reachable with their own step button: they
// are either a mislabeled stance, an ambiguous "front", or a bad keypoint,
// and the only way to tell is to look.
//
// Everything is signed by `facing`, so + always means AHEAD of the shoulder
// (toward the opponent) whichever way the boxer works. A frame whose facing
// would not resolve — the stance is square to the camera, so the projected
// depth axis is noise — carries no gap at all rather than a guessed one,
// and is drawn greyed.
//
// Units: TORSO (shoulder-mid to hip-mid), which is what the backend
// defaults to on this axis. Shoulder width is the projection of the very
// line depth is measured along, so it collapses side-on and every number
// divided by it inflates.
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
  suspect:  "#ff5d6c",   // keypoint reads in front of the clicked surface
  unsigned: "#777",      // facing unresolved — no honest gap
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

// Signed x distance in TORSO units, + = ahead along the facing axis. The
// generator precomputes the three gaps; this is for everything else (chin
// errors, the keypoint's offset from the clicked front).
function depth(entry, a, b, W) {
  if (!entry?.facing || !a || !b || !entry.torso_px) return NaN;
  return entry.facing * (a[0] - b[0]) * W / entry.torso_px;
}

// The keypoint reading in FRONT of the clicked shoulder surface. A joint
// centre inside the deltoid cannot really be outside the body, so this is
// the frame telling you something is wrong — with the stance label, the
// click, or the keypoint. 31% of the corpus, and the reason this lens has a
// step button for them.
function isSuspect(entry, W) {
  const d = depth(entry, entry.kp, entry.gt_sh, W);
  return Number.isFinite(d) && d > 0;
}

function errorsOf(entry, W) {
  if (!entry) return null;
  return {
    // each chin estimate against the clicked chin, on the depth axis
    proxy: depth(entry, entry.proxy, entry.gt, W),
    ext: depth(entry, entry.ext, entry.gt, W),
    // the shoulder end: keypoint against the clicked front
    kp: depth(entry, entry.kp, entry.gt_sh, W),
    gap: entry.gap || {},
    // what each source's gap gets wrong — the number a rule would act on
    gapErrProxy: Number.isFinite(entry.gap?.proxy) && Number.isFinite(entry.gap?.gt)
      ? entry.gap.proxy - entry.gap.gt : NaN,
    gapErrExt: Number.isFinite(entry.gap?.ext) && Number.isFinite(entry.gap?.gt)
      ? entry.gap.ext - entry.gap.gt : NaN,
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

// Which chin source gets the GAP closer on this frame — the per-frame
// verdict for THIS axis. Deliberately not "which chin is closer": the
// backend measured that the better chin can give the worse gap, because the
// gap error is the chin error minus the shoulder error and a chin built off
// the same skeleton as the keypoint cancels part of it.
function winnerOf(entry, W) {
  const e = errorsOf(entry, W);
  if (!entry.facing) return "unsigned";
  if (isSuspect(entry, W)) return "suspect";
  const p = Math.abs(e.gapErrProxy), x = Math.abs(e.gapErrExt);
  if (!Number.isFinite(p) && !Number.isFinite(x)) return "none";
  if (!Number.isFinite(x) || gatedOut(entry)) return "proxy-only";
  if (!Number.isFinite(p)) return "ext-only";
  return x <= p ? "ext" : "proxy";
}

const WIN_COLOR = {
  ext: C.ext, proxy: C.proxy, "ext-only": C.ext, "proxy-only": C.proxy,
  suspect: C.suspect, unsigned: C.unsigned, none: "#666",
};

// ---------------------------------------------------------------- toggles
const SHOW_KEY = "cornerman.chin_depth.show.v1";
const show = { gt: true, gtSh: true, proxy: true, ext: true, kp: true,
               guides: true, gap: true };
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
  const out = { n: 0, gapProxy: [], gapExt: [], kp: [], gt: [],
                suspect: 0, unsigned: 0, noFace: 0, gated: 0, cameraBad: 0,
                sideProxy: 0, sideExt: 0, sidePaired: 0 };
  for (const f of labeledFrames()) {
    const entry = byViewer.get(f);
    const e = errorsOf(entry, W);
    out.n++;
    if (!entry.facing) out.unsigned++;
    else if (isSuspect(entry, W)) out.suspect++;
    if (entry.camera_bad) out.cameraBad++;
    if (entry.ext == null) out.noFace++;
    else if (gatedOut(entry)) out.gated++;
    if (Number.isFinite(e.gapErrProxy)) out.gapProxy.push(Math.abs(e.gapErrProxy));
    if (Number.isFinite(e.gapErrExt) && !gatedOut(entry)) out.gapExt.push(Math.abs(e.gapErrExt));
    if (Number.isFinite(e.kp)) out.kp.push(e.kp);
    if (Number.isFinite(entry.gap?.gt)) out.gt.push(entry.gap.gt);
    // does the estimate agree which SIDE of the shoulder the chin is on —
    // the coarsest thing a rule could act on
    if (Number.isFinite(entry.gap?.gt)) {
      if (Number.isFinite(entry.gap?.proxy)) {
        out.sidePaired++;
        if ((entry.gap.gt > 0) === (entry.gap.proxy > 0)) out.sideProxy++;
        if (Number.isFinite(entry.gap?.ext) && (entry.gap.gt > 0) === (entry.gap.ext > 0)) out.sideExt++;
      }
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
    ["gap", "gap bar", C.text],
  ];

  host.innerHTML = `
    <h2>Chin depth</h2>
    <p class="hint">
      The x axis: <span style="color:${C.gt}">◯ the clicked chin</span> against
      <span style="color:${C.gtSh}">◯ the clicked shoulder front</span>, and the
      <span style="color:${C.kp}">■ keypoint</span> that stands in for that
      shoulder in the rule. The bar between the two x positions IS the number
      the rule reads; + means the chin is AHEAD of the shoulder, whichever way
      the boxer works. Units are torso.
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
      <button id="cd-suspect" class="btn small"
        title="frames where the keypoint reads in FRONT of the clicked shoulder surface">
        next suspect ▶</button>
    </div>

    <div id="cd-frame" class="small" style="margin:8px 0"></div>

    ${sum ? `
    <h3 style="margin-top:10px">This video</h3>
    <table class="small" style="width:100%;border-collapse:collapse">
      <tr><th style="text-align:left">what</th><th style="text-align:right">n</th>
          <th style="text-align:right">median</th></tr>
      <tr><td>labelers' gap</td><td style="text-align:right">${sum.gt.length}</td>
          <td style="text-align:right">${signed(median(sum.gt), 3)}</td></tr>
      <tr><td style="color:${C.kp}">keypoint − clicked front</td>
          <td style="text-align:right">${sum.kp.length}</td>
          <td style="text-align:right">${signed(median(sum.kp), 3)}</td></tr>
      <tr><td style="color:${C.proxy}">|gap err| formula</td>
          <td style="text-align:right">${sum.gapProxy.length}</td>
          <td style="text-align:right">${fmt(median(sum.gapProxy), 3)}</td></tr>
      <tr><td style="color:${C.ext}">|gap err| extractor</td>
          <td style="text-align:right">${sum.gapExt.length}</td>
          <td style="text-align:right">${fmt(median(sum.gapExt), 3)}</td></tr>
    </table>
    <p class="hint">${sum.n} labeled frames ·
      side agreed on ${sum.sidePaired ? `${(100 * sum.sideProxy / sum.sidePaired).toFixed(0)}%` : "—"}
      (formula) / ${sum.sidePaired ? `${(100 * sum.sideExt / sum.sidePaired).toFixed(0)}%` : "—"} (extractor) ·
      <span style="color:${C.suspect}">${sum.suspect} suspect</span> ·
      <span style="color:${C.unsigned}">${sum.unsigned} unsigned</span> ·
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
  host.querySelector("#cd-suspect")?.addEventListener("click", () => stepSuspect());
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

function stepSuspect() {
  if (!latestState) return;
  const W = ctxW(latestState);
  const frames = labeledFrames().filter(f => isSuspect(byViewer.get(f), W));
  if (!frames.length) return;
  const cur = latestState.frame;
  seekFrame(frames.find(f => f > cur) ?? frames[0]);
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
      <span title="the labelers' gap">${signed(entry.gap?.gt, 2)}</span>
      <span style="color:${C.proxy}" title="formula gap error">${signed(e.gapErrProxy, 2)}</span>
      <span style="color:${C.ext}" title="extractor gap error">${
        entry.ext == null ? "—" : signed(e.gapErrExt, 2)}</span>
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
  const suspect = isSuspect(entry, W);

  box.innerHTML = `
    <table class="small" style="width:100%;border-collapse:collapse">
      <tr><th style="text-align:left">gap (torso)</th><th style="text-align:right">value</th>
          <th style="text-align:right">err vs GT</th></tr>
      <tr><td>labelers (both clicks)</td>
          <td style="text-align:right">${signed(entry.gap?.gt, 3)}</td>
          <td style="text-align:right" class="muted">—</td></tr>
      <tr><td style="color:${C.proxy}">formula vs keypoint</td>
          <td style="text-align:right">${signed(entry.gap?.proxy, 3)}</td>
          <td style="text-align:right">${signed(e.gapErrProxy, 3)}</td></tr>
      <tr><td style="color:${C.ext}">extractor vs keypoint</td>
          <td style="text-align:right">${signed(entry.gap?.ext, 3)}</td>
          <td style="text-align:right">${signed(e.gapErrExt, 3)}</td></tr>
    </table>
    <table class="small" style="width:100%;border-collapse:collapse;margin-top:6px">
      <tr><th style="text-align:left">endpoint error</th><th style="text-align:right">depth</th></tr>
      <tr><td style="color:${C.proxy}">formula chin − clicked chin</td>
          <td style="text-align:right">${signed(e.proxy, 3)}</td></tr>
      <tr><td style="color:${C.ext}">extractor chin − clicked chin</td>
          <td style="text-align:right">${signed(e.ext, 3)}</td></tr>
      <tr><td style="color:${suspect ? C.suspect : C.kp}">keypoint − clicked front</td>
          <td style="text-align:right;color:${suspect ? C.suspect : "inherit"}">
            ${signed(e.kp, 3)}</td></tr>
    </table>
    ${suspect ? `<p class="hint" style="color:${C.suspect};margin:6px 0 0">
      SUSPECT: the keypoint reads in FRONT of the clicked surface. A joint
      centre cannot sit outside the body — mislabeled stance, an ambiguous
      "front", or a bad keypoint.</p>` : ""}
    ${!entry.facing ? `<p class="hint" style="color:${C.unsigned};margin:6px 0 0">
      facing unresolved — the stance is square to the camera, so the depth
      axis is noise here and no gap is drawn.</p>` : ""}
    ${entry.camera_bad ? `<p class="hint" style="color:${C.gated};margin:6px 0 0">
      ⚑ a labeler flagged this frame as not usable side-on footage. The
      comparison drops these; this lens keeps them.</p>` : ""}
    <div style="display:flex;align-items:baseline;gap:8px;margin-top:6px">
      <span class="small">face score</span>
      <strong style="color:${scoreColor};font-size:1.15em">${scoreText}</strong>
      <span class="muted small">${verdict}</span>
    </div>
    <span class="muted">t ${entry.t}s · r${entry.round} f${entry.frame} ·
      lead ${entry.lead || "?"} · facing ${entry.facing ? (entry.facing > 0 ? "→" : "←") : "?"}
      ${entry.facing_src ? `(${entry.facing_src})` : ""} ·
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

// The x guides and the gap bar — the part that makes this a DEPTH lens
// rather than a second chin lens. Vertical lines at each x position, and a
// horizontal double-arrow spanning the two that matter, because on this
// axis the y positions are context and the x positions are the measurement.
function drawAxis(ctx, entry, W, H, view, s) {
  if (!entry.facing) return;
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

  if (!show.gap || !entry.gt_sh || !Number.isFinite(entry.gap?.gt)) return;
  // The bar sits between the two points it measures, so it cannot be
  // mistaken for something about the head or the shoulder alone.
  const y = (top + bot) / 2;
  const x1 = entry.gt_sh[0] * W, x2 = entry.gt[0] * W;
  ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 3.0 * s;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
  ctx.strokeStyle = entry.gap.gt >= 0 ? C.gt : C.kp;
  ctx.lineWidth = 1.4 * s;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
  // arrow head at the chin end — the direction the gap is measured in
  const dir = Math.sign(x2 - x1) || 1;
  ctx.beginPath();
  ctx.moveTo(x2, y);
  ctx.lineTo(x2 - dir * 4 * s, y - 2.6 * s);
  ctx.lineTo(x2 - dir * 4 * s, y + 2.6 * s);
  ctx.closePath();
  ctx.fillStyle = entry.gap.gt >= 0 ? C.gt : C.kp; ctx.fill();

  if ((view.zoom || 1) > 2.5) return;
  ctx.font = `${Math.round(11 * s)}px ui-monospace, monospace`;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "center";
  const label = `${signed(entry.gap.gt, 3)} torso`;
  const mx = (x1 + x2) / 2;
  ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 3 * s;
  ctx.strokeText(label, mx, y - 3 * s);
  ctx.fillStyle = entry.gap.gt >= 0 ? C.gt : C.kp;
  ctx.fillText(label, mx, y - 3 * s);
  ctx.textAlign = "left";
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
    show.kp && entry.kp ? ["■ shoulder keypoint", isSuspect(entry, ctxW(state))
      ? C.suspect : C.kp, signed(e.kp, 3)] : null,
    show.proxy ? ["● formula chin", C.proxy, signed(e.gapErrProxy, 3)] : null,
    !show.ext ? null
      : [entry.ext ? "● extractor chin" : "○ extractor chin",
         entry.ext ? (gatedOut(entry) ? C.gated : C.ext) : C.gated,
         entry.ext ? signed(e.gapErrExt, 3) : "no face"],
    ["↔ gap (labelers)", entry.facing ? C.text : C.unsigned,
     entry.facing ? signed(entry.gap?.gt, 3) : "unsigned"],
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
  label.textContent = "Labeled frames (click to seek) — colored by which chin gets the GAP closer; red = suspect keypoint, grey = facing unresolved";
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
  label: "Chin depth (chin · shoulder front · gap)",
  requiresVideo,
  mount,
  update,
  draw,
};
