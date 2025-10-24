# Hybrid Genetic Algorithm for Optimal User Order Routing (Publication Package)

This repo contains the paper source/PDF, benchmark instances, result JSONs, and scripts to (re)generate figures from provided results. Solver implementation is intentionally excluded.

## Reproduce Figures

- Requirements: Node.js >= 18
- Install dev deps: `npm install`
- Generate figures (uses local benchmarks by default): `npm run figures`
  - Output: `arxiv_submission/figures/*.svg` (PNG converted for LaTeX if converter available)
  - Aggregates: `benchmarks/results/{aggregate.json,latency_summary.json}`
  - To use an external benchmark repo (e.g., `/Users/mitch/arbitrage-bot/benchmarks`), either:
    - Set `ALPHA_BENCHMARKS_DIR=/Users/mitch/arbitrage-bot/benchmarks` and run the same command, or
    - Pass the results path explicitly:
      - `npx ts-node scripts/bench/aggregate_results.ts /Users/mitch/arbitrage-bot/benchmarks/results/results.json benchmarks/results/aggregate.json`
      - `npx ts-node scripts/bench/plot_figures.ts /Users/mitch/arbitrage-bot/benchmarks/results/results.json arxiv_submission/figures`

## Paper

- Canonical PDF: `arxiv_submission/hybrid_ga_mev_arxiv.pdf`
- LaTeX source: `arxiv_submission/hybrid_ga_mev_arxiv.tex`

## Data

- Instances: `benchmarks/instances/*.json`
- Results: `benchmarks/results/results.json`

License: MIT
