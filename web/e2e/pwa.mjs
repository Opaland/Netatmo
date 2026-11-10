// #357: the app as an installed application (Chromium, with its real service worker).
// - A new version (a second build of sw.js, served by this script) waits: no reload by surprise,
//   a banner (role=status, 44 px, axe, 360 px with the text at 200 %) offers « Recharger »;
//   with two tabs open, « Recharger » in one activates it and reloads that one, the other is not
//   reloaded behind the reader's back and its own button reloads it. The remembered key keeps
//   both unlocked. The first visit shows no banner.
// - « Recharger l'application » (Paramètres → À propos): the remembered key (IndexedDB), the
//   notes (localStorage) and the encrypted data cache are the same before and after (read in
//   the storage itself, not through setOffline: it does not apply to the service worker).
// - Installer: a button once `beforeinstallprompt` has arrived (even before the card exists),
//   gone after the choice; the Safari gesture on iPhone; nothing when opened from the icon.
// - Offline with nothing kept: a screen that says so.
// Run after `npm run build`: node e2e/pwa.mjs (serves dist/ itself, data/ answered by the demo
// files, passphrase « demo »; port: E2E_PORT). Captures in e2e/screenshots/pwa-*.png.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const PORT = Number(process.env.E2E_PORT ?? 4191);
const OUT = process.env.E2E_OUT ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const DIST = new URL('../dist/', import.meta.url).pathname;
if (!existsSync(join(DIST, 'sw.js'))) {
  console.error('pwa : dist/sw.js absent, lancer `npm run build` avant.');
  process.exit(1);
}

// ------------------------------------------------------------------ server: dist/, two versions of sw.js
let version = 1;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.csv': 'text/csv' };
const server = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  if (path.startsWith('/data/')) path = `/demo/${path.slice(6)}`; // the demo answers as real data
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  let body = readFileSync(file);
  // a new deployment: same precache, another sw.js (byte-different), as after a push to main
  if (path === '/sw.js' && version > 1) body = Buffer.concat([body, Buffer.from(`\n// version ${version}\n`)]);
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(body);
});
await new Promise((ok, ko) => server.once('error', ko).listen(PORT, ok)).catch((e) => {
  console.error(`E2E : port ${PORT} indisponible (${e.code}), définir E2E_PORT.`);
  process.exit(1);
});
const base = `http://localhost:${PORT}/`;

const errors = [];
const check = (ok, msg) => ok || errors.push(msg);
const t0 = Date.now();
const progress = (s) => console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${s}`);
const watch = (page, where) => {
  page.on('pageerror', (e) => errors.push(`${where} : ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${where} : console ${m.text()}`));
  page.on('response', (r) => r.status() >= 400 && !OPTIONAL.test(new URL(r.url()).pathname) && errors.push(`${where} : ${r.status()} ${r.url()}`));
};
/** Absent from a local build: build.json is written by the deploy workflow. */
const OPTIONAL = /^\/build\.json$/;
const ready = (page) => page.waitForSelector('#view[data-ready]', { state: 'attached', timeout: 60000 });
async function go(page, key) {
  await page.evaluate((k) => (location.hash = `#${k}`), key);
  await page.waitForSelector(`#view[data-page="${key}"][data-ready]`, { state: 'attached', timeout: 30000 });
}
async function audit(page, where) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  for (const v of violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'))
    errors.push(`${where} : axe « ${v.id} » → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}
/** 360 px, system text at 200 %: no horizontal scroll, every control of `sel` ≥ 44 px high. */
async function big(page, where, sel) {
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(wide <= 1, `${where} : défilement horizontal de ${wide} px à 200 %`);
  const small = await page.evaluate(
    (sel) => [...document.querySelectorAll(sel)].map((el) => [el.id || el.className, el.getBoundingClientRect()]).filter(([, r]) => r.height > 0 && (r.height < 43.5 || r.right > window.innerWidth + 1)).map(([n, r]) => `${n} ${Math.round(r.width)}×${Math.round(r.height)}`),
    sel,
  );
  check(!small.length, `${where} : cibles < 44 px ou hors écran → ${small.join(', ')}`);
}
/** Wait until this page is controlled by a worker (clients.claim() at the first visit). */
const controlled = (page) =>
  page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return true;
    await new Promise((r) => {
      navigator.serviceWorker.addEventListener('controllerchange', r, { once: true });
      setTimeout(r, 15000);
    });
    return !!navigator.serviceWorker.controller;
  });
/** What « Recharger l'application » must not touch: localStorage, the remembered key, the data cache. */
const kept = (page) =>
  page.evaluate(async () => {
    const ls = Object.fromEntries(Object.keys(localStorage).filter((k) => !k.endsWith(':state') && !k.endsWith(':activity')).sort().map((k) => [k, localStorage.getItem(k)]));
    const dbs = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name).sort() : [];
    const keys = await new Promise((res) => {
      const req = indexedDB.open(dbs.find((n) => n?.startsWith('intuis-history')) ?? 'intuis-history', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('keys');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('keys')) return (db.close(), res([]));
        const r = db.transaction('keys').objectStore('keys').getAllKeys();
        r.onsuccess = () => (db.close(), res(r.result));
        r.onerror = () => (db.close(), res(['?']));
      };
      req.onerror = () => res(['?']);
    });
    const names = await caches.keys();
    const data = names.find((n) => n.startsWith('energy-data'));
    const dataEntries = data ? (await (await caches.open(data)).keys()).length : 0;
    // an entry the app never fetches again by itself: a deleted cache cannot be refilled with it
    const marker = data ? !!(await (await caches.open(data)).match(new URL('data/e2e-marqueur.json', location.href).href)) : false;
    return { ls, dbs, keys, dataEntries, marker };
  });

const browser = await chromium.launch();
try {
  // ---------------------------------------------------------------- update and « Recharger l'application »
  {
    progress('première visite : service worker, aucun bandeau');
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true });
    const page = await ctx.newPage();
    watch(page, 'onglet 1');
    await page.goto(base);
    check(await controlled(page), 'première visite : la page n’est pas contrôlée par le service worker');
    await page.fill('#pass', 'demo');
    check(await page.isChecked('#remember'), '« Rester connecté » non coché');
    await page.click('#unlock button.primary');
    await ready(page);
    check((await page.locator('#update-banner').count()) === 0, 'première visite : bandeau « nouvelle version » affiché à tort');

    progress('À propos : carte Application');
    await go(page, 'parametres-apropos');
    await page.waitForSelector('#app-card #reload-app');
    check(/Prête pour une utilisation hors connexion/.test(await page.textContent('#offline-ready')), 'carte : « prête hors connexion » absent');
    check(/stockage/.test(await page.textContent('#persist-state')), 'carte : état du stockage absent');
    check((await page.locator('#install-app').count()) === 0, 'carte : bouton Installer sans invitation du navigateur');
    await audit(page, 'à propos');

    progress('Recharger l’application : clé, notes et données hors ligne gardées');
    // a note as the app writes them (sealed: only the value matters here) and the files of a page
    await page.evaluate(async () => {
      localStorage.setItem('intuis-history:notes:e2e', '{"iv":"AAAA","ct":"BBBB"}');
      const data = (await caches.keys()).find((n) => n.startsWith('energy-data'));
      await (await caches.open(data)).put(new URL('data/e2e-marqueur.json', location.href).href, new Response('{}'));
    });
    const before = await kept(page);
    check(before.keys.includes('data'), `avant : clé mémorisée absente (${JSON.stringify(before.keys)})`);
    check(before.dataEntries > 0 && before.marker, 'avant : cache des données chiffrées vide');
    await page.evaluate(() => (window.__avant = 1));
    await Promise.all([page.waitForEvent('load', { timeout: 30000 }), page.click('#reload-app')]);
    await ready(page);
    check((await page.locator('#pass').count()) === 0, 'Recharger l’application : la phrase de passe est redemandée');
    check(!(await page.evaluate(() => window.__avant)), 'Recharger l’application : la page n’a pas été rechargée');
    check(await controlled(page), 'Recharger l’application : pas de service worker après');
    const after = await kept(page);
    check(JSON.stringify(after.ls) === JSON.stringify(before.ls), `Recharger l’application : localStorage changé\n  avant ${JSON.stringify(before.ls)}\n  après ${JSON.stringify(after.ls)}`);
    check(JSON.stringify(after.keys) === JSON.stringify(before.keys), 'Recharger l’application : clé mémorisée changée');
    check(after.marker && after.dataEntries >= before.dataEntries, `Recharger l’application : cache des données ${before.dataEntries} → ${after.dataEntries} entrées`);
    const precache = await page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith('workbox-precache')).length);
    check(precache === 1, `Recharger l’application : ${precache} précache(s) après`);

    progress('nouvelle version : deux onglets, rien ne se recharge tout seul');
    const page2 = await ctx.newPage();
    watch(page2, 'onglet 2');
    await page2.goto(base);
    await ready(page2);
    check((await page2.locator('#pass').count()) === 0, 'onglet 2 : la clé mémorisée n’ouvre pas les données');
    for (const p of [page, page2]) await p.evaluate(() => (window.__avant = 1));
    version = 2;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    for (const [p, n] of [
      [page, 'onglet 1'],
      [page2, 'onglet 2'],
    ]) {
      await p.waitForSelector('#update-banner[role="status"] #update-reload', { timeout: 30000 }).catch(() => errors.push(`${n} : bandeau « nouvelle version » absent`));
      check(/Nouvelle version disponible/.test((await p.textContent('#update-banner').catch(() => '')) ?? ''), `${n} : texte du bandeau`);
    }
    // the version WAITS (no skipWaiting): the reverse would show here (seen red with skipWaiting: true)
    const waiting = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
    check(waiting, 'nouvelle version : elle ne reste pas en attente (activée sans le bouton)');
    for (const [p, n] of [
      [page, 'onglet 1'],
      [page2, 'onglet 2'],
    ])
      check(await p.evaluate(() => window.__avant === 1), `${n} : rechargé sans qu’on le demande`);
    // a reload does not activate it while another tab is open (#334): only the button does
    await page2.reload();
    await ready(page2);
    await page2.waitForSelector('#update-banner #update-reload', { timeout: 15000 }).catch(() => errors.push('onglet 2 rechargé : la version en attente n’est plus annoncée'));
    await page2.evaluate(() => (window.__avant = 1));
    await audit(page, 'bandeau');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${OUT}/pwa-bandeau.png` });
    await big(page, 'bandeau', '#update-banner button');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${OUT}/pwa-bandeau-200.png` });

    progress('« Recharger » dans l’onglet 1');
    await Promise.all([page.waitForEvent('load', { timeout: 30000 }), page.click('#update-reload')]);
    await ready(page);
    check(!(await page.evaluate(() => window.__avant)), 'onglet 1 : pas rechargé après « Recharger »');
    check((await page.locator('#pass').count()) === 0, 'onglet 1 : verrouillé après la mise à jour');
    check((await page.locator('#update-banner').count()) === 0, 'onglet 1 : bandeau encore là après la mise à jour');
    const sw = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return { waiting: !!r.waiting, active: r.active?.state };
    });
    check(!sw.waiting && sw.active === 'activated', `onglet 1 : nouvelle version non activée (${JSON.stringify(sw)})`);
    await page2.waitForFunction(() => /autre onglet/.test(document.getElementById('update-banner')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => errors.push('onglet 2 : le bandeau ne dit pas que l’autre onglet a activé la version'));
    check(await page2.evaluate(() => window.__avant === 1), 'onglet 2 : rechargé sans qu’on le demande');
    await Promise.all([page2.waitForEvent('load', { timeout: 30000 }), page2.click('#update-reload')]);
    await ready(page2);
    check((await page2.locator('#update-banner').count()) === 0, 'onglet 2 : bandeau encore là après « Recharger »');
    await ctx.close();
  }

  // ---------------------------------------------------------------- Installer
  const installable = () => {
    window.addEventListener('DOMContentLoaded', () => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = async () => {
        window.__prompted = (window.__prompted ?? 0) + 1;
      };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    });
  };
  async function aboutDemo(ctx, where) {
    const page = await ctx.newPage();
    watch(page, where);
    await page.goto(base);
    await page.click('#demo');
    await ready(page);
    await go(page, 'parametres-apropos');
    await page.waitForSelector('#app-card #reload-app');
    return page;
  }
  {
    progress('Installer : invitation reçue au chargement, bouton, puis plus rien (thème sombre)');
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, serviceWorkers: 'block', colorScheme: 'dark' });
    await ctx.addInitScript(installable);
    const page = await aboutDemo(ctx, 'installer');
    const btn = page.locator('#install-app');
    check((await btn.count()) === 1, 'installer : bouton absent après beforeinstallprompt');
    await audit(page, 'installer');
    await page.screenshot({ path: `${OUT}/pwa-a-propos.png`, fullPage: true });
    await big(page, 'à propos', '#app-card button');
    await page.screenshot({ path: `${OUT}/pwa-a-propos-200.png`, fullPage: true });
    await btn.click();
    await page.waitForFunction(() => !document.getElementById('install-app'), null, { timeout: 5000 }).catch(() => errors.push('installer : bouton encore là après l’installation'));
    check((await page.evaluate(() => window.__prompted)) === 1, 'installer : la fenêtre d’installation n’a pas été ouverte');
    check(await page.evaluate(() => document.activeElement?.id === 'app-card-title'), 'installer : le focus est perdu après l’installation');
    await ctx.close();
  }
  {
    progress('Installer : ouverte depuis son icône, rien ; iPhone, le geste de Safari');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.addInitScript(installable);
    await ctx.addInitScript(() => {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => (q.includes('display-mode: standalone') ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } : mm(q));
    });
    const page = await aboutDemo(ctx, 'installée');
    check((await page.locator('#install-app, #install-how').count()) === 0, 'installée : invitation à installer affichée');
    await ctx.close();
    const ios = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: 'block',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    const p2 = await aboutDemo(ios, 'iphone');
    check((await p2.locator('#install-app').count()) === 0, 'iPhone : bouton Installer sans effet affiché');
    check(/Partager.*Sur l.écran d.accueil/.test((await p2.textContent('#install-how').catch(() => '')) ?? ''), 'iPhone : geste Partager → « Sur l’écran d’accueil » absent');
    await ios.close();
  }

  // ---------------------------------------------------------------- offline, nothing kept
  {
    progress('hors ligne sans rien de gardé : un écran qui le dit');
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, serviceWorkers: 'block', contrast: 'more' });
    await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false }));
    await ctx.route('**/data/keyinfo.json', (r) => r.abort('internetdisconnected'));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`hors ligne : ${e.message}`));
    await page.goto(base);
    await page.waitForSelector('.offline-screen h1', { timeout: 15000 }).catch(() => errors.push('hors ligne : écran absent'));
    check((await page.locator('#pass').count()) === 0, 'hors ligne : formulaire de phrase de passe affiché pour rien');
    await audit(page, 'hors ligne');
    await big(page, 'hors ligne', '#offline-retry');
    await page.screenshot({ path: `${OUT}/pwa-hors-ligne.png`, fullPage: true });
    await ctx.close();
  }
} catch (e) {
  errors.push(`exception : ${e.stack ?? e}`);
} finally {
  await browser.close();
  server.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`PWA : OK (captures dans ${OUT})`);
