// Bladedness lens — exploration workbench for "too squared / too bladed".
//
// Bladedness is a rotation about the VERTICAL axis: how far the boxer's
// shoulder line (and foot line) has turned away from lying across your view
// and toward pointing at the camera. 0° = squared (chest to camera),
// 90° = fully side-on. The curated frontal set exists so the camera can stand
// in for the opponent — the curated set is defined below.
//
// NO DEPTH IS USED. BlazePose z is not reliable enough, so both angles come
// from foreshortening instead:
//
//   SHOULDERS   gap = |L_sh.x − R_sh.x| / torso_height
//               bladed° = arccos(gap / W)          W = their true shoulder
//                                                  width in torso units
//     A shoulder line pointing at the camera looks narrow; one across your
//     view looks full width. Dividing by W recovers the turn. Same machinery
//     hip_rotation already uses on the hips, expressed as the complement
//     (arccos instead of arcsin) because we want the absolute angle, not a
//     peak-minus-trough difference.
//
//   FEET        bladed° = atan2(|dy| · k, |dx|)
//     Stance WIDTH is not anatomically fixed — the boxer changes it at will —
//     so the arccos(gap/W) trick can't work on the ankles. Instead we use the
//     ground-plane trick stance_width v5 already relies on: with the camera
//     above ankle height, image-vertical IS the depth axis, so the ankle
//     vector's (dx, dy) is the stance direction seen from above, up to an
//     unknown scale k set by camera pitch/height. k is a SLIDER, not a
//     constant — read it off the footage.
//
// ── everything here is uncalibrated ────────────────────────────────────────
// W is estimated per-round as the 99th percentile of |gap| — i.e. "they went
// broadside at some point". An over-bladed boxer NEVER does, so W comes out
// too small, gap/W too large, and they measure as MORE SQUARE than they are.
// The bias points the wrong way for exactly the people this rule is meant to
// catch. Hence the W slider, and hence the onboarding calibration pose. The
// band thresholds are guesses pending a coach — do not read them as tuned.

import { J } from "../../skeleton.js";
import { activeDetections } from "../shared/punch_detections.js";

// ── the 3D bands ────────────────────────────────────────────────────────────
//
// Separate from the 2D machinery above and NOT subject to the W problem: these
// come from the BlazePose WORLD landmarks, where the line's angle needs no
// reference width at all. bladed° = atan2(|dz|, |dx|) on the world hip line
// (BP 23/24) and shoulder line (BP 11/12) — 0° = the line lies across your
// view (square), 90° = it runs away from you (side-on). Same construction as
// backend `frame_viewer.load_round`, flipped to the 0-is-square convention the
// cuts below live on.
//
// THE CUTS ARE COACH JOHN'S, and they are the only bladedness thresholds that
// exist. Fitted in cornerman-backend/ml/research/bladedness/coach_review_page.py
// (`fit_bands`) as the midpoint between adjacent class medians of his 30
// verdicts — 22/24 within one band on the hips, 17/25 on the shoulders.
//
// Read them with three caveats: they were fitted on the same 30 frames they
// were scored on, they come from ONE coach, and there is no upper edge —
// across all 30 frames he never once called anyone TOO bladed, so "bladed"
// here means "fine", not "over-rotated". Above the top cut is simply good.
const COACH_CUTS = { hip: [18.2, 27.9], sh: [12.7, 17.6] };

const cfg = {
  wScale: 1.0,        // multiplies the auto W estimate (1.0 = use it as-is)
  footK: 1.0,         // image-y → ground-depth scale for the ankle vector
  squaredBelow: 25,   // GUESS — below this = too squared      (2D tracks only)
  bladedAbove: 65,    // GUESS — above this = too bladed       (2D tracks only)
  hipCuts: [...COACH_CUTS.hip],
  shCuts: [...COACH_CUTS.sh],
  minConfidence: 0.5,
  spansOnly: false,   // false = band the whole round, not just the curated spans
  excludePunches: true,
  leanFix: true,      // correct gap on frames where the torso is foreshortened
};

// Lean gate. gap = shoulder_width / torso_height, and a forward lean rotates
// the torso about the HIP axis: it foreshortens the torso while leaving the
// shoulder line's horizontal extent alone. So gap inflates without the boxer
// being any wider, the frame reads as squarer than it is, and — worse — those
// frames set W, corrupting every angle in the round.
//
// Below this fraction of the round's own median torso, gap is rescaled as if
// the torso were its median length:
//     gap_fixed = shoulder_px / torso_median = gap * (torso / torso_median)
// which is the geometrically correct undo, not a fudge. Clamped so it can only
// ever shrink gap, never inflate it.
const LEAN_GATE = 0.90;

// Curated-only is NOT a toggle. The camera-as-opponent assumption is what makes
// these angles mean anything, and it only holds inside the curated spans — a
// number measured outside them is not a worse measurement, it's a meaningless
// one. So frames outside a span are excluded, and a video that isn't in the set
// gets refused outright rather than silently measured.

const REQ_SH = [J.L_SHOULDER, J.R_SHOULDER, J.L_HIP, J.R_HIP];
const REQ_FT = [J.L_ANKLE, J.R_ANKLE];

const C_SQUARE  = "#ff9e64";   // orange — too squared
const C_OK      = "#7adf7a";   // green
const C_BLADED  = "#ff5d6c";   // red — too bladed
const C_INVALID = "#888";
const C_PUNCH   = "#6b7280";   // grey — punch frame, excluded (not a stance)

// The 3D band palette, which is NOT the 2D one above: the coach scheme has no
// too-bladed edge, so green means "at or past the top cut" rather than "in the
// middle". Kept visually distinct on purpose — the two schemes disagree about
// what green means and mixing them up would be the easy misread.
const C_B_SQUARED = "#ff5d6c";   // red    — too squared
const C_B_BETWEEN = "#ffcc4d";   // yellow — between the cuts
const C_B_BLADED  = "#7adf7a";   // green  — bladed enough
const C_HIP3      = "#ff9ad5";   // hip-3D accent
const C_SH3       = "#a78bfa";   // shoulder-3D accent (distinct from the 2D shoulder blue)
const C_SH      = "#7ec8ff";   // shoulder accent
const C_FT      = "#ffd95c";   // foot accent
const C_FRAME   = "#3ad9e0";
const C_REEL    = "#ffd95c";   // the slice cut for the coach reel
const C_TIGHT   = "#ff9e64";   // tightrope: lead-toe line -> rear heel
const C_ACCENT  = "#b48cff";   // span labels

// ── stance + tightrope ──────────────────────────────────────────────────────
//
// LEAD FOOT FROM STANCE, not from a guess. The labels Sheet carries `stance`
// per punch, so the fighter's stance is the majority vote over the round's
// detections. Orthodox leads with the LEFT foot, southpaw with the RIGHT.
// (The frames lens still uses the lower-in-image heuristic — its data is
// extracted offline where the Sheet isn't available.)
function roundStance(state) {
  const dets = activeDetections(state);
  if (!dets || !dets.length) return null;
  let o = 0, s = 0;
  for (const d of dets) {
    const v = String(d.stance || "").trim().toLowerCase();
    if (v === "orthodox") o++;
    else if (v === "southpaw") s++;
  }
  if (!o && !s) return null;
  return { stance: s > o ? "southpaw" : "orthodox", orthodox: o, southpaw: s };
}

// Full BlazePose-33 indices — the COCO-17 remap the rules engine uses stops at
// the ankles, so heels and toes only exist on state.blaze33.
const BP = { L_SH: 11, R_SH: 12, L_HIP: 23, R_HIP: 24,
             L_ANKLE: 27, R_ANKLE: 28, L_HEEL: 29, R_HEEL: 30, L_TOE: 31, R_TOE: 32 };
const BP_CH = 8, BP_X = 0, BP_Y = 1, BP_WX = 3, BP_WZ = 5, BP_VIS = 6;

// Map a viewer frame onto the blaze33 cache (same shape as the inspector lens's
// frameOf: aligned when it's the primary timeline, else via pts).
function b33FrameOf(b, state, frame) {
  if (!b) return null;
  const aligned = b.n_frames === state.n_frames
    && Math.abs((b.fps || 0) - (state.fps || 0)) < 0.01
    && Math.abs((b.start_sec || 0) - (state.start_sec || 0)) < 1e-3;
  if (aligned) return Math.min(Math.max(frame, 0), b.n_frames - 1);
  const t = (state.start_sec || 0) + frame / (state.fps || 30);
  if (b.pts && b.pts.length) {
    let lo = 0, hi = b.pts.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (b.pts[m] < t) lo = m + 1; else hi = m; }
    return lo;
  }
  const f = Math.round((t - (b.start_sec || 0)) * (b.fps || 30));
  return (f >= 0 && f < b.n_frames) ? f : null;
}

const b33Frame = (b, state) => b33FrameOf(b, state, state.frame);

// World-line bladedness, 0° = across your view (square), 90° = away from you.
// |dz| over |dx| — the y axis is height and plays no part. Gated on the two
// landmarks' own visibility, matching the backend's MIN_CONF gate.
function worldDeg(b, fb, jL, jR) {
  const at = (j, ch) => b.data[(fb * 33 + j) * BP_CH + ch];
  if (!(at(jL, BP_VIS) > cfg.minConfidence) || !(at(jR, BP_VIS) > cfg.minConfidence)) return NaN;
  const dx = at(jL, BP_WX) - at(jR, BP_WX);
  const dz = at(jL, BP_WZ) - at(jR, BP_WZ);
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return NaN;
  return Math.atan2(Math.abs(dz), Math.abs(dx)) * (180 / Math.PI);
}

// Which of the coach's three bands a world angle falls in. null = not measured;
// callers must distinguish that from "squared", which is a verdict.
function band3(v, cuts) {
  if (!Number.isFinite(v)) return null;
  return v < cuts[0] ? "squared" : (v < cuts[1] ? "between" : "bladed");
}

const BAND3_COLOR = { squared: C_B_SQUARED, between: C_B_BETWEEN, bladed: C_B_BLADED };
const band3Color = (v, cuts) => BAND3_COLOR[band3(v, cuts)] || C_INVALID;

// Tightrope has no bands (see computeMetrics) — it gets a magnitude ramp, dark
// at the target and bright as the rear heel drifts off the lead-toe line.
// TR_FULL is a display scale, not a threshold: it only sets where the ramp
// saturates. Crossed feet (negative) get their own colour, because "past the
// line" is a different fault from "wide of it", not more of the same one.
const TR_FULL = 0.8;
const C_TR_CROSS = "#b48cff";
function tightColor(v) {
  if (!Number.isFinite(v)) return C_INVALID;
  if (v < 0) return C_TR_CROSS;
  const t = Math.min(1, v / TR_FULL);
  return `rgb(${Math.round(60 + 195 * t)}, ${Math.round(60 + 98 * t)}, ${Math.round(70 + 30 * t)})`;
}

// Perpendicular distance from the REAR HEEL to a vertical line through the LEAD
// TOE, over torso height. Shortest distance to a vertical line IS the
// horizontal offset, so this needs no camera constant — unlike the atan2 foot
// angle. Squared feet sit side by side (wide); a bladed stance stacks the rear
// foot behind the lead one and it collapses toward zero.
function tightrope(state, torsoPx, frame = state.frame, stance = null) {   // signed; negative = feet crossed
  const b = state.blaze33;
  if (!b || !b.data || !(torsoPx > 1e-6)) return null;
  const f = b33FrameOf(b, state, frame);
  if (f == null) return null;
  const st = stance !== null ? stance : roundStance(state);
  const leadLeft = !st || st.stance === "orthodox";
  const toeJ  = leadLeft ? BP.L_TOE  : BP.R_TOE;
  const heelJ = leadLeft ? BP.R_HEEL : BP.L_HEEL;
  const vid = document.getElementById("video");
  const W = (vid && vid.videoWidth) || state.pose?.width || b.width || 0;
  const H = (vid && vid.videoHeight) || state.pose?.height || b.height || 0;
  const at = (j, c) => b.data[(f * 33 + j) * BP_CH + c];
  if (at(toeJ, BP_VIS) <= cfg.minConfidence || at(heelJ, BP_VIS) <= cfg.minConfidence) return null;
  const tx = at(toeJ, BP_X) * W, hx = at(heelJ, BP_X) * W;
  const ty = at(toeJ, BP_Y), hy = at(heelJ, BP_Y);
  if (![tx, hx, ty, hy].every(Number.isFinite) || !(W > 0)) return null;
  // SIGNED — the rear heel belongs on the rear side of the lead-toe line. For
  // an orthodox boxer the right heel sits to the boxer's right, which is the
  // image LEFT because the camera faces them, so correct is hx < tx. Southpaw
  // mirrors. Negative means the feet have crossed; an absolute value would hide
  // that behind an ordinary-looking number.
  return { dist: (leadLeft ? tx - hx : hx - tx) / torsoPx, tx, hx,
           toeY: ty * H, heelY: hy * H,
           stance: st ? st.stance : "orthodox (assumed)", votes: st };
}

// ── metric core ─────────────────────────────────────────────────────────────

function torso(sk, f) {
  const b = f * 17;
  const sx = 0.5 * (sk[(b + J.L_SHOULDER) * 2]     + sk[(b + J.R_SHOULDER) * 2]);
  const sy = 0.5 * (sk[(b + J.L_SHOULDER) * 2 + 1] + sk[(b + J.R_SHOULDER) * 2 + 1]);
  const hx = 0.5 * (sk[(b + J.L_HIP) * 2]          + sk[(b + J.R_HIP) * 2]);
  const hy = 0.5 * (sk[(b + J.L_HIP) * 2 + 1]      + sk[(b + J.R_HIP) * 2 + 1]);
  return Math.hypot(sx - hx, sy - hy);
}

const ok = (conf, f, js, min) => js.every(j => conf[f * 17 + j] > min);

let mc = { pose: null };

const pickPose = s => s.poseV6 || s.pose;

// ── curated frontal set (merged in from the retired frontal_segments lens) ──
//
// Data: ./lens_data/frontal_segments.json — a copy of the backend's source of truth,
// plus ./lens_data/clip_windows.json, the slices make_clips.py actually cut for the
// coach reel. Refresh both with:
//   cp ~/code/cornerman-backend/bladedness/frontal_segments.json \
//      ~/code/cornerman-debug-viewer/lens_data/frontal_segments.json
//   cp ~/code/cornerman-backend/bladedness/clip_windows.json \
//      ~/code/cornerman-debug-viewer/lens_data/clip_windows.json
//
// TIME BASE (the thing that silently breaks): manifest times are SOURCE-VIDEO
// seconds, but a cache holds one round starting at `pose.start_sec`. We convert
// with the viewer's own start-frame convention —
//     cacheFrame = floor(t * fps) - floor(start_sec * fps)
// — matching how the viewer seeks. The backend uses the cache's `_pts.npy`
// clock, which is authoritative when pts is non-uniform; if a span ever looks a
// frame or two off here, that is why.

const DATA_URL = "./lens_data/frontal_segments.json";
const WINDOWS_URL = "./lens_data/clip_windows.json";

let manifest = null;
let manifestError = null;
let manifestPromise = null;
let windows = null;

async function loadManifest() {
  if (manifest || manifestError) return;
  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    manifestError = err.message || String(err);
  }
  try {
    const res = await fetch(WINDOWS_URL, { cache: "no-store" });
    if (res.ok) windows = (await res.json()).windows || null;
  } catch { /* reel windows are optional */ }
  // The video dropdown filters on requiresVideo(), which can't answer until
  // this lands — tell the viewer to re-filter now that it can.
  window.dispatchEvent(new Event("lens-filter-changed"));
}

// Kick the fetch off at module load (registry.js imports every lens on page
// load) so the dropdown filters correctly on the first paint.
manifestPromise = loadManifest();

// Stems in the wild pick up `_prepared` / `_h264` re-encode tails, and these
// YouTube titles contain double spaces that are easy to lose in a copy-paste.
function normStem(s) {
  return String(s || "")
    .replace(/_(prepared|h264)$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchEntry(basename) {
  if (!manifest || !basename) return null;
  const segs = manifest.segments || {};
  if (segs[basename]) return { stem: basename, spans: segs[basename] };
  const want = normStem(basename);
  for (const [stem, spans] of Object.entries(segs)) {
    if (normStem(stem) === want) return { stem, spans };
  }
  return null;
}

// Video filter. Pending ⇒ hide (loadManifest re-fires the filter once the data
// lands). Failed ⇒ show everything, because an unexplained empty dropdown is a
// dead end when the error message lives in a panel you can't reach.
function isCuratedVideo(base) {
  if (manifestError) return true;
  if (!manifest) return false;
  return !!matchEntry(base);
}

let spanCache = { pose: null, basename: null };

function curatedInfo(state) {
  const pose = pickPose(state);
  if (!pose) return null;
  const basename = state.cacheBasename || null;
  if (spanCache.pose === pose && spanCache.basename === basename
      && spanCache.round === state.cacheRound) return spanCache;

  const n = pose.n_frames;
  const fps = pose.fps || state.fps || 30;
  const startSec = Number(pose.start_sec || 0);
  const startFrame = Math.floor(startSec * fps);

  const entry = matchEntry(basename);
  const inSpan = new Uint8Array(n);
  const ranges = [];

  if (entry) {
    // A span with `round` set belongs to THAT cache round only. Spans starting
    // at "the round's start" (start_sec null) would otherwise apply to every
    // round of the video — R0's span would also paint r1 and r2.
    const roundIdx = state.cacheRound;
    const mine = entry.spans.filter(
      sp => sp.round == null || roundIdx == null || sp.round === roundIdx);

    const ordered = [...mine].sort((a, b) => (a.start_sec ?? 0) - (b.start_sec ?? 0));
    const resolved = ordered.map((sp, i) => {
      const inherited = sp.end_sec == null && ordered[i + 1]?.start_sec != null;
      return {
        ...sp,
        _end: sp.end_sec != null ? sp.end_sec : (ordered[i + 1]?.start_sec ?? null),
        // An explicit end_sec is inclusive; an end inherited from the next
        // span's start is exclusive — R0 stops one frame BEFORE R1 begins.
        _endExclusive: inherited,
      };
    });

    for (const sp of resolved) {
      const s = sp.start_sec == null ? 0 : Math.floor(sp.start_sec * fps) - startFrame;
      const e = sp._end == null
        ? n - 1
        : Math.floor(sp._end * fps) - startFrame - (sp._endExclusive ? 1 : 0);
      const cs = Math.max(0, Math.min(n - 1, s));
      const ce = Math.max(0, Math.min(n - 1, e));
      // A span landing entirely outside this round belongs to a different round
      // of the same video — skip it rather than clamping it to a sliver.
      if (e < 0 || s > n - 1) continue;
      for (let f = cs; f <= ce; f++) inSpan[f] = 1;
      ranges.push({ label: sp.label, s: cs, e: ce, startSec: sp.start_sec, endSec: sp._end });
    }
    ranges.sort((a, b) => a.s - b.s);
  }

  let nIn = 0;
  for (let f = 0; f < n; f++) if (inSpan[f]) nIn++;

  // The slice make_clips.py cut for the reel. Only ONE clip is cut per video,
  // so on a multi-round video most rounds have no window — `reelElsewhere`
  // names the round that does, instead of the UI silently going blank.
  let reel = null, reelElsewhere = null;
  const w = entry && windows ? windows[entry.stem] : null;
  if (w) {
    const sameRound = w.round == null || state.cacheRound == null
                      || w.round === state.cacheRound;
    if (sameRound) {
      const s = Math.floor(w.start_sec * fps) - startFrame;
      const e = Math.floor(w.end_sec * fps) - startFrame;
      if (e >= 0 && s <= n - 1) {
        reel = { ...w, s: Math.max(0, Math.min(n - 1, s)), e: Math.max(0, Math.min(n - 1, e)) };
      }
    }
    if (!reel) reelElsewhere = w;
  }

  spanCache = { pose, basename, round: state.cacheRound, n, fps, startSec,
                entry, inSpan, ranges, nIn, reel, reelElsewhere };
  return spanCache;
}

function fmtTime(sec) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

function shortStem(s, max = 44) {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}


function computeMetrics(state) {
  const pose = pickPose(state);
  if (!pose) return null;
  const dets = activeDetections(state);
  const b33 = state.blaze33 || null;
  if (mc.pose === pose && mc.dets === dets && mc.b33 === b33
      && mc.minConf === cfg.minConfidence && mc.leanFix === cfg.leanFix) return mc;

  const n = pose.n_frames, sk = pose.skeleton, conf = pose.conf;
  const gapRaw = new Float64Array(n).fill(NaN);   // |shoulder width| / torso
  const tor = new Float64Array(n).fill(NaN);      // torso height, px
  const fdx = new Float64Array(n).fill(NaN);      // ankle |dx| / torso
  const fdy = new Float64Array(n).fill(NaN);      // ankle |dy| / torso
  const validSh = new Uint8Array(n), validFt = new Uint8Array(n);

  for (let f = 0; f < n; f++) {
    const th = torso(sk, f);
    if (!(th > 1e-6)) continue;
    tor[f] = th;
    const b = f * 17;
    if (ok(conf, f, REQ_SH, cfg.minConfidence)) {
      const d = Math.abs(sk[(b + J.L_SHOULDER) * 2] - sk[(b + J.R_SHOULDER) * 2]) / th;
      if (Number.isFinite(d)) { gapRaw[f] = d; validSh[f] = 1; }
    }
    if (ok(conf, f, REQ_FT, cfg.minConfidence)) {
      const dx = Math.abs(sk[(b + J.L_ANKLE) * 2]     - sk[(b + J.R_ANKLE) * 2]) / th;
      const dy = Math.abs(sk[(b + J.L_ANKLE) * 2 + 1] - sk[(b + J.R_ANKLE) * 2 + 1]) / th;
      if (Number.isFinite(dx) && Number.isFinite(dy)) { fdx[f] = dx; fdy[f] = dy; validFt[f] = 1; }
    }
  }

  // The two world-landmark angles, per frame. These need the full BlazePose-33
  // cache; without it the 3D tracks stay empty rather than falling back to the
  // 2D numbers, which answer a different question and carry the W bias.
  const hip3 = new Float64Array(n).fill(NaN);
  const sh3 = new Float64Array(n).fill(NaN);
  let n3d = 0;
  if (b33 && b33.data) {
    for (let f = 0; f < n; f++) {
      const fb = b33FrameOf(b33, state, f);
      if (fb == null) continue;
      hip3[f] = worldDeg(b33, fb, BP.L_HIP, BP.R_HIP);
      sh3[f] = worldDeg(b33, fb, BP.L_SH, BP.R_SH);
      if (Number.isFinite(hip3[f]) || Number.isFinite(sh3[f])) n3d++;
    }
  }

  // Tightrope per frame, so it can sit beside the two angles instead of only
  // existing on the frame you happen to be parked on. Stance is resolved once
  // for the round — it is a per-round majority vote, not a per-frame quantity.
  //
  // NO BANDS ON THIS ONE. The same midpoint-of-medians fit that produced the
  // hip and shoulder cuts collapses here: on John's 30 frames the tightrope
  // medians are +0.477 (squared), +0.476 (between), +0.365 (bladed) — the first
  // two are indistinguishable, and the resulting scheme scores 11/22 exact,
  // which is the majority-class base rate. So it is drawn as a magnitude ramp:
  // structure visible, no threshold implied.
  const stance = roundStance(state);
  const tight = new Float64Array(n).fill(NaN);
  for (let f = 0; f < n; f++) {
    const q = tightrope(state, tor[f], f, stance);
    if (q) tight[f] = q.dist;
  }

  // Punch frames — bladedness is a RESTING-stance property. You blade on the
  // jab and square up on the cross by design, so averaging across punches
  // measures punch mix, not stance.
  const punch = new Uint8Array(n);
  if (dets) {
    for (const d of dets) {
      const s = Math.max(0, Math.round(d.start_frame));
      const e = Math.min(n - 1, Math.round(d.end_frame));
      for (let f = s; f <= e; f++) punch[f] = 1;
    }
  }

  // Median torso for this round, from the frames we can measure.
  const tv = [...tor].filter(Number.isFinite).sort((a, b) => a - b);
  const torMed = tv.length ? tv[tv.length >> 1] : NaN;

  // Lean correction, applied BEFORE W is estimated so a leaning frame can't
  // set the reference.
  const gap = new Float64Array(n).fill(NaN);
  const leaned = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    if (!Number.isFinite(gapRaw[f])) continue;
    const ratio = torMed > 1e-6 ? tor[f] / torMed : 1;
    if (cfg.leanFix && Number.isFinite(ratio) && ratio < LEAN_GATE) {
      gap[f] = gapRaw[f] * Math.min(1, ratio);
      leaned[f] = 1;
    } else {
      gap[f] = gapRaw[f];
    }
  }

  // W: 99th percentile of |gap| over the round — "they went broadside once".
  // See the header for why this is the weakest link in the whole lens.
  const finite = [...gap].filter(Number.isFinite).sort((a, b) => a - b);
  const wAuto = finite.length ? finite[Math.min(finite.length - 1,
                  Math.floor(0.99 * finite.length))] : NaN;

  let nLeaned = 0;
  for (let f = 0; f < n; f++) if (leaned[f]) nLeaned++;

  mc = { pose, dets, b33, minConf: cfg.minConfidence, leanFix: cfg.leanFix,
         n, gap, gapRaw, tor, torMed,
         leaned, nLeaned, fdx, fdy, validSh, validFt, punch, wAuto,
         hip3, sh3, n3d, tight, stance };
  return mc;
}

const DEG = 180 / Math.PI;

// Shoulder bladedness: 0° = squared (line across view), 90° = side-on.
function shoulderDeg(c, f) {
  const W = c.wAuto * cfg.wScale;
  if (!c.validSh[f] || !(W > 1e-6) || !Number.isFinite(c.gap[f])) return NaN;
  return Math.acos(Math.max(0, Math.min(1, c.gap[f] / W))) * DEG;
}

// Foot bladedness: 0° = ankle line across view, 90° = pointing at the camera.
function footDeg(c, f) {
  if (!c.validFt[f]) return NaN;
  const dx = c.fdx[f], dy = c.fdy[f] * cfg.footK;
  if (!(dx > 1e-9 || dy > 1e-9)) return NaN;
  return Math.atan2(dy, dx) * DEG;
}

// A frame counts toward the round stats only if it's measurable, inside the
// curated span (when that filter is on), and not mid-punch.
// A frame counts if it's measurable and not mid-punch. `spansOnly` narrows that
// to the curated spans — the stretches where the camera is verified to stand in
// for the opponent. Off by default: on a frontal video the whole round is worth
// looking at, and hiding four fifths of it makes the bands impossible to judge.
// The spans are still marked on the timeline, so a suspicious stretch can be
// checked against them.
function counted(c, cur, f) {
  if (!cur?.entry) return false;                     // curated VIDEOS only, always
  if (cfg.spansOnly && !cur.inSpan[f]) return false;
  if (cfg.excludePunches && c.punch[f]) return false;
  return true;
}

function bandColor(deg) {
  if (!Number.isFinite(deg)) return C_INVALID;
  if (deg < cfg.squaredBelow) return C_SQUARE;
  if (deg > cfg.bladedAbove) return C_BLADED;
  return C_OK;
}

function median(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : 0.5 * (v[m - 1] + v[m]);
}

function iqr(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 4) return NaN;
  const q = p => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return q(0.75) - q(0.25);
}

function rollup(c, cur) {
  const sh = [], ft = [], diff = [];
  let nCounted = 0;
  for (let f = 0; f < c.n; f++) {
    if (!counted(c, cur, f)) continue;
    nCounted++;
    const s = shoulderDeg(c, f), t = footDeg(c, f);
    if (Number.isFinite(s)) sh.push(s);
    if (Number.isFinite(t)) ft.push(t);
    if (Number.isFinite(s) && Number.isFinite(t)) diff.push(s - t);
  }
  return { nCounted, sh, ft,
           medSh: median(sh), medFt: median(ft), medDiff: median(diff),
           iqrSh: iqr(sh), iqrFt: iqr(ft) };
}

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "—");

// ── lens ────────────────────────────────────────────────────────────────────

let host;

export const BladednessRule = {
  id: "bladedness_lens",
  label: "Bladedness (squared vs side-on)",

  // Only the curated frontal videos are selectable. The dropdown filter alone
  // isn't enough — the manual file picker and the Firebase path bypass it — so
  // update()/draw() refuse to measure a non-curated video as well.
  requiresVideo: isCuratedVideo,

  skeletonStyle() {
    return {
      boneColor: "rgba(255,255,255,0.22)",
      boneWidth: 1.5,
      jointRadius: 3,
      highlightJoints: new Set([J.L_SHOULDER, J.R_SHOULDER, J.L_HIP, J.R_HIP,
                                J.L_ANKLE, J.R_ANKLE]),
    };
  },

  mount(_host) {
    host = _host;
    mc = { pose: null };
    host.innerHTML = `
      <h2>Bladedness</h2>
      <p class="hint">
        Turn about the vertical axis: <strong>0° = squared</strong> (chest to
        camera), <strong>90° = side-on</strong>. Two families here —
        <strong>3D</strong> (world landmarks, coach-cut bands, on the torso
        lines and the top two timeline tracks) and <strong>2D</strong>
        (foreshortening <code>arccos(gap/W)</code> for shoulders, the ankle
        vector for feet, placeholder edges).
        Below, the 2D scheme: <span style="color:${C_SQUARE}">too squared</span> ·
        <span style="color:${C_OK}">ok</span> ·
        <span style="color:${C_BLADED}">too bladed</span> ·
        <span style="color:${C_PUNCH}">punch (excluded)</span>.
      </p>
      <p class="hint" style="border-left:2px solid ${C_BLADED}; padding-left:6px">
        <strong>Uncalibrated.</strong> W is guessed as the 99th percentile of
        |gap| — assumes they go broadside at some point. An over-bladed boxer
        never does, so W lands too small and they read as <em>more square than
        they are</em>. Band edges are placeholders, not coach-tuned.
      </p>

      <label class="slider-row" style="display:block; font-size:12px; margin-top:6px">
        W scale = <output id="bl-w-out">1.00</output> <span class="muted" id="bl-w-eff"></span>
        <input type="range" id="bl-w" min="0.6" max="1.6" step="0.01" value="1.0"></label>
      <label class="slider-row" style="display:block; font-size:12px">
        foot depth scale k = <output id="bl-k-out">1.00</output>
        <input type="range" id="bl-k" min="0.2" max="4.0" step="0.05" value="1.0"></label>
      <label class="slider-row" style="display:block; font-size:12px">
        2D too squared below = <output id="bl-sq-out">25</output>°
        <input type="range" id="bl-sq" min="0" max="60" step="1" value="25"></label>
      <label class="slider-row" style="display:block; font-size:12px">
        2D too bladed above = <output id="bl-bd-out">65</output>°
        <input type="range" id="bl-bd" min="30" max="90" step="1" value="65"></label>

      <h3 style="margin-bottom:2px">3D bands <span class="muted small">(coach cuts)</span></h3>
      <p class="hint" style="margin:2px 0 6px">
        World-landmark line angles — no <code>W</code>, so no saturation bias.
        <span style="color:${C_B_SQUARED}">squared</span> ·
        <span style="color:${C_B_BETWEEN}">between</span> ·
        <span style="color:${C_B_BLADED}">bladed (fine)</span>.
        From John's 30 verdicts, <strong>fitted on those same 30 frames</strong>,
        one coach. He never called anyone <em>too</em> bladed, so there is no
        upper edge — past the top cut is simply good.
      </p>
      <div style="display:grid; grid-template-columns:auto 1fr 1fr; gap:3px 6px;
                  font-size:12px; align-items:center">
        <span class="muted"></span>
        <span class="muted small">squared below</span>
        <span class="muted small">bladed at/above</span>
        <span style="color:${C_HIP3}">hips</span>
        <input type="number" id="bl-hip-lo" step="0.1" style="width:100%">
        <input type="number" id="bl-hip-hi" step="0.1" style="width:100%">
        <span style="color:${C_SH3}">shoulders</span>
        <input type="number" id="bl-sh-lo" step="0.1" style="width:100%">
        <input type="number" id="bl-sh-hi" step="0.1" style="width:100%">
      </div>
      <button id="bl-reset-cuts" style="margin-top:5px; font-size:11px; cursor:pointer">
        reset to coach fit (${COACH_CUTS.hip.join("/")}° · ${COACH_CUTS.sh.join("/")}°)</button>

      <label style="display:block; font-size:12px; margin-top:8px">
        <input type="checkbox" id="bl-pun" checked> exclude punch frames
        <span class="muted small">(greyed on the timeline)</span></label>
      <label style="display:block; font-size:12px">
        <input type="checkbox" id="bl-spans"> curated spans only
        <span class="muted small">(off = band the whole round)</span></label>
      <label style="display:block; font-size:12px">
        <input type="checkbox" id="bl-lean" checked> lean fix
        <span class="muted small">(rescale gap where torso &lt; 90% of median)</span></label>

      <h3>Round</h3>
      <div id="bl-round" style="font-size:13px; line-height:1.6"></div>

      <h3>Curated spans here <span class="muted small">(click to jump)</span></h3>
      <div id="bl-spans" style="font-size:12px"></div>

      <h3>Reel clip <span class="muted small">(what the coach sees)</span></h3>
      <div id="bl-reel" style="font-size:12px; line-height:1.5"></div>

      <h3>Current frame</h3>
      <div id="bl-frame" style="font-size:13px; line-height:1.6"></div>

      <h3><span style="color:${C_HIP3}">hip3D</span> /
          <span style="color:${C_SH3}">sh3D</span> /
          <span style="color:${C_SH}">sh2D</span> /
          <span style="color:${C_FT}">feet</span> over time</h3>
      <canvas id="bl-trace" width="320" height="130"></canvas>

      <h3>Curated set <span class="muted small" id="bl-set-count"></span></h3>
      <div id="bl-set" style="font-size:11px; line-height:1.5; max-height:200px; overflow:auto"></div>
    `;
    renderSetList();
    mountStageTimeline();

    const wire = (id, key, dec, out) => {
      const s = host.querySelector(id), o = host.querySelector(out);
      s.addEventListener("input", () => {
        cfg[key] = parseFloat(s.value);
        if (o) o.textContent = cfg[key].toFixed(dec);
        refresh();
      });
    };
    wire("#bl-w", "wScale", 2, "#bl-w-out");
    wire("#bl-k", "footK", 2, "#bl-k-out");
    wire("#bl-sq", "squaredBelow", 0, "#bl-sq-out");
    wire("#bl-bd", "bladedAbove", 0, "#bl-bd-out");
    const CUT_INPUTS = [["#bl-hip-lo", "hipCuts", 0], ["#bl-hip-hi", "hipCuts", 1],
                        ["#bl-sh-lo", "shCuts", 0], ["#bl-sh-hi", "shCuts", 1]];
    const syncCuts = () => CUT_INPUTS.forEach(([id, key, i]) => {
      host.querySelector(id).value = cfg[key][i];
    });
    syncCuts();
    CUT_INPUTS.forEach(([id, key, i]) => {
      host.querySelector(id).addEventListener("input", e => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) { cfg[key][i] = v; refresh(); }
      });
    });
    host.querySelector("#bl-reset-cuts").addEventListener("click", () => {
      cfg.hipCuts = [...COACH_CUTS.hip];
      cfg.shCuts = [...COACH_CUTS.sh];
      syncCuts(); refresh();
    });

    host.querySelector("#bl-pun").addEventListener("change", e => {
      cfg.excludePunches = e.target.checked; refresh();
    });
    host.querySelector("#bl-spans").addEventListener("change", e => {
      cfg.spansOnly = e.target.checked; refresh();
    });
    host.querySelector("#bl-lean").addEventListener("change", e => {
      cfg.leanFix = e.target.checked; refresh();
    });
  },

  update(state) {
    if (!host || !state) return;
    const c = computeMetrics(state);
    const roundEl = host.querySelector("#bl-round");
    if (!c) { if (roundEl) roundEl.innerHTML = `<p class="muted">No pose cache loaded.</p>`; return; }
    const cur = curatedInfo(state);

    // Not in the curated set ⇒ refuse. Showing an angle here would be showing a
    // number whose reference axis doesn't hold.
    if (!cur?.entry) {
      roundEl.innerHTML =
        `<div style="color:${C_BLADED}; font-weight:600">Not in the curated set</div>
         <div class="muted small" style="margin-top:3px">
           These angles only mean something where the camera stands in for the
           opponent. <code>${state.cacheBasename || "this video"}</code> isn't in
           <code>frontal_segments.json</code>, so nothing is measured.
         </div>`;
      host.querySelector("#bl-frame").innerHTML = `<span class="muted">—</span>`;
      host.querySelector("#bl-spans").innerHTML = "";
      host.querySelector("#bl-reel").innerHTML = "";
      const tl = document.getElementById("bl-timeline");
      if (tl) fitCanvas(tl);
      const tr = host.querySelector("#bl-trace");
      if (tr) tr.getContext("2d").clearRect(0, 0, tr.width, tr.height);
      return;
    }

    const r = rollup(c, cur);
    const f = state.frame;

    host.querySelector("#bl-w-eff").textContent =
      Number.isFinite(c.wAuto) ? `(auto ${c.wAuto.toFixed(3)} → ${(c.wAuto * cfg.wScale).toFixed(3)})` : "";

    const curNote = `curated spans only`;

    roundEl.innerHTML = `
      ${c.n3d ? "" : `<div style="color:${C_B_SQUARED}">No BlazePose-33 cache —
         the 3D bands are blank. Load the round from a Drive folder that carries
         the <code>_blazepose_r&lt;N&gt;.npy</code> cache; the COCO-17 remap has no
         world landmarks.</div>`}
      <div><span style="color:${C_SH}">shoulders</span>
        median <code style="color:${bandColor(r.medSh)}">${fmt(r.medSh)}°</code>
        <span class="muted">IQR ${fmt(r.iqrSh)}° · n=${r.sh.length}</span></div>
      <div><span style="color:${C_FT}">feet</span>
        median <code style="color:${bandColor(r.medFt)}">${fmt(r.medFt)}°</code>
        <span class="muted">IQR ${fmt(r.iqrFt)}° · n=${r.ft.length}</span></div>
      <div style="margin-top:3px">shoulders − feet
        <code>${fmt(r.medDiff)}°</code>
        <span class="muted">(&gt;0 = chest turned further than the feet)</span></div>
      <div class="muted small" style="margin-top:3px">${curNote} · ${r.nCounted} frames counted</div>
      <div class="muted small">stance <code>${(() => { const st = roundStance(state);
          return st ? `${st.stance} (${st.orthodox}o/${st.southpaw}s)` : "no labels — assuming orthodox"; })()}</code>
        <span class="muted">→ lead foot</span></div>
      <div class="muted small">torso median <code>${fmt(c.torMed, 0)}px</code> ·
        lean-corrected <code>${c.nLeaned}</code> frames
        ${cfg.leanFix ? "" : `<span style="color:${C_SQUARE}">(fix OFF)</span>`}</div>`;

    const spansEl = host.querySelector("#bl-spans");
    if (spansEl) {
      spansEl.innerHTML = cur.ranges.length
        ? cur.ranges.map((rg, i) =>
            `<div class="bl-span" data-i="${i}" style="cursor:pointer; padding:3px 0;
                  border-bottom:1px solid var(--border)">
               <code style="color:${C_ACCENT}">${rg.label}</code>
               <span class="muted">src ${fmtTime(rg.startSec)} → ${fmtTime(rg.endSec)}</span><br>
               <span class="small">frames <code>${rg.s}</code>–<code>${rg.e}</code>
                 · ${rg.e - rg.s + 1} fr</span>
             </div>`).join("")
        : `<p class="muted small">In the set, but no span falls inside this round —
             try another round.</p>`;
      spansEl.querySelectorAll(".bl-span").forEach(el =>
        el.addEventListener("click", () => seekTo(cur.ranges[+el.dataset.i].s)));
    }

    const reelEl = host.querySelector("#bl-reel");
    if (reelEl) {
      const rw = cur.reel, other = cur.reelElsewhere;
      reelEl.innerHTML = rw
        ? `<div id="bl-reel-jump" style="cursor:pointer">
             <code style="color:${C_REEL}">${rw.window_sec}s</code>
             <span class="muted">frames ${rw.s}–${rw.e} ·
               ${Math.round((rw.nonpunch_frac ?? 0) * 100)}% non-punch ·
               ${rw.punch_events} punches — click to jump</span>
             ${rw.excluded_from_reel
               ? `<div style="color:${C_BLADED}">NOT CUT — flagged for re-curation</div>` : ""}
           </div>`
        : other
          ? `<span class="muted">Cut from
               <code style="color:${C_REEL}">r${other.round}</code>, not this round —
               only one clip per video.</span>
             <button id="bl-goto-round" style="margin-top:4px; cursor:pointer">
               Go to r${other.round}</button>`
          : `<span class="muted">No reel clip for this round.</span>`;
      reelEl.querySelector("#bl-reel-jump")?.addEventListener("click", () => seekTo(rw.s));
      reelEl.querySelector("#bl-goto-round")?.addEventListener("click", () => gotoRound(other.round));
    }

    // The three readings side by side — hips, shoulders, tightrope — because
    // the interesting frames are the ones where they disagree, and that is
    // invisible if you have to step away to read the third.
    const s = shoulderDeg(c, f), t = footDeg(c, f), tr = c.tight[f];
    const bandCell = (v, cuts) => {
      const b = band3(v, cuts);
      return `<code style="color:${band3Color(v, cuts)}">${fmt(v)}°</code>
              <span class="muted">${b || (c.n3d ? "no landmark" : "no BP-33 cache")}</span>`;
    };
    host.querySelector("#bl-frame").innerHTML = `
      <strong>frame ${f}</strong>
      ${c.punch[f] ? `<span style="color:${C_PUNCH}"> punch — not a stance frame</span>` : ""}
      ${!cur.inSpan[f] ? `<span style="color:${C_INVALID}"> · outside curated span${
        cfg.spansOnly ? ", not counted" : ""}</span>` : ""}
      <div style="display:grid; grid-template-columns:auto 1fr; gap:1px 8px; margin-top:3px">
        <span style="color:${C_HIP3}">hips</span>
        <span>${bandCell(c.hip3[f], cfg.hipCuts)}</span>
        <span style="color:${C_SH3}">shoulders</span>
        <span>${bandCell(c.sh3[f], cfg.shCuts)}
          <span class="muted">· 2D <span style="color:${bandColor(s)}">${fmt(s)}°</span>
          gap ${fmt(c.gap[f], 3)}${
            c.leaned[f] ? ` <span style="color:${C_SQUARE}">(lean: raw ${fmt(c.gapRaw[f], 3)}, torso ${
              fmt(100 * c.tor[f] / c.torMed, 0)}%)</span>` : ""}</span></span>
        <span style="color:${C_TIGHT}">tightrope</span>
        <span><code style="color:${tightColor(tr)}">${fmt(tr, 2)}</code>
          <span class="muted">${Number.isFinite(tr)
            ? (tr < 0 ? `<span style="color:${C_TR_CROSS}">feet crossed</span>`
                      : "torso units off the lead-toe line — 0 is the target, unbanded")
            : "no heel/toe"}</span></span>
        <span style="color:${C_FT}">feet 2D</span>
        <span><code style="color:${bandColor(t)}">${fmt(t)}°</code>
          <span class="muted">dx ${fmt(c.fdx[f], 3)} dy ${fmt(c.fdy[f], 3)}</span></span>
      </div>`;

    drawTrace(host.querySelector("#bl-trace"), c, cur, f);
    drawTimeline(document.getElementById("bl-timeline"), c, cur, f);
  },

  draw(ctx, state) {
    const c = computeMetrics(state);
    if (!c) return;
    const cur = curatedInfo(state);
    const f = state.frame, sc = state.renderScale || 1;

    // Outside the curated set / span: say so and draw nothing else. No angle is
    // better than an angle whose reference axis doesn't hold.
    if (!cur?.entry || (cfg.spansOnly && !cur.inSpan[f])) {
      const msg = !cur?.entry ? "VIDEO NOT IN CURATED SET" : "OUTSIDE CURATED SPAN";
      const fsz = Math.round(14 * sc);
      ctx.save();
      ctx.strokeStyle = C_INVALID; ctx.lineWidth = 4 * sc; ctx.globalAlpha = 0.8;
      ctx.strokeRect(2 * sc, 2 * sc, ctx.canvas.width - 4 * sc, ctx.canvas.height - 4 * sc);
      ctx.globalAlpha = 1;
      ctx.font = `600 ${fsz}px ui-monospace, monospace`;
      ctx.textBaseline = "top";
      const w = ctx.measureText(msg).width + 20 * sc;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath(); ctx.roundRect(10 * sc, 10 * sc, w, fsz + 14 * sc, 6 * sc); ctx.fill();
      ctx.fillStyle = C_INVALID;
      ctx.fillText(msg, 20 * sc, 17 * sc);
      ctx.restore();
      return;
    }

    const pose = pickPose(state);
    const b = f * 17;
    const P = j => [pose.skeleton[(b + j) * 2], pose.skeleton[(b + j) * 2 + 1]];

    const seg = (aJ, bJ, color) => {
      const [ax, ay] = P(aJ), [bx, by] = P(bJ);
      if (![ax, ay, bx, by].every(Number.isFinite)) return;
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = 4 * sc;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = color;
      for (const [x, y] of [[ax, ay], [bx, by]]) {
        ctx.beginPath(); ctx.arc(x, y, 4 * sc, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    };

    // The two torso lines carry their 3D band — that is the reading with
    // thresholds behind it. Shoulders fall back to the 2D band when there is no
    // BlazePose-33 cache to measure the world angle from. Ankles stay on the
    // foot metric, which has no 3D counterpart here.
    const sDeg = shoulderDeg(c, f), tDeg = footDeg(c, f);
    seg(J.L_SHOULDER, J.R_SHOULDER,
        Number.isFinite(c.sh3[f]) ? band3Color(c.sh3[f], cfg.shCuts) : bandColor(sDeg));
    seg(J.L_HIP, J.R_HIP, band3Color(c.hip3[f], cfg.hipCuts));
    seg(J.L_ANKLE, J.R_ANKLE, bandColor(tDeg));

    // Ghost of the shoulder line at full width W, centred on the real one —
    // the gap between ghost and real IS the foreshortening the angle reads.
    const [lx, ly] = P(J.L_SHOULDER), [rx, ry] = P(J.R_SHOULDER);
    const W = c.wAuto * cfg.wScale;
    if ([lx, ly, rx, ry].every(Number.isFinite) && W > 1e-6) {
      const th = torso(pose.skeleton, f);
      const half = (W * th) / 2, cx = (lx + rx) / 2, cy = (ly + ry) / 2;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1.5 * sc; ctx.setLineDash([5 * sc, 5 * sc]);
      ctx.beginPath(); ctx.moveTo(cx - half, cy); ctx.lineTo(cx + half, cy); ctx.stroke();
      ctx.restore();
    }

    // Tightrope: vertical through the lead toe, horizontal to the rear heel.
    const tr = tightrope(state, torso(pose.skeleton, f));
    if (tr) {
      ctx.save();
      ctx.strokeStyle = C_TIGHT; ctx.lineWidth = 2 * sc;
      ctx.setLineDash([6 * sc, 6 * sc]);
      ctx.beginPath(); ctx.moveTo(tr.tx, 0); ctx.lineTo(tr.tx, ctx.canvas.height); ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 4 * sc;
      ctx.beginPath(); ctx.moveTo(tr.tx, tr.heelY); ctx.lineTo(tr.hx, tr.heelY); ctx.stroke();
      ctx.fillStyle = C_TIGHT;
      for (const [px, py] of [[tr.tx, tr.toeY], [tr.hx, tr.heelY]]) {
        ctx.beginPath(); ctx.arc(px, py, 5 * sc, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    const fsz = Math.round(13 * sc), lh = fsz + 4 * sc;
    const b3 = (v, cuts) => `${fmt(v)}° ${band3(v, cuts) || "—"}`;
    // Hips, shoulders and tightrope in the top three lines, always together —
    // the 2D pair and the constants sit underneath.
    const lines = [
      [`hips  3D  ${b3(c.hip3[f], cfg.hipCuts)}`, band3Color(c.hip3[f], cfg.hipCuts)],
      [`sh    3D  ${b3(c.sh3[f], cfg.shCuts)}`, band3Color(c.sh3[f], cfg.shCuts)],
      [tr ? `tightrope ${fmt(tr.dist, 2)}${tr.dist < 0 ? " crossed" : ""}` : `tightrope —`,
       tr ? tightColor(tr.dist) : C_INVALID],
      [`sh    2D  ${fmt(sDeg)}°`, bandColor(sDeg)],
      [`feet  2D  ${fmt(tDeg)}°`, bandColor(tDeg)],
      [`W ${fmt(W, 3)}  k ${cfg.footK.toFixed(2)}`, "#fff"],
    ];
    if (c.punch[f]) lines.push([`punch — excluded`, C_PUNCH]);
    if (c.leaned[f]) lines.push([`lean ${fmt(100 * c.tor[f] / c.torMed, 0)}% torso`, C_SQUARE]);
    const padX = 10 * sc, padY = 8 * sc, boxW = 210 * sc;
    const boxH = lines.length * lh + padY * 2 - 4 * sc;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.roundRect(ctx.canvas.width - boxW - 10 * sc, 10 * sc, boxW, boxH, 6 * sc);
    ctx.fill();
    ctx.font = `${fsz}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    lines.forEach(([t2, col], i) => {
      ctx.fillStyle = col;
      ctx.fillText(t2, ctx.canvas.width - boxW - 10 * sc + padX, 10 * sc + padY + i * lh);
    });
    ctx.restore();
  },
};

// ── below-video timeline ────────────────────────────────────────────────────

function refresh() {
  document.getElementById("video")?.dispatchEvent(new Event("seeked"));
}

// Switch the viewer to another cache round. The reel clip is cut from ONE round
// per video, and the picker opens on r0, so without this you have to know which
// round to hunt for. Drives the same <select> the user would.
function gotoRound(r) {
  const sel = document.getElementById("round-select");
  if (!sel) return;
  const opt = [...sel.options].find(o => o.value === String(r));
  if (!opt || opt.disabled) return;
  sel.value = String(r);
  sel.dispatchEvent(new Event("change"));
}

function seekTo(f) {
  const sl = document.getElementById("scrubber");
  if (!sl) return;
  sl.value = f;
  sl.dispatchEvent(new Event("input"));
}

// The whole curated set, so you can see what else is loadable without leaving
// the lens. Built once at mount; the manifest may still be in flight, in which
// case the fetch's completion re-renders it.
function renderSetList() {
  const el = host?.querySelector("#bl-set");
  const cnt = host?.querySelector("#bl-set-count");
  if (!el) return;
  if (!manifest) {
    el.innerHTML = `<span class="muted">loading…</span>`;
    manifestPromise?.then(() => renderSetList());
    return;
  }
  const segs = manifest.segments || {};
  const stems = Object.keys(segs);
  if (cnt) cnt.textContent =
    `${stems.length} videos · ${stems.reduce((a, k) => a + segs[k].length, 0)} spans`;
  el.innerHTML = stems.map(k => `
    <div title="${k.replace(/"/g, "&quot;")}" style="padding:2px 0;
         border-bottom:1px solid var(--border)">
      <span style="color:${C_ACCENT}">${segs[k].map(s => s.label).join(", ")}</span>
      — ${shortStem(k)}
    </div>`).join("");
}

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
  label.innerHTML = `Bladedness — <span style="color:${C_HIP3}">hip3D</span> /
    <span style="color:${C_SH3}">sh3D</span> banded on the coach cuts
    (<span style="color:${C_B_SQUARED}">squared</span>
    <span style="color:${C_B_BETWEEN}">between</span>
    <span style="color:${C_B_BLADED}">bladed</span>),
    <span style="color:${C_TIGHT}">tr</span> as a magnitude ramp
    (<span style="color:${C_TR_CROSS}">crossed feet</span>, no bands fit it),
    <span style="color:${C_SH}">sh2D</span> / <span style="color:${C_FT}">ft</span> on the
    placeholder edges · <span style="color:${C_PUNCH}">punch</span> ·
    faded = outside a curated span · click to seek`;
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = "bl-timeline";
  canvas.style.cssText = "display:block;width:100%;height:142px";
  canvas.width = 800; canvas.height = 142;
  wrap.appendChild(canvas);
  slot.appendChild(wrap);
  canvas.addEventListener("click", e => {
    const N = mc?.n;
    if (!N) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - TL_LABEL_W) / Math.max(1, rect.width - TL_LABEL_W - 4);
    const sl = document.getElementById("scrubber");
    if (!sl) return;
    sl.value = Math.max(0, Math.min(N - 1, Math.round(ratio * (N - 1))));
    sl.dispatchEvent(new Event("input"));
  });
}

function fitCanvas(canvas) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = Math.max(1, canvas.getBoundingClientRect().width);
  const h = Math.max(1, canvas.getBoundingClientRect().height);
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, W: w, H: h };
}

function drawTimeline(canvas, c, cur, frame) {
  if (!canvas) return;
  const { ctx, W, H } = fitCanvas(canvas);
  const N = c.n;
  if (!N) return;
  const xOf = f => TL_LABEL_W + (f / Math.max(1, N - 1)) * (W - TL_LABEL_W - 4);
  const colW = Math.max(1, (W - TL_LABEL_W - 4) / Math.max(1, N - 1));

  // The two coach-banded world-landmark tracks first — they are the ones with
  // thresholds behind them. The 2D pair below still uses the placeholder edges.
  const tracks = [
    { label: "hip3D", accent: C_HIP3, color: f => band3Color(c.hip3[f], cfg.hipCuts) },
    { label: "sh3D",  accent: C_SH3,  color: f => band3Color(c.sh3[f], cfg.shCuts) },
    { label: "tr",    accent: C_TIGHT, color: f => tightColor(c.tight[f]) },
    { label: "sh2D",  accent: C_SH,   color: f => bandColor(shoulderDeg(c, f)) },
    { label: "ft",    accent: C_FT,   color: f => bandColor(footDeg(c, f)) },
  ];
  const gap = 6, top = 4;
  const trackH = Math.floor((H - top * 2 - gap * tracks.length) / tracks.length);
  ctx.font = "10px ui-monospace, monospace";

  tracks.forEach((t, i) => {
    const y = top + i * (trackH + gap);
    ctx.fillStyle = t.accent;
    ctx.fillText(t.label, 6, y + trackH / 2 + 3);
    for (let f = 0; f < N; f++) {
      // Punch frames are grey, not a band: you blade on the jab and square up
      // on the cross by design, so the stance verdict there is about the punch.
      // Outside the curated spans the band is still drawn but faded — measured,
      // just not vouched for by the camera-as-opponent assumption.
      const punch = cfg.excludePunches && c.punch[f];
      ctx.fillStyle = punch ? C_PUNCH : t.color(f);
      ctx.globalAlpha = punch ? 0.55 : (cur?.entry && cur.inSpan[f] ? 0.9 : 0.35);
      ctx.fillRect(xOf(f), y, colW + 0.5, trackH);
    }
    ctx.globalAlpha = 1;
  });

  // bracket the slice that became the coach clip
  if (cur?.reel) {
    ctx.strokeStyle = C_REEL; ctx.lineWidth = 2;
    const x0 = xOf(cur.reel.s), x1 = xOf(cur.reel.e);
    ctx.strokeRect(x0, 2, Math.max(2, x1 - x0), H - 4);
    ctx.fillStyle = C_REEL; ctx.font = "9px ui-monospace, monospace";
    ctx.fillText("reel", Math.min(W - 24, x0 + 3), H - 3);
  }

  ctx.strokeStyle = C_FRAME; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 1); ctx.lineTo(xOf(frame), H - 1); ctx.stroke();
}

// Both angles over the round on a fixed 0–90° axis, with the band edges drawn
// so you can read the cutoffs straight off the distribution.
function drawTrace(canvas, c, cur, frame) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const N = c.n;
  if (!N) return;
  const yOf = d => H - 4 - (d / 90) * (H - 12);
  const xOf = f => (f / Math.max(1, N - 1)) * W;

  ctx.setLineDash([4, 4]);
  const rule = (d, color) => {
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(0, yOf(d)); ctx.lineTo(W, yOf(d)); ctx.stroke();
  };
  for (const d of [cfg.squaredBelow, cfg.bladedAbove]) rule(d, "rgba(255,255,255,0.35)");
  for (const d of cfg.hipCuts) rule(d, "rgba(255,154,213,0.55)");
  for (const d of cfg.shCuts) rule(d, "rgba(167,139,250,0.55)");
  ctx.setLineDash([]);

  const dots = (fn, color) => {
    for (let f = 0; f < N; f++) {
      if (!counted(c, cur, f)) continue;
      const v = fn(f);
      if (!Number.isFinite(v)) continue;
      ctx.fillStyle = color;
      ctx.fillRect(xOf(f) - 0.5, yOf(v) - 1, 2, 2);
    }
  };
  dots(f => shoulderDeg(c, f), C_SH);
  dots(f => footDeg(c, f), C_FT);
  dots(f => c.hip3[f], C_HIP3);
  dots(f => c.sh3[f], C_SH3);

  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "9px ui-monospace, monospace";
  ctx.fillText("90° side-on", 2, 9);
  ctx.fillText("0° squared", 2, H - 2);

  ctx.strokeStyle = C_FRAME; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 0); ctx.lineTo(xOf(frame), H); ctx.stroke();
}
