# Pipeline viewer

**Live**: https://cornerman-ai.github.io/debug-viewer/pipeline/

One page, `index.html`, for the four base stages of one full-pipeline test video on one timeline, synced with the
video: punches (`punch_classification/`) with their impact frame drawn on each punch (`punch_impact/`), defensive
moves (`defense_classification/`) and the continuous facing angle (`facing_angle/`). No build, no dependencies; like
the rule debug viewer, files stay on your machine — the page reads them through the browser, nothing is uploaded.

The stage folders are written by the backend's `combined_pipeline/research/` scripts (`run_punches.py`,
`run_impact.py`, `run_defense.py`, `run_facing_angle.py`) into Drive `Ambo/data/pipeline_tests/<video>/`.

## Opening it

Chrome or Edge (it reads folders with the File System Access API) and Google Drive for desktop. **Open Folder…**:

- the Ambo **data** folder → a dropdown of every video folder in `pipeline_tests/`; the folder is remembered, so
  next time **Continue with “data”** reopens it;
- or one video folder, e.g. `pipeline_tests/2 rounds bagwork, working on balance [r1puy8]_CUT/`. The video and
  skeleton live outside that folder (`raw_videos/full_pipeline_test_videos/`, `skeleton_data/full_pipeline_test_videos/`),
  so the page asks to link the data folder once, or to pick the video file by hand.

It reads `punch_impact/impacts.csv` (falls back to `punch_classification/punches.csv`), `punch_classification/punches.json`
(fps, stance, video name), `defense_classification/defenses.csv`, `facing_angle/facing_angle.csv`, the video, and the
`*_blazepose_full.npy` skeleton for the stick figure. A missing stage is named in the timeline header; the rest still works.
The rule layers read `arm_extension/arm_extension.{csv,json}`, `hip_rotation/hip_rotation.csv`, `hit_height/hit_height.{csv,json}` and `head_offcenter/head_offcenter.{csv,json}`
when present, joined to the punches by start frame and hand.

Over HTTP (a static server with Range support rooted at the data folder, serving this page from the same origin):
`index.html?data=<url of data/>&video=<folder name>` — used for testing.

## Using it

Timeline rows: facing angle (0° = to the camera, ±180° = back), lead and rear punches (white tick = impact frame),
defense, and an overview of the whole video (drag it to move the window). Scroll to zoom, drag to pan, click to seek,
hover for details; the chips in the side panel hide or show a punch / defense type. On the video: the skeleton, a ring
on the punching wrist around impact, and pills naming the current punch / move.

**Rule layers** (side panel, all off by default, the choice is remembered): each adds a timeline row, a section in
the punch card and a video overlay for the punch under the playhead. Colors: green = fine, orange = too little,
red = wrong / too much, gray = not judged.

- **Arm extension** (`arm_extension/`): per jab / cross the production rule's verdict (pass / fail; skipped = dashed),
  its elbow bend and a white tick at the frame the rule measured; on the video the punching arm in the verdict color
  with this frame's elbow bend.
- **Hip rotation** (`hip_rotation/`): per punch the start → impact rotation against a good band of 2× the study's IQR (block color and
  degrees); on the video the hip line in the verdict color. The impact → end step is in the CSV but not shown.
- **Hit height** (`hit_height/`): per jab / cross the production rule's zone (head / shoulder / body / over the head /
  below the belt; on target = green, off = red, skipped = dashed gray) with a white tick at the frame it judged; hooks
  and uppercuts get the same zones read at their impact frame (lighter, dashed). On the video a ring on the fist at the
  judged frame with its zone.
- **Head off center line** (`head_offcenter/`): per punch thrown facing or backing the camera, how far the head got
  off a vertical line through the hips (in torso heights), colored by band (perfect / good / bad / critical) with a
  tick at the furthest frame; on the video the hip line (dashed) and the head's distance from it.

**Adding a rule layer**: one entry in `RULE_LAYERS` in `index.html` (key, label, the CSV / JSON it reads, and how to
parse, summarize, card, tooltip, draw its row and, optionally, draw on the video). The toggle, loading, timeline row,
hover and punch card come from that entry; nothing else changes.

Keys: Space play · ← → one frame · Shift + ← → one second · ↑ ↓ previous / next event · I jump to the impact.
