// #362: the numbers written in the documentation that describe the repository, held in step with
// the files they describe. Each pattern must be found at least once: a sentence reworded so that
// the pattern no longer matches fails with « motif introuvable » instead of comparing nothing.
// Model: Mousse de Poche, tests/unit/chiffres-ecrits.test.ts (S305) and jumeaux.test.ts (S359).
import { describe, expect, it } from 'vitest';

const fsName = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, enc: 'utf8') => string };
const root = new URL('../../', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, root), 'utf8');

/** Every match of `re` (with one capture) in `file`; fails when there is none. */
function found(file: string, re: RegExp): string[] {
  const all = [...read(file).matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))].map((m) => m[1]);
  if (!all.length) throw new Error(`motif introuvable dans ${file} : ${re}`);
  return all;
}

/** [file, pattern] pairs that must all say `expected`; the failure names every file that does not. */
function agree(expected: string, pairs: [string, RegExp][]) {
  const wrong = pairs.flatMap(([f, re]) => found(f, re).filter((v) => v !== expected).map((v) => `${f} dit ${v} (${re})`));
  expect(wrong, `attendu ${expected}`).toEqual([]);
}

describe('chiffres de la documentation (#362)', () => {
  it('le nombre de personas = les lignes numérotées de 02-revue-50-personas.md', () => {
    const text = read('docs/bmad/02-revue-50-personas.md');
    const numbers = new Set([...text.matchAll(/^\| *(\d+) *\|/gm)].map((m) => Number(m[1])));
    const n = numbers.size;
    expect(n).toBeGreaterThanOrEqual(50);
    expect([...numbers].sort((a, b) => a - b), 'numérotation continue de 1 à n').toEqual(Array.from({ length: n }, (_, i) => i + 1));
    agree(String(n), [
      ['docs/PROJET.md', /\*\*(\d+) personas\*\* depuis/],
      ['README.md', /revue des (\d+) personas/],
      ['docs/bmad/00-index.md', /une revue par (\d+) personas/],
    ]);
    // the index lists the additions (« personas 51 à 62 », « personas 63 à 72 »…): the last one ends at n
    const ranges = found('docs/bmad/00-index.md', /personas \d+ à (\d+)/).map(Number);
    expect(Math.max(...ranges), 'docs/bmad/00-index.md : dernier ajout de personas').toBe(n);
  });

  it('le budget de taille écrit = BUDGET_KB et TARGET de size-budget.mjs', () => {
    const script = read('web/scripts/size-budget.mjs');
    const budget = /const BUDGET_KB = (\d+);/.exec(script)?.[1];
    const target = /const TARGET = (0\.\d+);/.exec(script)?.[1];
    expect(budget, 'BUDGET_KB introuvable').toBeTruthy();
    expect(target, 'TARGET introuvable').toBeTruthy();
    agree(budget!, [
      ['CONTRIBUTING.md', /size-budget\.mjs`, (\d+) kB gzip/],
      ['docs/bmad/04-architecture.md', /size-budget\.mjs`, (\d+) kB gzip/],
    ]);
    agree(String(Math.round(Number(target) * 100)), [
      ['CONTRIBUTING.md', /il échoue au-delà de (\d+) % du budget/],
      ['docs/bmad/04-architecture.md', /kB gzip, objectif < (\d+) %/],
    ]);
  });

  it('les versions de Node et de Python citées = celles de la CI et du devcontainer', () => {
    const ci = read('.github/workflows/ci.yml');
    const nodes = new Set([...ci.matchAll(/node-version: (\d+)/g)].map((m) => m[1]));
    const pythons = new Set([...ci.matchAll(/python-version: "([\d.]+)"/g)].map((m) => m[1]));
    expect(nodes.size, `ci.yml : une seule version de Node (${[...nodes]})`).toBe(1);
    expect(pythons.size, `ci.yml : une seule version de Python (${[...pythons]})`).toBe(1);
    const [node] = nodes;
    const [python] = pythons;
    agree(node, [
      ['CONTRIBUTING.md', /Node (\d+)/],
      ['.devcontainer/devcontainer.json', /node:1": \{ "version": "(\d+)"/],
    ]);
    agree(python, [
      ['CONTRIBUTING.md', /Python ([\d.]+)/],
      ['.devcontainer/devcontainer.json', /python:1-([\d.]+)-/],
      ['docs/bmad/04-architecture.md', /collector \(Python ([\d.]+)\)/],
    ]);
  });

  it('le port des e2e cité = celui de e2e/demo.mjs', () => {
    const port = /E2E_PORT \?\? (\d+)/.exec(read('web/e2e/demo.mjs'))?.[1];
    expect(port).toBeTruthy();
    agree(port!, [['CONTRIBUTING.md', /`vite preview` sur le port (\d+)/]]);
  });
});
