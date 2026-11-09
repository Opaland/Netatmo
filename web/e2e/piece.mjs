// #313: the Pièces list (by cost, comfort pill, water heater apart) and the page of a room
// (« maintenant », planning, tiles, temperature, « Pourquoi il a fait froid », consumption, air,
// radiator), in the demo: content, household view (bedrooms grouped, never named), axe in light,
// dark and high contrast, 360 px with the system text at 200 % (no horizontal scroll).
// Run after `npm run build`: node e2e/piece.mjs  (starts `vite preview` itself; port: E2E_PORT;
// E2E_BROWSER=webkit|chromium). Captures in e2e/screenshots/piece-*.png.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { chromium, webkit } from 'playwright';

const BROWSER = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const PORT = Number(process.env.E2E_PORT ?? 4185);
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

const ready = (page) => page.waitForSelector('#view[data-ready]', { state: 'attached', timeout: 30000 });
async function go(page, key) {
  const tab = page.locator(`.tabs [data-view="${key}"]`);
  if (await tab.count()) await tab.click();
  else await page.evaluate((k) => (location.hash = `#${k}`), key);
  await page.waitForSelector(`#view[data-page="${key}"][data-ready]`, { state: 'attached', timeout: 30000 });
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
/** Euros (or kWh) of the list rows, in order. */
const values = (page, list) =>
  page.$$eval(`#view ul[aria-label="${list}"] .row .v`, (els) => els.map((e) => Number((e.firstChild?.textContent ?? '').replace(/[^\d]/g, ''))));

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

    // ---------------------------------------------------------------- the list
    progress(`${name} : Pièces`);
    await go(page, 'pieces');
    const eur = await values(page, 'Pièces chauffées, de la plus chère à la moins chère');
    check(eur.length >= 4, `${name} : liste des pièces vide (${eur.join(', ')})`);
    check(eur.every((v, i) => i === 0 || v <= eur[i - 1]), `${name} : pièces non triées par coût (${eur.join(', ')})`);
    check((await page.locator('#view .row .pill').count()) >= 4, `${name} : pastilles de confort absentes`);
    check((await page.locator('#view ul[aria-label=Appareils] a[href="#chauffe-eau"]').count()) === 1, `${name} : chauffe-eau absent de la section Appareils`);
    check((await page.locator('#view a[href="#confort"]').count()) >= 1, `${name} : lien Air et confort absent`);
    check((await wide(page)) <= 1, `${name} : défilement horizontal sur Pièces (${await wide(page)} px)`);
    await audit(page, `${name}/pieces`, enhanced);
    await page.screenshot({ path: `${OUT}/piece-${BROWSER}-${name}-liste.png`, fullPage: true });

    // ---------------------------------------------------------------- the most expensive room (Salon in the demo)
    progress(`${name} : page Pièce`);
    await page.locator('#view a[data-room-link]').first().click();
    await page.waitForSelector('#view[data-page^="piece-"][data-ready]', { state: 'attached', timeout: 30000 });
    await page.waitForSelector('#piece-temp-chart canvas', { timeout: 15000 }).catch(() => errors.push(`${name} : graphique de température absent`));
    await page.waitForSelector('#room-detail canvas', { timeout: 15000 }).catch(() => errors.push(`${name} : graphique de consommation absent`));
    await ready(page);
    const text = await page.locator('#view').innerText();
    check(/Maintenant/.test(text) && (await page.locator('#piece-now .now .temp').count()) === 1, `${name} : panneau « maintenant » absent`);
    check((await page.locator('#piece-now .sched').count()) === 1, `${name} : planning du jour absent`);
    check(/jusqu’à \d+ h/.test(text), `${name} : mode sans « jusqu'à »`);
    check(/vs \d{4} à date/.test(await page.locator('#piece-cost').innerText()), `${name} : coût sans comparaison nommée`);
    check(/Temps à la consigne/.test(text) && /température demandée/.test(await page.locator('#piece-at-setpoint').innerText()), `${name} : « temps à la consigne » sans définition`);
    check(!/tps/i.test(text), `${name} : libellé « tps » encore présent`);
    check(/Pourquoi il a fait froid/.test(text), `${name} : « Pourquoi il a fait froid » absent`);
    check((await page.locator('#piece-radiator .row').count()) >= 3, `${name} : carte Radiateur incomplète`);
    check(/Surface/.test(await page.locator('#piece-radiator').innerText()), `${name} : surface absente du radiateur`);
    check(/CO₂ la nuit/.test(text), `${name} : air (CO₂ des nuits) absent`);
    const axis = await page.locator('#piece-temp-chart').getAttribute('aria-label');
    check(/jours? sous|aucun jour sous/.test(axis ?? ''), `${name} : résumé du graphique de température sans les jours froids (« ${axis} »)`);
    check((await wide(page)) <= 1, `${name} : défilement horizontal sur la page Pièce (${await wide(page)} px)`);
    await audit(page, `${name}/piece`, enhanced);
    await page.screenshot({ path: `${OUT}/piece-${BROWSER}-${name}-salon.png`, fullPage: true });

    // ---------------------------------------------------------------- a room with cold days (parents' bedroom: 18 °C asked, aired some mornings)
    if (name === 'clair') {
      await go(page, 'piece-r-ch1');
      await page.waitForSelector('#froid li', { timeout: 15000 }).catch(() => errors.push(`${name} : chambre parentale sans jour froid expliqué`));
      const cold = await page.locator('#froid').innerText();
      check(/température demandée de 18,0 °C/.test(cold) && /\(1\d,\d °C\) :/.test(cold), `${name} : jours froids de la chambre parentale mal expliqués (« ${cold.slice(0, 200)} »)`);
      await page.screenshot({ path: `${OUT}/piece-${BROWSER}-${name}-chambre.png`, fullPage: true });

      // ---------------------------------------------------------------- household view: « Chambres » regroupées, never named
      progress(`${name} : vue foyer`);
      await go(page, 'parametres-affichage');
      await page.check('[data-toggle=household]');
      await ready(page);
      await go(page, 'pieces');
      const list = await page.locator('#view ul[aria-label^="Pièces chauffées"]').innerText();
      check(/Chambres/.test(list) && /regroupées/.test(list) && !/Chambre parentale/.test(list), `${name} : vue foyer non respectée dans la liste (« ${list.replace(/\s+/g, ' ').slice(0, 200)} »)`);
      await go(page, 'piece-__bedrooms__');
      await page.waitForSelector('#piece-temp-chart canvas', { timeout: 15000 }).catch(() => errors.push(`${name} : page Chambres sans température`));
      await ready(page);
      const ch = await page.locator('#view').innerText();
      check(!/Chambre parentale|Chambre enfant/.test(ch), `${name} : la page Chambres nomme une chambre`);
      check((await page.locator('[data-piece=show-air]').count()) === 1, `${name} : l'air des chambres n'est pas masqué par défaut`);
      await page.click('[data-piece=show-air]');
      await page.waitForSelector('#piece-air >> text=CO₂ la nuit', { timeout: 10000 }).catch(() => errors.push(`${name} : « Afficher l'air » sans effet`));
      await audit(page, `${name}/chambres`);
      await page.screenshot({ path: `${OUT}/piece-${BROWSER}-${name}-chambres.png`, fullPage: true });
      await go(page, 'parametres-affichage');
      await page.uncheck('[data-toggle=household]');
      await ready(page);
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
console.log(`Pièce : OK (captures dans ${OUT})`);
