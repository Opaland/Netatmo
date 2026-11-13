// #541: the repository named by the build (vite.config.ts → VITE_SOURCE_REPO).
import { describe, expect, it } from 'vitest';
import { builtSourceRepo } from './build-env';

const fsName = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, enc: 'utf8') => string };

describe('#541 dépôt de la construction', () => {
  it('VITE_SOURCE_REPO first, else GITHUB_REPOSITORY, else nothing', () => {
    expect(builtSourceRepo({ VITE_SOURCE_REPO: 'copie/fictive', GITHUB_REPOSITORY: 'autre/depot' })).toBe('copie/fictive');
    expect(builtSourceRepo({ GITHUB_REPOSITORY: 'autre/depot' })).toBe('autre/depot');
    expect(builtSourceRepo({})).toBe('');
  });

  it('an empty VITE_SOURCE_REPO does not hide GITHUB_REPOSITORY', () => {
    expect(builtSourceRepo({ VITE_SOURCE_REPO: '', GITHUB_REPOSITORY: 'autre/depot' })).toBe('autre/depot');
    expect(builtSourceRepo({ VITE_SOURCE_REPO: '  ', GITHUB_REPOSITORY: 'autre/depot' })).toBe('autre/depot');
  });

  it('the configuration of the build uses it', () => {
    const cfg = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
    expect(cfg).toContain("'import.meta.env.VITE_SOURCE_REPO': JSON.stringify(builtSourceRepo(env))");
  });
});
