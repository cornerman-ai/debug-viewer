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

const cfg = { wMode: "p99", footK: 1.0, sortBy: "sh", blind: true };

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
  const per = new Map();
  for (const f of data.frames) if (!per.has(f.stem)) per.set(f.stem, f.w.robust);
  const v = [...per.values()].sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : NaN;
}

function wFor(f, cohort) {
  return cfg.wMode === "cohort" ? cohort : f.w[cfg.wMode];
}

function angles(f, cohort) {
  const W = wFor(f, cohort);
  const sh = W > 1e-6 ? Math.acos(Math.max(0, Math.min(1, f.gap / W))) * DEG : NaN;
  const ft = (f.adx != null && f.ady != null)
    ? Math.atan2(f.ady * cfg.footK, f.adx) * DEG : null;
  return { W, sh, ft };
}

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "—");

// ── lens ────────────────────────────────────────────────────────────────────

export const BladednessFramesRule = {
  id: "bladedness_frames_lens",
  label: "Bladedness frames (all videos)",

  // Deliberately NO requiresVideo: this grid doesn't depend on what's loaded.
  // Restricting the dropdown would add friction for no benefit — you just need
  // something loaded for the viewer to mount a lens at all.

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
    const el = host?.querySelector("#bf-loaded");
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

    <label style="display:block; font-size:12px; margin-top:8px">W estimator
      <select id="bf-w" style="width:100%">
        <option value="p99">p99 — the shipped one</option>
        <option value="p95">p95 — less tail-sensitive</option>
        <option value="max">max — most optimistic</option>
        <option value="robust">robust — ignores lean frames</option>
        <option value="cohort">cohort — one W for everybody</option>
      </select></label>
    <div class="muted small" id="bf-wnote" style="margin-top:3px"></div>

    <label class="slider-row" style="display:block; font-size:12px; margin-top:6px">
      foot depth scale k = <output id="bf-k-out">1.00</output>
      <input type="range" id="bf-k" min="0.2" max="4.0" step="0.05" value="1.0"></label>

    <label style="display:block; font-size:12px; margin-top:4px">sort by
      <select id="bf-sort" style="width:100%">
        <option value="sh">shoulders</option>
        <option value="ft">feet</option>
        <option value="gap">raw gap (uncalibrated)</option>
      </select></label>

    <button id="bf-blind" style="margin-top:8px; width:100%">Reveal numbers</button>
    <div class="muted small" id="bf-loaded" style="margin-top:6px"></div>
    <div class="muted small" id="bf-spread" style="margin-top:6px"></div>`;

  host.querySelector("#bf-w").value = cfg.wMode;
  host.querySelector("#bf-sort").value = cfg.sortBy;
  host.querySelector("#bf-w").addEventListener("change", e => { cfg.wMode = e.target.value; rebuild(); });
  host.querySelector("#bf-sort").addEventListener("change", e => { cfg.sortBy = e.target.value; rebuild(); });
  host.querySelector("#bf-k").addEventListener("input", e => {
    cfg.footK = parseFloat(e.target.value);
    host.querySelector("#bf-k-out").textContent = cfg.footK.toFixed(2);
    rebuild();
  });
  host.querySelector("#bf-blind").addEventListener("click", e => {
    cfg.blind = !cfg.blind;
    e.target.textContent = cfg.blind ? "Reveal numbers" : "Hide numbers";
    grid?.classList.toggle("blind", cfg.blind);
  });
  mountGrid();
}

function mountGrid() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:12px;padding:10px 12px;background:var(--bg-card);" +
                       "border:1px solid var(--border);border-radius:8px";
  const style = document.createElement("style");
  style.textContent = `
    #bf-grid { display:flex; flex-wrap:wrap; gap:10px; }
    #bf-grid .bf-card { background:#171a22; border:1px solid #262b36; border-radius:6px;
                        overflow:hidden; width:max-content; }
    #bf-grid .bf-card.wbad { border-color:${C_BAD}; }
    #bf-grid .bf-card.mine { outline:2px solid ${C_ACC}; }
    #bf-grid .bf-card img { display:block; height:190px; }
    #bf-grid figcaption { padding:4px 6px; font-size:10px;
                          font-family:ui-monospace,monospace; line-height:1.4; }
    #bf-grid .rank { color:${C_ACC}; font-weight:700; }
    #bf-grid .dim { color:#79808f; }
    #bf-grid.blind .hideable { visibility:hidden; }
  `;
  wrap.appendChild(style);
  const label = document.createElement("div");
  label.className = "muted small";
  label.style.cssText = "margin-bottom:6px";
  label.textContent = "Squarest → most side-on. Red border = W suspect. Purple outline = the round you have open.";
  wrap.appendChild(label);
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
    return { f, ...a, key: cfg.sortBy === "ft" ? (a.ft ?? 1e9)
                        : cfg.sortBy === "gap" ? -f.gap : a.sh };
  });
  rows.sort((x, y) => x.key - y.key);

  // A W far off the cohort isn't a wider boxer, it's a contaminated estimate.
  const perVid = new Map();
  for (const r of rows) if (!perVid.has(r.f.stem)) perVid.set(r.f.stem, r.W);
  const ws = [...perVid.values()].sort((a, b) => a - b);
  const medW = ws.length ? ws[ws.length >> 1] : NaN;

  grid.innerHTML = rows.map((r, i) => {
    const off = (r.W - medW) / medW * 100;
    const bad = Math.abs(off) > 20;
    return `<figure class="bf-card${bad ? " wbad" : ""}" data-stem="${r.f.stem.replace(/"/g, "&quot;")}">
      <img src="data:image/jpeg;base64,${r.f.img}" alt="" title="${r.f.stem.replace(/"/g, "&quot;")}">
      <figcaption>
        <div class="rank">#${i + 1}</div>
        <div class="hideable">sh <b>${fmt(r.sh)}°</b>${r.ft == null ? "" : ` ft ${fmt(r.ft)}°`}</div>
        <div class="hideable dim">gap ${r.f.gap.toFixed(3)} / W ${r.W.toFixed(3)}${
          bad ? ` <span style="color:${C_BAD}">${off > 0 ? "+" : ""}${off.toFixed(0)}%</span>` : ""}</div>
        <div class="hideable dim">${r.f.stem.slice(0, 22)}<br>r${r.f.round} · ${r.f.t}s</div>
      </figcaption>
    </figure>`;
  }).join("");

  const shs = rows.map(r => r.sh).filter(Number.isFinite);
  const nBad = [...perVid.entries()].filter(([, w]) => Math.abs((w - medW) / medW) > 0.2).length;
  const note = host?.querySelector("#bf-wnote");
  if (note) note.textContent = cfg.wMode === "cohort"
    ? `one W = ${fmt(medW, 3)} for all videos`
    : `${nBad} video(s) more than 20% off the median W ${fmt(medW, 3)}`;
  const spread = host?.querySelector("#bf-spread");
  if (spread && shs.length) spread.textContent =
    `range ${fmt(Math.min(...shs))}° – ${fmt(Math.max(...shs))}°`;
}
