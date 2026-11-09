import { describe, expect, it } from 'vitest';
import { type Dataset, hourlyYears } from './data';

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
