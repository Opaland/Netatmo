import { describe, expect, it } from 'vitest';
import type { Meta } from './aggregate';
import { backupNames } from './backup';
import { type Day30, type Room30, halfHourProfile, hourlyFrom30, mergeDocs, preferRoom30, slotLabel, tempDrops, unpack } from './room30';
import { coldReasons, coldWithWindow } from './windows';

const flat = (v: number | null) => new Array(48).fill(v);
/** A day: 100 Wh HP every half hour from 6 h, 50 Wh HC before, the given temperatures, setpoint 19. */
const day = (t: (number | null)[] | number = 20, sp: number | (number | null)[] = 19): Day30 => [
  [...flat(0).slice(0, 12), ...flat(100).slice(12)],
  [...flat(50).slice(0, 12), ...flat(0).slice(12)],
  t,
  sp,
];

describe('room30 (S-1.26)', () => {
  it('expands the compact columns', () => {
    expect(unpack(null)).toEqual(flat(null));
    expect(unpack(19.5)).toEqual(flat(19.5));
    expect(unpack([1, 2])).toEqual([1, 2, ...flat(null).slice(2)]);
    expect(slotLabel(15)).toBe('07:30');
  });

  it('merges the yearly documents', () => {
    const r = mergeDocs([{ rooms: { a: { '2025-12-31': day() } } }, null, { rooms: { a: { '2026-01-01': day() }, b: { '2026-01-01': day() } } }]);
    expect([...r.get('a')!.keys()]).toEqual(['2025-12-31', '2026-01-01']);
    expect(r.has('b')).toBe(true);
  });

  it('rebuilds hourly kWh, merged like the household view', () => {
    const r30: Room30 = new Map([
      ['ch1', new Map([['2026-01-05', day()]])],
      ['ch2', new Map([['2026-01-05', day()]])],
    ]);
    const h = hourlyFrom30(r30, '2026-01-01', '2026-01-31', new Map([['ch1', 'bedrooms'], ['ch2', 'bedrooms']]));
    expect([...h.keys()]).toEqual(['bedrooms']);
    expect(h.get('bedrooms')!.get('2026-01-05T00')).toBeCloseTo(0.2); // 2 rooms × 2 × 50 Wh
    expect(h.get('bedrooms')!.get('2026-01-05T12')).toBeCloseTo(0.4);
    expect(hourlyFrom30(r30, '2026-02-01', '2026-02-28').size).toBe(0);
  });

  it('prefers the half hours on the days they cover, without touching the cached hourly data', () => {
    const hourly = new Map([['a', new Map([['2026-01-04T10', 9], ['2026-01-05T10', 9], ['2026-01-05T11', 9]])]]);
    const r30: Room30 = new Map([['a', new Map([['2026-01-05', day()]])]]);
    const best = preferRoom30(hourly, hourlyFrom30(r30));
    expect(best.get('a')!.get('2026-01-04T10')).toBe(9);
    expect(best.get('a')!.get('2026-01-05T10')).toBeCloseTo(0.2);
    expect(best.get('a')!.size).toBe(25);
    expect(hourly.get('a')!.get('2026-01-05T10')).toBe(9);
  });

  it('averages the half-hour profile over the days with data', () => {
    const r30: Room30 = new Map([['a', new Map([['2026-01-05', day()], ['2026-01-06', day()], ['2025-12-01', day()]])]]);
    const { profile, days } = halfHourProfile(r30, new Set(['a']), '2026-01-01', '2026-01-31');
    expect(days).toBe(2);
    expect(profile[0]).toBeCloseTo(0.05);
    expect(profile[47]).toBeCloseTo(0.1);
    expect(halfHourProfile(r30, new Set(['b']), '2026-01-01', '2026-01-31').days).toBe(0);
  });

  it('finds a sharp temperature fall, not the night setback', () => {
    const t = flat(20);
    t[15] = 18.9;
    t[16] = 17.6; // window opened at 07:30
    t[17] = 18.5;
    const setback = flat(20);
    for (let i = 44; i < 48; i++) setback[i] = 20 - (i - 43) * 1.2; // falls fast, but the setpoint went down
    const sp = [...flat(19).slice(0, 44), ...flat(17).slice(44)];
    const r30: Room30 = new Map([
      ['a', new Map([['2026-01-05', day(t)], ['2026-01-06', day(setback, sp)], ['2026-01-07', day(20)]])],
    ]);
    const drops = tempDrops(r30, '2026-01-01', '2026-01-31');
    expect(drops.get('a')!.get('2026-01-05')).toEqual({ at: '07:00', fall: 2.4 });
    expect(drops.get('a')!.has('2026-01-06')).toBe(false);
    expect(drops.get('a')!.has('2026-01-07')).toBe(false);
  });

  it('explains a cold day the hourly snapshots missed', () => {
    const temps = new Map([['a', new Map<string, [number, number | null]>([['2026-01-05', [18, 19]], ['2026-01-06', [18, 19]]])]]);
    const drops = new Map([['a', new Map([['2026-01-05', { at: '07:00', fall: 2.4 }]])]]);
    const rs = { seen: { '2026-01-05': 0xffffff, '2026-01-06': 0xffffff }, rooms: { a: { '2026-01-05': { n: 24 }, '2026-01-06': { n: 24 } } } };
    expect(coldReasons(temps, rs, '2026-01-01', '2026-01-31').get('a')).toMatchObject({ window: 0, unexplained: 2 });
    expect(coldReasons(temps, rs, '2026-01-01', '2026-01-31', undefined, 19, 1, drops).get('a')).toMatchObject({ window: 1, drop: 1, unexplained: 1, openHours: 0 });
    const list = coldWithWindow(temps, rs, '2026-01-01', '2026-01-31', 19, 1, drops);
    expect(list).toEqual([{ day: '2026-01-05', room: 'a', temp: 18, open: 0, drop: { at: '07:00', fall: 2.4 } }]);
    expect(coldWithWindow(temps, rs, '2026-01-01', '2026-01-31')).toEqual([]);
  });

  it('is in the backup with its progress document', () => {
    const meta = { years: [2026], room30_years: [2025, 2026] } as unknown as Meta;
    const names = backupNames(meta);
    expect(names).toContain('2025.room30.enc.json');
    expect(names).toContain('2026.room30.enc.json');
    expect(names).toContain('room30.enc.json');
    expect(backupNames({ years: [2026] } as unknown as Meta)).not.toContain('room30.enc.json');
  });
});
