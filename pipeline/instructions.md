# Adding or changing a rule in the pipeline viewer

A rule is built in the backend (`cornerman-backend/combined_pipeline/rules_creation/run_<rule>.py`, writing
`Ambo/data/pipeline_tests/<video>/<stage>/`; the backend half, step by step:
`combined_pipeline/pipeline_notes/how_to_change_a_rule.md`). Showing it here is part of implementing it, not a
separate task.

## 1. Every rule gets a row

Every rule has a timeline row and a Round score row (since 2026-10-06). What the row draws depends on what the rule
judges:

| The rule judges | Its timeline row draws |
| --- | --- |
| punches, frames, defensive moves or combos — anything that happens at a point in time | each judged item, coloured by its verdict |
| the round as a whole, from moves it counts (a share of punch types, two windows of punches) | the moves it counts, coloured by their part in the number |

A row for a number that never changes during the video would draw the same thing everywhere; a share's row draws
the moves the share is made of, not the number.

## 2. Where a rule lives in `index.html`

Every place, in the order the page uses them:

- **`RULE_NAMES`** — its name, by number: the one place a name is written; everything else calls `RN(n)`. A rename
  changes it here, in the backend's thresholds file and in its `findings.json`.
- **`RULE_LAYERS`** — its timeline layer (§3). **`LAYER_RULES`** — the layer's rule numbers, shown beside its switch;
  the camera views under the switch come from the first one's entry in the video's thresholds snapshot (its
  `camera`). **`SCOPE`** — what it is measured on, the line under its switch.
- **`RULE_META`** — its "Analysis Group" / "Analyzed on" tags in the Rules tab (the Notion columns).
- **`ruleCard()`** — its Round score row (§4).
- **`explainRows()`** — its Explanations tab row: `[number, what it measures, judged on, scoring, why]`; the camera view
  comes from the snapshot.
- **`PUNCH_RULES`** (a per-punch rule) or **`frameCard()`** (a per-frame rule) — its line in the Now tab's punch or
  frame card.
- **`SKIPTXT`** (the Now tab's sentence for a skip reason) and **`SKIPWORD`** (the word written on a gray strip) — an
  entry for every new skip reason or gray state.
- **`buildVideo()`** loads every layer's `csv` / `json` by itself; a whole-video JSON no layer declares goes in its
  `SUMS` map.
- **`README.md`** — its entry in the layer list.

## 3. A timeline layer

One entry in `RULE_LAYERS`; the toggle, the file loading, the row, the hover and the punch card all come from it.

```js
{
  key: 'myrule', label: RN(34), short: 'My rule',           // label = the toggle (RULE_NAMES), short = the row's name
  csv: ['my_rule', 'punches.csv'], json: ['my_rule', 'my_rule.json'],
  parse: (r, num) => r.verdict ? {verdict: r.verdict, score: num(r.score)} : {verdict: '', skip: r.skip_reason},
                                                             // joined to the punch by start frame + hand
  card: (e, x) => `<div class="sub">…</div>`,                // the punch card's section in the Now view
  tip:  (e, x, {head, v}) => `…`,                            // the timeline tooltip
  row(e, x, {c, y, h, span, tag, ring, tx, fps}) { … },     // draws the punch's block in this rule's row
  overlay(e, x, f, P, leadLeft) { … },                       // optional: drawn on the video for the punch under the playhead
}
```

A rule whose items are not punches (combos, stretches of frames, defensive moves) sets `items: true` and a
`parseItem(r, num)`; `row` is then called once per item, `S.items[key]` holds them, and hover hits anything under the
cursor in that row. `split: 'hand'` / `'arm'` / `'lane'` (with `halves` naming the two) splits a row in two;
`window: true` draws a window before the punch; a per-frame rule draws on the video with `frameOverlay(f, P, …)`.

House style for a row:

- Draw only what the rule judged. A stretch it could not judge is a gray dashed strip with its reason
  (`skipStrip(…, why)`, the word from `SKIPWORD`); a skipped punch is not drawn.
- Green only at full marks (100), red below — orange only where the rule's scale names a middle state.
- The tag on a block is the item's **score** (`tag(x, w, y, h, '83.2')`); the measured value goes in the tooltip.
- Every number in a tooltip, card or overlay label comes from the video's thresholds snapshot — `T(n, 'move.score.full')`,
  `H(n, 'min_judged')` — inside `THR(() => …)`, so a missing file shows the marker instead of a number. Never a
  literal.

## 4. A Round score row

In `ruleCard()`, one `add(name, value, color, info)` call — or `scored(key, name, q => info)` for a per-punch rule
whose pass / fail / skip counts come from the punches:

```js
add(RN(34), js.score ?? 'not rated', js.score == null ? '#8e8e93' : 'var(--text)', {
  what: 'the coaching question in one plain line, ending in a question mark',
  on:   'what it was measured on, with the counts (70 of 81 judged) and why the rest were skipped',
  th:   THR(() => ({event: {label: 'per punch', rule: `the per-item rule, its numbers from T(34, …)`,
                            bands: [[`≥ ${fD(T(34, 'move.score.full'), 2)}`, '100'], [`≤ ${fD(T(34, 'move.score.zero'), 2)}`, '0']],
                            pal: {'100': '#34c759', '0': '#ff3b30'}},
                    round: {label: 'per round', rule: `the mean punch score — a plain number, no bands; fewer than ${NJ(34)} judged punches: not rated`}}),
              thMiss),
  calc: '29 turned / 34 combos = 85% → 100'});              // the actual sum, with this video's numbers
```

`value` is the 0–100 round score the backend wrote, `'not rated'` when it wrote `null`. `NJ(n)` / `NF(n)` print the
rule's punch / frame floor. Drop the `event` group for a rule with no per-item level.

## 5. When a rule changes

A rule's wording here is part of the rule. When the backend rule changes — what it is measured on, which frames it
skips, how it scores — update in the same commit its Round row (`what`, `on`, `th`, `calc`), its `explainRows` row,
its tooltip / card / overlay text and its `README.md` entry. A threshold change alone needs no edit here: every
number reads the video's snapshot. Rerun the stage on the test videos (`run_all.py --stages <stage> --force`) so the
snapshots and the outputs are the new ones, then check the row in the browser.

A row that still explains the old rule is worse than no row: it is read as the current truth.

The same commit also updates the backend's documents, which are written to be read together and must never
contradict each other or the viewer:

- `combined_pipeline/pipeline_notes/rule_explanations.md` — what the rule measures and the fault it catches. Two lines,
  no numbers unless the number *is* the rule.
- `combined_pipeline/pipeline_notes/rule_cards.md` — every rule in six lines: what it reads, its camera angle, its row
  here, how one punch (frame, combo, move) is scored and how the round is; every number as in the thresholds file.
- `combined_pipeline/pipeline_notes/threshold_source.md` — every number, marked **lens**, **study**, **coach** or
  **ours**, with where it came from.
- `combined_pipeline/pipeline_notes/rule_dependencies.md` — what the rule reads, when that changes.

A new rule adds an entry to all four. A changed threshold changes it in `threshold_source.md` and in `rule_cards.md`
(`how_to_change_a_threshold.md` beside them has the full list).

## 6. Before pushing

- The rule's stage is in `STAGES` in the backend's `combined_pipeline/run_all.py`, or a fresh run never makes it.
- Open a few test videos (`python combined_pipeline/pipeline_server.py` serves them on http://localhost:8766/) and
  check the row, the Rules tab, the Explanations tab and the Now card render with no console errors.
- Update `README.md`.
- Push `debug-viewer` main — it deploys to <https://cornerman-ai.github.io/debug-viewer/pipeline/> — and the backend
  with it.
