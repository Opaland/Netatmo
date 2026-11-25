// #649 n° 4: what the mutation configuration (vitest.mutation.config.mjs) leaves out, said instead
// of silent. Stryker copies web/ into a sandbox: a test file that reads outside web/ (a path up to
// the repository root) cannot run there and is excluded, whole (#495). #633: crypto.ts fell to
// 77.6 % when one of its test files started reading outside web/, and nothing said so. Pure
// functions over the test sources ({ 'x.test.ts': text }), tested in src/mutation-exclusion.test.ts.
//
//   node mutation-exclusion.mjs     prints the excluded files, fails when a mutated module has no
//                                   test file left (`npm run mutation` runs it before Stryker, whose
//                                   test runner does not show what its configuration prints)
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The test files that read outside web/ (a path up to the repository root): excluded. */
export function outsideTests(sources) {
  return Object.keys(sources)
    .filter((f) => f.endsWith('.test.ts') && sources[f].includes('../../'))
    .sort();
}

/** The test files that import a module (`'./crypto'`, `"./crypto.ts"`): its tests. */
export function testsOf(module, sources) {
  const base = module.replace(/^src\//, '').replace(/\.ts$/, '');
  const re = new RegExp(`['"]\\./${base.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')}(?:\\.ts)?['"]`);
  return Object.keys(sources)
    .filter((f) => f.endsWith('.test.ts') && re.test(sources[f]))
    .sort();
}

/**
 * What the exclusion costs the mutated modules (`mutate` of stryker.config.json): the lines
 * printed at every launch (each excluded file, and the mutated modules it also tests), and the
 * mutated modules left without any test file once it is applied — the configuration fails on
 * them, since their score would mean nothing.
 */
export function exclusionReport(mutate, sources) {
  const outside = outsideTests(sources);
  const lines = [`Mutation : ${outside.length} fichier(s) de tests écarté(s), car ils lisent hors de web/ (#649 n° 4) :`];
  for (const f of outside) {
    const tested = mutate.filter((m) => testsOf(m, sources).includes(f));
    lines.push(`  src/${f}${tested.length ? ` — teste aussi ${tested.join(', ')}` : ''}`);
  }
  const orphans = mutate.filter((m) => testsOf(m, sources).every((f) => outside.includes(f)));
  return { outside, lines, orphans };
}

/** The report for this web/ folder: its test sources and the `mutate` of stryker.config.json. */
export function webReport() {
  const dir = new URL('./src/', import.meta.url);
  const sources = Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith('.test.ts'))
      .map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]),
  );
  const { mutate } = JSON.parse(readFileSync(new URL('./stryker.config.json', import.meta.url), 'utf8'));
  return exclusionReport(mutate, sources);
}

/** The error when a mutated module has no test file left, or null. */
export function orphanError(report) {
  return report.orphans.length
    ? `Mutation : ${report.orphans.join(', ')} sans aucun fichier de tests dans la mutation (tous écartés car ils lisent hors de web/, ou aucun) : son score ne voudrait rien dire.`
    : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = webReport();
  console.log(report.lines.join('\n'));
  const error = orphanError(report);
  if (error) {
    console.error(error);
    process.exit(1);
  }
}
