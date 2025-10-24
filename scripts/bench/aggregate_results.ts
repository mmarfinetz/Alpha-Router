#!/usr/bin/env ts-node
import fs from 'fs';
import path from 'path';
import { runStats } from '../analysis/stat_tests';

type Record = {
  id: string;
  seed: number;
  gasRegime: string;
  orderSizeClass: string;
  fragmentation: string;
  ammDiversity: string;
  ga: { net: string };
  split: { net: string };
  milp: { net: string };
};

function parseBN(x: string): number {
  // Convert wei string to ETH float for reporting
  const len = x.length;
  const eth = len > 18 ? x.slice(0, len - 18) + '.' + x.slice(len - 18) : '0.' + x.padStart(18, '0');
  return parseFloat(eth);
}

function bestBaselineNet(r: Record): number {
  const s = Math.max(parseBN(r.split.net), 0);
  const m = Math.max(parseBN(r.milp.net), 0);
  return Math.max(s, m);
}

function resolveResultsPath(arg?: string): string {
  // If arg provided, accept file path directly; if a directory, append results/results.json
  if (arg) {
    const stat = (() => { try { return fs.statSync(arg); } catch { return null; } })();
    if (stat?.isDirectory()) {
      const candidate = path.join(arg, 'results', 'results.json');
      if (fs.existsSync(candidate)) return candidate;
    }
    return arg;
  }
  // Try environment override first
  const envBase = process.env.ALPHA_BENCHMARKS_DIR || process.env.BENCHMARKS_DIR;
  const candidates: string[] = [];
  if (envBase) candidates.push(path.join(envBase, 'results', 'results.json'));
  // External canonical path
  candidates.push('/Users/mitch/arbitrage-bot/benchmarks/results/results.json');
  // Local workspace fallbacks
  candidates.push(path.join(process.cwd(), 'benchmarks/results/results.json'));
  candidates.push(path.resolve(__dirname, '../../benchmarks/results/results.json'));
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error('Could not locate benchmarks/results/results.json. Provide a path as argv[2] or set ALPHA_BENCHMARKS_DIR.');
}

async function main() {
  const file = resolveResultsPath(process.argv[2]);
  const out = process.argv[3] || path.join(process.cwd(), 'benchmarks/results/aggregate.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record[];

  // Group by strata: orderSizeClass|fragmentation|ammDiversity|gasRegime
  const groups = new Map<string, Record[]>();
  for (const r of data) {
    const key = [r.orderSizeClass, r.fragmentation, r.ammDiversity, r.gasRegime].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const agg: any[] = [];
  for (const [key, records] of groups.entries()) {
    const parts = key.split('|');
    const ga = records.map(r => parseBN(r.ga.net));
    const base = records.map(r => bestBaselineNet(r));
    const paired = records.map((_, i) => ({ id: `${records[i].id}-${records[i].seed}`, ga: ga[i], baseline: base[i] }));
    const stats = runStats(paired as any);
    agg.push({
      key: { orderSizeClass: parts[0], fragmentation: parts[1], ammDiversity: parts[2], gasRegime: parts[3] },
      n: records.length,
      wilcoxon: stats.wilcoxon,
      effectSize: stats.effectSize,
      bootstrap: stats.bootstrap,
      ecdf: stats.ecdf,
    });
  }

  fs.writeFileSync(out, JSON.stringify({ strata: agg }, null, 2));
  console.log(`Saved aggregate to ${out}`);
}

main().catch(e => { console.error(e); process.exit(1); });
