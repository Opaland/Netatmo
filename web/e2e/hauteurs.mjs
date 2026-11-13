// #556: the height of every page of the end-of-version review table, measured in the repository
// (the reviews v2.0 to v2.2 used a script outside it). On the demo, in the CI's wide font (DejaVu
// Sans, A6), Chromium:
// - every page at 360 × 800 and at 360 × 800 with the text at 200 %, in screens of 800 px;
// - every page that has a height limit (e2e/hauteurs-limites.mjs, the guard's own list): its
//   height, its limit and its margin in px. A limit exceeded makes the script fail, like the guard.
// Prints a Markdown table to paste into the review. No limit is added here (cadrage v2.3 § 2).
// Run after `npm run build`: npm run e2e:hauteurs   (port E2E_PORT, default 4204)
import { chromium, devices } from 'playwright';
import { HEIGHT_LIMITS, displayOptions, measureHeight } from './hauteurs-limites.mjs';
import { frames, goto, openDemo, ready, startPreview } from './lib.mjs';

const PORT = Number(process.env.E2E_PORT ?? 4204);
const FONT = 'html, body, button, input, select, textarea { font-family: "DejaVu Sans", system-ui, sans-serif !important; }';
const BIG = 'html { font-size: 200% !important; }';

/** Open the État des données's « Année par année » and its detailed audit (folded, #387). */
async function openEtatFolds(page) {
  await page.click('#quality-years > summary');
  await page.waitForSelector('#audit-fold > summary', { timeout: 20000 });
  await page.click('#audit-fold > summary');
  await frames(page);
  await ready(page);
}

/** The rows of the review table (docs/bmad/revues/v2.2.md § 6): [label, route, then (page) => …]. */
const ROWS = [
  ['Accueil', 'accueil'],
  ['Pièces', 'pieces'],
  ['Page Pièce (Salon)', 'piece:Salon'],
  ['Historique', 'historique'],
  ['Historique › Le logement face au froid', 'historique-froid'],
  ['État des données', 'etat'],
  ['État des données, « Année par année » et l’audit ouverts (sans rapport)', 'etat', openEtatFolds],
  ['Air et confort', 'confort'],
  ['Compteur', 'compteur'],
  ['Outils', 'outils'],
  ['Rapport (sans surface)', 'rapport'],
  ['⚙ Mon logement', 'parametres-logement'],
  ['⚙ Sources de données', 'parametres-sources'],
  ['⚙ Contrat et prix', 'parametres-contrat'],
  ['⚙ Objectifs et alertes', 'parametres-objectifs'],
  ['⚙ À propos', 'parametres-apropos'],
  ['⚙ Sécurité', 'parametres-securite'],
];

const errors = [];

/** A demo session on `display`, in DejaVu Sans, the text at 200 % when `big`. */
async function session(browser, base, display, big = false) {
  const ctx = await browser.newContext({ ...displayOptions(display, devices), serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${display}${big ? ' 200 %' : ''} : ${e.message}`));
  await openDemo(page, base);
  await page.addStyleTag({ content: `${big ? BIG : ''}${FONT}` });
  await frames(page);
  return { ctx, page };
}

/** Show `route` (« piece:Salon »: the room named so, from the list) and wait until it is settled. */
async function show(page, route) {
  if (route.startsWith('piece:')) {
    await goto(page, 'pieces');
    const name = route.slice(6);
    const href = await page.$$eval('#view a[href^="#piece-"]', (as, n) => as.find((a) => a.textContent.includes(n))?.getAttribute('href'), name);
    if (!href) throw new Error(`pièce « ${name} » introuvable dans la liste`);
    route = href.slice(1);
  }
  await goto(page, route);
  await frames(page);
  await ready(page);
}

/** Heights of every row on one display: [h in px, …] in the order of ROWS. */
async function heights(browser, base, big) {
  const { ctx, page } = await session(browser, base, '360', big);
  const out = [];
  for (const [, route, then] of ROWS) {
    await show(page, route);
    if (then) await then(page);
    out.push((await measureHeight(page, route, '360')).h);
  }
  await ctx.close();
  return out;
}

const { base, stop } = await startPreview(PORT);
const browser = await chromium.launch();
const t0 = Date.now();
try {
  // the limits: each on its own display, at 100 % (as the guard measures them)
  const limits = [];
  for (const display of [...new Set(HEIGHT_LIMITS.map((l) => l.display))]) {
    const { ctx, page } = await session(browser, base, display);
    for (const l of HEIGHT_LIMITS.filter((x) => x.display === display)) {
      await show(page, l.route);
      limits.push({ ...l, ...(await measureHeight(page, l.route, display)) });
    }
    await ctx.close();
  }
  const [normal, big] = await Promise.all([heights(browser, base, false), heights(browser, base, true)]);

  const fr = (x, d = 1) => x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const where = (d) => (d === 'iphone' ? 'iPhone 13' : '360 × 800');
  console.log('\n**Limites de hauteur** (`e2e/hauteurs-limites.mjs`, DejaVu Sans, démo, Chromium)\n');
  console.log('| Écran | Affichage | Hauteur | Limite | Marge |');
  console.log('|---|---|---|---|---|');
  for (const l of limits) {
    const name = ROWS.find(([, r]) => r === l.route)?.[0] ?? l.route;
    console.log(`| ${name} (${l.issue}) | ${where(l.display)} | ${fr(l.h, 0)} px | ${l.screens} écrans, ${fr(l.max, 0)} px | ${l.ok ? '' : '**'}${fr(l.margin, 0)} px${l.ok ? '' : '**'} |`);
  }
  console.log('\n**Hauteurs** (écrans de 800 px, `scrollHeight / 800`, DejaVu Sans, démo, Chromium)\n');
  console.log('| Écran | 360 px | 360 px à 200 % |');
  console.log('|---|---|---|');
  ROWS.forEach(([label], i) => console.log(`| ${label} | ${fr(normal[i] / 800)} | ${fr(big[i] / 800)} |`));
  console.log(`\n(${Math.round((Date.now() - t0) / 1000)} s)`);

  for (const l of limits) if (!l.ok) errors.push(l.message);
} finally {
  await browser.close();
  stop();
}
if (errors.length) {
  console.error(`\n${errors.length} échec(s) :\n${errors.join('\n')}`);
  process.exit(1);
}
