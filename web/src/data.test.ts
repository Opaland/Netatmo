import { describe, expect, it, vi } from 'vitest';
import { type Dataset, clearDataCaches, hourlyYears, loadRoomState, mergeRooms } from './data';

const ds = { meta: { hourly_years: [2023, 2024, 2025, 2026] } } as unknown as Dataset;

describe('hourly years to load (#251)', () => {
  it('a 30-day card needs the last year, or the last two across new year', () => {
    expect(hourlyYears(ds, '2026-10-11')).toEqual([2026]);
    expect(hourlyYears(ds, '2025-12-20')).toEqual([2025, 2026]);
  });

  it('without a start day, every year (research export)', () => {
    expect(hourlyYears(ds)).toEqual([2023, 2024, 2025, 2026]);
    expect(hourlyYears({ meta: {} } as unknown as Dataset, '2026-01-01')).toEqual([]);
  });
});

describe('household view of the hourly data (#255)', () => {
  it('merges the bedrooms after the load, once per raw data and room map', () => {
    const raw = new Map([
      ['a', new Map([['2026-01-01T00', 1], ['2026-01-01T01', 2]])],
      ['b', new Map([['2026-01-01T00', 0.5]])],
      ['kitchen', new Map([['2026-01-01T00', 3]])],
    ]);
    const map = new Map([['a', '__bedrooms__'], ['b', '__bedrooms__']]);
    const merged = mergeRooms(raw, map);
    expect([...merged.keys()].sort()).toEqual(['__bedrooms__', 'kitchen']);
    expect(merged.get('__bedrooms__')!.get('2026-01-01T00')).toBe(1.5);
    expect(merged.get('__bedrooms__')!.get('2026-01-01T01')).toBe(2);
    expect(merged.get('kitchen')).toBe(raw.get('kitchen'));
    expect(raw.get('a')!.get('2026-01-01T00')).toBe(1); // the raw data are left untouched
    expect(mergeRooms(raw, map)).toBe(merged);
  });

  it('a decrypted document is reused by the household view, and forgotten on lock (#232)', async () => {
    const get = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', get);
    const rawDs = { source: 'demo', key: {} as CryptoKey, meta: {} } as unknown as Dataset;
    const shown = { ...rawDs, roomMap: new Map([['a', '__bedrooms__']]) } as Dataset;
    await loadRoomState(rawDs);
    await loadRoomState(shown);
    expect(get).toHaveBeenCalledTimes(1);
    clearDataCaches();
    await loadRoomState(shown);
    expect(get).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
