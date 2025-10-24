#!/usr/bin/env ts-node
/**
 * Statistical validation utilities for GA vs baseline
 * - Paired Wilcoxon signed-rank test
 * - Bootstrap 95% CI for mean improvement
 * - Cohen's d effect size
 * - ECDF generation
 *
 * Usage:
 *   npx ts-node scripts/analysis/stat_tests.ts input.json
 *
 * input.json format:
 *   [ { "id": "instance-1", "ga": 1.23, "baseline": 1.10 }, ... ]
 */

import * as fs from 'fs';

type RecordItem = { id: string; ga: number; baseline: number };

function wilcoxonSignedRank(x: number[], y: number[]) {
  // Paired: compute differences
  const diffs = x.map((xi, i) => xi - y[i]).filter(d => d !== 0);
  const absDiffs = diffs.map((d, i) => ({ idx: i, val: Math.abs(d), sign: Math.sign(d) }));
  // Rank absolute diffs
  absDiffs.sort((a, b) => a.val - b.val);
  const ranks: number[] = new Array(absDiffs.length).fill(0);
  let i = 0;
  while (i < absDiffs.length) {
    let j = i;
    while (j + 1 < absDiffs.length && absDiffs[j + 1].val === absDiffs[i].val) j++;
    const rank = (i + j + 2) / 2; // average rank (1-based)
    for (let k = i; k <= j; k++) ranks[k] = rank;
    i = j + 1;
  }
  const Wpos = ranks.reduce((acc, r, idx) => acc + (absDiffs[idx].sign > 0 ? r : 0), 0);
  const Wneg = ranks.reduce((acc, r, idx) => acc + (absDiffs[idx].sign < 0 ? r : 0), 0);
  const W = Math.min(Wpos, Wneg);
  const n = diffs.length;
  // Normal approximation for n > 20
  const meanW = n * (n + 1) / 4;
  const sdW = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24);
  const z = (W - meanW) / sdW;
  // Two-sided p-value from normal approximation
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return { W, z, p, n };
}

function normalCdf(z: number) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Numerical approximation of erf
function erf(x: number) {
  // Abramowitz and Stegun formula 7.1.26
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function bootstrapMeanCI(values: number[], B = 1000, alpha = 0.05) {
  const means: number[] = [];
  for (let b = 0; b < B; b++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      const idx = Math.floor(Math.random() * values.length);
      sum += values[idx];
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor((alpha / 2) * B)];
  const hi = means[Math.floor((1 - alpha / 2) * B)];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { mean, ci: [lo, hi] };
}

function cohensD(x: number[], y: number[]) {
  const nx = x.length, ny = y.length;
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const varv = (arr: number[], m: number) => arr.reduce((a, b) => a + Math.pow(b - m, 2), 0) / (arr.length - 1);
  const mx = mean(x), my = mean(y);
  const vpooled = (((nx - 1) * varv(x, mx)) + ((ny - 1) * varv(y, my))) / (nx + ny - 2);
  return (mx - my) / Math.sqrt(vpooled || 1e-9);
}

function ecdf(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return s.map((v, i) => ({ x: v, y: (i + 1) / s.length }));
}

function runStats(records: RecordItem[]) {
  const ga = records.map(r => r.ga);
  const base = records.map(r => r.baseline);
  const improve = records.map((_, i) => (ga[i] - base[i]) / Math.max(1e-9, Math.abs(base[i])));

  const wil = wilcoxonSignedRank(ga, base);
  const boot = bootstrapMeanCI(improve, 2000, 0.05);
  const d = cohensD(ga, base);
  const ecdfGa = ecdf(ga);
  const ecdfImp = ecdf(improve);

  return { wilcoxon: wil, bootstrap: boot, effectSize: d, ecdf: { ga: ecdfGa, improvement: ecdfImp } };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: ts-node scripts/analysis/stat_tests.ts input.json");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as RecordItem[];
  const out = runStats(data);
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

export { wilcoxonSignedRank, bootstrapMeanCI, cohensD, ecdf, runStats };

