// v1.5: health of the devices and of the meters, from devices.enc.json, station.enc.json
// ("health"), linky.enc.json ("pmax_at", "index") and the meta ("intuis_contract").
// Pure functions, no DOM (devices.test.ts). Formats: collector/devices.py, docs/api-notes.md.
//   #214 modules not answering · #215 station batteries · #216 firmware changes · #218 anticipation
//   and lowering hours · #219 time of the Linky peak · #276 gateway restarts and Wi-Fi ·
//   #277 Linky index per rate period · #278 contract and Tempo colour seen by Intuis.
import type { ContractPeriod } from './offers';

export interface DevicesDoc {
  modules?: Record<string, { type?: string; room?: string; setup?: string; fw?: string }>;
  reach?: Record<string, Record<string, number>>; // module -> day -> 1 answering / 0 not
  firmware?: Record<string, [string, string, string][]>; // module -> [day, from, to]
  gateway?: { boots?: string[]; wifi?: Record<string, [number, number, number, number]> };
  tempo?: Record<string, string>; // Tempo day -> colour known by the gateway
}

export type StationHealth = Record<string, Record<string, [number | null, number | null, number]>>; // module -> day -> [battery %, signal, answering]

export interface IntuisContract {
  tariff?: string | string[];
  tariff_option?: string | string[];
  price_type?: string | string[];
  power_unit?: string;
  kva?: number;
}

export const LOW_BATTERY = 15; // %, same threshold as the collector (station.py)
export const WEAK_RF = 90; // rf_status: 90 = low, 60 = highest (Netatmo)
export const WEAK_WIFI = 86; // wifi_status: 86 = bad, 56 = good (Netatmo)

const TYPE_LABEL: Record<string, string> = {
  NMH: 'radiateur',
  NMW: 'chauffe-eau',
  NMR: 'relais',
  NMG: 'passerelle Intuis',
  NAMain: 'station (module intérieur principal)',
  NAModule1: 'module extérieur',
  NAModule4: 'module intérieur',
  NAModule2: 'anémomètre',
  NAModule3: 'pluviomètre',
};
export const typeLabel = (t?: string) => (t && TYPE_LABEL[t]) || 'module';

const lastKey = (o: Record<string, unknown> | undefined) => Object.keys(o ?? {}).sort().pop();

/** #214: modules whose last nightly status says they do not answer, with the first day of the run. */
export function offlineModules(doc: DevicesDoc | null | undefined): { key: string; type?: string; room?: string; since: string }[] {
  const out: { key: string; type?: string; room?: string; since: string }[] = [];
  const latest = Object.values(doc?.reach ?? {}).reduce<string>((a, days) => {
    const k = lastKey(days);
    return k && k > a ? k : a;
  }, '');
  for (const [key, days] of Object.entries(doc?.reach ?? {})) {
    const sorted = Object.keys(days).sort();
    const last = sorted[sorted.length - 1];
    if (!last || last !== latest || days[last] !== 0) continue;
    let i = sorted.length - 1;
    while (i > 0 && days[sorted[i - 1]] === 0) i--;
    const m = doc?.modules?.[key];
    out.push({ key, type: m?.type, room: m?.room, since: sorted[i] });
  }
  return out;
}

/**
 * #346: the modules not answering, split between the rooms whose radiator was switched off on
 * purpose (⚙ Mon logement: a stove…), silent as expected, and the others (out of reach).
 */
export function splitStopped<T extends { room?: string }, S extends { room: string; from: string }>(mods: T[], stopped: S[]): { off: T[]; stopped: (T & { stop: S })[] } {
  const by = new Map(stopped.map((s) => [s.room, s]));
  const out: { off: T[]; stopped: (T & { stop: S })[] } = { off: [], stopped: [] };
  for (const m of mods) {
    const s = m.room ? by.get(m.room) : undefined;
    if (s) out.stopped.push({ ...m, stop: s });
    else out.off.push(m);
  }
  return out;
}

/** #214: days a room had a module not answering (nightly status, or offline hours of the snapshots). */
export function offlineDays(doc: DevicesDoc | null | undefined, roomOffline?: Map<string, Set<string>>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (room: string, day: string) => (out.get(room) ?? out.set(room, new Set()).get(room)!).add(day);
  for (const [key, days] of Object.entries(doc?.reach ?? {})) {
    const room = doc?.modules?.[key]?.room;
    if (!room) continue;
    for (const [d, v] of Object.entries(days)) if (v === 0) add(room, d);
  }
  for (const [room, days] of roomOffline ?? []) for (const d of days) add(room, d);
  return out;
}

export interface FirmwareEvent {
  day: string;
  key: string;
  type?: string;
  room?: string;
  from: string;
  to: string;
}

/** #216: firmware changes (newest first). */
export function firmwareLog(doc: DevicesDoc | null | undefined): FirmwareEvent[] {
  const out: FirmwareEvent[] = [];
  for (const [key, changes] of Object.entries(doc?.firmware ?? {})) {
    const m = doc?.modules?.[key];
    for (const [day, from, to] of changes) out.push({ day, key, type: m?.type, room: m?.room, from, to });
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.key.localeCompare(b.key)));
}

/** #216: one line per (day, module type, from → to): ten radiators updated the same night are one event. */
export function firmwareSummary(events: FirmwareEvent[]): { day: string; type?: string; from: string; to: string; n: number }[] {
  const out = new Map<string, { day: string; type?: string; from: string; to: string; n: number }>();
  for (const e of events) {
    const k = `${e.day}|${e.type}|${e.from}|${e.to}`;
    const cur = out.get(k);
    if (cur) cur.n++;
    else out.set(k, { day: e.day, type: e.type, from: e.from, to: e.to, n: 1 });
  }
  return [...out.values()];
}

/** #216: commissioning dates (setup_date), oldest first, per day and type. */
export function setupDates(doc: DevicesDoc | null | undefined): { day: string; type?: string; n: number }[] {
  const out = new Map<string, { day: string; type?: string; n: number }>();
  for (const m of Object.values(doc?.modules ?? {})) {
    if (!m.setup) continue;
    const k = `${m.setup}|${m.type}`;
    const cur = out.get(k);
    if (cur) cur.n++;
    else out.set(k, { day: m.setup, type: m.type, n: 1 });
  }
  return [...out.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** #276: gateway restarts (local "YYYY-MM-DDTHH:MM"), newest first; the first one is the start before monitoring. */
export function restarts(doc: DevicesDoc | null | undefined, from = ''): string[] {
  const all = [...(doc?.gateway?.boots ?? [])].sort();
  return all.slice(1).filter((b) => b.slice(0, 10) >= from).reverse();
}

/** #276: daily Wi-Fi of the gateway over [from, to]: [min, mean, max] of the means and extremes. */
export function wifiSummary(doc: DevicesDoc | null | undefined, from: string, to: string): { days: number; min: number; mean: number; max: number } | null {
  const cells = Object.entries(doc?.gateway?.wifi ?? {}).filter(([d]) => d >= from && d <= to).map(([, c]) => c);
  if (!cells.length) return null;
  const n = cells.reduce((a, c) => a + c[3], 0);
  return {
    days: cells.length,
    min: Math.min(...cells.map((c) => c[0])),
    mean: Math.round((cells.reduce((a, c) => a + c[1] * c[3], 0) / n) * 10) / 10,
    max: Math.max(...cells.map((c) => c[2])),
  };
}

export interface BatteryRow {
  key: string;
  day: string;
  battery: number | null;
  signal: number | null;
  answering: boolean;
  low: boolean;
  weakSignal: boolean;
  trend: number[]; // battery, oldest first (last 90 values)
}

/** #215: last health reading of each station module. */
export function stationHealth(health: StationHealth | null | undefined, mainKeys: Set<string> = new Set(['m0'])): BatteryRow[] {
  return Object.entries(health ?? {})
    .map(([key, days]) => {
      const sorted = Object.keys(days).sort();
      const day = sorted[sorted.length - 1];
      const [battery, signal, ok] = days[day];
      const trend = sorted
        .slice(-90)
        .map((d) => days[d][0])
        .filter((v): v is number => v !== null);
      return {
        key,
        day,
        battery,
        signal,
        answering: ok === 1,
        low: battery !== null && battery < LOW_BATTERY,
        weakSignal: signal !== null && signal >= (mainKeys.has(key) ? WEAK_WIFI : WEAK_RF),
        trend,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key, 'fr', { numeric: true }));
}

/** #278: Tempo colour code (1 blue, 2 white, 3 red) of a gateway value; null when unknown. */
export function tempoCode(v: string | number | undefined): number | null {
  if (v === undefined) return null;
  const s = String(v).toLowerCase();
  if (/blue|bleu/.test(s)) return 1;
  if (/white|blanc/.test(s)) return 2;
  if (/red|rouge/.test(s)) return 3;
  return /^[123]$/.test(s) ? Number(s) : null; // numeric codes: à confirmer, used only if they agree (see fillTempo)
}

export interface TempoCheck {
  overlap: number; // days known by both
  agree: number;
  mismatch: string[]; // days where they differ
  filled: string[]; // days added from the gateway
  trusted: boolean; // enough agreement to fill missing days
}

/**
 * #278: compare the gateway colours with the public calendar (api-couleur-tempo.fr) and fill the
 * days missing there, only when the two agree on at least 90 % of 7 days or more (so a value
 * mapping that is wrong can never price a day). Mutates `days`.
 */
export function fillTempo(days: Map<string, number>, gateway: Record<string, string> | undefined, upTo: string): TempoCheck {
  const out: TempoCheck = { overlap: 0, agree: 0, mismatch: [], filled: [], trusted: false };
  const codes = Object.entries(gateway ?? {})
    .map(([d, v]) => [d, tempoCode(v)] as const)
    .filter((x): x is readonly [string, number] => x[1] !== null);
  for (const [d, c] of codes) {
    const known = days.get(d);
    if (known === undefined) continue;
    out.overlap++;
    if (known === c) out.agree++;
    else out.mismatch.push(d);
  }
  out.trusted = out.overlap >= 7 && out.agree / out.overlap >= 0.9;
  if (out.trusted) {
    for (const [d, c] of codes) {
      if (!days.has(d) && d <= upTo) {
        days.set(d, c);
        out.filled.push(d);
      }
    }
  }
  out.mismatch.sort().reverse();
  out.filled.sort();
  return out;
}

/** #278: offer id of the shared contract that the tariff option seen by Intuis means (null: unknown). */
export function intuisOffer(ic: IntuisContract | null | undefined): 'edf-trv-base' | 'edf-trv-hphc' | 'tempo' | null {
  const values = [ic?.tariff_option, ic?.tariff, ic?.price_type].flat().filter((v): v is string => typeof v === 'string');
  const text = values.join(' ').toLowerCase();
  if (/tempo/.test(text)) return 'tempo';
  if (/off_peak|peak|hphc|hp_hc|creuse|pleine/.test(text)) return 'edf-trv-hphc';
  if (/base/.test(text)) return 'edf-trv-base';
  return null;
}

/** #278: what differs between the contract seen by Intuis and the shared contract in force today. */
export function contractMismatch(ic: IntuisContract | null | undefined, current: ContractPeriod | undefined): string[] {
  if (!ic || !current) return [];
  const out: string[] = [];
  const offer = intuisOffer(ic);
  if (offer && offer !== current.offer) out.push('option');
  if (typeof ic.kva === 'number' && ic.kva !== current.kva) out.push('puissance');
  return out;
}

/** #219: daily peaks per hour band over [from, to] (local hour of the peak). */
export function peakHours(pmax: Map<string, number>, at: Map<string, string>, from: string, to: string): { hour: number; n: number }[] {
  const n = new Array<number>(24).fill(0);
  for (const [d, hhmm] of at) if (d >= from && d <= to && pmax.has(d)) n[Number(hhmm.slice(0, 2))]++;
  return n.map((v, hour) => ({ hour, n: v })).filter((x) => x.n);
}

/** #277: per day, consumption from the index (sum of the deltas of one calendar) vs the daily total. */
export function indexCheck(
  index: Record<string, Record<string, number>> | undefined,
  daily: Map<string, number>, // day -> kWh
  tolerance = 0.02,
): { days: number; off: { day: string; index: number; daily: number }[] } {
  const groups = new Map<string, string[]>();
  for (const name of Object.keys(index ?? {})) {
    const g = name.includes('.') ? name.slice(0, name.indexOf('.')) : name;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(name);
  }
  const perDay = new Map<string, number[]>(); // day -> kWh per calendar group
  for (const names of groups.values()) {
    const sums = new Map<string, number>();
    let complete = new Set<string>();
    names.forEach((name, i) => {
      const days = Object.keys(index![name]).sort();
      const here = new Set<string>();
      for (let j = 1; j < days.length; j++) {
        const [a, b] = [days[j - 1], days[j]];
        if (addOne(a) !== b) continue;
        const delta = (index![name][b] - index![name][a]) / 1000;
        sums.set(b, (sums.get(b) ?? 0) + delta);
        here.add(b);
      }
      complete = i ? new Set([...complete].filter((d) => here.has(d))) : here;
    });
    for (const d of complete) (perDay.get(d) ?? perDay.set(d, []).get(d)!).push(sums.get(d)!);
  }
  const off: { day: string; index: number; daily: number }[] = [];
  let days = 0;
  for (const [d, sums] of perDay) {
    // An index dated D is read at the start of D: the delta D-1 → D is the consumption of D-1.
    const day = addOne(d, -1);
    const ref = daily.get(day);
    if (ref === undefined || ref <= 0) continue;
    days++;
    const best = sums.reduce((a, s) => (Math.abs(s - ref) < Math.abs(a - ref) ? s : a), sums[0]);
    if (Math.abs(best - ref) > tolerance * ref) off.push({ day, index: Math.round(best * 10) / 10, daily: Math.round(ref * 10) / 10 });
  }
  return { days, off: off.sort((a, b) => (a.day < b.day ? 1 : -1)) };
}

function addOne(day: string, n = 1): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface StateHoursCell {
  n: number;
  anticipating_h?: number;
  lowering_h?: number;
  offline_h?: number;
}

/** #218, #214: per room, hours of anticipation, lowering and module offline over [from, to]. */
export function roomStateHours(
  rooms: Record<string, Record<string, StateHoursCell>> | undefined,
  from: string,
  to: string,
): { room: string; days: number; anticipating: number; lowering: number; offline: number; offlineDays: string[] }[] {
  const out = [];
  for (const [room, days] of Object.entries(rooms ?? {})) {
    let n = 0;
    let a = 0;
    let l = 0;
    let o = 0;
    const offDays: string[] = [];
    for (const [d, c] of Object.entries(days)) {
      if (d < from || d > to) continue;
      if (c.anticipating_h === undefined && c.lowering_h === undefined && c.offline_h === undefined) continue;
      n++;
      a += c.anticipating_h ?? 0;
      l += c.lowering_h ?? 0;
      o += c.offline_h ?? 0;
      if ((c.offline_h ?? 0) >= 1) offDays.push(d);
    }
    if (n) out.push({ room, days: n, anticipating: Math.round(a * 10) / 10, lowering: Math.round(l * 10) / 10, offline: Math.round(o * 10) / 10, offlineDays: offDays.sort() });
  }
  return out;
}
