import { describe, expect, it } from 'vitest';
import {
  type DevicesDoc,
  contractMismatch,
  fillTempo,
  firmwareLog,
  firmwareSummary,
  indexCheck,
  intuisOffer,
  offlineModules,
  peakHours,
  restarts,
  roomStateHours,
  stationHealth,
  tempoCode,
  wifiSummary,
} from './devices';
import { plugsFrom } from './breakdown';

const doc: DevicesDoc = {
  modules: { i1: { type: 'NMH', room: 'r1', fw: '106', setup: '2021-11-15' }, i2: { type: 'NMH', room: 'r2', fw: '106' }, i0: { type: 'NMG' } },
  reach: { i1: { '2025-01-10': 1, '2025-01-11': 0, '2025-01-12': 0 }, i2: { '2025-01-10': 0, '2025-01-11': 1, '2025-01-12': 1 } },
  firmware: { i1: [['2025-01-11', '105', '106']], i2: [['2025-01-11', '105', '106']], i0: [['2024-12-01', '300', '318']] },
  gateway: { boots: ['2024-10-01T00:00', '2025-01-05T14:07', '2024-12-20T03:12'], wifi: { '2025-01-10': [50, 55, 60, 24], '2025-01-11': [40, 45, 70, 24] } },
  tempo: {},
};

describe('modules not answering (#214)', () => {
  it('lists the modules silent on the last night with the start of the run', () => {
    expect(offlineModules(doc)).toEqual([{ key: 'i1', type: 'NMH', room: 'r1', since: '2025-01-11' }]);
    expect(offlineModules(null)).toEqual([]);
  });
  it('sums offline, anticipation and lowering hours per room (#218)', () => {
    const rooms = {
      r1: {
        '2025-01-10': { n: 24, anticipating_h: 1, lowering_h: 7, offline_h: 0 },
        '2025-01-11': { n: 24, anticipating_h: 2, lowering_h: 7, offline_h: 5 },
        '2024-01-01': { n: 2 },
      },
    };
    expect(roomStateHours(rooms, '2025-01-01', '2025-01-31')).toEqual([{ room: 'r1', days: 2, anticipating: 3, lowering: 14, offline: 5, offlineDays: ['2025-01-11'] }]);
  });
});

describe('firmware and gateway (#216, #276)', () => {
  it('groups the same update of several radiators', () => {
    const log = firmwareLog(doc);
    expect(log[0].day).toBe('2025-01-11');
    expect(firmwareSummary(log)).toEqual([
      { day: '2025-01-11', type: 'NMH', from: '105', to: '106', n: 2 },
      { day: '2024-12-01', type: 'NMG', from: '300', to: '318', n: 1 },
    ]);
  });
  it('restarts exclude the start before monitoring; Wi-Fi weighted mean', () => {
    expect(restarts(doc)).toEqual(['2025-01-05T14:07', '2024-12-20T03:12']);
    expect(restarts(doc, '2025-01-01')).toEqual(['2025-01-05T14:07']);
    expect(wifiSummary(doc, '2025-01-01', '2025-01-31')).toEqual({ days: 2, min: 40, mean: 50, max: 70 });
    expect(wifiSummary(doc, '2026-01-01', '2026-01-31')).toBeNull();
  });
});

describe('station batteries (#215)', () => {
  it('flags a low battery and a weak signal', () => {
    const rows = stationHealth({ m0: { '2025-01-10': [null, 90, 1] }, m1: { '2025-01-09': [20, 70, 1], '2025-01-10': [12, 92, 0] } });
    expect(rows.map((r) => [r.key, r.low, r.weakSignal, r.answering])).toEqual([
      ['m0', false, true, true],
      ['m1', true, true, false],
    ]);
    expect(rows[1].trend).toEqual([20, 12]);
  });
});

describe('Tempo colour of the gateway (#278)', () => {
  it('maps the names, fills missing days only when the two sources agree', () => {
    expect([tempoCode('blue'), tempoCode('BLANC'), tempoCode('red'), tempoCode(2), tempoCode('autre')]).toEqual([1, 2, 3, 2, null]);
    const days = new Map<string, number>();
    const gw: Record<string, string> = {};
    for (let i = 10; i <= 19; i++) {
      days.set(`2025-01-${i}`, 1);
      gw[`2025-01-${i}`] = i === 19 ? 'red' : 'blue';
    }
    gw['2025-01-20'] = 'white';
    gw['2025-01-21'] = 'red';
    const chk = fillTempo(days, gw, '2025-01-20');
    expect(chk).toMatchObject({ overlap: 10, agree: 9, mismatch: ['2025-01-19'], filled: ['2025-01-20'], trusted: true });
    expect(days.get('2025-01-20')).toBe(2);
    expect(days.has('2025-01-21')).toBe(false); // after the archive's last day
    const fresh = new Map([['2025-01-01', 1]]);
    expect(fillTempo(fresh, { '2025-01-01': '3', '2025-01-02': '3' }, '2025-12-31').filled).toEqual([]); // not trusted
  });
});

describe('contract seen by Intuis (#278)', () => {
  it('maps the option and reports what differs', () => {
    expect(intuisOffer({ tariff_option: 'peak_and_off_peak' })).toBe('edf-trv-hphc');
    expect(intuisOffer({ tariff_option: 'base' })).toBe('edf-trv-base');
    expect(intuisOffer({ tariff: 'edf_tempo' })).toBe('tempo');
    expect(intuisOffer({ tariff: 'x' })).toBeNull();
    const current = { from: '2023-10-01', offer: 'edf-trv-hphc', kva: 12 };
    expect(contractMismatch({ tariff_option: 'base', kva: 9 }, current)).toEqual(['option', 'puissance']);
    expect(contractMismatch({ tariff_option: 'peak', kva: 12 }, current)).toEqual([]);
    expect(contractMismatch(null, current)).toEqual([]);
  });
});

describe('Linky peak time and index (#219, #277)', () => {
  it('counts the daily peaks per hour', () => {
    const pmax = new Map([
      ['2025-01-01', 6],
      ['2025-01-02', 7],
      ['2025-01-03', 5],
    ]);
    const at = new Map([
      ['2025-01-01', '19:10'],
      ['2025-01-02', '19:55'],
      ['2025-01-03', '07:00'],
    ]);
    expect(peakHours(pmax, at, '2025-01-01', '2025-01-31')).toEqual([
      { hour: 7, n: 1 },
      { hour: 19, n: 2 },
    ]);
  });
  it('index deltas of one calendar vs the daily total, 2 % tolerance', () => {
    const index = {
      'distributeur.hph': { '2025-01-01': 1_000_000, '2025-01-02': 1_006_000, '2025-01-03': 1_012_000 },
      'distributeur.hch': { '2025-01-01': 500_000, '2025-01-02': 504_000, '2025-01-03': 509_000 },
    };
    const daily = new Map([
      ['2025-01-01', 10],
      ['2025-01-02', 10],
    ]);
    expect(indexCheck(index, daily)).toEqual({ days: 2, off: [{ day: '2025-01-02', index: 11, daily: 10 }] });
  });
});

describe('Shelly channels (#279)', () => {
  it('a clamp meter counts by channel; main supply and water heater stay out of the breakdown', () => {
    const shelly = {
      plugs: {
        p0: { name: 'Frigo' },
        p1: { name: 'Pinces', channels: 2 },
        p1c0: { name: 'Pinces · canal 1', parent: 'p1' },
        p1c1: { name: 'Pinces · canal 2', parent: 'p1' },
      },
      daily: { p0: { '2025-01-01': 1000 }, p1: { '2025-01-01': 9999 }, p1c0: { '2025-01-01': 3000 }, p1c1: { '2025-01-01': 2000 } },
    };
    const { plugs } = plugsFrom(shelly, { names: { p1c1: 'Four' }, roles: { p1c0: 'water' } });
    expect(plugs.map((p) => [p.key, p.name])).toEqual([
      ['p0', 'Frigo'],
      ['p1c1', 'Four'],
    ]);
  });
});
