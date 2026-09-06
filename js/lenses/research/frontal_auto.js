// Frontal (angle model) lens — the MODEL-curated frontal set, one clip at a
// time, looped.
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
// alternatives. Data: lens_data/frontal_auto/index.json +
// angles/<stem>_r<N>.json, written by cornerman-backend ml/frontal_auto.py:
//   cd ~/code/cornerman-backend && python -m ml.frontal_auto
// (15-20 min for the model pass; `--from-angles` re-segments in seconds).
//
// ONE CLIP ON LOOP. The current clip plays in a loop; ◀ ▶ (keys P / N) step to
// the previous / next clip in the list order you chose (sort + filter). When
// the next clip sits in another video or round, the lens loads it by driving
// the Drive video + round selects the way you would — so the Drive folder has
// to be connected for cross-video stepping; within the loaded round it just
// seeks. Loading a round by hand jumps to that round's first clip. Space
// pauses the loop where it is, ← → then step frames. The loop rides on the
// viewer's own playback: update() runs on every displayed frame and seeks back
// to the clip start once the frame passes its end.
//
// With a round loaded the lens also shows the facing-angle trace, a timeline
// (per-frame in/out of the band · auto clips · hand-curated spans, so the two
// curations can be compared), a compass HUD and a red frame outside the
// current clip.
//
// Time base: clips are stored in cache FRAMES of their BlazePose round plus
// source seconds off that round's _pts.npy. When the loaded cache is that same
// round (same frame count) the frames are used directly; otherwise the seconds
// are converted with the viewer's convention (../shared/segment_set.js).

import { normStem, resolveRanges } from "../shared/segment_set.js";
import { hasSkeleton, matchEntry } from "../shared/frontal_set.js";

const DATA = "./lens_data/frontal_auto/";

const COLOR_IN     = "#7adf7a";   // green  — facing within the band / inside the clip
const COLOR_OUT    = "#888";      // grey   — pose, but outside the band
const COLOR_NOPOSE = "#3a3a3a";   // dark   — no pose
const COLOR_MISS   = "#ff5d6c";   // red    — outside the clip / video not in the set
const COLOR_FRAME  = "#3ad9e0";   // cyan   — current frame
const COLOR_CLIP   = "#b48cff";   // purple — auto clips
const COLOR_HAND   = "#ffd24a";   // yellow — hand-curated spans

// ── the index ───────────────────────────────────────────────────────────────

let index = null, indexError = null;
let byStem = null;   // Map<normStem(stem), { stem, rounds: Map<round, clip[]> }>

fetch(DATA + "index.json", { cache: "no-store" })
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(j => {
    index = j;
    byStem = new Map();
    for (const c of j.clips || []) {
      const k = normStem(c.stem);
      if (!byStem.has(k)) byStem.set(k, { stem: c.stem, rounds: new Map() });
      const v = byStem.get(k);
      if (!v.rounds.has(c.round)) v.rounds.set(c.round, []);
      v.rounds.get(c.round).push(c);
    }
  })
  .catch(err => { indexError = err.message || String(err); })
  .finally(() => { window.dispatchEvent(new Event("lens-filter-changed")); refresh(); });

// Pending ⇒ hide (re-fires once the index lands). Failed ⇒ show everything.
function isAutoVideo(base) {
  if (indexError) return true;
  if (!byStem) return false;
  return byStem.has(normStem(base));
}
function isAutoRound(slot, ctx) {
  if (!hasSkeleton(slot)) return false;
  if (indexError) return true;
  if (!byStem) return false;
  const v = byStem.get(normStem(ctx?.base || ""));
  if (!v) return true;
  return ctx?.round == null || v.rounds.has(ctx.round);
}

// ── per-round facing angles (the trace) ─────────────────────────────────────

const angles = new Map();   // "stem|r" → { status, data, error }

function ensureAngles(stem, r) {
  const key = `${stem}|${r}`;
  if (!stem || r == null || angles.has(key)) return angles.get(key) || null;
  const rec = { status: "loading", data: null, error: null };
  angles.set(key, rec);
  fetch(DATA + "angles/" + encodeURIComponent(`${stem}_r${r}`) + ".json", { cache: "no-store" })
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then(j => { rec.status = "ok"; rec.data = j; refresh(); })
    .catch(err => { rec.status = "error"; rec.error = err.message || String(err); refresh(); });
  return rec;
}

// ── the loaded round against the set ────────────────────────────────────────

let cache = { pose: null };

function roundInfo(state) {
  const pose = state.poseV6 || state.pose;
  if (!pose) return null;
  const stem = state.cacheBasename || null, r = state.cacheRound;
  const v = byStem?.get(normStem(stem || ""));
  const rinfo = v ? index?.rounds?.[`${v.stem}|r${r}`] : null;
  const ang = v ? ensureAngles(v.stem, r) : null;
  const angData = ang?.status === "ok" ? ang.data : null;
  const handEntry = matchEntry(stem);
  const memo = `${!!v}|${rinfo ? 1 : 0}|${angData ? 1 : 0}|${handEntry?.stem ?? ""}`;
  if (cache.pose === pose && cache.stem === stem && cache.r === r && cache.memo === memo) return cache;

  const n = pose.n_frames, fps = pose.fps || state.fps || 30;
  const startSec = Number(pose.start_sec || 0);
  const startFrame = Math.floor(startSec * fps);
  const sameCache = !!(rinfo && rinfo.n_frames === n);
  const clamp = f => Math.max(0, Math.min(n - 1, f));
  const toFrames = c => sameCache
    ? { s: c.start_frame, e: c.end_frame }
    : { s: Math.floor(c.start_sec * fps) - startFrame, e: Math.floor(c.end_sec * fps) - startFrame };
  const clips = (v?.rounds.get(r) || []).map(c => ({ ...toFrames(c), clip: c }))
    .filter(x => x.e >= 0 && x.s <= n - 1)
    .map(x => ({ ...x, s: clamp(x.s), e: clamp(x.e) }));

  const deg = new Float32Array(n).fill(NaN);
  if (angData) {
    const a = angData;
    for (let f = 0; f < n; f++) {
      const fa = sameCache ? f : Math.round((startSec + f / fps - (a.start_sec || 0)) * (a.fps || fps));
      const v2 = a.deg[fa];
      if (fa >= 0 && fa < a.deg.length && v2 != null) deg[f] = v2;
    }
  }

  const hand = handEntry
    ? resolveRanges(handEntry.spans, { n, fps, startSec, roundIdx: r })
    : { inSpan: new Uint8Array(n), ranges: [], nIn: 0 };

  cache = { pose, stem, r, memo, n, fps, startSec, v, rinfo, sameCache, clips,
            deg, angStatus: ang?.status || (v ? "none" : "no-video"), angError: ang?.error,
            hand, handEntry };
  return cache;
}

const band = () => index?.params?.band_deg ?? 22.5;
const inBand = d => Number.isFinite(d) && Math.abs(d) <= band();

// Frames of clip `c` in the loaded round, or null if that round is not loaded.
function clipFrames(info, c) {
  if (!info || !info.v || !c || info.v.stem !== c.stem || info.r !== c.round) return null;
  return info.clips.find(x => x.clip === c) || null;
}

// ── small helpers ───────────────────────────────────────────────────────────

function fmtTime(sec) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
function shortStem(s, max = 44) { return s.length <= max ? s : s.slice(0, max - 1) + "…"; }
function refresh() { document.getElementById("video")?.dispatchEvent(new Event("seeked")); }
function seekTo(f) {
  const slider = document.getElementById("scrubber");
  if (!slider) return;
  slider.value = f;
  slider.dispatchEvent(new Event("input"));
}
const video = () => document.getElementById("video");
const wait = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(cond, ms) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) { if (cond()) return true; await wait(100); }
  return cond();
}
function note(msg) { const el = host?.querySelector("#fa-note"); if (el) el.textContent = msg; }

// ── the clip list order + the current clip ──────────────────────────────────

const UI_KEY = "cornerman.frontal_auto.v1";
const ui = { sort: "video", outsideOnly: false };
try { Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || "{}")); } catch {}
function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch {} }

let visible = [];        // the clips in list order (sort + filter applied)
let cur = -1;            // index into `visible`
let looping = true;
let pending = null;      // clip whose video/round is being loaded
let lastPose = null;     // to notice a round the user loaded by hand
let activeState = null;
let host = null;
let listKey = null;

function rebuildVisible() {
  if (!index) { visible = []; cur = -1; return; }
  const prev = visible[cur] || null;
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
  listKey = null;
}

// Drive the video + round selects the way the user would. Resolves true once
// the clip's round is the loaded one. Needs the Drive folder connected — the
// manual and Firebase paths have no video list.
async function loadClipRound(c) {
  const vsel = document.getElementById("video-pick");
  const want = normStem(c.stem);
  const opt = vsel && [...vsel.options].find(o => o.value && normStem(o.value.replace(/\.[^.]+$/, "")) === want);
  if (!opt) { note("Connect the Drive folder (top of the page) to load clips from other videos."); return false; }
  note(`Loading ${shortStem(c.stem)} r${c.round}…`);
  if (vsel.value !== opt.value) { vsel.value = opt.value; vsel.dispatchEvent(new Event("change")); }
  const rsel = document.getElementById("round-select");
  const roundReady = () => rsel && [...rsel.options].some(o => o.value === String(c.round) && !o.disabled);
  if (!await waitFor(roundReady, 20000)) { note(`r${c.round} of that video is not offered here.`); return false; }
  if (rsel.value !== String(c.round)) { rsel.value = String(c.round); rsel.dispatchEvent(new Event("change")); }
  const loaded = () => !!clipFrames(activeState && roundInfo(activeState), c);
  if (!await waitFor(loaded, 20000)) { note("The round did not finish loading."); return false; }
  note("");
  return true;
}

// Make clip i (wrapping) the current one: seek to its start if its round is
// loaded, otherwise load that round first. `play` null keeps the play state;
// a cross-video step keeps looping if the loop is on (a fresh video starts
// paused).
function select(i, { play = null } = {}) {
  if (!visible.length) return;
  cur = ((i % visible.length) + visible.length) % visible.length;
  const c = visible[cur];
  listKey = null;
  const start = () => {
    const x = clipFrames(activeState && roundInfo(activeState), c);
    if (!x) return;
    seekTo(x.s);
    const v = video();
    const wantPlay = play == null ? (v && !v.paused) : play;
    if (wantPlay && v?.paused) v.play().catch(() => { /* autoplay policy — Space starts it */ });
    refresh();
  };
  if (clipFrames(activeState && roundInfo(activeState), c)) { start(); return; }
  pending = c;
  refresh();
  loadClipRound(c).then(ok => {
    if (pending !== c) return;          // the user moved on meanwhile
    pending = null;
    if (ok) { lastPose = (activeState.poseV6 || activeState.pose) || null; start(); }
    else refresh();
  });
}

document.addEventListener("keydown", e => {
  if (!host || activeState?.rule !== FrontalAutoRule) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "n" || e.key === "N") { select(cur + 1, { play: looping ? true : null }); e.preventDefault(); }
  if (e.key === "p" || e.key === "P") { select(cur - 1, { play: looping ? true : null }); e.preventDefault(); }
});

// ── lens ────────────────────────────────────────────────────────────────────

export const FrontalAutoRule = {
  id: "frontal_auto",
  label: "Frontal (angle model, auto-curated)",
  standalone: true,

  skeletonStyle() {
    return { boneColor: "rgba(255,255,255,0.25)", boneWidth: 1.5, jointRadius: 3 };
  },

  requiresVideo: isAutoVideo,
  requires: isAutoRound,

  mount(_host, state) {
    host = _host;
    activeState = state;
    cache = { pose: null };
    listKey = null;
    host.innerHTML = `
      <h2>Frontal (angle model)</h2>
      <p class="hint">
        The <strong>model-curated</strong> frontal set: every BlazePose round on the
        Drive scored by the boxer_facing_angle model, every clip of at least
        <span id="fa-minsec">5</span> s in which <span id="fa-minfrac">90</span>% of the
        frames have the boxer within ±<span id="fa-band">22.5</span>° of chest-to-camera.
        One clip loops at a time; <kbd>N</kbd> / <kbd>P</kbd> or the buttons step through
        the list below in its current order — across videos when the Drive folder is
        connected. <kbd>Space</kbd> pauses, <kbd>←</kbd> <kbd>→</kbd> then step frames.
        <span style="color:${COLOR_IN}">green</span> = facing within the band,
        <span style="color:${COLOR_OUT}">grey</span> = outside,
        <span style="color:${COLOR_CLIP}">purple</span> = auto clip,
        <span style="color:${COLOR_HAND}">yellow</span> = hand-curated span.
      </p>
      <div id="fa-params" class="muted small" style="margin-bottom:6px"></div>

      <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin:6px 0">
        <button id="fa-prev" type="button" title="Previous clip (P)">◀ prev</button>
        <button id="fa-next" type="button" title="Next clip (N)">next ▶</button>
        <button id="fa-loop" type="button" title="Loop the current clip / play through"></button>
      </div>
      <div id="fa-note" class="muted small" style="min-height:1.2em"></div>
      <div id="fa-current" style="font-size:13px; line-height:1.6"></div>

      <h3>This round</h3>
      <div id="fa-round" style="font-size:13px; line-height:1.6"></div>
      <canvas id="fa-trace" width="320" height="110" style="display:block; margin-top:6px"></canvas>
      <div class="muted small">facing angle over the round · band shaded · auto clips purple (current outlined) · hand spans yellow</div>

      <h3>All clips <span id="fa-count" class="muted small"></span></h3>
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; font-size:12px; margin-bottom:4px">
        <label>order
          <select id="fa-sort" style="font-size:12px">
            <option value="video">by video</option>
            <option value="duration">longest first</option>
            <option value="frontal">most frontal first</option>
            <option value="angle">straightest first</option>
            <option value="hand">outside the hand set first</option>
          </select></label>
        <label><input type="checkbox" id="fa-outside"> only videos outside the hand-curated set</label>
      </div>
      <div id="fa-list" style="font-size:12px; max-height:380px; overflow:auto"></div>`;

    host.querySelector("#fa-sort").value = ui.sort;
    host.querySelector("#fa-outside").checked = ui.outsideOnly;
    host.querySelector("#fa-sort").addEventListener("change", e => { ui.sort = e.target.value; saveUi(); rebuildVisible(); refresh(); });
    host.querySelector("#fa-outside").addEventListener("change", e => { ui.outsideOnly = e.target.checked; saveUi(); rebuildVisible(); refresh(); });
    host.querySelector("#fa-prev").addEventListener("click", () => select(cur - 1, { play: looping ? true : null }));
    host.querySelector("#fa-next").addEventListener("click", () => select(cur + 1, { play: looping ? true : null }));
    host.querySelector("#fa-loop").addEventListener("click", () => {
      looping = !looping;
      if (looping && cur >= 0) select(cur, { play: true }); else refresh();
    });

    mountStageTimeline();
    if (index && !visible.length) rebuildVisible();
    this.update(state);
  },

  update(state) {
    if (!host || !state) return;
    activeState = state;
    const paramsEl = host.querySelector("#fa-params");
    const loopBtn = host.querySelector("#fa-loop");
    if (loopBtn) loopBtn.textContent = looping ? "⟳ looping" : "⟳ loop off";
    if (indexError) {
      paramsEl.innerHTML = `<span style="color:${COLOR_MISS}">frontal_auto/index.json failed to load — ${indexError}.</span>
        Generate it with <code>python -m ml.frontal_auto</code> in cornerman-backend.`;
      return;
    }
    if (!index) { paramsEl.textContent = "Loading the clip index…"; return; }
    if (!visible.length && index.clips.length) rebuildVisible();
    const p = index.params;
    host.querySelector("#fa-minsec").textContent = p.min_sec;
    host.querySelector("#fa-minfrac").textContent = Math.round(p.min_frac * 100);
    host.querySelector("#fa-band").textContent = p.band_deg;
    paramsEl.innerHTML =
      `<code>${index.n_clips}</code> clips in <code>${index.n_videos_with_clips}</code> of ${index.n_videos} videos
       (${index.n_rounds} rounds scanned) · <code>${(index.clip_seconds / 60).toFixed(1)}</code> min of footage
       · spans by <code>${p.method || "window"}</code> · generated ${index._generated}`;

    const info = roundInfo(state);
    const f = state.frame;

    // A round the user loaded by hand (or that our load just finished): if the
    // current clip is not in it, move to this round's first clip in list order.
    if (info?.v && info.pose !== lastPose && !pending) {
      lastPose = info.pose;
      if (!clipFrames(info, visible[cur])) {
        const j = visible.findIndex(c => clipFrames(info, c));
        if (j >= 0) { select(j, { play: looping }); return; }
      }
    }

    // The loop: once the frame passes the clip's end (or was scrubbed ahead of
    // its start), back to the start. Only while playing — paused is stepping.
    const c = visible[cur];
    const x = clipFrames(info, c);
    if (x && looping) {
      const v = video();
      if (v && !v.paused && (f >= x.e || f < x.s - 1)) seekTo(x.s);
    }

    renderCurrent(info, c, x, f);
    renderRound(info, f);
    renderList(info);
    drawTrace(host.querySelector("#fa-trace"), info, f, x);
    drawTimeline(document.getElementById("fa-timeline"), info, f, x);
  },

  draw(ctx, state) {
    const info = roundInfo(state);
    if (!info) return;
    const s = state.renderScale || 1;
    const f = state.frame;
    const c = visible[cur];
    const x = clipFrames(info, c);
    const inNow = !!(x && x.s <= f && f <= x.e);

    if (!inNow) {
      ctx.save();
      ctx.strokeStyle = COLOR_MISS;
      ctx.lineWidth = 4 * s;
      ctx.globalAlpha = 0.85;
      ctx.strokeRect(2 * s, 2 * s, ctx.canvas.width - 4 * s, ctx.canvas.height - 4 * s);
      ctx.restore();
    }

    const fsz = Math.round(14 * s);
    const label = !info.v ? "VIDEO NOT IN THE AUTO SET"
      : !x ? (pending ? "LOADING THE NEXT CLIP…" : "CURRENT CLIP IS IN ANOTHER ROUND")
      : inNow ? `CLIP ${cur + 1}/${visible.length}` : `OUTSIDE CLIP ${cur + 1}/${visible.length}`;
    ctx.save();
    ctx.font = `600 ${fsz}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    const w = ctx.measureText(label).width + 20 * s;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath(); ctx.roundRect(10 * s, 10 * s, w, fsz + 14 * s, 6 * s); ctx.fill();
    ctx.fillStyle = inNow ? COLOR_IN : COLOR_MISS;
    ctx.fillText(label, 20 * s, 17 * s);
    ctx.restore();

    // Compass HUD, top-right: the model's facing angle for this frame. Up =
    // chest to camera, right = facing image-right; the band is the green wedge.
    const d = info.deg[f];
    const R = 26 * s, cx = ctx.canvas.width - R - 14 * s, cy = R + 14 * s;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath(); ctx.roundRect(cx - R - 8 * s, cy - R - 8 * s, 2 * R + 16 * s, 2 * R + 16 * s + fsz + 6 * s, 6 * s); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    const b = band() * Math.PI / 180;
    ctx.fillStyle = "rgba(122,223,122,0.25)";
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, -Math.PI / 2 - b, -Math.PI / 2 + b); ctx.closePath(); ctx.fill();
    if (Number.isFinite(d)) {
      const a = d * Math.PI / 180;
      ctx.strokeStyle = inBand(d) ? COLOR_IN : "#fff";
      ctx.lineWidth = 3 * s;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(a) * R * 0.9, cy - Math.cos(a) * R * 0.9); ctx.stroke();
    }
    ctx.font = `600 ${fsz}px ui-monospace, monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillStyle = Number.isFinite(d) ? (inBand(d) ? COLOR_IN : "#fff") : "#888";
    ctx.fillText(Number.isFinite(d) ? `${d >= 0 ? "+" : ""}${d.toFixed(0)}°`
      : info.angStatus === "loading" ? "…" : "no angle", cx, cy + R + 8 * s);
    ctx.restore();

    // Loop progress bar under the badge: where in the clip we are.
    if (x) {
      const bx = 20 * s, by = 10 * s + fsz + 20 * s, bw = 220 * s, bh = 6 * s;
      const px = fr => bx + ((fr - x.s) / Math.max(1, x.e - x.s)) * bw;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath(); ctx.roundRect(bx - 10 * s, by - 6 * s, bw + 20 * s, bh + 12 * s, 6 * s); ctx.fill();
      ctx.fillStyle = COLOR_CLIP; ctx.globalAlpha = 0.9;
      ctx.fillRect(bx, by, bw, bh);
      ctx.globalAlpha = 1; ctx.fillStyle = COLOR_FRAME;
      ctx.fillRect(px(Math.max(x.s, Math.min(x.e, f))) - 1 * s, by - 2 * s, 2 * s, bh + 4 * s);
      ctx.restore();
    }
  },
};

// ── sidebar: the current clip ───────────────────────────────────────────────

function renderCurrent(info, c, x, f) {
  const el = host.querySelector("#fa-current");
  if (!c) { el.innerHTML = `<p class="muted">No clips match the current filter.</p>`; return; }
  const state = x ? (x.s <= f && f <= x.e ? "in the clip" : f < x.s ? "before the clip" : "after the clip")
    : pending === c ? "loading its video + round…"
    : info?.v && info.v.stem === c.stem ? `in round r${c.round} of this video — press next again or pick it above`
    : "its video is not loaded — connect the Drive folder and press next / prev, or pick it in the list";
  el.innerHTML =
    `<div style="font-size:15px; font-weight:600; color:${COLOR_CLIP}">
       clip ${cur + 1} / ${visible.length}
       <span style="color:#ddd; font-weight:500" title="${c.stem.replace(/"/g, "&quot;")}">— ${shortStem(c.stem, 40)}</span>
       <code>r${c.round}</code></div>
     <div>src <code>${fmtTime(c.start_sec)}</code> → <code>${fmtTime(c.end_sec)}</code>
       · <code>${c.duration_sec.toFixed(1)}</code> s · ${Math.round(100 * c.frontal_frac)}% frontal
       · mean |${c.mean_abs_deg}°|
       · ${c.in_hand_set ? `<span style="color:${COLOR_HAND}">hand-curated ${Math.round(100 * c.hand_frac)}%</span>` : `<span class="muted">not in the hand set</span>`}</div>
     <div class="muted small">${x ? `frames <code>${x.s}</code>–<code>${x.e}</code> in this round` : ""}</div>
     <div><strong>frame ${f}</strong> · <span style="color:${x && x.s <= f && f <= x.e ? COLOR_IN : COLOR_MISS}">${state}</span></div>`;
}

// ── sidebar: this round ─────────────────────────────────────────────────────

function renderRound(info, f) {
  const el = host.querySelector("#fa-round");
  if (!info) { el.innerHTML = `<p class="muted">No round loaded.</p>`; return; }
  if (!info.v) {
    el.innerHTML = `<div style="color:${COLOR_MISS}; font-weight:600">This video has no auto clip</div>
      <div class="muted small">stem <code>${info.stem || "—"}</code> · ${index.rounds?.[`${info.stem}|r${info.r}`]
        ? `frontal on ${Math.round(100 * index.rounds[`${info.stem}|r${info.r}`].frontal_frac)}% of this round's frames`
        : "not among the scanned rounds"}</div>`;
    return;
  }
  const ri = info.rinfo;
  const d = info.deg[f];
  el.innerHTML =
    `<div><span style="color:${info.clips.length ? COLOR_IN : COLOR_MISS}; font-weight:600">
       ${info.clips.length} auto clip${info.clips.length === 1 ? "" : "s"}</span> in this round
       ${ri ? `<span class="muted small">· frontal on ${Math.round(100 * ri.frontal_frac)}% of ${ri.n_frames} frames ·
        pose on ${Math.round(100 * ri.detected_frac)}%${info.sameCache ? "" : " · <em>different cache than the export — clips mapped by time</em>"}</span>` : ""}</div>
     <div class="muted small">${info.handEntry ? `hand-curated: ${info.hand.nIn} of ${info.n} frames in a span` : "not in the hand-curated set"}</div>
     <div><strong>frame ${f}</strong> ·
       ${Number.isFinite(d)
         ? `<span style="color:${inBand(d) ? COLOR_IN : COLOR_OUT}; font-weight:600">${d >= 0 ? "+" : ""}${d.toFixed(0)}°</span>
            <span class="muted small">${inBand(d) ? "within the band" : "outside the band"}</span>`
         : `<span class="muted">${info.angStatus === "loading" ? "loading angles…" : info.angStatus === "error" ? "angles not exported for this round" : "no pose"}</span>`}</div>`;
}

// ── sidebar: all clips ──────────────────────────────────────────────────────

function renderList(info) {
  const listEl = host.querySelector("#fa-list");
  const countEl = host.querySelector("#fa-count");
  const key = `${ui.sort}|${ui.outsideOnly}|${cur}|${visible.length}`;
  if (key === listKey) return;
  listKey = key;
  const nVid = new Set(visible.map(c => c.stem)).size;
  countEl.textContent = `${visible.length} clips · ${nVid} videos · click to select`;
  let lastStem = null;
  listEl.innerHTML = visible.map((c, i) => {
    const here = i === cur;
    const head = ui.sort === "video" && c.stem !== lastStem
      ? `<div style="margin-top:6px; font-weight:600; color:${c.in_hand_set ? COLOR_HAND : "#ddd"}"
              title="${c.stem.replace(/"/g, "&quot;")}">${shortStem(c.stem, 52)}
           ${c.in_hand_set ? `<span class="muted small" style="font-weight:400">· in the hand set</span>` : ""}</div>` : "";
    lastStem = c.stem;
    return head + `<div class="fa-clip" data-i="${i}" style="cursor:pointer; padding:2px 4px; border-bottom:1px solid var(--border);
              border-left:3px solid ${here ? COLOR_CLIP : "transparent"}; ${here ? "background:rgba(255,255,255,0.08)" : ""}">
        <span class="muted small">${i + 1}.</span>
        ${ui.sort !== "video" ? `<span title="${c.stem.replace(/"/g, "&quot;")}">${shortStem(c.stem, 30)}</span> ` : ""}
        <code>r${c.round}</code> · ${fmtTime(c.start_sec)} → ${fmtTime(c.end_sec)} ·
        <code>${c.duration_sec.toFixed(1)}</code> s · ${Math.round(100 * c.frontal_frac)}% · |${c.mean_abs_deg}°|
        ${c.in_hand_set ? `· <span style="color:${COLOR_HAND}">hand ${Math.round(100 * c.hand_frac)}%</span>` : ""}
      </div>`;
  }).join("") || `<p class="muted small">No clips match.</p>`;
  listEl.querySelectorAll(".fa-clip").forEach(row => {
    row.addEventListener("click", () => select(+row.dataset.i, { play: looping ? true : null }));
  });
  listEl.querySelector(".fa-clip[style*='rgba(255,255,255,0.08)']")?.scrollIntoView({ block: "nearest" });
}

// ── trace ───────────────────────────────────────────────────────────────────

function drawTrace(canvas, info, frame, curX) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!info) return;
  const N = info.n;
  const xOf = f => (f / Math.max(1, N - 1)) * W;
  const yOf = d => H / 2 - (d / 180) * (H / 2 - 4);

  ctx.fillStyle = "rgba(122,223,122,0.18)";
  ctx.fillRect(0, yOf(band()), W, yOf(-band()) - yOf(band()));
  ctx.fillStyle = COLOR_CLIP; ctx.globalAlpha = 0.25;
  for (const x of info.clips) ctx.fillRect(xOf(x.s), 0, Math.max(1.5, xOf(x.e) - xOf(x.s)), H);
  ctx.globalAlpha = 0.9; ctx.fillStyle = COLOR_HAND;
  for (const r of info.hand.ranges) ctx.fillRect(xOf(r.s), 0, Math.max(1.5, xOf(r.e) - xOf(r.s)), 3);
  ctx.globalAlpha = 1;
  if (curX) {
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
    ctx.strokeRect(xOf(curX.s), 1, Math.max(2, xOf(curX.e) - xOf(curX.s)), H - 2);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath(); ctx.moveTo(0, yOf(0)); ctx.lineTo(W, yOf(0)); ctx.stroke();
  for (let f = 0; f < N; f++) {
    const d = info.deg[f];
    if (!Number.isFinite(d)) continue;
    ctx.fillStyle = inBand(d) ? COLOR_IN : "rgba(255,255,255,0.7)";
    ctx.fillRect(xOf(f) - 0.5, yOf(d) - 1, 1.5, 2);
  }
  if (info.angStatus !== "ok") {
    ctx.fillStyle = "#888"; ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(info.angStatus === "loading" ? "loading angles…" : "no per-frame angles for this round", 6, 12);
  }
  ctx.strokeStyle = COLOR_FRAME; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 0); ctx.lineTo(xOf(frame), H); ctx.stroke();
}

// ── below-video timeline ────────────────────────────────────────────────────

const TL_LABEL_W = 56;

function mountStageTimeline() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:12px;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px";
  const label = document.createElement("div");
  label.className = "muted small";
  label.style.cssText = "margin-bottom:6px";
  label.textContent = "Facing per frame · auto clips (current outlined) · hand-curated spans (click a clip to select it, elsewhere to seek)";
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = "fa-timeline";
  canvas.style.cssText = "display:block;width:100%;height:80px";
  canvas.width = 800; canvas.height = 80;
  wrap.appendChild(canvas);
  slot.appendChild(wrap);
  canvas.addEventListener("click", e => {
    const info = activeState && roundInfo(activeState);
    const N = info?.n;
    if (!N) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - TL_LABEL_W) / Math.max(1, rect.width - TL_LABEL_W - 4);
    const f = Math.max(0, Math.min(N - 1, Math.round(ratio * (N - 1))));
    const hit = info.clips.find(x => x.s <= f && f <= x.e);
    const j = hit ? visible.indexOf(hit.clip) : -1;
    if (j >= 0) select(j); else seekTo(f);
  });
}

function drawTimeline(canvas, info, frame, curX) {
  if (!canvas) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.max(1, canvas.getBoundingClientRect().width);
  const cssH = Math.max(1, canvas.getBoundingClientRect().height);
  if (canvas.width !== Math.round(cssW * dpr))  canvas.width  = Math.round(cssW * dpr);
  if (canvas.height !== Math.round(cssH * dpr)) canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssH;
  ctx.clearRect(0, 0, W, H);
  if (!info) return;
  const N = info.n;
  const xOf = f => TL_LABEL_W + (f / Math.max(1, N - 1)) * (W - TL_LABEL_W - 4);
  const colW = Math.max(1, (W - TL_LABEL_W - 4) / Math.max(1, N - 1));
  ctx.font = "10px ui-monospace, monospace";

  const laneH = 18, gap = 6, top = 4;
  const lanes = [["facing", top], ["auto", top + laneH + gap], ["hand", top + 2 * (laneH + gap)]];
  for (const [name, y] of lanes) {
    ctx.fillStyle = name === "auto" ? COLOR_CLIP : name === "hand" ? COLOR_HAND : "#aaa";
    ctx.fillText(name, 6, y + laneH / 2 + 3);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(TL_LABEL_W, y, W - TL_LABEL_W - 4, laneH);
  }
  for (let f = 0; f < N; f++) {
    const d = info.deg[f];
    ctx.fillStyle = !Number.isFinite(d) ? COLOR_NOPOSE : inBand(d) ? COLOR_IN : COLOR_OUT;
    ctx.globalAlpha = Number.isFinite(d) && inBand(d) ? 0.9 : 0.5;
    ctx.fillRect(xOf(f), lanes[0][1], colW + 0.5, laneH);
  }
  ctx.fillStyle = COLOR_CLIP;
  for (const x of info.clips) {
    ctx.globalAlpha = curX ? (x === curX ? 1 : 0.45) : 0.9;
    ctx.fillRect(xOf(x.s), lanes[1][1], Math.max(2, xOf(x.e) - xOf(x.s)), laneH);
  }
  ctx.globalAlpha = 1;
  if (curX) {
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
    ctx.strokeRect(xOf(curX.s) - 1, lanes[1][1] - 1, Math.max(2, xOf(curX.e) - xOf(curX.s)) + 2, laneH + 2);
  }
  ctx.globalAlpha = 0.9; ctx.fillStyle = COLOR_HAND;
  for (const r of info.hand.ranges) ctx.fillRect(xOf(r.s), lanes[2][1], Math.max(2, xOf(r.e) - xOf(r.s)), laneH);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = COLOR_FRAME; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 1); ctx.lineTo(xOf(frame), H - 1); ctx.stroke();
}
