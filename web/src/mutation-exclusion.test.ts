// #649 n° 4: the exclusion of the mutation runs (vitest.mutation.config.mjs) is said, and a mutated
// module left without any test file stops the configuration. Seen red: with `orphans` always empty,
// the module whose only test file reads outside web/ is not named; with `testsOf` finding nothing,
// crypto-kdf.test.ts is no longer said to test crypto.ts.
import { describe, expect, it } from 'vitest';

const fsName = 'node:fs';
const { readFileSync, readdirSync } = (await import(/* @vite-ignore */ fsName)) as {
  readFileSync: (u: URL, enc: 'utf8') => string;
  readdirSync: (u: URL) => string[];
};
type Report = { outside: string[]; lines: string[]; orphans: string[] };
const { exclusionReport, testsOf, orphanError } = (await import(/* @vite-ignore */ new URL('../mutation-exclusion.mjs', import.meta.url).href)) as {
  exclusionReport: (mutate: string[], sources: Record<string, string>) => Report;
  testsOf: (module: string, sources: Record<string, string>) => string[];
  orphanError: (report: Report) => string | null;
};

const dir = new URL('./', import.meta.url);
const sources: Record<string, string> = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]),
);
const { mutate } = JSON.parse(readFileSync(new URL('../stryker.config.json', import.meta.url), 'utf8')) as { mutate: string[] };

describe('mutation : les fichiers de tests écartés (#649 n° 4)', () => {
  it('aujourd’hui : chaque module muté garde au moins un fichier de tests', () => {
    expect(mutate.length).toBeGreaterThanOrEqual(10);
    expect(exclusionReport(mutate, sources).orphans).toEqual([]);
  });

  it('la liste écrite au lancement nomme chaque fichier écarté et ce qu’il teste aussi', () => {
    const { outside, lines } = exclusionReport(mutate, sources);
    expect(outside.length).toBeGreaterThan(0);
    expect(lines[0]).toBe(`Mutation : ${outside.length} fichier(s) de tests écarté(s), car ils lisent hors de web/ (#649 n° 4) :`);
    expect(lines).toHaveLength(outside.length + 1);
    // #633: the file whose exclusion made crypto.ts fall is said.
    expect(lines).toContain('  src/crypto-kdf.test.ts — teste aussi src/crypto.ts');
    expect(lines).toContain('  src/agents-md.test.ts');
  });

  it('un module muté dont tous les tests lisent hors de web/ est nommé', () => {
    // Built, not written: this file must not read outside web/ itself.
    const up = '../'.repeat(2);
    const fake = {
      'a.test.ts': `import { x } from './money';\nconst doc = '${up}docs/x.md';`,
      'b.test.ts': `import { y } from './money.ts';\nnew URL('${up}SECURITY.md', import.meta.url);`,
      'c.test.ts': "import { z } from './pricing';",
    };
    expect(exclusionReport(['src/money.ts', 'src/pricing.ts'], fake).orphans).toEqual(['src/money.ts']);
    expect(exclusionReport(['src/money.ts', 'src/pricing.ts', 'src/sans-test.ts'], fake).orphans).toEqual(['src/money.ts', 'src/sans-test.ts']);
    expect(orphanError(exclusionReport(['src/money.ts'], fake))).toMatch(/^Mutation : src\/money\.ts sans aucun fichier de tests/);
    // Only that module: one test file left is enough.
    const kept = exclusionReport(['src/money.ts'], { ...fake, 'd.test.ts': "import './money';" });
    expect(kept.orphans).toEqual([]);
    expect(orphanError(kept)).toBeNull();
  });

  it('un import se reconnaît à son module exact (« ./money » n’est pas « ./money-format »)', () => {
    expect(testsOf('src/money.ts', { 'a.test.ts': "import './money-format';", 'b.test.ts': 'import "./money.ts";' })).toEqual(['b.test.ts']);
  });
});
