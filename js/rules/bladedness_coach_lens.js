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
  // The seven frames where John said outright that the hips and the shoulders
  // are not in the same place — the only rows carrying hip-vs-shoulder signal.
  split: (c) => c.split,
};

const shown = () => data.cards.filter(FILTERS[filter]);

// His single prose verdict, split into a hip call and a shoulder call. This is
// an INTERPRETATION of his words made offline (cornerman-backend's
// coach_review/responses/john_parts.csv), not a second round of labelling — so
// the rule and the exact phrase behind every split ride along on the card and
// are rendered here. His verbatim review sits directly above, which is what
// makes a split checkable rather than something to take on trust.
//
// Older data files predate the split; fall back to the single band rather than
// rendering "undefined" if bladedness_coach.json has not been regenerated.
function partsBlock(c) {
  if (c.hipBand == null || c.shBand == null) {
    return `<div class="cr-parts"><div class="cr-pbasis">no hip/shoulder split in
      this data file — regenerate with <code>coach_review_page.py</code></div></div>`;
  }
  return `
    <div class="cr-parts${c.split ? " split" : ""}">
      ${partRow("hips", c.hipBand, c.hipBandName, "hip3D", c.m.hip3D,
                c.hipSays, c.hipAgree, data.hip_cut)}
      ${partRow("shoulders", c.shBand, c.shBandName, "sh3D", c.m.sh3D,
                c.shSays, c.shAgree, data.sh_cut)}
      <div class="cr-pbasis">${c.split ? "<b>he split them</b> — " : ""}${c.basisNote}
        ${c.hedge ? `· <i>hedged (${c.hedge})</i>` : ""}
        <br><span class="cr-pev">from: “${c.evidence}”</span></div>
    </div>`;
}

// One row per body part: his call, our metric for THAT joint, and whether the
// two agree at that joint's own cut. Two metrics are being tracked, so neither
// borrows the other's verdict — a single "bladed" line would hide exactly the
// hip-vs-shoulder difference this lens exists to show.
function partRow(label, band, bandName, mname, mval, says, agree, cut) {
  const tag =
    agree === true
      ? '<span style="color:#8ce0a3">agrees</span>'
      : agree === false
      ? '<span style="color:#ff9db0">DISAGREES</span>'
      : '<span style="color:#9fb0d0">not scored</span>';
  return `<div class="cr-prow"><span class="cr-plab">${label}</span>
    <span class="cr-band b${band < 0 ? "m1" : band}">${bandName}</span>
    <span class="cr-pm">${mname} ${mval ?? "—"}° → <b>${says || "—"}</b>
      at ${cut}° · ${tag}</span></div>`;
}

function metricRows(m) {
  return Object.entries(m)
    .filter(([k]) => k !== "crop")
    .map(([k, v]) => `<tr><td>${k}</td><td class="cr-v">${v == null ? "—" : v}</td></tr>`)
    .join("");
}

// One frame at a time, filling the window. The lens host is the sidebar
// (#rule-panel inside <aside id="side">) which is far too narrow to judge a
// stance in, so this renders into #stage-extras and hides the rest of the
// stage — the same takeover the frames lens uses. That also removes the video
// and round pickers, which is correct: this lens has no use for a loaded round
// and offering the choice only invites the question of why it changes nothing.
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
        <span class="cr-hdr">hips
          <span class="cr-band b${c.hipBand < 0 ? "m1" : c.hipBand}">${c.hipBandName}</span></span>
        <span class="cr-hdr">shoulders
          <span class="cr-band b${c.shBand < 0 ? "m1" : c.shBand}">${c.shBandName}</span></span>
        <blockquote>${c.quote}</blockquote>
        ${partsBlock(c)}
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
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";

  // The takeover CSS lives INSIDE #stage-extras on purpose: the viewer clears
  // that slot on every lens switch, so the video player, the pickers and the
  // side panel all come back by themselves. There is no unmount hook to do it.
  const takeover = document.createElement("style");
  takeover.textContent = `
    /* Everything in the stage except our own slot — including the video and
       round pickers. Hiding the <video> alone leaves .video-wrap holding its
       space, and enumerating elements misses whatever gets added later. */
    #stage > *:not(#stage-extras) { display:none !important; }
    #side { display:none !important; }
    /* This lens renders 30 fixed stills and never reads a round, so offering a
       video/round picker only invites the question of why choosing one changes
       nothing. The LENS select stays — it is the only way back out, since
       #side (which holds the other one) is hidden. Everything below the picker
       is a different way to load a round, equally irrelevant here. */
    .picker-row, #firebase-section, #ondevice-section, .manual-fallback,
    #drive-section, #cache-section
      { display:none !important; }
    /* Collapse the page header and the setup card's padding too, so the frame
       starts at the top of the window instead of 470px down it. */
    body > header { display:none !important; }
    #picker-card { margin:0 !important; padding:6px 10px !important; }
    .layout { display:block !important; }
    #stage { width:100% !important; max-width:none !important;
             padding:0 !important; background:none !important; }
    /* #viewer carries 32px of bottom padding for the normal layout; with the
       panel measured to fill the rest of the window that padding is exactly
       what makes the page scroll by a sliver. */
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

    #cr-panel{height:100%;display:flex;flex-direction:column;
      background:#12182b;color:#e0e0e0;font:15px/1.55 system-ui,sans-serif;
      border-radius:8px;overflow:hidden}
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
    .cr-hdr{font-size:12px;color:#5f6d8c;margin-left:14px}
    .cr-t{border-collapse:collapse;font-family:ui-monospace,monospace;font-size:14px}
    .cr-t td{padding:3px 18px 3px 0} .cr-t td:first-child{color:#5f6d8c}
    .cr-v{font-weight:700;color:#e0e0e0}
    .cr-src{margin-top:9px;font-size:11px;color:#5f6d8c;word-break:break-all}
    /* His ONE prose verdict, split into a hip call and a shoulder call. Sits
       directly under the quote it was derived from — the evidence line is what
       makes the split checkable rather than asserted. Lives inside .cr-meta,
       which scrolls on its own, so this can never push the frame off-screen. */
    .cr-parts{margin-top:11px;padding:9px 12px;border-radius:8px;
      background:#101728;border:1px solid #1d2740}
    .cr-parts.split{border-color:#e94560}
    /* Fixed label and chip widths so the two metric readouts start at the same
       x — otherwise "bladed" and "very squared" shift them apart and the rows
       stop being comparable at a glance, which is the whole point of them. */
    .cr-prow{display:flex;align-items:baseline;gap:9px;margin:5px 0}
    .cr-plab{flex:none;width:74px;color:#5f6d8c;font-size:13px}
    .cr-prow .cr-band{flex:none;width:104px;margin-left:0;text-align:center}
    .cr-prow .cr-pm{flex:1;min-width:0}
    .cr-pm{font-family:ui-monospace,monospace;font-size:12px;color:#8b9ab8}
    .cr-pbasis{margin-top:7px;font-size:12px;color:#8b9ab8;line-height:1.5}
    .cr-pev{color:#5f6d8c;font-style:italic}
    /* Stacked on a narrow window the meta column would squeeze the frame to
       nothing — reserve most of the height for the image. */
    @media (max-width:900px){#cr-stage{grid-template-columns:1fr;
      grid-template-rows:minmax(55vh,1fr) auto;overflow:auto}}
  `;
  slot.appendChild(takeover);

  const panel = document.createElement("div");
  panel.id = "cr-panel";
  panel.innerHTML = `
    <div id="cr-top">
      <h2>Coach review — John's 30</h2>
      <button id="cr-prev">← prev</button>
      <span id="cr-pos"></span>
      <button id="cr-next">next →</button>
      <select id="cr-filter">
        <option value="all">all 30</option>
        <option value="split">hips ≠ shoulders</option>
        <option value="no">disagreements only</option>
        <option value="judge">judgeable</option>
        <option value="oop">out of position</option>
      </select>
      <span class="s">hips <b>${data.hip_agree ?? data.n_agree}</b>/${
        data.hip_scored ?? data.n_scored} at ${data.hip_cut}°${
        data.sh_cut == null ? "" :
        ` · shoulders <b>${data.sh_agree}</b>/${data.sh_scored} at ${data.sh_cut}°`}</span>
      <span style="flex:1"></span>
      <span class="s">← → to page</span>
    </div>
    <div id="cr-warn">⚠ Both cuts were swept on these same 30 frames — the
      agree/disagree calls describe the fit, they do not measure accuracy. The
      hip/shoulder split of his verdict is an interpretation of his words; the
      phrase behind each one is shown.</div>
    <div id="cr-stage"></div>`;
  slot.appendChild(panel);

  panel.querySelector("#cr-prev").onclick = () => step(-1);
  panel.querySelector("#cr-next").onclick = () => step(1);
  panel.querySelector("#cr-filter").onchange = (e) => {
    filter = e.target.value;
    idx = 0;
    paintOne();
  };

  // Arrow keys page frames. THE VIEWER HAS NO UNMOUNT HOOK — it tears a lens
  // down by clearing #stage-extras and ruleHost, nothing else — so this
  // listener looks after itself two ways: drop any listener from a previous
  // mount (otherwise switching away and back doubles every keypress), and
  // no-op once the panel is gone from the DOM (otherwise it keeps stealing the
  // arrow keys the viewer uses to step the video).
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
