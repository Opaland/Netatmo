// #353: what every end-to-end script needs, in one place: the preview server, the « view ready »
// signal (#260) instead of fixed delays, the demo opening (optionally on a named fixture) and
// the axe audit. New scripts use it; the older ones move to it when they are touched.
import { spawn } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';

/** Start `vite preview` on `port` (after `npm run build`); resolves with { base, stop }. */
export async function startPreview(port) {
  const busy = await fetch(`http://localhost:${port}/`).then(
    () => true,
    () => false,
  );
  if (busy) throw new Error(`le port ${port} est déjà utilisé, définir E2E_PORT`);
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  let exited = false;
  server.on('exit', () => (exited = true));
  const base = `http://localhost:${port}/`;
  for (let i = 0; i < 100; i++) {
    if (exited) throw new Error(`le serveur de prévisualisation s'est arrêté (port ${port})`);
    try {
      if ((await fetch(base)).ok) return { base, stop: () => server.kill() };
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  server.kill();
  throw new Error('le serveur de prévisualisation ne répond pas');
}

/** The view shown is drawn and everything it started in the background has settled (#260). */
export const ready = (page, timeout = 30000) => page.waitForSelector('#view[data-page][data-ready]', { state: 'attached', timeout });

/** Two animation frames: a click's re-render (and its « not ready » mark) has happened. */
export const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/**
 * Show the page at `hash` (« outils-teletravail ») and wait until it is ready. The page shown
 * may differ (a route redirected in tenant mode or in the simple view): returns its key.
 */
export async function goto(page, hash, timeout = 30000) {
  await page.evaluate((h) => {
    if (location.hash === `#${h}`) return; // already there (a redirect wrote it): no hashchange will come
    const view = document.getElementById('view');
    view?.removeAttribute('data-ready');
    view?.removeAttribute('data-page');
    location.hash = `#${h}`;
  }, hash);
  await ready(page, timeout);
  return page.evaluate(() => document.getElementById('view')?.dataset.page ?? '');
}

/** Open the demo from the lock screen (`fixture`: a folder of web/dist/demo-fixtures, #353). */
export async function openDemo(page, base, fixture = null, hash = '') {
  await page.goto(`${base}${fixture ? `?fixture=${encodeURIComponent(fixture)}` : ''}${hash ? `#${hash}` : ''}`);
  await page.getByRole('button', { name: /données de démonstration/ }).click();
  await page.waitForSelector('header.top', { timeout: 60000 });
  await ready(page, 60000);
}

/** Open real data from the lock screen with the passphrase (key not remembered). */
export async function openData(page, base, passphrase, hash = '') {
  await page.goto(`${base}${hash ? `#${hash}` : ''}`);
  await page.locator('#pass').fill(passphrase);
  const remember = page.locator('#remember');
  if (await remember.isChecked()) await remember.uncheck();
  await page.locator('#unlock button.primary').click();
  await page.waitForSelector('header.top', { timeout: 120000 });
  await ready(page, 120000);
}

/** axe violations of impact « serious » or « critical » (WCAG 2.1 A / AA): [{ id, targets }]. */
export async function seriousAxe(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
}
