// #524: the app opened in plain HTTP on an address other than localhost (the NAS copy before its
// HTTPS proxy, docs/nas-copie-locale.md § 4). The page is served by the test at http://nas.test/
// (requests answered from the preview server: no network, no DNS), which the browser does not
// count as a secure context, so WebCrypto is absent, as on the NAS.
// - the lock screen says so before anything is typed, with the way to the NAS guide;
// - the passphrase, « Déverrouiller » and the demo are disabled (nothing could be decrypted);
// - no JavaScript error; the message is read without scrolling (heights printed for the PR);
// - on localhost (secure), none of it.
// Run after `npm run build`: node e2e/http.mjs (port: E2E_PORT; E2E_BROWSER=webkit|chromium).
// Captures in e2e/screenshots/http-*.png.
import { mkdirSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { seriousAxe, startPreview } from './lib.mjs';

const BROWSER = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const OUT = process.env.E2E_OUT ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const { base, stop } = await startPreview(Number(process.env.E2E_PORT ?? 4199));
const errors = [];
const check = (ok, msg) => ok || errors.push(`${BROWSER}: ${msg}`);
const browser = await (BROWSER === 'webkit' ? webkit : chromium).launch();
const NAS = 'http://nas.test/';

/** A context whose pages see the demo's files as the data of the site (made-up values). */
async function context() {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: BROWSER === 'chromium', serviceWorkers: 'block' });
  await ctx.route(
    (url) => url.pathname.startsWith('/data/') && url.hostname === 'localhost',
    async (r) => r.fulfill({ response: await r.fetch({ url: `${base}demo/${new URL(r.request().url()).pathname.slice('/data/'.length)}` }) }),
  );
  // http://nas.test/… is answered from the preview server (data/ from the demo's files)
  await ctx.route(`${NAS}**`, async (r) => {
    const path = new URL(r.request().url()).pathname.slice(1);
    const target = path.startsWith('data/') ? `${base}demo/${path.slice('data/'.length)}` : `${base}${path}`;
    return r.fulfill({ response: await r.fetch({ url: target }) });
  });
  return ctx;
}

/** Height of the page and of the screen, the lock screen drawn. */
const heights = (page) => page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]);

try {
  // Insecure: http://nas.test/
  const ctx = await context();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${BROWSER}: erreur JS ${e.message}`));
  await page.goto(NAS);
  await page.waitForSelector('.lock-card', { timeout: 30000 });
  const [secure, subtle] = await page.evaluate(() => [window.isSecureContext, !!globalThis.crypto?.subtle]);
  check(secure === false && !subtle, `la page de test devait être un contexte non sûr (isSecureContext ${secure}, subtle ${subtle})`);
  const alert = page.locator('#lock-insecure');
  await alert.waitFor({ timeout: 10000 }).catch(() => errors.push(`${BROWSER}: aucun message sur une page en HTTP`));
  const text = await alert.innerText().catch(() => '');
  check(/HTTPS ou sur localhost/.test(text), `message sans la marche à suivre (« ${text} »)`);
  const doc = await alert.locator('a').getAttribute('href').catch(() => null);
  check(doc?.endsWith('/docs/nas-copie-locale.md') ?? false, `pas de renvoi vers docs/nas-copie-locale.md (${doc})`);
  for (const sel of ['#pass', '#unlock button.primary', '#demo']) check(await page.locator(sel).isDisabled(), `${sel} reste actif sur une page en HTTP`);
  const [h, screenH] = await heights(page);
  console.log(`${BROWSER} : écran de déverrouillage en HTTP, ${h} px pour un écran de ${screenH} px`);
  // the message is read without scrolling (the page itself was already longer than a screen)
  const bottom = await alert.evaluate((el) => el.getBoundingClientRect().bottom);
  check(bottom <= screenH, `le message HTTP finit à ${Math.round(bottom)} px, sous le premier écran (${screenH} px)`);
  for (const v of await seriousAxe(page)) errors.push(`${BROWSER}: axe ${v.id} ${v.targets.join(', ')}`);
  await page.screenshot({ path: `${OUT}/${BROWSER}-http-verrou.png`, fullPage: true });
  await ctx.close();

  // Secure (localhost): no message, everything active
  const ctx2 = await context();
  const ok = await ctx2.newPage();
  ok.on('pageerror', (e) => errors.push(`${BROWSER}: erreur JS ${e.message}`));
  await ok.goto(base);
  await ok.waitForSelector('#unlock', { timeout: 30000 });
  check((await ok.locator('#lock-insecure').count()) === 0, 'message HTTP affiché sur localhost');
  for (const sel of ['#pass', '#unlock button.primary', '#demo']) check(await ok.locator(sel).isEnabled(), `${sel} désactivé sur localhost`);
  const [h2] = await heights(ok);
  console.log(`${BROWSER} : écran de déverrouillage sur localhost, ${h2} px (en HTTP : ${h} px, +${h - h2} px)`);
  await ctx2.close();
} catch (e) {
  errors.push(`${BROWSER}: ${e.stack ?? e}`);
} finally {
  await browser.close();
  stop();
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`${BROWSER} : page en HTTP hors localhost, message clair et rien à déverrouiller`);
