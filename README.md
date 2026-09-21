# Cornerman rule debug viewer

A static, dependency-free web app for inspecting BlazePose Drive caches
against the
[Cornerman](https://github.com/cornerman-ai/backend) rules
engine, frame by frame. BlazePose is the only engine it reads: Apple
Vision, glove-wrist, YOLO, RTMPose, MoveNet and YOLO11 caches (Drive
`archive/`) are skipped, and the engine-era comparison lenses live in
`cornerman-archive/legacy-pose/`.

**Live**: https://cornerman-ai.github.io/debug-viewer/

## What it does

Pick the cache folder once per session, then for each round pick just
the video — the viewer auto-matches the cache files by filename. (A
manual multi-file picker is still available as a fallback.)

The viewer renders the video with a skeleton overlay and a side-panel
"lens" that re-paints the overlay and surfaces metrics for one rule at
a time. Add a new lens by dropping a file in the right [js/lenses/](js/lenses/)
subfolder (rules / models / research / inspect) and registering it in
[js/lenses/registry.js](js/lenses/registry.js) — see js/lenses/README.md.

Files stay on the user's machine — the page uses the browser File API,
nothing is uploaded.

## Workflow

1. **Cache folder** — pick `Ambo/data/skeleton_data/blazepose/`.
   The viewer indexes every `<base>_blazepose_r<N>.npy +
   <base>_blazepose_r<N>_meta.json` pair (`.bak.npy` backups skipped)
   and **merges picks** into one index. The status line reports the
   round count. Use *Clear index* to start over.
   Same workflow on Mac and Windows — no symlinks, no parent-folder
   pick.
2. **Video** — pick an `.mp4`. If its basename matches an indexed video,
   the viewer auto-loads the only round, or shows a round dropdown when
   multiple rounds exist.
3. **Lens** — switch the right-side dropdown to "Guard drop" (etc).

## Input format

BlazePose Drive cache, one set per round:

- `<stem>_blazepose_r<N>.npy` — float32, shape `(N, 33, 8)`: per joint
  per frame `x, y, z, x_world_m, y_world_m, z_world_m, visibility,
  presence`. x, y are normalised to `[0, 1]` and de-normalised to pixels
  at load time using the video's natural dimensions. Lenses read it
  remapped to COCO-17 (`state.pose`, conf = visibility); the full 33
  joints ride along as `state.blaze33`.
- `<stem>_blazepose_r<N>_meta.json` — at minimum
  `{ fps, layout: "blazepose33" }`. Any other layout is refused.
- `<stem>_blazepose_r<N>_pts.npy` (optional) — each frame's source-video
  time; `<stem>_blazepose_r<N>_punches.json` (optional) — ST-GCN
  detections.

Pick the `.npy` and `_meta.json` together via multi-select in the pose
picker.

## Lenses

The lens dropdown in the app is the authoritative list — one module per
lens in [js/lenses/](js/lenses/) (foldered by kind: rules / models /
research / inspect), registered in [js/lenses/registry.js](js/lenses/registry.js).

## Running locally

```bash
python3 -m http.server 8765
# open http://localhost:8765
```

## Adding a new lens

One module in [js/lenses/](js/lenses/) (`rules` / `models` / `research` /
`inspect`), one import + one entry in
[js/lenses/registry.js](js/lenses/registry.js). The contract, what `state`
holds, the DOM slots, the frame/time convention and the gotchas are in
[js/lenses/README.md](js/lenses/README.md) — read that before writing one.
