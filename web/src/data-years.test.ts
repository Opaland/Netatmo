// #550: the fine series (hours, station, Linky curve) read a key found in two year files as the
// energy does (aggregate.ts mergeYear): the value of the file of its own year, not the last read.
// The envelopes are not encrypted here: decryptEnvelope returns the document it is given.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./crypto')>()),
  decryptEnvelope: async (env: unknown) => env,
}));

const { clearDataCaches, loadCurve, loadHourly, loadStationHourly } = await import('./data');
type Dataset = import('./data').Dataset;

const files: Record<string, unknown> = {
  '2024.hourly': { hourly: { a: { '2024-12-31T23': 1000 } } },
  '2025.hourly': { hourly: { a: { '2024-12-31T23': 9000, '2025-01-01T00': 2000 } } },
  '2024.station_h': { hourly: { m: { '2024-12-31T23': [5, 80, null] } } },
  '2025.station_h': { hourly: { m: { '2024-12-31T23': [25, 10, null] } } },
  '2024.linky30': { curve: { '2024-12-31T23:30': 400 } },
  '2025.linky30': { curve: { '2024-12-31T23:30': 4000, '2025-01-01T00:00': 300 } },
};

function serve(): void {
  vi.stubGlobal('fetch', async (url: string) => {
    const name = url.replace(/^.*\//, '').replace(/\.enc\.json$/, '');
    const doc = files[name];
    return doc ? new Response(JSON.stringify(doc), { headers: { 'content-type': 'application/json' } }) : new Response('', { status: 404 });
  });
}

const ds = {
  source: 'demo',
  key: {} as CryptoKey,
  meta: { rooms: [], hourly_years: [2024, 2025], station_hourly_years: [2024, 2025], linky_curve_years: [2024, 2025] },
} as unknown as Dataset;

afterEach(() => {
  clearDataCaches();
  vi.unstubAllGlobals();
});

describe('a key in two year files, fine series (#550)', () => {
  it('hours: the value of the file of the hour own year', async () => {
    serve();
    const h = await loadHourly(ds);
    expect(h.get('a')!.get('2024-12-31T23')).toBe(1);
    expect(h.get('a')!.get('2025-01-01T00')).toBe(2);
  });

  it('station: the same rule', async () => {
    serve();
    expect((await loadStationHourly(ds)).get('m')!.get('2024-12-31T23')).toEqual([5, 80, null]);
  });

  it('Linky curve: the same rule', async () => {
    serve();
    const c = await loadCurve(ds);
    expect(c.get('2024-12-31T23:30')).toBe(400);
    expect(c.get('2025-01-01T00:00')).toBe(300);
  });
});
