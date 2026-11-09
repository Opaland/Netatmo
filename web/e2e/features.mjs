// v1.4 checks, on Chromium (job e2e) and on WebKit (job e2e-webkit, S-7.9: Safari iOS):
// - S-7.9: the five views of the demo render on an iPhone; a remembered key erased by the
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
  const roomNames = (await page.locator('.rooms-panel label').allInnerTexts()).map((t) => t.split('\n')[0].replace(/\s*(Chauffage|Chauffe-eau)\s*$/, '').trim());
  const homeName = (await page.locator('.top h1').innerText()).replace(/\s*démo$/i, '').trim();
  check(roomNames.length >= 3, `pièces introuvables (${roomNames.join(', ')})`);

  // S-7.9: the five views
  for (const view of ['overview', 'compare', 'rooms', 'analyse', 'comfort']) {
    progress(`vue ${view}`);
    await page.click(`[data-view=${view}]`);
    try {
      await page.waitForSelector(view === 'comfort' ? '#cold-chart canvas' : '#view .chart canvas', { timeout: 20000 });
    } catch {
      errors.push(`${BROWSER}/${view}: aucun graphique rendu`);
    }
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${BROWSER}-iphone-${view}.png`, fullPage: true });
    await checkViolations(page, view);
  }

  // v1.5 figures (#245 #246 #294 #295 #297 #298)
  progress('chiffres v1.5');
  {
    const label = () => page.locator('#cmp-chart').getAttribute('aria-label');
    await page.click('[data-view=compare]');
    await page.waitForSelector('#cmp-chart canvas');
    const totals = await page.locator('table', { hasText: 'Évolution' }).first().innerText();
    check(/jours? estimés? ou manquants?/.test(totals), '#297 : évolution annuelle sans mention des jours perdus');
    await page.click('[data-set=compareMode][data-value=cumul]');
    await page.waitForTimeout(400);
    const cumul = (await label()) ?? '';
    check(!/total/.test(cumul) && / kWh au \d+ /.test(cumul), `#295 : résumé du cumul faux (« ${cumul.slice(0, 160)} »)`);
    await page.click('[data-set=compareMode][data-value=season]');
    await page.waitForTimeout(400);
    check((await page.locator('[data-season]', { hasText: 'en cours' }).count()) === 1, '#298 : pas de puce pour la saison en cours');
    check(/\(en cours\) : [\d\s ]+ kWh au \d+/.test((await label()) ?? ''), '#298 : saison en cours absente du graphique');
    await page.click('[data-set=compareMode][data-value=monthly]');
    await page.click('[data-view=rooms]');
    await page.waitForSelector('#rooms-chart canvas');
    const head = await page.locator('#view table thead').first().innerText();
    check(/Jours à moyenne sous/.test(head) && /hiver \d{4}–\d{4}/.test(head), `#294 : colonne des jours froids sans définition ni hiver (« ${head.replace(/\s+/g, ' ')} »)`);
    await page.click('.menu summary');
    await page.click('.menu-panel [data-view=report]');
    await page.waitForSelector('.report .kpis');
    const yr = await page.locator('select[data-set=reportYear] option').first().getAttribute('value');
    await page.selectOption('select[data-set=reportYear]', yr);
    await page.waitForTimeout(400);
    const kpis = await page.locator('.report .kpis').innerText();
    check(!/par mois en moyenne/.test(kpis) || /par mois en moyenne sur [\d,]+ mois/.test(kpis), `#246 : moyenne mensuelle de l'année en cours sans période (« ${kpis.replace(/\s+/g, ' ')} »)`);
    await page.click('[data-view=overview]');
  }

  // S-2.3: invoice
  progress('facture');
  await page.click('[data-view=overview]');
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
  await audit(page, 'synthese-facture');

  // S-6.2: works marker and surfaces
  progress('travaux');
  await page.click('[data-view=analyse]');
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
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(400);
  works = await page.locator('#works-card').innerText();
  check(/kWh\/m²/.test(works), 'travaux : kWh/m² absent après saisie des surfaces');
  await page.locator('#works-card').screenshot({ path: `${OUT}/${BROWSER}-travaux.png` });
  await audit(page, 'analyse-travaux');
  await checkViolations(page, 'analyse-travaux');

  // S-6.6: research export
  progress('export recherche');
  await page.click('.menu summary');
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
