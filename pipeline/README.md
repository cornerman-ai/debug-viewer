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

- the Ambo **data** folder → a picker of every video folder in `pipeline_tests/`, numbered in alphabetical order (a
  new video shifts the numbers after it; the All videos table shows the same numbers) and searchable: click it or
  press **/**, type any words of the name or a number (every word must appear; a number alone also finds that video,
  first), ↑ ↓ to move, Enter to open, Esc to close. The folder is remembered, so next time **Continue with “data”**
  reopens it;
- or one video folder, e.g. `pipeline_tests/2 rounds bagwork, working on balance [r1puy8]_CUT/`. The video and
  skeleton live outside that folder (`raw_videos/full_pipeline_test_videos/`, `skeleton_data/full_pipeline_test_videos/`),
  so the page asks to link the data folder once, or to pick the video file by hand.

Someone without the folder set up gets the setup guide on the start screen (open by default on a browser that has no
remembered folder): Google Drive for Desktop → My Drive › Ambo › data, the folder tree the page expects, a plain copy
as the no-Drive route, and the local server as the third. A wrongly picked folder is checked, not just refused: the
guide lists which of `pipeline_tests/`, `raw_videos/`, `skeleton_data/` it holds and names the likely slip (one level
too deep, half-synced). Picking Ambo or My Drive steps down to `Ambo/data` by itself. A video file that is missing
names the exact path it was looked for at.

It reads `punch_impact/impacts.csv` (falls back to `punch_classification/punches.csv`), `punch_classification/punches.json`
(fps, stance, video name — and `mirrored`: a southpaw's stages ran on his skeleton mirrored to orthodox, so the page
flips back what carries an image side — the facing angle's sign, hook overswing's x lines, the balance head position,
head-off-center's left / right — and takes lead = his right side; the skeleton it draws is the real one), `defense_classification/defenses.csv`, `facing_angle/facing_angle.csv`, the video, and the
`*_blazepose_full.npy` skeleton for the stick figure. A missing stage is named in the timeline header; the rest still works.
Switching videos is safe at any moment — while playing, mid-load, while a skeleton is still downloading: the old
video pauses at once and stays as it was (dimmed) until the new one has been read in full, in parallel, and swapped
in in one step; a pick overtaken by a newer one is dropped and its downloads cancelled, so nothing from one video
ever lands on another.
Each rule layer reads its own stage folder (`<stage>/*.csv` + `<stage>.json`, listed per layer below) when present;
the per-punch ones are joined to the punches by start frame and hand.

Over HTTP (a static server with Range support rooted at the data folder, serving this page from the same origin):
`index.html?data=<url of data/>&video=<folder name>` — used for testing. The backend's
`combined_pipeline/pipeline_server.py` is that server, and more: run it on the machine with the Drive mount and the two
conda envs and open **http://localhost:8766/**.

## Uploading a video

**Upload video** (header) runs a new video through the whole pipeline and opens it when it is done. It needs the
pipeline server above — the page cannot run Python; without the server the window says how to start it. Opened from
the server the page calls it directly; opened any other way (the hosted page with Open Folder) it looks for it at
`http://localhost:8766/`.

- **Pick**: drop a file or choose one — MP4 or MOV, the formats the page plays (anything else, or a file the browser
  cannot decode, is refused before upload). The window shows it playing, its length, size and resolution, and an
  estimate of the whole run. Its name becomes the folder in `pipeline_tests`, editable; a name already in use is
  refused as you type (with a link to open that video).
- **Run**: the file goes to the server, which copies it to `raw_videos/full_pipeline_test_videos/` and runs
  `run_all.py --video <name>` — the same command as by hand. The window lists the steps (upload, copy to Google
  Drive, skeleton, the six shared stages, the 28 rule stages, ready) with the current one spinning and its stage
  named ("facing angle · 3 of 6"), a bar with the percentage, the time elapsed and an estimate of the time left
  (rescaled by how fast the finished steps really ran), run_all's latest log line, and the video playing on the left.
  Finished steps show how long they took.
- **Keep browsing**: the window shrinks into a chip in the header ("Analysing · 42 %"); the job runs on the server, so
  closing the window or even reloading the page stops nothing — a reload picks the job up again. Only an upload still
  in flight is lost (the page warns before leaving).
- **Done**: with the window open the video opens by itself; minimised, the chip turns green ("… is ready — open").
  The dropdown and the All videos table include it from then on.
- **Refused or failed**: the same video byte for byte under another name is refused after the upload, naming the copy
  already there. A failed run marks its step red, gives the first error from the log ("the skeleton extraction failed
  — av.error.InvalidDataError: …") and the log's tail, and the server removes what that job created, so the test set
  never holds a half-run video and the name can be used again.

One job runs at a time; a second upload waits in line ("waiting for “X” to finish first"). Measured 2026-10-02: a
12 s clip took 29 s end to end, a 45 s clip about a minute; the skeleton runs at about real time and the facing
model grows with the square of the length, so long videos take longer than their length.

## Using it

Timeline rows: facing angle (0° = to the camera, ±180° = back) — split at ±45° and ±135° into the front / side-on / back bands (each gated rule's own window is its `camera_window_deg` in the thresholds file, 45° by default; a rule with any other window shows its range beside its Front / Side / Back badges, e.g. "Side — 60–105°"), each frame’s dot coloured by its band, lead and rear punches (white tick = impact frame),
defense, **Defense 2.0** right under it (rolls + slips; the `rolls_slips` stage) — rolls from the roll detector (its newest run, fr_none seed 42, the five
fold models averaged) and slips from the Slip exploration lens's rule, both kept only while the boxer faces the camera
(within 22.5°, `rolls_slips/moves.csv`, run_all's viewer-only `rolls_slips` stage; no rule reads it, it sits beside
defense6's row to be judged by eye; hover a block for its score; the defense chips hide its moves too) — and an
overview of the whole video (drag it to move the window). Scroll to zoom, drag to pan, click to seek,
hover for details; the chips in the side panel hide or show a punch / defense type. Every row has a switch in the
**Timelines** tab's Timeline layers card: the base rows (Facing, Lead, Rear, Defense, Defense 2.0) on top, all on by
default, then the rule rows; the choice is remembered in the browser, and a row the video's folder lacks is greyed out. On the video: the skeleton, a ring
on the punching wrist around impact, and pills naming the current punch / move.

The side panel has five views, switched at its top:

- **Now** — what is under the playhead: the facing angle, then three cards, each judged on every rule that applies
  to it — a score in the round score's tier colours, a verdict (okay / not okay, on / off target), or "not judged" and
  why (the camera angle, the joint not visible, too far from the camera…). **Punch**: every per-punch rule that applies
  to that punch (arm extension and hand return path for jabs and crosses only, hook overswing for hooks, rear-foot heel up for
  rear-hand punches), then the detail sections of the layers that are on. **Defense**: a slip on rules 14 and 15; no
  rule scores a single roll, duck or pull-back. **Combo**: each combo the playhead is in — an offensive one on rules 24
  (length), 30 (how often that sequence repeats) and 3 (defended after it?), a combined one on rules 13 (angle changed
  after it?) and 31 (repeats). **Frame**: this frame on every per-frame rule — guard height (lead 30 + rear 70), chin
  tuck depth and height, elbow tuck (50 / 50), stance depth and width, both bladedness axes, and what dead time (rule 25) counts it
  as. Judged or not, and why, comes from the rule's own runs.csv; the score is the rule's formula on this frame's
  skeleton, the same number the video overlay draws, with the reading it came from.
- **Round** — the whole video's counts: the punch and defense distributions and the combos (counts and the most-used
  sequences).
- **Floors** (since 2026-10-06): the house floors from the video's thresholds snapshot are shown where they act. On
  the skeleton, a joint under the visibility floor (0.30) is drawn hollow and its bones dashed, with a note naming
  how many the rules skip; the **Now** tab's Frame card ends with **Joint visibility** — a bar per joint (nose, then
  lead / rear shoulder to ankle), a tick at the floor, red under it, the value beside it; the **Rules** tab's
  **Floors** line lists visibility, the judged minimum (10 punches / combos / moves, 150 frames) and the torso
  minimum, plus the rules that change one; **Explanations** says what visibility means.
- **Rules** — a **Brief** on top: the **overall round score** — each rated rule earns points by its tier (critical 0,
  bad 1, mid 2, good 3, great 4), and the sum over 4 × the rated rules is put on 0–100 (not-rated rules count in
  neither), coloured and labelled on the same tier scale as the rules, with the same bar — then every rule's name under its tier (great / good / mid / bad / critical / not rated), with the count
  per tier. Then the whole video's **Round score**: every rule we have, one row each, numbered 1–33 in the Notion
  order: its 0–100 score — a plain number, coloured on one scale shared by every rule (85–100 great, 75–85 good,
  60–75 mid, 40–60 bad, 0–40 critical; display only, the rules compute no bands) — or "not rated" under
  the rule's floor (10 judged punches / combos / moves, 150 frames), and under it four lines — what the
  rule measures, what it was measured on, its thresholds, and the sum that produced the number — and a rated per-punch
  rule a fifth, **fails on**: its failed punches split by punch type, a bar in the punch colours (each type's share of
  the fails) with failed / judged after each type, so a punch that fails out of proportion to how often it is thrown
  shows. A fail is what the rule's own counts call one (under 100; off target for hit height, not okay for hand return
  path); hook overswing has none (hooks only). Under the score a
  game-style bar shows it on 0–100, filled in its tier's colour, with a tick at each tier line (40, 60, 75, 85);
  a not-rated rule gets an empty striped bar. Each row carries three
  tags — its analysis group (separate move / overall round), what it is analysed on (a punch, a combo, a defensive
  move, a frame, or the whole round only) and its angle gate (side-on / front, back / every angle; from the layer's
  scope; shown as three Front / Side / Back badges, lit = judged, struck through = skipped, in the facing row's colours) — and the card sorts by rule number, score (not rated always last), or any of the three tags, grouped under
  a heading. Every sort runs both ways: click the active button again to flip it (the arrow and the line under the
  buttons say which way, e.g. worst → best). The card always opens on rule number, 1 → 33.

- **Timelines** — the **Timeline layers** card, the tab's only card: it only turns timeline rows on and off, and each toggle shows
that rule's headline verdict. It sorts by rule number (the default on every load) or by the angles each rule judges —
side-on / front, back / every angle, under a heading — and the active button flips the order; the timeline rows and
the punch card's sections follow the same order.
- **Explanations** — one card, static text: every rule in plain words, in one shape — what it actually measures (one
  sentence starting "How…", "Whether…", "What share…" or "The same as rule N…", with the trap its name hides right
  after), a grey line (what it judges · camera view · scoring) and **Why** a coach wants it. Written
  from the scripts and checked against them on 2026-10-02; when a rule's script changes, its line in `EXPLAIN` changes
  with it.

**All videos** (header button, next to the video list): every video in the folder × every rule in one table — rows
are videos, columns are the overall round score and rules 1–33, each cell the 0–100 score tinted in its tier's colour
("–" = not rated). It is not a separate computation: each video is read with the viewer's own loader, minus the
timeline CSVs and the facing curve, which no round score needs (checked equal to the full read on all 495 cells,
2026-10-02), and scored by the same code as the Rules tab, so a cell always equals what that video's Round score card
says. A median row closes the table. Click any column header to sort by it (click again to flip), a video's name to
open it. Read once per folder (about 36 s for 15 videos over the local server) and kept; **Reload** re-reads after a
pipeline re-run. Esc or a click outside closes it.

**Thresholds** are not in this page: every number a card, the Explanations tab or an overlay shows is read from the
video's `pipeline_tests/<stem>/rule_thresholds.json` - the copy of the backend's `combined_pipeline/configs/
rule_thresholds.json` that `run_all.py` writes next to the outputs, so a card shows the numbers its video was computed
with. A folder without it shows "thresholds file missing — rerun this video" (no hardcoded fallback). The score tiers
(great / good / mid / bad / critical) stay in the page.

**Rule names** live in one table, `RULE_NAMES` (number → name, the Notion order), and every place the page names a
rule reads it — the Rules tab, the Brief, the All videos headers, Explanations, the Now cards, the timeline rows and
their cards. Renaming a rule is that one entry (plus the docs); the layer keys, stage folders and CSV columns are
identifiers and keep their names.

**Rule layers** (side panel, all off by default, the choice is remembered): each adds a timeline row, a section in
the punch card and a video overlay.

Every rule with geometry in the frame now draws it. Rules that judge a punch (arm extension, hit height, hip and
shoulder rotation, head off center, punch starts from low guard, resting hand, balance, hand return path, hook overswing, rear-foot heel up)
draw for the punch under the playhead. Rules that judge frames (guard height, elbow tuck, chin tuck height and depth, stance width and depth, both
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

- **Punch starts from low guard** (rule 2, `hand_drop/`; "Punching hand drop before punch" until 2026-10-03): per punch, the punching wrist's mean height below the nose over every
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
- **Balance at impact** (`balance/`): per punch at the impact frame, read side-on (\|facing\| 65–115°, the rule's
  `camera_window_deg` since 2026-10-05), a score 0–100 = head (0–50) +
  hips (0–50), in ankle distances. Head: 50 while the nose is at most 0.20 past an ankle, linearly to 0 at 0.75
  past it. Hips: 50 while the hip centre is within 0.20 of the ankles' midpoint, linearly to 0 at 0.50 (over an
  ankle). The block is green when both are inside their green zone (score 100), red otherwise, and carries the
  score. The overlay draws the base between the ankles, the head's slack as dashed ticks outside it, the hips'
  ticks, the head and the hips, at the impact frame. Round = the mean punch score, a plain number with no bands,
  from at least 10 judged punches. Reads `punches.csv` + `balance.json`.
- **Rear-foot heel up** (rule 33, `rear_pivot/`; "Rear-foot pivot" until 2026-10-03): per rear-hand punch, at the impact frame, how far the rear heel sits above the
  rear toe in torso lengths, scored 0 with the heel level with the toe and 100 from 0.20, linearly between — green at
  100, red below, the score on the block (the stance already carries the heel about 0.14 up, so a planted foot scores
  about 67). The overlay draws the toe's height dashed grey, the 0.20 line in the verdict's colour, the foot and the
  heel. Every angle is judged; lead-hand punches and a hidden rear foot are not drawn. Round = the mean punch score,
  a plain number, from at least 10. Reads `punches.csv` + `rear_pivot.json`.
- **Hook overswing** (rule 32, `hook_stop/`; "Hook stop" until 2026-10-03): per head hook, read front-on or back-on, where the fist is at the turnaround — the
  frame the impact spotter says it stopped going forward. Score 100 at the boxer's centre line or short of it, linearly to 0 at a third of a
  torso past his own far shoulder; green at 100, red below, the score on the block. The far shoulder is his centre
  line plus half his squared-up width (the 90th percentile of his shoulder separation over the clip), not the gap in
  that frame, which collapses when he blades. The overlay draws the centre line (green, 100), the far shoulder
  (dashed grey), the zero line (red) and the fist. Round = the mean punch score, a plain number, from at
  least 10 — most hooks on the current footage are thrown side-on and are not judged at all. Reads `punches.csv` +
  `hook_stop.json`.
- **Hand return path** (`hand_return_path/`): per side-on jab / cross, the wrist's height above its own shoulder
  from the impact to the punch's end + 0.15 s — the tail cut at the next punch of the same hand when that starts
  sooner — against the straight line (chord) between its first and last frame. Not okay — a U — when every frame between the ends sits under the chord; okay otherwise; no grade per
  punch. The block covers the measured window itself (impact → end + 0.15 s), lead windows on the top half of the row
  and rear on the bottom (a cross's window runs into the next jab's all the time), a white edge where each window
  starts, green okay, red not okay, labelled with the frames under the chord. Overlapping windows each draw on the
  video, on their own wrist, labelled by hand. On the video, for every frame of that window: the wrist's whole line, the
  two ends (grey dots), each frame between them as a red (under) or green dot tied by a thin line to the chord, and
  where the wrist is now. The chord (dashed white) is the rule's own: a straight line in time of the wrist's height above
  its shoulder, drawn at each frame's wrist x and that frame's shoulder height — so a dot is under it exactly when the
  rule counted it (0 of 12,628 dots differ, 2026-10-02). Until then it was a straight image segment between the two end
  positions, which ignored the shoulder and the timing and contradicted the verdict on a quarter of the dots. Round = 100 with no punch not okay, linearly to 0 at 70 % not okay, a plain number. Rebuilt 2026-10-01 — the earlier versions are in
  `combined_pipeline/pipeline_notes/changes.md`. Reads `punches.csv` + `hand_return_path.json`.
- **Dropping resting hand while punching** (`resting_hand/`; "idle hand" until 2026-09-28): per punch, the hand
  that is NOT throwing, read at impact −1, impact and impact +1 frames and weighted ¼ · ½ · ¼ — how far it sits below
  the nose. Scored 100 up to 0.25 torso (an absolute line: a boxer who holds his hands low all round must not pass),
  linearly to 0 at 0.60 (since 2026-10-05; was ±2 frames, 0.40 / 0.70); green at 100, red below, with the score on
  the block. The overlay
  draws the 100 / 0 lines and the weighted reading at the impact frame, ticks each of the three readings on that scale
  (each read against its own frame's nose and torso, as the rule does), and rings the resting wrist at every frame
  the rule could read. That hand's own
  median guard is shown in the card, unjudged. Round = the mean punch score, a plain number with no bands. Frames
  around the impact and not the punch's window, because punches overlap inside a combination, which would leave most
  punches unjudgeable. Reads `punches.csv` + `resting_hand.json`.
- **Arm extension** (`arm_extension/`): per jab / cross the elbow angle at the frame of furthest reach, scored
  linearly — 100 at 160° or straighter, 0 at 100° — and eased far from the camera: with the torso under ¼ of the
  frame height full marks start at 150°, under ⅛ the punch is not judged. Green at 100 and red below, the score on the block and a white
  tick at the frame measured; on the video the punching arm in the same colour with this frame's elbow angle (a punch
  the rule did not judge says why: head-on, too far from the camera…). The round is the mean punch score, a plain
  number with no bands.
- **Hip rotation** (`hip_rotation/`): per punch the start → impact rotation against a set range per punch type (lead
  jab 0–25°, lead hook 25–60°, lead uppercut 15–50°, lead body shot 25–60°, rear cross 20–60°, rear hook 25–60°, rear
  uppercut 20–50°, rear body shot 25–50°): 100 inside, linear from 0° to the lower bound below it, and above it up
  to 20 off — linear from the upper bound to twice it, capped at 20. Green at 100, red below, the score on the block; the round is the mean punch score, no bands (from
  `hip_rotation.json`); on the video the hip line coloured by the rule's verdict, and — since that line is not the
  measurement — a dial of what is: seen from above (the world landmarks), the direction other hip → punching hip at
  the start (dashed white) and at impact, against the facing angle (grey), labelled with both angles; their difference
  is the rule's number (checked to 0.14° on 5,352 punches, 2026-10-02). The impact → end step is in the CSV but not shown.
- **Shoulder rotation** (`shoulder_rotation/`): the hip rule moved to the shoulders — per punch the start → impact
  turn of the punching shoulder against a set range per punch type (lead jab 5–30°, lead hook 35–70°, lead uppercut
  25–60°, lead body shot 40–75°, rear cross 30–60°, rear hook 40–75°, rear uppercut 30–75°, rear body shot 50–75°),
  scored like hip rotation — green at 100, red below, the score on the block; on the video the shoulder line in the
  verdict's colour and the same dial from above. The round is the mean punch score, no bands.
- **Hit height** (`hit_height/`): per punch of every type — jab, cross, hook, uppercut, body shot — the zone the fist
  is in at its impact frame on a ghost the boxer's own size (head / shoulder / body / over the head / below the belt;
  on target = green, off = red, skipped = not drawn) with a white tick at the impact frame. On the video a ring on the
  fist where it was at that frame (for ±2 frames around it, with a dot on the wrist now), with its zone. Round = 100 × the on-target share of the judged punches, a plain number. Until
  2026-09-30 it judged jabs and crosses only, at the most-extended frame.
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

- **Slip far enough** / **Slip not too much** (rules 14 and 15, `slip_distance/`; 15 was "Slips compact" until 2026-10-03): per slip, how far the head travelled sideways from where it started, in
  torso lengths, with a white tick at the furthest frame. Rolls and ducks are not measured. Judged front-on / back-on only. Two timeline rows, one per rule, each slip coloured by that
  rule's slip score (green 100, orange between, red 0), and two round rows, each the mean of its slip scores: rule 14 "slip far enough" (100 at 0.20 torso of travel or more, 0 with none) and 15 "slip not too much" (100
  up to 0.70, 0 at 1.00). Reads `moves.csv` + `slip_distance.json`.
- **Guard height** (`guard_height/`): per hand, how far the wrist sits below the nose in torso lengths while that
  hand is not punching — low above 0.50 for the lead hand, 0.30 for the rear, and 0.30 for both inside a detected
  defensive move (since 2026-10-05; 0 at 0.70 throughout). Continuous row, lead in the top half,
  rear in the bottom: green guard up, red low, and a dashed gray line for everything the rule could not look at —
  that hand throwing, or a joint not visible. The overlay draws the rear line (0.30, "rear 100"), the lead line
  (0.50, "lead 100") and the zero line (0.70) — inside a defensive move the lead line at 0.30, said in the label — and
  labels the frame score: lead 30 + rear 70, or one hand alone.
  Round = the mean frame score, a plain number with no bands. Reads `runs.csv` + `guard_height.json`.
- **Hips bladed** (`bladedness_hips/`) and **Shoulders bladed** (`bladedness_shoulders/`): both per frame outside
  punches, both continuous rows. The angle is that line's turn from square TO THE OPPONENT: its direction in the 3D
  landmarks minus the facing model's direction to the opponent (the model's labelers drew a line from the boxer
  toward his opponent) — 0° chest-on, 90° side-on; with the boxer facing the camera it is the lens's formula. The two
  cuts per axis are a coach's verdicts on 30 frames (hips 18.2 / 27.9, shoulders 12.7 / 17.6). Frame score: 0 at the
  squared cut or below, 100 at the fine cut or above, linear between (red / orange / green on the row; the overlay
  labels the angle and the score). There is no upper edge; he never called anyone too bladed. Every facing angle is
  judged; a frame with no facing angle is not. Round = the mean frame score, a plain number. Read `runs.csv` + the
  stage's `.json`.
- **Chin tuck height** (rule 8, `chin_height/`; "Chin height" until 2026-10-03) and **Chin tuck depth** (rule 7, `chin_depth/`; "Chin depth" until 2026-10-03): both per frame outside punches, both
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
- **Elbow tuck** (`elbow_tuck/`): the research lens ported to Python — flare = how far the elbow sits out past its
  shoulder, away from the body's midline, / torso per arm (pulled in counts 0; the lens's |x shoulder − x elbow| until 2026-10-02),
  judged only while the boxer is within 25° of facing or backing the camera (45° until 2026-10-06) and that arm isn't throwing a hook. The row
  is continuous — every frame belongs to a stretch: green tucked (< 0.20), yellow borderline (0.20–0.30), red flared
  (≥ 0.30), and a thin gray strip where the rule cannot judge, with the reason in its tooltip (the boxer is side-on,
  a joint it needs is not visible, or that arm is throwing a hook). Lead in the top half, rear in the bottom. Each
  frame scores 0–100: each arm 50, full up to 0.15 flare and 0 at 0.50, or 100 when only one arm can be judged; the
  overlay labels it ("frame score 65.8 · lead 15.8/50 · rear 50.0/50"). Round = the mean frame score, no bands.
  Reads `runs.csv` + `elbow_tuck.json`.

**Angle change after combo** (rule 13, `angle_change/angle_change.json`; "Angle change" until 2026-10-03; a whole-video rule — no timeline row): per combined combo, the
mean facing during it against the most different smoothed facing in the 2 s after it; a turn of ≥ 45° counts as a
change. Round = 100 at half the combos changed or more, 0 at none, linear between — a plain number, no bands;
fewer than 10 readable combos → not rated.

- **Defense after combo** (`defense_after_combo/combos.csv` + `.json`): the defensive move that covered an offensive
  combo, drawn in green where the move is; a combo nobody covered draws its empty search window as a hollow red box
  after its end. Hovering says how long after the combo the move started, or how long the window was and whether the
  next punch cut it. A move counts when it starts anywhere from the combo's first frame to 2 s after its last — or
  only until the next punch starts, if that comes first. Round = 100 at 70 % of combos covered or more, 0 at none,
  linearly in between; a plain number, no bands (fewer than 10 combos → not rated).

**Lead/rear hand balance** (rule 5, `hand_balance/hand_balance.json`; "Hand balance" until 2026-10-03; a whole-video rule — no timeline row): the share of punches
thrown with the rear hand, scored 100 from 25 % to 40 % (60 % until 2026-10-05) and falling linearly to 0 at 0 % (all lead) and at 100 % (all
rear); a plain number, no bands; fewer than 10 punches → not rated. The band is off-centre on purpose: the lead hand should throw more, the jab
being the most thrown punch. Each hand's punch types sit beside it, unjudged.

**Combination length** (`combo_length/combo_length.json`, a whole-video rule — no timeline row): over the offensive
combinations `run_combinations.py` already wrote, the share that are 3 punches or more, scored 0 at none and 100
from 40 %, linearly between — a plain number, no bands; fewer than 10 combinations → not rated. The mean length, the longest, the spread by
length and the share of punches thrown outside any combination sit beside it, unjudged.

**Fading output through round** (rule 26, `output_decay/output_decay.json`; "Output through the round" until 2026-10-03; a whole-video rule — no timeline
row): measured from the first punch to the last. Under 90 s of that span, the span is cut in three equal thirds and
the last third compared with the first; 90 s or more, the first 30 s from the first punch against the last 30 s up
to the last punch. 100 up to 15 % fewer punches at the end, linearly to 0 at 40 % fewer, a plain number; under 30
punches → not rated. The per-window counts, rates and dead shares are shown beside it, unjudged, to separate a
slower rate from more standing. It needs one continuous round to mean anything.

**Dead time** (rule 25, `work_rate/work_rate.json` + `segments.csv`; "Work rate" until 2026-10-03): its timeline row shows the whole video as runs — green
where a punch or a defensive move covers it, blue where only a change of angle does, red for dead stretches with
their length, empty for the short pauses in between. A frame counts as work when a
punch or a defensive move covers it, or when he is changing angle — the 0.5 s-smoothed facing turning 90° or more in
under 1 s, only the frames of the turn itself. A stretch with none of these lasting ≥ 3 s is dead time. Score = 100 at no dead time, linearly
to 0 at 50 % dead — a plain number, no bands; under 20 s of video → not rated. Punches and actions per minute and the
seconds credited to turns are shown beside it, unjudged — punch rate is a style, standing still is not.

**Punch variety** (rule 27, `same_punches/same_punches.json`; "Same punches" until 2026-10-03; a whole-video rule — no timeline row): under the target
distribution, the share of the 2 most-used punch types, scored 100 at 66 % or less and linearly to 0 at 100 % (a plain
number; fewer than 10 punches → not rated). The top 2 because jab and cross are normally the most common anyway.

**Body shots** (`bodyshots/bodyshots.json`, a whole-video rule — no timeline row): under punch variety, body shots /
(body + head) over hooks and uppercuts only (the classifier can't split jab / cross into head / body): scored 0 at
none and 100 from 25 %, linearly between (a plain number); fewer than 10 hooks + uppercuts → not rated. The cut-offs are ours.

**Defense variety** (rule 29, `same_defense/same_defense.json`; "Same defense" until 2026-10-03; a whole-video rule — no timeline row): under the defense
distributions, a score of two halves: 50 for the move — full below 60 % of the most-used type, linearly to 0 at 100 % —
and 50 for the side among moves that have one — full below 70 %, linearly to 0 at 100 %; each half needs 10 moves,
one alone is the whole score. The defense model finds rolls far
better than slips, so a high roll share is partly the model.

**Adding a rule**: see [instructions.md](instructions.md). In short — a rule that judges punches, frames, defensive
moves or combos gets a timeline layer (one entry in `RULE_LAYERS` in `index.html`) plus a Round score row; a rule that
only rates the round gets the Round score row alone, with no timeline row.

**Isolating one camera angle**: shift-click a band in the facing row (front / side-on / back) and the timeline keeps
only the stretches the boxer spent in that band at full strength — everything else fades back and stops answering the
cursor, so a rule's row can be read against the view it is actually judged in. The bands are fixed ±45° / ±135°
cuts; since 2026-10-06 the gated rules judge narrower windows inside them — side-on 65–115°, front / back 0–25° +
155–180° — each shown beside its rule's badges. The chosen band is outlined in the facing row and named in a chip beside the zoom buttons;
shift-click it again, click the chip, or press Esc to clear. Faded is not hidden on purpose — the shape of the round
stays visible around the selection.

Keys: Space play · ← → one frame · Shift + ← → one second · ↑ ↓ previous / next event · I jump to the impact · Esc clear the angle filter.
