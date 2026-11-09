// #310: the component demo page (composants.html, development only) under axe, in light, dark
// and high contrast, at 360 px with the system text at 200 %. Run: node e2e/composants.mjs
// (starts `vite` itself; port: E2E_PORT). Captures in e2e/screenshots/composants-*.png.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { chromium, webkit } from 'playwright';

const PORT = Number(process.env.E2E_PORT ?? 4183);
const OUT = process.env.E2E_OUT ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const base = `http://localhost:${PORT}/composants.html`;
const errors = [];
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await (process.env.E2E_BROWSER === 'webkit' ? webkit : chromium).launch();
  const runs = [
    ['clair', { viewport: { width: 390, height: 900 } }],
    ['sombre', { viewport: { width: 390, height: 900 }, colorScheme: 'dark' }],
    ['contraste-clair', { viewport: { width: 390, height: 900 }, contrast: 'more' }, true],
    ['contraste-sombre', { viewport: { width: 390, height: 900 }, colorScheme: 'dark', contrast: 'more' }, true],
    ['texte-200', { viewport: { width: 360, height: 800 } }, false, true],
  ];
  for (const [name, ctx, enhanced, big] of runs) {
    const context = await browser.newContext(ctx);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${name} : ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${name} : console ${m.text()}`));
    await page.goto(base);
    await page.waitForSelector('#demo-bar canvas', { timeout: 30000 });
    if (big) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    // next laid-out frame after the style change (no fixed delay, as in demo.mjs #260)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', ...(enhanced ? ['wcag2aaa'] : [])];
    const builder = new AxeBuilder({ page }).withTags(tags);
    if (enhanced) builder.withRules(['color-contrast-enhanced']);
    const { violations } = await builder.analyze();
    for (const v of violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'))
      errors.push(`${name} : axe « ${v.id} » → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
    // ≥ 44 px targets for every control (WCAG 2.5.8 asks 24, the design system 44)
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('button, a.row, .switch, summary, [role=radio]')]
        .filter((el) => el.closest('.seg') === null || el.getAttribute('role') !== 'radio')
        .filter((el) => !el.classList.contains('link'))
        .map((el) => [el, el.getBoundingClientRect()])
        .filter(([, r]) => r.height > 0 && r.height < 43.5)
        .map(([el, r]) => `${el.className || el.tagName} ${Math.round(r.height)} px`),
    );
    if (small.length) errors.push(`${name} : cibles < 44 px → ${small.slice(0, 5).join(', ')}`);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (wide > 1) errors.push(`${name} : défilement horizontal de ${wide} px`);
    await page.screenshot({ path: `${OUT}/composants-${name}.png`, fullPage: true });
    await context.close();
  }
  await browser.close();
} finally {
  server.kill();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Composants : OK (captures dans ${OUT})`);
