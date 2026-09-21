// Live ground-truth label fetcher.
//
// The labeler writes punches to a public Google Sheet ("Combined Data"
// tab). The gviz CSV endpoint is reachable without auth, so we can pull
// labels live in the browser — no `dump_labels.py` rerun, no sidecar JSON.
//
// Flow (option A — auto-match):
//   1. The viewer loads a pose cache. The cache filename gives us a
//      basename (e.g. `30 MIN SHADOWBOXING…_h264` from
//      `30 MIN SHADOWBOXING…_h264_vision_r0.npz`).
//   2. We fetch the Sheet CSV once per session (cached in memory), then
//      look for a unique `video_name` whose stem matches the cache
//      basename (case-insensitive, substring either direction).
//   3. If exactly one source matches we filter to its rows; if none, we
//      report it and the lens falls back to ST-GCN punches / heuristic.
//   4. Times are mapped to cache-relative frames using
//      `state.pose.start_sec` (read from the cache's `_meta.json`) and
//      `state.pose.fps`.
//
// Adding a new label in the labeler → click Refresh from Sheet in the
// step+punch-sync lens; the in-session cache is bypassed and the live
// rows are re-pulled.

// 2026-09: the gviz CSV path above is DEAD. The labeling tabs moved to a new
// spreadsheet (Combined Data now lives in 1HkKO…) and neither file is
// link-viewable, so every gviz fetch redirects to a Google login and fails on
// CORS — state.labels never arrives. The read path that still works from the
// browser is the labeler's own Apps Script web app (the deployment
// cornerman-labeler/shared/player.js posts labels to): it runs as the script
// owner and needs no sharing. fetchCombinedRowsForStem() at the bottom reads
// one video's Combined Data rows through it, and fetchLiveLabels() (the
// viewer's state.labels) goes through it since 2026-09-21 — one ~6-9 s Apps
// Script call per video instead of one CSV per session. The form verdicts
// (Combined Form Labels, rule_* on each detection) came with the dead CSV
// read and have no web-app path, so detections carry none.
const PUBLIC_SHEET_ID = "1CewEaweCBw9F-qSvNapiQMNj4wnidHqLA-I19whrly0";
const ORIENTATION_SHEET = "Orientation Labels";
const PUNCH_DIR_SHEET = "Punch Directions";
const NON_PUNCH = new Set([
  "round_start", "round_end", "rest_start", "rest_end",
]);

const CACHE_TTL_MS = 5 * 60 * 1000;

export function clearCache() {
  cachedTrackingVideos = null;
  cachedLabelerRowsByLink.clear();
}

// ── Public API ──────────────────────────────────────────────────────────────

export function parseTimestamp(s) {
  if (s == null) return null;
  let t = String(s).trim().replace(/^["']|["']$/g, "").replace(",", ".");
  if (!t) return null;
  if (t.includes(":")) {
    const parts = t.split(":").map(Number);
    if (parts.some(n => Number.isNaN(n))) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function handForLabel(label) {
  const l = String(label || "").trim().toLowerCase();
  if (l.startsWith("jab"))   return "lead";
  if (l.startsWith("cross")) return "rear";
  if (l.startsWith("lead_")) return "lead";
  if (l.startsWith("rear_")) return "rear";
  return null;
}

export function parseCsv(text) {
  const rows = [];
  let cur = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else { field += c; }
    } else {
      if (c === '"')      inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  if (rows.length === 0) return [];
  const headers = rows.shift().map(h => h.trim());
  return rows
    .filter(r => r.some(v => v.length))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

// Normalize a filename / basename for fuzzy matching: drop extension,
// lowercase, collapse non-alphanum to single spaces, trim.
function normalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")     // drop one extension
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Find the source video that best matches a cache basename, over a
// `video_name → row count` map. Returns
// { name, confidence: 'exact' | 'substr' | 'tokens', n_rows } or null.
// Strategy:
//   1. Exact (normalized) match — strongest.
//   2. One direction substring (cache normalized contains video normalized,
//      or vice versa).
//   3. Tokens: every alphanum token of the shorter side appears as a token
//      in the longer side. Catches `name_r0` vs `name`, `name_h264` vs
//      `name`, etc.
// If multiple candidates tie, pick the one with the most label rows (i.e.
// the most specific source video).
export function pickSourceByCounts(counts, cacheBasename) {
  if (!cacheBasename) return null;
  // Strip the cache-shape suffix `_<engine>_r<N>` so the basename we match
  // against is just the source name, e.g.
  //   `30 MIN SHADOWBOXING…_h264_vision_r0` → `30 MIN SHADOWBOXING…_h264`
  const cb = cacheBasename.replace(/_(yolo|vision)_r\d+$/i, "");
  const cbN = normalize(cb);
  if (!cbN) return null;
  const names = [...counts.keys()];

  const cbTokens = new Set(cbN.split(" ").filter(Boolean));
  let exact = null;
  const substrHits = [];
  const tokenHits = [];

  for (const n of names) {
    const nN = normalize(n);
    if (!nN) continue;
    if (nN === cbN) { exact = n; break; }
    if (cbN.includes(nN) || nN.includes(cbN)) {
      substrHits.push({ name: n, score: Math.min(nN.length, cbN.length) });
      continue;
    }
    const nTokens = nN.split(" ").filter(Boolean);
    const shorter = nTokens.length < cbTokens.size ? nTokens : [...cbTokens];
    const longer  = nTokens.length < cbTokens.size ? new Set(cbTokens) : new Set(nTokens);
    if (shorter.length && shorter.every(t => longer.has(t))) {
      tokenHits.push({ name: n, score: shorter.length });
    }
  }

  const pickByCount = arr => {
    arr.sort((a, b) => (counts.get(b.name) || 0) - (counts.get(a.name) || 0));
    return arr[0]?.name || null;
  };

  if (exact)             return { name: exact,                 confidence: "exact",  n_rows: counts.get(exact) };
  if (substrHits.length) {
    const w = pickByCount(substrHits);
    return { name: w, confidence: "substr", n_rows: counts.get(w) };
  }
  if (tokenHits.length) {
    const w = pickByCount(tokenHits);
    return { name: w, confidence: "tokens", n_rows: counts.get(w) };
  }
  return null;
}

// Reshape filtered Sheet rows into the detection schema rule lenses expect.
export function rowsToDetections(rows, { cacheStartSec = 0, fps, nFrames }) {
  const detections = [];
  for (const r of rows) {
    const label = String(r.label || "").trim().toLowerCase();
    if (!label || NON_PUNCH.has(label)) continue;
    const sStart = parseTimestamp(r.start_sec);
    const sEnd   = parseTimestamp(r.end_sec);
    if (sStart == null || sEnd == null || sEnd <= sStart) continue;
    const localStart = sStart - cacheStartSec;
    const localEnd   = sEnd   - cacheStartSec;
    if (localEnd <= 0 || localStart >= nFrames / fps) continue;

    const sf = Math.max(0, Math.round(localStart * fps));
    const ef = Math.min(nFrames - 1, Math.round(localEnd * fps));
    if (ef - sf < 1) continue;
    const punch_uuid = (r.punch_uuid || "").trim() || null;
    const det = {
      idx: detections.length,
      timestamp: (localStart + localEnd) / 2,
      start_time: localStart,
      end_time: localEnd,
      start_frame: sf,
      end_frame: ef,
      hand: handForLabel(label),
      punch_type: label,
      category: null,
      n_frames: ef - sf + 1,
      stance: String(r.stance || "").trim().toLowerCase() || null,
      punch_uuid,
      labeler: r.labeler || null,
      reviewed: r.reviewed || null,
    };
    detections.push(det);
  }
  detections.sort((a, b) => a.start_frame - b.start_frame);
  return detections;
}

// Orientation Labels tab — separate from Combined Data. Stored verbatim by
// the labeler keyed by (video_stem, round, frame); we filter client-side.
// Light enough (<50 KB typically) that one fetch per session is fine.
let cachedOrientationRows = null;
let cachedOrientationFetchedAt = 0;

async function fetchOrientationRows({ force = false } = {}) {
  if (!force && cachedOrientationRows
      && Date.now() - cachedOrientationFetchedAt < CACHE_TTL_MS) {
    return cachedOrientationRows;
  }
  const url =
    `https://docs.google.com/spreadsheets/d/${PUBLIC_SHEET_ID}` +
    `/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(ORIENTATION_SHEET)}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${ORIENTATION_SHEET}`);
  cachedOrientationRows = parseCsv(await r.text());
  cachedOrientationFetchedAt = Date.now();
  return cachedOrientationRows;
}

// Returns a Map keyed `${round}:${frame}` → { label, labeler, ts }, restricted
// to a single video stem (the cache basename, which the labeler also uses as
// its `video` identifier). Drops deleted rows and skip-rows (empty label).
export async function fetchOrientationForStem(videoStem, { force = false } = {}) {
  let rows;
  try { rows = await fetchOrientationRows({ force }); }
  catch (err) { return { error: err.message, byKey: new Map() }; }
  const byKey = new Map();
  let countForVideo = 0;
  for (const r of rows) {
    if (String(r.deleted ?? "") === "1") continue;
    if ((r.video ?? "") !== videoStem) continue;
    countForVideo++;
    const lbl = String(r.label ?? "").trim();
    if (lbl === "") continue;   // skip rows the labeler marked as "skip"
    const round = Number(r.round);
    const frame = Number(r.frame);
    const label = Number(lbl);
    if (!Number.isFinite(round) || !Number.isFinite(frame) || !Number.isFinite(label)) continue;
    byKey.set(`${round}:${frame}`, { label, labeler: r.labeler || "", ts: r.ts || "" });
  }
  return { byKey, countForVideo, totalRows: rows.length };
}

// Punch Directions tab — per-punch facing labels, keyed by punch_uuid.
// Written by the orientation labeler's PUNCH mode. Same gviz fetch pattern
// as orientation labels.
let cachedPunchDirRows = null;
let cachedPunchDirFetchedAt = 0;

async function fetchPunchDirRows({ force = false } = {}) {
  if (!force && cachedPunchDirRows
      && Date.now() - cachedPunchDirFetchedAt < CACHE_TTL_MS) {
    return cachedPunchDirRows;
  }
  const url =
    `https://docs.google.com/spreadsheets/d/${PUBLIC_SHEET_ID}` +
    `/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(PUNCH_DIR_SHEET)}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${PUNCH_DIR_SHEET}`);
  cachedPunchDirRows = parseCsv(await r.text());
  cachedPunchDirFetchedAt = Date.now();
  return cachedPunchDirRows;
}

// Returns Map<punch_uuid, {label, labeler, ts}> across all videos. Lens code
// joins to its own detections by uuid. Drops deleted + skip rows.
export async function fetchPunchDirectionsAll({ force = false } = {}) {
  let rows;
  try { rows = await fetchPunchDirRows({ force }); }
  catch (err) { return { error: err.message, byUuid: new Map() }; }
  const byUuid = new Map();
  for (const r of rows) {
    if (String(r.deleted ?? "") === "1") continue;
    const lbl = String(r.label ?? "").trim();
    if (lbl === "") continue;
    const uuid = String(r.punch_uuid ?? "").trim();
    if (!uuid) continue;
    const label = Number(lbl);
    if (!Number.isFinite(label)) continue;
    byUuid.set(uuid, { label, labeler: r.labeler || "", ts: r.ts || "" });
  }
  return { byUuid, totalRows: rows.length };
}

// Top-level convenience: given a cache basename + cache offset + fps + frame
// count, pull that video's Combined Data rows through the labeler web app
// (fetchCombinedRowsForStem: exact stem, else the fuzzy match with its
// short-name guard) and return a detections array — punches AND defense rows,
// round markers excluded. The lens code is one call away from live labels.
export async function fetchLiveLabels({
  cacheBasename, cacheStartSec = 0, fps, nFrames, force = false,
}) {
  const got = await fetchCombinedRowsForStem(cacheBasename, { force });
  const fetchedAt = Date.now();
  if (got.error) return { error: got.error, cacheBasename, fetched_at: fetchedAt };
  const detections = rowsToDetections(got.rows, { cacheStartSec, fps, nFrames });
  return {
    source: "labels_sheet_live",
    schema_version: 1,
    source_video: got.source_video,
    match_confidence: got.match_confidence,
    n_rows_for_video: got.n_rows,
    cache_start_sec: cacheStartSec,
    fps,
    fetched_at: fetchedAt,
    total_punches: detections.length,
    detections,
  };
}

// ── Labeler web app — the read path that still works ────────────────────────
//
// `listCombinedVideos` → every video_name in Combined Data with its row count;
// `listPunchesForVideo&video=<name|stem>` → that video's rows (label, start /
// end as "MM:SS.mmm" text, stance, punch_uuid). Despite the name it returns
// EVERY label except the round/rest markers — defense rows included — and no
// labeler column, so two labelers' rows on the same footage come back as two
// rows. Combined Data is rebuilt from the per-labeler tabs by hand (the
// sheet's MyCorner ▸ Rebuild menu), so "live" means "as of the last rebuild".
// Cached per session; `force` re-pulls.

const LABELER_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec";

let cachedVideoCounts = null;          // Map<video_name, n_labels>
const cachedRowsByName = new Map();    // video_name → rows (seconds parsed)

// One retry after a pause: the web app answers through a one-shot
// script.googleusercontent.com redirect that now and then 404s (and a clasp
// deploy from the labeler repo makes the script briefly unavailable), so a
// single failed hop is not a verdict. The action rides in the error so the
// lens can say which call failed.
async function webAppGet(params, { retries = 1 } = {}) {
  const url = new URL(LABELER_WEBAPP_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status} from the labeler web app (${params.action})`);
      const j = await r.json();
      if (j.status !== "ok") throw new Error(j.message || `labeler web app error (${params.action})`);
      return j;
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise(res => setTimeout(res, 1500));
    }
  }
}

export async function fetchCombinedVideoCounts({ force = false } = {}) {
  if (!force && cachedVideoCounts) return cachedVideoCounts;
  const j = await webAppGet({ action: "listCombinedVideos" });
  const m = new Map();
  for (const v of j.videos || []) m.set(v.name, v.n_labels || 0);
  cachedVideoCounts = m;
  return m;
}

// One video's Combined Data rows for a cache basename, matched the way
// fetchLiveLabels matches (pickSourceByCounts). Resolves to
//   { source_video, match_confidence, n_rows,
//     rows: [{ label, start_sec, end_sec, stance, punch_uuid, id }] }
// with times in source-video SECONDS, or { error }.
export async function fetchCombinedRowsForStem(cacheBasename, { force = false } = {}) {
  if (!cacheBasename) return { error: "no cache basename to match" };
  const stem = cacheBasename.replace(/_(yolo|vision)_r\d+$/i, "");

  const pull = async name => {
    const hit = force ? null : cachedRowsByName.get(name);
    if (hit) return hit;
    const j = await webAppGet({ action: "listPunchesForVideo", video: name });
    const rows = (j.punches || []).map(p => ({
      label: String(p.label || "").trim().toLowerCase(),
      start_sec: parseTimestamp(p.start_sec),
      end_sec: parseTimestamp(p.end_sec),
      stance: String(p.stance || "").trim().toLowerCase() || null,
      punch_uuid: p.punch_uuid || null,
      id: p.id ?? null,
      video_name: p.video_name || name,
    })).filter(r => r.label && r.start_sec != null && r.end_sec != null);
    cachedRowsByName.set(name, rows);
    return rows;
  };

  try {
    // The web app matches the stem itself (exact, extension-stripped,
    // case-insensitive), so the common case is one round trip. Each Apps
    // Script call is seconds, so the video list is only pulled when needed.
    let rows = await pull(stem);
    if (rows.length) {
      return { source_video: rows[0].video_name, match_confidence: "exact",
               n_rows: rows.length, rows };
    }
    // Nothing under that exact name (an `_h264` tail, a double space) —
    // fuzzy-match against the video list the way fetchLiveLabels does.
    const counts = await fetchCombinedVideoCounts({ force });
    const match = pickSourceByCounts(counts, cacheBasename);
    // A fuzzy hit on a short name is a guess, not a match: an on-device
    // round is called `round_1`, and both of its tokens sit in "Do a full
    // round practicing a combo. Today: 1 - 2 - 3 …" — 29 rows of someone
    // else's labels. Fuzzy needs a name with something to go on.
    const nTokens = normalize(stem).split(" ").filter(Boolean).length;
    if (!match || (match.confidence !== "exact" && nTokens < 3)) {
      return { error: "no source-video match in Combined Data for this cache", cacheBasename };
    }
    rows = await pull(match.name);
    return { source_video: match.name, match_confidence: match.confidence,
             n_rows: rows.length, rows };
  } catch (err) {
    return { error: err.message };
  }
}

// ── Labeler web app: the per-labeler tabs, live ─────────────────────────────
//
// `listForeign&labeler=admin&video=<Drive link>` is the punch labeler's
// admin-mode read: every person's `Labeled Data <name>` tab (not Combined Data,
// not the Review / Archive tabs), one video's rows tagged with the tab they came
// from. Unreviewed rows included, times in seconds, no uuid. A video is
// addressed by its Drive link; `listTrackingVideos` (the labeling tracker's
// `progress` tab: video name without extension → link) turns a cache basename
// into one. The catalog is one ~3 s call per session; the walk is ~15 s per
// video (the script's own cache only keeps payloads under ~90 KB, and a labeled
// video's rows are more). Cached per video for the session; `force` re-pulls.

let cachedTrackingVideos = null;             // Map<video name, Drive link>
const cachedLabelerRowsByLink = new Map();   // Drive link → { labelers, rows }

export async function fetchTrackingVideos({ force = false } = {}) {
  if (!force && cachedTrackingVideos) return cachedTrackingVideos;
  const j = await webAppGet({ action: "listTrackingVideos" });
  const m = new Map();
  for (const v of j.videos || []) if (v.name && v.link) m.set(v.name, v.link);
  cachedTrackingVideos = m;
  return m;
}

// Every labeler's rows for the video behind a cache basename:
//   { source_video, link, match_confidence, labelers: [name, …] (tab order),
//     rows: [{ label, start_sec, end_sec, labeler, id }] }
// with times in source-video SECONDS, or { error }.
export async function fetchLabelerRowsForStem(cacheBasename, { force = false } = {}) {
  if (!cacheBasename) return { error: "no cache basename to match" };
  const stem = cacheBasename.replace(/_(yolo|vision)_r\d+$/i, "");
  try {
    const catalog = await fetchTrackingVideos({ force });
    // Exact first (tracker names carry no extension), then the fuzzy match and
    // short-name guard of fetchCombinedRowsForStem.
    const stemN = normalize(stem);
    let name = [...catalog.keys()].find(n => normalize(n) === stemN) || null;
    let confidence = "exact";
    if (!name) {
      const counts = new Map([...catalog.keys()].map(n => [n, 1]));
      const match = pickSourceByCounts(counts, cacheBasename);
      const nTokens = stemN.split(" ").filter(Boolean).length;
      if (!match || (match.confidence !== "exact" && nTokens < 3)) {
        return { error: "video not in the labeling tracker (listTrackingVideos)", cacheBasename };
      }
      name = match.name; confidence = match.confidence;
    }
    const link = catalog.get(name);
    let hit = force ? null : cachedLabelerRowsByLink.get(link);
    if (!hit) {
      const j = await webAppGet({ action: "listForeign", labeler: "admin", video: link });
      const rows = [], labelers = [];
      for (const r of j.foreign_punch_labels || []) {
        const labeler = String(r.sheet || "").replace(/^Labeled Data /, "");
        const label = String(r.punch || "").trim().toLowerCase();
        const start_sec = Number(r.startTime), end_sec = Number(r.endTime);
        if (!labeler || !label || !Number.isFinite(start_sec) || !Number.isFinite(end_sec)) continue;
        if (!labelers.includes(labeler)) labelers.push(labeler);
        rows.push({ label, start_sec, end_sec, labeler, id: r.id ?? null });
      }
      hit = { labelers, rows };
      cachedLabelerRowsByLink.set(link, hit);
    }
    return { source_video: name, link, match_confidence: confidence, labelers: hit.labelers, rows: hit.rows };
  } catch (err) {
    return { error: err.message };
  }
}
