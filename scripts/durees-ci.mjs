#!/usr/bin/env node
// #653: the durations of the CI, read the same way at every review (revue § 6, « Durées de la CI »)
// instead of by hand. Read only: the public API of the runs (`gh api`, the GitHub login of gh, no
// secret of the repository), nothing is launched nor written.
//
//   node scripts/durees-ci.mjs <run> [<run>…]   each job of these runs (every attempt), and its long steps
//   node scripts/durees-ci.mjs --main 5         the last 5 green runs of ci.yml on main, then per job
//                                               its shortest and longest duration and its longest step
//   --seuil 60                                  a step is « long » from this many seconds (default 60);
//                                               the browser installations are always printed
//
// The computation (durations, filter, summary) is in pure functions, tested without network
// (web/src/durees-ci.test.ts).
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** A browser installation step: always printed, whatever its duration (#653: 29 min 36 s once). */
const INSTALL = /playwright install/;

/** Seconds between two ISO times (null when one is missing: a step skipped or still running). */
export function seconds(start, end) {
  if (!start || !end) return null;
  return Math.round((Date.parse(end) - Date.parse(start)) / 1000);
}

/** « 29 min 36 s », « 43 s », « 1 h 02 min 05 s ». */
export function formatDuration(s) {
  if (s === null || s === undefined) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min ${String(r).padStart(2, '0')} s`;
  return m ? `${m} min ${String(r).padStart(2, '0')} s` : `${r} s`;
}

/** The step's command as ci.yml writes it (« Run npm ci » → « npm ci »). */
const stepName = (name) => name.replace(/^Run /, '');

/**
 * The jobs of a run as the API gives them (`/actions/runs/<id>/jobs`): for each job its duration,
 * its conclusion, and its long steps (≥ `threshold` s, or a browser installation), in the run's
 * order. [{ name, attempt, conclusion, duration, steps: [{ name, duration }] }]
 */
export function jobDurations(jobs, threshold = 60) {
  return jobs.map((j) => ({
    name: j.name,
    attempt: j.run_attempt ?? 1,
    conclusion: j.conclusion ?? j.status,
    duration: seconds(j.started_at, j.completed_at),
    steps: (j.steps ?? [])
      .map((s) => ({ name: stepName(s.name), duration: seconds(s.started_at, s.completed_at) }))
      .filter((s) => s.duration !== null && (s.duration >= threshold || INSTALL.test(s.name))),
  }));
}

/** The lines printed for one run. */
export function runLines(id, jobs, threshold = 60) {
  const out = [`Run ${id} :`];
  for (const j of jobDurations(jobs, threshold)) {
    out.push(`  ${j.name}${j.attempt > 1 ? ` (tentative ${j.attempt})` : ''} : ${formatDuration(j.duration)} (${j.conclusion})`);
    for (const s of j.steps) out.push(`    ${formatDuration(s.duration).padStart(13)}  ${s.name}`);
  }
  return out;
}

/**
 * Per job, over several runs ([{ id, jobs }]): shortest and longest duration, longest step (and
 * its range) — the table of the review. Only the last attempt of each job counts.
 */
export function summaryLines(runs, threshold = 60) {
  const byJob = new Map();
  for (const run of runs) {
    const last = new Map();
    for (const j of jobDurations(run.jobs, threshold)) if (!last.has(j.name) || j.attempt >= last.get(j.name).attempt) last.set(j.name, j);
    for (const j of last.values()) {
      if (!byJob.has(j.name)) byJob.set(j.name, []);
      byJob.get(j.name).push(j);
    }
  }
  const out = [`Sur ${runs.length} run(s) :`];
  for (const [name, js] of byJob) {
    const d = js.map((j) => j.duration).filter((x) => x !== null);
    const steps = new Map();
    for (const j of js) for (const s of j.steps) steps.set(s.name, [...(steps.get(s.name) ?? []), s.duration]);
    let longest = null;
    for (const [step, ds] of steps) if (!longest || Math.max(...ds) > Math.max(...longest[1])) longest = [step, ds];
    const range = (xs) => (Math.min(...xs) === Math.max(...xs) ? formatDuration(xs[0]) : `${formatDuration(Math.min(...xs))} à ${formatDuration(Math.max(...xs))}`);
    out.push(`  ${name} : ${d.length ? range(d) : '—'}${longest ? ` ; étape la plus longue : ${longest[0]}, ${range(longest[1])}` : ''}`);
  }
  return out;
}

/** « Opaland/netatmo » from GITHUB_REPOSITORY or the `origin` remote. */
function repository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const m = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error(`dépôt GitHub introuvable dans le remote origin (${url}) : définir GITHUB_REPOSITORY`);
  return m[1];
}

const api = (path) => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

function main(argv) {
  const opt = (name, dflt) => {
    const i = argv.indexOf(name);
    if (i < 0) return dflt;
    const v = Number(argv[i + 1]);
    if (!Number.isInteger(v) || v < 0) throw new Error(`${name} attend un nombre entier`);
    argv.splice(i, 2);
    return v;
  };
  const threshold = opt('--seuil', 60);
  const onMain = opt('--main', 0);
  const ids = argv.filter((a) => /^\d+$/.test(a));
  if (!onMain && !ids.length) {
    console.error('Usage : node scripts/durees-ci.mjs <run> [<run>…] | --main <n>  [--seuil <s>]');
    process.exit(2);
  }
  const repo = repository();
  if (onMain) {
    const { workflow_runs } = api(`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=${onMain}`);
    ids.push(...workflow_runs.map((r) => String(r.id)));
  }
  const runs = ids.map((id) => ({ id, jobs: api(`repos/${repo}/actions/runs/${id}/jobs?filter=all&per_page=100`).jobs }));
  for (const r of runs) console.log(`${runLines(r.id, r.jobs, threshold).join('\n')}\n`);
  if (runs.length > 1) console.log(summaryLines(runs, threshold).join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
