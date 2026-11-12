// #452: the lower level of the house — a heated bedroom and a heated entrance next to the garage,
// which the household uses as an airlock — and the heat it costs. Pure functions (no DOM, no app
// state): views/lower.ts reads the choices of this device and draws the card.
//
// What is measured, and why (comments of the owner on #452):
// - the bedroom is heated, so its temperature alone says little: the measure is the ENERGY of the
//   radiators of the chosen rooms, at equal cold (per degree day, base 18 °C, as everywhere);
// - the entrance and the garage door face south: the sun of the day hides part of the losses, so
//   the days kept are the heating days with LITTLE sun (Open-Meteo radiation at or under the
//   median of the heating days), and the nights (0 h – 6 h, no sun at all) when the half hours of
//   the radiators are collected;
// - a probe in an unheated space (garage, technical room), when there is one, is used as well:
//   its gap to the outside says how much warmer the space is kept.
import { addDays, seasonOf } from './aggregate';
import { type Weather, dju } from './analysis';
import { isDay } from './invoice';
import { HEATING_DAY_BELOW, MIN_SIDE_DAYS } from './works';

export type LowerKind = 'joints' | 'rideau' | 'porte' | 'isolation' | 'autre';
export const LOWER_KINDS: Record<LowerKind, string> = {
  joints: 'Joints de porte',
  rideau: 'Rideau thermique',
  porte: 'Porte changée ou réglée',
  isolation: 'Isolation',
  autre: 'Autre',
};

export interface LowerMarker {
  day: string; // YYYY-MM-DD, first day « after »
  kind: LowerKind;
  label: string; // free text, stays on this device (never exported)
}

export interface LowerPrefs {
  rooms: string[]; // heated rooms of the lower level (raw Intuis ids)
  probe: string | null; // station module in an unheated space (garage, technical room), if any
  markers: LowerMarker[];
}

export const NO_LOWER: LowerPrefs = { rooms: [], probe: null, markers: [] };
export const MAX_LOWER_ROOMS = 8;
export const MAX_LOWER_MARKERS = 20;
const ID = /^[\w.:-]{1,64}$/;

/** Clean what comes back from storage (never trusted blindly; fuzzed in fuzz.test.ts). */
export function validLower(v: unknown): LowerPrefs {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return NO_LOWER;
  const o = v as Record<string, unknown>;
  const rooms = Array.isArray(o.rooms) ? [...new Set(o.rooms.filter((r): r is string => typeof r === 'string' && ID.test(r)))].slice(0, MAX_LOWER_ROOMS) : [];
  const probe = typeof o.probe === 'string' && ID.test(o.probe) ? o.probe : null;
  const byDay = new Map<string, LowerMarker>();
  if (Array.isArray(o.markers)) {
    for (const m of o.markers as unknown[]) {
      if (!m || typeof m !== 'object') continue;
      const x = m as Record<string, unknown>;
      if (typeof x.day !== 'string' || !isDay(x.day)) continue;
      const kind = typeof x.kind === 'string' && Object.hasOwn(LOWER_KINDS, x.kind) ? (x.kind as LowerKind) : 'autre';
      byDay.set(x.day, { day: x.day, kind, label: typeof x.label === 'string' ? x.label.slice(0, 80) : '' });
    }
  }
  const markers = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-MAX_LOWER_MARKERS);
  return { rooms, probe, markers };
}

/** One day of the lower level. */
export interface LowerDay {
  day: string;
  kwh: number; // heating of the chosen rooms that day
  night: number | null; // the same, 0 h – 6 h, when the half hours are collected
  tOut: number; // outdoor mean
  dju: number;
  sun: number | null; // global radiation of the day, MJ/m² (Open-Meteo)
  tRoom: number | null; // daily mean of the station module of the bedroom
  tProbe: number | null; // daily mean of the probe in an unheated space
}

export interface LowerInput {
  heat: Map<string, number>; // day -> kWh of the chosen rooms
  night: Map<string, number>; // day -> kWh 0 h – 6 h of the chosen rooms
  weather: Weather;
  sun: Map<string, number>;
  room: Map<string, number>;
  probe: Map<string, number>;
}

/** A decrypted value is read as a number only when it is one (the files are not typed). */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The heating days of the lower level (outdoor mean under 15 °C, as the signature), in order. */
export function lowerDays(i: LowerInput): LowerDay[] {
  const out: LowerDay[] = [];
  for (const [day, kwh] of [...i.heat].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const w = i.weather.get(day);
    if (!w || !(w[2] < HEATING_DAY_BELOW)) continue;
    out.push({
      day,
      kwh,
      night: i.night.get(day) ?? null,
      tOut: w[2],
      dju: dju(w),
      sun: num(i.sun.get(day)),
      tRoom: num(i.room.get(day)),
      tProbe: num(i.probe.get(day)),
    });
  }
  return out;
}

/**
 * The radiation under which a heating day counts as « peu ensoleillé »: the median of the heating
 * days that have one. A split of the days of this home, not a physical threshold (AGENTS.md §2):
 * half of the heating days are kept, the sunnier half is set aside. Null without any radiation.
 */
export function sunCut(days: LowerDay[]): number | null {
  const s = days.map((d) => d.sun).filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Days kept for the comparison: little sun (or every heating day when no radiation is known). */
export function dimDays(days: LowerDay[], cut: number | null): LowerDay[] {
  return cut === null ? days : days.filter((d) => d.sun !== null && d.sun <= cut);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export interface LowerSide {
  from: string;
  to: string;
  days: number; // dim heating days kept
  kwh: number;
  dju: number;
  perDju: number | null; // kWh per degree day, null under MIN_SIDE_DAYS days
  tOut: number | null; // mean outdoor temperature of those days: is the cold comparable?
  roomOverOut: number | null; // bedroom − outdoor, °C
  probeOverOut: number | null; // unheated space − outdoor, °C
  nights: number; // heating days with the night measured
  nightPerDju: number | null; // kWh 0 h – 6 h per degree day of the day, null under MIN_SIDE_DAYS
}

/** One span of days: the dim days for the day measures, every heating day for the nights. */
export function lowerSide(all: LowerDay[], cut: number | null, from: string, to: string): LowerSide {
  const span = all.filter((d) => d.day >= from && d.day <= to);
  const dim = dimDays(span, cut);
  const kwh = dim.reduce((s, d) => s + d.kwh, 0);
  const deg = dim.reduce((s, d) => s + d.dju, 0);
  const nights = span.filter((d) => d.night !== null);
  const nKwh = nights.reduce((s, d) => s + d.night!, 0);
  const nDeg = nights.reduce((s, d) => s + d.dju, 0);
  const gap = (pick: (d: LowerDay) => number | null) => mean(dim.filter((d) => pick(d) !== null).map((d) => pick(d)! - d.tOut));
  return {
    from,
    to,
    days: dim.length,
    kwh,
    dju: deg,
    perDju: dim.length >= MIN_SIDE_DAYS && deg > 0 ? kwh / deg : null,
    tOut: mean(dim.map((d) => d.tOut)),
    roomOverOut: gap((d) => d.tRoom),
    probeOverOut: gap((d) => d.tProbe),
    nights: nights.length,
    nightPerDju: nights.length >= MIN_SIDE_DAYS && nDeg > 0 ? nKwh / nDeg : null,
  };
}

export interface LowerBeforeAfter {
  marker: string;
  before: LowerSide;
  after: LowerSide;
  /** Change of kWh per degree day, after vs before, in % (< 0: less heat needed). */
  change: number | null;
  nightChange: number | null;
}

const pctOf = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? (a / b - 1) * 100 : null);

/** Before / after a marker: `windowDays` days on each side (the marker day is « after »), clipped. */
export function lowerBeforeAfter(all: LowerDay[], cut: number | null, marker: string, first: string, last: string, windowDays = 365): LowerBeforeAfter {
  const bFrom = addDays(marker, -windowDays) < first ? first : addDays(marker, -windowDays);
  const aTo = addDays(marker, windowDays - 1) > last ? last : addDays(marker, windowDays - 1);
  const before = lowerSide(all, cut, bFrom, addDays(marker, -1));
  const after = lowerSide(all, cut, marker, aTo);
  return { marker, before, after, change: pctOf(after.perDju, before.perDju), nightChange: pctOf(after.nightPerDju, before.nightPerDju) };
}

/** One heating season (« 2025-2026 ») of the lower level, for the trend from winter to winter. */
export function lowerSeasons(all: LowerDay[], cut: number | null): { season: string; side: LowerSide }[] {
  const seasons = [...new Set(all.map((d) => seasonOf(d.day)))].sort();
  return seasons.map((s) => {
    const y = Number(s.slice(0, 4));
    return { season: s, side: lowerSide(all, cut, `${y}-09-01`, `${y + 1}-08-31`) };
  });
}

/** Night kWh (0 h – 6 h) per day of the chosen rooms from the half hours [hp, hc, …] in Wh. */
export const NIGHT_SLOTS = 12; // 0 h → 6 h, 12 half hours
export function nightKwh(rooms: Map<string, (number | null)[]>[]): Map<string, number> {
  const sum = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const room of rooms)
    for (const [day, wh] of room) {
      const slots = wh.slice(0, NIGHT_SLOTS);
      if (slots.length < NIGHT_SLOTS || slots.some((v) => v === null)) continue; // a night with a hole is not a night
      sum.set(day, (sum.get(day) ?? 0) + (slots as number[]).reduce((s, v) => s + v, 0) / 1000);
      seen.set(day, (seen.get(day) ?? 0) + 1);
    }
  // a night counts only when EVERY chosen room has it: else it would be under-counted
  return new Map([...sum].filter(([day]) => seen.get(day) === rooms.length));
}
