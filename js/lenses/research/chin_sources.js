// Chin sources — the labelers' chin, the skeleton formula's chin, and the
// face pipeline's chin, on the same frame.
//
// Three estimates of one point, drawn as three marks and nothing else:
//
//   ◯ white ring   the labelers' median click — ground truth
//   ● magenta      chin = nose + 2.25 * (mouth_mid - nose), the skeleton
//                  formula every chin_tuck sampler carries
//   ● cyan         SCRFD-10G + 2d106, the lowest of the 106 landmarks;
//                  dashed when the SCRFD score is below the gate, absent
//                  when no face was found
//
// The backend's chin_height_compare.py says which is closer and by how much
// (the face pipeline ~2x, see ml/research/chin_tuck/FACE_PIPELINE.md). This
// is where that gets checked against the footage.
//
// Two things make it readable when the boxer is far from the camera and the
// three marks land within a few pixels of each other:
//   - a zoom inset, which copies the video pixels around the chin BEFORE the
//     marks go down, magnifies them into the corner, and redraws the marks
//     on top;
//   - ctrl+scroll zoom, which every mark here divides out (state.view.zoom),
//     so marks stay a fixed size on screen and magnifying genuinely pulls
//     them apart instead of inflating them together. HUD and inset ride the
//     visible region so they stay on screen as you zoom and pan.
//
// Data: ./lens_data/chin_sources/<stem>.json + index.json, built by the
// backend's chin_lens_data.py from a labels snapshot, the variant manifest
// and the extractor sidecar. Only frames a human actually labeled have data,
// so the lens is a frame-by-frame inspector, not a per-frame overlay: the
// sidebar lists every labeled frame and the timeline lane marks them.
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
  gated:   "#ff9e64",   // extractor chin below the score gate
  mark:    "#d3b136",   // labeled-frame marks on the timeline
  playhead:"#3ad9e0",
  text:    "#aaa",
};
// Labeled frames are sparse, so land on the nearest one rather than
// showing nothing when the scrubber stops a frame short.
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
      Three chins on the frame:
      <span style="color:${C.gt}">◯ the labelers' median</span>,
      <span style="color:${C.proxy}">● the formula</span> (nose + ${activeData?.chin_coef ?? 2.25}·(mouth − nose)),
      <span style="color:${C.ext}">● the extractor</span> (SCRFD + 2d106).
      Only labeled frames carry data — use the list below, or ◀ ▶.
    </p>
    ${indexError ? `<p class="hint" style="color:#ff5d6c">index.json failed: ${indexError}</p>` : ""}
    ${dataError[activeStem] ? `<p class="hint" style="color:#ff5d6c">no data for this video: ${dataError[activeStem]}</p>` : ""}

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
function drawMarks(ctx, entry, P, s, zoomed) {
  // Mark sizes are deliberately small. On a frame where both estimates are
  // good they sit a couple of pixels apart, and a mark wide enough to be
  // comfortable on its own swallows exactly the difference the lens exists
  // to show. The zoom inset is what makes small marks readable.
  const R = 2.6;                 // estimate dot radius
  const RING = 4.6;              // the labelers' ring, big enough to contain
                                 // both dots without touching them

  // Zoomed in, a filled dot stops being enough: it holds its size on screen
  // while the footage under it grows, so it covers the very pixels you
  // zoomed in to see, and its centre — the actual estimate — is a guess.
  // Past ~1.5x each mark grows four ticks pointing at its own centre, clear
  // of the mark itself. Two crosshairs a few pixels apart read as two
  // positions; two dots read as one blob.
  const tick = (x, y, color, w) => {
    if (!zoomed) return;
    ctx.strokeStyle = color; ctx.lineWidth = w * s;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(x + dx * 5.5 * s, y + dy * 5.5 * s);
      ctx.lineTo(x + dx * 10.5 * s, y + dy * 10.5 * s);
    }
    ctx.stroke();
  };

  const dot = (x, y, color, dashed) => {
    ctx.beginPath();
    ctx.arc(x, y, R * s, 0, Math.PI * 2);
    if (dashed) {
      ctx.strokeStyle = color; ctx.lineWidth = 1.3 * s;
      ctx.setLineDash([2 * s, 2 * s]); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.fillStyle = color; ctx.fill();
      // a hairline of dark keeps the dot readable over pale skin or a glove
      ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 0.7 * s; ctx.stroke();
    }
    tick(x, y, color, 1.1);
  };

  // Three chins, nothing else. The labelers' median is a ring rather than a
  // dot so the two estimates stay readable when they land inside it — which
  // on a good frame they do.
  const gt = P(entry.gt);
  ctx.strokeStyle = C.gt; ctx.lineWidth = 1.4 * s;
  ctx.beginPath(); ctx.arc(gt[0], gt[1], RING * s, 0, Math.PI * 2); ctx.stroke();

  if (entry.proxy) { const p = P(entry.proxy); dot(p[0], p[1], C.proxy); }
  if (entry.ext) {
    const p = P(entry.ext);
    dot(p[0], p[1], gatedOut(entry) ? C.gated : C.ext, gatedOut(entry));
  }
  // GT's ticks go on last so they cross whatever landed inside the ring.
  tick(gt[0], gt[1], C.gt, 1.4);
}

function draw(ctx, state) {
  const entry = entryAt(state.frame);
  if (!entry) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const view = state.view || { zoom: 1, x0: 0, y0: 0, x1: W, y1: H };
  // Everything this lens draws is sized in `s`, which now DIVIDES OUT the
  // ctrl+scroll zoom. The zoom is a CSS transform over the finished bitmap,
  // so without this a mark grows with the magnification and two marks that
  // overlap at 1x still overlap at 24x — the frames worth zooming into are
  // exactly the ones zoom could not help with. Held constant on screen, the
  // only thing zoom changes is the gap between the marks, which is the
  // measurement.
  //
  // The 0.4 floor is on the SCALE, not a pixel size: below it a mark is a
  // sub-pixel arc on the canvas and antialiasing thins it to a smudge. It
  // starts binding around 6x on a typical 1080-in-410 stage, so past that
  // marks do creep up on screen — but ~3x by full zoom against 24x more
  // separation, which is the trade worth making. Past 2.5x the marks are the
  // only thing `s` sizes, so nothing else inherits that creep.
  const s = Math.max((state.renderScale || 1) / (view.zoom || 1), 0.4);
  const P = p => [p[0] * W, p[1] * H];
  const e = errorsOf(entry, ctxW(state), ctxH(state));
  // Both overlays are canvas-drawn, so the zoom transform magnifies their
  // rasterized pixels: past ~2.5x the key's text is a blur and the inset is
  // a magnifier inside a magnifier, and between them they cover most of what
  // you zoomed in to look at. The sidebar carries the same numbers as live
  // DOM text, sharper than the key ever was. So once you are inspecting
  // pixels, the marks get the frame to themselves.
  const chrome = (view.zoom || 1) <= 2.5;

  ctx.save();

  // ZOOM INSET — video pixels around the chin, magnified, with the same
  // marks on top. Copied from the canvas BEFORE the marks are drawn on it,
  // so the inset shows footage rather than a picture of the overlay.
  const gtPx = P(entry.gt);
  const rulerPx = Math.hypot((entry.lsh[0] - entry.rsh[0]) * W,
                             (entry.lsh[1] - entry.rsh[1]) * H);
  // Region to magnify: about one shoulder-width around the chin — tight,
  // because with marks this small the inset is where the difference is
  // actually read, and a wider crop shows more boxer and less of the thing
  // being judged. It widens when it has to: on a frame where an estimate
  // flies off the jaw, a fixed crop would simply not contain that mark and
  // the inset would imply the estimate was missing rather than wrong.
  const reach = [entry.proxy, entry.ext].reduce((m, pt) => {
    if (!pt) return m;
    const q = P(pt);
    return Math.max(m, Math.hypot(q[0] - gtPx[0], q[1] - gtPx[1]));
  }, 0);
  const want = Math.max(rulerPx * 1.1, reach * 2.6);
  const src = Math.max(36, Math.min(W, H, want));
  // Inset size follows the VISIBLE box, not the frame: zoomed in, most of
  // the canvas is off screen, and a corner measured against the whole frame
  // is a corner you cannot see.
  const visW = Math.max(1, view.x1 - view.x0), visH = Math.max(1, view.y1 - view.y0);
  const box = Math.min(visW, visH) * 0.32;                    // inset size
  const zoom = box / src;
  const sx = Math.max(0, Math.min(W - src, gtPx[0] - src / 2));
  const sy = Math.max(0, Math.min(H - src, gtPx[1] - src / 2));
  const ix = view.x1 - box - 10 * s, iy = view.y0 + 10 * s;
  // `box` is canvas pixels, and at high zoom the visible slice is small, so a
  // flat "box > 20" retired the inset exactly when it was still a comfortable
  // 130 CSS px on screen. Compare in screen terms instead.
  if (chrome && Number.isFinite(sx) && Number.isFinite(sy) && box > 24 * s) {
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
    // The inset is its own magnifier, so it never gets the crosshairs — it
    // would be showing them at two magnifications at once.
    drawMarks(ctx, entry, p => [ix + (p[0] * W - sx) * zoom,
                                iy + (p[1] * H - sy) * zoom], s, false);
    ctx.restore();
  }

  drawMarks(ctx, entry, P, s, (view.zoom || 1) > 1.5);

  // A three-line key: which colour is which chin, and how far each estimate
  // is from the ring. Everything else moved to the sidebar.
  if (!chrome) { ctx.restore(); return; }
  const fsz = Math.round(13 * s), lineH = fsz + 4 * s;
  const lines = [
    ["\u25cb labelers", C.gt, ""],
    ["\u25cf formula", C.proxy, fmt(e.proxy?.sh, 3) + " sh"],
    [entry.ext ? "\u25cf extractor" : "\u25cb extractor", entry.ext
      ? (gatedOut(entry) ? C.gated : C.ext) : C.gated,
      entry.ext ? fmt(e.ext?.sh, 3) + " sh" + (gatedOut(entry) ? " (gated)" : "")
                : "no face"],
  ];
  const padX = 10 * s, padY = 8 * s, boxW = 205 * s;
  const boxH = lines.length * lineH + padY * 2 - 4 * s;
  // Top-left of what is on screen, not of the frame — see the inset above.
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
