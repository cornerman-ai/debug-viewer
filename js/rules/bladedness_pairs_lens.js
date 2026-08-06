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
// what breaks a threshold. Cards are ordered worst-disagreement first for
// exactly that reason.
//
// The "no stable answer" filter is the control. 30 already-answered pairs were
// salted back into the labeler left/right swapped under new ids; those are the
// pairs with no stable human answer. The metric losing one of those is not
// evidence against the metric — of the 4 flipped, it "lost" 3, which is the
// signature of a metric limited by label noise rather than by its own quality.
//
// UX matches the coach-review lens on purpose: one comparison at a time filling
// the window, stats beside it, arrows to page. A scrolling wall of 700 cards is
// unreadable, and these two lenses are used for the same thing — looking at a
// disagreement closely enough to explain it.
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

let host = null;
let data = null;
let dataPromise = null;
let dataError = null;
let filter = "all";
let pass = 0;      // index into data.passes
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
  bad: (c) => !c.ok,
  ok: (c) => c.ok,
  split: (c) => c.split,
  flip: (c) => c.flip,
};

const P = () => data.passes[pass];
const shown = () => P().cards.filter(FILTERS[filter]);

// Both frames' metrics in ONE table, side by side. Two separate tables would
// make the reader hold six numbers in their head to compare them; the whole
// question here is which frame is higher on each row.
function metricTable(c) {
  const keys = Object.keys(c.L.m);
  const cell = (v) => (v == null ? "—" : v);
  return `<table class="bp-t">
    <tr><th></th><th>left</th><th>right</th></tr>
    ${keys
      .map((k) => {
        const a = c.L.m[k];
        const b = c.R.m[k];
        const hiL = a != null && b != null && a > b;
        const hiR = a != null && b != null && b > a;
        return `<tr><td class="k">${k}</td>
          <td class="${hiL ? "hi" : ""}">${cell(a)}</td>
          <td class="${hiR ? "hi" : ""}">${cell(b)}</td></tr>`;
      })
      .join("")}
  </table>`;
}

function sideHtml(c, which) {
  const s = which === "L" ? c.L : c.R;
  const side = which === "L" ? "left" : "right";
  const you = c.won === side;
  const met = c.says === side;
  const url = P().imgs[String(s.i)] || "";
  return `<figure class="bp-side${you ? " you" : ""}${met ? " met" : ""}">
    <img loading="lazy" src="${url}" alt="${side} frame">
    <figcaption>
      <div class="bp-picks">
        ${you ? '<span class="p-you">● human</span>' : ""}
        ${["sh3D", "hip3D"]
          .filter((k) => c.v && c.v[k] && c.v[k].says === side)
          .map((k) => `<span class="p-met">● ${k}</span>`)
          .join("")}
      </div>
      <div class="bp-src">${s.v} · r${s.r} f${s.f}</div>
    </figcaption>
  </figure>`;
}

// Both torso metrics get a verdict on every pair. The 700 comparisons chose
// shoulders 3D and the coach's 30 verdicts chose hips 3D, so the honest thing
// is to show both calls rather than privilege one — and to make the pairs where
// they pick DIFFERENT frames easy to find, because at most one can be right
// there and that is where the whole disagreement lives.
function verdictRows(c) {
  return ["sh3D", "hip3D"]
    .map((name) => {
      const v = c.v && c.v[name];
      const own = name === P().primary ? ' class="own"' : "";
      if (!v) return `<tr${own}><td class="k">${name}</td><td colspan="3">—</td></tr>`;
      return `<tr${own}>
        <td class="k">${name}</td>
        <td>picks <b>${v.says}</b></td>
        <td>${v.d}°</td>
        <td class="${v.ok ? "vok" : "vno"}">${v.ok ? "✓" : "✗"}</td></tr>`;
    })
    .join("");
}

function paintOne() {
  const stage = document.getElementById("bp-stage");
  if (!stage) return;
  const list = shown();
  if (!list.length) {
    stage.innerHTML = `<p class="hint">nothing in this filter</p>`;
    return;
  }
  idx = Math.max(0, Math.min(idx, list.length - 1));
  const c = list[idx];
  stage.innerHTML = `
    <div class="bp-pair">${sideHtml(c, "L")}${sideHtml(c, "R")}</div>
    <div class="bp-meta">
      <div>
        <span class="bp-id">pair ${c.id}</span>
        ${c.split ? '<span class="bp-tag sp">SHOULDERS vs HIPS SPLIT</span>' : ""}
        ${c.flip ? '<span class="bp-tag fl">NO STABLE HUMAN ANSWER</span>' : ""}
        <div class="bp-gap">human picked <b>${c.won}</b></div>
      </div>
      <table class="bp-t bp-v">
        <tr><th>vs human</th><th></th><th>apart</th><th></th></tr>
        ${verdictRows(c)}
      </table>
      ${metricTable(c)}
      <p class="bp-note">${
        c.flip
          ? "Re-shown swapped and answered differently — no stable human answer to get right."
          : c.split
          ? `The two torso metrics pick different frames here, so at most one can be right. These ${P().n_split} pairs are the only ones testing shoulders against hips.`
          : c.d < 5
          ? "A near-tie. Losing these is expected — the labeler flips on them too."
          : c.ok
          ? ""
          : "A confident miss. This is the kind that breaks a threshold."
      }</p>
    </div>`;
  document.getElementById("bp-pos").textContent = `${idx + 1} / ${list.length}`;
  document.getElementById("bp-prev").disabled = idx === 0;
  document.getElementById("bp-next").disabled = idx === list.length - 1;
  for (const j of [idx + 1, idx - 1]) {
    const n = list[j];
    if (n) for (const s of [n.L, n.R]) { const im = new Image(); im.src = P().imgs[String(s.i)]; }
  }
}

function step(d) {
  idx += d;
  paintOne();
}


function renderShell() {
  if (dataError) {
    host.innerHTML = `<h2>Bladedness pairs</h2>
      <div style="color:#e94560">bladedness_pairs.json failed to load — ${dataError}</div>
      <p class="hint">Generate + copy it:<br>
        <code>python bladedness/pair_review.py</code><br>
        <code>cp ~/code/cornerman-backend/bladedness/pair_lens_data.json
        ~/code/cornerman-debug-viewer/data/bladedness_pairs.json</code></p>`;
    return;
  }
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";

  // Takeover CSS lives INSIDE #stage-extras: the viewer clears that slot on
  // every lens switch, so the player, pickers and sidebar come back by
  // themselves. There is no unmount hook to do it.
  const takeover = document.createElement("style");
  takeover.textContent = `
    #stage > *:not(#stage-extras) { display:none !important; }
    #side { display:none !important; }
    /* Renders 700 fixed comparisons and never reads a round, so every way of
       loading one is noise. The LENS select stays — with #side hidden it is the
       only way back out. */
    .picker-row, #firebase-section, #ondevice-section, .manual-fallback,
    #drive-section, #cache-section { display:none !important; }
    body > header { display:none !important; }
    #picker-card { margin:0 !important; padding:6px 10px !important; }
    .layout { display:block !important; }
    #stage { width:100% !important; max-width:none !important;
             padding:0 !important; background:none !important; }
    #viewer { padding:4px 6px 0 !important; }
    #stage-extras { margin-top:0 !important; }
    /* HEIGHT IS DONE IN CSS, NOT MEASURED. Two earlier attempts measured
       window.innerHeight and set a pixel height: the first read 0 before the
       pane had laid out, the second read a stale value because the takeover
       below moves this panel several hundred pixels up. A flex chain from
       <body> has neither failure mode and needs no resize listener. */
    html, body { height:100% !important; }
    body { display:flex !important; flex-direction:column !important;
           overflow:hidden !important; }
    #viewer { flex:1 1 auto !important; min-height:0 !important;
              display:flex !important; flex-direction:column !important; }
    .layout { flex:1 1 auto !important; min-height:0 !important; }
    #stage, #stage-extras { height:100% !important; min-height:0 !important; }

    #bp-panel{height:100%;display:flex;flex-direction:column;background:#12182b;color:#e0e0e0;
      font:15px/1.55 system-ui,sans-serif;border-radius:8px;overflow:hidden}
    #bp-top{display:flex;gap:14px;align-items:center;flex-wrap:wrap;
      padding:9px 18px;background:#0f1424;border-bottom:1px solid #24304f}
    #bp-top h2{font-size:15px;margin:0}
    #bp-top .s{font-family:ui-monospace,monospace;font-size:13px;color:#8ea2c8}
    #bp-top .s b{color:#e94560}
    #bp-panel button,#bp-panel select{background:#1a2138;border:1px solid #2b3555;
      color:#cbd5e8;padding:5px 13px;border-radius:5px;cursor:pointer;font-size:13px}
    #bp-panel button:disabled{opacity:.3;cursor:default}
    #bp-pos{font-family:ui-monospace,monospace;color:#e94560;font-weight:700}
    #bp-stage{flex:1;min-height:0;display:grid;
      grid-template-columns:minmax(0,1fr) minmax(290px,25%);gap:20px;padding:14px 18px}
    .bp-pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;min-height:0}
    .bp-side{margin:0;display:flex;flex-direction:column;min-height:0;
      background:#101728;border-radius:9px;padding:8px;border:2px solid transparent}
    .bp-side.you{border-color:#3f9d55}
    .bp-side.met{box-shadow:inset 0 0 0 2px #e9a03f}
    .bp-side img{flex:1;min-height:0;width:100%;object-fit:contain;border-radius:6px}
    .bp-side figcaption{margin-top:7px;font-family:ui-monospace,monospace;font-size:11px}
    .bp-picks{display:flex;gap:12px;font-size:12px;margin-bottom:3px}
    .p-you{color:#8ce0a3} .p-met{color:#e9a03f} .p-non{color:#5f6d8c}
    .bp-src{color:#5f6d8c;word-break:break-all;line-height:1.35}
    .bp-meta{display:flex;flex-direction:column;gap:14px;overflow:auto}
    .bp-id{font-family:ui-monospace,monospace;font-size:20px;color:#e94560;font-weight:700}
    .bp-tag{display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;
      font-weight:700;margin-left:8px}
    .bp-tag.ok{background:#1d4429;color:#8ce0a3}
    .bp-tag.no{background:#4a1626;color:#ff9db0}
    .bp-tag.fl{background:#4a3a12;color:#f5cf72}
    .bp-tag.sp{background:#2b2450;color:#c3b6ff}
    .bp-v td{white-space:nowrap}
    .bp-v td.vok{color:#8ce0a3;font-weight:700}
    .bp-v td.vno{color:#ff9db0;font-weight:700}
    .bp-v tr.own td.k{color:#e0e0e0;font-weight:700}
    #bp-asks{padding:5px 18px;background:#171f38;color:#9fb0d0;font-size:12.5px}
    #bp-asks b{color:#e0e0e0}
    .bp-gap{margin-top:9px;font-family:ui-monospace,monospace;font-size:13px;color:#8ea2c8}
    .bp-t{border-collapse:collapse;font-family:ui-monospace,monospace;font-size:13px;width:100%}
    .bp-t th{color:#5f6d8c;font-weight:400;font-size:11px;text-align:right;padding:0 0 4px}
    .bp-t th:first-child{text-align:left}
    .bp-t td{padding:3px 0;text-align:right;color:#93a3c4}
    .bp-t td.k{text-align:left;color:#5f6d8c}
    .bp-t td.hi{color:#fff;font-weight:700}
    .bp-note{margin:0;font-size:12.5px;color:#8ea2c8;line-height:1.45}
    @media (max-width:1000px){#bp-stage{grid-template-columns:1fr;
      grid-template-rows:minmax(52vh,1fr) auto;overflow:auto}}
  `;
  slot.appendChild(takeover);

  const panel = document.createElement("div");
  panel.id = "bp-panel";
  panel.innerHTML = `
    <div id="bp-top">
      <h2>Bladedness pairs</h2>
      <select id="bp-pass">${data.passes
        .map((p, i) => `<option value="${i}">${p.attribute} pass (${p.n})</option>`)
        .join("")}</select>
      <button id="bp-prev">← prev</button>
      <span id="bp-pos"></span>
      <button id="bp-next">next →</button>
      <select id="bp-filter"></select>
      <span class="s" id="bp-tally"></span>
      <span style="flex:1"></span>
      <span class="s">worst disagreements first · ← → to page</span>
    </div>
    <div id="bp-asks"></div>
    <div id="bp-stage"></div>`;
  slot.appendChild(panel);

  // Everything that depends on WHICH pass is being viewed. The two passes are
  // different questions over different pair sets, so the counts, the filter
  // options and the tally all change when you switch.
  function chrome() {
    const p = P(), t = p.tally;
    const pct = (k) => ((t[k].ok / Math.max(t[k].n, 1)) * 100).toFixed(1) + "%";
    panel.querySelector("#bp-asks").innerHTML =
      `the human was asked: <b>${p.asks}</b> — ${p.n} comparisons`;
    panel.querySelector("#bp-tally").innerHTML =
      `sh3D <b>${pct("sh3D")}</b> · hip3D <b>${pct("hip3D")}</b>` +
      (p.n_split
        ? ` · on the ${p.n_split} they split: sh3D <b>${p.split_sh}</b> vs hip3D <b>${p.split_hip}</b>`
        : "");
    const f = panel.querySelector("#bp-filter");
    f.innerHTML = `
      <option value="all">all ${p.n}</option>
      <option value="bad">disagreements (${p.n - p.agree})</option>
      <option value="ok">agreements</option>
      <option value="split">shoulders vs hips split (${p.n_split})</option>
      <option value="flip">no stable answer (${p.flipped})</option>`;
    f.value = filter;
  }

  panel.querySelector("#bp-pass").onchange = (e) => {
    pass = +e.target.value;
    idx = 0;
    chrome();
    paintOne();
  };
  panel.querySelector("#bp-prev").onclick = () => step(-1);
  panel.querySelector("#bp-next").onclick = () => step(1);
  panel.querySelector("#bp-filter").onchange = (e) => {
    filter = e.target.value;
    idx = 0;
    paintOne();
  };
  chrome();

  // The viewer has no unmount hook, so this listener manages itself: drop the
  // one from a previous mount (or switching away and back doubles every
  // keypress) and no-op once the panel has left the DOM (or it keeps stealing
  // the arrow keys the viewer uses to step the video).
  if (onKey) document.removeEventListener("keydown", onKey, true);
  onKey = (e) => {
    if (!document.getElementById("bp-panel")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); step(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); step(1); }
  };
  document.addEventListener("keydown", onKey, true);


  paintOne();
}

export const BladednessPairsRule = {
  id: "bladedness_pairs_lens",
  label: "Bladedness pairs (labels vs metric)",

  standalone: true,

  mount(_host) {
    host = _host;
    idx = 0;
    pass = 0;
    host.innerHTML = `<h2>Bladedness pairs</h2><p class="hint">Loading…</p>`;
    (dataPromise || loadData()).then(renderShell);
  },

  update() { /* nothing round-dependent */ },
  draw() { /* nothing on the video canvas */ },
};
