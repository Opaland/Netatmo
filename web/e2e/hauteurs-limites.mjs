// #556: the height limits of the pages, written once (AGENTS.md § 5). Read by e2e/features.mjs
// (the guard, in CI, Chromium and WebKit), by e2e/hauteurs.mjs (the table of the end-of-version
// reviews) and by src/hauteurs-limites.test.ts (no limit written again inline).
//
// A limit is a number of « screens » of one display:
// - `of: 'screen'`: the height of the device's screen (window.screen.height: 844 on an iPhone 13);
// - `of: 'viewport'`: the height of its window (window.innerHeight: 664 on an iPhone 13, 800 at
//   360 × 800).
// Adding a limit, or raising one, is the owner's decision (docs/bmad/revues/v2.3-cadrage.md § 2):
// it is proposed in a PR, not written here on one's own.

/** The displays a limit is measured on; `devices` is Playwright's (`import { devices } from 'playwright'`). */
export function displayOptions(display, devices) {
  if (display === 'iphone') return { ...devices['iPhone 13'], deviceScaleFactor: 1 };
  if (display === '360') return { viewport: { width: 360, height: 800 }, deviceScaleFactor: 1, hasTouch: true };
  throw new Error(`affichage inconnu : ${display}`);
}

export const HEIGHT_LIMITS = [
  { issue: '#311', route: 'accueil', name: 'l’Accueil', display: 'iphone', screens: 3, of: 'screen' },
  { issue: '#387', route: 'etat', name: 'État des données', display: 'iphone', screens: 4, of: 'viewport' },
  { issue: '#386', route: 'historique', name: 'l’Historique', display: 'iphone', screens: 4, of: 'screen' },
  { issue: '#426', route: 'historique', name: 'l’Historique', display: '360', screens: 4, of: 'viewport' },
  { issue: '#498', route: 'confort', name: 'Air et confort', display: '360', screens: 11, of: 'viewport' },
];

/** The limit of `route` on `display`, or null when it has none. */
export const heightLimit = (route, display) => HEIGHT_LIMITS.find((l) => l.route === route && l.display === display) ?? null;

/**
 * Height of the page shown (`page`, Playwright) against its limit: { h, max, margin, ok, message }.
 * `max` and `margin` are null when the page has no limit on this display.
 */
export async function measureHeight(page, route, display) {
  const limit = heightLimit(route, display);
  const [h, screen, inner] = await page.evaluate(() => [document.documentElement.scrollHeight, window.screen.height, window.innerHeight]);
  if (!limit) return { h, inner, max: null, margin: null, ok: true, message: '' };
  const max = limit.screens * (limit.of === 'screen' ? screen : inner);
  const where = display === 'iphone' ? 'sur iPhone 13' : 'à 360 × 800';
  return {
    h,
    inner,
    max,
    margin: max - h,
    ok: h <= max,
    message: `${limit.issue} : ${limit.name} fait ${h} px ${where}, plus de ${limit.screens} écrans (${max} px)`,
  };
}
