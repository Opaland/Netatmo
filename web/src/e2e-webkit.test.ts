// #596: an e2e script that can run in WebKit (it reads E2E_BROWSER, or the BROWSER of
// e2e/captures.mjs) is run by a WebKit job of the CI (e2e-webkit, e2e-webkit-parcours: two jobs in
// parallel, so that WebKit does not outlast the job e2e), in WebKit. The list of what runs in WebKit
// is written once, in ci.yml (AGENTS.md §5), read here with the gate's own parser.
import { describe, expect, it } from 'vitest';

type Step = { job: string; dir: string; cmd: string };
const load = async <T>(rel: string): Promise<T> => (await import(/* @vite-ignore */ new URL(rel, import.meta.url).href)) as T;
const fsName = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, enc: 'utf8') => string };
const { ciSteps } = await load<{ ciSteps: (yaml: string, jobs?: string[]) => Step[] }>('../../scripts/porte.mjs');
const ci = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const { scripts } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };

/** The npm scripts `e2e…` whose file can run in WebKit, with the file. */
function webkitReady(): string[] {
  return Object.entries(scripts)
    .filter(([name]) => /^e2e(:|$)/.test(name))
    .filter(([, cmd]) => {
      const file = /\b(e2e\/[\w-]+\.mjs)\s*$/.exec(cmd)?.[1];
      if (!file) return false;
      const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      return /\bE2E_BROWSER\b/.test(src) || /import \{[^}]*\bBROWSER\b[^}]*\} from '\.\/captures\.mjs'/.test(src);
    })
    .map(([name]) => name);
}

/** The WebKit jobs of `yaml` (their name starts with e2e-webkit). */
const webkitJobs = (yaml: string) => [...yaml.matchAll(/^ {2}(e2e-webkit[\w-]*):\s*$/gm)].map((m) => m[1]);
/** The npm scripts run by the WebKit jobs of `yaml`, with those they run in turn (`e2e:sweep` runs `e2e:clavier`). */
function inWebkitJob(yaml: string): Set<string> {
  const run = new Set<string>();
  const add = (name: string) => {
    if (run.has(name)) return;
    run.add(name);
    for (const m of (scripts[name] ?? '').matchAll(/\bnpm run ([\w:-]+)/g)) add(m[1]);
  };
  for (const s of ciSteps(yaml, webkitJobs(yaml))) {
    const name = /^npm run (\S+)$/.exec(s.cmd)?.[1];
    if (name) add(name);
  }
  return run;
}
/** What can run in WebKit but the e2e-webkit job of `yaml` does not run. */
const missing = (yaml: string) => webkitReady().filter((name) => !inWebkitJob(yaml).has(name));

/** The e2e-webkit job as it was on main 6425c79 (nine scripts), for the red case. */
const BEFORE = `jobs:
  e2e-webkit:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
${['features', 'piece', 'reglages', 'logement', 'jeton', 'assistant', 'http', 'plan', 'plan-edition'].map((s) => `      - run: npm run e2e:${s}\n        env:\n          E2E_BROWSER: webkit\n`).join('')}`;

describe('e2e en WebKit (#596)', () => {
  it('les jobs WebKit lancent chaque script qui sait tourner dans WebKit', () => {
    expect(webkitJobs(ci)).toEqual(['e2e-webkit', 'e2e-webkit-parcours']);
    expect(webkitReady().length).toBeGreaterThanOrEqual(19);
    expect(missing(ci)).toEqual([]);
  });

  it('vu rouge sur le job d’avant : les scripts prêts mais jamais lancés en WebKit sont nommés', () => {
    expect(missing(BEFORE)).toEqual(expect.arrayContaining(['e2e:trous', 'e2e:composants', 'e2e:expliquer', 'e2e:retours']));
  });

  it('chaque e2e des jobs WebKit tourne vraiment dans WebKit (E2E_BROWSER: webkit)', () => {
    const job = ci.slice(ci.indexOf('\n  e2e-webkit:'));
    expect(job).toContain('\n  e2e-webkit-parcours:'); // both jobs are in the slice (the last ones of ci.yml)
    const runs = [...job.matchAll(/^ {6}- run: (npm run e2e\S*)[^\n]*\n((?: {8}.*\n)*)/gm)];
    expect(runs.length).toBeGreaterThan(0);
    for (const [, cmd, rest] of runs) expect(rest, cmd).toMatch(/^ {8}env:\n {10}E2E_BROWSER: webkit$/m);
  });
});
