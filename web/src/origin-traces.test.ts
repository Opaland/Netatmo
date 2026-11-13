import { describe, expect, it } from 'vitest';
import { type OriginInventory, foreignTraces, readInventory, tracesText, warnNear } from './origin-traces';

const SCOPE = 'https://compte.github.io/Netatmo/';
const OWN = { ns: 'intuis-history@Netatmo', scope: SCOPE, caches: ['energy-data@Netatmo', 'energy-tariffs@Netatmo'] };
const MINE: OriginInventory = {
  storageKeys: ['intuis-history@Netatmo:state', 'intuis-history@Netatmo:remembered', 'intuis-history@Netatmo:migrated'],
  databases: ['intuis-history@Netatmo'],
  caches: [`workbox-precache-v2-${SCOPE}`, 'energy-data@Netatmo', 'energy-tariffs@Netatmo'],
  workerScopes: [SCOPE],
};

describe('#229 traces d’un autre site de la même origine github.io', () => {
  it('rien à signaler quand tout est à l’appli (ou vide)', () => {
    expect(foreignTraces(MINE, OWN)).toEqual([]);
    expect(foreignTraces({ storageKeys: [], databases: [], caches: [], workerScopes: [] }, OWN)).toEqual([]);
  });

  it('nomme chaque sorte de stockage qui garde autre chose', () => {
    expect(foreignTraces({ ...MINE, storageKeys: [...MINE.storageKeys, 'theme'] }, OWN)).toEqual(['stockage']);
    // Another copy of the app on the same account, or a version from before #229.
    expect(foreignTraces({ ...MINE, storageKeys: ['intuis-history@Autre:state'] }, OWN)).toEqual(['stockage']);
    expect(foreignTraces({ ...MINE, storageKeys: ['intuis-history:state'] }, OWN)).toEqual(['stockage']);
    // A prefix is not enough: « intuis-history@Netatmo2: » is another site.
    expect(foreignTraces({ ...MINE, storageKeys: ['intuis-history@Netatmo2:state'] }, OWN)).toEqual(['stockage']);
    expect(foreignTraces({ ...MINE, databases: [...MINE.databases, 'localforage'] }, OWN)).toEqual(['base']);
    expect(foreignTraces({ ...MINE, caches: [...MINE.caches, 'workbox-precache-v2-https://compte.github.io/Autre/'] }, OWN)).toEqual([
      'cache',
    ]);
    // The account's own site at the root: a worker whose scope covers /Netatmo/ too.
    expect(foreignTraces({ ...MINE, workerScopes: [SCOPE, 'https://compte.github.io/'] }, OWN)).toEqual(['service worker']);
    expect(
      foreignTraces({ storageKeys: ['x'], databases: ['y'], caches: ['z'], workerScopes: ['https://compte.github.io/'] }, OWN),
    ).toEqual(['stockage', 'base', 'cache', 'service worker']);
  });

  it('lit ce que garde le navigateur ; une API absente ou refusée ne voit rien', async () => {
    const g = {
      localStorage: { length: 2, key: (i: number) => ['a', 'b'][i] ?? null },
      indexedDB: { databases: async () => [{ name: 'db' }, { name: undefined }] },
      caches: { keys: async () => ['c'] },
      navigator: { serviceWorker: { getRegistrations: async () => [{ scope: SCOPE }] } },
    } as unknown as typeof globalThis;
    expect(await readInventory(g)).toEqual({ storageKeys: ['a', 'b'], databases: ['db'], caches: ['c'], workerScopes: [SCOPE] });
    const refused = {
      get localStorage(): Storage {
        throw new Error('SecurityError');
      },
      indexedDB: {}, // older Firefox: no databases()
      navigator: {},
    } as unknown as typeof globalThis;
    expect(await readInventory(refused)).toEqual({ storageKeys: [], databases: [], caches: [], workerScopes: [] });
  });

  it('la phrase nomme le compte, en mots de tous les jours, jamais un nom de clé', () => {
    const t = tracesText('compte.github.io');
    expect(t).toContain('du compte compte,');
    expect(t).toContain('« Rester connecté »');
    // #533 (revue design v2.0): technical words, for the personas 22 and 59
    for (const word of ['stockage', 'base', 'cache', 'service worker', 'script', 'GitHub Pages']) expect(t).not.toContain(word);
  });

  function fakeField() {
    const inserted: { id: string; html: string }[] = [];
    const doc = {
      getElementById: (id: string) => (inserted.some((e) => e.id === id) ? {} : null),
      createElement: () => {
        let content = '';
        return {
          set innerHTML(v: string) {
            content = String(v);
          },
          get firstElementChild() {
            return content ? { id: /id="([^"]+)"/.exec(content)?.[1] ?? '', html: content } : null;
          },
        };
      },
    };
    return { field: { ownerDocument: doc, after: (el: { id: string; html: string }) => inserted.push(el) } as unknown as Element, inserted };
  }

  it('l’avertissement se pose à côté de « Rester connecté », une seule fois, seulement s’il y a des traces', async () => {
    const { field, inserted } = fakeField();
    expect(await warnNear(field, 'compte.github.io', async () => [])).toEqual([]);
    expect(inserted).toEqual([]);
    await warnNear(field, 'compte.github.io', async () => ['cache']);
    await warnNear(field, 'compte.github.io', async () => ['cache']);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].id).toBe('origin-traces');
    expect(inserted[0].html).toContain('du compte compte,');
    expect(inserted[0].html).toContain('class="alert warn"');
  });

  it('hors de github.io (domaine à soi, aperçu local) : rien n’est lu', async () => {
    const { field, inserted } = fakeField();
    let read = 0;
    const inspect = async () => {
      read++;
      return ['cache' as const];
    };
    expect(await warnNear(field, 'energie.example.fr', inspect)).toEqual([]);
    expect(await warnNear(field, 'localhost', inspect)).toEqual([]);
    expect(await warnNear(null, 'compte.github.io', inspect)).toEqual([]);
    expect(read).toBe(0);
    expect(inserted).toEqual([]);
  });
});
