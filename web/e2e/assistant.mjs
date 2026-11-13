// #40: the first-launch assistant. GitHub's API is answered by the test (no network), for a
// fictitious repository: the collection workflow stopped, one Intuis secret out of four, no
// passphrase, never collected.
// - ⚙ Sources de données → « Ouvrir l'assistant »: loaded on demand; the token checks what is done;
//   the app enables the collection and seals the missing Intuis secrets itself (never in clear);
//   the passphrase and GitHub Pages are gestures by hand, with the link to the right page;
//   once the owner has added the passphrase, the first collection is run with the whole history;
//   every call goes to api.github.com for this repository only; axe; 200 % at 360 px;
// - in the demo: a fictitious example, no call to GitHub, nothing to click;
// - the lock screen of a site without data offers the assistant.
// Run after `npm run build`: node e2e/assistant.mjs (port: E2E_PORT; E2E_BROWSER=webkit|chromium).
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { frames, openData, ready, seriousAxe, startPreview } from './lib.mjs';

const BROWSER = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const OUT = process.env.E2E_OUT ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const { base, stop } = await startPreview(Number(process.env.E2E_PORT ?? 4197));
const errors = [];
const check = (ok, msg) => ok || errors.push(`${BROWSER}: ${msg}`);
const browser = await (BROWSER === 'webkit' ? webkit : chromium).launch();
const TOKEN = 'github_pat_FICTIF_pour_le_test';
const REPO = 'proprietaire-fictif/depot-fictif';
const PASSWORD = 'mot-de-passe-fictif-du-test';
const KEY = randomBytes(32).toString('base64'); // a public key for the sealed boxes (never opened here)
const step = (page, id) => page.locator(`#setup-zone li[data-step="${id}"]`);
const status = (page, id) => step(page, id).getAttribute('data-status');
/** Wait for the assistant to have read GitHub again (the summary is redrawn, no « Vérification… »). */
const settled = (page) => page.waitForFunction(() => !/Vérification|En cours/.test(document.getElementById('setup-msg')?.textContent ?? '') && !!document.getElementById('setup-summary'), null, { timeout: 15000 });

/** A fictitious repository as GitHub would answer about it; `calls` records what was asked. */
function fakeGitHub() {
  const gh = { secrets: new Set(['INTUIS_USERNAME']), state: 'disabled_inactivity', runs: [], calls: [], puts: [], dispatched: null, failPut: null };
  gh.handle = async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    gh.calls.push({ method, url: req.url(), auth: req.headers().authorization ?? '' });
    const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const repo = `/repos/${REPO}`;
    if (!path.startsWith(`${repo}/`)) return r.fulfill({ status: 404, body: '' });
    const rest = path.slice(repo.length);
    if (rest === '/actions/secrets' && method === 'GET') return json({ total_count: gh.secrets.size, secrets: [...gh.secrets].map((name) => ({ name })) });
    if (rest === '/actions/secrets/public-key') return json({ key: KEY, key_id: 'cle-fictive' });
    const put = /^\/actions\/secrets\/([A-Z_]+)$/.exec(rest);
    if (put && method === 'PUT') {
      if (gh.failPut === put[1]) {
        gh.failPut = null; // once: GitHub answers again on the next try
        return json({ message: 'Service Unavailable' }, 503);
      }
      gh.puts.push({ name: put[1], body: req.postData() ?? '' });
      gh.secrets.add(put[1]);
      return r.fulfill({ status: 201, body: '' });
    }
    if (rest === '/actions/workflows/collect.yml') return json({ id: 7, name: 'Collecte quotidienne', state: gh.state });
    if (rest === '/actions/workflows/collect.yml/enable' && method === 'PUT') {
      gh.state = 'active';
      return r.fulfill({ status: 204, body: '' });
    }
    if (rest === '/actions/workflows/collect.yml/runs') return json({ total_count: gh.runs.length, workflow_runs: gh.runs });
    if (/^\/actions\/runs\/\d+\/jobs$/.test(rest)) return json({ total_count: 0, jobs: [] });
    if (rest === '/actions/workflows/collect.yml/dispatches' && method === 'POST') {
      gh.dispatched = JSON.parse(req.postData() ?? 'null');
      gh.runs = [{ id: 99, status: 'in_progress', conclusion: null, html_url: `https://github.com/${REPO}/actions/runs/99`, created_at: '2026-11-12T20:00:00Z' }];
      return r.fulfill({ status: 204, body: '' });
    }
    return r.fulfill({ status: 404, body: '' });
  };
  return gh;
}

const newContext = () => browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: BROWSER === 'chromium', serviceWorkers: 'block' });
const noFirstLaunch = (ctx) =>
  ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem('intuis-history:state')) localStorage.setItem('intuis-history:state', '{}'); // a device already used: no first launch
    } catch {}
  });

try {
  // ---------------------------------------------------------------- real data: ⚙ Sources de données
  {
    const ctx = await newContext();
    await ctx.route(
      (url) => url.pathname.startsWith('/data/'),
      async (r) => r.fulfill({ response: await r.fetch({ url: `${base}demo/${new URL(r.request().url()).pathname.slice('/data/'.length)}` }) }),
    );
    await noFirstLaunch(ctx);
    const gh = fakeGitHub();
    await ctx.route('https://api.github.com/**', gh.handle);
    const chunks = [];
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${BROWSER}: erreur JS ${e.message}`));
    page.on('request', (r) => /\/assets\/setup-[^/]*\.js$/.test(r.url()) && chunks.push(r.url()));
    await openData(page, base, 'demo', 'parametres-sources');
    check(chunks.length === 0, 'l’assistant est chargé avant qu’on l’ouvre (il doit l’être à la demande)');
    await page.locator('#setup-open').click();
    await page.waitForSelector('#setup-title', { timeout: 15000 });
    check(chunks.length === 1, `module de l’assistant chargé ${chunks.length} fois`);
    check((await page.evaluate(() => document.activeElement?.id)) === 'setup-title', 'le focus ne va pas sur le titre de l’assistant');
    check(gh.calls.length === 0, 'GitHub appelé avant la saisie du jeton');
    // #533: the token to create is told once on this page (the card « 1. Autoriser… » says it)
    const advice = await page.evaluate(() => (document.querySelector('main')?.innerText.match(/fine-grained/g) ?? []).length);
    check(advice === 1, `Sources de données : le texte du jeton à créer est dit ${advice} fois avec l’assistant ouvert`);
    const tall200 = await page.evaluate(async () => {
      const s = document.createElement('style');
      s.textContent = 'html { font-size: 200% !important; }';
      document.head.append(s);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const h = document.documentElement.scrollHeight / window.innerHeight;
      s.remove();
      return h;
    });
    console.log(`${BROWSER} : Sources de données, assistant ouvert, 200 % : ${tall200.toFixed(1)} écrans`);

    // #533 (#259): a repository in the wrong form keeps the token typed, nothing is sent
    await page.locator('#setup-login input[name="repo"]').fill('pas-un-depot');
    await page.locator('#setup-login input[name="token"]').fill(TOKEN);
    await page.locator('#setup-check').click();
    check((await page.locator('#setup-login input[name="token"]').inputValue()) === TOKEN, 'dépôt mal formé : le jeton collé est effacé');
    check((await page.locator('#setup-login input[name="repo"]').getAttribute('aria-invalid')) === 'true', 'dépôt mal formé : le champ n’est pas signalé');
    check((await page.evaluate(() => document.activeElement?.getAttribute('name'))) === 'repo', 'dépôt mal formé : le focus ne va pas sur le dépôt');
    check(gh.calls.length === 0, 'dépôt mal formé : GitHub appelé');

    await page.locator('#setup-login input[name="repo"]').fill(REPO);
    await page.locator('#setup-login input[name="token"]').fill(TOKEN);
    await page.locator('#setup-check').click();
    await settled(page);
    check((await status(page, 'jeton')) === 'fait', 'jeton : pas « fait »');
    check((await status(page, 'actions')) === 'a-faire' && (await page.locator('#setup-enable').count()) === 1, 'collecte arrêtée : pas de bouton « Activer »');
    check((await status(page, 'phrase')) === 'a-faire', 'phrase de passe : pas « à faire »');
    check(
      (await step(page, 'phrase').locator('a').getAttribute('href')) === `https://github.com/${REPO}/settings/secrets/actions/new`,
      'phrase de passe : pas de lien vers « New repository secret »',
    );
    check((await step(page, 'phrase').locator('input, button').count()) === 0, 'phrase de passe : l’appli propose de l’écrire');
    check((await status(page, 'intuis')) === 'a-faire' && (await page.locator('#setup-intuis input').count()) === 4, 'Intuis : pas de champs pour les secrets manquants');
    check((await status(page, 'pages')) === 'a-verifier' && (await step(page, 'pages').locator('a').getAttribute('href')) === `https://github.com/${REPO}/settings/pages`, 'Pages : pas « à vérifier » avec le lien');
    check((await page.locator('#setup-run').count()) === 0, 'collecte proposée avant les secrets');
    for (const v of await seriousAxe(page)) errors.push(`${BROWSER} assistant : axe « ${v.id} » → ${v.targets.join(' | ')}`);
    const big = await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await frames(page);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(over <= 1, `200 % : la page déborde de ${over} px avec l’assistant`);
    await page.locator('#setup-zone').screenshot({ path: `${OUT}/assistant-${BROWSER}-200.png` });
    await big.evaluate((s) => s.remove());
    await page.locator('#setup-zone').screenshot({ path: `${OUT}/assistant-${BROWSER}.png` });

    // what the token allows, the app does: enable the workflow, seal the Intuis secrets
    await page.locator('#setup-enable').click();
    await settled(page);
    check(gh.state === 'active' && (await status(page, 'actions')) === 'fait', 'collecte : non réactivée');
    // #533: GitHub fails on the 2nd of three secrets: the assistant reads it again, the first is saved
    gh.failPut = 'INTUIS_CLIENT_ID';
    await page.locator('#setup-intuis input[name="INTUIS_PASSWORD"]').fill(PASSWORD);
    await page.locator('#setup-intuis input[name="INTUIS_CLIENT_ID"]').fill('identifiant-fictif');
    await page.locator('#setup-intuis input[name="INTUIS_CLIENT_SECRET"]').fill('secret-fictif-du-test');
    await page.locator('#setup-intuis-save').click();
    await settled(page);
    const partial = await step(page, 'intuis').innerText();
    check(/INTUIS_CLIENT_ID, INTUIS_CLIENT_SECRET/.test(partial) && !/INTUIS_PASSWORD/.test(partial), `échec au 2ᵉ secret : l’étape n’est pas relue (« ${partial.replace(/\s+/g, ' ')} »)`);
    check((await page.locator('#setup-msg').innerText()).trim() !== '', 'échec au 2ᵉ secret : l’erreur n’est pas dite');
    await page.locator('#setup-intuis input[name="INTUIS_CLIENT_ID"]').fill('identifiant-fictif');
    await page.locator('#setup-intuis input[name="INTUIS_CLIENT_SECRET"]').fill('secret-fictif-du-test');
    await page.locator('#setup-intuis-save').click();
    await settled(page);
    check(gh.puts.map((p) => p.name).sort().join() === 'INTUIS_CLIENT_ID,INTUIS_CLIENT_SECRET,INTUIS_PASSWORD', `secrets envoyés : ${gh.puts.map((p) => p.name).join(', ')}`);
    check(gh.puts.every((p) => /"encrypted_value":"[A-Za-z0-9+/=]{40,}"/.test(p.body) && !p.body.includes(PASSWORD) && !p.body.includes('secret-fictif')), 'un secret est parti en clair');
    check((await status(page, 'intuis')) === 'fait', 'Intuis : pas « fait » après l’enregistrement');
    check(/2 secrets chiffrés et enregistrés/.test(await page.locator('#setup-msg').innerText()), 'Intuis : enregistrement non annoncé');
    check((await page.locator('#setup-run').count()) === 0, 'collecte proposée sans la phrase de passe');

    // the owner adds DATA_PASSPHRASE in GitHub by hand, then « Vérifier à nouveau »
    gh.secrets.add('DATA_PASSPHRASE');
    await page.locator('#setup-recheck').click();
    await settled(page);
    check((await status(page, 'phrase')) === 'fait', 'phrase de passe : pas « fait » une fois ajoutée');
    await page.locator('#setup-run').click().catch(() => errors.push(`${BROWSER}: « Lancer la première collecte » absent`));
    await settled(page);
    check(JSON.stringify(gh.dispatched) === JSON.stringify({ ref: 'main', inputs: { backfill: true } }), `collecte lancée avec ${JSON.stringify(gh.dispatched)}`);
    check((await status(page, 'collecte')) === 'en-cours', 'collecte : pas « en cours » après le lancement');

    // every call: api.github.com, this repository, the token in the header only
    for (const c of gh.calls) {
      check(c.url.startsWith(`https://api.github.com/repos/${REPO}/`), `appel hors du dépôt : ${c.method} ${c.url}`);
      check(c.auth === `Bearer ${TOKEN}` && !c.url.includes(TOKEN), `jeton mal transmis : ${c.method} ${c.url}`);
    }
    const text = await page.locator('#setup-zone').innerText();
    for (const secret of [TOKEN, PASSWORD]) check(!text.includes(secret), `l’assistant affiche « ${secret} »`);
    await ctx.close();
  }

  // ---------------------------------------------------------------- demo: fictitious, no call
  {
    const ctx = await newContext();
    await noFirstLaunch(ctx);
    const calls = [];
    await ctx.route('https://api.github.com/**', (r) => {
      calls.push(r.request().url());
      return r.fulfill({ status: 404, body: '' });
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${BROWSER} démo : erreur JS ${e.message}`));
    await page.goto(`${base}#parametres-sources`);
    await page.locator('#demo').click();
    await ready(page);
    await page.locator('#setup-open').click();
    await page.waitForSelector('#setup-demo', { timeout: 15000 });
    check(/exemple\/historique-energie/.test(await page.locator('#setup-zone').innerText()), 'démo : dépôt fictif absent');
    check((await page.locator('#setup-zone button:not([disabled])').count()) === 0, 'démo : un bouton de l’assistant agit');
    check((await page.locator('#setup-zone li[data-status="fait"]').count()) > 0 && (await page.locator('#setup-zone li[data-status="a-faire"]').count()) > 0, 'démo : pas un dépôt à moitié installé');
    check(calls.length === 0, `démo : ${calls.length} appel(s) à GitHub`);
    for (const v of await seriousAxe(page)) errors.push(`${BROWSER} assistant (démo) : axe « ${v.id} » → ${v.targets.join(' | ')}`);
    await ctx.close();
  }

  // ---------------------------------------------------------------- lock screen, nothing collected
  {
    const ctx = await newContext();
    await ctx.route((url) => url.pathname.startsWith('/data/'), (r) => r.fulfill({ status: 404, body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${BROWSER} verrou : erreur JS ${e.message}`));
    await page.goto(base);
    await page.locator('#setup-lock').click({ timeout: 15000 });
    await page.waitForSelector('#setup-login', { timeout: 15000 });
    check((await page.locator('#pass').count()) === 0, 'verrou : formulaire de phrase sans données');
    for (const v of await seriousAxe(page)) errors.push(`${BROWSER} assistant (verrou) : axe « ${v.id} » → ${v.targets.join(' | ')}`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(over <= 1, `verrou : la page déborde de ${over} px avec l’assistant`);
    // #533 (revue design v2.0): the summary does not stick to the paragraph of the token
    const gap = await page.evaluate(() => document.getElementById('setup-summary').getBoundingClientRect().top - document.getElementById('setup-advice').getBoundingClientRect().bottom);
    check(gap >= 6, `verrou : le résumé colle au paragraphe du jeton (${gap.toFixed(1)} px)`);
    check(/fine-grained/.test(await page.locator('#setup-advice').innerText()), 'verrou : le jeton à créer n’est pas décrit (pas d’autre carte sur cet écran)');

    // revue v2.0: a mistyped repository (or a token without the right access) is not a dead end:
    // on this screen there is no ⚙ Paramètres to change it, the assistant itself must allow it
    const gh = fakeGitHub();
    await ctx.route('https://api.github.com/**', gh.handle);
    await page.locator('#setup-login input[name="repo"]').fill('proprietaire-fictif/depot-mal-tape');
    await page.locator('#setup-login input[name="token"]').fill(TOKEN);
    await page.locator('#setup-check').click();
    await settled(page);
    check((await page.locator('#setup-change').count()) === 1, 'verrou : dépôt mal tapé, rien pour changer de dépôt ou de jeton');
    await page.locator('#setup-change').click({ timeout: 5000 }).catch(() => {});
    await page.waitForSelector('#setup-login', { timeout: 5000 }).catch(() => {});
    check((await page.locator('#setup-login input[name="repo"]').inputValue().catch(() => '')) === 'proprietaire-fictif/depot-mal-tape', 'verrou : le dépôt tapé n’est pas repris pour être corrigé');
    if (await page.locator('#setup-login').count()) {
      await page.locator('#setup-login input[name="repo"]').fill(REPO);
      await page.locator('#setup-login input[name="token"]').fill(TOKEN);
      await page.locator('#setup-check').click();
      await settled(page);
      check((await status(page, 'intuis')) === 'a-faire', 'verrou : le bon dépôt n’est pas relu après le changement');
    }
    check(gh.calls.every((c) => c.auth === `Bearer ${TOKEN}`), 'verrou : jeton mal transmis après le changement');
    await ctx.close();
  }
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
console.log(`${BROWSER} : assistant de premier lancement (vérifie, fait ce que le jeton permet, renvoie au reste)`);
