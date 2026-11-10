import { describe, expect, it } from 'vitest';
import { CHART_DEFAULT, chartPrefs, keepLastYear, movingAverage, smoothable, zeroAxis } from './chart-prefs';

describe('chartPrefs (#20)', () => {
  it('defaults when nothing is saved, field by field when a value is damaged', () => {
    expect(chartPrefs(undefined)).toEqual(CHART_DEFAULT);
    expect(chartPrefs('oui')).toEqual(CHART_DEFAULT);
    expect(chartPrefs({ points: true, zero: 'oui', lastYear: false })).toEqual({ points: true, zero: false, lastYear: false, smooth: false });
  });
  it('the defaults keep the charts as they were drawn before the sheet', () => {
    expect(CHART_DEFAULT).toEqual({ points: false, zero: false, lastYear: true, smooth: false });
  });
});

describe('movingAverage (#20)', () => {
  it('trailing mean over 7 values, rounded to the hundredth; raw until half the window is there', () => {
    expect(movingAverage([7, 0, 0, 0, 0, 0, 0, 14])).toEqual([7, 0, 0, 1.75, 1.4, 1.17, 1, 2]);
  });
  it('a gap stays a gap, and the missing days are left out of the mean', () => {
    expect(movingAverage([2, null, 4, 6, 8, null, 10])).toEqual([2, null, 4, 6, 5, null, 6]);
    expect(movingAverage([2, null, null, null, null, null, 9])).toEqual([2, null, null, null, null, null, 9]);
  });
  it('the window is the last n values, not the first ones', () => {
    const r = movingAverage([100, 1, 1, 1], 3);
    expect(r[3]).toBe(1);
  });
});

describe('keepLastYear (#20)', () => {
  const s = [{ name: '12 derniers mois' }, { name: 'Un an plus tôt', lastYear: true }];
  it('keeps everything by default', () => expect(keepLastYear(s, CHART_DEFAULT)).toBe(s));
  it('drops « Un an plus tôt » when the reader turned it off', () => {
    expect(keepLastYear(s, { ...CHART_DEFAULT, lastYear: false }).map((x) => x.name)).toEqual(['12 derniers mois']);
  });
  it('never leaves a chart empty', () => {
    const only = [{ name: 'Un an plus tôt', lastYear: true }];
    expect(keepLastYear(only, { ...CHART_DEFAULT, lastYear: false })).toBe(only);
  });
});

describe('smoothable, zeroAxis (#20)', () => {
  it('smooths day-by-day curves of a month or more only', () => {
    const on = { ...CHART_DEFAULT, smooth: true };
    expect(smoothable(on, 30)).toBe(true);
    expect(smoothable(on, 24)).toBe(false); // hours of a day
    expect(smoothable(on, 12)).toBe(false); // months of a year
    expect(smoothable(CHART_DEFAULT, 30)).toBe(false);
  });
  it('from 0 when the unit says so, or when asked and the chart has no range of its own', () => {
    const on = { ...CHART_DEFAULT, zero: true };
    expect(zeroAxis(CHART_DEFAULT, true, false)).toBe(true);
    expect(zeroAxis(CHART_DEFAULT, false, false)).toBe(false);
    expect(zeroAxis(on, false, false)).toBe(true);
    expect(zeroAxis(on, false, true)).toBe(false);
  });
});
