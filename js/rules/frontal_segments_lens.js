// Frontal segments lens — the curated "camera stands where the opponent would
// be" set for the bladedness work.
//
// This is a BROWSING lens, not a metric lens. It answers one question about the
// round you have loaded: "is this footage part of the curated frontal set, and
// if so, which frames?" Everything outside a curated span is greyed out, so you
// can scrub a whole round and see at a glance which parts count.
//
// Data: ./data/frontal_segments.json — a copy of the backend's source of truth.
// Refresh with:
//     cp ~/code/cornerman-backend/bladedness/frontal_segments.json \
//        ~/code/cornerman-debug-viewer/data/frontal_segments.json
//
// TIME BASE (the thing that silently breaks): manifest times are SOURCE-VIDEO
// seconds, but a cache holds one round starting at `pose.start_sec`. We convert
// with the viewer's own start-frame convention —
//     cacheFrame = floor(t * fps) - floor(start_sec * fps)
// — matching how the viewer seeks (see the frame-index note in viewer.js). The
// backend uses the cache's `_pts.npy` clock instead, which is authoritative when
// pts is non-uniform; if a span ever looks a frame or two off here, that's why.

const DATA_URL = "./data/frontal_segments.json";

const COLOR_IN      = "#7adf7a";  // green — inside a curated span
const COLOR_OUT     = "#888";     // grey  — outside
const COLOR_MISS    = "#ff5d6c";  // red   — this video isn't in the set at all
const COLOR_FRAME   = "#3ad9e0";  // cyan  — current-frame marker
const COLOR_ACCENT  = "#b48cff";

// ── manifest loading ────────────────────────────────────────────────────────

let manifest = null;        // { segments: {stem: [{label,start_sec,end_sec}]} }
let manifestError = null;
let manifestPromise = null;

async function loadManifest() {
  if (manifest || manifestError) return;
  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    manifestError = err.message || String(err);
  }
  // The video dropdown filters on requiresVideo(), which can't answer until
  // this lands — tell the viewer to re-filter now that it can.
  window.dispatchEvent(new Event("lens-filter-changed"));
}

// Kick the fetch off at module load (registry.js imports every lens on page
// load), so by the time the user connects a Drive folder and picks this lens
// the manifest is already in and the dropdown filters on the first paint.
manifestPromise = loadManifest();

// Stems in the wild pick up `_prepared` / `_h264` re-encode tails, and these
// YouTube titles contain double spaces that are easy to lose in a copy-paste.
// Normalise both sides before comparing.
function normStem(s) {
  return String(s || "")
    .replace(/_(prepared|h264)$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchEntry(basename) {
  if (!manifest || !basename) return null;
  const segs = manifest.segments || {};
  if (segs[basename]) return { stem: basename, spans: segs[basename] };
  const want = normStem(basename);
  for (const [stem, spans] of Object.entries(segs)) {
    if (normStem(stem) === want) return { stem, spans };
  }
  return null;
}

// ── span → cache-frame mapping ──────────────────────────────────────────────

let cache = { pose: null, basename: null };

function pickPose(state) {
  return state.poseV6 || state.pose;
}

function compute(state) {
  const pose = pickPose(state);
  if (!pose) return null;
  const basename = state.cacheBasename || null;
  if (cache.pose === pose && cache.basename === basename) return cache;

  const n = pose.n_frames;
  const fps = pose.fps || state.fps || 30;
  const startSec = Number(pose.start_sec || 0);
  const startFrame = Math.floor(startSec * fps);

  const entry = matchEntry(basename);
  const inSpan = new Uint8Array(n);          // 1 = frame is in a curated span
  const ranges = [];                         // [{label, s, e, startSec, endSec}]

  if (entry) {
    // An open-ended span ("R0 starts at 151.014") runs until the NEXT span on
    // the same video starts, not to the end of the video — otherwise R0 and R1
    // both claim every frame of every round.
    const ordered = [...entry.spans].sort((a, b) => (a.start_sec ?? 0) - (b.start_sec ?? 0));
    const resolved = ordered.map((sp, i) => {
      const inherited = sp.end_sec == null && ordered[i + 1]?.start_sec != null;
      return {
        ...sp,
        _end: sp.end_sec != null ? sp.end_sec : (ordered[i + 1]?.start_sec ?? null),
        // An explicit end_sec is inclusive; an end inherited from the next
        // span's start is exclusive — R0 stops one frame BEFORE R1 begins.
        _endExclusive: inherited,
      };
    });

    for (const sp of resolved) {
      // null start = video start; null end = runs to the end of the cache.
      const s = sp.start_sec == null ? 0 : Math.floor(sp.start_sec * fps) - startFrame;
      const e = sp._end == null
        ? n - 1
        : Math.floor(sp._end * fps) - startFrame - (sp._endExclusive ? 1 : 0);
      const cs = Math.max(0, Math.min(n - 1, s));
      const ce = Math.max(0, Math.min(n - 1, e));
      // A span that lands entirely outside this round belongs to a different
      // round of the same video — skip it rather than clamping it to a sliver.
      if (e < 0 || s > n - 1) continue;
      for (let f = cs; f <= ce; f++) inSpan[f] = 1;
      ranges.push({ label: sp.label, s: cs, e: ce, startSec: sp.start_sec, endSec: sp._end });
    }
    ranges.sort((a, b) => a.s - b.s);
  }

  let nIn = 0;
  for (let f = 0; f < n; f++) if (inSpan[f]) nIn++;

  cache = { pose, basename, n, fps, startSec, entry, inSpan, ranges, nIn };
  return cache;
}

function fmtTime(sec) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

function shortStem(s, max = 46) {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

// ── lens ────────────────────────────────────────────────────────────────────

let host = null;
let mountToken = 0;

export const FrontalSegmentsRule = {
  id: "frontal_segments_lens",
  label: "Frontal segments (curated)",

  skeletonStyle() {
    return { boneColor: "rgba(255,255,255,0.25)", boneWidth: 1.5, jointRadius: 3 };
  },

  // Per-video filter for the Drive dropdown: only the curated videos are
  // selectable while this lens is active. Pending ⇒ hide (the dispatch in
  // loadManifest re-filters the moment the data lands). Failed ⇒ show
  // everything: an unexplained empty dropdown would be a dead end, since the
  // sidebar that carries the error only mounts once a round is loaded.
  requiresVideo(base) {
    if (manifestError) return true;
    if (!manifest) return false;
    return !!matchEntry(base);
  },

  mount(_host, state) {
    host = _host;
    cache = { pose: null, basename: null };
    host.innerHTML = `<h2>Frontal segments</h2><p class="hint">Loading manifest…</p>`;
    mountStageTimeline();

    const token = ++mountToken;
    (manifestPromise || loadManifest()).then(() => {
      if (token !== mountToken || !host) return;   // lens switched mid-fetch
      renderShell();
      refresh();
    });
    if (state) { /* state arrives again via update() once data is in */ }
  },

  update(state) {
    if (!host || !state || (!manifest && !manifestError)) return;
    if (!host.querySelector("#fs-status")) renderShell();

    const c = compute(state);
    const statusEl = host.querySelector("#fs-status");
    const spansEl = host.querySelector("#fs-spans");
    const frameEl = host.querySelector("#fs-frame");
    if (!statusEl) return;

    if (!c) {
      statusEl.innerHTML = `<p class="muted">No pose cache loaded.</p>`;
      if (spansEl) spansEl.innerHTML = "";
      if (frameEl) frameEl.innerHTML = "";
      return;
    }

    if (!c.entry) {
      statusEl.innerHTML =
        `<div style="color:${COLOR_MISS}; font-weight:600">NOT in the curated set</div>
         <div class="muted small" style="margin-top:2px">stem: <code>${c.basename || "—"}</code></div>`;
      if (spansEl) spansEl.innerHTML = `<p class="muted small">Load one of the videos listed below.</p>`;
    } else {
      const pct = c.n ? (100 * c.nIn / c.n) : 0;
      statusEl.innerHTML =
        `<div style="color:${COLOR_IN}; font-weight:600">IN the curated set</div>
         <div class="muted small" style="margin-top:2px">stem: <code>${shortStem(c.entry.stem, 60)}</code></div>
         <div style="margin-top:4px"><code>${c.nIn}</code> / ${c.n} frames curated
           <span class="muted">(${pct.toFixed(1)}% of this round)</span></div>`;
      if (spansEl) {
        spansEl.innerHTML = c.ranges.length
          ? c.ranges.map((r, i) =>
              `<div class="fs-span" data-i="${i}" style="cursor:pointer; padding:3px 0; border-bottom:1px solid var(--border)">
                 <code style="color:${COLOR_ACCENT}">${r.label}</code>
                 <span class="muted small"> src ${fmtTime(r.startSec)} → ${fmtTime(r.endSec)}</span><br>
                 <span class="small">frames <code>${r.s}</code>–<code>${r.e}</code> · ${(r.e - r.s + 1)} fr</span>
               </div>`).join("")
          : `<p class="muted small">This video is in the set, but none of its spans
             fall inside this round's frame range — try another round.</p>`;
        spansEl.querySelectorAll(".fs-span").forEach(el => {
          el.addEventListener("click", () => seekTo(c.ranges[+el.dataset.i].s));
        });
      }
    }

    const f = state.frame;
    const inNow = c.entry && c.inSpan[f];
    if (frameEl) {
      frameEl.innerHTML =
        `<strong>frame ${f}</strong> ·
         <span style="color:${inNow ? COLOR_IN : COLOR_OUT}; font-weight:600">
           ${inNow ? "in span" : "outside"}</span>
         <span class="muted small"> · src ${fmtTime(c.startSec + f / c.fps)}</span>`;
    }

    drawTimeline(document.getElementById("fs-timeline"), c, f);
  },

  draw(ctx, state) {
    const c = compute(state);
    if (!c) return;
    const s = state.renderScale || 1;
    const inNow = c.entry && c.inSpan[state.frame];

    // Frame the video in red whenever you're looking at footage that is NOT
    // part of the curated set — the whole point of this lens is that you can't
    // miss it while scrubbing.
    if (!inNow) {
      ctx.save();
      ctx.strokeStyle = COLOR_MISS;
      ctx.lineWidth = 4 * s;
      ctx.globalAlpha = 0.85;
      ctx.strokeRect(2 * s, 2 * s, ctx.canvas.width - 4 * s, ctx.canvas.height - 4 * s);
      ctx.restore();
    }

    const label = !c.entry ? "VIDEO NOT IN SET"
                : inNow ? "IN CURATED SPAN"
                : "OUTSIDE SPAN";
    const color = inNow ? COLOR_IN : COLOR_MISS;
    const fsz = Math.round(14 * s);
    ctx.save();
    ctx.font = `600 ${fsz}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    const w = ctx.measureText(label).width + 20 * s;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath(); ctx.roundRect(10 * s, 10 * s, w, fsz + 14 * s, 6 * s); ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(label, 20 * s, 17 * s);
    ctx.restore();
  },
};

// ── sidebar shell ───────────────────────────────────────────────────────────

function renderShell() {
  if (manifestError) {
    host.innerHTML =
      `<h2>Frontal segments</h2>
       <div style="color:${COLOR_MISS}">frontal_segments.json failed to load — ${manifestError}</div>
       <p class="hint">Refresh it with<br>
         <code>cp ~/code/cornerman-backend/bladedness/frontal_segments.json
         ~/code/cornerman-debug-viewer/data/frontal_segments.json</code></p>`;
    return;
  }

  const segs = manifest?.segments || {};
  const stems = Object.keys(segs);
  const nSpans = stems.reduce((a, k) => a + segs[k].length, 0);

  host.innerHTML = `
    <h2>Frontal segments</h2>
    <p class="hint">
      The curated set where the camera stands roughly where the opponent would
      be. Selected on gaze / punch direction — <em>not</em> on shoulder
      squareness, so bladed boxers are deliberately still in here.
      <span style="color:${COLOR_IN}">green</span> = curated,
      <span style="color:${COLOR_OUT}">grey</span> = outside.
    </p>

    <h3>This round</h3>
    <div id="fs-status" style="font-size:13px; line-height:1.6"></div>

    <h3>Spans here <span class="muted small">(click to jump)</span></h3>
    <div id="fs-spans" style="font-size:12px"></div>

    <h3>Current frame</h3>
    <div id="fs-frame" style="font-size:13px; line-height:1.6"></div>

    <h3>Whole set <span class="muted small">${stems.length} videos · ${nSpans} spans</span></h3>
    <div id="fs-list" style="font-size:11px; line-height:1.5; max-height:260px; overflow:auto">
      ${stems.map(k => `
        <div title="${k.replace(/"/g, "&quot;")}" style="padding:2px 0; border-bottom:1px solid var(--border)">
          <span style="color:${COLOR_ACCENT}">${segs[k].map(s => s.label).join(", ")}</span>
          — ${shortStem(k)}
        </div>`).join("")}
    </div>`;
}

// ── below-video timeline ────────────────────────────────────────────────────

function refresh() {
  document.getElementById("video")?.dispatchEvent(new Event("seeked"));
}

function seekTo(f) {
  const slider = document.getElementById("scrubber");
  if (!slider) return;
  slider.value = f;
  slider.dispatchEvent(new Event("input"));
}

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
  label.textContent = "Curated frontal spans (click to seek)";
  wrap.appendChild(label);
  const canvas = document.createElement("canvas");
  canvas.id = "fs-timeline";
  canvas.style.cssText = "display:block;width:100%;height:40px";
  canvas.width = 800; canvas.height = 40;
  wrap.appendChild(canvas);
  slot.appendChild(wrap);

  canvas.addEventListener("click", e => {
    const N = cache?.n;
    if (!N) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - TL_LABEL_W) / Math.max(1, rect.width - TL_LABEL_W - 4);
    seekTo(Math.max(0, Math.min(N - 1, Math.round(ratio * (N - 1)))));
  });
}

function drawTimeline(canvas, c, frame) {
  if (!canvas) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.max(1, canvas.getBoundingClientRect().width);
  const cssH = Math.max(1, canvas.getBoundingClientRect().height);
  if (canvas.width !== Math.round(cssW * dpr))  canvas.width  = Math.round(cssW * dpr);
  if (canvas.height !== Math.round(cssH * dpr)) canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssH;
  ctx.clearRect(0, 0, W, H);
  const N = c.n;
  if (!N) return;

  const xOf = f => TL_LABEL_W + (f / Math.max(1, N - 1)) * (W - TL_LABEL_W - 4);
  const colW = Math.max(1, (W - TL_LABEL_W - 4) / Math.max(1, N - 1));

  const top = 6, barH = H - 18;
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillStyle = c.entry ? COLOR_IN : COLOR_MISS;
  ctx.fillText(c.entry ? "curated" : "not in set", 6, top + barH / 2 + 3);

  for (let f = 0; f < N; f++) {
    ctx.fillStyle = c.entry && c.inSpan[f] ? COLOR_IN : COLOR_OUT;
    ctx.globalAlpha = c.entry && c.inSpan[f] ? 0.9 : 0.35;
    ctx.fillRect(xOf(f), top, colW + 0.5, barH);
  }
  ctx.globalAlpha = 1;

  // span labels along the bottom
  ctx.fillStyle = COLOR_ACCENT;
  for (const r of c.ranges) {
    ctx.fillText(r.label, Math.min(W - 20, xOf(r.s) + 2), H - 4);
  }

  ctx.strokeStyle = COLOR_FRAME;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(xOf(frame), 1); ctx.lineTo(xOf(frame), H - 1); ctx.stroke();
}
