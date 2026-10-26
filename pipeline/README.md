# Pipeline viewer

**Live**: https://cornerman-ai.github.io/debug-viewer/pipeline/

One page, `index.html`, for one full-pipeline test video on one timeline, synced with the video: the base stages —
punches (`punch_classification/`) with their impact frame drawn on each punch (`punch_impact/`), defensive moves
(`defense_classification/`) and the continuous facing angle (`facing_angle/`) —
and every rule's timeline row and round score. No build, no dependencies; like the rule debug
viewer, files stay on your machine — the page reads them through the browser, nothing is uploaded.

The stage folders are written by the backend's `combined_pipeline/rules_creation/` scripts (`run_punches.py`,
`run_impact.py`, `run_facing_angle.py`, `run_punch_facing.py`, `run_defense.py`, and one
`run_<rule>.py` per rule stage), driven by `combined_pipeline/run_all.py`, into Drive `Ambo/data/pipeline_tests/<video>/`.

## Opening it

Chrome or Edge (it reads folders with the File System Access API) and Google Drive for desktop. **Open Folder…** on the
start screen (the header has no folder button: reload the page to pick another folder):

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
flips back what carries an image side — the facing angle's sign, hook overswing's x lines, the balance nose position,
head-off-center's left / right, hit height's fist point — and takes lead = his right side; the skeleton it draws is the real one), `defense_classification/defenses.csv`, `facing_angle/facing_angle.csv`, the video, and the
`*_blazepose_full.npy` skeleton for the stick figure. A missing stage is named in the timeline header; the rest still works.
Switching videos is safe at any moment — while playing, mid-load, while a skeleton is still downloading: the old
video pauses at once and stays as it was (dimmed) until the new one has been read in full, in parallel, and swapped
in in one step; a pick overtaken by a newer one is dropped and its downloads cancelled, so nothing from one video
ever lands on another.
Each rule layer reads its own stage folder (`<stage>/*.csv` + `<stage>.json`, listed per layer below) when present;
the per-punch ones are joined to the punches by start frame and hand.

Over HTTP (a static server with Range support rooted at the data folder, serving this page from the same origin):
`index.html?data=<url of data/>&video=<folder name>` — used for testing. The backend's
`combined_pipeline/dev_tools/pipeline_server.py` is that server (read-only): run it on the machine with the Drive mount and open
**http://localhost:8766/**.

## A new video

The page does not run anything. A new video is run in the backend with `combined_pipeline/brief.py --video <its full
path>`: the whole pipeline into a folder beside it, and its score card, `brief.txt`. The Upload video button and
the server's upload were removed 2026-10-12.

## Using it

Timeline rows: facing angle (0° = to the camera, ±180° = back) — split at ±45° and ±135° into the front / side-on / back bands (each gated rule judges its own, narrower window — its `camera_window_deg` in the video's thresholds snapshot; there is no default — shown beside its Front / Side / Back badges, e.g. "Side — 65–115°"), each frame’s dot coloured by its band, lead and rear punches (white tick = impact frame),
defense — and an
overview of the whole video (drag it to move the window). Scroll to zoom, drag to pan, click to seek,
hover for details; the chips in the side panel hide or show a punch / defense type. Every row has a switch in the
**Timelines** tab's Timeline layers card: the base rows (Facing, Lead, Rear, Defense) on top, all on by
default, then the rule rows; the choice is remembered in the browser, and a row the video's folder lacks is greyed out.
Under Lead, Rear and Defense, one small switch per punch / move type the video has on that row, with its
count (since 2026-10-07): off hides that type on that row only (lead jabs, not rear ones) — its blocks, hover, the pills
and the ↑ / ↓ jumps — and is remembered across videos; the Round tab's chips still hide a type on every row, for the
current video. On the video: the skeleton (each foot drawn whole since 2026-10-22: ankle, heel and toe tip — BlazePose's heel and foot-index points), a ring
on the punching wrist around impact (dashed, with its visibility and "may be a guess", when the wrist is under 0.6 —
see Hand return path), and pills naming the current punch / move.

The side panel has five views, switched at its top:

- **Now** — what is under the playhead: the facing angle, then three cards, each judged on every rule that applies
  to it — a score in the round score's tier colours, a verdict (okay / not okay, on / off target), or "not judged" and
  why (the camera angle, the joint not visible, too far from the camera…). **Punch**: every per-punch rule that applies
  to that punch (arm extension and hand return path for jabs and crosses only, hook overswing for head hooks, rear-foot heel up for
  rear-hand punches), then the detail sections of the layers that are on. **Defense**: a slip on rules 14 and 15; no
  rule scores a single roll, duck or pull-back. **Combo**: each combo the playhead is in — an offensive one on rules 24
  (length), 30 (how often that sequence repeats) and 3 (defended after it?), a combined one on rules 13 (angle changed
  after it?) and 31 (repeats). **Frame**: this frame on every per-frame rule — guard height (lead 30 + rear 70), chin
  tuck depth and height, elbow tuck (50 / 50), stance depth and width, both bladedness axes, and what dead time (rule 25) counts it
  as. Judged or not, and why, comes from the rule's own runs.csv; the score is the rule's formula on this frame's
  skeleton, the same number the video overlay draws, with the reading it came from.
- **Round** — the whole video's counts: the punch and defense distributions and the combos (counts and the most-used
  sequences).
- **Rules** — a **Brief** on top: the **overall round score** — each rated rule earns points by its tier (critical 0,
  bad 1, mid 2, good 3, great 4), and the sum over 4 × the rated rules is put on 0–100 (not-rated rules count in
  neither), coloured and labelled on the same tier scale as the rules, with the same bar — then every rule's name under its tier (great / good / mid / bad / critical / not rated), with the count
  per tier. Then the whole video's **Round score**: every rule we have, one row each, numbered 1–36 in the Notion
  order: its 0–100 score — a plain number, coloured on one scale shared by every rule (85–100 great, 75–85 good,
  60–75 mid, 40–60 bad, 0–40 critical; display only, the rules compute no bands) — or "not rated" under
  the rule's floor (10 judged punches / combos / moves, 5 s of judged frames), and under it four lines — what the
  rule measures, what it was measured on, its thresholds, and the sum that produced the number — and a rated per-punch
  rule a fifth, **fails on**: its failed punches split by punch type, a bar in the punch colours (each type's share of
  the fails) with failed / judged after each type, so a punch that fails out of proportion to how often it is thrown
  shows. A fail is what the rule's own counts call one (under 100 - for hit height the off-target punches; not okay for
  hand return path); hook overswing has none (hooks only). Under the score a
  game-style bar shows it on 0–100, filled in its tier's colour, with a tick at each tier line (40, 60, 75, 85);
  a not-rated rule gets an empty striped bar. Each row carries three
  tags — its analysis group (separate move / overall round), what it is analysed on (a punch, a combo, a defensive
  move, a frame, or the whole round only) and its angle gate (side-on / front, back / every angle; the rule's `camera`
  in the video's thresholds snapshot, its window beside the badges; shown as three Front / Side / Back badges, lit = judged, struck through = skipped, in the facing row's colours) — and the card sorts by rule number, score (not rated always last), or any of the three tags, grouped under
  a heading. Every sort runs both ways: click the active button again to flip it (the arrow and the line under the
  buttons say which way, e.g. worst → best). The card always opens on rule number, 1 → 33.

- **Timelines** — the **Timeline layers** card, the tab's only card: it only turns timeline rows on and off; under each toggle,
the rule's number, what it is measured on and the camera views it judges (the badges and the window, from the video's
thresholds snapshot). It sorts by rule number (the default on every load) or by the angles each rule judges —
side-on / front, back / every angle, under a heading — and the active button flips the order; the timeline rows and
the punch card's sections follow the same order.
- **Explanations** — one card, static text: every rule in plain words, in one shape — what it actually measures (one
  sentence starting "How…", "Whether…", "What share…" or "The same as rule N…", with the trap its name hides right
  after), a grey line (what it judges · camera view · scoring) and **Why** a coach wants it. Written
  from the scripts and checked against them on 2026-10-08; when a rule's script changes, its row in `explainRows()`
  changes with it. Every number in it is read from the video's thresholds snapshot (before a video is open each reads
  '…').
- **Info** (since 2026-10-24) — one card, the video as a whole, one row each: file, frames, fps, duration, punches,
  defensive moves, stance (its clear frames, mirrored or not), gloves, training (bag work / shadowboxing), camera
  height and camera distance, each value's detail under it, the stage's rule in the row's tooltip. The only place they are shown: the line
  under the video's name that carried them was dropped the same day (it duplicated this tab).

**Excluded time**: the stretches of the video no rule judges, read from its `excluded_segments.json` (run_all writes it
beside the outputs from the backend's `combined_pipeline/configs/excluded_segments.json`: by default the first and last
2 s, plus any segments set for that video). Everything is still detected and measured there - its punches and moves stay
on their rows - but every timeline row and the overview are grey and hatched ("not judged · excluded time"), the video is
dimmed with the stretch's times, a frame rule's row shows a dashed "excluded" strip, and a punch, move or combo that
reaches into it says "not judged: it reaches into the video's excluded time" (rules 3 and 13 count the window after a
combo too). The Rules tab's Floors line lists the stretches; count rules note the items they left out. A folder computed
before the file existed (2026-10-12) is read with its snapshot's `house.edge_skip_s` at both ends instead.

**Floors**: the house floors from the video's thresholds snapshot are shown where they act. On the skeleton, a joint
under the visibility floor (0.30) is drawn hollow and its bones dashed, with a note naming how many the rules skip; the
**Now** tab's Frame card ends with **Joint visibility** — a bar per joint (nose, then lead / rear shoulder to ankle), a
tick at the floor, red under it, the value beside it, and a **Visibility / Presence** switch (presence: is the joint in
the picture at all, its floor 0.75 since 2026-10-06); the **Rules** tab's **Floors** line lists visibility, presence,
the judged minimum (10 punches / combos / moves, 5 s of judged frames) and the torso minimum, plus the rules that change one;
**Explanations** says what both mean. Every reading the page recomputes (and the hollow joints) drops a joint under
the presence floor exactly as the pipeline does (`visAt`).

**Stance.** The Info tab's Stance row says `orthodox` / `southpaw` — the stance the run used (who
was mirrored), and under it how the backend's `stance` stage decided (`stance/stance.json`: since 2026-10-20 the
clear frames each way, the majority deciding — or no answer and taken as orthodox; a folder from 2026-10-09 to 10-20
shows its 15 voting frames instead). The **Stance** row under Facing (`stance/runs.csv`, since 2026-10-20) is the
stance on every frame: yellow = the left foot in front (orthodox), blue = the right foot in front (southpaw), grey =
neutral — the feet less than 0.15 torso apart along the facing direction (a stance of its own, drawn full like the
other two since 2026-10-22); empty = no data (an ankle not seen, no facing angle).

**Timeline layout** (redesigned 2026-10-22, after the first grouping with bands and outlines read worse): grouping by
space and type, the way Apple's own charts and track views read — no bands, no outlines. Three groups under small
uppercase headers, a hairline above each but the first: BODY (Facing, Stance), ACTIONS (Activity, Lead hand, Rear hand,
Defense), RULES. One left-aligned label column: each lane's name, and under it a colour key where the colours carry the
meaning (Facing: front / back, side-on; Stance: left, right, neutral; Activity: output, movement). Lanes are soft rounded
fills (`--lane`) 6 px apart, the time grid drawn inside them only; Apple system colours for the data; softer facing
bands; the excluded time a light wash marked "not judged"; the playhead carries the current time in a red pill in the
ruler; the lane under the mouse turns a shade darker; the overview's window is a tinted lens.

**Activity** (since 2026-10-22, viewer only, no rule reads it): two lines for looking at a round's output and movement
by eye. Green, filled = **output**: every punch and defensive move as one event at its middle frame under a Gaussian
(σ 2 s), in events a minute — exactly 0 far from any. Purple = **movement**: how far he actually travels, not how much he bounces (since 2026-10-22, the user's call, after
a speed of the hips showed bouncing more than moving): the hip centre averaged over 0.5 s (a bounce averages out to one
point) against where it was 1 s before, in torso lengths, both hips seen (visibility ≥ 0.5); plus the way to and from
the camera, which barely moves a point in the picture but changes the size — the change of the torso's log length over
that second (averaged over 1 s, as leaning, rolling and turning also shorten it) × 4; and turning (since 2026-10-22,
most test videos being filmed on one spot): the facing angle folded to 0–180° (so the model's +90 / −90 mix-up of a
side-on boxer is no fake half-turn), averaged over 1 s, its change over 3 s per second, 90° counting as one torso length;
combined as one distance a second,
over 6 dropped (a tracker jump), the same Gaussian, minus a fixed 0.15. Fixed scales for every video (top = 120 a
minute and 1.5 torso/s), so rounds compare by eye; the left column keys the two lines and the tooltip gives both values.
Measured 2026-10-22 on 24 test videos: 10 % of frames under 0.15, the median 0.45, 10 % over 1.14; a beginner staying
on one spot has a median of 0.17, a boxer moving around a court 0.70; a quick turn reads 0.5–0.65, while a slow circle
(4° a second) stays inside the facing model's jitter and barely shows.
The hips are not read (since 2026-10-22; a folder run 2026-10-20 to 10-22 has an `unclear` state, hips square
among its reasons, drawn grey too). The pill on the video names the frame's stance. Read on the raw skeleton, so never
flipped back. Short flips are mostly noise.
The Info tab's next rows: Gloves, `yes / no` from the backend's `gloves` stage (`gloves/gloves.json`: the hand points' shape, gloves
from 0.50; no rule reads it yet), Training, `bag work / shadowboxing (P(bag) X)` from the `bagwork` stage
(`bagwork/bagwork.json`: a logistic regression on how hidden the hands are, the framing and the punches; no rule reads
it yet), and Camera height, `~X cm (bucket, leg/torso Y)` from the `camera_height` stage (`camera_height/camera_height.json`,
since 2026-10-24: leg / torso length in the picture through four reference clips - floor 0, hips 95, head 170, above
the head 220 cm; `extrapolated` past them; `unknown` when the legs are seen on under 30 frames; no rule reads it yet).

**Steps** (the base row under Defense, on by default, since 2026-10-23; the backend's `steps` stage,
`steps/steps.csv`): every foot move, the lead foot's on the top half (light blue), the rear foot's below (indigo); the
video's pill names a foot while it moves. The counter is the AMBO app's own (Feet stance, `stance.ts`, one definition in
the backend's `ml/research/footwork/foot_moves.py`): a foot's centre (ankle, heel, toe) moving over 0.6 torso lengths a
second starts a move, back under 0.35 ends it. Against 545 labeled foot moves (YouTube footage, any angle, 2026-10-09;
its settings swept on the same labels) it found 87 % at precision 0.70, and about one labeled step in six comes out as
two moves - so read the row as when the feet move, not an exact step count. No rule reads it yet.

**Distance** (the base row under Stance, on by default, since 2026-10-24; the backend's `camera_distance` stage,
`camera_distance/distance.csv`): how far the boxer stands from the camera, camera → hips in metres, every frame — the
line is its median over 0.5 s, on a fixed 0–6 m scale (gridlines every 2 m, the same for every video, so videos compare
by eye); the tooltip gives that and the frame's own reading. The stage fits BlazePose's metre skeleton onto its pixel one
(13 joints) with an assumed 65° field of view over the picture's long side (black bars cut) and BlazePose's size of the
body — both guesses, so a whole video can read too near or too far by one factor; a forward lean (a squat) reads a
little farther. The Info tab shows the video's median and 10–90 %. No rule reads it yet.

**All videos** (header button, next to the video list): every video in the folder × every rule in one table — rows
are videos, columns are the overall round score and rules 1–36, each cell the 0–100 score tinted in its tier's colour
("–" = not rated). It is not a separate computation: each video is read with the viewer's own loader, minus the
timeline CSVs and the facing curve, which no round score needs (checked equal to the full read on all 495 cells,
2026-10-02), and scored by the same code as the Rules tab, so a cell always equals what that video's Round score card
says. A median row closes the table; each video is its number and its name. It only sorts: a rule's header (or
Overall) sorts the videos by it, best to worst; a video sorts the 33 rule columns by its scores, best to worst; the two
buttons in the corner put them back in number order (**Videos 1→N**, **Rules 1→N**). Not rated always goes last. It
opens with the videos and the rules in number order. Read once per folder (about 80 s for 29 videos over the local server, 2026-10-07) and kept; **Reload** re-reads after a
pipeline re-run. Esc or a click outside closes it.
**Export HTML** saves the table as one self-contained file (`ambo_round_scores_<date>.html`, about 22 KB for 56 videos):
the data and a few lines of sorting inlined, no network, so anyone can open it in a browser offline and sort any column
in the same four ways as the table here, and opens in the order the table had. It is the viewer's table itself - the
same function builds and sorts it (`ovrTableHTML` / `ovrTableWire`, embedded as they are) and the page's own table
styles are copied in at export, so it looks and works exactly like the table here. **Export PDF** opens the same page, sorted as on screen, and the browser's print dialog
(A3 landscape; choose Save as PDF). A PDF cannot sort - script in a PDF runs in Adobe Acrobat / Reader only, not in
browsers, Preview or most phone viewers (looked up 2026-10-12) - so the HTML is the file to send; the PDF is for print.

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
channels — they need joints (mouth corners, heels, foot-index (toe-tip) points) and channels (world x/z) the punch overlays never touch.
Punch speed has no overlay on purpose: it measures a duration, and a duration has no geometry to draw.

When punches overlap, every punch under the playhead draws its own overlay, and each label is prefixed with its
hand and punch ("Rear cross · …"); labels never land on top of each other — a label that would is moved down.

Turn on one or two at a time. With a dozen layers on, the picture is unreadable — that is a debugging view, not a
bug. Colors: green = full marks (100), red = below; orange only where a row has a
middle state (slip distance and bladedness, between 0 and 100) and in the hip / shoulder rotation cards, which name a
turn short of the range "too little" (orange) apart from one past it, "too much" (red). A stretch the rule threw out —
a joint it needs not visible, a punch in flight, the wrong camera angle, no facing angle — is a **dashed gray mid-line
carrying the reason** (`SKIPWORD`): `joint hidden`, `side-on`, `front-on`, `punching`, `hook / body`, `no facing` or `no side`,
written on the strip when there is room for it and in the tooltip always. The row is
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
  30th percentile of that punch type in the labelled corpus (8,166 punches marked by the labelling team; the backend's
  `reference/punch_speed_reference.csv`) and linearly down to 0 at its 80th; the score on the
  block, green at 100 and red below. Every angle is judged: a time is not foreshortened. Round = the mean punch
  score, a plain number, from at least 10 judged punches. Reads `punches.csv` + `punch_speed.json`.
- **Balance at impact** (`balance/`): per punch at the impact frame, read side-on (\|facing\| 65–115°, the rule's
  `camera_window_deg` since 2026-10-05), a score 0–100 = nose (0–50) +
  hip centre (0–50), in ankle distances. Nose: 50 while the nose is at most 0.20 past an ankle, linearly to 0 at 0.75
  past it. Hip centre: 50 while the hip centre is within 0.20 of the ankles' midpoint, linearly to 0 at 0.50 (over an
  ankle). The block is green when both are inside their green zone (score 100), red otherwise, and carries the
  score. The overlay draws the base between the ankles, the nose's slack as dashed ticks outside it, the hip
  centre's ticks, the nose and the hip centre, at the impact frame. Round = the mean punch score, a plain number with no bands,
  from at least 10 judged punches. Reads `punches.csv` + `balance.json`.
- **Rear-foot heel up** (rule 33, `rear_pivot/`; "Rear-foot pivot" until 2026-10-03): per rear-hand punch, at the impact frame, how far the rear heel sits above the
  rear foot-index (toe-tip) point in torso lengths, scored 0 with the heel level with the foot-index point and 100
  from 0.20, linearly between — green at 100, red below, the score on the block (the stance already carries the heel
  about 0.14 up, so a planted foot scores about 70). The overlay draws the foot-index point's height dashed grey, the
  0.20 line in the verdict's colour, the line from the foot-index point to the heel, and the heel. Every angle is
  judged; lead-hand punches and a hidden rear heel, foot-index point or torso are not drawn. Round = the mean punch score,
  a plain number, from at least 10. Reads `punches.csv` + `rear_pivot.json`.
- **Combo lands on one spot** (rule 40, `combo_same_spot/`, since 2026-10-23): per offensive combination (rule 30's),
  its punches thrown front-on (each punch's mean facing within `camera_window_deg`, 0–35°), each fist read at its impact
  frame (the knuckles' midpoint, else the wrist pushed 0.3 of the forearm further): the spread is the farthest-apart two
  fists across the picture over the median torso. 100 at 0.20 torso or less, 0 at 0.60 (punches side by side, each
  straight out of its own shoulder). Its timeline row draws every combination with two or more punches read, from its
  first frame to its last — green at 100, red below, grey in excluded time — with the score on the block; the tooltip
  gives the spread. On the video, inside a combination, each fist's landing spot is ringed in its punch's colour (the
  one landing on this frame bigger) between two dashed lines at the outermost two. The Now tab's combo card has its
  line. Round = the mean combination score, from at least 5 (the rule's own floor: front-on combinations are rare).
  Reads `combos.csv` + `combo_same_spot.json`.
- **Combo lands at one height** (rule 44, `combo_same_height/`, since 2026-10-24): rule 40 up and down, side-on. Per
  offensive combination (rule 30's), its head punches thrown side-on (each punch's mean facing within
  `camera_window_deg`, 65–115°), each fist read at its impact frame (the knuckles' midpoint, else the wrist pushed 0.3 of
  the forearm further; not read outside the picture or moving up or down faster than 4.5 torso lengths a second): the
  spread is the farthest-apart two fists up and down the picture over the median torso. Body shots are left out: the
  body-shot class, and a jab or cross at or under 0.75 of hip centre → shoulder centre. 100 at 0.20 torso or less, 0 at
  0.50. Its timeline row draws every combination with two or more head punches read, from its first frame to its last —
  green at 100, red below, grey in excluded time — with the score on the block; the tooltip gives the spread. On the
  video, inside a combination, each fist's landing spot is ringed in its punch's colour (the one landing on this frame
  bigger) between two dashed lines at the highest and the lowest. The Now tab's combo card has its line. Round = the
  mean combination score, from at least 10. Reads `combos.csv` + `combo_same_height.json`.
- **Chin tuck on impact** (rule 35, `chin_impact/`, since 2026-10-22): rule 8 on the punch frames it skips. Per
  punch, on the frames within ±`window_s` (0.1 s) of the impact, inside the punch, with a face chin at the 0.7 gate:
  the chin against the top of the shoulder that covers it — the punching shoulder on jabs, crosses and hooks (keypoint
  raised 0.09 torso), the other one on uppercuts and body shots (`dip_punches`; the punching shoulder dips, raised
  0.06) — at any camera angle; the punch takes its highest-chin frame: 100 at or below the top, 0 at 0.20 above.
  Height only since 2026-10-22 (a depth half, side-on, was dropped the same day). Green at 100, red below, the score
  on the block; the card and tooltip give the reading and its frame. The overlay draws the covering shoulder's top
  and this frame's chin. Skipped: no face on any frame read (about half the punches on the test videos — an arm in
  front of the face), a shoulder or hip hidden, excluded time. Round = the mean punch score, from at least 10. Reads
  `punches.csv` + `chin_impact.json`.
- **Punches stuck in the bag** (rule 41, `bag_bite/`, since 2026-10-23; the push model since 2026-10-26): bag work only
  (a test video by its known training type, the backend's `configs/training_types.json`; any other round by the bagwork
  stage's call - the Round row says which, and "not bag work" with it otherwise). Per jab and cross whose elbow
  straightens to 130°, the punching arm in BlazePose's world skeleton: how long the elbow stays within 20° of its
  straightest, the wrist's mean 3D speed over the 0.3 s after the arm is out (its reach first within 2 cm of its
  longest) and the punch's length, weighed by a logistic regression (the snapshot's `model`, fitted on coach Stafford's
  ratings) into the push probability; 100 at p ≤ 0.3, 0 at p ≥ 0.7. A block per judged punch, green snapping (100), red
  pushing, the score on it; the card and tooltip give the three readings, p and the arm's visibility; on the video the
  punching wrist is ringed, solid and labelled "coming back" over the 0.3 s return window. Round = the mean punch score
  (from 10); the Now tab lists it per jab / cross; skip reasons: a hook or an uppercut (not judged), the arm not seen
  (the bag hides the far arm), the elbow never straightening, no arm reading. Until 2026-10-26: the wrist's speed in the
  picture around the impact (arrival, pause, snap).
- **Looping uppercut** (rule 36, `uppercut_drop/`, since 2026-10-22; "Hand drop before the uppercut" until 2026-10-23): per head uppercut (body uppercuts are
  the punch model's body class and are not judged), the punching forearm's direction in world coordinates — (wrist y −
  elbow y) / forearm length, the arm filtered at 6 Hz — at its most downward over the window from 0.5 s before the
  start (or the end of the same hand's previous punch, when later) to impact. 100 up to 0.49 (about 29° below level),
  0 at 0.93 (about 68°), linear; both lines fitted to Stafford's ratings of 355 uppercut clips. The row draws the window,
  lead on the top half, rear below — green at 100, red below, the score on the block; the card and tooltip give the
  lowest reading, its frame and whether the window was trimmed. The overlay draws the punching forearm in the verdict's
  colour, thicker with a ring on the frame that decides. Skipped: the arm not seen (the median over the window of its
  least visible joint under 0.5 — mostly the far arm of a side-on boxer), no reading, excluded time. Round = the mean
  uppercut score, from at least 5. Reads `punches.csv` + `uppercut_drop.json`.
- **Hook overswing** (rule 32, `hook_stop/`; "Hook stop" until 2026-10-03): per head hook, read front-on or back-on, where the wrist is at the turnaround — the
  frame the impact spotter says it stopped going forward. Score 100 at the boxer's centre line or short of it, linearly to 0 at a third of a
  torso past his own far shoulder; green at 100, red below, the score on the block. The far shoulder is his centre
  line plus half his squared-up width (the 90th percentile of his shoulder separation over the clip), not the gap in
  that frame, which collapses when he blades. The overlay draws the centre line (green, 100), the far shoulder
  (dashed grey), the zero line (red) and the wrist. Round = the mean punch score, a plain number, from at
  least 10 — most hooks on the current footage are thrown side-on and are not judged at all. Reads `punches.csv` +
  `hook_stop.json`.
- **Hand return path** (`hand_return_path/`): per side-on jab / cross, the wrist's height above its own shoulder
  from the impact to the punch's end + 0.15 s — the tail cut at the next punch of the same hand when that starts
  sooner, and the window ended at the last frame before the wrist's visibility first drops under 0.3 after the impact
  (since 2026-10-08; the impact frame always starts the line, whatever its visibility; under 0.133 s left, the punch
  is skipped as wrist unsure) — against the straight line (chord) between its first and last frame. Not okay — a U — when the frames between the ends sit under the chord, at most 0.067 s of them on
  or over it (2 frames at 30 fps), and the deepest is at least 0.20 torso under it (both since 2026-10-08;
  a shallower sag is okay); okay otherwise; no grade per punch. The card, tooltip and video label give that deepest frame's distance (`dip` in `punches.csv`). The block covers the measured window itself (impact → end + 0.15 s), lead windows on the top half of the row
  and rear on the bottom (a cross's window runs into the next jab's all the time), a white edge where each window
  starts, green okay, red not okay, labelled with the frames under the chord. Each window draws on the video on its
  own wrist, its label always naming the punch ("Lead jab · okay · 0/4 under the chord"). A wrist under visibility 0.6
  is drawn hollow (an end) or as a hollow dot (a frame between), and the label gives the ends' visibility and "may be a
  guess": a wrist BlazePose cannot see (side-on, the far wrist behind the head or the body) still gets a position, on the
  chest, back or hip (by eye on the shelf's window ends, 2026-10-07: off the hand in 8 of 12 under 0.5, 6 of 12 at
  0.5–0.6, 1 of 12 at 0.6–0.8). Display only: the rule cuts its window at the wrist's own line (0.30 after the impact, the impact frame exempt), so dots between 0.30 and 0.6 still count. On the video, for every frame of that window: the wrist's whole line, the
  two ends (grey dots), each frame between them as a red (under) or green dot tied by a thin line to the chord, and
  where the wrist is now. The chord (dashed white) is the rule's own: a straight line in time of the wrist's height above
  its shoulder, drawn at each frame's wrist x and that frame's shoulder height — so a dot is under it exactly when the
  rule counted it (0 of 12,628 dots differ, 2026-10-02). Round = 100 with no punch not okay, linearly to 0 at 70 % not
  okay, a plain number; under 10 judged punches → not rated. Reads `punches.csv` + `hand_return_path.json`.
- **Dropping resting hand while punching** (`resting_hand/`; "idle hand" until 2026-09-28): per punch, the wrist
  of the hand that is NOT throwing, read over the frames within 0.033 s before the impact (their mean), at the impact
  frame and over the frames within 0.033 s after it (one frame each side at 30 fps; seconds since 2026-10-08), weighted
  ¼ · ½ · ¼ — how far it sits below the nose. Scored 100 up to 0.25 torso (an absolute line: a boxer who holds his hands low all round must not pass),
  linearly to 0 at 0.60 (since 2026-10-05; was ±2 frames, 0.40 / 0.70); green at 100, red below, with the score on
  the block. The overlay
  draws the 100 / 0 lines and the weighted reading at the impact frame, ticks each of the three readings on that scale
  (each read against its own frame's nose and torso, as the rule does), and rings the resting wrist at every frame
  the rule could read. That hand's own
  median guard is shown in the card, unjudged. Round = the mean punch score, a plain number with no bands. Frames
  around the impact and not the punch's window, because punches overlap inside a combination, which would leave most
  punches unjudgeable. Reads `punches.csv` + `resting_hand.json`.
- **Arm extension** (`arm_extension/`): per jab / cross the punch's largest elbow angle — its straightest frame, among
  the frames with the shoulder, elbow and wrist visible (since 2026-10-08; the frame of furthest reach before), if that
  frame is within 0.067 s of the punch's middle frame; otherwise the elbow angle at the middle frame (the arm hidden
  there: not judged) — scored
  linearly — 100 at 160° or straighter, 0 at 100° — and eased far from the camera: with the torso under ¼ of the
  frame height full marks start at 150°, under ⅛ the punch is not judged. With the arm visible on no frame of the
  punch it is not judged ("the arm is not visible on any frame of the punch"). Green at 100 and red below, the score on the block and a white
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
  is the rule's number (checked to 0.14° on 5,352 punches, 2026-10-02). The impact → end step is in the CSV but not shown
  (blank when the end frame hides a hip: only the start and impact frames decide whether a punch is judged).
- **Shoulder rotation** (`shoulder_rotation/`): the hip rule moved to the shoulders — per punch the start → impact
  turn of the punching shoulder against a set range per punch type (lead jab 5–30°, lead hook 35–70°, lead uppercut
  25–60°, lead body shot 40–75°, rear cross 30–60°, rear hook 40–75°, rear uppercut 30–75°, rear body shot 50–75°),
  scored like hip rotation — green at 100, red below, the score on the block; on the video the shoulder line in the
  verdict's colour and the same dial from above. The round is the mean punch score, no bands.
- **Hit height** (`hit_height/`): per punch of every type — jab, cross, hook, uppercut, body shot — read side-on
  (|facing| 65–115°; 75–105° on a video filmed from the floor or above the head - the camera_height stage's ground /
  above_head, since 2026-10-24 - and the angle badges, the Rules tab and the Round row show that video's window),
  the zone the fist is in at its impact frame (the midpoint of the index and pinky knuckle points; with either
  unseen, the wrist pushed 0.3 of the forearm further — `fist_from` in the CSV) against the boxer's own skeleton on that frame (the ghost below, whose heights are his: head = from the higher
  shoulder up to 0.28 torso above it, body = the middle third from the hip centre to the shoulder centre, misses = over the head, the shoulder gap
  between them and below the body; since 2026-10-08, a ghost stance built from his limb lengths before) and scores it
  0–100 (since 2026-10-24; on / off target only before): on target 100; over the head and below the body 100 at the
  zone's edge, linearly down to 0 at 0.5 torso past it; in the shoulder gap 100 at either edge, linearly down to 30 at
  its middle (`score`, `past_zone_torso`, `gap_share` in the CSV). The block: green on target (100), red off target,
  skipped not drawn, the score and zone on it, with a white tick at the impact frame; the card and tooltip say how far
  off target the fist is. On the video a ring on the
  fist where the rule read it at that frame (for ±2 frames around it, with a dot on the wrist now), with its zone and score. With the layer on, every frame also draws the ghost opponent (dashed): the boxer's own
  skeleton without the arms, mirrored about a vertical line through the nose and moved one arm's reach (upper arm +
  forearm, 90th percentile of both arms over ±1 s) toward the side the lead ankle points to — same height, floor and
  pose, face to face. Mirroring keeps every height, so the rule's zones are this ghost's: its shoulders and hips are the boxer's own.
  At the ghost's face a bar shows them on that frame — green = hit (head: from the higher shoulder up to 0.28 torso above it; body: the
  middle third from the hip centre to the shoulder centre), red = miss (over the head, the shoulder gap, below the body) — with dashed
  borders from the boxer to the ghost, the over / below bars running to where the score reaches 0 (dashed red lines,
  labelled 0) and a dashed orange line at the shoulder gap's middle (labelled 30); no bar when a shoulder or hip is under
  the house visibility floor. Round = the mean punch score of the judged punches, a plain number, from at least 10
  judged punches (100 × the on-target share before 2026-10-24; a video still on such a run says so in its Round row).
- **Head off center line** (`head_offcenter/`): per punch thrown facing or backing the camera, how far the head point
  (the middle of the visible face landmarks: nose, eyes, ears, mouth) is off a vertical line through the hip centre — 0.75 × at the impact frame + 0.125 × at 25 % of the punch + 0.125 × at 75 % (in torso lengths, each frame's own torso), scored linearly to 100 at 0.25 torso off —
  green at 100, red below, the score on the block — with a tick at the impact frame; on the video the vertical line through the hip centre (dashed) and the head point's distance from it.
  Round = the mean punch score, a plain number; under 10 judged punches → not rated. Reads `head_offcenter.csv` +
  `head_offcenter.json`.
- **Offensive combos** and **Combined combos** (`combinations/`; the rows of rules 24 and 30, and of rule 31): the same
  grouping for both — no pause longer than 0.3 s between elements (rules 30 / 31's `max_gap_s`), however long each lasts. Offensive = punches only; combined = punches and all
  defensive moves in time order (a move may start or end one). Each combination is one plain line from its first
  frame to its last (blue = offensive, purple = combined; 2 elements minimum — a lone punch or move is not a combination); hovering it lists its elements in
  order with their times; the punch card shows the combination holding that punch and how often its sequence repeats.
  Reads `offensive.csv` / `combined.csv` + `combinations.json`; the Round tab's Combos card counts both (how many, how
  many unique, each sequence with its count), and the Rules tab scores their variety as rules 30 (offensive) and 31
  (combined), each kind on its own combos (the share of combos that are one of the 3 most-used sequences: 100 at
  40 % or less, linearly to 0 at 100 %, < 10 combos not rated) — the combined one with the caveat that the defense model's
  noise inflates its variety. These are "items" layers (`items: true`): their rows are the combinations,
  not the punches.

- **Slip far enough** / **Slip not too much** (rules 14 and 15, `slip_distance/`; 15 was "Slips compact" until 2026-10-03): per slip, how far the head point (the middle of the visible face landmarks: nose,
  eyes, ears, mouth) travelled against the hip centre from where it started, in torso lengths, sideways (x) and up-down (y) each scored on its own for up to 50 points, summed (since 2026-10-07; x only
  before), with a white tick at the furthest frame of the axis with fewer points. Rolls, ducks and pull-backs are not measured. Judged front-on / back-on only;
  a frame is read when a face landmark and both hip points are visible (the overlay's path too: the head point against the hip centre, both axes, with a ring at each axis's furthest frame). Two timeline rows, one per rule, each slip coloured by that
  rule's slip score (green 100, orange between, red 0), and two round rows, each the mean of its slip scores: rule 14 "slip far enough" (per axis 50 at 0.20 torso of travel or more, 0 with none) and 15 "slip not too much" (per axis 50
  up to 0.50, 0 at 1.00). Reads `moves.csv` + `slip_distance.json`.
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
  continuous rows, both reading the chin found on the face (the backend's `face_chin` stage: a face detector, SCRFD,
  around the nose, then the chin tip of a face-landmark model, 2d106 — BlazePose has no chin landmark; since 2026-10-09,
  before that `nose + 2.25 × nose→mouth`), drawn as a ring; read from `face_chin/face_chin.csv` (a mirrored run's x
  flipped back). A frame whose face scores under `face_score_gate` (0.7) has no chin and is not judged.
  Height is the chin against the top of the lead shoulder (the keypoint raised 0.06 torso) in torso lengths, scored 100 with the chin at or below
  the shoulder top and linearly to 0 at 0.20 above — green at 100, red below. Depth is the chin against the
  shoulder's front (the lead keypoint pushed forward 0.10 torso) in torso lengths, scored 100 at or behind it and
  linearly to 0 at 0.40 in front — green at 100, red below — read side-on
  only. A dashed gray line is everything the rule could not look at: no face, a joint not visible, a punch in flight, or
  the wrong camera angle. Round = the mean frame score over every judged frame, however brief — a plain number, no
  bands; under 5 s of judged frames → not rated. Both read joints at visibility 0.30, like every rule. Read `runs.csv` + the stage's `.json`.
- **Stance width** (`stance_width/`) and **Stance depth** (`stance_depth/`): both per frame, both continuous rows
  — green fine, red too small, and a dashed gray line for everything the rule could not look at — the wrong side of
  the camera, or a joint not visible. Width = ankle-to-ankle distance in torso lengths,
  read front- or back-on; depth = the horizontal ankle gap in torso lengths, read side-on. Each frame scores 100 from its line (width 0.50,
  depth 0.73) and above, 0 with the ankles together (or level), linearly between — green at 100, red below. Round = the mean frame
  score, a plain number; under 5 s of judged frames → not rated. Read `runs.csv` + the stage's `.json`.
- **Elbow tuck** (`elbow_tuck/`): the research lens ported to Python — flare = how far the elbow sits out past its
  shoulder, away from the body's midline, / torso per arm (pulled in counts 0; the lens's |x shoulder − x elbow| until 2026-10-02),
  judged only while the boxer is within 25° of facing or backing the camera (45° until 2026-10-06) and that arm isn't
  throwing a hook or a body shot. The row is continuous — every frame belongs to a stretch: green tucked (flare ≤ 0.15,
  full marks), red flared (above it, below full marks), and a thin gray strip where the rule cannot judge, with the reason in its tooltip (the
  boxer is side-on, a joint it needs is not visible, or that arm is throwing a hook or a body shot). Lead in the top half, rear in the bottom. Each
  frame scores 0–100: each arm 50, full up to 0.15 flare and 0 at 0.50, or 100 when only one arm can be judged; the
  overlay labels it ("frame score 65.8 · lead 15.8/50 · rear 50.0/50"). Round = the mean frame score, no bands.
  Reads `runs.csv` + `elbow_tuck.json`.

**Angle change after combo** (rule 13, `angle_change/combos.csv` + `angle_change.json`; "Angle change" until 2026-10-03): per combined combo, the
mean facing during it against the most different smoothed facing in the 2 s after it; a turn of ≥ 45° scores the combo
100, else a turn of ≥ 45° inside the combo itself (between any two of its 0.5 s-smoothed facings) 50 (since
2026-10-07), else 0. Round = the mean combo score / 100 as the changed share: 100 at half or more, 0 at none, linear
between — a plain number, no bands; fewer than 10 readable combos → not rated. Its timeline row (since 2026-10-06) is
one block per combo — green (100) when he turned after it, orange (50) when only inside it, red (0) when he stayed, the
turn after it in degrees on it — with a thin tail over the 2 s the rule reads; a combo it
could not read — no facing angle during it or in the 2 s after it (no pose, or the video ends) — is a gray dashed strip
("no facing"). Inside a combo or its window the overlay says how far
the facing has turned so far against the 45° needed.

- **Defense after combo** (`defense_after_combo/combos.csv` + `.json`): the defensive move that covered an offensive
  combo, drawn in green where the move is; a combo nobody covered draws its empty search window as a hollow red box
  after its end. Hovering says how long after the combo the move started, or how long the window was and whether the
  next punch cut it. A move counts when it starts anywhere from the combo's first frame to 2 s after its last — or
  only until the next punch starts, if that comes first. Round = 100 at 70 % of combos covered or more, 0 at none,
  linearly in between; a plain number, no bands (fewer than 10 combos → not rated).

**Lead/rear hand balance** (rule 5, `hand_balance/hand_balance.json`; "Hand balance" until 2026-10-03; a whole-video rule): the share of punches
thrown with the rear hand, scored 100 from 25 % to 40 % (60 % until 2026-10-05) and falling linearly to 0 at 0 % (all lead) and at 100 % (all
rear); a plain number, no bands; fewer than 10 punches → not rated. The band is off-centre on purpose: the lead hand should throw more, the jab
being the most thrown punch. Each hand's punch types sit beside it, unjudged. Its timeline row (since 2026-10-06) has
a lane per hand over every punch it counts — lead blue on top, rear amber below (the share the score reads), the
punch's letter on each — so the split, and where in the round one hand takes over, can be seen.

**Combination length** (`combo_length/combo_length.json`, a whole-video rule; its combos are the Offensive combos row, shared with rule 30): over the offensive
combinations `run_combinations.py` already wrote, the share that are 3 punches or more, scored 0 at none and 100
from 40 %, linearly between — a plain number, no bands; fewer than 10 combinations → not rated. The mean length, the longest, the spread by
length and the share of punches thrown outside any combination sit beside it, unjudged.

**Fading output through round** (rule 26, `output_decay/output_decay.json`; "Output through the round" until 2026-10-03; a whole-video rule):
measured from the first punch to the last. Under 90 s of that span, the span is cut in three equal thirds and
the last third compared with the first; 90 s or more, the first 30 s from the first punch against the last 30 s up
to the last punch. 100 up to 15 % fewer punches at the end, linearly to 0 at 40 % fewer, a plain number; under 30
punches → not rated. The per-window counts, rates and dead shares are shown beside it, unjudged, to separate a
slower rate from more standing. It needs one continuous round to mean anything. Its timeline row (since 2026-10-06)
shades the two windows it compares in that video and draws only the punches each counted — blue in the first, amber
in the last, each window's count on its band; a short video's middle third is shaded gray, not compared. The windows
are recomputed in the page from the same punch start times and the video's thresholds snapshot, so the counts are the
rule's own.

**Stance changes** (rule 34, `stance_changes/stance_changes.json` + `segments.csv`, since 2026-10-22): the raw
per-frame stance (the Stance row, no smoothing) under a `move.window_s` (5 s) window sliding one frame at a time; a
window is held in a stance when at least `move.min_share` (80 %) of all its frames are that stance — neutral and no
data count against it, so a few misread frames do not break it but a long hole does. Its timeline row draws the
stretches of consecutive held windows, yellow orthodox / blue southpaw, with a white tick where a change starts; a
change is a held window in the other stance from the one held before. Score = 100 at 2 changes or fewer, linearly to 0
at 5; when rule 19, 20 or 33 scored under 70 in the round (`round.strict`) 100 at 0 changes, 0 at 2 (1 change = 50); no
held window: not rated. It reads the `facing_angle` stage's angle, so on a video whose facing stage predates the current
facing model it can differ from the Stance row, which computes its own.

**Combos too long** (rule 37, `combo_too_long/combo_too_long.json` + `combos.csv`, since 2026-10-22): every combined
combination (rule 31's: punches and defensive moves, each within 0.3 s of the last) of `move.min_elements` (7) moves or
more, one block from its first frame to its last — red when counted, grey when it touches the excluded time; the block
carries its number of moves and the tooltip lists them. Score = 100 at 5 or fewer such combinations, linearly to 0 at
10; fewer than 10 combined combinations: not rated.

**Solo punches** (rule 38, `solo_punches/solo_punches.json` + `punches.csv`, since 2026-10-22): every punch clear of
the excluded time in no combined combination (rule 31's: no punch or defensive move within 0.3 s before or after it),
one orange block each. Score = 100 at a solo share of 40 % or less, linearly to 0 at 100 %; fewer than 10 judged
punches: not rated.

**Flat-footed in guard** (rule 39, `flat_feet/flat_feet.json` + `runs.csv`, since 2026-10-22): every frame,
punches and defensive moves included (since the same day) — side-on (65–115°), both feet seen at visibility ≥ 0.5, as stretches — red where
both heels are down (each under 0.06 torso above its toe tip), green where a heel is up, gray where not judged; on the
video, each foot's heel → toe line in the same colour with the heel's height. Score = 100 at 15 % of that time
flat-footed or less, linearly to 0 at 45 %; under 5 s judged: not rated.

**Straight legs** (rule 42, `knee_bend/knee_bend.json` + `runs.csv`, since 2026-10-23): every frame, punches and
defensive moves included, side-on (65–115°), each leg on its own — the knee angle in the picture (hip – knee – ankle,
180° = a straight leg), read while the leg's points are seen (visibility ≥ 0.5) inside the picture and its foot is seen
from the side (heel to toe tip at least 0.40 of the shin; a foot turned toward the camera hides the bend). Lead leg on
the top half, rear below, as stretches: green where the leg scores 100 (lead knee at 155° or more bent, rear 159°),
red below, gray where not judged (the leg not seen, its foot turned, not side-on, excluded time); the tooltip gives each
stretch's mean angle and score. On the video each leg's hip – knee – ankle in the same colour with the knee's angle and
its score; the Now tab gives this frame's angles. Score per leg = 100 at its line, linearly to 0 at 180°; the round =
the mean of the two legs' means; either leg under 5 s judged: not rated.

**Front-foot heavy** (rule 45, `front_heavy/front_heavy.json` + `runs.csv`, since 2026-10-24): every frame, punches and
defensive moves included, side-on (65–115°) — where the hip centre and the nose sit on the line from the rear ankle (0)
to the front ankle (1), along the picture's x; read while the joints are seen (visibility ≥ 0.5), the ankles at least
0.25 torso apart, the front foot seen from the side (heel to toe tip at least 0.40 of the shin) and the shoulders at
most 0.45 torso apart in the picture (wider = facing the camera). One row of stretches: green where both halves score
full, orange where the hip centre (past 0.6) or the nose (past 1.2: a guard keeps the head over the front foot) is past
its line, red where both are, gray where not judged (a joint not seen, the feet together, the foot turned, not side-on,
excluded time); the tooltip gives each stretch's mean positions and score. On the video the ankle line with the two
marks (orange 0.6, blue 1.2) and the hip centre and the nose dropped onto it; the Now tab gives this frame's positions.
Score per frame = hips 50 (full to 0.6, 0 at 1.0) + head 50 (full to 1.2, 0 at 1.6); the round = the mean; under 5 s
judged: not rated.

**Form fades when tired** (rule 43, `form_fade/form_fade.json` + `thirds.csv`, since 2026-10-24): the judged time in
thirds; each form rule's own score over the first third against the last — hands (2, 4, 6), feet and legs (11, 12, 39,
42), punch speed (23), a rule counting when both thirds hold its own floor — and the mean of the drops. Its row draws
the two thirds compared (blue first, amber last, as rule 26), each tagged with the mean score of the rules that count;
the tooltip lists every rule's first → last score. Score = 100 at a mean drop of 0 points or less, linearly to 0 at 20;
under 60 s of judged time or fewer than 3 rules: not rated. It reads those rules' outputs and re-measures nothing.

**Dead time** (rule 25, `work_rate/work_rate.json` + `segments.csv`; "Work rate" until 2026-10-03): its timeline row shows the whole video as runs — green
where a punch or a defensive move covers it, blue where only a change of angle does, red for dead stretches with
their length, empty for the short pauses in between. A frame counts as work when a
punch or a defensive move covers it, or when he is changing angle — the 0.5 s-smoothed facing turning 90° or more in
under 1 s, only the frames of the turn itself. A stretch with none of these lasting ≥ 3 s is dead time. Score = 100 at no dead time, linearly
to 0 at 50 % dead — a plain number, no bands; under 20 s of video → not rated. Punches and actions per minute and the
seconds credited to turns are shown beside it, unjudged — punch rate is a style, standing still is not.

**Punch variety** (rule 27, `same_punches/same_punches.json`; "Same punches" until 2026-10-03; a whole-video rule): under the target
distribution, the share of the 2 most-used punch types, scored 100 at 66 % or less and linearly to 0 at 100 % (a plain
number; fewer than 10 punches → not rated). The top 2 because jab and cross are normally the most common anyway. Its
timeline row (since 2026-10-06) shows what that share is made of: every punch the rule counts
(`punch_impact/impacts.csv`) as a block with its type's letter, amber when the type is one of the 2 most-used, green
when it is another; hover gives the share and the scale. No punch is right or wrong — it is a round rule.

**Body shots** (`bodyshots/bodyshots.json`, a whole-video rule): under punch variety, body shots /
(body + head) over hooks and uppercuts only (the classifier can't split jab / cross into head / body): scored 0 at
none and 100 from 25 %, linearly between (a plain number); fewer than 10 hooks + uppercuts → not rated. The cut-offs are ours.
Its timeline row (since 2026-10-06) draws the punches it counts: body shots as solid green blocks ("B"), head hooks and
uppercuts as outlines (they only count in the total); jab and cross are not drawn.

**Defense variety** (rule 29, `same_defense/same_defense.json`; "Same defense" until 2026-10-03; a whole-video rule): under the defense
distributions, a score of two halves: 50 for the move — full up to 60 % of the most-used type, linearly to 0 at 100 % —
and 50 for the side among moves that have one — full up to 70 %, linearly to 0 at 100 %; each half needs 10 moves,
one alone is the whole score. Its timeline row (since 2026-10-06) has the same two halves as lanes over every move the
rule counts (`defense_classification/defenses.csv`): **move** — amber when it is the most-used type, green another;
**side** — amber when it went to the most-used side, green the other side, dashed ("no side") for a duck or a
pull-back, which the side half does not count. The defense model finds rolls far
better than slips, so a high roll share is partly the model.

**Adding or changing a rule**: see [instructions.md](instructions.md) — every place a rule lives in `index.html`, the
timeline-layer and Round-row templates, and the backend documents that change with it. Every rule has a timeline row
and a Round score row: a rule that judges punches, frames, defensive moves or combos draws each judged item; a rule
that only rates the round draws the moves it counts (punch variety and defense variety colour what their share is made
of). A split row names its two halves with `halves` (lead / rear by default).

**Isolating one camera angle**: shift-click a band in the facing row (front / side-on / back) and the timeline keeps
only the stretches the boxer spent in that band at full strength — everything else fades back and stops answering the
cursor, so a rule's row can be read against the view it is actually judged in. The bands are fixed ±45° / ±135°
cuts; since 2026-10-06 the gated rules judge narrower windows inside them — side-on 65–115°, front / back 0–25° +
155–180° — each shown beside its rule's badges. The chosen band is outlined in the facing row and named in a chip beside the zoom buttons;
shift-click it again, click the chip, or press Esc to clear. Faded is not hidden on purpose — the shape of the round
stays visible around the selection.

Keys: Space play · ← → one frame · Shift + ← → one second · ↑ ↓ previous / next event · I jump to the impact · Esc clear the angle filter.
