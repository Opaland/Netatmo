// #357 (PWA part of the « smoke test du site en ligne » of #353): the published site, after each
// Pages deployment, in the DEMO only (fictive data; the real data are never opened here, no
// capture, no artefact: the repository is public).
// - build.json reaches the deployed commit within 2 minutes (Pages may serve the previous one);
// - manifest.webmanifest: id, ≥ 3 shortcuts, a maskable icon, each icon served;
// - sw.js served, registered, and controlling the page;
// - the demo opens; no JavaScript error, no file of the site answering 4xx / 5xx.
// Run: SITE_URL=https://<compte>.github.io/<dépôt>/ EXPECTED_COMMIT=<sha> node e2e/en-ligne.mjs
// Without SITE_URL: skipped (exit 0) with the reason.
import { chromium } from 'playwright';

const SITE = process.env.SITE_URL;
if (!SITE) {
  console.log('Site en ligne : SITE_URL absent, sonde sautée.');
  process.exit(0);
}
const base = SITE.endsWith('/') ? SITE : `${SITE}/`;
const want = process.env.EXPECTED_COMMIT ?? '';
const errors = [];
const check = (ok, msg) => ok || errors.push(msg);

// ---------------------------------------------------------------- build.json → the deployed commit
const until = Date.now() + 120_000;
let commit = '';
for (;;) {
  try {
    const r = await fetch(`${base}build.json?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) commit = (await r.json()).commit ?? '';
  } catch {}
  if (!want || commit === want || Date.now() > until) break;
  await new Promise((r) => setTimeout(r, 5000));
}
check(/^[0-9a-f]{40}$/.test(commit), `build.json : commit illisible (${commit || 'absent'})`);
if (want) check(commit === want, `build.json : ${commit.slice(0, 12)} servi au lieu de ${want.slice(0, 12)} après 2 min`);

// ---------------------------------------------------------------- manifest and its icons
try {
  const r = await fetch(`${base}manifest.webmanifest`, { cache: 'no-store' });
  check(r.ok, `manifeste : ${r.status}`);
  const m = await r.json();
  check(typeof m.id === 'string' && m.id.length > 0, 'manifeste : id absent');
  check(Array.isArray(m.shortcuts) && m.shortcuts.length >= 3, 'manifeste : moins de 3 raccourcis');
  check(m.icons?.some((i) => i.purpose === 'maskable'), 'manifeste : icône maskable absente');
  for (const i of m.icons ?? []) {
    const ir = await fetch(new URL(i.src, `${base}manifest.webmanifest`), { cache: 'no-store' });
    check(ir.ok, `manifeste : icône ${i.src} → ${ir.status}`);
  }
  const sw = await fetch(`${base}sw.js`, { cache: 'no-store' });
  check(sw.ok && /precacheAndRoute/.test(await sw.text()), `sw.js : ${sw.status}`);
} catch (e) {
  errors.push(`manifeste : ${e.message}`);
}

// ---------------------------------------------------------------- the page, its worker, the demo
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const origin = new URL(base).origin;
  page.on('pageerror', (e) => errors.push(`page : ${e.message}`));
  page.on('response', (r) => {
    const u = new URL(r.url());
    // keyinfo.json may be absent (no real data yet): the lock screen says so
    if (u.origin === origin && r.status() >= 400 && !/\/data\/keyinfo\.json$/.test(u.pathname)) errors.push(`${r.status()} ${u.pathname}`);
  });
  await page.goto(base, { waitUntil: 'load' });
  const controlled = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return true;
    await new Promise((r) => {
      navigator.serviceWorker.addEventListener('controllerchange', r, { once: true });
      setTimeout(r, 15000);
    });
    return !!navigator.serviceWorker.controller;
  });
  check(controlled, 'service worker : la page n’est pas contrôlée');
  await page.click('#demo');
  await page.waitForSelector('#view[data-ready]', { state: 'attached', timeout: 60000 }).catch(() => errors.push('démo : ne s’ouvre pas'));
  await ctx.close();
} finally {
  await browser.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Site en ligne : OK (${base}, commit ${commit.slice(0, 12)})`);
