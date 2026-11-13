// #463: the error of the GitHub token in ⚙ Sources de données. The demo files are served as real
// data (passphrase « demo ») and GitHub's API is answered by the test (no network): the
// connection is refused twice (403, as just after a change of permissions), then accepted.
// - the message names the call and the permission, never the token nor the repository;
// - a new attempt clears the message first, and a new failure says it is a new one;
// - « Réessayer » tries again, with the mention that a change of permissions may take a minute.
// Run after `npm run build`: node e2e/jeton.mjs (port: E2E_PORT; E2E_BROWSER=webkit|chromium).
// Captures in e2e/screenshots/jeton-*.png.
import { chromium, webkit } from 'playwright';
import { frames, openData, seriousAxe, startPreview } from './lib.mjs';
import { capturesOut } from './captures.mjs';

const BROWSER = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const OUT = capturesOut(); // #583: e2e/screenshots/ only in the CI's font
const { base, stop } = await startPreview(Number(process.env.E2E_PORT ?? 4198));
const errors = [];
const check = (ok, msg) => ok || errors.push(`${BROWSER}: ${msg}`);
const browser = await (BROWSER === 'webkit' ? webkit : chromium).launch();
const TOKEN = 'github_pat_FICTIF_pour_le_test';
const REPO = 'proprietaire-fictif/depot-fictif';

try {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: BROWSER === 'chromium', serviceWorkers: 'block' });
  // the demo's files answer as the data of the site (made-up values, passphrase « demo »)
  await ctx.route(
    (url) => url.pathname.startsWith('/data/'),
    async (r) => r.fulfill({ response: await r.fetch({ url: `${base}demo/${new URL(r.request().url()).pathname.slice('/data/'.length)}` }) }),
  );
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem('intuis-history:state')) localStorage.setItem('intuis-history:state', '{}'); // a device already used: no first launch
    } catch {}
  });
  // GitHub: the list of secrets refused twice, then given; each answer waits for the test
  let calls = 0;
  let onArrive = null;
  let release = () => {};
  /** The next request to GitHub has arrived (and waits for `release`). */
  const arrival = () => new Promise((res) => (onArrive = res));
  /** At most 5 s (a guard, not a delay: it ends as soon as `p` does). */
  const within = (p) => Promise.race([p, new Promise((r) => setTimeout(r, 5000))]);
  await ctx.route('https://api.github.com/**', async (r) => {
    const url = new URL(r.request().url());
    if (!url.pathname.endsWith('/actions/secrets')) return r.fulfill({ status: 404, body: '' });
    calls += 1;
    const go = new Promise((res) => (release = res));
    onArrive?.();
    await go;
    if (calls <= 2) return r.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"Resource not accessible by personal access token"}' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total_count: 1, secrets: [{ name: 'INTUIS_USERNAME' }] }) });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${BROWSER}: erreur JS ${e.message}`));
  await openData(page, base, 'demo', 'parametres-sources');

  const bad = page.locator('#settings-msg .alert.bad');
  const retry = page.locator('#settings-retry');

  await page.locator('#gh-login input[name="repo"]').fill(REPO);
  await page.locator('#gh-login input[name="token"]').fill(TOKEN);
  let arrived = arrival();
  await page.locator('#gh-login-btn').click();
  await within(arrived);
  release();
  await bad.waitFor({ timeout: 10000 }).catch(() => errors.push(`${BROWSER}: premier échec : aucun message`));
  const first = await bad.innerText().catch(() => '');
  check(/lecture de la liste des secrets/.test(first), `le message ne nomme pas l'appel en cause (« ${first} »)`);
  check(/« Secrets » en lecture/.test(first), `le message ne nomme pas la permission en cause (« ${first} »)`);
  for (const secret of [TOKEN, REPO, 'proprietaire-fictif', 'depot-fictif']) check(!first.includes(secret), `le message contient « ${secret} »`);
  check(/une minute/.test(await page.locator('#settings-msg').innerText().catch(() => '')), 'pas de mention du délai de GitHub après un changement de droits');
  check(await retry.isVisible().catch(() => false), 'pas de bouton « Réessayer »');
  for (const v of await seriousAxe(page)) errors.push(`${BROWSER} échec du jeton : axe « ${v.id} » → ${v.targets.join(' | ')}`);
  await page.locator('#settings-msg').screenshot({ path: `${OUT}/jeton-${BROWSER}-echec.png` });
  // text at 200 %: the message and its button stay within the screen
  const big = await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await frames(page);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(over <= 1, `200 % : la page déborde de ${over} px avec le message d'échec`);
  await page.locator('#settings-msg').screenshot({ path: `${OUT}/jeton-${BROWSER}-echec-200.png` });
  await big.evaluate((s) => s.remove());

  // « Réessayer »: the old message goes at once, a new failure says it is a new one
  arrived = arrival();
  await retry.click().catch(() => errors.push(`${BROWSER}: « Réessayer » introuvable`));
  await within(arrived);
  await frames(page);
  check((await bad.count()) === 0, 'l’ancien message d’échec reste affiché pendant le nouvel essai');
  release();
  await bad.waitFor({ timeout: 10000 }).catch(() => errors.push(`${BROWSER}: second échec : aucun message`));
  const second = await bad.innerText().catch(() => '');
  check(second !== first && /essai 2/.test(second), `le second échec ne se distingue pas du premier (« ${second} »)`);

  // the permissions took effect at GitHub: the third attempt connects
  arrived = arrival();
  await retry.click().catch(() => errors.push(`${BROWSER}: « Réessayer » absent après le second échec`));
  await within(arrived);
  release();
  await page.waitForFunction(() => /Connecté à/.test(document.getElementById('settings-msg')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
  const ok = await page.locator('#settings-msg').innerText().catch(() => '');
  check(/Connecté à .* 1 secret déjà enregistré/.test(ok), `troisième essai : connexion non annoncée (« ${ok} »)`);
  check((await bad.count()) === 0 && (await retry.count()) === 0, 'message d’échec ou « Réessayer » restés après la connexion');
  check(calls === 3, `${calls} appels à GitHub au lieu de 3`);
  await ctx.close();
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
console.log(`${BROWSER} : erreur du jeton nommée, effacée à chaque essai, « Réessayer »`);
