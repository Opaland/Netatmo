// v1.6 #312 (premier lancement) and #316 (vue Proche), on Chromium:
// - first unlock on a fresh device (the demo files answer as real data, passphrase « demo »):
//   the four screens open by themselves, focus on each title, « Étape n sur 4 », skippable;
//   « Un proche » ends on the simple view; seen once (not again after a reload); the tip
//   « Touchez une pièce pour son détail » shows once on Pièces;
// - the simple view: three tabs, Ma pièce chosen then pinned, Aide, « Voir plus de détails »
//   with its confirmation; « Revoir la présentation » in ⚙ (demo: nothing is written);
// - axe light and dark, 360 px with the system text at 200 % without horizontal scroll.
// Run after `npm run build`: node e2e/proche.mjs   (port E2E_PORT, default 4184)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const PORT = Number(process.env.E2E_PORT ?? 4184);
const OUT = process.env.E2E_OUT ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const base = `http://localhost:${PORT}/`;
const errors = [];
const check = (ok, msg) => ok || errors.push(msg);
const t0 = Date.now();
const progress = (s) => console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${s}`);

const page = (p, key) => p.waitForSelector(`#view[data-page="${key}"][data-ready]`, { state: 'attached', timeout: 60000 });
const frame = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

async function audit(p, where) {
  const { violations } = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  for (const v of violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'))
    errors.push(`${where} : axe « ${v.id} » ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

/** No horizontal scroll, and no control under 44 px high (design system). */
async function layout(p, where) {
  const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (wide > 1) errors.push(`${where} : défilement horizontal de ${wide} px`);
  const small = await p.evaluate(() =>
    [...document.querySelectorAll('#view .btn, #view .radio-card, .onboarding-top .btn, .onb-tip .btn')]
      .map((el) => [el, el.getBoundingClientRect()])
      .filter(([, r]) => r.height > 0 && r.height < 43.5)
      .map(([el, r]) => `${el.textContent.trim().slice(0, 30)} ${Math.round(r.height)} px`),
  );
  if (small.length) errors.push(`${where} : cibles < 44 px → ${small.slice(0, 4).join(', ')}`);
  // no word of a title or of a tab label is cut over two lines, and none is wider than its box
  const cut = await p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#view :is(h2, h3, .proche-strong, .onb-hero), .tabs a span')) {
      if (!el.getClientRects().length || el.classList.contains('sr-only')) continue;
      if (el.scrollWidth > el.clientWidth + 1) out.push(`« ${el.textContent.trim().slice(0, 30)} » déborde`);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        for (const m of n.data.matchAll(/\S+/g)) {
          const r = document.createRange();
          r.setStart(n, m.index);
          r.setEnd(n, m.index + m[0].length);
          const tops = new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
          if (tops.size > 1) out.push(`« ${m[0]} » coupé`);
        }
      }
    }
    return out;
  });
  if (cut.length) errors.push(`${where} : mots coupés → ${cut.slice(0, 5).join(', ')}`);
  // #316: the tab labels of the simple view are at least the size of the body text (1rem)
  const tabs = await p.evaluate(() =>
    document.body.classList.contains('simple-nav')
      ? [...document.querySelectorAll('.tabs a span')].map((s) => parseFloat(getComputedStyle(s).fontSize) / parseFloat(getComputedStyle(document.documentElement).fontSize))
      : [],
  );
  if (tabs.some((r) => r < 0.99)) errors.push(`${where} : libellés d’onglets plus petits que le texte (${tabs.map((r) => r.toFixed(2)).join(', ')} rem)`);
}

/** Light and dark, then 360 px at 200 %: axe and layout on the screen shown. */
async function screens(p, where) {
  await audit(p, `${where} clair`);
  await p.emulateMedia({ colorScheme: 'dark' });
  await frame(p);
  await audit(p, `${where} sombre`);
  await p.screenshot({ path: `${OUT}/proche-${where}-sombre.png`, fullPage: true });
  await p.emulateMedia({ colorScheme: 'light' });
  await p.setViewportSize({ width: 360, height: 800 });
  // worst case: system text at 200 % and a wide font (DejaVu Sans, the default of the CI runner)
  const style = await p.addStyleTag({ content: "html { font-size: 200% !important; } * { font-family: 'DejaVu Sans', sans-serif !important; }" });
  await frame(p);
  await layout(p, `${where} 360 px 200 %`);
  await p.screenshot({ path: `${OUT}/proche-${where}-200.png`, fullPage: true });
  await style.evaluate((el) => el.remove());
  await p.setViewportSize({ width: 390, height: 844 });
  await frame(p);
}

async function titleFocused(p, where) {
  await p.waitForFunction(() => document.activeElement?.id === 'page-title', null, { timeout: 5000 }).catch(() => errors.push(`${where} : le titre n'a pas le focus`));
}

try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await chromium.launch();
  const phone = { viewport: { width: 390, height: 844 }, serviceWorkers: 'block' };

  // ---------------------------------------------------------------- first launch: « Un proche »
  {
    progress('premier lancement, un proche');
    const ctx = await browser.newContext(phone);
    await ctx.route('**/data/**', async (r) => {
      const rest = new URL(r.request().url()).pathname.replace(/^.*\/data\//, '');
      await r.fulfill({ response: await r.fetch({ url: `${base}demo/${rest}` }) });
    });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`proche : ${e.message}`));
    try {
      await p.goto(base);
      await p.fill('#pass', 'demo');
      await p.click('#unlock button.primary');
      await page(p, 'bienvenue');
      check((await p.locator('.onb-progress').innerText()) === 'Étape 1 sur 4', 'étape 1 : progression absente');
      check(!(await p.locator('.tabs').count()), 'premier lancement : la barre d’onglets reste affichée');
      check(!(await p.locator('#view input[type=password]').count()), 'premier lancement : un champ de phrase de passe');
      await screens(p, 'bienvenue-1');
      await p.click('text=Commencer');
      await page(p, 'bienvenue-2');
      await titleFocused(p, 'étape 2');
      check(/Étape 2 sur 4/.test(await p.locator('.onb-progress').innerText()), 'étape 2 : progression absente');
      check((await p.isChecked('[data-onb-who=gere]')) === true, 'étape 2 : « je gère » non présélectionné');
      await p.check('[data-onb-who=proche]');
      await p.waitForFunction(() => document.body.classList.contains('simple-nav'));
      await screens(p, 'bienvenue-2');
      await p.click('[data-onb-finish]');
      await page(p, 'accueil');
      check((await p.locator('.tabs a').count()) === 3, 'un proche : la vue simple n’a pas 3 onglets');
      const ls = await p.evaluate(() => ({ ...localStorage }));
      check(JSON.parse(ls['intuis-history:onboarding'] ?? '{}').done === true, 'premier lancement : non retenu');
      check(!Object.values(ls).some((v) => v.includes('"demo"') && v.includes('pass')), 'stockage : phrase de passe écrite');
      await p.reload();
      await p.waitForSelector('#pass, #view[data-ready]', { state: 'attached', timeout: 60000 });
      check(!(await p.locator('#view[data-page^=bienvenue]').count()), 'premier lancement : revient après rechargement');
    } catch (err) {
      errors.push(`premier lancement (proche) : ${err}`);
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- first launch: « je gère », 4 screens, tip
  {
    progress('premier lancement, je gère');
    const ctx = await browser.newContext(phone);
    await ctx.route('**/data/**', async (r) => {
      const rest = new URL(r.request().url()).pathname.replace(/^.*\/data\//, '');
      await r.fulfill({ response: await r.fetch({ url: `${base}demo/${rest}` }) });
    });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`gère : ${e.message}`));
    try {
      await p.goto(base);
      await p.fill('#pass', 'demo');
      await p.click('#unlock button.primary');
      await page(p, 'bienvenue');
      await p.click('text=Commencer');
      await page(p, 'bienvenue-2');
      await p.click('#view a.btn.primary');
      await page(p, 'bienvenue-3');
      await titleFocused(p, 'étape 3');
      check((await p.locator('#view .list li').count()) >= 4, 'étape 3 : sources absentes');
      await screens(p, 'bienvenue-3');
      await p.click('text=Plus tard');
      await page(p, 'bienvenue-4');
      await titleFocused(p, 'étape 4');
      check((await p.locator('#view [data-onb-finish]').count()) === 1, 'étape 4 : bouton de fin absent');
      await screens(p, 'bienvenue-4');
      // Back returns to the previous screen
      await p.goBack();
      await page(p, 'bienvenue-3');
      await p.goForward();
      await page(p, 'bienvenue-4');
      await p.click('[data-onb-finish]');
      await page(p, 'accueil');
      check((await p.locator('.tabs a').count()) === 5, 'je gère : 5 onglets attendus');
      check(!(await p.locator('.onb-tip').count()), 'bulle d’aide hors de Pièces');
      await p.click('.tabs [data-view=pieces]');
      await page(p, 'pieces');
      check(/Touchez une pièce pour son détail/.test(await p.locator('.onb-tip').innerText().catch(() => '')), 'bulle d’aide absente sur Pièces');
      await audit(p, 'bulle d’aide');
      await p.click('[data-tip-ok]');
      check(!(await p.locator('.onb-tip').count()), 'bulle d’aide : « Compris » ne la ferme pas');
      await p.click('.tabs [data-view=accueil]');
      await page(p, 'accueil');
      await p.click('.tabs [data-view=pieces]');
      await page(p, 'pieces');
      check(!(await p.locator('.onb-tip').count()), 'bulle d’aide : revient');
    } catch (err) {
      errors.push(`premier lancement (gère) : ${err}`);
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- demo: vue Proche, revoir la présentation
  {
    progress('vue Proche (démo)');
    const ctx = await browser.newContext(phone);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`vue Proche : ${e.message}`));
    try {
      await p.goto(base);
      await p.click('#demo');
      await page(p, 'accueil');
      check(!(await p.locator('#view[data-page^=bienvenue]').count()), 'démo : le premier lancement s’ouvre de lui-même');
      // #400: the figures of the full Accueil, to compare with the vue Proche below
      const num = (s) => Number(String(s).replace(/[\s  ]/g, '').replace('−', '-'));
      const fullGap = /^([\d\s  ]+) € de (moins|plus)/.exec((await p.locator('#verdict-title').innerText()).trim());
      const fullYoy = /([−+]?[\d\s  ]+) %\s*vs nov\./.exec(await p.locator('.home-tiles .kpi').first().innerText());
      const fullMonth = (await p.locator('.home-tiles .kpi .kpi-value').first().innerText()).trim();
      await p.evaluate(() => (location.hash = '#parametres-affichage'));
      await page(p, 'parametres-affichage');
      await p.check('[data-toggle=simple]');
      await p.click('.tabs [data-view=accueil]');
      await page(p, 'accueil');
      const tabs = await p.locator('.tabs a span').allInnerTexts();
      check(tabs.join('|') === 'Accueil|Ma pièce|Aide', `vue Proche : onglets ${tabs.join('|')}`);
      check((await p.locator('#view .proche-big').count()) >= 1, 'vue Proche : chiffre du mois absent');
      // #400: the same figures as the full Accueil (gap in euros, month amount, change on last
      // year), and the room out of reach named
      {
        const said = (await p.locator('#view').innerText()).replace(/\s+/g, ' ');
        const gap = /Cela fait environ ([\d\s  ]+) € de (moins|plus)/.exec(said);
        const yo = /C'est ([\d\s  ]+) % de (moins|plus) que l'an dernier/.exec(said);
        const month = (await p.locator('#view .proche-month .proche-big').innerText()).trim();
        check(fullGap && gap && num(gap[1]) === num(fullGap[1]) && gap[2] === fullGap[2], `vue Proche : écart « ${gap?.[0]} » ≠ Accueil « ${fullGap?.[0]} » (#400)`);
        check(fullYoy && yo && num(yo[1]) === Math.abs(num(fullYoy[1])) && (yo[2] === 'moins') === num(fullYoy[1]) < 0, `vue Proche : « ${yo?.[0]} » ≠ Accueil « ${fullYoy?.[0]} » (#400)`);
        check(num(month.replace('€', '')) === num(fullMonth.replace('€', '')), `vue Proche : mois ${month} ≠ Accueil ${fullMonth} (#400)`);
        check(/Chambre enfant ne répond plus depuis le 5 novembre : cette pièce n'est pas comptée\./.test(said), 'vue Proche : la pièce hors ligne n’est pas nommée (#400)');
      }
      check((await p.locator('#view [data-term=kwh]').count()) >= 1, 'vue Proche : glossaire absent');
      check(await p.locator('[data-simple-exit=ask]').isVisible(), 'vue Proche : sortie non visible');
      await screens(p, 'accueil');
      // Ma pièce: choose, then it is the tab
      await p.click('.tabs a:nth-child(2)');
      await page(p, 'pieces');
      await screens(p, 'choix');
      const name = (await p.locator('[data-pin-room]').first().innerText()).trim();
      await p.click('[data-pin-room]');
      await p.waitForSelector('#view[data-page^="piece-"][data-ready]', { state: 'attached', timeout: 30000 });
      check((await p.locator('#page-title').innerText()).trim() === name, 'Ma pièce : titre de la pièce absent');
      check(!(await p.locator('.subhead .back').count()), 'Ma pièce : flèche retour sur un onglet');
      check((await p.locator('.tabs a:nth-child(2)').getAttribute('aria-current')) === 'page', 'Ma pièce : onglet non allumé');
      await screens(p, 'ma-piece');
      await p.click('.tabs a:nth-child(3)');
      await page(p, 'aide');
      check(/Qui appeler/.test(await p.locator('#view').innerText()), 'Aide : « Qui appeler » absent');
      await screens(p, 'aide');
      // Revoir la présentation (demo: nothing written)
      await p.click('#view a[href="#bienvenue"]');
      await page(p, 'bienvenue');
      await p.click('[data-onb-skip]');
      await page(p, 'accueil');
      check(!(await p.evaluate(() => localStorage.getItem('intuis-history:onboarding'))), 'démo : le premier lancement est enregistré');
      // the way out, with its confirmation
      await p.click('[data-simple-exit=ask]');
      check(await p.locator('.simple-confirm').isVisible(), 'sortie : pas de confirmation');
      await audit(p, 'confirmation de sortie');
      await p.click('[data-simple-exit=no]');
      check((await p.locator('.tabs a').count()) === 3, 'sortie : « Rester » quitte la vue simple');
      await p.click('[data-simple-exit=ask]');
      await p.click('[data-simple-exit=yes]');
      await page(p, 'accueil');
      check((await p.locator('.tabs a').count()) === 5, 'sortie : la vue complète n’a pas 5 onglets');
      // and back from ⚙ Affichage: « Revoir la présentation »
      await p.evaluate(() => (location.hash = '#parametres-affichage'));
      await page(p, 'parametres-affichage');
      check((await p.locator('#onboarding-again').count()) === 1, '⚙ Affichage : « Revoir la présentation » absent');
    } catch (err) {
      errors.push(`vue Proche : ${err}`);
    }
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Premier lancement et vue Proche : OK (captures dans ${OUT})`);
