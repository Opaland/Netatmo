// #358: the Vitest configuration of the mutation runs (stryker.config.json). Stryker copies web/
// into a sandbox: the tests that read files outside web/ (docs/, SECURITY.md, the CI, the
// collector) cannot run there, and they test documents or the agreement with the collector, not
// the mutated modules. #495: they are found by what they read (a path up to the repository root),
// not listed by hand: a list went stale when dju.test.ts started reading collector/weather.py.
// No PWA plugin: faster.
import { readFileSync, readdirSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const dir = new URL('./src/', import.meta.url);
const outside = readdirSync(dir)
  .filter((f) => f.endsWith('.test.ts') && readFileSync(new URL(f, dir), 'utf8').includes('../../'))
  .map((f) => `src/${f}`);

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: outside,
  },
});
