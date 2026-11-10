// #357: the service worker's life cycle, as the household sees it.
//
// - Registration: here (not virtual:pwa-register, whose prompt mode reloads every tab that
//   showed the prompt as soon as one tab activates the new version).
// - A new version WAITS (vite.config.ts: registerType 'prompt', no skipWaiting). A banner
//   (role=status) says so; « Recharger » sends SKIP_WAITING to the waiting worker, then reloads
//   once the controller has changed. Decision of 10/11/2026: no reload by surprise.
// - #334 (a version stuck in « waiting » for days, an installed app never closed): the button
//   activates the waiting worker whatever the other tabs, and the app looks for a new version
//   each time it comes back to the foreground. Another tab activated it: this one is not
//   reloaded behind the reader's back, the banner says so and its button reloads.
// - The first visit (no controller yet) never shows the banner: there is nothing to replace.
// - « Recharger l'application » (Paramètres → À propos): see reloadApp below.
import { DATA_CACHE, TARIFF_CACHE } from './scope';
import './pwa.css';

export type UpdateKind = 'waiting' | 'elsewhere';

/** What the updater needs from navigator.serviceWorker (a fake in the unit tests). */
export interface SwContainer extends EventTarget {
  readonly controller: unknown;
  getRegistration(): Promise<SwRegistration | undefined>;
}
export interface SwRegistration extends EventTarget {
  readonly waiting: { postMessage(m: unknown): void } | null;
  readonly installing: (EventTarget & { readonly state: string }) | null;
  update(): Promise<unknown>;
}

interface Deps {
  sw: SwContainer;
  onUpdate: (kind: UpdateKind) => void;
  reload: () => void;
  /** Fallback when the worker never takes control (it should within a second). */
  later?: (fn: () => void, ms: number) => unknown;
}

/** The update logic, without the DOM (src/pwa.test.ts drives it with fakes). */
export function createUpdater({ sw, onUpdate, reload, later = setTimeout }: Deps) {
  let requested = false;
  let reloading = false;
  let hadController = sw.controller !== null && sw.controller !== undefined;
  const reloadOnce = () => {
    if (reloading) return;
    reloading = true;
    reload();
  };
  const announce = (reg: SwRegistration) => {
    // a version waiting behind one in service; at the first visit there is nothing to replace
    if (reg.waiting && sw.controller) onUpdate('waiting');
  };
  sw.addEventListener('controllerchange', () => {
    if (requested) return reloadOnce();
    // `clients.claim()` of the very first installation also changes the controller (null → worker)
    if (hadController) onUpdate('elsewhere');
    hadController = true;
  });
  return {
    watch(reg: SwRegistration) {
      announce(reg);
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next?.addEventListener('statechange', () => {
          if (next.state === 'installed') announce(reg);
        });
      });
    },
    /** « Recharger » in the banner. */
    async apply() {
      requested = true;
      const reg = await sw.getRegistration();
      const waiting = reg?.waiting;
      // nothing waits any more (another tab activated it): this page only needs a reload
      if (!waiting) return reloadOnce();
      waiting.postMessage({ type: 'SKIP_WAITING' });
      later(reloadOnce, 10_000);
    },
  };
}

// ------------------------------------------------------------------ banner (outside #app)
const BANNER_TEXT: Record<UpdateKind, string> = {
  waiting: 'Nouvelle version disponible.',
  elsewhere: 'Nouvelle version activée dans un autre onglet.',
};

export function showUpdateBanner(kind: UpdateKind, apply: () => void, doc: Document = document) {
  let box = doc.getElementById('update-banner');
  if (!box) {
    box = doc.createElement('div');
    box.id = 'update-banner';
    box.className = 'update-banner';
    box.setAttribute('role', 'status');
    const app = doc.getElementById('app');
    doc.body.insertBefore(box, app);
  }
  const p = doc.createElement('p');
  const strong = doc.createElement('strong');
  strong.textContent = BANNER_TEXT[kind];
  p.append(strong, ' Vos données, vos notes et la clé mémorisée sont gardées.');
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'btn primary';
  b.id = 'update-reload';
  b.textContent = 'Recharger';
  b.addEventListener('click', () => {
    b.disabled = true;
    b.textContent = 'Rechargement…';
    apply();
  });
  box.replaceChildren(p, b);
}

// ------------------------------------------------------------------ « Recharger l'application »
/**
 * The caches « Recharger l'application » may empty: this app's precache (its code) and the
 * public tariffs, nothing else. Never the encrypted data kept for offline use (DATA_CACHE), and
 * never another site's caches: on <compte>.github.io the origin is shared by every Pages site of
 * the account (#229), so the precache is matched by this worker's exact scope.
 */
export function cachesToClear(names: string[], scope: string, tariffCache = TARIFF_CACHE, dataCache = DATA_CACHE): string[] {
  const precache = `workbox-precache-v2-${scope}`;
  return names.filter((n) => n !== dataCache && (n === precache || n === tariffCache));
}

/**
 * Fetch the application again: the worker of this app is unregistered, its precache and the
 * tariffs dropped, then the page reloads and installs the current version. Untouched: the
 * remembered key (IndexedDB), the encrypted notes (localStorage), the encrypted data cache.
 * Needs the network (the code is downloaded again): refused offline.
 */
export async function reloadApp(): Promise<string | null> {
  if (!navigator.onLine) return 'Hors connexion : l’application ne peut pas être retéléchargée. Réessayez une fois en ligne.';
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    const scope = reg?.scope ?? new URL('.', document.baseURI).href;
    if ('caches' in window) for (const name of cachesToClear(await caches.keys(), scope)) await caches.delete(name);
    await reg?.unregister();
  } catch (err) {
    return `Rechargement impossible : ${err instanceof Error ? err.message : String(err)}`;
  }
  location.reload();
  return null;
}

/** Whether this page is served by the worker (the app opens offline once it is). */
export const offlineReady = () => 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;

// ------------------------------------------------------------------ start
let lastCheck = 0;

export function startPwa() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  const sw = navigator.serviceWorker;
  const updater = createUpdater({
    sw: sw as unknown as SwContainer,
    onUpdate: (kind) => showUpdateBanner(kind, () => void updater.apply()),
    reload: () => location.reload(),
  });
  sw.register('sw.js', { scope: './' }).then(
    (reg) => {
      // Playwright with service workers blocked resolves to undefined (a browser never does)
      if (!reg) return;
      updater.watch(reg as unknown as SwRegistration);
      // #334: an installed app is resumed, not reopened: look for a new version on coming back
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 60_000) return;
        lastCheck = Date.now();
        reg.update().catch(() => {});
      });
    },
    // blocked (private browsing, tests): the app works without it, online
    () => {},
  );
}
