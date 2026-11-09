import { describe, expect, it } from 'vitest';
import { type Day30, type Room30 } from './room30';
import { ecoRate, energySplit, groupRises, offPeakMask, rises, suggestShift, verdict } from './plannings';

const HC = (i: number) => i < 12 || i >= 44; // 22 h → 6 h
/**
 * A day: setpoint 18 °C, 20 °C from `start` (half hour) to 22 h; the temperature climbs `step` °C per
 * half hour after the rise; 200 Wh per half hour while warming, 80 Wh holding, 40 Wh in economy.
 */
function day(start = 14, step = 0.5, comfort = 20): Day30 {
  const sp: number[] = [];
  const t: number[] = [];
  const e: number[] = [];
  let cur = 18;
  for (let i = 0; i < 48; i++) {
    const on = i >= start && i < 44;
    sp.push(on ? comfort : 18);
    if (on) cur = Math.min(comfort, cur + step);
    else cur = Math.max(18, cur - 0.3);
    t.push(Math.round(cur * 10) / 10);
    e.push(on ? (cur < comfort - 0.3 || i === start ? 200 : 80) : 40);
  }
  return [e.map((v, i) => (HC(i) ? 0 : v)), e.map((v, i) => (HC(i) ? v : 0)), t, sp];
}
const room = (days: Record<string, Day30>): Room30 => new Map([['salon', new Map(Object.entries(days))]]);
const week = (f: () => Day30) => Object.fromEntries(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((d) => [d, f()]));

describe('plannings (S-4.13, #211)', () => {
  it('reads the off-peak half hours and the split of the energy', () => {
    const r = room(week(() => day()));
    const mask = offPeakMask(r, '2026-11-01', '2026-11-30')!;
    expect(mask.filter(Boolean).length).toBe(16);
    expect(mask[0] && mask[11] && !mask[12] && mask[44]).toBe(true);
    const s = energySplit(r, ['salon'], '2026-11-01', '2026-11-30');
    expect(s.days).toBe(4);
    expect(s.hc).toBeCloseTo((16 * 40 * 4) / 1000);
    expect(s.hp).toBeGreaterThan(s.hc);
    // days of absence are left out
    expect(energySplit(r, ['salon'], '2026-11-01', '2026-11-30', new Set(['2026-11-02'])).days).toBe(3);
    expect(rises(r, 'salon', '2026-11-01', '2026-11-30', new Set(['2026-11-02', '2026-11-03']))).toHaveLength(2);
    // a Base contract: no off-peak energy, no mask
    expect(offPeakMask(new Map([['a', new Map([['2026-11-02', [100, 0, 19, 19] as Day30]])]]), '2026-11-01', '2026-11-30')).toBeNull();
  });

  it('follows each comfort start: delay, gain, kWh in peak hours', () => {
    const list = rises(room(week(() => day())), 'salon', '2026-11-01', '2026-11-30');
    expect(list).toHaveLength(4);
    const r = list[0];
    expect(r.slot).toBe(14);
    expect(r.target).toBe(20);
    expect(r.start).toBe(18);
    expect(r.reached).toBe(3); // 18.5, 19, 19.5, 20 → warm at the 4th half hour
    expect(r.kwh).toBeCloseTo(0.2 * 3 + 0.08);
    expect(r.hpKwh).toBeCloseTo(r.kwh);
    expect(r.span).toBe(12);
    expect(r.holdSlots).toBe(8);
    const [g] = groupRises(list);
    expect(g.n).toBe(4);
    expect(g.reached).toBe(4);
    expect(g.delay).toBe(3);
    expect(g.gain).toBeCloseTo(2);
    expect(g.hpShare).toBeCloseTo(1);
    expect(g.hold).toBeCloseTo(0.08);
  });

  it('counts the warm-ups that never reach the requested temperature', () => {
    const list = rises(room(week(() => day(14, 0.1))), 'salon', '2026-11-01', '2026-11-30');
    const [g] = groupRises(list);
    expect(g.reached).toBe(0);
    expect(g.missing).toBeCloseTo(20 - 19.2);
    expect(g.wasted).toBe(4 * 12);
    expect(verdict(g, null)).toBe('unreached');
  });

  it('suggests starting earlier so that the warm-up ends with the off-peak hours', () => {
    const r = room(week(() => day()));
    const [g] = groupRises(rises(r, 'salon', '2026-11-01', '2026-11-30'));
    const eco = ecoRate(r, 'salon', '2026-11-01', '2026-11-30');
    expect(eco).toBeCloseTo(0.04);
    const s = suggestShift(g, offPeakMask(r, '2026-11-01', '2026-11-30'), eco, { hp: 0.27, hc: 0.2 }, 30)!;
    expect(s.from).toBe(14); // 7 h
    expect(s.gap).toBe(2); // the off-peak hours end at 6 h
    expect(s.to).toBe(9); // 4 h 30: three half hours of warm-up before 6 h
    expect(s.kwh).toBeCloseTo(0.68);
    // saving 0.68 × 0.07 = 0.0476 € per start, holding 2 × (0.08 − 0.04) × 0.27 = 0.0216 €
    expect(s.high).toBeCloseTo((0.0476 - 0.7 * 0.0216) * 30);
    expect(s.low).toBeCloseTo((0.7 * 0.0476 - 1.3 * 0.0216) * 30);
    expect(verdict(g, s)).toBe('shift');
    // no gain when peak and off-peak cost the same, nor when the start is already off-peak
    expect(suggestShift(g, offPeakMask(r, '2026-11-01', '2026-11-30'), eco, { hp: 0.2, hc: 0.2 }, 30)).toBeNull();
    const night = room(week(() => day(10)));
    const [gn] = groupRises(rises(night, 'salon', '2026-11-01', '2026-11-30'));
    expect(suggestShift(gn, offPeakMask(night, '2026-11-01', '2026-11-30'), eco, { hp: 0.27, hc: 0.2 }, 30)).toBeNull();
  });

  it('flags late and already-warm starts, and ignores rare ones', () => {
    const slow = groupRises(rises(room(week(() => day(14, 0.2))), 'salon', '2026-11-01', '2026-11-30'))[0];
    expect(slow.delay).toBe(8);
    expect(verdict(slow, null)).toBe('late');
    const warm = groupRises(rises(room(week(() => day(14, 0.5, 19))), 'salon', '2026-11-01', '2026-11-30'));
    expect(warm[0].delay).toBe(1);
    const rare = room({ '2026-11-02': day() });
    expect(groupRises(rises(rare, 'salon', '2026-11-01', '2026-11-30'))).toEqual([]);
    expect(groupRises(rises(rare, 'salon', '2026-11-01', '2026-11-30'), 1)).toHaveLength(1);
  });
});
