// S-1.9: visual smoke test of the demo, every view, light and dark, mobile and desktop.
// Run after `npm run build`: node e2e/demo.mjs  (starts `vite preview` itself).
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
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
  ]) {
    const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 1 });
    await ctx.addInitScript(recordViolations);
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
    await page.click('.menu summary');
    await page.click('.menu-panel [data-view=report]');
    await page.waitForSelector('.report');
    await page.screenshot({ path: `${OUT}/${name}-report.png`, fullPage: true });
    await page.click('.menu summary');
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
