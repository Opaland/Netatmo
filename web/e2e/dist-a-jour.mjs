// #361: refuses to run an end-to-end test on a dist/ older than the sources. The e2e serve
// web/dist/ (`vite preview`), not web/src/: a forgotten `npm run build`, or one that failed
// unnoticed, tests the previous version, and the test passes for a reason nobody wanted.
//
// It runs INSIDE the test process (`node --import ./e2e/dist-a-jour.mjs e2e/<script>.mjs`, see
// package.json, and startPreview in lib.mjs), not in a hook before the command: a check placed
// before the action only guards what the action has not changed yet (Sentiers, CLAUDE.md §6quater;
// AGENTS.md §6 here).
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
/** What `npm run build` reads: a change in any of them makes dist/ stale. */
export const SOURCES = ['src', 'public', 'index.html', 'composants.html', 'vite.config.ts', 'tsconfig.json', 'package.json'];

function newest(path) {
  if (!existsSync(path)) return { at: 0, file: null };
  const s = statSync(path);
  if (!s.isDirectory()) return { at: s.mtimeMs, file: path };
  let best = { at: 0, file: null };
  for (const name of readdirSync(path)) {
    const n = newest(join(path, name));
    if (n.at > best.at) best = n;
  }
  return best;
}

/** null when dist/ is up to date, else the sentence to show. */
export function staleDist(dir = web) {
  const built = join(dir, 'dist', 'index.html');
  if (!existsSync(built)) return 'web/dist/ est absent : lancer `npm run build` (dans web/) avant les e2e.';
  const at = statSync(built).mtimeMs;
  for (const src of SOURCES) {
    const n = newest(join(dir, src));
    if (n.at > at) return `web/dist/ est plus ancien que ${n.file.slice(dir.length)} : lancer \`npm run build\` (dans web/) avant les e2e.`;
  }
  return null;
}

/** Throws with the sentence (scripts that start their server through lib.mjs). */
export function assertFreshDist() {
  const why = staleDist();
  if (why) throw new Error(why);
}

// Loaded with `node --import ./e2e/dist-a-jour.mjs`: stop before anything starts. (Imported
// by lib.mjs or a test, it only exports: startPreview calls assertFreshDist itself.)
if (process.execArgv.some((a) => a.endsWith('dist-a-jour.mjs'))) {
  const why = staleDist();
  if (why) {
    console.error(`E2E refusé : ${why}`);
    process.exit(1);
  }
}
