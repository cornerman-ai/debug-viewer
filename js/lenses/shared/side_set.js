// The curated side set — the videos shot COMPLETELY FROM THE SIDE, where the
// camera looks along the boxer's frontal plane. The frame shows the sagittal
// plane and the opponent axis runs left-right across it, perpendicular to the
// camera: the mirror of ./frontal_set.js.
//
// Backend source of truth: cornerman-backend `ml/side_segments.json`, read
// there by `ml/side_spans.py`. Refresh this copy with:
//   cp ~/code/cornerman-backend/ml/side_segments.json \
//      ~/code/cornerman-debug-viewer/lens_data/side_segments.json
//
// Any lens that measures something FORE-AFT — how far the hand travels down the
// punch line, the path it returns through, the head riding forward over the
// lead knee, where the weight sits — needs this view, because on frontal
// footage those all point at the lens and collapse. Such lenses set
// `requiresVideo: isCuratedVideo`. Two stems are in both sets at disjoint times
// (the camera moves partway through) — match on (stem, span), never stem alone.

import { makeSegmentSet, normStem } from "./segment_set.js";

const set = makeSegmentSet("./lens_data/side_segments.json");

export const sideSetReady = set.ready;
export const getManifest = set.getManifest;
export const getManifestError = set.getManifestError;
export const matchEntry = set.matchEntry;
export const isCuratedVideo = set.isCuratedVideo;
export { normStem };
