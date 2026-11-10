// #428: one source of the off-peak hours. Fictitious ranges only (never a real contract): a night
// one and an afternoon one, bounds inside a half hour, one over midnight, and the fallback.
import { describe, expect, it } from 'vitest';
import { evPlan } from './ev';
import { type HcRange, FALLBACK_RANGES, parseHcRanges, rangesFromR30, rangesText, resolveOffPeak, slotMask, slotShares, toHours } from './offpeak';
import type { Day30, Room30 } from './room30';
import { simulate } from './solar';

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
    expect(parseHcRanges(Array.from({ length: 9 }, (_, i) => ({ from: i * 60, to: i * 60 + 30 })))).toHaveLength(4);
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
