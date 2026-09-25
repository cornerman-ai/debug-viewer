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

Timeline rows: facing angle (0° = to the camera, ±180° = back) — split at ±45° and ±135° into the front / side-on / back bands every gated rule reads, each frame’s dot coloured by its band, lead and rear punches (white tick = impact frame),
defense, and an overview of the whole video (drag it to move the window). Scroll to zoom, drag to pan, click to seek,
hover for details; the chips in the side panel hide or show a punch / defense type. On the video: the skeleton, a ring
on the punching wrist around impact, and pills naming the current punch / move.

The side panel has two views, switched at its top:

- **Now** — what is under the playhead: the facing angle, the current punch and the current defensive move, each with
  the sections of the rule layers that are on.
- **Round** — the whole video. **Round score** lists every rule we have, one row each: the 0–100 score where the
  rule has one (arm extension, head off center, hit height), otherwise its rating, and under it four lines — what the
  rule measures, what it was measured on, its thresholds, and the sum that produced the number. Then the punch and defense distributions and the combos (counts and the most-used sequences).

The **Timeline layers** card stays below both views: it only turns timeline rows on and off, and each toggle shows
that rule's headline verdict.

**Rule layers** (side panel, all off by default, the choice is remembered): each adds a timeline row, a section in
the punch card and a video overlay for the punch under the playhead. Colors: green = fine, orange = too little,
red = wrong / too much. A stretch the rule threw out — a joint it needs not visible, a punch in flight, the wrong
camera angle — is a **dashed gray mid-line carrying the reason**: `joint hidden`, `side-on`, `front-on`,
`punching` or `hook`, written on the strip when there is room for it and in the tooltip always. The row is
continuous, so a gray stretch never means "nothing happened" — it means the rule could not look, and says why.

- **Hand drop before punch** (`hand_drop/`): per punch, how far the throwing hand dipped below ITS OWN guard in the
  0.4 s before the punch started (green no dip, red dips at ≥ 0.25 torso), with the dip on the block. Reads
  `punches.csv` + `hand_drop.json`.
- **Punch speed** (`punch_speed/`): per punch, the time from its first frame to the impact, with the milliseconds
  on the block — green inside the band for that punch type, red above it. The band is the upper quartile of the
  type across 8,166 labelled punches, shifted onto our own detector (a person marks a punch's start at the windup,
  the decoder starts it later). Every angle is judged: a time is not foreshortened. Round rating = the share of
  judged punches above their band (< 10 % sharp, 10–25 % mixed, ≥ 25 % slow). Reads `punches.csv` +
  `punch_speed.json`.
- **Balance at impact** (`balance/`): per punch, where the head sits across the base of support — the widest span
  of the ankles, heels and toes — at the impact frame, read side-on. Green inside the feet, red past either edge,
  with the position on the block; nothing drawn for punches thrown head-on or with the feet out of view. The card
  and tooltip carry the shoulders and hips too, unjudged, so a lean can be told from a lunge. Round rating = the
  share of judged punches whose head left the base (< 5 % balanced, 5–15 % sometimes, ≥ 15 % falls in). Reads
  `punches.csv` + `balance.json`.
- **Hand return path** (`hand_return_path/`): per jab / cross, between the landing and the end of the punch, the
  fist's height against its own shoulder must not drop below where it was at the punch's start or where it was at
  impact; the dip is measured from the lower of those two, so a punch that started or landed low is not punished
  for being there. Green under 0.10 torso, red at or above, with the dip on the block; punches with no impact
  frame, a lost wrist or a tracking jump are not drawn. Every angle is judged — the measurement is vertical. Round
  = the worst 10 % of punch scores, banded 95/80/55. The lens's own 1.5 s window and descent/recovery pair were
  tried first and read 42 % / 58 % — see `combined_pipeline/changes.md`. Reads `punches.csv` +
  `hand_return_path.json`.
- **Idle hand at impact** (`idle_hand/`): per punch, the hand that is NOT throwing, read at the impact frame —
  how far it sits below the nose. Green up, red low at ≥ 0.40 torso (the same line guard height uses, an absolute one: a boxer
  who holds his hands low all round must not pass), nothing drawn where the idle wrist isn't visible. That hand's
  own median guard is shown in the card beside the verdict, unjudged. Round rating = the share of judged punches
  whose idle hand was low (< 10 % holds, 10–25 % sometimes drops, ≥ 25 % drops). One frame and not the punch's
  window because punches overlap inside a combination, which would leave most punches unjudgeable.
  Reads `punches.csv` + `idle_hand.json`.
- **Arm extension** (`arm_extension/`): per jab / cross the production rule's verdict (pass / fail; skipped = dashed),
  its elbow bend and a white tick at the frame the rule measured; on the video the punching arm in the verdict color
  with this frame's elbow bend.
- **Hip rotation** (`hip_rotation/`): per punch the start → impact rotation against a good band of 2× the study's IQR (block color and
  degrees); the round rating is the share of judged punches inside the band (≥ 80 % good, 65–80 % mixed, < 65 % poor, from `hip_rotation.json`); on the video the hip line in the verdict color. The impact → end step is in the CSV but not shown.
- **Shoulder rotation** (`shoulder_rotation/`): the hip rule moved to the shoulders — per punch the start → impact
  turn of the punching shoulder against a good band of 2× the study's IQR for that punch type, block coloured by
  verdict with the degrees on it; on the video the shoulder line in the verdict colour. The CSV also carries
  `shoulder_minus_hip`, the separation the biomechanics papers measure, unjudged for now.
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
  not rated) — combined combos get the same rating, with the caveat that the defense model's noise inflates it. These are "items" layers (`items: true`): their rows are the combinations,
  not the punches.

- **Guard after combo** (`guard_recovery/`): per combined combo, each hand's mean height over the 4 frames before it
  started against 0.33–0.43 s after its last frame — past the ~0.17 s a hand needs to come home. One bar per combo,
  green when both hands are back, red when the worse one is still ≥ 0.15 torso lower; hovering gives both hands'
  numbers. Combos whose windows are touched by another punch or move, or missing a joint, are not drawn. Round
  rating = the share of judged combos that ended with the guard down (< 20 % recovers, 20–40 % sometimes, ≥ 40 %
  hands stay down). An "items" layer. Reads `combos.csv` + `guard_recovery.json`.
- **Slip distance** (`slip_distance/`): per slip, how far the head travelled sideways from where it started, in
  torso lengths, with a white tick at the furthest frame (orange < 0.20 too short, green 0.20–0.70, red > 0.70 too
  far). Rolls and ducks are not measured. Judged front-on / back-on only. Reads `moves.csv` + `slip_distance.json`.
- **Guard height** (`guard_height/`): per hand, how far the wrist sits below the nose in torso lengths while that
  hand is not punching — low above 0.40, the same absolute line the idle-hand rule uses (the lens says 0.30). Continuous row, lead in the top half, rear in the bottom: green guard up,
  red low, and a dashed gray line for everything the rule could not look at — that hand throwing, or a joint not
  visible. Round rating = the share of judged frames low on the worse hand, every frame counting however brief
  (< 10 % good, 10–25 % sometimes low, ≥ 25 % low). Reads `runs.csv` + `guard_height.json`.
- **Chin height** (`chin_height/`) and **Chin depth** (`chin_depth/`): both per frame outside punches, both
  continuous rows, both reading the skeleton chin (`nose + 2.25 × nose→mouth` — BlazePose has no jaw landmark).
  Height is the chin against a line at the lead shoulder in shoulder widths, with the lens's own bands (red chin up,
  orange level, green tucked) — those two cut-offs were fitted on a coach's labels. Depth is the chin against the
  shoulder's front (the lead keypoint pushed forward 0.101 torso) in torso lengths, red past 0.10, read side-on
  only. A dashed gray line is everything the rule could not look at: a joint not visible, a punch in flight, or the
  wrong camera angle. Round rating = the share of judged frames that are bad, every frame counting however
  brief: < 15 % good, 15–30 % sometimes, ≥ 30 % bad. Read `runs.csv` + the stage's `.json`.
- **Stance width** (`stance_width/`) and **Stance depth** (`stance_depth/`): both per frame, both continuous rows
  — green fine, red too small, and a dashed gray line for everything the rule could not look at — the wrong side of
  the camera, or a joint not visible. Width = ankle-to-ankle distance in torso lengths,
  read front-on, narrow below 0.50; depth = the horizontal ankle gap in leg lengths, read side-on, shallow below
  0.50. The round rating is the share of judged frames that are bad, every frame counting however brief:
  < 15 % good, 15–30 % sometimes, ≥ 30 % bad. Read `runs.csv` + the stage's `.json`.
- **Elbow tuck** (`elbow_tuck/`): the research lens ported to Python — flare = |x shoulder − x elbow| / torso per arm,
  judged only while the boxer is within 45° of facing or backing the camera and that arm isn't throwing a hook. The row
  is continuous — every frame belongs to a stretch: green tucked (< 0.20), yellow borderline (0.20–0.30), red flared
  (≥ 0.30), and a thin gray strip where the rule cannot judge, with the reason in its tooltip (the boxer is side-on,
  a joint it needs is not visible, or that arm is throwing a hook). Lead in the top half, rear in the bottom; the toggle's summary
  has the per-arm share of judged frames flared and the video's rating (< 10 % tucked, 10–25 % sometimes flared,
  ≥ 25 % flared, worse arm decides). Reads `runs.csv` + `elbow_tuck.json`.

**Angle change** (`angle_change/angle_change.json`, a whole-video rule — no timeline row): per combined combo, the
mean facing during it against the most different smoothed facing in the 2 s after it; a turn of ≥ 45° counts as a
change. ≥ 50 % of combos good, 25–50 % some, < 25 % stays square; fewer than 5 readable combos → not rated.

- **Defense after combo** (`defense_after_combo/combos.csv` + `.json`): the defensive move that covered an offensive
  combo, drawn in green where the move is; a combo nobody covered is a red tick at its end frame. Hovering a move says
  how long after the combo it started and which combo it was. A move counts when it starts anywhere from the combo's first frame to 1 s after its last. The round rating is the share of combos covered
  (≥ 60 % good, 35–60 % moderate, < 35 % no defense after combos; fewer than 10 combos → not rated).

**Hand balance** (`hand_balance/hand_balance.json`, a whole-video rule — no timeline row): the share of punches
thrown with the rear hand — 30–50 % balanced, 20–30 % lead-heavy, 50–60 % rear-heavy, < 20 % lead only, > 60 % rear
only; fewer than 30 punches → not rated. The band is off-centre on purpose: the lead hand should throw more, the jab
being the most thrown punch. Each hand's punch types sit beside it, unjudged.

**Combination length** (`combo_length/combo_length.json`, a whole-video rule — no timeline row): over the offensive
combinations `run_combinations.py` already wrote, the share that are 3 punches or more — ≥ 40 % builds, 20–40 %
short, < 20 % one-twos only; fewer than 10 combinations → not rated. The mean length, the longest, the spread by
length and the share of punches thrown outside any combination sit beside it, unjudged.

**Output through the round** (`output_decay/output_decay.json`, a whole-video rule — no timeline row): the video cut
into three equal thirds, punches counted in each, the last third against the first — < 15 % fewer holds, 15–35 %
fades, ≥ 35 % drops off; under 90 s or 30 punches → not rated. The per-third counts, rates and dead shares are shown
beside it, unjudged, to separate a slower rate from more standing. It needs one continuous round to mean anything —
neither test video is one. `thirds.csv` has the per-third rows.

**Work rate** (`work_rate/work_rate.json`, a whole-video rule — no timeline row): a frame counts as work when a
punch or a defensive move covers it; a stretch with neither lasting ≥ 3 s is dead time (shorter gaps are the normal
breathing between combos, or a step or two around the bag). The rating is the share of the video inside those
stretches: < 20 % working, 20–40 % patchy, ≥ 40 % stalling; under 60 s of video → not rated. Punches and actions per
minute are shown beside it, unjudged — punch rate is a style, standing still is not. Footwork between punches is not
credited: crediting a 45° facing change within 1–2 s as work was measured and drove dead time to 0–2 % on both test
videos, because the unsmoothed facing model flips front/back and its turn signal does not separate moving from
standing. `gaps.csv` lists every dead stretch.

**Same punches** (`same_punches/same_punches.json`, a whole-video rule — no timeline row): under the target
distribution, the share of the 2 most-used punch types (≥ 85 % same punches, 70–85 % moderate, < 70 % varied; fewer
than 20 punches → not rated). The top 2 because jab and cross are normally the most common anyway.

**Body shots** (`bodyshots/bodyshots.json`, a whole-video rule — no timeline row): under same punches, body shots /
(body + head) over hooks and uppercuts only (the classifier can't split jab / cross into head / body): ≥ 25 % enough,
15–25 % a few, 5–15 % too few, < 5 % head only; fewer than 10 hooks + uppercuts → not rated. The cut-offs are ours.

**Same defense** (`same_defense/same_defense.json`, a whole-video rule — no timeline row): under the defense
distributions, the most-used move type (≥ 80 % same defense, 60–80 % moderate, < 60 % varied) and the most-used side
among moves that have one (≥ 80 % one-sided); fewer than 10 moves → not rated. The defense model finds rolls far
better than slips, so a high roll share is partly the model.

**Adding a rule**: see [instructions.md](instructions.md). In short — a rule that judges punches, frames, defensive
moves or combos gets a timeline layer (one entry in `RULE_LAYERS` in `index.html`) plus a Round score row; a rule that
only rates the round gets the Round score row alone, with no timeline row.

**Isolating one camera angle**: shift-click a band in the facing row (front / side-on / back) and the timeline keeps
only the stretches the boxer spent in that band at full strength — everything else fades back and stops answering the
cursor, so a rule's row can be read against the view it is actually judged in. The bands are the same ±45° / ±135°
cuts the gated rules use. The chosen band is outlined in the facing row and named in a chip beside the zoom buttons;
shift-click it again, click the chip, or press Esc to clear. Faded is not hidden on purpose — the shape of the round
stays visible around the selection.

Keys: Space play · ← → one frame · Shift + ← → one second · ↑ ↓ previous / next event · I jump to the impact · Esc clear the angle filter.
