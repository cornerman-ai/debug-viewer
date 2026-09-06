// Frontal (angle model) lens — the MODEL-curated frontal set as a player: one
// clip at a time on the real footage, its skeleton overlaid, looping, a next
// button. Nothing to pick: the lens loads each clip's video and round itself.
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
// THE SCREEN IS THE SPAN. While this lens is active the page hides everything
// that is about choosing footage — the picker card's Drive / cache / video /
// round / Firebase / on-device sections (the lens dropdown stays, and the
// Drive connect section comes back when the folder is not connected), the
// stage's own video + round mirrors, the side panel — and shows the current
// clip on the footage with the skeleton overlay, the viewer's play / speed /
// scrubber controls, and a bar with ◀ prev / next ▶ and the clip's facts. The
// full clip list sits folded under the player for jumping around.
//
// Data: lens_data/frontal_auto/index.json (the clip list) and, per clip,
// clips/<id>.json — the clip's own COCO-17 skeleton (normalized x,y as uint16,
// visibility as uint8, base64), the video's width/height, and the per-frame
// facing angle. Written by cornerman-backend ml/frontal_auto.py:
//   cd ~/code/cornerman-backend && python -m ml.frontal_auto
// (15-20 min for the model pass; `--from-angles` re-segments and re-writes the
// clip files in seconds).
//
// WHEN THE DRIVE LIST IS READ. The viewer mounts a lens BEFORE it repopulates
// the video dropdown for it, so at mount time the dropdown still holds the
// previous lens's filtered list (the Slips lens leaves 24 videos in it). The
// "is this clip's video on the Drive?" decision therefore runs a tick after
// mount, and a MutationObserver on the dropdown re-runs it whenever the list
// changes — the Drive index also arrives asynchronously after a page load —
// so a clip that started as skeleton-only switches to its footage the moment
// the video shows up.
//
// TWO WAYS TO SHOW A CLIP. With the Drive folder connected the lens loads the
// clip's video + round by driving the viewer's own video and round selects
// (the same two selects bladedness's gotoRound drives), then loops the clip on
// the real footage with the viewer's skeleton overlay: update() runs on every
// displayed frame and seeks back to the clip start once the frame passes its
// end. Without the Drive folder (the hosted site, a machine without the
// grant), or for a clip whose video is not in the index, it falls back to
// playing the clip's own exported skeleton on a canvas of its own, with its
// own clock. Either way ◀ ▶ (keys P / N) step through the list in its current
// order (sort + filter), Space pauses, ← → step frames, and the list on the
// right selects any clip directly. The side panel is hidden while this lens
// is active (the bladedness_frames takeover, undone by the lens switch); in
// the skeleton fallback the video player is hidden too.

import { drawSkeleton } from "../../skeleton.js";
import { normStem } from "../shared/segment_set.js";

const DATA = "./lens_data/frontal_auto/";

const COLOR_IN     = "#7adf7a";   // green  — facing within the band / inside the clip
const COLOR_OUT    = "#888";      // grey   — pose, but outside the band
const COLOR_NOPOSE = "#3a3a3a";   // dark   — no pose
const COLOR_MISS   = "#ff5d6c";   // red    — outside the clip
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

// { n, fps, width, height, xy (normalized), conf, deg }
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
  return { n: j.n, fps: j.fps || 30, width: j.width || 1080, height: j.height || 1920, xy, conf, deg };
}

function ensureClip(c) {
  if (!c) return null;
  if (clipCache.has(c.id)) return clipCache.get(c.id);
  const rec = { status: "loading", data: null, error: null };
  clipCache.set(c.id, rec);
  fetch(DATA + "clips/" + encodeURIComponent(c.id) + ".json", { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(j => { rec.status = "ok"; rec.data = decodeClip(j); if (curClip() === c && mode === "skeleton") startSkeleton(); else renderAll(); })
    .catch(err => { rec.status = "error"; rec.error = err.message || String(err); renderAll(); });
  return rec;
}

// ── list order + current clip ───────────────────────────────────────────────

const UI_KEY = "cornerman.frontal_auto.v2";
const ui = { sort: "video", outsideOnly: false, speed: 1, lastId: null };   // speed: the skeleton fallback's clock
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

const curClip = () => visible[cur] || null;
const curData = () => { const r = curClip() && clipCache.get(curClip().id); return r?.status === "ok" ? r.data : null; };

// ── the viewer's video: is the clip's round loaded, and where is the clip ───

let activeState = null;
const video = () => document.getElementById("video");

// The Drive option for this clip's video, if the folder is connected and the
// video is in it. The select lists every video with a cache for this lens.
function driveOption(c) {
  const vsel = document.getElementById("video-pick");
  if (!vsel || !c) return null;
  const want = normStem(c.stem);
  return [...vsel.options].find(o => o.value && normStem(o.value.replace(/\.[^.]+$/, "")) === want) || null;
}

// { s, e, n } — the clip in the loaded round's frames, or null when that round
// is not the loaded one. Same frame count as the export ⇒ frames directly,
// otherwise the seconds via the viewer's convention.
function clipInLoaded(state, c) {
  const pose = state && (state.poseV6 || state.pose);
  if (!pose || !c || !state.cacheBasename) return null;
  if (normStem(state.cacheBasename) !== normStem(c.stem) || state.cacheRound !== c.round) return null;
  const n = pose.n_frames, fps = pose.fps || state.fps || 30;
  const rinfo = index?.rounds?.[`${c.stem}|r${c.round}`];
  let s, e;
  if (rinfo && rinfo.n_frames === n) { s = c.start_frame; e = c.end_frame; }
  else {
    const startFrame = Math.floor(Number(pose.start_sec || 0) * fps);
    s = Math.floor(c.start_sec * fps) - startFrame; e = Math.floor(c.end_sec * fps) - startFrame;
  }
  if (e < 0 || s > n - 1) return null;
  return { s: Math.max(0, s), e: Math.min(n - 1, e), n };
}

function seekTo(f) {
  const slider = document.getElementById("scrubber");
  if (!slider) return;
  slider.value = f;
  slider.dispatchEvent(new Event("input"));
}
// Load the clip's video + round through the viewer's selects. Resolves true
// once that round is the loaded one. Event-driven, not polled: the viewer
// remounts this lens on every round load and calls update() on every redraw,
// and both poke `pendingCheck`; a MutationObserver watches the round dropdown
// for the clip's round to appear. (Polling with chained timers stalls in a
// background tab, where Chrome throttles them to once a minute.)
let pending = null;
let pendingCheck = null;
function loadClipRound(c) {
  const opt = driveOption(c);
  if (!opt) return Promise.resolve(false);
  note(`Loading ${shortStem(c.stem)} r${c.round}…`);
  const vsel = document.getElementById("video-pick");
  if (vsel.value !== opt.value) { vsel.value = opt.value; vsel.dispatchEvent(new Event("change")); }
  const rsel = document.getElementById("round-select");
  return new Promise(resolve => {
    let done = false, roundPicked = false;
    const finish = ok => { if (done) return; done = true; mo?.disconnect(); clearTimeout(timer); pendingCheck = null; resolve(ok); };
    const check = () => {
      if (done) return;
      if (clipInLoaded(activeState, c)) { note(""); return finish(true); }
      // The video's first round loads on its own; if it is not the clip's,
      // pick the clip's round once the dropdown offers it.
      if (!roundPicked && rsel && [...rsel.options].some(o => o.value === String(c.round) && !o.disabled)
          && rsel.value !== String(c.round)) {
        roundPicked = true;
        rsel.value = String(c.round); rsel.dispatchEvent(new Event("change"));
      }
    };
    pendingCheck = check;
    const mo = rsel ? new MutationObserver(check) : null;
    mo?.observe(rsel, { childList: true, attributes: true, subtree: true });
    const timer = setTimeout(() => {
      note(clipInLoaded(activeState, c) ? "" : `${shortStem(c.stem)} r${c.round} did not load from the Drive folder.`);
      finish(!!clipInLoaded(activeState, c));
    }, 25000);
    check();
  });
}

// ── the player ──────────────────────────────────────────────────────────────

let root = null, takeoverStage = null, canvas = null, strip = null;
let mode = "video";                 // "video" (real footage + overlay) | "skeleton" (own canvas)
let looping = true;
let playing = true;                 // skeleton mode's own play state
let frame = 0;                      // skeleton mode's frame
let clock = { t0: 0, f0: 0 };
let rafHandle = 0;
let listKey = null;

function showClip(i) {
  if (!visible.length) return;
  cur = ((i % visible.length) + visible.length) % visible.length;
  const c = visible[cur];
  ui.lastId = c.id; saveUi();
  listKey = null;
  ensureClip(c);                                        // strip + compass (+ the fallback's skeleton)
  const nxt = visible[(cur + 1) % visible.length];
  if (nxt) ensureClip(nxt);

  // Real footage when the clip's round is already loaded (by hand, or by us)
  // or its video is in the Drive index; the exported skeleton otherwise.
  if (clipInLoaded(activeState, c) || driveOption(c)) {
    setMode("video");
    if (clipInLoaded(activeState, c)) { startVideoLoop(c); return; }
    pending = c;
    renderAll();
    loadClipRound(c).then(ok => {
      if (pending !== c) return;                        // moved on meanwhile
      pending = null;
      if (ok) startVideoLoop(c);
      else { setMode("skeleton"); startSkeleton(); }
    });
  } else {
    setMode("skeleton");
    if (!driveConnected()) note("Drive folder not connected — playing the clip's exported skeleton instead of the footage.");
    else note(`${shortStem(c.stem)} is not in the Drive index — playing its exported skeleton.`);
    startSkeleton();
  }
}

const driveConnected = () => {
  const vsel = document.getElementById("video-pick");
  return !!vsel && [...vsel.options].some(o => o.value);
};

function setMode(m) {
  mode = m;
  if (!root) return;
  // Skeleton mode hides the viewer's player and shows our canvas; video mode
  // the other way round.
  takeoverStage.disabled = m !== "skeleton";
  canvas.parentElement.style.display = m === "skeleton" ? "" : "none";
  if (m === "video" && rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = 0; }
}

function startVideoLoop(c) {
  const x = clipInLoaded(activeState, c);
  if (!x) return;
  seekTo(x.s);
  const v = video();
  if (looping && v?.paused) v.play().catch(() => { /* autoplay policy — Space starts it */ });
  renderAll();
}

function startSkeleton() {
  const d = curData();
  if (!d || !canvas) { renderAll(); return; }
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
  renderSkeletonFrame();
  renderInfo();
}

function tick(now) {
  rafHandle = 0;
  if (!root || !document.contains(root) || mode !== "skeleton") return;
  const d = curData();
  if (d && playing) {
    const f = Math.floor(clock.f0 + (now - clock.t0) / 1000 * d.fps * ui.speed);
    const nf = ((f % d.n) + d.n) % d.n;
    if (nf !== frame) { frame = nf; renderSkeletonFrame(); renderInfo(); }
  }
  rafHandle = requestAnimationFrame(tick);
}

// ── drawing: compass, strip, skeleton canvas ────────────────────────────────

function drawCompass(ctx, deg, W, s = 1) {
  const R = 26 * s, cx = W - R - 14 * s, cy = R + 14 * s;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath(); ctx.roundRect(cx - R - 8 * s, cy - R - 8 * s, 2 * R + 16 * s, 2 * R + 16 * s + 20 * s, 6 * s); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1.5 * s;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  const b = band() * Math.PI / 180;
  ctx.fillStyle = "rgba(122,223,122,0.25)";
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, -Math.PI / 2 - b, -Math.PI / 2 + b); ctx.closePath(); ctx.fill();
  if (Number.isFinite(deg)) {
    const a = deg * Math.PI / 180;
    ctx.strokeStyle = inBand(deg) ? COLOR_IN : "#fff"; ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(a) * R * 0.9, cy - Math.cos(a) * R * 0.9); ctx.stroke();
  }
  ctx.font = `600 ${Math.round(13 * s)}px ui-monospace, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.fillStyle = Number.isFinite(deg) ? (inBand(deg) ? COLOR_IN : "#fff") : "#888";
  ctx.fillText(Number.isFinite(deg) ? `${deg >= 0 ? "+" : ""}${deg.toFixed(0)}°` : "no pose", cx, cy + R + 4 * s);
  ctx.restore();
}

function drawBadge(ctx, text, color, s = 1, y = 10) {
  const fsz = Math.round(14 * s);
  ctx.save();
  ctx.font = `600 ${fsz}px ui-monospace, monospace`;
  ctx.textBaseline = "top";
  const w = ctx.measureText(text).width + 20 * s;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath(); ctx.roundRect(10 * s, y * s, w, fsz + 14 * s, 6 * s); ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, 20 * s, (y + 7) * s);
  ctx.restore();
}

// The strip under the player: every frame of the clip, in band / out / no
// pose, with the playhead at clip frame `f`.
function drawStrip(d, f) {
  if (!strip || !d) return;
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
  if (Number.isFinite(f)) { ctx.fillStyle = COLOR_FRAME; ctx.fillRect(Math.max(0, Math.min(d.n - 1, f)) * colW - 1, 0, 2, cssH); }
}

function renderSkeletonFrame() {
  if (!canvas || mode !== "skeleton") return;
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
  const sk = new Float32Array(17 * 2), cf = d.conf.subarray(f * 17, f * 17 + 17);
  for (let j = 0; j < 17; j++) { sk[j * 2] = d.xy[(f * 17 + j) * 2] * W; sk[j * 2 + 1] = d.xy[(f * 17 + j) * 2 + 1] * H; }
  drawSkeleton(ctx, { skeleton: sk, conf: cf, n_frames: 1 }, 0, {
    boneColor: inBand(deg) ? "rgba(122,223,122,0.85)" : "rgba(255,255,255,0.7)",
    boneWidth: 3, jointRadius: 4, minConf: 0.3,
  });
  drawCompass(ctx, deg, W);
  const c = curClip();
  ctx.save();
  ctx.font = "13px ui-monospace, monospace"; ctx.textBaseline = "bottom";
  const t = `skeleton only · frame ${f + 1}/${d.n} · src ${fmtTime(c.start_sec + f / d.fps)} · ${playing ? "▶" : "⏸"} ${ui.speed}x`;
  const tw = ctx.measureText(t).width;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath(); ctx.roundRect(8, H - 30, tw + 16, 24, 5); ctx.fill();
  ctx.fillStyle = "#ddd"; ctx.fillText(t, 16, H - 12);
  ctx.restore();
  drawStrip(d, f);
}

// ── DOM ─────────────────────────────────────────────────────────────────────

function fmtTime(sec) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
function shortStem(s, max = 44) { return s.length <= max ? s : s.slice(0, max - 1) + "…"; }
function note(msg) { const el = root?.querySelector("#fa-note"); if (el) el.textContent = msg; }

function renderAll() { renderParams(); renderInfo(); renderList(); if (mode === "skeleton") renderSkeletonFrame(); }

function renderParams() {
  const el = root?.querySelector("#fa-params");
  if (!el) return;
  // The Drive connect section stays visible until the folder is connected.
  document.getElementById("picker-card")?.classList.toggle("fa-drive-ok", driveConnected());
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
     · ${index._generated}${driveConnected() ? "" : ` · <span style="color:${COLOR_HAND}">Drive folder not connected: skeleton only</span>`}`;
}

function renderInfo() {
  const el = root?.querySelector("#fa-info");
  if (!el) return;
  const c = curClip();
  if (!c) { el.innerHTML = `<span class="muted">${index ? "No clips match the current filter." : ""}</span>`; return; }
  let where = "";
  if (mode === "video") {
    const x = clipInLoaded(activeState, c);
    const f = activeState?.frame ?? 0;
    where = pending === c ? `<span class="muted">· loading its video…</span>`
      : x ? `· <span style="color:${x.s <= f && f <= x.e ? COLOR_IN : COLOR_MISS}">${x.s <= f && f <= x.e ? "in the clip" : "outside the clip"}</span>
             <span class="muted">frames ${x.s}–${x.e}</span>` : "";
  }
  el.innerHTML =
    `<span style="font-size:15px; font-weight:600; color:${COLOR_CLIP}">clip ${cur + 1} / ${visible.length}</span>
     <span style="font-weight:600" title="${c.stem.replace(/"/g, "&quot;")}">${shortStem(c.stem, 52)}</span> <code>r${c.round}</code>
     <span class="muted"> · src ${fmtTime(c.start_sec)} → ${fmtTime(c.end_sec)} · ${c.duration_sec.toFixed(1)} s
     · ${Math.round(100 * c.frontal_frac)}% frontal · mean |${c.mean_abs_deg}°|
     · ${c.in_hand_set ? `<span style="color:${COLOR_HAND}">hand-curated ${Math.round(100 * c.hand_frac)}%</span>` : "not in the hand set"}</span>
     ${where}`;
  const play = root.querySelector("#fa-play");
  if (play) play.textContent = (mode === "video" ? !video()?.paused : playing) ? "⏸" : "▶";
  const loop = root.querySelector("#fa-loop");
  if (loop) loop.textContent = looping ? "⟳ looping" : "⟳ loop off";
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

// The Drive list changed (repopulated for this lens, or the index arrived):
// a clip playing as skeleton-only because its video "was not there" gets
// another look.
let listObserver = null;
function watchDriveList() {
  const vsel = document.getElementById("video-pick");
  if (!vsel || listObserver) return;
  listObserver = new MutationObserver(() => {
    if (!root || !document.contains(root) || activeState?.rule !== FrontalAutoRule) return;
    const c = curClip();
    if (c && mode === "skeleton" && !pending && driveOption(c)) queueMicrotask(() => showClip(cur));
    else if (mode === "skeleton") renderParams();
  });
  listObserver.observe(vsel, { childList: true });
}

window.addEventListener("resize", () => {
  if (!root || !document.contains(root) || mode !== "skeleton") return;
  const d = curData();
  if (d) { sizeCanvas(d); renderSkeletonFrame(); }
});

// Keys. N / P always; Space and the arrows only in skeleton mode (in video
// mode the viewer's own handler drives its player). Lens modules evaluate
// before viewer.js, so this listener runs first and can stop the viewer's.
document.addEventListener("keydown", e => {
  if (!root || !document.contains(root) || activeState?.rule !== FrontalAutoRule) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "n" || e.key === "N") { showClip(cur + 1); e.preventDefault(); e.stopImmediatePropagation(); return; }
  if (e.key === "p" || e.key === "P") { showClip(cur - 1); e.preventDefault(); e.stopImmediatePropagation(); return; }
  if (mode !== "skeleton") return;
  const d = curData();
  switch (e.key) {
    case " ": playing = !playing; if (playing) clock = { t0: performance.now(), f0: frame }; renderInfo(); renderSkeletonFrame(); break;
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

  skeletonStyle() {
    return { boneColor: "rgba(255,255,255,0.3)", boneWidth: 2, jointRadius: 3 };
  },

  mount(host, state) {
    activeState = state;
    host.innerHTML = `<h2>Frontal (angle model)</h2><p class="hint">This lens lives on the stage.</p>`;
    const slot = document.getElementById("stage-extras");
    if (!slot) return;
    slot.innerHTML = "";

    // Takeover, living inside #stage-extras so the viewer's lens switch undoes
    // it: the side panel always; the video player only in skeleton mode.
    const base = document.createElement("style");
    base.textContent = `
      /* Nothing about choosing footage: the picker card keeps only the lens
         row (and the Drive connect section while the folder is not connected),
         the stage loses its video / round mirrors and the meta line, the side
         panel goes. */
      #picker-card > *:not(.lens-row):not(#drive-section) { display:none !important; }
      #picker-card.fa-drive-ok > #drive-section { display:none !important; }
      #picker-card { padding-bottom:6px !important; }
      .stage-pick, #meta { display:none !important; }
      #side { display:none !important; }
      .layout { display:block !important; }
      #stage { width:100% !important; max-width:none !important; padding:0 !important; background:none !important; }
      #stage-extras { margin-top:0 !important; }
      #fa-root button { font-size:13px; padding:4px 10px; }
      #fa-root select { font-size:12px; }
    `;
    slot.appendChild(base);
    takeoverStage = document.createElement("style");
    takeoverStage.textContent = `#stage > *:not(#stage-extras) { display:none !important; }`;
    slot.appendChild(takeoverStage);

    root = document.createElement("div");
    root.id = "fa-root";
    root.style.cssText = "margin-top:12px;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px";
    root.innerHTML = `
      <div id="fa-params" class="muted small" style="margin-bottom:6px"></div>
      <div style="display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap">
        <div id="fa-stage" style="flex:1; min-width:320px">
          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-bottom:6px">
            <button id="fa-prev" type="button" title="Previous clip (P)">◀ prev</button>
            <button id="fa-play" type="button" title="Play / pause (Space)">⏸</button>
            <button id="fa-next" type="button" title="Next clip (N)">next ▶</button>
            <button id="fa-loop" type="button" title="Loop the clip / play through"></button>
            <span id="fa-info" style="font-size:13px; line-height:1.5"></span>
          </div>
          <div id="fa-note" class="muted small" style="min-height:1.2em"></div>
          <div id="fa-canvas-wrap"><canvas id="fa-canvas" style="display:block; background:#0e1014; border-radius:6px"></canvas></div>
          <canvas id="fa-strip" style="display:block; width:100%; height:14px; margin-top:6px; cursor:pointer"></canvas>
          <div class="muted small" style="margin-top:4px">
            <span style="color:${COLOR_IN}">green</span> = facing within the band ·
            <span style="color:${COLOR_OUT}">grey</span> = outside ·
            <span style="color:${COLOR_NOPOSE}">dark</span> = no pose ·
            <kbd>N</kbd>/<kbd>P</kbd> next/prev · <kbd>Space</kbd> pause · <kbd>←</kbd><kbd>→</kbd> frames · click the strip to seek
          </div>
        </div>
        <details style="width:100%; flex:none">
          <summary class="muted small" style="cursor:pointer">all clips <span id="fa-count"></span> — click one to jump to it</summary>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:12px; margin:6px 0 4px">
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
          <div id="fa-list" style="font-size:12px; max-height:50vh; overflow:auto"></div>
        </details>
      </div>`;
    slot.appendChild(root);
    canvas = root.querySelector("#fa-canvas");
    strip = root.querySelector("#fa-strip");

    root.querySelector("#fa-sort").value = ui.sort;
    root.querySelector("#fa-outside").checked = ui.outsideOnly;
    root.querySelector("#fa-sort").addEventListener("change", e => { ui.sort = e.target.value; saveUi(); rebuildVisible(); listKey = null; renderAll(); });
    root.querySelector("#fa-outside").addEventListener("change", e => {
      ui.outsideOnly = e.target.checked; saveUi(); const before = curClip(); rebuildVisible(); listKey = null;
      if (curClip() !== before) showClip(cur); else renderAll();
    });
    root.querySelector("#fa-prev").addEventListener("click", () => showClip(cur - 1));
    root.querySelector("#fa-next").addEventListener("click", () => showClip(cur + 1));
    root.querySelector("#fa-loop").addEventListener("click", () => {
      looping = !looping;
      if (looping && curClip() && mode === "video") startVideoLoop(curClip()); else renderInfo();
    });
    root.querySelector("#fa-play").addEventListener("click", () => {
      if (mode === "video") { const v = video(); if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); }
      else { playing = !playing; if (playing) clock = { t0: performance.now(), f0: frame }; renderSkeletonFrame(); }
      renderInfo();
    });
    strip.addEventListener("click", e => {
      const d = curData(); if (!d) return;
      const r = strip.getBoundingClientRect();
      const f = Math.round((e.clientX - r.left) / Math.max(1, r.width) * (d.n - 1));
      if (mode === "video") { const x = clipInLoaded(activeState, curClip()); if (x) seekTo(x.s + f); }
      else seekFrame(f, { pause: true });
    });

    rebuildVisible();
    setMode(mode);
    renderAll();
    watchDriveList();
    // Resume where we were — a tick later, once the viewer has repopulated the
    // video dropdown for this lens (it mounts first, repopulates second). A
    // remount happens on every round load (the viewer rebuilds the panel), so
    // do not restart a load that is in flight; a round the user loaded by hand
    // jumps to its first clip, and a hand-loaded round with no clip is left
    // alone rather than swapped for another video.
    const mountedRoot = root;
    setTimeout(() => {
      if (root !== mountedRoot || !document.contains(root)) return;
      const c = curClip();
      if (!c) return;
      const st = activeState;
      const loaded = !!(st?.poseV6 || st?.pose);
      const here = loaded ? visible.findIndex(k => clipInLoaded(st, k)) : -1;
      if (pending) { setMode("video"); renderAll(); pendingCheck?.(); }
      else if (here >= 0 && !clipInLoaded(st, c)) showClip(here);
      else if (here >= 0 && mode === "video") renderAll();
      else if (loaded && here < 0) {
        setMode("video"); renderAll();
        note(`The loaded round has no auto clip — press next for clip ${cur + 1} (${shortStem(c.stem, 30)} r${c.round}).`);
      }
      else showClip(cur);
    }, 0);
  },

  // Video mode: the loop, the strip and the info follow the viewer's frames.
  update(state) {
    activeState = state;
    if (pending) pendingCheck?.();
    if (mode !== "video" || !root) return;
    const c = curClip();
    const x = clipInLoaded(state, c);
    const f = state.frame;
    if (x && looping) {
      const v = video();
      if (v && !v.paused && (f >= x.e || f < x.s - 1)) seekTo(x.s);
    }
    renderInfo();
    const d = curData();
    if (d && x) drawStrip(d, f - x.s);
  },

  // Video mode: red frame outside the clip, a badge, the compass.
  draw(ctx, state) {
    if (mode !== "video") return;
    const c = curClip();
    const x = clipInLoaded(state, c);
    const s = state.renderScale || 1;
    const f = state.frame;
    const inNow = !!(x && x.s <= f && f <= x.e);
    if (!inNow) {
      ctx.save();
      ctx.strokeStyle = COLOR_MISS; ctx.lineWidth = 4 * s; ctx.globalAlpha = 0.85;
      ctx.strokeRect(2 * s, 2 * s, ctx.canvas.width - 4 * s, ctx.canvas.height - 4 * s);
      ctx.restore();
    }
    const label = !c ? "NO CLIP" : !x ? (pending ? "LOADING THE CLIP'S VIDEO…" : "CURRENT CLIP IS IN ANOTHER ROUND")
      : inNow ? `CLIP ${cur + 1}/${visible.length}` : `OUTSIDE CLIP ${cur + 1}/${visible.length}`;
    drawBadge(ctx, label, inNow ? COLOR_IN : COLOR_MISS, s);
    const d = curData();
    const deg = d && x && inNow ? d.deg[Math.min(d.n - 1, f - x.s)] : NaN;
    drawCompass(ctx, deg, ctx.canvas.width, s);
    if (x) {
      const fsz = Math.round(14 * s);
      const bx = 20 * s, by = 10 * s + fsz + 20 * s, bw = 220 * s, bh = 6 * s;
      const px = fr => bx + ((fr - x.s) / Math.max(1, x.e - x.s)) * bw;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath(); ctx.roundRect(bx - 10 * s, by - 6 * s, bw + 20 * s, bh + 12 * s, 6 * s); ctx.fill();
      ctx.fillStyle = COLOR_CLIP; ctx.globalAlpha = 0.9; ctx.fillRect(bx, by, bw, bh);
      ctx.globalAlpha = 1; ctx.fillStyle = COLOR_FRAME;
      ctx.fillRect(px(Math.max(x.s, Math.min(x.e, f))) - 1 * s, by - 2 * s, 2 * s, bh + 4 * s);
      ctx.restore();
    }
  },
};
