// #346: rooms without reading (« hors ligne »), their estimate from the meter, and the rooms left
// out of a comparison with last year. Small cases, then the demo (the kitchen offline since
// 14 October 2025, collector/demo.py OFFLINE_ROOM).
import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import { WOOD_ROOM } from './wood';
import type { Weather } from './analysis';
import { demoDataset } from './__fixtures__/demo';
import {
  applyStopped,
  displayEstimate,
  displayRuns,
  estimateOffline,
  estimatedIn,
  lastReadingAfterStop,
  notComparable,
  offlineDaysIn,
  offlineRuns,
  offlineText,
  parseStopped,
  runIn,
  STOP_REASONS,
  type StopReason,
  stoppedJson,
  stoppedOn,
  referenceUnmeasured,
  unmeasuredIn,
  unmeasuredPhrase,
  unmeasuredReasons,
  unmeasuredRooms,
} from './room-offline';

const rec = (day: string, room: string, kwh = 1): DayRecord => ({ day, room, kwh, cat: room === 'ce' ? 'water_heater' : 'heating' });
const ROOMS = [
  { id: 'a', category: 'heating' },
  { id: 'b', category: 'heating' },
  { id: 'ce', category: 'water_heater' },
];
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

describe('offline runs', () => {
  it('2 days without reading while the others read make a run; 1 day does not', () => {
    const rs = [...days('2026-01-01', 10).flatMap((d) => [rec(d, 'a'), rec(d, 'ce')]), ...days('2026-01-01', 10).filter((d) => d !== '2026-01-03' && d < '2026-01-06').map((d) => rec(d, 'b'))];
    const runs = offlineRuns(rs, ROOMS, '2026-01-10');
    expect(runs).toEqual([{ room: 'b', from: '2026-01-06', to: '2026-01-10', days: 5, ongoing: true }]);
    expect(offlineText(runs[0])).toBe('hors ligne depuis le 6 janv. 2026');
  });

  it('a run that ended, days lost for every room skipped, a room followed from its first reading', () => {
    const all = days('2026-01-01', 20).filter((d) => d < '2026-01-12' || d > '2026-01-13'); // 12-13 lost for everyone
    const rs = [
      ...all.map((d) => rec(d, 'a')),
      ...all.filter((d) => d < '2026-01-10' || d > '2026-01-15').map((d) => rec(d, 'b')),
      ...all.filter((d) => d >= '2026-01-05').map((d) => rec(d, 'ce')), // installed on the 5th
    ];
    const runs = offlineRuns(rs, ROOMS, '2026-01-20');
    expect(runs).toEqual([{ room: 'b', from: '2026-01-10', to: '2026-01-15', days: 4, ongoing: false }]);
    expect(offlineText(runs[0])).toBe('hors ligne du 10 janv. au 15 janv. 2026');
    expect(offlineDaysIn(runs, 'b', '2026-01-14', '2026-01-31')).toBe(2);
    expect(runIn(runs, 'b', '2026-01-01', '2026-01-09')).toBeNull();
    expect(runIn(runs, 'b', '2026-01-15', '2026-01-31')?.from).toBe('2026-01-10');
  });

  it('ignored rooms and a single room give nothing', () => {
    expect(offlineRuns([rec('2026-01-01', 'a')], ROOMS, '2026-01-10')).toEqual([]);
    expect(offlineRuns([rec('2026-01-01', 'a'), rec('2026-01-05', 'x')], [...ROOMS, { id: 'x', category: 'ignore' }], '2026-01-10')).toEqual([]);
  });

  it('household view: the run carries the group id', () => {
    const runs = [{ room: 'b', from: '2026-01-06', to: '2026-01-10', days: 5, ongoing: true }];
    expect(displayRuns(runs, new Map([['b', 'chambres']]))[0].room).toBe('chambres');
    expect(displayRuns(runs)).toBe(runs);
  });

  it('a room offline in either window is left out of the comparison with last year', () => {
    const runs = [{ room: 'b', from: '2025-01-06', to: '2025-01-10', days: 5, ongoing: false }];
    expect([...notComparable(runs, '2026-01-01', '2026-01-31')]).toEqual(['b']);
    expect([...notComparable(runs, '2025-01-01', '2025-01-31')]).toEqual(['b']);
    expect([...notComparable(runs, '2026-02-01', '2026-02-28')]).toEqual([]);
  });
});

// #570: the shape of a real account's gaps (fictitious days): the water heater without any reading
// for all of 2024, a radiator added in October 2025, a room switched off on purpose since June 2025
describe('rooms measured on one side of a comparison only (#570)', () => {
  const rs = [
    ...days('2023-01-01', 1096).flatMap((d) => [
      rec(d, 'a'),
      ...(d < '2023-08-24' || d > '2025-01-11' ? [rec(d, 'ce')] : []),
      ...(d >= '2025-10-20' ? [rec(d, 'b')] : []),
      ...(d < '2025-06-16' ? [rec(d, 'k')] : []),
      ...(d.endsWith('-15') ? [rec(d, WOOD_ROOM)] : []),
    ]),
  ];
  const keep = new Set(['k']);
  it('the water heater missing all year is out of 2025 vs 2024 and 2024 vs 2023; the room added says since when', () => {
    expect([...unmeasuredReasons(rs, '2025-01-01', '2025-12-31', '2024-01-01', '2024-12-31', keep)].sort()).toEqual([
      ['b', '2025-10-20'],
      ['ce', null],
    ]);
    expect([...unmeasuredRooms(rs, '2024-01-01', '2024-12-31', '2023-01-01', '2023-12-31', keep)]).toEqual(['ce']);
  });
  it('a room added during the earlier window is out too (not counted all along), not once it is there on both', () => {
    expect([...unmeasuredReasons(rs, '2025-11-01', '2025-11-30', '2025-10-01', '2025-10-31', keep)]).toEqual([['b', '2025-10-20']]);
    expect([...unmeasuredRooms(rs, '2025-12-01', '2025-12-31', '2025-11-01', '2025-11-30', keep)]).toEqual([]);
  });
  it('a room read from the first day of the data is never « added », even when the window starts before', () => {
    expect([...unmeasuredRooms(rs, '2024-01-01', '2024-06-30', '2022-12-15', '2023-06-30', keep)]).toEqual(['ce']);
  });
  it('a room switched off on purpose and the wood stay: their fall is a change of heating', () => {
    expect(unmeasuredRooms(rs, '2025-08-01', '2025-08-31', '2024-08-01', '2024-08-31', keep).has('k')).toBe(false);
    expect(unmeasuredRooms(rs, '2025-08-01', '2025-08-31', '2024-08-01', '2024-08-31').has('k')).toBe(true);
    expect(unmeasuredRooms(rs, '2025-08-01', '2025-08-14', '2024-08-15', '2024-08-31').has(WOOD_ROOM)).toBe(false);
  });
  it('the verdict leaves out the rooms of any reference year, not the year; one sentence names them', () => {
    const out = referenceUnmeasured(rs, '2025-11-01', '2025-11-30', keep);
    expect([...out].sort()).toEqual([
      ['b', '2025-10-20'],
      ['ce', null],
    ]);
    const name = (id: string) => ({ b: 'Bureau', ce: 'Chauffe-eau' })[id] ?? id;
    expect(unmeasuredPhrase(out, name)).toBe('hors Bureau (ajouté le 20 oct. 2025) et Chauffe-eau (sans relevé sur l’une des périodes comparées)');
    expect(unmeasuredPhrase(new Map(), name)).toBe('');
  });
  it('« non mesuré » is one definition: records exist, none in the window', () => {
    expect(unmeasuredIn(rs.filter((r) => r.room === 'ce'), '2024-01-01', '2024-12-31')).toBe(true);
    expect(unmeasuredIn(rs.filter((r) => r.room === 'ce'), '2025-01-01', '2025-12-31')).toBe(false);
    expect(unmeasuredIn([], '2024-01-01', '2024-12-31')).toBe(false);
  });
});

describe('estimate from the meter', () => {
  // 60 reference days, then 10 days with b offline: Linky = a + b + ce + other (2 + 0.5 × DJU)
  const ref = days('2025-11-01', 60);
  const off = days('2025-12-31', 10);
  const weather: Weather = new Map([...ref, ...off].map((d, i) => [d, [4 + (i % 7), 8 + (i % 7), 6 + (i % 7)]]));
  const djuOf = (d: string) => 18 - (weather.get(d)![0] + weather.get(d)![1]) / 2;
  const records: DayRecord[] = [];
  const linky = new Map<string, number>();
  for (const d of [...ref, ...off]) {
    const a = 0.5 * djuOf(d);
    const b = 0.25 * djuOf(d);
    records.push(rec(d, 'a', a), rec(d, 'ce', 3));
    if (ref.includes(d)) records.push(rec(d, 'b', b));
    linky.set(d, a + b + 3 + 2 + 0.5 * djuOf(d));
  }
  const runs = offlineRuns(records, ROOMS, off.at(-1)!);

  it('Linky − measured rooms − the usual other usages, fitted on the degree days', () => {
    expect(runs).toHaveLength(1);
    const est = estimateOffline(records, runs, linky, weather);
    expect(est.baseline?.a).toBeCloseTo(2, 6);
    expect(est.baseline?.b).toBeCloseTo(0.5, 6);
    const truth = off.reduce((s, d) => s + 0.25 * djuOf(d), 0);
    expect(estimatedIn(est, 'b', off[0], off.at(-1)!)).toBeCloseTo(truth, 6);
    expect(estimatedIn(est, 'a', off[0], off.at(-1)!)).toBeNull();
    expect(estimatedIn(displayEstimate(est, new Map([['b', 'g']])), 'g', off[0], off.at(-1)!)).toBeCloseTo(truth, 6);
  });

  it('nothing without the meter or without a month of reference', () => {
    expect(estimateOffline(records, runs, new Map(), weather).days.size).toBe(0);
    const short = records.filter((r) => r.day >= '2025-12-15');
    expect(estimateOffline(short, offlineRuns(short, ROOMS, off.at(-1)!), linky, weather).baseline).toBeNull();
  });

  it('never negative: a meter below the usual other usages gives 0', () => {
    const low = new Map([...linky].map(([d, v]) => [d, off.includes(d) ? v - 50 : v]));
    const est = estimateOffline(records, runs, low, weather);
    expect(estimatedIn(est, 'b', off[0], off.at(-1)!)).toBe(0);
  });
});

describe('radiators switched off on purpose (⚙ Mon logement)', () => {
  const run = { room: 'b', from: '2026-01-06', to: '2026-01-31', days: 26, ongoing: true };
  const stove = { room: 'b', from: '2026-01-10', reason: 'poele' as const, label: 'chauffée par un poêle' };

  it('the list is cleaned: bad dates dropped, unknown reason → « autre », one entry per room, label cut', () => {
    expect(parseStopped('x')).toEqual([]);
    const list = parseStopped([
      { room: 'b', from: '2026-01-10', reason: 'poele', label: 'x'.repeat(80) },
      { room: 'c', from: '10/01/2026' },
      { room: 'a', from: '2025-12-01', reason: 'n/a' },
      { room: 'b', from: '2026-01-11', reason: 'poele', label: 'second' },
    ]);
    expect(list.map((x) => [x.room, x.from, x.reason])).toEqual([
      ['a', '2025-12-01', 'autre'],
      ['b', '2026-01-11', 'poele'],
    ]);
    expect(parseStopped([{ room: 'b', from: '2026-01-10', label: 'y'.repeat(80) }])[0].label).toHaveLength(60);
    expect(JSON.parse(stoppedJson(list))).toHaveLength(2);
  });

  it('from the declared day the run is « arrêté (poêle) »; the days before stay « hors ligne » when 2 or more', () => {
    const out = applyStopped([run], [stove]);
    expect(out).toEqual([
      { ...run, to: '2026-01-09', days: 4, ongoing: false },
      { ...run, from: '2026-01-10', days: 22, stopped: stove },
    ]);
    expect(offlineText(out[1])).toBe('arrêté depuis le 10 janv. 2026 (poêle)');
    expect(applyStopped([run], [{ ...stove, from: '2026-01-07' }])).toHaveLength(1); // 1 day before: not a run
    expect(applyStopped([run], [{ ...stove, room: 'z' }])).toEqual([run]);
    // #461: from the day declared, even on a run that was not cut (the declared day prevails)
    expect(offlineText({ ...run, stopped: { ...stove, reason: 'autre' } })).toBe('arrêté depuis le 10 janv. 2026');
  });

  it('#461: « arrêté depuis » the day declared, not the last reading; the last reading said in complement', () => {
    // radiators taken down on 1 July 2025; the room still sent readings until 9 October
    const gone = { room: 'k', from: '2025-07-01', reason: 'retires' as const, label: '' };
    const silent = { room: 'k', from: '2025-10-10', to: '2026-01-31', days: 114, ongoing: true };
    const [out] = applyStopped([silent], [gone]);
    expect(out.stopped).toBe(gone);
    expect(offlineText(out)).toBe('arrêté depuis le 1er juil. 2025 (radiateurs retirés)');
    expect(offlineText({ ...out, ongoing: false, to: '2025-12-31' })).toBe('arrêté du 1er juil. au 31 déc. 2025 (radiateurs retirés)');
    expect(lastReadingAfterStop(out)).toBe('2025-10-09');
    // silent since the day declared (or before it, cut by applyStopped): nothing to add
    expect(lastReadingAfterStop(applyStopped([{ ...silent, from: '2025-06-20' }], [gone]).at(-1)!)).toBeNull();
    expect(lastReadingAfterStop(silent)).toBeNull();
    expect(offlineText(silent)).toBe('hors ligne depuis le 10 oct. 2025');
  });

  it('#440: « radiateurs retirés » is a reason of its own, kept by the reader, said in the text', () => {
    const gone = { ...stove, reason: 'retires' as const, label: '' };
    expect(parseStopped([{ room: 'b', from: '2026-01-10', reason: 'retires' }])[0].reason).toBe('retires');
    expect(STOP_REASONS.retires).toBe('Radiateurs retirés (chauffée autrement)');
    expect(offlineText(applyStopped([run], [gone])[1])).toBe('arrêté depuis le 10 janv. 2026 (radiateurs retirés)');
  });

  it('#440: one rule for every module alert: quiet from the declared day on, whatever the reason', () => {
    for (const reason of Object.keys(STOP_REASONS) as StopReason[]) {
      const s = { ...stove, reason };
      expect(stoppedOn([s], 'b', '2026-01-10')).toBe(s);
      expect(stoppedOn([s], 'b', '2026-02-01')).toBe(s);
      expect(stoppedOn([s], 'b', '2026-01-09')).toBeUndefined();
      expect(stoppedOn([s], 'a', '2026-01-10')).toBeUndefined();
    }
    expect(stoppedOn([stove], undefined, '2026-01-10')).toBeUndefined();
    expect(stoppedOn(undefined, 'b', '2026-01-10')).toBeUndefined();
  });

  it('no estimate and still compared: its fall is a change of heating', () => {
    const runs = applyStopped([run], [{ ...stove, from: run.from }]);
    expect([...notComparable(runs, '2026-01-01', '2026-01-31')]).toEqual([]);
    const linky = new Map([['2026-01-20', 30]]);
    expect(estimateOffline([rec('2026-01-20', 'a', 5)], runs, linky, null).days.size).toBe(0);
  });
});

describe('on the demo: the kitchen stove and the kids’ bedroom offline', () => {
  it('the kitchen is « arrêté (poêle) », the bedroom « hors ligne » and estimated from the meter', async () => {
    const ds = await demoDataset();
    const last = ds.meta.last_day!;
    const stopped = parseStopped((ds.meta as { stopped_rooms?: unknown }).stopped_rooms);
    expect(stopped).toEqual([{ room: 'r-cuisine', from: '2025-10-14', reason: 'poele', label: 'chauffée par un poêle à bois' }]);
    const runs = applyStopped(offlineRuns(ds.records, ds.meta.rooms, last), stopped);
    const kitchen = runs.filter((r) => r.room === 'r-cuisine').at(-1)!;
    expect(offlineText(kitchen)).toBe('arrêté depuis le 14 oct. 2025 (poêle)');
    const bedroom = runs.filter((r) => r.room === 'r-ch2').at(-1)!;
    expect(bedroom).toMatchObject({ from: '2026-11-05', to: last, ongoing: true, days: 4 });
    expect(bedroom.stopped).toBeUndefined();
    expect(offlineText(bedroom)).toBe('hors ligne depuis le 5 nov. 2026');
    // the November 2024 gap of the demo (two rooms, 14 days) is found as well, over
    expect(runs.some((r) => r.room === 'r-salon' && r.from === '2024-11-04' && !r.ongoing && !r.stopped)).toBe(true);
    const est = estimateOffline(ds.records, runs, ds.linky, ds.weather);
    expect(estimatedIn(est, 'r-cuisine', '2025-10-14', last)).toBeNull();
    const nov = estimatedIn(est, 'r-ch2', '2026-11-05', last)!;
    // the bedroom used about 2-4 kWh a day in early November; on its last setting, a little more
    expect(nov).toBeGreaterThan(4);
    expect(nov).toBeLessThan(40);
  });
});
