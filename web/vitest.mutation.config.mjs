// #358: the Vitest configuration of the mutation runs (stryker.config.json). Stryker copies web/
// into a sandbox: the tests that read files outside web/ (docs/, SECURITY.md, the CI, the
// collector) cannot run there, and they test documents or the agreement with the collector, not
// the mutated modules. #495: they are found by what they read (a path up to the repository root),
// not listed by hand: a list went stale when dju.test.ts started reading collector/weather.py.
// #649 n° 4: no longer silent (mutation-exclusion.mjs). `npm run mutation` prints the excluded
// files first, with the mutated modules each one also tests; and this configuration fails, under
// Stryker too, when a mutated module has no test file left.
// No PWA plugin: faster.
import { defineConfig } from 'vitest/config';
import { orphanError, webReport } from './mutation-exclusion.mjs';

const report = webReport();
const error = orphanError(report);
if (error) throw new Error(error);

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: report.outside.map((f) => `src/${f}`),
  },
});
