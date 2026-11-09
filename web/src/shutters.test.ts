import { beforeEach, describe, expect, it } from 'vitest';
import { addDays } from './aggregate';
import type { Hourly, Weather } from './analysis';
import { compareShutters, loadNotes, nightHours, nights, notesCsv, parseNotesCsv, saveNotes } from './shutters';

describe('shutters notes (S-9.6)', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  it('keeps sorted, unique, valid dates on the device', () => {
    expect(loadNotes()).toEqual([]);
    saveNotes(['2025-01-03', '2025-01-01', '2025-01-03', 'nope']);
    expect(loadNotes()).toEqual(['2025-01-01', '2025-01-03']);
  });

  it('exports and re-imports as CSV', () => {
    const csv = notesCsv(['2025-01-01', '2025-01-03']);
    expect(csv).toBe('date;volets_fermes\r\n2025-01-01;1\r\n2025-01-03;1\r\n');
    expect(parseNotesCsv(csv)).toEqual(['2025-01-01', '2025-01-03']);
    expect(parseNotesCsv('2025-02-01,0\n"2025-02-02";oui\n2025-02-03')).toEqual(['2025-02-02', '2025-02-03']);
  });

  it('night runs from 22 h to 7 h', () => {
    expect(nightHours('2025-01-31')).toEqual([
      '2025-01-31T22',
      '2025-01-31T23',
      '2025-02-01T00',
      '2025-02-01T01',
      '2025-02-01T02',
      '2025-02-01T03',
      '2025-02-01T04',
      '2025-02-01T05',
      '2025-02-01T06',
    ]);
  });
});

describe('shutters comparison', () => {
  // 61 nights, outdoor 0..12 °C; closed nights use `saving` less than the others.
  function build(closedEvery: number, saving: number) {
    const hourly: Hourly = new Map([['r', new Map()]]);
    const weather: Weather = new Map();
    const closed = new Set<string>();
    let d = '2025-01-01';
    for (let i = 0; i < 61; i++, d = addDays(d, 1)) {
      const t = (i * 7) % 13;
      const night = (t + (((i + 1) * 7) % 13)) / 2; // the night spans two days
      weather.set(d, [t - 2, t + 2, t]);
      const isClosed = i % closedEvery === 0;
      if (isClosed) closed.add(d);
      const noise = ((i * 37) % 11) / 100 - 0.05;
      const perHour = Math.max(0, (13 - night) / 13 + noise) * (isClosed ? 1 - saving : 1);
      for (const h of nightHours(d)) hourly.get('r')!.set(h, perHour);
    }
    return nights(hourly, ['r'], weather, closed, '2025-01-01', '2025-03-01');
  }

  it('needs enough notes', () => {
    expect(compareShutters(build(30, 0.1))).toBeNull();
  });

  it('measures a saving with its uncertainty', () => {
    const c = compareShutters(build(3, 0.15))!;
    expect(c.closed.length).toBeGreaterThanOrEqual(7);
    expect(c.gap).toBeLessThan(0);
    expect(c.gapPct!).toBeLessThan(-8);
    expect(c.gapPct!).toBeGreaterThan(-25);
    expect(c.ci95).toBeGreaterThan(0);
    expect(c.significant).toBe(true);
  });

  it('finds no significant gap without effect', () => {
    const c = compareShutters(build(3, 0))!;
    expect(c.significant).toBe(false);
  });

  it('skips nights without a complete hourly record', () => {
    const hourly: Hourly = new Map([['r', new Map([['2025-01-01T22', 1]])]]);
    const weather: Weather = new Map([
      ['2025-01-01', [0, 0, 0]],
      ['2025-01-02', [0, 0, 0]],
    ]);
    expect(nights(hourly, ['r'], weather, new Set(), '2025-01-01', '2025-01-02')).toEqual([]);
  });
});
