// Skeleton usability — what the skeleton-usability detectors declared unusable in this round.
//
// Four declared kinds so far (cornerman-backend ml/research/skeleton_usability/README.md), each
// with its own show/hide toggle so one can be reviewed on its own — the toggles drive everything:
// the timeline, the list, the frame line, the on-video HUD, the "declared" union, and which
// rounds the video / round dropdowns offer:
//   no skeleton   frames INSIDE the round (round_start … round_end; the extractor's 1.5 s pre-roll
//                 is not judged) where BlazePose returned no pose at all — every landmark NaN —
//                 as stretches of at least 3 frames (shorter dropouts are ignored blips); plus the
//                 tail of a round the cache never reached (decoder stopped)
//   jump          between consecutive DETECTED frames the core (shoulders + hips centre) moved more
//                 than a torso within 0.25 s — the tracker landed on someone else
//   other person  big steps (jumps, and far re-acquisitions after a gap) cut the round into segments;
//                 the segment with the most frames seeds the boxer, segments near it in position and
//                 torso size join, and so does a segment entering through the image edge after the
//                 boxer left through it (a walk out and back); the rest are another person (the home
//                 position / torso the decision was made against is shown)
//   frozen        a fully detected 5 s window in which no joint travels more than 0.1 torso — the
//                 tracker locked on a painting, a statue, a poster
// Nothing learned yet: the labelers' unusable_start / unusable_end markers are the target of the
// model this line is heading for.
//
// Data: lens_data/skeleton_usability/ (index.json + one JSON per round), written by
//   cd ~/code/cornerman-backend && .venv/bin/python ml/research/skeleton_usability/lens_export.py
// (jumps.py's and frozen.py's thresholds can be passed through; the index records them).
//
// Schema:
//   index.json   { generated, source, detectors: { no_skeleton: { min_frames }, jumps: { jump_torso, max_dt_s, pos_tol, scale, edge_torso },
//                  frozen: { window_s, tol } }, shelf, n_rounds,
//                  totals: { n_in_round, n_no_skeleton, n_stretches, n_rounds_touched, n_jumps, n_rounds_with_jumps,
//                            n_other, n_rounds_with_other, n_frozen, n_rounds_with_frozen, declared_sec },
//                  videos: { <stem>: { <ri>: { file, n_no_skeleton, n_stretches, no_skeleton_sec, uncovered_tail_sec,
//                                              n_jumps, other_sec, frozen_sec, declared_sec } } } }
//   <hash>.json  { round_id, stem, ri, start_sec, end_sec, fps, n_frames, n_in_round, torso,
//                  n_no_skeleton, no_skeleton_sec, stretches: [{ s, e, n, f0, f1 }], n_blips_ignored, uncovered_tail_sec,
//                  jumps: [{ s, e, f0, f1, gap, dt, step, torso_ratio, from_edge, to_edge }],   from frame f0 (time s) to the landing frame f1 (time e)
//                  other: [{ s, e, n, f0, f1, cx, cy, torso, enters_edge, exits_edge }], home: { cx, cy, torso } | null, n_other, other_sec,
//                  frozen: [{ s, e, n, f0, f1, motion }], n_frozen, frozen_sec, min_motion,
//                  declared_sec, declared_frac }                              the union of every kind, plus the tail
// s / e are source-video seconds of a stretch's FIRST and LAST frame, f0 / f1 those frames' indices in
// the cache (pre-roll included). A stretch is placed by its cache frames when the loaded cache is that
// file (same frame count) and through the viewer's clock (secToFrame, the impact spotter lens's
// convention) otherwise.
//
// The video and round dropdowns offer only rounds where a SHOWN kind declared something; everything
// if the index failed to load.

import { createRangeSelection } from "../shared/timeline_selection.js";

const DATA_DIR = "./lens_data/skeleton_usability/";
const LENS_ID = "skeleton_usability";
const EARLY_END_SEC = 0.5;    // an uncovered tail above this = the cache stops before the round does (no_skeleton.EARLY_END_SEC)
const EXPORT_CMD = "cd ~/code/cornerman-backend && .venv/bin/python ml/research/skeleton_usability/lens_export.py";
const C = {
  miss: "#ff5d6c",       // no skeleton
  jump: "#ffd166",       // a jump
  other: "#b48cff",      // another person
  frozen: "#8ab4f8",     // a locked tracker
  tail: "#f5a23c",       // the cache never reached this part of the round
  ok: "#7adf7a",
  playhead: "#3ad9e0",
  round: "#2a3340",
  preroll: "#14171c",
  bg: "#181818",
  text: "#aaa",
  muted: "#666",
};
const KINDS = ["nosk", "jump", "other", "frozen"];
const KIND = {
  nosk:   { label: "no skeleton", short: "no skel", color: C.miss,   items: (d) => d.stretches },
  jump:   { label: "jumps",       short: "jump",    color: C.jump,   items: (d) => d.jumps },
  other:  { label: "other person", short: "other",  color: C.other,  items: (d) => d.other },
  frozen: { label: "frozen",      short: "frozen",  color: C.frozen, items: (d) => d.frozen },
};

let host = null, latestState = null;
let index = null, indexError = null, indexLoading = null;
let doc = null, docKey = null, docError = null;
let show = { nosk: true, jump: true, other: true, frozen: true };   // the kind toggles, kept for the session
let view = null;               // zoom window in viewer frames {start, end}; null = the whole round
let selection = null;          // drag-selected frame range (shared/timeline_selection.js)
let lastFrame = 0, lastDrawnFrame = -1, lastZoomLabel = "";

// ── clock (the impact spotter lens's convention) ─────────────────────────────
function stripStem(s) { return String(s || "").replace(/_h264$/, ""); }
function poseOf(state) { return state.pose || null; }
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
// [first, last] viewer frame of a stretch or jump: the export's own cache frames when the loaded
// cache is the exported file, else its source seconds through the clock
function framesOf(state, st) {
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
// a round is offered when a SHOWN kind declared something in it
function declared(e) {
  if (!e) return false;
  return (show.nosk && (e.n_stretches > 0 || e.uncovered_tail_sec > EARLY_END_SEC))
      || (show.jump && e.n_jumps > 0)
      || (show.other && e.other_sec > 0)
      || (show.frozen && (e.frozen_sec || 0) > 0);
}
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
  docKey = key; doc = null; docError = null; view = null;
  selection?.clear();
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
    d.stretches = d.stretches || []; d.jumps = d.jumps || []; d.other = d.other || []; d.frozen = d.frozen || [];
    doc = d;
  } catch (e) { if (docKey === key) docError = String(e); }
  if (docKey !== key) return;
  renderAll();
}

// what the SHOWN kinds declare under the playhead: one entry per kind, or null
function currentAt(state) {
  const f = state.frame, cur = {};
  for (const k of KINDS) {
    cur[k] = null;
    if (!doc || !show[k]) continue;
    const items = KIND[k].items(doc);
    for (let i = 0; i < items.length; i++) {
      const [a, b] = framesOf(state, items[i]);
      if (f >= a && f <= b) { cur[k] = { i, it: items[i], a, b }; break; }
    }
  }
  return cur;
}
function tailFrames(state) {
  return doc && show.nosk && doc.uncovered_tail_sec > EARLY_END_SEC ? Math.round(doc.uncovered_tail_sec * (state.fps || 30)) : 0;
}
function tailSec() { return doc && show.nosk && doc.uncovered_tail_sec > EARLY_END_SEC ? doc.uncovered_tail_sec : 0; }
// the union of the shown kinds' frames inside the round, in seconds, plus the tail
function declaredSec(state) {
  if (!doc) return 0;
  const n = doc.n_frames, mark = new Uint8Array(n);
  for (const k of KINDS) {
    if (!show[k]) continue;
    for (const it of KIND[k].items(doc)) {
      const [a, b] = framesOf(state, it);
      for (let f = Math.max(0, a); f <= Math.min(n - 1, b); f++) mark[f] = 1;
    }
  }
  let c = 0;
  for (let f = Math.max(0, secToFrame(state, doc.start_sec)); f < n; f++) c += mark[f];
  return c / doc.fps + tailSec();
}

// ── side panel ───────────────────────────────────────────────────────────────
function template() {
  const cb = (k) => `<label style="margin-right:10px;cursor:pointer;color:${KIND[k].color};white-space:nowrap">
      <input type="checkbox" data-kind="${k}" ${show[k] ? "checked" : ""}> ${KIND[k].label}</label>`;
  return `
    <h2>Skeleton usability</h2>
    <p class="hint">What the skeleton-usability detectors declared unusable in this round:
      <b style="color:${C.miss}">no skeleton</b> (BlazePose returned no pose at all for 3 frames or more),
      <b style="color:${C.jump}">jumps</b> (the core moved more than a torso within 0.25 s between
      consecutive detected frames — the tracker landed on someone else),
      <b style="color:${C.other}">other person</b> (the segments between jumps that are not the boxer
      by position and torso size; a walk out through the image edge and back in keeps the boxer) and
      <b style="color:${C.frozen}">frozen</b> (no joint moved more than
      0.1 torso for 5 s — a painting, a statue), plus the tail of a round the cache never reached. The
      pre-roll before round_start is not judged. Untick a kind to review the others on their own: the
      dropdowns then list only rounds where a ticked kind declared something. On the timeline: click = seek,
      drag = select (then Zoom to / Export), shift-drag = pan, wheel = zoom, double-click = fit.</p>
    <div style="font-size:12px;margin-bottom:8px"><span class="muted">show</span> ${KINDS.map(cb).join("")}</div>
    <div id="su-scope" class="muted small" style="margin-bottom:6px"></div>
    <div id="su-stats" style="font-size:13px;line-height:1.6;margin-bottom:8px"></div>
    <div id="su-frame" style="font-size:13px;margin-bottom:8px;min-height:18px"></div>
    <div id="su-list-head" class="muted small" style="margin-bottom:4px"></div>
    <div id="su-list" style="max-height:280px;overflow-y:auto;font-size:12px"></div>
    <div id="su-shelf" class="muted small" style="margin-top:10px"></div>`;
}

function wireControls() {
  host.querySelectorAll("input[data-kind]").forEach(cb => cb.addEventListener("change", () => {
    show[cb.dataset.kind] = cb.checked;
    renderAll();
    window.dispatchEvent(new Event("lens-filter-changed"));   // the dropdowns follow the toggles
    document.getElementById("video")?.dispatchEvent(new Event("seeked"));   // the on-video HUD too
  }));
}

function renderAll() {
  if (!host) return;
  renderScope();
  renderList();
  renderShelf();
  if (latestState) { renderStats(latestState); renderFrameLine(latestState); drawTimeline(latestState); }
  else renderStats(null);
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
  if (!index) { el.textContent = "loading the detectors' index…"; return; }
  if (!st || !st.cacheBasename || st.cacheRound == null) { el.textContent = "load a video + round"; return; }
  el.innerHTML = doc
    ? `scoped: <code>${esc(doc.stem)}</code> · r${doc.ri} · ${fmtTime(doc.start_sec)} – ${fmtTime(doc.end_sec)} · ${doc.fps} fps`
    : docError ? `<span style="color:${C.miss}">${esc(docError)}</span>`
    : entryFor(st) ? "loading this round…"
    : `no export for <code>${esc(st.cacheBasename)}</code> r${st.cacheRound} — not on the surveyed shelf; re-export with<br>` +
      `<code style="font-size:11px">${esc(EXPORT_CMD)}</code>`;
}

function renderStats(state) {
  const el = host.querySelector("#su-stats");
  if (!el) return;
  if (!doc) { el.innerHTML = ""; return; }
  const dur = doc.end_sec - doc.start_sec;
  const pct = (n) => doc.n_in_round ? (100 * n / doc.n_in_round).toFixed(1) : "—";
  const dim = (k) => show[k] ? "" : "opacity:0.4";
  const longest = doc.stretches.reduce((m, s) => Math.max(m, s.n), 0) / doc.fps;
  const acrossGap = doc.jumps.filter(j => j.gap > 1).length;
  const thr = index?.detectors || {};
  const tail = doc.uncovered_tail_sec > EARLY_END_SEC ? doc.uncovered_tail_sec : 0;
  const declaredS = state ? declaredSec(state) : (doc.declared_sec || 0);
  const shown = KINDS.filter(k => show[k]);
  const verdictColor = declaredS === 0 ? C.ok : C.miss;
  el.innerHTML =
    `<div>in round: <b>${fmtN(doc.n_in_round)}</b> frames (${fmtSec(dur)})` + (doc.torso ? ` · torso ${doc.torso.toFixed(3)}` : "") + `</div>` +
    `<div style="${dim("nosk")}"><span style="color:${C.miss}">no skeleton</span>: <b>${fmtN(doc.n_no_skeleton)}</b> frames = ${pct(doc.n_no_skeleton)} % ` +
      `(${fmtSec(doc.no_skeleton_sec)}) in <b>${doc.stretches.length}</b> stretch${doc.stretches.length === 1 ? "" : "es"}` +
      (doc.stretches.length ? ` · longest ${fmtSec(longest)}` : "") +
      (doc.n_blips_ignored ? ` <span class="muted">· ${doc.n_blips_ignored} blip${doc.n_blips_ignored === 1 ? "" : "s"} under ${thr.no_skeleton ? thr.no_skeleton.min_frames : 3} frames ignored</span>` : "") + `</div>` +
    `<div style="${dim("jump")}"><span style="color:${C.jump}">jumps</span>: <b>${doc.jumps.length}</b>` +
      (doc.jumps.length ? ` (${acrossGap} across a no-skeleton gap` + (thr.jumps ? `; > ${thr.jumps.jump_torso} torso within ${thr.jumps.max_dt_s} s` : "") + `)` : "") + `</div>` +
    `<div style="${dim("other")}"><span style="color:${C.other}">other person</span>: <b>${fmtN(doc.n_other || 0)}</b> frames = ${pct(doc.n_other || 0)} % ` +
      `(${fmtSec(doc.other_sec || 0)}) in <b>${doc.other.length}</b> stretch${doc.other.length === 1 ? "" : "es"}` +
      (doc.home ? ` · the boxer at (${doc.home.cx.toFixed(2)}, ${doc.home.cy.toFixed(2)}), torso ${doc.home.torso.toFixed(3)}` +
        (thr.jumps ? ` <span class="muted">(within ${thr.jumps.pos_tol} torso, ratio ${thr.jumps.scale[0]}–${thr.jumps.scale[1]})</span>` : "") : "") + `</div>` +
    `<div style="${dim("frozen")}"><span style="color:${C.frozen}">frozen</span>: <b>${fmtN(doc.n_frozen || 0)}</b> frames = ${pct(doc.n_frozen || 0)} % ` +
      `(${fmtSec(doc.frozen_sec || 0)}) in <b>${doc.frozen.length}</b> stretch${doc.frozen.length === 1 ? "" : "es"}` +
      (doc.min_motion != null ? ` · stillest ${thr.frozen ? thr.frozen.window_s : 5} s window: ${doc.min_motion.toFixed(3)} torso` +
        (thr.frozen ? ` <span class="muted">(frozen under ${thr.frozen.tol})</span>` : "") : "") + `</div>` +
    (tail ? `<div style="color:${C.tail};${dim("nosk")}">cache stops <b>${fmtSec(tail)}</b> before round_end — those frames were never decoded</div>` : "") +
    `<div style="margin-top:4px;padding:4px 8px;border-left:3px solid ${verdictColor}">declared unusable` +
      `${shown.length === KINDS.length ? " (the union)" : ` (${shown.map(k => KIND[k].label).join(" + ") || "nothing shown"})`}: ` +
      `<b style="color:${verdictColor}">${fmtSec(declaredS)}</b> of ${fmtSec(dur)} (${(dur ? 100 * declaredS / dur : 0).toFixed(1)} %)</div>`;
}

function renderFrameLine(state) {
  const el = host.querySelector("#su-frame");
  if (!el) return;
  if (!doc) { el.innerHTML = ""; return; }
  const f = state.frame, t = frameToSec(state, f);
  const cur = currentAt(state);
  const parts = [];
  if (cur.jump) {
    const j = cur.jump.it;
    parts.push(`<span style="color:${C.jump};font-weight:700">JUMP</span> <span class="muted">${cur.jump.i + 1}/${doc.jumps.length} · ` +
      `${j.step.toFixed(2)} torso in ${(j.dt * 1000).toFixed(0)} ms (f${j.f0} → f${j.f1}${j.gap > 1 ? `, ${j.gap - 1} frame${j.gap > 2 ? "s" : ""} without a skeleton between` : ""}) · torso ×${j.torso_ratio.toFixed(2)}</span>`);
  }
  if (cur.other) {
    const o = cur.other.it;
    parts.push(`<span style="color:${C.other};font-weight:700">OTHER PERSON</span> <span class="muted">${cur.other.i + 1}/${doc.other.length} · ` +
      `${fmtTime(o.s)} – ${fmtTime(o.e)} (${fmtSec(o.n / doc.fps)}) · at (${o.cx.toFixed(2)}, ${o.cy.toFixed(2)}), torso ${o.torso.toFixed(3)}</span>`);
  }
  if (cur.frozen) {
    const z = cur.frozen.it;
    parts.push(`<span style="color:${C.frozen};font-weight:700">FROZEN</span> <span class="muted">${cur.frozen.i + 1}/${doc.frozen.length} · ` +
      `${fmtTime(z.s)} – ${fmtTime(z.e)} (${fmtSec(z.n / doc.fps)}) · stillest window ${z.motion.toFixed(3)} torso</span>`);
  }
  if (cur.nosk) {
    const s = cur.nosk.it;
    parts.push(`<span style="color:${C.miss};font-weight:700">NO SKELETON</span> <span class="muted">${cur.nosk.i + 1}/${doc.stretches.length} · ` +
      `f${s.f0}–f${s.f1} · ${s.n} f (${fmtSec(s.n / doc.fps)})</span>`);
  }
  const head = `frame ${f} · ${fmtTime(t)} — `;
  if (parts.length) el.innerHTML = head + parts.join("<br>" + "&nbsp;".repeat(4));
  else if (t < doc.start_sec) el.innerHTML = `<span class="muted">${head}pre-roll, not judged</span>`;
  else el.innerHTML = `<span style="color:${C.ok}">${head}skeleton present, the boxer</span>`;
}

// every declared item of the shown kinds as one time-ordered list
function listItems() {
  const out = [];
  if (show.nosk) doc.stretches.forEach((s, i) => out.push({ kind: "nosk", i, it: s, t: s.s, len: s.n / doc.fps, txt: `${s.n} f · f${s.f0}–f${s.f1}` }));
  if (show.jump) doc.jumps.forEach((j, i) => out.push({ kind: "jump", i, it: j, t: j.e, len: j.dt,
    txt: `${j.step.toFixed(1)} torso · ×${j.torso_ratio.toFixed(2)} · f${j.f0} → f${j.f1}` +
         (j.from_edge ? " · from the edge" : "") + (j.to_edge ? " · to the edge" : "") }));
  if (show.other) doc.other.forEach((o, i) => out.push({ kind: "other", i, it: o, t: o.s, len: o.n / doc.fps,
    txt: `${o.n} f · at (${o.cx.toFixed(2)}, ${o.cy.toFixed(2)}) torso ${o.torso.toFixed(3)}` +
         (o.enters_edge ? " · enters at the edge" : "") + (o.exits_edge ? " · exits at the edge" : "") }));
  if (show.frozen) doc.frozen.forEach((z, i) => out.push({ kind: "frozen", i, it: z, t: z.s, len: z.n / doc.fps,
    txt: `${z.n} f · stillest window ${z.motion.toFixed(3)} torso` }));
  return out.sort((a, b) => a.t - b.t);
}

function renderList() {
  const head = host.querySelector("#su-list-head"), el = host.querySelector("#su-list");
  if (!head || !el) return;
  if (!doc) { head.textContent = ""; el.innerHTML = ""; return; }
  const items = listItems();
  const total = KINDS.reduce((n, k) => n + KIND[k].items(doc).length, 0);
  head.textContent = total ? `${items.length} of ${total} declared, in time — click to jump (kind · start · length)` : "nothing declared in this round";
  el.innerHTML = items.map((x, k) =>
    `<div data-k="${k}" style="display:flex;gap:8px;padding:2px 6px;cursor:pointer;border-left:3px solid ${KIND[x.kind].color}">
      <span style="width:50px;color:${KIND[x.kind].color}">${KIND[x.kind].short}</span>
      <span style="width:52px;color:${C.text}">${fmtTime(x.t)}</span>
      <span style="width:56px">${fmtSec(x.len)}</span>
      <span class="muted">${x.txt}</span>
    </div>`).join("");
  el.querySelectorAll("[data-k]").forEach(row => row.addEventListener("click", () => {
    if (!latestState || !doc) return;
    const x = items[Number(row.dataset.k)];
    const [a, b] = framesOf(latestState, x.it);
    seekFrame(x.kind === "jump" ? b : a);        // a jump: land on its landing frame
  }));
}

function renderShelf() {
  const el = host.querySelector("#su-shelf");
  if (!el || !index) return;
  const T = index.totals || {};
  const pct = (n) => T.n_in_round ? (100 * (n || 0) / T.n_in_round).toFixed(2) : "—";
  el.innerHTML = `shelf: ${fmtN(index.n_rounds)} rounds · no skeleton ${pct(T.n_no_skeleton)} % of in-round frames (${fmtN(T.n_rounds_touched)} rounds) · ` +
    `${fmtN(T.n_jumps || 0)} jumps (${fmtN(T.n_rounds_with_jumps || 0)} rounds) · other person ${pct(T.n_other)} % (${fmtN(T.n_rounds_with_other || 0)} rounds) · ` +
    `frozen ${pct(T.n_frozen)} % (${fmtN(T.n_rounds_with_frozen || 0)} rounds) · exported ${esc(String(index.generated || "").slice(0, 10))}`;
}

// ── stage timeline: three lanes over the round in viewer frames — no skeleton (red), other person
// (purple), frozen (blue); jumps as yellow ticks through all; the never-decoded tail hatched orange.
// Zoom / pan / select / seek machinery mirrors the rolls lenses (shared/timeline_selection.js). ──
const LANES = ["nosk", "other", "frozen"];
const LABEL_W = 64, PAD_R = 4, MIN_SPAN_FRAMES = 30;
const TL_TOP = 4, LANE_H = 16, LANE_GAP = 3, AXIS_H = 14;
const ZOOM_HINT = "click = seek · drag = select · shift-drag = pan · wheel = zoom · double-click = fit";

function mountStageTimeline() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:12px;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px";
  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px";
  const label = document.createElement("div");
  label.id = "su-tl-label";
  label.className = "muted small";
  label.style.cssText = "flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  label.textContent = `Skeleton usability timeline — ${ZOOM_HINT}`;
  header.appendChild(label);
  const btnCss = "background:var(--bg-elev);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:2px 9px;cursor:pointer;font:inherit;font-size:12px;line-height:1.4";
  const mkBtn = (text, title, onClick) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = text; b.title = title; b.style.cssText = btnCss;
    b.addEventListener("click", onClick); header.appendChild(b);
  };
  mkBtn("−", "Zoom out", () => zoomStep(0.5));
  mkBtn("+", "Zoom in on the playhead", () => zoomStep(2));
  mkBtn("Fit", "Show the whole round", () => { view = null; redrawTimelineNow(); });
  selection = createRangeSelection({
    header, frameToX, xToFrame,
    frameToSec: f => frameToSec(latestState, f), nFrames: () => nFrames(latestState),
    seek: f => seekFrame(f), zoomTo: zoomToRange, redraw: redrawTimelineNow,
  });
  wrap.appendChild(header);
  const canvas = document.createElement("canvas");
  canvas.id = "su-timeline";
  const cssH = TL_TOP + LANES.length * (LANE_H + LANE_GAP) + AXIS_H;
  canvas.style.cssText = `display:block;width:100%;height:${cssH}px;cursor:crosshair`;
  canvas.width = 800; canvas.height = cssH;
  wrap.appendChild(canvas);
  slot.appendChild(wrap);

  canvas.addEventListener("wheel", e => {
    if (!doc) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { panBy(e.deltaX * framesPerPx(rect.width)); return; }
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(Math.exp(-dy * 0.002), xToFrame(e.clientX - rect.left, rect.width));
  }, { passive: false });
  canvas.addEventListener("mousedown", e => {
    if (!doc || e.button !== 0) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    if (!e.shiftKey) { selection.beginDrag(e, rect); return; }   // drag = select a range · click = seek
    const fpp = framesPerPx(rect.width);                          // shift-drag = pan the zoom window
    let lastX = e.clientX;
    const onMove = ev => { panBy((lastX - ev.clientX) * fpp); lastX = ev.clientX; };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
  canvas.addEventListener("dblclick", e => { e.preventDefault(); view = null; redrawTimelineNow(); });
}

// the axis runs over the cache's frames plus the never-decoded tail
function axisFrames() { return Math.max(2, nFrames(latestState) + (latestState ? tailFrames(latestState) : 0)); }
function viewRange() {
  if (!view) return { v0: 0, v1: axisFrames() - 1 };
  return { v0: view.start, v1: view.end };
}
function frameToX(f, cssW) { const { v0, v1 } = viewRange(); return LABEL_W + ((f - v0) / Math.max(1e-6, v1 - v0)) * (cssW - LABEL_W - PAD_R); }
function xToFrame(x, cssW) { const { v0, v1 } = viewRange(); return v0 + ((x - LABEL_W) / Math.max(1, cssW - LABEL_W - PAD_R)) * (v1 - v0); }
function framesPerPx(cssW) { const { v0, v1 } = viewRange(); return (v1 - v0) / Math.max(1, cssW - LABEL_W - PAD_R); }
function zoomAt(factor, anchorFrame) {
  if (!doc) return;
  const full = axisFrames() - 1;
  const { v0, v1 } = viewRange();
  const span = Math.max(Math.min(MIN_SPAN_FRAMES, full), Math.min(full, (v1 - v0) / factor));
  if (span >= full) { view = null; redrawTimelineNow(); return; }
  let start = anchorFrame - (anchorFrame - v0) * (span / (v1 - v0));
  start = Math.max(0, Math.min(full - span, start));
  view = { start, end: start + span };
  redrawTimelineNow();
}
function zoomToRange(a, b) {                       // the selection toolbar's "Zoom to"
  if (!doc) return;
  const full = axisFrames() - 1;
  const span = Math.max(Math.min(MIN_SPAN_FRAMES, full), Math.min(full, b - a + 1));
  if (span >= full) { view = null; redrawTimelineNow(); return; }
  const start = Math.max(0, Math.min(full - span, a - (span - (b - a + 1)) / 2));
  view = { start, end: start + span };
  redrawTimelineNow();
}
function zoomStep(factor) {
  if (!doc) return;
  const { v0, v1 } = viewRange();
  zoomAt(factor, (lastFrame >= v0 && lastFrame <= v1) ? lastFrame : (v0 + v1) / 2);
}
function panBy(dFrames) {
  if (!doc || !view || !dFrames) return;
  const full = axisFrames() - 1;
  const span = view.end - view.start;
  const start = Math.max(0, Math.min(full - span, view.start + dFrames));
  view = { start, end: start + span };
  redrawTimelineNow();
}
function redrawTimelineNow() { if (latestState) drawTimeline(latestState); }
function timelineCounts() {
  const parts = [];
  if (show.nosk) parts.push(`no skeleton ${fmtSec(doc.no_skeleton_sec)} (${doc.stretches.length})`);
  if (show.jump) parts.push(`${doc.jumps.length} jumps`);
  if (show.other) parts.push(`other person ${fmtSec(doc.other_sec || 0)} (${doc.other.length})`);
  if (show.frozen) parts.push(`frozen ${fmtSec(doc.frozen_sec || 0)} (${doc.frozen.length})`);
  if (tailSec()) parts.push(`cache ends ${fmtSec(doc.uncovered_tail_sec)} early`);
  parts.push(`declared ${fmtSec(declaredSec(latestState))}`);
  return parts.join(" · ");
}
function updateZoomLabel() {
  const el = document.getElementById("su-tl-label");
  if (!el || !doc || !latestState) return;
  let text = `${timelineCounts()} — ${ZOOM_HINT}`;
  if (view) {
    const full = axisFrames() - 1, fps = latestState.fps || 30;
    const zoom = full / (view.end - view.start);
    text = `showing ${fmtTime(frameToSec(latestState, view.start))}–${fmtTime(frameToSec(latestState, view.end))} of ` +
      `${fmtTime(frameToSec(latestState, full))} · ${zoom >= 10 ? zoom.toFixed(0) : zoom.toFixed(1)}× — ${ZOOM_HINT}`;
  }
  if (text !== lastZoomLabel) { lastZoomLabel = text; el.textContent = text; }
}

function drawAxis(ctx, state, W, y) {
  const { v0, v1 } = viewRange();
  const fps = state.fps || 30, base = Math.floor(startSec(state) * fps);
  const t0 = frameToSec(state, v0), t1 = frameToSec(state, v1);
  const target = Math.max(3, Math.floor((W - LABEL_W - PAD_R) / 80));
  const step = [0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(s => (t1 - t0) / s <= target) || 600;
  ctx.fillStyle = C.muted; ctx.strokeStyle = "#3a3f48"; ctx.lineWidth = 1;
  for (let t = Math.ceil(t0 / step) * step; t <= t1 + 1e-9; t += step) {
    const x = frameToX(t * fps - base - 0.5, W);                 // frameToSec's inverse
    if (x < LABEL_W || x > W - PAD_R) continue;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y); ctx.lineTo(Math.round(x) + 0.5, y + 4); ctx.stroke();
    ctx.fillText(fmtTime(t), x + 3, y + AXIS_H - 3);
  }
}

function drawTimeline(state) {
  const cv = document.getElementById("su-timeline");
  if (!cv) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = cv.getBoundingClientRect();
  const W = Math.max(1, rect.width), H = Math.max(1, rect.height);
  if (cv.width !== Math.round(W * dpr)) cv.width = Math.round(W * dpr);
  if (cv.height !== Math.round(H * dpr)) cv.height = Math.round(H * dpr);
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.font = "10px ui-monospace, monospace";
  if (!doc) {
    ctx.fillStyle = C.muted;
    ctx.fillText(docError ? "skeleton usability: export error (see panel)" : "skeleton usability: no export for this round", LABEL_W, 20);
    return;
  }
  const frame = state.frame, full = axisFrames() - 1;
  if (view && frame !== lastDrawnFrame && (frame < view.start || frame > view.end)) {   // the view follows the playhead
    const span = view.end - view.start;
    const start = Math.max(0, Math.min(full - span, frame - span / 2));
    view = { start, end: start + span };
  }
  lastDrawnFrame = frame;
  updateZoomLabel();
  const trackW = W - LABEL_W - PAD_R;
  const n = nFrames(state), tail = tailFrames(state);
  const roundF = Math.min(n, Math.max(0, secToFrame(state, doc.start_sec)));
  const clipTrack = (y, h, fn) => { ctx.save(); ctx.beginPath(); ctx.rect(LABEL_W, y, trackW, h); ctx.clip(); fn(); ctx.restore(); };
  const rows = {};
  let y = TL_TOP;
  for (const k of LANES) { rows[k] = { y, h: LANE_H }; y += LANE_H + LANE_GAP; }
  const rowsBottom = y - LANE_GAP;
  for (const k of LANES) {
    const r = rows[k];
    ctx.fillStyle = show[k] ? C.muted : "#3a3f48";
    ctx.fillText(KIND[k].short, 4, r.y + 12);
    clipTrack(r.y, r.h, () => {
      const x0 = frameToX(0, W), xr = frameToX(roundF, W), xn = frameToX(n, W);
      ctx.fillStyle = C.preroll; ctx.fillRect(x0, r.y, xr - x0, r.h);                    // the pre-roll, not judged
      ctx.fillStyle = show[k] ? C.round : "#1f242c"; ctx.fillRect(xr, r.y, xn - xr, r.h);  // the round the cache holds
      if (show[k]) {
        ctx.fillStyle = KIND[k].color;
        for (const it of KIND[k].items(doc)) {
          const [a, b] = framesOf(state, it);
          const x1 = frameToX(a, W), x2 = Math.max(x1 + 1.5, frameToX(b + 1, W));
          if (x2 < LABEL_W || x1 > W - PAD_R) continue;
          ctx.fillRect(x1, r.y, x2 - x1, r.h);
        }
      }
      if (tail) {                                                                          // hatched: never decoded
        const xt = frameToX(n + tail, W);
        ctx.fillStyle = "rgba(245,162,60,0.25)"; ctx.fillRect(xn, r.y, xt - xn, r.h);
        ctx.strokeStyle = C.tail; ctx.lineWidth = 1;
        ctx.save(); ctx.beginPath(); ctx.rect(xn, r.y, xt - xn, r.h); ctx.clip();
        ctx.beginPath();
        for (let px = xn - r.h; px < xt; px += 8) { ctx.moveTo(px, r.y + r.h); ctx.lineTo(px + r.h, r.y); }
        ctx.stroke(); ctx.restore();
      }
    });
  }
  if (show.jump) clipTrack(TL_TOP - 2, rowsBottom - TL_TOP + 2, () => {
    ctx.fillStyle = C.jump;
    for (const j of doc.jumps) { const [, b] = framesOf(state, j); ctx.fillRect(frameToX(b, W) - 1, TL_TOP - 2, 2, rowsBottom - TL_TOP + 2); }
  });
  drawAxis(ctx, state, W, rowsBottom + 1);
  selection?.draw(ctx, W, LABEL_W, W - PAD_R, TL_TOP, rowsBottom);
  const cur = currentAt(state);
  const px = frameToX(frame, W);
  if (px >= LABEL_W - 1 && px <= W - PAD_R + 1) {
    ctx.strokeStyle = cur.jump ? C.jump : cur.other ? C.other : cur.frozen ? C.frozen : cur.nosk ? C.miss : C.playhead; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, rowsBottom + 2); ctx.stroke();
  }
}

// ── on-video: a border in the kind's colour and a HUD line per declared (shown) kind ──
function draw(ctx, state) {
  const cur = currentAt(state);
  const lines = [];
  if (cur.jump) lines.push([C.jump, `JUMP · ${cur.jump.it.step.toFixed(2)} torso in ${(cur.jump.it.dt * 1000).toFixed(0)} ms · torso ×${cur.jump.it.torso_ratio.toFixed(2)}`]);
  if (cur.other) lines.push([C.other, `OTHER PERSON · stretch ${cur.other.i + 1}/${doc.other.length} · ${fmtSec(cur.other.it.n / doc.fps)} from ${fmtTime(cur.other.it.s)}`]);
  if (cur.frozen) lines.push([C.frozen, `FROZEN · stretch ${cur.frozen.i + 1}/${doc.frozen.length} · ${fmtSec(cur.frozen.it.n / doc.fps)} · stillest window ${cur.frozen.it.motion.toFixed(3)} torso`]);
  if (cur.nosk) lines.push([C.miss, `NO SKELETON · stretch ${cur.nosk.i + 1}/${doc.stretches.length} · ${cur.nosk.it.n} f (${fmtSec(cur.nosk.it.n / doc.fps)})`]);
  if (!lines.length) return;
  const s = state.renderScale || 1;
  ctx.save();
  ctx.lineWidth = 6 * s; ctx.strokeStyle = lines[0][0];
  ctx.strokeRect(3 * s, 3 * s, ctx.canvas.width - 6 * s, ctx.canvas.height - 6 * s);
  ctx.font = `${13 * s}px monospace`;
  const w = Math.max(...lines.map(l => ctx.measureText(l[1]).width)) + 16 * s;
  ctx.fillStyle = "rgba(0,0,0,0.65)"; ctx.fillRect(8 * s, 8 * s, w, (8 + 18 * lines.length) * s);
  lines.forEach(([color, txt], k) => { ctx.fillStyle = color; ctx.fillText(txt, 16 * s, (25 + 18 * k) * s); });
  ctx.restore();
}

export const SkeletonUsabilityRule = {
  id: LENS_ID,
  label: "Skeleton usability",

  // only rounds where a shown kind declared something are offered; before the index is in: nothing
  // (the load re-filters the dropdowns); if it failed to load: everything
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
    wireControls();
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
    lastFrame = state.frame;
    if (!index) return;
    refreshScope(state);
    renderFrameLine(state);
    drawTimeline(state);
  },

  draw,
};
