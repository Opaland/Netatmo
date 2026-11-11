// #428: one source of the off-peak hours. Fictitious ranges only (never a real contract): a night
// one and an afternoon one, bounds inside a half hour, one over midnight, and the fallback.
import { describe, expect, it } from 'vitest';
import { addDays } from './aggregate';
import { addCharge, evPlan, evPlanOn } from './ev';
import {
  type HcRange,
  FALLBACK_RANGES,
  MAX_RANGES,
  STABLE_DAYS,
  changesFromR30,
  offPeakSentence,
  parseHcRanges,
  periodsFromR30,
  periodsOfTyped,
  rangesFromR30,
  rangesOn,
  rangesText,
  resolveOffPeak,
  shareOn,
  slotMask,
  slotShares,
  toHours,
} from './offpeak';
import { offPeakMask } from './plannings';
import type { Day30, Room30 } from './room30';
import { runAll, simulate } from './solar';

const hm = (h: number, m = 0) => h * 60 + m;
/** Two fictitious ranges: 2 h 15 → 7 h 45 at night, 13 h 15 → 15 h 45 in the afternoon. */
const TWO: HcRange[] = [
  { from: hm(2, 15), to: hm(7, 45) },
  { from: hm(13, 15), to: hm(15, 45) },
];
/** Bounds well inside their half hour: 3 h 17 → 8 h 47. */
const ODD: HcRange[] = [{ from: hm(3, 17), to: hm(8, 47) }];
/** Over midnight: 22 h 40 → 6 h 10. */
const MIDNIGHT: HcRange[] = [{ from: hm(22, 40), to: hm(6, 10) }];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** One day of half hours drawing 10 Wh every minute, counted HC on the minutes of `ranges`. */
function r30Of(ranges: readonly HcRange[], day = '2026-11-08'): Room30 {
  const hc = slotShares(ranges).map((f) => Math.round(f * 30) * 10);
  const hp = hc.map((v) => 300 - v);
  return new Map([['a', new Map([[day, [hp, hc, 20, 19] as Day30]])]]);
}

describe('#428 heures creuses : parts de chaque demi-heure', () => {
  it('deux plages, dont une l’après-midi, comptent huit heures', () => {
    const s = slotShares(TWO);
    expect(sum(s)).toBeCloseTo(16); // 8 h = 16 half hours
    expect(s[4]).toBeCloseTo(0.5); // 2:00–2:30, from 2:15
    expect(s.slice(5, 15).every((f) => f === 1)).toBe(true);
    expect(s[15]).toBeCloseTo(0.5); // 7:30–8:00, until 7:45
    expect(s[26]).toBeCloseTo(0.5); // 13:00–13:30
    expect(s.slice(27, 31).every((f) => f === 1)).toBe(true);
    expect(s[31]).toBeCloseTo(0.5);
    expect(s[24]).toBe(0); // noon: peak
    expect(s[44]).toBe(0); // 22 h: peak for this contract, unlike the fallback
  });

  it('une borne au milieu d’une demi-heure la compte au prorata des minutes', () => {
    const s = slotShares(ODD);
    expect(s[6]).toBeCloseTo(13 / 30); // 3:00–3:30 from 3:17: 13 minutes
    expect(s[17]).toBeCloseTo(17 / 30); // 8:30–9:00 until 8:47: 17 minutes
    expect(s[5]).toBe(0);
    expect(s[18]).toBe(0);
    // the boolean mask of the schedules: a half hour is off-peak when half of it is at least
    expect(slotMask(ODD)[6]).toBe(false);
    expect(slotMask(ODD)[17]).toBe(true);
  });

  it('une plage qui passe minuit', () => {
    const s = slotShares(MIDNIGHT);
    expect(s[45]).toBeCloseTo(20 / 30); // 22:30–23:00 from 22:40
    expect([46, 47, 0, 5, 11].every((i) => s[i] === 1)).toBe(true);
    expect(s[12]).toBeCloseTo(10 / 30); // 6:00–6:30 until 6:10
    expect(s[44]).toBe(0);
    expect(sum(s)).toBeCloseTo((7 * 60 + 30) / 30);
    expect(toHours(MIDNIGHT)).toEqual([[22 + 40 / 60, 6 + 10 / 60]]);
    expect(rangesText(MIDNIGHT)).toBe('22 h 40 → 6 h 10');
  });
});

describe('#428 heures creuses : une seule source, dans l’ordre', () => {
  it('sans relevé ni saisie : 22 h → 6 h, dit supposé', () => {
    for (const o of [resolveOffPeak(null, []), resolveOffPeak(undefined, undefined), resolveOffPeak([], [])]) {
      expect(o.source).toBe('supposees');
      expect(o.ranges).toEqual(FALLBACK_RANGES);
      expect(sum(o.share)).toBeCloseTo(16);
      expect(o.share[44]).toBe(1);
      expect(o.share[12]).toBe(0);
    }
  });

  it('les plages lues passent avant celles saisies, qui passent avant la supposition', () => {
    expect(resolveOffPeak(TWO, MIDNIGHT)).toMatchObject({ source: 'releves', ranges: TWO });
    expect(resolveOffPeak(null, MIDNIGHT)).toMatchObject({ source: 'saisies', ranges: MIDNIGHT });
    expect(resolveOffPeak(null, MIDNIGHT).share).toEqual(slotShares(MIDNIGHT));
  });

  it('lues dans les relevés : deux plages, bornes à la minute, l’une l’après-midi', () => {
    expect(rangesFromR30(r30Of(TWO), '2026-11-01', '2026-11-08')).toEqual(TWO);
    expect(rangesFromR30(r30Of(ODD), '2026-11-01', '2026-11-08')).toEqual(ODD);
    const both = [...ODD, TWO[1]];
    expect(rangesFromR30(r30Of(both), '2026-11-01', '2026-11-08')).toEqual(both);
  });

  it('lues dans les relevés : une plage qui passe minuit reste une seule plage', () => {
    expect(rangesFromR30(r30Of(MIDNIGHT), '2026-11-01', '2026-11-08')).toEqual(MIDNIGHT);
    expect(rangesFromR30(r30Of(FALLBACK_RANGES), '2026-11-01', '2026-11-08')).toEqual(FALLBACK_RANGES);
  });

  it('rien à lire : contrat Base, tout en heures creuses, hors période', () => {
    const flat = (v: number) => new Array<number>(48).fill(v);
    const base: Room30 = new Map([['a', new Map([['2026-11-08', [flat(100), flat(0), 20, 19] as Day30]])]]);
    expect(rangesFromR30(base, '2026-11-01', '2026-11-08')).toBeNull();
    const all: Room30 = new Map([['a', new Map([['2026-11-08', [flat(0), flat(100), 20, 19] as Day30]])]]);
    expect(rangesFromR30(all, '2026-11-01', '2026-11-08')).toBeNull();
    expect(rangesFromR30(r30Of(TWO), '2026-11-09', '2026-11-10')).toBeNull();
    expect(rangesFromR30(new Map(), '2026-11-01', '2026-11-08')).toBeNull();
  });

  it('saisies relues : minutes ou « HH:MM », le reste écarté', () => {
    expect(parseHcRanges([{ from: '02:15', to: '07:45' }, { from: 795, to: 945 }])).toEqual(TWO);
    expect(parseHcRanges([{ from: '22:40', to: '06:10' }])).toEqual(MIDNIGHT);
    expect(parseHcRanges([{ from: 600, to: 600 }, { from: 1440, to: 3 }, { from: '7:45', to: '08:00' }, { from: 1.5, to: 3 }, null, [1, 2]])).toEqual([]);
    expect(parseHcRanges('[{"from":1,"to":2}]')).toEqual([]);
    expect(parseHcRanges(JSON.parse('[{"__proto__":{"from":1,"to":2}}]'))).toEqual([]);
    expect(parseHcRanges(Array.from({ length: 12 }, (_, i) => ({ from: i * 60, to: i * 60 + 30 })))).toHaveLength(MAX_RANGES);
  });
});

describe('#428 les simulateurs prennent les plages fournies', () => {
  it('recharge : 13 h → 15 h 30 à 4 kW, presque toute en heures creuses l’après-midi', () => {
    const input = { kwhWeek: 70, powerKw: 4, startHour: 13 }; // 10 kWh a day, 2 h 30
    const p = evPlan(input, slotShares(TWO))!;
    // 13:00–13:30 counts half (from 13:15), then four full half hours
    expect(p.hc).toBeCloseTo(1 + 8);
    expect(p.hp).toBeCloseTo(1);
    // the same charge under the fallback 22 h → 6 h: all in peak hours
    const fallback = evPlan(input)!;
    expect(fallback.hc).toBeCloseTo(0);
    expect(fallback.hp).toBeCloseTo(10);
  });

  it('recharge : une borne au milieu d’une demi-heure partage son énergie au prorata', () => {
    const p = evPlan({ kwhWeek: 7, powerKw: 2, startHour: 3 }, slotShares(ODD))!; // 1 kWh, 3:00–3:30
    expect(p.hc).toBeCloseTo(13 / 30);
    expect(p.hp).toBeCloseTo(17 / 30);
  });

  it('solaire : le prix de chaque demi-heure et le pilotage suivent les plages', () => {
    const a = { priceHp: 0.25, priceHc: 0.2, feedIn: 0, costPerKwc: 0, batteryCostPerKwh: 0, batteryEfficiency: 0.9 };
    const wh = new Array<number>(48).fill(0);
    wh[26] = 1000; // 13:00–13:30, half of it off-peak with TWO
    const prod = new Array<number>(48).fill(0);
    prod[26] = 1000;
    const d = { day: '2026-06-15', wh, prod, shiftable: 0, rebuilt: false };
    const opts = { kwc: 1, pilotKw: 0, scenario: { pilot: false, battery: 0 }, a };
    // 1 kWh not bought, at the mean of the two prices on this half hour
    expect(simulate({ days: [d] }, { ...opts, offPeak: slotShares(TWO) }).saving).toBeCloseTo(0.225);
    expect(simulate({ days: [d] }, { ...opts, offPeak: slotShares(FALLBACK_RANGES) }).saving).toBeCloseTo(0.25);
    // piloting moves only what was drawn in the off-peak hours given (here the afternoon)
    const heater = new Array<number>(48).fill(0);
    heater[28] = 2000; // 14:00–14:30: off-peak with TWO, peak with the fallback
    const sun = new Array<number>(48).fill(0);
    sun[24] = 5000;
    const h = { day: '2026-06-15', wh: heater, prod: sun, shiftable: 2000, rebuilt: false };
    const pilot = { ...opts, pilotKw: 10, scenario: { pilot: true, battery: 0 } };
    expect(simulate({ days: [h] }, { ...pilot, offPeak: slotShares(TWO) }).moved).toBeCloseTo(2); // kWh
    expect(simulate({ days: [h] }, { ...pilot, offPeak: slotShares(FALLBACK_RANGES) }).moved).toBeCloseTo(0);
  });
});

// ------------------------------------------------------------------ #441 dated ranges
// Fictitious ranges only (never a real contract): one night range before, then a shorter night
// one and an afternoon one « à compter du » a day, as the CRE reform does.
/** Before: 23 h 10 → 7 h 10. */
const OLD: HcRange[] = [{ from: hm(23, 10), to: hm(7, 10) }];
/** After: 1 h 40 → 6 h 40 and 11 h 40 → 14 h 40 (noon is peak before, off-peak after). */
const NEW: HcRange[] = [
  { from: hm(1, 40), to: hm(6, 40) },
  { from: hm(11, 40), to: hm(14, 40) },
];
const START = '2026-01-01';
type Spec = HcRange[] | 'none' | 'night';
/**
 * Half hours of one room from START, a day per entry: heated all day (10 Wh a minute) and counted
 * HC on the minutes of its ranges; 'none' not heated (summer); 'night' heated 2 h 30 → 5 h only,
 * off-peak with both OLD and NEW (a day that tells nothing about the change).
 */
function history(spec: Spec[]): Room30 {
  const days = new Map<string, Day30>();
  spec.forEach((s, k) => {
    const day = addDays(START, k);
    if (s === 'none') return void days.set(day, [new Array(48).fill(0), new Array(48).fill(0), 20, 19] as Day30);
    if (s === 'night') {
      const hc = new Array<number>(48).fill(0).map((_, i) => (i >= 5 && i < 10 ? 300 : 0));
      return void days.set(day, [new Array(48).fill(0), hc, 20, 19] as Day30);
    }
    const hc = slotShares(s).map((f) => Math.round(f * 30) * 10);
    days.set(day, [hc.map((v) => 300 - v), hc, 20, 19] as Day30);
  });
  return new Map([['a', days]]);
}
const times = (n: number, x: Spec): Spec[] => Array<Spec>(n).fill(x);
const lastOf = (n: number) => addDays(START, n - 1);

describe('#441 heures creuses datées : la date du changement lue dans les relevés', () => {
  it('un changement au milieu : deux périodes, chacune avec ses plages', () => {
    const r = history([...times(30, OLD), ...times(30, NEW)]);
    expect(changesFromR30(r, START, lastOf(60))).toEqual(['2026-01-31']);
    expect(periodsFromR30(r, START, lastOf(60))).toEqual([
      { since: null, ranges: OLD },
      { since: '2026-01-31', ranges: NEW },
    ]);
    // the single reading of #428 mixed them over the same window
    expect(rangesFromR30(r, START, lastOf(60))).not.toEqual(NEW);
  });

  it(`moins de ${STABLE_DAYS} jours d’écart ne coupent pas l’historique ; ${STABLE_DAYS} jours, si`, () => {
    const odd = history([...times(30, OLD), ...times(STABLE_DAYS - 1, NEW), ...times(30, OLD)]);
    expect(changesFromR30(odd, START, lastOf(70))).toEqual([]);
    expect(periodsFromR30(odd, START, lastOf(70))).toHaveLength(1);
    const run = history([...times(30, OLD), ...times(STABLE_DAYS, NEW), ...times(30, OLD)]);
    expect(changesFromR30(run, START, lastOf(70))).toEqual(['2026-01-31', addDays('2026-01-31', STABLE_DAYS)]);
    expect(periodsFromR30(run, START, lastOf(70))!.map((p) => p.ranges)).toEqual([OLD, NEW, OLD]);
  });

  it('des jours sans chauffage ou qui ne disent rien ne comptent pas et ne coupent pas la série', () => {
    // summer between the two: the change is dated on the first heated day that shows it
    const summer = history([...times(30, OLD), ...times(20, 'none'), NEW, NEW, 'night', NEW, 'night', NEW, NEW, ...times(10, NEW)]);
    expect(changesFromR30(summer, START, lastOf(69))).toEqual([addDays(START, 50)]);
    expect(periodsFromR30(summer, START, lastOf(69))!.map((p) => p.ranges)).toEqual([OLD, NEW]);
  });

  it('une demi-heure coupée par une borne, chauffée tantôt avant tantôt après, ne fait pas un changement', () => {
    const r = history(times(40, OLD));
    // 23:00–23:30 is cut at 23:10: ten days in a row the radiator only runs 23:00–23:10 (all HP)
    for (const [day, cols] of r.get('a')!) {
      if (day < '2026-01-21' || day > '2026-01-30') continue;
      (cols[0] as number[])[46] = 100;
      (cols[1] as number[])[46] = 0;
    }
    expect(changesFromR30(r, START, lastOf(40))).toEqual([]);
  });

  it('un changement trop récent pour être sûr n’est pas encore vu', () => {
    const r = history([...times(30, OLD), ...times(STABLE_DAYS - 1, NEW)]);
    expect(changesFromR30(r, START, lastOf(30 + STABLE_DAYS - 1))).toEqual([]);
  });

  it('les plannings prennent les plages en vigueur le jour, pas un mélange', () => {
    const r = history([...times(10, OLD), ...times(18, NEW)]);
    expect(rangesOn(periodsFromR30(r, START, lastOf(28))!, lastOf(28))).toEqual(NEW);
    expect(rangesOn(periodsFromR30(r, START, lastOf(28))!, lastOf(5))).toEqual(OLD);
    expect(offPeakMask(r, START, lastOf(28))).toEqual(slotMask(NEW));
  });
});

/** 365 fictitious days (2026), the ranges changing on 1 July: 181 days before, 184 after. */
const YEAR = Array.from({ length: 365 }, (_, k) => addDays(START, k));
const CHANGE = '2026-07-01';
const DATED = resolveOffPeak(
  [
    { since: null, ranges: OLD },
    { since: CHANGE, ranges: NEW },
  ],
  null,
);

describe('#441 chaque jour compté avec ses plages, sur 365 jours', () => {
  const a = { priceHp: 0.25, priceHc: 0.2, feedIn: 0, costPerKwc: 0, batteryCostPerKwh: 0, batteryEfficiency: 0.9 };
  const at = (i: number, wh: number) => new Array<number>(48).fill(0).map((_, j) => (j === i ? wh : 0));

  it('le simulateur solaire : le prix de midi suit le changement', () => {
    // 1 kWh drawn and produced at noon each day: not bought, at the price of noon that day
    const days = YEAR.map((day) => ({ day, wh: at(24, 1000), prod: at(24, 1000), shiftable: 0, rebuilt: false }));
    const opts = { kwc: 1, pilotKw: 0, scenario: { pilot: false, battery: 0 }, a };
    expect(YEAR.filter((d) => d < CHANGE)).toHaveLength(181);
    expect(simulate({ days }, { ...opts, offPeak: (d) => shareOn(DATED, d) }).saving).toBeCloseTo(181 * 0.25 + 184 * 0.2);
    // the ranges of today applied to the whole year (#428): every noon off-peak
    expect(simulate({ days }, { ...opts, offPeak: DATED.share }).saving).toBeCloseTo(365 * 0.2);
    // runAll, as the view calls it
    const w = { days, from: YEAR[0], to: YEAR[364], curveDays: 365, rebuiltDays: 0 };
    const inputs = { priceHp: 0.25, priceHc: 0.2, feedIn: 0, costPerKwc: 1000, batteryCostPerKwh: 500, batteryEfficiency: 90, heaterKw: null, evKwhWeek: null, evKw: null };
    expect(runAll(w, inputs, (d) => shareOn(DATED, d), [1])[0].rows[0].saving).toBeCloseTo(181 * 0.25 + 184 * 0.2);
  });

  it('le simulateur solaire : le pilotage ne déplace que ce que les heures creuses du jour ont tiré', () => {
    // the water heater runs 1 h → 1 h 30: off-peak before the change, peak after
    const days = YEAR.map((day) => ({ day, wh: at(2, 2000), prod: at(24, 5000), shiftable: 2000, rebuilt: false }));
    const pilot = { kwc: 1, pilotKw: 10, scenario: { pilot: true, battery: 0 }, a };
    expect(simulate({ days }, { ...pilot, offPeak: (d) => shareOn(DATED, d) }).moved).toBeCloseTo(181 * 2);
    expect(simulate({ days }, { ...pilot, offPeak: DATED.share }).moved).toBeCloseTo(0);
  });

  it('la recharge : 1 kWh à midi chaque jour, en heures pleines avant, creuses après', () => {
    const splits = YEAR.map((day) => ({ day, hc: 0, hp: 0 }));
    const input = { kwhWeek: 7, powerKw: 2, startHour: 12 }; // 12:00–12:30
    const dated = addCharge(splits, evPlanOn(input, DATED)!);
    expect(dated.reduce((s, x) => s + x.hp, 0)).toBeCloseTo(181);
    expect(dated.reduce((s, x) => s + x.hc, 0)).toBeCloseTo(184);
    const flat = addCharge(splits, evPlan(input, DATED.share)!);
    expect(flat.reduce((s, x) => s + x.hc, 0)).toBeCloseTo(365);
    expect(evPlanOn({ kwhWeek: 7, powerKw: 0, startHour: 12 }, DATED)).toBeNull();
  });
});

describe('#441 heures creuses saisies « à compter du »', () => {
  const typed = parseHcRanges([
    { from: '23:10', to: '07:10' },
    { from: '11:40', to: '14:40', since: CHANGE },
    { from: '01:40', to: '06:40', since: CHANGE },
  ]);

  it('deux périodes, la date en tête de la seconde', () => {
    expect(periodsOfTyped(typed)).toEqual([
      { since: null, ranges: OLD },
      { since: CHANGE, ranges: NEW },
    ]);
    const o = resolveOffPeak(null, typed);
    expect(o.source).toBe('saisies');
    expect(o.ranges).toEqual(NEW);
    expect(rangesOn(o.periods, '2026-06-30')).toEqual(OLD);
    expect(rangesOn(o.periods, CHANGE)).toEqual(NEW);
    expect(shareOn(o, '2026-06-30')).toEqual(slotShares(OLD));
    expect(offPeakSentence(o)).toBe(
      `Heures creuses saisies dans ⚙ Mon contrat : ${rangesText(NEW)} depuis le 1er juillet 2026 ; avant le 1er juillet 2026, ${rangesText(OLD)}`,
    );
  });

  it('trois périodes : celle du milieu bornée par ses deux dates', () => {
    const o = resolveOffPeak(null, [...typed, { from: hm(0, 20), to: hm(5, 20), since: '2026-10-15' }]);
    expect(offPeakSentence(o)).toContain(`du 1er juillet 2026 au 14 octobre 2026, ${rangesText(NEW)}`);
    expect(offPeakSentence(o)).toContain('depuis le 15 octobre 2026');
  });

  it('une saisie d’avant #441, sans date, reste valide ; une date fausse écarte la plage', () => {
    const old = parseHcRanges([{ from: 1390, to: 430 }]);
    expect(old).toEqual(OLD);
    const o = resolveOffPeak(null, old);
    expect(o.periods).toEqual([{ since: null, ranges: OLD, share: slotShares(OLD) }]);
    expect(offPeakSentence(o)).toBe(`Heures creuses saisies dans ⚙ Mon contrat : ${rangesText(OLD)}`);
    expect(parseHcRanges([{ from: 100, to: 400, since: '2026-02-30' }, { from: 100, to: 400, since: '2026-7-1' }, { from: 100, to: 400, since: 20260701 }])).toEqual([]);
    expect(parseHcRanges([{ from: 100, to: 400, since: '' }, { from: 500, to: 600, since: null }])).toEqual([
      { from: 100, to: 400 },
      { from: 500, to: 600 },
    ]);
  });

  it('toutes datées : avant la première date, la première connue', () => {
    const o = resolveOffPeak(null, [{ ...NEW[0], since: CHANGE }]);
    expect(rangesOn(o.periods, '2026-01-01')).toEqual([NEW[0]]);
  });
});

describe('#441 le repli', () => {
  it('sans relevé ni saisie : 22 h → 6 h tous les jours, une seule période', () => {
    const o = resolveOffPeak(null, []);
    expect(o.periods).toHaveLength(1);
    for (const d of [YEAR[0], CHANGE, YEAR[364]]) expect(shareOn(o, d)).toEqual(slotShares(FALLBACK_RANGES));
  });

  it('des périodes lues sans plage laissent la place à la saisie', () => {
    const o = resolveOffPeak([{ since: null, ranges: [] }], [{ ...NEW[1] }]);
    expect(o.source).toBe('saisies');
    expect(o.ranges).toEqual([NEW[1]]);
  });

  it('les relevés datés passent avant la saisie', () => {
    const o = resolveOffPeak(DATED.periods, [{ ...NEW[1] }]);
    expect(o.source).toBe('releves');
    expect(rangesOn(o.periods, YEAR[0])).toEqual(OLD);
  });
});
