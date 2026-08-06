#!/usr/bin/env bash
# Assemble dist/ = the partner demo ONLY (not the debug viewer), ready for
# `firebase deploy` from the repo root. Pure copy, no build tooling.
#
# Source lives under demo/; the dist layout is unchanged (index.html at the
# site root, js/demo/, demo-brand/, demo-assets/) so nothing inside the HTML
# or modules needed to change when the sources moved. To develop: run this,
# then serve dist/.
set -euo pipefail
DEMO="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$DEMO")"
DIST="$ROOT/dist"
SESSION="session_1781788984153"
A="demo-assets/$SESSION"

rm -rf "$DIST"
mkdir -p "$DIST/js/demo" "$DIST/$A"

cp "$DEMO/index.html"              "$DIST/index.html"          # demo is the site root
cp "$DEMO"/js/*                    "$DIST/js/demo/"
cp "$ROOT/js/skeleton.js"          "$DIST/js/skeleton.js"      # reused renderer
cp "$ROOT/js/ondevice-loader.js"   "$DIST/js/ondevice-loader.js"
cp -r "$DEMO/brand"                "$DIST/demo-brand"          # official Cornerman lockup

# Featured session: web-compressed video + skeleton + analysis sidecar.
cp "$DEMO/assets/$SESSION/round_1_skeleton.json"          "$DIST/$A/"
cp "$DEMO/assets/$SESSION/round_1_ondevice_analysis.json" "$DIST/$A/"
cp "$DEMO/assets/$SESSION/round_1_web.mp4"                "$DIST/$A/"

echo "Built $DIST ($(du -sh "$DIST" | cut -f1)) — demo only, no debug viewer."
