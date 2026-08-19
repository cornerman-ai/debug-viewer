// Face mesh (chin) — MediaPipe face mesh vs the v4 chin-point labelers.
//
// BlazePose has no chin landmark. Step 1 of the chin-tuck rule is deciding
// whether MediaPipe's face mesh can BE the chin oracle: this lens draws the
// mesh jaw arc and two chin candidates on the footage, pulls the v4
// chin-point labels LIVE from the labeler backend, and on labeled frames
// shows each labeler's click plus its distance to the mesh chin.
//
// Data: ./lens_data/face_mesh/<stem>.json, one per top-labeled video —
//   cd ~/code/cornerman-backend && .venv-mediapipe/bin/python \
//       ml/research/chin_tuck/face_extract_v1.py
// Schema: { video, width, height, fps, engine, stride, chin_landmark,
//   jaw_arc_indices, rounds: { <ri>: { fps, n_frames, start_sec, frames: [
//     { f, t, found, chin:[x,y], low:[x,y], arc:[[x,y],...] } ] } } }
// Coords are normalized 0-1; t is SOURCE-VIDEO seconds (the cache _pts
// clock). Labels come from the chin-point Apps Script (statsChinPoint
// roster -> listChinPoint per labeler) — the same endpoint the labeler
// page saves to, so what you see here is always the live sheet.
//
// Alignment is BY TIME: a label's (round, frame) is resolved to t through
// the face JSON entry minted from the same cache grid, then to a viewer
// frame via start_sec/fps — raw frame indices are never trusted across
// clocks, so an off-by-one shows up as a visible one-frame lag instead of
// a silent mismatch.

import { normStem } from "../shared/segment_set.js";

const DATA_DIR = "./lens_data/face_mesh/";
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwM57VoFCXWIhw8jyechZQLtMzlmeT15bhIy0eozKpA0jHlmuZPSqVzyEcS5Vy0A5cS/exec";
const EXCLUDE_LABELERS = new Set(["Test"]);   // verification rows, not a labeler

const C = {
  arc:      "#8ab4f8",   // blue — jaw arc from FACEMESH_FACE_OVAL
  chin:     "#ffa657",   // orange — mesh chin tip (landmark 152)
  low:      "#d3b136",   // yellow — lowest image-space jaw point
  noface:   "#ff5d6c",   // red — no face detected
  ok:       "#7adf7a",   // green — SCRFD box above the include threshold
  cascade:  "#ff5df1",   // magenta — gate-cascade landmarks (SCRFD → mesh|2d106)
  playhead: "#3ad9e0",
  text:     "#aaa",
};
// Per-labeler click colors, assigned in roster order (stats order).
const LABELER_COLORS = ["#56d364", "#c792ea", "#f97583", "#79c0ff", "#ffab70"];

let host = null;
let latestState = null;
let faceData = {};        // stem -> parsed face JSON
let faceErrors = {};      // stem -> fetch error string
let labelsPromise = null; // live label fetch, once per session
let labels = null;        // { roster: [names], byStem: Map(stem -> rows[]) }
let labelsError = null;
let activeStem = null;    // scoped stem (cacheBasename, _h264 stripped)
let activeFace = null;    // faceData[activeStem]
let activeRound = null;   // activeFace.rounds[cacheRound]
let cascadeData = {};     // stem -> <stem>.cascade.json (gate-experiment sidecar)
let cascadeErrors = {};   // stem -> error (absence is fine — overlay is optional)
let activeCascade = null;
let cascadeByViewer = null; // Map(viewer frame -> cascade entry)
let cascadeRuns = null;     // [{lo, hi, kind: mesh|l106|excluded|none}]
let mapsKey = "";         // memo key for the per-round lookup maps
let entryByViewer = null; // Map(viewer frame -> face frame entry)
let noFaceRuns = null;    // [[viewerLo, viewerHi], ...] over stored frames
let labelRows = null;     // scoped labels: [{labeler, ci, x, y, vis, rep, viewerF, approx}]

// ---------------------------------------------------------------- helpers
function stripStem(s) { return String(s || "").replace(/_h264$/, ""); }

function poseOf(state) { return state.poseV6 || state.pose || null; }

function startSec(state) {
  const p = poseOf(state);
  return (p && (p.start_sec || 0)) || 0;
}

function secToFrame(state, tSrc) {
  // ROUND, not floor: the mesh was computed on (and the labelers' JPEGs were
  // baked from) the source frame NEAREST tSrc, while the viewer's slot F
  // displays source frame start_frame + F. Cache pts often sit a hair shy of
  // the next frame boundary (frac(t*fps) ~ 0.99 on 36 of the 57 extracted
  // rounds) — a floor mapping drew the mesh one frame ahead of the pixels on
  // exactly those rounds.
  const fps = state.fps || 30;
  return Math.round(tSrc * fps) - Math.floor(startSec(state) * fps + 1e-6);
}

function seekFrame(f) {
  const slider = document.getElementById("scrubber");
  if (!slider) return;
  slider.value = Math.max(0, Math.round(f));
  slider.dispatchEvent(new Event("input", { bubbles: true }));
}

function labelerColor(name) {
  const i = labels ? labels.roster.indexOf(name) : -1;
  return LABELER_COLORS[(i >= 0 ? i : 0) % LABELER_COLORS.length];
}

function selected() {
  const sel = document.getElementById("rule-select");
  return !sel || sel.value === "face_mesh_chin";
}

function poke() {
  if (!selected() || !host) return;
  buildSidebar();
  if (latestState) update(latestState);
  document.getElementById("video")?.dispatchEvent(new Event("seeked"));
}

// ---------------------------------------------------------------- data
// Which stems have face-mesh data — index.json is written by
// face_extract_v1.py next to the per-video JSONs. Fetched at module load
// (registry.js imports every lens on page load) so the video dropdown
// filters correctly on the first paint.
let index = null;
let indexError = null;
(async () => {
  try {
    const res = await fetch(DATA_DIR + "index.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    index = await res.json();
  } catch (e) {
    indexError = String(e);
  }
  // The video dropdown filters on requiresVideo(), which cannot answer
  // until this lands — tell the viewer to re-filter now that it can.
  window.dispatchEvent(new Event("lens-filter-changed"));
})();

// The index stem matching a video basename (re-encode tails and whitespace
// normalized away, same rule as the curated segment sets), or null.
function indexStemFor(base) {
  if (!index || !base) return null;
  const want = normStem(base);
  for (const s of index.videos || []) {
    if (normStem(s) === want) return s;
  }
  return null;
}

// Video-dropdown filter (segment_set semantics): pending ⇒ hide (the fetch
// re-fires the filter once the data lands); failed ⇒ show everything,
// because an unexplained empty dropdown is a dead end.
function requiresVideo(base) {
  if (indexError) return true;
  if (!index) return false;
  return indexStemFor(base) != null;
}

async function ensureFaceData(stem) {
  // The JSON is named by the LABEL stem; the loaded cache may carry an
  // _h264 suffix — try the exact basename first, then the stripped one.
  if (!stem || faceData[stem] || faceErrors[stem]) return;
  let lastErr = "not found";
  const cands = [...new Set([stem, stripStem(stem), indexStemFor(stem)]
    .filter(Boolean))];
  for (const cand of cands) {
    try {
      const res = await fetch(DATA_DIR + encodeURIComponent(cand) + ".json",
                              { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      faceData[stem] = await res.json();
      poke();
      return;
    } catch (e) {
      lastErr = String(e);
    }
  }
  faceErrors[stem] = lastErr;
  poke();
}

async function ensureCascade(stem) {
  // Gate-cascade sidecar (cascade_sidecar.py): SCRFD score + marks for the
  // labeled frames. Optional — a missing file just means no overlay.
  if (!stem || cascadeData[stem] || cascadeErrors[stem]) return;
  let lastErr = "not found";
  for (const cand of [...new Set([stem, stripStem(stem), indexStemFor(stem)]
    .filter(Boolean))]) {
    try {
      const res = await fetch(DATA_DIR + encodeURIComponent(cand) + ".cascade.json",
                              { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cascadeData[stem] = await res.json();
      poke();
      return;
    } catch (e) {
      lastErr = String(e);
    }
  }
  cascadeErrors[stem] = lastErr;
  poke();
}

async function fetchLabels() {
  // The Apps Script exec URL 404s in bursts — retry with backoff, same as
  // the extractor's api() does.
  const get = async (params) => {
    const url = SCRIPT_URL + "?" + new URLSearchParams(params).toString();
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, { redirect: "follow" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (body.status !== "ok") throw new Error(body.message || "backend error");
        return body;
      } catch (e) {
        if (attempt >= 2) throw e;
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  };
  const roster = (await get({ action: "statsChinPoint" })).labelers
    .map((e) => e.labeler)
    .filter((n) => !EXCLUDE_LABELERS.has(n));
  const byStem = new Map();
  let n = 0;
  for (const who of roster) {
    const body = await get({ action: "listChinPoint", labeler: who });
    for (const r of body.rows) {
      if (r.skipped || r.chin_x == null || r.chin_y == null) continue;
      const stem = String(r.video);
      if (!byStem.has(stem)) byStem.set(stem, []);
      byStem.get(stem).push({
        labeler: who, round: Number(r.round), frame: Number(r.frame),
        rep: Number(r.rep) || 0, x: Number(r.chin_x), y: Number(r.chin_y),
        vis: r.chin_vis || "visible",
      });
      n++;
    }
  }
  return { roster, byStem, n };
}

function ensureLabels() {
  // A failed fetch re-arms on the next mount, so re-selecting the lens
  // retries after an endpoint outage.
  if (labelsPromise && !labelsError) return;
  labelsError = null;
  labelsPromise = fetchLabels()
    .then((out) => { labels = out; })
    .catch((e) => { labelsError = String(e); })
    .then(poke);
}

// ---------------------------------------------------------------- scoping
function matchRound(state) {
  activeStem = state.cacheBasename || null;
  activeFace = null;
  activeRound = null;
  if (!activeStem) return;
  ensureFaceData(activeStem);
  ensureCascade(activeStem);
  activeFace = faceData[activeStem] || null;
  activeCascade = cascadeData[activeStem] || null;
  if (activeFace && state.cacheRound != null) {
    activeRound = activeFace.rounds[String(state.cacheRound)] || null;
  }
}

// The per-round lookups: viewer frame -> face entry, no-face runs, and the
// scoped labels resolved to viewer frames — all through t, memoized.
function buildMaps(state) {
  const key = `${activeStem}|${state.cacheRound}|${startSec(state)}` +
              `|${activeRound ? 1 : 0}|${labels ? labels.n : -1}` +
              `|${activeCascade ? 1 : 0}`;
  if (key === mapsKey) return;
  mapsKey = key;
  entryByViewer = new Map();
  cascadeByViewer = new Map();
  cascadeRuns = [];
  noFaceRuns = [];
  labelRows = [];
  if (activeRound) {
    const byF = new Map();
    let run = null;
    for (const fr of activeRound.frames) {
      const vf = secToFrame(state, fr.t);
      entryByViewer.set(vf, fr);
      byF.set(fr.f, fr);
      if (!fr.found) {
        if (run && vf <= run[1] + 1) run[1] = vf;
        else { run = [vf, vf]; noFaceRuns.push(run); }
      }
    }
    if (activeCascade) {
      const thr = activeCascade.threshold || 0.6;
      const TIER = { m: "mesh", l: "l106", n: "none" };
      // all-frames columns (v2 sidecars) — one entry per cache frame,
      // viewer frame resolved through the face JSON's t for the same row
      const rc = activeCascade.rounds &&
                 activeCascade.rounds[String(state.cacheRound)];
      if (rc) {
        for (let f = 0; f < rc.n; f++) {
          const fe = byF.get(f);
          if (!fe) continue;
          const score = rc.score[f];
          cascadeByViewer.set(secToFrame(state, fe.t), {
            tier: TIER[rc.tier[f]] || "none",
            score,
            included: score != null && score >= thr,
            box: rc.box[f], chin: rc.chin[f], nose: rc.nose[f],
            arc: rc.arc[f],
          });
        }
      }
      // labeled frames keep their rich marks (pts106 etc.) on top
      for (const ce of activeCascade.frames || []) {
        if (ce.round !== state.cacheRound) continue;
        cascadeByViewer.set(secToFrame(state, ce.t), {
          ...ce,
          included: ce.score != null && ce.score >= thr,
          labeled: true,
        });
      }
      // timeline runs: mesh / l106 (included), excluded, none
      const kindOf = (e) => !e || e.tier === "none" ? "none"
                          : !e.included ? "excluded" : e.tier;
      let cr = null;
      for (const vf of [...cascadeByViewer.keys()].sort((a, b) => a - b)) {
        const k = kindOf(cascadeByViewer.get(vf));
        if (cr && cr.kind === k && vf <= cr.hi + 1) cr.hi = vf;
        else { cr = { lo: vf, hi: vf, kind: k }; cascadeRuns.push(cr); }
      }
    }
    const rows = (labels &&
      (labels.byStem.get(activeStem) ||
       labels.byStem.get(stripStem(activeStem)))) || [];
    for (const r of rows) {
      if (r.round !== state.cacheRound) continue;
      const entry = byF.get(r.frame) || null;
      labelRows.push({
        ...r,
        entry,
        approx: !entry,                       // no t available — index fallback
        viewerF: entry ? secToFrame(state, entry.t) : r.frame,
      });
    }
    labelRows.sort((a, b) => a.viewerF - b.viewerF ||
                             a.labeler.localeCompare(b.labeler));
  }
}

function clicksAt(frame) {
  return (labelRows || []).filter((r) => r.viewerF === frame);
}

// distances mesh-point -> click, in normalized units and pixels
function dists(pt, r) {
  const W = activeFace ? activeFace.width : 1;
  const H = activeFace ? activeFace.height : 1;
  const dn = Math.hypot(pt[0] - r.x, pt[1] - r.y);
  const dpx = Math.hypot((pt[0] - r.x) * W, (pt[1] - r.y) * H);
  return { dn, dpx };
}

// ---------------------------------------------------------------- mount
function mount(hostEl, state) {
  host = hostEl;
  latestState = state;
  // A transient fetch failure (server bounce, network blip) must not stick
  // for the whole session — re-selecting the lens retries failed fetches.
  faceErrors = {};
  cascadeErrors = {};
  buildTimelineSlot();
  ensureLabels();
  matchRound(state);
  buildSidebar();
}

function buildSidebar() {
  if (!host) return;
  const parts = [];
  if (faceErrors[activeStem]) {
    parts.push(`<div style="color:${C.noface};font-size:12px">
      no face-mesh data for <code>${activeStem || "?"}</code>
      (${faceErrors[activeStem]}).<br>Extract it with:<br>
      <code style="font-size:11px">.venv-mediapipe/bin/python
      ml/research/chin_tuck/face_extract_v1.py</code></div>`);
  } else if (!activeFace) {
    parts.push(`<div style="color:#888;font-size:12px">loading face-mesh data…</div>`);
  } else {
    const rounds = Object.values(activeFace.rounds);
    const n = rounds.reduce((a, r) => a + r.frames.length, 0);
    const found = rounds.reduce(
      (a, r) => a + r.frames.filter((f) => f.found).length, 0);
    parts.push(`<div style="font-size:12px;color:#888;margin-bottom:6px">
      <code>${activeFace.video}</code> · ${activeFace.engine} ·
      stride ${activeFace.stride} ·
      face on <b style="color:#ddd">${n ? (100 * found / n).toFixed(1) : 0}%</b>
      of ${n} frames</div>`);
  }
  parts.push(`<div style="font-size:12px;margin-bottom:6px">
    <span style="color:${C.arc}">— jaw arc</span> ·
    <span style="color:${C.chin}">● chin 152</span> ·
    <span style="color:${C.low}">◆ lowest jaw</span><br>
    <span style="color:${C.cascade}">— cascade marks</span> ·
    <span style="color:${C.ok}">▭ SCRFD ≥thr</span> ·
    <span style="color:${C.noface}">▭ below thr</span>
    <span style="color:#666">(labeled frames only)</span></div>`);
  if (labelsError) {
    parts.push(`<div style="color:${C.noface};font-size:12px">
      labels failed to load: ${labelsError}</div>`);
  } else if (!labels) {
    parts.push(`<div style="color:#888;font-size:12px">fetching v4 chin labels…</div>`);
  } else {
    const sw = labels.roster.map((nm) =>
      `<span style="color:${labelerColor(nm)}">✕ ${nm}</span>`).join(" · ");
    parts.push(`<div style="font-size:12px;margin-bottom:6px">${sw}
      <span style="color:#666">(${labels.n} clicks live)</span></div>`);
  }
  parts.push(`<div id="fm-current" style="border:1px solid #333;border-radius:6px;
      padding:8px;margin-bottom:8px;min-height:44px;font-size:12px"></div>`);
  parts.push(`<div style="font-size:11px;color:#888;margin-bottom:4px">
    labeled frames in this round — click to jump</div>
    <div id="fm-list" style="max-height:240px;overflow-y:auto;font-size:11px"></div>`);
  host.innerHTML = parts.join("");
}

function buildTimelineSlot() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";
  const cv = document.createElement("canvas");
  cv.id = "fm-timeline";
  cv.style.cssText = "display:block;width:100%;height:64px;cursor:pointer;margin-top:6px";
  slot.appendChild(cv);
  cv.addEventListener("click", (e) => {
    if (!latestState) return;
    const p = poseOf(latestState);
    if (!p) return;
    const rect = cv.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
    seekFrame(ratio * (p.n_frames - 1));
  });
}

// ---------------------------------------------------------------- update
function update(state) {
  latestState = state;
  matchRound(state);
  buildMaps(state);
  renderCurrent(state);
  renderList(state);
  drawTimeline(state);
}

function renderCurrent(state) {
  const el = host && host.querySelector("#fm-current");
  if (!el) return;
  if (!activeRound) {
    el.innerHTML = `<span style="color:#666">no face-mesh data for this round</span>`;
    return;
  }
  const fr = entryByViewer.get(state.frame);
  const clicks = clicksAt(state.frame);
  const lines = [];
  lines.push(fr
    ? (fr.found
        ? `face <b style="color:${C.arc}">✓</b> · t=${fr.t.toFixed(3)}s`
        : `face <b style="color:${C.noface}">✗</b> · t=${fr.t.toFixed(3)}s`)
    : `<span style="color:#666">frame not in face data (stride?)</span>`);
  for (const r of clicks) {
    const tag = `<span style="color:${labelerColor(r.labeler)}">✕ ${r.labeler}` +
                `${r.rep ? " (rep)" : ""}${r.vis === "inferred" ? " ~" : ""}</span>`;
    if (fr && fr.found) {
      const d1 = dists(fr.chin, r), d2 = dists(fr.low, r);
      lines.push(`${tag} → 152 <b style="color:${C.chin}">${d1.dn.toFixed(4)}</b> ` +
        `(${d1.dpx.toFixed(0)}px) · low <b style="color:${C.low}">` +
        `${d2.dn.toFixed(4)}</b> (${d2.dpx.toFixed(0)}px)`);
    } else {
      lines.push(`${tag} <span style="color:${C.noface}">— no mesh on this frame</span>`);
    }
  }
  const ce = cascadeByViewer && cascadeByViewer.get(state.frame);
  if (ce) {
    const thr = (activeCascade && activeCascade.threshold) || 0.6;
    if (ce.box) {
      lines.push(`cascade: SCRFD <b style="color:${ce.included ? C.ok : C.noface}">` +
        `${ce.score.toFixed(2)}</b> ${ce.included
          ? `✓ ≥${thr}` : `✗ &lt;${thr} excluded`} · tier ` +
        `${ce.tier === "mesh" ? "mesh" : "2d106"}`);
      if (ce.chin) {
        for (const r of clicks) {
          const d = dists(ce.chin, r);
          lines.push(`<span style="color:${labelerColor(r.labeler)}">${r.labeler}</span>` +
            ` → <span style="color:${C.cascade}">cascade chin</span> ` +
            `<b>${d.dn.toFixed(4)}</b> (${d.dpx.toFixed(0)}px)`);
        }
      }
    } else {
      lines.push(`cascade: <span style="color:${C.noface}">SCRFD found no face</span>`);
    }
  }
  el.innerHTML = lines.join("<br>");
}

function renderList(state) {
  const el = host && host.querySelector("#fm-list");
  if (!el) return;
  const byF = new Map();
  for (const r of labelRows || []) {
    if (!byF.has(r.viewerF)) byF.set(r.viewerF, []);
    byF.get(r.viewerF).push(r);
  }
  el.innerHTML = [...byF.entries()].map(([vf, rs]) => {
    const who = rs.map((r) =>
      `<span style="color:${labelerColor(r.labeler)}">${r.labeler}` +
      `${r.rep ? "·rep" : ""}</span>`).join(" ");
    const cur = vf === state.frame ? "background:#22303a;" : "";
    const noface = rs[0].entry && !rs[0].entry.found
      ? ` <span style="color:${C.noface}">no face</span>` : "";
    const approx = rs[0].approx
      ? ` <span style="color:#d3b136" title="no t for this label — raw index">≈</span>` : "";
    return `<div data-f="${vf}" style="display:flex;gap:6px;padding:2px 4px;
        cursor:pointer;${cur}border-left:3px solid ${labelerColor(rs[0].labeler)}">
      <span style="width:44px;color:#888">f${vf}</span>
      <span style="flex:1">${who}${approx}${noface}</span></div>`;
  }).join("") ||
    `<div style="color:#666">no labeled frames in this round</div>`;
  el.querySelectorAll("[data-f]").forEach((row) => {
    row.addEventListener("click", () => seekFrame(parseInt(row.dataset.f, 10)));
  });
}

// ---------------------------------------------------------------- timeline
function sizeCanvas(cv) {
  const rect = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(50, Math.round(rect.width * dpr));
  const h = Math.max(30, Math.round(rect.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return { ctx: cv.getContext("2d"), W: w, H: h, dpr };
}

function drawTimeline(state) {
  const cv = document.getElementById("fm-timeline");
  if (!cv) return;
  const { ctx, W, H, dpr } = sizeCanvas(cv);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, W, H);
  const p = poseOf(state);
  if (!p) return;
  const n = Math.max(1, p.n_frames - 1);
  const x = (f) => (f / n) * W;
  if (!activeRound) {
    ctx.fillStyle = "#666";
    ctx.font = `${11 * dpr}px monospace`;
    ctx.fillText("face mesh: no data for this round", 10 * dpr, 16 * dpr);
  } else {
    // coverage strip — red where the original pipeline found no face
    const y0 = H * 0.06, hh = H * 0.2;
    ctx.fillStyle = "#243038";
    ctx.fillRect(0, y0, W, hh);
    ctx.fillStyle = "#5a2f35";
    for (const [lo, hi] of noFaceRuns) {
      ctx.fillRect(x(lo), y0, Math.max(1.5 * dpr, x(hi + 1) - x(lo)), hh);
    }
    ctx.fillStyle = C.text;
    ctx.font = `${9 * dpr}px monospace`;
    ctx.fillText("no-face", 4 * dpr, y0 - 1 * dpr);
    // cascade lane — per-frame tier / verdict
    if (cascadeRuns && cascadeRuns.length) {
      const y1 = H * 0.36, h1 = H * 0.2;
      const KIND = { mesh: C.arc, l106: C.low, excluded: "#ff9a3d",
                     none: "#5a2f35" };
      ctx.fillStyle = "#243038";
      ctx.fillRect(0, y1, W, h1);
      for (const r of cascadeRuns) {
        ctx.fillStyle = KIND[r.kind] || "#243038";
        ctx.fillRect(x(r.lo), y1, Math.max(1.5 * dpr, x(r.hi + 1) - x(r.lo)), h1);
      }
      ctx.fillStyle = C.text;
      ctx.fillText("cascade", 4 * dpr, y1 - 1 * dpr);
    }
    // labeled-frame ticks, one lane per labeler
    const roster = labels ? labels.roster : [];
    const laneY = (i) => H * 0.66 + i * (H * 0.3 / Math.max(1, roster.length));
    roster.forEach((nm, i) => {
      ctx.fillStyle = labelerColor(nm);
      ctx.font = `${9 * dpr}px monospace`;
      ctx.fillText(nm.slice(0, 6), 4 * dpr, laneY(i) + 8 * dpr);
    });
    for (const r of labelRows || []) {
      const i = Math.max(0, roster.indexOf(r.labeler));
      ctx.strokeStyle = labelerColor(r.labeler);
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(x(r.viewerF), laneY(i));
      ctx.lineTo(x(r.viewerF), laneY(i) + 9 * dpr);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = C.playhead;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.moveTo(x(state.frame), 0);
  ctx.lineTo(x(state.frame), H);
  ctx.stroke();
}

// ---------------------------------------------------------------- on-video
function crossMark(ctx, px, py, r, color, lw) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(px - r, py - r); ctx.lineTo(px + r, py + r);
  ctx.moveTo(px - r, py + r); ctx.lineTo(px + r, py - r);
  ctx.stroke();
}

function draw(ctx, state) {
  if (!activeRound) return;
  const s = state.renderScale || 1;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const fr = entryByViewer.get(state.frame);
  const clicks = clicksAt(state.frame);
  ctx.save();
  if (fr && fr.found) {
    // jaw arc polyline
    ctx.strokeStyle = C.arc;
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    fr.arc.forEach((q, i) => {
      const px = q[0] * W, py = q[1] * H;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
    // lowest jaw point — yellow diamond
    const lx = fr.low[0] * W, ly = fr.low[1] * H, r = 5 * s;
    ctx.fillStyle = C.low;
    ctx.beginPath();
    ctx.moveTo(lx, ly - r); ctx.lineTo(lx + r, ly);
    ctx.lineTo(lx, ly + r); ctx.lineTo(lx - r, ly);
    ctx.closePath();
    ctx.fill();
    // chin 152 — orange dot + ring
    const cx = fr.chin[0] * W, cy = fr.chin[1] * H;
    ctx.fillStyle = C.chin;
    ctx.beginPath(); ctx.arc(cx, cy, 3.5 * s, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = C.chin;
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.arc(cx, cy, 7 * s, 0, 2 * Math.PI); ctx.stroke();
    // labeler clicks + a thin tie-line from the mesh chin to each click
    for (const rr of clicks) {
      const px = rr.x * W, py = rr.y * H;
      ctx.setLineDash([4 * s, 4 * s]);
      ctx.strokeStyle = labelerColor(rr.labeler);
      ctx.lineWidth = 1 * s;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
      ctx.setLineDash([]);
      crossMark(ctx, px, py, 6 * s, labelerColor(rr.labeler), 2 * s);
    }
  } else {
    for (const rr of clicks) {
      crossMark(ctx, rr.x * W, rr.y * H, 6 * s, labelerColor(rr.labeler), 2 * s);
    }
  }
  // gate-cascade overlay (sidecar): SCRFD box colored by the include
  // verdict, magenta landmarks, white nose
  const ce = cascadeByViewer && cascadeByViewer.get(state.frame);
  if (ce && ce.box) {
    ctx.strokeStyle = ce.included ? C.ok : C.noface;
    ctx.lineWidth = 2 * s;
    if (!ce.included) ctx.setLineDash([6 * s, 5 * s]);
    ctx.strokeRect(ce.box[0] * W, ce.box[1] * H,
                   (ce.box[2] - ce.box[0]) * W, (ce.box[3] - ce.box[1]) * H);
    ctx.setLineDash([]);
    if (ce.tier === "mesh" && ce.arc) {
      ctx.strokeStyle = C.cascade;
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ce.arc.forEach((q, i) => {
        i ? ctx.lineTo(q[0] * W, q[1] * H) : ctx.moveTo(q[0] * W, q[1] * H);
      });
      ctx.stroke();
    } else if (ce.pts106) {
      ctx.fillStyle = C.cascade;
      for (const q of ce.pts106) {
        ctx.beginPath();
        ctx.arc(q[0] * W, q[1] * H, 1.6 * s, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    if (ce.chin) {
      ctx.strokeStyle = C.cascade;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(ce.chin[0] * W, ce.chin[1] * H, 6 * s, 0, 2 * Math.PI);
      ctx.stroke();
    }
    if (ce.nose) {
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(ce.nose[0] * W, ce.nose[1] * H, 4 * s, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ce.nose[0] * W, ce.nose[1] * H, 2.8 * s, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  // HUD
  ctx.font = `${13 * s}px monospace`;
  const hud = [];
  hud.push([fr ? (fr.found ? "face ✓" : "face ✗") : "face —",
            fr && fr.found ? C.arc : C.noface]);
  for (const rr of clicks) {
    if (fr && fr.found) {
      const d1 = dists(fr.chin, rr), d2 = dists(fr.low, rr);
      hud.push([`${rr.labeler}${rr.rep ? "·rep" : ""}: 152 ${d1.dn.toFixed(4)} ` +
                `(${d1.dpx.toFixed(0)}px) · low ${d2.dn.toFixed(4)} (${d2.dpx.toFixed(0)}px)`,
                labelerColor(rr.labeler)]);
    } else {
      hud.push([`${rr.labeler}: labeled — no mesh here`, labelerColor(rr.labeler)]);
    }
  }
  if (ce) {
    const thr = (activeCascade && activeCascade.threshold) || 0.6;
    if (ce.box) {
      hud.push([`SCRFD ${ce.score.toFixed(2)} ` +
                (ce.included ? `✓ ≥${thr}` : `✗ <${thr} excluded`) +
                ` · tier ${ce.tier === "mesh" ? "mesh" : "2d106"}`,
                ce.included ? C.ok : C.noface]);
      if (ce.chin) {
        for (const rr of clicks) {
          const d = dists(ce.chin, rr);
          hud.push([`${rr.labeler} → cascade chin ${d.dn.toFixed(4)} ` +
                    `(${d.dpx.toFixed(0)}px)`, C.cascade]);
        }
      }
    } else {
      hud.push(["SCRFD: no detection", C.noface]);
    }
  }
  const wmax = Math.max(...hud.map(([t]) => ctx.measureText(t).width));
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(8 * s, 8 * s, wmax + 16 * s, hud.length * 18 * s + 8 * s);
  hud.forEach(([t, col], i) => {
    ctx.fillStyle = col;
    ctx.fillText(t, 16 * s, (24 + 18 * i) * s);
  });
  ctx.restore();
}

export const FaceMeshChinRule = {
  id: "face_mesh_chin",
  label: "Face mesh (chin)",
  // Only videos with extracted face-mesh data are selectable under this lens.
  requiresVideo,
  mount,
  update,
  draw,
};
