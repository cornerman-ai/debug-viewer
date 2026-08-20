// Chin sources — the labelers' click vs the skeleton formula vs the face
// pipeline, on the same frame.
//
// Three estimates of the same point exist, and the backend's
// chin_height_compare.py says which is closer and by how much (face
// pipeline ~2x, see ml/research/chin_tuck/FACE_PIPELINE.md). This lens is
// the other half of that: it draws all three on the footage so you can see
// WHY each one lands where it does.
//
//   labelers   every click, one color per labeler, plus their median as a
//              white ring — the ring is the ground truth the numbers use,
//              and the spread between the crosses is the noise floor.
//   formula    chin = nose + 2.25 * (mouth_mid - nose), drawn WITH its
//              construction (nose -> mouth -> extrapolated chin), because
//              its failure is directional: watch the ray swing off the jaw
//              as the head turns.
//   extractor  SCRFD-10G + 2d106, the lowest of the 106 landmarks. Solid
//              when the SCRFD score clears the gate, dashed below it.
//
// Data: ./lens_data/chin_sources/<stem>.json + index.json, built by the
// backend's chin_lens_data.py from a labels snapshot, the variant manifest
// and the extractor sidecar. Only frames a human actually labeled have
// data, so the lens is a frame-by-frame inspector, not a per-frame overlay:
// the sidebar lists every labeled frame and the timeline lane marks them.
//
// Alignment is BY TIME, exactly as in face_mesh_chin: each entry's `t` is
// SOURCE-VIDEO seconds off the cache _pts clock, mapped to a viewer frame
// via round(t*fps) - floor(start_sec*fps). ROUND, not floor — cache pts sit
// a hair shy of the next frame boundary, and flooring draws the marks one
// frame ahead of the pixels.

const DATA_DIR = "./lens_data/chin_sources/";

const C = {
  gt:      "#ffffff",   // the labelers' median — ground truth
  proxy:   "#ff5df1",   // magenta — the skeleton formula
  ext:     "#3ad9e0",   // cyan — the face pipeline
  build:   "rgba(255,255,255,0.45)",
  gated:   "#ff9e64",   // extractor chin below the score gate
  mark:    "#d3b136",   // labeled-frame marks on the timeline
  playhead:"#3ad9e0",
  text:    "#aaa",
};
// Per-labeler click colors, assigned in index roster order.
const LABELER_COLORS = ["#56d364", "#c792ea", "#f97583", "#79c0ff", "#ffab70"];

const cfg = {
  showClicks: true,
  showProxy: true,
  showExt: true,
  showBuild: true,
  snap: true,        // draw the nearest labeled frame within SNAP_FRAMES
};
const SNAP_FRAMES = 2;

let host = null;
let latestState = null;
let index = null, indexError = null, indexPromise = null;
let data = {};          // stem -> parsed per-video JSON
let dataError = {};
let activeStem = null;
let activeData = null;
let byViewer = null;    // Map(viewer frame -> entry), memoized per (stem, clock)
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

function labelerColor(name) {
  const i = index?.labelers ? index.labelers.indexOf(name) : -1;
  return LABELER_COLORS[(i >= 0 ? i : 0) % LABELER_COLORS.length];
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
      mapsKey = "";                       // same reason as ensureData's
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
  const cands = [base, stripStem(base)];
  for (const c of cands) if (index.videos.includes(c)) return c;
  return null;
}

// Only videos with labeled frames are selectable under this lens. An index
// that failed to load returns true rather than hiding every video — a
// missing file should look like a broken lens, not an empty corpus.
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
  // Invalidate the per-round memo: it was built while this fetch was still in
  // flight, so it memoized "no data for this video" and would keep answering
  // that forever.
  mapsKey = "";
  if (host) {
    if (latestState) rebuildMaps(latestState);
    buildSidebar();
    refresh();
  }
}

// ---------------------------------------------------------------- geometry
// Errors in PIXELS and in shoulder-widths, the two units the backend
// reports. sh divides the pixel distance by the inter-shoulder distance in
// pixels — normalized x and y are not the same length on a non-square
// video, so the multiply back to pixels has to happen first.
function errorsOf(entry, W, H) {
  if (!entry) return null;
  const px = (a, b) => [(a[0] - b[0]) * W, (a[1] - b[1]) * H];
  const ruler = Math.hypot((entry.lsh[0] - entry.rsh[0]) * W,
                           (entry.lsh[1] - entry.rsh[1]) * H);
  const one = (p) => {
    if (!p) return null;
    const [dx, dy] = px(p, entry.gt);
    const d = Math.hypot(dx, dy);
    return { dx, dy, d, shx: dx / ruler, shy: dy / ruler, sh: d / ruler };
  };
  const spread = entry.clicks.length > 1
    ? entry.clicks.map(c => Math.hypot(...px([c[1], c[2]], entry.gt)))
    : [];
  return {
    ruler,
    proxy: one(entry.proxy),
    ext: one(entry.ext),
    floor: spread.length ? spread.reduce((a, b) => a + b, 0) / spread.length : null,
  };
}

function gatedOut(entry) {
  const gate = activeData?.score_gate ?? 0.6;
  return entry?.ext != null && entry.score != null && entry.score < gate;
}

// Which source is closer on this frame — the per-frame verdict the timeline
// and the frame list color themselves by.
function winnerOf(entry, W, H) {
  const e = errorsOf(entry, W, H);
  if (!e?.proxy && !e?.ext) return "none";
  if (!e.ext || gatedOut(entry)) return "proxy-only";
  if (!e.proxy) return "ext-only";
  return e.ext.d <= e.proxy.d ? "ext" : "proxy";
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

// The entry drawn at viewer frame f: the exact one, else the nearest within
// SNAP_FRAMES when snapping is on (labeled frames are sparse — 12 per video
// — so landing on one by scrubbing is otherwise luck).
function entryAt(f) {
  if (!byViewer) return null;
  if (byViewer.has(f)) return byViewer.get(f);
  if (!cfg.snap) return null;
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
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

// Per-video rollup, in the same units and with the same both-answered rule
// as chin_height_compare.py: the head-to-head only counts frames where both
// sources produced a chin, so neither wins by declining the hard ones.
function summary(state) {
  const W = ctxW(state), H = ctxH(state);
  const out = { n: 0, proxy: [], ext: [], floor: [], wins: 0, paired: 0,
                noFace: 0, gated: 0 };
  for (const f of labeledFrames()) {
    const entry = byViewer.get(f);
    const e = errorsOf(entry, W, H);
    out.n++;
    if (e.proxy) out.proxy.push(e.proxy.sh);
    if (entry.ext == null) out.noFace++;
    else if (gatedOut(entry)) out.gated++;
    else if (e.ext) out.ext.push(e.ext.sh);
    if (e.floor != null) out.floor.push(e.floor / e.ruler);
    if (e.proxy && e.ext && !gatedOut(entry)) {
      out.paired++;
      if (e.ext.d < e.proxy.d) out.wins++;
    }
  }
  return out;
}

function ctxW(state) { return activeData?.wh?.[0] || poseOf(state)?.width || 1; }
function ctxH(state) { return activeData?.wh?.[1] || poseOf(state)?.height || 1; }

// ---------------------------------------------------------------- sidebar
function buildSidebar() {
  if (!host) return;
  const st = latestState;
  const has = !!activeData;
  const sum = has && byViewer ? summary(st) : null;
  const gate = activeData?.score_gate ?? 0.6;

  host.innerHTML = `
    <h2>Chin sources</h2>
    <p class="hint">
      <span style="color:${C.gt}">◯ labelers' median (GT)</span> ·
      <span style="color:${C.proxy}">● formula</span> nose + ${activeData?.chin_coef ?? 2.25}·(mouth − nose) ·
      <span style="color:${C.ext}">● extractor</span> SCRFD + 2d106.
      Only labeled frames carry data — use the list below, or ◀ ▶.
    </p>
    ${indexError ? `<p class="hint" style="color:#ff5d6c">index.json failed: ${indexError}</p>` : ""}
    ${dataError[activeStem] ? `<p class="hint" style="color:#ff5d6c">no data for this video: ${dataError[activeStem]}</p>` : ""}

    <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px;margin:6px 0">
      <label><input type="checkbox" id="cs-clicks" ${cfg.showClicks ? "checked" : ""}> clicks</label>
      <label><input type="checkbox" id="cs-proxy" ${cfg.showProxy ? "checked" : ""}> formula</label>
      <label><input type="checkbox" id="cs-ext" ${cfg.showExt ? "checked" : ""}> extractor</label>
      <label><input type="checkbox" id="cs-build" ${cfg.showBuild ? "checked" : ""}> construction</label>
      <label><input type="checkbox" id="cs-snap" ${cfg.snap ? "checked" : ""}> snap ±${SNAP_FRAMES}</label>
    </div>

    <div style="display:flex;gap:6px;margin:6px 0">
      <button id="cs-prev" class="btn small">◀ prev labeled</button>
      <button id="cs-next" class="btn small">next labeled ▶</button>
    </div>

    <div id="cs-frame" class="small" style="margin:8px 0"></div>

    ${sum ? `
    <h3 style="margin-top:10px">This video</h3>
    <table class="small" style="width:100%;border-collapse:collapse">
      <tr><th style="text-align:left">source</th><th style="text-align:right">n</th>
          <th style="text-align:right">median euclid (sh)</th></tr>
      <tr><td style="color:${C.proxy}">formula</td><td style="text-align:right">${sum.proxy.length}</td>
          <td style="text-align:right">${fmt(median(sum.proxy), 3)}</td></tr>
      <tr><td style="color:${C.ext}">extractor</td><td style="text-align:right">${sum.ext.length}</td>
          <td style="text-align:right">${fmt(median(sum.ext), 3)}</td></tr>
      <tr><td class="muted">labeler floor</td><td style="text-align:right">${sum.floor.length}</td>
          <td style="text-align:right">${fmt(median(sum.floor), 3)}</td></tr>
    </table>
    <p class="hint">${sum.n} labeled frames · extractor closer on
      ${sum.paired ? `${sum.wins}/${sum.paired} = ${(100 * sum.wins / sum.paired).toFixed(0)}%` : "—"}
      of the frames where both answered · ${sum.noFace} no face ·
      ${sum.gated} below the ${gate} score gate</p>` : ""}

    <h3 style="margin-top:10px">Labeled frames</h3>
    <div id="cs-list" style="max-height:260px;overflow:auto"></div>
    ${activeData ? `<p class="hint" style="margin-top:8px">
      labels ${activeData.labels_snapshot} · variant ${activeData.variant}</p>` : ""}
  `;

  host.querySelector("#cs-clicks")?.addEventListener("change", e => { cfg.showClicks = e.target.checked; refresh(); });
  host.querySelector("#cs-proxy")?.addEventListener("change", e => { cfg.showProxy = e.target.checked; refresh(); });
  host.querySelector("#cs-ext")?.addEventListener("change", e => { cfg.showExt = e.target.checked; refresh(); });
  host.querySelector("#cs-build")?.addEventListener("change", e => { cfg.showBuild = e.target.checked; refresh(); });
  host.querySelector("#cs-snap")?.addEventListener("change", e => { cfg.snap = e.target.checked; refresh(); });
  host.querySelector("#cs-prev")?.addEventListener("click", () => step(-1));
  host.querySelector("#cs-next")?.addEventListener("click", () => step(+1));
  buildList();
}

function step(dir) {
  const frames = labeledFrames();
  if (!frames.length || !latestState) return;
  const cur = latestState.frame;
  const next = dir > 0 ? frames.find(f => f > cur)
                       : [...frames].reverse().find(f => f < cur);
  if (next != null) seekFrame(next);
  else seekFrame(dir > 0 ? frames[0] : frames[frames.length - 1]);
}

const WIN_COLOR = { ext: C.ext, proxy: C.proxy, "ext-only": C.ext,
                    "proxy-only": C.proxy, none: "#666" };

function buildList() {
  const box = host?.querySelector("#cs-list");
  if (!box) return;
  const frames = labeledFrames();
  if (!frames.length) {
    box.innerHTML = `<p class="hint">no labeled frames in this round</p>`;
    return;
  }
  const W = ctxW(latestState), H = ctxH(latestState);
  box.innerHTML = frames.map(f => {
    const entry = byViewer.get(f);
    const e = errorsOf(entry, W, H);
    const win = winnerOf(entry, W, H);
    const cur = latestState && latestState.frame === f;
    return `<div class="cs-row small" data-f="${f}" style="
        display:flex;justify-content:space-between;gap:8px;padding:2px 4px;
        cursor:pointer;border-left:3px solid ${WIN_COLOR[win]};
        background:${cur ? "rgba(58,217,224,0.12)" : "transparent"}">
      <span>f${f}</span>
      <span style="color:${C.proxy}">${fmt(e.proxy?.sh, 2)}</span>
      <span style="color:${C.ext}">${entry.ext == null ? "no face" : fmt(e.ext?.sh, 2)}</span>
    </div>`;
  }).join("");
  box.querySelectorAll(".cs-row").forEach(el =>
    el.addEventListener("click", () => seekFrame(Number(el.dataset.f))));
}

function updateFrameBox(state) {
  const box = host?.querySelector("#cs-frame");
  if (!box) return;
  const entry = entryAt(state.frame);
  if (!entry) {
    box.innerHTML = `<span class="muted">no labeled frame here — jump with the list or ◀ ▶</span>`;
    return;
  }
  const e = errorsOf(entry, ctxW(state), ctxH(state));
  const row = (name, color, v) => v ? `
    <tr><td style="color:${color}">${name}</td>
        <td style="text-align:right">${fmt(v.sh, 3)}</td>
        <td style="text-align:right">${fmt(v.shy, 3)}</td>
        <td style="text-align:right">${fmt(v.shx, 3)}</td>
        <td style="text-align:right" class="muted">${fmt(v.d, 1)}px</td></tr>` : `
    <tr><td style="color:${color}">${name}</td><td colspan="4" class="muted">—</td></tr>`;
  box.innerHTML = `
    <table class="small" style="width:100%;border-collapse:collapse">
      <tr><th style="text-align:left">vs GT</th><th style="text-align:right">euclid</th>
          <th style="text-align:right">height</th><th style="text-align:right">x</th>
          <th></th></tr>
      ${row("formula", C.proxy, e.proxy)}
      ${row("extractor", C.ext, e.ext)}
    </table>
    <span class="muted">t ${entry.t}s · r${entry.round} f${entry.frame} ·
      ${entry.clicks.length} click(s) · score
      ${entry.score == null ? "no face" : entry.score.toFixed(2)}
      ${gatedOut(entry) ? "(below gate)" : ""} ·
      lead ${entry.lead || "?"}</span>`;
}

// ---------------------------------------------------------------- lifecycle
function mount(_host, state) {
  host = _host;
  latestState = state;
  mapsKey = "";
  ensureIndex();
  if (state) { rebuildMaps(state); }
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
// The marks themselves, drawn through whatever mapping `P` gives — once on
// the frame, once more inside the zoom inset. Boxers are often far from the
// camera and the three estimates then land within a few pixels of each
// other, which is exactly when you most need to see which is which.
function drawMarks(ctx, entry, P, s) {
  const dot = (x, y, r, color, dashed) => {
    ctx.beginPath();
    ctx.arc(x, y, r * s, 0, Math.PI * 2);
    if (dashed) {
      ctx.strokeStyle = color; ctx.lineWidth = 2 * s;
      ctx.setLineDash([3 * s, 3 * s]); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.fillStyle = color; ctx.fill();
    }
  };
  const line = (a, b, color, width, dash) => {
    ctx.strokeStyle = color; ctx.lineWidth = width * s;
    ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.setLineDash([]);
  };
  const gt = P(entry.gt);

  // The formula's construction: nose -> mouth -> extrapolated chin. Drawn
  // first so the estimates sit on top of it.
  if (cfg.showBuild && cfg.showProxy) {
    const nose = P(entry.nose), mouth = P(entry.mouth), chin = P(entry.proxy);
    line(nose, chin, C.build, 1.5, [5 * s, 4 * s]);
    dot(nose[0], nose[1], 3, "#ffffff");
    dot(mouth[0], mouth[1], 2.5, "#ffd95c");
  }

  // Error lines to ground truth — the thing being measured.
  if (cfg.showProxy && entry.proxy) line(P(entry.proxy), gt, C.proxy, 1.5);
  if (cfg.showExt && entry.ext) line(P(entry.ext), gt, C.ext, 1.5);

  // Individual clicks, then their median: the spread between the crosses is
  // the noise floor no estimator can beat.
  if (cfg.showClicks) {
    for (const [who, x, y, vis] of entry.clicks) {
      const [cx, cy] = P([x, y]);
      const r = 5 * s;
      ctx.strokeStyle = labelerColor(who);
      ctx.lineWidth = (vis === "visible" ? 2 : 1.2) * s;
      ctx.setLineDash(vis === "visible" ? [] : [2 * s, 2 * s]);
      ctx.beginPath();
      ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
      ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.strokeStyle = C.gt; ctx.lineWidth = 2.5 * s;
  ctx.beginPath(); ctx.arc(gt[0], gt[1], 7 * s, 0, Math.PI * 2); ctx.stroke();

  if (cfg.showProxy && entry.proxy) {
    const p = P(entry.proxy); dot(p[0], p[1], 5, C.proxy);
  }
  if (cfg.showExt && entry.ext) {
    const p = P(entry.ext);
    dot(p[0], p[1], 5, gatedOut(entry) ? C.gated : C.ext, gatedOut(entry));
  }
}

function draw(ctx, state) {
  const entry = entryAt(state.frame);
  if (!entry) return;
  const s = state.renderScale || 1;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const P = p => [p[0] * W, p[1] * H];
  const e = errorsOf(entry, ctxW(state), ctxH(state));

  ctx.save();

  // ZOOM INSET — video pixels around the chin, magnified, with the same
  // marks on top. Copied from the canvas BEFORE the marks are drawn on it,
  // so the inset shows footage rather than a picture of the overlay.
  const gtPx = P(entry.gt);
  const rulerPx = Math.hypot((entry.lsh[0] - entry.rsh[0]) * W,
                             (entry.lsh[1] - entry.rsh[1]) * H);
  const src = Math.max(40, Math.min(W, H, rulerPx * 1.6));   // region to magnify
  const box = Math.min(W, H) * 0.28;                          // inset size
  const zoom = box / src;
  const sx = Math.max(0, Math.min(W - src, gtPx[0] - src / 2));
  const sy = Math.max(0, Math.min(H - src, gtPx[1] - src / 2));
  const ix = W - box - 10 * s, iy = 10 * s;
  if (Number.isFinite(sx) && Number.isFinite(sy) && box > 20) {
    ctx.drawImage(ctx.canvas, sx, sy, src, src, ix, iy, box, box);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1.5 * s;
    ctx.strokeRect(ix, iy, box, box);
    // where the inset is looking, on the frame itself
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
                                iy + (p[1] * H - sy) * zoom], s);
    ctx.restore();
  }

  drawMarks(ctx, entry, P, s);

  // HUD
  const fsz = Math.round(13 * s), lineH = fsz + 4 * s;
  const lines = [
    [`GT      ${entry.clicks.length} click(s), floor ${fmt(e.floor / e.ruler, 3)} sh`, C.gt],
    [`formula ${fmt(e.proxy?.sh, 3)} sh  (dy ${fmt(e.proxy?.shy, 3)}  dx ${fmt(e.proxy?.shx, 3)})`, C.proxy],
    [entry.ext
      ? `extract ${fmt(e.ext?.sh, 3)} sh  (dy ${fmt(e.ext?.shy, 3)}  dx ${fmt(e.ext?.shx, 3)})`
      : "extract no face", entry.ext ? (gatedOut(entry) ? C.gated : C.ext) : C.gated],
    [`score   ${entry.score == null ? "—" : entry.score.toFixed(2)}${gatedOut(entry) ? "  BELOW GATE" : ""}`, C.text],
    [`+dy = below the clicked chin`, C.text],
  ];
  const padX = 10 * s, padY = 8 * s, boxW = 340 * s;
  const boxH = lines.length * lineH + padY * 2 - 4 * s;
  const bx = 10 * s, by = 10 * s;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 6 * s); ctx.fill();
  ctx.font = `${fsz}px ui-monospace, monospace`;
  ctx.textBaseline = "top";
  lines.forEach(([t, cc], i) => {
    ctx.fillStyle = cc;
    ctx.fillText(t, bx + padX, by + padY + i * lineH);
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
  label.textContent = "Labeled frames (click to seek) — colored by which source is closer";
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = "cs-timeline";
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
    // snap to the nearest labeled frame — clicking between marks should
    // land on data, not on an empty frame
    seekFrame(frames.reduce((a, b) =>
      Math.abs(b - target) < Math.abs(a - target) ? b : a));
  });
}

function drawTimeline(state) {
  const cv = document.getElementById("cs-timeline");
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
  const W = ctxW(state), H = ctxH(state);
  for (const f of labeledFrames()) {
    ctx.fillStyle = WIN_COLOR[winnerOf(byViewer.get(f), W, H)] || C.mark;
    ctx.fillRect(x(f) - 1.5, 6, 3, cssH - 14);
  }
  ctx.strokeStyle = C.playhead;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x(state.frame), 0); ctx.lineTo(x(state.frame), cssH); ctx.stroke();
}

export const ChinSourcesRule = {
  id: "chin_sources",
  label: "Chin sources (GT · formula · extractor)",
  requiresVideo,
  mount,
  update,
  draw,
};
