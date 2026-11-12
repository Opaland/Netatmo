// #229: is this browser ALSO used by another site of the same <compte>.github.io origin?
//
// The origin is shared by every GitHub Pages site of the account (scope.ts), and the only rule
// that keeps the remembered key out of reach is « no other Pages site on this account ». This
// checks it where it matters, on the device: anything kept for the origin (localStorage keys,
// IndexedDB databases, Cache API caches, service-worker registrations) whose name is not one of
// this app's is the trace of another site of the account opened in this browser. It is a
// detection, not a protection: a hostile script can erase its traces, and a site never opened
// here leaves none. Read only: nothing is deleted (it may be the owner's own site).

import { escapeHtml as esc } from './charts';
import { alertHtml } from './components';
import { DATA_CACHE, NS, TARIFF_CACHE } from './scope';
import { html } from './trusted';

export interface OriginInventory {
  storageKeys: string[];
  databases: string[];
  caches: string[];
  workerScopes: string[];
}

export type TraceKind = 'stockage' | 'base' | 'cache' | 'service worker';

export interface Own {
  ns: string; // localStorage prefix and IndexedDB name (scope.ts)
  scope: string; // this app's service-worker scope (its folder, absolute URL)
  caches: string[]; // runtime caches named after the repository (vite.config.ts)
}

/** Kinds of storage holding something that is not this app's, in a fixed order. */
export function foreignTraces(inv: OriginInventory, own: Own): TraceKind[] {
  const ownCaches = new Set([`workbox-precache-v2-${own.scope}`, ...own.caches]);
  const found: TraceKind[] = [];
  if (inv.storageKeys.some((k) => !k.startsWith(`${own.ns}:`))) found.push('stockage');
  if (inv.databases.some((d) => d !== own.ns)) found.push('base');
  if (inv.caches.some((c) => !ownCaches.has(c))) found.push('cache');
  if (inv.workerScopes.some((s) => s !== own.scope)) found.push('service worker');
  return found;
}

async function attempt<T>(read: () => Promise<T[]> | T[]): Promise<T[]> {
  try {
    return await read();
  } catch {
    return []; // API missing (older Firefox: indexedDB.databases) or storage refused: nothing seen
  }
}

/** What the browser keeps for this origin (each part empty when it cannot be read). */
export async function readInventory(g: typeof globalThis = globalThis): Promise<OriginInventory> {
  return {
    storageKeys: await attempt(() => {
      const s = g.localStorage;
      return Array.from({ length: s.length }, (_, i) => s.key(i)).filter((k): k is string => k !== null);
    }),
    databases: await attempt(async () => (await g.indexedDB.databases()).map((d) => d.name ?? '').filter(Boolean)),
    caches: await attempt(() => g.caches.keys()),
    workerScopes: await attempt(async () => (await g.navigator.serviceWorker.getRegistrations()).map((r) => r.scope)),
  };
}

/** On <compte>.github.io only (elsewhere the origin is the app's own): the traces found. */
export async function sharedOriginTraces(host = location.hostname, base = document.baseURI): Promise<TraceKind[]> {
  if (!host.endsWith('.github.io')) return [];
  return foreignTraces(await readInventory(), { ns: NS, scope: new URL('.', base).href, caches: [DATA_CACHE, TARIFF_CACHE] });
}

/** The sentence shown next to « Rester connecté » and in Sécurité (plain text, escaped by the caller). */
export function tracesText(kinds: TraceKind[], host: string): string {
  const account = host.replace(/\.github\.io$/, '');
  return (
    `Ce navigateur garde aussi des données d'un autre site GitHub Pages du compte ${account} (${kinds.join(', ')}). ` +
    `Ce site partage l'adresse de l'appli : un de ses scripts pourrait se servir de la clé gardée sur cet appareil. ` +
    `Ici, mieux vaut ne pas activer « Rester connecté ».`
  );
}

/**
 * Puts the warning right after `field` (the « Rester connecté » switch) when traces are found;
 * once only. Resolves to the traces found.
 */
export async function warnNear(field: Element | null, host: string, inspect = sharedOriginTraces): Promise<TraceKind[]> {
  if (!field || !host.endsWith('.github.io')) return [];
  const kinds = await inspect(host);
  const doc = field.ownerDocument;
  if (!kinds.length || doc.getElementById('origin-traces')) return kinds;
  const box = doc.createElement('div');
  box.innerHTML = html(alertHtml('warn', esc(tracesText(kinds, host)), { id: 'origin-traces', role: 'status' }));
  if (box.firstElementChild) field.after(box.firstElementChild);
  return kinds;
}
