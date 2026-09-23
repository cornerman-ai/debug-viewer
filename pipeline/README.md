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

The side panel has two views, switched at its top:

- **Now** — what is under the playhead: the facing angle, the current punch and the current defensive move, each with
  the sections of the rule layers that are on.
- **Round** — the whole video. **Round score** lists every rule we have, one row each: the 0–100 score where the
  rule has one (arm extension, head off center, hit height), otherwise its rating, with the counts behind it
  underneath. Then the punch and defense distributions and the combos (counts and the most-used sequences).

The **Timeline layers** card stays below both views: it only turns timeline rows on and off, and each toggle shows
that rule's headline verdict.

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
- **Head off center line** (`head_offcenter/`): per punch thrown facing or backing the camera, how far the head is
  off a vertical line through the hips — 0.75 × at the impact frame + 0.125 × at 25 % of the punch + 0.125 × at 75 % (in torso heights), colored by band (perfect / good / bad /
  critical) with a tick at the impact frame; on the video the hip line (dashed) and the head's distance from it.
- **Offensive combos** and **Combined combos** (`combinations/`, not rules): the same rule for both — no pause longer
  than 0.3 s between elements, however long each lasts. Offensive = punches only; combined = punches and all
  defensive moves in time order (a move may start or end one). Each combination is one plain line from its first
  frame to its last (blue = offensive, purple = combined; 2 elements minimum — a lone punch or move is not a combination); hovering it lists its elements in
  order with their times; the punch card shows the combination holding that punch and how often its sequence repeats.
  Reads `offensive.csv` / `combined.csv` + `combinations.json`; the distributions card counts both (how many, how many
  different, each sequence with its count) and rates offensive combo diversity by the top-3 share (the share of
  combos that are one of the 3 most-used sequences: ≥ 70 % repetitive, 50–70 % moderate, < 50 % varied, < 10 combos
  not rated). These are "items" layers (`items: true`): their rows are the combinations,
  not the punches.

- **Elbow tuck** (`elbow_tuck/`): the research lens ported to Python — flare = |x shoulder − x elbow| / torso per arm,
  judged only while the boxer is within 45° of facing or backing the camera and that arm isn't throwing a hook. The row
  is continuous — every frame belongs to a stretch: green tucked (< 0.20), yellow borderline (0.20–0.30), red flared
  (≥ 0.30), and a thin gray strip where the rule cannot judge, with the reason in its tooltip (the boxer is side-on,
  a joint it needs is not visible, or that arm is throwing a hook). Lead in the top half, rear in the bottom; the toggle's summary
  has the per-arm share of judged frames flared and the video's rating (< 10 % tucked, 10–25 % sometimes flared,
  ≥ 25 % flared, worse arm decides). Reads `runs.csv` + `elbow_tuck.json`.

**Defense after combo** (`defense_after_combo/defense_after_combo.json`, a whole-video rule — no timeline row): under
the offensive combo list, the share of combos followed by a defensive move within 1 s of the combo's end (≥ 60 % good,
35–60 % moderate, < 35 % no defense after combos; fewer than 10 combos → not rated).

**Same punches** (`same_punches/same_punches.json`, a whole-video rule — no timeline row): under the target
distribution, the share of the 2 most-used punch types (≥ 85 % same punches, 70–85 % moderate, < 70 % varied; fewer
than 20 punches → not rated). The top 2 because jab and cross are normally the most common anyway.

**Body shots** (`bodyshots/bodyshots.json`, a whole-video rule — no timeline row): under same punches, body shots /
(body + head) over hooks and uppercuts only (the classifier can't split jab / cross into head / body): ≥ 25 % enough,
15–25 % a few, 5–15 % too few, < 5 % head only; fewer than 10 hooks + uppercuts → not rated. The old app's
bodyshot_ratio numbers.

**Same defense** (`same_defense/same_defense.json`, a whole-video rule — no timeline row): under the defense
distributions, the most-used move type (≥ 80 % same defense, 60–80 % moderate, < 60 % varied) and the most-used side
among moves that have one (≥ 80 % one-sided); fewer than 10 moves → not rated. The defense model finds rolls far
better than slips, so a high roll share is partly the model.

**Adding a rule layer**: one entry in `RULE_LAYERS` in `index.html` (key, label, the CSV / JSON it reads, and how to
parse, summarize, card, tooltip, draw its row and, optionally, draw on the video). The toggle, loading, timeline row,
hover and punch card come from that entry; nothing else changes.

Keys: Space play · ← → one frame · Shift + ← → one second · ↑ ↓ previous / next event · I jump to the impact.
