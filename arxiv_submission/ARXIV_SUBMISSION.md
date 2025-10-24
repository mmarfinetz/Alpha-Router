ArXiv submission checklist and metadata

- Primary category: `cs.NE` (Neural and Evolutionary Computation)
- Secondary categories: `cs.CR`, `cs.DS`, `q-fin.TR` (optional)
- Comments (paste into arXiv form):
  Preprint, 20 pages, 8 figures, 9 tables; artifact pinned at commit a4ce66c3 (instructions inside).

Packaging (pdfLaTeX):
- Upload: `hybrid_ga_mev_arxiv.tex` and all PNGs under `arxiv_submission/figures/`.
- Build engine: pdfLaTeX (no shell-escape required).
- Bibliography: in-document `thebibliography` (no BibTeX/Biber).

Notes on recent fixes for consistency:
- Latency: captions and text now reflect a fixed ~0.53 s GA budget; quantile table caption updated accordingly. ECDF latency figure caption notes cap ≈ 0.53 s.
- Effect sizes: replaced `\gg 2.0` with `> 2.0` where exact values were not included.
- Figure captions: added N=30 seeds per stratum to win-rate bars and panel labels for Pareto (low/medium/high).

Suggested arXiv license: CC BY 4.0 (select on submission form).
