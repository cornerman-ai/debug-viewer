// Roll eyes — does the boxer keep their eyes up at the bottom of a roll, or look at the floor?
//
// On every frame of every labeled roll (and the guard frames half a second before it) the face pipeline's 106
// landmarks are fitted to a generic 3D face, which gives where the face points. Drawn on the frame:
//
//   → arrow      from the nose tip, the way the face points (80 mm in front of it, projected)
//                green below the cut-off, red at or above it ("looking down"), grey under the score gate
//   · dots       a subset of the 2d106 landmarks (jaw, brows, eyes, nose, mouth), to judge the fit
//   NN° down     the angle below the camera's horizontal; against the CAMERA, not the floor, so a camera filming
//                from below reads a level face 20-30° down — compare with the guard frames
//
// The sidebar lists the round's labeled rolls with the angle at the bottom (the median over the lowest frame ±4)
// and the guard angle; click one to land on its bottom. Under the video, a strip lined up with the scrubber marks
// every roll, colored and labeled with that angle. The cut-off slider is for eyeballing only: no cut-off has been
// measured yet. Only the videos, and the rounds, with a labeled roll are offered (index.json's videos / rounds).
//
// Data: ./lens_data/roll_eyes/<stem>.json + index.json, written by the backend's
// ml/research/roll_eyes/roll_eyes_lens_data.py (rolls = John's labeled rolls, the angle = roll_eyes/head_pitch.py).
// Times are SOURCE-VIDEO seconds off the cache _pts clock, mapped to viewer frames as chin_sources.js does:
// round(t*fps) - floor(start_sec*fps).

const DATA_DIR = "./lens_data/roll_eyes/";
const CUT_KEY = "cornerman.roll_eyes.cut.v1";

const C = {
  up: "#3fd17a",
  down: "#ff4d5e",
  gated: "#9a9a9a",
  noface: "#e0a030",
  lm: "rgba(255,255,255,0.85)",
  playhead: "#3ad9e0",
  text: "#ddd",
};

let host = null;
let latestState = null;
let index = null, indexError = null, indexPromise = null;
let data = {}, dataError = {};
let activeStem = null, activeData = null;
let byViewer = null;        // Map(viewer frame -> frame entry)
let rounds = [];            // this round's rolls with viewer frames: {roll, sf, ef, bf, gf}
let mapsKey = "";
let cut = 30;
try { const v = Number(localStorage.getItem(CUT_KEY)); if (Number.isFinite(v) && v !== 0) cut = v; } catch { /* private mode */ }

// ---------------------------------------------------------------- helpers
const stripStem = s => String(s || "").replace(/_h264$/, "");
const poseOf = state => state?.pose || null;
const startSec = state => poseOf(state)?.start_sec || 0;
const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));

function secToFrame(state, t) {
  const fps = state.fps || 30;
  return Math.round(t * fps) - Math.floor(startSec(state) * fps + 1e-6);
}

function seekFrame(f) {
  const slider = document.getElementById("scrubber");
  if (!slider) return;
  slider.value = Math.max(0, Math.round(f));
  slider.dispatchEvent(new Event("input", { bubbles: true }));
}

const refresh = () => document.getElementById("video")?.dispatchEvent(new Event("seeked"));
const gate = () => activeData?.score_gate ?? 0.5;
const verdictOf = p => (p == null ? "na" : p >= cut ? "down" : "up");
const colorOf = (p, s) => (s == null ? C.noface : s < gate() || p == null ? C.gated : p >= cut ? C.down : C.up);

// ---------------------------------------------------------------- data
function ensureIndex() {
  if (index || indexError || indexPromise) return indexPromise;
  indexPromise = fetch(DATA_DIR + "index.json")
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(j => { index = j; })
    .catch(e => { indexError = String(e); })
    .finally(() => {
      mapsKey = "";
      window.dispatchEvent(new Event("lens-filter-changed"));   // the video list re-filters now the index is in
      if (host) { if (latestState) rebuildMaps(latestState); buildSidebar(); refresh(); }
    });
  return indexPromise;
}
ensureIndex();

function indexStemFor(base) {
  if (!index?.videos) return null;
  for (const c of [base, stripStem(base)]) if (index.videos.includes(c)) return c;
  return null;
}

// Only videos with labeled rolls. A missing index shows every video (a broken lens, not an empty corpus).
function requiresVideo(base) {
  if (indexError) return true;
  if (!index) return false;
  return indexStemFor(base) != null;
}

// Only the rounds with a labeled roll (index.rounds, per video).
function requires(slot, { base, round }) {
  if (!slot?.blazepose) return false;
  const stem = indexStemFor(base);
  const rounds = stem && index?.rounds?.[stem];
  return rounds ? rounds.includes(round) : !!stem;
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
  mapsKey = "";            // the memo was built while this fetch was in flight
  if (host) { if (latestState) rebuildMaps(latestState); buildSidebar(); refresh(); }
}

function rebuildMaps(state) {
  const stem = state.cacheBasename || "";
  const n = poseOf(state)?.n_frames || 0;
  const key = `${stem}|${state.fps}|${startSec(state)}|${n}`;
  if (key === mapsKey) return;
  mapsKey = key;
  activeStem = stem;
  activeData = data[stem] || data[stripStem(stem)] || null;
  byViewer = new Map();
  rounds = [];
  if (!activeData) { ensureData(stem); return; }
  for (const e of activeData.frames) {
    const f = secToFrame(state, e.t);
    if (f >= 0 && f < n) byViewer.set(f, e);
  }
  for (const roll of activeData.rolls) {
    const sf = secToFrame(state, roll.start), ef = secToFrame(state, roll.end);
    if (ef < 0 || sf >= n) continue;
    const bf = roll.bottom != null ? secToFrame(state, roll.bottom) : Math.round((sf + ef) / 2);
    const gf = secToFrame(state, roll.start - (index?.guard_s ?? 0.5));
    rounds.push({ roll, sf, ef, bf, gf });
  }
  rounds.sort((a, b) => a.sf - b.sf);
}

// The frame entry at f, else the nearest within one frame (the cache and the video can sit a frame apart at cuts).
function entryAt(f) {
  if (!byViewer) return null;
  if (byViewer.has(f)) return byViewer.get(f);
  if (byViewer.has(f - 1)) return byViewer.get(f - 1);
  if (byViewer.has(f + 1)) return byViewer.get(f + 1);
  return null;
}

function rollAt(f) {
  return rounds.find(r => f >= r.gf - 3 && f <= r.ef + 6) || null;
}

function phaseOf(r, f) {
  if (!r) return "";
  if (Math.abs(f - r.bf) <= 4) return f === r.bf ? "the bottom" : "near the bottom";
  if (f < r.sf) return "guard, before the roll";
  if (f > r.ef) return "after the roll";
  return "in the roll";
}

// ---------------------------------------------------------------- sidebar
function setCut(v) {
  cut = v;
  try { localStorage.setItem(CUT_KEY, String(v)); } catch { /* private mode */ }
  buildList();
  refresh();
}

function buildSidebar() {
  if (!host) return;
  const n = rounds.length;
  const withAngle = rounds.filter(r => r.roll.pitch != null);
  const down = withAngle.filter(r => r.roll.pitch >= cut).length;
  host.innerHTML = `
    <h2>Roll eyes</h2>
    <p class="hint">
      Where the face points, on every frame of every labeled roll (John's) and the guard frames before it.
      The arrow leaves the nose tip the way the face points:
      <span style="color:${C.up}">green</span> below the cut-off,
      <span style="color:${C.down}">red</span> at or above it,
      <span style="color:${C.gated}">grey</span> under the ${gate()} face-score gate;
      <span style="color:${C.noface}">no face</span> means SCRFD found none in the head crop.
      The angle is against the camera, not the floor: compare the bottom with the guard frames.
    </p>
    ${indexError ? `<p class="hint" style="color:#ff5d6c">index.json failed: ${indexError}</p>` : ""}
    ${dataError[activeStem] ? `<p class="hint" style="color:#ff5d6c">no data for this video: ${dataError[activeStem]}</p>` : ""}
    <div style="display:flex;align-items:center;gap:8px;margin:8px 0">
      <span class="small">cut-off</span>
      <input id="re-cut" type="range" min="0" max="60" step="1" value="${cut}" style="flex:1">
      <strong id="re-cut-v" class="small">${cut}° down</strong>
    </div>
    <p class="hint" style="margin-top:-4px">For eyeballing — no cut-off has been measured yet.</p>
    <div style="display:flex;gap:6px;margin:6px 0">
      <button id="re-prev" class="btn small">◀ prev roll</button>
      <button id="re-next" class="btn small">next roll ▶</button>
    </div>
    <div id="re-frame" class="small" style="margin:8px 0"></div>
    <h3 style="margin-top:10px">Rolls in this round</h3>
    <p class="hint" id="re-count">${n} labeled · ${withAngle.length} with an angle · ${down} at or above the cut</p>
    <div id="re-list" style="max-height:300px;overflow:auto"></div>
    ${activeData ? `<p class="hint" style="margin-top:8px">${index?.labels || ""} · made ${index?.made || "?"}</p>` : ""}
  `;
  const slider = host.querySelector("#re-cut");
  slider?.addEventListener("input", () => {
    host.querySelector("#re-cut-v").textContent = `${slider.value}° down`;
    setCut(Number(slider.value));
  });
  host.querySelector("#re-prev")?.addEventListener("click", () => step(-1));
  host.querySelector("#re-next")?.addEventListener("click", () => step(+1));
  buildList();
}

function step(dir) {
  if (!rounds.length || !latestState) return;
  const cur = latestState.frame;
  const next = dir > 0 ? rounds.find(r => r.bf > cur) : [...rounds].reverse().find(r => r.bf < cur);
  seekFrame((next || (dir > 0 ? rounds[0] : rounds[rounds.length - 1])).bf);
}

function buildList() {
  const box = host?.querySelector("#re-list");
  if (!box) return;
  const withAngle = rounds.filter(r => r.roll.pitch != null);
  const cnt = host.querySelector("#re-count");
  if (cnt) cnt.textContent = `${rounds.length} labeled · ${withAngle.length} with an angle · ${withAngle.filter(r => r.roll.pitch >= cut).length} at or above the cut`;
  if (!rounds.length) { box.innerHTML = `<p class="hint">no labeled rolls in this round</p>`; return; }
  const curRoll = latestState ? rollAt(latestState.frame) : null;
  box.innerHTML = rounds.map(r => {
    const v = verdictOf(r.roll.pitch);
    const col = r.roll.noface ? C.noface : v === "na" ? C.gated : v === "down" ? C.down : C.up;
    const what = r.roll.pitch != null ? `${fmt(r.roll.pitch)}°` : r.roll.noface ? "no face" : "—";
    return `<div class="re-row small" data-f="${r.bf}" style="display:grid;grid-template-columns:52px 1fr 52px 52px;gap:6px;
        padding:2px 4px;cursor:pointer;border-left:3px solid ${col};
        background:${r === curRoll ? "rgba(58,217,224,0.12)" : "transparent"}">
      <span>${(r.roll.start).toFixed(1)}s</span>
      <span class="muted">${r.roll.side.replace("_roll", "")}</span>
      <span style="color:${col};text-align:right">${what}</span>
      <span class="muted" style="text-align:right">g ${fmt(r.roll.guard)}°</span>
    </div>`;
  }).join("");
  box.querySelectorAll(".re-row").forEach(el => el.addEventListener("click", () => seekFrame(Number(el.dataset.f))));
}

function updateFrameBox(state) {
  const box = host?.querySelector("#re-frame");
  if (!box) return;
  const r = rollAt(state.frame);
  const e = entryAt(state.frame);
  if (!r && !e) { box.innerHTML = `<span class="muted">not in a roll — jump with the list or ◀ ▶</span>`; return; }
  const face = !e ? `<span class="muted">not looked at</span>`
    : e.s == null ? `<strong style="color:${C.noface}">no face</strong>${e.b ? ` <span class="muted">(body seen)</span>` : ""}`
      : `<strong style="color:${colorOf(e.p, e.s)};font-size:1.15em">${fmt(e.p)}° down</strong>
         <span class="muted">yaw ${fmt(e.y)}° · score ${fmt(e.s, 2)}${e.s < gate() ? " (under the gate)" : ""}</span>`;
  box.innerHTML = `
    <div>${face}</div>
    ${r ? `<div class="muted" style="margin-top:4px">${r.roll.id} · ${r.roll.side} · ${phaseOf(r, state.frame)} ·
      bottom ${fmt(r.roll.pitch)}° · guard ${fmt(r.roll.guard)}° · change ${r.roll.change == null ? "—" : (r.roll.change > 0 ? "+" : "") + fmt(r.roll.change)}° ·
      faces ${r.roll.faces}/5</div>` : ""}`;
}

// ---------------------------------------------------------------- lifecycle
function mount(_host, state) {
  host = _host;
  latestState = state;
  mapsKey = "";
  ensureIndex();
  if (state?.pose) rebuildMaps(state);
  buildSidebar();
  mountStageTimeline();
}

function update(state) {
  latestState = state;
  const before = mapsKey;
  rebuildMaps(state);
  if (mapsKey !== before) buildSidebar();
  updateFrameBox(state);
  buildList();
  drawTimeline(state);
}

// ---------------------------------------------------------------- canvas
function draw(ctx, state) {
  const e = entryAt(state.frame);
  if (!e || e.s == null || !e.k) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const view = state.view || { zoom: 1, x0: 0, y0: 0, x1: W, y1: H };
  const s = Math.max((state.renderScale || 1) / (view.zoom || 1), 0.4);
  const P = p => [p[0] * W, p[1] * H];
  const col = colorOf(e.p, e.s);
  ctx.save();
  ctx.fillStyle = C.lm;
  for (const p of e.k) {
    const [x, y] = P(p);
    ctx.beginPath(); ctx.arc(x, y, 1.3 * s, 0, Math.PI * 2); ctx.fill();
  }
  if (e.a) {
    const [x0, y0] = P(e.a[0]), [x1, y1] = P(e.a[1]);
    // the arrow keeps a readable length when the face is small: at least 40 css px
    const len = Math.hypot(x1 - x0, y1 - y0) || 1, minLen = 40 * s;
    const k = Math.max(1, minLen / len);
    const xe = x0 + (x1 - x0) * k, ye = y0 + (y1 - y0) * k;
    const ang = Math.atan2(ye - y0, xe - x0), hl = 8 * s;
    const path = () => {
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(xe, ye);
      ctx.moveTo(xe, ye); ctx.lineTo(xe - hl * Math.cos(ang - 0.45), ye - hl * Math.sin(ang - 0.45));
      ctx.moveTo(xe, ye); ctx.lineTo(xe - hl * Math.cos(ang + 0.45), ye - hl * Math.sin(ang + 0.45));
    };
    path(); ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 5 * s; ctx.lineCap = "round"; ctx.stroke();
    path(); ctx.strokeStyle = col; ctx.lineWidth = 2.5 * s; ctx.stroke();
  }
  // the angle beside the face
  const xs = e.k.map(p => p[0] * W), ys = e.k.map(p => p[1] * H);
  const tx = Math.max(...xs) + 8 * s, ty = Math.min(...ys);
  const label = `${fmt(e.p)}° down`;
  ctx.font = `bold ${Math.round(14 * s)}px ui-monospace, monospace`;
  ctx.textBaseline = "top";
  const w = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath(); ctx.roundRect(tx - 4 * s, ty - 3 * s, w + 8 * s, 20 * s, 4 * s); ctx.fill();
  ctx.fillStyle = col; ctx.fillText(label, tx, ty);
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
  label.textContent = "Labeled rolls, lined up with the scrubber (click to land on the bottom) — colored by the angle at the bottom against the cut-off";
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = "re-timeline";
  canvas.style.cssText = "display:block;width:100%;height:46px";
  wrap.appendChild(canvas);
  slot.appendChild(wrap);
  canvas.addEventListener("click", ev => {
    const n = poseOf(latestState)?.n_frames;
    if (!n || !rounds.length) return;
    const { left, width } = track(canvas);
    const target = ((ev.clientX - canvas.getBoundingClientRect().left - left) / Math.max(1, width)) * (n - 1);
    seekFrame(rounds.reduce((a, b) => (Math.abs(b.bf - target) < Math.abs(a.bf - target) ? b : a)).bf);
  });
}

// The scrubber's track inside the canvas, in css px: the strip's x matches the scrubber thumb's (the thumb's centre
// travels the input's width minus the thumb, THUMB_PX). The whole canvas when the scrubber can't be measured.
const THUMB_PX = 16;
function track(canvas) {
  const c = canvas.getBoundingClientRect(), s = document.getElementById("scrubber")?.getBoundingClientRect();
  if (!s || !s.width) return { left: 0, width: c.width };
  return { left: s.left - c.left + THUMB_PX / 2, width: s.width - THUMB_PX };
}

function drawTimeline(state) {
  const cv = document.getElementById("re-timeline");
  if (!cv) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.max(1, cv.getBoundingClientRect().width), cssH = Math.max(1, cv.getBoundingClientRect().height);
  if (cv.width !== Math.round(cssW * dpr)) cv.width = Math.round(cssW * dpr);
  if (cv.height !== Math.round(cssH * dpr)) cv.height = Math.round(cssH * dpr);
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, cssW, cssH);
  const n = poseOf(state)?.n_frames;
  if (!n) return;
  const { left, width } = track(cv);
  const x = f => left + (f / Math.max(1, n - 1)) * width;
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let lastLabelEnd = -Infinity;
  for (const r of rounds) {
    const v = verdictOf(r.roll.pitch);
    ctx.fillStyle = r.roll.noface ? C.noface : v === "na" ? C.gated : v === "down" ? C.down : C.up;
    const x0 = x(r.sf), w = Math.max(3, x(r.ef) - x0);
    ctx.fillRect(x0, 18, w, cssH - 22);
    // the angle at the bottom above each roll, skipped where it would overlap the previous one
    const text = r.roll.pitch != null ? `${Math.round(r.roll.pitch)}°` : r.roll.noface ? "no face" : "—";
    const tw = ctx.measureText(text).width, cx = x0 + w / 2;
    if (cx - tw / 2 > lastLabelEnd + 3) { ctx.fillText(text, cx, 3); lastLabelEnd = cx + tw / 2; }
  }
  ctx.strokeStyle = C.playhead;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x(state.frame), 0); ctx.lineTo(x(state.frame), cssH); ctx.stroke();
}

export const RollEyesRule = {
  id: "roll_eyes",
  label: "Roll eyes (eyes up in the roll)",
  requiresVideo,
  requires,
  mount,
  update,
  draw,
};
