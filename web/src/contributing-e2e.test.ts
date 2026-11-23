// #652: CONTRIBUTING § 2 lists every e2e script of web/package.json with the jobs of ci.yml that run
// it. The table is the only list written by hand; this test compares it with the two files it
// describes (AGENTS.md §5): a script added to the CI without a row, a row without a script, or a job
// written wrong fails, naming the script. The CI steps are read by the gate's own parser
// (scripts/porte.mjs `ciSteps`), never a second one.
import { describe, expect, it } from 'vitest';

type Step = { job: string; dir: string; cmd: string };
const load = async <T>(rel: string): Promise<T> => (await import(/* @vite-ignore */ new URL(rel, import.meta.url).href)) as T;
const fsName = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, enc: 'utf8') => string };
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const { ciSteps } = await load<{ ciSteps: (yaml: string, jobs: string[]) => Step[] }>('../../scripts/porte.mjs');

/** The jobs of a workflow (two-space keys; only `jobs:` has such keys in ci.yml). */
const jobNames = (yaml: string) => [...yaml.matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]);

/** Row of the CONTRIBUTING table: script → the ci.yml jobs written in its « Jobs » column. */
function contributingRows(md: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const m of md.matchAll(/^\| `(e2e(?::[a-z-]+)?)` \|[^|\n]*\| ([^|\n]*) \|[^|\n]*\|$/gm)) {
    if (rows.has(m[1])) throw new Error(`CONTRIBUTING.md : deux lignes pour ${m[1]}`);
    rows.set(m[1], [...m[2].matchAll(/`([\w-]+)`/g)].map((j) => j[1]).sort());
  }
  return rows;
}

/** Script → the ci.yml jobs that run it, directly (`npm run x`) or through another script of package.json. */
function ciJobsOf(yaml: string, scripts: Record<string, string>): Map<string, string[]> {
  const direct = new Map<string, Set<string>>();
  for (const s of ciSteps(yaml, jobNames(yaml)))
    for (const m of s.cmd.matchAll(/npm run ([\w:-]+)/g)) direct.set(m[1], (direct.get(m[1]) ?? new Set()).add(s.job));
  const of = (name: string, seen: Set<string>): Set<string> => {
    const out = new Set(direct.get(name) ?? []);
    for (const [parent, cmd] of Object.entries(scripts))
      if (!seen.has(parent) && new RegExp(`npm run ${name.replace(/[:-]/g, '\\$&')}(?![\\w:-])`).test(cmd))
        for (const j of of(parent, new Set([...seen, parent]))) out.add(j);
    return out;
  };
  return new Map(Object.keys(scripts).map((n) => [n, [...of(n, new Set([n]))].sort()]));
}

/** The disagreements between the table and the files, one sentence per script. */
function e2eDisagreements(md: string, yaml: string, pkg: { scripts: Record<string, string> }): string[] {
  const rows = contributingRows(md);
  const jobs = ciJobsOf(yaml, pkg.scripts);
  const e2e = Object.keys(pkg.scripts).filter((n) => /^e2e(:|$)/.test(n));
  const out: string[] = [];
  for (const n of e2e) {
    const row = rows.get(n);
    if (!row) out.push(`${n} : aucune ligne dans le tableau des scripts e2e de CONTRIBUTING.md`);
    else if (row.join(',') !== jobs.get(n)!.join(','))
      out.push(`${n} : CONTRIBUTING.md écrit [${row.join(', ')}], ci.yml le lance dans [${jobs.get(n)!.join(', ')}]`);
  }
  for (const n of rows.keys()) if (!e2e.includes(n)) out.push(`${n} : ligne de CONTRIBUTING.md sans script dans web/package.json`);
  for (const s of ciSteps(yaml, jobNames(yaml)))
    for (const m of s.cmd.matchAll(/npm run (e2e[\w:-]*)/g))
      if (!(m[1] in pkg.scripts)) out.push(`${m[1]} : lancé par ci.yml (job ${s.job}), absent de web/package.json`);
  return [...new Set(out)];
}

const md = read('../../CONTRIBUTING.md');
const yaml = read('../../.github/workflows/ci.yml');
const pkg = JSON.parse(read('../package.json')) as { scripts: Record<string, string> };

describe('scripts e2e de CONTRIBUTING (#652)', () => {
  it('chaque script e2e a sa ligne, avec les jobs de ci.yml qui le lancent', () => {
    expect(contributingRows(md).size, 'tableau introuvable ou vide').toBeGreaterThanOrEqual(20);
    expect(e2eDisagreements(md, yaml, pkg)).toEqual([]);
  });

  it('les 20 scripts que lance ci.yml sont tous dans le tableau', () => {
    const inCi = [...ciJobsOf(yaml, pkg.scripts)].filter(([n, js]) => /^e2e(:|$)/.test(n) && js.length).map(([n]) => n);
    expect(inCi.length).toBeGreaterThanOrEqual(20);
    expect(inCi.filter((n) => !contributingRows(md).has(n))).toEqual([]);
  });

  // The guard must be able to fail (AGENTS.md §4): the three ways the issue names.
  it('nomme une ligne retirée, un script ajouté à la CI sans ligne, un job faux', () => {
    const noRow = md.replace(/^\| `e2e:plannings` .*\n/m, '');
    expect(noRow).not.toBe(md);
    expect(e2eDisagreements(noRow, yaml, pkg)).toEqual(['e2e:plannings : aucune ligne dans le tableau des scripts e2e de CONTRIBUTING.md']);

    const moreCi = yaml.replace('      - run: npm run e2e:sweep\n', '      - run: npm run e2e:nouveau\n      - run: npm run e2e:sweep\n');
    expect(moreCi).not.toBe(yaml);
    expect(e2eDisagreements(md, moreCi, pkg)).toContain('e2e:nouveau : lancé par ci.yml (job e2e), absent de web/package.json');
    const morePkg = { scripts: { ...pkg.scripts, 'e2e:nouveau': 'node e2e/nouveau.mjs' } };
    expect(e2eDisagreements(md, moreCi, morePkg)).toEqual(['e2e:nouveau : aucune ligne dans le tableau des scripts e2e de CONTRIBUTING.md']);

    const wrongJob = md.replace(/^(\| `e2e:plannings` .*)`e2e-webkit-parcours`/m, '$1`e2e-webkit`');
    expect(wrongJob).not.toBe(md);
    expect(e2eDisagreements(wrongJob, yaml, pkg)).toEqual([
      'e2e:plannings : CONTRIBUTING.md écrit [e2e, e2e-webkit], ci.yml le lance dans [e2e, e2e-webkit-parcours]',
    ]);
  });

  it('suit un script lancé par un autre (e2e:clavier par e2e:sweep)', () => {
    expect(ciJobsOf(yaml, pkg.scripts).get('e2e:clavier')).toEqual(['e2e', 'e2e-webkit']);
    expect(ciJobsOf(yaml, pkg.scripts).get('e2e:en-ligne')).toEqual([]);
  });
});
