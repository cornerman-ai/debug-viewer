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
