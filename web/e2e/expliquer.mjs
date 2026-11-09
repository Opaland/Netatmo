// #337 « Expliquer un mois » and #346 rooms without reading, in the demo: the living room radiator
// switched off on purpose since 14 October 2025 (a stove, declared in ⚙ Mon logement) and the
// kitchen out of reach since 1 December 2025. The link under the verdict of Accueil and the row of
// Outils, January 2026 explained (sentence, parts from 0 with the change of heating, rooms, the
// kitchen estimated), « hors ligne » vs « arrêté (poêle) » in Accueil, Pièces, the room pages and
// État des données, the setting of Mon logement; axe in light, dark and high contrast, 360 px
// with the text at 200 % (no horizontal scroll).
// Run after `npm run build`: node e2e/expliquer.mjs  (starts `vite preview` itself; port: E2E_PORT;
// E2E_BROWSER=webkit|chromium). Captures in e2e/screenshots/expliquer-*.png.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { chromium, webkit } from 'playwright';

const BROWSER = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const PORT = Number(process.env.E2E_PORT ?? 4186);
const OUT = process.env.E2E_OUT ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const busy = await fetch(`http://localhost:${PORT}/`).then(
  () => true,
  () => false,
);
if (busy) {
  console.error(`E2E : le port ${PORT} est déjà utilisé, définir E2E_PORT.`);
  process.exit(1);
}
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let serverExited = false;
server.on('exit', () => (serverExited = true));
const base = `http://localhost:${PORT}/`;
const errors = [];
const check = (ok, msg) => ok || errors.push(`${BROWSER}: ${msg}`);
const t0 = Date.now();
const progress = (s) => console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${BROWSER} ${s}`);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    if (serverExited) throw new Error(`port ${PORT} déjà utilisé (choisir E2E_PORT=…)`);
    try {
      if ((await fetch(base)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

const shown = (page, key) => page.waitForSelector(`#view[data-page="${key}"][data-ready]`, { state: 'attached', timeout: 30000 });
async function go(page, key) {
  const tab = page.locator(`.tabs [data-view="${key}"]`);
  if (await tab.count()) await tab.click();
  else await page.evaluate((k) => (location.hash = `#${k}`), key);
  await shown(page, key);
}
async function audit(page, where, enhanced = false) {
  progress(`axe ${where}`);
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', ...(enhanced ? ['wcag2aaa'] : [])]);
  if (enhanced) builder.withRules(['color-contrast-enhanced']);
  const { violations } = await builder.analyze();
  for (const v of violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'))
    errors.push(`${BROWSER} ${where} : axe « ${v.id} » → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}
const wide = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const KITCHEN = /Cuisine : hors ligne depuis le 1er déc\. 2025/;
const STOVE = /arrêté depuis le 14 oct\. 2025 \(poêle\)/;

try {
  await waitForServer();
  const browser = await (BROWSER === 'webkit' ? webkit : chromium).launch();
  const runs = [
    ['clair', { viewport: { width: 390, height: 900 } }],
    ['sombre', { viewport: { width: 390, height: 900 }, colorScheme: 'dark' }],
    ['contraste', { viewport: { width: 390, height: 900 }, contrast: 'more' }, true],
    ['texte-200', { viewport: { width: 360, height: 800 } }, false, true],
  ];
  for (const [name, opts, enhanced, big] of runs) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${BROWSER} ${name}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${BROWSER} ${name} console: ${m.text()}`));
    await page.goto(base);
    await page.click('#demo');
    await page.waitForSelector('header.top', { timeout: 30000 });
    if (big) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    // ---------------------------------------------------------------- Accueil: the room offline, the link under the verdict
    progress(`${name} : Accueil`);
    await go(page, 'accueil');
    const alerts = await page.locator('#alerts').innerText();
    check(KITCHEN.test(alerts) && /Plus mesurée/.test(alerts), `${name} : alerte « hors ligne » absente de l'Accueil (« ${alerts.slice(0, 200)} »)`);
    check(!/Salon/.test(alerts), `${name} : alerte pour le Salon, arrêté volontairement (« ${alerts.slice(0, 200)} »)`);
    const link = page.locator('.verdict .verdict-link a[href^="#outils-expliquer-"]');
    check((await link.count()) === 1, `${name} : lien « Pourquoi ? » absent sous le verdict`);
    const sub = await page.locator('.verdict').innerText();
    check(/sans Cuisine \(hors ligne\)/i.test(sub), `${name} : le verdict ne dit pas que la Cuisine n'est pas comparée`);
    check(/Salon chauffé au poêle depuis le 14 oct\. 2025/.test(sub), `${name} : le verdict n'attribue pas la baisse au poêle (« ${sub.slice(0, 300)} »)`);
    check((await wide(page)) <= 1, `${name} : défilement horizontal sur l'Accueil (${await wide(page)} px)`);

    // ---------------------------------------------------------------- the link opens the month shown
    progress(`${name} : Expliquer un mois`);
    const href = (await link.getAttribute('href')) ?? '';
    await link.click();
    await shown(page, href.slice(1));
    check((await page.locator('select[data-explain-month]').count()) === 1, `${name} : choix du mois absent`);

    // ---------------------------------------------------------------- January 2026, the owner's question
    await page.selectOption('select[data-explain-month]', '2026-01');
    await shown(page, 'outils-expliquer-2026-01');
    await page.waitForSelector('#explain-chart canvas', { timeout: 15000 }).catch(() => errors.push(`${name} : cascade absente`));
    const sentence = await page.locator('#explain-sentence').innerText();
    check(/^En janvier 2026, le logement a consommé \d+ kWh de moins qu’en janvier 2025/.test(sentence), `${name} : phrase de synthèse inattendue (« ${sentence} »)`);
    check(/Surtout le poêle au Salon/.test(sentence) && /plus froid/.test(sentence) && /Cuisine hors ligne/.test(sentence), `${name} : la synthèse ne cite ni le poêle, ni la météo, ni la pièce hors ligne (« ${sentence} »)`);
    const steps = await page.locator('#explain-steps ul[aria-label="Écart par cause"] .row').allInnerTexts();
    const want = ['Météo', 'Températures demandées', 'Changement de mode de chauffage (poêle au Salon)', 'Pièces', 'Pièces hors ligne (estimée)', 'Eau chaude', 'Autres usages'];
    check(want.every((w, i) => steps[i]?.startsWith(w)), `${name} : parts de l'écart (${steps.map((s) => s.split('\n')[0]).join(' | ')})`);
    const scope = await page.locator('#view .periodbar .scope').innerText();
    check(/^Compté : tout le logement \(compteur Linky\), du 1er janv\. au 31 janv\. 2026, comparé aux mêmes jours de janvier 2025$/.test(scope), `${name} : ligne « Compté : » (« ${scope} »)`);
    // the parts are drawn from 0 (no zoomed axis): the summary gives both totals
    const aria = (await page.locator('#explain-chart').getAttribute('aria-label')) ?? '';
    check(/^Écart par cause, en kWh\. de [\d\s ]+ kWh \(janv\. 2025\) à [\d\s ]+ kWh \(janv\. 2026\)/.test(aria), `${name} : résumé de la cascade (« ${aria.slice(0, 160)} »)`);
    const view = await page.locator('#view').innerText();
    check(KITCHEN.test(view) && /Salon : radiateur arrêté depuis le 14 oct\. 2025 \(poêle\)/.test(view), `${name} : la Cuisine hors ligne ou le Salon arrêté ne sont pas signalés dans l'explication`);
    check((await page.locator('#explain-rooms .row').count()) >= 5, `${name} : pièce par pièce incomplet`);
    check((await wide(page)) <= 1, `${name} : défilement horizontal sur « Expliquer un mois » (${await wide(page)} px)`);
    await audit(page, `${name}/expliquer`, enhanced);
    await page.screenshot({ path: `${OUT}/expliquer-${BROWSER}-${name}.png`, fullPage: true });

    // ---------------------------------------------------------------- Outils, Pièces and the room page
    if (name === 'clair' || big) {
      await go(page, 'outils');
      check((await page.locator('#view a[href="#outils-expliquer"]').count()) === 1, `${name} : « Expliquer un mois » absent d'Outils`);
      await go(page, 'pieces');
      const list = await page.locator('#view ul[aria-label^="Pièces chauffées"]').innerText();
      check(/Cuisine[\s\S]*hors ligne depuis le 1er déc\. 2025/.test(list), `${name} : Pièces ne dit pas que la Cuisine est hors ligne`);
      check(new RegExp(`Salon[\\s\\S]*${STOVE.source}`).test(list), `${name} : Pièces ne dit pas que le Salon est arrêté (poêle)`);
      check(!/Cuisine\s*\n?\s*0 kWh/.test(list), `${name} : la Cuisine affiche 0 kWh`);
      await go(page, 'piece-r-cuisine');
      const p = await page.locator('#view').innerText();
      check(KITCHEN.test(p) && /non comparé/.test(p), `${name} : page Cuisine sans « hors ligne » ni comparaison écartée`);
      check((await wide(page)) <= 1, `${name} : défilement horizontal sur la page Cuisine (${await wide(page)} px)`);
      await audit(page, `${name}/cuisine`, enhanced);
      await page.screenshot({ path: `${OUT}/expliquer-${BROWSER}-${name}-cuisine.png`, fullPage: true });
      await go(page, 'piece-r-salon');
      const salon = await page.locator('#view').innerText();
      check(/Radiateur arrêté depuis le 14 oct\. 2025 \(poêle\)/.test(salon) && /changement de mode de chauffage/.test(salon) && !/hors ligne/.test(salon), `${name} : page Salon sans « arrêté (poêle) » (« ${salon.slice(0, 300)} »)`);

      // ---------------------------------------------------------------- État des données: no data expected, the year not degraded
      progress(`${name} : État des données`);
      await go(page, 'etat');
      await page.waitForSelector('#quality-sources', { timeout: 15000 });
      const etat = await page.locator('#view').innerText();
      check(/Salon : radiateur arrêté volontairement depuis le 14 oct\. 2025 \(chauffé par un poêle à granulés\) : pas de données attendues/.test(etat), `${name} : État des données sans « arrêté volontairement : pas de données attendues »`);
      check(!/muette depuis le 14 oct\. 2025/.test(etat), `${name} : État des données compte le Salon comme muet`);
      // 2026 is « à vérifier » because of the kitchen (out of reach), never because of the living room
      const y2026 = await page.locator('#quality-years .year-verdict').first().innerText();
      check(/Cuisine/.test(y2026) && !/Salon/.test(y2026), `${name} : 2026 expliquée par le Salon arrêté (« ${y2026.replace(/\s+/g, ' ').slice(0, 300)} »)`);
      check((await wide(page)) <= 1, `${name} : défilement horizontal sur État des données (${await wide(page)} px)`);
      await audit(page, `${name}/etat`, enhanced);

      // ---------------------------------------------------------------- ⚙ Mon logement: declare the kitchen switched off, the alert goes
      progress(`${name} : Mon logement`);
      await go(page, 'parametres-logement');
      const card = page.locator('#stopped-card');
      check(/Salon/.test(await card.locator('ul[aria-label="Radiateurs arrêtés"]').innerText()), `${name} : le Salon n'est pas listé parmi les radiateurs arrêtés`);
      check(/Cuisine n’envoie plus rien depuis le 1er déc\. 2025/.test(await card.innerText()), `${name} : la Cuisine n'est pas proposée`);
      await audit(page, `${name}/logement`, enhanced);
      if (!big) {
        await page.selectOption('#stop-room', 'r-cuisine');
        await page.selectOption('#stop-reason', 'inoccupee');
        await page.click('#stop-add');
        await page.waitForSelector('#stopped-card [data-stop-remove="r-cuisine"]', { timeout: 10000 });
        await go(page, 'accueil');
        check(!/Cuisine : hors ligne/.test(await page.locator('#alerts').innerText()), `${name} : alerte toujours là après « arrêté volontairement »`);
        await go(page, 'parametres-logement');
        await page.click('#stopped-card [data-stop-remove="r-cuisine"]');
        await page.waitForSelector('#stopped-card #stop-room option[value="r-cuisine"]', { state: 'attached', timeout: 10000 });
        await go(page, 'accueil');
        check(KITCHEN.test(await page.locator('#alerts').innerText()), `${name} : alerte absente après avoir retiré la Cuisine`);
      }
    }
    await ctx.close();
  }
  await browser.close();
} catch (err) {
  errors.push(`${BROWSER}: ${err}`);
} finally {
  server.kill();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Expliquer un mois : OK (captures dans ${OUT})`);
