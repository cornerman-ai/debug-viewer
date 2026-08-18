// Chin height lens — where IS the line, and what number separates the bands?
//
// The label (`chin_height`: over / level / under) asks whether the chin clears
// a horizontal line at the lead shoulder. Two things have to be right before a
// model can learn it, and both are guesses right now:
//
//   1. WHERE THE CHIN IS. BlazePose-33 has no jaw landmark, so the chin is
//      extrapolated down the nose→mouth vector:
//          chin = nose + coef * (mouth_mid − nose)
//      coef 2.25 was settled by eye on still frames in the chin project's
//      02_chin_point/. This lens puts the same call on moving footage, with
//      coef on a slider — watch the marker track the jaw through a slip.
//
//   2. WHERE THE LINE IS. The metric is
//          height_norm = (chin_y − lead_shoulder_y) / ruler
//      and the label boundaries were fitted on John's labels at −0.42 (over |
//      level) and −0.08 (level | under). Both are drawn ACROSS THE FRAME as
//      dashed lines, so you can see the band the boxer's chin actually sits in
//      rather than reading a number. This is the boundary two labelers disagree
//      on, so it is the thing worth eyeballing.
//
// Two toggles exist because both are open questions, not settled choices:
//
//   ruler         shoulder width (the chin project's choice) vs torso length.
//                 Torso is more robust to the boxer turning side-on but scored
//                 worse; shoulder width matches how the human judged it.
//   aspect-correct The pose cache stores x/width and y/height, so a normalized
//                 dx and dy are NOT the same length on a non-square video.
//                 `shoulder_width = hypot(dx, dy)` over normalized coords
//                 therefore mixes units, and the mix changes with the video's
//                 aspect ratio. ON multiplies back to pixels first (correct
//                 geometry); OFF reproduces the raw-normalized pipeline. If
//                 these two disagree, every distance feature is aspect-skewed.
//
// Needs the BlazePose-33 cache (mouth landmarks are dropped by the COCO-17
// remap), so it only appears for rounds that have one.

import { J as COCO } from "../../skeleton.js";

// BlazePose-33 layout + channel offsets (see blazepose_inspector.js).
const NOSE = 0, MOUTH_L = 9, MOUTH_R = 10, L_SHOULDER = 11, R_SHOULDER = 12, L_HIP = 23, R_HIP = 24;
const X = 0, Y = 1, VIS = 6, CH = 8, NJ = 33;

const cfg = {
  chinCoef: 2.25,        // nose→mouth extrapolation to the chin
  overLevel: -0.42,      // height_norm below this ⇒ "over" (chin above the line)
  levelUnder: -0.08,     // height_norm above this ⇒ "under" (chin tucked)
  ruler: "shoulder",     // "shoulder" | "torso"
  aspect: false,         // multiply normalized coords back to pixels first
  stance: "auto",        // "auto" | "orthodox" | "southpaw"
  minVis: 0.5,
};

const COLOR_OVER  = "#ff5d6c";   // chin above the shoulder line — the fault
const COLOR_LEVEL = "#ff9e64";
const COLOR_UNDER = "#7adf7a";   // tucked — the good one
const COLOR_INVALID = "#888";
const COLOR_FRAME = "#3ad9e0";
const COLOR_CHIN  = "#e040fb";
const COLOR_LEAD  = "#5fd1ff";

const BAND_COLOR = { over: COLOR_OVER, level: COLOR_LEVEL, under: COLOR_UNDER, filtered: COLOR_INVALID };

function b33(state) { return state.blaze33 || null; }
function refresh() { document.getElementById("video")?.dispatchEvent(new Event("seeked")); }
function fmt(v, d = 3) { return Number.isFinite(v) ? v.toFixed(d) : "—"; }

// Same frame mapping as the BlazePose inspector: aligned when the cache matches
// the primary timeline, else map through pts/time.
function frameOf(b, state) {
  const aligned = b.n_frames === state.n_frames
    && Math.abs((b.fps || 0) - (state.fps || 0)) < 0.01
    && Math.abs((b.start_sec || 0) - (state.start_sec || 0)) < 1e-3;
  if (aligned) return Math.min(Math.max(state.frame, 0), b.n_frames - 1);
  const v = (typeof document !== "undefined") && document.getElementById("video");
  const t = (v && isFinite(v.currentTime)) ? v.currentTime
    : (state.start_sec || 0) + state.frame / (state.fps || 30);
  if (b.pts && b.pts.length) {
    let lo = 0, hi = b.pts.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (b.pts[m] < t) lo = m + 1; else hi = m; }
    if (lo > 0 && Math.abs(b.pts[lo - 1] - t) <= Math.abs(b.pts[lo] - t)) lo--;
    return lo;
  }
  const f = Math.round((t - (b.start_sec || 0)) * (b.fps || 30));
  return (f >= 0 && f < b.n_frames) ? f : null;
}

function stanceOf(state) {
  if (cfg.stance !== "auto") return cfg.stance;
  const s = state.analysis?.ankleOrientation?.stance;
  return (s === "southpaw" || s === "orthodox") ? s : "orthodox";   // house default
}

// Everything the lens needs for one frame, in the CURRENTLY SELECTED coord
// space. sx/sy are the multipliers that turn normalized coords into that space.
function frameGeom(b, f, sx, sy, stance) {
  const base = f * NJ * CH;
  const gx = j => b.data[base + j * CH + X] * sx;
  const gy = j => b.data[base + j * CH + Y] * sy;
  const vis = j => b.data[base + j * CH + VIS];

  const nose = [gx(NOSE), gy(NOSE)];
  const mouth = [0.5 * (gx(MOUTH_L) + gx(MOUTH_R)), 0.5 * (gy(MOUTH_L) + gy(MOUTH_R))];
  const chin = [nose[0] + cfg.chinCoef * (mouth[0] - nose[0]),
                nose[1] + cfg.chinCoef * (mouth[1] - nose[1])];

  const lSh = [gx(L_SHOULDER), gy(L_SHOULDER)], rSh = [gx(R_SHOULDER), gy(R_SHOULDER)];
  const lead = stance === "orthodox" ? lSh : rSh;
  const shoulderWidth = Math.hypot(lSh[0] - rSh[0], lSh[1] - rSh[1]);

  const shMid = [0.5 * (lSh[0] + rSh[0]), 0.5 * (lSh[1] + rSh[1])];
  const hipMid = [0.5 * (gx(L_HIP) + gx(R_HIP)), 0.5 * (gy(L_HIP) + gy(R_HIP))];
  const torso = Math.hypot(shMid[0] - hipMid[0], shMid[1] - hipMid[1]);

  const ruler = cfg.ruler === "torso" ? torso : shoulderWidth;
  const heightNorm = ruler > 1e-9 ? (chin[1] - lead[1]) / ruler : NaN;

  const minVis = Math.min(vis(NOSE), vis(MOUTH_L), vis(MOUTH_R), vis(L_SHOULDER), vis(R_SHOULDER));
  return { nose, mouth, chin, lSh, rSh, lead, shoulderWidth, torso, ruler, heightNorm, minVis };
}

function bandOf(g) {
  if (!g || !Number.isFinite(g.heightNorm) || !(g.minVis >= cfg.minVis)) return "filtered";
  if (g.heightNorm < cfg.overLevel) return "over";
  if (g.heightNorm < cfg.levelUnder) return "level";
  return "under";
}

// Per-frame metric over the whole round. Memoized on the cache + the choices
// that change the numbers (not the band thresholds — those are cheap to reapply).
let cache = { b: null, key: "" };

function compute(state) {
  const b = b33(state);
  if (!b) return null;
  const stance = stanceOf(state);
  const key = `${cfg.chinCoef}|${cfg.ruler}|${cfg.aspect}|${stance}`;
  if (cache.b === b && cache.key === key) return cache;

  const sx = cfg.aspect ? (b.width || 1) : 1;
  const sy = cfg.aspect ? (b.height || 1) : 1;
  const n = b.n_frames;
  const hn = new Array(n).fill(NaN);
  const vis = new Array(n).fill(NaN);
  for (let f = 0; f < n; f++) {
    const g = frameGeom(b, f, sx, sy, stance);
    hn[f] = g.heightNorm;
    vis[f] = g.minVis;
  }
  cache = { b, key, n, hn, vis, sx, sy, stance };
  return cache;
}

function rollup(c) {
  const counts = { over: 0, level: 0, under: 0, filtered: 0 };
  for (let f = 0; f < c.n; f++) {
    const ok = Number.isFinite(c.hn[f]) && c.vis[f] >= cfg.minVis;
    if (!ok) { counts.filtered++; continue; }
    counts[c.hn[f] < cfg.overLevel ? "over" : c.hn[f] < cfg.levelUnder ? "level" : "under"]++;
  }
  const judged = counts.over + counts.level + counts.under;
  return { ...counts, judged };
}

let host;

export const ChinHeightRule = {
  id: "chin_height_lens",
  label: "Chin height",

  // Mouth landmarks only exist in the 33-joint cache.
  requires(slot) { return !!(slot && slot.blazepose); },

  skeletonStyle() {
    return {
      boneColor: "rgba(255,255,255,0.18)",
      boneWidth: 1.2,
      jointRadius: 2.5,
      highlightJoints: new Set([COCO.L_SHOULDER, COCO.R_SHOULDER, COCO.NOSE]),
    };
  },

  mount(_host) {
    host = _host;
    cache = { b: null, key: "" };
    host.innerHTML = `
      <h2>Chin height</h2>
      <p class="hint">
        chin = nose + <b>coef</b>·(mouth − nose), then
        <code>height_norm = (chin_y − lead_shoulder_y) / ruler</code>.
        Bands drawn across the frame:
        <span style="color:${COLOR_OVER}">over</span> ·
        <span style="color:${COLOR_LEVEL}">level</span> ·
        <span style="color:${COLOR_UNDER}">under</span>.
        Defaults are the cut points fitted on John's labels.
      </p>

      <label class="slider-row" style="display:block; font-size:12px; margin-top:6px">
        chin coef = <output id="ch-coef-out">2.25</output>
        <input type="range" id="ch-coef" min="1.0" max="3.5" step="0.05" value="2.25"></label>
      <label class="slider-row" style="display:block; font-size:12px">
        over | level = <output id="ch-ol-out">-0.42</output>
        <input type="range" id="ch-ol" min="-1.2" max="0.4" step="0.01" value="-0.42"></label>
      <label class="slider-row" style="display:block; font-size:12px">
        level | under = <output id="ch-lu-out">-0.08</output>
        <input type="range" id="ch-lu" min="-1.2" max="0.6" step="0.01" value="-0.08"></label>

      <div style="display:flex; gap:12px; align-items:center; margin-top:8px; font-size:12px; flex-wrap:wrap">
        <label>ruler
          <select id="ch-ruler">
            <option value="shoulder" selected>shoulder width</option>
            <option value="torso">torso length</option>
          </select></label>
        <label>stance
          <select id="ch-stance">
            <option value="auto" selected>auto</option>
            <option value="orthodox">orthodox</option>
            <option value="southpaw">southpaw</option>
          </select></label>
        <label title="Normalized x,y divide by width,height — so dx and dy are different lengths unless the video is square.">
          <input type="checkbox" id="ch-aspect"> aspect-correct</label>
      </div>

      <h3>Round</h3>
      <div id="ch-round" style="font-size:13px; line-height:1.6"></div>

      <h3>Current frame</h3>
      <div id="ch-frame" style="font-size:13px; line-height:1.6"></div>

      <h3>height_norm over time</h3>
      <canvas id="ch-trace" width="320" height="130"></canvas>
    `;
    mountStageTimeline();

    // cfg is module-level and survives a lens switch, but the markup above is
    // written with the DEFAULTS — so seed every control from cfg or the panel
    // lies about what the metric is using.
    const seed = (id, key, dec, out) => {
      host.querySelector(id).value = cfg[key];
      const o = out && host.querySelector(out);
      if (o) o.textContent = cfg[key].toFixed(dec);
    };
    seed("#ch-coef", "chinCoef", 2, "#ch-coef-out");
    seed("#ch-ol", "overLevel", 2, "#ch-ol-out");
    seed("#ch-lu", "levelUnder", 2, "#ch-lu-out");
    host.querySelector("#ch-ruler").value = cfg.ruler;
    host.querySelector("#ch-stance").value = cfg.stance;
    host.querySelector("#ch-aspect").checked = cfg.aspect;

    const slider = (id, key, dec, out) => {
      const s = host.querySelector(id), o = host.querySelector(out);
      s.addEventListener("input", () => {
        cfg[key] = parseFloat(s.value);
        if (o) o.textContent = cfg[key].toFixed(dec);
        refresh();
      });
    };
    slider("#ch-coef", "chinCoef", 2, "#ch-coef-out");
    slider("#ch-ol", "overLevel", 2, "#ch-ol-out");
    slider("#ch-lu", "levelUnder", 2, "#ch-lu-out");

    host.querySelector("#ch-ruler").addEventListener("change", e => { cfg.ruler = e.target.value; refresh(); });
    host.querySelector("#ch-stance").addEventListener("change", e => { cfg.stance = e.target.value; refresh(); });
    host.querySelector("#ch-aspect").addEventListener("change", e => { cfg.aspect = e.target.checked; refresh(); });
  },

  update(state) {
    if (!host || !state) return;
    const c = compute(state);
    if (!c) {
      host.querySelector("#ch-round").innerHTML = `<p class="muted" style="color:var(--bad)">No BlazePose-33 cache for this round — the chin proxy needs the mouth landmarks.</p>`;
      return;
    }
    const b = b33(state);
    const f = frameOf(b, state);
    const r = rollup(c);
    const pct = k => r.judged ? (100 * r[k] / r.judged).toFixed(1) : "0.0";

    host.querySelector("#ch-round").innerHTML = `
      <div><span style="color:${COLOR_OVER}">over</span> <code>${pct("over")}%</code>
        · <span style="color:${COLOR_LEVEL}">level</span> <code>${pct("level")}%</code>
        · <span style="color:${COLOR_UNDER}">under</span> <code>${pct("under")}%</code></div>
      <div class="muted">${r.judged} judged · ${r.filtered} filtered (vis &lt; ${cfg.minVis}) · stance ${c.stance}</div>`;

    if (f == null) {
      host.querySelector("#ch-frame").innerHTML = `<span class="muted">no BlazePose frame for this instant</span>`;
      return;
    }
    const g = frameGeom(b, f, c.sx, c.sy, c.stance);
    const band = bandOf(g);
    host.querySelector("#ch-frame").innerHTML = `
      <strong>frame ${f}:</strong>
      <span style="color:${BAND_COLOR[band]}; font-weight:600">${band}</span>
      <code style="color:${BAND_COLOR[band]}">${fmt(g.heightNorm)}</code><br>
      <span class="muted">ruler (${cfg.ruler}) <code>${fmt(g.ruler, 4)}</code>
        · shoulderW <code>${fmt(g.shoulderWidth, 4)}</code>
        · torso <code>${fmt(g.torso, 4)}</code>
        · min vis <code>${fmt(g.minVis, 2)}</code></span>`;

    drawTrace(host.querySelector("#ch-trace"), c, f);
    drawTimeline(document.getElementById("ch-timeline"), c, f);
  },

  draw(ctx, state) {
    const c = compute(state);
    if (!c) return;
    const b = b33(state);
    const f = frameOf(b, state);
    if (f == null) return;
    const s = state.renderScale || 1;
    const W = b.width || state.pose?.width || 1;
    const H = b.height || state.pose?.height || 1;

    // Geometry in the selected space, plus the multipliers back to video pixels.
    const g = frameGeom(b, f, c.sx, c.sy, c.stance);
    const toPxX = v => cfg.aspect ? v : v * W;
    const toPxY = v => cfg.aspect ? v : v * H;
    const P = p => [toPxX(p[0]), toPxY(p[1])];

    const [nx, ny] = P(g.nose), [mx, my] = P(g.mouth), [cx, cy] = P(g.chin);
    const [lx, ly] = P(g.lead);
    if (![nx, ny, cx, cy, lx, ly].every(Number.isFinite)) return;

    const band = bandOf(g);
    const col = BAND_COLOR[band];

    ctx.save();

    // Band lines across the frame: the shoulder line, and the two cut points
    // expressed back in image units. Seeing where they land on the face is the
    // whole point of the lens.
    const lineY = thr => toPxY(g.lead[1] + thr * g.ruler);
    const drawLine = (y, color, dash, label) => {
      if (!Number.isFinite(y)) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * s;
      ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ctx.canvas.width, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = `${Math.round(11 * s)}px ui-monospace, monospace`;
      ctx.textBaseline = "bottom";
      ctx.fillText(label, 6 * s, y - 2 * s);
    };
    drawLine(lineY(cfg.overLevel), COLOR_OVER, [6 * s, 5 * s], "over ↑");
    drawLine(lineY(cfg.levelUnder), COLOR_UNDER, [6 * s, 5 * s], "under ↓");
    drawLine(toPxY(g.lead[1]), COLOR_LEAD, [2 * s, 3 * s], "lead shoulder");

    // Face construction: nose → mouth → extrapolated chin.
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(cx, cy); ctx.stroke();
    const dot = (x, y, r, color) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, r * s, 0, Math.PI * 2); ctx.fill();
    };
    dot(nx, ny, 3.5, "#ffffff");
    dot(mx, my, 3, "#ffd95c");
    dot(cx, cy, 6, COLOR_CHIN);

    // THE measured quantity: vertical drop from the shoulder line to the chin.
    ctx.strokeStyle = col;
    ctx.lineWidth = 3.5 * s;
    ctx.beginPath(); ctx.moveTo(cx, toPxY(g.lead[1])); ctx.lineTo(cx, cy); ctx.stroke();
    dot(lx, ly, 5, COLOR_LEAD);

    // corner HUD
    const fsz = Math.round(13 * s), lineH = fsz + 4 * s;
    const lines = [
      [`height_norm ${fmt(g.heightNorm, 3)}`, col],
      [`band        ${band}`, col],
      [`ruler       ${cfg.ruler} ${fmt(g.ruler, 3)}`, "#fff"],
      [`coef        ${cfg.chinCoef.toFixed(2)}`, COLOR_CHIN],
      [`cuts        ${cfg.overLevel.toFixed(2)} / ${cfg.levelUnder.toFixed(2)}`, "#fff"],
      [`aspect      ${cfg.aspect ? "corrected" : "raw normalized"}`, cfg.aspect ? "#7adf7a" : "#ff9e64"],
    ];
    const padX = 10 * s, padY = 8 * s, boxW = 215 * s;
    const boxH = lines.length * lineH + padY * 2 - 4 * s;
    const bx = ctx.canvas.width - boxW - 10 * s, by = 10 * s;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 6 * s); ctx.fill();
    ctx.font = `${fsz}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    lines.forEach(([t, cc], i) => { ctx.fillStyle = cc; ctx.fillText(t, bx + padX, by + padY + i * lineH); });
    ctx.restore();
  },
};

// ── below-video timeline ────────────────────────────────────────────────────

const TL_LABEL_W = 56;

function mountStageTimeline() {
  const slot = document.getElementById("stage-extras");
  if (!slot) return;
  slot.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:12px;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px";
  const label = document.createElement("div");
  label.className = "muted small";
  label.style.cssText = "margin-bottom:6px";
  label.textContent = "Chin height band per frame (click to seek)";
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = "ch-timeline";
  canvas.style.cssText = "display:block;width:100%;height:46px";
  canvas.width = 800; canvas.height = 46;
  wrap.appendChild(canvas);
  slot.appendChild(wrap);

  canvas.addEventListener("click", e => {
    const N = cache?.n;
    if (!N) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - TL_LABEL_W) / Math.max(1, rect.width - TL_LABEL_W - 4);
    const f = Math.max(0, Math.min(N - 1, Math.round(ratio * (N - 1))));
    const slider = document.getElementById("scrubber");
    if (slider) { slider.value = f; slider.dispatchEvent(new Event("input")); }
  });
}

function bandAt(c, f) {
  if (!Number.isFinite(c.hn[f]) || !(c.vis[f] >= cfg.minVis)) return "filtered";
  return c.hn[f] < cfg.overLevel ? "over" : c.hn[f] < cfg.levelUnder ? "level" : "under";
}

function drawTimeline(canvas, c, frame) {
  if (!canvas) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.max(1, canvas.getBoundingClientRect().width);
  const cssH = Math.max(1, canvas.getBoundingClientRect().height);
  if (canvas.width !== Math.round(cssW * dpr)) canvas.width = Math.round(cssW * dpr);
  if (canvas.height !== Math.round(cssH * dpr)) canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const N = c.n;
  if (!N) return;

  const xOf = f => TL_LABEL_W + (f / Math.max(1, N - 1)) * (cssW - TL_LABEL_W - 4);
  const colW = Math.max(1, (cssW - TL_LABEL_W - 4) / Math.max(1, N - 1));
  const top = 6, h = cssH - 16;

  ctx.font = "10px ui-monospace, monospace";
  ctx.fillStyle = "#aaa";
  ctx.fillText("band", 6, top + h / 2 + 3);
  for (let f = 0; f < N; f++) {
    ctx.fillStyle = BAND_COLOR[bandAt(c, f)];
    ctx.globalAlpha = 0.9;
    ctx.fillRect(xOf(f), top, colW + 0.5, h);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = COLOR_FRAME;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 1); ctx.lineTo(xOf(frame), cssH - 1); ctx.stroke();
}

// height_norm sparkline with both cut points drawn, so the bands can be read
// straight off the distribution.
function drawTrace(canvas, c, frame) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const N = c.n;
  if (!N) return;

  let lo = Math.min(cfg.overLevel, cfg.levelUnder) - 0.2;
  let hi = Math.max(cfg.overLevel, cfg.levelUnder) + 0.2;
  for (let f = 0; f < N; f++) {
    const v = c.hn[f];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const yOf = v => H - 6 - ((v - lo) / Math.max(1e-6, hi - lo)) * (H - 14);
  const xOf = f => (f / Math.max(1, N - 1)) * W;

  for (const [thr, color] of [[cfg.overLevel, COLOR_OVER], [cfg.levelUnder, COLOR_UNDER]]) {
    ctx.strokeStyle = color;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, yOf(thr)); ctx.lineTo(W, yOf(thr)); ctx.stroke();
    ctx.setLineDash([]);
  }
  for (let f = 0; f < N; f++) {
    const v = c.hn[f];
    if (!Number.isFinite(v)) continue;
    ctx.fillStyle = BAND_COLOR[bandAt(c, f)];
    ctx.fillRect(xOf(f) - 0.5, yOf(v) - 1, 2, 2);
  }
  ctx.strokeStyle = COLOR_FRAME;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 0); ctx.lineTo(xOf(frame), H); ctx.stroke();
}
