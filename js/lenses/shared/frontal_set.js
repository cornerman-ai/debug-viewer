// The curated frontal set — the videos where the boxer works TOWARD the camera,
// so the camera stands where the opponent would be.
//
// Backend source of truth: cornerman-backend `ml/frontal_segments.json`, read
// there by `ml/frontal_spans.py` (its docstring is the spec for the span
// semantics). Refresh this copy with:
//   cp ~/code/cornerman-backend/ml/frontal_segments.json \
//      ~/code/cornerman-debug-viewer/lens_data/frontal_segments.json
//
// Any lens that measures something across the boxer's width — a slip, a head
// coming off the center line, shoulder squareness — is only meaningful when the
// opponent axis is the camera axis. Those lenses set
// `requiresVideo: isCuratedVideo` so the video dropdown hides footage where the
// measurement would be referenced to the wrong axis. Fetched once per page load
// and shared by every such lens. The camera's other useful angle — side-on, for
// fore-aft quantities — is ./side_set.js; the machinery both share, including
// the source-second → cache-frame conversion, is ./segment_set.js.

import { makeSegmentSet, normStem } from "./segment_set.js";

const set = makeSegmentSet("./lens_data/frontal_segments.json");

export const frontalSetReady = set.ready;
export const getManifest = set.getManifest;
export const getManifestError = set.getManifestError;
export const matchEntry = set.matchEntry;
export const isCuratedVideo = set.isCuratedVideo;
export { normStem };

// ── which ROUNDS of a curated video carry frontal footage ───────────────────
//
// A curated video can have eight rounds and one span, and which round a
// time-only span falls in needs each round's `_pts.npy` clock — the backend
// has those, the browser does not. `lens_data/frontal_rounds.json` is the
// backend's answer, dumped by
//   python -m ml.frontal_spans --rounds-json > \
//     ~/code/cornerman-debug-viewer/lens_data/frontal_rounds.json
// (regenerate with the manifest). Lenses whose scope is the span rather than
// the video set `requires: isCuratedRound` next to `requiresVideo`; the viewer
// hands `requires` `{ base, round }` alongside the slot.

let roundsByStem = null;   // Map<normStem(stem), Set<round>>
let roundsError = null;
fetch("./lens_data/frontal_rounds.json", { cache: "no-store" })
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(j => {
    roundsByStem = new Map();
    for (const [stem, rs] of Object.entries(j.rounds || {})) {
      roundsByStem.set(normStem(stem), new Set(rs));
    }
  })
  .catch(err => { roundsError = err.message || String(err); })
  // The dropdowns filter on requires(), which cannot answer until this lands.
  .finally(() => window.dispatchEvent(new Event("lens-filter-changed")));

// Same engine test as the viewer's default `requires` — any 2D skeleton cache.
// Exported for lenses that build their own round filter on top of it.
export const hasSkeleton = slot => !!(slot?.blazepose || slot?.yolo || slot?.vision
  || slot?.vision_glove || slot?.rtmpose || slot?.movenet || slot?.yolo11);

// Pending ⇒ hide (the fetch re-fires the filter). Failed, or a stem the dump
// does not know ⇒ do not filter rounds rather than hide footage silently.
export function isCuratedRound(slot, ctx) {
  if (!hasSkeleton(slot)) return false;
  if (roundsError) return true;
  if (!roundsByStem) return false;
  const rs = roundsByStem.get(normStem(ctx?.base || ""));
  if (!rs) return true;
  return ctx?.round == null || rs.has(ctx.round);
}
