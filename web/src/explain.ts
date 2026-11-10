// #337: « Expliquer un mois » — why did a month cost more (or less) than the same month a year
// earlier? The change is split into parts that add up exactly to it:
//   météo        the heating of last year scaled by the degree days (the cold really observed);
//   consignes    the temperature asked of the radiators (≈ 7 % of heating per °C, ADEME rule);
//   pièces       what each room measured beyond weather and setpoints (room by room);
//   hors ligne   the rooms without reading (#346): their share estimated from the meter;
//   mode         a change of heating: a radiator switched off on purpose (a stove in the living
//                room…, ⚙ Mon logement): its whole change, never « vos réglages »;
//   eau chaude   the water heater;
//   autres usages the meter minus heating and hot water (cooking, lights, appliances).
// With the Linky meter the total is the whole home; without it, radiators and water heater only.
// Pure functions, no DOM (explain.test.ts).
import { type DayRecord, addDays, minusYears } from './aggregate';
import { type Weather, dju } from './analysis';
import { ADEME_PER_DEGREE } from './checks';
import { MONTHS_LONG, monthLong, signedPct } from './glossary';
import type { CutKind } from './incidents';
import { type OfflineEstimate, type OfflineRun, type StoppedRoom, offlineDaysIn, offlineText } from './room-offline';

export type StepKey = 'meteo' | 'consignes' | 'mode' | 'pieces' | 'horsligne' | 'eau' | 'autres';
export const STEP_LABEL: Record<StepKey, string> = {
  meteo: 'Météo',
  consignes: 'Températures demandées',
  mode: 'Changement de mode de chauffage',
  pieces: 'Pièces',
  horsligne: 'Pièces hors ligne',
  eau: 'Eau chaude',
  autres: 'Autres usages',
};

export interface Step {
  key: StepKey;
  label: string;
  /** kWh added (> 0) or saved (< 0) vs the same month a year earlier. */
  kwh: number;
  /** Partly estimated (rooms offline). */
  estimated?: boolean;
}

export interface RoomPart {
  id: string;
  name: string;
  /** kWh this month (measured, plus the estimate of the offline days). */
  now: number;
  ref: number;
  /** Change once weather and setpoints are taken out. */
  rest: number;
  setpoint: number;
  offline: boolean;
  /** Switched off on purpose (a stove…): its change is a change of heating. */
  stopped?: StoppedRoom;
  /** kWh estimated from the meter this month (offline days). */
  estimated: number;
}

export interface Explanation {
  month: string;
  from: string;
  to: string;
  refFrom: string;
  refTo: string;
  /** The month is still running (compared on the same days). */
  partial: boolean;
  /** Whole home (Linky) or radiators and water heater only. */
  basis: 'linky' | 'intuis';
  now: number;
  ref: number;
  delta: number;
  pct: number;
  steps: Step[];
  rooms: RoomPart[];
  weather: { now: number; ref: number } | null;
  setpoint: { now: number; ref: number } | null;
  other: { now: number; ref: number } | null;
  water: { now: number; ref: number };
  offline: { id: string; name: string; since: string; ongoing: boolean; estimated: number | null }[];
  /** Rooms switched off on purpose over the month or a year earlier. */
  stopped: { id: string; name: string; text: string; stop: StoppedRoom }[];
  /** #394: days of the month left out with their day a year earlier (a cut on either), and the cause. */
  cuts: { day: string; ref: string; kind: CutKind; on: 'now' | 'ref' }[];
}

export interface ExplainInput {
  month: string; // YYYY-MM
  last: string; // last day of the data
  records: DayRecord[];
  rooms: { id: string; name: string; category: string }[];
  weather: Weather | null;
  linky: Map<string, number>;
  temps: Map<string, Map<string, [number, number | null]>>;
  runs: OfflineRun[];
  estimate: OfflineEstimate;
  /** #394: days touched by a power or Internet cut (incidents.ts). */
  cuts?: Map<string, CutKind>;
}

const monthEnd = (ym: string) => addDays(`${nextMonth(ym)}-01`, -1);
function nextMonth(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;

/** Months that can be explained: with data, and data on the same days a year earlier (newest first). */
export function explainableMonths(records: DayRecord[], last: string): string[] {
  const months = new Set<string>();
  for (const r of records) if (r.day <= last) months.add(r.day.slice(0, 7));
  return [...months].filter((m) => months.has(`${Number(m.slice(0, 4)) - 1}${m.slice(4)}`)).sort().reverse();
}

/** Mean setpoint of a room over [from, to] (days with one, `skip` left out), or null. */
function meanSetpoint(t: Map<string, [number, number | null]> | undefined, from: string, to: string, skip: Set<string>): { mean: number; days: number } | null {
  if (!t) return null;
  let s = 0;
  let n = 0;
  for (const [d, v] of t) if (d >= from && d <= to && v[1] !== null && !skip.has(d)) (s += v[1]), n++;
  return n ? { mean: s / n, days: n } : null;
}

/** Linky covers every day of [from, to] (`skip` left out). */
function linkySum(linky: Map<string, number>, from: string, to: string, skip: Set<string>): number | null {
  let s = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (skip.has(d)) continue;
    const v = linky.get(d);
    if (v === undefined) return null;
    s += v;
  }
  return s;
}

/** The explanation of a month vs the same days a year earlier; null without a reference. */
export function explainMonth(i: ExplainInput): Explanation | null {
  const from = `${i.month}-01`;
  const end = monthEnd(i.month);
  const to = end < i.last ? end : i.last;
  if (to < from) return null;
  const refFrom = minusYears(from);
  const refTo = minusYears(to);
  // #394: a day touched by a cut, this year or a year earlier, is left out of both periods
  const cuts: Explanation['cuts'] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const ref = minusYears(d);
    const kind = i.cuts?.get(d) ?? i.cuts?.get(ref);
    if (kind) cuts.push({ day: d, ref, kind, on: i.cuts?.has(d) ? 'now' : 'ref' });
  }
  const skip = new Set(cuts.flatMap((c) => [c.day, c.ref]));
  const sum = (room: string, f: string, t: string) => i.records.reduce((s, r) => s + (r.room === room && r.day >= f && r.day <= t && !skip.has(r.day) ? r.kwh : 0), 0);
  const estimatedIn = (est: OfflineEstimate, room: string, f: string, t: string): number | null => {
    const days = est.days.get(room);
    if (!days) return null;
    let s = 0;
    let n = 0;
    for (const [d, v] of days) if (d >= f && d <= t && !skip.has(d)) (s += v), n++;
    return n ? s : null;
  };
  const djuBetween = (w: Weather, f: string, t: string) => {
    let s = 0;
    let n = 0;
    for (let d = f; d <= t; d = addDays(d, 1)) {
      const v = w.get(d);
      if (v && !skip.has(d)) (s += dju(v)), n++;
    }
    return { dju: s, days: n };
  };
  const followed = i.rooms.filter((r) => r.category !== 'ignore');
  const refAny = i.records.some((r) => r.day >= refFrom && r.day <= refTo);
  if (!refAny) return null;
  const heat = followed.filter((r) => r.category === 'heating');
  const waterRooms = followed.filter((r) => r.category === 'water_heater');
  // weather: the degree days of both periods, when every day is known
  const wNow = i.weather ? djuBetween(i.weather, from, to) : null;
  const wRef = i.weather ? djuBetween(i.weather, refFrom, refTo) : null;
  const days = dayCount(from, to) - cuts.length;
  const weather = wNow && wRef && wNow.days === days && wRef.days === days && wRef.dju > 5 ? { now: wNow.dju, ref: wRef.dju } : null;
  const wf = weather ? weather.now / weather.ref : 1;
  // rooms: measured + estimated (offline days)
  const rooms: RoomPart[] = [];
  let spNow = 0, spRef = 0, spW = 0;
  for (const r of heat) {
    const estNow = estimatedIn(i.estimate, r.id, from, to) ?? 0;
    const estRef = estimatedIn(i.estimate, r.id, refFrom, refTo) ?? 0;
    const now = sum(r.id, from, to) + estNow;
    const ref = sum(r.id, refFrom, refTo) + estRef;
    const live = i.runs.filter((x) => !x.stopped);
    const offline = offlineDaysIn(live, r.id, from, to) > 0 || offlineDaysIn(live, r.id, refFrom, refTo) > 0;
    const stopped = i.runs.find((x) => x.stopped && x.room === r.id && x.to >= refFrom && x.from <= to)?.stopped;
    if (stopped) {
      // a change of heating: all of it, not the weather nor the setpoints
      if (now || ref) rooms.push({ id: r.id, name: r.name, now, ref, rest: now - ref, setpoint: 0, offline: false, stopped, estimated: 0 });
      continue;
    }
    const expected = ref * wf;
    let setpoint = 0;
    if (!offline) {
      const a = meanSetpoint(i.temps.get(r.id), from, to, skip);
      const b = meanSetpoint(i.temps.get(r.id), refFrom, refTo, skip);
      if (a && b && a.days >= days / 2 && b.days >= days / 2) {
        setpoint = expected * ADEME_PER_DEGREE * (a.mean - b.mean);
        spNow += a.mean * ref;
        spRef += b.mean * ref;
        spW += ref;
      }
    }
    if (!now && !ref) continue;
    rooms.push({ id: r.id, name: r.name, now, ref, rest: now - expected - setpoint, setpoint, offline, estimated: estNow });
  }
  const H = (k: 'now' | 'ref') => rooms.reduce((s, r) => s + r[k], 0);
  const water = {
    now: waterRooms.reduce((s, r) => s + sum(r.id, from, to) + (estimatedIn(i.estimate, r.id, from, to) ?? 0), 0),
    ref: waterRooms.reduce((s, r) => s + sum(r.id, refFrom, refTo) + (estimatedIn(i.estimate, r.id, refFrom, refTo) ?? 0), 0),
  };
  const lNow = linkySum(i.linky, from, to, skip);
  const lRef = linkySum(i.linky, refFrom, refTo, skip);
  const basis = lNow !== null && lRef !== null ? 'linky' : 'intuis';
  const now = basis === 'linky' ? lNow! : H('now') + water.now;
  const ref = basis === 'linky' ? lRef! : H('ref') + water.ref;
  if (ref <= 0) return null;
  const other = basis === 'linky' ? { now: now - H('now') - water.now, ref: ref - H('ref') - water.ref } : null;
  const meteo = rooms.filter((r) => !r.stopped).reduce((s, r) => s + r.ref * (wf - 1), 0);
  const changed = rooms.filter((r) => r.stopped);
  const steps: Step[] = [
    { key: 'meteo', label: STEP_LABEL.meteo, kwh: meteo },
    { key: 'consignes', label: STEP_LABEL.consignes, kwh: rooms.reduce((s, r) => s + r.setpoint, 0) },
    ...(changed.length ? [{ key: 'mode' as const, label: modeLabel(changed), kwh: changed.reduce((s, r) => s + r.rest, 0) }] : []),
    { key: 'pieces', label: STEP_LABEL.pieces, kwh: rooms.filter((r) => !r.offline && !r.stopped).reduce((s, r) => s + r.rest, 0) },
  ];
  const offRooms = rooms.filter((r) => r.offline);
  if (offRooms.length) steps.push({ key: 'horsligne', label: STEP_LABEL.horsligne, kwh: offRooms.reduce((s, r) => s + r.rest, 0), estimated: offRooms.some((r) => r.estimated > 0) });
  if (waterRooms.length) steps.push({ key: 'eau', label: STEP_LABEL.eau, kwh: water.now - water.ref });
  if (other) steps.push({ key: 'autres', label: STEP_LABEL.autres, kwh: other.now - other.ref });
  const offline = heat
    .concat(waterRooms)
    .flatMap((r) => {
      const run = i.runs.filter((x) => !x.stopped && x.room === r.id && x.to >= refFrom && x.from <= to).pop();
      if (!run) return [];
      return [{ id: r.id, name: r.name, since: run.from, ongoing: run.ongoing, estimated: estimatedIn(i.estimate, r.id, from, to) }];
    });
  return {
    month: i.month,
    from,
    to,
    refFrom,
    refTo,
    partial: to < end,
    basis,
    now,
    ref,
    delta: now - ref,
    pct: ((now - ref) / ref) * 100,
    steps,
    rooms: rooms.sort((a, b) => Math.abs(b.rest) - Math.abs(a.rest)),
    weather,
    setpoint: spW ? { now: spNow / spW, ref: spRef / spW } : null,
    other,
    water,
    offline,
    stopped: changed.map((r) => ({ id: r.id, name: r.name, stop: r.stopped!, text: offlineText({ from: r.stopped!.from, to, ongoing: true, stopped: r.stopped }) })),
    cuts,
  };
}

/** « Changement de mode de chauffage (poêle : Salon) », « … (Bureau arrêté) ». */
function modeLabel(rooms: RoomPart[]): string {
  const stove = rooms.filter((r) => r.stopped!.reason === 'poele').map((r) => r.name);
  const other = rooms.filter((r) => r.stopped!.reason !== 'poele').map((r) => r.name);
  const parts = [stove.length ? `poêle : ${and(stove)}` : '', other.length ? `${and(other)} arrêté${other.length > 1 ? 's' : ''}` : ''].filter(Boolean);
  return `${STEP_LABEL.mode} (${parts.join(', ')})`;
}

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
/** « 112 kWh » (absolute value, rounded). */
export const kwhAbs = (v: number) => `${nf0.format(Math.round(Math.abs(v)))} kWh`;
/** « +112 kWh », « −35 kWh », « 0 kWh ». */
export const kwhSigned = (v: number) => {
  const r = Math.round(v);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${nf0.format(Math.abs(r))} kWh`;
};

/** What a step means, in a few words (« plus froid », « hors ligne, estimée »). */
export function stepNote(e: Explanation, s: Step): string {
  switch (s.key) {
    case 'meteo':
      return e.weather ? `${e.weather.now > e.weather.ref ? 'plus froid' : e.weather.now < e.weather.ref ? 'plus doux' : 'aussi froid'} : ${nf0.format(e.weather.now)} degrés-jours contre ${nf0.format(e.weather.ref)}` : 'météo inconnue sur l’une des deux périodes';
    case 'consignes':
      return e.setpoint ? `${(e.setpoint.now >= e.setpoint.ref ? '+' : '−') + Math.abs(e.setpoint.now - e.setpoint.ref).toFixed(1).replace('.', ',')} °C demandés en moyenne` : 'températures demandées non relevées';
    case 'mode':
      return e.stopped.map((x) => `radiateur ${x.text}${x.stop.label ? ` : ${x.stop.label}` : ''}`).join(' ; ');
    case 'pieces':
      return 'à météo et températures demandées égales';
    case 'horsligne':
      return s.estimated ? 'estimée d’après le compteur Linky' : 'plus mesurée, sans compteur Linky pour l’estimer';
    case 'eau':
      return 'chauffe-eau';
    default:
      return 'compteur − chauffage − eau chaude';
  }
}

/** Short noun of a step for the sentence (« le froid », « la Cuisine hors ligne »). */
function stepPhrase(e: Explanation, s: Step): string {
  switch (s.key) {
    case 'meteo':
      return s.kwh > 0 ? 'un mois plus froid' : 'un mois plus doux';
    case 'consignes':
      return s.kwh > 0 ? 'des températures demandées plus hautes' : 'des températures demandées plus basses';
    case 'mode': {
      const stove = e.stopped.filter((x) => x.stop.reason === 'poele').map((x) => x.name);
      return stove.length === e.stopped.length ? `le poêle (${and(stove)})` : `l’arrêt des radiateurs (${and(e.stopped.map((x) => x.name))})`;
    }
    case 'pieces': {
      const top = e.rooms.filter((r) => !r.offline && !r.stopped && Math.sign(r.rest) === Math.sign(s.kwh)).slice(0, 2);
      return top.length ? `${s.kwh > 0 ? 'la hausse' : 'la baisse'} des pièces, surtout ${and(top.map((r) => r.name))}` : 'les pièces';
    }
    case 'horsligne': {
      return `${and(e.offline.map((o) => o.name)) || 'les pièces'} hors ligne`;
    }
    case 'eau':
      return 'l’eau chaude';
    default:
      return 'les autres usages';
  }
}

/** « a », « a et b », « a, b et c ». */
const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} et ${xs[xs.length - 1]}` : (xs[0] ?? ''));

/** The sentence of the verdict, in plain words, from the biggest parts. */
export function explainSentence(e: Explanation, eurPerKwh: number | null = null): string {
  const m = MONTHS_LONG[Number(e.month.slice(5, 7)) - 1];
  const refLabel = monthLong(e.refFrom.slice(0, 7));
  const span = e.partial ? ` (du 1er au ${Number(e.to.slice(8, 10))})` : '';
  const what = e.basis === 'linky' ? 'le logement a consommé' : 'radiateurs et chauffe-eau ont consommé';
  const eur = eurPerKwh ? `, ≈ ${nf0.format(Math.round(Math.abs(e.delta) * eurPerKwh))} €` : '';
  if (Math.abs(e.pct) < 3) return `En ${m} ${e.month.slice(0, 4)}${span}, ${what} à peu près autant qu’en ${refLabel} (${signedPct(e.pct)}).`;
  const up = e.delta > 0;
  const head = `En ${m} ${e.month.slice(0, 4)}${span}, ${what} ${kwhAbs(e.delta)} de ${up ? 'plus' : 'moins'} qu’en ${refLabel} (${signedPct(e.pct)}${eur}).`;
  const significant = e.steps.filter((s) => Math.abs(s.kwh) >= Math.max(5, Math.abs(e.delta) * 0.1));
  const pushing = significant.filter((s) => Math.sign(s.kwh) === Math.sign(e.delta)).sort((a, b) => Math.abs(b.kwh) - Math.abs(a.kwh));
  const against = significant.filter((s) => Math.sign(s.kwh) !== Math.sign(e.delta)).sort((a, b) => Math.abs(b.kwh) - Math.abs(a.kwh));
  const part = (s: Step) => `${stepPhrase(e, s)} (${kwhSigned(s.kwh)}${s.estimated ? ', estimé' : ''})`;
  const why = pushing.length ? ` Surtout ${and(pushing.slice(0, 3).map(part))}` : '';
  const but = against.length ? `${why ? ' ; en partie compensé par' : ' En sens inverse :'} ${and(against.slice(0, 2).map(part))}` : '';
  return `${head}${why}${but}${why || but ? '.' : ''}`;
}
