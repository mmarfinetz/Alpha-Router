#!/usr/bin/env ts-node
import fs from 'fs';
import path from 'path';

type Rec = {
  gasRegime: 'low'|'medium'|'high'|string;
  ga: { gross: string; net: string; swaps: number; timeMs?: number };
  split: { net: string; timeMs?: number };
  milp: { net: string; timeMs?: number };
};

function parseWeiToEthFloat(s: string): number {
  const neg = s.startsWith('-');
  const t = neg ? s.slice(1) : s;
  const len = t.length;
  const eth = len > 18 ? t.slice(0, len - 18) + '.' + t.slice(len - 18) : '0.' + t.padStart(18, '0');
  const v = parseFloat(eth);
  return neg ? -v : v;
}

function unique<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }

function ensureDir(p: string) { fs.mkdirSync(p, { recursive: true }); }

function writeFile(fp: string, content: string) {
  ensureDir(path.dirname(fp));
  fs.writeFileSync(fp, content);
}

function computeECDF(values: number[]) {
  const s = [...values].sort((a,b)=>a-b);
  return s.map((v,i)=>({x:v,y:(i+1)/s.length}));
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

function computeNonDominated(points: {x:number;y:number}[]) {
  // minimize x (gas), maximize y (surplus)
  const sorted = [...points].sort((a,b)=> a.x - b.x || b.y - a.y);
  const front: {x:number;y:number}[] = [];
  let bestY = -Infinity;
  for (const p of sorted) {
    if (p.y > bestY) {
      front.push(p);
      bestY = p.y;
    }
  }
  return front;
}

function svgLinePath(data: {x:number;y:number}[], xScale:(n:number)=>number, yScale:(n:number)=>number) {
  if (data.length === 0) return '';
  return data.map((d,i)=> `${i===0?'M':'L'}${xScale(d.x).toFixed(2)},${yScale(d.y).toFixed(2)}`).join(' ');
}

function makeAxisTicks(min:number,max:number,steps:number) {
  const arr:number[] = [];
  const step = (max-min)/steps;
  for (let i=0;i<=steps;i++) arr.push(min + i*step);
  return arr;
}

function renderSVG({width,height,padLeft,padBottom,title,xLabel,yLabel,curve,color,points}:{
  width:number;height:number;padLeft:number;padBottom:number;title:string;xLabel:string;yLabel:string;curve:{data:{x:number;y:number}[];xMin:number;xMax:number;yMin:number;yMax:number};color:string;points?:{data:{x:number;y:number}[];color?:string}
}) {
  const w = width, h = height, pl = padLeft, pb = padBottom, pr=20, pt=30;
  const plotW = w - pl - pr, plotH = h - pt - pb;
  const xScale = (x:number)=> pl + ( (x-curve.xMin) / Math.max(1e-12,(curve.xMax-curve.xMin)) ) * plotW;
  const yScale = (y:number)=> pt + plotH - ( (y-curve.yMin) / Math.max(1e-12,(curve.yMax-curve.yMin)) ) * plotH;
  const pathD = svgLinePath(curve.data, xScale, yScale);
  const xticks = makeAxisTicks(curve.xMin, curve.xMax, 4);
  const yticks = makeAxisTicks(curve.yMin, curve.yMax, 4);
  const pointCircles = points ? points.data.map(p=>`<circle cx='${xScale(p.x).toFixed(2)}' cy='${yScale(p.y).toFixed(2)}' r='2' fill='${points.color||'#444'}' />`).join('\n') : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>
  <rect x='0' y='0' width='${w}' height='${h}' fill='white' />
  <text x='${w/2}' y='18' font-family='sans-serif' font-size='14' text-anchor='middle'>${title}</text>
  <!-- Axes -->
  <line x1='${pl}' y1='${pt}' x2='${pl}' y2='${pt+plotH}' stroke='#000'/>
  <line x1='${pl}' y1='${pt+plotH}' x2='${pl+plotW}' y2='${pt+plotH}' stroke='#000'/>
  <!-- Ticks X -->
  ${xticks.map(t=>`<line x1='${xScale(t)}' y1='${pt+plotH}' x2='${xScale(t)}' y2='${pt+plotH+5}' stroke='#000'/>`).join('')}
  ${xticks.map(t=>`<text x='${xScale(t)}' y='${pt+plotH+18}' font-size='10' text-anchor='middle' font-family='sans-serif'>${t.toFixed(2)}</text>`).join('')}
  <!-- Ticks Y -->
  ${yticks.map(t=>`<line x1='${pl-5}' y1='${yScale(t)}' x2='${pl}' y2='${yScale(t)}' stroke='#000'/>`).join('')}
  ${yticks.map(t=>`<text x='${pl-8}' y='${yScale(t)+3}' font-size='10' text-anchor='end' font-family='sans-serif'>${t.toFixed(2)}</text>`).join('')}
  <!-- Labels -->
  <text x='${pl+plotW/2}' y='${h-5}' font-family='sans-serif' font-size='12' text-anchor='middle'>${xLabel}</text>
  <text transform='translate(12,${pt+plotH/2}) rotate(-90)' font-family='sans-serif' font-size='12' text-anchor='middle'>${yLabel}</text>
  <!-- Data -->
  <path d='${pathD}' fill='none' stroke='${color}' stroke-width='2'/>
  ${pointCircles}
</svg>`;
}

function renderBarChart({width,height,padLeft,padBottom,title,xLabel,yLabel,bars,color}:{
  width:number;height:number;padLeft:number;padBottom:number;title:string;xLabel:string;yLabel:string;bars:{label:string;value:number}[];color:string;
}) {
  const w = width, h = height, pl = padLeft, pb = padBottom, pr=20, pt=30;
  const plotW = w - pl - pr, plotH = h - pt - pb;
  const yMax = Math.max(100, ...bars.map(b=>b.value));
  const yMin = 0;
  const barWidth = plotW / (bars.length * 1.5);
  const barSpacing = plotW / bars.length;
  const yScale = (y:number)=> pt + plotH - ( (y-yMin) / (yMax-yMin) ) * plotH;
  const yticks = [0, 25, 50, 75, 100];
  const barElements = bars.map((b,i)=> {
    const x = pl + i * barSpacing + (barSpacing - barWidth) / 2;
    const barHeight = ((b.value - yMin) / (yMax - yMin)) * plotH;
    const y = pt + plotH - barHeight;
    return `<rect x='${x.toFixed(2)}' y='${y.toFixed(2)}' width='${barWidth.toFixed(2)}' height='${barHeight.toFixed(2)}' fill='${color}' stroke='#333' stroke-width='1'/>
    <text x='${(x + barWidth/2).toFixed(2)}' y='${(pt + plotH + 18).toFixed(2)}' font-size='11' text-anchor='middle' font-family='sans-serif'>${b.label}</text>
    <text x='${(x + barWidth/2).toFixed(2)}' y='${(y - 5).toFixed(2)}' font-size='10' text-anchor='middle' font-family='sans-serif'>${b.value.toFixed(1)}%</text>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>
  <rect x='0' y='0' width='${w}' height='${h}' fill='white' />
  <text x='${w/2}' y='18' font-family='sans-serif' font-size='14' text-anchor='middle'>${title}</text>
  <!-- Axes -->
  <line x1='${pl}' y1='${pt}' x2='${pl}' y2='${pt+plotH}' stroke='#000'/>
  <line x1='${pl}' y1='${pt+plotH}' x2='${pl+plotW}' y2='${pt+plotH}' stroke='#000'/>
  <!-- Ticks Y -->
  ${yticks.map(t=>`<line x1='${pl-5}' y1='${yScale(t)}' x2='${pl}' y2='${yScale(t)}' stroke='#000'/>`).join('')}
  ${yticks.map(t=>`<text x='${pl-8}' y='${yScale(t)+3}' font-size='10' text-anchor='end' font-family='sans-serif'>${t}</text>`).join('')}
  <!-- Labels -->
  <text x='${pl+plotW/2}' y='${h-5}' font-family='sans-serif' font-size='12' text-anchor='middle'>${xLabel}</text>
  <text transform='translate(12,${pt+plotH/2}) rotate(-90)' font-family='sans-serif' font-size='12' text-anchor='middle'>${yLabel}</text>
  <!-- Bars -->
  ${barElements}
</svg>`;
}

function extent<T>(arr: T[], accessor: (t: T) => number): {min:number;max:number} {
  let min = Infinity;
  let max = -Infinity;
  for (const el of arr) {
    const v = accessor(el);
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 1;
  return { min, max };
}

function resolveResultsPath(arg?: string): string {
  if (arg) {
    const stat = (() => { try { return fs.statSync(arg); } catch { return null; } })();
    if (stat?.isDirectory()) {
      const candidate = path.join(arg, 'results', 'results.json');
      if (fs.existsSync(candidate)) return candidate;
    }
    return arg;
  }
  const envBase = process.env.ALPHA_BENCHMARKS_DIR || process.env.BENCHMARKS_DIR;
  const candidates: string[] = [];
  if (envBase) candidates.push(path.join(envBase, 'results', 'results.json'));
  candidates.push('/Users/mitch/arbitrage-bot/benchmarks/results/results.json');
  candidates.push(path.join(process.cwd(), 'benchmarks/results/results.json'));
  candidates.push(path.resolve(__dirname, '../../benchmarks/results/results.json'));
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error('Could not locate benchmarks/results/results.json. Provide a path as argv[2] or set ALPHA_BENCHMARKS_DIR.');
}

async function main() {
  const resultsPath = resolveResultsPath(process.argv[2]);
  const outDir = process.argv[3] || path.join(process.cwd(), 'arxiv_submission/figures');
  ensureDir(outDir);
  const raw = JSON.parse(fs.readFileSync(resultsPath, 'utf-8')) as Rec[];
  const regimes = unique(raw.map(r=>r.gasRegime));
  const latencySummary: Record<string, {p50:number;p90:number;p95:number;p99:number}> = {};
  
  // ECDF of improvement per gas regime (percent improvement vs best baseline)
  for (const regime of regimes) {
    const subset = raw.filter(r=> r.gasRegime === regime);
    // Compute percentage improvement relative to best baseline; clip to [-100, 100] to handle near-zero baselines
    const improvements = subset
      .filter(r => r.ga.gross !== '-1000000000000000000') // exclude sentinel failures
      .map(r => {
        const ga = parseWeiToEthFloat(r.ga.net);
        const split = parseWeiToEthFloat(r.split.net);
        const milp = parseWeiToEthFloat(r.milp.net);
        const base = Math.max(split, milp);
        const denom = Math.max(1e-9, Math.abs(base));
        let pct = ((ga - base) / denom) * 100;
        // Clip extreme values when baselines are near zero
        if (!Number.isFinite(pct)) pct = 0;
        pct = Math.max(-100, Math.min(100, pct));
        return pct;
      })
      .filter((imp:number) => isFinite(imp));
    if (improvements.length === 0) continue;
    const ecdf = computeECDF(improvements);
    // Fixed bounds for percent improvement
    const xMin = -100;
    const xMax = 100;
    const svg = renderSVG({
      width: 520, height: 360, padLeft: 50, padBottom: 40,
      title: `ECDF of % improvement (Hybrid vs best baseline), ${regime} gas`, xLabel: 'Net surplus improvement (%)', yLabel: 'ECDF',
      curve: { data: ecdf, xMin, xMax, yMin: 0, yMax: 1 }, color: '#1f77b4'
    });
    writeFile(path.join(outDir, `ecdf_improvement_gas_${regime}.svg`), svg);
  }

  // Pareto fronts per regime: trade-off between net surplus (ETH) and gas cost (ETH)
  for (const regime of regimes) {
    const subset = raw.filter(r=> r.gasRegime === regime);
    const gweiByRegime: Record<string, number> = { low: 10, medium: 30, high: 80 };
    const gasGwei = gweiByRegime[String(regime)] ?? 30;
    const pts: {x:number;y:number}[] = [];
    for (const r of subset as any[]) {
      if (Array.isArray(r.gaCandidates) && r.gaCandidates.length > 0) {
        for (const c of r.gaCandidates) {
          const x = parseWeiToEthFloat(String(c.gasCost));
          const y = parseWeiToEthFloat(String(c.net));
          // Filter out infeasible/sentinel candidates that blow out the axes
          const grossStr = String((c as any).gross ?? '');
          const gasUnitsVal = (() => {
            try { return BigInt((c as any).gasUnits); } catch { return 0n; }
          })();
          const looksInfeasible = grossStr === '-1000000000000000000' || gasUnitsVal > 10000000n; // 1e7 gas units is unrealistic
          const looksCrazy = x <= 0 || x > 5 || !isFinite(x) || !isFinite(y) || Math.abs(y) > 1000;
          if (!looksInfeasible && !looksCrazy) pts.push({ x, y });
        }
      } else {
        // Fallback: approximate from swap count
        const gasUnits = (r.ga?.swaps || 0) * 150000 + 80000;
        const gasCostEth = gasUnits * gasGwei * 1e-9;
        const netEth = parseWeiToEthFloat(r.ga?.net || '0');
        if (isFinite(gasCostEth) && isFinite(netEth)) pts.push({ x: gasCostEth, y: netEth });
      }
    }
    // Keep only profitable (user-positive) candidates
    const ptsPos = pts.filter(p => isFinite(p.y) && p.y > 0 && isFinite(p.x) && p.x >= 0);
    const front = computeNonDominated(ptsPos);
    // Robust axis ranges (use 1st-99th percentiles on positives)
    let xMin = 0, xMax = 1, yMin = 0, yMax = 1;
    if (ptsPos.length > 0) {
      const xs = [...ptsPos.map(p=>p.x)].sort((a,b)=>a-b);
      const ys = [...ptsPos.map(p=>p.y)].sort((a,b)=>a-b);
      const q01x = quantile(xs, 0.01);
      const q99x = quantile(xs, 0.99);
      const q01y = quantile(ys, 0.01);
      const q99y = quantile(ys, 0.99);
      xMin = Math.max(0, q01x * 0.95);
      xMax = Math.max(q99x * 1.05, xMin + 1e-4);
      yMin = Math.max(0, q01y * 0.95);
      yMax = Math.max(q99y * 1.05, yMin + 1e-4);
    }
    const svg = renderSVG({
      width: 520, height: 360, padLeft: 60, padBottom: 40,
      title: `Pareto: net surplus vs gas cost (${regime})`, xLabel: 'Gas cost (ETH)', yLabel: 'Net surplus (ETH)',
      curve: { data: front, xMin, xMax, yMin, yMax }, color: '#d62728',
      points: { data: ptsPos, color: '#999' }
    });
    writeFile(path.join(outDir, `pareto_gas_${regime}.svg`), svg);
  }

  // Latency ECDFs (GA convergence time) per gas regime + quantiles
  for (const regime of regimes) {
    const subset = raw.filter(r=> r.gasRegime === regime);
    const latS = subset.map(r => (r.ga.timeMs ?? 0) / 1000).filter(x => isFinite(x) && x >= 0);
    if (latS.length === 0) continue;
    const ecdf = computeECDF(latS);
    // GA time budget is 1 s in the bench harness; allow small overhead in plotting window
    const xMin = 0;
    const xMax = 1.2;
    const svg = renderSVG({
      width: 520, height: 360, padLeft: 60, padBottom: 40,
      title: `ECDF of GA latency (${regime} gas; cap = 1 s)`, xLabel: 'Latency (s)', yLabel: 'ECDF',
      curve: { data: ecdf, xMin, xMax, yMin: 0, yMax: 1 }, color: '#ff7f0e'
    });
    writeFile(path.join(outDir, `ecdf_latency_ga_${regime}.svg`), svg);

    const sorted = [...latS].sort((a,b)=>a-b);
    latencySummary[regime] = {
      p50: quantile(sorted, 0.50),
      p90: quantile(sorted, 0.90),
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
    };
  }

  // Write latency summary JSON next to aggregate output
  try {
    const summaryPath = path.join(path.dirname(resultsPath), 'latency_summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(latencySummary, null, 2));
  } catch {}

  // Supplemental: ECDF by order size and fragmentation (percent improvement)
  const orderSizes = unique((raw as any).map((r:any)=> r.orderSizeClass).filter((x:any)=>x));
  for (const os of orderSizes) {
    const subset = (raw as any).filter((r:any)=> r.orderSizeClass === os);
    if (subset.length === 0) continue;
    const improvements = subset
      .filter((r:any) => r.ga.gross !== '-1000000000000000000')
      .map((r:any) => {
        const ga = parseWeiToEthFloat(r.ga.net);
        const split = parseWeiToEthFloat(r.split.net);
        const milp = parseWeiToEthFloat(r.milp.net);
        const base = Math.max(split, milp);
        const denom = Math.max(1e-9, Math.abs(base));
        let pct = ((ga - base) / denom) * 100;
        if (!Number.isFinite(pct)) pct = 0;
        return Math.max(-100, Math.min(100, pct));
      })
      .filter((imp:number) => isFinite(imp));
    if (improvements.length === 0) continue;
    const ecdf = computeECDF(improvements);
    const xMin = -100;
    const xMax = 100;
    const svg = renderSVG({ width: 520, height: 360, padLeft: 50, padBottom: 40,
      title: `ECDF of % improvement (order=${os})`, xLabel: 'Net surplus improvement (%)', yLabel: 'ECDF',
      curve: { data: ecdf, xMin, xMax, yMin: 0, yMax: 1 }, color: '#2ca02c' });
    writeFile(path.join(outDir, `ecdf_improvement_order_${os}.svg`), svg);
  }

  const frags = unique((raw as any).map((r:any)=> r.fragmentation).filter((x:any)=>x));
  for (const f of frags) {
    const subset = (raw as any).filter((r:any)=> r.fragmentation === f);
    if (subset.length === 0) continue;
    const improvements = subset
      .filter((r:any) => r.ga.gross !== '-1000000000000000000')
      .map((r:any) => {
        const ga = parseWeiToEthFloat(r.ga.net);
        const split = parseWeiToEthFloat(r.split.net);
        const milp = parseWeiToEthFloat(r.milp.net);
        const base = Math.max(split, milp);
        const denom = Math.max(1e-9, Math.abs(base));
        let pct = ((ga - base) / denom) * 100;
        if (!Number.isFinite(pct)) pct = 0;
        return Math.max(-100, Math.min(100, pct));
      })
      .filter((imp:number) => isFinite(imp));
    if (improvements.length === 0) continue;
    const ecdf = computeECDF(improvements);
    const xMin = -100;
    const xMax = 100;
    const svg = renderSVG({ width: 520, height: 360, padLeft: 50, padBottom: 40,
      title: `ECDF of % improvement (fragmentation=${f})`, xLabel: 'Net surplus improvement (%)', yLabel: 'ECDF',
      curve: { data: ecdf, xMin, xMax, yMin: 0, yMax: 1 }, color: '#9467bd' });
    writeFile(path.join(outDir, `ecdf_improvement_fragmentation_${f}.svg`), svg);
  }

  // ECDF of absolute surplus improvement per gas regime (in ETH, only profitable GA solutions)
  for (const regime of regimes) {
    const subset = raw.filter(r=> r.gasRegime === regime);
    const improvements = subset
      .filter(r => r.ga.gross !== '-1000000000000000000') // exclude sentinel failures
      .map(r => {
        const gaNet = parseWeiToEthFloat(r.ga.net);
        const splitNet = parseWeiToEthFloat(r.split.net);
        const milpNet = parseWeiToEthFloat(r.milp.net);
        const baseline = Math.max(splitNet, milpNet);
        const improvement = gaNet - baseline;
        return { improvement, gaNet };
      })
      .filter(d => d.gaNet > 0 && isFinite(d.improvement)) // only profitable GA solutions
      .map(d => d.improvement);
    if (improvements.length === 0) continue;
    const ecdf = computeECDF(improvements);
    // Adaptive bounds based on filtered data
    const xMin = Math.min(0, Math.min(...improvements) * 0.95);
    const xMax = Math.max(...improvements) * 1.05;
    const svg = renderSVG({
      width: 520, height: 360, padLeft: 60, padBottom: 40,
      title: `ECDF of Δ net surplus (ETH), ${regime} gas`,
      xLabel: 'Δ Net surplus (ETH)',
      yLabel: 'ECDF',
      curve: { data: ecdf, xMin, xMax, yMin: 0, yMax: 1 },
      color: '#1f77b4'
    });
    writeFile(path.join(outDir, `ecdf_delta_surplus_gas_${regime}.svg`), svg);
  }

  // ECDF of absolute surplus improvement by order size (in ETH, only profitable GA solutions)
  for (const os of orderSizes) {
    const subset = (raw as any).filter((r:any)=> r.orderSizeClass === os);
    if (subset.length === 0) continue;
    const improvements = subset
      .filter((r:any) => r.ga.gross !== '-1000000000000000000')
      .map((r:any) => {
        const gaNet = parseWeiToEthFloat(r.ga.net);
        const splitNet = parseWeiToEthFloat(r.split.net);
        const milpNet = parseWeiToEthFloat(r.milp.net);
        const baseline = Math.max(splitNet, milpNet);
        const improvement = gaNet - baseline;
        return { improvement, gaNet };
      })
      .filter((d:any) => d.gaNet > 0 && isFinite(d.improvement))
      .map((d:any) => d.improvement);
    if (improvements.length === 0) continue;
    const ecdf = computeECDF(improvements);
    const xMin = Math.min(0, Math.min(...improvements) * 0.95);
    const xMax = Math.max(...improvements) * 1.05;
    const svg = renderSVG({
      width: 520, height: 360, padLeft: 60, padBottom: 40,
      title: `ECDF of Δ net surplus (ETH), order=${os}`,
      xLabel: 'Δ Net surplus (ETH)',
      yLabel: 'ECDF',
      curve: { data: ecdf, xMin, xMax, yMin: 0, yMax: 1 },
      color: '#2ca02c'
    });
    writeFile(path.join(outDir, `ecdf_delta_surplus_order_${os}.svg`), svg);
  }

  // ECDF of absolute surplus improvement by fragmentation (in ETH, only profitable GA solutions)
  for (const f of frags) {
    const subset = (raw as any).filter((r:any)=> r.fragmentation === f);
    if (subset.length === 0) continue;
    const improvements = subset
      .filter((r:any) => r.ga.gross !== '-1000000000000000000')
      .map((r:any) => {
        const gaNet = parseWeiToEthFloat(r.ga.net);
        const splitNet = parseWeiToEthFloat(r.split.net);
        const milpNet = parseWeiToEthFloat(r.milp.net);
        const baseline = Math.max(splitNet, milpNet);
        const improvement = gaNet - baseline;
        return { improvement, gaNet };
      })
      .filter((d:any) => d.gaNet > 0 && isFinite(d.improvement))
      .map((d:any) => d.improvement);
    if (improvements.length === 0) continue;
    const ecdf = computeECDF(improvements);
    const xMin = Math.min(0, Math.min(...improvements) * 0.95);
    const xMax = Math.max(...improvements) * 1.05;
    const svg = renderSVG({
      width: 520, height: 360, padLeft: 60, padBottom: 40,
      title: `ECDF of Δ net surplus (ETH), fragmentation=${f}`,
      xLabel: 'Δ Net surplus (ETH)',
      yLabel: 'ECDF',
      curve: { data: ecdf, xMin, xMax, yMin: 0, yMax: 1 },
      color: '#9467bd'
    });
    writeFile(path.join(outDir, `ecdf_delta_surplus_fragmentation_${f}.svg`), svg);
  }

  // Win rate by fragmentation (% of instances where GA beats baseline)
  const fragWinRates: {label:string;value:number}[] = [];
  for (const f of frags) {
    const subset = (raw as any).filter((r:any)=> r.fragmentation === f);
    if (subset.length === 0) continue;
    const feasible = subset.filter((r:any) => r.ga.gross !== '-1000000000000000000');
    if (feasible.length === 0) continue;
    const wins = feasible.filter((r:any) => {
      const ga = parseWeiToEthFloat(r.ga.net);
      const split = parseWeiToEthFloat(r.split.net);
      const milp = parseWeiToEthFloat(r.milp.net);
      const base = Math.max(split, milp);
      return ga > base;
    }).length;
    const winRate = (wins / feasible.length) * 100;
    fragWinRates.push({label: String(f), value: winRate});
  }
  if (fragWinRates.length > 0) {
    const svg = renderBarChart({
      width: 520, height: 360, padLeft: 60, padBottom: 50,
      title: 'Win rate by fragmentation level (GA > baseline)',
      xLabel: 'Fragmentation', yLabel: 'Win rate (%)',
      bars: fragWinRates, color: '#9467bd'
    });
    writeFile(path.join(outDir, 'winrate_by_fragmentation.svg'), svg);
  }

  // Win rate by gas regime (% of instances where GA beats baseline)
  const gasWinRates: {label:string;value:number}[] = [];
  for (const regime of regimes) {
    const subset = raw.filter(r=> r.gasRegime === regime);
    if (subset.length === 0) continue;
    const feasible = subset.filter((r:any) => r.ga.gross !== '-1000000000000000000');
    if (feasible.length === 0) continue;
    const wins = feasible.filter((r:any) => {
      const ga = parseWeiToEthFloat(r.ga.net);
      const split = parseWeiToEthFloat(r.split.net);
      const milp = parseWeiToEthFloat(r.milp.net);
      const base = Math.max(split, milp);
      return ga > base;
    }).length;
    const winRate = (wins / feasible.length) * 100;
    gasWinRates.push({label: String(regime), value: winRate});
  }
  if (gasWinRates.length > 0) {
    const svg = renderBarChart({
      width: 520, height: 360, padLeft: 60, padBottom: 50,
      title: 'Win rate by gas regime (GA > baseline)',
      xLabel: 'Gas regime', yLabel: 'Win rate (%)',
      bars: gasWinRates, color: '#1f77b4'
    });
    writeFile(path.join(outDir, 'winrate_by_gas.svg'), svg);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
