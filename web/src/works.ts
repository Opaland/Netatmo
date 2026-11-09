// S-6.2: room surfaces and dated "works" markers (insulation, windows, new radiator…),
// to compare before / after. Pure functions (no DOM, no app state): views/works.ts reads
// and saves them (encrypted on this device) and draws the cards.
import { addDays } from './aggregate';
import { type Fit, type Weather, dju, fitSeason } from './analysis';

export type WorkKind = 'isolation' | 'menuiseries' | 'chauffage' | 'ventilation' | 'reglage' | 'autre';
export const WORK_KINDS: Record<WorkKind, string> = {
  isolation: 'Isolation',
  menuiseries: 'Fenêtres, portes, volets',
  chauffage: 'Chauffage (radiateur, pompe à chaleur…)',
  ventilation: 'Ventilation',
  reglage: 'Réglage, programmation',
  autre: 'Autre',
};

export interface Marker {
  day: string; // YYYY-MM-DD, first day "after"
  kind: WorkKind;
  label: string; // free text, stays on this device (never exported)
}

export interface HomeWorks {
  surfaces: Record<string, number>; // room id -> m²
  markers: Marker[];
}

export const NO_WORKS: HomeWorks = { surfaces: {}, markers: [] };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_SURFACE = 1000;

/** Clean what comes back from storage (never trusted blindly). */
export function validWorks(v: unknown): HomeWorks {
  if (!v || typeof v !== 'object') return NO_WORKS;
  const o = v as { surfaces?: unknown; markers?: unknown };
  const surfaces: Record<string, number> = {};
  if (o.surfaces && typeof o.surfaces === 'object') {
    for (const [k, s] of Object.entries(o.surfaces as Record<string, unknown>)) {
      if (typeof s === 'number' && Number.isFinite(s) && s > 0 && s <= MAX_SURFACE) surfaces[k] = Math.round(s * 10) / 10;
    }
  }
  const markers = Array.isArray(o.markers)
    ? (o.markers as Partial<Marker>[])
        .filter((m) => m && typeof m.day === 'string' && DAY_RE.test(m.day))
        .map((m) => ({
          day: m.day!,
          kind: (m.kind && m.kind in WORK_KINDS ? m.kind : 'autre') as WorkKind,
          label: typeof m.label === 'string' ? m.label.slice(0, 80) : '',
        }))
    : [];
  return { surfaces, markers: sortMarkers(markers) };
}

export const sortMarkers = (list: Marker[]) => [...list].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

/** Total surface of these rooms, and how many of them have one. */
export function surfaceOf(surfaces: Record<string, number>, rooms: string[]): { m2: number; known: number } {
  let m2 = 0;
  let known = 0;
  for (const r of rooms) {
    if (surfaces[r]) {
      m2 += surfaces[r];
      known++;
    }
  }
  return { m2, known };
}

export interface Side {
  from: string;
  to: string;
  days: number; // days with heating data
  kwh: number; // heating kWh over the window
  dju: number; // degree days over the same days (base 18 °C)
  points: [number, number, string][]; // [outdoor mean °C, kWh, day]
  fit: Fit | null;
  perM2: number | null; // kWh/m² over the window
  perDjuM2: number | null; // Wh per degree day and m²: climate-corrected
}

export interface BeforeAfter {
  marker: string;
  before: Side | null;
  after: Side | null;
  /** Change of kWh per degree day (and m² when known), after vs before, in %: < 0 = saving. */
  change: number | null;
}

/** Below this many heating days on one side, its line means nothing. */
export const MIN_SIDE_DAYS = 20;

function side(heat: Map<string, number>, weather: Weather, from: string, to: string, m2: number | null): Side | null {
  if (to < from) return null;
  const points: [number, number, string][] = [];
  let kwh = 0;
  let deg = 0;
  let days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = heat.get(d);
    const w = weather.get(d);
    if (k === undefined || !w) continue;
    kwh += k;
    deg += dju(w);
    days++;
    points.push([w[2], k, d]);
  }
  const heatingDays = points.filter(([t, k]) => t < 15 && k > 0.2).length;
  if (heatingDays < MIN_SIDE_DAYS) return null;
  return {
    from,
    to,
    days,
    kwh,
    dju: deg,
    points,
    fit: fitSeason(points),
    perM2: m2 ? kwh / m2 : null,
    perDjuM2: deg > 0 ? (kwh * 1000) / deg / (m2 || 1) : null,
  };
}

/**
 * Heating before and after a marker: `windowDays` days on each side (the day of the marker
 * belongs to "after"), clipped to the data. Each side gets its own signature line.
 */
export function beforeAfter(
  heat: Map<string, number>,
  weather: Weather,
  marker: string,
  first: string,
  last: string,
  m2: number | null,
  windowDays = 365,
): BeforeAfter {
  const bFrom = addDays(marker, -windowDays) < first ? first : addDays(marker, -windowDays);
  const aTo = addDays(marker, windowDays - 1) > last ? last : addDays(marker, windowDays - 1);
  const before = side(heat, weather, bFrom, addDays(marker, -1), m2);
  const after = side(heat, weather, marker, aTo, m2);
  const change = before?.perDjuM2 && after?.perDjuM2 ? (after.perDjuM2 / before.perDjuM2 - 1) * 100 : null;
  return { marker, before, after, change };
}

/** Heating kWh per day (radiators only, ignored rooms already left out by the caller). */
export function heatPerDay(records: { day: string; cat: string; kwh: number; room: string }[], rooms?: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of records) if (r.cat === 'heating' && (!rooms || rooms.has(r.room))) out.set(r.day, (out.get(r.day) ?? 0) + r.kwh);
  return out;
}

/** kWh/m² per room over [from, to] (rooms with a surface only). */
export function perRoomM2(
  records: { day: string; room: string; kwh: number }[],
  surfaces: Record<string, number>,
  from: string,
  to: string,
): Map<string, { kwh: number; m2: number; perM2: number }> {
  const kwh = new Map<string, number>();
  for (const r of records) if (r.day >= from && r.day <= to && surfaces[r.room]) kwh.set(r.room, (kwh.get(r.room) ?? 0) + r.kwh);
  const out = new Map<string, { kwh: number; m2: number; perM2: number }>();
  for (const [room, k] of kwh) out.set(room, { kwh: k, m2: surfaces[room], perM2: k / surfaces[room] });
  return out;
}
