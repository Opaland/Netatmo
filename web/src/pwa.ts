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
  // The worker of the first visit (none controlled the page at load). Its « installed » event can
  // reach the page after clients.claim() already made it the controller (seen on WebKit under
  // load in CI, PR #438): it must never read as a new version.
  let first: unknown = null;
  const announce = (reg: SwRegistration) => {
    // a version waiting behind one in service; at the first visit there is nothing to replace
    if (reg.waiting && sw.controller && reg.waiting !== first) onUpdate('waiting');
  };
  sw.addEventListener('controllerchange', () => {
    if (requested) return reloadOnce();
    // `clients.claim()` of the very first installation also changes the controller (null → worker)
    if (hadController) onUpdate('elsewhere');
    hadController = true;
  });
  return {
    watch(reg: SwRegistration) {
      // not controlled at load: the worker already there (installing or waiting) is the first one
      if (!hadController) first = reg.installing ?? reg.waiting ?? null;
      announce(reg);
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!hadController && first === null) first = next;
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

/** The worker, as startPwa registers it (relative to the page: Pages serves the app in a folder). */
const SW_URL = 'sw.js';
const SW_SCOPE = './';

/** Set by reloadApp: the worker it installs claims this page, which is no other tab's update. */
let appReloading = false;

/** Resolve once `worker` is activated (or redundant), at the latest after `ms`. */
function settled(worker: ServiceWorker | null, ms: number): Promise<void> {
  return new Promise((done) => {
    if (!worker || worker.state === 'activated' || worker.state === 'redundant') return done();
    const timer = setTimeout(done, ms);
    worker.addEventListener('statechange', () => {
      if (worker.state !== 'activated' && worker.state !== 'redundant') return;
      clearTimeout(timer);
      done();
    });
  });
}

/**
 * Fetch the application again: the worker of this app is unregistered, its precache and the
 * tariffs dropped, the current version registered again (installed, precached), then the page
 * reloads. Untouched: the remembered key (IndexedDB), the encrypted notes (localStorage), the
 * encrypted data cache. Needs the network (the code is downloaded again): refused offline.
 *
 * #604: the new registration is made BEFORE the reload. WebKit (Safari) empties every cache of
 * the origin, the encrypted data included, when a page reloads after its last service worker
 * registration was removed (seen in Playwright's WebKit: 17 → 0 entries; Chromium keeps them).
 * Registered again first, the origin never has none, and the data cache stays (where the browser
 * revives the old registration instead, it is removed again: that browser keeps the caches).
 */
export async function reloadApp(): Promise<string | null> {
  if (!navigator.onLine) return 'Hors connexion : l’application ne peut pas être retéléchargée. Réessayez une fois en ligne.';
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    const scope = reg?.scope ?? new URL('.', document.baseURI).href;
    if ('caches' in window) for (const name of cachesToClear(await caches.keys(), scope)) await caches.delete(name);
    if (reg) {
      appReloading = true;
      await reg.unregister();
      const next = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
      const fresh = next.installing ?? next.waiting;
      // A new registration (WebKit): its worker downloads the app again; reloaded before it is
      // activated, the page would load uncontrolled. Chromium instead revives the registration
      // being removed (same worker, nothing installing): removed again, as before #604, the
      // reload installs the current version, and Chromium keeps the caches.
      if (fresh) await settled(fresh, 15_000);
      else await next.unregister();
    }
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
    // the worker reloadApp installs claims this page: not « activated in another tab »
    onUpdate: (kind) => appReloading || showUpdateBanner(kind, () => void updater.apply()),
    reload: () => location.reload(),
  });
  sw.register(SW_URL, { scope: SW_SCOPE }).then(
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
