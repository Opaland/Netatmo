// S-12.2: "vue foyer". Bedrooms are merged into a single room « Chambres » on every
// screen (consumption, hourly profiles, temperatures, station CO₂), so that a member of
// the household is not watched room by room. The detail comes back only after a
// deliberate gesture, until the next lock. Pure functions: no DOM, no state.
import type { DayRecord, Room } from './aggregate';
import type { Dataset, Station } from './data';

export const BEDROOMS_ID = '__bedrooms__';
export const BEDROOMS_NAME = 'Chambres';

/** A room or a station module whose name says it is a bedroom. */
export const isBedroom = (name: string) => /\b(chambres?|bedrooms?|suite parentale|dortoir)\b/i.test(name.normalize('NFC'));

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** The heating bedrooms merged by the household view (water heaters are never merged). */
export function bedroomIds(rooms: Room[]): string[] {
  return rooms.filter((r) => r.category === 'heating' && isBedroom(r.name)).map((r) => r.id);
}

/**
 * The dataset seen in household view: the bedrooms (two or more, a single bedroom is
 * merged too, under the generic name) become one room « Chambres ». Returns the dataset
 * unchanged when it has no bedroom. Totals are preserved: kWh are summed, temperatures
 * and humidity averaged, CO₂ averaged, minima / maxima kept.
 */
export function householdView(ds: Dataset): Dataset {
  const ids = new Set(bedroomIds(ds.meta.rooms));
  if (!ids.size) return ds;
  const first = ds.meta.rooms.findIndex((r) => ids.has(r.id));
  const rooms: Room[] = ds.meta.rooms.filter((r) => !ids.has(r.id));
  const types = [...new Set(ds.meta.rooms.filter((r) => ids.has(r.id)).flatMap((r) => r.module_types))];
  rooms.splice(first, 0, { id: BEDROOMS_ID, name: BEDROOMS_NAME, category: 'heating', module_types: types });

  // daily consumption: one record per day for the group
  const records: DayRecord[] = [];
  const merged = new Map<string, DayRecord>();
  for (const r of ds.records) {
    if (!ids.has(r.room)) {
      records.push(r);
      continue;
    }
    const m = merged.get(r.day);
    if (m) m.kwh += r.kwh;
    else {
      const rec = { ...r, room: BEDROOMS_ID };
      merged.set(r.day, rec);
      records.push(rec);
    }
  }

  // tariff split: summed per day
  const tariffs: Dataset['tariffs'] = new Map();
  const tGroup = new Map<string, [number, number, number]>();
  for (const [room, days] of ds.tariffs) {
    if (!ids.has(room)) {
      tariffs.set(room, days);
      continue;
    }
    for (const [d, v] of days) {
      const cur = tGroup.get(d) ?? [0, 0, 0];
      tGroup.set(d, [cur[0] + v[0], cur[1] + v[1], cur[2] + v[2]]);
    }
  }
  if (tGroup.size) tariffs.set(BEDROOMS_ID, tGroup);

  // temperatures: mean of the bedrooms measured that day; setpoint only when all known
  const temps: Dataset['temps'] = new Map();
  const tAcc = new Map<string, { m: number[]; s: (number | null)[] }>();
  for (const [room, days] of ds.temps) {
    if (!ids.has(room)) {
      temps.set(room, days);
      continue;
    }
    for (const [d, [m, s]] of days) {
      const a = tAcc.get(d) ?? { m: [], s: [] };
      a.m.push(m);
      a.s.push(s);
      tAcc.set(d, a);
    }
  }
  if (tAcc.size) {
    const g = new Map<string, [number, number | null]>();
    for (const [d, a] of tAcc) g.set(d, [avg(a.m)!, a.s.some((x) => x === null) ? null : avg(a.s as number[])]);
    temps.set(BEDROOMS_ID, g);
  }

  // estimated days and coverage: the group is as uncertain as its least certain bedroom
  const estimated = new Set([...ds.estimated].map((k) => (ids.has(k.slice(0, -11)) ? `${BEDROOMS_ID}|${k.slice(-10)}` : k)));
  let coverage: Dataset['coverage'] = null;
  if (ds.coverage) {
    coverage = new Map();
    const g = new Map<string, [number, number, number]>();
    for (const [room, months] of ds.coverage) {
      if (!ids.has(room)) {
        coverage.set(room, months);
        continue;
      }
      for (const [k, v] of months) {
        const c = g.get(k);
        g.set(k, c ? [Math.min(c[0], v[0]), Math.max(c[1], v[1]), Math.max(c[2], v[2])] : [...v]);
      }
    }
    if (g.size) coverage.set(BEDROOMS_ID, g);
  }

  return {
    ...ds,
    meta: { ...ds.meta, rooms },
    records,
    tariffs,
    temps,
    estimated,
    coverage,
    station: ds.station ? householdStation(ds.station) : null,
    insights: ds.insights ? hideNames(ds.insights, ds.meta.rooms.filter((r) => ids.has(r.id)).map((r) => r.name)) : null,
    roomMap: new Map([...ids].map((id) => [id, BEDROOMS_ID])),
  };
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
  return { ...st, modules, daily };
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
