#!/usr/bin/env node
// #361: the local gate. One command runs the checks of the CI, in its order, and stops at the
// first red step, naming it:
//
//   node scripts/porte.mjs            everything ci.yml runs (collector, web, e2e), except WebKit
//   node scripts/porte.mjs --rapide   lint and tests only (Python, TypeScript, Vitest), before a commit
//   cd web && npm run porte           the same, from web/
//
// The steps are READ from .github/workflows/ci.yml, never written a second time here: two lists
// of the same rule have the same hole (AGENTS.md §5). Installation steps (pip install, npm ci,
// playwright install) are skipped: the gate checks the tree, it does not install it; a step
// already run in the same folder is not run twice. The e2e refuse a stale dist/ by themselves
// (web/e2e/dist-a-jour.mjs).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Jobs of ci.yml the gate runs, in this order (e2e-webkit needs WebKit: CI only). */
export const JOBS = ['collector', 'web', 'e2e'];
const INSTALL = /^(pip install|npm ci|npm install|npx playwright install)\b/;
/** Steps of the quick gate: lint, types and unit tests, nothing that builds. */
const QUICK = /^(ruff |pytest|npm test|npx tsc)/;

/**
 * The `run:` steps of the given jobs of a GitHub workflow, with their folder (the job's
 * `defaults.run.working-directory`, or the step's own). A line parser that knows only what
 * ci.yml uses: one-line `run:`, `working-directory:` on the step or under `defaults: run:`.
 */
export function ciSteps(yaml, jobs = JOBS) {
  const steps = [];
  let job = null;
  let jobDir = '.';
  let inJobs = false;
  let inDefaults = false;
  for (const line of yaml.split('\n')) {
    if (/^\S/.test(line)) inJobs = /^jobs:\s*$/.test(line);
    if (!inJobs) continue;
    const j = /^ {2}([\w-]+):\s*$/.exec(line);
    if (j) {
      job = j[1];
      jobDir = '.';
      inDefaults = false;
      continue;
    }
    if (!job || !jobs.includes(job)) continue;
    if (/^ {4}\S/.test(line)) inDefaults = /^ {4}defaults:/.test(line);
    const wd = /^ {8}working-directory: (\S+)\s*$/.exec(line);
    if (wd) {
      if (inDefaults) jobDir = wd[1];
      else if (steps.length && steps[steps.length - 1].job === job) steps[steps.length - 1].dir = wd[1]; // the step's own, after its run:
      continue;
    }
    const run = /^ {6}- run: (.+?)\s*(?:#.*)?$/.exec(line);
    if (run) steps.push({ job, dir: jobDir, cmd: run[1] });
  }
  return steps;
}

/** The steps the gate runs: no installation, no step twice in the same folder; `quick` keeps lint and tests. */
export function gateSteps(yaml, quick = false) {
  const seen = new Set();
  const out = [];
  for (const s of ciSteps(yaml)) {
    if (INSTALL.test(s.cmd)) continue;
    const key = `${s.dir}|${s.cmd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  if (!quick) return out;
  const q = out.filter((s) => QUICK.test(s.cmd));
  // types: `npm run build` runs tsc in the full gate; the quick one runs it alone
  q.push({ job: 'web', dir: 'web', cmd: 'npx tsc --noEmit' });
  return q;
}

function main() {
  const quick = process.argv.includes('--rapide');
  const steps = gateSteps(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'), quick);
  const t0 = Date.now();
  for (const [i, s] of steps.entries()) {
    console.log(`\n▶ porte ${i + 1}/${steps.length} [${s.job}] (${s.dir}) ${s.cmd}`);
    // PYTHONPATH: the collector is importable from the root as in the CI (`pip install -e .`)
    const env = { ...process.env, PYTHONPATH: [ROOT, process.env.PYTHONPATH].filter(Boolean).join(delimiter) };
    // `python -m pytest`: the `pytest` on the PATH may belong to another Python than the one with
    // the collector's dependencies (seen on 10/11: a system pytest without httpx). PYTHON overrides.
    const cmd = s.cmd.replace(/^pytest\b/, `${process.env.PYTHON ?? 'python'} -m pytest`);
    const r = spawnSync(cmd, { cwd: join(ROOT, s.dir), shell: true, stdio: 'inherit', env });
    if (r.status !== 0) {
      console.error(`\n✗ porte rouge à l'étape ${i + 1}/${steps.length} [${s.job}] : ${s.cmd} (dans ${s.dir})`);
      process.exit(r.status || 1);
    }
  }
  console.log(`\n✓ porte ${quick ? 'rapide ' : ''}verte : ${steps.length} étapes en ${Math.round((Date.now() - t0) / 1000)} s`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
