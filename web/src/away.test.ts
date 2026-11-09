import { describe, expect, it } from 'vitest';
import { absenceSaving, absentDaysIn, awayRuns, homeAbsences, homeAwayHours, roomOnlyAway, shiftBack } from './away';
import type { RoomState, StateCell } from './windows';

const cell = (away = 0, mode = 'away'): StateCell => ({ n: 24, boost_h: 0, open_window_h: 0, ...(away ? { mode_h: { [mode]: away } } : {}) });
const water: StateCell = { n: 24, contactor_h: { off: 24 } };

describe('absences from the absence mode (S-13.7, #210)', () => {
  const rs: RoomState = {
    rooms: {
      salon: { '2026-09-24': cell(4), '2026-09-25': cell(24), '2026-09-26': cell(24), '2026-09-27': cell(17), '2026-10-01': cell(0), '2026-10-02': cell(0), '2026-10-10': cell(10) },
      cuisine: { '2026-09-24': cell(4, 'hg'), '2026-09-25': cell(24), '2026-09-26': cell(24), '2026-09-27': cell(17), '2026-10-10': cell(0) },
      bureau: { '2026-09-24': cell(5), '2026-09-25': cell(24), '2026-09-26': cell(24), '2026-09-27': cell(18), '2026-10-01': cell(24), '2026-10-02': cell(24) },
      ce: { '2026-09-25': water },
    },
  };

  it('takes the least of the radiator rooms, day by day (the water heater has no mode)', () => {
    const h = homeAwayHours(rs);
    expect(h.get('2026-09-24')).toBe(4);
    expect(h.get('2026-09-27')).toBe(17);
    expect(h.get('2026-10-10')).toBe(0); // the kitchen did not switch: not an absence of the home
    expect(h.get('2026-10-01')).toBe(0); // the office alone
  });

  it('rebuilds start and end hours from the hours of the first and last days', () => {
    const runs = homeAbsences({ rooms: { salon: rs.rooms!.salon, cuisine: rs.rooms!.cuisine } });
    expect(runs).toHaveLength(1);
    const [r] = runs;
    expect([r.from, r.startHour, r.to, r.endHour, r.hours]).toEqual(['2026-09-24', 20, '2026-09-27', 17, 69]);
    expect(r.days).toHaveLength(4);
  });

  it('breaks a run on a day that did not reach midnight, and drops short ones', () => {
    const runs = awayRuns(
      new Map([
        ['2026-01-01', 24],
        ['2026-01-02', 10], // back in the evening…
        ['2026-01-03', 24], // …gone again the next day (separate run, alone: hours only)
        ['2026-01-05', 3], // an evening out
      ]),
    );
    expect(runs.map((r) => [r.from, r.to, r.startHour, r.endHour])).toEqual([
      ['2026-01-01', '2026-01-02', 0, 10],
      ['2026-01-03', '2026-01-03', null, null],
    ]);
  });

  it('keeps a room alone in absence apart (bedrooms grouped)', () => {
    const only = roomOnlyAway(rs, (r) => (r === 'bureau' ? 'chambres' : r));
    expect(only.get('chambres')).toEqual({ days: 2, hours: 48 });
    expect(only.has('salon')).toBe(true); // 10 Oct, 10 h alone
    expect(only.has('cuisine')).toBe(false);
  });

  it('corrects the start by the detection delay', () => {
    expect(shiftBack('2026-09-24', 20, 12)).toEqual({ day: '2026-09-24', hour: 8 });
    expect(shiftBack('2026-09-24', 5, 12)).toEqual({ day: '2026-09-23', hour: 17 });
  });

  it('estimates the heating saved against the signature, pro rata of the hours away', () => {
    const heat = new Map([
      ['2026-09-24', 20],
      ['2026-09-25', 4],
    ]);
    const s = absenceSaving(
      [
        ['2026-09-24', 6],
        ['2026-09-25', 24],
        ['2026-09-26', 24],
      ],
      heat,
      (d) => (d === '2026-09-26' ? null : 20),
    )!;
    expect(s.days).toBe(2);
    expect(s.expected).toBeCloseTo(5 + 20);
    expect(s.measured).toBeCloseTo(5 + 4);
    expect(s.kwh).toBeCloseTo(16);
    expect(absenceSaving([['2026-09-26', 24]], heat, () => null)).toBeNull();
  });

  it('counts the days away inside a comparison window', () => {
    const runs = homeAbsences(rs);
    expect(absentDaysIn(runs, '2026-09-01', '2026-09-30')).toBe(3); // 25, 26, 27 (24 Sept: 4 h only)
    expect(absentDaysIn(runs, '2026-10-01', '2026-10-31')).toBe(0);
  });
});
