// Frontal (angle model) lens — the MODEL-curated frontal set as a player: one
// clip at a time, its skeleton looping, a next button. No video, no Drive
// folder, nothing to pick.
//
// The hand-curated frontal set (../shared/frontal_set.js) is 24 videos picked
// by eye. This lens steps through what the boxer_facing_angle model finds when
// asked the same question of every BlazePose round on the Drive: every clip of
// at least 5 s in which 90% of the frames have the boxer within ±22.5° of
// chest-to-camera (the model's own 0° bucket; a frame with no pose counts as
// not frontal). Spans come out of the all-maximal-scoring-segments algorithm
// (Ruzzo & Tompa 1999) on frontal − 0.9, so every clip's aggregate density is
// above 90% and it starts and ends on a frontal frame — the exporter's
// docstring measures this against the window-union and gap-bridging
// alternatives.
//
// Data: lens_data/frontal_auto/index.json (the clip list) and, per clip,
// clips/<id>.json — the clip's own COCO-17 skeleton (normalized x,y as uint16,
// visibility as uint8, base64), the video's width/height for the aspect, and
// the per-frame facing angle. Written by cornerman-backend ml/frontal_auto.py:
//   cd ~/code/cornerman-backend && python -m ml.frontal_auto
// (15-20 min for the model pass; `--from-angles` re-segments and re-writes the
// clip files in seconds).
//
// THE PLAYER. This lens IS the view: it takes over the stage (the same hiding
// CSS as bladedness_frames, living inside #stage-extras so a lens switch
// undoes it) and animates the current clip's skeleton on its own canvas with
// its own clock — the viewer's <video> machinery is not involved. ◀ ▶ (keys
// P / N) step to the previous / next clip in the list's current order (sort +
// filter); Space pauses, ← → then step frames; the speed control slows the
// loop. Bones turn green while the frame is inside the ±22.5° band, a compass
// shows the model's angle, and a strip under the canvas shows which frames of
// the clip are in the band. The list on the right selects any clip directly.

import { drawSkeleton } from "../../skeleton.js";

const DATA = "./lens_data/frontal_auto/";

const COLOR_IN     = "#7adf7a";   // green  — facing within the band
const COLOR_OUT    = "#888";      // grey   — pose, but outside the band
const COLOR_NOPOSE = "#3a3a3a";   // dark   — no pose
const COLOR_MISS   = "#ff5d6c";
const COLOR_FRAME  = "#3ad9e0";   // cyan   — playhead
const COLOR_CLIP   = "#b48cff";   // purple — the clip / current row
const COLOR_HAND   = "#ffd24a";   // yellow — hand-curated

// ── the index ───────────────────────────────────────────────────────────────

let index = null, indexError = null;
fetch(DATA + "index.json", { cache: "no-store" })
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(j => { index = j; })
  .catch(err => { indexError = err.message || String(err); })
  .finally(() => { if (root) { rebuildVisible(); renderAll(); if (cur >= 0) showClip(cur); } });

const band = () => index?.params?.band_deg ?? 22.5;
const inBand = d => Number.isFinite(d) && Math.abs(d) <= band();

// ── clips: fetch + decode ───────────────────────────────────────────────────

const clipCache = new Map();   // id → { status, data, error }

function b64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// { n, fps, width, height, xy: Float32Array(n*17*2) normalized, conf: Float32Array(n*17), deg: Float32Array(n) }
function decodeClip(j) {
  const raw = b64(j.xy_b64);
  const u16 = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const xy = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) xy[i] = u16[i] / 65535;
  const c8 = b64(j.conf_b64);
  const conf = new Float32Array(c8.length);
  for (let i = 0; i < c8.length; i++) conf[i] = c8[i] / 255;
  const deg = new Float32Array(j.n).fill(NaN);
  (j.deg || []).forEach((v, i) => { if (v != null) deg[i] = v; });
  return { n: j.n, fps: j.fps || 30, width: j.width || 1080, height: j.height || 1920, xy, conf, deg, meta: j };
}

function ensureClip(c) {
  if (!c) return null;
  if (clipCache.has(c.id)) return clipCache.get(c.id);
  const rec = { status: "loading", data: null, error: null };
  clipCache.set(c.id, rec);
  fetch(DATA + "clips/" + encodeURIComponent(c.id) + ".json", { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(j => { rec.status = "ok"; rec.data = decodeClip(j); if (visible[cur] === c) startClip(); })
    .catch(err => { rec.status = "error"; rec.error = err.message || String(err); renderInfo(); });
  return rec;
}

// ── list order + current clip ───────────────────────────────────────────────

const UI_KEY = "cornerman.frontal_auto.v2";
const ui = { sort: "video", outsideOnly: false, speed: 1, lastId: null };
try { Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || "{}")); } catch {}
function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch {} }

let visible = [];
let cur = -1;

function rebuildVisible() {
  if (!index) { visible = []; cur = -1; return; }
  const prev = visible[cur] || (ui.lastId ? index.clips.find(c => c.id === ui.lastId) : null);
  let clips = index.clips.slice();
  if (ui.outsideOnly) clips = clips.filter(c => !c.in_hand_set);
  const by = {
    video:    (a, b) => a.stem.localeCompare(b.stem) || a.round - b.round || a.start_frame - b.start_frame,
    duration: (a, b) => b.duration_sec - a.duration_sec,
    frontal:  (a, b) => b.frontal_frac - a.frontal_frac || b.duration_sec - a.duration_sec,
    angle:    (a, b) => (a.mean_abs_deg ?? 99) - (b.mean_abs_deg ?? 99),
    hand:     (a, b) => (a.in_hand_set - b.in_hand_set) || a.hand_frac - b.hand_frac || b.duration_sec - a.duration_sec,
  };
  visible = clips.sort(by[ui.sort] || by.video);
  cur = prev ? visible.indexOf(prev) : -1;
  if (cur < 0 && visible.length) cur = 0;
}

// ── the player ──────────────────────────────────────────────────────────────

let root = null;         // our DOM inside #stage-extras (null when not mounted)
let canvas = null, strip = null;
let activeState = null;
let playing = true;
let frame = 0;
let clock = { t0: 0, f0: 0 };      // wall time of frame f0, for the running clock
let rafHandle = 0;
let listKey = null;

const curClip = () => visible[cur] || null;
const curData = () => { const r = curClip() && clipCache.get(curClip().id); return r?.status === "ok" ? r.data : null; };

function showClip(i, { keepPlaying = true } = {}) {
  if (!visible.length) return;
  cur = ((i % visible.length) + visible.length) % visible.length;
  ui.lastId = visible[cur].id; saveUi();
  frame = 0;
  listKey = null;
  if (keepPlaying) playing = true;
  const rec = ensureClip(visible[cur]);
  if (rec?.status === "ok") startClip();
  else renderAll();
  const nxt = visible[(cur + 1) % visible.length];   // prefetch the next one
  if (nxt) ensureClip(nxt);
}

function startClip() {
  const d = curData();
  if (!d || !canvas) return;
  frame = 0;
  clock = { t0: performance.now(), f0: 0 };
  sizeCanvas(d);
  renderAll();
  if (!rafHandle) rafHandle = requestAnimationFrame(tick);
}

function sizeCanvas(d) {
  const maxW = Math.max(320, (root?.querySelector("#fa-stage")?.clientWidth || 800) - 4);
  const maxH = Math.min(680, Math.max(360, window.innerHeight - 260));
  const scale = Math.min(maxW / d.width, maxH / d.height);
  const cw = Math.round(d.width * scale), ch = Math.round(d.height * scale);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  canvas.dataset.cw = cw; canvas.dataset.ch = ch;
}

function seekFrame(f, { pause = false } = {}) {
  const d = curData();
  if (!d) return;
  frame = ((f % d.n) + d.n) % d.n;
  clock = { t0: performance.now(), f0: frame };
  if (pause) playing = false;
  renderFrame();
  renderInfo();
}

function tick(now) {
  rafHandle = 0;
  if (!root || !document.contains(root)) return;        // lens switched: stop
  const d = curData();
  if (d && playing) {
    const f = Math.floor(clock.f0 + (now - clock.t0) / 1000 * d.fps * ui.speed);
    const nf = ((f % d.n) + d.n) % d.n;
    if (nf !== frame) { frame = nf; renderFrame(); renderInfo(); }
  }
  rafHandle = requestAnimationFrame(tick);
}

// ── drawing ─────────────────────────────────────────────────────────────────

function renderFrame() {
  if (!canvas) return;
  const d = curData();
  const ctx = canvas.getContext("2d");
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = +canvas.dataset.cw || canvas.width / dpr, H = +canvas.dataset.ch || canvas.height / dpr;
  ctx.fillStyle = "#0e1014";
  ctx.fillRect(0, 0, W, H);
  if (!d) {
    ctx.fillStyle = "#888"; ctx.font = "14px ui-monospace, monospace"; ctx.textAlign = "center";
    const rec = curClip() && clipCache.get(curClip().id);
    ctx.fillText(rec?.status === "error" ? `clip failed to load — ${rec.error}` : "loading clip…", W / 2, H / 2);
    ctx.textAlign = "left";
    return;
  }
  const f = Math.min(frame, d.n - 1);
  const deg = d.deg[f];

  // The skeleton, in canvas pixels. Bones green inside the band.
  const sk = new Float32Array(17 * 2), cf = d.conf.subarray(f * 17, f * 17 + 17);
  for (let j = 0; j < 17; j++) { sk[j * 2] = d.xy[(f * 17 + j) * 2] * W; sk[j * 2 + 1] = d.xy[(f * 17 + j) * 2 + 1] * H; }
  const pose = { skeleton: sk, conf: cf, n_frames: 1 };
  drawSkeleton(ctx, pose, 0, {
    boneColor: inBand(deg) ? "rgba(122,223,122,0.85)" : "rgba(255,255,255,0.7)",
    boneWidth: 3, jointRadius: 4, minConf: 0.3,
  });

  // Compass, top-right: up = chest to camera, right = facing image-right.
  const R = 26, cx = W - R - 14, cy = R + 14;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath(); ctx.roundRect(cx - R - 8, cy - R - 8, 2 * R + 16, 2 * R + 16 + 20, 6); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  const b = band() * Math.PI / 180;
  ctx.fillStyle = "rgba(122,223,122,0.25)";
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, -Math.PI / 2 - b, -Math.PI / 2 + b); ctx.closePath(); ctx.fill();
  if (Number.isFinite(deg)) {
    const a = deg * Math.PI / 180;
    ctx.strokeStyle = inBand(deg) ? COLOR_IN : "#fff"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(a) * R * 0.9, cy - Math.cos(a) * R * 0.9); ctx.stroke();
  }
  ctx.font = "600 13px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.fillStyle = Number.isFinite(deg) ? (inBand(deg) ? COLOR_IN : "#fff") : "#888";
  ctx.fillText(Number.isFinite(deg) ? `${deg >= 0 ? "+" : ""}${deg.toFixed(0)}°` : "no pose", cx, cy + R + 4);
  ctx.restore();

  // Frame / time, bottom-left.
  const c = curClip();
  ctx.save();
  ctx.font = "13px ui-monospace, monospace"; ctx.textBaseline = "bottom";
  const t = `frame ${f + 1}/${d.n} · src ${fmtTime(c.start_sec + f / d.fps)} · ${playing ? "▶" : "⏸"} ${ui.speed}x`;
  const tw = ctx.measureText(t).width;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath(); ctx.roundRect(8, H - 30, tw + 16, 24, 5); ctx.fill();
  ctx.fillStyle = "#ddd";
  ctx.fillText(t, 16, H - 12);
  ctx.restore();

  drawStrip(d, f);
}

// The strip under the canvas: every frame of the clip, in band / out / no pose.
function drawStrip(d, f) {
  if (!strip) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.max(1, strip.getBoundingClientRect().width), cssH = 14;
  if (strip.width !== Math.round(cssW * dpr)) strip.width = Math.round(cssW * dpr);
  if (strip.height !== Math.round(cssH * dpr)) strip.height = Math.round(cssH * dpr);
  const ctx = strip.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const colW = cssW / d.n;
  for (let i = 0; i < d.n; i++) {
    const v = d.deg[i];
    ctx.fillStyle = !Number.isFinite(v) ? COLOR_NOPOSE : inBand(v) ? COLOR_IN : COLOR_OUT;
    ctx.fillRect(i * colW, 0, colW + 0.5, cssH);
  }
  ctx.fillStyle = COLOR_FRAME;
  ctx.fillRect(f * colW - 1, 0, 2, cssH);
}

// ── DOM ─────────────────────────────────────────────────────────────────────

function fmtTime(sec) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
function shortStem(s, max = 44) { return s.length <= max ? s : s.slice(0, max - 1) + "…"; }

function renderAll() { renderParams(); renderInfo(); renderList(); renderFrame(); }

function renderParams() {
  const el = root?.querySelector("#fa-params");
  if (!el) return;
  if (indexError) {
    el.innerHTML = `<span style="color:${COLOR_MISS}">frontal_auto/index.json failed to load — ${indexError}.</span>
      Generate it with <code>python -m ml.frontal_auto</code> in cornerman-backend.`;
    return;
  }
  if (!index) { el.textContent = "Loading the clip index…"; return; }
  const p = index.params;
  el.innerHTML =
    `<code>${index.n_clips}</code> clips in <code>${index.n_videos_with_clips}</code> of ${index.n_videos} videos
     (${index.n_rounds} rounds scanned) · <code>${(index.clip_seconds / 60).toFixed(1)}</code> min
     · ≥${p.min_sec} s · ≥${Math.round(p.min_frac * 100)}% within ±${p.band_deg}° · spans by <code>${p.method || "window"}</code>
     · ${index._generated}`;
}

function renderInfo() {
  const el = root?.querySelector("#fa-info");
  if (!el) return;
  const c = curClip();
  if (!c) { el.innerHTML = `<span class="muted">${index ? "No clips match the current filter." : ""}</span>`; return; }
  const d = curData();
  el.innerHTML =
    `<span style="font-size:15px; font-weight:600; color:${COLOR_CLIP}">clip ${cur + 1} / ${visible.length}</span>
     <span style="font-weight:600" title="${c.stem.replace(/"/g, "&quot;")}">${shortStem(c.stem, 56)}</span> <code>r${c.round}</code>
     <span class="muted"> · src ${fmtTime(c.start_sec)} → ${fmtTime(c.end_sec)} · ${c.duration_sec.toFixed(1)} s
     · ${Math.round(100 * c.frontal_frac)}% frontal · mean |${c.mean_abs_deg}°|
     · ${c.in_hand_set ? `<span style="color:${COLOR_HAND}">hand-curated ${Math.round(100 * c.hand_frac)}%</span>` : "not in the hand set"}
     ${d ? ` · ${d.width}×${d.height}` : ""}</span>`;
  const play = root.querySelector("#fa-play");
  if (play) play.textContent = playing ? "⏸" : "▶";
}

function renderList() {
  const listEl = root?.querySelector("#fa-list"), countEl = root?.querySelector("#fa-count");
  if (!listEl) return;
  const key = `${ui.sort}|${ui.outsideOnly}|${cur}|${visible.length}`;
  if (key === listKey) return;
  listKey = key;
  const nVid = new Set(visible.map(c => c.stem)).size;
  countEl.textContent = `${visible.length} clips · ${nVid} videos`;
  let lastStem = null;
  listEl.innerHTML = visible.map((c, i) => {
    const here = i === cur;
    const head = ui.sort === "video" && c.stem !== lastStem
      ? `<div style="margin-top:6px; font-weight:600; color:${c.in_hand_set ? COLOR_HAND : "#ddd"}"
              title="${c.stem.replace(/"/g, "&quot;")}">${shortStem(c.stem, 40)}
           ${c.in_hand_set ? `<span class="muted small" style="font-weight:400">· hand set</span>` : ""}</div>` : "";
    lastStem = c.stem;
    return head + `<div class="fa-clip" data-i="${i}" style="cursor:pointer; padding:2px 4px; border-bottom:1px solid var(--border);
              border-left:3px solid ${here ? COLOR_CLIP : "transparent"}; ${here ? "background:rgba(255,255,255,0.08)" : ""}">
        <span class="muted small">${i + 1}.</span>
        ${ui.sort !== "video" ? `<span title="${c.stem.replace(/"/g, "&quot;")}">${shortStem(c.stem, 24)}</span> ` : ""}
        <code>r${c.round}</code> · ${fmtTime(c.start_sec)} · <code>${c.duration_sec.toFixed(1)}</code> s
        · ${Math.round(100 * c.frontal_frac)}% · |${c.mean_abs_deg}°|
      </div>`;
  }).join("") || `<p class="muted small">No clips match.</p>`;
  listEl.querySelectorAll(".fa-clip").forEach(row => row.addEventListener("click", () => showClip(+row.dataset.i)));
  listEl.querySelector(".fa-clip[style*='rgba(255,255,255,0.08)']")?.scrollIntoView({ block: "nearest" });
}

// The canvas is sized to the stage when a clip starts; follow the window too.
window.addEventListener("resize", () => {
  if (!root || !document.contains(root)) return;
  const d = curData();
  if (d) { sizeCanvas(d); renderFrame(); }
});

// Keys: ours while the lens is mounted, and kept from the viewer's own handler
// (which would act on the empty <video>). Lens modules evaluate before
// viewer.js, so this listener runs first.
document.addEventListener("keydown", e => {
  if (!root || !document.contains(root)) return;
  if (activeState?.rule !== FrontalAutoRule) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  const d = curData();
  switch (e.key) {
    case "n": case "N": showClip(cur + 1); break;
    case "p": case "P": showClip(cur - 1); break;
    case " ": playing = !playing; if (playing) clock = { t0: performance.now(), f0: frame }; renderInfo(); renderFrame(); break;
    case "ArrowRight": if (d) seekFrame(frame + 1, { pause: true }); break;
    case "ArrowLeft":  if (d) seekFrame(frame - 1, { pause: true }); break;
    case "]": if (d) seekFrame(frame + 10, { pause: true }); break;
    case "[": if (d) seekFrame(frame - 10, { pause: true }); break;
    default: return;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
});

export const FrontalAutoRule = {
  id: "frontal_auto",
  label: "Frontal (angle model, auto-curated)",
  standalone: true,

  mount(host, state) {
    activeState = state;
    host.innerHTML = `<h2>Frontal (angle model)</h2><p class="hint">This lens lives on the stage.</p>`;
    const slot = document.getElementById("stage-extras");
    if (!slot) return;
    slot.innerHTML = "";

    // This lens IS the view — the same takeover as bladedness_frames, living
    // inside #stage-extras so the viewer's lens switch undoes it.
    const takeover = document.createElement("style");
    takeover.textContent = `
      #stage > *:not(#stage-extras) { display:none !important; }
      #side { display:none !important; }
      .layout { display:block !important; }
      #stage { width:100% !important; max-width:none !important; padding:0 !important; background:none !important; }
      #stage-extras { margin-top:0 !important; }
      #fa-root button { font-size:13px; padding:4px 10px; }
      #fa-root select { font-size:12px; }
    `;
    slot.appendChild(takeover);

    root = document.createElement("div");
    root.id = "fa-root";
    root.style.cssText = "margin-top:12px;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px";
    root.innerHTML = `
      <div id="fa-params" class="muted small" style="margin-bottom:6px"></div>
      <div style="display:flex; gap:14px; align-items:flex-start">
        <div id="fa-stage" style="flex:1; min-width:0">
          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-bottom:6px">
            <button id="fa-prev" type="button" title="Previous clip (P)">◀ prev</button>
            <button id="fa-play" type="button" title="Play / pause (Space)">⏸</button>
            <button id="fa-next" type="button" title="Next clip (N)">next ▶</button>
            <label class="small">speed
              <select id="fa-speed">
                <option value="0.25">0.25x</option><option value="0.5">0.5x</option>
                <option value="1">1x</option><option value="2">2x</option>
              </select></label>
            <span id="fa-info" style="font-size:13px; line-height:1.5"></span>
          </div>
          <canvas id="fa-canvas" style="display:block; background:#0e1014; border-radius:6px"></canvas>
          <canvas id="fa-strip" style="display:block; width:100%; height:14px; margin-top:6px; cursor:pointer"></canvas>
          <div class="muted small" style="margin-top:4px">
            <span style="color:${COLOR_IN}">green</span> = facing within the band ·
            <span style="color:${COLOR_OUT}">grey</span> = outside ·
            <span style="color:${COLOR_NOPOSE}">dark</span> = no pose ·
            <kbd>N</kbd>/<kbd>P</kbd> next/prev · <kbd>Space</kbd> pause · <kbd>←</kbd><kbd>→</kbd> frames · click the strip to seek
          </div>
        </div>
        <div style="width:340px; flex:none">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:12px; margin-bottom:4px">
            <label>order
              <select id="fa-sort">
                <option value="video">by video</option>
                <option value="duration">longest first</option>
                <option value="frontal">most frontal first</option>
                <option value="angle">straightest first</option>
                <option value="hand">outside the hand set first</option>
              </select></label>
            <label><input type="checkbox" id="fa-outside"> outside the hand set only</label>
          </div>
          <div id="fa-count" class="muted small" style="margin-bottom:4px"></div>
          <div id="fa-list" style="font-size:12px; max-height:70vh; overflow:auto"></div>
        </div>
      </div>`;
    slot.appendChild(root);
    canvas = root.querySelector("#fa-canvas");
    strip = root.querySelector("#fa-strip");

    root.querySelector("#fa-sort").value = ui.sort;
    root.querySelector("#fa-outside").checked = ui.outsideOnly;
    root.querySelector("#fa-speed").value = String(ui.speed);
    root.querySelector("#fa-sort").addEventListener("change", e => { ui.sort = e.target.value; saveUi(); rebuildVisible(); listKey = null; renderAll(); });
    root.querySelector("#fa-outside").addEventListener("change", e => {
      ui.outsideOnly = e.target.checked; saveUi(); const before = curClip(); rebuildVisible(); listKey = null;
      if (curClip() !== before) showClip(cur); else renderAll();
    });
    root.querySelector("#fa-speed").addEventListener("change", e => {
      ui.speed = parseFloat(e.target.value) || 1; saveUi(); clock = { t0: performance.now(), f0: frame }; renderInfo(); renderFrame();
    });
    root.querySelector("#fa-prev").addEventListener("click", () => showClip(cur - 1));
    root.querySelector("#fa-next").addEventListener("click", () => showClip(cur + 1));
    root.querySelector("#fa-play").addEventListener("click", () => {
      playing = !playing; if (playing) clock = { t0: performance.now(), f0: frame }; renderInfo(); renderFrame();
    });
    strip.addEventListener("click", e => {
      const d = curData(); if (!d) return;
      const r = strip.getBoundingClientRect();
      seekFrame(Math.round((e.clientX - r.left) / Math.max(1, r.width) * (d.n - 1)), { pause: true });
    });

    playing = true;
    rebuildVisible();
    renderAll();
    if (cur >= 0) showClip(cur);
    if (!rafHandle) rafHandle = requestAnimationFrame(tick);
  },

  update(state) { activeState = state; },
  draw() {},
};
