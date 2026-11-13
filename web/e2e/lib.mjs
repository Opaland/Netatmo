// #353: what every end-to-end script needs, in one place: the preview server, the « view ready »
// signal (#260) instead of fixed delays, the demo opening (optionally on a named fixture) and
// the axe audit. New scripts use it; the older ones move to it when they are touched.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { assertFreshDist } from './dist-a-jour.mjs';

/** Start `vite preview` on `port` (after `npm run build`); resolves with { base, stop }. */
export async function startPreview(port) {
  assertFreshDist(); // #361: never test an older build than the sources
  const busy = await fetch(`http://localhost:${port}/`).then(
    () => true,
    () => false,
  );
  if (busy) throw new Error(`le port ${port} est déjà utilisé, définir E2E_PORT`);
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  let exited = false;
  server.on('exit', () => (exited = true));
  process.on('exit', () => server.kill()); // a script that throws does not leave the port taken
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
  // The view drawn now is marked; the page is ready once a NEW view is drawn and settled. When
  // nothing is redrawn (already there, or a route that the app maps to the page shown, like the
  // meter pages in tenant mode), the marked view counts after a grace second.
  const t0 = await page.evaluate((h) => {
    const view = document.getElementById('view');
    if (view) view.dataset.e2eOld = '';
    if (location.hash !== `#${h}`) location.hash = `#${h}`;
    return performance.now();
  }, hash);
  await page.waitForFunction(
    (t0) => {
      const v = document.getElementById('view');
      return !!v && v.hasAttribute('data-ready') && v.dataset.page !== undefined && (v.dataset.e2eOld === undefined || performance.now() - t0 > 1000);
    },
    t0,
    { timeout, polling: 50 },
  );
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

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every route of the registry (src/router.ts): the five tabs, the simple view, each tool, meter
 * page, history page and settings page, and the first launch. Rooms (« piece-<id> ») come from
 * the data opened (roomRoutes). Shared by the sweep and the keyboard walk (#594).
 */
export function registryRoutes() {
  const src = readFileSync(join(WEB, 'src/router.ts'), 'utf8');
  const keys = (name) => {
    const block = new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\} as const;`).exec(src);
    if (!block) throw new Error(`router.ts : ${name} introuvable`);
    return [...block[1].matchAll(/^\s*'?([\w-]+)'?\s*:/gm)].map((m) => m[1]);
  };
  const tabs = [...src.matchAll(/^\s*\['(\w+)', '[^']+'\],$/gm)].map((m) => m[1]);
  const simple = /SIMPLE_PAGES = new Set\(\[([^\]]+)\]\)/.exec(src)[1].match(/[\w-]+/g);
  return [
    ...new Set(tabs),
    ...simple,
    ...keys('TOOLS').map((k) => `outils-${k}`),
    ...keys('METER_PAGES').map((k) => `compteur-${k}`),
    ...keys('HISTORY_PAGES').map((k) => `historique-${k}`),
    'parametres',
    ...keys('SETTINGS').map((k) => `parametres-${k}`),
    'bienvenue',
    'bienvenue-2',
    'bienvenue-3',
    'bienvenue-4',
  ];
}

/** Folders of web/dist/demo-fixtures (made-up data, python -m collector fixtures), generated when missing. */
export function dataFixtures() {
  const dir = join(WEB, 'dist/demo-fixtures');
  if (!existsSync(join(dir, 'sans-prix', 'meta.enc.json'))) {
    console.log('Fixtures absentes : python3 -m collector fixtures');
    execFileSync('python3', ['-m', 'collector', 'fixtures', '-o', dir], { cwd: join(WEB, '..'), stdio: 'inherit' });
  }
  return readdirSync(dir).filter((n) => existsSync(join(dir, n, 'meta.enc.json')));
}

/** Rooms of the list (« piece-<id> ») of the data opened, in their order. */
export async function roomRoutes(page) {
  await goto(page, 'pieces');
  const hrefs = await page.$$eval('#view a[href^="#piece-"]', (as) => as.map((a) => a.getAttribute('href').slice(1)));
  return [...new Set(hrefs)];
}

/**
 * Serve a fixture folder (web/dist/demo-fixtures/<name>) where the app fetches data/, to open it
 * as real data (lock screen, passphrase « demo »): nothing is copied into dist/.
 */
export async function serveFixtureAsData(ctx, base, dir) {
  const prefix = `${new URL(base).pathname}data/`;
  await ctx.route(
    (url) => url.pathname.startsWith(prefix),
    (route) => {
      const file = join(dir, new URL(route.request().url()).pathname.slice(prefix.length));
      return file.startsWith(`${dir}/`) && existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    },
  );
}

/** Every page of `ctx` starts with exactly these device settings ({ key: string }, app namespace). */
export async function seedStorage(ctx, storage) {
  await ctx.addInitScript(
    (entries) => {
      try {
        // the app's namespace (src/scope.ts): « intuis-history@<dépôt> » under a path, else « intuis-history »
        const dir = location.pathname.replace(/[^/]*$/, '').replace(/^\/+|\/+$/g, '');
        const prefix = dir ? `intuis-history@${dir}` : 'intuis-history';
        localStorage.clear();
        for (const [k, v] of entries) localStorage.setItem(`${prefix}:${k}`, v);
      } catch {
        /* storage blocked: defaults */
      }
    },
    Object.entries(storage),
  );
}

/** What a device of a fuller account keeps (made up): Shelly clamp names of 60 characters without a space. */
export const RICH_STORAGE = {
  shelly: JSON.stringify({
    names: { p4c0: 'Circuit_prises_cuisine_buanderie_et_cellier_du_sous-sol_nord', p4c1: 'Ballon_thermodynamique_garage_et_atelier_du_rez-de-chaussée' },
    roles: { p4c1: 'water' },
  }),
};
