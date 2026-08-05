// Shared "bare hands only" video filter for the wrist-based lenses
// (guard_height, guard_drop).
//
// A glove obscures the wrist and moves the visible hand away from the joint the
// pose model was trained to place, so every wrist-relative reading on a gloved
// video is measuring the wrong point. Rather than let those lenses quietly
// produce wrong numbers, we keep gloved videos out of the picker entirely.
//
// Source of truth is the "Video Summary" tab of the labels Sheet (Glove =
// Yes/No/Mixed), pulled live over the same public gviz endpoint the label
// fetcher uses — no export step, no sidecar JSON. Add a video there and it
// appears (or doesn't) on the next page load.
//
// Only Glove == "no" passes. "mixed" is excluded too: the boxer is bare-handed
// for part of the clip, so a rollup would blend valid and invalid frames.
// Unlabelled rows are excluded as well — unknown is not the same as no.
//
// If the Sheet can't be reached we fail OPEN (show everything) rather than
// present an empty dropdown, matching bladedness_lens's manifest behaviour.

import { fetchGloveByVideo, fetchRows, findSourceByBasename, normalizeName } from "../sheet-labels.js";

let gloveIndex = null;    // Map<video_name, "yes"|"no"|"mixed"|"">
let gloveCounts = null;
let gloveRows = null;     // Combined Data rows, for findSourceByBasename
let gloveError = null;

async function loadGloveIndex() {
  try {
    const [{ byName, counts }, { rows }] = await Promise.all([
      fetchGloveByVideo(),
      fetchRows(),
    ]);
    gloveIndex = byName;
    gloveCounts = counts;
    gloveRows = rows;
  } catch (err) {
    gloveError = err.message || String(err);
  }
  // requiresVideo() can't answer until this lands — re-filter the dropdowns.
  window.dispatchEvent(new Event("lens-filter-changed"));
}
loadGloveIndex();

// A basename can be matched WRONGLY in two ways, and both would be worse than
// not knowing, so both resolve to "unknown" (which hides the video):
//
//   1. findSourceByBasename's third tier ('tokens' — every token of the shorter
//      name appears in the longer one) is far too loose for a short basename:
//      `round_1` "matches" a video titled "Do a full ROUND practicing a combo.
//      Today： 1 - 2 - 3…". Only exact/substr are trusted here. `_h264` / `_r0`
//      tails are still handled, by the substr tier.
//
//   2. Ambiguity: the Sheet holds both "Learn This Deadly Boxing Combo.mp4"
//      (Glove=no) and "Learn This Deadly Boxing Combo🥊💥 [zRBL7ISpYGk].mp4"
//      (Glove=yes). One name contains the other, so the matcher picks whichever
//      has more label rows — and a gloved video sails through as bare-handed.
//      When several sheet names match one basename and disagree on gloves we
//      return "conflict", which fails closed and names the problem in the panel.
const gloveMemo = new Map();

// base (cache basename) → { glove, name } | null when the video can't be
// resolved. `glove` is "" for a row with an empty Glove cell.
export function gloveFor(base) {
  if (!gloveIndex || !gloveRows || !base) return null;
  if (gloveMemo.has(base)) return gloveMemo.get(base);

  let result = null;
  const src = findSourceByBasename(gloveRows, base);
  if (src && (src.confidence === "exact" || src.confidence === "substr")) {
    const glove = gloveIndex.get(src.name);
    if (glove !== undefined) {
      const stem = normalizeName(base.replace(/_(yolo|vision|blazepose)_r\d+$/i, ""));
      const rival = new Set();
      for (const [name, g] of gloveIndex) {
        const n = normalizeName(name);
        if (n && (n === stem || stem.includes(n) || n.includes(stem))) rival.add(g);
      }
      result = { glove: rival.size > 1 ? "conflict" : glove, name: src.name };
    }
  }
  gloveMemo.set(base, result);
  return result;
}

export function isGlovelessVideo(base) {
  if (gloveError) return true;        // Sheet unreachable → don't hide anything
  if (!gloveIndex) return false;      // still loading; the event re-filters
  return gloveFor(base)?.glove === "no";
}

// One line for a lens panel: what the video dropdown is filtered to, and where
// the loaded video sits in that filter. Called per frame, so keep it cheap
// (gloveFor is memoised per basename).
export function gloveNote(state) {
  if (gloveError) {
    return `<span class="bad">Video Summary unreachable (${gloveError})</span> — ` +
           `glove filter off, every video is listed.`;
  }
  if (!gloveCounts) return `Loading glove labels from the Sheet…`;
  const c = gloveCounts;
  const hidden = c.yes + c.mixed + c.unlabelled;
  const here = gloveFor(state?.cacheBasename);
  const mine = here === null
    ? `This video isn't in the Video Summary tab.`
    : here.glove === "no"
      ? `<span class="good">This video: bare hands.</span>`
      : here.glove === "conflict"
        ? `<span class="bad">This video matches two Video Summary rows that disagree on Glove</span> — fix the duplicate in the Sheet.`
        : `<span class="bad">This video: Glove = ${here.glove || "(unlabelled)"}</span> — readings are unreliable.`;
  return `${mine} Dropdown shows the ${c.no} bare-handed videos; ` +
         `${hidden} hidden (${c.yes} gloved, ${c.mixed} mixed, ${c.unlabelled} unlabelled). ` +
         `Fill the Glove column in the Sheet and reload to unhide more.`;
}
