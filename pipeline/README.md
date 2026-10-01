# Pipeline viewer

**Live**: https://cornerman-ai.github.io/debug-viewer/pipeline/

One page, `index.html`, for the four base stages of one full-pipeline test video on one timeline, synced with the
video: punches (`punch_classification/`) with their impact frame drawn on each punch (`punch_impact/`), defensive
moves (`defense_classification/`) and the continuous facing angle (`facing_angle/`). No build, no dependencies; like
the rule debug viewer, files stay on your machine — the page reads them through the browser, nothing is uploaded.

The stage folders are written by the backend's `combined_pipeline/rules_creation/` scripts (`run_punches.py`,
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
- **Round** — the whole video. **Round score** lists every rule we have, one row each, numbered 1–33 in the Notion
  order: its 0–100 score — a plain number for most rules; hit height and hand return path add a quality band; slip
  distance and the two bladedness axes still give a rating word instead — or "not rated" under
  the rule's floor (10 judged punches / combos / moves, 150 frames), and under it four lines — what the
  rule measures, what it was measured on, its thresholds, and the sum that produced the number. Then the punch and defense distributions and the combos (counts and the most-used sequences).

The **Timeline layers** card stays below both views: it only turns timeline rows on and off, and each toggle shows
that rule's headline verdict.

**Rule layers** (side panel, all off by default, the choice is remembered): each adds a timeline row, a section in
the punch card and a video overlay.

Every rule with geometry in the frame now draws it. Rules that judge a punch (arm extension, hit height, hip and
shoulder rotation, head off center, hand drop, resting hand, balance, hand return path, hook stop, rear-foot pivot)
draw for the punch under the playhead. Rules that judge frames (guard height, elbow tuck, chin height and depth, stance width and depth, both
bladedness axes, slip distance) draw on every frame through `frameOverlay`, which gets the raw BlazePose-33
channels — they need joints (mouth corners, heels, toes) and channels (world x/z) the punch overlays never touch.
Punch speed has no overlay on purpose: it measures a duration, and a duration has no geometry to draw.

When punches overlap, every punch under the playhead draws its own overlay, and each label is prefixed with its
hand and punch ("Rear cross · …"); labels never land on top of each other — a label that would is moved down.

Turn on one or two at a time. With a dozen layers on, the picture is unreadable — that is a debugging view, not a
bug. Colors: green = fine, orange = too little,
red = wrong / too much. A stretch the rule threw out — a joint it needs not visible, a punch in flight, the wrong
camera angle — is a **dashed gray mid-line carrying the reason**: `joint hidden`, `side-on`, `front-on`,
`punching` or `hook`, written on the strip when there is room for it and in the tooltip always. The row is
continuous, so a gray stretch never means "nothing happened" — it means the rule could not look, and says why.

- **Hand drop before punch** (`hand_drop/`): per punch, the punching wrist's mean height below the nose over every
  readable frame of the 0.25 s before the punch started, in torso lengths, scored 100 up to 0.40 and linearly to 0
  at 0.70 — green at 100, red below it, with the score on the block. The block, its highlight and its tooltip sit on the 0.25 s
  WINDOW before the punch, not on the punch, because that is what the rule measured. With the playhead inside the
  window the overlay draws the nose, the 0.40 line (score 100 above it) and the 0.70 line (0 below it), the window's mean, the wrist's path so far and this frame's own
  reading ("not read" when a joint is below visibility 0.30); nothing is drawn on the punch itself. Windows overlap
  other punches constantly (a cross starting while the jab is out), so the row is split — lead windows on the top
  half, rear on the bottom — and every window holding the playhead draws on its own wrist, its label naming the
  hand and punch ("Rear cross in 3 f · mean 0.527 · …"). Round = the mean punch score, a plain number with no
  bands, from at least 10 judged punches. Reads `punches.csv` + `hand_drop.json`.
- **Punch speed** (`punch_speed/`): per punch, the time from its first frame to the impact, scored 100 up to the
  30th percentile of that punch type across 8,166 labelled punches and linearly down to 0 at its 80th; the score on the
  block, green at 100 and red below. Every angle is judged: a time is not foreshortened. Round = the mean punch
  score, a plain number, from at least 10 judged punches. Reads `punches.csv` + `punch_speed.json`.
- **Balance at impact** (`balance/`): per punch at the impact frame, read side-on, a score 0–100 = head (0–50) +
  hips (0–50), in ankle distances. Head: 50 while the nose is at most 0.20 past an ankle, linearly to 0 at 0.75
  past it. Hips: 50 while the hip centre is within 0.20 of the ankles' midpoint, linearly to 0 at 0.50 (over an
  ankle). The block is green when both are inside their green zone (score 100), red otherwise, and carries the
  score. The overlay draws the base between the ankles, the head's slack as dashed ticks outside it, the hips'
  ticks, the head and the hips, at the impact frame. Round = the mean punch score, a plain number with no bands,
  from at least 10 judged punches. Reads `punches.csv` + `balance.json`.
- **Rear-foot pivot** (`rear_pivot/`): per rear-hand punch, at the impact frame, how far the rear heel sits above the
  rear toe in torso lengths, scored 0 with the heel level with the toe and 100 from 0.20, linearly between — green at
  100, red below, the score on the block (the stance already carries the heel about 0.14 up, so a planted foot scores
  about 67). The overlay draws the toe's height dashed grey, the 0.20 line in the verdict's colour, the foot and the
  heel. Every angle is judged; lead-hand punches and a hidden rear foot are not drawn. Round = the mean punch score,
  a plain number, from at least 10. Reads `punches.csv` + `rear_pivot.json`.
- **Hook stop** (`hook_stop/`): per head hook, read front-on or back-on, where the fist is at the turnaround — the
  frame the impact spotter says it stopped going forward. Score 100 at the boxer's centre line or short of it, linearly to 0 at a third of a
  torso past his own far shoulder; green at 100, red below, the score on the block. The far shoulder is his centre
  line plus half his squared-up width (the 90th percentile of his shoulder separation over the clip), not the gap in
  that frame, which collapses when he blades. The overlay draws the centre line (green, 100), the far shoulder
  (dashed grey), the zero line (red) and the fist. Round = the mean punch score, a plain number, from at
  least 10 — most hooks on the current footage are thrown side-on and are not judged at all. Reads `punches.csv` +
  `hook_stop.json`.
- **Hand return path** (`hand_return_path/`): per jab / cross, between the landing and the end of the punch, the
  fist's height against its own shoulder must not drop below where it was at the punch's start or where it was at
  impact; the dip is measured from the lower of those two, so a punch that started or landed low is not punished
  for being there. Green under 0.10 torso, red at or above, with the dip on the block; punches with no impact
  frame, a lost wrist or a tracking jump are not drawn. Every angle is judged — the measurement is vertical. Round
  = the worst 10 % of punch scores, banded 95/80/55. The lens's own 1.5 s window and descent/recovery pair were
  tried first and read 42 % / 58 % — see `combined_pipeline/changes.md`. Reads `punches.csv` +
  `hand_return_path.json`.
- **Dropping resting hand while punching** (`resting_hand/`; "idle hand" until 2026-09-28): per punch, the hand
  that is NOT throwing, read at impact −2, impact and impact +2 frames and weighted ¼ · ½ · ¼ — how far it sits below
  the nose. Scored 100 up to 0.40 torso (the line hand drop uses, an absolute one: a boxer who holds his hands low
  all round must not pass), linearly to 0 at 0.70; green at 100, red below, with the score on the block. The overlay
  rings the resting wrist at all three frames and draws the 100 / 0 lines and the weighted reading. That hand's own
  median guard is shown in the card, unjudged. Round = the mean punch score, a plain number with no bands. Frames
  around the impact and not the punch's window, because punches overlap inside a combination, which would leave most
  punches unjudgeable. Reads `punches.csv` + `resting_hand.json`.
- **Arm extension** (`arm_extension/`): per jab / cross the elbow angle at the frame of furthest reach, scored
  linearly — 100 at 160° or straighter, 0 at 100° — and eased far from the camera: with the torso under ¼ of the
  frame height full marks start at 150°, under ⅛ the punch is not judged. Green at 100 and red below, the score on the block and a white
  tick at the frame measured; on the video the punching arm in the same colour with this frame's elbow angle. The
  round is the mean punch score, a plain number with no bands.
- **Hip rotation** (`hip_rotation/`): per punch the start → impact rotation against a set range per punch type (lead
  jab 0–25°, lead hook 25–60°, lead uppercut 15–50°, lead body shot 25–60°, rear cross 20–60°, rear hook 25–60°, rear
  uppercut 20–50°, rear body shot 25–50°): 100 inside, linear from 0° to the lower bound below it, and above it up
  to 20 off — linear from the upper bound to twice it, capped at 20. Green at 100, red below, the score on the block; the round is the mean punch score, no bands (from
  `hip_rotation.json`); on the video the hip line in the same colour. The impact → end step is in the CSV but not shown.
- **Shoulder rotation** (`shoulder_rotation/`): the hip rule moved to the shoulders — per punch the start → impact
  turn of the punching shoulder against a set range per punch type (lead jab 5–30°, lead hook 35–70°, lead uppercut
  25–60°, lead body shot 40–75°, rear cross 30–60°, rear hook 40–75°, rear uppercut 30–75°, rear body shot 50–75°),
  scored like hip rotation — green at 100, red below, the score on the block; on the video the shoulder line in the
  same colour. The round is the mean punch score, no bands. The CSV also carries
  `shoulder_minus_hip`, the separation the biomechanics papers measure, unjudged for now.
- **Hit height** (`hit_height/`): per punch of every type — jab, cross, hook, uppercut, body shot — the zone the fist
  is in at its impact frame on a ghost the boxer's own size (head / shoulder / body / over the head / below the belt;
  on target = green, off = red, skipped = not drawn) with a white tick at the impact frame. On the video a ring on the
  fist at that frame with its zone. Until 2026-09-30 it judged jabs and crosses only, at the most-extended frame.
- **Head off center line** (`head_offcenter/`): per punch thrown facing or backing the camera, how far the head is
  off a vertical line through the hips — 0.75 × at the impact frame + 0.125 × at 25 % of the punch + 0.125 × at 75 % (in torso heights), scored linearly to 100 at 0.25 torso off —
  green at 100, red below, the score on the block — with a tick at the impact frame; on the video the hip line (dashed) and the head's distance from it.
- **Offensive combos** and **Combined combos** (`combinations/`, not rules): the same rule for both — no pause longer
  than 0.3 s between elements, however long each lasts. Offensive = punches only; combined = punches and all
  defensive moves in time order (a move may start or end one). Each combination is one plain line from its first
  frame to its last (blue = offensive, purple = combined; 2 elements minimum — a lone punch or move is not a combination); hovering it lists its elements in
  order with their times; the punch card shows the combination holding that punch and how often its sequence repeats.
  Reads `offensive.csv` / `combined.csv` + `combinations.json`; the distributions card counts both (how many, how many
  different, each sequence with its count) and scores combo diversity by the top-3 share, each kind on its own
  combos (the share of combos that are one of the 3 most-used sequences: 100 below 40 %, linearly to 0 at 100 %,
  < 10 combos not rated) — the combined one with the caveat that the defense model's noise inflates its variety. These are "items" layers (`items: true`): their rows are the combinations,
  not the punches.

- **Slip distance** (`slip_distance/`): per slip, how far the head travelled sideways from where it started, in
  torso lengths, with a white tick at the furthest frame (orange < 0.20 too short, green 0.20–0.70, red > 0.70 too
  far). Rolls and ducks are not measured. Judged front-on / back-on only. One timeline row for two round rows: rule 14
  "slip far enough" (the share of judged slips not too short) and 15 "slips compact" (not too far), each ≥ 60 % good,
  40–60 % mixed, < 40 % poor. Reads `moves.csv` + `slip_distance.json`.
- **Guard height** (`guard_height/`): per hand, how far the wrist sits below the nose in torso lengths while that
  hand is not punching — low above 0.50 for the lead hand, 0.30 for the rear. Continuous row, lead in the top half,
  rear in the bottom: green guard up, red low, and a dashed gray line for everything the rule could not look at —
  that hand throwing, or a joint not visible. The overlay draws the rear line (0.30, "rear 100"), the lead line
  (0.50, "lead 100") and the zero line (0.70), and labels the frame score: lead 30 + rear 70, or one hand alone.
  Round = the mean frame score, a plain number with no bands. Reads `runs.csv` + `guard_height.json`.
- **Hips bladed** (`bladedness_hips/`) and **Shoulders bladed** (`bladedness_shoulders/`): both per frame outside
  punches, both continuous rows. The angle is that line's turn out of the image plane from the 3D landmarks — 0°
  chest-on, 90° side-on — and the two cuts per axis are a coach's verdicts on 30 frames (hips 18.2 / 27.9,
  shoulders 12.7 / 17.6): red squared, orange between, green fine. There is no upper edge; he never called anyone
  too bladed. Round rating = the share of judged frames below the squared cut (< 15 % good, 15–30 % sometimes
  squared, ≥ 30 % squared). **The angle is measured against the camera**, which stands in for the opponent only on
  the curated frontal set — neither test video is in it, so read these two as a demonstration of the rule rather
  than a verdict on the boxer. Read `runs.csv` + the stage's `.json`.
- **Chin height** (`chin_height/`) and **Chin depth** (`chin_depth/`): both per frame outside punches, both
  continuous rows, both reading the skeleton chin (`nose + 2.25 × nose→mouth` — BlazePose has no jaw landmark).
  Height is the chin against the top of the lead shoulder (the keypoint raised 0.06 torso) in torso lengths, scored 100 with the chin at or below
  the shoulder top and linearly to 0 at 0.20 above — green at 100, red below. Depth is the chin against the
  shoulder's front (the lead keypoint pushed forward 0.10 torso) in torso lengths, scored 100 at or behind it and
  linearly to 0 at 0.40 in front — green at 100, red below — read side-on
  only. A dashed gray line is everything the rule could not look at: a joint not visible, a punch in flight, or the
  wrong camera angle. Round = the mean frame score over every judged frame, however brief — a plain number, no
  bands; under 150 judged frames → not rated. Both read joints at visibility 0.30, like every rule. Read `runs.csv` + the stage's `.json`.
- **Stance width** (`stance_width/`) and **Stance depth** (`stance_depth/`): both per frame, both continuous rows
  — green fine, red too small, and a dashed gray line for everything the rule could not look at — the wrong side of
  the camera, or a joint not visible. Width = ankle-to-ankle distance in torso lengths,
  read front-on; depth = the horizontal ankle gap in leg lengths, read side-on. Each frame scores 100 at 0.50 and
  above, 0 with the feet together (or level), linearly between — green at 100, red below. Round = the mean frame
  score, a plain number; under 150 judged frames → not rated. Read `runs.csv` + the stage's `.json`.
- **Elbow tuck** (`elbow_tuck/`): the research lens ported to Python — flare = |x shoulder − x elbow| / torso per arm,
  judged only while the boxer is within 45° of facing or backing the camera and that arm isn't throwing a hook. The row
  is continuous — every frame belongs to a stretch: green tucked (< 0.20), yellow borderline (0.20–0.30), red flared
  (≥ 0.30), and a thin gray strip where the rule cannot judge, with the reason in its tooltip (the boxer is side-on,
  a joint it needs is not visible, or that arm is throwing a hook). Lead in the top half, rear in the bottom. Each
  frame scores 0–100: each arm 50, full up to 0.15 flare and 0 at 0.50, or 100 when only one arm can be judged; the
  overlay labels it ("frame score 65.8 · lead 15.8/50 · rear 50.0/50"). Round = the mean frame score, no bands.
  Reads `runs.csv` + `elbow_tuck.json`.

**Angle change** (`angle_change/angle_change.json`, a whole-video rule — no timeline row): per combined combo, the
mean facing during it against the most different smoothed facing in the 2 s after it; a turn of ≥ 45° counts as a
change. Round = 100 at half the combos changed or more, 0 at none, linear between — a plain number, no bands;
fewer than 10 readable combos → not rated.

- **Defense after combo** (`defense_after_combo/combos.csv` + `.json`): the defensive move that covered an offensive
  combo, drawn in green where the move is; a combo nobody covered draws its empty search window as a hollow red box
  after its end. Hovering says how long after the combo the move started, or how long the window was and whether the
  next punch cut it. A move counts when it starts anywhere from the combo's first frame to 2 s after its last — or
  only until the next punch starts, if that comes first. Round = 100 at 70 % of combos covered or more, 0 at none,
  linearly in between; a plain number, no bands (fewer than 10 combos → not rated).

**Hand balance** (`hand_balance/hand_balance.json`, a whole-video rule — no timeline row): the share of punches
thrown with the rear hand, scored 100 from 25 % to 60 % and falling linearly to 0 at 0 % (all lead) and at 100 % (all
rear); a plain number, no bands; fewer than 10 punches → not rated. The band is off-centre on purpose: the lead hand should throw more, the jab
being the most thrown punch. Each hand's punch types sit beside it, unjudged.

**Combination length** (`combo_length/combo_length.json`, a whole-video rule — no timeline row): over the offensive
combinations `run_combinations.py` already wrote, the share that are 3 punches or more, scored 0 at none and 100
from 40 %, linearly between — a plain number, no bands; fewer than 10 combinations → not rated. The mean length, the longest, the spread by
length and the share of punches thrown outside any combination sit beside it, unjudged.

**Output through the round** (`output_decay/output_decay.json` + `windows.csv`, a whole-video rule — no timeline
row): measured from the first punch to the last. Under 90 s of that span, the span is cut in three equal thirds and
the last third compared with the first; 90 s or more, the first 30 s from the first punch against the last 30 s up
to the last punch. 100 up to 15 % fewer punches at the end, linearly to 0 at 40 % fewer, a plain number; under 30
punches → not rated. The per-window counts, rates and dead shares are shown beside it, unjudged, to separate a
slower rate from more standing. It needs one continuous round to mean anything.

**Work rate** (`work_rate/work_rate.json` + `segments.csv`): its timeline row shows the whole video as runs — green
where a punch or a defensive move covers it, blue where only a change of angle does, red for dead stretches with
their length, empty for the short pauses in between. A frame counts as work when a
punch or a defensive move covers it, or when he is changing angle — the 0.5 s-smoothed facing turning 90° or more in
under 1 s, only the frames of the turn itself. A stretch with none of these lasting ≥ 3 s is dead time. Score = 100 at no dead time, linearly
to 0 at 50 % dead — a plain number, no bands; under 20 s of video → not rated. Punches and actions per minute and the
seconds credited to turns are shown beside it, unjudged — punch rate is a style, standing still is not.

**Same punches** (`same_punches/same_punches.json`, a whole-video rule — no timeline row): under the target
distribution, the share of the 2 most-used punch types, scored 100 at 66 % or less and linearly to 0 at 100 % (a plain
number; fewer than 10 punches → not rated). The top 2 because jab and cross are normally the most common anyway.

**Body shots** (`bodyshots/bodyshots.json`, a whole-video rule — no timeline row): under same punches, body shots /
(body + head) over hooks and uppercuts only (the classifier can't split jab / cross into head / body): scored 0 at
none and 100 from 25 %, linearly between (a plain number); fewer than 10 hooks + uppercuts → not rated. The cut-offs are ours.

**Same defense** (`same_defense/same_defense.json`, a whole-video rule — no timeline row): under the defense
distributions, a score of two halves: 50 for the move — full below 60 % of the most-used type, linearly to 0 at 100 % —
and 50 for the side among moves that have one — full below 70 %, linearly to 0 at 100 %; each half needs 10 moves,
one alone is the whole score. The defense model finds rolls far
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
