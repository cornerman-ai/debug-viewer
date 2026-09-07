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
// own round-wide scrubber and frame label are hidden too: the traces under
// the player are the timeline, and they span the clip only — click or drag
// them to seek, ⏮ ⏭ step frames, the speed control slows the loop.
//
// ON THE TRACES AND THE BODY (2026-09-06). The Sheet's labels for the clip —
// via ../shared/slip_labels.js, the labeler web app — wash over the traces:
// lead / rear slips in their colours, punches faint. Straight punches carry
// the head-off-center-line rule from ./head_offcenter.js (did the head come off
// the line at the punch? green yes, red no — ../shared/center_line.js) in the
// body badge and the info line. The rule's quantity is drawn on the body every
// frame: the hip line, the head point and the offset between them, in torso
// heights, and a badge names the slip or the punch the frame sits in with its
// verdict. No axiality gate here: the whole set faces the camera by
// construction. (Until 2026-09-07 evening a strip above the traces carried
// facing, labels and rule lanes; Mathe had it removed — the traces already
// show all of it, and the footage gets the height.)
//
// WHAT SAYS "SLIP"? Under the footage, ONE trace of the center-line quantity
// over the clip with its threshold: dev, the head's deviation from the
// boxer's own resting position — off (the head's distance from the hip line)
// minus its rolling 3-s median. Five formulations were measured and shown here
// on 2026-09-06/07 — off, dev, rest (distance from the round's most common
// position), travel (range inside 0.5 s) and vel (change over 0.1 s) — and
// narrowed to off + dev (position beats movement, rest trails dev), then to
// dev alone at 0.20 on 2026-09-08: a quarter of the boxers rest with the head
// off the hip line, so off fires on a head that never moved, and no movement
// gate fixes that. The numbers: ml/research/defense/slip_rule/README.md.
// Labeled slips are shaded in the trace, frames past the threshold marked
// under it, the badge names the frame's live values (off and dev both).
//
// THE RULE, FIRING ONLY WHEN NO PUNCH IS BEING THROWN. The trace row carries
// its SLIP blocks along its bottom, each named LEAD or REAR by the side the
// head moved toward (the sign of dev at the peak through the video's stance;
// the labels agree on 19 of 24 events touching a labeled slip, 2026-09-08),
// and each needing the head at least 0.05 torso off the hip line at some
// point — a head coming back to the line has not slipped (same day; on this
// footage that removes 1 event in 102). The rule fires on a run of ≥ 3 frames past
// the threshold (gaps ≤ 2
// frames bridged) that BEGINS as a movement away from the line while no punch
// is being thrown. The gate closes the FIRST HALF of each of the Sheet's punch
// labels — start to midpoint, the midpoint standing in for the impact
// (2026-09-07): a slip that closes a combo is thrown while the last punch
// retracts, so the retraction half stays open. A head that went off the line
// inside the closed half is the punch's: it does not count while it stays
// there, while it returns with the arm, or after the label ends — only a
// further movement away (REARM, 0.08 torso) starts a slip (the onset rule in
// ruleEvents; Mathe's three cases of the same evening). A select under the
// traces closes the whole label instead, for comparison (±0.25 s widening
// swallowed most of the labeled slips and is gone). The Sheet's
// labels are the gate for now because the measured skeleton cue (2D arm
// extension) does not see punches thrown at the camera, and a depth-aware one
// is not built yet. An event touching a labeled slip is green, one touching
// none is red, grey while the labels are still loading; the gated stretches
// are dimmed in the traces. The gate can be switched off to see what the raw
// rule would do. Its measured cost and the alternatives:
// ml/research/defense/slip_rule/README.md.
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
const COLOR_REST   = "#ff9ee0";   // pink   — the resting line dev is measured from

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
const UI_DEFAULT_THR = { dev: 0.20 };
const THR_VERSION = 2;                // bump when a default threshold changes: saved sliders from before are dropped
const ui = { sort: "video", outsideOnly: false, speed: 1, lastId: null, muted: false,
             thr: { ...UI_DEFAULT_THR }, gate: true, gateExt: "half", legendOpen: true };   // speed: the skeleton fallback's clock
try {
  const saved = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
  Object.assign(ui, saved);
  ui.thr = saved.thrVersion === THR_VERSION ? { ...UI_DEFAULT_THR, ...(saved.thr || {}) } : { ...UI_DEFAULT_THR };
  ui.thrVersion = THR_VERSION;
} catch {}
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
  // The boxer's stance, from the rows (per video): it decides which image side is the lead side.
  const counts = {};
  for (const r of lab.rows) if (r.stance) counts[r.stance] = (counts[r.stance] || 0) + 1;
  items.stance = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
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

// Draw the rule's quantities on the body: the hip line, the head point and the
// offset between them (off); and, when the signals are at hand, the RESTING
// line — where the head has sat over the surrounding 3 s, the rolling median
// of off that dev is measured from — with a thin bar from it to the head
// (dev). `toX/toY` map the pose's pixels to the target canvas.
function drawCenterLine(ctx, cl, f, col, toX, toY, s = 1, series = null) {
  const m = cl.m, fr = f + cl.base;
  const hx = m.hipX[fr], hy = m.hipY[fr], hxHead = m.headX[fr], hyHead = m.headY[fr];
  if (![hx, hy, hxHead, hyHead].every(Number.isFinite)) return;
  const HX = toX(hx), HY = toY(hy), KX = toX(hxHead), KY = toY(hyHead);
  ctx.save();
  ctx.font = `${Math.round(13 * s)}px ui-monospace, monospace`; ctx.textBaseline = "bottom"; ctx.textAlign = "left";
  const rest = series && Number.isFinite(series.off[fr]) && Number.isFinite(series.dev[fr]) ? series.off[fr] - series.dev[fr] : NaN;
  if (Number.isFinite(rest)) {                            // the resting line, and dev from it to the head
    const RX = toX(hx + rest * m.torso);
    ctx.strokeStyle = COLOR_REST; ctx.lineWidth = 1.5 * s; ctx.setLineDash([3 * s, 5 * s]);
    ctx.beginPath(); ctx.moveTo(RX, HY + 20 * s); ctx.lineTo(RX, KY - 60 * s); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 2 * s;
    ctx.beginPath(); ctx.moveTo(RX, KY + 8 * s); ctx.lineTo(KX, KY + 8 * s); ctx.stroke();
    ctx.fillStyle = COLOR_REST; ctx.textBaseline = "top";
    const dv = series.dev[fr];
    ctx.fillText(`dev ${dv >= 0 ? "+" : ""}${dv.toFixed(2)}`, Math.max(HX, KX, RX) + 10 * s, KY + 4 * s);
    ctx.textBaseline = "bottom";
  }
  ctx.strokeStyle = COLOR_FRAME; ctx.lineWidth = 1.5 * s; ctx.setLineDash([6 * s, 6 * s]);
  ctx.beginPath(); ctx.moveTo(HX, HY + 20 * s); ctx.lineTo(HX, KY - 60 * s); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = col; ctx.lineWidth = 4 * s;
  ctx.beginPath(); ctx.moveTo(HX, KY); ctx.lineTo(KX, KY); ctx.stroke();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(KX, KY, 5 * s, 0, Math.PI * 2); ctx.fill();
  const v = m.off[fr];
  ctx.fillText(`off ${v >= 0 ? "+" : ""}${Number.isFinite(v) ? v.toFixed(2) : "—"} torso`, Math.max(HX, KX) + 10 * s, KY - 4 * s);
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

let root = null, takeoverStage = null, canvas = null;
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
  ensureClip(c);                                        // traces + compass (+ the fallback's skeleton)
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
  fittedH = 0; fitVideo();
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

// Footage and timelines on one screen: the height the viewport leaves for the
// footage under the lens's own rows — bar, strip, traces, sliders, legend.
function availHeight() {
  const stage = document.getElementById("stage");
  if (!root || !stage) return 480;
  const top = stage.getBoundingClientRect().top + window.scrollY;
  const own = canvas?.parentElement?.offsetHeight || 0;       // the skeleton canvas, when shown
  const thr = root.querySelector("#fa-thr");                  // down to the sliders; the legend and the clip list may sit below the fold
  const need = (thr || root).getBoundingClientRect().bottom - root.getBoundingClientRect().top + 12;
  return Math.max(240, window.innerHeight - top - (need - own) - 16);
}
let fittedH = 0;
function fitVideo() {
  const wrap = document.querySelector(".video-wrap");
  if (!wrap || mode !== "video") return;
  const h = Math.round(availHeight());
  if (h === fittedH) return;
  fittedH = h;
  wrap.style.setProperty("--fa-video-h", `${h}px`);
}

function sizeCanvas(d) {
  const maxW = Math.max(320, (root?.querySelector("#fa-stage")?.clientWidth || 800) - 4);
  const maxH = Math.min(680, availHeight());
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

// The legend: every colour, shade and line the lens draws, from the same
// constants the drawing code uses, so it cannot drift from the picture.
const LANE_BG = "#20242b";                                   // roughly the lanes' ground under the shades
const sw = (bg, extra = "") => `<span class="fa-sw" style="background:${bg};${extra}"></span>`;
const ln = (color, dashed = false) => `<span class="fa-ln" style="border-top:2px ${dashed ? "dashed" : "solid"} ${color}"></span>`;
const shade = a => sw(LANE_BG, `box-shadow:inset 0 0 0 20px rgba(0,0,0,${a})`);
function legendHtml() {
  const row = (swatch, text) => `<div>${swatch}</div><div>${text}</div>`;
  const head = t => `<div class="fa-lg-h">${t}</div>`;
  return [
    head("The trace — the clip's timeline, one column per frame: the dev rule. The left gutter names it and its threshold (the slider below). Click or drag anywhere to seek."),
    row(ln(COLOR_FRAME), "the frame you are looking at — the same cyan marker sits on the purple progress bar over the footage"),
    row(ln("rgba(255,255,255,0.85)"), "the quantity's magnitude frame by frame, in torso heights: 0 at the row's bottom, up is away from the reference — a slip to either side goes UP (which side is the arrow in the readout). The row tops out at max(0.8, 1.5 × threshold)"),
    row(ln("rgba(255,255,255,0.5)", true), "the threshold"),
    row(sw("#ff9e64", "height:3px"), "orange ticks along the row's bottom: frames past the threshold — BEFORE the gate and the ≥ 3-frame rule, so not every tick becomes a SLIP block"),
    row(sw(COLOR_IN), "a block in the band under the ticks = the rule says SLIP here: a run of ≥ 3 frames past its threshold, gaps ≤ 2 frames bridged, outside the gate, with the head at least 0.05 torso off the hip line at some point (a head coming back to the line has not slipped). Green: the block touches a labeled slip (±3 frames)"),
    row(`<span style="font:bold 9px ui-sans-serif,system-ui,sans-serif;color:#ddd">LEAD</span>`, "the word in a block is the side: LEAD or REAR, the side of the body the head moved toward — the sign of dev at its peak, mapped through the boxer's stance from the Sheet's rows (orthodox: lead is the image's right; southpaw the left). LEAD? / REAR? = the video has no stance and orthodox was assumed. On this footage the side matches the label on 19 of 24 events that touch a labeled slip"),
    row(sw(COLOR_MISS), "a red SLIP block: it touches no slip label — a false alarm, or a slip the labelers missed"),
    row(sw(COLOR_CLIP), "a purple SLIP block: the labels are still loading — not judged yet"),
    row(sw(SLIP.lead, "opacity:.35"), "a wash over the whole row: a labeled slip from the Sheet — blue lead, yellow rear"),
    row(sw("rgba(255,255,255,0.14)"), "a faint wash: a punch label from the Sheet (any type)"),
    row(shade(0.45), "dark shade: the punch gate is closed — the first half of a punch label (start → midpoint ≈ impact), or the whole label when the select says so. No slip can begin here, and a head that went off the line in here belongs to the punch: it does not count while it stays off, while it returns with the arm, or after the label ends — only a further movement away (≥ 0.08 torso from where it settled) starts a slip"),
    row(shade(0.22), "lighter shade: the retraction half of a punch label — open: a slip may begin here (the 1-2-slip)"),
    row(sw(COLOR_IN), "so a SLIP block always starts where the head began moving away from its reference with no punch being thrown: either the threshold crossing itself, or the renewed movement after a punch"),
    row(`<span style="color:#ff9e64;font-weight:600;font-size:11px">0.31→</span>`, "the readout at the right: this frame's value; → the head sits to the image's right of its reference, ← to the left; orange when past the threshold"),
    head("On the body"),
    row(ln(COLOR_FRAME, true), "the hip line: the vertical through the hip midpoint — the boxer's own center line, the reference for <b>off</b>; the thick bar from it to the head is off, its value written above the head"),
    row(ln(COLOR_REST, true), "the resting line: where the head has sat over the surrounding 3 s (the rolling median of off) — the reference for <b>dev</b>; the thin pink bar from it to the head is dev, its value written below the head. A head parked off the hip line has the two lines apart and dev near zero"),
    row(`<span class="fa-sw" style="background:${SLIP.lead};border-radius:50%;width:10px;margin-left:3px"></span>`, "the head point (midpoint of the visible head landmarks) with the bar from the hip line to it: the offset, in torso heights, written beside it. Its colour is what the frame sits in — blue / yellow a slip label, green a straight with the head off the line, red one with the head on it, grey another punch, white when nothing is labeled here"),
    row(ln("rgba(122,223,122,0.85)"), "the skeleton, skeleton-only mode: green bones while the facing-angle model has the boxer within ±22.5° of chest-to-camera, white outside; on the footage the bones are faint white"),
    row(sw("transparent", `border:2px solid ${COLOR_MISS};height:8px`), "a red frame around the picture: the video is outside the clip (video mode)"),
    row(`<span style="color:${COLOR_IN};font-weight:600;font-size:10px">CLIP</span>`, `the badges top-left: the clip counter — green inside the clip, red outside; the label this frame sits in, in that label's colour (a straight also says whether the head came off the line); the live |off| · |dev| values; and <span style="color:${COLOR_IN}">SLIP? dev rule</span> when the rule fires — green on a labeled slip, red with no label there, purple while the labels load`),
    row(sw(COLOR_CLIP, "height:4px"), "the purple bar under the badges: the clip's extent, the cyan marker your position in it (video mode)"),
    row(`<span style="color:${COLOR_IN};font-weight:600;font-size:11px">−3°</span>`, "the dial top-right: this frame's facing angle from the model. The green wedge is the ±22.5° band; needle and number are green inside it, white outside, “no pose” when there is none"),
    head("Text"),
    row(`<span style="color:${COLOR_IN};font-weight:600;font-size:10px">SLIP</span>`, "the frame line under the traces: what each rule says on this frame, in its block's colour; — when that rule is quiet"),
    row(`<span style="color:${COLOR_MISS};font-weight:600;font-size:10px">FA</span>`, `the info line: <span style="color:${SLIP.lead}">slips</span> = the clip's slip labels; straights <span style="color:${COLOR_IN}">off the line</span> / <span style="color:${COLOR_MISS}">on it</span>; per <span style="color:${COLOR_CLIP}">rule</span>: its events on this clip, how many of the labeled slips they touch, and FA = events touching no slip label`),
  ].join("");
}

const GUTTER = 62;             // left gutter of the traces: the rule's name and threshold


// A rule's SLIP block: the verdict colour, and the word when there is room.
function slipBlock(ctx, x, y, w, h, color, text = "SLIP") {
  ctx.fillStyle = color; ctx.globalAlpha = 0.95; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
  if (w < 30) return;
  ctx.fillStyle = "#111"; ctx.font = "bold 9px ui-sans-serif, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
  ctx.textAlign = "left";
}

// The punch gate over a lane: closed stretches dark, away-only lighter.
function drawGate(ctx, gate, n, x0, colW, y, h, aClosed, aAway) {
  let a = -1, cur = GATE_OPEN;
  for (let i = 0; i <= n; i++) {
    const g = i < n ? gate[i] : GATE_OPEN;
    if (g === cur) continue;
    if (cur !== GATE_OPEN) { ctx.fillStyle = `rgba(0,0,0,${cur === GATE_CLOSED ? aClosed : aAway})`; ctx.fillRect(x0 + a * colW, y, (i - a) * colW, h); }
    a = i; cur = g;
  }
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
  if (cl) drawCenterLine(ctx, cl, f, fc?.color || "rgba(255,255,255,0.6)", x => x * W / d.width, y => y * H / d.height, 1, seriesFor(cl, d.fps));
  if (fc) drawBadge(ctx, fc.text, fc.color, 1, 10);
  if (cl) drawBadge(ctx, liveValues(cl, f, d.fps), "#ddd", 1, fc ? 42 : 10);
  const rs = ruleState(d, items, cl, d.fps);
  const fired = rs ? RULES.filter(k => eventAt(rs.events[k], f)) : [];
  if (fired.length) {
    const hit = fired.some(k => eventAt(rs.events[k], f).hit);
    drawBadge(ctx, `${fired.map(k => `${sideText(eventAt(rs.events[k], f))} SLIP? ${k} rule`).join(" + ")}${hit ? " · on a labeled slip" : items ? " · no label here" : ""}`,
              hit ? COLOR_IN : items ? COLOR_MISS : COLOR_CLIP, 1, fc ? 74 : 42);
  }
  drawCompass(ctx, deg, W);
  ctx.save();
  ctx.font = "13px ui-monospace, monospace"; ctx.textBaseline = "bottom";
  const t = `skeleton only · frame ${f + 1}/${d.n} · src ${fmtTime(c.start_sec + f / d.fps)} · ${playing ? "▶" : "⏸"} ${ui.speed}x`;
  const tw = ctx.measureText(t).width;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath(); ctx.roundRect(8, H - 30, tw + 16, 24, 5); ctx.fill();
  ctx.fillStyle = "#ddd"; ctx.fillText(t, 16, H - 12);
  ctx.restore();
  drawTraces(d, f, items, cl);
}

// ── the four traces ─────────────────────────────────────────────────────────

// All four rows are magnitudes: a slip to either side goes UP. The side itself
// is the arrow in the readout (→ head to image right, ← to image left).
const TRACE_ROWS = [
  { key: "dev", label: "its deviation from the rolling 3 s median (the boxer's own resting position)" },
];

function seriesFor(cl, fps) {
  const sig = centerLineSignals(cl.m, fps);
  return sig ? { off: cl.m.off, dev: sig.dev } : null;
}

let lastTrace = null;
function redrawTraces() {
  if (!lastTrace) return;
  const [d, f, items, cl] = lastTrace;
  drawTraces(d, f, items, cl);
  fitVideo();
}

// The timeline: a row of the clip's frames per rule quantity (dev alone since 2026-09-08) — its
// magnitude over the clip, the threshold dashed, labeled slips washed in,
// punches faint, the gate dimmed, and along the row's bottom the frames past
// the threshold (orange ticks) over the rule's own SLIP blocks.
function drawTraces(d, f, items, cl) {
  const canvas = root?.querySelector("#fa-traces");
  if (!canvas || !d) return;
  lastTrace = [d, f, items, cl];
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.max(1, canvas.getBoundingClientRect().width), cssH = 90;
  if (canvas.width !== Math.round(cssW * dpr)) canvas.width = Math.round(cssW * dpr);
  if (canvas.height !== Math.round(cssH * dpr)) canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const x0 = GUTTER, rowH = cssH / TRACE_ROWS.length, colW = (cssW - x0) / d.n;
  const fps = mode === "video" ? (activeState?.pose?.fps || d.fps) : d.fps;
  const series = cl ? seriesFor(cl, fps) : null;
  const rs = cl ? ruleState(d, items, cl, fps) : null;
  const gate = rs?.gate || punchGate(items, d.n);
  const BAND = 13;                                          // the row's bottom band: ticks over SLIP blocks
  TRACE_ROWS.forEach((row, ri) => {
    const y0 = ri * rowH, thr = ui.thr[row.key];
    const arr = series?.[row.key];
    const lim = Math.max(0.8, thr * 1.5);                   // 0 at the bottom, magnitudes up
    const yOf = v => y0 + rowH - BAND - 2 - (v / lim) * (rowH - BAND - 16);
    ctx.fillStyle = "rgba(255,255,255,0.04)"; ctx.fillRect(x0, y0, cssW - x0, rowH - 1);
    if (items) {
      for (const it of items) {
        if (it.kind === "punch") { ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.fillRect(x0 + it.s * colW, y0, Math.max(1, (it.e - it.s + 1) * colW), rowH - 1); }
      }
      for (const it of items) {
        if (it.kind !== "slip") continue;
        ctx.fillStyle = SLIP[it.side]; ctx.globalAlpha = 0.22;
        ctx.fillRect(x0 + it.s * colW, y0, Math.max(1.5, (it.e - it.s + 1) * colW), rowH - 1);
        ctx.globalAlpha = 1;
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, yOf(thr)); ctx.lineTo(cssW, yOf(thr)); ctx.stroke();
    ctx.setLineDash([]);
    if (arr) {
      const base = cl.base;
      ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 1.2; ctx.beginPath();
      let started = false;
      for (let i = 0; i < d.n; i++) {
        const v = arr[i + base];
        if (!Number.isFinite(v)) { started = false; continue; }
        const vv = Math.min(lim, Math.abs(v));
        if (!started) { ctx.moveTo(x0 + i * colW, yOf(vv)); started = true; } else ctx.lineTo(x0 + i * colW, yOf(vv));
      }
      ctx.stroke();
      ctx.fillStyle = "#ff9e64";                      // past the threshold
      for (let i = 0; i < d.n; i++) {
        const v = arr[i + base];
        if (Number.isFinite(v) && Math.abs(v) >= thr) ctx.fillRect(x0 + i * colW, y0 + rowH - BAND, colW + 0.5, 3);
      }
    }
    drawGate(ctx, gate, d.n, x0, colW, y0, rowH - BAND - 1, 0.45, 0.22);
    if (rs) for (const ev of rs.events[row.key]) slipBlock(ctx, x0 + ev.s * colW, y0 + rowH - BAND + 4, Math.max(2, (ev.e - ev.s + 1) * colW), BAND - 5, RULE_COLOR[ev.hit], sideText(ev));
    // The gutter names the rule and its threshold; the long label sits over the plot.
    ctx.font = "bold 11px ui-monospace, monospace"; ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.fillStyle = "#ddd"; ctx.fillText(row.key, 4, y0 + 4);
    ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = "#aaa"; ctx.fillText(`≥ ${thr.toFixed(2)}`, 4, y0 + 18);
    ctx.fillText(row.label, x0 + 6, y0 + 3);
    const vNow = arr ? arr[f + cl.base] : NaN;
    ctx.fillStyle = Number.isFinite(vNow) && Math.abs(vNow) >= thr ? "#ff9e64" : "#ddd"; ctx.textAlign = "right";
    const arrow = Number.isFinite(vNow) ? (vNow > 0 ? " →" : vNow < 0 ? " ←" : "") : "";
    ctx.fillText(Number.isFinite(vNow) ? `${Math.abs(vNow).toFixed(2)}${arrow}` : "—", cssW - 6, y0 + 3);
    ctx.textAlign = "left";
  });
  ctx.fillStyle = COLOR_FRAME;
  ctx.fillRect(x0 + Math.max(0, Math.min(d.n - 1, f)) * colW - 1, 0, 2, cssH);
}

// ── the rule ────────────────────────────────────────────────────────────────

const RULES = ["dev"];
// Clip frames inside a punch label, per frame: GATE_CLOSED for the label's
// FIRST HALF — start up to midpoint, the midpoint standing in for the impact
// (the whole label when the extent select says so) — and GATE_AWAY for the
// retraction half, which is open: the slip that closes a combo is thrown while
// the last punch retracts (1-2-slip). What the closed half does to a head
// that went off the line in it is ruleEvents' onset rule. In a combo the next
// punch's own first half closes the gate again (closed wins over away).
const GATE_OPEN = 0, GATE_AWAY = 1, GATE_CLOSED = 2;
function punchGate(items, n) {
  const g = new Uint8Array(n);
  if (!ui.gate || !items) return g;
  for (const it of items) {
    if (it.kind !== "punch") continue;
    const mid = ui.gateExt === "full" ? it.e : Math.floor((it.s + it.e) / 2);
    for (let f = Math.max(0, it.s); f <= Math.min(n - 1, it.e); f++) g[f] = Math.max(g[f], f <= mid ? GATE_CLOSED : GATE_AWAY);
  }
  return g;
}

// Runs of |series[key]| >= thr on ungated clip frames, gaps <= 2 bridged, >= 3
// frames kept: [{ s, e, hit }] with hit = touches a labeled slip (null = no labels).
// The rule's events on the clip. An event is a stretch past the threshold that
// BEGAN as a movement away from the reference while no punch was being thrown:
// a run that crosses the threshold outside the closed gate starts an event at
// the crossing. A run that was already past the threshold inside the closed
// gate — the head went off the line with the punch — does not: not while the
// head stays there, not while it returns with the arm, and not after the label
// ends (Mathe, 2026-09-07) — unless the head then moves a further REARM torso
// away from where it settled, which is a new movement and starts an event
// there. The closed gate cuts a running event; the retraction half is open.
// Runs are bridged over gaps ≤ 2 frames; events shorter than 3 frames drop.
function ruleEvents(series, key, thr, gate, items, base, n) {
  const arr = series?.[key];
  if (!arr) return [];
  const q = i => { const v = arr[i + base]; return Number.isFinite(v) ? Math.abs(v) : NaN; };
  const runs = [];
  let s = -1, prev = -10;
  for (let i = 0; i < n; i++) {
    if (!(q(i) >= thr)) continue;
    if (s < 0) { s = i; prev = i; continue; }
    if (i - prev > 3) { runs.push([s, prev]); s = i; }
    prev = i;
  }
  if (s >= 0) runs.push([s, prev]);
  const events = [];
  for (const [a, b] of runs) {
    let ev = -1, parked = gate[a] === GATE_CLOSED, qmin = NaN;
    for (let i = a; i <= b; i++) {
      if (gate[i] === GATE_CLOSED) {                       // a punch: cut, and whatever is off the line now belongs to it
        if (ev >= 0) { events.push([ev, i - 1]); ev = -1; }
        parked = true; qmin = NaN;
        continue;
      }
      if (ev >= 0) continue;
      if (!parked) { ev = i; continue; }                   // crossed the threshold in the open: the crossing is the movement
      const v = q(i);
      if (!Number.isFinite(v)) continue;
      qmin = Number.isFinite(qmin) ? Math.min(qmin, v) : v;
      if (v - qmin >= REARM) { ev = i; parked = false; }  // a further movement away: a new slip
    }
    if (ev >= 0) events.push([ev, b]);
  }
  // Each event: at least 3 frames; the head at least MIN_OFF from the hip
  // line at some point; named LEAD or REAR by the side the head moved toward
  // (the sign of the quantity at its peak: + = the image's right, which is
  // the lead side for an orthodox boxer and the rear side for a southpaw).
  const slips = items ? items.filter(it => it.kind === "slip") : null;
  const stance = items?.stance || null;
  const out = [];
  for (const [a, b] of events) {
    if (b - a + 1 < 3) continue;
    let peak = a, pk = -1, offMax = 0;
    for (let i = a; i <= b; i++) {
      const v = Math.abs(arr[i + base]); if (v > pk) { pk = v; peak = i; }
      const o = Math.abs(series.off[i + base]); if (o > offMax) offMax = o;
    }
    if (!(offMax >= MIN_OFF)) continue;
    const side = (arr[peak + base] > 0) !== (stance === "southpaw") ? "lead" : "rear";
    const touched = slips ? slips.filter(sl => sl.s <= b + 3 && sl.e >= a - 3) : null;
    out.push({ s: a, e: b, side, stanceKnown: !!stance, peak, offMax,
               hit: touched ? touched.length > 0 : null,
               sideOk: touched && touched.length ? touched.some(sl => sl.side === side) : null });
  }
  return out;
}

const RULE_COLOR = { true: COLOR_IN, false: COLOR_MISS, null: COLOR_CLIP };
const REARM = 0.08;            // torso: a head already off the line when the gate releases must move this much further away to count
const MIN_OFF = 0.05;          // torso: the head must get at least this far from the hip line during the event — a head coming back to the line has not slipped
const sideText = ev => ev.side.toUpperCase() + (ev.stanceKnown ? "" : "?");

// Everything the lanes, traces and badge need for the current clip.
function ruleState(d, items, cl, fps) {
  if (!d || !cl) return null;
  const series = seriesFor(cl, fps);
  if (!series) return null;
  const gate = punchGate(items, d.n);
  const events = {};
  for (const k of RULES) events[k] = ruleEvents(series, k, ui.thr[k], gate, items, cl.base, d.n);
  return { gate, events };
}

const eventAt = (evs, f) => (evs || []).find(e => e.s <= f && f <= e.e) || null;

// "|off| 0.31→ · |dev| 0.28→" for the frame's badge.
function liveValues(cl, f, fps) {
  const series = seriesFor(cl, fps);
  if (!series) return "";
  const fr = f + cl.base;
  const mag = v => Number.isFinite(v) ? `${Math.abs(v).toFixed(2)}${v > 0 ? "→" : v < 0 ? "←" : ""}` : "—";
  return `|off| ${mag(series.off[fr])} · |dev| ${mag(series.dev[fr])}`;
}

// ── DOM ─────────────────────────────────────────────────────────────────────

function fmtTime(sec) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
function shortStem(s, max = 44) { return s.length <= max ? s : s.slice(0, max - 1) + "…"; }
function note(msg) { const el = root?.querySelector("#fa-note"); if (el) el.textContent = msg; }

function renderAll() { renderParams(); renderInfo(); renderList(); if (mode === "skeleton") renderSkeletonFrame(); fitVideo(); }

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
    const rs = ruleState(d0, items, cl, mode === "video" ? (activeState?.pose?.fps || d0.fps) : d0.fps);
    if (rs) {
      const slips = items.filter(i => i.kind === "slip");
      labelsTxt += RULES.map(k => {
        const evs = rs.events[k];
        const caught = slips.filter(sl => evs.some(ev => ev.s <= sl.e + 3 && ev.e >= sl.s - 3)).length;
        const fa = evs.filter(ev => ev.hit === false).length;
        const nLead = evs.filter(ev => ev.side === "lead").length;
        const judged = evs.filter(ev => ev.sideOk != null), sideOk = judged.filter(ev => ev.sideOk).length;
        return ` · <span style="color:${COLOR_CLIP}">${k} rule</span> ${evs.length} event${evs.length === 1 ? "" : "s"}
          (<span style="color:${SLIP.lead}">${nLead} lead</span> / <span style="color:${SLIP.rear}">${evs.length - nLead} rear</span>;
          <span style="color:${COLOR_IN}">${caught}/${slips.length} slips</span>, <span style="color:${COLOR_MISS}">${fa} FA</span>${judged.length ? `, side as labeled ${sideOk}/${judged.length}` : ""})`;
      }).join("") + (items.stance ? "" : ` · <span class="muted">no stance in the rows → orthodox assumed for lead / rear</span>`);
    }
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
    // What each rule says at this frame — the same events the strip and traces draw.
    let says = "";
    if (d && k != null) {
      const kk = Math.max(0, Math.min(d.n - 1, k));
      const its = clipLabels(c, d), cl = centerLineFor(d, activeState);
      const rs = cl ? ruleState(d, its, cl, mode === "video" ? (activeState?.pose?.fps || d.fps) : d.fps) : null;
      if (rs) says = RULES.map(k2 => {
        const ev = rs.events[k2].find(ev => ev.s <= kk && kk <= ev.e);
        return ev ? `<b style="color:${RULE_COLOR[ev.hit]}">${k2} rule: ${sideText(ev)} SLIP</b>` : `<span class="muted">${k2} rule: —</span>`;
      }).join(" · ");
    }
    fr.innerHTML = d && k != null
      ? `clip frame <code>${Math.max(0, Math.min(d.n - 1, k)) + 1}</code> / ${d.n}
         · src <code>${fmtTime(c.start_sec + Math.max(0, Math.min(d.n - 1, k)) / d.fps)}</code>
         ${k < 0 ? `<span style="color:${COLOR_MISS}">· before the clip</span>` : k > d.n - 1 ? `<span style="color:${COLOR_MISS}">· after the clip</span>` : ""}
         ${says ? ` · ${says}` : ""}`
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
  if (!root || !document.contains(root)) return;
  fittedH = 0; fitVideo();
  if (mode !== "skeleton") return;
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
      /* Footage and timelines on one screen: the video box takes what the
         viewport leaves under the lens's rows (fitVideo sets --fa-video-h),
         not the viewer's 75vh. Gone with this style on the lens switch. */
      .video-wrap { max-height: var(--fa-video-h, 75vh) !important; max-width: calc(var(--fa-video-h, 75vh) * var(--video-ratio, 16 / 9)) !important; }
      #stage-extras { margin-top:0 !important; }
      #fa-root button { font-size:13px; padding:4px 10px; }
      #fa-root select { font-size:12px; }
      #fa-legend .fa-lg { display:grid; grid-template-columns:22px 1fr; gap:3px 8px; font-size:12px; line-height:1.35; margin-top:6px; align-items:start; }
      #fa-legend .fa-lg-h { grid-column:1 / -1; font-weight:600; margin-top:8px; color:#ddd; }
      #fa-legend .fa-sw { display:inline-block; width:16px; height:10px; border-radius:2px; vertical-align:middle; margin-top:3px; }
      #fa-legend .fa-ln { display:inline-block; width:16px; height:0; vertical-align:middle; margin-top:3px; }
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
          <canvas id="fa-traces" style="display:block; width:100%; height:90px; margin-top:6px; background:#0e1014; border-radius:6px; cursor:pointer; touch-action:none"></canvas>
          <div id="fa-frame" class="small" style="margin-top:3px; font-size:12px"></div>
          <div id="fa-thr" style="display:flex; gap:14px; flex-wrap:wrap; font-size:12px; margin-top:4px">
            ${RULES.map(k => `
              <label>${k} ≥ <output id="fa-thr-${k}-out">${ui.thr[k].toFixed(2)}</output>
                <input type="range" id="fa-thr-${k}" min="0" max="1" step="0.01" value="${ui.thr[k]}" style="width:110px; vertical-align:middle"></label>`).join("")}
            <label><input type="checkbox" id="fa-gate" ${ui.gate ? "checked" : ""}> fire only when no punch is being thrown, gate =</label>
            <select id="fa-gate-ext">
              <option value="half" ${ui.gateExt !== "full" ? "selected" : ""}>first half of each punch label closed (start → midpoint ≈ impact); a slip may begin in the retraction, but a head that went off the line with the punch counts only once it moves further away</option>
              <option value="full" ${ui.gateExt === "full" ? "selected" : ""}>the whole punch label closed</option>
            </select>
            <span class="muted small">torso units, magnitudes (a slip to either side goes up; → / ← in the readout is the side); frames past the threshold are marked under the trace; the rules fire on runs ≥ 3 frames outside the gate</span>
          </div>
          <details id="fa-legend" ${ui.legendOpen === false ? "" : "open"} style="margin-top:6px">
            <summary class="small" style="cursor:pointer; color:#ddd">Legend — every colour, shade and line, what it means</summary>
            <div class="fa-lg">${legendHtml()}</div>
          </details>
          <div class="muted small" style="margin-top:4px">
            <kbd>N</kbd>/<kbd>P</kbd> next/prev clip · <kbd>Shift+N</kbd>/<kbd>Shift+P</kbd> next/prev video · <kbd>Space</kbd> pause · <kbd>←</kbd><kbd>→</kbd> frames · click or drag the traces to seek
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
    for (const k of RULES) {
      root.querySelector(`#fa-thr-${k}`).addEventListener("input", e => {
        ui.thr[k] = parseFloat(e.target.value); saveUi();
        root.querySelector(`#fa-thr-${k}-out`).textContent = ui.thr[k].toFixed(2);
        redrawTraces(); renderInfo();
      });
    }
    root.querySelector("#fa-gate").addEventListener("change", e => { ui.gate = e.target.checked; saveUi(); redrawTraces(); renderInfo(); });
    root.querySelector("#fa-gate-ext").addEventListener("change", e => { ui.gateExt = e.target.value; saveUi(); redrawTraces(); renderInfo(); });
    // The traces are the clip's timeline: click or drag anywhere on them to seek.
    const seekAt = e => {
      const d = curData(); if (!d) return;
      const r = e.currentTarget.getBoundingClientRect();
      const f = Math.max(0, Math.min(d.n - 1, Math.round((e.clientX - r.left - GUTTER) / Math.max(1, r.width - GUTTER) * (d.n - 1))));
      if (mode === "video") { const x = clipInLoaded(activeState, curClip()); if (x) seekTo(x.s + f); }
      else seekFrame(f, { pause: true });
    };
    let dragging = false;
    const tl = root.querySelector("#fa-traces");
    tl.addEventListener("pointerdown", e => { dragging = true; tl.setPointerCapture(e.pointerId); seekAt(e); });
    tl.addEventListener("pointermove", e => { if (dragging) seekAt(e); });
    tl.addEventListener("pointerup", () => { dragging = false; });
    tl.addEventListener("pointercancel", () => { dragging = false; });

    // The legend or the clip list unfolding changes what the footage may take;
    // the legend remembers whether it is open.
    for (const det of root.querySelectorAll("details")) {
      det.addEventListener("toggle", () => {
        if (det.id === "fa-legend") { ui.legendOpen = det.open; saveUi(); }
        fittedH = 0; fitVideo();
        const d = curData();
        if (d && mode === "skeleton") { sizeCanvas(d); renderSkeletonFrame(); }
      });
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
      if (cl) drawCenterLine(ctx, cl, f - x.s, fc?.color || "rgba(255,255,255,0.6)", v => v, v => v, s, seriesFor(cl, state.pose?.fps || d.fps));
      if (fc) drawBadge(ctx, fc.text, fc.color, s, 60);   // under the clip badge + progress bar
      if (cl) drawBadge(ctx, liveValues(cl, f - x.s, state.pose?.fps || d.fps), "#ddd", s, fc ? 92 : 60);
      const rs = ruleState(d, items, cl, state.pose?.fps || d.fps);
      const fired = rs ? RULES.filter(k => eventAt(rs.events[k], f - x.s)) : [];
      if (fired.length) {
        const hit = fired.some(k => eventAt(rs.events[k], f - x.s).hit);
        drawBadge(ctx, `${fired.map(k => `${sideText(eventAt(rs.events[k], f - x.s))} SLIP? ${k} rule`).join(" + ")}${hit ? " · on a labeled slip" : items ? " · no label here" : ""}`,
                  hit ? COLOR_IN : items ? COLOR_MISS : COLOR_CLIP, s, fc ? 124 : 92);
      }
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
