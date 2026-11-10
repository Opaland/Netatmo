// #360: AGENTS.md is the single source of the agents' instructions. CLAUDE.md imports it, Copilot
// and Gemini are pointed at it; every « AGENTS.md §n » cited in the repository exists, and every
// « PROJET.md §n » / « CONTRIBUTING.md §n » that AGENTS.md sends to exists too (AGENTS.md sums the
// rules up and refers to them: a renumbered section must not leave a dead reference).
// Model: Mousse de Poche, tests/unit/agents-md.test.ts.
import { describe, expect, it } from 'vitest';

const fsName = 'node:fs';
const { readFileSync, readdirSync, statSync } = (await import(/* @vite-ignore */ fsName)) as {
  readFileSync: (u: URL, enc: 'utf8') => string;
  readdirSync: (u: URL) => string[];
  statSync: (u: URL) => { isDirectory(): boolean };
};
const root = new URL('../../', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, root), 'utf8');

/** Section numbers of a Markdown file (« ## 3. La porte » → 3). */
const sections = (file: string) => new Set([...read(file).matchAll(/^## (\d+)\./gm)].map((m) => m[1]));

const SKIP = new Set(['node_modules', 'dist', 'reports', '.git', '.stryker-tmp', 'screenshots', 'worktrees', '__pycache__', 'data', 'public']);
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(new URL(dir, root))) {
    if (SKIP.has(name)) continue;
    const path = `${dir}${name}`;
    if (statSync(new URL(path, root)).isDirectory()) files(`${path}/`, out);
    else if (/\.(ts|mjs|js|py|md|yml|json)$/.test(name)) out.push(path);
  }
  return out;
}

describe('AGENTS.md, source unique (#360)', () => {
  it('CLAUDE.md l\'importe, Copilot et Gemini y sont renvoyés', () => {
    expect(read('CLAUDE.md')).toMatch(/^@AGENTS\.md$/m);
    expect(read('.github/copilot-instructions.md')).toMatch(/\]\(\.\.\/AGENTS\.md\)/);
    const gemini = JSON.parse(read('.gemini/settings.json')) as { context?: { fileName?: string | string[] } };
    expect([gemini.context?.fileName].flat()).toContain('AGENTS.md');
  });

  it('dit de lire docs/APPRENTISSAGES.md en premier, qui tient les leçons datées', () => {
    expect(read('AGENTS.md')).toMatch(/À lire en premier : \[`docs\/APPRENTISSAGES\.md`\]/);
    const text = read('docs/APPRENTISSAGES.md');
    const entries = text.split(/^### /m).slice(1);
    expect(entries.length).toBeGreaterThanOrEqual(4);
    for (const e of entries) {
      expect(e, e.slice(0, 40)).toMatch(/^A\d+ · \d{2}\/\d{2}\/\d{4}/);
      expect(e, e.slice(0, 40)).toMatch(/\*\*Conduite\*\*/);
    }
    for (const n of ['#229', '#249', '#260', '#334']) expect(text, n).toContain(n);
  });

  it('chaque « PROJET.md §n » et « CONTRIBUTING.md §n » d\'AGENTS.md existe', () => {
    const targets = { 'PROJET.md': sections('docs/PROJET.md'), 'CONTRIBUTING.md': sections('CONTRIBUTING.md') };
    const refs = [...read('AGENTS.md').matchAll(/(PROJET\.md|CONTRIBUTING\.md) §(\d+)/g)];
    expect(refs.length, 'AGENTS.md doit renvoyer à ses sources').toBeGreaterThanOrEqual(5);
    const dead = refs.filter(([, f, n]) => !targets[f as keyof typeof targets].has(n)).map((m) => m[0]);
    expect(dead).toEqual([]);
  });

  it('chaque « AGENTS.md §n » cité dans le dépôt existe', () => {
    const have = sections('AGENTS.md');
    const cited: string[] = [];
    const dead: string[] = [];
    for (const f of files('')) {
      for (const m of read(f).matchAll(/AGENTS\.md §(\d+)/g)) {
        cited.push(`${f} §${m[1]}`);
        if (!have.has(m[1])) dead.push(`${f} : AGENTS.md §${m[1]}`);
      }
    }
    expect(cited.length, 'aucun renvoi trouvé : le test ne vérifierait rien').toBeGreaterThanOrEqual(3);
    expect(dead).toEqual([]);
  });
});
