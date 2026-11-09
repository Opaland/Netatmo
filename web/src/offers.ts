// Supplier offers: price history files. To add a supplier, add an entry and its CSV
// (same columns as the CRE open-data files: DATE_DEBUT, DATE_FIN, P_SOUSCRITE,
// PART_FIXE_TTC and either PART_VARIABLE_HC_TTC + PART_VARIABLE_HP_TTC or PART_VARIABLE_TTC).

import { type TempoRow, type TrveRow, parseTempoCsv, parseTrveCsv } from './analysis';

export interface Offer {
  id: string;
  supplier: string;
  label: string;
  file: string; // under public/tarifs/
}

export const OFFERS: Offer[] = [
  { id: 'edf-trv-hphc', supplier: 'EDF', label: 'Tarif Bleu — Heures pleines / creuses', file: 'Option_HPHC.csv' },
  { id: 'edf-trv-base', supplier: 'EDF', label: 'Tarif Bleu — Base', file: 'Option_Base.csv' },
];

/** One contract period: from that day on (until the next period), this offer and power. */
export interface ContractPeriod {
  from: string; // YYYY-MM-DD
  offer: string;
  kva: number;
}

export async function loadOffers(): Promise<Map<string, TrveRow[]>> {
  const out = new Map<string, TrveRow[]>();
  await Promise.all(
    OFFERS.map(async (o) => {
      try {
        const resp = await fetch(`tarifs/${o.file}`, { cache: 'no-cache' });
        if (!resp.ok || (resp.headers.get('content-type') ?? '').includes('text/html')) return;
        out.set(o.id, parseTrveCsv(await resp.text()));
      } catch {
        /* offer unavailable offline: costs for it stay empty */
      }
    }),
  );
  return out;
}

export function periodAt(contracts: ContractPeriod[], day: string): ContractPeriod | null {
  let found: ContractPeriod | null = null;
  for (const c of [...contracts].sort((a, b) => (a.from < b.from ? -1 : 1))) if (c.from <= day) found = c;
  return found ?? contracts[0] ?? null;
}

/** EDF Tempo prices (CRE) and the public history of day colours (1 blue, 2 white, 3 red). */
export async function loadTempo(): Promise<{ rows: TempoRow[]; days: Map<string, number> }> {
  const get = async (f: string) => {
    try {
      const r = await fetch(`tarifs/${f}`, { cache: 'no-cache' });
      return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html') ? r : null;
    } catch {
      return null;
    }
  };
  const [csv, days] = await Promise.all([get('Option_Tempo.csv'), get('tempo_jours.json')]);
  return {
    rows: csv ? parseTempoCsv(await csv.text()) : [],
    days: days ? new Map(Object.entries((await days.json()) as Record<string, number>)) : new Map(),
  };
}
