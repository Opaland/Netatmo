// S-7.12: offline use and data saving.
// The service worker keeps every encrypted file it has served (vite.config.ts, NetworkFirst):
// on Wi-Fi the app also fetches, in the background, the hourly files that only the Analyse
// view loads, so they are there offline. Requests are conditional (cache: 'no-cache' → ETag,
// 304 when unchanged), so an unchanged file is not downloaded again.
import type { Dataset } from './data';

export const DATA_CACHE = 'energy-data';

const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

interface NetInfo {
  saveData?: boolean;
  type?: string;
  effectiveType?: string;
}

/** Whether background downloads are welcome: not on a metered, slow or "save data" connection. */
export function canPrefetch(c: NetInfo | undefined, online = true): boolean {
  if (!online) return false;
  if (!c) return true;
  if (c.saveData) return false;
  if (c.type === 'cellular') return false;
  return !['slow-2g', '2g', '3g'].includes(c.effectiveType ?? '');
}

const hourlyFiles = (ds: Dataset) => (ds.meta.hourly_years ?? []).map((y) => `${ds.source}/${y}.hourly.enc.json`);

/** Warm the service-worker cache with the hourly files (no decryption, nothing kept in memory). */
export function prefetchForOffline(ds: Dataset) {
  const conn = (navigator as Navigator & { connection?: NetInfo }).connection;
  if (!canPrefetch(conn, navigator.onLine)) return;
  const run = () => {
    for (const url of hourlyFiles(ds)) fetch(url, { cache: 'no-cache', priority: 'low' } as RequestInit).catch(() => {});
  };
  const idle = (window as Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(run, { timeout: 5000 });
  else setTimeout(run, 3000);
}

async function cached(url: string): Promise<boolean> {
  try {
    if (!('caches' in window)) return false;
    const cache = await caches.open(DATA_CACHE);
    return !!(await cache.match(new URL(url, location.href).href));
  } catch {
    return false;
  }
}

/** Message for content that could not be loaded: offline it will come back by itself. */
export function unavailable(what: string): string {
  return navigator.onLine ? `${what} indisponibles.` : `${what} : disponible au prochain accès réseau.`;
}

/** Fill the offline banner (hidden when online): what can be read without network. */
export async function updateNetStatus(ds: Dataset | null) {
  const el = document.getElementById('net-status');
  if (!el || !ds) return;
  if (navigator.onLine) {
    el.hidden = true;
    return;
  }
  const files = hourlyFiles(ds);
  const hourly = files.length > 0 && (await Promise.all(files.map(cached))).every(Boolean);
  el.innerHTML = `<strong>Hors ligne.</strong> Disponible sur cet appareil : toutes les vues, données au ${ds.meta.last_day ? dayLabel(ds.meta.last_day) : '—'}${
    files.length ? (hourly ? ', profil horaire compris.' : ' ; profil horaire disponible au prochain accès réseau.') : '.'
  }`;
  el.hidden = false;
}
