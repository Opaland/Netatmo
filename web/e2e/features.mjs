// v1.4 checks, on Chromium (job e2e) and on WebKit (job e2e-webkit, S-7.9: Safari iOS):
// - S-7.9: the five tabs of the demo render on an iPhone; a remembered key erased by the
//   browser is explained on the lock screen (« … a effacé la clé, vos données sont intactes »);
// - S-2.3: an invoice is reconciled and the gap explained (Synthèse);
// - S-6.2: a works marker gives the signature before / after and kWh/m² (Analyse);
// - S-6.6: the research export is anonymised (no name, no real date) and carries its licence.
// Run after `npm run build`: node e2e/features.mjs   (E2E_BROWSER=webkit|chromium, port E2E_PORT)
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices, webkit } from 'playwright';

const BROWSER = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const PORT = Number(process.env.E2E_PORT ?? 4181);
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
const check = (ok, msg) => ok || errors.push(`${BROWSER}: ${msg}`);
const t0 = Date.now();
const progress = (s) => console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${BROWSER} ${s}`);

/**
 * #260: the view is drawn and every lazy card, document and chart it started has settled
 * (`#view[data-ready]`, set by src/ready.ts). Wait for it instead of a fixed delay, and before
 * checking that something is ABSENT (a lazy card that would come late must fail the test).
 */
const ready = (page, timeout = 30000) => page.waitForSelector('#view[data-ready]', { state: 'attached', timeout });

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

/**
 * #308: every card of v1.5 at its new place (docs/design/architecture-cible.md § 3): each page is
 * opened and must show the listed elements. « text: » checks a sentence of the page instead.
 */
const DESTINATIONS = {
  // #311: period, verdict and its gauge, 3 tiles, alerts, what counted, consumption and cold, AI summary
  accueil: ['.periodbar [data-set=home]', '.periodbar .scope', '.verdict .gauge', '.home-tiles .kpi', '#grid-card .alert', '#counted-card .list .row', 'text:Poêle à bois (Cuisine)', '#home-chart canvas', '#insight-card .md', 'a[href="#historique"]'],
  pieces: ['.periodbar [data-set=pieces]', '#pieces-compare .counted', '.rooms-picker', '#rooms-chart canvas', 'a[href="#confort"]', 'a[href="#chauffe-eau"]'],
  // #386: winter against winter and « en détail » on the tab, the rest in its sub-pages, each card saying what it counts
  // #394: the cut days of the incident log, said under « Consommation en détail » and in its chart's summary
  historique: ['#cmp-chart canvas', '#cmp-card .card-period', '#cmp-card .counted', '#explore-card #main-chart canvas', '#explore-card #cut-note', '#main-chart[aria-label*="Jours de coupure"]', '#explore-card [data-set=cat]', '#explore-card [data-set=gran]', '#explore-card .counted', '#history-more a[href="#historique-froid"]'],
  'historique-annees': ['#years-card table', '#years-card .card-period', '#years-card .counted', '#years-card button.term[data-term=dju]', 'text:Totaux par année'],
  'historique-changements': ['#rooms-waterfall canvas', '#changes-card .card-period', '#changes-card .counted'],
  'historique-froid': ['#sig-chart canvas', '#sig-card .counted', '#sig-wind table', 'text:Le vent explique', '#indoor-sig-chart canvas'],
  'historique-jours': ['#unusual-card .card-period', '#unusual-card .counted'],
  'historique-calendrier': ['#cal-chart canvas', '#calendar-card .card-period', '#calendar-card .counted'],
  'historique-station': ['#station-chart canvas', '#station-table table'],
  'historique-flambees': ['#fires-card [data-fire-day]', '#fires-card .fires-grid', '#fires-card [data-fire-answer=yes]', 'text:Confiance'], // #469
  // #301: part of the usages, maximum power (shedding in « Voir les valeurs »), then the detail pages
  compteur: ['#linky-chart canvas', '#pmax-chart canvas', '#offload-zone table', '#share-card .counted', '#power-card .counted', 'a[href="#compteur-veille"]', 'a[href="#compteur-heures-creuses"]'],
  'compteur-journee': ['#curve-typical canvas', '#curve-day-chart canvas', '#hour-grid canvas', '#curve-card .counted'],
  'compteur-veille': ['#standby-card .counted', 'text:en permanence'],
  'compteur-autres': ['#bd-parts .row', '#breakdown-card .counted'],
  'compteur-heures-creuses': ['#offpeak-chart canvas', '#offpeak-card .counted', 'text:Heures pleines / creuses'],
  confort: ['#pressure-card table', 'text:bruyante', '#cold-chart canvas', '#windows-chart canvas', '#ha-card table', '#cellar-0 canvas', '#probe-0 canvas'],
  'chauffe-eau': ['#wh-month-chart canvas', '#contactor-line:not([hidden])'],
  etat: ['#quality', '.status-list', '#devices-card a[href="#parametres-sources"]', '#quality-years .year-verdict', '#incidents .incident-list li', 'text:h sans Internet', 'text:coupure de courant', '#quality-sources [data-source=heating] .gaps li', '#quality-sources [data-source=station]', '#quality-fine [data-source=linky30]', '#quality-fine [data-source=room30]', 'text:Année par année'],
  rapport: ['.report .kpis', '#report-offers table'],
  'outils-offres': ['#offers-chart canvas'],
  'outils-voiture': ['#ev-card #ev-result table'],
  'outils-pac': ['#hp-card #hp-result table'],
  // #356: production profile, result per size (prices of the contract offered), amiante, hypotheses
  'outils-solaire': ['#solar-card #solar-profile strong', '#solar-result h3', '#solar-result .list .row', '.sim-note', 'text:amiante', 'text:Hypothèses de ce résultat', 'text:pilotage avant la batterie'],
  // #453: the water heater's year, the three options (COP offered as an assumption), legionella under 55 °C not shown by default
  'outils-thermodynamique': ['#hw-card #hw-result .list .row', '.sim-note', 'text:Hypothèses de ce résultat', 'text:Un chauffe-eau thermodynamique', 'text:proposé, non saisi', 'text:de moins par an'], // #499: a saving, not a negative cost
  outils: ['a[href="#etat"] .swatch', 'a[href="#outils-offres"] .s', 'a[href="#parametres-securite"]', 'text:Sauvegarde chiffrée'],
  'outils-consigne': ['#setpoint-card #sp-result', '.sim-note', 'text:Simulation'],
  'outils-teletravail': ['#telework-card'],
  'outils-facture': ['#invoice-card #inv-add'],
  'outils-absences': ['#absence-card'],
  'outils-volets': ['#shutters-card', '#shutters-auto table', 'text:Relevé automatique', '#shutters-result'],
  'outils-analyse': ['#insight-card .insight-usage'],
  'outils-questions': ['#questions-card [data-question]'],
  'outils-exports': ['#export', '[data-export-long=csv]', '[data-export-long=json]', '[data-research]', '#backup'],
  'parametres-contrat': ['[data-pmode]', '#contract-share'],
  // #366: the stove's wood (demo: three purchases, two seasons), on Accueil too (winter against winter: e2e/expliquer.mjs)
  'parametres-logement': ['#wood-card [aria-label="Bois par saison"] .row', '#wood-card #wood-add', '#works-card [data-works-surface]', 'a[href="#compteur-autres"]', '#location-card #loc-edit', 'text:Commune d'],
  'parametres-sources': ['.status-list', '#gh-login', '#devices-card [data-shelly-role]'],
  'parametres-objectifs': ['#money-card #budget-input', '#co2-input', '[data-threshold]', '#cold-card [data-cold-room]'],
  'parametres-affichage': ['[data-set=theme]', '[data-toggle=simple]', 'select[data-pin]', '[data-toggle=household]'],
  'parametres-foyer': ['#invite-open', '#tenant-card #tenant-on'],
  'parametres-securite': ['select[data-lock-after]', '#backup', '#lock'],
  'parametres-apropos': ['#legal-open', '#build-info', 'text:Ce qui est public'],
};

async function audit(page, where) {
  progress(`axe ${where}`);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  for (const v of violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')) {
    const nodes = v.nodes.slice(0, 3).map((n) => n.target.join(' '));
    errors.push(`${BROWSER} ${where} : axe ${v.impact} « ${v.id} » ${v.help} → ${nodes.join(' | ')}`);
  }
}

/** #311: the amounts of the tiles (every page, components.ts tile()) stay on one line and inside their tile. */
const tileAmounts = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#view .kpis .kpi-value')].flatMap((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
      const tile = el.closest('.kpi').getBoundingClientRect();
      const box = range.getBoundingClientRect();
      const out = [];
      if (lines.size > 1) out.push(`« ${el.textContent} » sur ${lines.size} lignes`);
      if (box.right > tile.right + 1 || box.left < tile.left - 1) out.push(`« ${el.textContent} » sort de sa tuile`);
      return out;
    }),
  );

const recordViolations = () => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${(e.sample || '').slice(0, 60)}`.trim()));
};
const checkViolations = async (page, where) => {
  for (const v of await page.evaluate(() => window.__csp ?? [])) errors.push(`${BROWSER} ${where}: violation CSP ${v}`);
};

/** Previous full month of the demo, from the date input bounds. */
function previousMonth(max) {
  const [y, m] = max.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const mm = String(pm).padStart(2, '0');
  return [`${py}-${mm}-01`, `${py}-${mm}-${last}`];
}

try {
  await waitForServer();
  const engine = BROWSER === 'webkit' ? webkit : chromium;
  const browser = await engine.launch();
  const iphone = { ...devices['iPhone 13'], deviceScaleFactor: 1 };

  // ---------------------------------------------------------------- S-7.9: key erased by the browser
  {
    const ctx = await browser.newContext(iphone);
    await ctx.route('**/data/keyinfo.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iter: 1000 }) }));
    await ctx.addInitScript(() => {
      if (!sessionStorage.getItem('e2e-marked')) {
        sessionStorage.setItem('e2e-marked', '1');
        localStorage.setItem('intuis-history:remembered', JSON.stringify({ source: 'data', at: Date.now() - 3 * 86400000 }));
      }
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${BROWSER} éviction: ${e.message}`));
    await page.goto(base);
    await page.waitForSelector('#pass', { timeout: 15000 });
    const notice = await page.locator('#lock-notice p').innerText().catch(() => '');
    check(/^iOS a effacé la clé, vos données sont intactes/.test(notice), `éviction : message attendu sur iPhone, lu « ${notice} »`);
    await page.screenshot({ path: `${OUT}/${BROWSER}-cle-effacee.png`, fullPage: true });
    await audit(page, 'verrou-cle-effacee');
    await page.reload();
    await page.waitForSelector('#pass');
    check(!(await page.locator('#lock-notice').count()), 'éviction : le message revient après rechargement');
    await ctx.close();
  }

  // ---------------------------------------------------------------- #334 / #335: session under /Netatmo/
  // Served under a sub-path like GitHub Pages (the storage names depend on it, #229): the demo
  // files answer as real data (passphrase « demo »). The legacy names are migrated once; with
  // « Rester connecté » a reload keeps the app open; a tab left alone does not log out the tab
  // in use; after the inactivity delay it locks and says why. Fake clock (Playwright).
  {
    progress('session sous /Netatmo/');
    const sub = `${base}Netatmo/`;
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.clock.install();
    await ctx.route('**/Netatmo/**', async (r) => {
      const rest = new URL(r.request().url()).pathname.slice('/Netatmo/'.length);
      const url = rest.startsWith('data/') ? `${base}demo/${rest.slice(5)}` : `${base}${rest}`;
      await r.fulfill({ response: await r.fetch({ url }) });
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${BROWSER} session: ${e.message}`));
    const locked = (p) => p.locator('#pass').count().then(Boolean);
    try {
      // names of v1.4 (before #229), on the same origin
      await page.goto(base);
      await page.waitForSelector('#demo');
      await page.evaluate(
        () =>
          new Promise((res) => {
            localStorage.setItem('intuis-history:remembered', JSON.stringify({ source: 'data', at: Date.now() }));
            localStorage.setItem('intuis-history:state', JSON.stringify({ comfortThreshold: 18 }));
            const req = indexedDB.open('intuis-history', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('keys');
            req.onsuccess = () => (req.result.close(), res());
            req.onerror = () => res();
          }),
      );
      await page.goto(sub);
      await page.waitForSelector('#pass', { timeout: 15000 });
      const ls = (k) => page.evaluate((k) => localStorage.getItem(k), k);
      const dbs = () => page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : null));
      check((await ls('intuis-history@Netatmo:migrated')) === '1', 'migration : marque absente');
      check((await ls('intuis-history:remembered')) === null, 'migration : ancienne marque de clé gardée');
      check(JSON.parse((await ls('intuis-history@Netatmo:state')) ?? '{}').comfortThreshold === 18, 'migration : préférences non reprises');
      await page.waitForFunction(async () => !indexedDB.databases || !(await indexedDB.databases()).some((d) => d.name === 'intuis-history'), null, { timeout: 5000 }).catch(() => errors.push(`${BROWSER} migration : ancienne base IndexedDB gardée`));

      // #335: show / hide the passphrase
      const toggle = page.locator('#unlock .reveal');
      check((await toggle.getAttribute('aria-pressed')) === 'false', 'afficher : aria-pressed absent');
      check(/Afficher la phrase de passe/.test(await toggle.innerText().catch(() => '')) || /Afficher la phrase de passe/.test((await toggle.getAttribute('title')) ?? ''), 'afficher : libellé absent');
      const box = await toggle.boundingBox();
      check(box && box.width >= 44 && box.height >= 44, `afficher : cible de ${box?.width}×${box?.height} px`);
      await page.fill('#pass', 'phrase fausse');
      await toggle.click();
      check((await page.getAttribute('#pass', 'type')) === 'text' && (await toggle.getAttribute('aria-pressed')) === 'true', 'afficher : la phrase reste masquée');
      check((await page.getAttribute('#pass', 'autocomplete')) === 'off', 'afficher : autocomplétion gardée sur le champ en clair');
      await audit(page, 'verrou-phrase-affichee');
      await page.click('#unlock button.primary');
      check((await page.getAttribute('#pass', 'type')) === 'password', 'afficher : la phrase reste en clair après validation');
      await page.waitForFunction(() => document.querySelector('#lock-msg')?.textContent === 'Phrase de passe incorrecte.', null, { timeout: 30000 });
      check((await page.getAttribute('#pass', 'autocomplete')) === 'current-password', 'afficher : autocomplete non rétabli');

      // #334: « Rester connecté », then reload
      await page.fill('#pass', 'demo');
      check(await page.isChecked('#remember'), '« Rester connecté » non coché par défaut');
      await page.click('#unlock button.primary');
      await ready(page, 60000);
      await page.evaluate(() => localStorage.setItem('intuis-history:sentinelle', '1'));
      for (let i = 0; i < 2; i++) {
        await page.reload();
        await page.waitForSelector('#pass, #view[data-ready]', { state: 'attached', timeout: 60000 });
        check(!(await locked(page)), `rechargement ${i + 1} : la phrase de passe est redemandée`);
      }
      check((await ls('intuis-history:sentinelle')) === '1', 'migration : rejouée au rechargement');
      check((await dbs())?.includes('intuis-history@Netatmo') ?? true, 'clé mémorisée : base IndexedDB absente');

      // a second tab in use, this one left alone: nobody is logged out
      const other = await ctx.newPage();
      await other.goto(sub);
      await ready(other, 60000);
      for (let i = 0; i < 17; i++) {
        await ctx.clock.runFor(60_000);
        await other.keyboard.press('Shift');
      }
      check(!(await locked(page)), 'onglet laissé seul verrouillé alors qu’un autre est utilisé');
      await other.reload();
      await other.waitForSelector('#pass, #view[data-ready]', { state: 'attached', timeout: 60000 });
      check(!(await locked(other)), 'onglet utilisé : déconnecté au rechargement à cause de l’onglet laissé seul');

      // nobody for 15 min: locked, and the lock screen says why (also after a reload)
      await ctx.clock.runFor(16 * 60_000);
      for (const p of [other, page]) {
        await p.waitForSelector('#lock-notice', { timeout: 15000 }).catch(() => {});
        const n = await p.locator('#lock-notice p').innerText().catch(() => '');
        check(/^Verrouillé après 15 min sans activité/.test(n), `inactivité : message attendu, lu « ${n} »`);
      }
      await other.reload();
      await other.waitForSelector('#pass', { timeout: 15000 });
      check(/sans activité/.test(await other.locator('#lock-notice p').innerText().catch(() => '')), 'inactivité : message perdu au rechargement');
      await other.screenshot({ path: `${OUT}/${BROWSER}-verrou-inactivite.png`, fullPage: true });
      await audit(other, 'verrou-inactivite');
    } catch (err) {
      errors.push(`${BROWSER} session : ${err}`);
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- #301: a selection kept from the last visit
  progress('sélection gardée');
  for (const answer of ['Réinitialiser', 'Garder']) {
    const c = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    // the last visit chose « Eau chaude » (set once: the app saves the state again afterwards)
    await c.addInitScript(() => {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('intuis-history:state', JSON.stringify({ cat: 'water_heater' }));
    });
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(`${BROWSER} sélection gardée: ${e.message}`));
    await p.goto(base);
    await p.click('#demo');
    await ready(p);
    const banner = p.locator('.kept-filter');
    check((await banner.count()) === 1 && /Eau chaude/.test(await banner.innerText()), `#301 : pas de rappel de la sélection gardée au démarrage (${await p.locator('#view').getAttribute('data-page')})`);
    await go(p, 'historique');
    check((await banner.count()) === 1, '#301 : le rappel de la sélection gardée disparaît en changeant de page');
    await p.getByRole('button', { name: answer, exact: true }).click();
    await ready(p);
    check((await banner.count()) === 0, `#301 : le rappel reste après « ${answer} »`);
    const chip = await p.locator('#view .filter-chip').count();
    check(answer === 'Réinitialiser' ? chip === 0 : chip === 1, `#301 : « ${answer} » ${answer === 'Réinitialiser' ? 'garde' : 'retire'} la sélection`);
    if (answer === 'Garder') {
      await go(p, 'accueil');
      check((await banner.count()) === 0, '#301 : le rappel revient après « Garder »');
    }
    await c.close();
  }

  // ---------------------------------------------------------------- demo on an iPhone
  const ctx = await browser.newContext({ ...iphone, acceptDownloads: true });
  await ctx.addInitScript(recordViolations);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${BROWSER}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${BROWSER} console: ${m.text()}`));
  await page.goto(base);
  await page.click('#demo');
  await page.waitForSelector('.kpi', { timeout: 30000 });
  await go(page, 'pieces');
  const roomNames = (await page.locator('.rooms-panel label').allInnerTexts()).map((t) => t.split('\n')[0].replace(/\s*(Chauffage|Chauffe-eau)\s*$/, '').trim());
  const homeName = (await page.locator('.top .home-name').innerText()).replace(/\s*démo$/i, '').trim();
  check(roomNames.length >= 3, `pièces introuvables (${roomNames.join(', ')})`);

  // S-7.9: the five views
  for (const view of ['accueil', 'pieces', 'historique', 'compteur', 'confort']) {
    progress(`page ${view}`);
    await go(page, view);
    try {
      await page.waitForSelector(view === 'confort' ? '#cold-chart canvas' : '#view .chart canvas', { timeout: 20000 });
    } catch {
      errors.push(`${BROWSER}/${view}: aucun graphique rendu`);
    }
    await ready(page);
    await page.screenshot({ path: `${OUT}/${BROWSER}-iphone-${view}.png`, fullPage: true });
    await checkViolations(page, view);
  }

  // #387: État des données, a verdict per source and the detail folded, holds in 4 screens
  progress('état des données');
  {
    await go(page, 'etat');
    const [h, screenH] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]);
    check(h <= 4 * screenH, `#387 : État des données fait ${h} px, plus de 4 écrans (${4 * screenH} px)`);
  }

  // #311 / #302: Accueil holds in 3 iPhone screens; one period for the screen, each comparison named
  progress('accueil');
  {
    await go(page, 'accueil');
    const [h, screenH] = await page.evaluate(() => [document.documentElement.scrollHeight, window.screen.height]);
    check(h <= 3 * screenH, `#311 : l'Accueil fait ${h} px, plus de 3 écrans (${3 * screenH} px)`);
    const tiles = await page.locator('.home-tiles').innerText();
    check(/vs nov\. \d{4} au \d+/.test(tiles) && /vs attendu à météo comparable/.test(tiles), `#302 : tuile du mois sans ses deux références nommées (« ${tiles.replace(/\s+/g, ' ').slice(0, 200)} »)`);
    const verdictText = await page.locator('.verdict').innerText();
    check(/attendus à météo comparable/.test(verdictText), '#302 : verdict sans sa référence');
    // #433: the demo's Cuisine is heated by a stove, with three fictitious purchases: the verdict
    // compares the heating electricity + wood, and says so
    check(/\d\s€ d’électricité \+ bois \(\d+\skWh\)/.test(verdictText), `#433 : verdict sans « électricité + bois » (« ${verdictText.replace(/\s+/g, ' ').slice(0, 160)} »)`);
    check(!/N-1/.test(await page.locator('#view').innerText()), '#302 : « N-1 » encore affiché');
    for (const [p, want] of [['season', /^Saison de chauffe/], ['12m', /^12 derniers mois/], ['year', /^Année \d{4}/], ['month', /^[A-Z][a-zéû]+ \d{4}, du 1er au/]]) {
      await page.click(`.periodbar [data-value="${p}"]`);
      await ready(page);
      const scope = await page.locator('.periodbar .scope').innerText();
      check(want.test(scope) && /hors abonnement/.test(scope), `#311 : ligne « ce qui est compté » inattendue pour ${p} (« ${scope} »)`);
      check((await page.locator('#home-chart canvas').count()) === 1, `#311 : graphique absent pour ${p}`);
    }
    const cut = await tileAmounts(page);
    check(!cut.length, `#311 : montant de tuile coupé (iPhone 13) → ${cut.join(', ')}`);
    await audit(page, 'accueil');
  }

  // #386: Historique holds in 4 iPhone screens, one question per page, no technical term left
  progress('historique');
  {
    await go(page, 'historique');
    const [h, screenH] = await page.evaluate(() => [document.documentElement.scrollHeight, window.screen.height]);
    check(h <= 4 * screenH, `#386 : l'Historique fait ${h} px, plus de 4 écrans (${4 * screenH} px)`);
    const subs = await page.locator('#history-more a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    check(subs.length >= 5, `#386 : « Pour aller plus loin » n'a que ${subs.length} sous-pages`);
    for (const route of ['historique', ...subs.map((s) => s.slice(1))]) {
      await go(page, route);
      const text = await page.locator('#view').innerText();
      const jargon = text.match(/\bDJU\b|\b[Pp]entes?\b|[Ss]ignature|\bsuspect\b|\bseuil\b/g);
      check(!jargon, `#386 : terme technique visible dans ${route} → ${[...new Set(jargon ?? [])].join(', ')}`);
      // #299 / #301: every card of the page says its period and what it counts
      const cards = await page.locator('#view section.card:not(#history-more)').evaluateAll((cs) =>
        cs.filter((c) => c.querySelector('.chart, table')).map((c) => [c.querySelector('h2')?.textContent ?? '?', !!c.querySelector('.card-period'), !!c.querySelector('.counted')]),
      );
      for (const [title, period, counted] of cards) check(period && counted, `#299/#301 : ${route} « ${title} » sans ${period ? '' : 'période '}${counted ? '' : '« Compté : »'}`);
    }
    // #466: every total read as « the heating » says what it counts, with the words of the
    // Accueil's scope line (countedWhat): « Hiver contre hiver » and the month tile of the Accueil,
    // for the whole selection and for the heating alone
    for (const [cat, words] of [['all', 'chauffage et eau chaude'], ['heating', 'chauffage seul']]) {
      await go(page, 'historique');
      await page.click(`#explore-card [data-set=cat][data-value=${cat}]`);
      await ready(page);
      const figure = await page.locator('.season-tiles + p').innerText();
      check(figure.toLowerCase().startsWith(`${words} :`), `#466 : « Hiver contre hiver » ne dit pas « ${words} » (« ${figure} »)`);
      await go(page, 'accueil');
      const scope = await page.locator('.periodbar .scope').innerText();
      const month = await page.locator('.home-tiles .kpi h3').first().innerText();
      check(scope.includes(words) && month.includes(words), `#466 : total du mois sans « ${words} » (ligne « ${scope} », tuile « ${month} »)`);
    }
    await go(page, 'historique');
    await page.click('#explore-card [data-set=cat][data-value=all]');
    await ready(page);
    // #306: « An » only over whole years
    await go(page, 'historique');
    await page.selectOption('select[data-set=period]', '12m');
    await ready(page);
    check((await page.locator('#explore-card [data-set=gran][data-value=year]').count()) === 0, '#306 : granularité « An » proposée sur 12 mois glissants');
    await page.selectOption('select[data-set=period]', 'all');
    await ready(page);
    check((await page.locator('#explore-card [data-set=gran][data-value=year]').count()) === 1, '#306 : granularité « An » absente sur « Tout »');
    await page.selectOption('select[data-set=period]', '12m');
    await ready(page);
    await audit(page, 'historique');
  }

  // #426: Historique also holds in 4 screens on a small Android phone (360 × 800), in the CI's wide
  // font (DejaVu Sans, A6): the iPhone check above left 304 px of margin while 360 px was over.
  progress('historique 360 px');
  {
    const c = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1, hasTouch: true, serviceWorkers: 'block' });
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(`${BROWSER} historique 360: ${e.message}`));
    await p.goto(base);
    await p.click('#demo');
    await ready(p);
    await p.addStyleTag({ content: 'html, body, button, input, select, textarea { font-family: "DejaVu Sans", system-ui, sans-serif !important; }' });
    await go(p, 'historique');
    const [h, screenH] = await p.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]);
    progress(`historique 360 px : ${h} px (limite ${4 * screenH})`);
    check(h <= 4 * screenH, `#426 : l'Historique fait ${h} px à 360 × 800 (DejaVu Sans), plus de 4 écrans (${4 * screenH} px)`);
    await p.screenshot({ path: `${OUT}/${BROWSER}-360-historique.png`, fullPage: true });
    // #498: Air et confort, the longest page (12,8 screens before its explanations were folded):
    // a limit measured like the Historique's, to be lowered with the layout proposed in the PR
    await go(p, 'confort');
    const [hc, screenC] = await p.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]);
    progress(`confort 360 px : ${hc} px (limite ${11 * screenC})`);
    check(hc <= 11 * screenC, `#498 : Air et confort fait ${hc} px à 360 × 800 (DejaVu Sans), plus de 11 écrans (${11 * screenC} px)`);
    await c.close();
  }

  // v1.5 figures (#245 #246 #294 #295 #297 #298)
  progress('chiffres v1.5');
  {
    const label = () => page.locator('#cmp-chart').getAttribute('aria-label');
    await go(page, 'historique-annees');
    const totals = await page.locator('#years-card').innerText();
    check(/\*[\s\S]*Évolution de \d{4} : \d{4} compte \d+ jours? estimés? ou manquants?/.test(totals), '#297 : évolution annuelle sans mention des jours perdus');
    await go(page, 'historique');
    await page.waitForSelector('#cmp-chart canvas');
    await page.click('[data-set=compareMode][data-value=cumul]');
    await ready(page);
    const cumul = (await label()) ?? '';
    check(!/total/.test(cumul) && / kWh au \d+ /.test(cumul), `#295 : résumé du cumul faux (« ${cumul.slice(0, 160)} »)`);
    await page.click('[data-set=compareMode][data-value=season]');
    await ready(page);
    check((await page.locator('[data-season]', { hasText: 'en cours' }).count()) === 1, '#298 : pas de puce pour la saison en cours');
    check(/\(en cours\) : total [\d\s  ]+\skWh/.test((await label()) ?? ''), '#298 : saison en cours absente du graphique');
    // maquette « Historique » : hiver contre hiver, deux hivers complets chiffrés, à climat égal, l'hiver en cours en pointillé
    check((await page.locator('#cmp-card .season-tiles .kpi').count()) === 2, 'Historique : les deux hivers complets ne sont pas chiffrés');
    check(/à climat égal/.test(await page.locator('#cmp-card').innerText()), 'Historique : pas de comparaison « à climat égal »');
    check((await page.locator('#cmp-legend .legend i.line').count()) === 1, 'Historique : hiver en cours non signalé (pointillé)');
    await page.click('[data-set=compareMode][data-value=monthly]');
    await ready(page);
    // #303 : un seul tableau de signature, saison courte « provisoire »
    await go(page, 'historique-froid');
    await page.waitForSelector('#sig-chart canvas');
    check((await page.locator('#indoor-sig table').count()) === 0, '#303 : deuxième tableau de signature');
    check(/provisoire|en cours/.test(await page.locator('#sig-table').innerText()), '#303 : saison en cours non signalée dans la signature');
    // #305 : résumés chiffrés des graphiques sans série
    for (const [route, id] of [['historique-changements', '#rooms-waterfall'], ['historique-froid', '#sig-chart'], ['historique-calendrier', '#cal-chart']]) {
      await go(page, route);
      await page.waitForSelector(`${id} canvas`);
      const a = (await page.locator(id).getAttribute('aria-label')) ?? '';
      check(/\d/.test(a.split('. ').slice(1).join('. ')), `#305 : ${id} sans résumé chiffré (« ${a.slice(0, 120)} »)`);
    }
    await go(page, 'pieces');
    await page.waitForSelector('#rooms-chart canvas');
    const head = await page.locator('#view table thead').first().innerText();
    // #294, #388: the cold days follow the period of the page, said once by « Compté : » (no winter of their own)
    const counted = await page.locator('#pieces-compare .counted').innerText();
    const card = await page.locator('#pieces-compare').innerText();
    check(
      /Jours à moyenne sous/.test(head) && /^Compté : [A-ZÉ].* \d{4}/.test(counted) && /Températures et jours froids : mêmes jours que les kWh/.test(card) && !/hiver \d{4}–\d{4}/.test(card),
      `#294 : colonne des jours froids sans définition ni période (« ${head.replace(/\s+/g, ' ')} » / « ${counted} »)`,
    );
    await go(page, 'outils');
    await page.click('#view a[href="#rapport"]');
    await page.waitForSelector('.report .kpis');
    const yr = await page.locator('select[data-set=reportYear] option').first().getAttribute('value');
    await page.selectOption('select[data-set=reportYear]', yr);
    await ready(page);
    const kpis = await page.locator('.report .kpis').innerText();
    check(!/par mois en moyenne/.test(kpis) || /par mois en moyenne sur [\d,]+ mois/.test(kpis), `#246 : moyenne mensuelle de l'année en cours sans période (« ${kpis.replace(/\s+/g, ' ')} »)`);
    await go(page, 'accueil');
  }

  // S-2.3: invoice
  progress('facture');
  await go(page, 'outils-facture');
  await page.waitForSelector('#invoice-card #inv-add', { timeout: 15000 });
  const max = await page.getAttribute('#inv-to', 'max');
  const [from, to] = previousMonth(max);
  await page.fill('#inv-from', from);
  await page.fill('#inv-to', to);
  await page.fill('#inv-amount', '150');
  await page.fill('#inv-kwh', '600');
  await page.click('#inv-add');
  await page.waitForSelector('#invoice-card .invoice-result', { timeout: 10000 }).catch(() => {});
  const inv = await page.locator('#invoice-card').innerText();
  check(/Écart \(facture − appli\)/.test(inv), `facture : tableau de l'écart absent (${inv.slice(0, 200)})`);
  check(/D'où vient l'écart/.test(inv) && /Part du chauffage et de l'eau chaude/.test(inv), 'facture : explication ou périmètre absents');
  check(/Retirer/.test(inv), 'facture : non enregistrée dans la liste');
  await page.locator('#invoice-card').screenshot({ path: `${OUT}/${BROWSER}-facture.png` });
  await audit(page, 'outils-facture');

  // #127: without any surface, the report has no kWh/m²/an mark (checked once the view is ready)
  progress('rapport sans surface');
  await go(page, 'rapport');
  check((await page.locator('#report-dpe').count()) === 0, '#127 : repère kWh/m²/an affiché sans surface saisie');

  // S-6.2: works marker and surfaces
  progress('travaux');
  await go(page, 'parametres-logement');
  await page.waitForSelector('#works-card #works-add', { timeout: 15000 });
  const y = Number(max.slice(0, 4)) - 1;
  await page.fill('#works-day', `${y}-${max.slice(5, 7)}-01`);
  await page.selectOption('#works-kind', 'isolation');
  await page.fill('#works-label', 'Combles');
  await page.click('#works-add');
  await page.waitForSelector('#works-sig-chart canvas', { timeout: 15000 }).catch(() => errors.push(`${BROWSER}: travaux : signature avant / après absente`));
  await page.waitForSelector('#works-chart canvas', { timeout: 15000 }).catch(() => errors.push(`${BROWSER}: travaux : graphique mensuel absent`));
  let works = await page.locator('#works-card').innerText();
  check(/Avant/.test(works) && /Après/.test(works), 'travaux : lignes avant / après absentes');
  check(/Isolation — Combles/.test(works), 'travaux : marqueur non listé');
  // #476: the demo's Cuisine is heated by a stove with fictitious purchases: the before / after
  // compares the electricity + wood (worksHeat), and says so
  check(/le chauffage \(électricité \+ bois\) a évolué de/.test(works), `#476 : avant / après sans « électricité + bois » (« ${works.slice(0, 300)} »)`);
  // #488: the monthly chart counts the same heating (worksMonthly → worksHeat), and says so
  check(/Chauffage électricité \+ bois par mois/.test(works), `#488 : « Chauffage par mois » sans le bois (« ${works.slice(0, 600)} »)`);
  check(/^Chauffage électricité \+ bois par mois/.test((await page.locator('#works-chart').getAttribute('aria-label')) ?? ''), '#488 : graphique mensuel des travaux sans « électricité + bois » (aria-label)');
  await page.click('#works-surfaces summary');
  const inputs = page.locator('[data-works-surface]');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    await page.locator('[data-works-surface]').nth(i).fill(String(10 + i));
    await page.locator('[data-works-surface]').nth(i).dispatchEvent('change');
    await ready(page);
  }
  await page.waitForFunction(() => /kWh\/m²/.test(document.querySelector('#works-card')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
  works = await page.locator('#works-card').innerText();
  check(/kWh\/m²/.test(works), 'travaux : kWh/m² absent après saisie des surfaces');
  // #460: the stove's wood counted in the kWh/m² of the home; the Cuisine (stove) never at 0 kWh/m²
  check(/12 derniers mois : [\d,]+ kWh\/m² de chauffage électricité \+ bois/.test(works), `travaux : kWh/m² du logement sans le bois (${works.slice(0, 300)})`);
  check(/Cuisine\t[\d,]+ m²\t[^\n]*\tchauffée au bois/.test(works), `travaux : la Cuisine (poêle) n'est pas « chauffée au bois » (${works.slice(-500)})`);
  await page.locator('#works-card').screenshot({ path: `${OUT}/${BROWSER}-travaux.png` });
  await audit(page, 'parametres-logement');
  await checkViolations(page, 'parametres-logement');
  await go(page, 'historique-froid');
  const isoM2 = await page.locator('#iso-m2').innerText();
  check(/Chauffage des 12 derniers mois ≈ \d+ kWh\/m², électricité \+ bois, sur \d+ m² : (très bien|bien|moyennement|mal) isolé\./.test(isoM2), `isolation : kWh/m² électricité + bois absent (« ${isoM2} »)`);
  // #127: with the surfaces, the report situates the home in kWh/m²/an against the DPE thresholds
  await go(page, 'rapport');
  const dpe = (await page.locator('#report-dpe').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check(
    /Repère en kWh\/m²\/an, pas un DPE/.test(dpe) && /Mesuré : [\d\u202f\u00a0]+ kWh\/m² d’énergie finale \(chauffage, électricité \+ bois, et eau chaude/.test(dpe) && /classe [A-G] à titre indicatif/.test(dpe) && /Pas un DPE/.test(dpe),
    `#127 : repère kWh/m²/an incomplet (« ${dpe.slice(0, 300)} »)`,
  );
  await go(page, 'piece-r-cuisine');
  const kitchen = await page.locator('#view').innerText();
  check(/Surface · kWh par m²[\s\S]{0,40}m² · chauffée au bois/.test(kitchen), `pièce Cuisine : surface sans « chauffée au bois » (${kitchen.slice(0, 200)})`);

  // #308: no card lost, each one at its new place; #309: every setting in ⚙ (one page each)
  progress('destinations des cartes');
  for (const [key, wants] of Object.entries(DESTINATIONS)) {
    await go(page, key);
    for (const want of wants) {
      if (want.startsWith('text:')) {
        if (!(await page.locator('#view').innerText()).includes(want.slice(5))) errors.push(`${BROWSER} #${key} : « ${want.slice(5)} » absent`);
        continue;
      }
      await page.waitForSelector(want, { state: 'attached', timeout: 15000 }).catch(() => errors.push(`${BROWSER} #${key} : ${want} absent`));
    }
    await checkViolations(page, key);
  }
  // a room page from the list, and the Back button of the system comes back to the list
  await go(page, 'pieces');
  await page.locator('#view a[data-room-link]').first().click();
  await page.waitForSelector('#view[data-page^="piece-"] #room-detail canvas', { timeout: 15000 }).catch(() => errors.push(`${BROWSER} page Pièce : détail mois par mois absent`));
  check(await page.evaluate(() => document.activeElement?.id === 'page-title'), 'page Pièce : le titre ne reçoit pas le focus');
  await page.goBack();
  await page.waitForSelector('#view[data-page=pieces]', { state: 'attached', timeout: 10000 }).catch(() => errors.push(`${BROWSER} retour du système : la liste des pièces ne revient pas`));
  await audit(page, 'pieces');

  // S-6.6: research export
  progress('export recherche');
  await go(page, 'outils-exports');
  await page.click('[data-research]');
  await page.waitForSelector('#research-dialog[open] #research-go');
  await page.click('#research-go');
  check(/licence/.test(await page.locator('#research-status').innerText()), 'export recherche : licence non exigée');
  await page.selectOption('#research-license', 'CC-BY-4.0');
  await page.selectOption('#research-zone', 'H2b');
  await audit(page, 'export-recherche');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#research-go')]);
  const text = readFileSync(await dl.path(), 'utf8');
  check(dl.suggestedFilename() === 'energie-recherche-v1.csv', `export recherche : nom ${dl.suggestedFilename()}`);
  check(text.startsWith('# energie-recherche v1'), 'export recherche : en-tête absent');
  check(/^# Licence : CC-BY-4\.0/m.test(text), 'export recherche : licence absente');
  check(/^# Limite : Un seul logement/m.test(text), 'export recherche : limites absentes');
  check(/zone climatique H2b/.test(text), 'export recherche : zone absente');
  check(/^# Travaux : time \d+ Isolation/m.test(text), 'export recherche : travaux absents');
  check(!/\b20\d{2}-\d{2}-\d{2}/.test(text), 'export recherche : date réelle présente');
  check(!text.includes('Combles'), 'export recherche : précision libre des travaux exportée');
  check(/\nPièce A|,Pièce A,/.test(text) && /,1,/.test(text), 'export recherche : pseudonymes ou valeurs horaires absents');
  for (const s of [homeName, ...roomNames.filter((r) => !/^chauffe-eau$/i.test(r))]) {
    if (s.length >= 3 && text.includes(s)) errors.push(`${BROWSER}: export recherche : « ${s} » apparaît`);
  }
  check(/Fichier prêt/.test(await page.locator('#research-status').innerText()), 'export recherche : statut final absent');
  await page.screenshot({ path: `${OUT}/${BROWSER}-export-recherche.png` });
  await page.click('#research-close');
  check(!(await page.locator('#research-dialog[open]').count()), 'export recherche : la boîte ne se ferme pas');
  await checkViolations(page, 'export-recherche');
  await ctx.close();
  await browser.close();
} catch (err) {
  errors.push(`${BROWSER}: ${String(err)}`);
} finally {
  server.kill();
}
if (errors.length) console.error(errors.join('\n'));
console.log(errors.length ? `E2E ${BROWSER} : ÉCHEC` : `E2E ${BROWSER} : OK (captures dans ${OUT})`);
process.exit(errors.length ? 1 : 0);
