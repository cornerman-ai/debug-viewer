# js/lenses — one module per lens, and how to add one

A lens is one ES module that the viewer mounts when you pick it in the dropdown.
It gets the loaded round (pose cache + video) through `state`, draws on the
video canvas, fills a side panel, and can put a timeline under the video.
No build step: edit the file, reload the page.

## Adding a lens, start to finish

1. Copy the closest template into the right folder (the folder is the type;
   filenames carry no `_lens` suffix):
   - `rules/` — workbenches for shipped rules-engine rules (named after the rule)
   - `models/` — a trained model's outputs against ground truth (`impact_spotter.js`
     is the leanest model lens; `rolls_gt_vs_pred_mathe.js` and `punch_classifier.js`
     the fullest, with a zoomable timeline)
   - `research/` — `cornerman-backend/ml/research/<topic>` work (same topic names;
     `elbow_tuck.js` is the leanest metric lens, `rolls_gt.js` / `slips_gt.js` the
     Sheet-labels-only kind)
   - `inspect/` — pose / data-quality tools (`overview.js` is the minimum lens)
   - `shared/` — helpers lenses import; never in the registry
2. Export one object (the contract below) with a unique `id` and a `label`.
3. Register it in `registry.js`: one `import` line, one entry in `RULES`
   (Overview stays first; the rest are alphabetical by label). That is the only
   place the viewer learns about lenses — both dropdowns are built from `RULES`.
4. Serve the folder over http (ES modules don't load from `file://`):
   `python3 -m http.server 8765` in the repo, open http://localhost:8765, load a
   video + round, pick the lens. If the page keeps serving the old file, hard-reload
   (python's server lets the browser cache modules for a long time).
5. Data the lens fetches goes in `/lens_data/<lens id or topic>/` (fetch paths
   resolve against the page, so moving the module never breaks them). Data the
   user drops in comes through the file pickers (`state.predictionFiles`, below).

Smoke test without Drive: `node -e "import('./js/lenses/<kind>/<file>.js').then(m => console.log(Object.keys(m)))"`
catches syntax and import errors in YOUR module (importing the whole registry in node
fails on purpose-built browser code — `shared/segment_set.js` touches `window` at import);
for the rest, load a round and watch the browser console.

## The contract

```js
export const MyLens = {
  id: "my_lens",                 // slug; the <select> value
  label: "My lens",              // what the dropdown shows
  mount(host, state) {},         // build the side panel into `host` (= #rule-panel).
                                 // Called on lens pick and again whenever the round
                                 // (re)loads or the Sheet labels land — build fresh, idempotently.
  update(state) {},              // every frame change (scrub, play, step). Keep it cheap.
  draw(ctx, state) {},           // optional; every redraw, on the video canvas, AFTER the skeleton
  skeletonStyle(state) {},       // optional; overrides for the base skeleton (see below)
  requires(slot, { base, round }) {},   // optional; which cached rounds the lens can show (default: any 2D engine)
  requiresVideo(base) {},        // optional; which videos appear in the video dropdown (curated sets)
  standalone: false,             // true = mounts with no round loaded (a cross-video grid)
};
```

`skeletonStyle` keys: `boneColor`, `boneWidth`, `jointRadius`, `minConf` (hide joints
and edges below this confidence), `highlightJoints` (a `Set` of joint indices, drawn
larger), `hideJoints` (a `Set`, skipped with their edges), `showImputed` (draw the
joints the loader interpolated). Line widths are scaled by `renderScale` for you.

## What `state` holds

| field | meaning |
|---|---|
| `state.pose` | the loaded pose cache. `pose.skeleton` is a FLAT array of `n_frames × 17 × 2` pixels: joint `j` at frame `f` is `x = skeleton[(f*17+j)*2]`, `y = skeleton[(f*17+j)*2+1]`. `pose.conf[f*17+j]` is the confidence (BlazePose visibility). `pose.n_frames`, `pose.fps`, `pose.width`, `pose.height`, `pose.start_sec` (video time of cache frame 0, pre-buffer included), `pose.round_start_sec`, `pose.meta` (the parsed `_meta.json`), `pose.imputed`. Prefer `state.poseV6 || state.pose` if you want the glove-augmented cache when present. |
| `state.frame`, `state.fps`, `state.n_frames` | the current cache frame and the cache's fps |
| `state.start_sec`, `state.start_frame` | where cache frame 0 sits in the source video (`start_frame = floor(start_sec * fps)`) |
| `state.cacheBasename`, `state.cacheRound` | the video stem (cache suffix stripped) and round index — the identity to match your own data on |
| `state.renderScale` | canvas px ÷ CSS px; multiply your line widths and font sizes by it in `draw` |
| `state.labels` | the Sheet's rows for this round, loaded asynchronously (null until then; `{error, detections: []}` when the lookup failed). `labels.detections[]` = `{punch_type, start_frame, end_frame, start_time, end_time, timestamp, hand, stance, punch_uuid, labeler, reviewed}` in cache frames / cache-relative seconds — punches AND defense labels (`lead_roll`, `duck`, …); round markers excluded |
| `state.punches` | the on-device / backend punch detections when a Firebase round was loaded, else null |
| `state.predictionFiles` | `Map<filename, File>` of `predictions_*.json` files found next to the caches — how the punch lens gets its dumps |
| `state.analysis` | the on-device analysis sidecar (Firebase path) |

Joints are COCO-17: `import { J, EDGES, torsoHeight, drawSkeleton, confColor } from "../../skeleton.js"`
(`J.NOSE`, `J.L_SHOULDER`, … `J.R_ANKLE`). The house unit for any metric is torso
height (shoulder-mid ↔ hip-mid), `torsoHeight(pose, frame)`.

## The DOM you may touch

- `#rule-panel` — your side panel (the `host` passed to `mount`; cleared on every lens switch)
- `#stage-extras` — the slot under the video for a timeline; cleared on every lens
  switch, so rebuild it in `mount`
- `#scrubber` — seek by setting its value and dispatching `input`:
  `slider.value = f; slider.dispatchEvent(new Event("input"))`
- `#video` — dispatching `seeked` on it forces a full redraw (`draw` + `update`) after a
  slider change; `window.__viewerRedraw()` does the same
- `#rule-select` — read it to know whether your lens is still the active one after an
  `await` (the user may have switched while your fetch was in flight)

Never seek by setting `video.currentTime` yourself, and never store DOM nodes across
mounts — the panel is rebuilt each time.

## Time: source seconds vs cache frames

Cache frame `f` lives on source-video frame `start_frame + f`. Sheet times, `_pts.npy`
and every backend export are SOURCE-VIDEO seconds. Convert with
`frame = floor(t * fps + 1e-6) - floor(start_sec * fps + 1e-6)` and back with
`t = (start_frame + f + 0.5) / fps` — `impact_spotter.js` has both as `secToFrame` /
`frameToSec`. Do not use `Math.round` here and do not seek by raw `start_sec`; both put
the skeleton one frame off at hard cuts. Caches are 24 / 30 / 60 fps, so never assume 30.

## Data conventions

- The Sheet is read through `js/sheet-labels.js` (`state.labels`) or, for the
  defense rows of the labeler web app, `shared/slip_labels.js` (`ensureSlipLabels`,
  `computeLabelSpans(c, kindMap)` — `rolls_gt.js` is `slips_gt.js` over `ROLL_KIND`).
- Curated sets (frontal / side) and their source-second → cache-frame conversion live
  in `shared/segment_set.js` (`shared/frontal_set.js`, `shared/side_set.js`).
- A model's outputs: one JSON per round + an `index.json` under `/lens_data/<name>/`,
  keyed by `(stem, round)`, times in source seconds — `models/rolls_gt_vs_pred_mathe.js`
  documents that shape in its header and the backend script that writes it.
- `shared/punch_detections.js` = which punches a lens analyzes (GT labels, else the
  classifier's); `shared/rules_score.js` = the mistake → quality mapping of
  `rules_config.json`.

## Gotchas that have cost time

- `mount` runs before the Sheet labels arrive and again when they do — a lens that
  caches "no labels" on first mount shows nothing forever.
- `state.labels.detections` being an empty ARRAY is not "no rolls": check
  `state.labels.error` first.
- Filenames carry Unicode (`｜`, `⧸`) and YouTube ids in `[...]`; match on
  `state.cacheBasename` exactly, then fall back to substring both ways, never on a prefix.
- `getBoundingClientRect()` is 0×0 while the viewer section is hidden (no round loaded);
  size timeline canvases at draw time, not at mount.
- Wheel handlers on a timeline need `{ passive: false }` or the page scrolls instead of zooming.
