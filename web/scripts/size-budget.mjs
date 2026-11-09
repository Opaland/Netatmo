// S-7.10: bundle-size budget. Run after `npm run build`: node scripts/size-budget.mjs
// Fails when the entry chunk (the JS loaded by index.html) exceeds the gzip budget.
// Lazy chunks (libsodium for the settings, the service-worker registration) are listed
// but not counted: they are not needed to display the first screen.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

// Entry chunk measured at 244.5 kB gzip (zlib level 9) when the budget was introduced (S-7.10), + 15 %.
const BUDGET_KB = 281;

const dist = new URL('../dist/', import.meta.url).pathname;
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entry = html.match(/<script[^>]*type="module"[^>]*src="\.?\/?([^"]+\.js)"/)?.[1];
if (!entry) {
  console.error('size-budget : script d\'entrée introuvable dans dist/index.html (lancer `npm run build` avant).');
  process.exit(1);
}

const kb = (n) => (n / 1000).toFixed(2).padStart(8);
const sizes = readdirSync(join(dist, 'assets'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => {
    const buf = readFileSync(join(dist, 'assets', f));
    return { file: `assets/${f}`, raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length };
  })
  .sort((a, b) => b.gzip - a.gzip);

console.log('Chunks JS            brut (kB)  gzip (kB)');
for (const s of sizes) console.log(`${s.file.padEnd(48)} ${kb(s.raw)} ${kb(s.gzip)}${s.file === entry ? '  ← entrée' : '  (différé)'}`);

const main = sizes.find((s) => s.file === entry);
if (!main) {
  console.error(`size-budget : ${entry} absent de dist/assets.`);
  process.exit(1);
}
const used = main.gzip / 1000;
console.log(`\nEntrée ${entry} : ${used.toFixed(2)} kB gzip, budget ${BUDGET_KB} kB (${((used / BUDGET_KB) * 100).toFixed(0)} %).`);
if (used > BUDGET_KB) {
  console.error(`Budget dépassé de ${(used - BUDGET_KB).toFixed(2)} kB : alléger le chunk d'entrée (import() différé) ou relever le budget en le justifiant.`);
  process.exit(1);
}
