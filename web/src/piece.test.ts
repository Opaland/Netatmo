import { describe, expect, it } from 'vitest';
import {
  byCost,
  coldDays,
  comfortPill,
  lastReading,
  meanIn,
  modeAt,
  modeText,
  reasonText,
  scheduleOf,
  tempAxis,
  timeAtSetpoint,
} from './piece';
import type { Day30, Room30 } from './room30';

const flat = <T>(v: T) => new Array<T>(48).fill(v);
/** Setpoint 20 °C from 7 h to 22 h, 18 °C otherwise. */
const SP = flat(18).map((v, i) => (i >= 14 && i < 44 ? 20 : v));
/** HC from 22 h to 6 h (energy counted in the HC column), HP otherwise. */
const HP = flat(100).map((v, i) => (i < 12 || i >= 44 ? 0 : v));
const HC = flat(0).map((v, i) => (i < 12 || i >= 44 ? 80 : v));
const day = (t: (number | null)[] | number | null = 20, sp: (number | null)[] | number | null = SP): Day30 => [HP, HC, t, sp];

describe('page Pièce : maintenant (#313)', () => {
  it('reads the last half hour measured, across the rooms of a group', () => {
    const t = flat<number | null>(19.5).map((v, i) => (i > 40 ? null : v));
    const r30: Room30 = new Map([
      ['a', new Map([['2026-11-07', day(20)], ['2026-11-08', day(t)]])],
      ['b', new Map([['2026-11-08', day(18.5, 19)]])],
    ]);
    expect(lastReading(r30, ['a'])).toEqual({ day: '2026-11-08', slot: 40, temps: [19.5], setpoints: [20] });
    // b has the 23 h 30 reading: the group takes it, with what a had then (nothing)
    expect(lastReading(r30, ['a', 'b'])).toEqual({ day: '2026-11-08', slot: 47, temps: [18.5], setpoints: [18, 19] });
    expect(lastReading(r30, ['zz'])).toBeNull();
  });

  it('reads the schedule of a day from its setpoints', () => {
    const s = scheduleOf(SP)!;
    expect(s.comfort).toBe(20);
    expect(s.eco).toBe(18);
    expect(s.slots).toEqual([
      { from: 0, to: 7, kind: 'eco' },
      { from: 7, to: 22, kind: 'comfort' },
      { from: 22, to: 24, kind: 'eco' },
    ]);
    // constant, or too few setpoints: no schedule
    expect(scheduleOf(flat(19))).toBeNull();
    expect(scheduleOf(SP.map((v, i) => (i < 10 ? v : null)))).toBeNull();
  });

  it('says the mode and until when, the night going on to the morning', () => {
    const s = scheduleOf(SP)!;
    expect(modeAt(s, 30)).toEqual({ kind: 'comfort', until: 22, next: 'eco' });
    expect(modeText(s, 30)).toBe('Confort jusqu’à 22 h, puis économie 18,0 °C');
    // 23 h: eco until 7 h the next morning
    expect(modeAt(s, 46)).toEqual({ kind: 'eco', until: 7, next: 'comfort' });
    expect(modeText(s, 46)).toBe('Économie jusqu’à 7 h, puis confort 20,0 °C');
    const half = scheduleOf(SP.map((v, i) => (i === 14 ? 18 : v)))!;
    expect(modeText(half, 2)).toBe('Économie jusqu’à 7 h 30, puis confort 20,0 °C');
  });

});

describe('temps à la consigne (#313, « tps consigné ? »)', () => {
  it('is the share of the hours at the requested temperature, frost guard left out', () => {
    // 19,6 °C all day: at the setpoint in eco (18) and within 0,5 °C of 20 in comfort
    const r30: Room30 = new Map([['a', new Map([['2026-11-08', day(19.6)]])]]);
    expect(timeAtSetpoint(r30, ['a'], '2026-11-01', '2026-11-08')).toEqual({ share: 1, hours: 24 });
    // 19 °C: below 20 − 0,5 during the 30 comfort half hours
    const cold: Room30 = new Map([['a', new Map([['2026-11-08', day(19)]])]]);
    expect(timeAtSetpoint(cold, ['a'], '2026-11-01', '2026-11-08')!.share).toBeCloseTo(18 / 48);
    // frost guard (7 °C) is not a temperature asked to live in: too few half hours left
    const away: Room30 = new Map([['a', new Map([['2026-11-08', day(12, 7)]])]]);
    expect(timeAtSetpoint(away, ['a'], '2026-11-01', '2026-11-08')).toBeNull();
  });
});

describe('Pourquoi il a fait froid (#313)', () => {
  const rows = [
    { day: '2026-11-01', temp: 20, setpoint: 20 },
    { day: '2026-11-02', temp: 18.2, setpoint: 20 },
    { day: '2026-11-03', temp: 18.5, setpoint: 20 },
    { day: '2026-11-04', temp: 18.9, setpoint: 17 },
    { day: '2026-11-05', temp: 18.8, setpoint: 20 },
    { day: '2026-11-06', temp: null, setpoint: 20 },
    { day: '2026-11-07', temp: 18.7, setpoint: 7 },
  ];
  const cells = (d: string) =>
    ({
      '2026-11-02': [{ n: 24, open_window_h: 3.5 }, { n: 24, offload_h: 2 }],
      '2026-11-03': [{ n: 24 }],
      '2026-11-04': [{ n: 24 }],
      '2026-11-07': [{ n: 24, mode_h: { hg: 20, manual: 2 } }],
    })[d] ?? null;

  it('explains each cold day, most recent first', () => {
    const out = coldDays(rows, 19, cells, (d) => (d === '2026-11-03' ? { at: '07:00', fall: 1.8 } : undefined));
    expect(out.map((c) => c.day)).toEqual(['2026-11-07', '2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02']);
    const by = Object.fromEntries(out.map((c) => [c.day, c.reasons]));
    expect(by['2026-11-02']).toEqual([{ kind: 'window', hours: 3.5 }, { kind: 'offload', hours: 2 }]);
    expect(by['2026-11-03']).toEqual([{ kind: 'drop', at: '07:00', fall: 1.8 }]);
    expect(by['2026-11-04']).toEqual([{ kind: 'setpoint', value: 17 }]);
    expect(by['2026-11-05']).toEqual([{ kind: 'nodata' }]);
    // the frost-guard mode explains the low setpoint: said once
    expect(by['2026-11-07']).toEqual([{ kind: 'mode', mode: 'hg', hours: 20 }]);
    expect(coldDays([{ day: '2026-11-03', temp: 18, setpoint: 20 }], 19, cells)[0].reasons).toEqual([{ kind: 'none' }]);
  });

  it('words the reasons without technical terms', () => {
    expect(reasonText({ kind: 'window', hours: 3.5 }, 19)).toBe('fenêtre ouverte 3,5 h');
    expect(reasonText({ kind: 'window', hours: 4 }, 19)).toBe('fenêtre ouverte 4 h');
    expect(reasonText({ kind: 'offload', hours: 2 }, 19)).toBe('radiateur coupé 2 h (délestage)');
    expect(reasonText({ kind: 'mode', mode: 'hg', hours: 20 }, 19)).toBe('mode hors-gel 20 h');
    expect(reasonText({ kind: 'drop', at: '07:30', fall: 1.8 }, 19)).toBe('chute de 1,8 °C vers 7 h 30 (fenêtre ou porte ouverte ?)');
    expect(reasonText({ kind: 'setpoint', value: 17 }, 19)).toBe('température demandée de 17,0 °C, sous le seuil de 19,0 °C');
    expect(reasonText({ kind: 'none' }, 19)).toMatch(/pas d’explication/);
  });
});

describe('liste Pièces (#313)', () => {
  it('sorts by cost, then kWh', () => {
    const rows = [
      { id: 'a', eur: 80, kwh: 400 },
      { id: 'b', eur: 234, kwh: 1263 },
      { id: 'c', eur: 80, kwh: 500 },
    ];
    expect(byCost(rows).map((r) => r.id)).toEqual(['b', 'c', 'a']);
    // without prices: by kWh
    expect(byCost(rows.map((r) => ({ ...r, eur: null }))).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('gives a comfort pill', () => {
    expect(comfortPill(2, 10, 19)).toEqual({ level: 'warn', text: '2 j sous 19,0 °C' });
    expect(comfortPill(0, 6.2, 19)).toEqual({ level: 'warn', text: 'fenêtre 6 h' });
    expect(comfortPill(0, 1, 19)).toEqual({ level: 'ok', text: 'confort' });
    expect(comfortPill(0, null, 19)).toEqual({ level: 'ok', text: 'confort' });
  });

  it('averages over a period and scales a temperature axis away from 0', () => {
    expect(meanIn([['2026-11-01', 19], ['2026-11-02', null], ['2026-11-03', 21], ['2026-10-31', 5]], '2026-11-01', '2026-11-30')).toEqual({ mean: 20, n: 2 });
    expect(meanIn([], 'a', 'b')).toBeNull();
    expect(tempAxis([18.4, 20.2, null, 20])).toEqual({ min: 17, max: 21 });
    expect(tempAxis([19.9, 20])).toEqual({ min: 19, max: 21 });
    expect(tempAxis([null])).toBeNull();
  });
});
