#!/usr/bin/env ts-node
import fs from 'fs';
import path from 'path';

function ensureDir(p: string) { fs.mkdirSync(p, { recursive: true }); }

function copyFile(src: string, dst: string) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function exists(p: string) { try { fs.accessSync(p); return true; } catch { return false; } }

function resolveSrcDir(arg?: string): string {
  if (arg && exists(arg)) return arg;
  const envBase = process.env.ALPHA_BENCHMARKS_DIR || process.env.BENCHMARKS_DIR;
  if (envBase && exists(envBase)) return envBase;
  const canonical = '/Users/mitch/arbitrage-bot/benchmarks';
  if (exists(canonical)) return canonical;
  throw new Error('Could not resolve source benchmarks dir. Provide a path as argv[2] or set ALPHA_BENCHMARKS_DIR.');
}

function syncDir(srcDir: string, dstDir: string) {
  const copies: string[] = [];
  const tryCopy = (rel: string) => {
    const s = path.join(srcDir, rel);
    const d = path.join(dstDir, rel);
    if (exists(s)) { copyFile(s, d); copies.push(rel); }
  };

  // Ensure base folders exist
  ensureDir(dstDir);
  ensureDir(path.join(dstDir, 'results'));
  ensureDir(path.join(dstDir, 'instances'));

  // Instances: copy directory recursively if present
  const instSrc = path.join(srcDir, 'instances');
  const instDst = path.join(dstDir, 'instances');
  if (exists(instSrc)) {
    const entries = fs.readdirSync(instSrc);
    for (const e of entries) {
      const sPath = path.join(instSrc, e);
      const dPath = path.join(instDst, e);
      const st = fs.statSync(sPath);
      if (st.isDirectory()) {
        // Shallow copy subfolders (we don't expect deep trees here)
        ensureDir(dPath);
        for (const f of fs.readdirSync(sPath)) {
          const sf = path.join(sPath, f);
          const df = path.join(dPath, f);
          if (fs.statSync(sf).isFile()) { copyFile(sf, df); copies.push(path.join('instances', e, f)); }
        }
      } else if (st.isFile()) {
        copyFile(sPath, dPath); copies.push(path.join('instances', e));
      }
    }
  }

  // Results: copy key files if present
  for (const rel of ['results/results.json', 'results/aggregate.json', 'results/latency_summary.json']) {
    tryCopy(rel);
  }
  return copies;
}

async function main() {
  const srcDir = resolveSrcDir(process.argv[2]);
  const dstDir = process.argv[3] || path.join(process.cwd(), 'benchmarks');
  const copied = syncDir(srcDir, dstDir);
  console.log(`Synced ${copied.length} files from ${srcDir} -> ${dstDir}`);
  for (const rel of copied.slice(0, 10)) console.log(`  ${rel}`);
  if (copied.length > 10) console.log('  ...');
}

main().catch(e => { console.error(e); process.exit(1); });

