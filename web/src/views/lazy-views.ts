// #555: the views shared by Historique, Compteur, the tools and ⚙ Mon logement, out of the first
// screen (CONTRIBUTING.md § 2): one loader each, so that the pages and the meter share the module.
import { lazyView } from '../lazy';
import { canPrefetch } from '../offline';
import { onceReady } from '../ready';

export const analyseView = lazyView(() => import('./analyse'));
export const compareView = lazyView(() => import('./compare'));

/**
 * #555: once the first screen is drawn and settled, load these views while the browser is idle,
 * so that Historique opens as fast as when they were part of the first screen (like ECharts,
 * charts.ts). Not on a slow, metered or « save data » connection (offline.ts): there they come
 * with the first page that shows them. Not tracked: the first screen is ready without them.
 */
export function warmViews() {
  onceReady(() => {
    const conn = (navigator as Navigator & { connection?: Parameters<typeof canPrefetch>[0] }).connection;
    if (!canPrefetch(conn, navigator.onLine)) return;
    const warm = () => {
      analyseView.warm();
      compareView.warm();
    };
    const idle = (window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(warm, { timeout: 5000 });
    else setTimeout(warm, 1500);
  });
}
