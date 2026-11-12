// S-12.1: contract shared between devices.
//
// The owner writes it from Settings into the repository secret CONTRACT_JSON, sealed in the
// browser (#497: like the other household settings); the nightly collection validates it and copies it
// into the encrypted meta (`meta.contract`). On every device the shared contract wins over
// the one saved in this browser, unless the user edited it here on purpose (`localEdit`).
import { type ContractPeriod, OFFERS } from './offers';

/** Subscribed powers offered by the regulated tariff (same list as the collector). */
export const KVAS = [3, 6, 9, 12, 15, 18, 24, 30, 36];

export type ContractSource = 'shared' | 'local' | 'default';

export interface ResolvedContract {
  periods: ContractPeriod[];
  source: ContractSource;
  /** A shared contract exists and differs from the periods used / saved on this device. */
  differs: boolean;
  /** A shared contract exists. */
  shared: boolean;
}

const sorted = (list: ContractPeriod[]) => [...list].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

/** Same periods (order ignored)? */
export function sameContract(a: ContractPeriod[], b: ContractPeriod[]): boolean {
  if (a.length !== b.length) return false;
  const [x, y] = [sorted(a), sorted(b)];
  return x.every((p, i) => p.from === y[i].from && p.offer === y[i].offer && p.kva === y[i].kva);
}

/** Light check of what the collector stored (it validated it already). */
export function validContract(v: unknown): ContractPeriod[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const known = new Set(OFFERS.map((o) => o.id));
  const ok = v.every(
    (p) =>
      p &&
      typeof p === 'object' &&
      typeof p.from === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(p.from) &&
      known.has(p.offer) &&
      KVAS.includes(p.kva),
  );
  return ok ? sorted(v as ContractPeriod[]).map((p) => ({ from: p.from, offer: p.offer, kva: p.kva })) : null;
}

/**
 * Contract in force on this device: the shared one, else the local one, else a default
 * (EDF HP/HC, `fallbackKva`, from the first day of data).
 */
export function resolveContract(
  sharedRaw: unknown,
  local: ContractPeriod[],
  localEdit: boolean,
  firstDay: string,
  fallbackKva: number,
): ResolvedContract {
  const shared = validContract(sharedRaw);
  if (shared && !(localEdit && local.length)) {
    return { periods: shared, source: 'shared', differs: local.length > 0 && !sameContract(shared, local), shared: true };
  }
  if (local.length) return { periods: local, source: 'local', differs: !!shared && !sameContract(shared, local), shared: !!shared };
  return { periods: [{ from: firstDay, offer: 'edf-trv-hphc', kva: fallbackKva || 9 }], source: 'default', differs: false, shared: false };
}

/** Value written to CONTRACT_JSON: sorted periods, nothing else. */
export function contractJson(periods: ContractPeriod[]): string {
  return JSON.stringify(sorted(periods).map((p) => ({ from: p.from, offer: p.offer, kva: p.kva })));
}
