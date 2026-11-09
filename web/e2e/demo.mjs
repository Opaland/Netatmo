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
    const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 1 });
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
    if (name === 'bureau') {
      try {
        // S-9.6: « volets fermés » card (lazy module) in Analyse
        await page.waitForSelector('#shutters-card', { timeout: 10000 });
        // S-12.2: bedrooms merged by default, detail on demand until the next lock
        const picker = () => page.locator('.rooms-panel').textContent();
        if (!(await picker()).includes('Chambres') || (await picker()).includes('Chambre parentale')) errors.push('vue foyer : chambres non regroupées');
        const openMenu = async () => (await page.locator('.menu').getAttribute('open')) === null && (await page.click('.menu summary'));
        await page.click('[data-view=overview]');
        await openMenu();
        await page.click('[data-household=reveal]');
        if (!(await picker()).includes('Chambre parentale')) errors.push('vue foyer : détail non affiché');
        await openMenu();
        await page.click('[data-household=hide]');
        await openMenu();
        // S-8.14: « Cadre juridique » from Paramètres (lazy module)
        await page.click('.menu-panel [data-view=settings]');
        await page.click('#legal-open');
        await page.waitForSelector('#legal-card .legal-list', { timeout: 10000 });
        await page.screenshot({ path: `${OUT}/${name}-juridique.png`, fullPage: true });
      } catch (err) {
        errors.push(`${name}: vue foyer / volets / cadre juridique (${err})`);
      }
    }
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
