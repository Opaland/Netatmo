// #313: the page of a room (« maintenant », planning of the day, time at the requested
// temperature, « Pourquoi il a fait froid ») and the Pièces list (sorted by cost, comfort pill).
// Pure functions, no DOM: unit-tested in piece.test.ts. The view lives in views/piece.ts.
import type { Slot } from './components';
import { fmt1, hourMin } from './glossary';
import { type Room30, SLOTS, unpack } from './room30';
import { ABSENCE_MODES, type StateCell, modeLabel } from './windows';

// ------------------------------------------------------------------ « maintenant »
export interface Reading {
  day: string;
  /** Half hour of the day (0-47) of the last measured temperature. */
  slot: number;
  /** Measured temperatures at that half hour, one per room that has one (a group has several). */
  temps: number[];
  /** Requested temperatures (setpoints) at that half hour, same rooms. */
  setpoints: number[];
}

/** The latest half hour with a measured temperature in any of `rooms` (raw ids), or null. */
export function lastReading(r30: Room30, rooms: string[]): Reading | null {
  let best: { day: string; slot: number } | null = null;
  for (const id of rooms) {
    const days = r30.get(id);
    if (!days) continue;
    for (const [day, cols] of days) {
      if (best && day < best.day) continue;
      const t = unpack(cols[2]);
      for (let i = SLOTS - 1; i >= 0; i--) {
        if (t[i] === null) continue;
        if (!best || day > best.day || i > best.slot) best = { day, slot: i };
        break;
      }
    }
  }
  if (!best) return null;
  const temps: number[] = [];
  const setpoints: number[] = [];
  for (const id of rooms) {
    const cols = r30.get(id)?.get(best.day);
    if (!cols) continue;
    const t = unpack(cols[2])[best.slot];
    const sp = unpack(cols[3])[best.slot];
    if (t !== null) temps.push(t);
    if (sp !== null) setpoints.push(sp);
  }
  return { ...best, temps, setpoints };
}

export interface Schedule {
  slots: Slot[];
  /** Requested temperature of the comfort and eco slots, °C. */
  comfort: number;
  eco: number;
}

/**
 * The schedule of a day read from its 48 half-hour setpoints: comfort where the setpoint is in the
 * upper half of the day's range, eco elsewhere. Null when the day has too few setpoints (fewer than
 * 40 half hours) or a constant one (less than 0,5 °C between the highest and the lowest).
 */
export function scheduleOf(sp: (number | null)[]): Schedule | null {
  const known = sp.filter((v): v is number => v !== null);
  if (known.length < 40) return null;
  const max = Math.max(...known);
  const min = Math.min(...known);
  if (max - min < 0.5) return null;
  const mid = (max + min) / 2;
  const kinds: Slot['kind'][] = [];
  let prev: Slot['kind'] | null = null;
  for (let i = 0; i < SLOTS; i++) {
    const v = sp[i] ?? null;
    const k: Slot['kind'] = v === null ? (prev ?? (known[0] >= mid ? 'comfort' : 'eco')) : v >= mid ? 'comfort' : 'eco';
    kinds.push(k);
    prev = k;
  }
  const slots: Slot[] = [];
  for (let i = 0; i < SLOTS; i++) {
    const last = slots[slots.length - 1];
    if (last && last.kind === kinds[i]) last.to = (i + 1) / 2;
    else slots.push({ from: i / 2, to: (i + 1) / 2, kind: kinds[i] });
  }
  return { slots, comfort: max, eco: min };
}

/**
 * Mode at a half hour of the schedule and until when (hours, 0-24; the day is assumed to repeat:
 * a slot that runs to midnight goes on with the first slot of the day), and the next mode.
 */
export function modeAt(s: Schedule, slot: number): { kind: Slot['kind']; until: number; next: Slot['kind'] } {
  const h = slot / 2;
  const i = Math.max(0, s.slots.findIndex((x) => x.from <= h && h < x.to));
  const cur = s.slots[i];
  if (i < s.slots.length - 1) return { kind: cur.kind, until: cur.to, next: s.slots[i + 1].kind };
  // the last slot of the day: it goes on with the first one when they are the same mode
  const first = s.slots[0];
  if (first.kind === cur.kind && s.slots.length > 1) return { kind: cur.kind, until: first.to, next: s.slots[1].kind };
  return { kind: cur.kind, until: 0, next: first.kind };
}

/** « Confort jusqu'à 22 h, puis économie 18 °C ». */
export function modeText(s: Schedule, slot: number): string {
  const m = modeAt(s, slot);
  const name = (k: Slot['kind']) => (k === 'comfort' ? 'confort' : 'économie');
  const temp = (k: Slot['kind']) => `${fmt1(k === 'comfort' ? s.comfort : s.eco)}\u00a0°C`;
  const now = name(m.kind);
  return `${now[0].toUpperCase()}${now.slice(1)} jusqu’à ${hourMin(Math.floor(m.until), Math.round((m.until % 1) * 60))}, puis ${name(m.next)} ${temp(m.next)}`;
}

/**
 * Off-peak hours, read from where the energy of the half hours was counted (HP / HC columns) over
 * [from, to], every room: a half hour is off-peak when most of its energy went to HC. Ranges of
 * hours [from, to) (a range over midnight has to < from); none when HC is never or always used.
 */
export function offPeakRanges(r30: Room30, from: string, to: string): [number, number][] {
  const hp = new Array<number>(SLOTS).fill(0);
  const hc = new Array<number>(SLOTS).fill(0);
  for (const days of r30.values()) {
    for (const [d, cols] of days) {
      if (d < from || d > to) continue;
      unpack(cols[0]).forEach((v, i) => (hp[i] += v ?? 0));
      unpack(cols[1]).forEach((v, i) => (hc[i] += v ?? 0));
    }
  }
  const off = hc.map((v, i) => v > 0 && v >= hp[i]);
  const n = off.filter(Boolean).length;
  if (!n || n === SLOTS) return [];
  const ranges: [number, number][] = [];
  for (let i = 0; i < SLOTS; i++) {
    if (!off[i]) continue;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i / 2) last[1] = (i + 1) / 2;
    else ranges.push([i / 2, (i + 1) / 2]);
  }
  // a range ending at midnight goes on with the one starting at 0 h
  if (ranges.length > 1 && ranges[0][0] === 0 && ranges[ranges.length - 1][1] === 24) {
    const end = ranges.shift()!;
    ranges[ranges.length - 1][1] = end[1];
  }
  return ranges;
}

// ------------------------------------------------------------------ time at the requested temperature
/** Setpoints below this are frost guard or « off »: not a temperature anyone asked to live in. */
export const LIVING_SETPOINT = 10;
/** Tolerance under the setpoint: a radiator regulates around it. */
export const SETPOINT_TOLERANCE = 0.5;

/**
 * « Temps à la consigne » (owner feedback « tps consigné ? de quoi ? de qui ? »): the share of the
 * hours when the room was at the temperature asked of its radiators (measured ≥ setpoint − 0,5 °C),
 * over [from, to], counting only the half hours with both readings and a living setpoint. Null with
 * less than one day of such half hours.
 */
export function timeAtSetpoint(r30: Room30, rooms: string[], from: string, to: string, tol = SETPOINT_TOLERANCE): { share: number; hours: number } | null {
  let n = 0;
  let at = 0;
  for (const id of rooms) {
    for (const [d, cols] of r30.get(id) ?? []) {
      if (d < from || d > to) continue;
      const t = unpack(cols[2]);
      const sp = unpack(cols[3]);
      for (let i = 0; i < SLOTS; i++) {
        const a = t[i];
        const b = sp[i];
        if (a === null || b === null || b < LIVING_SETPOINT) continue;
        n++;
        if (a >= b - tol) at++;
      }
    }
  }
  return n >= SLOTS ? { share: at / n, hours: n / 2 } : null;
}

// ------------------------------------------------------------------ « Pourquoi il a fait froid »
export type Reason =
  | { kind: 'window'; hours: number }
  | { kind: 'drop'; at: string; fall: number }
  | { kind: 'offload'; hours: number }
  | { kind: 'mode'; mode: string; hours: number }
  | { kind: 'setpoint'; value: number }
  | { kind: 'none' }
  | { kind: 'nodata' };

export interface ColdDay {
  day: string;
  temp: number;
  reasons: Reason[];
}

const MODES_COLD = [...ABSENCE_MODES, 'off'];
const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Days whose mean temperature was below `threshold`, most recent first, each with what the radiator
 * reported that day (hourly snapshots, summed over the rooms of a group): window open, sharp fall of
 * the half-hour temperature (an opening the snapshots missed), load shedding, absence / frost-guard
 * mode, a requested temperature already under the threshold. `cells(day)` is null when no snapshot
 * covers the day.
 */
export function coldDays(
  days: { day: string; temp: number | null; setpoint: number | null }[],
  threshold: number,
  cells: (day: string) => StateCell[] | null,
  drop?: (day: string) => { at: string; fall: number } | undefined,
): ColdDay[] {
  const out: ColdDay[] = [];
  for (const { day, temp, setpoint } of days) {
    if (temp === null || !(temp < threshold)) continue;
    const c = cells(day);
    const reasons: Reason[] = [];
    const open = (c ?? []).reduce((s, x) => s + (x.open_window_h ?? 0), 0);
    const shed = (c ?? []).reduce((s, x) => s + (x.offload_h ?? 0), 0);
    const modes = new Map<string, number>();
    for (const x of c ?? []) for (const [m, h] of Object.entries(x.mode_h ?? {})) if (MODES_COLD.includes(m)) modes.set(m, Math.max(modes.get(m) ?? 0, h));
    const fall = drop?.(day);
    if (open >= 0.5) reasons.push({ kind: 'window', hours: r1(open) });
    else if (fall) reasons.push({ kind: 'drop', at: fall.at, fall: fall.fall });
    if (shed >= 0.5) reasons.push({ kind: 'offload', hours: r1(shed) });
    const [mode, hours] = [...modes].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    if (hours >= 1) reasons.push({ kind: 'mode', mode, hours: r1(hours) });
    if (setpoint !== null && setpoint < threshold && !reasons.some((r) => r.kind === 'mode')) reasons.push({ kind: 'setpoint', value: setpoint });
    if (!reasons.length) reasons.push({ kind: c && c.length ? 'none' : 'nodata' });
    out.push({ day, temp, reasons });
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : -1));
}

const hours = (h: number) => `${fmt1(h).replace(/,0$/, '')} h`;

/** The words of one reason, as the list shows it. */
export function reasonText(r: Reason, threshold: number): string {
  switch (r.kind) {
    case 'window':
      return `fenêtre ouverte ${hours(r.hours)}`;
    case 'drop':
      return `chute de ${fmt1(r.fall)}\u00a0°C vers ${hourMin(r.at)} (fenêtre ou porte ouverte ?)`;
    case 'offload':
      return `radiateur coupé ${hours(r.hours)} (délestage)`;
    case 'mode':
      return `mode ${modeLabel(r.mode)} ${hours(r.hours)}`;
    case 'setpoint':
      return `température demandée de ${fmt1(r.value)}\u00a0°C, sous le seuil de ${fmt1(threshold)}\u00a0°C`;
    case 'none':
      return 'pas d’explication trouvée : fenêtre fermée, ni délestage ni absence';
    default:
      return 'pas de relevé de l’état du radiateur ce jour-là';
  }
}

// ------------------------------------------------------------------ the Pièces list
export interface Pill {
  level: 'ok' | 'warn';
  text: string;
}
/** Window open this many hours over the period shown: worth a look. */
export const WINDOW_PILL_HOURS = 4;

/** Comfort pill of a room: cold days first, then a window often open, else « confort ». */
export function comfortPill(cold: number, openHours: number | null, threshold: number): Pill {
  if (cold > 0) return { level: 'warn', text: `${cold} j sous ${fmt1(threshold)}\u00a0°C` };
  if (openHours !== null && openHours >= WINDOW_PILL_HOURS) return { level: 'warn', text: `fenêtre ${hours(Math.round(openHours))}` };
  return { level: 'ok', text: 'confort' };
}

/** Rooms by cost (€, then kWh when there is no price or a tie), the most expensive first. */
export function byCost<T extends { eur: number | null; kwh: number }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => (b.eur ?? -1) - (a.eur ?? -1) || b.kwh - a.kwh);
}

/** Mean of the values of `days` in [from, to] (null when none). */
export function meanIn(values: Iterable<[string, number | null | undefined]>, from: string, to: string): { mean: number; n: number } | null {
  let s = 0;
  let n = 0;
  for (const [d, v] of values) {
    if (d < from || d > to || v === null || v === undefined || !Number.isFinite(v)) continue;
    s += v;
    n++;
  }
  return n ? { mean: s / n, n } : null;
}

/** Y axis bounds of a temperature chart: whole degrees around the data, never 0 (#320, « échelle »). */
export function tempAxis(values: (number | null)[], pad = 0.5): { min: number; max: number } | null {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  if (!v.length) return null;
  const min = Math.floor(Math.min(...v) - pad);
  const max = Math.ceil(Math.max(...v) + pad);
  return { min, max: max - min < 2 ? min + 2 : max };
}
