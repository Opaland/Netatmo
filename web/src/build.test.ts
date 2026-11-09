import { describe, expect, it } from 'vitest';
import { buildCard, parseBuild } from './build';

const good = {
  commit: 'a'.repeat(40),
  date: '2026-11-09T04:12:00Z',
  repo: 'Opaland/Netatmo',
  run: '123456',
  manifest: 'b'.repeat(64),
};

describe('Version déployée (S-8.10)', () => {
  it('accepte un build.json bien formé et affiche commit et empreinte', () => {
    const b = parseBuild(good);
    expect(b).not.toBeNull();
    const card = buildCard(b);
    expect(card).toContain('a'.repeat(12));
    expect(card).toContain('b'.repeat(64));
    expect(card).toContain('https://github.com/Opaland/Netatmo/actions/runs/123456');
  });

  it('refuse toute valeur inattendue', () => {
    expect(parseBuild(null)).toBeNull();
    expect(parseBuild({ ...good, commit: '<img src=x>' })).toBeNull();
    expect(parseBuild({ ...good, repo: 'x/y"><script>' })).toBeNull();
    expect(parseBuild({ ...good, manifest: 'abc' })).toBeNull();
    expect(parseBuild({ ...good, run: 'javascript:1' })).toBeNull();
  });

  it('sans build.json : version locale, sans empreinte', () => {
    expect(buildCard(null)).toContain('Version locale');
  });
});
