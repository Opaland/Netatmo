// Derived series memoised per source object (#251, #256): the Synthèse cards are rebuilt on
// every setState, but the hourly data, the Linky curve and the dataset never change once
// loaded, so what is computed from them is kept with them (WeakMap: forgotten with them).

let store = new WeakMap<object, Map<string, unknown>>();
const MAX = 64; // keys per source: windows and room sets in use stay well under it

/** fn() computed once per (source, key); the oldest keys are dropped past MAX. */
export function memo<T>(source: object, key: string, fn: () => T): T {
  let m = store.get(source);
  if (!m) store.set(source, (m = new Map()));
  if (m.has(key)) return m.get(key) as T;
  const v = fn();
  if (m.size >= MAX) m.delete(m.keys().next().value!);
  m.set(key, v);
  return v;
}

/** #232: forget every memoised series (on lock). */
export function clearMemo() {
  store = new WeakMap();
}

/** Stable key of a set of strings (order of insertion ignored). */
export const setKey = (s: Iterable<string>) => [...s].sort().join('\u0001');
