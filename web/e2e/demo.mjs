// S-1.9: visual smoke test of the demo, every page, light and dark, mobile and desktop.
// #308 / #309: the new navigation (tabs, ⚙, sub-pages, Back, simple view) and the settings centre.
// S-7.6: axe-core audit of every view (fails on "serious" or "critical"), keyboard route.
// S-7.7: high contrast (7:1 checked by axe), forced colours, system text at 200 % in simple mode.
// S-7.8, S-7.11, S-7.12: pinned room, swipe, offline.
// Run after `npm run build`: node e2e/demo.mjs  (starts `vite preview` itself; port: E2E_PORT).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices } from 'playwright';

const PORT = Number(process.env.E2E_PORT ?? 4179);
const OUT = process.env.E2E_OUT ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
// A port that already answers belongs to another server: never test someone else's build.
const busy = await fetch(`http://localhost:${PORT}/`).then(
  () => true,
  () => false,
);
if (busy) {
  console.error(`E2E : le port ${PORT} est déjà utilisé, définir E2E_PORT.`);
  process.exit(1);
}
// vite itself (not npx): kill() must stop the server, not only a wrapper.
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const base = `http://localhost:${PORT}/`;
// With --strictPort the server exits at once when the port is taken: never test someone else's build.
let serverExited = false;
server.on('exit', () => (serverExited = true));

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

const errors = [];
const check = (ok, msg) => ok || errors.push(msg);

/** axe-core on the current page: WCAG A/AA (and AAA contrast when asked), serious and critical only. */
const t0 = Date.now();
const progress = (s) => console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${s}`);

/**
 * #260: the view is drawn and every lazy card, document and chart it started has settled
 * (`#view[data-ready]`, set by src/ready.ts). Wait for it instead of a fixed delay, and before
 * checking that something is ABSENT (a lazy card that would come late must fail the test).
 */
const ready = (page, timeout = 30000) => page.waitForSelector('#view[data-ready]', { state: 'attached', timeout });
/** The next frame has been laid out (after a style change). */
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

async function audit(page, where, { enhanced = false } = {}) {
  progress(`axe ${where}`);
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', ...(enhanced ? ['wcag2aaa'] : [])];
  const builder = new AxeBuilder({ page }).withTags(tags);
  if (enhanced) builder.withRules(['color-contrast-enhanced']);
  const { violations } = await builder.analyze();
  for (const v of violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')) {
    const nodes = v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')}${n.failureSummary ? ` (${n.failureSummary.split('\n').slice(1).join(' ').trim()})` : ''}`);
    errors.push(`${where} : axe ${v.impact} « ${v.id} » ${v.help} → ${nodes.join(' | ')}${v.nodes.length > 3 ? ` (+${v.nodes.length - 3})` : ''}`);
  }
}

async function openDemo(page) {
  await page.goto(base);
  await page.click('#demo');
  await page.waitForSelector('header.top', { timeout: 30000 });
}
/**
 * #308: open a page by its address: a click on its tab when it has one, else the address bar
 * (as a shared link or the Back button would). Waits for that page to be drawn and settled.
 */
async function go(page, key) {
  const tab = page.locator(`.tabs [data-view="${key}"]`);
  if (await tab.count()) await tab.click();
  else await page.evaluate((k) => (location.hash = `#${k}`), key);
  await page.waitForSelector(`#view[data-page="${key}"][data-ready]`, { state: 'attached', timeout: 30000 });
}

/** Keyboard only: tabs, charts, ⚙ and a sub-page (title focused, Escape goes back) (S-7.6, #308). */
async function keyboard(page, name) {
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      const cs = el ? getComputedStyle(el) : null;
      return {
        view: el?.getAttribute('data-view') ?? null,
        id: el?.id ?? '',
        chart: !!el?.classList.contains('chart'),
        label: el?.getAttribute('aria-label') ?? '',
        outline: cs ? cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 : false,
      };
    });
  await go(page, 'accueil');
  await page.evaluate(() => document.activeElement?.blur());
  let f;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    f = await focused();
    if (f.view === 'historique') break;
  }
  check(f?.view === 'historique', `${name}/clavier : l'onglet « Historique » n'est pas atteignable au clavier`);
  check(f?.outline, `${name}/clavier : focus invisible sur l'onglet`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.tabs [data-view=historique][aria-current=page]');
  await ready(page);
  check((await focused()).view === 'historique', `${name}/clavier : le focus quitte l'onglet ouvert`);
  let charts = 0;
  for (let i = 0; i < 120 && charts < 2; i++) {
    await page.keyboard.press('Tab');
    f = await focused();
    if (f.chart) {
      charts++;
      check(f.outline, `${name}/clavier : focus invisible sur un graphique`);
      check(/\d/.test(f.label) && f.label.length > 30, `${name}/clavier : graphique sans résumé (« ${f.label} »)`);
    }
  }
  check(charts >= 2, `${name}/clavier : graphiques non atteignables au clavier`);
  // ⚙ then a settings page: each sub-page puts the focus on its title
  await page.focus('.top [data-view=parametres]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#view[data-page=parametres][data-ready]', { state: 'attached' });
  check((await focused()).id === 'page-title', `${name}/clavier : le titre de Paramètres ne reçoit pas le focus`);
  await page.focus('#view a[href="#parametres-contrat"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#view[data-page=parametres-contrat][data-ready]', { state: 'attached' });
  check((await focused()).id === 'page-title', `${name}/clavier : le titre de « Contrat et prix » ne reçoit pas le focus`);
  // #256: typing a price then Tab goes on to the next field (the page is redrawn around it).
  if (await page.locator('[data-pmode=manual]').count()) {
    await page.check('[data-pmode=manual]');
    await ready(page);
    check(
      await page.evaluate(() => document.activeElement?.getAttribute('data-pmode') === 'manual'),
      `${name}/clavier : le focus est perdu après le choix du mode de prix`,
    );
  }
  const order = await page.locator('[data-price]').evaluateAll((els) => els.map((e) => e.getAttribute('data-price')));
  await page.fill('[data-price=base]', '0.2516');
  await page.keyboard.press('Tab');
  await ready(page);
  const next = await page.evaluate(() => document.activeElement?.getAttribute('data-price') ?? document.activeElement?.tagName);
  check(next === order[1], `${name}/clavier : après un prix et Tab, le focus est sur « ${next} » au lieu de « ${order[1]} »`);
  check(/0[.,]2516/.test(await page.inputValue('[data-price=base]')), `${name}/clavier : le prix saisi n'est pas gardé`);
  // back to the official tariffs and no manual price, for the following checks
  await page.fill('[data-price=base]', '');
  await page.keyboard.press('Tab');
  await ready(page);
  if (await page.locator('[data-pmode=trve]').count()) {
    await page.check('[data-pmode=trve]');
    await ready(page);
  }
  // Escape on a sub-page (nothing open) goes back to its parent
  await page.focus('#page-title');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#view[data-page=parametres]', { state: 'attached', timeout: 5000 }).catch(() => errors.push(`${name}/clavier : Échap ne revient pas à Paramètres`));
  await ready(page);
}

/** Synthetic touch swipe (pointer events, as a finger would send them). */
async function swipe(page, selector, dx) {
  await page.evaluate(
    ({ selector, dx }) => {
      const el = document.querySelector(selector);
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const opts = (cx) => ({ bubbles: true, pointerType: 'touch', pointerId: 7, clientX: cx, clientY: y, isPrimary: true });
      el.dispatchEvent(new PointerEvent('pointerdown', opts(x)));
      el.dispatchEvent(new PointerEvent('pointerup', opts(x + dx)));
    },
    { selector, dx },
  );
  await ready(page);
}

let failed = false;

// S-8.9: every CSP violation (Trusted Types included) is recorded in the page and fails the run.
const recordViolations = () => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) =>
    window.__csp.push(`${e.violatedDirective} ${e.blockedURI || ''} ${(e.sample || '').slice(0, 60)}`.trim()),
  );
};
const checkViolations = async (page, where) => {
  for (const v of await page.evaluate(() => window.__csp ?? [])) errors.push(`${where}: violation CSP ${v}`);
};
try {
  await waitForServer();
  const browser = await chromium.launch();
  for (const [name, opts] of [
    ['mobile-clair', { ...devices['iPhone 13'] }],
    ['mobile-sombre', { ...devices['Pixel 7'], colorScheme: 'dark' }],
    ['bureau', { viewport: { width: 1280, height: 900 } }],
    // smallest common Android width: only the tab bar and the comfort view (five tabs must fit)
    ['mobile-360', { viewport: { width: 360, height: 740 }, hasTouch: true }],
  ]) {
    const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 1, acceptDownloads: true });
    await ctx.addInitScript(recordViolations);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
    await page.goto(base);
    await page.waitForSelector('#demo');
    await audit(page, `${name}/verrou`);
    await page.click('#demo');
    await page.waitForSelector('.kpi', { timeout: 30000 });
    for (const view of name === 'mobile-360' ? [] : ['accueil', 'pieces', 'historique', 'compteur', 'outils', 'parametres']) {
      await go(page, view);
      if (view === 'compteur') {
        // Linky 30-min load curve card (lazy module + lazy documents)
        try {
          await page.waitForSelector('#curve-day-chart canvas', { timeout: 15000 });
          const talon = await page.locator('#curve-talon').innerText();
          if (!/\d\s?W/.test(talon)) errors.push(`${name}/compteur: talon de veille absent (${talon})`);
          if ((await page.locator('#curve-card canvas').count()) < 2) errors.push(`${name}/compteur: courbe de charge incomplète`);
        } catch (err) {
          errors.push(`${name}/compteur: carte « Courbe de charge » non rendue (${err})`);
        }
        // S-4.12 / S-1.17: other usages split into Shelly plugs, declared appliances, talon
        try {
          await page.waitForSelector('#bd-chart canvas', { timeout: 15000 });
          const text = await page.locator('#breakdown-card').innerText();
          for (const want of ['Réfrigérateur', 'Lave-linge', 'Veille non attribuée', 'Non attribué', 'non exploitable sans hub']) {
            if (!text.includes(want)) errors.push(`${name}/compteur: décomposition sans « ${want} »`);
          }
          await page.fill('#bd-form [name=name]', 'Box internet');
          await page.fill('#bd-form [name=watts]', '12');
          await page.fill('#bd-form [name=hours]', '24');
          await page.click('#bd-form button[type=submit]');
          await page.waitForSelector('[data-bd-remove]', { timeout: 5000 });
          if (!(await page.locator('#breakdown-card').innerText()).includes('Box internet'))
            errors.push(`${name}/compteur: poste saisi absent de la décomposition`);
          await page.click('[data-bd-remove]');
        } catch (err) {
          errors.push(`${name}/compteur: carte « Autres usages en détail » non rendue (${err})`);
        }
        // S-13.6: load shedding per room next to the Linky peak (lazy module + room states)
        try {
          await page.waitForSelector('#offload-zone:not([hidden]) table', { timeout: 15000 });
          if (!/Pic Linky moyen/.test(await page.locator('#offload-summary').innerText())) errors.push(`${name}/compteur: délestage sans pic Linky`);
        } catch (err) {
          errors.push(`${name}/compteur: délestage par pièce non rendu (${err})`);
        }
      }
      if (view === 'historique') {
        // S-3.7: indoor − outdoor signature (lazy module)
        try {
          await page.waitForSelector('#indoor-sig-chart canvas', { timeout: 15000 });
        } catch (err) {
          errors.push(`${name}/historique: signature intérieur − extérieur non rendue (${err})`);
        }
        // S-13.3: open windows as a possible explanation of the unusual days
        try {
          await page.waitForFunction(() => {
            const t = document.querySelector('#unusual-card')?.textContent ?? '';
            return t.includes('Explication possible') && !document.querySelector('#unusual-card td:last-child')?.textContent?.includes('…');
          }, null, { timeout: 15000 });
        } catch (err) {
          errors.push(`${name}/historique: explication des jours inhabituels absente (${err})`);
        }
      }
      const charts = await page.locator('.chart canvas').count();
      if (!charts && !['outils', 'parametres'].includes(view)) errors.push(`${name}/${view}: aucun graphique rendu`);
      // Tooltip (ECharts) shown then hidden: goes through the Trusted Types policy.
      if (charts && !opts.isMobile) {
        const canvas = page.locator('.chart canvas').first();
        const { width, height } = (await canvas.boundingBox()) ?? { width: 0, height: 0 };
        await canvas.hover({ position: { x: width * 0.6, y: height * 0.6 } });
        // the tooltip goes through the Trusted Types policy; only the Accueil chart is sure to show one there
        const tip = await page.waitForSelector('.tt', { state: 'attached', timeout: view === 'accueil' ? 5000 : 1000 }).catch(() => null);
        if (view === 'accueil' && !tip) errors.push(`${name}/${view}: infobulle ECharts absente`);
        await page.mouse.move(0, 0);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      await checkViolations(page, `${name}/${view}`);
      await page.screenshot({ path: `${OUT}/${name}-${view}.png`, fullPage: true });
      await audit(page, `${name}/${view}`);
    }
    if (name !== 'mobile-360') {
      // the tools moved out of Comparer and Analyse (#308), each on its own page of Outils
      await go(page, 'outils');
      await page.click('#view a[href="#outils-voiture"]');
      await page.waitForSelector('#view[data-page=outils-voiture]', { state: 'attached' });
      // S-2.14: EV charging simulator (lazy module), costs per offer and peaks on the Linky curve
      try {
        await page.waitForSelector('#ev-card #ev-result table', { timeout: 15000 });
        await page.waitForSelector('#ev-peak h3', { timeout: 15000 });
        const ev = await page.locator('#ev-card').innerText();
        if (!/Avec la voiture/.test(ev) || !/demi-heure/.test(ev) || !/Comment c'est calculé/.test(ev)) errors.push(`${name}/outils-voiture: simulation de recharge incomplète`);
      } catch (err) {
        errors.push(`${name}/outils-voiture: simulation de recharge non rendue (${err})`);
      }
      // S-2.15: heat pump estimate (lazy module)
      await go(page, 'outils-pac');
      try {
        await page.waitForSelector('#hp-card #hp-result table', { timeout: 15000 });
        const hp = await page.locator('#hp-card').innerText();
        if (!/pas une étude thermique/.test(hp) || !/France Rénov/.test(hp)) errors.push(`${name}/outils-pac: carte PAC sans avertissement ni lien France Rénov'`);
        await page.selectOption('#hp-mode', 'curve');
        await page.waitForFunction(() => /COP saisonnier/.test(document.querySelector('#hp-result')?.textContent ?? ''));
        await page.selectOption('#hp-mode', 'scop');
      } catch (err) {
        errors.push(`${name}/outils-pac: estimation pompe à chaleur non rendue (${err})`);
      }
      // S-13.4: absences confirmed by the setpoint mode; S-13.6: contactor of the water heater
      await go(page, 'outils-absences');
      try {
        await page.waitForSelector('#absence-card', { timeout: 15000 });
        if (!(await page.locator('#absence-card').textContent()).includes('confirmée par le mode de consigne')) errors.push(`${name}/outils-absences: absence confirmée par le mode de consigne absente`);
      } catch (err) {
        errors.push(`${name}/outils-absences: absences confirmées non rendues (${err})`);
      }
      await go(page, 'chauffe-eau');
      await page.waitForSelector('#contactor-line:not([hidden])', { timeout: 15000 }).catch((err) => errors.push(`${name}/chauffe-eau: contacteur non rendu (${err})`));
      await go(page, 'outils-analyse');
      if (!(await page.locator('#insight-card .insight-usage').count())) errors.push(`${name}/outils-analyse: carte IA (S-5.8) non rendue`);
      // S-1.10: lost days rebuilt apart, on demand (lazy module), in État des données (header pill)
      await page.click('.top .status-pill');
      await page.waitForSelector('#view[data-page=etat][data-ready]', { state: 'attached' });
      try {
        await page.check('[data-recon]');
        await page.waitForSelector('#recon-chart canvas', { timeout: 15000 });
        if (!(await page.getByText('Jours suspects').count())) errors.push(`${name}/etat: jours suspects absents`);
      } catch (err) {
        errors.push(`${name}/etat: reconstitution non rendue (${err})`);
      }
      await ready(page);
      await page.screenshot({ path: `${OUT}/${name}-etat.png`, fullPage: true });
      await audit(page, `${name}/etat`);
    }
    if (name === 'bureau') {
      try {
        // S-9.6: « volets fermés » card (lazy module) in Outils → Journaux
        await go(page, 'outils-volets');
        await page.waitForSelector('#shutters-card', { timeout: 10000 });
        // S-12.2 (v1.5): the household view is opt-in; real per-room figures by default, the
        // switch of ⚙ Affichage merges the bedrooms (display only: same total), detail on demand until the lock
        const picker = async () => (await go(page, 'pieces'), page.locator('.rooms-panel').textContent());
        const total = async () => (await go(page, 'accueil'), page.locator('.period-total strong').first().textContent());
        const display = () => go(page, 'parametres-affichage');
        if (!(await picker()).includes('Chambre parentale') || (await picker()).includes('Chambres')) errors.push('vue foyer : active par défaut (doit être désactivée)');
        const before = await total();
        await display();
        await page.check('[data-toggle=household]');
        await ready(page);
        if (!(await picker()).includes('Chambres') || (await picker()).includes('Chambre parentale')) errors.push('vue foyer : chambres non regroupées');
        if ((await total()) !== before) errors.push(`vue foyer : total changé par le regroupement (${before} → ${await total()})`);
        await display();
        await page.click('[data-household=reveal]');
        if (!(await picker()).includes('Chambre parentale')) errors.push('vue foyer : détail non affiché');
        await display();
        await page.click('[data-household=hide]');
        await ready(page);
        await page.uncheck('[data-toggle=household]');
        if (!(await picker()).includes('Chambre parentale')) errors.push('vue foyer : désactivation sans effet');
        await page.screenshot({ path: `${OUT}/${name}-pieces.png`, fullPage: true });
        // S-8.14: « Cadre juridique » from ⚙ À propos (lazy module)
        await go(page, 'parametres-apropos');
        await page.click('#legal-open');
        await page.waitForSelector('#legal-card .legal-list', { timeout: 10000 });
        await page.screenshot({ path: `${OUT}/${name}-juridique.png`, fullPage: true });
      } catch (err) {
        errors.push(`${name}: vue foyer / volets / cadre juridique (${err})`);
      }
    }
    // S-11 / S-3.8: Air et confort (lazy chunk), bedroom detail on a deliberate gesture, other threshold
    await go(page, 'pieces');
    await page.click('#view a[href="#confort"]');
    await page.waitForSelector('#cold-chart canvas', { timeout: 15000 });
    await page.click('[data-comfort=show-bedrooms]');
    await page.waitForSelector('#co2-0 canvas');
    await page.selectOption('select[data-comfort=threshold]', '18');
    await page.waitForFunction(() => !document.querySelector('#view td.num')?.closest('table')?.textContent?.includes('…'), null, { timeout: 15000 });
    await ready(page);
    for (const id of ['co2-0', 'cellar-0', 'cold-chart', 'probe-0']) {
      if (!(await page.locator(`#${id} canvas`).count())) errors.push(`${name}/confort: graphique ${id} absent`);
    }
    if (!(await page.getByText('Heures sous 18,0 °C').count())) errors.push(`${name}/confort: seuil 18 °C non appliqué`);
    // E13 (S-13.3): open windows per room (lazy document), signature without the window days
    try {
      await page.waitForSelector('#windows-chart canvas', { timeout: 15000 });
      if (!(await page.getByText('Pourquoi cette pièce était froide ?').count())) errors.push(`${name}/confort: question « pièce froide » absente`);
      await page.check('[data-windows=exclude]');
      await page.waitForSelector('#windows-signature', { timeout: 5000 });
      if (!/jours? exclus?/.test(await page.locator('#windows-signature').innerText())) errors.push(`${name}/confort: signature sans les jours fenêtre ouverte absente`);
    } catch (err) {
      errors.push(`${name}/confort: carte « Fenêtres ouvertes » non rendue (${err})`);
    }
    // S-1.18: Home Assistant import, agreement between the window contact and open_window
    try {
      await page.waitForSelector('#ha-card table', { timeout: 15000 });
      const ha = await page.locator('#ha-card').innerText();
      for (const want of ['Fenêtre bureau', 'prise_frigo', 'Accord sur']) if (!ha.includes(want)) errors.push(`${name}/confort: Home Assistant sans « ${want} »`);
      await page.selectOption('select[data-ha-room]', '');
      await page.waitForFunction(() => document.querySelector('#ha-card')?.textContent?.includes('Choisissez la pièce'), null, { timeout: 5000 });
      await page.selectOption('select[data-ha-room]', 'r-bureau');
      await page.waitForFunction(() => document.querySelector('#ha-card')?.textContent?.includes('Accord sur'), null, { timeout: 5000 });
    } catch (err) {
      errors.push(`${name}/confort: carte Home Assistant non rendue (${err})`);
    }
    const overflow = await page.evaluate(() => {
      const t = document.querySelector('.tabs');
      return t ? t.scrollWidth > t.clientWidth + 1 : false;
    });
    if (overflow) errors.push(`${name}: barre d'onglets plus large que l'écran`);
    await page.screenshot({ path: `${OUT}/${name}-confort.png`, fullPage: true });
    await page.selectOption('select[data-comfort=threshold]', '19');
    await ready(page);
    // #308: the back arrow of a sub-page returns to its tab
    await page.click('.subhead .back');
    await page.waitForSelector('#view[data-page=pieces]', { state: 'attached', timeout: 5000 }).catch(() => errors.push(`${name}: la flèche retour d'Air et confort ne revient pas à Pièces`));

    await go(page, 'outils');
    await page.click('#view a[href="#rapport"]');
    await page.waitForSelector('.report');
    // S-6.3: offer comparator and maximum power in the annual report (lazy module)
    try {
      await page.waitForSelector('#report-offers table', { timeout: 15000 });
      await page.waitForSelector('#report-pmax table', { timeout: 15000 });
    } catch (err) {
      errors.push(`${name}/rapport: comparateur ou pic de puissance absent (${err})`);
    }
    await page.screenshot({ path: `${OUT}/${name}-report.png`, fullPage: true });
    // S-5.9: a canned question answered by code (Outils → Questions types)
    await go(page, 'outils-questions');
    await page.click('[data-question=normal]');
    await page.waitForSelector('.question-answer li', { timeout: 5000 });
    // S-13.3: « pourquoi cette pièce était froide ? » (room states loaded on demand)
    await page.click('[data-question=cold]');
    try {
      await page.waitForFunction(() => /sous 19 °C/.test(document.querySelector('.question-answer')?.textContent ?? ''), null, { timeout: 10000 });
    } catch (err) {
      errors.push(`${name}/rapport: question « pièce froide » sans réponse (${err})`);
    }
    await page.click('[data-question=normal]');
    await page.waitForSelector('.question-answer li', { timeout: 5000 });
    await page.screenshot({ path: `${OUT}/${name}-questions.png`, fullPage: true });
    await go(page, 'rapport');
    // S-6.4: anonymised report, without any room or home name of the demo
    const roomNames = await page.locator('#report-waterfall ~ .table-wrap').first().locator('tbody td:first-child').allInnerTexts();
    const homeName = (await page.locator('.top h1').innerText()).replace(/\s*démo$/i, '').trim();
    if (roomNames.length < 2) errors.push(`${name}/rapport: tableau des pièces introuvable`);
    await page.click('#report-anon');
    await page.waitForSelector('.anon-report #anon-chart canvas', { timeout: 15000 });
    const anon = await page.locator('.anon-report').innerText();
    for (const secret of [homeName, ...roomNames.filter((n) => !/^chauffe-eau$/i.test(n.trim()))]) {
      if (anon.includes(secret)) errors.push(`${name}/anonymisé: « ${secret} » apparaît`);
    }
    if (!/Pièce A/.test(anon) || !/Période/.test(anon)) errors.push(`${name}/anonymisé: pseudonymes ou période absents`);
    await page.screenshot({ path: `${OUT}/${name}-report-anonymise.png`, fullPage: true });
    await audit(page, `${name}/rapport`);
    // S-9.7: long export, generated in the page (Outils → Exporter mes données)
    if (name === 'bureau') {
      await go(page, 'outils-exports');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-long=csv]')]);
      const head = readFileSync(await dl.path(), 'utf8').split('\n')[0];
      if (head !== 'date,source,entity,metric,value,unit') errors.push(`export long : en-tête inattendu (${head})`);
      if (!/^energie-long-v1-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename())) errors.push(`export long : nom ${dl.suggestedFilename()}`);
      await audit(page, `${name}/outils-exports`);
    }
    // #309: the settings centre, one page per subject
    for (const p of ['contrat', 'logement', 'sources', 'objectifs', 'affichage', 'foyer', 'securite', 'apropos']) {
      await go(page, `parametres-${p}`);
      await audit(page, `${name}/parametres-${p}`);
      if (name === 'bureau' || p === 'contrat') await page.screenshot({ path: `${OUT}/${name}-parametres-${p}.png`, fullPage: true });
    }
    // S-12.6 tenant mode (⚙ Foyer), S-12.5 prolonged cold alert (⚙ Objectifs) (lazy cards)
    try {
      await go(page, 'parametres-objectifs');
      await page.waitForSelector('#cold-card [data-cold-room]', { timeout: 15000 });
      await page.locator('#cold-card [data-cold-room]').first().check();
      await page.waitForSelector('#cold-card td:text-is("Pièce A")', { timeout: 5000 });
      if (!/pas un dispositif de sécurité/.test(await page.locator('#cold-card').innerText())) errors.push(`${name}/objectifs: avertissement « pas un dispositif de sécurité » absent`);
      await go(page, 'parametres-foyer');
      await page.waitForSelector('#tenant-card #tenant-on', { timeout: 15000 });
    } catch (err) {
      errors.push(`${name}/parametres: cartes locataire ou alerte froid non rendues (${err})`);
    }
    // v1.5: state of the devices (station battery, gateway, Intuis contract, Shelly clamps)
    try {
      await go(page, 'parametres-sources');
      await page.waitForSelector('#devices-card [data-shelly-role]', { timeout: 15000 });
      const text = await page.locator('#devices-card').innerText();
      for (const want of [/Pile faible/, /Intuis indique/, /Redémarrée 1 fois/, /Heure du pic/]) if (!want.test(text)) errors.push(`${name}/sources: état des appareils sans ${want}`);
    } catch (err) {
      errors.push(`${name}/sources: carte « État des appareils » non rendue (${err})`);
    }
    await page.screenshot({ path: `${OUT}/${name}-settings.png`, fullPage: true }); // S-7.14: inventaire
    // S-12.3: invite a member of the household: a QR code of the address, never the passphrase
    try {
      await go(page, 'parametres-foyer');
      await page.click('#invite-open');
      await page.waitForSelector('#invite-card svg.qr', { timeout: 10000 });
      const invite = await page.locator('#invite-card').innerText();
      if (!invite.includes(`${base}#installer`)) errors.push(`${name}/invitation: adresse attendue absente`);
      if (/phrase de passe\s*:\s*\S|demo\b/.test(invite.replace(base, ''))) errors.push(`${name}/invitation: la phrase de passe semble affichée`);
      if (name === 'bureau') {
        await audit(page, `${name}/invitation`);
        await page.screenshot({ path: `${OUT}/${name}-invitation.png`, fullPage: true });
      }
    } catch (err) {
      errors.push(`${name}/invitation: QR code non rendu (${err})`);
    }
    if (name === 'bureau') {
      // S-12.6: tenant mode hides the comparator and the Compteur tab, costs at the average price, lease report
      await go(page, 'parametres-foyer');
      await page.check('#tenant-on');
      await page.waitForSelector('#tenant-price');
      await page.fill('#tenant-price', '0.25');
      await page.locator('#tenant-price').blur();
      await ready(page);
      await page.fill('#tenant-from', '2024-07-01');
      await page.locator('#tenant-from').blur();
      await ready(page);
      if (await page.locator('.tabs [data-view=compteur]').count()) errors.push('locataire : onglet Compteur encore affiché');
      await go(page, 'outils');
      if (!/Mode locataire/.test(await page.locator('#view').innerText())) errors.push("locataire : ligne d'explication absente dans Outils");
      if (await page.locator('#view a[href="#outils-offres"], #view a[href="#outils-voiture"]').count()) errors.push('locataire : comparateur ou recharge encore proposés');
      await go(page, 'outils-offres');
      if (await page.locator('#offers-chart').count()) errors.push('locataire : comparateur encore affiché');
      if (!(await page.locator('.tenant-note').count())) errors.push("locataire : phrase d'explication absente du comparateur");
      await audit(page, 'locataire/outils-offres');
      await page.evaluate(() => (location.hash = '#compteur'));
      await page.waitForSelector('#view[data-page=outils][data-ready]', { state: 'attached' }).catch(() => errors.push('locataire : l’adresse #compteur ne mène pas à Outils'));
      await go(page, 'accueil');
      if (await page.locator('#linky-chart, #curve-card').count()) errors.push('locataire : cartes Linky encore affichées');
      if (!/€/.test(await page.locator('.kpis').innerText())) errors.push('locataire : coûts absents malgré le prix moyen');
      await go(page, 'rapport');
      await page.click('#report-anon');
      await page.waitForSelector('.anon-report #anon-chart canvas', { timeout: 15000 });
      const lease = await page.locator('.anon-report').innerText();
      if (!/période du bail/i.test(lease) || !/1er juillet 2024/.test(lease)) errors.push('locataire : le rapport anonymisé ne couvre pas le bail');
      await page.screenshot({ path: `${OUT}/${name}-locataire-rapport.png`, fullPage: true });
      await audit(page, 'locataire/rapport');
      await go(page, 'parametres-foyer');
      await page.waitForSelector('#tenant-on');
      await page.uncheck('#tenant-on');
      await ready(page);
    }

    if (name === 'bureau') await keyboard(page, name);

    if (name === 'mobile-clair') {
      // S-7.11: swipe on the header changes the period (Accueil), on the tab bar the tab.
      await go(page, 'accueil');
      const period = () => page.$eval('select[data-set=period]', (s) => s.value);
      const before = await period();
      await swipe(page, '.top .title', 120);
      const older = await period();
      check(older !== before, `${name}/glisser : la période ne change pas (${before})`);
      await swipe(page, '.top .title', -120);
      check((await period()) === before, `${name}/glisser : retour impossible à la période ${before}`);
      await swipe(page, '.tabs', -120);
      check(await page.locator('.tabs [data-view=pieces][aria-current=page]').count(), `${name}/glisser : l'onglet ne change pas`);
      check(/Pièces/.test(await page.textContent('#sr-status')), `${name}/glisser : changement non annoncé`);

      // S-7.8 + S-7.7 + #316: pinned room in the simple view, its 3 tabs, system text at 200 %, nothing cut.
      await go(page, 'parametres-affichage');
      const room = await page.$eval('select[data-pin] option:nth-child(2)', (o) => o.value);
      await page.selectOption('select[data-pin]', room);
      await ready(page);
      await page.check('[data-toggle=simple]');
      await ready(page);
      await go(page, 'accueil');
      await page.waitForSelector('body.simple-nav');
      check((await page.locator('.tabs a').count()) === 3, `${name}/vue simple : barre de 3 onglets attendue`);
      // #316: the pinned room comes right after the verdict of the month
      check((await page.locator('#view .proche-room').count()) === 1, `${name}/épingle : pièce épinglée absente du mode simple`);
      // S-7.13: plain language and glossary terms, read aloud when touched.
      check(/vous consommez/.test(await page.textContent('.proche-strong')), `${name}/FALC : verdict non réécrit`);
      check(!/N-1/.test(await page.textContent('#view')), `${name}/FALC : sigle N-1 en mode simple`);
      await page.click('.glossary [data-term=dju]');
      check(await page.locator('.glossary [data-term=dju][aria-expanded=true] + .term-def:visible').count(), `${name}/FALC : définition non affichée`);
      check(/degrés-jours/.test(await page.textContent('#sr-status')), `${name}/FALC : définition non annoncée`);
      await audit(page, `${name}/vue-simple`);
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await nextFrame(page);
      const cut = await page.evaluate(() => {
        const out = [];
        if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`page ${document.documentElement.scrollWidth}px > ${window.innerWidth}px`);
        for (const el of document.querySelectorAll('.top *, .tabs *, #view .card, #view .card *')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('details:not([open]) > :not(summary)') || el.classList.contains('sr-only')) continue;
          if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && cs.overflowX !== 'visible') out.push(el.className || el.tagName);
          const r = el.getBoundingClientRect();
          if (r.width && r.right > window.innerWidth + 1) out.push(`${el.className || el.tagName} déborde (${Math.round(r.right)}px)`);
        }
        return out;
      });
      check(!cut.length, `${name}/texte 200 % : texte tronqué ou débordant → ${cut.slice(0, 5).join(', ')}`);
      await page.screenshot({ path: `${OUT}/${name}-simple-200.png`, fullPage: true });
      // « Ma pièce » opens the pinned room; « Voir plus de détails » leaves the simple view after a confirmation
      await page.click('.tabs a:nth-child(2)');
      await page.waitForSelector(`#view[data-page="piece-${room}"][data-ready]`, { state: 'attached' }).catch(() => errors.push(`${name}/vue simple : « Ma pièce » n'ouvre pas la pièce épinglée`));
      await go(page, 'accueil');
      await page.click('[data-simple-exit=ask]');
      check((await page.locator('.tabs a').count()) === 3, `${name}/vue simple : quittée sans confirmation`);
      await page.click('[data-simple-exit=yes]');
      await page.waitForFunction(() => document.querySelectorAll('.tabs a').length === 5, null, { timeout: 5000 }).catch(() => errors.push(`${name}/vue simple : « Voir plus de détails » ne la quitte pas`));
      await ready(page);
    }
    await checkViolations(page, `${name}/rapport+parametres`);
    if (name === 'bureau') {
      // S-12.3: the invited member lands on the lock screen with the installation help open
      await page.goto('about:blank');
      await page.goto(`${base}#installer`);
      await page.waitForSelector('#install-help[open]', { timeout: 10000 }).catch(() => errors.push('invitation : aide d\'installation non ouverte'));
      const help = await page.locator('#install-help').innerText();
      if (!/iPhone/.test(help) || !/Android/.test(help)) errors.push('invitation : aide iPhone / Android absente');
      await audit(page, `${name}/verrou-invitation`);
    }
    await ctx.close();
  }

  // #319: 360 px phone, system text at 200 %, normal mode: no horizontal page scroll, segments
  // wrap, nothing sticks out of the screen, and axe still passes (WCAG 1.4.4, 1.4.10).
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`360-200: ${e.message}`));
    await openDemo(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    for (const view of ['accueil', 'pieces', 'historique', 'compteur', 'outils', 'confort', 'parametres', 'parametres-contrat', 'parametres-affichage']) {
      progress(`360 px, texte 200 % : ${view}`);
      await go(page, view);
      await nextFrame(page);
      const out = await page.evaluate(() => {
        const found = [];
        if (document.documentElement.scrollWidth > window.innerWidth + 1) found.push(`page ${document.documentElement.scrollWidth}px > ${window.innerWidth}px`);
        for (const el of document.querySelectorAll('#view .seg, #view .seg button, #view .controls, #view .card-head, #view .kpi, #view .chip, #view .verdict, #view .share-legend, #view .list .row, .top > *, .tabs a, .tabs a span, .subhead')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || el.closest('details:not([open])') || el.closest('[hidden]')) continue;
          const r = el.getBoundingClientRect();
          if (r.width && r.right > window.innerWidth + 1) found.push(`${el.className || el.tagName} déborde (${Math.round(r.right)} px)`);
          if (el.matches('.seg button, .tabs a span') && el.scrollWidth > el.clientWidth + 1) found.push(`« ${el.textContent} » coupé`);
          // #308: each tab keeps a 44 px target
          if (el.matches('.tabs a') && (r.height < 44 || r.width < 44)) found.push(`onglet « ${el.textContent} » trop petit (${Math.round(r.width)} × ${Math.round(r.height)} px)`);
        }
        return found;
      });
      check(!out.length, `360 px, texte 200 %/${view} : ${out.slice(0, 5).join(', ')}`);
      await page.screenshot({ path: `${OUT}/mobile360-texte200-${view}.png`, fullPage: true });
      if (['accueil', 'historique', 'outils', 'parametres-contrat'].includes(view)) await audit(page, `360 px, texte 200 %/${view}`);
    }
    await ctx.close();
  }

  // S-7.7: high contrast (axe checks the enhanced 7:1 ratio) and forced colours, light and dark.
  for (const [name, opts] of [
    ['contraste-clair', { viewport: { width: 1280, height: 900 }, contrast: 'more' }],
    ['contraste-sombre', { ...devices['Pixel 7'], colorScheme: 'dark', contrast: 'more' }],
    ['couleurs-forcees', { viewport: { width: 1280, height: 900 }, forcedColors: 'active' }],
  ]) {
    const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 1 });
    await ctx.addInitScript(recordViolations);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await openDemo(page);
    // S-7.8: pinned room in simple mode under Trusted Types (insertAdjacentHTML path).
    await go(page, 'parametres-affichage');
    await page.selectOption('select[data-pin]', { index: 1 });
    await ready(page);
    await page.check('[data-toggle=simple]');
    await ready(page);
    await go(page, 'accueil');
    await page.waitForSelector('#view .proche-room');
    await audit(page, `${name}/vue-simple`, { enhanced: name !== 'couleurs-forcees' });
    await go(page, 'parametres-affichage');
    await page.uncheck('[data-toggle=simple]');
    await ready(page);
    await checkViolations(page, `${name}/épingle`);
    for (const view of ['accueil', 'historique', 'outils', 'parametres', 'parametres-contrat']) {
      await go(page, view);
      await page.screenshot({ path: `${OUT}/${name}-${view}.png`, fullPage: true });
      await audit(page, `${name}/${view}`, { enhanced: name !== 'couleurs-forcees' });
    }
    // S-7.14: captures of the other pages for the design inventory (7:1 audited on the pages above).
    for (const view of ['pieces', 'compteur', 'confort']) {
      await go(page, view);
      await page.screenshot({ path: `${OUT}/${name}-${view}.png`, fullPage: true });
    }
    await ctx.close();
  }

  // S-7.12: once visited, the demo opens offline, with a banner instead of errors.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`hors-ligne: ${e.message}`));
    await page.goto(base);
    progress('hors ligne : installation du service worker');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((r) => {
          navigator.serviceWorker.addEventListener('controllerchange', r, { once: true });
          setTimeout(r, 10000);
        });
      }
    });
    await openDemo(page); // through the service worker: files are cached
    await go(page, 'compteur');
    await page.waitForSelector('#hour-grid canvas', { timeout: 20000 });
    await ctx.setOffline(true);
    progress('hors ligne : ouverture de la démo');
    await openDemo(page).catch(async (e) => {
      throw new Error(`hors-ligne : la démo ne s'ouvre pas (${(await page.textContent('#app'))?.slice(0, 200)}) ${e.message.split('\n')[0]}`);
    });
    await page.waitForSelector('#net-status:not([hidden])', { timeout: 5000 });
    const banner = await page.textContent('#net-status');
    check(/Hors ligne/.test(banner) && /profil horaire compris/.test(banner), `hors-ligne : bandeau inattendu « ${banner} »`);
    await go(page, 'compteur');
    await page.waitForSelector('#hour-grid canvas', { timeout: 20000 }).catch(() => errors.push('hors-ligne : profil horaire absent'));
    await page.screenshot({ path: `${OUT}/hors-ligne-compteur.png`, fullPage: true });
    await ctx.close();
  }
  // v1.5 life cycle (#247, #255, #232): household view toggled while the Synthèse cards load,
  // no hourly file downloaded again by the toggle, then lock and reopen: everything is drawn again.
  {
    progress('cycle de vie : vue foyer pendant le chargement, verrouillage, réouverture');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript(recordViolations);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`cycle de vie: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`cycle de vie: ${m.text()}`));
    let hourlyRequests = 0;
    page.on('request', (r) => /\.hourly\.enc\.json$/.test(r.url()) && hourlyRequests++);
    try {
      await openDemo(page);
      await page.evaluate(() => (location.hash = '#compteur'));
      await page.waitForSelector('#curve-card');
      // at once, before the load curve and the hourly data arrive (#247)
      await page.evaluate(() => (location.hash = '#parametres-affichage'));
      await page.check('[data-toggle=household]');
      await go(page, 'compteur');
      await page.waitForSelector('#curve-day-chart canvas', { timeout: 20000 });
      await page.waitForSelector('#bd-chart canvas', { timeout: 20000 });
      const talon = await page.locator('#curve-talon').innerText();
      check(/\d\s?W/.test(talon), `cycle de vie : talon de veille absent après la bascule (${talon})`);
      await page.waitForSelector('#hour-grid canvas', { timeout: 20000 });
      await ready(page); // offline prefetch (idle callback) included
      const before = hourlyRequests;
      for (let i = 0; i < 2; i++) {
        await go(page, 'parametres-affichage');
        await page.click('[data-toggle=household]');
        await go(page, 'compteur');
        await page.waitForSelector('#hour-grid canvas', { timeout: 20000 });
      }
      await ready(page);
      check(hourlyRequests === before, `cycle de vie : la bascule de la vue foyer a retéléchargé ${hourlyRequests - before} fichier(s) horaire(s) (#255)`);
      // lock (« Quitter la démo »), then reopen: the views draw again from a clean slate
      await go(page, 'parametres');
      await page.click('#lock');
      await page.waitForSelector('#demo', { timeout: 10000 });
      check(!(await page.locator('header.top').count()), 'cycle de vie : l’appli reste affichée après le verrouillage');
      await page.click('#demo');
      await page.waitForSelector('header.top', { timeout: 30000 });
      await go(page, 'compteur');
      await page.waitForSelector('#curve-day-chart canvas', { timeout: 20000 }).catch(() => errors.push('cycle de vie : courbe de charge absente après réouverture'));
      await page.waitForSelector('#hour-grid canvas', { timeout: 20000 }).catch(() => errors.push('cycle de vie : profil horaire absent après réouverture'));
      await go(page, 'confort');
      await page.waitForSelector('#cold-chart canvas', { timeout: 20000 }).catch(() => errors.push('cycle de vie : vue Confort absente après réouverture'));
      await checkViolations(page, 'cycle de vie');
    } catch (err) {
      errors.push(`cycle de vie : ${err}`);
    }
    await ctx.close();
  }
  // #249: a lazy card that cannot load offline says so and offers to try again (never vanishes).
  {
    progress('carte différée hors ligne');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript(recordViolations);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`carte hors ligne: ${e.message}`));
    try {
      await openDemo(page);
      await go(page, 'accueil');
      await page.waitForSelector('.kpi');
      await ctx.setOffline(true);
      await page.evaluate(() => (location.hash = '#outils-volets'));
      const failed = page.locator('#shutters-zone .lazy-failed');
      await failed.waitFor({ timeout: 15000 });
      const text = await failed.innerText();
      check(/indisponible hors connexion/.test(text) && /Réessayer/.test(text), `carte hors ligne : message inattendu « ${text} »`);
      await audit(page, 'carte-hors-ligne');
      await checkViolations(page, 'carte hors ligne');
      // back online: the browser keeps the failed module until a reload, the card says so
      await ctx.setOffline(false);
      // (#308: Outils → Volets loads no document that would redraw the page when the network comes back:
      // the « Réessayer » button itself sees that the module failed offline and reloads the page)
      await page.waitForSelector('#shutters-zone [data-lazy-retry]', { timeout: 15000 });
      await Promise.all([page.waitForEvent('load'), page.click('#shutters-zone [data-lazy-retry]')]);
      await openDemo(page);
      await go(page, 'outils-volets');
      await page.waitForSelector('#shutters-card', { timeout: 15000 }).catch(() => errors.push('carte hors ligne : la carte ne revient pas après rechargement'));
    } catch (err) {
      errors.push(`carte hors ligne : ${err}`);
    }
    await ctx.close();
  }
  // #254: while a passphrase is being checked, the demo button cannot start a second unlock.
  {
    progress('déverrouillage unique');
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route('**/data/keyinfo.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iter: 600000 }) }));
    await ctx.route('**/data/meta.enc.json', async (r) => {
      await new Promise((res) => setTimeout(res, 1500));
      await r.fulfill({ status: 404, body: '' });
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`déverrouillage: ${e.message}`));
    try {
      await page.goto(base);
      await page.fill('#pass', 'une phrase quelconque');
      await page.click('#unlock button.primary');
      await page.waitForFunction(() => document.querySelector('.lock .error')?.textContent === 'Déchiffrement…');
      check(await page.isDisabled('#demo'), 'déverrouillage : le bouton de démo reste cliquable pendant le déchiffrement');
      await page.waitForSelector('#pass:not([disabled])', { timeout: 15000 });
      check(!(await page.locator('header.top').count()), 'déverrouillage : un jeu de données s’est ouvert');
    } catch (err) {
      errors.push(`déverrouillage : ${err}`);
    }
    await ctx.close();
  }
  // S-8.9: Trusted Types enforced (a raw string is refused) and libsodium still works under it.
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(recordViolations);
    const page = await ctx.newPage();
    await page.goto(base);
    await page.waitForSelector('#demo');
    const raw = await page.evaluate(() => {
      try {
        document.body.insertAdjacentHTML('beforeend', '<b>brut</b>');
        return 'accepté';
      } catch (e) {
        return e.name;
      }
    });
    if (raw !== 'TypeError') errors.push(`Trusted Types non appliqué : innerHTML brut ${raw}`);
    const seen = await page.evaluate(() => window.__csp);
    if (!seen.some((v) => v.startsWith('require-trusted-types-for'))) errors.push('Trusted Types : aucune violation signalée pour un innerHTML brut');
    const sodium = readdirSync('dist/assets').find((f) => f.startsWith('libsodium-wrappers-') && f.endsWith('.js'));
    const sealed = await page.evaluate(async (path) => {
      const { default: s } = await import(path);
      await s.ready;
      const kp = s.crypto_box_keypair();
      return s.crypto_box_seal(s.from_string('test'), kp.publicKey).length;
    }, `./assets/${sodium}`);
    if (sealed !== 4 + 48) errors.push(`libsodium sous Trusted Types : scellement inattendu (${sealed})`);
    await ctx.close();
  }
  // #237: inside another page's frame, neither the unlock form nor the demo is rendered.
  {
    progress('anti-clickjacking');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<!doctype html><title>cadre</title><iframe src="${base}" width="800" height="600"></iframe>`);
    const frame = await page.waitForSelector('iframe').then((el) => el.contentFrame());
    await frame.waitForSelector('#framed', { timeout: 15000 }).catch(() => errors.push('cadre : message « ouvrir directement » absent'));
    if (await frame.locator('#unlock, #pass, #demo').count()) errors.push('cadre : l’écran de déverrouillage est rendu dans un iframe');
    await ctx.close();
  }
  await browser.close();
} catch (err) {
  errors.push(String(err));
} finally {
  server.kill();
}
if (errors.length) {
  failed = true;
  console.error(errors.join('\n'));
}
console.log(failed ? 'E2E : ÉCHEC' : 'E2E : OK (captures dans ' + OUT + ')');
process.exit(failed ? 1 : 0);
