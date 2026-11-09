// S-1.18: Home Assistant statistics imported by `python -m collector import-ha` (ha.enc.json,
// docs/import-ha.md), shown in Confort, and the agreement between an opening sensor and the
// open-window detection of the Intuis radiator of the same room. Pure functions, unit-tested.
import type { RoomState } from './windows';

export type HaKind = 'opening' | 'binary' | 'energy' | 'temperature' | 'humidity' | 'power' | 'numeric';

export interface HaDay {
  on_h?: number;
  n?: number;
  kwh?: number;
  min?: number;
  max?: number;
  mean?: number;
}

export interface HaDoc {
  sensors?: Record<string, { entity?: string; name?: string; kind?: HaKind; unit?: string }>;
  daily?: Record<string, Record<string, HaDay>>;
  imported?: string;
}

export const KIND_LABEL: Record<HaKind, string> = {
  opening: 'Ouverture',
  binary: 'Tout ou rien',
  energy: 'Énergie',
  temperature: 'Température',
  humidity: 'Humidité',
  power: 'Puissance',
  numeric: 'Mesure',
};

export interface SensorSummary {
  key: string;
  name: string;
  kind: HaKind;
  unit: string;
  first: string | null;
  last: string | null;
  days: number; // days in [from, to]
  onHours: number; // opening / binary
  openings: number;
  kwh: number; // energy
  mean: number | null; // other numbers: mean of the daily means
  min: number | null;
  max: number | null;
}

/** One line per sensor over [from, to], in the order of the import. */
export function summarize(doc: HaDoc, from: string, to: string): SensorSummary[] {
  return Object.entries(doc.sensors ?? {})
    .sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)))
    .map(([key, s]) => {
      const all = doc.daily?.[key] ?? {};
      const days = Object.keys(all).sort();
      const inRange = days.filter((d) => d >= from && d <= to).map((d) => all[d]);
      const means = inRange.map((v) => v.mean).filter((v): v is number => typeof v === 'number');
      const mins = inRange.map((v) => v.min).filter((v): v is number => typeof v === 'number');
      const maxs = inRange.map((v) => v.max).filter((v): v is number => typeof v === 'number');
      return {
        key,
        name: s.name || s.entity || key,
        kind: s.kind ?? 'numeric',
        unit: s.unit ?? '',
        first: days[0] ?? null,
        last: days[days.length - 1] ?? null,
        days: inRange.length,
        onHours: inRange.reduce((t, v) => t + (v.on_h ?? 0), 0),
        openings: inRange.reduce((t, v) => t + (v.n ?? 0), 0),
        kwh: inRange.reduce((t, v) => t + (v.kwh ?? 0), 0),
        mean: means.length ? means.reduce((a, b) => a + b, 0) / means.length : null,
        min: mins.length ? Math.min(...mins) : null,
        max: maxs.length ? Math.max(...maxs) : null,
      };
    });
}

/** Last day of any sensor, or null. */
export function lastHaDay(doc: HaDoc): string | null {
  let last: string | null = null;
  for (const days of Object.values(doc.daily ?? {})) for (const d of Object.keys(days)) if (!last || d > last) last = d;
  return last;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** The heated room whose name appears in the sensor's name or entity (longest match), else null. */
export function guessRoom(sensor: { name?: string; entity?: string }, rooms: { id: string; name: string }[]): string | null {
  const hay = fold(`${sensor.name ?? ''} ${(sensor.entity ?? '').replace(/_/g, ' ')}`);
  let best: { id: string; len: number } | null = null;
  for (const r of rooms) {
    const n = fold(r.name).trim();
    if (n.length >= 3 && hay.includes(n) && (!best || n.length > best.len)) best = { id: r.id, len: n.length };
  }
  return best?.id ?? null;
}

export interface Agreement {
  days: number; // days with both an HA aggregate and an Intuis snapshot
  bothOpen: number;
  sensorOnly: number; // the sensor saw an opening, the radiator did not
  intuisOnly: number; // the radiator detected an open window, the sensor saw nothing
  bothClosed: number;
  rate: number | null; // (bothOpen + bothClosed) / days
  sensorHours: number;
  intuisHours: number;
}

/**
 * Daily agreement between an opening sensor and `open_window` of the Intuis rooms `rooms`
 * (several raw rooms when the household view merged them): a day is "open" for a source when it
 * reports at least `minHours`. Only daily aggregates exist on both sides, so this compares days,
 * not hours: a short airing the radiator cannot see (no temperature drop) counts as "sensor only".
 */
export function agreement(sensor: Record<string, HaDay>, rs: RoomState, rooms: string[], minHours = 0.5): Agreement {
  const a: Agreement = { days: 0, bothOpen: 0, sensorOnly: 0, intuisOnly: 0, bothClosed: 0, rate: null, sensorHours: 0, intuisHours: 0 };
  for (const [d, v] of Object.entries(sensor)) {
    const cells = rooms.map((r) => rs.rooms?.[r]?.[d]).filter((c) => c !== undefined);
    if (!cells.length || v.on_h === undefined) continue;
    const intuis = cells.reduce((t, c) => t + (c!.open_window_h ?? 0), 0);
    const s = v.on_h >= minHours;
    const i = intuis >= minHours;
    a.days++;
    a.sensorHours += v.on_h;
    a.intuisHours += intuis;
    if (s && i) a.bothOpen++;
    else if (s) a.sensorOnly++;
    else if (i) a.intuisOnly++;
    else a.bothClosed++;
  }
  a.rate = a.days ? (a.bothOpen + a.bothClosed) / a.days : null;
  a.sensorHours = Math.round(a.sensorHours * 10) / 10;
  a.intuisHours = Math.round(a.intuisHours * 10) / 10;
  return a;
}
