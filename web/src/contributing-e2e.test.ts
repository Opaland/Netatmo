// #652: CONTRIBUTING § 2 lists every e2e script of web/package.json with the jobs of ci.yml that run
// it. The table is the only list written by hand; this test compares it with the files it
// describes (AGENTS.md §5): a script added to the CI without a row, a row without a script, or a job
// written wrong fails, naming the script. The CI steps are read by the gate's own parser
// (scripts/porte.mjs `ciSteps`), never a second one.
// #673 n° 3: the other workflows (deploy.yml, e2e-complet.yml, smoke-reel.yml, revue-agents.yml…)
// run e2e scripts too, by `npm run` or by `node e2e/<file>.mjs`: the « Autres workflows » column is
// held the same way. They are read line by line (multi-line `run: |` blocks included), which the
// gate's parser does not need to know.
import { describe, expect, it } from 'vitest';

type Step = { job: string; dir: string; cmd: string };
const load = async <T>(rel: string): Promise<T> => (await import(/* @vite-ignore */ new URL(rel, import.meta.url).href)) as T;
const fsName = 'node:fs';
const { readFileSync, readdirSync } = (await import(/* @vite-ignore */ fsName)) as {
  readFileSync: (u: URL, enc: 'utf8') => string;
  readdirSync: (u: URL) => string[];
};
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const { ciSteps } = await load<{ ciSteps: (yaml: string, jobs: string[]) => Step[] }>('../../scripts/porte.mjs');

/** The jobs of a workflow (two-space keys; only `jobs:` has such keys in ci.yml). */
const jobNames = (yaml: string) => [...yaml.matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]);

const TABLE_ROW = /^\| `(e2e(?::[a-z-]+)?)` \|[^|\n]*\| ([^|\n]*) \| ([^|\n]*) \|[^|\n]*\|$/gm;

/** Row of the CONTRIBUTING table: script → the ci.yml jobs written in its « Jobs » column. */
function contributingRows(md: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const m of md.matchAll(TABLE_ROW)) {
    if (rows.has(m[1])) throw new Error(`CONTRIBUTING.md : deux lignes pour ${m[1]}`);
    rows.set(m[1], [...m[2].matchAll(/`([\w-]+)`/g)].map((j) => j[1]).sort());
  }
  return rows;
}

/** Row of the CONTRIBUTING table: script → the workflows written in its « Autres workflows » column. */
function otherRows(md: string): Map<string, string[]> {
  return new Map([...md.matchAll(TABLE_ROW)].map((m) => [m[1], [...m[3].matchAll(/`([\w.-]+\.yml)`/g)].map((w) => w[1]).sort()]));
}

/** The scripts a script runs: itself, and those its command runs by `npm run` (e2e:sweep runs e2e:clavier). */
function launched(name: string, scripts: Record<string, string>, seen = new Set<string>()): Set<string> {
  const out = new Set([name]);
  for (const m of (scripts[name] ?? '').matchAll(/npm run ([\w:-]+)/g))
    if (!seen.has(m[1])) for (const n of launched(m[1], scripts, new Set([...seen, name]))) out.add(n);
  return out;
}

/**
 * Script → the workflows other than ci.yml that run it. `npm run x` runs x and what x runs;
 * `node e2e/f.mjs` runs the file alone, counted for the script whose command names that file.
 * A command naming no script is reported as « ?e2e/f.mjs » or « ?x », so that it is not lost.
 */
function otherWorkflowsOf(workflows: Record<string, string>, scripts: Record<string, string>): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  const add = (script: string, wf: string) => out.set(script, (out.get(script) ?? new Set()).add(wf));
  for (const [wf, yaml] of Object.entries(workflows)) {
    if (wf === 'ci.yml') continue;
    for (const line of yaml.split('\n')) {
      if (/^\s*#/.test(line)) continue;
      for (const m of line.matchAll(/npm run (e2e[\w:-]*)/g)) {
        if (!(m[1] in scripts)) add(`?${m[1]}`, wf);
        else for (const n of launched(m[1], scripts)) add(n, wf);
      }
      for (const m of line.matchAll(/\bnode (?:--import \S+ )?(e2e\/[\w-]+\.mjs)/g)) {
        const file = new RegExp(`(?:^|\\s)${m[1].replace(/[./-]/g, '\\$&')}(?:\\s|$)`);
        const owners = Object.keys(scripts).filter((n) => /^e2e(:|$)/.test(n) && file.test(scripts[n]));
        if (!owners.length) add(`?${m[1]}`, wf);
        for (const n of owners) add(n, wf);
      }
    }
  }
  return new Map([...out].map(([n, wfs]) => [n, [...wfs].sort()]));
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
function e2eDisagreements(md: string, yaml: string, pkg: { scripts: Record<string, string> }, workflows: Record<string, string>): string[] {
  const rows = contributingRows(md);
  const others = otherRows(md);
  const otherJobs = otherWorkflowsOf(workflows, pkg.scripts);
  const jobs = ciJobsOf(yaml, pkg.scripts);
  const e2e = Object.keys(pkg.scripts).filter((n) => /^e2e(:|$)/.test(n));
  const out: string[] = [];
  for (const n of e2e) {
    const row = rows.get(n);
    if (!row) out.push(`${n} : aucune ligne dans le tableau des scripts e2e de CONTRIBUTING.md`);
    else if (row.join(',') !== jobs.get(n)!.join(','))
      out.push(`${n} : CONTRIBUTING.md écrit [${row.join(', ')}], ci.yml le lance dans [${jobs.get(n)!.join(', ')}]`);
  }
  for (const n of e2e) {
    const row = others.get(n);
    const real = otherJobs.get(n) ?? [];
    if (row && row.join(',') !== real.join(','))
      out.push(`${n} : CONTRIBUTING.md écrit [${row.join(', ')}] dans « Autres workflows », les workflows le lancent dans [${real.join(', ')}]`);
  }
  for (const [n, wfs] of otherJobs) if (n.startsWith('?')) out.push(`${n.slice(1)} : lancé par ${wfs.join(', ')}, sans script e2e de web/package.json`);
  for (const n of rows.keys()) if (!e2e.includes(n)) out.push(`${n} : ligne de CONTRIBUTING.md sans script dans web/package.json`);
  for (const s of ciSteps(yaml, jobNames(yaml)))
    for (const m of s.cmd.matchAll(/npm run (e2e[\w:-]*)/g))
      if (!(m[1] in pkg.scripts)) out.push(`${m[1]} : lancé par ci.yml (job ${s.job}), absent de web/package.json`);
  return [...new Set(out)];
}

const md = read('../../CONTRIBUTING.md');
const yaml = read('../../.github/workflows/ci.yml');
const pkg = JSON.parse(read('../package.json')) as { scripts: Record<string, string> };
const wfDir = new URL('../../.github/workflows/', import.meta.url);
const workflows = Object.fromEntries(
  readdirSync(wfDir)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => [f, readFileSync(new URL(f, wfDir), 'utf8')]),
);

describe('scripts e2e de CONTRIBUTING (#652)', () => {
  it('chaque script e2e a sa ligne, avec les jobs de ci.yml qui le lancent', () => {
    expect(contributingRows(md).size, 'tableau introuvable ou vide').toBeGreaterThanOrEqual(20);
    expect(e2eDisagreements(md, yaml, pkg, workflows)).toEqual([]);
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
    expect(e2eDisagreements(noRow, yaml, pkg, workflows)).toEqual(['e2e:plannings : aucune ligne dans le tableau des scripts e2e de CONTRIBUTING.md']);

    const moreCi = yaml.replace('      - run: npm run e2e:sweep\n', '      - run: npm run e2e:nouveau\n      - run: npm run e2e:sweep\n');
    expect(moreCi).not.toBe(yaml);
    expect(e2eDisagreements(md, moreCi, pkg, workflows)).toContain('e2e:nouveau : lancé par ci.yml (job e2e), absent de web/package.json');
    const morePkg = { scripts: { ...pkg.scripts, 'e2e:nouveau': 'node e2e/nouveau.mjs' } };
    expect(e2eDisagreements(md, moreCi, morePkg, workflows)).toEqual(['e2e:nouveau : aucune ligne dans le tableau des scripts e2e de CONTRIBUTING.md']);

    const wrongJob = md.replace(/^(\| `e2e:plannings` .*)`e2e-webkit-parcours`/m, '$1`e2e-webkit`');
    expect(wrongJob).not.toBe(md);
    expect(e2eDisagreements(wrongJob, yaml, pkg, workflows)).toEqual([
      'e2e:plannings : CONTRIBUTING.md écrit [e2e, e2e-webkit], ci.yml le lance dans [e2e, e2e-webkit-parcours]',
    ]);
  });

  // #673 n° 3. Seen red: with the other workflows no longer read (`workflows` = {}), the four
  // rows that name one fail; with a `node e2e/…` added to deploy.yml, or a workflow removed from a
  // row, the script is named.
  it('les autres workflows : lus, et une différence nommée', () => {
    const others = otherWorkflowsOf(workflows, pkg.scripts);
    expect(others.get('e2e:en-ligne')).toEqual(['deploy.yml']);
    expect(others.get('e2e:sweep')).toEqual(['deploy.yml', 'e2e-complet.yml', 'smoke-reel.yml']);
    expect(others.get('e2e:clavier'), 'node e2e/sweep.mjs ne lance pas le clavier, npm run e2e:sweep oui').toEqual(['e2e-complet.yml']);
    expect(others.get('e2e'), 'run: | sur plusieurs lignes').toEqual(['revue-agents.yml']);

    const deployMore = { ...workflows, 'deploy.yml': workflows['deploy.yml'].replace('      - run: node e2e/en-ligne.mjs\n', '      - run: node e2e/en-ligne.mjs\n      - run: node e2e/pwa.mjs\n') };
    expect(deployMore['deploy.yml']).not.toBe(workflows['deploy.yml']);
    expect(e2eDisagreements(md, yaml, pkg, deployMore)).toEqual([
      'e2e:pwa : CONTRIBUTING.md écrit [] dans « Autres workflows », les workflows le lancent dans [deploy.yml]',
    ]);
    const unknown = { ...workflows, 'deploy.yml': workflows['deploy.yml'].replace('node e2e/en-ligne.mjs', 'node e2e/inconnu.mjs') };
    expect(e2eDisagreements(md, yaml, pkg, unknown)).toEqual([
      'e2e:en-ligne : CONTRIBUTING.md écrit [deploy.yml] dans « Autres workflows », les workflows le lancent dans []',
      'e2e/inconnu.mjs : lancé par deploy.yml, sans script e2e de web/package.json',
    ]);
    const rowLess = md.replace(/^(\| `e2e:sweep` .*)`deploy.yml`, /m, '$1');
    expect(rowLess).not.toBe(md);
    expect(e2eDisagreements(rowLess, yaml, pkg, workflows)).toEqual([
      'e2e:sweep : CONTRIBUTING.md écrit [e2e-complet.yml, smoke-reel.yml] dans « Autres workflows », les workflows le lancent dans [deploy.yml, e2e-complet.yml, smoke-reel.yml]',
    ]);
  });

  it('suit un script lancé par un autre (e2e:clavier par e2e:sweep)', () => {
    expect(ciJobsOf(yaml, pkg.scripts).get('e2e:clavier')).toEqual(['e2e', 'e2e-webkit']);
    expect(ciJobsOf(yaml, pkg.scripts).get('e2e:en-ligne')).toEqual([]);
  });
});
