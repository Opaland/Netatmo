// S-7.10 / #227: bundle-size budget. Run after `npm run build`: node scripts/size-budget.mjs
// Honest measure of the first screen: the entry chunk AND every chunk index.html preloads
// (<link rel="modulepreload">), since the browser downloads them all before the app starts.
// Lazy chunks (ECharts, loaded on the first chart; libsodium for the settings; the views
// imported with import()) are listed but not counted.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

// Entry chunk measured at 244.5 kB gzip (zlib level 9) when the budget was introduced (S-7.10), + 15 %.
const BUDGET_KB = 281;
// #227: target, without changing the budget: the first screen stays under 80 % of it.
const TARGET = 0.8;
// #555: views that the first screen does not show, each in a chunk of its own loaded on demand
// (src/views/lazy-views.ts). The chunk is named after its module; it must exist (a view merged
// into a preloaded chunk has none of its own) and must not be preloaded.
const DEFERRED_VIEWS = ['analyse', 'compare'];

const dist = new URL('../dist/', import.meta.url).pathname;
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const clean = (p) => p.replace(/^\.?\//, '');
const entry = html.match(/<script[^>]*type="module"[^>]*src="([^"]+\.js)"/)?.[1];
if (!entry) {
  console.error("size-budget : script d'entrée introuvable dans dist/index.html (lancer `npm run build` avant).");
  process.exit(1);
}
const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+\.js)"/g)].map((m) => clean(m[1]));
const first = new Set([clean(entry), ...preloads]);

const kb = (n) => (n / 1000).toFixed(2).padStart(8);
const sizes = readdirSync(join(dist, 'assets'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => {
    const buf = readFileSync(join(dist, 'assets', f));
    return { file: `assets/${f}`, raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length };
  })
  .sort((a, b) => b.gzip - a.gzip);

console.log('Chunks JS                                          brut (kB)  gzip (kB)');
for (const s of sizes) {
  const tag = s.file === clean(entry) ? '  ← entrée' : first.has(s.file) ? '  ← préchargé (modulepreload)' : '  (différé)';
  console.log(`${s.file.padEnd(48)} ${kb(s.raw)} ${kb(s.gzip)}${tag}`);
}

const missing = [...first].filter((f) => !sizes.some((s) => s.file === f));
if (missing.length) {
  console.error(`size-budget : ${missing.join(', ')} absent(s) de dist/assets.`);
  process.exit(1);
}
const deferredWrong = DEFERRED_VIEWS.flatMap((name) => {
  const own = sizes.filter((s) => new RegExp(`^assets/${name}-[\\w-]{8}\\.js$`).test(s.file));
  if (!own.length) return [`${name} : pas de morceau à part (fusionné dans un autre, importé en statique ?)`];
  return own.filter((s) => first.has(s.file)).map((s) => `${name} : ${s.file} est préchargé par le premier écran`);
});
if (deferredWrong.length) {
  console.error(`size-budget (#555) : une vue chargée à la demande est revenue dans le premier écran.\n  ${deferredWrong.join('\n  ')}\nLa charger par import() (src/views/lazy-views.ts).`);
  process.exit(1);
}
const used = sizes.filter((s) => first.has(s.file)).reduce((a, s) => a + s.gzip, 0) / 1000;
const pct = (used / BUDGET_KB) * 100;
console.log(
  `\nPremier écran (entrée + ${first.size - 1} préchargé(s)) : ${used.toFixed(2)} kB gzip, budget ${BUDGET_KB} kB (${pct.toFixed(0)} %, objectif < ${TARGET * 100} %).`,
);
if (used > BUDGET_KB) {
  console.error(`Budget dépassé de ${(used - BUDGET_KB).toFixed(2)} kB : alléger le premier écran (import() différé) ou relever le budget en le justifiant.`);
  process.exit(1);
}
if (used > BUDGET_KB * TARGET) {
  console.error(`Objectif #227 manqué : ${pct.toFixed(0)} % du budget (> ${TARGET * 100} %). Différer un module avec import().`);
  process.exit(1);
}
