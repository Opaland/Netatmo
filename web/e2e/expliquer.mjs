// #337 « Expliquer un mois » and #346 rooms without reading, in the demo: the kitchen radiator
// switched off on purpose since 14 October 2025 (a wood stove, declared in ⚙ Mon logement) and the
// kids' bedroom out of reach since 5 November 2026. The link under the verdict of Accueil and the
// row of Outils, January 2026 explained (sentence, parts from 0 with the change of heating, rooms),
// « hors ligne » vs « arrêté (poêle) » in Accueil, Pièces, the room pages and État des données,
// the setting of Mon logement; axe in light, dark and high contrast, 360 px with the text at
// 200 % (no horizontal scroll).
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
const BEDROOM = /Chambre enfant : hors ligne depuis le 5 nov\. 2026/;
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

    // ---------------------------------------------------------------- Accueil: the room offline, the stove, the link under the verdict
    progress(`${name} : Accueil`);
    await go(page, 'accueil');
    // the room out of reach is said in the verdict that leaves it out, with what to do (#346,
    // #311), in the very phrase that says the scope of its figures (#383)
    const warn = (await page.locator('.verdict .verdict-warn').allInnerTexts()).join(' ');
    check(/^⚠ hors Chambre enfant, hors ligne depuis le 5 nov\. \(que faire \?\)$/.test(warn.trim()), `${name} : « hors ligne » absent du verdict (« ${warn} »)`);
    check(!/Cuisine/.test(warn), `${name} : la Cuisine, arrêtée volontairement, signalée hors ligne (« ${warn} »)`);
    // #383: the figures of the verdict add up, over one scope said in the sentence
    {
      const num = (s) => Number(s.replace(/[\s  ]/g, '').replace('−', '-'));
      const title = (await page.locator('#verdict-title').innerText()).trim();
      const said = (await page.locator('.verdict .verdict-sub').first().innerText()).replace(/\s+/g, ' ');
      const h = /^([\d\s  ]+) € de (moins|plus) que d'habitude$/.exec(title);
      const s = /^([\d\s  ]+) € \(([\d\s  ]+) kWh\) dépensés ⚠ hors Chambre enfant, hors ligne depuis le 5 nov\. \(que faire \?\), en novembre \(au 8\), pour ([\d\s  ]+) € attendus .*?\(([−+]?[\d\s  ]+) %\)/.exec(said);
      check(h && s, `${name} : verdict illisible (« ${title} » / « ${said.slice(0, 200)} »)`);
      if (h && s) {
        const gap = num(h[1]) * (h[2] === 'moins' ? -1 : 1);
        const [spent, expected, pct] = [num(s[1]), num(s[3]), num(s[4])];
        check(gap === spent - expected, `${name} : « ${title} » mais ${spent} € pour ${expected} € (#383)`);
        const lo = Math.floor(((spent - 0.5) / (expected + 0.5) - 1) * 100);
        const hi = Math.ceil(((spent + 0.5) / (expected - 0.5) - 1) * 100);
        check(pct >= lo && pct <= hi, `${name} : ${pct} % pour ${spent} € sur ${expected} € (#383)`);
      }
    }
    check((await page.locator('.verdict .verdict-warn a[href="#piece-r-ch2"]').count()) === 1, `${name} : « que faire ? » ne mène pas à la Chambre enfant`);
    const link = page.locator('.verdict a.verdict-link[href^="#outils-expliquer-"]');
    check((await link.count()) === 1, `${name} : lien « Pourquoi ? » absent sous le verdict`);
    const sub = await page.locator('.verdict').innerText();
    check(/Pourquoi \? \(poêle\)/.test(sub) && /dont le poêle \(Cuisine\)/.test((await link.textContent()) ?? ''), `${name} : le verdict n'attribue pas la baisse au poêle (« ${sub.slice(0, 300)} »)`);
    check((await wide(page)) <= 1, `${name} : défilement horizontal sur l'Accueil (${await wide(page)} px)`);

    // ---------------------------------------------------------------- the link opens the month shown
    progress(`${name} : Expliquer un mois`);
    const href = (await link.getAttribute('href')) ?? '';
    await link.click();
    await shown(page, href.slice(1));
    check((await page.locator('select[data-explain-month]').count()) === 1, `${name} : choix du mois absent`);
    check(BEDROOM.test(await page.locator('#view').innerText()), `${name} : la Chambre enfant hors ligne n'est pas signalée dans l'explication du mois`);

    // ---------------------------------------------------------------- January 2026, the owner's question
    await page.selectOption('select[data-explain-month]', '2026-01');
    await shown(page, 'outils-expliquer-2026-01');
    await page.waitForSelector('#explain-chart .cascade-row', { timeout: 15000 }).catch(() => errors.push(`${name} : cascade absente`));
    // short names on the chart, and no text over another text or a bar (360 px, text at 200 % included)
    const names = await page.locator('#explain-chart .cascade-label').allInnerTexts();
    check(names.join('|') === 'Météo|Consignes|Poêle|Pièces|Eau chaude|Autres', `${name} : libellés de la cascade (${names.join(' | ')})`);
    const clash = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('#explain-chart .cascade-label, #explain-chart .cascade-value, #explain-chart .cascade-track i')].map((e) => {
        const r = e.getBoundingClientRect();
        return { what: `${e.className || e.tagName} « ${e.textContent} »`, l: r.left, r: r.right, t: r.top, b: r.bottom, text: e.tagName !== 'I' };
      });
      const out = [];
      for (let i = 0; i < boxes.length; i++) {
        const a = boxes[i];
        if (a.text && (a.l < 0 || a.r > window.innerWidth)) out.push(`${a.what} hors de l'écran`);
        for (let j = i + 1; j < boxes.length; j++) {
          const b = boxes[j];
          if (!a.text && !b.text) continue;
          if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5) out.push(`${a.what} sur ${b.what}`);
        }
      }
      return out;
    });
    check(!clash.length, `${name} : cascade, textes superposés : ${clash.slice(0, 4).join(' ; ')}`);
    const sentence = await page.locator('#explain-sentence').innerText();
    check(/^En janvier 2026, le logement a consommé \d+ kWh de moins qu’en janvier 2025/.test(sentence), `${name} : phrase de synthèse inattendue (« ${sentence} »)`);
    check(/Surtout le poêle \(Cuisine\)/.test(sentence) && /plus froid/.test(sentence), `${name} : la synthèse ne cite ni le poêle ni la météo (« ${sentence} »)`);
    const steps = await page.locator('#explain-steps ul[aria-label="Écart par cause"] .row').allInnerTexts();
    const want = ['Météo', 'Températures demandées', 'Changement de mode de chauffage (poêle : Cuisine)', 'Pièces', 'Eau chaude', 'Autres usages']; // the full names, under the chart
    check(want.every((w, i) => steps[i]?.startsWith(w)), `${name} : parts de l'écart (${steps.map((s) => s.split('\n')[0]).join(' | ')})`);
    const scope = await page.locator('#view .periodbar .scope').innerText();
    check(/^Compté : tout le logement \(compteur Linky\), du 1er janv\. au 31 janv\. 2026, comparé aux mêmes jours de janvier 2025$/.test(scope), `${name} : ligne « Compté : » (« ${scope} »)`);
    // the parts are drawn from 0 (no zoomed axis): the summary gives both totals
    const aria = (await page.locator('#explain-chart').getAttribute('aria-label')) ?? '';
    check(/^Écart par cause, en kWh\. de [\d\s ]+ kWh \(janv\. 2025\) à [\d\s ]+ kWh \(janv\. 2026\)/.test(aria), `${name} : résumé de la cascade (« ${aria.slice(0, 160)} »)`);
    const view = await page.locator('#view').innerText();
    check(/Cuisine : radiateur arrêté depuis le 14 oct\. 2025 \(poêle\)/.test(view) && !/Cuisine : hors ligne/.test(view), `${name} : la Cuisine arrêtée n'est pas signalée comme telle dans l'explication`);
    check((await page.locator('#explain-rooms .row').count()) >= 5, `${name} : pièce par pièce incomplet`);
    check((await wide(page)) <= 1, `${name} : défilement horizontal sur « Expliquer un mois » (${await wide(page)} px)`);
    await audit(page, `${name}/expliquer`, enhanced);
    await page.screenshot({ path: `${OUT}/expliquer-${BROWSER}-${name}.png`, fullPage: true });

    // #394: October 2026 has two cuts in the incident log (14 Oct. power, 31 Oct. Internet): left out of both months
    if (name === 'clair' || big) {
      await page.evaluate(() => (location.hash = '#outils-expliquer-2026-10'));
      await shown(page, 'outils-expliquer-2026-10');
      const oct = await page.locator('#view .periodbar .scope').innerText();
      check(/sans le 14 oct\. \(coupure de courant\) ni le 31 oct\. \(coupure Internet\) : jours retirés des deux mois$/.test(oct), `${name} : octobre 2026 compte les jours de coupure (« ${oct} »)`);
      check((await wide(page)) <= 1, `${name} : défilement horizontal sur octobre 2026 (${await wide(page)} px)`);
    }

    // ---------------------------------------------------------------- Outils, Pièces and the room pages
    if (name === 'clair' || big) {
      await go(page, 'outils');
      check((await page.locator('#view a[href="#outils-expliquer"]').count()) === 1, `${name} : « Expliquer un mois » absent d'Outils`);
      // Historique: a month opens its explanation
      await go(page, 'historique');
      await page.locator('#explain-fold summary').click(); // #386: folded under the winter chart
      const jan = page.locator('#explain-links a[href="#outils-expliquer-2026-01"]');
      check((await jan.count()) === 1 && /Expliquer janv\. 2026 \(janvier 2026\)/.test((await jan.textContent()) ?? ''), `${name} : pas de lien « janv. 2026 » dans l'Historique`);
      await jan.click();
      await shown(page, 'outils-expliquer-2026-01');
      check((await page.locator('select[data-explain-month]').inputValue()) === '2026-01', `${name} : l'Historique n'ouvre pas janvier 2026`);
      await go(page, 'pieces');
      const list = await page.locator('#view ul[aria-label^="Pièces chauffées"]').innerText();
      check(/Chambre enfant[\s\S]*hors ligne depuis le 5 nov\. 2026/.test(list), `${name} : Pièces ne dit pas que la Chambre enfant est hors ligne`);
      check(new RegExp(`Cuisine[\\s\\S]*${STOVE.source}`).test(list), `${name} : Pièces ne dit pas que la Cuisine est arrêtée (poêle)`);
      check(!/Cuisine\s*\n?\s*0 (kWh|€)/.test(list), `${name} : la Cuisine affiche 0`);
      await go(page, 'piece-r-ch2');
      const p = await page.locator('#view').innerText();
      check(BEDROOM.test(p) && /non comparé/.test(p), `${name} : page Chambre enfant sans « hors ligne » ni comparaison écartée`);
      check((await wide(page)) <= 1, `${name} : défilement horizontal sur la page Chambre enfant (${await wide(page)} px)`);
      await audit(page, `${name}/chambre-enfant`, enhanced);
      await go(page, 'piece-r-cuisine');
      const k = await page.locator('#view').innerText();
      check(/Radiateur arrêté depuis le 14 oct\. 2025 \(poêle\)/.test(k) && /changement de mode de chauffage/.test(k) && !/hors ligne/.test(k), `${name} : page Cuisine sans « arrêté (poêle) » (« ${k.slice(0, 300)} »)`);
      await audit(page, `${name}/cuisine`, enhanced);
      await page.screenshot({ path: `${OUT}/expliquer-${BROWSER}-${name}-cuisine.png`, fullPage: true });

      // ---------------------------------------------------------------- État des données: no data expected, the year not degraded by it
      progress(`${name} : État des données`);
      await go(page, 'etat');
      await page.waitForSelector('#quality-sources', { timeout: 15000 });
      const etat = await page.locator('#view').innerText();
      check(/Cuisine : radiateur arrêté volontairement depuis le 14 oct\. 2025 \(chauffée par un poêle à bois\) : pas de données attendues/.test(etat), `${name} : État des données sans « arrêté volontairement : pas de données attendues »`);
      check(!/muette depuis le 14 oct\. 2025/.test(etat), `${name} : État des données compte la Cuisine comme muette`);
      // 2025 and 2026 (since the stove): never explained by the kitchen; 2024 has its own gap (two rooms)
      const years = (await page.locator('#quality-years .year-verdict').allInnerTexts()).slice(0, 2).join(' ');
      check(/^2026/.test(years) && /2025/.test(years) && !/Cuisine/.test(years), `${name} : 2025 ou 2026 expliquée par la Cuisine arrêtée (« ${years.replace(/\s+/g, ' ').slice(0, 300)} »)`);
      // État des appareils: the kitchen radiator is switched off on purpose, not « injoignable »
      await page.waitForSelector('#devices-card:not([hidden])', { timeout: 15000 });
      const dev = await page.locator('#devices-card').innerText();
      check(/Radiateur arrêté volontairement : Cuisine, depuis le 14 octobre 2025 \(chauffée par un poêle à bois\)/.test(dev), `${name} : État des appareils sans « radiateur arrêté volontairement » (« ${dev.slice(0, 300)} »)`);
      check(/ne répond plus : radiateur \(Chambre enfant\)/.test(dev) && !/radiateur \(Cuisine\) depuis/.test(dev), `${name} : État des appareils dit la Cuisine injoignable (« ${dev.slice(0, 300)} »)`);
      check((await wide(page)) <= 1, `${name} : défilement horizontal sur État des données (${await wide(page)} px)`);
      await audit(page, `${name}/etat`, enhanced);

      // ---------------------------------------------------------------- ⚙ Mon logement: declare the bedroom switched off, the alert goes
      progress(`${name} : Mon logement`);
      await go(page, 'parametres-logement');
      const card = page.locator('#stopped-card');
      check(/Cuisine/.test(await card.locator('ul[aria-label="Radiateurs arrêtés"]').innerText()), `${name} : la Cuisine n'est pas listée parmi les radiateurs arrêtés`);
      check(/Chambre enfant n’envoie plus rien depuis le 5 nov\. 2026/.test(await card.innerText()), `${name} : la Chambre enfant n'est pas proposée`);
      await audit(page, `${name}/logement`, enhanced);
      if (!big) {
        await page.selectOption('#stop-room', 'r-ch2');
        await page.selectOption('#stop-reason', 'inoccupee');
        await page.click('#stop-add');
        await page.waitForSelector('#stopped-card [data-stop-remove="r-ch2"]', { timeout: 10000 });
        await go(page, 'accueil');
        check(!/Chambre enfant, hors ligne/.test(await page.locator('.verdict').innerText()), `${name} : alerte toujours là après « arrêté volontairement »`);
        await go(page, 'parametres-logement');
        await page.click('#stopped-card [data-stop-remove="r-ch2"]');
        await page.waitForSelector('#stopped-card #stop-room option[value="r-ch2"]', { state: 'attached', timeout: 10000 });
        await go(page, 'accueil');
        check(/Chambre enfant, hors ligne/.test(await page.locator('.verdict').innerText()), `${name} : alerte absente après avoir retiré la Chambre enfant`);
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
