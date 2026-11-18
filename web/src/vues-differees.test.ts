// #640 (#564 n° 4): the size guard's check of the deferred views (scripts/vues-differees.mjs), on
// made-up chunk names, not the real build. Seen red with the old check (the 8-character pattern only):
// a chunk with a 10-character hash was blamed as « pas de morceau à part (… importé en statique ?) ».
import { describe, expect, it } from 'vitest';

const { deferredViewProblems } = (await import(/* @vite-ignore */ new URL('../scripts/vues-differees.mjs', import.meta.url).href)) as {
  deferredViewProblems: (files: string[], first: Set<string>, views: string[]) => string[];
};

const entry = 'assets/index-AbCd1234.js';

describe('deferredViewProblems (size guard, views loaded on demand)', () => {
  it('a view in its own chunk, not preloaded: nothing to say', () => {
    expect(deferredViewProblems([entry, 'assets/analyse-Zz_9-x12.js'], new Set([entry]), ['analyse'])).toEqual([]);
  });

  it('a view preloaded by the first screen is named', () => {
    const own = 'assets/analyse-Zz_9-x12.js';
    expect(deferredViewProblems([entry, own], new Set([entry, own]), ['analyse'])).toEqual([
      `analyse : ${own} est préchargé par le premier écran`,
    ]);
  });

  it('a view with no chunk of its own: merged or imported statically', () => {
    expect(deferredViewProblems([entry], new Set([entry]), ['analyse'])[0]).toContain('pas de morceau à part');
  });

  it('a hash of another length: the name is not of the expected form, and it says so', () => {
    const odd = 'assets/analyse-AbCdEf1234.js';
    const [msg] = deferredViewProblems([entry, odd], new Set([entry]), ['analyse']);
    expect(msg).toContain(odd);
    expect(msg).toContain("n'a pas la forme attendue");
    expect(msg).not.toContain('pas de morceau à part');
  });
});
