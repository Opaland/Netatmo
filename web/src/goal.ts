// #152: a goal for a room, at equal climate — « −10 % de kWh par degré-jour face à l'hiver
// dernier » — and the way to it, said as a challenge rather than a reproach. The heating of the
// current season (September to the last day) per degree day, against the same days a year
// earlier: a colder winter asks for more kWh and gives more degree days, so the ratio stays fair.
// Pure functions, no DOM (goal.test.ts); the card is in views/piece.ts.
import { type DayRecord, addDays, minusYears, seasonOf } from './aggregate';
import { type Weather, dju } from './analysis';
import { ADEME_PER_DEGREE } from './checks';
import { MIN_DJU } from './dju';
import { signedPct } from './glossary';

/** The goals offered (% of kWh per degree day less than last winter). */
export const GOAL_CHOICES = [5, 10, 15] as const;
/** A goal read back is kept between 1 and this (%), whole numbers only. */
export const MAX_GOAL = 50;
const ID = /^[\w.:-]{1,64}$/;

/** Clean the goals read back from storage: room id → %, never trusted blindly (fuzz.test.ts). */
export function validGoals(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, g] of Object.entries(v as Record<string, unknown>)) {
    if (!ID.test(k) || k === '__proto__' || typeof g !== 'number' || !Number.isInteger(g) || g < 1 || g > MAX_GOAL) continue;
    Object.defineProperty(out, k, { value: g, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/** The goal of a room, or null (an own key only: « constructor » is not a room). */
export const goalOf = (goals: Record<string, number>, room: string): number | null => (Object.hasOwn(goals, room) ? goals[room] : null);

/** The goals with one room's goal set (a %) or removed (null). */
export function withGoal(goals: Record<string, number>, room: string, goal: number | null): Record<string, number> {
  const out = validGoals(goals);
  if (goal === null) delete out[room];
  else Object.defineProperty(out, room, { value: goal, enumerable: true, writable: true, configurable: true });
  return validGoals(out);
}

export interface GoalProgress {
  goal: number;
  from: string;
  to: string;
  refFrom: string;
  refTo: string;
  /** Days counted: with an outdoor temperature this year and a year earlier. */
  days: number;
  now: { kwh: number; dju: number };
  ref: { kwh: number; dju: number };
  /** Change of the kWh per degree day, %. */
  change: number;
  /** Part of the goal already done (0 when nothing yet; above 1 when beyond). */
  share: number;
}

/**
 * The way to a goal of `room`: its kWh per degree day of the current heating season to `last`,
 * against the same days a year earlier, on the days with an outdoor temperature both years. Null
 * without enough cold on either side (MIN_DJU) or without heating a year earlier.
 */
export function goalProgress(records: DayRecord[], room: string, weather: Weather, last: string, goal: number): GoalProgress | null {
  const from = `${seasonOf(last).slice(0, 4)}-09-01`;
  const refFrom = minusYears(from);
  const refTo = minusYears(last);
  const kept = new Set<string>();
  const now = { kwh: 0, dju: 0 };
  const ref = { kwh: 0, dju: 0 };
  for (let d = from; d <= last; d = addDays(d, 1)) {
    const a = weather.get(d);
    const b = weather.get(minusYears(d));
    if (!a || !b) continue;
    kept.add(d);
    kept.add(minusYears(d));
    now.dju += dju(a);
    ref.dju += dju(b);
  }
  for (const r of records) {
    if (r.room !== room || !kept.has(r.day)) continue;
    if (r.day >= from && r.day <= last) now.kwh += r.kwh;
    else if (r.day >= refFrom && r.day <= refTo) ref.kwh += r.kwh;
  }
  if (now.dju <= MIN_DJU || ref.dju <= MIN_DJU || ref.kwh <= 0) return null;
  const change = ((now.kwh / now.dju / (ref.kwh / ref.dju)) - 1) * 100;
  return { goal, from, to: last, refFrom, refTo, days: kept.size / 2, now, ref, change, share: Math.max(0, -change / goal) };
}

const pct0 = (v: number) => `${Math.round(v * 100)} %`;

/** The sentence of the way to the goal: a challenge, never a reproach. */
export function goalSentence(p: GoalProgress): string {
  const aim = signedPct(-p.goal);
  const got = signedPct(p.change);
  // reached as written: −9,6 % shows « −10 % », and is read as the −10 % aimed at
  if (Math.round(p.change) <= -p.goal) return `Objectif atteint : ${got} à climat égal, pour ${aim} visés. Bravo, gardez le cap !`;
  if (p.change < 0) return `${got} à climat égal : déjà ${pct0(p.share)} du chemin vers ${aim}. Continuez, chaque degré compte.`;
  return `${got} à climat égal : la baisse reste à venir. Une piste : 1 °C de moins demandé, c’est environ ${Math.round(ADEME_PER_DEGREE * 100)} % de chauffage en moins.`;
}
