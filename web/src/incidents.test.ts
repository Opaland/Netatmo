import { describe, expect, it } from 'vitest';
import { byMonth, cutCauses, cutCausesOf, cutDays, hourRuns, incidents, monthSummary, simpleSentence } from './incidents';
import { cutText } from './periods';

const base = {
  devices: {
    modules: { i0: { type: 'NMH', room: 'r1' }, i1: { type: 'NMH', room: 'r2' }, i9: { type: 'NMG' }, m0: { type: 'NAMain' } },
    gateway: {
      // first boot: start before monitoring; then a restart at 14:07 after an hour cut off
      boots: ['2025-01-01T00:00', '2026-10-14T14:07', '2026-11-02T03:40'],
      offline: ['2026-10-14T13', '2026-11-05T19', '2026-11-05T20', '2026-11-05T21'],
    },
    reach: {
      i0: { '2026-11-01': 1, '2026-11-02': 0, '2026-11-03': 0, '2026-11-04': 1 },
      i1: { '2026-11-06': 1, '2026-11-07': 0, '2026-11-08': 0 }, // stopped on purpose from 2026-11-07
      i9: { '2026-11-03': 0 },
    },
    failures: { '2026-11-04': ['linky', 'netatmo'] },
  },
  health: { m1: { '2026-11-06': [16, 70, 1], '2026-11-07': [14, 70, 0], '2026-11-08': [13, 70, 1] } as Record<string, [number | null, number | null, number]> },
  stationModules: { m1: { name: 'Extérieur', type: 'NAModule1' } },
  rooms: [
    { id: 'r1', name: 'Salon' },
    { id: 'r2', name: 'Cuisine' },
  ],
  stopped: [{ room: 'r2', from: '2026-11-07' }],
  sourceName: { linky: 'Linky', netatmo: 'station Netatmo' },
  last: '2026-11-08',
};

describe('incident log (#280)', () => {
  it('groups consecutive hours', () => {
    expect(hourRuns(['2026-11-05T21', '2026-11-05T19', '2026-11-05T20', '2026-11-06T00', '2026-11-05T23'])).toEqual([
      ['2026-11-05T19', '2026-11-05T21'],
      ['2026-11-05T23', '2026-11-06T00'],
    ]);
  });
  it('tells a power cut (restart of the gateway) from an Internet cut (no restart)', () => {
    const list = incidents(base);
    const power = list.filter((e) => e.kind === 'power');
    expect(power.map((e) => [e.at, e.hours])).toEqual([
      ['2026-11-02T03:40', null], // restart alone: shorter than the hour between two readings
      ['2026-10-14T13:00', 1],
    ]);
    const net = list.filter((e) => e.kind === 'internet');
    expect(net.map((e) => [e.at, e.hours])).toEqual([['2026-11-05T19:00', 3]]);
    expect(cutDays(list, 'internet')).toEqual(['2026-11-05']);
  });
  it('dates the silent modules with their duration, leaves out a room stopped on purpose and the gateway', () => {
    const list = incidents(base);
    const mods = list.filter((e) => e.kind === 'module');
    expect(mods).toEqual([expect.objectContaining({ day: '2026-11-02', to: '2026-11-03', days: 2, label: 'Radiateur Salon injoignable', ongoing: false })]);
    const st = list.filter((e) => e.kind === 'station');
    expect(st).toEqual([expect.objectContaining({ day: '2026-11-07', days: 1, label: 'Module « Extérieur » de la station muet' })]);
    const bat = list.filter((e) => e.kind === 'battery');
    expect(bat).toEqual([expect.objectContaining({ day: '2026-11-07', days: 2, ongoing: true, label: 'Pile faible : module « Extérieur » (13 %)' })]);
    expect(list.find((e) => e.kind === 'collect')?.label).toBe('Collecte en échec : Linky, station Netatmo');
  });
  it('sums a month and says it in one sentence', () => {
    const months = byMonth(incidents(base));
    expect(months.map((m) => m.month)).toEqual(['2026-11', '2026-10']);
    const nov = months[0];
    expect([nov.power, nov.internetHours, nov.moduleDays, nov.failures]).toEqual([1, 3, 3, 1]);
    expect(monthSummary(nov)).toBe('1 coupure de courant, 3 h sans Internet, 3 jours avec un module muet, 1 collecte en échec, 1 pile faible');
    expect(simpleSentence(months, '2026-11-08')).toBe('1 coupure de courant, 3 h sans Internet, 3 jours avec un module muet, 1 collecte en échec, 1 pile faible ce mois-ci.');
    expect(simpleSentence(months, '2026-12-01')).toBe('Aucun incident ce mois-ci.');
  });
  it('works with a single source and with nothing', () => {
    expect(incidents({ devices: { gateway: { boots: ['2026-01-01T00:00', '2026-11-02T03:40'] } }, last: '2026-11-08' })).toHaveLength(1);
    expect(incidents({ last: '2026-11-08' })).toEqual([]);
    expect(byMonth([])).toEqual([]);
  });
});

describe('#394: days touched by a cut', () => {
  it('dates each cut day with its cause, a power cut winning the same day, a cut past midnight on both days', () => {
    const causes = cutCausesOf({
      gateway: {
        boots: ['2025-01-01T00:00', '2026-10-14T14:07', '2026-11-02T03:40', '2026-11-08T01:10'],
        offline: ['2026-10-14T13', '2026-11-02T01', '2026-11-05T23', '2026-11-06T00', '2026-11-06T01', '2026-11-07T22', '2026-11-07T23', '2026-11-08T00'],
      },
    });
    expect([...causes].sort()).toEqual([
      ['2026-10-14', 'power'],
      ['2026-11-02', 'power'], // Internet at 1 h, then a restart alone at 3:40: power wins
      ['2026-11-05', 'internet'],
      ['2026-11-06', 'internet'],
      ['2026-11-07', 'power'], // 22 h → restart at 1:10: both days
      ['2026-11-08', 'power'],
    ]);
    expect(cutCauses([])).toEqual(new Map());
    expect(cutCausesOf(base.devices)).toEqual(new Map([['2026-10-14', 'power'], ['2026-11-02', 'power'], ['2026-11-05', 'internet']])); // modules ignored
    expect(cutCausesOf(null)).toEqual(new Map());
  });
  it('says the cut days of a period', () => {
    const causes = new Map([
      ['2026-10-14', 'power' as const],
      ['2026-11-05', 'internet' as const],
    ]);
    expect(cutText([], causes)).toBe('');
    expect(cutText(['2026-10-14'], causes)).toBe('1 jour de coupure de courant');
    expect(cutText(['2026-11-05'], causes)).toBe('1 jour de coupure Internet');
    expect(cutText(['2026-10-14', '2026-11-05'], causes)).toBe('2 jours de coupure (courant, Internet)');
  });
});
