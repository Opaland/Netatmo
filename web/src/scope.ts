// #229: names of everything this app keeps in the browser, scoped to its path.
//
// On https://<compte>.github.io/<dépôt>/ the origin is shared by EVERY GitHub Pages site of the
// account: localStorage, IndexedDB and the Cache API are per origin, not per path. Scoping the
// names to the app's path (« intuis-history@Netatmo:… ») stops another copy of this app (a fork,
// a demo) published on the same account from reading or overwriting this one's state, notes or
// remembered key by mistake. It is NOT an isolation: any script of the same origin can still
// list and use them. Only an origin of its own (custom domain, dedicated organisation) isolates; see
// docs/etudes/origine-dediee.md and the README (Sécurité).
//
// Served at the root of its origin (custom domain, `vite preview`, tests), the historical names
// are kept unchanged.

export const LEGACY_NS = 'intuis-history';

/** Namespace for an app served under `path` (« /Netatmo/ » → « intuis-history@Netatmo »). */
export function namespaceFor(path: string): string {
  const dir = path.replace(/[^/]*$/, '').replace(/^\/+|\/+$/g, '');
  return dir ? `${LEGACY_NS}@${dir}` : LEGACY_NS;
}

function appPath(): string {
  try {
    return typeof document === 'undefined' ? '/' : new URL('.', document.baseURI).pathname;
  } catch {
    return '/';
  }
}

/** This app's namespace (localStorage prefix and IndexedDB name). */
export const NS = namespaceFor(appPath());

/** A localStorage key of this app. */
export const lsKey = (name: string) => `${NS}:${name}`;

/** IndexedDB database holding the « Rester connecté » key. */
export const KEY_DB = NS;

/** Service-worker runtime caches (vite.config.ts names them after the repository). */
export const DATA_CACHE: string = import.meta.env.VITE_DATA_CACHE ?? 'energy-data';
export const TARIFF_CACHE: string = import.meta.env.VITE_TARIFF_CACHE ?? 'energy-tariffs';

/**
 * Moves the values an older version saved under the historical names (v1.4 and before) to the
 * scoped ones. The remembered key is not moved but forgotten (its database is deleted, its mark
 * removed): the passphrase is asked once more after the update, and no usable key is left under
 * a name another copy of the app would open.
 */
export function migrateLegacy(ns = NS, store: Storage | undefined = globalThis.localStorage, idb: IDBFactory | undefined = globalThis.indexedDB) {
  if (ns === LEGACY_NS || !store) return;
  const done = `${ns}:migrated`;
  try {
    if (store.getItem(done)) return;
    const legacy: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(`${LEGACY_NS}:`)) legacy.push(k);
    }
    for (const k of legacy) {
      const v = store.getItem(k);
      const target = ns + k.slice(LEGACY_NS.length);
      if (k !== `${LEGACY_NS}:remembered` && v !== null && store.getItem(target) === null) store.setItem(target, v);
      store.removeItem(k);
    }
    store.setItem(done, '1');
    idb?.deleteDatabase(LEGACY_NS);
  } catch {
    /* private browsing, storage full: keep going with the scoped names */
  }
}

/** Drops the unscoped runtime caches of v1.4 and before (refilled under the scoped names). */
export function dropLegacyCaches(c: CacheStorage | undefined = globalThis.caches) {
  if (!c) return;
  for (const [legacy, now] of [
    ['energy-data', DATA_CACHE],
    ['energy-tariffs', TARIFF_CACHE],
  ])
    if (legacy !== now) c.delete(legacy).catch(() => {});
}

migrateLegacy();
dropLegacyCaches();
