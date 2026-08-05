// Bladedness frames — cross-video comparison grid.
//
// The bladedness lens measures ONE round. This one answers a different
// question: with N non-punching frames from every curated video side by side,
// sorted squarest → most side-on, does the model's ordering match what a human
// sees? That can't be done a round at a time.
//
// Frames are pre-extracted (cropped to the boxer, common height) by
// `bladedness/frame_viewer.py` in cornerman-backend. Refresh with:
//   cp ~/code/cornerman-backend/bladedness/frame_viewer_data.json \
//      ~/code/cornerman-debug-viewer/data/bladedness_frames.json
//
// WHY A LENS AND NOT THE STATIC PAGE: the data file ships each frame's RAW
// geometry (gap, ankle dx/dy, torso px) plus every candidate W, so the angles
// are recomputed HERE. Change the W estimator and the whole grid re-sorts live
// — no re-running the extractor. That matters because W is the open problem:
//
//   p99     the shipped estimator — 99th percentile of |gap| over the round
//   p95     less tail-sensitive
//   max     the most optimistic
//   robust  p99 over frames whose TORSO is near its own median, so leaning /
//           crouching frames (where torso collapses and gap spikes without the
//           shoulders widening) can't set it
//   leanfix95  the same lean-corrected gap at the 95th percentile instead of
//           the 99th. Across 25 videos the W spread drops 61% -> 37% of median
//           for 5.1% of frames saturating at 0 deg (vs 1.0%). Pulls the
//           contaminated videos in hard while barely touching the clean ones.
//           Does NOT help the too-small-W cases — a boxer who never squares up
//           is not rescued by a lower percentile.
//   sq3d    W read off frames the 3D calls square + upright, rather than
//           inferred from "the widest we ever saw". Tightens the spread on
//           paper (61% -> 23%) and returns "unknown" for 5 of 25 rounds that
//           contain no such frame — but eyeballing the frames it picks, the
//           3D hip angle is not reliable enough to identify square. Kept as an
//           option, NOT trusted.
//   cohort  ONE W for everybody, the median robust W. W is anatomical
//           (~0.7 shoulder-width / torso) so it should barely vary between
//           people; this is the fairest cross-video comparison and the closest
//           thing to what a calibration pose would give.
//
// On the shipped p99, one video lands at 1.158 (+60% off the cohort) purely
// from lean frames; `robust` brings it to 0.775. Switch between them and watch
// that video's five frames move.

const DATA_URL = "./data/bladedness_frames.json";

const C_OK   = "#7adf7a";
const C_BAD  = "#ff5d6c";
const C_ACC  = "#b48cff";
const C_WARN = "#ff9e64";
const C_3D   = "#5fd1ff";   // the world-landmark hip angle

const cfg = { wMode: "cohort", footK: 1.0, sortBy: "sh", blind: true, overlay: true,
              leanFix: true };

let data = null, dataError = null, dataPromise = null;
let host = null, grid = null;

async function loadData() {
  if (data || dataError) return;
  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    dataError = err.message || String(err);
  }
}
dataPromise = loadData();

const DEG = 180 / Math.PI;

// One W for everybody: the median of the per-video robust estimates.
function cohortW() {
  // Cohort = median of the per-video sq3d estimates where they exist (the most
  // trustworthy source), else robust.
  const per = new Map();
  for (const f of data.frames) if (!per.has(f.stem)) per.set(f.stem, f.w.sq3d ?? f.w.robust);
  const v = [...per.values()].sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : NaN;
}

function wFor(f, cohort) {
  if (cfg.wMode === "cohort") return cohort;
  const v = f.w[cfg.wMode];
  // sq3d is deliberately null when a round contains no square, upright frame —
  // the honest answer where the widest-observed estimators just guessed. Fall
  // back to the cohort constant and let the card say so.
  return (v == null) ? cohort : v;
}
function wIsFallback(f) {
  return cfg.wMode !== "cohort" && f.w[cfg.wMode] == null;
}

function angles(f, cohort) {
  const W = wFor(f, cohort);
  // Hip line, same construction as the shoulders but with its own W. Kept on
  // the leanfix95 estimator regardless of the shoulder W dropdown — the hip W
  // has no cohort/sq3d variants.
  const Wh = f.w?.hip95;
  const hip2d = (f.hgap != null && Wh > 1e-6)
    ? Math.acos(Math.max(0, Math.min(1, f.hgap / Wh))) * DEG : null;
  // gap ships lean-CORRECTED; gap_raw is the uncorrected one, so the fix can be
  // switched off and compared rather than taken on faith.
  const g = cfg.leanFix ? f.gap : (f.gap_raw ?? f.gap);
  const sh = W > 1e-6 ? Math.acos(Math.max(0, Math.min(1, g / W))) * DEG : NaN;
  const ft = (f.adx != null && f.ady != null)
    ? Math.atan2(f.ady * cfg.footK, f.adx) * DEG : null;
  // 3D angles arrive as 0 = depth-aligned (bladed); flip so every metric here
  // shares one direction: 0 = square, 90 = side-on.
  const sh3d = f.sh3d == null ? null : 90 - f.sh3d;
  const hip3d = f.hip3d == null ? null : 90 - f.hip3d;
  return { W, sh, ft, hip2d, sh3d, hip3d };
}

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "—");

// ── lens ────────────────────────────────────────────────────────────────────

export const BladednessFramesRule = {
  id: "bladedness_frames_lens",
  label: "Bladedness frames (all videos)",

  // Renders entirely from its own data file, so it needs no loaded round —
  // the viewer mounts it and reveals the stage on selection alone. Also no
  // requiresVideo: the grid doesn't depend on what (if anything) is loaded.
  standalone: true,

  mount(_host) {
    host = _host;
    host.innerHTML = `<h2>Bladedness frames</h2><p class="hint">Loading…</p>`;
    (dataPromise || loadData()).then(() => { renderShell(); rebuild(); });
  },

  update(state) {
    // Only job here: mark which cards come from the round you have open.
    if (!grid || !state) return;
    const stem = state.cacheBasename || "";
    let n = 0;
    for (const el of grid.querySelectorAll(".bf-card")) {
      const mine = stem && el.dataset.stem === stem;
      el.classList.toggle("mine", !!mine);
      if (mine) n++;
    }
    const el = document.getElementById("bf-loaded");
    if (el) el.textContent = n ? `${n} frames below are from the round you have open` : "";
  },

  draw() { /* nothing on the video canvas — this lens is the grid */ },
};

function renderShell() {
  if (dataError) {
    host.innerHTML = `<h2>Bladedness frames</h2>
      <div style="color:${C_BAD}">bladedness_frames.json failed to load — ${dataError}</div>
      <p class="hint">Generate + copy it:<br>
        <code>python bladedness/frame_viewer.py</code><br>
        <code>cp ~/code/cornerman-backend/bladedness/frame_viewer_data.json
        ~/code/cornerman-debug-viewer/data/bladedness_frames.json</code></p>`;
    return;
  }
  const nVids = new Set(data.frames.map(f => f.stem)).size;
  host.innerHTML = `
    <h2>Bladedness frames</h2>
    <p class="hint">
      ${data.frames.length} non-punching frames from ${nVids} videos, cropped to the
      boxer at a common height, sorted squarest → most side-on. Angles are
      recomputed here from each frame's raw geometry, so changing W re-sorts the
      grid live.
    </p>
    <p class="hint" style="border-left:2px solid ${C_WARN}; padding-left:6px">
      <strong>Judge the order before revealing the numbers.</strong> Seeing the
      angle first tells you what to think.
    </p>

    <p class="hint">Controls are above the grid.</p>`;

  mountGrid();
  renderBar();
}

function renderBar() {
  const bar = document.getElementById("bf-bar");
  if (!bar) return;
  bar.innerHTML = `
    <label>W
      <select id="bf-w">
        <option value="sq3d">sq3d — measured where 3D says square</option>
        <option value="leanfix95">leanfix p95 — safer percentile</option>
        <option value="leanfix">leanfix p99</option>
        <option value="p99">p99 (shipped)</option>
        <option value="p95">p95</option>
        <option value="max">max</option>
        <option value="robust">robust — ignores lean frames</option>
        <option value="cohort">cohort — one W for all</option>
      </select></label>
    <label>sort
      <select id="bf-sort">
        <option value="sh">shoulders 2D (gap/W)</option>
        <option value="hip2d">hips 2D (hip gap/W)</option>
        <option value="sh3d">shoulders 3D</option>
        <option value="ft">feet</option>
        <option value="gap">raw gap</option>
        <option value="tight">tightrope (lead toe → rear heel)</option>
        <option value="hip3d">hips 3D</option>
      </select></label>
    <label>foot k <output id="bf-k-out">${cfg.footK.toFixed(2)}</output>
      <input type="range" id="bf-k" min="0.2" max="4.0" step="0.05"
             value="${cfg.footK}" style="width:110px"></label>
    <label><input type="checkbox" id="bf-ov" ${cfg.overlay ? "checked" : ""}> overlay</label>
    <label><input type="checkbox" id="bf-lean" ${cfg.leanFix ? "checked" : ""}> lean fix</label>
    <button id="bf-blind">${cfg.blind ? "Reveal numbers" : "Hide numbers"}</button>
    <span class="note" id="bf-wnote"></span>
    <span class="note" id="bf-spread"></span>
    <span class="note" id="bf-loaded"></span>`;

  bar.querySelector("#bf-w").value = cfg.wMode;
  bar.querySelector("#bf-sort").value = cfg.sortBy;
  bar.querySelector("#bf-w").addEventListener("change", e => { cfg.wMode = e.target.value; rebuild(); });
  bar.querySelector("#bf-sort").addEventListener("change", e => { cfg.sortBy = e.target.value; rebuild(); });
  bar.querySelector("#bf-k").addEventListener("input", e => {
    cfg.footK = parseFloat(e.target.value);
    bar.querySelector("#bf-k-out").textContent = cfg.footK.toFixed(2);
    rebuild();
  });
  bar.querySelector("#bf-ov").addEventListener("change", e => {
    cfg.overlay = e.target.checked; rebuild();
  });
  bar.querySelector("#bf-lean").addEventListener("change", e => {
    cfg.leanFix = e.target.checked; rebuild();
  });
  bar.querySelector("#bf-blind").addEventListener("click", e => {
    cfg.blind = !cfg.blind;
    e.target.textContent = cfg.blind ? "Reveal numbers" : "Hide numbers";
    grid?.classList.toggle("blind", cfg.blind);
  });
}

function mountGrid() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";

  // This lens IS the view — the video player and the side panel are noise when
  // you're comparing 65 stills. The hiding CSS lives INSIDE #stage-extras on
  // purpose: the viewer clears that slot on every lens switch, so everything
  // comes back by itself without needing an unmount hook the contract doesn't
  // have.
  const takeover = document.createElement("style");
  takeover.textContent = `
    /* Everything in the stage except our own slot. Hiding the <video> alone
       left .video-wrap holding its space, and enumerating each element misses
       whatever gets added later — so hide the lot and keep only #stage-extras. */
    #stage > *:not(#stage-extras) { display:none !important; }
    #side { display:none !important; }
    .layout { display:block !important; }
    #stage { width:100% !important; max-width:none !important;
             padding:0 !important; background:none !important; }
    #stage-extras { margin-top:0 !important; }
  `;
  slot.appendChild(takeover);
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:12px;padding:10px 12px;background:var(--bg-card);" +
                       "border:1px solid var(--border);border-radius:8px";
  const style = document.createElement("style");
  style.textContent = `
    #bf-grid { display:grid; gap:14px;
               grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); }
    #bf-grid .bf-card { background:#171a22; border:1px solid #262b36; border-radius:6px;
                        overflow:hidden; width:max-content; }
    #bf-grid .bf-card.wbad { border-color:${C_BAD}; }
    #bf-grid .bf-card.mine { outline:2px solid ${C_ACC}; }
    #bf-grid .bf-card { display:flex; flex-direction:column; }
    #bf-grid .bf-card img { display:block; height:360px; }
    #bf-grid .bf-wrap { align-self:center; }
    #bf-grid figcaption { padding:6px 8px; font-family:ui-monospace,monospace; }
    #bf-grid .rank { color:${C_ACC}; font-weight:700; font-size:13px;
                     margin-bottom:3px; }
    #bf-grid .dim { color:#79808f; font-size:11px; }
    #bf-grid table.m { width:100%; border-collapse:collapse; font-size:14px; }
    #bf-grid table.m td { padding:1px 0; }
    #bf-grid table.m td.k { color:#8b93a3; width:52px; }
    #bf-grid table.m td.v { text-align:right; font-weight:700; }
    #bf-grid table.m tr.on td { background:#232a3a; }
    #bf-grid table.m tr.on td.k { color:${C_ACC}; }
    #bf-grid.blind .hideable { visibility:hidden; }
    #bf-bar { display:flex; flex-wrap:wrap; gap:10px; align-items:center;
              margin-bottom:10px; font-size:12px; }
    #bf-bar label { display:flex; gap:5px; align-items:center; }
    #bf-bar select, #bf-bar button { background:#232836; color:#e7e9ee;
              border:1px solid #39405180; border-radius:5px; padding:4px 8px;
              font:inherit; cursor:pointer; }
    #bf-bar .note { color:#79808f; }
    #bf-grid .bf-wrap { position:relative; }
    #bf-grid .bf-wrap canvas { position:absolute; inset:0; pointer-events:none; }
    #bf-wref { margin-bottom:18px; }
    #bf-wref .row { display:grid; gap:14px;
                    grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); }
    #bf-wref h4 { margin:0 0 8px; font-size:13px; font-weight:600; }
    #bf-wref .wr { background:#171a22; border:1px solid #262b36; border-radius:6px;
                   overflow:hidden; display:flex; flex-direction:column; }
    #bf-wref .wr.lean { border-color:${C_BAD}; }
    #bf-wref .bf-wrap { position:relative; align-self:center; }
    #bf-wref .bf-wrap canvas { position:absolute; inset:0; pointer-events:none; }
    #bf-wref img { display:block; height:300px; }
    #bf-wref figcaption { padding:6px 8px; font-family:ui-monospace,monospace; }
    #bf-wref table.m { width:100%; border-collapse:collapse; font-size:14px; }
    #bf-wref table.m td { padding:1px 0; }
    #bf-wref table.m td.k { color:#8b93a3; width:48px; }
    #bf-wref table.m td.v { text-align:right; font-weight:700; }
    #bf-wref .dim { color:#79808f; font-size:11px; }
  `;
  wrap.appendChild(style);
  const bar = document.createElement("div");
  bar.id = "bf-bar";
  wrap.appendChild(bar);

  const wref = document.createElement("div");
  wref.id = "bf-wref";
  wrap.appendChild(wref);
  grid = document.createElement("div");
  grid.id = "bf-grid";
  grid.className = cfg.blind ? "blind" : "";
  wrap.appendChild(grid);
  slot.appendChild(wrap);
}

function rebuild() {
  if (!grid || !data) return;
  const cohort = cohortW();
  const rows = data.frames.map(f => {
    const a = angles(f, cohort);
    // Sort key. Every mode is ordered "most square first" so the grid always
    // reads left-to-right squarest -> most side-on, whichever signal you pick:
    //   sh     0 = square              -> ascending
    //   gap    high = square           -> negated
    //   ft     high = bladed           -> ascending
    //   tight  0 = rear foot stacked   -> negated (wide = square first)
    //   hip3d  0 = depth-aligned       -> negated (90 = square first)
    const g = cfg.leanFix ? f.gap : (f.gap_raw ?? f.gap);
    const key = cfg.sortBy === "ft"    ? (a.ft ?? 1e9)
              : cfg.sortBy === "gap"   ? -g
              : cfg.sortBy === "tight" ? -(f.tight ?? -1)
              : cfg.sortBy === "hip3d" ? (a.hip3d ?? 1e9)
              : cfg.sortBy === "sh3d"  ? (a.sh3d ?? 1e9)
              : cfg.sortBy === "hip2d" ? (a.hip2d ?? 1e9)
              : a.sh;
    return { f, ...a, key };
  });
  rows.sort((x, y) => x.key - y.key);

  // A W far off the cohort isn't a wider boxer, it's a contaminated estimate.
  const perVid = new Map();
  for (const r of rows) if (!perVid.has(r.f.stem)) perVid.set(r.f.stem, r.W);
  const ws = [...perVid.values()].sort((a, b) => a - b);
  const medW = ws.length ? ws[ws.length >> 1] : NaN;

  const THUMB = 360;
  // Metric rows, in a fixed order so the eye can scan down the same place on
  // every card. The one you're sorting by is highlighted.
  const ROWS = [
    ["sh2D",  "sh",    r => fmt(r.sh) + "°"],
    ["hip2D", "hip2d", r => (r.hip2d == null ? "—" : fmt(r.hip2d) + "°")],
    ["sh3D",  "sh3d",  r => (r.sh3d  == null ? "—" : fmt(r.sh3d, 0) + "°")],
    ["hip3D", "hip3d", r => (r.hip3d == null ? "—" : fmt(r.hip3d, 0) + "°")],
    ["feet",  "ft",    r => (r.ft    == null ? "—" : fmt(r.ft) + "°")],
    ["tight", "tight", r => (r.f.tight == null ? "—" : r.f.tight.toFixed(2))],
  ];

  grid.innerHTML = rows.map((r, i) => {
    const off = (r.W - medW) / medW * 100;
    const bad = Math.abs(off) > 20;
    const cw = Math.round(THUMB * (r.f.aspect || 0.75));
    const body = ROWS.map(([label, mode, get]) =>
      `<tr class="${cfg.sortBy === mode ? "on" : ""}">
         <td class="k">${label}</td><td class="v">${get(r)}</td></tr>`).join("");
    return `<figure class="bf-card${bad ? " wbad" : ""}" data-stem="${r.f.stem.replace(/"/g, "&quot;")}">
      <div class="bf-wrap" style="width:${cw}px;height:${THUMB}px">
        <img src="data:image/jpeg;base64,${r.f.img}" alt="" title="${r.f.stem.replace(/"/g, "&quot;")}">
        <canvas width="${cw}" height="${THUMB}" data-i="${i}"></canvas>
      </div>
      <figcaption>
        <div class="rank">#${i + 1}</div>
        <table class="m hideable">${body}</table>
        <div class="hideable dim" style="margin-top:4px">gap ${
          (cfg.leanFix ? r.f.gap : (r.f.gap_raw ?? r.f.gap)).toFixed(3)}${
          r.f.leaned ? ` <span style="color:${C_WARN}">lean</span>` : ""} / W ${r.W.toFixed(3)}${
          bad ? ` <span style="color:${C_BAD}">${off > 0 ? "+" : ""}${off.toFixed(0)}%</span>` : ""}${
          wIsFallback(r.f) ? ` <span style="color:${C_WARN}">W→cohort</span>` : ""}</div>
        <div class="hideable dim">${r.f.stem.slice(0, 30)}<br>r${r.f.round} · ${r.f.t}s</div>
      </figcaption>
    </figure>`;
  }).join("");

  // Draw what the model sees: the skeleton, the shoulder segment the gap is
  // measured on, the full-width W ghost it's compared against, and the ankle
  // vector with its dx/dy legs. Seeing the ghost next to the real shoulder line
  // IS the metric — the ratio between them is the whole angle.
  grid.querySelectorAll("canvas").forEach(cv => {
    const r = rows[+cv.dataset.i];
    drawOverlay(cv, r);
  });

  renderWRefs();

  const shs = rows.map(r => r.sh).filter(Number.isFinite);
  const nBad = [...perVid.entries()].filter(([, w]) => Math.abs((w - medW) / medW) > 0.2).length;
  const note = document.getElementById("bf-wnote");
  if (note) note.textContent = cfg.wMode === "cohort"
    ? `one W = ${fmt(medW, 3)} for all videos`
    : `${nBad} video(s) more than 20% off the median W ${fmt(medW, 3)}`;
  const spread = document.getElementById("bf-spread");
  if (spread && shs.length) spread.textContent =
    `range ${fmt(Math.min(...shs))}° – ${fmt(Math.max(...shs))}°`;
}


// COCO-17 bones, plus the joints each measurement uses.
const EDGES = [[5,7],[7,9],[6,8],[8,10],[5,6],[5,11],[6,12],[11,12],
               [11,13],[13,15],[12,14],[14,16],[0,5],[0,6]];
const L_SH = 5, R_SH = 6, L_HIP = 11, R_HIP = 12, L_ANK = 15, R_ANK = 16;

function drawOverlay(cv, r) {
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!cfg.overlay) return;
  const J = r.f.joints;
  if (!J) return;
  const P = j => {
    const p = J[j];
    return p ? [p[0] * cv.width, p[1] * cv.height, p[2]] : null;
  };

  // skeleton, dim so the measurement lines read on top of it
  ctx.strokeStyle = "rgba(255,255,255,0.30)";
  ctx.lineWidth = 1.2;
  for (const [a, b] of EDGES) {
    const p = P(a), q = P(b);
    if (!p || !q || p[2] < 0.3 || q[2] < 0.3) continue;
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  for (let j = 0; j < 17; j++) {
    const p = P(j);
    if (!p || p[2] < 0.3) continue;
    ctx.beginPath(); ctx.arc(p[0], p[1], 1.8, 0, Math.PI * 2); ctx.fill();
  }

  // shoulder segment = the numerator of gap
  const ls = P(L_SH), rs = P(R_SH);
  if (ls && rs) {
    ctx.strokeStyle = "#7ec8ff"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(ls[0], ls[1]); ctx.lineTo(rs[0], rs[1]); ctx.stroke();

    // W ghost: the same shoulder line at full anatomical width, centred on the
    // real one. Real ÷ ghost = gap / W = cos(bladedness).
    const lh = P(L_HIP), rh = P(R_HIP);
    if (lh && rh && r.W > 1e-6) {
      const smx = (ls[0] + rs[0]) / 2, smy = (ls[1] + rs[1]) / 2;
      const hmx = (lh[0] + rh[0]) / 2, hmy = (lh[1] + rh[1]) / 2;
      const torso = Math.hypot(smx - hmx, smy - hmy);
      const half = (r.W * torso) / 2;
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(smx - half, smy); ctx.lineTo(smx + half, smy); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Tightrope: a vertical line dropped through the LEAD TOE, and the shortest
  // (i.e. horizontal) distance from it to the REAR HEEL. Squared feet sit side
  // by side and this is wide; a bladed stance stacks the rear foot behind the
  // lead one and it collapses toward zero. Needs no camera constant.
  const FT = r.f.feet;   // [L_heel, R_heel, L_toe, R_toe] in crop coords
  if (FT && r.f.tight != null && r.f.lead) {
    const leadL = r.f.lead === "L";
    const toe = FT[leadL ? 2 : 3], heel = FT[leadL ? 1 : 0];
    if (toe && heel) {
      const tx = toe[0] * cv.width, hx = heel[0] * cv.width, hy = heel[1] * cv.height;
      ctx.strokeStyle = "#ff9e64"; ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(tx, 0); ctx.lineTo(tx, cv.height); ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(tx, hy); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = "#ff9e64";
      for (const [px, py] of [[toe[0] * cv.width, toe[1] * cv.height], [hx, hy]]) {
        ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // ankle vector + its dx / dy legs, the two terms of atan2
  const la = P(L_ANK), ra = P(R_ANK);
  if (la && ra) {
    ctx.strokeStyle = "#ffd95c"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(la[0], la[1]); ctx.lineTo(ra[0], ra[1]); ctx.stroke();
    ctx.strokeStyle = "rgba(255,217,92,0.45)"; ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(la[0], la[1]); ctx.lineTo(ra[0], la[1]);   // dx leg
    ctx.lineTo(ra[0], ra[1]);                              // dy leg
    ctx.stroke();
    ctx.setLineDash([]);
  }
}


// The frames that DEFINE W, one per video, for whichever estimator is selected.
// W is essentially "the widest shoulder line we saw in this round", so a single
// bad pose sets it — and every angle for that video is then measured against a
// wrong reference. This strip makes that inspectable instead of assumed.
//
// The tell is the TORSO. gap = shoulder_width / torso_height, so a frame where
// the boxer leans (torso foreshortens) inflates gap without the shoulders
// actually being wider. Frames whose torso is well under that round's median
// are flagged: they are the ones that corrupt W.
function renderWRefs() {
  const box = document.getElementById("bf-wref");
  if (!box) return;
  const refs = data.w_refs || [];
  if (!refs.length) { box.innerHTML = ""; return; }

  // cohort has no defining frame of its own — it's the median of the per-video
  // robust estimates — so show the robust frames and say so.
  const mode = cfg.wMode === "cohort" ? "robust" : cfg.wMode;
  const mine = refs.filter(r => r.mode === mode)
                   .sort((a, b) => b.W - a.W);
  if (!mine.length) { box.innerHTML = ""; return; }

  box.innerHTML = `
    <h4>Frames that set W — <code>${cfg.wMode}</code>${
      cfg.wMode === "cohort" ? ` <span class="dim">(cohort has no single frame; showing the robust ones it's a median of)</span>` : ""}
      <span class="dim">— red = torso well below this round's median, so gap is inflated by a lean, not by wider shoulders</span>
    </h4>
    <div class="row">${mine.map((r, i) => {
      const ratio = r.torso_median_px ? r.torso_px / r.torso_median_px : 1;
      const lean = ratio < 0.88;
      const cw = Math.round(300 * (r.aspect || 0.75));
      return `<figure class="wr${lean ? " lean" : ""}">
        <div class="bf-wrap" style="width:${cw}px;height:300px">
          <img src="data:image/jpeg;base64,${r.img}" alt="" title="${r.stem.replace(/"/g, "&quot;")}">
          <canvas width="${cw}" height="300" data-wi="${i}"></canvas>
        </div>
        <figcaption>
          <table class="m">
            <tr><td class="k">W</td><td class="v">${r.W.toFixed(3)}</td></tr>
            <tr><td class="k">gap</td><td class="v">${r.gap.toFixed(3)}</td></tr>
            <tr><td class="k">torso</td><td class="v"${lean ? ` style="color:${C_BAD}"` : ""}>${
              (ratio * 100).toFixed(0)}%</td></tr>
          </table>
          <div class="dim" style="margin-top:4px">${r.stem.slice(0, 30)}<br>r${r.round} · ${r.t}s</div>
        </figcaption>
      </figure>`;
    }).join("")}</div>`;

  box.querySelectorAll("canvas").forEach(cv => {
    const r = mine[+cv.dataset.wi];
    // At a W-defining frame gap ≈ W, so the blue shoulder line should sit right
    // on the dashed ghost. If it doesn't, the estimate is off.
    drawOverlay(cv, { f: r, W: r.W });
  });
}
