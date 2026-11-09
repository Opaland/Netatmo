// S-12.2: "vue foyer" (opt-in since v1.5). Bedrooms are shown as a single room « Chambres »
// (consumption, hourly profiles, temperatures, station CO₂), so that a member of the
// household is not watched room by room. The detail comes back after a deliberate gesture,
// until the next lock. Pure functions: no DOM, no state.
//
// Grouping is a DISPLAY transformation (v1.5, issues #238 #239 #241 #242 #243 #248): every
// computation runs on the raw rooms. A merged « Chambres » day keeps the raw records it is
// made of (`parts`, expanded by rawRecords() in the cost, HP/HC, quality and reconstitution
// functions); tariff detail and estimated days stay keyed by raw room id; per-room settings
// (surfaces, cold alert, room ↔ module) keep raw ids.
import { type DayRecord, type Room, addDays } from './aggregate';
import { computeCoverage } from './checks';
import type { Dataset, Station } from './data';

export const BEDROOMS_ID = '__bedrooms__';
export const BEDROOMS_NAME = 'Chambres';

/**
 * Words that make a room or a station module a bedroom: THE rule of the project (#234), used
 * by the household view, Confort, Fenêtres, Home Assistant and, with the same words, by the
 * AI facts (collector/insights.py). Both sides are checked against
 * web/src/__fixtures__/bedroom-names.json.
 */
export const BEDROOM_WORDS = ['chambre', 'bedroom', 'dortoir', 'suite parentale'];
export const BEDROOM_RE = new RegExp(`\\b(${BEDROOM_WORDS.join('|')})`);

/** Lower case, accents removed (NFD, combining marks dropped). */
export const foldName = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** A room or a station module whose name says it is a bedroom. */
export const isBedroom = (name: string) => BEDROOM_RE.test(foldName(name));

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** The heating bedrooms merged by the household view (water heaters are never merged). */
export function bedroomIds(rooms: Room[]): string[] {
  return rooms.filter((r) => r.category === 'heating' && isBedroom(r.name)).map((r) => r.id);
}

/** Display id of a raw room id: « Chambres » for a merged bedroom, itself otherwise. */
export const displayId = (ds: Pick<Dataset, 'roomMap'>, room: string) => ds.roomMap?.get(room) ?? room;

/**
 * Room choices (filter, pinned room, focused room) follow the grouping instead of being
 * dropped (#243): a bedroom becomes « Chambres » in household view (`shown` has a roomMap),
 * « Chambres » becomes its bedrooms again with the detail. `rooms` are the raw rooms.
 */
export function translateRooms(ids: string[], shown: Pick<Dataset, 'roomMap'>, rooms: Room[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const mapped = shown.roomMap?.get(id) ?? id;
    const list = mapped === BEDROOMS_ID && !shown.roomMap ? bedroomIds(rooms) : [mapped];
    for (const r of list) if (!out.includes(r)) out.push(r);
  }
  return out;
}

/**
 * Surfaces (S-6.2, stored by raw room id) as seen in the dataset shown: in household view,
 * « Chambres » has the sum of the bedrooms' surfaces when every merged bedroom with data has
 * one (#243). Raw ids are kept, so the detail still finds them.
 */
export function displaySurfaces(ds: Pick<Dataset, 'roomMap' | 'records'>, surfaces: Record<string, number>): Record<string, number> {
  if (!ds.roomMap?.size) return surfaces;
  const members = new Set<string>();
  for (const r of ds.records) if (r.room === BEDROOMS_ID) for (const p of r.parts ?? []) members.add(p.room);
  const out = { ...surfaces };
  delete out[BEDROOMS_ID];
  if (members.size && [...members].every((id) => surfaces[id] > 0)) {
    out[BEDROOMS_ID] = Math.round([...members].reduce((s, id) => s + surfaces[id], 0) * 10) / 10;
  }
  return out;
}

/**
 * The dataset seen in household view: the bedrooms (a single bedroom too, under the generic
 * name) become one room « Chambres ». Returns the dataset unchanged when it has no bedroom.
 * Totals are preserved by construction: a merged day sums the bedrooms and keeps their raw
 * records in `parts`; tariff detail and estimated days are the raw ones.
 */
export function householdView(ds: Dataset): Dataset {
  const ids = new Set(bedroomIds(ds.meta.rooms));
  if (!ids.size) return ds;
  const first = ds.meta.rooms.findIndex((r) => ids.has(r.id));
  const rooms: Room[] = ds.meta.rooms.filter((r) => !ids.has(r.id));
  const types = [...new Set(ds.meta.rooms.filter((r) => ids.has(r.id)).flatMap((r) => r.module_types))];
  rooms.splice(first, 0, { id: BEDROOMS_ID, name: BEDROOMS_NAME, category: 'heating', module_types: types });

  // daily consumption: one record per day for the group, made of the raw bedroom records
  const records: DayRecord[] = [];
  const merged = new Map<string, DayRecord & { parts: DayRecord[] }>();
  for (const r of ds.records) {
    if (!ids.has(r.room)) {
      records.push(r);
      continue;
    }
    const m = merged.get(r.day);
    if (m) {
      m.kwh += r.kwh;
      m.parts.push(r);
    } else {
      const rec = { day: r.day, room: BEDROOMS_ID, cat: r.cat, kwh: r.kwh, parts: [r] };
      merged.set(r.day, rec);
      records.push(rec);
    }
  }

  const last = ds.meta.last_day ?? ds.records.reduce((a, r) => (r.day > a ? r.day : a), '');
  return {
    ...ds,
    meta: { ...ds.meta, rooms },
    records,
    temps: groupTemps(ds.temps, ids),
    coverage: groupCoverage(ds.coverage ?? computeCoverage(ds.records, ds.estimated, last), ds.records, ds.estimated, ids, last),
    station: ds.station ? householdStation(ds.station) : null,
    insights: ds.insights ? hideNames(ds.insights, ds.meta.rooms.filter((r) => ids.has(r.id)).map((r) => r.name)) : null,
    roomMap: new Map([...ids].map((id) => [id, BEDROOMS_ID])),
  };
}

/**
 * Temperatures of « Chambres » (#248): the mean of the bedrooms, only on the days when every
 * bedroom expected that day (between its first and last measured day) was measured, so the
 * mean never changes composition; the setpoint is the mean of the known setpoints (a bedroom
 * without setpoint no longer erases the others').
 */
function groupTemps(temps: Dataset['temps'], ids: Set<string>): Dataset['temps'] {
  const out: Dataset['temps'] = new Map();
  const members: Map<string, [number, number | null]>[] = [];
  for (const [room, days] of temps) {
    if (!ids.has(room)) out.set(room, days);
    else if (days.size) members.push(days);
  }
  if (!members.length) return out;
  const ranges = members.map((m) => {
    const keys = [...m.keys()];
    return [keys.reduce((a, b) => (b < a ? b : a)), keys.reduce((a, b) => (b > a ? b : a))] as const;
  });
  const g = new Map<string, [number, number | null]>();
  for (const d of [...new Set(members.flatMap((m) => [...m.keys()]))].sort()) {
    const vals = members.filter((_, i) => ranges[i][0] <= d && d <= ranges[i][1]).map((m) => m.get(d));
    if (vals.some((v) => !v)) continue;
    const known = vals.map((v) => v![1]).filter((x): x is number => x !== null);
    g.set(d, [avg(vals.map((v) => v![0]))!, avg(known)]);
  }
  out.set(BEDROOMS_ID, g);
  return out;
}

/**
 * Coverage of « Chambres » (#239), day by day from the raw bedrooms: a day is missing when a
 * bedroom (from its first stored day) has no value, else estimated when a bedroom is, else
 * real. Counted in days, not room-days.
 */
function groupCoverage(
  cov: NonNullable<Dataset['coverage']>,
  records: DayRecord[],
  estimated: Set<string>,
  ids: Set<string>,
  last: string,
): Dataset['coverage'] {
  const out: NonNullable<Dataset['coverage']> = new Map([...cov].filter(([room]) => !ids.has(room)));
  const seen = new Map<string, Set<string>>();
  for (const r of records) {
    if (!ids.has(r.room)) continue;
    if (!seen.has(r.room)) seen.set(r.room, new Set());
    seen.get(r.room)!.add(r.day);
  }
  if (!seen.size || !last) return out;
  const firsts = new Map([...seen].map(([room, set]) => [room, [...set].reduce((a, b) => (b < a ? b : a))]));
  const g = new Map<string, [number, number, number]>();
  for (let d = [...firsts.values()].reduce((a, b) => (b < a ? b : a)); d <= last; d = addDays(d, 1)) {
    let status = 0;
    for (const [room, set] of seen) {
      if (firsts.get(room)! > d) continue;
      status = Math.max(status, estimated.has(`${room}|${d}`) ? 1 : set.has(d) ? 0 : 2);
    }
    const cell = g.get(d.slice(0, 7)) ?? [0, 0, 0];
    cell[status]++;
    g.set(d.slice(0, 7), cell);
  }
  out.set(BEDROOMS_ID, g);
  return out;
}

/** Station modules in bedrooms become one « Chambres » module (means, min of minima, max of maxima). */
export function householdStation(st: Station): Station {
  const keys = Object.keys(st.modules).filter((k) => st.modules[k].indoor && isBedroom(st.modules[k].name));
  if (!keys.length) return st;
  const modules: Station['modules'] = {};
  const daily: Station['daily'] = {};
  const group = BEDROOMS_ID;
  for (const [k, m] of Object.entries(st.modules)) {
    if (!keys.includes(k)) {
      modules[k] = m;
      if (st.daily[k]) daily[k] = st.daily[k];
    } else if (!modules[group]) {
      modules[group] = { name: BEDROOMS_NAME, type: m.type, indoor: true };
    }
  }
  const acc = new Map<string, [number, number, number, number | null, number | null][]>();
  for (const k of keys) {
    for (const [d, v] of Object.entries(st.daily[k] ?? {})) {
      const l = acc.get(d) ?? [];
      l.push(v);
      acc.set(d, l);
    }
  }
  const g: Station['daily'][string] = {};
  for (const [d, l] of [...acc].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const opt = (i: 3 | 4) => avg(l.map((v) => v[i]).filter((x): x is number => x !== null));
    g[d] = [Math.min(...l.map((v) => v[0])), Math.max(...l.map((v) => v[1])), avg(l.map((v) => v[2]))!, opt(3), opt(4)];
  }
  daily[group] = g;
  return { ...st, modules, daily, nightly: worstOf(st.nightly, keys), hours: worstOf(st.hours, keys) };
}

/**
 * Night CO₂ hours and humid / cold hours of the bedrooms, merged per day as the worst
 * bedroom (maximum of each count, minimum of the readings count `n`).
 */
function worstOf<V extends object>(o: Record<string, Record<string, V>> | undefined, keys: string[]) {
  if (!o) return o;
  const out: Record<string, Record<string, V>> = {};
  const g: Record<string, V> = {};
  for (const [k, days] of Object.entries(o)) {
    if (!keys.includes(k)) {
      out[k] = days;
      continue;
    }
    for (const [d, v] of Object.entries(days)) {
      const cur = g[d] as Record<string, number | null> | undefined;
      if (!cur) {
        g[d] = { ...v };
        continue;
      }
      for (const [f, x] of Object.entries(v as Record<string, number | null>)) {
        const y = cur[f];
        if (x === null || x === undefined) continue;
        cur[f] = y === null || y === undefined ? x : f === 'n' ? Math.min(x, y) : Math.max(x, y);
      }
    }
  }
  if (Object.keys(g).length) out[BEDROOMS_ID] = g;
  return out;
}

/**
 * The AI text names rooms: bedroom names become « Chambres ». The facts sent to the AI
 * list each room's figures: they are left out when they name a bedroom (shown with the detail).
 */
function hideNames<T extends { markdown: string; facts?: unknown }>(ins: T, names: string[]): T {
  const sorted = [...names].sort((a, b) => b.length - a.length).filter(Boolean);
  if (!sorted.length) return ins;
  const re = new RegExp(sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const facts = ins.facts !== undefined && re.test(JSON.stringify(ins.facts)) ? undefined : ins.facts;
  re.lastIndex = 0;
  return { ...ins, markdown: ins.markdown.replace(re, BEDROOMS_NAME), facts };
}
