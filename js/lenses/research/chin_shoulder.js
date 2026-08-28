// Chin / shoulder — our estimates against the labelers' clicks, on any
// variant, over the footage.
//
// The whole 4.0 grid in one lens: AXIS (height / depth) x FRAMES (guard /
// impact) x POINT (chin / shoulder). chin_sources does the height chin
// only; this covers the rest, including the shoulder endpoint that the
// depth rule actually reads.
//
//   ◯ red        ONE mark per landmark: the median of the labelers' clicks
//                for it (chin gets one, shoulder gets one). Median rather
//                than mean because that is what the backend scores against
//                in chin_depth_compare — with two clicks they are the same
//                number anyway, and with three a stray one cannot drag it.
//   · faint red  OFF by default: every individual click, when you want to
//                see the humans' own spread rather than their consensus
//   ● orange     chin = nose + 1.47*(mouth_mid - nose), the x-axis refit
//                — the adopted skeleton fallback              [depth only]
//   ● cyan       chin from the face pipeline (SCRFD + 2d106)
//
// The shipped 2.25 proxy is NOT drawn: it is a y-axis coefficient that the
// refit and the face pipeline both beat, and it only crowded the marks it
// was being compared against. It is still in the cached data, so putting
// it back is one line in SRC.
//   ● yellow     shoulder = the BlazePose lead-shoulder keypoint
//   ● green      shoulder = keypoint + d*0.1006*torso            [depth only]
//
// The two depth corrections are drawn ONLY on the depth variants. They are
// fitted against the front of the shoulder and the x axis, and mean nothing
// against the height variants' shoulder-TOP clicks — where, as the numbers
// show the moment you switch, the keypoint's error is almost entirely
// vertical.
//
// DATA, and why it splits. Model points are baked
// (lens_data/chin_shoulder/<variant>/<stem>.json, from the backend's
// lens/chin_shoulder_lens_data.py) because they need the Drive pose caches
// and the boxer_facing_angle MLP, neither of which a browser can reach.
// The CLICKS are fetched live from the Apps Script, the same way
// face_mesh_chin does, so new labels show up without regenerating anything.
//
// Alignment is BY TIME: each entry's `t` is SOURCE-VIDEO seconds off the
// cache _pts clock, mapped with round(t*fps) - floor(start_sec*fps).
// ROUND, not floor — cache pts sit a hair shy of the next frame boundary,
// and flooring draws the marks one frame early.

const DATA_DIR = "./lens_data/chin_shoulder/";
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec";

const VARIANTS = {
  height_guard:  { label: "height · guard",  action: "ChinPoint",            axis: "height" },
  height_impact: { label: "height · impact", action: "ChinPointImpact",      axis: "height" },
  depth_guard:   { label: "depth · guard",   action: "ChinPointDepth",       axis: "depth"  },
  depth_impact:  { label: "depth · impact",  action: "ChinPointDepthImpact", axis: "depth"  },
};

const C = {
  gt: "#ff2f45", gtFaint: "rgba(255,47,69,0.5)",
  chin_proxy_x: "#ffb347", chin_face: "#3ad9e0",
  sh_kp: "#ffd93d", sh_corr: "#7adf7a",
  mark: "#d3b136", playhead: "#3ad9e0",
};
const SRC = {
  chin_proxy_x: { label: "proxy 1.47",    kind: "chin", axis: "depth" },
  chin_face:    { label: "face pipeline", kind: "chin", axis: null },
  sh_kp:        { label: "keypoint",      kind: "sh",   axis: null },
  sh_corr:      { label: "kp + deltoid",  kind: "sh",   axis: "depth" },
};
const SNAP_FRAMES = 2;

let host = null, latestState = null;
let index = null, indexError = null, indexPromise = null;
let data = {}, dataError = {};
let activeKey = null, activeData = null;
let byViewer = null, mapsKey = "";
let labels = null, labelsFor = null, labelsPromise = null;

const SHOW_KEY = "cornerman.chin_shoulder.v1";
const pick = { variant: "depth_guard", point: "both", gt: true, all: false };
try { Object.assign(pick, JSON.parse(localStorage.getItem(SHOW_KEY) || "{}")); } catch {}
function save() { try { localStorage.setItem(SHOW_KEY, JSON.stringify(pick)); } catch {} }

// ---------------------------------------------------------------- helpers
const stripStem = (s) => String(s || "").replace(/_h264$/, "");
const poseOf = (st) => st.poseV6 || st.pose || null;
const startSec = (st) => poseOf(st)?.start_sec || 0;
const fmt = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "—");

function secToFrame(st, tSrc) {
  const fps = st.fps || 30;
  return Math.round(tSrc * fps) - Math.floor(startSec(st) * fps + 1e-6);
}
function seekFrame(f) {
  const s = document.getElementById("scrubber");
  if (!s) return;
  s.value = Math.max(0, Math.round(f));
  s.dispatchEvent(new Event("input", { bubbles: true }));
}
function refresh() { document.getElementById("video")?.dispatchEvent(new Event("seeked")); }

// ---------------------------------------------------------------- data
function ensureIndex() {
  if (index || indexError || indexPromise) return indexPromise;
  indexPromise = fetch(DATA_DIR + "index.json")
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(j => { index = j; })
    .catch(e => { indexError = String(e); })
    .finally(() => {
      mapsKey = "";
      // The video dropdown filters on requiresVideo(), which cannot answer
      // until this lands — until then every video passes. Tell the viewer to
      // re-filter now that it can, or the list stays as it was: everything.
      // Fires whether or not the lens is mounted; the viewer only re-reads
      // its dropdowns.
      window.dispatchEvent(new Event("lens-filter-changed"));
      if (host) rebuild();
    });
  return indexPromise;
}
ensureIndex();

function stemsOf(variant) { return index?.variants?.[variant] || []; }

function indexStemFor(base) {
  const list = stemsOf(pick.variant);
  for (const c of [base, stripStem(base)]) if (list.includes(c)) return c;
  return null;
}

// Only videos this variant actually has labeled frames for. Switching the
// variant therefore changes the video list, which is why the change handler
// fires "lens-filter-changed" — the viewer re-populates its dropdowns on it.
// An index that failed to load returns true rather than hiding every video:
// a missing file should look like a broken lens, not an empty corpus.
function requiresVideo(base) {
  if (indexError || !index) return true;
  return indexStemFor(base) != null;
}

async function ensureData(variant, stem) {
  const key = `${variant}|${stem}`;
  if (!stem || data[key] || dataError[key]) return;
  const name = indexStemFor(stem) || stripStem(stem);
  try {
    const r = await fetch(DATA_DIR + variant + "/" + encodeURIComponent(name) + ".json");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data[key] = await r.json();
  } catch (e) { dataError[key] = String(e); }
  mapsKey = "";
  if (host) rebuild();
}

// Clicks, live — same pattern as face_mesh_chin. Re-fetched when the
// variant changes, since each variant is its own spreadsheet.
async function ensureLabels(variant) {
  if (labelsFor === variant && (labels || labelsPromise)) return labelsPromise;
  labelsFor = variant; labels = null;
  const action = VARIANTS[variant].action;
  const get = async (params) => {
    const url = SCRIPT_URL + "?" + new URLSearchParams(params).toString();
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url);
        if (r.ok) return await r.json();
      } catch {}
      await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
    throw new Error("label fetch failed");
  };
  labelsPromise = (async () => {
    const out = new Map();
    const roster = ((await get({ action: `stats${action}` })).labelers || [])
      .map(e => e.labeler).filter(n => n && n !== "Test");
    for (const who of roster) {
      const body = await get({ action: `list${action}`, labeler: who });
      for (const row of body.rows || []) {
        if (row.skipped || row.camera_bad) continue;
        const k = `${row.video}|${row.round}|${row.frame}`;
        if (!out.has(k)) out.set(k, []);
        out.get(k).push({
          who,
          chin: row.chin_x == null ? null : [+row.chin_x, +row.chin_y],
          sh: row.sh_x == null ? null : [+row.sh_x, +row.sh_y],
          chin_vis: row.chin_vis || "visible", sh_vis: row.sh_vis || "visible",
        });
      }
    }
    return out;
  })()
    .then(m => { if (labelsFor === variant) labels = m; })
    .catch(() => { if (labelsFor === variant) labels = new Map(); })
    .finally(() => { labelsPromise = null; if (host) rebuild(); });
  return labelsPromise;
}

// ---------------------------------------------------------------- lookups
function rebuildMaps(st) {
  // `cacheBasename` is the viewer's name for the loaded round's video — the
  // same field chin_sources reads, and the one requiresVideo() is handed.
  // Anything else (there is no state.videoStem) leaves the stem empty and
  // the lens silently finds no frames.
  const base = st.cacheBasename || "";
  const key = `${pick.variant}|${base}|${startSec(st)}|${st.fps}|${poseOf(st)?.n_frames}`;
  if (key === mapsKey) return;
  mapsKey = key;
  activeKey = `${pick.variant}|${base}`;
  activeData = data[activeKey] || data[`${pick.variant}|${stripStem(base)}`] || null;
  byViewer = new Map();
  if (!activeData) { ensureData(pick.variant, base); return; }
  const n = poseOf(st)?.n_frames || 0;
  for (const e of activeData.frames || []) {
    const f = secToFrame(st, e.t);
    if (f >= 0 && f < n) byViewer.set(f, e);
  }
}
function entryAt(f) {
  if (!byViewer) return null;
  for (let d = 0; d <= SNAP_FRAMES; d++) {
    if (byViewer.has(f - d)) return byViewer.get(f - d);
    if (byViewer.has(f + d)) return byViewer.get(f + d);
  }
  return null;
}
function labeledFrames() { return byViewer ? [...byViewer.keys()].sort((a, b) => a - b) : []; }

function clicksFor(e) {
  if (!e || !labels || !activeData) return [];
  return labels.get(`${activeData.stem}|${e.r}|${e.f}`) || [];
}
function medianPt(pts) {
  if (!pts.length) return null;
  const med = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  return [med(pts.map(p => p[0])), med(pts.map(p => p[1]))];
}
function gtFor(e, kind) {
  const cl = clicksFor(e);
  const vis = cl.filter(c => c[kind] && c[`${kind}_vis`] === "visible").map(c => c[kind]);
  const any = cl.filter(c => c[kind]).map(c => c[kind]);
  return medianPt(vis.length ? vis : any);
}
function axisOf() { return activeData?.axis || VARIANTS[pick.variant].axis; }
function sources() {
  const ax = axisOf();
  return Object.entries(SRC)
    .filter(([, s]) => (s.axis === null || s.axis === ax))
    .filter(([, s]) => pick.point === "both" || s.kind === (pick.point === "chin" ? "chin" : "sh"))
    .map(([k]) => k);
}
function errOf(e, key) {
  const s = SRC[key], gt = gtFor(e, s.kind), p = e.model?.[key];
  if (!gt || !p || !e.wh) return null;
  const dx = (p[0] - gt[0]) * e.wh[0], dy = (p[1] - gt[1]) * e.wh[1];
  return { px: Math.hypot(dx, dy),
           torso: e.torso_px ? Math.hypot(dx, dy) / e.torso_px : NaN,
           xt: e.torso_px ? Math.abs(dx) / e.torso_px : NaN };
}

// per-video medians, the summary the backend reports
function summary() {
  const out = {};
  for (const k of sources()) out[k] = [];
  for (const e of activeData?.frames || []) {
    for (const k of sources()) { const er = errOf(e, k); if (er) out[k].push(er.torso); }
  }
  const med = a => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : NaN);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { n: v.length, med: med(v) }]));
}

// ---------------------------------------------------------------- sidebar
function rebuild() {
  if (latestState) rebuildMaps(latestState);
  buildSidebar();
  seekFirstIfUnlanded();
  if (latestState) updateNav(latestState);
  refresh();
}

function buildSidebar() {
  if (!host) return;
  const st = latestState;
  const sum = activeData && labels ? summary() : null;
  host.innerHTML = `
    <h2>Chin / shoulder</h2>
    <p class="hint">Our estimates against the labelers' clicks. Model points are
      baked (they need the pose caches + the facing model); clicks come live,
      so new labels appear on reload.</p>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">
      <label class="small">variant<br><select id="cs2-variant">
        ${Object.entries(VARIANTS).map(([k, v]) =>
          `<option value="${k}" ${k === pick.variant ? "selected" : ""}>${v.label}</option>`).join("")}
      </select></label>
      <label class="small">point<br><select id="cs2-point">
        ${[["both", "chin + shoulder"], ["chin", "chin"], ["shoulder", "shoulder"]].map(([v, l]) =>
          `<option value="${v}" ${v === pick.point ? "selected" : ""}>${l}</option>`).join("")}
      </select></label>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin:4px 0">
      <label class="small" style="display:flex;gap:4px;align-items:center;cursor:pointer">
        <input type="checkbox" id="cs2-gt" ${pick.gt ? "checked" : ""}>
        <span style="color:${C.gt}">labelers' median</span></label>
      <label class="small" style="display:flex;gap:4px;align-items:center;cursor:pointer">
        <input type="checkbox" id="cs2-all" ${pick.all ? "checked" : ""}>
        <span class="muted">every click</span></label>
    </div>

    <div class="small" style="margin:6px 0">
      ${sources().map(k => `<span style="margin-right:10px;white-space:nowrap">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${C[k]}"></span>
        ${SRC[k].label}</span>`).join("")}
    </div>

    ${indexError ? `<p class="hint" style="color:#ff5d6c">index.json failed: ${indexError}</p>` : ""}
    ${dataError[activeKey] ? `<p class="hint" style="color:#ff5d6c">no data for this video under ${pick.variant}</p>` : ""}
    ${!labels ? `<p class="hint muted">loading clicks…</p>` : ""}

    <div style="display:flex;gap:6px;margin:6px 0">
      <button id="cs2-prev" class="btn small">◀ prev labeled</button>
      <button id="cs2-next" class="btn small">next labeled ▶</button>
    </div>

    <div id="cs2-frame" class="small" style="margin:8px 0"></div>

    ${sum ? `<h3 style="margin-top:10px">This video (median err / torso)</h3>
    <table class="small" style="width:100%;border-collapse:collapse">
      <tr><th style="text-align:left">source</th><th style="text-align:right">n</th>
          <th style="text-align:right">median</th></tr>
      ${sources().map(k => `<tr>
        <td style="color:${C[k]}">${SRC[k].label}</td>
        <td style="text-align:right">${sum[k].n}</td>
        <td style="text-align:right">${fmt(sum[k].med)}</td></tr>`).join("")}
    </table>` : ""}

    <h3 style="margin-top:10px">Labeled frames</h3>
    <div id="cs2-list" style="max-height:220px;overflow:auto"></div>`;

  host.querySelector("#cs2-variant").onchange = (ev) => {
    pick.variant = ev.target.value; save();
    mapsKey = ""; activeData = null;
    ensureLabels(pick.variant);
    // the labeled-video set is per variant, so the dropdowns must re-filter
    window.dispatchEvent(new Event("lens-filter-changed"));
    rebuild();
  };
  host.querySelector("#cs2-point").onchange = (ev) => { pick.point = ev.target.value; save(); rebuild(); };
  host.querySelector("#cs2-gt").onchange = (ev) => { pick.gt = ev.target.checked; save(); rebuild(); };
  host.querySelector("#cs2-all").onchange = (ev) => { pick.all = ev.target.checked; save(); refresh(); };
  host.querySelector("#cs2-prev").onclick = () => step(-1);
  host.querySelector("#cs2-next").onclick = () => step(1);
  buildList();
  if (st) updateFrameBox(st);
}

// Labeled frames are the unit here, not seconds: this is a frame viewer
// that happens to read its pixels from a video. step() moves to the next
// LABELED frame, and stops at the ends rather than wrapping, so "next"
// never silently returns you to the start of the round.
function step(dir) {
  const fs = labeledFrames();
  if (!fs.length || !latestState) return;
  const cur = latestState.frame;
  const next = dir > 0 ? fs.find(f => f > cur) : [...fs].reverse().find(f => f < cur);
  if (next != null) seekFrame(next);
}

// Land on a labeled frame as soon as the data for a video arrives — opening
// a video on frame 0, which is almost never labeled, would show an empty
// lens and look broken.
function seekFirstIfUnlanded() {
  const fs = labeledFrames();
  if (!fs.length || !latestState) return;
  if (entryAt(latestState.frame)) return;      // already on one
  seekFrame(fs[0]);
}

// The frame strip lives in #stage-extras, which the viewer clears on every
// lens switch — so it is built fresh in mount() and never leaks.
function mountStageNav() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = `
    <div id="cs2-nav" style="display:flex;align-items:center;gap:10px;
         padding:6px 2px;flex-wrap:wrap">
      <button id="cs2-first" class="btn small">⏮</button>
      <button id="cs2-back" class="btn small">◀ prev frame</button>
      <button id="cs2-fwd" class="btn small">next frame ▶</button>
      <span id="cs2-count" class="small muted"></span>
      <span class="small muted" style="margin-left:auto">← → steps labeled frames</span>
    </div>
    <canvas id="cs2-strip" style="width:100%;height:16px;display:block"></canvas>`;
  slot.querySelector("#cs2-first").onclick = () => {
    const fs = labeledFrames(); if (fs.length) seekFrame(fs[0]);
  };
  slot.querySelector("#cs2-back").onclick = () => step(-1);
  slot.querySelector("#cs2-fwd").onclick = () => step(1);
  const strip = slot.querySelector("#cs2-strip");
  strip.onclick = (ev) => {
    const fs = labeledFrames();
    if (!fs.length || !latestState) return;
    const n = poseOf(latestState)?.n_frames || 1;
    const r = strip.getBoundingClientRect();
    const want = ((ev.clientX - r.left) / r.width) * n;
    // snap to the nearest LABELED frame — clicking between two marks should
    // land on one of them, not on an empty frame
    seekFrame(fs.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)));
  };
}

function drawStrip(st) {
  const cv = document.getElementById("cs2-strip");
  if (!cv || !st) return;
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  if (!r.width) return;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(16 * dpr);
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  const n = poseOf(st)?.n_frames || 1;
  const X = f => (f / n) * cv.width;
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = C.mark;
  for (const f of labeledFrames()) ctx.fillRect(X(f) - dpr, 3 * dpr, 2 * dpr, 10 * dpr);
  ctx.fillStyle = C.playhead;
  ctx.fillRect(X(st.frame) - dpr, 0, 2 * dpr, cv.height);
}

// One listener for the lens's lifetime; it no-ops whenever the lens is not
// the mounted one (its sidebar is gone), since there is no unmount hook to
// detach it in.
let keysBound = false;
function bindKeys() {
  if (keysBound) return;
  keysBound = true;
  document.addEventListener("keydown", (ev) => {
    if (!document.getElementById("cs2-variant")) return;
    const tag = (ev.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return;
    if (ev.key === "ArrowLeft") { ev.preventDefault(); step(-1); }
    if (ev.key === "ArrowRight") { ev.preventDefault(); step(1); }
  });
}

function buildList() {
  const box = host?.querySelector("#cs2-list");
  if (!box) return;
  const fs = labeledFrames();
  box.innerHTML = fs.length
    ? fs.map(f => `<div class="small cs2-row" data-f="${f}"
        style="cursor:pointer;padding:1px 3px">frame ${f}</div>`).join("")
    : `<p class="hint muted">none for this video under ${pick.variant}</p>`;
  box.querySelectorAll(".cs2-row").forEach(el =>
    el.onclick = () => seekFrame(+el.dataset.f));
}

function updateNav(st) {
  const fs = labeledFrames();
  const el = document.getElementById("cs2-count");
  if (el) {
    const i = fs.indexOf(st.frame);
    const near = i >= 0 ? i : fs.findIndex(f => Math.abs(f - st.frame) <= SNAP_FRAMES);
    el.textContent = fs.length
      ? `${near >= 0 ? near + 1 : "–"} / ${fs.length} labeled frames`
      : "no labeled frames for this video";
  }
  drawStrip(st);
}

function updateFrameBox(st) {
  const box = host?.querySelector("#cs2-frame");
  if (!box) return;
  const e = entryAt(st.frame);
  if (!e) { box.innerHTML = `<span class="muted">no labeled frame here</span>`; return; }
  const rows = sources().map(k => {
    const er = errOf(e, k);
    return `<tr><td style="color:${C[k]}">${SRC[k].label}</td>
      <td style="text-align:right">${e.model?.[k] ? (er ? er.px.toFixed(1) : "—") : "<span class='muted'>absent</span>"}</td>
      <td style="text-align:right">${er ? fmt(er.torso) : "—"}</td>
      <td style="text-align:right">${er ? fmt(er.xt) : "—"}</td></tr>`;
  }).join("");
  box.innerHTML = `
    <div class="muted">r${e.r} f${e.f} · lead ${e.lead || "—"} ·
      facing ${e.d > 0 ? "image-right" : e.d < 0 ? "image-left" : "—"} ·
      torso ${e.torso_px?.toFixed(0)}px${e.score != null ? ` · SCRFD ${e.score}` : ""}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:4px">
      <tr><th style="text-align:left">source</th><th style="text-align:right">px</th>
          <th style="text-align:right">/torso</th><th style="text-align:right">|dx|/torso</th></tr>
      ${rows}</table>`;
}

// ---------------------------------------------------------------- draw
function draw(ctx, state) {
  const e = entryAt(state.frame);
  if (!e) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const view = state.view || { zoom: 1 };
  // divide the ctrl+scroll zoom out, so magnifying separates the marks
  // instead of inflating them together (same reasoning as chin_sources)
  const s = Math.max((state.renderScale || 1) / (view.zoom || 1), 0.4);
  const P = p => [p[0] * W, p[1] * H];

  // One mark per thing, and nothing else. An earlier version grew a
  // four-tick crosshair around every mark once zoomed, which pointed at
  // each centre precisely but put five crosshairs on the frame as soon as
  // both points were shown — the marks stopped being readable as marks.
  // Colour carries identity; the GT ring carries "this is the human".
  const dot = (p, color, r) => {
    const [x, y] = P(p);
    ctx.beginPath(); ctx.arc(x, y, r * s, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 0.5 * s; ctx.stroke();
  };

  for (const k of sources()) { const p = e.model?.[k]; if (p) dot(p, C[k], 1.5); }
  if (!pick.gt) return;
  const kinds = pick.point === "both" ? ["chin", "sh"] : [pick.point === "chin" ? "chin" : "sh"];
  for (const kind of kinds) {
    if (pick.all) for (const c of clicksFor(e)) if (c[kind]) dot(c[kind], C.gtFaint, 1.0);
    const gt = gtFor(e, kind);
    if (!gt) continue;
    const [x, y] = P(gt);
    ctx.beginPath(); ctx.arc(x, y, 3.0 * s, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 2.0 * s; ctx.stroke();
    ctx.strokeStyle = C.gt; ctx.lineWidth = 1.3 * s; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 0.7 * s, 0, Math.PI * 2);
    ctx.fillStyle = C.gt; ctx.fill();
  }
}

// ---------------------------------------------------------------- lifecycle
function mount(_host, state) {
  host = _host; latestState = state;
  ensureIndex();
  ensureLabels(pick.variant);
  bindKeys();
  mountStageNav();
  rebuildMaps(state);
  buildSidebar();
  seekFirstIfUnlanded();
  updateNav(state);
}
function update(state) {
  latestState = state;
  rebuildMaps(state);
  updateFrameBox(state);
  updateNav(state);
}

// No skeleton. Every joint it would draw sits within a few pixels of the
// marks this lens exists to separate — the shoulder bones run straight
// through the shoulder marks — and the pose is not what is being judged
// here. hideJoints also drops any edge touching a hidden joint, so this
// leaves the frame clean.
const ALL_JOINTS = new Set(Array.from({ length: 17 }, (_, i) => i));
function skeletonStyle() { return { hideJoints: ALL_JOINTS, showImputed: false }; }

export const ChinShoulderRule = {
  id: "chin_shoulder",
  label: "Chin / shoulder (model vs labelers)",
  requiresVideo,
  mount,
  update,
  draw,
  skeletonStyle,
};
