// #364: SECURITY.md lists what is already checked; every file it cites must exist (a renamed test
// would otherwise leave a promise without proof).
import { describe, expect, it } from 'vitest';

const fsName = 'node:fs';
const { readFileSync, existsSync } = (await import(/* @vite-ignore */ fsName)) as {
  readFileSync: (u: URL, enc: 'utf8') => string;
  existsSync: (u: URL) => boolean;
};
const root = new URL('../../', import.meta.url);

describe('SECURITY.md (#364)', () => {
  const text = readFileSync(new URL('SECURITY.md', root), 'utf8');
  const checked = text.slice(text.indexOf('## Ce qui est déjà vérifié'));
  it('says how to report privately and what not to publish', () => {
    expect(text).toMatch(/Report a vulnerability/);
    expect(text).toMatch(/Ne publiez jamais/);
  });
  it('every « déjà vérifié » cites a file that exists', () => {
    const files = [...checked.matchAll(/`((?:web|tests|collector|docs)\/[^`\s]+)`/g)].map((m) => m[1]);
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const f of files) expect(existsSync(new URL(f, root)), f).toBe(true);
    // each bullet has its proof
    for (const line of checked.split('\n- ').slice(1)) expect(line, line.slice(0, 40)).toMatch(/`(web|tests)\//);
  });
  it('promises no delay (#364): no duration anywhere in the « Délais » section', () => {
    const delays = text.slice(text.indexOf('## Délais'), text.indexOf('## Périmètre'));
    expect(delays).toMatch(/aucun délai n'est promis/);
    expect(delays).not.toMatch(/\b\d+\s*(h|heures?|jours?|semaines?|mois)\b|\bsous (une|un|deux|trois|huit|quinze) /i);
  });
  it('CONTRIBUTING.md and the issue chooser lead to it', () => {
    expect(readFileSync(new URL('CONTRIBUTING.md', root), 'utf8')).toMatch(/SECURITY\.md/);
    expect(readFileSync(new URL('.github/ISSUE_TEMPLATE/config.yml', root), 'utf8')).toMatch(
      /name: Signaler une faille\s+url: https:\/\/github\.com\/Opaland\/Netatmo\/security\/advisories\/new/,
    );
  });
});
