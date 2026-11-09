import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, backupFileName, backupNames, buildBundle } from './backup';
import type { Meta } from './aggregate';
import { decryptEnvelope, deriveKey } from './crypto';
import { type Curve, SLOTS, dayCurve, halfHourCounts, measuredWatts, peakHalfHour, percentile, talon, typicalDay, typicalHourly } from './curve';
import vector from './__fixtures__/python-vector.json';

const TZ = 'Europe/Paris';

/** A flat curve: `w` watts every half hour of each day (local keys, as the collector writes them). */
function flat(days: string[], w: number): Curve {
  const c: Curve = new Map();
  for (const d of days) {
    const counts = halfHourCounts(TZ, d);
    for (const s of SLOTS) {
      const n = counts ? (counts.get(s) ?? 0) : 1;
      if (n) c.set(`${d}T${s}`, (w / 2) * n); // Wh over the real half hours behind the key
    }
  }
  return c;
}

describe('load curve across DST', () => {
  it('knows which local half hours are doubled or missing', () => {
    expect(halfHourCounts(TZ, '2025-10-15')).toBeNull();
    const autumn = halfHourCounts(TZ, '2025-10-26')!;
    expect(autumn.get('02:00')).toBe(2);
    expect(autumn.get('02:30')).toBe(2);
    expect([...autumn.values()].reduce((a, b) => a + b, 0)).toBe(50);
    const spring = halfHourCounts(TZ, '2025-03-30')!;
    expect(spring.has('02:00')).toBe(false);
    expect([...spring.values()].reduce((a, b) => a + b, 0)).toBe(46);
  });

  it('averages a typical day in watts, DST days included', () => {
    // two Sundays (one is the autumn change) and two Mondays, all at a constant 300 W
    const c = flat(['2025-10-19', '2025-10-26', '2025-10-20', '2025-10-27'], 300);
    const t = typicalDay(c, TZ, '2025-10-19', '2025-10-27');
    expect(t.days).toEqual({ weekday: 2, weekend: 2 });
    for (const v of [...t.weekday, ...t.weekend]) expect(v).toBeCloseTo(300, 6);
    // spring change: the missing 02:00 slot is averaged over the other day only
    const s = flat(['2025-03-23', '2025-03-30'], 200);
    const ts = typicalDay(s, TZ, '2025-03-23', '2025-03-30');
    expect(ts.weekend[SLOTS.indexOf('02:00')]).toBeCloseTo(200, 6);
    expect(ts.weekend[SLOTS.indexOf('03:00')]).toBeCloseTo(200, 6);
    expect(dayCurve(s, TZ, '2025-03-30').values[SLOTS.indexOf('02:30')]).toBeNull();
  });

  it('spreads hourly room energy over half hours, per real hour', () => {
    const hourly = new Map([['r1', new Map([['2025-10-26T02', 1.0], ['2025-10-26T19', 0.5]])]]);
    const out = typicalHourly(hourly, new Set(['r1']), TZ, new Set(['2025-10-26']));
    expect(out.weekend[SLOTS.indexOf('02:00')]).toBeCloseTo(500, 6); // 1 kWh over two real hours
    expect(out.weekend[SLOTS.indexOf('19:30')]).toBeCloseTo(500, 6);
    expect(out.weekend[SLOTS.indexOf('12:00')]).toBe(0);
  });
});

describe('talon and peak', () => {
  it('percentile interpolates', () => {
    expect(percentile([], 0.1)).toBeNull();
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110], 0.1)).toBe(20);
    expect(percentile([5], 0.1)).toBe(5);
  });

  it('takes the 10th percentile of the night half hours only', () => {
    const c: Curve = new Map();
    // nights (01:00–04:30) from 200 to 390 W; a big day-time load must not count
    let w = 200;
    for (const day of ['2025-11-03', '2025-11-04']) {
      for (const s of SLOTS) {
        if (s >= '01:00' && s < '05:00') {
          c.set(`${day}T${s}`, w / 2);
          w += 12.5;
        } else c.set(`${day}T${s}`, s === '00:30' ? 10 : 1500);
      }
    }
    const t = talon(c, TZ, '2025-11-03', '2025-11-04')!;
    expect(t.samples).toBe(16);
    const nights = Array.from({ length: 16 }, (_, i) => 200 + 12.5 * i);
    expect(t.watts).toBeCloseTo(percentile(nights, 0.1)!, 6);
    expect(peakHalfHour(c, TZ, '2025-11-03', '2025-11-04')!.watts).toBe(3000);
  });

  it('takes the measured radiators and water heater out of the night load', () => {
    const c = flat(['2025-11-03', '2025-11-04'], 900); // 250 W standby + 650 W heating
    const hours = new Map<string, number>();
    for (const d of ['2025-11-03']) for (let h = 0; h < 24; h++) hours.set(`${d}T${String(h).padStart(2, '0')}`, 0.65);
    const m = measuredWatts(new Map([['r1', hours]]), new Set(['r1']), TZ);
    expect(m.last).toBe('2025-11-03');
    const t = talon(c, TZ, '2025-11-03', '2025-11-04', m)!;
    expect(t.watts).toBeCloseTo(250, 6);
    expect(t.samples).toBe(8); // 2025-11-04 not covered by the hourly data: skipped
  });

  it('does not count the doubled autumn half hour as a peak', () => {
    const c = flat(['2025-10-26'], 1000);
    expect(peakHalfHour(c, TZ, '2025-10-26', '2025-10-26')!.watts).toBeCloseTo(1000, 6);
  });
});

describe('encrypted backup bundle (S-1.15)', () => {
  const meta = {
    home: { id: 'h', name: 'Maison secrète', timezone: TZ },
    rooms: [{ id: 'r1', name: 'Chambre des enfants', category: 'heating' }],
    years: [2025, 2026],
    hourly_years: [2026],
    station_hourly_years: [2026],
    linky_curve_years: [2026],
    first_day: '2025-01-01',
    last_day: '2026-11-08',
    updated: '',
  } as unknown as Meta;

  it('lists every encrypted document but the Netatmo token', () => {
    const names = backupNames(meta);
    expect(names).toEqual(
      expect.arrayContaining(['meta.enc.json', '2025.enc.json', '2026.hourly.enc.json', '2026.station_h.enc.json', '2026.linky30.enc.json', 'linky.enc.json', 'shelly.enc.json', 'ha.enc.json']),
    );
    expect(names.some((n) => n.includes('netatmo-token'))).toBe(false);
  });

  it('copies envelopes as served, skips absent files and never holds plaintext', async () => {
    const env = vector as Record<string, unknown>;
    const served: Record<string, unknown> = { 'keyinfo.json': { salt: env.salt, iter: env.iter }, 'netatmo-token.enc.json': env };
    for (const n of backupNames(meta)) if (n !== 'insights.enc.json') served[n] = { ...env, extra: 'Chambre des enfants' };
    const asked: string[] = [];
    const bundle = await buildBundle(async (n) => (asked.push(n), served[n] ?? null), meta, new Date('2026-11-09T10:00:00Z'));
    expect(bundle.format).toBe(BACKUP_FORMAT);
    expect(bundle.created).toBe('2026-11-09T10:00:00.000Z');
    expect(bundle.keyinfo).toEqual({ salt: env.salt, iter: env.iter });
    expect(Object.keys(bundle.files)).not.toContain('insights.enc.json');
    expect(asked).not.toContain('netatmo-token.enc.json');
    const text = JSON.stringify(bundle);
    expect(text).not.toContain('Chambre des enfants');
    expect(text).not.toContain('Maison secrète');
    // still decryptable with the passphrase, i.e. untouched envelopes
    const key = await deriveKey('test', bundle.keyinfo);
    expect((await decryptEnvelope<{ txt: string }>(bundle.files['meta.enc.json'], key)).txt).toBe('Salle de bain é');
  });

  it('refuses a document that is not encrypted', async () => {
    const env = vector as Record<string, unknown>;
    const fetchJson = async (n: string) => (n === 'keyinfo.json' ? { salt: env.salt, iter: env.iter } : n === 'meta.enc.json' ? { home: 'x' } : null);
    await expect(buildBundle(fetchJson, meta)).rejects.toThrow(/pas un fichier chiffré/);
  });

  it('names the file after the local date', () => {
    expect(backupFileName(new Date(2026, 0, 5, 12))).toBe('sauvegarde-energie-2026-01-05.json');
  });
});
