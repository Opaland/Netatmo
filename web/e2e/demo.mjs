// S-1.9: visual smoke test of the demo, every view, light and dark, mobile and desktop.
// Run after `npm run build`: node e2e/demo.mjs  (starts `vite preview` itself).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const PORT = Number(process.env.E2E_PORT ?? 4179);
const OUT = process.env.E2E_OUT ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const base = `http://localhost:${PORT}/`;

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

const errors = [];
let failed = false;
try {
  await waitForServer();
  const browser = await chromium.launch();
  for (const [name, opts] of [
    ['mobile-clair', { ...devices['iPhone 13'] }],
    ['mobile-sombre', { ...devices['Pixel 7'], colorScheme: 'dark' }],
    ['bureau', { viewport: { width: 1280, height: 900 } }],
  ]) {
    const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 1, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
    await page.goto(base);
    await page.click('#demo');
    await page.waitForSelector('.kpi', { timeout: 30000 });
    for (const view of ['overview', 'compare', 'rooms', 'analyse']) {
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
      }
      const charts = await page.locator('.chart canvas').count();
      if (!charts) errors.push(`${name}/${view}: aucun graphique rendu`);
      await page.screenshot({ path: `${OUT}/${name}-${view}.png`, fullPage: true });
    }
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
    await page.screenshot({ path: `${OUT}/${name}-report.png`, fullPage: true });
    // S-6.4: anonymised report, without any room or home name of the demo
    await page.click('#report-anon');
    await page.waitForSelector('.anon-report #anon-chart canvas', { timeout: 15000 });
    const anon = await page.locator('.anon-report').innerText();
    for (const secret of ['Maison démo', 'Salon', 'Cuisine', 'Chambre parentale', 'Chambre enfant', 'Salle de bain', 'Bureau', 'r-salon']) {
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
