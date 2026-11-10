// #361: the local gate reads its steps from ci.yml (never a second list), the e2e refuse a stale
// dist/, and the commit hook recognises a `git commit`.
import { describe, expect, it } from 'vitest';

type Step = { job: string; dir: string; cmd: string };
const load = async <T>(rel: string): Promise<T> => (await import(/* @vite-ignore */ new URL(rel, import.meta.url).href)) as T;
const fsName = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsName)) as {
  readFileSync: (u: URL, enc: 'utf8') => string;
  mkdtempSync: (p: string) => string;
  mkdirSync: (p: string, o: { recursive: boolean }) => void;
  writeFileSync: (p: string, s: string) => void;
  utimesSync: (p: string, a: number, m: number) => void;
  rmSync: (p: string, o: { recursive: boolean; force: boolean }) => void;
};
const osName = 'node:os';
const { tmpdir } = (await import(/* @vite-ignore */ osName)) as { tmpdir: () => string };

const { gateSteps } = await load<{ gateSteps: (yaml: string, quick?: boolean) => Step[] }>('../../scripts/porte.mjs');
const { staleDist } = await load<{ staleDist: (dir: string) => string | null }>('../e2e/dist-a-jour.mjs');
const { isCommit } = await load<{ isCommit: (cmd: string) => boolean }>('../../.claude/hooks/crochet.mjs');
const ci = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

describe('porte (#361)', () => {
  it('reprend les étapes de ci.yml, sans installation ni doublon, dans leur dossier', () => {
    const steps = gateSteps(ci);
    const cmds = steps.map((s) => s.cmd);
    for (const want of ['ruff check . && ruff format --check .', 'pytest -q', 'npm test', 'npm run build', 'npm run size', 'npm run e2e', 'npm run e2e:sweep']) expect(cmds).toContain(want);
    // every e2e run line of the CI job e2e is in the gate
    const e2eJob = ci.slice(ci.indexOf('\n  e2e:'), ci.indexOf('\n  e2e-webkit:'));
    for (const m of e2eJob.matchAll(/- run: (npm run e2e[\w:-]*)/g)) expect(cmds).toContain(m[1]);
    expect(cmds.some((c) => /^(pip install|npm ci|npx playwright install)/.test(c))).toBe(false);
    expect(cmds.filter((c) => c === 'npm run build')).toHaveLength(1);
    expect(steps.find((s) => s.cmd === 'npm test')?.dir).toBe('web');
    expect(steps.find((s) => s.cmd === 'pytest -q')?.dir).toBe('.');
    expect(steps.find((s) => s.cmd.startsWith('python -m collector fixtures'))?.dir).toBe('.');
    // build before the e2e
    expect(cmds.indexOf('npm run build')).toBeLessThan(cmds.indexOf('npm run e2e'));
  });

  it('la porte rapide : lint, types et tests, rien qui construit', () => {
    const cmds = gateSteps(ci, true).map((s) => s.cmd);
    expect(cmds).toEqual(expect.arrayContaining(['pytest -q', 'npm test', 'npx tsc --noEmit']));
    expect(cmds.some((c) => /build|e2e|size/.test(c))).toBe(false);
  });

  it('les e2e refusent un dist/ absent ou plus ancien que les sources', () => {
    const dir = fs.mkdtempSync(`${tmpdir()}/porte-`);
    try {
      fs.mkdirSync(`${dir}/src`, { recursive: true });
      fs.writeFileSync(`${dir}/src/a.ts`, 'x');
      expect(staleDist(dir)).toMatch(/absent : lancer `npm run build`/);
      fs.mkdirSync(`${dir}/dist`, { recursive: true });
      fs.writeFileSync(`${dir}/dist/index.html`, 'x');
      const t = Date.now() / 1000;
      fs.utimesSync(`${dir}/dist/index.html`, t - 100, t - 100);
      fs.utimesSync(`${dir}/src/a.ts`, t, t);
      expect(staleDist(dir)).toMatch(/plus ancien que \/src\/a\.ts : lancer `npm run build`/);
      fs.utimesSync(`${dir}/dist/index.html`, t + 10, t + 10);
      expect(staleDist(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('le crochet reconnaît un git commit, et seulement lui', () => {
    for (const c of ['git commit -m x', 'git add -A && git commit -F f', 'cd web; git commit', 'git -C /x commit --amend']) expect(isCommit(c), c).toBe(true);
    for (const c of ['git status', 'git commit-tree abc', 'echo commit', 'git log --grep commit', '']) expect(isCommit(c), c).toBe(false);
  });
});
