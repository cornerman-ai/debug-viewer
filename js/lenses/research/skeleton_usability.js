// Skeleton usability — what the skeleton-usability detectors declared unusable in this round.
//
// Three declared kinds so far (cornerman-backend ml/research/skeleton_usability/README.md):
//   no skeleton   frames INSIDE the round (round_start … round_end; the extractor's 1.5 s pre-roll
//                 is not judged) where BlazePose returned no pose at all — every landmark NaN —
//                 as stretches; plus the tail of a round the cache never reached (decoder stopped)
//   jump          between consecutive DETECTED frames the core (shoulders + hips centre) moved more
//                 than a torso within 0.25 s — the tracker landed on someone else
//   other person  jumps cut the round into segments; the segment with the most frames seeds the
//                 boxer, segments near it in position and torso size join, the rest are another
//                 person (the home position / torso the decision was made against is shown)
// Nothing learned yet: the labelers' unusable_start / unusable_end markers are the target of the
// model this line is heading for.
//
// Data: lens_data/skeleton_usability/ (index.json + one JSON per round), written by
//   cd ~/code/cornerman-backend && .venv/bin/python ml/research/skeleton_usability/lens_export.py
// (jumps.py's thresholds can be passed through; the index records them under detectors.jumps).
//
// Schema:
//   index.json   { generated, source, detectors: { no_skeleton, jumps: { jump_torso, max_dt_s, pos_tol, scale } },
//                  shelf, n_rounds,
//                  totals: { n_in_round, n_no_skeleton, n_stretches, n_rounds_touched, n_jumps, n_rounds_with_jumps,
//                            n_other, n_rounds_with_other, declared_sec },
//                  videos: { <stem>: { <ri>: { file, n_no_skeleton, n_stretches, no_skeleton_sec, uncovered_tail_sec,
//                                              n_jumps, other_sec, declared_sec } } } }
//   <hash>.json  { round_id, stem, ri, start_sec, end_sec, fps, n_frames, n_in_round, torso,
//                  n_no_skeleton, no_skeleton_sec, stretches: [{ s, e, n, f0, f1 }], uncovered_tail_sec,
//                  jumps: [{ s, e, f0, f1, gap, dt, step, torso_ratio }],     from frame f0 (time s) to the landing frame f1 (time e)
//                  other: [{ s, e, n, f0, f1, cx, cy, torso }], home: { cx, cy, torso } | null, n_other, other_sec,
//                  declared_sec, declared_frac }                              the union of the three, plus the tail
// s / e are source-video seconds of a stretch's FIRST and LAST frame, f0 / f1 those frames' indices in
// the cache (pre-roll included). A stretch is placed by its cache frames when the loaded cache is that
// file (same frame count) and through the viewer's clock (secToFrame, the impact spotter lens's
// convention) otherwise.
//
// The video and round dropdowns offer only rounds where something was declared; everything if the
// index failed to load.

const DATA_DIR = "./lens_data/skeleton_usability/";
const LENS_ID = "skeleton_usability";
const EARLY_END_SEC = 0.5;    // an uncovered tail above this = the cache stops before the round does (no_skeleton.EARLY_END_SEC)
const EXPORT_CMD = "cd ~/code/cornerman-backend && .venv/bin/python ml/research/skeleton_usability/lens_export.py";
const C = {
  miss: "#ff5d6c",       // no skeleton
  jump: "#ffd166",       // a jump
  other: "#b48cff",      // another person
  tail: "#f5a23c",       // the cache never reached this part of the round
  ok: "#7adf7a",
  playhead: "#3ad9e0",
  round: "#2a3340",
  preroll: "#14171c",
  bg: "#181818",
  text: "#aaa",
  muted: "#666",
};
const KIND = {
  nosk:  { label: "no skel",  color: C.miss },
  jump:  { label: "jump",     color: C.jump },
  other: { label: "other",    color: C.other },
};

let host = null, latestState = null;
let index = null, indexError = null, indexLoading = null;
let doc = null, docKey = null, docError = null;
let show = { nosk: true, jump: true, other: true };   // the list's kind filter

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
function declared(e) {
  return !!e && ((e.declared_sec || 0) > 0 || e.n_stretches > 0 || e.n_jumps > 0 || e.other_sec > 0 || e.uncovered_tail_sec > EARLY_END_SEC);
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
    d.jumps = d.jumps || []; d.other = d.other || []; d.stretches = d.stretches || [];
    doc = d;
  } catch (e) { if (docKey === key) docError = String(e); }
  if (docKey !== key) return;
  renderAll();
}

// what is declared under the playhead: one entry per kind, or null
function currentAt(state) {
  const f = state.frame, cur = { nosk: null, jump: null, other: null };
  if (!doc) return cur;
  const find = (items) => {
    for (let i = 0; i < items.length; i++) {
      const [a, b] = framesOf(state, items[i]);
      if (f >= a && f <= b) return { i, it: items[i], a, b };
    }
    return null;
  };
  cur.nosk = find(doc.stretches); cur.jump = find(doc.jumps); cur.other = find(doc.other);
  return cur;
}
function tailFrames(state) {
  return doc && doc.uncovered_tail_sec > EARLY_END_SEC ? Math.round(doc.uncovered_tail_sec * (state.fps || 30)) : 0;
}
function tailSec() { return doc && doc.uncovered_tail_sec > EARLY_END_SEC ? doc.uncovered_tail_sec : 0; }

// ── side panel ───────────────────────────────────────────────────────────────
function template() {
  const cb = (k) => `<label style="margin-right:10px;cursor:pointer;color:${KIND[k].color}">
      <input type="checkbox" data-kind="${k}" ${show[k] ? "checked" : ""}> ${KIND[k].label}</label>`;
  return `
    <h2>Skeleton usability</h2>
    <p class="hint">What the skeleton-usability detectors declared unusable in this round:
      <b style="color:${C.miss}">no skeleton</b> (BlazePose returned no pose at all),
      <b style="color:${C.jump}">jumps</b> (the core moved more than a torso within 0.25 s between
      consecutive detected frames — the tracker landed on someone else) and
      <b style="color:${C.other}">other person</b> (the segments between jumps that are not the boxer
      by position and torso size), plus the tail of a round the cache never reached. The pre-roll
      before round_start is not judged. The dropdowns list only rounds with something declared.</p>
    <div id="su-scope" class="muted small" style="margin-bottom:6px"></div>
    <div id="su-stats" style="font-size:13px;line-height:1.6;margin-bottom:8px"></div>
    <div id="su-frame" style="font-size:13px;margin-bottom:8px;min-height:18px"></div>
    <div id="su-list-head" class="muted small" style="margin-bottom:4px"></div>
    <div style="font-size:12px;margin-bottom:4px">${cb("nosk")}${cb("jump")}${cb("other")}</div>
    <div id="su-list" style="max-height:280px;overflow-y:auto;font-size:12px"></div>
    <div id="su-shelf" class="muted small" style="margin-top:10px"></div>`;
}

function wireControls() {
  host.querySelectorAll("input[data-kind]").forEach(cb => cb.addEventListener("change", () => {
    show[cb.dataset.kind] = cb.checked;
    renderList();
  }));
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
  if (!index) { el.textContent = "loading the detectors' index…"; return; }
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
  const tail = tailSec();
  const declaredSec = doc.declared_sec != null ? doc.declared_sec : doc.no_skeleton_sec + (doc.other_sec || 0) + tail;
  const longest = doc.stretches.reduce((m, s) => Math.max(m, s.n), 0) / doc.fps;
  const pct = (n) => doc.n_in_round ? (100 * n / doc.n_in_round).toFixed(1) : "—";
  const acrossGap = doc.jumps.filter(j => j.gap > 1).length;
  const verdictColor = declaredSec === 0 ? C.ok : C.miss;
  const thr = index?.detectors?.jumps;
  el.innerHTML =
    `<div>in round: <b>${fmtN(doc.n_in_round)}</b> frames (${fmtSec(dur)})` + (doc.torso ? ` · torso ${doc.torso.toFixed(3)}` : "") + `</div>` +
    `<div><span style="color:${C.miss}">no skeleton</span>: <b>${fmtN(doc.n_no_skeleton)}</b> frames = ${pct(doc.n_no_skeleton)} % ` +
      `(${fmtSec(doc.no_skeleton_sec)}) in <b>${doc.stretches.length}</b> stretch${doc.stretches.length === 1 ? "" : "es"}` +
      (doc.stretches.length ? ` · longest ${fmtSec(longest)}` : "") + `</div>` +
    `<div><span style="color:${C.jump}">jumps</span>: <b>${doc.jumps.length}</b>` +
      (doc.jumps.length ? ` (${acrossGap} across a no-skeleton gap` + (thr ? `; > ${thr.jump_torso} torso within ${thr.max_dt_s} s` : "") + `)` : "") + `</div>` +
    `<div><span style="color:${C.other}">other person</span>: <b>${fmtN(doc.n_other || 0)}</b> frames = ${pct(doc.n_other || 0)} % ` +
      `(${fmtSec(doc.other_sec || 0)}) in <b>${doc.other.length}</b> stretch${doc.other.length === 1 ? "" : "es"}` +
      (doc.home ? ` · the boxer at (${doc.home.cx.toFixed(2)}, ${doc.home.cy.toFixed(2)}), torso ${doc.home.torso.toFixed(3)}` +
        (thr ? ` <span class="muted">(within ${thr.pos_tol} torso, ratio ${thr.scale[0]}–${thr.scale[1]})</span>` : "") : "") + `</div>` +
    (tail ? `<div style="color:${C.tail}">cache stops <b>${fmtSec(tail)}</b> before round_end — those frames were never decoded</div>` : "") +
    `<div style="margin-top:4px;padding:4px 8px;border-left:3px solid ${verdictColor}">declared unusable (the union): ` +
      `<b style="color:${verdictColor}">${fmtSec(declaredSec)}</b> of ${fmtSec(dur)} (${(dur ? 100 * declaredSec / dur : 0).toFixed(1)} %)</div>`;
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

// every declared item as one time-ordered list, filtered by kind
function listItems() {
  const out = [];
  doc.stretches.forEach((s, i) => out.push({ kind: "nosk", i, it: s, t: s.s, len: s.n / doc.fps, txt: `${s.n} f · f${s.f0}–f${s.f1}` }));
  doc.jumps.forEach((j, i) => out.push({ kind: "jump", i, it: j, t: j.e, len: j.dt,
    txt: `${j.step.toFixed(1)} torso · ×${j.torso_ratio.toFixed(2)} · f${j.f0} → f${j.f1}` }));
  doc.other.forEach((o, i) => out.push({ kind: "other", i, it: o, t: o.s, len: o.n / doc.fps,
    txt: `${o.n} f · at (${o.cx.toFixed(2)}, ${o.cy.toFixed(2)}) torso ${o.torso.toFixed(3)}` }));
  return out.filter(x => show[x.kind]).sort((a, b) => a.t - b.t);
}

function renderList() {
  const head = host.querySelector("#su-list-head"), el = host.querySelector("#su-list");
  if (!head || !el) return;
  if (!doc) { head.textContent = ""; el.innerHTML = ""; return; }
  const items = listItems();
  const total = doc.stretches.length + doc.jumps.length + doc.other.length;
  head.textContent = total ? `${items.length} of ${total} declared, in time — click to jump (kind · start · length)` : "nothing declared in this round";
  el.innerHTML = items.map((x, k) =>
    `<div data-k="${k}" style="display:flex;gap:8px;padding:2px 6px;cursor:pointer;border-left:3px solid ${KIND[x.kind].color}">
      <span style="width:50px;color:${KIND[x.kind].color}">${KIND[x.kind].label}</span>
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
  const pct = (n) => T.n_in_round ? (100 * n / T.n_in_round).toFixed(2) : "—";
  el.innerHTML = `shelf: ${fmtN(index.n_rounds)} rounds · no skeleton ${pct(T.n_no_skeleton)} % of in-round frames (${fmtN(T.n_rounds_touched)} rounds) · ` +
    `${fmtN(T.n_jumps || 0)} jumps (${fmtN(T.n_rounds_with_jumps || 0)} rounds) · other person ${pct(T.n_other || 0)} % (${fmtN(T.n_rounds_with_other || 0)} rounds) · ` +
    `exported ${esc(String(index.generated || "").slice(0, 10))}`;
}

// ── stage timeline: two lanes over the round in viewer frames — no skeleton (red) above, other person
// (purple) below, jumps as yellow ticks through both, the never-decoded tail hatched orange ──
function mountStageTimeline() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:6px";
  const cv = document.createElement("canvas");
  cv.id = "su-timeline";
  cv.style.cssText = "display:block;width:100%;height:64px;cursor:pointer";
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
  const y0 = 14 * dpr, laneH = (H - y0 - 4 * dpr) / 2, gap = 1 * dpr;
  const roundF = Math.min(n, Math.max(0, secToFrame(state, doc.start_sec)));
  for (const y of [y0, y0 + laneH]) {                                       // both lanes: pre-roll dark, round grey
    ctx.fillStyle = C.preroll; ctx.fillRect(0, y, x(roundF), laneH - gap);
    ctx.fillStyle = C.round; ctx.fillRect(x(roundF), y, x(n) - x(roundF), laneH - gap);
  }
  ctx.fillStyle = C.miss;
  for (const st of doc.stretches) { const [a, b] = framesOf(state, st); ctx.fillRect(x(a), y0, Math.max(1.5 * dpr, x(b + 1) - x(a)), laneH - gap); }
  ctx.fillStyle = C.other;
  for (const o of doc.other) { const [a, b] = framesOf(state, o); ctx.fillRect(x(a), y0 + laneH, Math.max(1.5 * dpr, x(b + 1) - x(a)), laneH - gap); }
  ctx.fillStyle = C.jump;
  for (const j of doc.jumps) { const [, b] = framesOf(state, j); ctx.fillRect(x(b) - 1 * dpr, y0 - 3 * dpr, 2 * dpr, 2 * laneH + 3 * dpr); }
  if (tail) {                                                                  // hatched: never decoded
    ctx.save();
    ctx.fillStyle = "rgba(245,162,60,0.25)"; ctx.fillRect(x(n), y0, W - x(n), 2 * laneH - gap);
    ctx.strokeStyle = C.tail; ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    const h2 = 2 * laneH;
    for (let px = x(n) - h2; px < W; px += 8 * dpr) { ctx.moveTo(px, y0 + h2); ctx.lineTo(px + h2, y0); }
    ctx.clip(); ctx.stroke(); ctx.restore();
    ctx.fillStyle = C.tail;
    ctx.fillText(`cache ends · round continues ${fmtSec(doc.uncovered_tail_sec)}`, x(n) + 4 * dpr, 10 * dpr);
  }
  ctx.fillStyle = C.text;
  ctx.fillText(`no skeleton ${fmtSec(doc.no_skeleton_sec)} (${doc.stretches.length}) · ${doc.jumps.length} jumps · ` +
    `other person ${fmtSec(doc.other_sec || 0)} (${doc.other.length}) · declared ${fmtSec(doc.declared_sec || 0)}`, 4 * dpr, 10 * dpr);
  const cur = currentAt(state);
  ctx.strokeStyle = cur.jump ? C.jump : cur.other ? C.other : cur.nosk ? C.miss : C.playhead; ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.moveTo(x(state.frame), 0); ctx.lineTo(x(state.frame), H); ctx.stroke();
}

// ── on-video: a border in the kind's colour and a HUD line per declared kind ──
function draw(ctx, state) {
  const cur = currentAt(state);
  if (!cur.nosk && !cur.jump && !cur.other) return;
  const s = state.renderScale || 1;
  const lines = [];
  if (cur.jump) lines.push([C.jump, `JUMP · ${cur.jump.it.step.toFixed(2)} torso in ${(cur.jump.it.dt * 1000).toFixed(0)} ms · torso ×${cur.jump.it.torso_ratio.toFixed(2)}`]);
  if (cur.other) lines.push([C.other, `OTHER PERSON · stretch ${cur.other.i + 1}/${doc.other.length} · ${fmtSec(cur.other.it.n / doc.fps)} from ${fmtTime(cur.other.it.s)}`]);
  if (cur.nosk) lines.push([C.miss, `NO SKELETON · stretch ${cur.nosk.i + 1}/${doc.stretches.length} · ${cur.nosk.it.n} f (${fmtSec(cur.nosk.it.n / doc.fps)})`]);
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
    if (!index) return;
    refreshScope(state);
    renderFrameLine(state);
    drawTimeline(state);
  },

  draw,
};
