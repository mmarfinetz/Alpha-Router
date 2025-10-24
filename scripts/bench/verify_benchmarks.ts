#!/usr/bin/env ts-node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function exists(p: string) { try { fs.accessSync(p); return true; } catch { return false; } }
function sha256(p: string) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

function resolveDir(label: string, arg?: string, fallback?: string): string {
  if (arg && exists(arg)) return arg;
  if (fallback && exists(fallback)) return fallback;
  throw new Error(`Could not resolve ${label} directory`);
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

async function main() {
  const srcDir = resolveDir('source', process.argv[2], process.env.ALPHA_BENCHMARKS_DIR || '/Users/mitch/arbitrage-bot/benchmarks');
  const dstDir = resolveDir('destination', process.argv[3], path.join(process.cwd(), 'benchmarks'));

  const srcRes = path.join(srcDir, 'results', 'results.json');
  const dstRes = path.join(dstDir, 'results', 'results.json');
  const resMatch = exists(srcRes) && exists(dstRes) && sha256(srcRes) === sha256(dstRes);

  const srcInst = path.join(srcDir, 'instances');
  const dstInst = path.join(dstDir, 'instances');
  let instMatch = false;
  if (exists(srcInst) && exists(dstInst)) {
    const sFiles = walkFiles(srcInst).filter(f => fs.statSync(f).isFile());
    const dFiles = walkFiles(dstInst).filter(f => fs.statSync(f).isFile());
    if (sFiles.length === dFiles.length) {
      const sHashes = sFiles.map(f => sha256(f)).sort();
      const dHashes = dFiles.map(f => sha256(f)).sort();
      instMatch = sHashes.every((h, i) => h === dHashes[i]);
    }
  }

  const ok = resMatch && instMatch;
  console.log(`results.json match: ${resMatch}`);
  console.log(`instances match: ${instMatch}`);
  if (!ok) process.exit(2);
}

main().catch(e => { console.error(e); process.exit(1); });

