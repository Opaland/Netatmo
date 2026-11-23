// #653: the durations of the CI, read by a command of the repository (scripts/durees-ci.mjs). The
// computation is tested here without network, on an excerpt of the API's answer for run
// 44316155565 (PR #645: the WebKit installation of 29 min 36 s). Seen red: with the browser
// installations no longer always kept, the 18 s installation is missing; with the attempts not
// told apart, the summary counts the failed first attempt; with minutes and seconds swapped in
// `formatDuration`, every duration is wrong.
import { describe, expect, it } from 'vitest';

type Step = { name: string; started_at: string | null; completed_at: string | null };
type Job = { name: string; run_attempt?: number; conclusion: string; started_at: string; completed_at: string; steps: Step[] };
const { seconds, formatDuration, jobDurations, runLines, summaryLines } = (await import(/* @vite-ignore */ new URL('../../scripts/durees-ci.mjs', import.meta.url).href)) as {
  seconds: (a: string | null, b: string | null) => number | null;
  formatDuration: (s: number | null) => string;
  jobDurations: (jobs: Job[], threshold?: number) => { name: string; attempt: number; duration: number; steps: { name: string; duration: number }[] }[];
  runLines: (id: string, jobs: Job[], threshold?: number) => string[];
  summaryLines: (runs: { id: string; jobs: Job[] }[], threshold?: number) => string[];
};

const step = (name: string, a: string, b: string | null): Step => ({ name, started_at: `2026-11-18T${a}Z`, completed_at: b && `2026-11-18T${b}Z` });
/** Run 44316155565, two of its jobs, steps shortened to the ones that matter. */
const RUN: Job[] = [
  {
    name: 'e2e',
    conclusion: 'success',
    started_at: '2026-11-18T13:40:51Z',
    completed_at: '2026-11-18T13:53:57Z',
    steps: [step('Run npm ci', '13:40:59', '13:41:10'), step('Run npx playwright install --with-deps chromium', '13:41:10', '13:41:28'), step('Run npm run e2e:sweep', '13:47:30', '13:53:39')],
  },
  {
    name: 'e2e-webkit-parcours',
    conclusion: 'success',
    started_at: '2026-11-18T13:40:52Z',
    completed_at: '2026-11-18T14:18:17Z',
    steps: [step('Run npx playwright install --with-deps webkit', '13:41:08', '14:10:44'), step('Run npm run e2e', '14:10:47', '14:13:41'), step('Post Run actions/checkout@v5', '14:18:15', null)],
  },
];

describe('durations', () => {
  it('seconds between two times, none when one is missing', () => {
    expect(seconds('2026-11-18T13:41:08Z', '2026-11-18T14:10:44Z')).toBe(1776);
    expect(seconds('2026-11-18T13:41:08Z', null)).toBeNull();
  });
  it('written as the reviews write them', () => {
    expect(formatDuration(1776)).toBe('29 min 36 s');
    expect(formatDuration(43)).toBe('43 s');
    expect(formatDuration(605)).toBe('10 min 05 s');
    expect(formatDuration(3725)).toBe('1 h 02 min 05 s');
    expect(formatDuration(null)).toBe('—');
  });
});

describe('a run', () => {
  it('keeps the long steps and every browser installation, nothing else', () => {
    const [e2e, parcours] = jobDurations(RUN);
    expect(e2e.duration).toBe(786);
    expect(e2e.steps).toEqual([
      { name: 'npx playwright install --with-deps chromium', duration: 18 },
      { name: 'npm run e2e:sweep', duration: 369 },
    ]);
    expect(parcours.steps).toEqual([
      { name: 'npx playwright install --with-deps webkit', duration: 1776 },
      { name: 'npm run e2e', duration: 174 },
    ]);
  });
  it('prints the WebKit installation of 29 min 36 s of run 44316155565', () => {
    const lines = runLines('44316155565', RUN);
    expect(lines[0]).toBe('Run 44316155565 :');
    expect(lines).toContain('  e2e-webkit-parcours : 37 min 25 s (success)');
    expect(lines.some((l) => /^\s+29 min 36 s {2}npx playwright install --with-deps webkit$/.test(l))).toBe(true);
  });
});

describe('several runs', () => {
  it('per job: shortest and longest duration, longest step; only the last attempt counts', () => {
    const failedFirst: Job = { ...RUN[0], run_attempt: 1, conclusion: 'failure', completed_at: '2026-11-18T15:40:51Z' };
    const second: Job[] = [failedFirst, { ...RUN[0], run_attempt: 2, completed_at: '2026-11-18T13:56:58Z' }];
    const lines = summaryLines([
      { id: '1', jobs: RUN },
      { id: '2', jobs: second },
    ]);
    expect(lines[0]).toBe('Sur 2 run(s) :');
    expect(lines).toContain('  e2e : 13 min 06 s à 16 min 07 s ; étape la plus longue : npm run e2e:sweep, 6 min 09 s');
    expect(lines).toContain('  e2e-webkit-parcours : 37 min 25 s ; étape la plus longue : npx playwright install --with-deps webkit, 29 min 36 s');
  });
});

// #653: ci.yml bounded. Seen red with the `timeout-minutes` of one installation removed, and with
// the one of the e2e-webkit job removed.
const fsName = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, enc: 'utf8') => string };
const CI = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

describe('ci.yml bounded', () => {
  it('every browser installation has a timeout-minutes, with its reason and figures just above', () => {
    const lines = CI.split('\n');
    const installs = lines.flatMap((l, i) => (/^\s+- run: npx playwright install\b/.test(l) ? [i] : []));
    expect(installs.length).toBeGreaterThan(0);
    for (const i of installs) {
      expect(lines[i + 1], `ci.yml l. ${i + 2}`).toMatch(/^\s+timeout-minutes: \d+\s*$/);
      expect(lines.slice(i - 3, i).join(' '), `ci.yml l. ${i + 1}`).toMatch(/#653.*\d+ min \d+ s/);
    }
  });
  it('every e2e job has a timeout-minutes of its own', () => {
    const jobs = [...CI.matchAll(/^ {2}(e2e[\w-]*):\s*\n((?: {4}.*\n|\s*\n)*)/gm)];
    expect(jobs.map((j) => j[1])).toEqual(['e2e', 'e2e-webkit', 'e2e-webkit-parcours']);
    for (const [, name, body] of jobs) expect(body, name).toMatch(/^ {4}timeout-minutes: \d+\s*$/m);
  });
});
