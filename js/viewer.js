// Main viewer. Owns the <video> + <canvas> sync, frame navigation, scrubber,
// and the rule-panel host. Rule panels register themselves via rules/registry.js
// and get a chance to (a) draw extra overlay graphics each frame and (b) own
// a side-panel DOM area that they refresh.

// Bump this on every push so the user can tell whether the new code is
// actually live or whether GitHub Pages / their browser is still serving
// a cached copy. Format: YYYY-MM-DD.N where N restarts at 1 each day.
const BUILD = "2026-09-21.1";
{
  const el = document.getElementById("build-tag");
  if (el) el.textContent = `build ${BUILD}`;
}

import "./theme.js";
import { loadPose, loadPtsArray, loadBlaze33 } from "./pose-loader.js";
import { loadPunches } from "./punches-loader.js";
import { fetchLiveLabels } from "./sheet-labels.js";
import { drawSkeleton } from "./skeleton.js";
import { RULES } from "./lenses/registry.js";
import * as drive from "./drive-folder.js";
import { Muxer, ArrayBufferTarget } from "./vendor/mp4-muxer.mjs";

const els = {
  videoFile:    document.getElementById("video-file"),
  videoPick:    document.getElementById("video-pick"),
  poseFile:     document.getElementById("pose-file"),
  cacheFolder:  document.getElementById("cache-folder"),
  cacheClear:   document.getElementById("cache-clear"),
  cacheStatus:  document.getElementById("cache-status"),
  cacheSection: document.getElementById("cache-section"),
  driveConnect: document.getElementById("drive-connect"),
  driveDisconnect: document.getElementById("drive-disconnect"),
  driveStatus:  document.getElementById("drive-status"),
  driveSection: document.getElementById("drive-section"),
  roundSel:     document.getElementById("round-select"),
  stageVideoPick: document.getElementById("stage-video-pick"),
  stageRoundSel:  document.getElementById("stage-round-select"),
  stageCopyName:  document.getElementById("stage-copy-name"),
  loadStatus:   document.getElementById("load-status"),
  pickerCard:   document.getElementById("picker-card"),
  viewer:      document.getElementById("viewer"),
  video:       document.getElementById("video"),
  canvas:      document.getElementById("overlay"),
  stage:       document.getElementById("stage"),
  prevFrame:   document.getElementById("prev-frame"),
  nextFrame:   document.getElementById("next-frame"),
  playPause:   document.getElementById("play-pause"),
  muteToggle:  document.getElementById("mute-toggle"),
  exportBtn:   document.getElementById("export-clip"),
  speedSel:    document.getElementById("speed"),
  frameLabel:  document.getElementById("frame-label"),
  scrubber:    document.getElementById("scrubber"),
  ruleSel:     document.getElementById("rule-select"),
  lensPick:    document.getElementById("lens-pick"),
  lensStatus:  document.getElementById("lens-pick-status"),
  ruleHost:    document.getElementById("rule-panel"),
  videoInfo:   document.getElementById("video-info"),
  viName:      document.getElementById("vi-name"),
  viDrive:     document.getElementById("vi-drive"),
  meta:        document.getElementById("meta"),
  thumbVideo:  document.getElementById("thumb-video"),
  thumbTip:    document.getElementById("thumb-tooltip"),
  thumbCanvas: document.getElementById("thumb-canvas"),
  thumbLabel:  document.getElementById("thumb-label"),
  stageExtras: document.getElementById("stage-extras"),
};

// Cache index built from the folder picker (or the Drive folder walker):
//   Map<videoBasename, Map<roundN, { blazepose: {npy, meta, pts?, punches?} }>>
// Slot values are EITHER File objects (manual picker) OR
// FileSystemFileHandle objects (Drive folder). loadFromIndex calls
// drive.toFile() on values when it's actually time to load.
// Survives across video picks within one page session.
//
// BlazePose is the only engine (`<stem>_blazepose_r<N>.npy`); caches of any
// other engine (Apple Vision, the glove-wrist caches, YOLO, RTMPose, MoveNet,
// YOLO11) are not indexed.
let cacheIndex = null;

// Drive-folder state: a separate index of video filename -> FileSystemFileHandle
// built by the Drive folder walker. Populated when a Drive folder is
// connected; consulted to populate the video dropdown.
let driveVideos = null;
let driveHandle = null;

// Punch-classifier predictions dumps found anywhere in the Drive folder or
// the manual cache-folder pick. Keyed by filename, value is a File OR
// FileSystemFileHandle (same dual-shape trick the cache index uses). Exposed
// to lenses via `state.predictionFiles` so the punch_classifier lens can
// auto-load without a manual file picker.
let predictionFiles = new Map();

// Monotonically increasing token. Bumped on every load attempt so an in-flight
// load can detect that a newer pick has superseded it and bail out before
// overwriting state (avoids the "I picked a new video but the old one keeps
// loading on top" race).
let currentLoadToken = 0;

const state = {
  pose: null,
  videoUrl: null,
  videoFileName: null,
  fps: 30,
  n_frames: 0,
  frame: 0,
  rule: null,    // active rule module
  raf: null,
};

// ── File loading ────────────────────────────────────────────────────────────
els.cacheFolder.addEventListener("change", onCacheFolder);
els.cacheClear.addEventListener("click", onCacheClear);
els.videoFile.addEventListener("change", onVideoPick);
els.roundSel.addEventListener("change", onRoundPick);
els.poseFile.addEventListener("change", onManualPose);
if (els.driveConnect)    els.driveConnect.addEventListener("click", onDriveConnect);
if (els.driveDisconnect) els.driveDisconnect.addEventListener("click", onDriveDisconnect);
if (els.videoPick)       els.videoPick.addEventListener("change", onDriveVideoPick);
if (els.stageVideoPick)  els.stageVideoPick.addEventListener("change", () => {
  if (!els.videoPick) return;
  els.videoPick.value = els.stageVideoPick.value;
  onDriveVideoPick();
});
if (els.stageRoundSel)   els.stageRoundSel.addEventListener("change", () => {
  els.roundSel.value = els.stageRoundSel.value;
  onRoundPick();
});
if (els.stageCopyName)   els.stageCopyName.addEventListener("click", onCopyVideoName);

// Copy the loaded video's filename to the clipboard (for pasting into the
// labels Sheet / a cache filename). Falls back to the picked-but-not-yet-
// loaded name so the button still works mid-load.
async function onCopyVideoName() {
  const name = state.videoFileName || els.videoPick?.value || "";
  if (!name) return;
  const btn = els.stageCopyName;
  const original = "⧉ Copy";
  try {
    await navigator.clipboard.writeText(name);
    btn.textContent = "✓ Copied";
  } catch (err) {
    console.error("[copy video name]", err);
    btn.textContent = "✕ Failed";
  }
  clearTimeout(btn._resetTimer);
  btn._resetTimer = setTimeout(() => { btn.textContent = original; }, 1200);
}
// On boot, hide the Drive section entirely if the API isn't there (Safari /
// Firefox today). Otherwise try to silently restore the last folder handle.
initDriveSection();
async function initDriveSection() {
  if (!els.driveSection) return;
  if (!drive.isSupported()) {
    els.driveSection.hidden = true;
    return;
  }
  const restored = await drive.tryRestore();
  if (!restored) {
    setDriveStatus("idle");
    return;
  }
  driveHandle = restored.handle;
  if (restored.permission === "granted") {
    await refreshDriveFolder();
  } else {
    setDriveStatus("needs-permission", restored.handle.name);
  }
}

function setDriveStatus(state, name) {
  if (!els.driveStatus) return;
  // Disabled only while actively scanning — every other state leaves the
  // button clickable (it's also how you retry after "denied").
  if (els.driveConnect) els.driveConnect.disabled = state === "scanning";
  switch (state) {
    case "idle":
      els.driveStatus.textContent = "— not connected";
      els.driveStatus.dataset.state = "";
      if (els.driveConnect)    els.driveConnect.textContent = "Connect Drive folder";
      if (els.driveDisconnect) els.driveDisconnect.hidden = true;
      break;
    case "needs-permission":
      els.driveStatus.innerHTML = `— need permission for <code>${name || "folder"}</code>`;
      els.driveStatus.dataset.state = "warn";
      if (els.driveConnect)    els.driveConnect.textContent = "Reconnect";
      if (els.driveDisconnect) els.driveDisconnect.hidden = false;
      break;
    case "scanning":
      els.driveStatus.innerHTML = `— scanning <code>${name || ""}</code>…`;
      els.driveStatus.dataset.state = "busy";
      if (els.driveDisconnect) els.driveDisconnect.hidden = false;
      break;
    case "connected": {
      const nRounds = countRounds(cacheIndex);
      const nVideos = driveVideos?.size || 0;
      els.driveStatus.innerHTML =
        `— connected to <code>${name || "folder"}</code> · ${nVideos} videos · ${nRounds} round caches`;
      els.driveStatus.dataset.state = "success";
      if (els.driveConnect)    els.driveConnect.textContent = "Pick a different folder";
      if (els.driveDisconnect) els.driveDisconnect.hidden = false;
      break;
    }
    case "denied":
      els.driveStatus.innerHTML = `— permission denied for <code>${name || "folder"}</code>`;
      els.driveStatus.dataset.state = "error";
      if (els.driveConnect)    els.driveConnect.textContent = "Reconnect";
      if (els.driveDisconnect) els.driveDisconnect.hidden = false;
      break;
  }
}

function countRounds(idx) {
  let n = 0;
  for (const rounds of idx?.values() || []) n += rounds.size;
  return n;
}

async function onDriveConnect() {
  // Two distinct flows: (1) we already have a handle but need permission, and
  // (2) the user wants to pick a (different) folder. Either way ends with a
  // valid handle + read permission, then a re-scan.
  try {
    if (driveHandle) {
      const perm = await drive.requestPermission(driveHandle);
      if (perm === "granted") {
        await refreshDriveFolder();
        return;
      }
      // Fall through to pick a new folder if denied.
    }
    const handle = await drive.pickFolder();
    driveHandle = handle;
    await refreshDriveFolder();
  } catch (err) {
    if (err?.name === "AbortError") return;     // user cancelled picker
    console.error("Drive folder connect failed:", err);
    els.loadStatus.textContent = `Drive folder: ${err.message}`;
  }
}

async function onDriveDisconnect() {
  driveHandle = null;
  driveVideos = null;
  // Clear only Drive-sourced entries — the manual cache picker may have added
  // its own entries we don't want to drop. For now we don't distinguish, so
  // clearing the whole index is the safe behaviour; pick again to rebuild.
  cacheIndex = null;
  predictionFiles = new Map();
  await drive.forget();
  populateDriveVideoSelect();
  populateRoundSelect(null);
  refreshCacheStatus();
  setDriveStatus("idle");
  notifyPredictionFilesChanged();
}

async function refreshDriveFolder() {
  if (!driveHandle) return;
  setDriveStatus("scanning", driveHandle.name);
  try {
    const { videos, cacheIndex: idx, predictions } = await drive.walk(driveHandle);
    driveVideos = videos;
    // Merge Drive-sourced entries on top of anything from the manual picker —
    // Drive wins (more likely fresh).
    if (!cacheIndex) cacheIndex = new Map();
    for (const [base, rounds] of idx) {
      if (!cacheIndex.has(base)) cacheIndex.set(base, new Map());
      const merged = cacheIndex.get(base);
      for (const [round, slot] of rounds) merged.set(round, slot);
    }
    // Replace any prior Drive-sourced predictions; merge with anything the
    // manual cache-folder picker may have added (those are File objects,
    // Drive's are handles — both work via drive.toFile()).
    if (predictions) {
      for (const [name, handle] of predictions) predictionFiles.set(name, handle);
    }
    populateDriveVideoSelect();
    refreshCacheStatus();
    setDriveStatus("connected", driveHandle.name);
    notifyPredictionFilesChanged();
  } catch (err) {
    console.error("Drive folder walk failed:", err);
    setDriveStatus("denied", driveHandle.name);
    els.loadStatus.textContent = `Drive folder walk failed: ${err.message}`;
  }
}

function populateDriveVideoSelect() {
  if (!els.videoPick) return;
  const sel = els.videoPick;
  // Preserve current selection across re-population (e.g. when the lens
  // changes) so the user doesn't lose the video they're inspecting.
  const previousValue = sel.value;
  sel.innerHTML = "";
  if (!driveVideos || driveVideos.size === 0) {
    sel.innerHTML = `<option value="">— connect a Drive folder to populate —</option>`;
    sel.disabled = true;
    setLensStatus(null, null);
    syncStagePickers();
    return;
  }
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = `— pick a video from ${driveHandle?.name || "Drive folder"} —`;
  sel.appendChild(placeholder);
  // Lens-aware filter: only show videos whose cached rounds satisfy the
  // active lens's requires(). Two states per video:
  //   matched = lens-compatible cache exists for at least one round
  //   anyCache = some cache exists, but not for this lens (kept visible
  //              with a "(no <lens> cache)" tag so the user can see the
  //              video isn't forgotten — they just need a different lens)
  const items = [...driveVideos.entries()].map(([name, h]) => {
    const base = videoBasename(name);
    const rounds = cacheIndex?.get(base);
    const anyCache = !!rounds?.size;
    const matched = videoMatchesActiveLens(base);
    return { name, h, matched, anyCache };
  });
  // Sort: lens-matched first, then any-cache, then nothing.
  items.sort((a, b) => {
    if (a.matched !== b.matched) return a.matched ? -1 : 1;
    if (a.anyCache !== b.anyCache) return a.anyCache ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  let matchedCount = 0;
  for (const it of items) {
    if (!it.matched) continue;   // hide non-matching videos entirely
    matchedCount++;
    const o = document.createElement("option");
    o.value = it.name;
    o.textContent = it.name;
    sel.appendChild(o);
  }
  setLensStatus(matchedCount, items.length);
  // Restore previous selection if it's still selectable, else clear.
  if (previousValue && [...sel.options].some(o => o.value === previousValue && !o.disabled)) {
    sel.value = previousValue;
  }
  sel.disabled = false;
  syncStagePickers();
}

// The stage-side dropdowns are pure mirrors of the picker-card ones: same
// options, same enabled/disabled state, same value. Rebuilt whenever the
// source dropdowns are.
function mirrorSelect(src, dst) {
  if (!src || !dst) return;
  dst.innerHTML = "";
  for (const o of src.options) {
    const c = document.createElement("option");
    c.value = o.value;
    c.textContent = o.textContent;
    c.disabled = o.disabled;
    dst.appendChild(c);
  }
  dst.value = src.value;
  dst.disabled = src.disabled;
}

function syncStagePickers() {
  mirrorSelect(els.videoPick, els.stageVideoPick);
  mirrorSelect(els.roundSel, els.stageRoundSel);
}

// True if a round-slot satisfies the active lens's requirements.
// Default predicate (when a rule doesn't declare `requires`): the round has
// a BlazePose cache. A lens's `requires(slot, { base, round })` also gets
// WHICH round of WHICH video it is judging, for lenses whose scope is a
// curated span inside a video (slips: one frontal round out of eight).
function slotMatchesActiveLens(slot, base, round) {
  const req = state.rule?.requires;
  if (!req) return !!slot?.blazepose;
  try { return !!req(slot, { base, round }); }
  catch { return false; }
}

function videoMatchesActiveLens(base) {
  const rounds = cacheIndex?.get(base);
  if (!rounds) return false;
  // Optional per-VIDEO predicate, alongside the per-slot `requires`. A lens
  // that curates a specific set of source videos (frontal_segments) filters on
  // the basename — engine availability says nothing about whether the clip is
  // in the set. Lenses without it are unaffected.
  const requiresVideo = state.rule?.requiresVideo;
  if (requiresVideo) {
    try { if (!requiresVideo(base)) return false; }
    catch { return false; }
  }
  for (const [round, slot] of rounds) {
    if (slotMatchesActiveLens(slot, base, round)) return true;
  }
  return false;
}

// A lens whose video filter depends on data it fetches (a manifest, an index)
// can't answer requiresVideo() until that lands. It fires this once the data
// is in so the dropdowns re-filter instead of staying stale.
window.addEventListener("lens-filter-changed", () => {
  populateDriveVideoSelect();
});

// Warm a Drive video and its cache files so a later load is quick. With Drive
// for Desktop in streaming mode a file is a placeholder until something reads
// it, and the first read downloads the whole thing — for a 20-minute video
// that is the wait a lens sees when it switches videos. Draining the bytes here
// (read and discard, nothing kept) makes Drive fetch them NOW, while the user
// is still on the current clip. Lenses that step through footage across videos
// (slip_exploration) call this for the next clip's video; harmless when the files
// are already local. One in-flight prefetch per name; a finished one is
// remembered for the session.
const prefetched = new Map();   // name → Promise<boolean>
window.cornermanPrefetchVideo = function prefetchDriveVideo(name) {
  if (!name || !driveVideos?.has(name)) return Promise.resolve(false);
  if (prefetched.has(name)) return prefetched.get(name);
  const drain = async fileOrHandle => {
    const file = fileOrHandle?.getFile ? await fileOrHandle.getFile() : fileOrHandle;
    if (!file?.stream) return;
    const reader = file.stream().getReader();
    while (!(await reader.read()).done) { /* discard */ }
  };
  const p = (async () => {
    try {
      await drain(driveVideos.get(name));
      const rounds = cacheIndex?.get(videoBasename(name));
      for (const slot of rounds?.values() || []) {
        for (const eng of Object.values(slot)) {
          for (const k of ["npy", "meta", "pts"]) if (eng?.[k]) await drain(eng[k]);
        }
      }
      return true;
    } catch (err) {
      console.warn("prefetch failed:", name, err);
      prefetched.delete(name);
      return false;
    }
  })();
  prefetched.set(name, p);
  return p;
};

async function onDriveVideoPick() {
  const name = els.videoPick.value;
  if (!name) return;
  const handle = driveVideos?.get(name);
  if (!handle) return;
  // Materialize the video file from its handle and feed the same code path
  // the manual <input type=file> uses.
  let file;
  try { file = await handle.getFile(); }
  catch (err) {
    els.loadStatus.textContent = `Couldn't open ${name}: ${err.message}`;
    return;
  }
  // Stuff the same File-like into the videoFile input via a DataTransfer so
  // the existing onVideoPick path runs unchanged.
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    els.videoFile.files = dt.files;
  } catch {
    /* DataTransfer assignment isn't strictly required — onVideoPick reads
       from els.videoFile.files, and if assignment fails we still have the
       file in scope. Fall through to direct pose load below. */
  }
  onVideoPick();
}

// Folder picker: index every `<base>_blazepose_r<N>.npy` and matching
// `<base>_blazepose_r<N>_meta.json` (same pattern as drive-folder.js's walk).
//
// Picks MERGE into the existing index (pick one folder, then another); use
// the Clear button to start over. Re-picking a folder that already contributed
// files just upserts those files — same files in same slot, no growth.
function onCacheFolder(e) {
  const files = Array.from(e.target.files || []);
  if (!cacheIndex) cacheIndex = new Map();
  let predictionsTouched = false;
  for (const f of files) {
    if (/^predictions_.*\.json$/i.test(f.name)) {
      predictionFiles.set(f.name, f);
      predictionsTouched = true;
      continue;
    }
    if (f.name.endsWith(".bak.npy")) continue;
    // Sibling patterns we recognize per round:
    //   <base>_blazepose_r<N>.npy           — pose data
    //   <base>_blazepose_r<N>_meta.json     — pose metadata
    //   <base>_blazepose_r<N>_pts.npy       — per-frame timestamps (optional)
    //   <base>_blazepose_r<N>_punches.json  — ST-GCN detections (optional)
    // GT labels are pulled live from the Sheet at load time — no sidecar.
    const m = f.name.match(
      /^(.+?)_(blazepose)_r(\d+)(_meta|_punches|_pts)?\.(npy|json)$/
    );
    if (!m) continue;
    const [, base, engine, roundStr, suffix, ext] = m;
    const round = parseInt(roundStr);
    if (ext === "json" && !suffix) continue;

    if (!cacheIndex.has(base)) cacheIndex.set(base, new Map());
    const rounds = cacheIndex.get(base);
    if (!rounds.has(round)) rounds.set(round, {});
    const roundSlot = rounds.get(round);
    if (!roundSlot[engine]) roundSlot[engine] = {};
    const engineSlot = roundSlot[engine];
    if (ext === "npy" && suffix === "_pts")        engineSlot.pts = f;
    else if (ext === "npy")                        engineSlot.npy = f;
    else if (suffix === "_meta")                   engineSlot.meta = f;
    else if (suffix === "_punches")                engineSlot.punches = f;
  }

  // Drop incomplete pose pairs (need .npy + _meta.json). The pts and punches
  // sidecars are optional — their absence is fine.
  for (const [base, rounds] of cacheIndex) {
    for (const [round, slot] of rounds) {
      if (!slot.blazepose?.npy || !slot.blazepose?.meta) rounds.delete(round);
    }
    if (rounds.size === 0) cacheIndex.delete(base);
  }

  refreshCacheStatus();

  // Reset the input so picking the same folder again still fires `change`
  // (otherwise the second click is a no-op and the user thinks merging is
  // broken).
  els.cacheFolder.value = "";

  if (predictionsTouched) notifyPredictionFilesChanged();

  // Re-evaluate any already-picked video against the updated index.
  if (els.videoFile.files[0]) onVideoPick();
}

// Push the latest prediction-file map onto state and re-mount the active
// lens if it cares. Lens reads state.predictionFiles inside mount().
function notifyPredictionFilesChanged() {
  state.predictionFiles = predictionFiles;
  if (state.pose && state.rule) {
    state.rule.mount(els.ruleHost, state);
    redraw();
  }
}

function onCacheClear() {
  cacheIndex = null;
  refreshCacheStatus();
  populateRoundSelect(null);
  if (els.videoFile.files[0]) onVideoPick();
}

function refreshCacheStatus() {
  const nVideos = cacheIndex?.size || 0;
  const nRounds = countRounds(cacheIndex);
  if (nRounds) {
    els.cacheStatus.textContent =
      `— ${nRounds} BlazePose rounds across ${nVideos} videos`;
    els.cacheStatus.dataset.state = "success";
    if (els.cacheSection) els.cacheSection.open = false;
    els.cacheClear.hidden = false;
  } else {
    els.cacheStatus.textContent = cacheIndex
      ? "— no `_blazepose_r{N}.npy + _meta.json` pairs found in that folder"
      : "— pick once per session";
    els.cacheStatus.dataset.state = cacheIndex ? "error" : "";
    els.cacheClear.hidden = true;
  }
}

function onVideoPick() {
  const v = els.videoFile.files[0];
  if (!v) return;

  if (!cacheIndex) {
    // No cache index yet — still swap the video so the user sees their
    // pick reflected, just without skeleton.
    loadVideoOnly(v, "Pick a cache folder above, or open the manual file picker.");
    populateRoundSelect(null);
    return;
  }
  const base = videoBasename(v.name);
  const rounds = cacheIndex.get(base);
  if (!rounds || rounds.size === 0) {
    // Same idea — show the new video so it's obvious the pick worked,
    // and surface the matching error.
    loadVideoOnly(v,
      `⚠ No cache match for "${base}". Use the manual file pick below, ` +
      `or rename the video to match a cache basename.`);
    populateRoundSelect(null);
    return;
  }
  populateRoundSelect(rounds, base);
  // Always auto-load the first round. (The dropdown defaults to r0 so
  // clicking r0 doesn't fire `change`; the dropdown stays interactive so
  // you can still pick r1, r2, …)
  const first = [...rounds.keys()].sort((a, b) => a - b)[0];
  els.roundSel.value = String(first);
  syncStagePickers();
  loadFromIndex(v, rounds.get(first));
}

// Swap the video src without loading any pose. Clears any leftover skeleton
// from the previous round so the screen is honest about the missing data.
function loadVideoOnly(videoFile, errMessage) {
  const token = ++currentLoadToken;
  els.loadStatus.textContent = `Loading ${videoFile.name}…`;
  loadVideo(videoFile)
    .then(() => {
      if (token !== currentLoadToken) return;
      state.pose = null;
      state.blaze33 = null;
      state.n_frames = 0;
      state.frame = 0;
      els.scrubber.max = 0;
      els.scrubber.value = 0;
      fitCanvasToVideo();
      // Clear the canvas explicitly — redraw() early-returns when no pose,
      // which would leave the prior skeleton ghosting on screen.
      const ctx = els.canvas.getContext("2d");
      ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
      els.viewer.hidden = false;
      els.frameLabel.textContent = "no pose data loaded";
      els.meta.textContent = `${videoFile.name} · ${els.video.videoWidth}×${els.video.videoHeight}`;
      els.loadStatus.textContent = errMessage;
    })
    .catch(err => {
      if (token !== currentLoadToken) return;
      els.loadStatus.textContent = `Error: ${err.message}`;
    });
}

function onRoundPick() {
  const v = els.videoFile.files[0];
  const r = parseInt(els.roundSel.value);
  if (!v || isNaN(r)) return;
  const base = videoBasename(v.name);
  const pair = cacheIndex?.get(base)?.get(r);
  if (pair) loadFromIndex(v, pair);
}

function onManualPose() {
  const v = els.videoFile.files[0];
  const ps = els.poseFile.files;
  const haveNpy  = Array.from(ps).some(f => f.name.endsWith(".npy"));
  const haveJson = Array.from(ps).some(f => f.name.endsWith(".json"));
  if (!v || !haveNpy || !haveJson) {
    const missing = [];
    if (!v) missing.push("video");
    if (!haveNpy) missing.push(".npy");
    if (!haveJson) missing.push("_meta.json");
    els.loadStatus.textContent = missing.length === 3
      ? "" : `Still need: ${missing.join(", ")}`;
    return;
  }
  loadFromFiles(v, ps);
}

function loadFromIndex(videoFile, slot) {
  // Every lens runs on BlazePose (the only engine the index holds). A round
  // without a complete BlazePose cache never reaches the index, but guard
  // anyway: show the video with a clear message and NO skeleton.
  // loadVideoOnly clears any leftover skeleton so the screen is honest about
  // the gap.
  const blaze = slot?.blazepose;
  if (!blaze) {
    loadVideoOnly(videoFile,
      `⚠ No BlazePose cache for this round — extract a _blazepose_ cache ` +
      `for this video/round.`);
    return;
  }
  els.loadStatus.textContent = `Loading ${videoFile.name}…`;

  const token = ++currentLoadToken;
  loadVideo(videoFile)
    .then(async () => {
      if (token !== currentLoadToken) return;
      const size = { width: els.video.videoWidth, height: els.video.videoHeight };
      // Each slot value may be a File OR a FileSystemFileHandle (Drive folder).
      // drive.toFile() returns a File from either.
      const npyFile  = await drive.toFile(blaze.npy);
      const metaFile = await drive.toFile(blaze.meta);
      // The 33→COCO-17 remap every lens reads as state.pose.
      const pose = await loadPose([npyFile, metaFile], size);
      if (token !== currentLoadToken) return;
      // Per-frame PTS sidecar → exact source-video time of each cache frame.
      if (blaze.pts) pose.pts = await loadPtsArray(await drive.toFile(blaze.pts));
      // Optional sibling: ST-GCN punch detections for this round.
      let punches = null;
      if (blaze.punches) {
        try {
          const punchFile = await drive.toFile(blaze.punches);
          punches = await loadPunches(punchFile);
        } catch (err) {
          console.warn("punches load failed:", err.message);
        }
      }
      // Full BlazePose-33 (all joints + z + visibility + presence) for the
      // lenses that need what the COCO-17 remap drops (feet, world-3D).
      let blaze33 = null;
      try {
        blaze33 = await loadBlaze33(npyFile, metaFile, size);
        if (pose.pts) blaze33.pts = pose.pts;
      } catch (err) { console.warn("blaze33 load failed:", err.message); }

      if (token !== currentLoadToken) return;
      start(pose, punches, blaze33);

      // Expose cache identity on state so lenses that key by (stem, round, frame)
      // — e.g. orientation_lens looking up orientation GT labels — can find it
      // without re-parsing filenames themselves. Round comes from the `_rN`
      // suffix; cacheBasename is the source-video stem (suffix stripped).
      const npyName = npyFile.name;
      state.cacheBasename = stripCacheSuffix(npyName);
      const rndMatch = /_blazepose_r(\d+)\.npy$/i.exec(npyName);
      state.cacheRound = rndMatch ? parseInt(rndMatch[1], 10) : null;

      // Live GT labels: derive a basename from the cache filename, then hit
      // the Sheet. Best-effort — failure just leaves state.labels null so
      // the lens falls back to ST-GCN / heuristic.
      tryLiveLabels({
        cacheBasename: state.cacheBasename,
        cacheStartSec: pose.start_sec || 0,
        fps: pose.fps,
        nFrames: pose.n_frames,
        token,
      });
    })
    .catch(err => {
      if (token !== currentLoadToken) return;
      console.error(err);
      els.loadStatus.textContent = `Error: ${err.message}`;
    });
}

function loadFromFiles(videoFile, poseFiles) {
  // Manual file picker — one BlazePose round. Pose loader takes the .npy and
  // the _meta.json; a third file ending in _punches.json is consumed as the
  // ST-GCN-detection source. GT labels are pulled live from the Sheet using
  // the cache basename as the source-video hint.
  const all = Array.from(poseFiles);
  const punchFile = all.find(f => /_punches\.json$/i.test(f.name));
  const poseOnly  = all.filter(f => f !== punchFile);
  const npyFile   = all.find(f => /\.npy$/i.test(f.name));
  const names = all.map(f => f.name).join(" + ");
  els.loadStatus.textContent = `Loading ${videoFile.name} + ${names}…`;
  const token = ++currentLoadToken;
  loadVideo(videoFile)
    .then(async () => {
      if (token !== currentLoadToken) return null;
      const pose = await loadPose(poseOnly, {
        width: els.video.videoWidth,
        height: els.video.videoHeight,
      });
      let punches = null;
      if (punchFile) {
        try { punches = await loadPunches(punchFile); }
        catch (err) { console.warn("punches load failed:", err.message); }
      }
      return { pose, punches };
    })
    .then(loaded => {
      if (loaded == null || token !== currentLoadToken) return;
      start(loaded.pose, null, loaded.punches);
      // Mirror the cache-identity wiring from loadFromIndex so lenses that
      // need (stem, round, frame) work in the manual-picker path too.
      if (npyFile) {
        state.cacheBasename = stripCacheSuffix(npyFile.name);
        const rndMatch = /_blazepose_r(\d+)\.npy$/i.exec(npyFile.name);
        state.cacheRound = rndMatch ? parseInt(rndMatch[1], 10) : null;
      }
      // Live GT labels.
      tryLiveLabels({
        cacheBasename: state.cacheBasename || null,
        cacheStartSec: loaded.pose.start_sec || 0,
        fps: loaded.pose.fps,
        nFrames: loaded.pose.n_frames,
        token,
      });
    })
    .catch(err => {
      if (token !== currentLoadToken) return;
      console.error(err);
      els.loadStatus.textContent = `Error: ${err.message}`;
    });
}

function populateRoundSelect(rounds, base = null) {
  // start()→setRule() rebuilds this dropdown on every load, so the user's
  // pick has to survive the rebuild or it visually snaps back to r0.
  const prev = els.roundSel.value;
  els.roundSel.innerHTML = "";
  if (!rounds || rounds.size === 0) {
    els.roundSel.innerHTML = `<option value="">—</option>`;
    els.roundSel.disabled = true;
    syncStagePickers();
    return;
  }
  // Lens-aware: rounds without a cache for the active lens are still listed
  // (so the user can see r0/r1/r2/… all exist) but disabled so they can't
  // be picked when the lens won't render anything for them.
  const sorted = [...rounds.keys()].sort((a, b) => a - b);
  let enabledCount = 0;
  for (const r of sorted) {
    const o = document.createElement("option");
    o.value = String(r);
    const slot = rounds.get(r);
    const ok = slotMatchesActiveLens(slot, base, r);
    if (!ok) o.disabled = true;
    o.textContent = ok ? `r${r}` : `r${r} (outside this lens)`;
    els.roundSel.appendChild(o);
    if (ok) enabledCount++;
  }
  els.roundSel.disabled = enabledCount < 2;
  if (prev && [...els.roundSel.options].some(o => o.value === prev && !o.disabled)) {
    els.roundSel.value = prev;
  }
  syncStagePickers();
}

// Strip extension; the cache files were named after the source video so
// `<videoBasename>` should be the prefix of `<videoBasename>_blazepose_r0.npy`.
function videoBasename(name) {
  return name.replace(/\.[^.]+$/, "");
}

// Strip the cache-shape tail from a .npy filename so what's left is the
// basename that points at the source video. `30 MIN…_h264_blazepose_r0.npy`
// → `30 MIN…_h264`. Anything that doesn't match the convention is returned
// extension-stripped so we can still try a fuzzy match.
function stripCacheSuffix(fileName) {
  if (!fileName) return null;
  return fileName
    .replace(/\.npy$/i, "")
    .replace(/_blazepose_r\d+$/i, "");
}

// Fire a best-effort live-label fetch. Doesn't block UI. On success, sets
// state.labels and remounts the active lens so the new data shows up.
async function tryLiveLabels({ cacheBasename, cacheStartSec, fps, nFrames, token }) {
  if (!cacheBasename) return;
  let live;
  try {
    live = await fetchLiveLabels({ cacheBasename, cacheStartSec, fps, nFrames });
  } catch (err) {
    console.warn("live label fetch threw:", err);
    return;
  }
  if (token !== currentLoadToken) return;
  if (live.error) {
    // Stash a minimal state.labels so the source pill can explain WHY there
    // are no labels (auto-match failed, network failed, etc).
    state.labels = { error: live.error, cacheBasename, detections: [] };
  } else {
    state.labels = live;
  }
  if (state.rule) state.rule.mount(els.ruleHost, state);
  redraw();
}

function loadVideo(file) {
  return new Promise((resolve, reject) => {
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = URL.createObjectURL(file);
    state.videoFileName = file.name;
    updateVideoInfo();
    els.video.src = state.videoUrl;
    // The thumb-video shares the source so we can seek-and-snapshot it on
    // scrubber hover without disturbing the main playback.
    els.thumbVideo.src = state.videoUrl;
    els.video.onloadedmetadata = () => resolve();
    els.video.onerror = () => reject(new Error("Video failed to load"));
  });
}

// Surface the current source video's filename plus a Drive *search* link in
// the side panel. We only have local file handles (File System Access API),
// not Drive file IDs, so a name-search query is the best deep link we can
// build without Drive API + OAuth. yt-dlp may have substituted unicode
// look-alikes (｜ ⧸) into the filename; those round-trip fine through the
// search query.
function updateVideoInfo() {
  if (!els.videoInfo) return;
  const name = state.videoFileName;
  if (!name) { els.videoInfo.hidden = true; return; }
  els.viName.textContent = name;
  const stem = name.replace(/\.[^.]+$/, "");
  els.viDrive.href = `https://drive.google.com/drive/search?q=${encodeURIComponent(stem)}`;
  els.videoInfo.hidden = false;
}

function start(pose, punches = null, blaze33 = null) {
  state.pose = pose;                     // BlazePose, remapped to COCO-17
  state.blaze33 = blaze33;               // optional full BlazePose-33 (feet, z, world-3D)
  state.punches = punches;               // optional ST-GCN detections
  state.labels = null;                   // populated asynchronously by tryLiveLabels()
  state.orientationLabels = null;        // populated by orientation lens on demand
  state.predictionFiles = predictionFiles; // punch-classifier dumps from Drive / cache folder
  state.fps = pose.fps;
  state.n_frames = pose.n_frames;
  state.start_sec = pose.start_sec || 0;
  // YOLO extraction (yolo_pose_extraction.ipynb) floors the start frame:
  //   start_frame = int(actual_start_sec * fps); cap.set(POS_FRAMES, start_frame)
  // and walks N frames from there. The .npy data therefore lives on
  // source frames [start_frame_floor .. start_frame_floor + n_frames).
  // If we set video.currentTime = start_sec + (f+0.5)/fps directly, when
  // (start_sec * fps) has a fractional part >= 0.5, the +0.5 epsilon walks
  // us past the floored frame's time slot into the next source frame —
  // skeleton ends up drawn one frame late. Snap to the floored frame's
  // timeline instead so seek and data agree.
  state.start_frame = Math.floor(state.start_sec * state.fps);
  state.frame = 0;

  els.pickerCard.classList.add("loaded");
  els.viewer.hidden = false;
  els.scrubber.max = pose.n_frames - 1;
  els.scrubber.value = 0;

  fitCanvasToVideo();

  populateRuleSelect();
  setRule(els.ruleSel.value);

  // Cache covers [start_sec, start_sec + n_frames/fps]. The official
  // round begins at round_start_sec which can be later than start_sec
  // when a pre-buffer is included — that's why frame 0 of the cache
  // shows footage BEFORE the round, not the first punch.
  const startSec = state.start_sec;
  const endSec = startSec + pose.n_frames / pose.fps;
  const clipRange = startSec || endSec !== els.video.duration
    ? ` · clip ${startSec.toFixed(1)}–${endSec.toFixed(1)}s of ${els.video.duration.toFixed(1)}s video`
    : "";
  const preBuffer = pose.pre_buffer_sec > 0.01
    ? ` · ${pose.pre_buffer_sec.toFixed(1)}s pre-buffer (round starts ${pose.round_start_sec.toFixed(1)}s)`
    : "";
  els.meta.textContent =
    `${pose.engine} · ${pose.width}×${pose.height} · ` +
    `${pose.fps.toFixed(1)} fps · ${pose.n_frames} frames${clipRange}${preBuffer}`;
  els.loadStatus.textContent = "";

  // Cache the pre-buffer frame count so the frame-label can mark when the
  // round officially starts.
  state.pre_buffer_frames = Math.round(pose.pre_buffer_sec * pose.fps);

  seekToFrame(0);
}

function fitCanvasToVideo() {
  // Canvas internal resolution = video native resolution, so we can draw using
  // raw skeleton pixel coords. CSS sizes both elements together.
  const w = els.video.videoWidth || state.pose?.width || 16;
  const h = els.video.videoHeight || state.pose?.height || 9;
  els.canvas.width = w;
  els.canvas.height = h;
  // Tell the .video-wrap CSS the aspect ratio so portrait videos don't
  // explode vertically — the wrap caps at 75vh and uses this ratio to
  // pick a sane width.
  const wrap = document.querySelector(".video-wrap");
  if (wrap) wrap.style.setProperty("--video-ratio", `${w} / ${h}`);
}

window.addEventListener("resize", () => {
  // CSS handles visual sizing; nothing to redo internally. Repaint anyway.
  redraw();
});

// ── Ctrl+scroll to zoom the video + overlay ──────────────────────────────────
// Scales the video and its skeleton overlay together via a shared CSS transform
// (transform-origin 0 0, so identical transforms stay aligned). Ctrl+wheel —
// which is also what a macOS trackpad pinch dispatches — zooms toward the
// cursor; scrolling back out clamps to 1× and recentres. Double-click resets.
const videoWrap = document.querySelector(".video-wrap");
const zoom = { scale: 1, tx: 0, ty: 0 };
// 8x sounds like a lot and isn't: the canvas carries the source video's own
// resolution (often 1080 wide) inside a CSS box a quarter that size, so 8x
// was only ~3x past native. Chin work compares marks a few source pixels
// apart, which needs to go further.
const ZOOM_MAX = 24;

// The zoom, plus the part of the canvas still visible through the wrap, in
// CANVAS pixels. A lens divides its drawing dimensions by `zoom` to hold a
// constant size on screen, and anchors HUD or insets to [x0,y0]-[x1,y1] so
// they don't drift off the edge when you zoom or pan. Lenses that ignore it
// behave exactly as before.
function viewTransform() {
  const z = zoom.scale || 1;
  const s = state.renderScale || 1;
  const full = { zoom: z, x0: 0, y0: 0,
                 x1: els.canvas.width, y1: els.canvas.height };
  const rect = videoWrap?.getBoundingClientRect();
  if (!rect || !rect.width || !rect.height) return full;
  // transform-origin is 0 0, so a canvas CSS point c maps to wrap point
  // t + c*z. Invert that over the wrap's own box, then CSS -> canvas px.
  return {
    zoom: z,
    x0: Math.max(0, (-zoom.tx / z) * s),
    y0: Math.max(0, (-zoom.ty / z) * s),
    x1: Math.min(els.canvas.width, ((rect.width - zoom.tx) / z) * s),
    y1: Math.min(els.canvas.height, ((rect.height - zoom.ty) / z) * s),
  };
}

// Wheel events fire far faster than we need to repaint, so coalesce.
let zoomRedraw = 0;
function applyZoom() {
  const t = `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`;
  els.video.style.transform = t;
  els.canvas.style.transform = t;
  // Hint that the frame is draggable once it's zoomed in.
  if (videoWrap) videoWrap.style.cursor = zoom.scale > 1 ? "grab" : "";
  // Zoom-aware lenses have to re-render to pick up the new scale.
  if (!zoomRedraw) {
    zoomRedraw = requestAnimationFrame(() => { zoomRedraw = 0; redraw(); });
  }
}

// Keep the frame covering the wrap (no black gaps) after any tx/ty change.
function clampPan(rect) {
  zoom.tx = Math.max(rect.width  * (1 - zoom.scale), Math.min(0, zoom.tx));
  zoom.ty = Math.max(rect.height * (1 - zoom.scale), Math.min(0, zoom.ty));
}

function resetZoom() {
  zoom.scale = 1; zoom.tx = 0; zoom.ty = 0;
  applyZoom();
}

if (videoWrap) {
  els.video.style.transformOrigin = "0 0";
  els.canvas.style.transformOrigin = "0 0";
  videoWrap.addEventListener("wheel", e => {
    if (!e.ctrlKey) return;            // only ctrl+scroll / pinch zooms
    e.preventDefault();
    const rect = videoWrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Content point currently under the cursor, in unscaled wrap coords.
    const cx = (mx - zoom.tx) / zoom.scale;
    const cy = (my - zoom.ty) / zoom.scale;
    // Exponential step feels uniform across zoom levels.
    const next = zoom.scale * Math.exp(-e.deltaY * 0.0015);
    zoom.scale = Math.max(1, Math.min(ZOOM_MAX, next));
    // Keep that content point pinned under the cursor.
    zoom.tx = mx - cx * zoom.scale;
    zoom.ty = my - cy * zoom.scale;
    clampPan(rect);
    applyZoom();
  }, { passive: false });
  videoWrap.addEventListener("dblclick", resetZoom);

  // Hold left mouse + drag to pan the zoomed-in frame around.
  let drag = null;
  videoWrap.addEventListener("mousedown", e => {
    if (e.button !== 0 || zoom.scale <= 1) return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, tx: zoom.tx, ty: zoom.ty };
    videoWrap.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", e => {
    if (!drag) return;
    zoom.tx = drag.tx + (e.clientX - drag.x);
    zoom.ty = drag.ty + (e.clientY - drag.y);
    clampPan(videoWrap.getBoundingClientRect());
    applyZoom();
  });
  window.addEventListener("mouseup", () => {
    if (!drag) return;
    drag = null;
    applyZoom();                       // restores the "grab" cursor
  });
}

// ── Rule panels ─────────────────────────────────────────────────────────────
function fillLensOptions(sel) {
  sel.innerHTML = "";
  for (const r of RULES) {
    const o = document.createElement("option");
    o.value = r.id;
    o.textContent = r.label;
    sel.appendChild(o);
  }
}

function populateRuleSelect() {
  // Preserve the active lens across the rebuild so loading a new video
  // doesn't snap it back to the first one — including a lens the user
  // picked in the picker card before any video was loaded (at which point
  // this select is still empty, so fall back to state.rule). The RULES list
  // is static so the previous id will always still exist.
  const prev = els.ruleSel.value || state.rule?.id;
  fillLensOptions(els.ruleSel);
  if (prev && [...els.ruleSel.options].some(o => o.value === prev)) {
    els.ruleSel.value = prev;
  }
}

els.ruleSel.addEventListener("change", () => setRule(els.ruleSel.value));

function setRule(id) {
  const rule = RULES.find(r => r.id === id);
  if (!rule) return;
  state.rule = rule;
  // Two selects show the lens — the picker card's (usable before a video is
  // loaded) and the side panel's. Keep them pointed at the same rule.
  if (els.lensPick && els.lensPick.value !== id) els.lensPick.value = id;
  if (els.ruleSel.value !== id && [...els.ruleSel.options].some(o => o.value === id)) {
    els.ruleSel.value = id;
  }
  // Mounting the panel needs a loaded round; before that the lens is only a
  // filter for the video/round dropdowns.
  //
  // A lens marked `standalone` renders from its own data rather than from the
  // loaded round (e.g. bladedness_frames, a cross-video grid), so it mounts
  // with no round at all and the viewer section is revealed for it.
  // Clear UNCONDITIONALLY. A standalone lens can have filled these with no
  // round loaded, so clearing only when we're about to mount would strip
  // nothing and leave the previous lens's DOM — and its stage takeover CSS —
  // behind when switching to a lens that can't mount.
  els.ruleHost.innerHTML = "";
  if (els.stageExtras) els.stageExtras.innerHTML = "";
  if (state.pose || rule.standalone) {
    if (rule.standalone && els.viewer.hidden) els.viewer.hidden = false;
    rule.mount(els.ruleHost, state);
  } else if (!state.pose) {
    // Nothing to show without a round; put the section back the way it was.
    els.viewer.hidden = true;
  }
  // Lens may change which videos/rounds are valid — refresh the dropdowns
  // so they reflect the new lens's requirements. We do NOT auto-swap the
  // currently-loaded video; the lens's own mount() shows an empty/hint
  // state if the loaded clip can't be rendered.
  populateDriveVideoSelect();
  const v = els.videoFile.files[0];
  if (v) {
    const base = videoBasename(v.name);
    populateRoundSelect(cacheIndex?.get(base), base);
  }
  redraw();
}

// Picker-card lens select: lets the user choose the lens FIRST and see only
// the videos it can render, instead of having to load a video before the
// side-panel lens dropdown exists.
function setLensStatus(matched, total) {
  if (!els.lensStatus) return;
  if (matched == null) { els.lensStatus.textContent = ""; return; }
  const label = state.rule?.label || "this lens";
  els.lensStatus.textContent = matched === 0
    ? `No videos in the Drive folder have a cache for ${label}.`
    : `${matched} of ${total} videos have a cache for ${label}.`;
}

if (els.lensPick) {
  fillLensOptions(els.lensPick);
  els.lensPick.addEventListener("change", () => setRule(els.lensPick.value));
  setRule(els.lensPick.value);
}

// Expose the viewer's redraw to lenses that need to repaint the main canvas
// in response to their own controls (e.g. the Overview lens's "Show skeleton
// overlay" toggle). The lens calls window.__viewerRedraw() — small hack vs.
// inventing a richer rule API.
window.__viewerRedraw = () => redraw();
// Lens timelines export a drag-selected frame range through the same path as
// the Export dialog (js/lenses/shared/timeline_selection.js).
window.__viewerExportRange = (startFrame, endFrame) => exportRange(startFrame, endFrame);

// ── Frame navigation ────────────────────────────────────────────────────────
els.prevFrame.addEventListener("click", () => seekToFrame(state.frame - 1));
els.nextFrame.addEventListener("click", () => seekToFrame(state.frame + 1));
els.playPause.addEventListener("click", togglePlay);
els.muteToggle.addEventListener("click", toggleMute);
els.scrubber.addEventListener("input", e => seekToFrame(parseInt(e.target.value)));
els.speedSel.addEventListener("change", () => {
  els.video.playbackRate = parseFloat(els.speedSel.value);
});
// Setting els.video.src (new video OR new round) resets playbackRate to 1.0,
// but the speed dropdown UI still shows whatever the user last picked. Re-apply
// the selected rate every time metadata loads so the displayed speed matches
// reality.
els.video.addEventListener("loadedmetadata", () => {
  els.video.playbackRate = parseFloat(els.speedSel.value);
  resetZoom();
});

document.addEventListener("keydown", e => {
  if (els.viewer.hidden) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  switch (e.key) {
    case "ArrowLeft":  seekToFrame(state.frame - 1); e.preventDefault(); break;
    case "ArrowRight": seekToFrame(state.frame + 1); e.preventDefault(); break;
    case "[":          seekToFrame(state.frame - 10); break;
    case "]":          seekToFrame(state.frame + 10); break;
    case " ":          togglePlay(); e.preventDefault(); break;
    case "m": case "M": toggleMute(); break;
  }
});

function seekToFrame(f) {
  if (!state.pose) return;
  f = Math.max(0, Math.min(state.n_frames - 1, Math.round(f)));
  state.frame = f;
  els.scrubber.value = f;
  // Cache frame N lives on source frame (start_frame + N). The +0.5
  // epsilon lands in the middle of that source frame's time slot so the
  // browser doesn't pick the previous frame on a boundary.
  els.video.currentTime = (state.start_frame + f + 0.5) / state.fps;
  // canvas redraw happens on the seeked event so video+overlay stay in sync.
}

els.video.addEventListener("seeked", redraw);

// During playback `timeupdate` only fires ~4–66 Hz and isn't aligned with
// rendered frames, so the skeleton drifts visibly. requestVideoFrameCallback
// fires once per displayed frame with the exact mediaTime — frame-accurate.
// Falls back to requestAnimationFrame polling on browsers without rVFC.
const hasRvfc = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
let playbackHandle = null;

function syncFromVideoTime(t_video) {
  const f = Math.floor(t_video * state.fps) - state.start_frame;
  if (f !== state.frame) {
    state.frame = Math.max(0, Math.min(f, state.n_frames - 1));
    els.scrubber.value = state.frame;
    redraw();
  }
}

function rvfcTick(_now, metadata) {
  syncFromVideoTime(metadata.mediaTime);
  if (recording) recTick();
  if (!els.video.paused) {
    playbackHandle = els.video.requestVideoFrameCallback(rvfcTick);
  }
}

function rafTick() {
  if (els.video.paused) { playbackHandle = null; return; }
  syncFromVideoTime(els.video.currentTime);
  if (recording) recTick();
  playbackHandle = requestAnimationFrame(rafTick);
}

els.video.addEventListener("play", () => {
  if (hasRvfc) {
    playbackHandle = els.video.requestVideoFrameCallback(rvfcTick);
  } else {
    playbackHandle = requestAnimationFrame(rafTick);
  }
});
els.video.addEventListener("pause", () => {
  if (playbackHandle == null) return;
  if (hasRvfc && els.video.cancelVideoFrameCallback) {
    els.video.cancelVideoFrameCallback(playbackHandle);
  } else {
    cancelAnimationFrame(playbackHandle);
  }
  playbackHandle = null;
});

function togglePlay() {
  if (els.video.paused) { els.video.play(); els.playPause.textContent = "⏸"; }
  else                  { els.video.pause(); els.playPause.textContent = "▶"; }
}

els.video.addEventListener("play",  () => els.playPause.textContent = "⏸");
els.video.addEventListener("pause", () => els.playPause.textContent = "▶");

function toggleMute() {
  els.video.muted = !els.video.muted;
  els.muteToggle.textContent = els.video.muted ? "🔇" : "🔊";
}
els.video.addEventListener("volumechange", () => {
  els.muteToggle.textContent = els.video.muted ? "🔇" : "🔊";
});

// ── Export: record video + current-lens overlay to a .webm ──────────────────
// redraw() already paints the overlay canvas (skeleton + active lens) frame-
// accurately. To export, we composite the <video> frame and that overlay onto
// an offscreen canvas on every displayed frame during a real-time playback
// pass (see the rvfc/raf tick hooks) and pipe it through MediaRecorder. The
// overlay's internal resolution equals the video's, so the two layers align
// 1:1 at native resolution.
let recording = false;
let exporting = false;
let recCanvas = null, recCtx = null, recorder = null, recChunks = null;
let recStopFrame = 0, recPrevRate = 1;

function compositeRecFrame() {
  if (!recCtx) return;
  recCtx.drawImage(els.video,  0, 0, recCanvas.width, recCanvas.height);
  recCtx.drawImage(els.canvas, 0, 0, recCanvas.width, recCanvas.height);
}

// Called from the playback ticks while recording: grab the frame, then stop
// once playback has reached the requested end frame.
function recTick() {
  compositeRecFrame();
  if (state.frame >= recStopFrame) finishRecording();
}

function pickRecMime() {
  // Prefer mp4 — Safari (and recent Chrome) record H.264 mp4 directly. Fall
  // back to webm on browsers that can't. The download extension follows the
  // mime actually chosen (see recorder.onstop).
  const types = [
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || "";
}

function finishRecording() {
  if (!recording) return;
  recording = false;
  els.video.pause();
  els.video.playbackRate = recPrevRate;
  if (recorder && recorder.state !== "inactive") recorder.stop();
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function exportFileName(ext) {
  return `${state.rule?.id || "raw"}_overlay.${ext}`;
}

// ── Export entry point ──────────────────────────────────────────────────────
// Prefer offline WebCodecs encoding (renders frame-by-frame as fast as the
// machine allows — no real-time playback). Fall back to the real-time
// MediaRecorder path on browsers without VideoEncoder / H.264 encode support.
async function exportRange(startFrame, endFrame) {
  if (recording || exporting) return;
  if (!state.pose || !els.video.src) { alert("Load a video + pose cache first."); return; }
  const last = state.n_frames - 1;
  startFrame = Math.max(0, Math.min(last, Math.round(startFrame)));
  endFrame   = Math.max(startFrame, Math.min(last, Math.round(endFrame)));

  const w = els.video.videoWidth, h = els.video.videoHeight;
  const codec = await pickAvcCodec(w, h);
  if (!("VideoEncoder" in window) || !codec) {
    recordRangeRealtime(startFrame, endFrame);   // fallback: real-time capture
    return;
  }
  try {
    await encodeRangeOffline(startFrame, endFrame, w, h, codec);
  } catch (err) {
    console.error("Offline export failed, falling back to real-time:", err);
    exporting = false;
    recordRangeRealtime(startFrame, endFrame);
  }
}

async function pickAvcCodec(w, h) {
  if (!("VideoEncoder" in window) || !VideoEncoder.isConfigSupported) return null;
  // High→Baseline, descending level, so big portrait frames still find a fit.
  const cands = ["avc1.640034", "avc1.640033", "avc1.640032", "avc1.640028",
                 "avc1.4D0034", "avc1.42E028", "avc1.42E01F", "avc1.42001F"];
  for (const codec of cands) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: 8e6, framerate: 30 });
      if (s && s.supported) return codec;
    } catch (_) { /* try next */ }
  }
  return null;
}

// Seek to cache frame f and resolve once the video frame + overlay are ready.
function seekToFramePromise(f) {
  f = Math.max(0, Math.min(state.n_frames - 1, Math.round(f)));
  const t = (state.start_frame + f + 0.5) / state.fps;
  state.frame = f;
  els.scrubber.value = f;
  return new Promise(res => {
    if (Math.abs(els.video.currentTime - t) < 1e-6) { redraw(); res(); return; }
    els.video.addEventListener("seeked", function once() {
      els.video.removeEventListener("seeked", once);
      res();   // the global seeked→redraw listener has already painted the overlay
    }, { once: true });
    els.video.currentTime = t;
  });
}

async function encodeRangeOffline(startFrame, endFrame, w, h, codec) {
  exporting = true;
  els.exportBtn.disabled = true;
  els.exportBtn.textContent = "Encoding…";

  const fps = state.fps;
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const octx = out.getContext("2d", { alpha: false });

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: w, height: h },
    fastStart: "in-memory",
  });
  let encErr = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encErr = e; },
  });
  encoder.configure({
    codec, width: w, height: h, framerate: fps,
    bitrate: Math.min(20e6, Math.round(w * h * fps * 0.12)),
  });

  const prevFrame = state.frame;
  els.video.pause();

  const total = endFrame - startFrame + 1;
  const usPerFrame = 1e6 / fps;
  const keyEvery = Math.max(1, Math.round(fps * 2));   // keyframe ~every 2s
  for (let i = 0; i < total; i++) {
    if (encErr) throw encErr;
    await seekToFramePromise(startFrame + i);
    octx.drawImage(els.video,  0, 0, w, h);
    octx.drawImage(els.canvas, 0, 0, w, h);
    const frame = new VideoFrame(out, {
      timestamp: Math.round(i * usPerFrame),
      duration: Math.round(usPerFrame),
    });
    encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
    frame.close();
    if (i % 4 === 0 || i === total - 1) {
      els.exportBtn.textContent = `Encoding ${Math.round((i + 1) / total * 100)}%`;
      // Yield so the UI repaints and the encoder queue drains.
      if (encoder.encodeQueueSize > 20) await new Promise(r => setTimeout(r));
      else await new Promise(r => requestAnimationFrame(r));
    }
  }
  await encoder.flush();
  if (encErr) throw encErr;
  muxer.finalize();
  encoder.close();

  downloadBlob(new Blob([muxer.target.buffer], { type: "video/mp4" }), exportFileName("mp4"));

  exporting = false;
  els.exportBtn.disabled = false;
  els.exportBtn.textContent = "⬇︎ Export";
  seekToFrame(prevFrame);
}

// Fallback: record cache frames [startFrame, endFrame] at 1x via MediaRecorder.
function recordRangeRealtime(startFrame, endFrame) {
  if (recording) return;
  const last = state.n_frames - 1;
  startFrame = Math.max(0, Math.min(last, Math.round(startFrame)));
  endFrame   = Math.max(startFrame, Math.min(last, Math.round(endFrame)));
  recStopFrame = endFrame;

  recCanvas = document.createElement("canvas");
  recCanvas.width  = els.video.videoWidth;
  recCanvas.height = els.video.videoHeight;
  recCtx = recCanvas.getContext("2d");

  recChunks = [];
  recorder = new MediaRecorder(recCanvas.captureStream(state.fps), { mimeType: pickRecMime() });
  recorder.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };

  recorder.onstop = () => {
    const ext = recorder.mimeType.includes("mp4") ? "mp4" : "webm";
    downloadBlob(new Blob(recChunks, { type: recorder.mimeType }), exportFileName(ext));
    els.exportBtn.disabled = false;
    els.exportBtn.textContent = "⬇︎ Export";
  };

  recPrevRate = els.video.playbackRate;
  els.video.playbackRate = 1;
  els.exportBtn.disabled = true;
  els.exportBtn.textContent = "● Recording…";

  // Natural end is a safety net when endFrame is the last frame.
  els.video.addEventListener("ended", finishRecording, { once: true });

  seekToFrame(startFrame);
  els.video.addEventListener("seeked", () => {
    recording = true;
    compositeRecFrame();   // seed the stream with the first frame
    recorder.start();
    els.video.play();
  }, { once: true });
}

// ── Export dialog ───────────────────────────────────────────────────────────
// Time fields accept "m:ss(.sss)" OR plain seconds, in the same clock the frame
// label shows (start_sec + frame/fps). "Use current" copies the scrubbed point.
function parseTimeInput(str) {
  const s = String(str).trim();
  if (!s) return NaN;
  if (s.includes(":")) {
    const parts = s.split(":");
    if (parts.length > 3) return NaN;
    let v = 0;
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isFinite(n) || n < 0) return NaN;
      v = v * 60 + n;
    }
    return v;
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function currentVideoTime() {
  return state.start_sec + state.frame / state.fps;
}

let exportDialog = null;
function buildExportDialog() {
  const dlg = document.createElement("dialog");
  dlg.id = "export-dialog";
  dlg.innerHTML = `
    <form class="export-form" method="dialog">
      <h3>Export overlay clip</h3>
      <label class="opt">
        <input type="radio" name="exp-range" value="whole" checked>
        <span>Whole video <span class="muted" id="exp-whole-range"></span></span>
      </label>
      <label class="opt">
        <input type="radio" name="exp-range" value="custom">
        <span>Custom range</span>
      </label>
      <div class="export-range" hidden>
        <div class="rng-row">
          <label for="exp-start">Start</label>
          <input id="exp-start" type="text" placeholder="0:00" autocomplete="off">
          <button type="button" id="exp-start-now">Use current</button>
        </div>
        <div class="rng-row">
          <label for="exp-end">End</label>
          <input id="exp-end" type="text" placeholder="1:30" autocomplete="off">
          <button type="button" id="exp-end-now">Use current</button>
        </div>
        <p class="hint">Enter <code>m:ss</code> (e.g. <code>1:30</code>) or seconds (e.g. <code>90</code>).
          Tip: scrub the video, then click <b>Use current</b>.</p>
      </div>
      <div class="export-err" id="exp-error"></div>
      <div class="export-actions">
        <button type="button" id="exp-cancel">Cancel</button>
        <button type="button" id="exp-go" class="primary">Export</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);

  const rangeBox = dlg.querySelector(".export-range");
  const startIn  = dlg.querySelector("#exp-start");
  const endIn    = dlg.querySelector("#exp-end");
  const errEl    = dlg.querySelector("#exp-error");
  const radios   = dlg.querySelectorAll('input[name="exp-range"]');
  const isCustom = () => dlg.querySelector('input[name="exp-range"]:checked').value === "custom";

  radios.forEach(r => r.addEventListener("change", () => {
    rangeBox.hidden = !isCustom();
    errEl.textContent = "";
  }));
  dlg.querySelector("#exp-start-now").addEventListener("click", () => {
    startIn.value = fmtClock(currentVideoTime());
  });
  dlg.querySelector("#exp-end-now").addEventListener("click", () => {
    endIn.value = fmtClock(currentVideoTime());
  });
  dlg.querySelector("#exp-cancel").addEventListener("click", () => dlg.close());

  dlg.querySelector("#exp-go").addEventListener("click", () => {
    const last = state.n_frames - 1;
    let startFrame = 0, endFrame = last;
    if (isCustom()) {
      const ts = parseTimeInput(startIn.value);
      const te = parseTimeInput(endIn.value);
      if (Number.isNaN(ts) || Number.isNaN(te)) {
        errEl.textContent = "Enter both times as m:ss or seconds."; return;
      }
      if (te <= ts) { errEl.textContent = "End must be after start."; return; }
      startFrame = Math.round((ts - state.start_sec) * state.fps);
      endFrame   = Math.round((te - state.start_sec) * state.fps);
      if (endFrame < 0 || startFrame > last) {
        errEl.textContent = "That range is outside this clip."; return;
      }
    }
    dlg.close();
    exportRange(startFrame, endFrame);
  });

  return dlg;
}

function openExportDialog() {
  if (recording || exporting) return;
  if (!state.pose || !els.video.src) { alert("Load a video + pose cache first."); return; }
  if (!exportDialog) exportDialog = buildExportDialog();
  const last = state.n_frames - 1;
  exportDialog.querySelector("#exp-whole-range").textContent =
    `(${fmtClock(state.start_sec)} – ${fmtClock(state.start_sec + last / state.fps)})`;
  exportDialog.querySelector("#exp-error").textContent = "";
  exportDialog.querySelector('input[name="exp-range"][value="whole"]').checked = true;
  exportDialog.querySelector(".export-range").hidden = true;
  exportDialog.showModal();
}

els.exportBtn.addEventListener("click", openExportDialog);

// ── Scrubber hover thumbnail ────────────────────────────────────────────────
// Hovering the scrubber should preview the frame at that timeline position
// without disturbing main playback. We seek a hidden duplicate of the video
// (els.thumbVideo) and draw its current frame + the skeleton at that frame
// into a small canvas tooltip near the cursor.
//
// mousemove fires far faster than the video can seek, so we keep only the
// latest target frame. When a seek finishes, if the target moved we kick off
// another seek.
let thumbTarget = null;        // frame the user is currently hovering
let thumbDrawn = -1;           // frame currently visible in the canvas
let thumbSeekInFlight = false;

els.scrubber.addEventListener("mousemove", e => {
  if (!state.pose) return;
  const rect = els.scrubber.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const f = Math.floor(ratio * (state.n_frames - 1));
  thumbTarget = f;
  positionThumb(e.clientX, rect.top);
  els.thumbTip.hidden = false;
  // If the requested frame is already drawn, skip the seek.
  if (f === thumbDrawn) return;
  if (!thumbSeekInFlight) seekThumb();
});

els.scrubber.addEventListener("mouseleave", () => {
  els.thumbTip.hidden = true;
  thumbTarget = null;
});

function seekThumb() {
  if (thumbTarget == null || !els.thumbVideo.src) return;
  const target = thumbTarget;
  thumbSeekInFlight = true;
  els.thumbVideo.currentTime = (state.start_frame + target + 0.5) / state.fps;
  els.thumbVideo.onseeked = () => {
    drawThumb(target);
    thumbDrawn = target;
    thumbSeekInFlight = false;
    // If the user moved while we were seeking, chase the new target.
    if (thumbTarget != null && thumbTarget !== target) seekThumb();
  };
}

function drawThumb(frame) {
  const ctx = els.thumbCanvas.getContext("2d");
  const W = els.thumbCanvas.width, H = els.thumbCanvas.height;
  const vw = els.thumbVideo.videoWidth || state.pose.width;
  const vh = els.thumbVideo.videoHeight || state.pose.height;

  // Letterbox the frame inside the canvas.
  const scale = Math.min(W / vw, H / vh);
  const dw = vw * scale, dh = vh * scale;
  const dx = (W - dw) / 2, dy = (H - dh) / 2;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(els.thumbVideo, dx, dy, dw, dh);

  // Skeleton at the hovered frame, scaled to match the letterboxed video.
  ctx.save();
  ctx.translate(dx, dy);
  ctx.scale(scale, scale);
  drawSkeleton(ctx, state.pose, frame, state.rule?.skeletonStyle?.(state) || {});
  ctx.restore();

  els.thumbLabel.textContent =
    `f${frame}  ·  t=${fmtClock(state.start_sec + frame / state.fps)}`;
}

// Sheet/labeler clock format: MM:SS.sss (zero-padded), matching the
// `start_sec`/`end_sec` strings in the Box Labeled Data sheet (e.g. `04:27.306`).
function fmtClock(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, "0")}:${r.toFixed(3).padStart(6, "0")}`;
}

function positionThumb(cursorX, scrubberTop) {
  const tip = els.thumbTip;
  const tw = tip.offsetWidth || 250;
  const th = tip.offsetHeight || 160;
  const left = Math.min(window.innerWidth - tw - 8, Math.max(8, cursorX - tw / 2));
  const top = Math.max(8, scrubberTop - th - 10);
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}

function redraw() {
  const ctx = els.canvas.getContext("2d");
  // Always clear so the previous frame doesn't ghost when there's no pose.
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  if (!state.pose) return;

  // Canvas internal resolution is the source video's, but the rendered CSS
  // box is often much smaller (portrait 1080×1920 capped at 75vh ≈ 149×264).
  // 2px-wide bones at 1080 internal → 0.3px on screen, i.e. invisible. Push
  // a render-scale into state so the active rule can multiply its drawing
  // dimensions accordingly. Default skeleton dims also get scaled below.
  // offsetWidth, NOT getBoundingClientRect(): the latter reports the box
  // AFTER the ctrl+scroll zoom transform, so renderScale silently shrank by
  // the zoom factor on any redraw that happened while zoomed in — and stayed
  // stale on the redraws that didn't. Marks then changed size depending on
  // whether a frame had been repainted since you last scrolled. Layout width
  // ignores transforms, so renderScale now means one thing at every zoom.
  const cssW = els.canvas.offsetWidth
    || els.canvas.getBoundingClientRect().width || els.canvas.width;
  state.renderScale = els.canvas.width / Math.max(1, cssW);

  // The zoom is a CSS transform over the finished bitmap, so it magnifies
  // whatever a lens drew: a 3px mark becomes a 24px blob at 8x, and zooming
  // in on two marks that overlap never separates them. Publish the transform
  // so a lens can divide its mark sizes by it — constant on screen, so the
  // growing gap between marks is the only thing zoom changes — and keep its
  // HUD inside the region still on screen.
  state.view = viewTransform();

  // Let the active rule influence the base skeleton style, then draw it.
  // Apply renderScale to width-style fields so lines/dots stay legible at
  // any rendered size. Lenses can override either by passing absolute or by
  // reading state.renderScale themselves.
  const baseStyle = state.rule?.skeletonStyle?.(state) || {};
  const scaled = {
    ...baseStyle,
    boneWidth:   (baseStyle.boneWidth   ?? 2) * state.renderScale,
    jointRadius: (baseStyle.jointRadius ?? 4) * state.renderScale,
  };
  drawSkeleton(ctx, state.pose, state.frame, scaled);

  // Then the rule paints its own decorations on top.
  state.rule?.draw?.(ctx, state);

  // And refreshes its side panel.
  state.rule?.update?.(state);

  // Show frame within the cache, video time (= start_sec + frame/fps),
  // and a "before round" marker when we're inside the pre-buffer.
  const t_video = state.start_sec + state.frame / state.fps;
  const before = state.pre_buffer_frames && state.frame < state.pre_buffer_frames
    ? "  ·  ⏪ pre-buffer (before round)" : "";
  els.frameLabel.textContent =
    `frame ${state.frame} / ${state.n_frames - 1}   ·   ` +
    `t=${fmtClock(t_video)}${before}`;
}
