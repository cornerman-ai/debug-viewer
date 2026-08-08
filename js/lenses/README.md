# js/lenses — one module per lens

Every module here follows the same contract (see registry.js header):
`{ id, label, mount(host, state), update(state), draw?(ctx, state), skeletonStyle?(state) }`.
Drop a file in the right folder, import + push it in `registry.js`, done.

Folders (the folder is the type — filenames carry no `_lens`/`_model` suffix):

- `rules/`     — workbenches for shipped rules-engine rules (named after the rule)
- `models/`    — inspect a trained model's outputs (GT vs predictions)
- `research/`  — lenses for `cornerman-backend/ml/research/<topic>` work (same topic names)
- `inspect/`   — pose/data-quality tools (no rule, no model)
- `shared/`    — helpers lenses import (punch_detections = which punches a lens
                 analyzes: GT labels else classifier predictions; rules_score =
                 mistake→quality mapping mirroring rules_config.json scoring.bands;
                 glove_filter, skeleton_schemas, axiality_predictions;
                 segment_set = the curated-set machinery behind frontal_set
                 (camera as opponent) and side_set (camera side-on), including
                 the source-second → cache-frame conversion); not lenses,
                 never in the registry

Data a lens fetches lives in `/lens_data/` (fetch paths resolve against the
page, so moving modules never breaks them).
