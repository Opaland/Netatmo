// #356, #453: what the owner types in a simulator whose assumptions are all theirs (« Des panneaux
// solaires ? », « Un chauffe-eau thermodynamique ? »): a list of numeric fields, each with its
// French label and bounds, read back from this device with every field null (not typed) or in its
// bounds. One rule for every such simulator (AGENTS.md §5): fuzzed in fuzz.test.ts.

/** Field key, label (French, shown when missing and in the assumptions), min, max. */
export type NumberField<K extends string> = readonly [K, string, number, number];

const own = (o: object, k: string): unknown => (Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined);

/** The inputs read back (localStorage, a form): unknown keys and values out of bounds dropped. */
export function parseNumberFields<K extends string>(fields: readonly NumberField<K>[], v: unknown): Record<K, number | null> {
  const out = Object.fromEntries(fields.map(([k]) => [k, null])) as Record<K, number | null>;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  for (const [k, , min, max] of fields) {
    const x = own(v, k);
    if (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max) out[k] = x;
  }
  return out;
}

/** Simple payback in years (installed cost / yearly saving), or null when it never pays. */
export const payback = (cost: number, yearlySaving: number) => (yearlySaving > 0 && cost > 0 ? cost / yearlySaving : null);

/** The fields typed in a form (`data-<attr>` inputs), a comma read as a decimal point; empty: not typed. */
export function readNumberForm(form: ParentNode, attr: string): Record<string, number> {
  const next: Record<string, number> = {};
  for (const el of form.querySelectorAll<HTMLInputElement>(`[data-${attr}]`)) {
    const raw = el.value.trim().replace(',', '.');
    if (raw !== '') next[el.getAttribute(`data-${attr}`)!] = Number(raw);
  }
  return next;
}

/**
 * The inputs kept on this device under `key` (an lsKey): read back through `parse`, never thrown
 * (private browsing, storage full: kept for this visit only).
 */
export function inputStore<T>(key: string, parse: (v: unknown) => T): { load: () => T; save: (v: T) => void } {
  return {
    load() {
      try {
        return parse(JSON.parse(localStorage.getItem(key) ?? '{}'));
      } catch {
        return parse({});
      }
    },
    save(v) {
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* kept for this visit */
      }
    },
  };
}
