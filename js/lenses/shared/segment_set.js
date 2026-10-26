// A curated segment set — the machinery behind ./frontal_set.js and
// ./side_set.js. Both manifests have the identical shape (backend
// `ml/frontal_segments.json` / `ml/side_segments.json`, read there by
// `ml/frontal_spans.py`, whose docstring is the spec for the span semantics),
// so the fetch, the stem matching, the video filter and the source-second →
// cache-frame conversion live here once and get instantiated twice.
//
// A set is a claim about the CAMERA, and every lens that depends on which axis
// the camera is looking down sets `requiresVideo: <set>.isCuratedVideo` so the
// video dropdown hides footage where its measurement would be referenced to the
// wrong axis.
//
// TIME BASE (the thing that silently breaks): manifest times are SOURCE-VIDEO
// seconds, but a cache holds one round starting at `pose.start_sec`. We convert
// with the viewer's own start-frame convention —
//     cacheFrame = floor(t * fps) - floor(start_sec * fps)
// — matching how the viewer seeks. The backend uses the cache's `_pts.npy`
// clock, which is authoritative when pts is non-uniform; if a span ever looks a
// frame or two off here, that is why.

// Stems in the wild pick up `_prepared` / `_h264` re-encode tails, and these
// YouTube titles contain double spaces that are easy to lose in a copy-paste.
export function normStem(s) {
  return String(s || "")
    .replace(/_(prepared|h264)$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// { ready, getManifest, getManifestError, matchEntry, isCuratedVideo }.
export function makeSegmentSet(dataUrl) {
  let manifest = null;
  let manifestError = null;

  async function load() {
    try {
      const res = await fetch(dataUrl, { cache: "no-store" });
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
  const ready = load();

  // { stem, spans } for a video basename, or null if it is not in the set.
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

  // Video filter. Pending ⇒ hide (the fetch re-fires the filter once the data
  // lands). Failed ⇒ show everything, because an unexplained empty dropdown is
  // a dead end when the error message lives in a panel you cannot reach.
  function isCuratedVideo(base) {
    if (manifestError) return true;
    if (!manifest) return false;
    return !!matchEntry(base);
  }

  return {
    ready,
    getManifest: () => manifest,
    getManifestError: () => manifestError,
    matchEntry,
    isCuratedVideo,
  };
}

// Spans of one entry → this round's cache frames.
// { inSpan: Uint8Array(n), ranges: [{label, s, e, startSec, endSec, span}], nIn }
export function resolveRanges(spans, { n, fps, startSec, roundIdx }) {
  const startFrame = Math.floor(startSec * fps);
  const inSpan = new Uint8Array(n);
  const ranges = [];

  // A span with `round` set belongs to THAT cache round only. Spans starting at
  // "the round's start" (start_sec null) would otherwise apply to every round of
  // the video — R0's span would also paint r1 and r2.
  const mine = spans.filter(
    sp => sp.round == null || roundIdx == null || sp.round === roundIdx);

  // A span left open at the end runs until the next one on the same video
  // starts, rather than to the end of the video.
  const ordered = [...mine].sort((a, b) => (a.start_sec ?? 0) - (b.start_sec ?? 0));
  for (let i = 0; i < ordered.length; i++) {
    const sp = ordered[i];
    const inherited = sp.end_sec == null && ordered[i + 1]?.start_sec != null;
    // An explicit end_sec is inclusive; an end inherited from the next span's
    // start is exclusive — R0 stops one frame BEFORE R1 begins.
    const endSec = sp.end_sec != null ? sp.end_sec : (ordered[i + 1]?.start_sec ?? null);

    // null start = the round's first frame; null end = the round's last.
    const s = sp.start_sec == null ? 0 : Math.floor(sp.start_sec * fps) - startFrame;
    const e = endSec == null
      ? n - 1
      : Math.floor(endSec * fps) - startFrame - (inherited ? 1 : 0);
    // A span that lands entirely outside this round belongs to a different
    // round of the same video — skip it rather than clamping it to a sliver.
    if (e < 0 || s > n - 1) continue;
    const cs = Math.max(0, Math.min(n - 1, s));
    const ce = Math.max(0, Math.min(n - 1, e));
    for (let f = cs; f <= ce; f++) inSpan[f] = 1;
    ranges.push({ label: sp.label, s: cs, e: ce, startSec: sp.start_sec, endSec, span: sp });
  }
  ranges.sort((a, b) => a.s - b.s);

  let nIn = 0;
  for (let f = 0; f < n; f++) if (inSpan[f]) nIn++;
  return { inSpan, ranges, nIn };
}
