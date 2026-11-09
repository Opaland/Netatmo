import { describe, expect, it } from 'vitest';
import type { DayRecord } from './aggregate';
import type { Weather } from './analysis';
import {
  type RoomState,
  anomaliesWithWindows,
  bits,
  boostEnergy,
  coldWithWindow,
  confirmedAbsences,
  contactor,
  coverage,
  dailyOpen,
  lastStateDay,
  modeLabel,
  monthlyOpen,
  offloadDays,
  signatureEffect,
  totals,
  windowDays,
  absenceDays,
  bedroomGrouping,
  coldReasons,
  offloadByRoom,
  openByDay,
  peakVsOffload,
} from './windows';
import { BEDROOMS_ID } from './household';

const ALL = 0xffffff;
const rs: RoomState = {
  seen: { '2025-01-14': ALL, '2025-01-15': ALL ^ 0b11, '2025-01-16': 0b1111 },
  rooms: {
    salon: {
      '2025-01-14': { n: 24, open_window_h: 0, boost_h: 1, heating_h: 4, offload_h: 0 },
      '2025-01-15': { n: 22, open_window_h: 3.3, boost_h: 0, heating_h: 8, offload_h: 1.1, mode_h: { away: 12 } },
    },
    ch1: {
      '2025-01-15': { n: 22, open_window_h: 1.1, boost_h: 0, heating_h: 2, mode_h: { hg: 13 } },
      '2025-02-01': { n: 24, open_window_h: 2, boost_h: 0 },
    },
    ce: { '2025-01-15': { n: 22, contactor_h: { auto: 20, off: 4 } } },
  },
  values: { radiator_state: ['heating', 'idle'] },
};

describe('room states (E13)', () => {
  it('counts hours and coverage', () => {
    expect(bits(ALL)).toBe(24);
    expect(bits(0b1011)).toBe(3);
    expect(coverage(rs, '2025-01-14', '2025-01-16')).toEqual({ hours: 24 + 22 + 4, expected: 72, days: 3 });
    expect(lastStateDay(rs)).toBe('2025-01-16');
    expect(lastStateDay({})).toBeNull();
  });

  it('adds up per room, and merges bedrooms into one group', () => {
    const t = totals(rs, '2025-01-01', '2025-01-31');
    expect(t.get('salon')).toMatchObject({ days: 2, n: 46, open: 3.3, boost: 1, heating: 12, offload: 1.1, modes: { away: 12 } });
    const g = totals(rs, '2025-01-01', '2025-01-31', (r) => (r === 'ch1' || r === 'salon' ? 'beds' : r));
    expect(g.get('beds')!.open).toBeCloseTo(4.4);
    expect(g.has('salon')).toBe(false);
  });

  it('daily and monthly open-window hours', () => {
    const d = dailyOpen(rs, ['2025-01-14', '2025-01-15', '2025-01-16'], (r) => (r === 'ce' ? r : 'all'));
    expect(d.get('all')).toEqual([0, 4.4, null]);
    expect(d.has('ce')).toBe(false); // no window data for the water heater
    const m = monthlyOpen(rs);
    expect(m.get('ch1')!.get('2025-02')).toBe(2);
    expect(m.get('salon')!.get('2025-01')).toBeCloseTo(3.3);
  });

  it('days with a window open more than 2 h', () => {
    expect([...windowDays(rs)]).toEqual(['2025-01-15']);
    expect([...windowDays(rs, 1)].sort()).toEqual(['2025-01-15', '2025-02-01']);
  });

  it('cold rooms explained by an open window', () => {
    const temps = new Map([
      ['salon', new Map<string, [number, number | null]>([['2025-01-15', [18.2, 20]], ['2025-01-14', [18, 20]]])],
      ['ch1', new Map<string, [number, number | null]>([['2025-01-15', [19.5, 19]]])],
    ]);
    expect(coldWithWindow(temps, rs, '2025-01-01', '2025-01-31')).toEqual([{ day: '2025-01-15', room: 'salon', temp: 18.2, open: 3.3 }]);
  });

  it('boost energy: share of the heating hours spent in boost', () => {
    const records: DayRecord[] = [{ day: '2025-01-14', room: 'salon', cat: 'heating', kwh: 8 }];
    expect(boostEnergy(records, rs).get('salon')!.get('2025-01')).toEqual({ hours: 1, kwh: 2 });
  });

  it('absences confirmed by the setpoint mode in every radiator room', () => {
    expect(confirmedAbsences(rs)).toEqual([['2025-01-15', '2025-01-15']]);
    const two: RoomState = { rooms: { a: { '2025-03-01': { n: 24, boost_h: 0, mode_h: { away: 24 } }, '2025-03-02': { n: 24, boost_h: 0, mode_h: { away: 24 } } } } };
    expect(confirmedAbsences(two)).toEqual([['2025-03-01', '2025-03-02']]);
    expect(modeLabel('hg')).toBe('hors-gel');
    expect(modeLabel('eco_plus')).toBe('eco plus');
  });

  it('load shedding with the Linky peak, and the contactor mode', () => {
    expect(offloadDays(rs, new Map([['2025-01-15', 8.4]]), '2025-01-01', '2025-01-31')).toEqual([{ day: '2025-01-15', rooms: 1, hours: 1.1, pmax: 8.4 }]);
    expect(contactor(rs, '2025-01-01', '2025-01-31')).toEqual({ hours: { auto: 20, off: 4 }, last: '2025-01-15', lastMode: 'auto' });
  });

  it('signature with and without the window days', () => {
    // 30 heating days of January 2025: kWh = 30 − 1.5 × T; on window days (every 5th) +6 kWh.
    const records: DayRecord[] = [];
    const weather: Weather = new Map();
    const state: RoomState = { seen: {}, rooms: { salon: {} } };
    for (let i = 1; i <= 30; i++) {
      const day = `2025-01-${String(i).padStart(2, '0')}`;
      const t = (i % 10) - 2;
      const open = i % 5 === 0;
      weather.set(day, [t - 3, t + 3, t]);
      records.push({ day, room: 'salon', cat: 'heating', kwh: 30 - 1.5 * t + (open ? 6 : 0) });
      state.seen![day] = ALL;
      state.rooms!.salon[day] = { n: 24, open_window_h: open ? 3 : 0 };
    }
    const e = signatureEffect(records, weather, state)!;
    expect(e.season).toBe('2024-2025');
    expect(e.excluded).toBe(6);
    expect(e.without!.slope).toBeCloseTo(-1.5, 5);
    expect(e.without!.balance).toBeCloseTo(20, 5);
    expect(Math.abs(e.all.slope + 1.5)).toBeGreaterThan(0); // the window days bias the fit
    expect(anomaliesWithWindows(records, weather, state).every((a) => a.open >= 1)).toBe(true);
  });
});

describe('room states, v1.4 remainders (S-13.3, S-13.4, S-13.6)', () => {
  it('sums the open-window hours of all rooms per day', () => {
    expect(openByDay(rs).get('2025-01-15')).toBeCloseTo(4.4);
    expect(openByDay(rs).get('2025-01-14')).toBe(0);
  });

  it('lists the days confirmed by the setpoint mode', () => {
    expect([...absenceDays(rs)]).toEqual(['2025-01-15']);
  });

  it('groups the bedrooms unless shown, and follows the household view', () => {
    const rooms = [
      { id: 'salon', name: 'Salon' },
      { id: 'ch1', name: 'Chambre 1' },
    ];
    expect(bedroomGrouping(rooms, false)('ch1')).toBe(BEDROOMS_ID);
    expect(bedroomGrouping(rooms, true)('ch1')).toBe('ch1');
    const merged = [{ id: 'salon', name: 'Salon' }, { id: BEDROOMS_ID, name: 'Chambres' }];
    expect(bedroomGrouping(merged, true)('ch1')).toBe(BEDROOMS_ID);
    expect(bedroomGrouping(merged, true)('salon')).toBe('salon');
  });

  it('counts load shedding per room and compares the Linky peaks', () => {
    expect(offloadByRoom(rs, '2025-01-01', '2025-01-31').get('salon')).toEqual({ days: 1, hours: 1.1 });
    const pmax = new Map([
      ['2025-01-14', 6],
      ['2025-01-15', 9],
      ['2025-01-16', 7],
    ]);
    expect(peakVsOffload(rs, pmax, '2025-01-01', '2025-01-31')).toEqual({ withShed: 9, without: 6.5, nWith: 1, nWithout: 2 });
  });

  it('explains the cold days: window, absence mode, low setpoint, nothing, no snapshot', () => {
    const temps = new Map<string, Map<string, [number, number | null]>>([
      [
        'salon',
        new Map<string, [number, number | null]>([
          ['2025-01-14', [18, 20]], // snapshot, nothing special: unexplained
          ['2025-01-15', [17, 20]], // window 3.3 h
          ['2025-01-20', [18, 20]], // no snapshot that day
          ['2025-01-21', [20, 20]], // not cold
        ]),
      ],
      ['ch1', new Map<string, [number, number | null]>([['2025-01-15', [18.5, 18]], ['2025-01-16', [18.5, 18]]])],
    ]);
    const r = coldReasons(temps, rs, '2025-01-01', '2025-01-31');
    expect(r.get('salon')).toEqual({ cold: 3, window: 1, openHours: 3.3, away: 0, lowSetpoint: 0, unexplained: 1, noData: 1 });
    // ch1 on the 15th: window 1.1 h comes first; on the 16th: setpoint 18 °C
    expect(r.get('ch1')).toMatchObject({ cold: 2, window: 1, lowSetpoint: 1 });
    // household view: the temperatures are merged under BEDROOMS_ID, the states stay raw
    const merged = new Map([['salon', temps.get('salon')!], [BEDROOMS_ID, temps.get('ch1')!]]);
    const g = coldReasons(merged, rs, '2025-01-01', '2025-01-31', bedroomGrouping([{ id: 'salon', name: 'Salon' }, { id: BEDROOMS_ID, name: 'Chambres' }], true));
    expect(g.get(BEDROOMS_ID)).toMatchObject({ cold: 2, window: 1, lowSetpoint: 1 });
  });
});

