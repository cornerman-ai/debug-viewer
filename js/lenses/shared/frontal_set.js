// The curated frontal set — the videos where the boxer works TOWARD the camera,
// so the camera stands where the opponent would be.
//
// Backend source of truth: cornerman-backend `ml/frontal_segments.json`, read
// there by `ml/frontal_spans.py` (its docstring is the spec for the span
// semantics). Refresh this copy with:
//   cp ~/code/cornerman-backend/ml/frontal_segments.json \
//      ~/code/cornerman-debug-viewer/lens_data/frontal_segments.json
//
// Any lens that measures something LATERAL — a slip, a head coming off the
// center line, shoulder squareness — is only meaningful when the opponent axis
// is the camera axis. Those lenses set `requiresVideo: isCuratedVideo` so the
// video dropdown hides footage where the measurement would be referenced to the
// wrong axis. Fetched once per page load and shared by every such lens.

const DATA_URL = "./lens_data/frontal_segments.json";

let manifest = null;
let manifestError = null;
let loadPromise = null;

async function load() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    manifestError = err.message || String(err);
  }
  // The video dropdown filters on requiresVideo(), which cannot answer until
  // this lands — tell the viewer to re-filter now that it can.
  window.dispatchEvent(new Event("lens-filter-changed"));
}

// Kick the fetch off at module load (registry.js imports every lens on page
// load) so the dropdowns filter correctly on the first paint.
export const frontalSetReady = (loadPromise ??= load());

export function getManifest() { return manifest; }
export function getManifestError() { return manifestError; }

// Stems in the wild pick up `_prepared` / `_h264` re-encode tails, and these
// YouTube titles contain double spaces that are easy to lose in a copy-paste.
export function normStem(s) {
  return String(s || "")
    .replace(/_(prepared|h264)$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// { stem, spans } for a video basename, or null if it is not in the set.
export function matchEntry(basename) {
  if (!manifest || !basename) return null;
  const segs = manifest.segments || {};
  if (segs[basename]) return { stem: basename, spans: segs[basename] };
  const want = normStem(basename);
  for (const [stem, spans] of Object.entries(segs)) {
    if (normStem(stem) === want) return { stem, spans };
  }
  return null;
}

// Video filter. Pending ⇒ hide (the fetch re-fires the filter once the data
// lands). Failed ⇒ show everything, because an unexplained empty dropdown is a
// dead end when the error message lives in a panel you cannot reach.
export function isCuratedVideo(base) {
  if (manifestError) return true;
  if (!manifest) return false;
  return !!matchEntry(base);
}
