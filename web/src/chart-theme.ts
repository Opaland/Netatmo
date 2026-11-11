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

// ------------------------------------------------------------------ #304 / #306: readability rules
// Pure helpers shared by every chart (charts.ts) and reusable by the views: no DOM, no ECharts.

/** Rough width in px of a text in the chart font (average glyph ≈ 0.58 em). */
export const textPx = (s: string, px: number) => Math.ceil(s.length * px * 0.58);

/**
 * #304: rows taken by a wrapping legend (never paginated « 1/3 »): items of `icon` px + name,
 * laid left to right over `width` px.
 */
export function legendRows(names: string[], width: number, px: number, icon = 14): number {
  if (!names.length) return 0;
  let rows = 1;
  let x = 0;
  for (const n of names) {
    const w = icon + 5 + textPx(n, px) + 12;
    if (x > 0 && x + w > width) {
      rows++;
      x = 0;
    }
    x += w;
  }
  return rows;
}

/**
 * #451: height in px of a legend stacked one item per row (charts.ts legendLayout, when a name has
 * to wrap): every line of every name, and the gap of 12 px between two items.
 */
export const legendStackHeight = (names: string[], width: number, px: number, icon = 14) =>
  names.reduce((h, n) => h + Math.max(1, legendLines(n, width, px, icon)) * lineHeightPx(px), 0) + (names.length - 1) * 12 + 4;

/** #451: width in px left to the name of a legend item that has a row to itself. */
export const legendTextWidth = (width: number, icon = 14) => Math.max(1, width - icon - 5 - 4);

/**
 * #451: lines of a legend name too wide for a row (« Température moyenne » at 360 px and text
 * 200 %), wrapped word by word inside its item; 0 when it holds on one row (no wrap). The
 * estimate is widened by 15 % (textPx is an average and the CI's DejaVu Sans is wider, A6): a name
 * near the edge is wrapped rather than cut, and the lines counted are never fewer than drawn.
 */
export function legendLines(name: string, width: number, px: number, icon = 14): number {
  const max = legendTextWidth(width, icon) / 1.15;
  return textPx(name, px) <= max ? 0 : wrappedLines(name, max, px);
}
/** Height in px of a legend of `rows` rows. */
export const legendHeight = (rows: number, px: number) => (rows ? rows * (px + 9) + 4 : 0);

/**
 * #304: end-of-line labels are readable only when the last values of the lines are far enough
 * apart on screen (one text line), and when the names leave room for the plot (a third at most).
 */
export function endLabelsFit(
  series: { name: string; data: (number | null)[] }[],
  opts: { width: number; height: number; px: number },
): boolean {
  if (series.length < 1 || series.length > 4) return false;
  const longest = Math.max(...series.map((s) => textPx(s.name, opts.px))) + 12;
  if (longest > opts.width / 3) return false;
  const all = series.flatMap((s) => s.data).filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  if (!all.length) return false;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const plot = Math.max(60, opts.height - 70);
  const lasts = series
    .map((s) => {
      for (let i = s.data.length - 1; i >= 0; i--) if (s.data[i] !== null && s.data[i] !== undefined) return s.data[i] as number;
      return null;
    })
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  for (let i = 1; i < lasts.length; i++) if (((lasts[i] - lasts[i - 1]) / span) * plot < opts.px + 3) return false;
  return true;
}

/**
 * #413: lines a category label takes once wrapped word by word in `width` px (ECharts
 * `overflow: 'break'`); a word wider than the line is cut into as many lines as it needs.
 */
export function wrappedLines(s: string, width: number, px: number): number {
  const space = textPx(' ', px);
  let lines = 1;
  let cur = 0;
  for (const w of s.split(/\s+/).filter(Boolean)) {
    let ww = textPx(w, px);
    if (cur && cur + space + ww <= width) {
      cur += space + ww;
      continue;
    }
    if (cur) lines++;
    while (ww > width) {
      lines++;
      ww -= width;
    }
    cur = ww;
  }
  return lines;
}

/** Line height of a chart text, in px (ECharts: about 1.2 em; rounded up, never optimistic). */
export const lineHeightPx = (px: number) => Math.ceil(px * 1.25);

/**
 * #413: how the category labels of a horizontal bar chart would be laid out — one per band of
 * `plot / labels.length` px, centred, wrapped in `labelWidth` px — and what goes wrong:
 * `overlaps`, the pairs of neighbouring labels whose estimated boxes cross (« Chauffe-eau /
 * Chambre parentale », drawn over each other at 360 px and text 200 %), and `broken`, the labels
 * with a word wider than the column (cut in the middle, « Chauff / e-eau »).
 */
export function categoryLabels(labels: string[], opts: { labelWidth: number; plot: number; px: number }): { overlaps: string[]; broken: string[] } {
  const band = opts.plot / Math.max(1, labels.length);
  const half = labels.map((l) => (wrappedLines(l, opts.labelWidth, opts.px) * lineHeightPx(opts.px)) / 2);
  const overlaps: string[] = [];
  for (let i = 1; i < labels.length; i++) if (half[i - 1] + half[i] > band) overlaps.push(`${labels[i - 1]} / ${labels[i]}`);
  const broken = labels.filter((l) => l.split(/\s+/).some((w) => textPx(w, opts.px) > opts.labelWidth));
  return { overlaps, broken };
}

/**
 * #304 (« manque de points ? »): which values of a line get a visible point. A short series
 * (≤ `few` values) shows them all; a long one only shows a value with no neighbour: without a
 * point it would not be drawn at all, since a gap (null) is never bridged by a straight line.
 */
export function pointsToShow(data: (number | null)[], few = 24): boolean[] {
  const has = (i: number) => i >= 0 && i < data.length && data[i] !== null && data[i] !== undefined;
  const n = data.filter((_, i) => has(i)).length;
  return data.map((_, i) => has(i) && (n <= few || (!has(i - 1) && !has(i + 1))));
}

/**
 * Value axes: an amount (kWh, €, hours, kVA…) starts at 0, otherwise bar heights and slopes lie;
 * a level (°C, ppm, %) never does: the axis follows the data (« °C jamais à 0 »).
 */
export const zeroBased = (unit: string) => !/^(°C|ppm|%|hPa|dB)$/.test(unit.trim());

/**
 * #306: daily values averaged per week (weeks starting on Monday), for a long noisy series
 * (station beyond 90 days). A week needs `minDays` measured days, else it is a gap (null).
 */
export function weeklyMeans(days: string[], series: (number | null)[][], minDays = 4): { labels: string[]; data: (number | null)[][] } {
  const start = (d: string) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    const wd = (new Date(t).getUTCDay() + 6) % 7;
    return new Date(t - wd * 86400000).toISOString().slice(0, 10);
  };
  const labels: string[] = [];
  const idx: number[][] = [];
  days.forEach((d, i) => {
    const w = start(d);
    if (labels[labels.length - 1] !== w) {
      labels.push(w);
      idx.push([]);
    }
    idx[idx.length - 1].push(i);
  });
  return {
    labels,
    data: series.map((s) =>
      idx.map((is) => {
        const v = is.map((i) => s[i]).filter((x): x is number => x !== null && x !== undefined);
        return v.length && v.length >= Math.min(minDays, is.length) ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
      }),
    ),
  };
}

/** « 05:30 » → « 5 h 30 », « 19:00 » → « 19 h », « 8h » → « 8 h » (§ 7.2); other labels unchanged. */
export function axisHour(label: string): string {
  let m = /^(\d{1,2}):(\d{2})$/.exec(label);
  if (m) return Number(m[2]) ? `${Number(m[1])} h ${m[2]}` : `${Number(m[1])} h`;
  m = /^(\d{1,2}) ?h ?(\d{2})?$/.exec(label);
  return m ? (m[2] && Number(m[2]) ? `${Number(m[1])} h ${m[2]}` : `${Number(m[1])} h`) : label;
}

/** Text of a category on an axis: hours in French, « sem. du 3 nov. 2026 » → « 3 nov. 2026 » (the tooltip keeps it all). */
export const axisText = (label: string) => axisHour(label.replace(/^sem\. du /, ''));

/** Ticks of a numeric legend (calendar, heat maps): « 0 », « 25 », « 50 kWh » (#305). */
export function scaleText(max: number, unit: string): [string, string] {
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: max < 10 ? 1 : 0 });
  return [`${nf.format(max)} ${unit}`, '0'];
}
