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

function metricRows(m) {
  return Object.entries(m)
    .filter(([k]) => k !== "crop")
    .map(([k, v]) => `<tr><td>${k}</td><td class="cr-v">${v == null ? "—" : v}</td></tr>`)
    .join("");
}

function renderList() {
  const box = document.getElementById("cr-list");
  if (!box) return;
  const cards = data.cards.filter(FILTERS[filter]);
  box.innerHTML = cards
    .map(
      (c) => `<div class="cr-card ${c.agree === true ? "ok" : c.agree === false ? "no" : "na"}">
      <div><img loading="lazy" src="${c.img}" alt="frame ${c.n}"></div>
      <div>
        <span class="cr-n">#${c.n}</span>
        <span class="cr-band b${c.band < 0 ? "m1" : c.band}">${c.bandName}</span>
        <blockquote>${c.quote}</blockquote>
        <table class="cr-t">${metricRows(c.m)}</table>
        <div class="cr-verdict">metric says <b>${c.says || "—"}</b> at hip3D
          ${c.m.hip3D ?? "—"}° ·
          ${
            c.agree === true
              ? '<span style="color:#8ce0a3">agrees</span>'
              : c.agree === false
              ? '<span style="color:#ff9db0">DISAGREES</span>'
              : '<span style="color:#9fb0d0">not scored</span>'
          }</div>
        <div class="cr-src">${c.video} · r${c.round} f${c.frame} · ${c.t}s</div>
      </div></div>`
    )
    .join("");
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
      .cr-bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:6px 0 8px}
      .cr-bar button{background:#1a2138;border:1px solid #2b3555;color:#cbd5e8;
        padding:4px 11px;border-radius:5px;cursor:pointer;font-size:12px}
      .cr-bar button.on{background:#e94560;border-color:#e94560;color:#fff}
      .cr-warn{padding:8px 12px;background:#241c14;color:#f5cf72;font-size:12px;
        border-radius:6px;margin-bottom:10px}
      .cr-card{display:grid;grid-template-columns:minmax(300px,44%) 1fr;gap:20px;
        margin:16px 0;padding:14px;background:#161d33;border-radius:10px;
        border-left:6px solid #2b3555}
      .cr-card.ok{border-left-color:#3f9d55} .cr-card.no{border-left-color:#e94560}
      .cr-card.na{border-left-color:#5f6d8c}
      .cr-card img{width:100%;border-radius:8px;display:block}
      .cr-n{font-family:ui-monospace,monospace;font-size:20px;color:#e94560;font-weight:700}
      .cr-band{display:inline-block;padding:2px 10px;border-radius:10px;font-size:12px;
        font-weight:700;margin-left:8px}
      .b3{background:#1d4429;color:#8ce0a3} .b2{background:#3b3a18;color:#e3e08a}
      .b1{background:#43291a;color:#f0b483} .b0{background:#4a1626;color:#ff9db0}
      .bm1{background:#26304a;color:#9fb0d0}
      .cr-card blockquote{margin:10px 0;padding:8px 13px;border-left:3px solid #e94560;
        background:#101728;border-radius:0 6px 6px 0;color:#d3dcee;font-size:14px}
      .cr-t{border-collapse:collapse;font-family:ui-monospace,monospace;font-size:13px}
      .cr-t td{padding:2px 15px 2px 0} .cr-t td:first-child{color:#5f6d8c}
      .cr-v{font-weight:700;color:#e0e0e0}
      .cr-verdict{margin-top:10px;font-family:ui-monospace,monospace;font-size:13px}
      .cr-src{margin-top:8px;font-size:11px;color:#5f6d8c}
    </style>
    <h2>Coach review — John's 30 frames</h2>
    <p class="hint">
      His verdicts, verbatim, beside the same instants re-cut at source
      resolution and every candidate metric.
      <b>${data.n_agree}</b>/${data.n_scored} agree at a hip3D cut of
      <b>${data.hip_cut}°</b>.
    </p>
    <div class="cr-warn">⚠ That cut was chosen by looking at these same frames,
      so the agree column describes the fit — it does not measure accuracy. It is
      here to make the frames that resist any threshold easy to find.</div>
    <div class="cr-bar">
      <button data-f="all" class="on">all 30</button>
      <button data-f="no">disagreements</button>
      <button data-f="judge">judgeable</button>
      <button data-f="oop">out of position</button>
    </div>
    <div id="cr-list"></div>`;

  for (const b of host.querySelectorAll(".cr-bar button")) {
    b.addEventListener("click", () => {
      host.querySelectorAll(".cr-bar button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      filter = b.dataset.f;
      renderList();
    });
  }
  renderList();
}

export const BladednessCoachRule = {
  id: "bladedness_coach_lens",
  label: "Bladedness coach review (John's 30)",

  standalone: true,

  mount(_host) {
    host = _host;
    host.innerHTML = `<h2>Coach review</h2><p class="hint">Loading…</p>`;
    (dataPromise || loadData()).then(renderShell);
  },

  update() { /* nothing round-dependent */ },
  draw() { /* nothing on the video canvas */ },
};
