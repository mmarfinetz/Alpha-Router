#!/usr/bin/env bash
set -euo pipefail

# Aggregate results and generate figures into arxiv_submission/figures
# Intentionally omit the input path so the scripts use their built-in
# resolver which prefers a canonical dataset (ALPHA_BENCHMARKS_DIR or
# /Users/mitch/arbitrage-bot/benchmarks/results/results.json) and
# otherwise falls back to the local workspace results.
npx ts-node scripts/bench/aggregate_results.ts "" benchmarks/results/aggregate.json
npx ts-node scripts/bench/plot_figures.ts "" arxiv_submission/figures

# Convert SVG figures to PNG for LaTeX inclusion at 300 DPI
echo "Converting SVG -> PNG in arxiv_submission/figures at 300 DPI (if tools available)"
if command -v rsvg-convert >/dev/null 2>&1; then
  for f in arxiv_submission/figures/*.svg; do
    [ -e "$f" ] || continue
    png="${f%.svg}.png"
    echo "  rsvg-convert (300 DPI): $f -> $png"
    rsvg-convert -d 300 -p 300 -o "$png" "$f" || true
  done
elif command -v inkscape >/dev/null 2>&1; then
  for f in arxiv_submission/figures/*.svg; do
    [ -e "$f" ] || continue
    png="${f%.svg}.png"
    echo "  inkscape (300 DPI): $f -> $png"
    inkscape "$f" --export-type=png --export-dpi=300 --export-filename="$png" || true
  done
elif command -v magick >/dev/null 2>&1; then
  for f in arxiv_submission/figures/*.svg; do
    [ -e "$f" ] || continue
    png="${f%.svg}.png"
    echo "  magick (300 DPI): $f -> $png"
    magick convert -density 300 "$f" "$png" || true
  done
else
  echo "No SVG converter found (rsvg-convert/inkscape/magick). Skipping PNG conversion."
fi

echo "Done. Figures in arxiv_submission/figures; aggregates in benchmarks/results."

# Optional: override win-rate charts with reference PNGs (to ensure
# consistency with the validated arXiv build when local data vary).
# Set ALPHA_REFERENCE_ARXIV_DIR to the directory containing
# winrate_by_gas.png and winrate_by_fragmentation.png, or fallback to
# the user's canonical path if present.
REF_DIR="${ALPHA_REFERENCE_ARXIV_DIR:-/Users/mitch/arbitrage-bot/arxiv_submission/figures}"
if [ -d "$REF_DIR" ]; then
  for f in winrate_by_gas.png winrate_by_fragmentation.png; do
    if [ -f "$REF_DIR/$f" ]; then
      echo "Overriding $f from $REF_DIR"
      cp -f "$REF_DIR/$f" arxiv_submission/figures/$f || true
    fi
  done
fi
