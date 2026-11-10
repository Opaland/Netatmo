import { beforeEach, describe, expect, it } from 'vitest';
import { addDays } from './aggregate';
import type { Hourly, Weather } from './analysis';
import { type VoletsDoc, compareShutters, evenings, lastReceived, loadNotes, nightHours, nights, notesCsv, parseNotesCsv, recentFailures, saveNotes, shutterNames, summarize } from './shutters';

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

describe('relevé automatique des volets (#200)', () => {
  const doc: VoletsDoc = {
    received: '2026-01-10',
    shutters: { v0: { name: 'Salon' }, v1: { name: '' } },
    days: {
      '2026-01-07': { evening: [2, 2], shutters: { v0: { close: '17:50', at22: 0, mean: 40 }, v1: { close: '21:00', at22: 0, mean: 50 } } },
      '2026-01-08': { evening: [1, 2], shutters: { v0: { close: '18:10', at22: 0, mean: 60 }, v1: { at22: 100, mean: 80 } } },
      '2026-01-09': { err: ['hub_injoignable', 'inconnu'], shutters: { v0: { close: '18:00', at22: null, mean: 50 } } }, // no evening: unknown
      '2026-01-10': { err: ['aucun_releve'] },
    },
  };

  it('le relevé remplace la note du soir, un soir partiel compte comme ouvert, un soir inconnu est écarté', () => {
    // 08: noted by hand, but read with one shutter open at 22 h → not closed
    // 09: read without evening, noted → the note counts; 11: noted only → counts
    const ev = evenings(doc, ['2026-01-08', '2026-01-09', '2026-01-11']);
    expect(ev.auto).toBe(2);
    expect([...ev.known!].sort()).toEqual(['2026-01-07', '2026-01-08', '2026-01-09', '2026-01-11']);
    expect([...ev.closed].sort()).toEqual(['2026-01-07', '2026-01-09', '2026-01-11']);
  });

  it('sans relevé, les notes comme avant (tous les soirs comptent)', () => {
    for (const d of [null, {}, { days: { '2026-01-01': { err: ['aucun_releve'] } } }] as VoletsDoc[]) {
      const ev = evenings(d, ['2026-01-02']);
      expect(ev.known).toBeNull();
      expect([...ev.closed]).toEqual(['2026-01-02']);
      expect(ev.auto).toBe(0);
    }
  });

  it('les nuits hors des soirs connus sont laissées de côté', () => {
    const hourly: Hourly = new Map([['r', new Map()]]);
    const weather: Weather = new Map();
    for (let d = '2026-01-01'; d <= '2026-01-06'; d = addDays(d, 1)) {
      weather.set(d, [0, 4, 2]);
      for (const h of nightHours(d)) hourly.get('r')!.set(h, 1);
    }
    const all = nights(hourly, ['r'], weather, new Set(['2026-01-02']), '2026-01-01', '2026-01-05');
    expect(all.map((n) => n.day)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
    const known = nights(hourly, ['r'], weather, new Set(['2026-01-02']), '2026-01-01', '2026-01-05', new Set(['2026-01-02', '2026-01-04']));
    expect(known.map((n) => [n.day, n.closed])).toEqual([
      ['2026-01-02', true],
      ['2026-01-04', false],
    ]);
  });

  it('résumé par volet : heure habituelle de fermeture, soirs fermés à 22 h, position moyenne', () => {
    const [salon, b] = summarize(doc, '2026-01-10', 14);
    expect(salon).toEqual({ key: 'v0', name: 'Salon', close: 18 * 60, closedAt22: 2, knownAt22: 2, mean: 50, days: 3 });
    expect(b).toEqual({ key: 'v1', name: 'Volet B', close: 21 * 60, closedAt22: 1, knownAt22: 2, mean: 65, days: 2 });
    // the window ends on `until` and spans n days
    expect(summarize(doc, '2026-01-08', 1)[0]).toMatchObject({ close: 18 * 60 + 10, days: 1 });
  });

  it("échecs récents, les plus récents d'abord, codes inconnus ignorés", () => {
    expect(recentFailures(doc, '2026-01-10')).toEqual([
      ['2026-01-10', 'aucun relevé ce jour-là'],
      ['2026-01-09', 'passerelle injoignable depuis le NAS'],
    ]);
    expect(recentFailures(doc, '2026-01-08')).toEqual([]);
  });

  it('noms : ceux de la passerelle, sinon « Volet A », B…', () => {
    expect([...shutterNames(doc)]).toEqual([
      ['v0', 'Salon'],
      ['v1', 'Volet B'],
    ]);
    expect(lastReceived(doc)).toBe('2026-01-10');
    expect(lastReceived({ received: 'hier' } as VoletsDoc)).toBeNull();
  });
});
