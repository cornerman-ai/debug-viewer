// Slip exploration lens — the MODEL-curated frontal set as a player: one clip
// at a time on the real footage, its skeleton overlaid, looping, a next button.
// Nothing to pick: the lens loads each clip's video and round itself. Built to
// eyeball slips on frontal footage (the Sheet's slip labels and the center-line
// rule ride on the strip and the body — below); it replaced the per-round
// "Slips (curated frontal)" lens on 2026-09-06.
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
// full clip list sits folded under the player for jumping around; ◀◀ / ▶▶ video
// (Shift+P / Shift+N) jump to the first span of the previous / next video. The viewer's
// own round-wide scrubber and frame label are hidden too: the strip under the
// player is the timeline, and it spans the clip only — click or drag it to
// seek, ⏮ ⏭ step frames, the speed control slows the loop.
//
// ON THE STRIP AND THE BODY (2026-09-06). The Sheet's labels for the clip —
// via ../shared/slip_labels.js, the labeler web app — sit in a second lane of
// the strip: lead / rear slips in their colours, straight punches coloured by
// the head-off-center-line rule from ./head_offcenter.js (did the head come off
// the line at the punch? green yes, red no — ../shared/center_line.js), other
// punches grey. The rule's quantity is drawn on the body every frame: the hip
// line, the head point and the offset between them, in torso heights, and a
// badge names the slip or the punch the frame sits in with its verdict. No
// axiality gate here: the whole set faces the camera by construction.
//
// WHAT SAYS "SLIP"? Under the strip, four traces of the center-line quantity
// over the clip, each with its own threshold: off (the head's distance from
// the hip line), dev (its deviation from the boxer's own resting position),
// travel (the range of off inside 0.5 s) and vel (its change over 0.1 s).
// Labeled slips are shaded in the traces so you can see which formulation
// lines up with what the labelers called a slip; frames past a threshold are
// marked under each trace and the badge names the frame's live values. The
// numbers behind the defaults: ml/research/defense/slip_rule/.
//
// Data: lens_data/frontal_auto/index.json (the clip list) and, per clip,
// clips/<id>.json — the clip's own COCO-17 skeleton (normalized x,y as uint16,
// visibility as uint8, base64), the video's width/height, and the per-frame
// facing angle. Written by cornerman-backend ml/frontal_auto.py:
//   cd ~/code/cornerman-backend && python -m ml.frontal_auto
// (15-20 min for the model pass; `--from-angles` re-segments and re-writes the
// clip files in seconds).
//
// THE NEXT TEN CLIPS ARE WARMED WHILE YOU WATCH THIS ONE. Switching videos was
// slow because a Drive for Desktop file in streaming mode is a placeholder
// until it is read, and the first read downloads all of it. So when a clip
// starts, the lens walks the next PREFETCH_AHEAD clips in list order and, one
// video at a time (nearest first, no bandwidth fight with the current clip),
// asks the viewer to drain each new video's file and cache files
// (window.cornermanPrefetchVideo — bytes read and discarded, so Drive fetches
// them now), pulls its Sheet rows into sheet-labels.js's cache, and fetches
// every clip's skeleton file. Jumping elsewhere re-plans from there. The bar
// shows how far the warming got.
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
import { COLOR as SLIP, SLIP_KIND, ensureSlipLabels, isPunchLabel, slipLabelState } from "../shared/slip_labels.js";
import { computeCenterLine, centerLineSignals, isStraightType, straightVerdict } from "../shared/center_line.js";
import { fetchCombinedRowsForStem } from "../../sheet-labels.js";

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

const UI_KEY = "cornerman.slip_exploration.v1";
const ui = { sort: "video", outsideOnly: false, speed: 1, lastId: null, muted: false,
             thr: { off: 0.22, dev: 0.24, travel: 0.50, vel: 0.12 } };   // speed: the skeleton fallback's clock
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

// ── the Sheet's labels + the center-line rule, for the current clip ─────────

let labelMemo = { rows: null, clipId: null, fps: null, items: null };

// The clip's slips and punches in CLIP frames: [{ kind: "slip", side, s, e } |
// { kind: "punch", label, straight, s, e }]. Label times are source seconds,
// the clip's frame 0 is at clip.start_sec (its round's pts clock).
function clipLabels(c, d) {
  if (!c || !d) return null;
  ensureSlipLabels(c.stem);
  const lab = slipLabelState();
  if (lab.status !== "ok" || normStem(lab.key) !== normStem(c.stem)) return null;
  if (labelMemo.rows === lab.rows && labelMemo.clipId === c.id && labelMemo.fps === d.fps) return labelMemo.items;
  const items = [];
  for (const r of lab.rows) {
    const s = Math.round((r.start_sec - c.start_sec) * d.fps), e = Math.round((r.end_sec - c.start_sec) * d.fps);
    if (e < 0 || s > d.n - 1) continue;
    const cs = Math.max(0, s), ce = Math.min(d.n - 1, e);
    if (SLIP_KIND[r.label]) items.push({ kind: "slip", side: SLIP_KIND[r.label], s: cs, e: ce, label: r.label });
    else if (isPunchLabel(r.label)) items.push({ kind: "punch", label: r.label, straight: isStraightType(r.label), s: cs, e: ce });
  }
  items.sort((a, b) => a.s - b.s);
  labelMemo = { rows: lab.rows, clipId: c.id, fps: d.fps, items };
  return items;
}

// The center line for the clip: the viewer's pose in video mode (round frames,
// `base` = the clip's first round frame), the clip's own skeleton in the
// fallback (clip frames, base 0). Points come back in the pose's pixel space.
function centerLineFor(d, state) {
  if (mode === "video") {
    const x = clipInLoaded(state, curClip());
    const m = computeCenterLine(state?.poseV6 || state?.pose);
    return m && !m.bad && x ? { m, base: x.s, w: state.pose?.width || null } : null;
  }
  if (!d) return null;
  if (!d.posePx) {
    const sk = new Float32Array(d.n * 17 * 2);
    for (let i = 0; i < d.n * 17; i++) { sk[i * 2] = d.xy[i * 2] * d.width; sk[i * 2 + 1] = d.xy[i * 2 + 1] * d.height; }
    d.posePx = { n_frames: d.n, skeleton: sk, conf: d.conf };
  }
  const m = computeCenterLine(d.posePx);
  return m && !m.bad ? { m, base: 0 } : null;
}

// Verdict per straight punch of the clip, memoized on (labels, center line).
let verdictMemo = { items: null, m: null, out: null };
function straightVerdicts(items, cl) {
  if (!items || !cl) return null;
  if (verdictMemo.items === items && verdictMemo.m === cl.m) return verdictMemo.out;
  const out = new Map();
  for (const it of items) {
    if (it.kind !== "punch" || !it.straight) continue;
    const v = straightVerdict(cl.m, it.s + cl.base, it.e + cl.base);
    if (v) out.set(it, v);
  }
  verdictMemo = { items, m: cl.m, out };
  return out;
}

const itemsAt = (items, f) => (items || []).filter(it => it.s <= f && f <= it.e);

// Draw the rule's quantity on the body: the hip line, the head point and the
// offset between them. `toX/toY` map the pose's pixels to the target canvas.
function drawCenterLine(ctx, cl, f, col, toX, toY, s = 1) {
  const m = cl.m, fr = f + cl.base;
  const hx = m.hipX[fr], hy = m.hipY[fr], hxHead = m.headX[fr], hyHead = m.headY[fr];
  if (![hx, hy, hxHead, hyHead].every(Number.isFinite)) return;
  const HX = toX(hx), HY = toY(hy), KX = toX(hxHead), KY = toY(hyHead);
  ctx.save();
  ctx.strokeStyle = COLOR_FRAME; ctx.lineWidth = 1.5 * s; ctx.setLineDash([6 * s, 6 * s]);
  ctx.beginPath(); ctx.moveTo(HX, HY + 20 * s); ctx.lineTo(HX, KY - 60 * s); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = col; ctx.lineWidth = 4 * s;
  ctx.beginPath(); ctx.moveTo(HX, KY); ctx.lineTo(KX, KY); ctx.stroke();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(KX, KY, 5 * s, 0, Math.PI * 2); ctx.fill();
  ctx.font = `${Math.round(13 * s)}px ui-monospace, monospace`; ctx.textBaseline = "bottom"; ctx.textAlign = "left";
  const v = m.off[fr];
  ctx.fillText(`${v >= 0 ? "+" : ""}${Number.isFinite(v) ? v.toFixed(2) : "—"} torso`, Math.max(HX, KX) + 10 * s, KY - 4 * s);
  ctx.restore();
}

// What the frame sits in, for the badge and the colour of the offset bar.
function frameContext(items, verdicts, f) {
  const here = itemsAt(items, f);
  const slip = here.find(it => it.kind === "slip");
  const punch = here.find(it => it.kind === "punch");
  if (slip) return { text: `${slip.side.toUpperCase()} SLIP`, color: SLIP[slip.side] };
  if (punch) {
    const v = verdicts?.get(punch);
    if (punch.straight && v) {
      return { text: `${punch.label.toUpperCase()} · head ${v.ok ? "off the line" : "on the line"} ${Math.abs(v.peak).toFixed(2)}`,
               color: v.ok ? COLOR_IN : COLOR_MISS };
    }
    return { text: punch.label.toUpperCase(), color: "#bbb" };
  }
  return null;
}

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
  prefetchAhead(cur);

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

// Warm what the next PREFETCH_AHEAD clips will need: every clip's skeleton
// file (small, all at once), and for each NEW video among them, in list order
// and one at a time, its file + cache files on the Drive and its Sheet rows
// (into sheet-labels.js's per-video cache, not the shared single-slot state
// the current clip is using). A newer call supersedes an older walk.
const PREFETCH_AHEAD = 10;
const videoWarmed = new Set(), rowsWarmed = new Set();   // per stem, separately
let warmGen = 0;
async function prefetchAhead(from) {
  const gen = ++warmGen;
  const cur0 = visible[from];
  if (!cur0 || visible.length < 2) return;
  const ahead = [];
  for (let k = 1; k <= Math.min(PREFETCH_AHEAD, visible.length - 1); k++) ahead.push(visible[(from + k) % visible.length]);
  ahead.forEach(ensureClip);
  const stems = [];
  for (const c of ahead) {
    if (normStem(c.stem) === normStem(cur0.stem) || stems.includes(c.stem)) continue;
    stems.push(c.stem);
  }
  let done = 0;
  const show = () => { const el = root?.querySelector("#fa-warm"); if (el) el.textContent = stems.length ? `· warming next videos ${done}/${stems.length}` : ""; };
  show();
  for (const stem of stems) {
    if (gen !== warmGen) return;                          // the user moved on; a newer walk runs
    if (!videoWarmed.has(stem)) {
      const opt = driveOption({ stem });                  // only when the Drive lists it
      if (opt && typeof window.cornermanPrefetchVideo === "function") {
        let ok = false;
        try { ok = await window.cornermanPrefetchVideo(opt.value); } catch { /* noted by the viewer */ }
        if (ok) videoWarmed.add(stem);
      }
    }
    if (!rowsWarmed.has(stem)) {
      try { await fetchCombinedRowsForStem(stem); rowsWarmed.add(stem); } catch { /* the lane says so when it matters */ }
    }
    if (gen !== warmGen) return;
    done++; show();
  }
}

// The first clip (in list order) of the previous / next video relative to the
// current clip's video. In "by video" order that is the neighbouring block;
// in the other orders it is the next clip along whose video differs, taken at
// that video's first appearance in the list.
function neighbourVideoIndex(dir) {
  if (!visible.length || cur < 0) return -1;
  const here = normStem(visible[cur].stem);
  for (let k = 1; k < visible.length; k++) {
    const j = ((cur + dir * k) % visible.length + visible.length) % visible.length;
    const st = normStem(visible[j].stem);
    if (st === here) continue;
    return visible.findIndex(c => normStem(c.stem) === st);
  }
  return -1;
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
  if (v) v.muted = !!ui.muted;                       // the mute choice survives clips and reloads
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

// The strip under the player: the clip's frames. Top lane: facing in band /
// out / no pose. Bottom lane: the Sheet's labels — slips in their colours,
// straights by the center-line verdict, other punches grey. Playhead at clip
// frame `f`.
function drawStrip(d, f, items = null, verdicts = null) {
  if (!strip || !d) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.max(1, strip.getBoundingClientRect().width), cssH = 26;
  if (strip.width !== Math.round(cssW * dpr)) strip.width = Math.round(cssW * dpr);
  if (strip.height !== Math.round(cssH * dpr)) strip.height = Math.round(cssH * dpr);
  const ctx = strip.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const colW = cssW / d.n, laneH = 12, gap = 2;
  for (let i = 0; i < d.n; i++) {
    const v = d.deg[i];
    ctx.fillStyle = !Number.isFinite(v) ? COLOR_NOPOSE : inBand(v) ? COLOR_IN : COLOR_OUT;
    ctx.fillRect(i * colW, 0, colW + 0.5, laneH);
  }
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(0, laneH + gap, cssW, laneH);
  if (items) {
    for (const it of items) {
      if (it.kind === "punch") {
        const v = it.straight ? verdicts?.get(it) : null;
        ctx.fillStyle = it.straight ? (v ? (v.ok ? COLOR_IN : COLOR_MISS) : "#bbb") : "#777";
        ctx.globalAlpha = it.straight ? 0.9 : 0.45;
        ctx.fillRect(it.s * colW, laneH + gap, Math.max(2, (it.e - it.s + 1) * colW), laneH);
      }
    }
    for (const it of items) {
      if (it.kind !== "slip") continue;
      ctx.fillStyle = SLIP[it.side]; ctx.globalAlpha = 0.95;
      ctx.fillRect(it.s * colW, laneH + gap, Math.max(2, (it.e - it.s + 1) * colW), laneH);
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = "#888"; ctx.font = "10px ui-monospace, monospace"; ctx.textBaseline = "middle";
    const lab = slipLabelState();
    ctx.fillText(lab.status === "loading" ? "loading the Sheet's labels…" : lab.status === "error" ? `no labels — ${lab.error}` : "labels…", 4, laneH + gap + laneH / 2);
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
  const c = curClip();
  const items = clipLabels(c, d), cl = centerLineFor(d, activeState), verdicts = straightVerdicts(items, cl);
  const fc = frameContext(items, verdicts, f);
  if (cl) drawCenterLine(ctx, cl, f, fc?.color || "rgba(255,255,255,0.6)", x => x * W / d.width, y => y * H / d.height);
  if (fc) drawBadge(ctx, fc.text, fc.color, 1, 10);
  if (cl) drawBadge(ctx, liveValues(cl, f, d.fps), "#ddd", 1, fc ? 42 : 10);
  drawCompass(ctx, deg, W);
  ctx.save();
  ctx.font = "13px ui-monospace, monospace"; ctx.textBaseline = "bottom";
  const t = `skeleton only · frame ${f + 1}/${d.n} · src ${fmtTime(c.start_sec + f / d.fps)} · ${playing ? "▶" : "⏸"} ${ui.speed}x`;
  const tw = ctx.measureText(t).width;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath(); ctx.roundRect(8, H - 30, tw + 16, 24, 5); ctx.fill();
  ctx.fillStyle = "#ddd"; ctx.fillText(t, 16, H - 12);
  ctx.restore();
  drawStrip(d, f, items, verdicts);
  drawTraces(d, f, items, cl);
}

// ── the four traces ─────────────────────────────────────────────────────────

const TRACE_ROWS = [
  { key: "off",    signed: true,  label: "off  · distance from the hip line" },
  { key: "dev",    signed: true,  label: "dev  · deviation from the resting position (3 s median)" },
  { key: "travel", signed: false, label: "travel · range of off inside 0.5 s" },
  { key: "vel",    signed: false, label: "vel  · change of off over 0.1 s" },
];

function seriesFor(cl, fps) {
  const sig = centerLineSignals(cl.m, fps);
  return sig ? { off: cl.m.off, dev: sig.dev, travel: sig.travel, vel: sig.vel } : null;
}

let lastTrace = null;
function redrawTraces() { if (lastTrace) drawTraces(...lastTrace); }

// Rows of the clip's frames; labeled slips shaded, punches faint, the threshold
// dashed (± for the signed rows), frames past it marked along the row's bottom.
function drawTraces(d, f, items, cl) {
  const canvas = root?.querySelector("#fa-traces");
  if (!canvas || !d) return;
  lastTrace = [d, f, items, cl];
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.max(1, canvas.getBoundingClientRect().width), cssH = 176;
  if (canvas.width !== Math.round(cssW * dpr)) canvas.width = Math.round(cssW * dpr);
  if (canvas.height !== Math.round(cssH * dpr)) canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const rowH = cssH / TRACE_ROWS.length, colW = cssW / d.n;
  const fps = mode === "video" ? (activeState?.pose?.fps || d.fps) : d.fps;
  const series = cl ? seriesFor(cl, fps) : null;
  ctx.font = "10px ui-monospace, monospace"; ctx.textBaseline = "top";
  TRACE_ROWS.forEach((row, ri) => {
    const y0 = ri * rowH, thr = ui.thr[row.key];
    const arr = series?.[row.key];
    // scale: signed rows ±max(0.6, thr·1.2), unsigned 0..max(0.8, thr·1.5)
    const lim = row.signed ? Math.max(0.6, thr * 1.2) : Math.max(0.8, thr * 1.5);
    const yOf = v => row.signed ? y0 + rowH / 2 - (v / lim) * (rowH / 2 - 8) : y0 + rowH - 4 - (v / lim) * (rowH - 16);
    ctx.fillStyle = "rgba(255,255,255,0.04)"; ctx.fillRect(0, y0, cssW, rowH - 1);
    if (items) {
      for (const it of items) {
        if (it.kind === "punch") { ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.fillRect(it.s * colW, y0, Math.max(1, (it.e - it.s + 1) * colW), rowH - 1); }
      }
      for (const it of items) {
        if (it.kind !== "slip") continue;
        ctx.fillStyle = SLIP[it.side]; ctx.globalAlpha = 0.22;
        ctx.fillRect(it.s * colW, y0, Math.max(1.5, (it.e - it.s + 1) * colW), rowH - 1);
        ctx.globalAlpha = 1;
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    if (row.signed) {
      ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(0, yOf(0)); ctx.lineTo(cssW, yOf(0)); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.setLineDash([4, 4]);
      for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, yOf(sgn * thr)); ctx.lineTo(cssW, yOf(sgn * thr)); ctx.stroke(); }
    } else {
      ctx.beginPath(); ctx.moveTo(0, yOf(thr)); ctx.lineTo(cssW, yOf(thr)); ctx.stroke();
    }
    ctx.setLineDash([]);
    if (arr) {
      const base = cl.base;
      ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 1.2; ctx.beginPath();
      let started = false;
      for (let i = 0; i < d.n; i++) {
        const v = arr[i + base];
        if (!Number.isFinite(v)) { started = false; continue; }
        const vv = Math.max(-lim, Math.min(lim, v));
        if (!started) { ctx.moveTo(i * colW, yOf(vv)); started = true; } else ctx.lineTo(i * colW, yOf(vv));
      }
      ctx.stroke();
      ctx.fillStyle = "#ff9e64";                      // past the threshold
      for (let i = 0; i < d.n; i++) {
        const v = arr[i + base];
        if (Number.isFinite(v) && Math.abs(v) >= thr) ctx.fillRect(i * colW, y0 + rowH - 4, colW + 0.5, 3);
      }
    }
    ctx.fillStyle = "#aaa"; ctx.fillText(row.label, 6, y0 + 3);
    const vNow = arr ? arr[f + cl.base] : NaN;
    ctx.fillStyle = Number.isFinite(vNow) && Math.abs(vNow) >= thr ? "#ff9e64" : "#ddd"; ctx.textAlign = "right";
    ctx.fillText(Number.isFinite(vNow) ? `${vNow >= 0 ? "+" : ""}${vNow.toFixed(2)}` : "—", cssW - 6, y0 + 3);
    ctx.textAlign = "left";
  });
  ctx.fillStyle = COLOR_FRAME;
  ctx.fillRect(Math.max(0, Math.min(d.n - 1, f)) * colW - 1, 0, 2, cssH);
}

// "off +0.31 · dev +0.28 · travel 0.19 · vel 0.05" for the frame's badge.
function liveValues(cl, f, fps) {
  const series = seriesFor(cl, fps);
  if (!series) return "";
  const fr = f + cl.base;
  const fmt = v => Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}` : "—";
  return `off ${fmt(series.off[fr])} · dev ${fmt(series.dev[fr])} · travel ${fmt(series.travel[fr])} · vel ${fmt(series.vel[fr])}`;
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
  const d0 = curData();
  const items = clipLabels(c, d0);
  let labelsTxt = "";
  if (items) {
    const nSlip = items.filter(i => i.kind === "slip").length;
    const straights = items.filter(i => i.kind === "punch" && i.straight);
    const cl = centerLineFor(d0, activeState), vs = straightVerdicts(items, cl);
    const ok = straights.filter(i => vs?.get(i)?.ok).length, bad = straights.filter(i => vs?.get(i) && !vs.get(i).ok).length;
    labelsTxt = ` · <span style="color:${SLIP.lead}">${nSlip} slip${nSlip === 1 ? "" : "s"}</span>
      · ${straights.length} straight${straights.length === 1 ? "" : "s"}${vs ? ` (<span style="color:${COLOR_IN}">${ok} off the line</span> / <span style="color:${COLOR_MISS}">${bad} on it</span>)` : ""}`;
  } else {
    const lab = slipLabelState();
    labelsTxt = lab.status === "loading" ? ` · <span class="muted">labels…</span>` : lab.status === "error" ? ` · <span class="muted">no Sheet labels</span>` : "";
  }
  el.innerHTML =
    `<span style="font-size:15px; font-weight:600; color:${COLOR_CLIP}">clip ${cur + 1} / ${visible.length}</span>
     <span style="font-weight:600" title="${c.stem.replace(/"/g, "&quot;")}">${shortStem(c.stem, 52)}</span> <code>r${c.round}</code>
     <span class="muted"> · src ${fmtTime(c.start_sec)} → ${fmtTime(c.end_sec)} · ${c.duration_sec.toFixed(1)} s
     · ${Math.round(100 * c.frontal_frac)}% frontal · mean |${c.mean_abs_deg}°|
     · ${c.in_hand_set ? `<span style="color:${COLOR_HAND}">hand-curated ${Math.round(100 * c.hand_frac)}%</span>` : "not in the hand set"}${labelsTxt}</span>
     ${where}`;
  const play = root.querySelector("#fa-play");
  if (play) play.textContent = (mode === "video" ? !video()?.paused : playing) ? "⏸" : "▶";
  const loop = root.querySelector("#fa-loop");
  if (loop) loop.textContent = looping ? "⟳ looping" : "⟳ loop off";
  const mute = root.querySelector("#fa-mute");
  if (mute) { mute.textContent = video()?.muted ? "🔇" : "🔊"; mute.style.display = mode === "video" ? "" : "none"; }
  const fr = root.querySelector("#fa-frame");
  if (fr) {
    const d = curData();
    let k = null;
    if (mode === "video") { const x = clipInLoaded(activeState, c); if (x) k = (activeState?.frame ?? 0) - x.s; }
    else if (d) k = frame;
    fr.innerHTML = d && k != null
      ? `clip frame <code>${Math.max(0, Math.min(d.n - 1, k)) + 1}</code> / ${d.n}
         · src <code>${fmtTime(c.start_sec + Math.max(0, Math.min(d.n - 1, k)) / d.fps)}</code>
         ${k < 0 ? `<span style="color:${COLOR_MISS}">· before the clip</span>` : k > d.n - 1 ? `<span style="color:${COLOR_MISS}">· after the clip</span>` : ""}`
      : "";
  }
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
    if (!root || !document.contains(root) || activeState?.rule !== SlipExplorationRule) return;
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
  if (!root || !document.contains(root) || activeState?.rule !== SlipExplorationRule) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "N" && e.shiftKey) { const j = neighbourVideoIndex(1); if (j >= 0) showClip(j); e.preventDefault(); e.stopImmediatePropagation(); return; }
  if (e.key === "P" && e.shiftKey) { const j = neighbourVideoIndex(-1); if (j >= 0) showClip(j); e.preventDefault(); e.stopImmediatePropagation(); return; }
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

export const SlipExplorationRule = {
  id: "slip_exploration",
  label: "Slip exploration",
  standalone: true,

  skeletonStyle() {
    return { boneColor: "rgba(255,255,255,0.3)", boneWidth: 2, jointRadius: 3 };
  },

  mount(host, state) {
    activeState = state;
    host.innerHTML = `<h2>Slip exploration</h2><p class="hint">This lens lives on the stage.</p>`;
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
      .stage-pick, #meta, .controls, #frame-label { display:none !important; }
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
            <button id="fa-vprev" type="button" title="First span of the previous video (Shift+P)">◀◀ video</button>
            <button id="fa-prev" type="button" title="Previous clip (P)">◀ prev</button>
            <button id="fa-fprev" type="button" title="Previous frame (←)">⏮</button>
            <button id="fa-play" type="button" title="Play / pause (Space)">⏸</button>
            <button id="fa-fnext" type="button" title="Next frame (→)">⏭</button>
            <button id="fa-next" type="button" title="Next clip (N)">next ▶</button>
            <button id="fa-vnext" type="button" title="First span of the next video (Shift+N)">video ▶▶</button>
            <button id="fa-loop" type="button" title="Loop the clip / play through"></button>
            <label class="small">speed
              <select id="fa-speed">
                <option value="0.25">0.25x</option><option value="0.5">0.5x</option>
                <option value="1">1x</option><option value="2">2x</option>
              </select></label>
            <button id="fa-mute" type="button" title="Mute / unmute (M)">🔊</button>
            <span id="fa-info" style="font-size:13px; line-height:1.5"></span>
            <span id="fa-warm" class="muted small"></span>
          </div>
          <div id="fa-note" class="muted small" style="min-height:1.2em"></div>
          <div id="fa-canvas-wrap"><canvas id="fa-canvas" style="display:block; background:#0e1014; border-radius:6px"></canvas></div>
          <canvas id="fa-strip" style="display:block; width:100%; height:26px; margin-top:6px; cursor:pointer; touch-action:none"></canvas>
          <div id="fa-frame" class="small" style="margin-top:3px; font-size:12px"></div>
          <canvas id="fa-traces" style="display:block; width:100%; height:176px; margin-top:8px; background:#0e1014; border-radius:6px; cursor:pointer; touch-action:none"></canvas>
          <div id="fa-thr" style="display:flex; gap:14px; flex-wrap:wrap; font-size:12px; margin-top:4px">
            ${["off", "dev", "travel", "vel"].map(k => `
              <label>${k} ≥ <output id="fa-thr-${k}-out">${ui.thr[k].toFixed(2)}</output>
                <input type="range" id="fa-thr-${k}" min="0" max="1" step="0.01" value="${ui.thr[k]}" style="width:110px; vertical-align:middle"></label>`).join("")}
            <span class="muted small">torso units · position (off, dev) vs movement (travel, vel); frames past a threshold are marked under each trace</span>
          </div>
          <div class="muted small" style="margin-top:2px">
            the strip is the clip's timeline — click or drag to seek · top lane:
            <span style="color:${COLOR_IN}">facing within the band</span> /
            <span style="color:${COLOR_OUT}">outside</span> /
            <span style="color:${COLOR_NOPOSE}">no pose</span> · bottom lane, the Sheet's labels:
            <span style="color:${SLIP.lead}">lead slip</span> ·
            <span style="color:${SLIP.rear}">rear slip</span> ·
            straights <span style="color:${COLOR_IN}">head off the line</span> /
            <span style="color:${COLOR_MISS}">on the line</span> · other punches grey ·
            <kbd>N</kbd>/<kbd>P</kbd> next/prev clip · <kbd>Shift+N</kbd>/<kbd>Shift+P</kbd> next/prev video · <kbd>Space</kbd> pause · <kbd>←</kbd><kbd>→</kbd> frames
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
    root.querySelector("#fa-vprev").addEventListener("click", () => { const j = neighbourVideoIndex(-1); if (j >= 0) showClip(j); });
    root.querySelector("#fa-vnext").addEventListener("click", () => { const j = neighbourVideoIndex(1); if (j >= 0) showClip(j); });
    root.querySelector("#fa-loop").addEventListener("click", () => {
      looping = !looping;
      if (looping && curClip() && mode === "video") startVideoLoop(curClip()); else renderInfo();
    });
    root.querySelector("#fa-play").addEventListener("click", () => {
      if (mode === "video") { const v = video(); if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); }
      else { playing = !playing; if (playing) clock = { t0: performance.now(), f0: frame }; renderSkeletonFrame(); }
      renderInfo();
    });
    // Frame steps: the viewer's frames in video mode, our clock's otherwise.
    const stepFrame = dir => {
      if (mode === "video") { if (activeState?.pose || activeState?.poseV6) seekTo((activeState.frame || 0) + dir); }
      else seekFrame(frame + dir, { pause: true });
    };
    root.querySelector("#fa-mute").addEventListener("click", () => {
      const v = video(); if (!v) return;
      v.muted = !v.muted; ui.muted = v.muted; saveUi(); renderInfo();
    });
    root.querySelector("#fa-fprev").addEventListener("click", () => stepFrame(-1));
    root.querySelector("#fa-fnext").addEventListener("click", () => stepFrame(1));
    root.querySelector("#fa-speed").value = String(ui.speed);
    root.querySelector("#fa-speed").addEventListener("change", e => {
      ui.speed = parseFloat(e.target.value) || 1; saveUi();
      const vs = document.getElementById("speed");            // the viewer's own (hidden) speed control
      if (vs) { vs.value = String(ui.speed); vs.dispatchEvent(new Event("change")); }
      clock = { t0: performance.now(), f0: frame }; renderInfo(); if (mode === "skeleton") renderSkeletonFrame();
    });
    for (const k of ["off", "dev", "travel", "vel"]) {
      root.querySelector(`#fa-thr-${k}`).addEventListener("input", e => {
        ui.thr[k] = parseFloat(e.target.value); saveUi();
        root.querySelector(`#fa-thr-${k}-out`).textContent = ui.thr[k].toFixed(2);
        redrawTraces();
      });
    }
    // The strip is the clip's timeline: click or drag anywhere on it to seek.
    const seekAt = e => {
      const d = curData(); if (!d) return;
      const r = (e.currentTarget || strip).getBoundingClientRect();
      const f = Math.max(0, Math.min(d.n - 1, Math.round((e.clientX - r.left) / Math.max(1, r.width) * (d.n - 1))));
      if (mode === "video") { const x = clipInLoaded(activeState, curClip()); if (x) seekTo(x.s + f); }
      else seekFrame(f, { pause: true });
    };
    let dragging = false;
    for (const el of [strip, root.querySelector("#fa-traces")]) {
      el.addEventListener("pointerdown", e => { dragging = true; el.setPointerCapture(e.pointerId); seekAt(e); });
      el.addEventListener("pointermove", e => { if (dragging) seekAt(e); });
      el.addEventListener("pointerup", () => { dragging = false; });
      el.addEventListener("pointercancel", () => { dragging = false; });
    }

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
    if (d && x) {
      const items = clipLabels(c, d), cl = centerLineFor(d, state);
      drawStrip(d, f - x.s, items, straightVerdicts(items, cl));
      drawTraces(d, f - x.s, items, cl);
    }
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
    // The center line on the body, and what this frame sits in.
    if (d && x) {
      const items = clipLabels(c, d), cl = centerLineFor(d, state), verdicts = straightVerdicts(items, cl);
      const fc = frameContext(items, verdicts, f - x.s);
      if (cl) drawCenterLine(ctx, cl, f - x.s, fc?.color || "rgba(255,255,255,0.6)", v => v, v => v, s);
      if (fc) drawBadge(ctx, fc.text, fc.color, s, 60);   // under the clip badge + progress bar
      if (cl) drawBadge(ctx, liveValues(cl, f - x.s, state.pose?.fps || d.fps), "#ddd", s, fc ? 92 : 60);
    }
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
