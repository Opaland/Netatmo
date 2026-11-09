// S-1.9: visual smoke test of the demo, every view, light and dark, mobile and desktop.
// Run after `npm run build`: node e2e/demo.mjs  (starts `vite preview` itself).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const PORT = Number(process.env.E2E_PORT ?? 4179);
const OUT = process.env.E2E_OUT ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
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
    await page.click('#demo');
    await page.waitForSelector('.kpi', { timeout: 30000 });
    for (const view of name === 'mobile-360' ? [] : ['overview', 'compare', 'rooms', 'analyse']) {
      await page.click(`[data-view=${view}]`);
      await page.waitForTimeout(view === 'analyse' ? 2000 : 600);
      if (view === 'overview') {
        // Linky 30-min load curve card (lazy module + lazy documents)
        try {
          await page.waitForSelector('#curve-day-chart canvas', { timeout: 15000 });
          const talon = await page.locator('#curve-talon').innerText();
          if (!/\d\s?W/.test(talon)) errors.push(`${name}/overview: talon de veille absent (${talon})`);
          if ((await page.locator('#curve-card canvas').count()) < 2) errors.push(`${name}/overview: courbe de charge incomplète`);
        } catch (err) {
          errors.push(`${name}/overview: carte « Courbe de charge » non rendue (${err})`);
        }
        // S-1.10: lost days rebuilt apart, on demand (lazy module)
        try {
          await page.click('#quality summary');
          await page.check('[data-recon]');
          await page.waitForSelector('#recon-chart canvas', { timeout: 15000 });
          if (!(await page.getByText('Jours suspects').count())) errors.push(`${name}/overview: jours suspects absents`);
        } catch (err) {
          errors.push(`${name}/overview: reconstitution non rendue (${err})`);
        }
      }
      if (view === 'analyse') {
        // S-3.7: indoor − outdoor signature (lazy module)
        try {
          await page.waitForSelector('#indoor-sig-chart canvas', { timeout: 15000 });
        } catch (err) {
          errors.push(`${name}/analyse: signature intérieur − extérieur non rendue (${err})`);
        }
      }
      const charts = await page.locator('.chart canvas').count();
      if (!charts) errors.push(`${name}/${view}: aucun graphique rendu`);
      if (view === 'analyse' && !(await page.locator('#insight-card .insight-usage').count())) errors.push(`${name}/analyse: carte IA (S-5.8) non rendue`);
      // Tooltip (ECharts) shown then hidden: goes through the Trusted Types policy.
      if (charts && !opts.isMobile) {
        const canvas = page.locator('.chart canvas').first();
        const { width, height } = (await canvas.boundingBox()) ?? { width: 0, height: 0 };
        await canvas.hover({ position: { x: width * 0.6, y: height * 0.6 } });
        await page.waitForTimeout(400);
        if (view === 'overview' && !(await page.locator('.tt').count())) errors.push(`${name}/${view}: infobulle ECharts absente`);
        await page.mouse.move(0, 0);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      await checkViolations(page, `${name}/${view}`);
      await page.screenshot({ path: `${OUT}/${name}-${view}.png`, fullPage: true });
    }
    // S-11 / S-3.8: comfort view (lazy chunk), bedroom detail on a deliberate gesture, other threshold
    await page.click('[data-view=comfort]');
    await page.waitForSelector('#cold-chart canvas', { timeout: 15000 });
    await page.click('[data-comfort=show-bedrooms]');
    await page.waitForSelector('#co2-0 canvas');
    await page.selectOption('select[data-comfort=threshold]', '18');
    await page.waitForFunction(() => !document.querySelector('#view td.num')?.closest('table')?.textContent?.includes('…'), null, { timeout: 15000 });
    await page.waitForTimeout(600);
    for (const id of ['co2-0', 'cellar-0', 'cold-chart', 'probe-0']) {
      if (!(await page.locator(`#${id} canvas`).count())) errors.push(`${name}/comfort: graphique ${id} absent`);
    }
    if (!(await page.getByText('Heures sous 18,0 °C').count())) errors.push(`${name}/comfort: seuil 18 °C non appliqué`);
    const overflow = await page.evaluate(() => {
      const t = document.querySelector('.tabs');
      return t ? t.scrollWidth > t.clientWidth + 1 : false;
    });
    if (overflow) errors.push(`${name}: barre d'onglets plus large que l'écran`);
    await page.screenshot({ path: `${OUT}/${name}-comfort.png`, fullPage: true });
    await page.selectOption('select[data-comfort=threshold]', '19');

    await page.click('.menu summary');
    await page.click('.menu-panel [data-view=report]');
    await page.waitForSelector('.report');
    // S-6.3: offer comparator and maximum power in the annual report (lazy module)
    try {
      await page.waitForSelector('#report-offers table', { timeout: 15000 });
      await page.waitForSelector('#report-pmax table', { timeout: 15000 });
    } catch (err) {
      errors.push(`${name}/report: comparateur ou pic de puissance absent (${err})`);
    }
    // S-5.9: a canned question answered by code
    await page.click('[data-question=normal]');
    await page.waitForSelector('.question-answer li', { timeout: 5000 });
    await page.screenshot({ path: `${OUT}/${name}-report.png`, fullPage: true });
    // S-6.4: anonymised report, without any room or home name of the demo
    const roomNames = await page.locator('#report-waterfall ~ .table-wrap').first().locator('tbody td:first-child').allInnerTexts();
    const homeName = (await page.locator('.top h1').innerText()).replace(/\s*démo$/i, '').trim();
    if (roomNames.length < 2) errors.push(`${name}/report: tableau des pièces introuvable`);
    await page.click('#report-anon');
    await page.waitForSelector('.anon-report #anon-chart canvas', { timeout: 15000 });
    const anon = await page.locator('.anon-report').innerText();
    for (const secret of [homeName, ...roomNames.filter((n) => !/^chauffe-eau$/i.test(n.trim()))]) {
      if (anon.includes(secret)) errors.push(`${name}/anonymisé: « ${secret} » apparaît`);
    }
    if (!/Pièce A/.test(anon) || !/Période/.test(anon)) errors.push(`${name}/anonymisé: pseudonymes ou période absents`);
    await page.screenshot({ path: `${OUT}/${name}-report-anonymise.png`, fullPage: true });
    // S-9.7: long export, generated in the page
    if (name === 'bureau') {
      await page.click('.menu summary');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-long=csv]')]);
      const head = readFileSync(await dl.path(), 'utf8').split('\n')[0];
      if (head !== 'date,source,entity,metric,value,unit') errors.push(`export long : en-tête inattendu (${head})`);
      if (!/^energie-long-v1-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename())) errors.push(`export long : nom ${dl.suggestedFilename()}`);
    }
    if (!(await page.locator('details.menu[open]').count())) await page.click('.menu summary');
    await page.click('.menu-panel [data-view=settings]');
    await page.waitForTimeout(300);
    await checkViolations(page, `${name}/report+settings`);
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
