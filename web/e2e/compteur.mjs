// v1.6 #301 / #308: the Compteur tab (maquette docs/design/maquettes/compteur.html) and its four
// detail pages, on Chromium:
// - one period for the tab: the control changes every card, each card says what it counts;
// - a room filter left on is named (it does not apply to the meter);
// - 360 px phone, text at 200 %: no horizontal scroll, nothing sticks out, « Veille » on one line;
// - axe-core clean in light, dark and high contrast (7:1), light and dark.
// Run after `npm run build`: node e2e/compteur.mjs   (port E2E_PORT, captures: e2e/captures.mjs)
import { spawn } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';
import { capturesOut } from './captures.mjs';

const PORT = Number(process.env.E2E_PORT ?? 4183);
const OUT = capturesOut(); // #583: e2e/screenshots/ only in the CI's font
const busy = await fetch(`http://localhost:${PORT}/`).then(
  () => true,
  () => false,
);
if (busy) {
  console.error(`E2E : le port ${PORT} est déjà utilisé, définir E2E_PORT.`);
  process.exit(1);
}
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const base = `http://localhost:${PORT}/`;
const errors = [];
const check = (ok, msg) => ok || errors.push(msg);
const t0 = Date.now();
const progress = (s) => console.log(`[${Math.round((Date.now() - t0) / 1000)} s] compteur ${s}`);
const PAGES = ['compteur', 'compteur-journee', 'compteur-veille', 'compteur-autres', 'compteur-heures-creuses'];

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
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
async function openDemo(page) {
  await page.goto(base);
  await page.click('#demo');
  await page.waitForSelector('header.top', { timeout: 30000 });
}
async function audit(page, where, enhanced = false) {
  progress(`axe ${where}`);
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', ...(enhanced ? ['wcag2aaa'] : [])]);
  if (enhanced) builder.withRules(['color-contrast-enhanced']);
  const { violations } = await builder.analyze();
  for (const v of violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')) {
    errors.push(`${where} : axe ${v.impact} « ${v.id} » ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  }
}

try {
  await waitForServer();
  const browser = await chromium.launch();

  // the period, what each card counts, the filter that does not apply
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`compteur: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`compteur: ${m.text()}`));
    await openDemo(page);
    await go(page, 'compteur');
    progress('période et « Compté : »');
    check((await page.locator('[data-set=meter][aria-checked=true]').textContent()) === '12 mois', 'la période du Compteur n’est pas « 12 mois » par défaut');
    check(/tout le logement, relevé par le compteur Linky/.test(await page.locator('.periodbar .scope').innerText()), 'ligne de portée absente');
    for (const id of ['share-card', 'power-card']) {
      check(/^Compté :/.test((await page.locator(`#${id} .counted`).innerText()).trim()), `#${id} : ne dit pas ce qu’il compte`);
      check(/12 derniers mois/.test(await page.locator(`#${id} .card-period`).innerText()), `#${id} : période absente`);
    }
    const share = await page.locator('#share-card .share').getAttribute('aria-label');
    const pct = [...share.matchAll(/(\d+)\s%/g)].map((m) => Number(m[1]));
    check(pct.length === 3 && pct.reduce((a, b) => a + b) === 100, `part des usages : ${share}`);
    check(/kVA/.test(await page.locator('#power-card .big').innerText()), 'puissance maximale absente');
    check(await page.locator('#power-card .gauge').count(), 'puissance : jauge souscrits / utilisés absente');
    await page.waitForFunction(() => /\d+ W en permanence/.test(document.querySelector('a[href="#compteur-veille"] .s')?.textContent ?? ''), null, { timeout: 15000 }).catch(() =>
      errors.push('ligne « Veille » sans la puissance permanente'),
    );
    await page.screenshot({ path: `${OUT}/compteur-mobile.png`, fullPage: true });
    // one period for the tab and its pages: « Mois » changes the cards and is kept on a detail page
    await page.click('[data-set=meter][data-value=month]');
    await ready(page);
    check(/nov\. 2026/.test(await page.locator('#share-card .card-period').innerText()), 'la période « Mois » ne s’applique pas à la part des usages');
    check(/du 1er nov\. au 8 nov\. 2026 \(8 jours\)/.test(await page.locator('#share-card .counted').innerText()), `« Compté » du mois : ${await page.locator('#share-card .counted').innerText()}`);
    await go(page, 'compteur-veille');
    check((await page.locator('[data-set=meter][aria-checked=true]').textContent()) === 'Mois', 'la période n’est pas gardée sur la page Veille');
    check(/8 nuits/.test(await page.locator('#standby-card .counted').innerText()), `Veille : nuits comptées → ${await page.locator('#standby-card .counted').innerText()}`);
    await page.click('[data-set=meter][data-value="12m"]');
    await ready(page);
    check(/60 nuits sur 365/.test(await page.locator('#standby-card .counted').innerText()), 'Veille : la courbe (60 jours) n’est pas dite sur 12 mois');
    // #348: « Autres usages en détail » gives the same standby as the Veille page, and why its row differs
    const standby = (await page.locator('#standby-card .meter-big .big').innerText()).replace(/\s/g, ' ').trim();
    await go(page, 'compteur-autres');
    await page.waitForSelector('#bd-parts .row', { timeout: 15000 });
    const veilleRow = (await page.locator('#bd-parts .row', { hasText: 'Veille' }).innerText()).replace(/\s/g, ' ');
    check(veilleRow.includes(`veille ${standby} la nuit`), `Autres usages : la ligne « Veille » ne reprend pas les ${standby} de la page Veille → ${veilleRow}`);
    check(/appareils permanents/.test(veilleRow), `Autres usages : l’écart avec la page Veille n’est pas expliqué → ${veilleRow}`);
    // #348: shedding says what a day counts
    await go(page, 'compteur');
    await page.waitForSelector('#offload-line:not([hidden])', { timeout: 15000 }).catch(() => {});
    const shed = await page.locator('#offload-line').innerText();
    check(/\d+ jours? avec au moins un délestage|Aucun radiateur coupé/.test(shed), `délestage : libellé → ${shed}`);
    await go(page, 'compteur-veille');
    // every detail page says what it counts
    for (const key of PAGES.slice(1)) {
      await go(page, key);
      await page.waitForSelector('#view .counted', { timeout: 15000 }).catch(() => errors.push(`#${key} : pas de ligne « Compté : »`));
      await page.screenshot({ path: `${OUT}/${key}-mobile.png`, fullPage: true });
    }
    check(/pas tout le logement/.test(await page.locator('#offpeak-card .counted').innerText()), 'heures creuses : ne dit pas qu’elles ne comptent que les radiateurs et le chauffe-eau');
    // #301: a filter left on elsewhere is named on the tab
    await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.endsWith(':state'));
      if (k) localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k)), cat: 'water_heater' }));
    });
    await openDemo(page);
    await go(page, 'compteur');
    check(/Le filtre « Eau chaude » ne s'applique pas ici/.test(await page.locator('.periodbar .scope').innerText()), 'filtre Eau chaude non signalé sur le Compteur');
    await ctx.close();
  }

  // #439: leaving a page while a chart is still painting. zrender paints a layer of « incremental »
  // elements (ECharts 6.1 marks every heatmap cell so: « Par jour et par heure » of Journée type)
  // in slices of 15 ms, the next one in a requestAnimationFrame that dispose() does not cancel; on
  // a loaded CI runner a slice ran out, the page changed, and the next slice painted a disposed
  // chart: « Cannot read properties of null (reading 'layerStack') ». Made certain here: a clock
  // 20 ms later at every read, so each slice paints one cell and the heatmap is still painting
  // when the page changes.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const before = errors.length;
    page.on('pageerror', (e) => errors.push(`#439 : ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`#439 : ${m.text()}`));
    progress('graphique quitté pendant qu’il se peint (#439)');
    await openDemo(page);
    await go(page, 'compteur');
    await page.evaluate(() => {
      let t = Date.now();
      Date.now = () => (t += 20);
    });
    await page.evaluate(() => (location.hash = '#compteur-journee'));
    await page.waitForSelector('#hour-grid canvas', { timeout: 30000 });
    // the precondition: the heatmap paints on an incremental layer (a canvas of its own), unfinished
    check((await page.locator('#hour-grid canvas').count()) > 1, '#439 : la carte de chaleur n’a pas de calque incrémental, le test ne prouve plus rien');
    await go(page, 'compteur');
    // the slice that was due runs in the next frames
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r())))));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    check(errors.length === before, '#439 : erreur en quittant un graphique en cours de rendu');
    await ctx.close();
  }

  // 360 px phone, text at 200 %
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 1, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`360-200: ${e.message}`));
    await openDemo(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    for (const key of PAGES) {
      progress(`360 px, texte 200 % : ${key}`);
      await go(page, key);
      if (key === 'compteur-autres') await page.waitForSelector('#bd-parts .row', { timeout: 15000 });
      const out = await page.evaluate(() => {
        const found = [];
        if (document.documentElement.scrollWidth > window.innerWidth + 1) found.push(`page ${document.documentElement.scrollWidth}px`);
        for (const el of document.querySelectorAll('#view .seg button, #view .card-head, #view .legend, #view .list .row, #view .counted, #view .meter-big, #view .gauge')) {
          if (el.closest('details:not([open])') || el.closest('[hidden]')) continue;
          const r = el.getBoundingClientRect();
          if (r.width && r.right > window.innerWidth + 1) found.push(`${el.className || el.tagName} déborde (${Math.round(r.right)} px)`);
        }
        // « Veille » (was « Veille non attribuée (talon) » on 3 lines): one line
        for (const t of document.querySelectorAll('#bd-parts .row .t')) {
          const range = document.createRange();
          range.selectNodeContents(t);
          const lines = new Set([...range.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size;
          if (t.textContent === 'Veille' && lines > 1) found.push(`« Veille » sur ${lines} lignes`);
        }
        return found;
      });
      check(!out.length, `360 px, texte 200 %/${key} : ${out.slice(0, 5).join(', ')}`);
      await page.screenshot({ path: `${OUT}/compteur-texte200-${key}.png`, fullPage: true });
    }
    await audit(page, '360 px, texte 200 %/compteur-autres');
    await ctx.close();
  }

  // axe: light, dark, high contrast light and dark (7:1)
  for (const [name, opts, enhanced] of [
    ['clair', { colorScheme: 'light' }, false],
    ['sombre', { colorScheme: 'dark' }, false],
    ['contraste-clair', { colorScheme: 'light', contrast: 'more' }, true],
    ['contraste-sombre', { colorScheme: 'dark', contrast: 'more' }, true],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: 'block', ...opts });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await openDemo(page);
    for (const key of PAGES) {
      await go(page, key);
      if (key === 'compteur') await page.locator('#power-card details summary').click(); // the shedding table too
      await ready(page);
      await audit(page, `${name}/${key}`, enhanced);
    }
    await ctx.close();
  }
  await browser.close();
} catch (err) {
  errors.push(`compteur: ${err}`);
} finally {
  server.kill();
}
if (errors.length) {
  console.error(`${errors.length} problème(s) :\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('Compteur : OK');
