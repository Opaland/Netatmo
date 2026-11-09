// #310 / #300: the one ECharts theme of the app, built from the design tokens (styles/tokens.css)
// for the current light / dark / high-contrast state and text size. charts.ts registers it in the
// lazily loaded ECharts chunk and creates every chart with it (a chart whose theme no longer
// matches is recreated). Pure: takes a token reader, so it is tested without a browser.

export type TokenReader = (name: string) => string;

/** Key of a theme: changes with the colour scheme, the contrast and the text size. */
export function themeKey(read: TokenReader, rootPx: number): string {
  return `foyer-${read('--surface-card')}-${read('--text')}-${Math.round(rootPx * 10)}`;
}

/** px of a rem token (« 0.8125rem » at 16 px → 13). */
export function remPx(value: string, rootPx: number): number {
  const v = parseFloat(value);
  if (!Number.isFinite(v)) return 12;
  return value.trim().endsWith('px') ? v : v * rootPx;
}

export function buildTheme(read: TokenReader, rootPx: number, fontFamily: string) {
  const text = read('--text');
  const muted = read('--text-muted');
  const border = read('--border');
  const grid = read('--grid');
  const fs = Math.max(11, Math.round(remPx(read('--font-xs'), rootPx)));
  const label = { color: muted, fontSize: fs, fontFamily };
  const axis = {
    axisLine: { show: true, lineStyle: { color: border } },
    axisTick: { show: false },
    axisLabel: { ...label, hideOverlap: true },
    splitLine: { show: true, lineStyle: { color: grid } },
    splitArea: { show: false },
    nameTextStyle: label,
  };
  return {
    // categorical palette: rooms (orange and blue belong to the usages, iris to the years)
    color: Array.from({ length: 8 }, (_, i) => read(`--room-${i + 1}`)),
    backgroundColor: 'transparent',
    textStyle: { color: text, fontFamily, fontSize: fs },
    title: { textStyle: { color: text }, subtextStyle: { color: muted } },
    legend: { textStyle: { color: muted, fontSize: Math.round(remPx(read('--font-sm'), rootPx)) }, pageTextStyle: { color: muted }, pageIconColor: text },
    tooltip: {
      backgroundColor: read('--surface-raised'),
      borderColor: border,
      textStyle: { color: text, fontFamily, fontSize: Math.round(remPx(read('--font-sm'), rootPx)) },
      axisPointer: { lineStyle: { color: muted, width: 1 }, shadowStyle: { color: 'rgba(128,128,128,0.12)' } },
    },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: { ...axis, axisLine: { show: false } },
    timeAxis: axis,
    logAxis: axis,
    line: { symbolSize: 8, lineStyle: { width: 2 }, emphasis: { lineStyle: { width: 3 } } },
    bar: { itemStyle: { borderRadius: [4, 4, 0, 0] } },
    visualMap: { textStyle: { color: muted } },
    calendar: { dayLabel: { color: muted }, monthLabel: { color: muted } },
    markLine: { lineStyle: { color: read('--series-reference') }, label: { color: muted } },
    dataZoom: { textStyle: { color: muted } },
  };
}

/** Number of value ticks that fit: fewer on a narrow or short chart (#319, no overlap). */
export const splitCount = (px: number, per = 90) => Math.max(2, Math.min(5, Math.floor(px / per)));
