// Coach review — John's 30 verdicts against every computed number.
//
// The other two bladedness lenses show what the metrics say. This one shows
// what a coach said, in his own words, beside the same frames at source
// resolution and beside every candidate metric — so a disagreement can be
// looked at instead of argued about.
//
// WHY THIS IS THE ONE THAT DECIDES THE RULE. 700 pairwise comparisons chose
// shoulders 3D. These 30 categorical verdicts choose HIPS 3D (rho +0.58,
// p=0.003 vs shoulders 3D's +0.27, p=0.206). Both stand, because they are
// different questions: the pairs asked which boxer is turned FURTHER, John was
// asked whether a stance is ACCEPTABLE. His own test is hip-level — "if I can
// clearly see their rear hip or rear nipple, they're too squared" — and frame 7
// states it outright: "the hips are bladed, but the shoulders are squared, so
// the overall position is still considered squared." The rule is the coaching
// judgement, so hips 3D is the candidate.
//
// THE AGREE COLUMN IS NOT ACCURACY. The hip3D cut was chosen by looking at
// these same frames. It describes the fit and is optimistic by construction.
// It earns its place by making the frames that resist any threshold obvious:
//
//   frame 9   duck position, torso at 78% of the round median. The lean
//             correction is applied to the 2D gap and NOT to the 3D angles —
//             a real gap, and this frame is the evidence for it.
//   frame 12  "the camera angle makes her appear squared" — his words. The
//             camera-as-opponent assumption fails on that video.
//
// Data comes from cornerman-backend. Refresh with:
//   python bladedness/coach_review_page.py
//   cp ~/code/cornerman-backend/bladedness/coach_lens_data.json \
//      ~/code/cornerman-debug-viewer/data/bladedness_coach.json
//
// Images are embedded (3 MB) rather than linked: unlike the labeler's frames
// these are not published anywhere, and they are the record of a coach review.

const DATA_URL = "./data/bladedness_coach.json";

let host = null;
let data = null;
let dataPromise = null;
let dataError = null;
let filter = "all";
let idx = 0;
let onKey = null;

async function loadData() {
  dataPromise = (async () => {
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (e) {
      dataError = e.message || String(e);
    }
  })();
  return dataPromise;
}

const FILTERS = {
  all: () => true,
  no: (c) => c.agree === false,
  judge: (c) => c.band >= 0,
  oop: (c) => c.band < 0,
};

const shown = () => data.cards.filter(FILTERS[filter]);

function metricRows(m) {
  return Object.entries(m)
    .filter(([k]) => k !== "crop")
    .map(([k, v]) => `<tr><td>${k}</td><td class="cr-v">${v == null ? "—" : v}</td></tr>`)
    .join("");
}

// One frame at a time, as large as the window allows. The lens host is the
// sidebar (#rule-panel inside <aside id="side">), which is far too narrow to
// judge a stance in — so the panel is position:fixed and covers the viewport.
// It stays a CHILD of the host on purpose: the viewer tears a lens down by
// clearing ruleHost.innerHTML, and anything appended to document.body would
// survive that and leak into the next lens.
function paintOne() {
  const list = shown();
  if (!list.length) {
    document.getElementById("cr-stage").innerHTML = `<p class="hint">nothing in this filter</p>`;
    return;
  }
  idx = Math.max(0, Math.min(idx, list.length - 1));
  const c = list[idx];
  document.getElementById("cr-stage").innerHTML = `
    <img id="cr-img" src="${c.img}" alt="frame ${c.n}">
    <div class="cr-meta">
      <div>
        <span class="cr-n">#${c.n}</span>
        <span class="cr-band b${c.band < 0 ? "m1" : c.band}">${c.bandName}</span>
        <span class="cr-verdict">metric says <b>${c.says || "—"}</b> at hip3D
          ${c.m.hip3D ?? "—"}° ·
          ${
            c.agree === true
              ? '<span style="color:#8ce0a3">agrees</span>'
              : c.agree === false
              ? '<span style="color:#ff9db0">DISAGREES</span>'
              : '<span style="color:#9fb0d0">not scored</span>'
          }</span>
        <blockquote>${c.quote}</blockquote>
        <div class="cr-src">${c.video} · r${c.round} f${c.frame} · ${c.t}s</div>
      </div>
      <table class="cr-t">${metricRows(c.m)}</table>
    </div>`;
  document.getElementById("cr-pos").textContent = `${idx + 1} / ${list.length}`;
  document.getElementById("cr-prev").disabled = idx === 0;
  document.getElementById("cr-next").disabled = idx === list.length - 1;
  // Preload the neighbours so paging does not flash.
  for (const j of [idx + 1, idx - 1]) {
    if (list[j]) { const im = new Image(); im.src = list[j].img; }
  }
}

function step(d) {
  idx += d;
  paintOne();
}

function renderShell() {
  if (dataError) {
    host.innerHTML = `<h2>Coach review</h2>
      <div style="color:#e94560">bladedness_coach.json failed to load — ${dataError}</div>
      <p class="hint">Generate + copy it:<br>
        <code>python bladedness/coach_review_page.py</code><br>
        <code>cp ~/code/cornerman-backend/bladedness/coach_lens_data.json
        ~/code/cornerman-debug-viewer/data/bladedness_coach.json</code></p>`;
    return;
  }
  host.innerHTML = `
    <style>
      #cr-panel{position:fixed;inset:0;z-index:40;background:#12182b;color:#e0e0e0;
        display:flex;flex-direction:column;font:15px/1.55 system-ui,sans-serif}
      #cr-top{display:flex;gap:14px;align-items:center;flex-wrap:wrap;
        padding:9px 18px;background:#0f1424;border-bottom:1px solid #24304f}
      #cr-top h2{font-size:15px;margin:0}
      #cr-top .s{font-family:ui-monospace,monospace;font-size:13px;color:#8ea2c8}
      #cr-top .s b{color:#e94560}
      #cr-panel button,#cr-panel select{background:#1a2138;border:1px solid #2b3555;
        color:#cbd5e8;padding:5px 13px;border-radius:5px;cursor:pointer;font-size:13px}
      #cr-panel button:disabled{opacity:.3;cursor:default}
      #cr-pos{font-family:ui-monospace,monospace;color:#e94560;font-weight:700}
      #cr-warn{padding:6px 18px;background:#241c14;color:#f5cf72;font-size:12px}
      #cr-stage{flex:1;min-height:0;display:grid;
        grid-template-columns:minmax(0,1fr) minmax(320px,29%);gap:22px;padding:16px 20px}
      #cr-img{width:100%;height:100%;min-height:0;object-fit:contain;border-radius:9px}
      .cr-meta{display:flex;flex-direction:column;gap:12px;overflow:auto}
      .cr-n{font-family:ui-monospace,monospace;font-size:26px;color:#e94560;font-weight:700}
      .cr-band{display:inline-block;padding:3px 12px;border-radius:11px;font-size:13px;
        font-weight:700;margin-left:9px}
      .b3{background:#1d4429;color:#8ce0a3} .b2{background:#3b3a18;color:#e3e08a}
      .b1{background:#43291a;color:#f0b483} .b0{background:#4a1626;color:#ff9db0}
      .bm1{background:#26304a;color:#9fb0d0}
      .cr-meta blockquote{margin:11px 0 0;padding:9px 14px;border-left:3px solid #e94560;
        background:#101728;border-radius:0 7px 7px 0;color:#d3dcee;font-size:15px}
      .cr-verdict{display:block;margin-top:9px;font-family:ui-monospace,monospace;font-size:13px}
      .cr-t{border-collapse:collapse;font-family:ui-monospace,monospace;font-size:14px}
      .cr-t td{padding:3px 18px 3px 0} .cr-t td:first-child{color:#5f6d8c}
      .cr-v{font-weight:700;color:#e0e0e0}
      .cr-src{margin-top:9px;font-size:11px;color:#5f6d8c;word-break:break-all}
      /* Stacked on a narrow window the meta column would otherwise squeeze the
         frame to nothing — reserve most of the height for the image. */
      @media (max-width:900px){#cr-stage{grid-template-columns:1fr;
        grid-template-rows:minmax(55vh,1fr) auto;overflow:auto}}
    </style>
    <div id="cr-panel">
      <div id="cr-top">
        <h2>Coach review — John's 30</h2>
        <button id="cr-prev">← prev</button>
        <span id="cr-pos"></span>
        <button id="cr-next">next →</button>
        <select id="cr-filter">
          <option value="all">all 30</option>
          <option value="no">disagreements only</option>
          <option value="judge">judgeable</option>
          <option value="oop">out of position</option>
        </select>
        <span class="s"><b>${data.n_agree}</b>/${data.n_scored} agree at hip3D
          ${data.hip_cut}°</span>
        <span style="flex:1"></span>
        <span class="s">← → to page</span>
      </div>
      <div id="cr-warn">⚠ The hip3D cut was chosen by looking at these same
        frames — the agree/disagree call describes the fit, it does not measure
        accuracy.</div>
      <div id="cr-stage"></div>
    </div>`;

  document.getElementById("cr-prev").onclick = () => step(-1);
  document.getElementById("cr-next").onclick = () => step(1);
  document.getElementById("cr-filter").onchange = (e) => {
    filter = e.target.value;
    idx = 0;
    paintOne();
  };

  // Arrow keys page frames. THE VIEWER HAS NO UNMOUNT HOOK — it tears a lens
  // down by clearing ruleHost.innerHTML and nothing else — so this listener
  // has to look after itself two ways: drop any listener from a previous mount
  // (otherwise switching away and back doubles every keypress), and no-op once
  // the panel is gone from the DOM (otherwise it keeps stealing the arrow keys
  // the viewer uses to step the video).
  if (onKey) document.removeEventListener("keydown", onKey, true);
  onKey = (e) => {
    if (!document.getElementById("cr-panel")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); step(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); step(1); }
  };
  document.addEventListener("keydown", onKey, true);
  paintOne();
}

export const BladednessCoachRule = {
  id: "bladedness_coach_lens",
  label: "Bladedness coach review (John's 30)",

  standalone: true,

  mount(_host) {
    host = _host;
    idx = 0;
    host.innerHTML = `<h2>Coach review</h2><p class="hint">Loading…</p>`;
    (dataPromise || loadData()).then(renderShell);
  },

  update() { /* nothing round-dependent */ },
  draw() { /* nothing on the video canvas */ },
};
