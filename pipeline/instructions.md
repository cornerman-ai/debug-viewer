# Adding a rule to the pipeline viewer

A rule is built in the backend (`cornerman-backend/combined_pipeline/rules_creation/run_<rule>.py`, writing
`Ambo/data/pipeline_tests/<video>/<stage>/`). Showing it here is part of implementing it, not a separate task.

## 1. Decide where it goes

**By what the rule judges, not by how interesting it is.**

| The rule judges | Where it goes |
| --- | --- |
| punches, frames, defensive moves or combos — anything that happens at a point in time | a **timeline layer** (`RULE_LAYERS`) **and** a Round score row |
| the round as a whole — one number or verdict for the video | the **Round score card only**, no timeline row |

Examples as of 2026-09-24. Timeline + Round score: arm extension, hip rotation, hit height, head off center line,
elbow tuck, offensive / combined combos. Round score only: angle change, defense after combo, same punches, same
defense, body shots, combo diversity.

A timeline row for a number that never changes during the video is noise — it draws the same thing everywhere.

## 2a. A timeline layer

One entry in `RULE_LAYERS` in `index.html`; the toggle, file loading, row, hover and punch card all come from it.

```js
{
  key: 'myrule', label: 'My rule', short: 'My rule',        // short = the timeline row's name, keep it narrow
  csv: ['my_rule', 'punches.csv'], json: ['my_rule', 'my_rule.json'],
  parse: (r, num) => r.verdict ? {verdict: r.verdict, deg: num(r.some_angle)} : null,   // joined by start frame + hand
  summary(P, js, {dot, count}) { ... },                      // kept for reuse; the panel does not render it now
  card: (e, x) => `<div class="sub">…</div>`,                // the punch card section in the Now view
  tip:  (e, x, {head, v}) => `…`,                            // the timeline tooltip
  row(e, x, {c, y, h, span, tag, ring, tx, fps}) { ... },     // draw the punch's block in this rule's row
  overlay(e, x, f, P, leadLeft) { ... },                     // optional: draw on the video
}
```

Rules whose rows are not punches (combos, stretches of frames) use `items: true` plus `parseItem`; then `row` is
called once per item, `S.items[key]` holds them, and hover hits anything under the cursor in that row.

House style for a row: draw only what the rule judged (skipped punches are not drawn), keep the block's colour the
verdict's colour, and put the measured value in the tag (`tag(x, w, y, h, '163°')`) rather than a score.

Also add the rule to `SCOPE` so the toggle says what it covers:

```js
myrule: {moves: 'jab, cross', angles: 'side-on'},            // angles: front, back, side-on
```

## 2b. A Round score row

In `ruleCard()` in `index.html`, one `add(name, value, colour, band, info)` call in the Notion rule order. `value` is
the 0–100 score where the rule has one, otherwise its rating word. `info` carries the four lines every row shows:

```js
add('My rule', js.rating, MYCOL[js.rating], null, {
  what: 'the coaching question in one plain line, ending in a question mark',
  on:   'what it was measured on, with the counts (70 of 81 judged)',
  th:   {                                                    // two groups; drop either if the rule has no such level
    event: {label: 'per punch', rule: 'what is measured on one punch / move / frame / combo',
            bands: [['≥ 157°', 'pass'], ['< 157°', 'fail']], pal: VERD, note: 'optional second line'},
    round: {label: 'per round', rule: 'how the round number is produced',
            bands: [['≥ 50 %', 'good'], ['25–50 %', 'some'], ['< 25 %', 'bad']], pal: MYCOL}},
  calc: '29 turned / 34 combos = 85%'});                     // the actual sum, with this video's numbers
```

Numbers in those lines come from the data, never hardcoded. The whole-video JSON is loaded next to the others in
`load()` (`S.myRule = await src.text(['my_rule', 'my_rule.json'])…`).

## 3. When a rule changes

A rule's wording in the viewer is part of the rule. Every time the backend rule changes — a threshold, a window, what
it is measured on, which frames it skips — update its **Round score row in the same commit**: the `what`, `on`, `th`
(the rule line and the bands) and `calc` lines, plus the timeline tooltip if it repeats the rule. Then re-run the
stage on both test videos so the numbers in the row come from the new rule, and check the row in the browser.

A row that still explains the old rule is worse than no row: it is read as the current truth.

The same commit also updates the backend's three documents, which are written to be read together and must never
contradict each other or the viewer:

- `combined_pipeline/rule_explanations.md` — what the rule measures and the fault it catches. Two lines, no numbers
  unless the number *is* the rule.
- `combined_pipeline/changes.md` — only what differs from the app or the lens, and anything tried and dropped.
- `combined_pipeline/threshold_source.md` — every number, marked **lens** or **ours**, with where it came from.

A new rule adds a row to all three. A changed threshold changes it in `threshold_source.md` and, if the reasoning
moved with it, in `changes.md`.

## 4. Before pushing

- Open both test videos in the browser and check the new row / rating renders with no console errors.
- Update `README.md` (the layer list, or the whole-video rule list).
- Push `debug-viewer` main — it deploys to <https://cornerman-ai.github.io/debug-viewer/pipeline/>.

The backend repo follows the usual rule: commit and push only when asked.
