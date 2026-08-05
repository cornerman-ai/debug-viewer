// Bladedness pairs — every human comparison, and whether the metric agrees.
//
// The frames lens asks "does the ordering look right". This one is the audit:
// 700 pairwise judgements were collected in the boxing-labeler's SHOULDER
// bladedness labeler, and this shows, pair by pair, which frame the human
// picked, which one the metric picked, and how far apart the metric claimed
// they were.
//
// WHY THE GAP MATTERS MORE THAN THE HIT RATE. "81% agreement" hides two
// completely different failures. A disagreement on frames the metric called 3
// deg apart is a near-tie — the labeler flips on those themselves, and no
// metric can win them. A disagreement where it claimed 55 deg means it put a
// squared boxer and a bladed one at opposite ends of the scale, and that is
// what breaks a threshold. Cards are sorted worst-disagreement first for
// exactly that reason.
//
// The YOU FLIPPED filter is the control. 30 already-answered pairs were salted
// back into the labeler left/right swapped under new ids; those are the pairs
// with no stable human answer. The metric losing one of those is not evidence
// against the metric — of the 4 flipped, it "lost" 3, which is the signature
// of a metric limited by label noise rather than by its own quality.
//
// Data comes from cornerman-backend. Refresh with:
//   python bladedness/pair_review.py
//   cp ~/code/cornerman-backend/bladedness/pair_lens_data.json \
//      ~/code/cornerman-debug-viewer/data/bladedness_pairs.json
//
// Images are served from the labeler's GitHub Pages rather than committed here
// — the same JPEGs, 10 MB, already published. This lens therefore needs
// network, unlike the frames lens which embeds its thumbnails.

const DATA_URL = "./data/bladedness_pairs.json";
const C_OK = "#3f9d55";
const C_BAD = "#e94560";
const C_MET = "#e9a03f";

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
  bad: (c) => !c.ok,
  ok: (c) => c.ok,
  flip: (c) => c.flip,
};

function metricTable(m) {
  return `<table class="bp-m">${Object.entries(m)
    .map(([k, v]) => `<tr><td>${k}</td><td>${v == null ? "—" : v}</td></tr>`)
    .join("")}</table>`;
}

function sideHtml(s, you, met) {
  const cls = `${you ? " you" : ""}${met ? " met" : ""}`;
  const url = data.imgs[String(s.i)] || "";
  return `<div class="bp-side${cls}">
    <img loading="lazy" src="${url}" alt="">
    <div class="bp-who">
      ${you ? `<span style="color:${C_OK}">● human picked this</span>` : ""}
      ${met ? `<span style="color:${C_MET}">● metric picked this</span>` : ""}
    </div>
    ${metricTable(s.m)}
    <div class="bp-src">${s.v} · r${s.r} f${s.f}</div>
  </div>`;
}

function renderList() {
  const box = document.getElementById("bp-list");
  if (!box) return;
  const cards = data.cards.filter(FILTERS[filter]);
  box.innerHTML = cards
    .map(
      (c) => `<div class="bp-card ${c.ok ? "ok" : "no"}">
      <div class="bp-hd">
        <span class="bp-tag ${c.ok ? "ok" : "no"}">${c.ok ? "AGREE" : "DISAGREE"}</span>
        <span>pair ${c.id}</span>
        <span>metric called them <b>${c.d}°</b> apart</span>
        ${c.flip ? `<span class="bp-tag fl">NO STABLE HUMAN ANSWER</span>` : ""}
      </div>
      <div class="bp-pair">
        ${sideHtml(c.L, c.won === "left", c.says === "left")}
        ${sideHtml(c.R, c.won === "right", c.says === "right")}
      </div></div>`
    )
    .join("");
  const cnt = document.getElementById("bp-count");
  if (cnt) cnt.textContent = `${cards.length} shown`;
}

function renderShell() {
  if (dataError) {
    host.innerHTML = `<h2>Bladedness pairs</h2>
      <div style="color:${C_BAD}">bladedness_pairs.json failed to load — ${dataError}</div>
      <p class="hint">Generate + copy it:<br>
        <code>python bladedness/pair_review.py</code><br>
        <code>cp ~/code/cornerman-backend/bladedness/pair_lens_data.json
        ~/code/cornerman-debug-viewer/data/bladedness_pairs.json</code></p>`;
    return;
  }
  const pct = ((data.agree / Math.max(data.n, 1)) * 100).toFixed(1);
  host.innerHTML = `
    <style>
      .bp-bar{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:6px 0 10px}
      .bp-bar b{color:${C_BAD}}
      .bp-bar button{background:#1a2138;border:1px solid #2b3555;color:#cbd5e8;
        padding:4px 11px;border-radius:5px;cursor:pointer;font-size:12px}
      .bp-bar button.on{background:${C_BAD};border-color:${C_BAD};color:#fff}
      .bp-card{margin:12px 0;border-radius:9px;background:#161d33;
        border-left:5px solid;padding:9px 13px}
      .bp-card.ok{border-color:${C_OK}} .bp-card.no{border-color:${C_BAD}}
      .bp-hd{display:flex;gap:13px;align-items:baseline;flex-wrap:wrap;
        margin-bottom:7px;font-family:ui-monospace,monospace;font-size:12px;color:#8ea2c8}
      .bp-tag{padding:1px 8px;border-radius:9px;font-size:11px;font-weight:700}
      .bp-tag.ok{background:#1d4429;color:#8ce0a3}
      .bp-tag.no{background:#4a1626;color:#ff9db0}
      .bp-tag.fl{background:#4a3a12;color:#f5cf72}
      .bp-pair{display:grid;grid-template-columns:1fr 1fr;gap:13px}
      .bp-side{background:#101728;border-radius:7px;padding:7px;border:2px solid transparent}
      .bp-side.you{border-color:${C_OK}}
      .bp-side.met{box-shadow:inset 0 0 0 2px ${C_MET}}
      .bp-side img{width:100%;max-height:400px;object-fit:contain;border-radius:5px;display:block}
      .bp-who{font-size:11px;margin:5px 0 2px;font-family:ui-monospace,monospace}
      .bp-m{font-family:ui-monospace,monospace;font-size:11px;color:#93a3c4;border-collapse:collapse}
      .bp-m td{padding:0 8px 0 0} .bp-m td:first-child{color:#5f6d8c}
      .bp-src{font-size:10px;color:#5f6d8c;margin-top:3px;word-break:break-all}
    </style>
    <h2>Bladedness pairs — human vs <code>${data.metric}</code></h2>
    <p class="hint">
      <b>${data.agree}</b>/${data.n} = <b>${pct}%</b> of comparisons ordered the
      same way. Sorted worst-disagreement first: a miss on frames called 3° apart
      is a near-tie, a miss at 50° is what breaks a threshold.
      Of the ${data.flipped} pairs the labeler answered differently when re-shown
      swapped, the metric lost ${data.flipped_lost} — those have no stable answer
      to get right.
    </p>
    <div class="bp-bar">
      <button data-f="all" class="on">all</button>
      <button data-f="bad">disagreements (${data.n - data.agree})</button>
      <button data-f="ok">agreements</button>
      <button data-f="flip">no stable answer (${data.flipped})</button>
      <span class="hint" id="bp-count"></span>
    </div>
    <div id="bp-list"></div>`;

  for (const b of host.querySelectorAll(".bp-bar button")) {
    b.addEventListener("click", () => {
      host.querySelectorAll(".bp-bar button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      filter = b.dataset.f;
      renderList();
    });
  }
  renderList();
}

export const BladednessPairsRule = {
  id: "bladedness_pairs_lens",
  label: "Bladedness pairs (labels vs metric)",

  // Its own data file, no round needed — same as the frames lens.
  standalone: true,

  mount(_host) {
    host = _host;
    host.innerHTML = `<h2>Bladedness pairs</h2><p class="hint">Loading…</p>`;
    (dataPromise || loadData()).then(renderShell);
  },

  update() { /* nothing round-dependent */ },
  draw() { /* nothing on the video canvas */ },
};
