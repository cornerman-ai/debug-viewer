// Drag-to-select a frame range on a lens's stage timeline, with a toolbar in
// the timeline header to export it as a clip (the viewer's own clip export,
// `window.__viewerExportRange`, the current lens overlay burned in), zoom to
// it, or clear it. Shared by the two Rolls GT vs Pred lenses; any lens with a
// frame <-> x mapping can use it. Not a lens.
//
// The lens keeps owning its canvas, zoom window and mapping. It calls
// `beginDrag` from its mousedown (a plain drag selects; a release without
// movement is a click and seeks), `draw` from its own drawTimeline (before the
// playhead), and `clear` when the round changes. Frames are the viewer's cache
// frames, the unit the clip export takes. The selection lives in frames, so it
// survives zooming and panning.

const BAND = "rgba(58,217,224,0.14)", EDGE = "rgba(58,217,224,0.9)";
const BTN_CSS = "background:var(--bg-elev);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:2px 9px;cursor:pointer;font:inherit;font-size:12px;line-height:1.4";
const DRAG_PX = 3;   // a press that moves less than this is a click

// { header, frameToX(f, cssW), xToFrame(x, cssW), frameToSec(f), nFrames(),
//   seek(f), zoomTo(a, b), redraw() } → { beginDrag(e, rect), draw(...), clear(), get() }
export function createRangeSelection({ header, frameToX, xToFrame, frameToSec, nFrames, seek, zoomTo, redraw }) {
  let sel = null;                 // { a, b }: inclusive viewer frames, a <= b

  // toolbar: between the header's label and its zoom buttons, hidden until a range exists
  const bar = document.createElement("span");
  bar.style.cssText = "display:none;align-items:center;gap:6px;white-space:nowrap";
  const text = document.createElement("span");
  text.className = "muted small";
  bar.appendChild(text);
  const mkBtn = (label, title, onClick) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.title = title; b.style.cssText = BTN_CSS;
    b.addEventListener("click", onClick); bar.appendChild(b);
  };
  mkBtn("Export", "Export the selected frames with the current lens overlay burned in", () => {
    if (!sel) return;
    if (typeof window.__viewerExportRange !== "function") { alert("This viewer build has no clip export."); return; }
    window.__viewerExportRange(sel.a, sel.b);
  });
  mkBtn("Zoom to", "Zoom the timeline to the selection", () => { if (sel) zoomTo(sel.a, sel.b); });
  mkBtn("×", "Clear the selection", () => clear());
  header.insertBefore(bar, header.querySelector("button"));

  const fmtT = (f) => {
    const s = frameToSec(f), m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
  };
  function update() {
    if (!sel) { bar.style.display = "none"; return; }
    bar.style.display = "inline-flex";
    text.textContent = `selected ${fmtT(sel.a)}–${fmtT(sel.b)} · ${(frameToSec(sel.b + 1) - frameToSec(sel.a)).toFixed(1)} s · ${sel.b - sel.a + 1} f`;
  }
  function clear() { sel = null; update(); redraw(); }

  // mousedown on the canvas: drag = select, release without movement = seek
  function beginDrag(e, rect) {
    const W = rect.width;
    const clampF = (f) => Math.max(0, Math.min(Math.max(0, nFrames() - 1), Math.round(f)));
    const f0 = clampF(xToFrame(e.clientX - rect.left, W));
    const originX = e.clientX;
    let moved = false;
    const onMove = (ev) => {
      if (!moved && Math.abs(ev.clientX - originX) <= DRAG_PX) return;
      moved = true;
      const f = clampF(xToFrame(ev.clientX - rect.left, W));
      sel = { a: Math.min(f0, f), b: Math.max(f0, f) };
      update(); redraw();
    };
    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (!moved) { seek(clampF(xToFrame(ev.clientX - rect.left, W))); return; }
      update(); redraw();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // the band over the rows (left..right = the track's x range, top..bottom = the rows)
  function draw(ctx, cssW, left, right, top, bottom) {
    if (!sel) return;
    const x1 = frameToX(sel.a, cssW), x2 = Math.max(x1 + 1, frameToX(sel.b + 1, cssW));
    if (x2 < left || x1 > right) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
    ctx.fillStyle = BAND; ctx.fillRect(x1, top, x2 - x1, bottom - top);
    ctx.strokeStyle = EDGE; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x1) + 0.5, top); ctx.lineTo(Math.round(x1) + 0.5, bottom);
    ctx.moveTo(Math.round(x2) - 0.5, top); ctx.lineTo(Math.round(x2) - 0.5, bottom);
    ctx.stroke();
    ctx.restore();
  }

  return { beginDrag, draw, clear, get: () => sel };
}
