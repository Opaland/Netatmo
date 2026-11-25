// #653: the durations of the CI, read by a command of the repository (scripts/durees-ci.mjs). The
// computation is tested here without network, on an excerpt of the API's answer for run
// 44316155565 (PR #645: the WebKit installation of 29 min 36 s). Seen red: with the browser
// installations no longer always kept, the 18 s installation is missing; with the attempts not
// told apart, the summary counts the failed first attempt; with minutes and seconds swapped in
// `formatDuration`, every duration is wrong.
import { describe, expect, it } from 'vitest';

type Step = { name: string; started_at: string | null; completed_at: string | null };
type Job = { name: string; run_attempt?: number; conclusion: string; started_at: string; completed_at: string; steps: Step[] };
const { seconds, formatDuration, jobDurations, runLines, summaryLines, ranJobs, mainRunsPath } = (await import(/* @vite-ignore */ new URL('../../scripts/durees-ci.mjs', import.meta.url).href)) as {
  seconds: (a: string | null, b: string | null) => number | null;
  formatDuration: (s: number | null) => string;
  jobDurations: (jobs: Job[], threshold?: number) => { name: string; attempt: number; duration: number; steps: { name: string; duration: number }[] }[];
  runLines: (id: string, jobs: Job[], threshold?: number) => string[];
  summaryLines: (runs: { id: string; jobs: Job[] }[], threshold?: number) => string[];
  ranJobs: (jobs: Job[]) => Job[];
  mainRunsPath: (repo: string, n: number, withRed?: boolean) => string;
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

// #673 n° 1. Seen red: with `ranJobs` returning its input unchanged, `web`, `collector`, `e2e` and
// `e2e-webkit-parcours` are printed a second time « (tentative 2) »; with `withRed` ignored, the
// red runs cut by a timeout-minutes stay out of `--main`.
describe('a re-run run (45232533937)', () => {
  const job = (name: string, attempt: number, conclusion: string, a: string, b: string): Job => ({
    name,
    run_attempt: attempt,
    conclusion,
    started_at: `2026-11-23T${a}Z`,
    completed_at: `2026-11-23T${b}Z`,
    steps: [],
  });
  /** As the API gives it after « Re-run failed jobs »: the four jobs not re-run come back under attempt 2. */
  const RERUN: Job[] = [
    job('collector', 1, 'success', '17:53:44', '17:55:28'),
    job('e2e-webkit-parcours', 1, 'success', '17:53:44', '18:03:47'),
    job('web', 1, 'success', '17:53:45', '17:54:14'),
    job('e2e', 1, 'success', '17:53:45', '18:09:31'),
    job('e2e-webkit', 1, 'failure', '17:53:44', '18:04:19'),
    job('e2e-webkit', 2, 'success', '18:09:54', '18:18:39'),
    job('web', 2, 'success', '17:53:45', '17:54:14'),
    job('e2e-webkit-parcours', 2, 'success', '17:53:44', '18:03:47'),
    job('e2e', 2, 'success', '17:53:45', '18:09:31'),
    job('collector', 2, 'success', '17:53:44', '17:55:28'),
  ];
  it('prints only the job that was re-run under attempt 2', () => {
    const lines = runLines('45232533937', RERUN).filter((l) => !l.startsWith('    '));
    expect(lines).toEqual([
      'Run 45232533937 :',
      '  collector : 1 min 44 s (success)',
      '  e2e-webkit-parcours : 10 min 03 s (success)',
      '  web : 29 s (success)',
      '  e2e : 15 min 46 s (success)',
      '  e2e-webkit : 10 min 35 s (failure)',
      '  e2e-webkit (tentative 2) : 8 min 45 s (success)',
    ]);
  });
  it('keeps a second attempt that really ran, even with the same duration', () => {
    const again = job('web', 2, 'success', '18:10:00', '18:10:29');
    expect(ranJobs([RERUN[2], again])).toEqual([RERUN[2], again]);
  });
  it('the summary is unchanged: the last attempt of each job', () => {
    expect(summaryLines([{ id: '45232533937', jobs: RERUN }])).toContain('  e2e-webkit : 8 min 45 s');
  });
});

describe('--main and the red runs', () => {
  it('reads the green runs by default, every completed run with --rouges', () => {
    expect(mainRunsPath('o/r', 5)).toBe('repos/o/r/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=5');
    expect(mainRunsPath('o/r', 5, true)).toBe('repos/o/r/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=5');
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
