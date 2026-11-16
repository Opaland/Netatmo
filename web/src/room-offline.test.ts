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
  incompleteParts,
  lastReadingAfterStop,
  notComparable,
  offlineDaysIn,
  offlineRuns,
  offlineText,
  parseStopped,
  runIn,
  STOP_REASONS,
  type StopReason,
  stopShort,
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

  it('#580: a total is incomplete by the usage not measured (named) and the days of the others, never 366 for it', () => {
    // a lost from 11 to 15 March 2024 (5 days); the water heater without any reading in 2024
    const gaps = rs.filter((r) => !(r.room === 'a' && r.day >= '2024-03-11' && r.day <= '2024-03-15'));
    const cats = ['heating', 'water_heater'] as const;
    expect(incompleteParts(gaps, '2024-01-01', '2024-12-31', [...cats])).toEqual({ unmeasured: ['water_heater'], days: 5 });
    // 2023: the water heater measured until August, its days after count as missing (with a's none)
    expect(incompleteParts(gaps, '2023-01-01', '2023-12-31', [...cats])).toEqual({ unmeasured: [], days: 130 });
    expect(incompleteParts(rs, '2025-02-01', '2025-02-28', [...cats])).toEqual({ unmeasured: [], days: 0 });
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

// #621: the survivors of the first mutation of room-offline.ts (docs/bmad/06-qa-strategy.md § 7).
// Each case below was seen red on its mutant (npx stryker run --mutate src/room-offline.ts).
describe('#621: what a mutant of the estimate or of the runs would change', () => {
  // Two rooms offline, no weather (the usual other usages are a mean). b offline from D40, c from
  // D42 (c still reads on D40 and D41). Reference: [D40 − 365, D40[.
  const D = (i: number) => addDays('2025-01-01', i);
  const start = D(40);
  const refFrom = addDays(start, -365);
  const records: DayRecord[] = [];
  const linky = new Map<string, number>();
  for (let i = 0; i < 40; i++) {
    records.push(rec(D(i), 'a', 1), rec(D(i), 'b', 3), rec(D(i), 'c', 1));
    linky.set(D(i), 1 + 3 + 1 + 2); // other usages: 2
  }
  // the first day of the reference counts (weight of c: 40 + 40), the day before does not
  records.push(rec(refFrom, 'c', 40), rec(addDays(refFrom, -1), 'c', 1000));
  linky.set(refFrom, 40 + 43); // its other usages: 43, the mean of the 41 points becomes 3
  linky.set(addDays(refFrom, -1), 1000 + 500); // out of the reference: not a point
  // D40, D41: c still reads, b alone offline; D42-D44: both; D45: no room reads; D46: no Linky
  for (const i of [40, 41]) {
    records.push(rec(D(i), 'a', 1), rec(D(i), 'c', 1));
    linky.set(D(i), 2 + 3 + 3); // measured 2, other 3, gap 3
  }
  for (const i of [42, 43, 44, 46]) records.push(rec(D(i), 'a', 1));
  for (const i of [42, 43, 44]) linky.set(D(i), 1 + 3 + 4); // measured 1, other 3, gap 4
  linky.set(D(45), 50);
  // D47: after the runs, measured: not a reference point (only the days before the first run are)
  records.push(rec(D(47), 'a', 1));
  linky.set(D(47), 1 + 100);
  // listed with the later run first: the reference starts at the earliest run, not the first listed
  const runs = [
    { room: 'c', from: D(42), to: D(46), days: 5, ongoing: true },
    { room: 'b', from: D(40), to: D(46), days: 7, ongoing: true },
  ];

  it('two rooms offline the same day share the gap by their consumption of the reference year', () => {
    const est = estimateOffline(records, runs, linky, null);
    // 41 points: 40 days at 2, the first day of the reference at 43 → mean 3
    expect(est.baseline).toEqual({ a: 3, b: 0, days: 41 });
    expect([...est.days.keys()].sort()).toEqual(['b', 'c']);
    // weights: b 40 × 3 = 120, c 40 × 1 + 40 = 80 → 0.6 and 0.4 of a gap of 4
    expect([...est.days.get('c')!]).toEqual([
      [D(42), 1.6],
      [D(43), 1.6],
      [D(44), 1.6],
    ]);
    expect(est.days.get('b')!.get(D(40))).toBeCloseTo(3, 9); // alone that day: the whole gap
    expect(est.days.get('b')!.get(D(42))).toBeCloseTo(2.4, 9);
    expect(estimatedIn(est, 'b', D(40), D(46))).toBeCloseTo(3 + 3 + 3 * 2.4, 9);
    // the parts of a day add up to its gap
    expect(est.days.get('b')!.get(D(43))! + est.days.get('c')!.get(D(43))!).toBeCloseTo(4, 9);
    // a day without any room's reading (D45) or without Linky (D46) has no estimate
    expect(est.days.get('b')!.has(D(45))).toBe(false);
    expect(est.days.get('b')!.has(D(46))).toBe(false);
    // a window cuts the sum
    expect(estimatedIn(est, 'b', D(41), D(42))).toBeCloseTo(3 + 2.4, 9);
  });

  it('the order of the runs does not change the estimate', () => {
    const est = estimateOffline(records, runs, linky, null);
    const rev = estimateOffline(records, [...runs].reverse(), linky, null);
    expect(rev.baseline).toEqual(est.baseline);
    expect([...rev.days.get('c')!]).toEqual([...est.days.get('c')!]);
  });

  it('rooms without consumption in the reference share the gap equally', () => {
    const none = records.filter((r) => r.room === 'a');
    const est = estimateOffline(none, runs, linky, null);
    // without b and c, the reference points are Linky − a: 6 on 40 days (the first day of the
    // reference has no reading left: not a point); gap of D42: 8 − 1 − 6 = 1, half each
    expect(est.baseline).toEqual({ a: 6, b: 0, days: 40 });
    expect(est.days.get('b')!.get(D(42))).toBeCloseTo(0.5, 9);
    expect(est.days.get('c')!.get(D(42))).toBeCloseTo(0.5, 9);
  });

  it('a month of reference exactly is enough, a day less is not', () => {
    const month = records.filter((r) => r.day >= D(10)); // 30 reference days with Linky: D10-D39
    expect(estimateOffline(month, runs, linky, null).baseline?.days).toBe(30);
    expect(estimateOffline(records.filter((r) => r.day >= D(11)), runs, linky, null).baseline).toBeNull();
  });

  it('with the weather: a day without it is neither a reference point nor estimated', () => {
    const weather: Weather = new Map([...linky.keys()].map((d) => [d, [2, 8, 5]]));
    const all = estimateOffline(records, runs, linky, weather);
    weather.delete(D(5));
    weather.delete(D(43));
    const est = estimateOffline(records, runs, linky, weather);
    expect(est.baseline?.days).toBe(all.baseline!.days - 1);
    expect(est.days.get('b')!.has(D(43))).toBe(false);
    expect(est.days.get('b')!.has(D(42))).toBe(true);
  });

  it('the estimate in display ids is the same object without a map', () => {
    const est = estimateOffline(records, runs, linky, null);
    expect(displayEstimate(est)).toBe(est);
  });

  it('a run of exactly 2 days counts; two rooms only are enough; runs sorted by day, then room', () => {
    const two = [{ id: 'a', category: 'heating' }, { id: 'b', category: 'heating' }];
    const rs = [
      ...days('2026-01-01', 8).map((d) => rec(d, 'a')),
      ...days('2026-01-01', 8).filter((d) => d !== '2026-01-03' && d !== '2026-01-04').map((d) => rec(d, 'b')),
    ];
    expect(offlineRuns(rs, two, '2026-01-08')).toEqual([{ room: 'b', from: '2026-01-03', to: '2026-01-04', days: 2, ongoing: false }]);
    // records after `last` are not read; b and c offline from the same day come in room order
    const three = [...two, { id: 'c', category: 'heating' }];
    const later = [
      ...days('2026-01-01', 10).map((d) => rec(d, 'a')),
      ...days('2026-01-01', 10).filter((d) => d < '2026-01-05' || d > '2026-01-08').map((d) => rec(d, 'c')),
      ...days('2026-01-01', 10).filter((d) => d < '2026-01-03' || d > '2026-01-08').map((d) => rec(d, 'b')),
    ].reverse();
    expect(offlineRuns(later, three, '2026-01-08').map((r) => [r.room, r.from, r.to, r.ongoing])).toEqual([
      ['b', '2026-01-03', '2026-01-08', true],
      ['c', '2026-01-05', '2026-01-08', true],
    ]);
    const same = [
      ...days('2026-01-01', 6).map((d) => rec(d, 'a')),
      ...days('2026-01-01', 6).filter((d) => d < '2026-01-04').flatMap((d) => [rec(d, 'c'), rec(d, 'b')]),
    ];
    expect(offlineRuns(same, three, '2026-01-06').map((r) => r.room)).toEqual(['b', 'c']);
  });

  it('a room declared stopped on the last day of a run, or after 2 days exactly offline', () => {
    const run = { room: 'b', from: '2026-01-06', to: '2026-01-10', days: 5, ongoing: false };
    const st = (from: string) => [{ room: 'b', from, reason: 'poele' as const, label: '' }];
    // declared on the run's last day: 4 days offline, then 1 day stopped
    expect(applyStopped([run], st('2026-01-10')).map((r) => [r.from, r.to, r.days, !!r.stopped])).toEqual([
      ['2026-01-06', '2026-01-09', 4, false],
      ['2026-01-10', '2026-01-10', 1, true],
    ]);
    // declared on the third day: the 2 days before stay offline
    expect(applyStopped([run], st('2026-01-08')).map((r) => [r.from, r.to, r.days, !!r.stopped])).toEqual([
      ['2026-01-06', '2026-01-07', 2, false],
      ['2026-01-08', '2026-01-10', 3, true],
    ]);
  });

  it('days and run of one room in a window: its own runs only, cut at both ends, the latest run', () => {
    const runs = [
      { room: 'b', from: '2026-01-05', to: '2026-01-10', days: 6, ongoing: false },
      { room: 'b', from: '2026-01-20', to: '2026-01-25', days: 6, ongoing: false },
      { room: 'c', from: '2026-01-01', to: '2026-01-31', days: 31, ongoing: false },
    ];
    expect(offlineDaysIn(runs, 'b', '2026-01-10', '2026-01-20')).toBe(2); // the last day of one, the first of the other
    expect(offlineDaysIn(runs, 'b', '2026-01-07', '2026-01-22')).toBe(4 + 3);
    expect(offlineDaysIn(runs, 'b', '2026-01-01', '2026-01-31')).toBe(12);
    expect(runIn(runs, 'b', '2026-01-01', '2026-01-31')?.from).toBe('2026-01-20');
    expect(runIn(runs, 'b', '2026-01-10', '2026-01-10')?.from).toBe('2026-01-05');
    expect(runIn(runs, 'b', '2026-01-25', '2026-01-28')?.from).toBe('2026-01-20');
    expect(runIn(runs, 'b', '2026-01-11', '2026-01-19')).toBeNull();
  });

  it('the stopped list: a null entry skipped, a 64-character room kept, sorted by day then room, no label = ""', () => {
    const r64 = 'r'.repeat(64);
    expect(
      parseStopped([null, { room: 'z', from: '2026-01-02' }, { room: r64, from: '2026-01-02', reason: 'poele' }, { room: 'r'.repeat(65), from: '2026-01-01' }, { room: 'y', from: '2026-01-01' }]),
    ).toEqual([
      { room: 'y', from: '2026-01-01', reason: 'autre', label: '' },
      { room: r64, from: '2026-01-02', reason: 'poele', label: '' },
      { room: 'z', from: '2026-01-02', reason: 'autre', label: '' },
    ]);
  });

  it('« non mesuré » holds a reading on the first or the last day of the window', () => {
    const one = [rec('2026-01-10', 'a')];
    expect(unmeasuredIn(one, '2026-01-10', '2026-01-20')).toBe(false);
    expect(unmeasuredIn(one, '2026-01-01', '2026-01-10')).toBe(false);
    expect(unmeasuredIn(one, '2026-01-11', '2026-01-20')).toBe(true);
  });

  it('a room read since the first day of the data is not « added », whatever the order of the records', () => {
    // the data start on 1 March 2025; the window a year earlier starts before: a is missing, not added
    const rs = days('2025-03-01', 340).map((d) => rec(d, 'a')).reverse();
    expect([...unmeasuredReasons(rs, '2026-01-01', '2026-01-31', '2025-01-01', '2025-01-31')]).toEqual([['a', null]]);
    // b added on 10 March, records unsorted: « added on 10 March », its first day, not its last
    const rb = [...rs, ...days('2025-03-10', 331).map((d) => rec(d, 'b')).reverse()];
    expect(unmeasuredReasons(rb, '2026-01-01', '2026-01-31', '2025-03-01', '2025-03-31').get('b')).toBe('2025-03-10');
  });

  it('the stopped list refuses a room or a day that is not a text, and sorts by day then room', () => {
    expect(parseStopped([{ room: ['b'], from: '2026-01-01' }, { room: 'b', from: ['2026-01-01'] }])).toEqual([]);
    const list = parseStopped(['d', 'c', 'b', 'a'].flatMap((room, i) => [{ room, from: '2026-01-02' }, { room: `${room}${i}`, from: `2026-01-0${4 - i}` }]));
    expect(list.map((x) => `${x.from} ${x.room}`)).toEqual([
      '2026-01-01 a3',
      '2026-01-02 a',
      '2026-01-02 b',
      '2026-01-02 b2',
      '2026-01-02 c',
      '2026-01-02 d',
      '2026-01-03 c1',
      '2026-01-04 d0',
    ]);
    expect(stopShort({ reason: 'inconnue' as StopReason })).toBe('');
  });

  it('an ignored room is never offline; a room is followed from its earliest reading, whatever the order', () => {
    const rooms = [...ROOMS, { id: 'x', category: 'ignore' }];
    const rs = [
      ...days('2026-01-01', 8).map((d) => rec(d, 'a')),
      ...['2026-01-01', '2026-01-02'].map((d) => rec(d, 'x')), // would be offline 6 days if followed
      // b: reads on the 1st and 2nd, offline on the 3rd and 4th, reads the 5th and 6th, offline after
      ...['2026-01-01', '2026-01-02', '2026-01-05', '2026-01-06'].map((d) => rec(d, 'b')),
    ].reverse();
    expect(offlineRuns(rs, rooms, '2026-01-08').map((r) => [r.room, r.from, r.to])).toEqual([
      ['b', '2026-01-03', '2026-01-04'],
      ['b', '2026-01-07', '2026-01-08'],
    ]);
    // runs of several rooms come sorted by first day, then room (b, offline last, comes last)
    const many = [
      ...days('2026-01-01', 10).map((d) => rec(d, 'a')),
      ...days('2026-01-01', 10).filter((d) => d < '2026-01-03').map((d) => rec(d, 'c')),
      ...days('2026-01-01', 10).filter((d) => d < '2026-01-03').map((d) => rec(d, 'd')),
      ...days('2026-01-01', 10).filter((d) => d < '2026-01-07').map((d) => rec(d, 'b')),
    ];
    const four = [...ROOMS, { id: 'c', category: 'heating' }, { id: 'd', category: 'heating' }];
    expect(offlineRuns(many, four, '2026-01-10').map((r) => `${r.from} ${r.room}`)).toEqual(['2026-01-03 c', '2026-01-03 d', '2026-01-07 b']);
  });

  it('the run of a window: the latest one, even listed first; one starting on the last day of the window', () => {
    const runs = [
      { room: 'b', from: '2026-01-20', to: '2026-01-25', days: 6, ongoing: false },
      { room: 'b', from: '2026-01-05', to: '2026-01-10', days: 6, ongoing: false },
    ];
    expect(runIn(runs, 'b', '2026-01-01', '2026-01-31')?.from).toBe('2026-01-20');
    expect(runIn(runs, 'b', '2026-01-11', '2026-01-20')?.from).toBe('2026-01-20');
  });

  it('a run over two years names both years', () => {
    expect(offlineText({ from: '2025-12-28', to: '2026-01-03', ongoing: false })).toBe('hors ligne du 28 déc. 2025 au 3 janv. 2026');
  });

  it('the wood and the order of the records do not change the reference years of a verdict', () => {
    const rs = [
      ...days('2024-01-01', 700).map((d) => rec(d, 'a')),
      ...days('2025-01-01', 334).map((d) => rec(d, 'b')),
    ];
    const out = [...referenceUnmeasured(rs, '2025-11-01', '2025-11-30')];
    expect(out).toEqual([['b', '2025-01-01']]);
    expect([...referenceUnmeasured([...rs].reverse(), '2025-11-01', '2025-11-30')]).toEqual(out);
    expect([...referenceUnmeasured([rec('2021-11-15', WOOD_ROOM), ...rs], '2025-11-01', '2025-11-30')]).toEqual(out);
  });
});
