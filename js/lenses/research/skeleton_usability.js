// Skeleton usability — what the skeleton-usability detector declared unusable in this round.
//
// The detector so far is the floor of "unusable": frames INSIDE the round (round_start …
// round_end; the extractor's 1.5 s pre-roll is not judged) where BlazePose returned no pose
// at all — every landmark NaN in the cache — grouped into stretches, plus the tail of a round
// the cache never reached (the decoder stopped early). Nothing learned yet: the labelers'
// unusable_start / unusable_end markers are the target of the model this line is heading for
// (cornerman-backend ml/research/skeleton_usability/README.md).
//
// Data: lens_data/skeleton_usability/ (index.json + one JSON per round), written by
//   cd ~/code/cornerman-backend && .venv/bin/python ml/research/skeleton_usability/no_skeleton.py \
//     --lens-out ~/code/cornerman-debug-viewer/lens_data/skeleton_usability
//
// Schema:
//   index.json   { generated, source, detector, shelf, n_rounds,
//                  totals: { n_in_round, n_no_skeleton, n_stretches, n_rounds_touched },
//                  videos: { <stem>: { <ri>: { file, n_no_skeleton, n_stretches, no_skeleton_sec, uncovered_tail_sec } } } }
//   <hash>.json  { round_id, stem, ri, start_sec, end_sec, fps, n_frames, n_in_round, n_no_skeleton,
//                  no_skeleton_sec, uncovered_tail_sec,
//                  stretches: [{ s, e, n, f0, f1 }] }     s / e = source-video time of the stretch's FIRST and
//                                                          LAST missing frame, n = frames, f0 / f1 = those
//                                                          frames' indices in the cache (pre-roll included)
// A stretch is placed by its cache frame indices when the loaded cache is that file (same frame
// count) and through the viewer's clock (secToFrame, the impact spotter lens's convention) otherwise.
//
// The video and round dropdowns offer only rounds where something was declared (a stretch, or a
// cache that stops > 0.5 s before round_end); everything if the index failed to load.

const DATA_DIR = "./lens_data/skeleton_usability/";
const LENS_ID = "skeleton_usability";
const EARLY_END_SEC = 0.5;    // an uncovered tail above this = the cache stops before the round does (no_skeleton.EARLY_END_SEC)
const EXPORT_CMD = "cd ~/code/cornerman-backend && .venv/bin/python ml/research/skeleton_usability/no_skeleton.py " +
  "--lens-out ~/code/cornerman-debug-viewer/lens_data/skeleton_usability";
const C = {
  miss: "#ff5d6c",       // declared: no skeleton
  tail: "#f5a23c",       // declared: the cache never reached this part of the round
  ok: "#7adf7a",
  playhead: "#3ad9e0",
  round: "#2a3340",
  preroll: "#14171c",
  bg: "#181818",
  text: "#aaa",
  muted: "#666",
};

let host = null, latestState = null;
let index = null, indexError = null, indexLoading = null;
let doc = null, docKey = null, docError = null;

// ── clock (the impact spotter lens's convention) ─────────────────────────────
function stripStem(s) { return String(s || "").replace(/_h264$/, ""); }
function poseOf(state) { return state.poseV6 || state.pose || null; }
function startSec(state) { const p = poseOf(state); return (p && (p.start_sec || 0)) || 0; }
function nFrames(state) { const p = poseOf(state); return p ? p.n_frames : 0; }
function secToFrame(state, t) {
  const fps = state.fps || 30;
  return Math.floor(t * fps + 1e-6) - Math.floor(startSec(state) * fps + 1e-6);
}
function frameToSec(state, f) {
  const fps = state.fps || 30;
  return (Math.floor(startSec(state) * fps) + f + 0.5) / fps;
}
// [first, last] viewer frame of a stretch: the export's own cache frames when the loaded cache is
// the exported file, else its source seconds through the clock
function stretchFrames(state, st) {
  if (doc && st.f0 != null && nFrames(state) === doc.n_frames) return [st.f0, st.f1];
  return [secToFrame(state, st.s), secToFrame(state, st.e)];
}
function seekFrame(f) {
  const slider = document.getElementById("scrubber");
  if (!slider) return;
  slider.value = Math.max(0, Math.round(f));
  slider.dispatchEvent(new Event("input", { bubbles: true }));
}
function fmtTime(sec) { const m = Math.floor(sec / 60); return `${m}:${(sec - m * 60).toFixed(1).padStart(4, "0")}`; }
function fmtSec(s) { return `${s < 10 ? s.toFixed(2) : s.toFixed(1)} s`; }
function fmtN(n) { return Number(n).toLocaleString("en-US"); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
function stillActive() { const sel = document.getElementById("rule-select"); return !sel || !sel.value || sel.value === LENS_ID; }

// ── data ─────────────────────────────────────────────────────────────────────
// Every fetch carries a version so a stale CDN / browser cache can never pair an old index with
// new round files; round files are named by a hash of the round id, so a stale pair is the SAME round.
function ensureIndex() {
  if (index || indexError) return Promise.resolve();
  if (!indexLoading) {
    indexLoading = (async () => {
      try {
        const res = await fetch(`${DATA_DIR}index.json?v=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        index = await res.json();
      } catch (e) { indexError = String(e); }
      window.dispatchEvent(new Event("lens-filter-changed"));   // the dropdowns asked before the index was in
    })();
  }
  return indexLoading;
}
function declared(e) { return !!e && (e.n_stretches > 0 || e.uncovered_tail_sec > EARLY_END_SEC); }
// index.videos entry for a cache basename: the exact stem, then the stem with _h264 stripped on
// either side, then a substring either way — never a bare prefix
function videoEntry(base) {
  if (!index || !base) return null;
  if (index.videos[base]) return { stem: base, rounds: index.videos[base] };
  const want = stripStem(base);
  const keys = Object.keys(index.videos);
  const hit = keys.find(k => stripStem(k) === want) || keys.find(k => want.includes(k) || k.includes(want));
  return hit ? { stem: hit, rounds: index.videos[hit] } : null;
}
function entryFor(state) {
  if (!state || state.cacheRound == null) return null;
  const v = videoEntry(state.cacheBasename);
  const e = v && v.rounds[String(state.cacheRound)];
  return e ? { ...e, stem: v.stem, ri: state.cacheRound } : null;
}
function refreshScope(state) {
  const entry = entryFor(state);
  const key = entry ? entry.file : `none:${state?.cacheBasename}|${state?.cacheRound}`;
  if (key === docKey) return;
  docKey = key; doc = null; docError = null;
  if (!entry) { renderAll(); return; }
  loadDoc(entry.file, key, entry);
}
async function loadDoc(file, key, expect) {
  try {
    const v = encodeURIComponent(index?.generated || Date.now());
    const res = await fetch(`${DATA_DIR}${file}?v=${v}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (docKey !== key) return;
    if (stripStem(d.stem) !== stripStem(expect.stem) || Number(d.ri) !== Number(expect.ri)) {
      throw new Error(`file ${file} holds ${d.stem} r${d.ri}, not ${expect.stem} r${expect.ri} — ` +
        `stale cached data; hard-reload the page (Cmd/Ctrl+Shift+R)`);
    }
    doc = d;
  } catch (e) { if (docKey === key) docError = String(e); }
  if (docKey !== key) return;
  renderAll();
}

// the declared stretch under the playhead, if any
function currentStretch(state) {
  if (!doc) return null;
  const f = state.frame;
  for (let i = 0; i < doc.stretches.length; i++) {
    const [a, b] = stretchFrames(state, doc.stretches[i]);
    if (f >= a && f <= b) return { i, st: doc.stretches[i], a, b };
  }
  return null;
}
function tailFrames(state) {
  return doc && doc.uncovered_tail_sec > EARLY_END_SEC ? Math.round(doc.uncovered_tail_sec * (state.fps || 30)) : 0;
}

// ── side panel ───────────────────────────────────────────────────────────────
function template() {
  return `
    <h2>Skeleton usability</h2>
    <p class="hint">What the skeleton-usability detector declared unusable in this round. So far the
      floor only: frames inside the round where BlazePose returned <b>no pose at all</b> (every
      landmark NaN in the cache), as stretches — plus the tail of a round the cache never reached.
      The pre-roll before round_start is not judged. The dropdowns list only rounds with something
      declared.</p>
    <div id="su-scope" class="muted small" style="margin-bottom:6px"></div>
    <div id="su-stats" style="font-size:13px;line-height:1.6;margin-bottom:8px"></div>
    <div id="su-frame" style="font-size:13px;margin-bottom:8px;min-height:18px"></div>
    <div id="su-list-head" class="muted small" style="margin-bottom:4px"></div>
    <div id="su-list" style="max-height:280px;overflow-y:auto;font-size:12px"></div>
    <div id="su-shelf" class="muted small" style="margin-top:10px"></div>`;
}

function renderAll() {
  if (!host) return;
  renderScope();
  renderStats();
  renderList();
  renderShelf();
  if (latestState) { renderFrameLine(latestState); drawTimeline(latestState); }
}

function renderScope() {
  const el = host.querySelector("#su-scope");
  if (!el) return;
  const st = latestState;
  if (indexError) {
    el.innerHTML = `<span style="color:${C.miss}">${DATA_DIR}index.json failed to load (${esc(indexError)}).</span> ` +
      `Export it with:<br><code style="font-size:11px">${esc(EXPORT_CMD)}</code>`;
    return;
  }
  if (!index) { el.textContent = "loading the detector's index…"; return; }
  if (!st || !st.cacheBasename || st.cacheRound == null) { el.textContent = "load a video + round"; return; }
  el.innerHTML = doc
    ? `scoped: <code>${esc(doc.stem)}</code> · r${doc.ri} · ${fmtTime(doc.start_sec)} – ${fmtTime(doc.end_sec)} · ${doc.fps} fps`
    : docError ? `<span style="color:${C.miss}">${esc(docError)}</span>`
    : entryFor(st) ? "loading this round…"
    : `no export for <code>${esc(st.cacheBasename)}</code> r${st.cacheRound} — not on the surveyed shelf; re-export with<br>` +
      `<code style="font-size:11px">${esc(EXPORT_CMD)}</code>`;
}

function renderStats() {
  const el = host.querySelector("#su-stats");
  if (!el) return;
  if (!doc) { el.innerHTML = ""; return; }
  const dur = doc.end_sec - doc.start_sec;
  const tail = doc.uncovered_tail_sec > EARLY_END_SEC ? doc.uncovered_tail_sec : 0;
  const declaredSec = doc.no_skeleton_sec + tail;
  const longest = doc.stretches.reduce((m, s) => Math.max(m, s.n), 0) / doc.fps;
  const pctMiss = doc.n_in_round ? (100 * doc.n_no_skeleton / doc.n_in_round) : 0;
  const verdictColor = declaredSec === 0 ? C.ok : C.miss;
  el.innerHTML =
    `<div>in round: <b>${fmtN(doc.n_in_round)}</b> frames (${fmtSec(dur)})</div>` +
    `<div>no skeleton: <b style="color:${doc.n_no_skeleton ? C.miss : C.ok}">${fmtN(doc.n_no_skeleton)}</b> frames = ` +
      `${pctMiss.toFixed(1)} % (${fmtSec(doc.no_skeleton_sec)}) in <b>${doc.stretches.length}</b> stretch${doc.stretches.length === 1 ? "" : "es"}` +
      (doc.stretches.length ? ` · longest ${fmtSec(longest)}` : "") + `</div>` +
    (tail ? `<div style="color:${C.tail}">cache stops <b>${fmtSec(tail)}</b> before round_end — those frames were never decoded</div>` : "") +
    `<div style="margin-top:4px;padding:4px 8px;border-left:3px solid ${verdictColor}">declared unusable: ` +
      `<b style="color:${verdictColor}">${fmtSec(declaredSec)}</b> of ${fmtSec(dur)} (${(dur ? 100 * declaredSec / dur : 0).toFixed(1)} %)</div>`;
}

function renderFrameLine(state) {
  const el = host.querySelector("#su-frame");
  if (!el) return;
  if (!doc) { el.innerHTML = ""; return; }
  const f = state.frame, t = frameToSec(state, f);
  const cur = currentStretch(state);
  if (cur) {
    el.innerHTML = `<span style="color:${C.miss};font-weight:700">frame ${f} · ${fmtTime(t)} — NO SKELETON</span> ` +
      `<span class="muted">stretch ${cur.i + 1} / ${doc.stretches.length} · f${cur.a}–f${cur.b} · ${cur.st.n} f (${fmtSec(cur.st.n / doc.fps)})</span>`;
  } else if (t < doc.start_sec) {
    el.innerHTML = `<span class="muted">frame ${f} · ${fmtTime(t)} — pre-roll, not judged</span>`;
  } else {
    el.innerHTML = `<span style="color:${C.ok}">frame ${f} · ${fmtTime(t)} — skeleton present</span>`;
  }
}

function renderList() {
  const head = host.querySelector("#su-list-head"), el = host.querySelector("#su-list");
  if (!head || !el) return;
  if (!doc) { head.textContent = ""; el.innerHTML = ""; return; }
  head.textContent = doc.stretches.length
    ? `${doc.stretches.length} stretch${doc.stretches.length === 1 ? "" : "es"}, in time — click to jump (start · length · frames)`
    : "no stretch declared in this round";
  el.innerHTML = doc.stretches.map((st, i) =>
    `<div data-i="${i}" style="display:flex;gap:8px;padding:2px 6px;cursor:pointer;border-left:3px solid ${C.miss}">
      <span style="width:52px;color:${C.text}">${fmtTime(st.s)}</span>
      <span style="width:56px">${fmtSec(st.n / doc.fps)}</span>
      <span class="muted">${st.n} f · f${st.f0}–f${st.f1}</span>
    </div>`).join("");
  el.querySelectorAll("[data-i]").forEach(row => row.addEventListener("click", () => {
    if (!latestState || !doc) return;
    seekFrame(stretchFrames(latestState, doc.stretches[Number(row.dataset.i)])[0]);
  }));
}

function renderShelf() {
  const el = host.querySelector("#su-shelf");
  if (!el || !index) return;
  const T = index.totals || {};
  const pct = T.n_in_round ? (100 * T.n_no_skeleton / T.n_in_round).toFixed(2) : "—";
  el.innerHTML = `shelf: ${fmtN(index.n_rounds)} rounds · ${pct} % of in-round frames without a skeleton · ` +
    `${fmtN(T.n_rounds_touched)} rounds touched · ${fmtN(T.n_stretches)} stretches · exported ${esc(String(index.generated || "").slice(0, 10))}`;
}

// ── stage timeline: the round in viewer frames, declared stretches in red, the never-decoded tail in orange ──
function mountStageTimeline() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:6px";
  const cv = document.createElement("canvas");
  cv.id = "su-timeline";
  cv.style.cssText = "display:block;width:100%;height:56px;cursor:pointer";
  wrap.appendChild(cv);
  slot.appendChild(wrap);
  cv.addEventListener("click", (e) => {
    if (!latestState || !doc) return;
    const rect = cv.getBoundingClientRect();
    const total = nFrames(latestState) + tailFrames(latestState);
    const f = Math.round(((e.clientX - rect.left) / Math.max(1, rect.width)) * total);
    seekFrame(Math.min(nFrames(latestState) - 1, Math.max(0, f)));
  });
}

function sizeCanvas(cv) {
  const rect = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(50, Math.round(rect.width * dpr)), h = Math.max(30, Math.round(rect.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return { ctx: cv.getContext("2d"), W: w, H: h, dpr };
}

function drawTimeline(state) {
  const cv = document.getElementById("su-timeline");
  if (!cv) return;
  const { ctx, W, H, dpr } = sizeCanvas(cv);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.font = `${10 * dpr}px monospace`;
  if (!doc) {
    ctx.fillStyle = C.muted;
    ctx.fillText(docError ? "skeleton usability: export error (see panel)" : "skeleton usability: no export for this round", 12 * dpr, 20 * dpr);
    return;
  }
  const n = nFrames(state), tail = tailFrames(state), total = Math.max(1, n + tail);
  const x = (f) => (f / total) * W;
  const y0 = 14 * dpr, h = H - y0 - 4 * dpr;
  const roundF = Math.min(n, Math.max(0, secToFrame(state, doc.start_sec)));
  ctx.fillStyle = C.preroll; ctx.fillRect(0, y0, x(roundF), h);              // the pre-roll, not judged
  ctx.fillStyle = C.round; ctx.fillRect(x(roundF), y0, x(n) - x(roundF), h);  // the round the cache holds
  ctx.fillStyle = C.miss;
  for (const st of doc.stretches) {
    const [a, b] = stretchFrames(state, st);
    ctx.fillRect(x(a), y0, Math.max(1.5 * dpr, x(b + 1) - x(a)), h);
  }
  if (tail) {                                                                  // hatched: never decoded
    ctx.save();
    ctx.fillStyle = "rgba(245,162,60,0.25)"; ctx.fillRect(x(n), y0, W - x(n), h);
    ctx.strokeStyle = C.tail; ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    for (let px = x(n) - h; px < W; px += 8 * dpr) { ctx.moveTo(px, y0 + h); ctx.lineTo(px + h, y0); }
    ctx.clip(); ctx.stroke(); ctx.restore();
    ctx.fillStyle = C.tail;
    ctx.fillText(`cache ends · round continues ${fmtSec(doc.uncovered_tail_sec)}`, x(n) + 4 * dpr, 10 * dpr);
  }
  ctx.fillStyle = C.text;
  ctx.fillText(`${doc.stretches.length} stretches · ${fmtSec(doc.no_skeleton_sec)} without a skeleton`, 4 * dpr, 10 * dpr);
  const cur = currentStretch(state);
  ctx.strokeStyle = cur ? C.miss : C.playhead; ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.moveTo(x(state.frame), 0); ctx.lineTo(x(state.frame), H); ctx.stroke();
}

// ── on-video ─────────────────────────────────────────────────────────────────
function draw(ctx, state) {
  const cur = currentStretch(state);
  if (!cur) return;
  const s = state.renderScale || 1;
  ctx.save();
  ctx.lineWidth = 6 * s; ctx.strokeStyle = C.miss;
  ctx.strokeRect(3 * s, 3 * s, ctx.canvas.width - 6 * s, ctx.canvas.height - 6 * s);
  ctx.font = `${13 * s}px monospace`;
  const txt = `NO SKELETON · stretch ${cur.i + 1}/${doc.stretches.length} · ${cur.st.n} f (${fmtSec(cur.st.n / doc.fps)})`;
  const w = ctx.measureText(txt).width + 16 * s;
  ctx.fillStyle = "rgba(0,0,0,0.65)"; ctx.fillRect(8 * s, 8 * s, w, 24 * s);
  ctx.fillStyle = C.miss; ctx.fillText(txt, 16 * s, 25 * s);
  ctx.restore();
}

export const SkeletonUsabilityRule = {
  id: LENS_ID,
  label: "Skeleton usability",

  // only rounds with something declared are offered; before the index is in: nothing (the load
  // re-filters the dropdowns); if it failed to load: everything
  requiresVideo(base) {
    if (indexError) return true;
    if (!index) { ensureIndex(); return false; }
    const v = videoEntry(base);
    return !!v && Object.values(v.rounds).some(declared);
  },
  requires(slot, { base, round } = {}) {
    if (indexError) return true;
    if (!index) { ensureIndex(); return false; }
    const v = videoEntry(base);
    return !!(v && declared(v.rounds[String(round)]));
  },

  mount(_host, state) {
    host = _host;
    latestState = state;
    host.innerHTML = template();
    mountStageTimeline();
    renderAll();
    ensureIndex().then(() => {
      if (!stillActive()) return;
      docKey = null;
      refreshScope(latestState);
      renderAll();
    });
  },

  update(state) {
    latestState = state;
    if (!index) return;
    refreshScope(state);
    renderFrameLine(state);
    drawTimeline(state);
  },

  draw,
};
