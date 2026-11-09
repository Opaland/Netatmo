// S-1.9: visual smoke test of the demo, every view, light and dark, mobile and desktop.
// Run after `npm run build`: node e2e/demo.mjs  (starts `vite preview` itself).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
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
    const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 1 });
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
      }
      const charts = await page.locator('.chart canvas').count();
      if (!charts) errors.push(`${name}/${view}: aucun graphique rendu`);
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
    await page.screenshot({ path: `${OUT}/${name}-report.png`, fullPage: true });
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
