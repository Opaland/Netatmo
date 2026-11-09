import { describe, expect, it } from 'vitest';
import { LEGACY_NS, migrateLegacy, namespaceFor } from './scope';

function fakeStorage(init: Record<string, string>): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

describe('#229 noms rangés sous le chemin de l’application', () => {
  it('un espace de noms par chemin, les noms historiques à la racine', () => {
    expect(namespaceFor('/Netatmo/')).toBe('intuis-history@Netatmo');
    expect(namespaceFor('/Netatmo/index.html')).toBe('intuis-history@Netatmo');
    expect(namespaceFor('/autre/')).toBe('intuis-history@autre');
    expect(namespaceFor('/')).toBe(LEGACY_NS);
  });

  it('déplace les anciennes valeurs, oublie la clé mémorisée, une seule fois', () => {
    const s = fakeStorage({
      'intuis-history:state': '{"view":"compare"}',
      'intuis-history:invoices:data': 'sealed',
      'intuis-history:remembered': '{"source":"data","at":1}',
      'intuis-history@Netatmo:budget': '90',
      'intuis-history:budget': '50',
      'autre-app:x': '1',
    });
    const deleted: string[] = [];
    const idb = { deleteDatabase: (n: string) => void deleted.push(n) } as unknown as IDBFactory;
    migrateLegacy('intuis-history@Netatmo', s, idb);
    expect(s.getItem('intuis-history@Netatmo:state')).toBe('{"view":"compare"}');
    expect(s.getItem('intuis-history@Netatmo:invoices:data')).toBe('sealed');
    expect(s.getItem('intuis-history@Netatmo:remembered')).toBeNull();
    // a value already written under the scoped name wins
    expect(s.getItem('intuis-history@Netatmo:budget')).toBe('90');
    expect(s.getItem('intuis-history:state')).toBeNull();
    expect(s.getItem('intuis-history:remembered')).toBeNull();
    expect(s.getItem('autre-app:x')).toBe('1');
    expect(deleted).toEqual(['intuis-history']);
    s.setItem('intuis-history:state', 'later');
    migrateLegacy('intuis-history@Netatmo', s, idb);
    expect(s.getItem('intuis-history:state')).toBe('later');
    expect(deleted).toHaveLength(1);
  });

  it('à la racine de son origine, rien ne bouge', () => {
    const s = fakeStorage({ 'intuis-history:state': '{}' });
    migrateLegacy(LEGACY_NS, s, undefined);
    expect(s.getItem('intuis-history:state')).toBe('{}');
  });
});
