// #358: the Vitest configuration of the mutation runs (stryker.config.json). Stryker copies web/
// into a sandbox: the three tests that read files outside web/ (docs/, SECURITY.md, the CI) cannot
// run there, and they test documents, not the six mutated modules. No PWA plugin: faster.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/export.test.ts', 'src/security-md.test.ts', 'src/doc-chiffres.test.ts'],
  },
});
