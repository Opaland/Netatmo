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
  accueil: ['.verdict', '#grid-card', '.kpis .kpi', '#main-chart canvas', '[data-set=cat]', '#insight-card .md'],
  pieces: ['.rooms-picker', '#rooms-chart canvas', 'a[href="#confort"]', 'a[href="#chauffe-eau"]'],
  historique: ['.kpis-one .kpi', '#cmp-chart canvas', 'text:Totaux annuels', '#rooms-waterfall canvas', '#sig-chart canvas', '#indoor-sig-chart canvas', '#unusual-card', '#cal-chart canvas', '#station-chart canvas'],
  compteur: ['#linky-chart canvas', '#pmax-chart canvas', '#offload-zone table', '#curve-day-chart canvas', '#bd-chart canvas', '#hour-grid canvas', 'text:Heures pleines / heures creuses'],
  confort: ['#cold-chart canvas', '#windows-chart canvas', '#ha-card table', '#cellar-0 canvas', '#probe-0 canvas'],
  'chauffe-eau': ['#wh-month-chart canvas', '#contactor-line:not([hidden])'],
  etat: ['#quality[open]', '.status-list', '#devices-card [data-shelly-role]'],
  rapport: ['.report .kpis', '#report-offers table'],
  'outils-offres': ['#offers-chart canvas'],
  'outils-voiture': ['#ev-card #ev-result table'],
  'outils-pac': ['#hp-card #hp-result table'],
  'outils-consigne': ['#setpoint-card #sp-result'],
  'outils-teletravail': ['#telework-card'],
  'outils-facture': ['#invoice-card #inv-add'],
  'outils-absences': ['#absence-card'],
  'outils-volets': ['#shutters-card'],
  'outils-analyse': ['#insight-card .insight-usage'],
  'outils-questions': ['#questions-card [data-question]'],
  'outils-exports': ['#export', '[data-export-long=csv]', '[data-export-long=json]', '[data-research]', '#backup'],
  'parametres-contrat': ['[data-pmode]', '#contract-share'],
  'parametres-logement': ['#works-card [data-works-surface]', 'a[href="#compteur"]'],
  'parametres-sources': ['.status-list', '#gh-login', '#devices-card'],
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
    const notice = await page.locator('#lock-notice').innerText().catch(() => '');
    check(/^iOS a effacé la clé, vos données sont intactes/.test(notice), `éviction : message attendu sur iPhone, lu « ${notice} »`);
    await page.screenshot({ path: `${OUT}/${BROWSER}-cle-effacee.png`, fullPage: true });
    await audit(page, 'verrou-cle-effacee');
    await page.reload();
    await page.waitForSelector('#pass');
    check(!(await page.locator('#lock-notice').count()), 'éviction : le message revient après rechargement');
    await ctx.close();
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
  const homeName = (await page.locator('.top h1').innerText()).replace(/\s*démo$/i, '').trim();
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

  // v1.5 figures (#245 #246 #294 #295 #297 #298)
  progress('chiffres v1.5');
  {
    const label = () => page.locator('#cmp-chart').getAttribute('aria-label');
    await go(page, 'historique');
    await page.waitForSelector('#cmp-chart canvas');
    const totals = await page.locator('table', { hasText: 'Évolution' }).first().innerText();
    check(/jours? estimés? ou manquants?/.test(totals), '#297 : évolution annuelle sans mention des jours perdus');
    await page.click('[data-set=compareMode][data-value=cumul]');
    await ready(page);
    const cumul = (await label()) ?? '';
    check(!/total/.test(cumul) && / kWh au \d+ /.test(cumul), `#295 : résumé du cumul faux (« ${cumul.slice(0, 160)} »)`);
    await page.click('[data-set=compareMode][data-value=season]');
    await ready(page);
    check((await page.locator('[data-season]', { hasText: 'en cours' }).count()) === 1, '#298 : pas de puce pour la saison en cours');
    check(/\(en cours\) : [\d\s ]+ kWh au \d+/.test((await label()) ?? ''), '#298 : saison en cours absente du graphique');
    await page.click('[data-set=compareMode][data-value=monthly]');
    await go(page, 'pieces');
    await page.waitForSelector('#rooms-chart canvas');
    const head = await page.locator('#view table thead').first().innerText();
    check(/Jours à moyenne sous/.test(head) && /hiver \d{4}–\d{4}/.test(head), `#294 : colonne des jours froids sans définition ni hiver (« ${head.replace(/\s+/g, ' ')} »)`);
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
  await page.locator('#works-card').screenshot({ path: `${OUT}/${BROWSER}-travaux.png` });
  await audit(page, 'parametres-logement');
  await checkViolations(page, 'parametres-logement');

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
