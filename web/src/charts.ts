// ECharts wrapper: modular import (smaller bundle) + theme read from CSS tokens.

import type { ECharts, EChartsCoreOption, SetOptionOpts } from 'echarts/core';
import {
  axisHour,
  axisText,
  buildTheme,
  endLabelsFit,
  legendHeight,
  legendRows,
  pointsToShow,
  remPx,
  scaleText,
  splitCount,
  textPx,
  themeKey,
  zeroBased,
} from './chart-theme';
import { dayLong, signedPct } from './glossary';
import { type Measure, changeSummary, daysSummary, gridSummary, rankSummary, slopeSummary, summarize } from './summary';
import { node } from './trusted';
import { track } from './ready';

// #227: ECharts lives in its own chunk (./echarts-lib), loaded on the first chart drawn — or
// earlier, when the browser is idle — so the entry chunk stays light for the lock screen.
type Lib = typeof import('./echarts-lib');
let lib: Lib | null = null;
let loading: Promise<Lib> | null = null;
export function loadCharts(): Promise<Lib> {
  return (loading ??= track(import('./echarts-lib').then((m) => (lib = m))));
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const idle = (window as { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback;
  const warm = () =>
    void loadCharts().catch(() => {
      loading = null;
    });
  if (idle) idle(warm);
  else setTimeout(warm, 1500);
}

export interface Series {
  name: string;
  color: string;
  data: (number | null)[];
  /** Optional per-bar colours (identity per category on a single series). */
  colors?: string[];
  /** Unit of this series when it differs from the chart's (combo charts). */
  unit?: string;
  /** #295: how the screen-reader summary sums it up (default: from the unit). */
  measure?: Measure;
  /** #295: unrounded values behind `data`, for the summary's total. */
  raw?: (number | null)[];
  /** #297: per point, a caveat shown in the tooltip (« 8 jours sur 30 », lost days…). */
  notes?: (string | null)[];
  /** #297: per point, hatch the bar (partial period, estimated or lost days). */
  marks?: boolean[];
  /** #295: day reached by a running total whose last month is still running. */
  lastLabel?: string;
  /** Lines: dashed (a period still running, an expected value). */
  dashed?: boolean;
  /** Lines: stroke width in px (default 2, 3 for the emphasized one). */
  width?: number;
}

export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
export const fmtKwh = (v: number) => `${(Math.abs(v) < 100 ? nf1 : nf0).format(v)} kWh`;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** S-8.9: tooltips handed to ECharts as DOM built through the Trusted Types policy (no innerHTML in ECharts). */
const tip =
  <P>(f: (p: P) => string) =>
  (p: P) =>
    node(f(p));

const observed = new WeakSet<HTMLElement>();

/** S-7.2: a sentence a screen reader can read instead of the canvas (wording in summary.ts, #295). */
function describe(el: HTMLElement, labels: string[], series: Series[], unit = 'kWh') {
  const base = el.getAttribute('data-label') ?? el.getAttribute('aria-label') ?? 'Graphique';
  el.setAttribute('data-label', base);
  const parts = summarize(labels, series, unit);
  el.setAttribute('aria-label', `${base}, de ${labels[0] ?? '—'} à ${labels[labels.length - 1] ?? '—'}. ${parts.join(' ; ')}.`);
}

/** S-7.7: high contrast asked by the system (or forced colours): series also differ by pattern. */
const highContrast = () => matchMedia('(prefers-contrast: more), (forced-colors: active)').matches;

/** Distinct fill patterns (stripes, dots, cross-hatch…), one per series index; the first stays plain. */
function decal(i: number) {
  if (!highContrast() || i === 0) return undefined;
  const ink = matchMedia('(prefers-color-scheme: dark)').matches ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  const patterns = [
    { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: Math.PI / 4 },
    { symbol: 'circle', symbolSize: 0.7, dashArrayX: [[4, 3]], dashArrayY: [4, 3] },
    { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: -Math.PI / 4 },
    { symbol: 'rect', dashArrayX: [[2, 3]], dashArrayY: [2, 3] },
  ];
  return { color: ink, ...patterns[(i - 1) % patterns.length] };
}

/** #297: stripes over a bar whose period is partial or has estimated or lost days. */
function hatch() {
  return { color: cssVar('--surface-card') || 'rgba(255,255,255,0.7)', symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 3], rotation: -Math.PI / 4 };
}

/** What the chart builders need from an ECharts instance; calls wait for the chunk if needed. */
export interface ChartHandle {
  setOption(option: EChartsCoreOption, opts?: SetOptionOpts): void;
  on(event: 'click', handler: (p: { dataIndex: number }) => void): void;
  off(event: 'click'): void;
}

// #310: one theme built from the tokens (chart-theme.ts), registered once per colour scheme,
// contrast and text size; a chart created under another theme is recreated with the current one.
const rootPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const registered = new Set<string>();
const themeOf = new WeakMap<ECharts, string>();
function currentTheme(l: Lib): string {
  const px = rootPx();
  const key = themeKey(cssVar, px);
  if (!registered.has(key)) {
    l.registerTheme(key, buildTheme(cssVar, px, getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'));
    registered.add(key);
  }
  return key;
}
/** Size of the axis texts in px (--font-xs, follows the system text size). */
export const axisPx = () => Math.max(11, Math.round(remPx(cssVar('--font-xs'), rootPx())));

function real(el: HTMLElement, l: Lib): ECharts {
  const key = currentTheme(l);
  let chart = l.getInstanceByDom(el);
  if (chart && themeOf.get(chart) !== key) {
    chart.dispose();
    chart = undefined;
  }
  if (!chart) {
    chart = l.init(el, key);
    themeOf.set(chart, key);
  }
  if (!observed.has(el)) {
    new ResizeObserver(() => chart.resize()).observe(el);
    observed.add(el);
  }
  return chart;
}

/** Runs f on the element's chart now if ECharts is there, else in call order once it has loaded. */
function run(el: HTMLElement, f: (c: ECharts) => void) {
  if (lib) return f(real(el, lib));
  loadCharts().then(
    (l) => {
      // the view was replaced meanwhile: nothing to draw
      if (el.isConnected) f(real(el, l));
    },
    (e: unknown) => {
      loading = null;
      console.error('Graphiques indisponibles', e);
    },
  );
}

/** The chart of an element (created on first use), e.g. to add marks after a builder. */
export function chartOf(el: HTMLElement): ChartHandle {
  return {
    setOption: (o, opts) => run(el, (c) => c.setOption(o, opts)),
    on: (ev, h) => run(el, (c) => c.on(ev, (p) => h(p as { dataIndex: number }))),
    off: (ev) => run(el, (c) => c.off(ev)),
  };
}

function instance(el: HTMLElement): ChartHandle {
  // S-7.6: a chart with a summary can be reached with the keyboard, which reads that summary.
  if (el.getAttribute('role') === 'img' && !el.hasAttribute('tabindex')) el.tabIndex = 0;
  return chartOf(el);
}

export function disposeAll(root: HTMLElement) {
  const l = lib;
  if (!l) return;
  root.querySelectorAll<HTMLElement>('.chart').forEach((el) => l.getInstanceByDom(el)?.dispose());
}

function tooltip(price: number | null, showTotal: boolean, unit = 'kWh', series: Series[] = [], notes?: (string | null)[]) {
  const fmt = (v: number, u = unit) => minus(u === 'kWh' ? fmtKwh(v) : `${nf1.format(v)} ${u}`);
  const note = (t: string | null | undefined) => (t ? `<div class="tt-note">${escapeHtml(t)}</div>` : '');
  return {
    trigger: 'axis' as const,
    confine: true,
    axisPointer: { type: 'line' as const },
    formatter: tip((params: unknown) => {
      const list = (
        params as { seriesName: string; seriesIndex: number; dataIndex: number; value: number | null; color: string; axisValueLabel: string }[]
      ).filter((p) => p.value !== null && p.value !== undefined && typeof p.value === 'number');
      if (!list.length) return '';
      const rows = list
        .map(
          (p) =>
            `<div class="tt-row"><span class="tt-key" style="background:${p.color}"></span><strong>${fmt(p.value!, series[p.seriesIndex]?.unit ?? unit)}</strong><span class="tt-name">${escapeHtml(p.seriesName)}</span></div>${note(series[p.seriesIndex]?.notes?.[p.dataIndex])}`,
        )
        .join('');
      const sum = list.reduce((s, p) => s + (p.value ?? 0), 0);
      const totalRow =
        showTotal && list.length > 1
          ? `<div class="tt-row tt-total"><strong>${fmtKwh(sum)}</strong><span class="tt-name">Total${price ? ` · ≈ ${nf0.format(sum * price)} €` : ''}</span></div>`
          : price && list.length === 1
            ? `<div class="tt-row tt-total"><span class="tt-name">≈ ${nf0.format(sum * price)} €</span></div>`
            : '';
      return `<div class="tt"><div class="tt-title">${escapeHtml(axisHour(list[0].axisValueLabel))}</div>${note(notes?.[list[0].dataIndex])}${rows}${totalRow}</div>`;
    }),
  };
}

// ------------------------------------------------------------------ #304: shared layout rules
/**
 * Axis labels and names kept inside the grid rect, measured (not sampled like the old
 * `containLabel`, which let « 6 nov. 2026 » overflow on the right of a phone).
 */
/** First and last dates always written, inside the chart (« 6 nov. 2026 » was cut at the right edge). */
const ENDS = { showMinLabel: true, showMaxLabel: true, alignMinLabel: 'left' as const, alignMaxLabel: 'right' as const };
const FIT = { outerBoundsMode: 'same' as const, outerBoundsContain: 'all' as const };
/** Size of the legend texts in px (--font-sm, follows the system text size). */
const legendPx = () => Math.max(11, Math.round(remPx(cssVar('--font-sm'), rootPx())));

/**
 * #304: a legend that wraps on as many rows as needed (never paginated « 1/3 »), and the room it
 * takes above the plot. `line`: wide 4 px strokes for curves (3 px lines were hard to see).
 */
export function legendLayout(names: string[], el: HTMLElement, line = false) {
  const width = (el.clientWidth || 360) - 8;
  const icon = line ? 20 : 12;
  const rows = names.length > 1 ? legendRows(names, width, legendPx(), icon) : 0;
  return {
    option: {
      show: rows > 0,
      type: 'plain' as const,
      top: 0,
      left: 0,
      right: 0,
      icon: 'roundRect',
      itemWidth: icon,
      itemHeight: line ? 4 : 12,
      itemGap: 12,
    },
    height: legendHeight(rows, legendPx()),
  };
}

/** 1 456 → 1 500, 23 → 25: a round axis end above a value. */
export function niceCeil(v: number): number {
  const half = 10 ** Math.floor(Math.log10(Math.abs(v) || 1)) / 2;
  return Math.ceil(v / half) * half;
}

/** Number formatter of a value axis: one decimal under 10 (« 0,5 »), none above. */
const tickFmt = (v: number) => minus((v !== 0 && Math.abs(v) < 10 && v % 1 ? nf1 : nf0).format(v));
/** Typographic minus (« −15 € », never « -15 € »), § 7.2. */
const minus = (s: string) => s.replace(/^-/, '−');

/**
 * Category axis (dates, months, hours) and value axis with its unit written on top (§ 7.2), as
 * many ticks as the height allows, from 0 for an amount (kWh, €, h) and following the data for a
 * level (°C, ppm, %). First and last labels kept inside the chart (« 2 nov. 20 » was cut).
 */
function axes(labels: string[], el: HTMLElement, unit: string, legendH: number, opts: { zero?: boolean; ends?: number } = {}) {
  const zero = opts.zero ?? zeroBased(unit);
  // the unit on top of the axis is kept inside the grid (FIT): only the legend needs room
  return {
    grid: { left: 8, right: opts.ends ?? 14, top: Math.max(unit ? axisPx() + 8 : 12, legendH + 6), bottom: 8, ...FIT },
    xAxis: {
      type: 'category' as const,
      data: labels,
      axisLabel: { hideOverlap: true, ...ENDS, formatter: (l: string) => axisText(l) },
    },
    yAxis: {
      type: 'value' as const,
      scale: !zero,
      name: unit,
      nameLocation: 'end' as const,
      nameGap: 8,
      nameTextStyle: { align: 'left' as const, color: cssVar('--text-muted'), fontSize: axisPx() },
      splitNumber: splitCount(el.clientHeight || 300, 60),
      axisLabel: { formatter: tickFmt },
    },
  };
}

/**
 * #304: a caption written in the page just above a chart (« 2025 au 8 nov. : 6 260 kWh → … »),
 * created once and kept up to date. Plain text: no HTML.
 */
export function chartCaption(el: HTMLElement, text: string) {
  let p = el.previousElementSibling as HTMLElement | null;
  if (!p || !p.classList.contains('chart-caption')) {
    p = document.createElement('p');
    p.className = 'chart-caption hint';
    el.before(p);
  }
  p.textContent = text;
  p.hidden = !text;
}

/** Sets the screen-reader sentence of a chart that is not a series over labels (#305). */
function label(el: HTMLElement, fallback: string, text: string) {
  const base = el.getAttribute('data-label') ?? el.getAttribute('aria-label') ?? fallback;
  el.setAttribute('data-label', base);
  el.setAttribute('aria-label', `${base}. ${text}.`);
}

export function barChart(
  el: HTMLElement,
  opts: {
    labels: string[];
    series: Series[];
    stacked: boolean;
    price: number | null;
    zoom?: boolean;
    unit?: string;
    /** Buckets drawn paler (estimated or lost days, S-1.10). */
    muted?: boolean[];
    /** #297: buckets cut by the period or the data, hatched. */
    partial?: boolean[];
    /** #297: per bucket, a caveat under the tooltip title. */
    notes?: (string | null)[];
    /** A reference line (subscribed power, alert threshold), dashed, labelled on the line. */
    mark?: { value: number; label: string };
  },
) {
  const surface = cssVar('--surface-card');
  // Per-bar style only when needed: plain arrays keep the default fast path.
  const item = (s: Series) =>
    s.colors || opts.muted?.some(Boolean) || opts.partial?.some(Boolean) || s.marks?.some(Boolean)
      ? s.data.map((v, j) => ({
          value: v,
          itemStyle: {
            ...(s.colors ? { color: s.colors[j] } : {}),
            ...(opts.muted?.[j] ? { opacity: 0.4 } : {}),
            ...(opts.partial?.[j] || s.marks?.[j] ? { decal: hatch() } : {}),
          },
        }))
      : s.data;
  const n = opts.series.length;
  const unit = opts.unit ?? 'kWh';
  const chart = instance(el);
  describe(el, opts.labels, opts.series, unit);
  const leg = legendLayout(
    opts.series.map((s) => s.name),
    el,
  );
  const ax = axes(opts.labels, el, unit, leg.height, { zero: true });
  chart.setOption(
    {
      animationDuration: 300,
      ...ax,
      legend: leg.option,
      tooltip: tooltip(opts.price, opts.stacked && !opts.unit, unit, opts.series, opts.notes),
      dataZoom: opts.zoom ? [{ type: 'inside', minValueSpan: 6 }] : [],
      series: opts.series.map((s, i) => ({
        type: 'bar',
        name: s.name,
        data: item(s),
        stack: opts.stacked ? 'total' : undefined,
        barMaxWidth: 28,
        barGap: '15%',
        itemStyle: {
          color: s.color,
          // rounded data-end only on the top segment of a stack; surface hairline separates segments
          borderRadius: !opts.stacked || i === n - 1 ? [4, 4, 0, 0] : 0,
          borderColor: surface,
          borderWidth: opts.stacked ? 1 : 0,
          decal: decal(i),
        },
        emphasis: { focus: 'none', itemStyle: { opacity: 0.85 } },
        markLine: i === 0 && opts.mark ? refLine(opts.mark) : undefined,
      })),
    },
    { notMerge: true },
  );
}

/** A dashed reference line labelled on the line itself (§ 7.3: seuils, souscription). */
function refLine(mark: { value: number; label: string }) {
  const muted = cssVar('--text-muted');
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { color: muted, type: 'dashed', width: 1 },
    label: { show: !!mark.label, color: muted, formatter: mark.label, position: 'insideEndTop', fontSize: axisPx() },
    data: [{ yAxis: mark.value }],
  };
}

export function lineChart(
  el: HTMLElement,
  opts: {
    labels: string[];
    series: Series[];
    price: number | null;
    emphasize?: string;
    unit?: string;
    /** Value axis follows the data (default: from the unit, °C / ppm / % never start at 0). */
    scale?: boolean;
    endLabels?: boolean;
    /** false: the view writes its own legend in the page (HTML, readable at 200 %). */
    legend?: boolean;
    /** A reference line (threshold, subscribed power), dashed and labelled. */
    mark?: { value: number; label: string };
    /** Axis bounds when the question has its own range (« 50 – 100 % »). */
    min?: number;
    max?: number;
  },
) {
  const chart = instance(el);
  const unit = opts.unit ?? 'kWh';
  describe(el, opts.labels, opts.series, unit);
  // #304: end labels only when they do not overlap nor eat the plot, else a wrapping legend
  const px = axisPx();
  const width = el.clientWidth || 360;
  const ends =
    opts.endLabels !== false &&
    opts.series.length > 1 &&
    endLabelsFit(opts.series, { width, height: el.clientHeight || 300, px });
  const room = ends ? Math.max(...opts.series.map((s) => textPx(s.name, px))) + 14 : 14;
  const leg = legendLayout(
    ends || opts.legend === false ? [] : opts.series.map((s) => s.name),
    el,
    true,
  );
  const ax = axes(opts.labels, el, unit, leg.height, { zero: opts.scale === undefined ? undefined : !opts.scale, ends: room });
  const yAxis = { ...ax.yAxis, ...(opts.min !== undefined ? { min: opts.min } : {}), ...(opts.max !== undefined ? { max: opts.max } : {}) };
  chart.setOption(
    {
      animationDuration: 300,
      ...ax,
      yAxis,
      legend: leg.option,
      tooltip: tooltip(opts.price, false, unit, opts.series),
      series: opts.series.map((s, i) => {
        // #304: a point for each value of a short series and for a value isolated between gaps
        const pts = pointsToShow(s.data);
        const any = pts.some(Boolean);
        return {
          type: 'line',
          name: s.name,
          data: s.data,
          showSymbol: any,
          showAllSymbol: true,
          symbol: 'circle',
          symbolSize: (_: unknown, p: { dataIndex: number }) => (pts[p.dataIndex] ? 6 : 0),
          // a gap stays a gap: never a straight line over missing days
          connectNulls: false,
          lineStyle: { width: s.width ?? (s.name === opts.emphasize ? 3 : 2), color: s.color, type: s.dashed ? ('dashed' as const) : ('solid' as const) },
          itemStyle: { color: s.color, borderColor: cssVar('--surface-card'), borderWidth: 1 },
          // direct label at the line end (few series only)
          endLabel: { show: ends, formatter: '{a}', color: cssVar('--text-muted'), fontSize: px, distance: 6 },
          labelLayout: { moveOverlap: 'shiftY' },
          markLine: i === 0 && opts.mark ? refLine(opts.mark) : undefined,
        };
      }),
    },
    { notMerge: true },
  );
}

export function hbarChart(
  el: HTMLElement,
  opts: { labels: string[]; series: Series[]; price: number | null; onClick?: (index: number) => void; unit?: string },
) {
  const chart = instance(el);
  const unit = opts.unit ?? 'kWh';
  const width = el.clientWidth || 360;
  // #305: the ranking, read instead of the canvas
  label(el, 'Classement', rankSummary(opts.labels, opts.series[0]?.data ?? [], unit));
  const leg = legendLayout(
    opts.series.map((s) => s.name),
    el,
  );
  chart.setOption(
    {
      animationDuration: 300,
      grid: { left: 8, right: 56, top: Math.max(8, leg.height + 4), bottom: 4, ...FIT },
      legend: leg.option,
      tooltip: { ...tooltip(opts.price, false, unit), axisPointer: { type: 'shadow' as const } },
      yAxis: {
        type: 'category',
        data: opts.labels,
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        // every room named (a label hidden by overlap left a bar without a name)
        axisLabel: { color: cssVar('--text'), width: Math.round(Math.min(140, width * 0.32)), overflow: 'break', interval: 0, hideOverlap: false },
      },
      // #304: 3 ticks at most (« 0 300 600 9001 2001 500 » overlapped at 360 px)
      xAxis: {
        type: 'value',
        name: unit,
        nameLocation: 'end',
        nameGap: 6,
        nameTextStyle: { color: cssVar('--text-muted'), fontSize: axisPx(), verticalAlign: 'top', padding: [8, 0, 0, 0] },
        splitNumber: Math.min(3, splitCount(width - 180)),
        axisLabel: { hideOverlap: true, formatter: (v: number) => nf0.format(v) },
      },
      series: opts.series.map((s, i) => ({
        type: 'bar',
        name: s.name,
        data: s.colors ? s.data.map((v, j) => ({ value: v, itemStyle: { color: s.colors![j] } })) : s.data,
        barMaxWidth: 18,
        barGap: '20%',
        itemStyle: { color: s.color, borderRadius: [0, 4, 4, 0] },
        label:
          i === 0
            ? { show: true, position: 'right', color: cssVar('--text-muted'), formatter: (p: { value: number }) => nf0.format(p.value) }
            : { show: false },
        cursor: opts.onClick ? 'pointer' : 'default',
      })),
    },
    { notMerge: true },
  );
  chart.off('click');
  if (opts.onClick) chart.on('click', (p) => opts.onClick!(p.dataIndex));
}

/**
 * #306: two measures of different units on the same days, drawn as two charts aligned on the
 * same date axis (never a double axis whose scales cross at random): bars on top (hours over a
 * threshold), lines below (the value behind it, with its threshold line). `dim` greys out the
 * bars of incomplete days or nights.
 */
export function comboChart(
  el: HTMLElement,
  opts: {
    labels: string[];
    bars: Series[];
    lines: Series[];
    barUnit: string;
    lineUnit: string;
    dim?: boolean[];
    lineMark?: { value: number; label: string };
    barMax?: number;
  },
) {
  if ((el.clientHeight || 0) < 400) el.style.height = '420px';
  const chart = instance(el);
  const all = [...opts.bars.map((s) => ({ ...s, unit: opts.barUnit })), ...opts.lines.map((s) => ({ ...s, unit: opts.lineUnit }))];
  describe(el, opts.labels, all);
  const muted = cssVar('--text-muted');
  const leg = legendLayout(
    all.map((s) => s.name),
    el,
  );
  const px = axisPx();
  const h = el.clientHeight || 420;
  const top = leg.height + 8;
  const gap = px + 20; // date labels hidden on the top chart, units of the second one
  const bottom = px + 16;
  const avail = Math.max(160, h - top - gap - bottom);
  const h1 = Math.round(avail * 0.42);
  const h2 = avail - h1;
  const fmt = (v: number, unit: string) => `${nf1.format(v)} ${unit}`;
  // the threshold stays in sight even on calm nights
  const lineMax = Math.max(-Infinity, ...opts.lines.flatMap((s) => s.data).filter((v): v is number => typeof v === 'number'));
  const markMax = opts.lineMark && opts.lineMark.value > lineMax ? niceCeil(opts.lineMark.value * 1.04) : undefined;
  const xAx = (i: number) => ({
    type: 'category' as const,
    gridIndex: i,
    data: opts.labels,
    axisLabel: { show: i === 1, hideOverlap: true, ...ENDS, formatter: (l: string) => axisText(l) },
    axisTick: { show: false },
  });
  const yName = (unit: string) => ({
    name: unit,
    nameLocation: 'end' as const,
    nameGap: 8,
    nameTextStyle: { align: 'left' as const, color: muted, fontSize: px },
  });
  chart.setOption(
    {
      animationDuration: 300,
      grid: [
        { left: 8, right: 14, top, height: h1, ...FIT },
        { left: 8, right: 14, top: top + h1 + gap, height: h2, ...FIT },
      ],
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      xAxis: [xAx(0), xAx(1)],
      yAxis: [
        { type: 'value', gridIndex: 0, max: opts.barMax, minInterval: 1, splitNumber: 2, ...yName(opts.barUnit), axisLabel: { formatter: tickFmt } },
        {
          type: 'value',
          gridIndex: 1,
          scale: !zeroBased(opts.lineUnit),
          splitNumber: 3,
          max: markMax,
          ...yName(opts.lineUnit),
          axisLabel: { formatter: tickFmt },
        },
      ],
      legend: leg.option,
      tooltip: {
        ...tooltip(null, false, opts.barUnit),
        formatter: tip((params: unknown) => {
          const list = (params as { seriesIndex: number; seriesName: string; value: number | null; color: string; axisValueLabel: string }[]).filter(
            (p) => typeof p.value === 'number',
          );
          if (!list.length) return '';
          const rows = list
            .map(
              (p) =>
                `<div class="tt-row"><span class="tt-key" style="background:${p.color}"></span><strong>${fmt(p.value!, p.seriesIndex < opts.bars.length ? opts.barUnit : opts.lineUnit)}</strong><span class="tt-name">${escapeHtml(p.seriesName)}</span></div>`,
            )
            .join('');
          return `<div class="tt"><div class="tt-title">${escapeHtml(list[0].axisValueLabel)}</div>${rows}</div>`;
        }),
      },
      series: [
        ...opts.bars.map((s) => ({
          type: 'bar',
          name: s.name,
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: s.data.map((v, i) => (opts.dim?.[i] && v !== null ? { value: v, itemStyle: { opacity: 0.35 } } : v)),
          barMaxWidth: 16,
          barGap: '10%',
          itemStyle: { color: s.color, borderRadius: [3, 3, 0, 0] },
        })),
        ...opts.lines.map((s, i) => {
          const pts = pointsToShow(s.data);
          return {
            type: 'line',
            name: s.name,
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: s.data,
            showSymbol: pts.some(Boolean),
            showAllSymbol: true,
            symbol: 'circle',
            symbolSize: (_: unknown, p: { dataIndex: number }) => (pts[p.dataIndex] ? 6 : 0),
            connectNulls: false,
            lineStyle: { width: 2, color: s.color },
            itemStyle: { color: s.color },
            markLine: i === 0 && opts.lineMark ? refLine(opts.lineMark) : undefined,
          };
        }),
      ],
    },
    { notMerge: true },
  );
}

// ------------------------------------------------------------------ extra chart forms
const ttBase = () => ({
  confine: true,
});
/** Sequential blue ramp (light → dark), light/dark mode aware. */
export const seqRamp = () => [cssVar('--seq-1'), cssVar('--seq-2'), cssVar('--seq-3'), cssVar('--seq-4'), cssVar('--seq-5')];

export interface ScatterSeries {
  name: string;
  color: string;
  points: [number, number, string][]; // x °C, y kWh, label (day)
  fit?: { slope: number; intercept: number; from: number; to: number } | null;
  /** #303: a season still too short to be compared: its line is dashed. */
  provisional?: boolean;
}

export function scatterChart(el: HTMLElement, opts: { series: ScatterSeries[]; xName: string; yName: string; slopeUnit?: string }) {
  const chart = instance(el);
  const muted = cssVar('--text-muted');
  // #305: days and slope of each season, read instead of the canvas
  label(
    el,
    'Signature',
    slopeSummary(opts.series.map((s) => ({ name: s.name, days: s.points.length, slope: s.fit?.slope ?? null, unit: opts.slopeUnit ?? 'kWh par °C' }))),
  );
  const leg = legendLayout(
    opts.series.map((s) => s.name),
    el,
  );
  const grid = cssVar('--grid');
  chart.setOption(
    {
      animationDuration: 300,
      grid: { left: 24, right: 16, top: Math.max(16, leg.height + 8), bottom: 24, ...FIT },
      legend: leg.option,
      tooltip: {
        ...ttBase(),
        trigger: 'item',
        formatter: tip((p: { seriesName: string; value: [number, number, string] }) =>
          Array.isArray(p.value) && p.value.length === 3
            ? `<div class="tt"><div class="tt-title">${escapeHtml(p.value[2])}</div><div class="tt-row"><strong>${fmtKwh(p.value[1])}</strong><span class="tt-name">${nf1.format(p.value[0])} °C</span></div></div>`
            : escapeHtml(p.seriesName),
        ),
      },
      xAxis: {
        type: 'value',
        name: opts.xName,
        nameLocation: 'middle',
        nameGap: 26,
        nameTextStyle: { color: muted, fontSize: axisPx() },
        scale: true,
        axisLine: { onZero: false, lineStyle: { color: cssVar('--border') } },
        splitLine: { lineStyle: { color: grid } },
        axisLabel: { color: muted, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        name: opts.yName,
        nameLocation: 'middle',
        nameGap: 34,
        min: 0,
        nameTextStyle: { color: muted, fontSize: axisPx() },
        splitLine: { lineStyle: { color: grid } },
        axisLabel: { color: muted },
      },
      series: opts.series.flatMap((s) => [
        {
          type: 'scatter',
          name: s.name,
          data: s.points,
          symbolSize: 6,
          itemStyle: { color: s.color, opacity: s.provisional ? 0.8 : 0.55, borderColor: cssVar('--surface-card'), borderWidth: 0.5 },
        },
        ...(s.fit
          ? [
              {
                type: 'line',
                name: s.name,
                data: [
                  [s.fit.from, s.fit.slope * s.fit.from + s.fit.intercept],
                  [s.fit.to, Math.max(0, s.fit.slope * s.fit.to + s.fit.intercept)],
                ],
                showSymbol: false,
                lineStyle: { width: 2, color: s.color, type: s.provisional ? ('dashed' as const) : ('solid' as const) },
                tooltip: { show: false },
              },
            ]
          : []),
      ]),
    },
    { notMerge: true },
  );
}

export function calendarChart(el: HTMLElement, opts: { year: number; data: [string, number][]; max: number; marks?: string[]; markLabel?: string }) {
  const chart = instance(el);
  const muted = cssVar('--text-muted');
  // #305: total, mean and the day that used the most
  label(el, 'Calendrier', daysSummary(opts.data, (d) => dayLong(d)));
  chart.setOption(
    {
      tooltip: {
        ...ttBase(),
        formatter: tip(
          (p: { value: [string, number]; seriesIndex: number }) =>
            p.seriesIndex === 1
              ? `<div class="tt"><div class="tt-title">${escapeHtml(dayLong(p.value[0]))}</div>${escapeHtml(opts.markLabel ?? '')}</div>`
              : `<div class="tt"><div class="tt-title">${escapeHtml(dayLong(p.value[0]))}</div><strong>${fmtKwh(p.value[1])}</strong></div>`,
        ),
      },
      // #305: a legend with figures (0 → N kWh), not « faible / élevée »
      visualMap: {
        seriesIndex: 0,
        min: 0,
        max: Math.max(1, opts.max),
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        itemWidth: 10,
        itemHeight: 120,
        text: scaleText(Math.max(1, opts.max), 'kWh'),
        textStyle: { color: muted, fontSize: axisPx() },
        inRange: { color: seqRamp() },
      },
      calendar: {
        range: String(opts.year),
        top: axisPx() + 14,
        left: 30,
        right: 8,
        cellSize: ['auto', 13],
        splitLine: { show: false },
        itemStyle: { color: cssVar('--surface-page'), borderColor: cssVar('--surface-card'), borderWidth: 2 },
        yearLabel: { show: false },
        dayLabel: { firstDay: 1, nameMap: ['D', 'L', 'M', 'M', 'J', 'V', 'S'], color: muted, fontSize: axisPx() },
        // French month names (« FR » is not a built-in name map: it fell back to « Jan Feb »)
        monthLabel: { nameMap: MONTHS_INITIALS, color: muted, fontSize: axisPx() },
      },
      series: [
        { type: 'heatmap', coordinateSystem: 'calendar', data: opts.data },
        // S-4.10: marked days (probable absences), a dot over the cell
        ...(opts.marks?.length
          ? [{ type: 'scatter', coordinateSystem: 'calendar', data: opts.marks.map((d) => [d, 0]), symbolSize: 5, itemStyle: { color: cssVar('--text') } }]
          : []),
      ],
    },
    { notMerge: true },
  );
}
/** Month names short enough for a phone-wide year (« janv. » would overlap « févr. »). */
const MONTHS_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export function gridHeatmap(
  el: HTMLElement,
  opts: { xLabels: string[]; yLabels: string[]; data: [number, number, number][]; unit: string },
) {
  const chart = instance(el);
  const muted = cssVar('--text-muted');
  const max = Math.max(0.001, ...opts.data.map((d) => d[2]));
  const xLabels = opts.xLabels.map(axisHour);
  // #305: the peak and the lowest cell, read instead of the canvas
  label(el, 'Carte de chaleur', gridSummary(xLabels, opts.yLabels, opts.data, opts.unit));
  chart.setOption(
    {
      tooltip: {
        ...ttBase(),
        formatter: tip(
          (p: { value: [number, number, number] }) =>
            `<div class="tt"><div class="tt-title">${escapeHtml(opts.yLabels[p.value[1]])} ${escapeHtml(xLabels[p.value[0]])}</div><strong>${nf1.format(p.value[2])} ${escapeHtml(opts.unit)}</strong></div>`,
        ),
      },
      grid: { left: 8, right: 8, top: 8, bottom: 44, ...FIT },
      xAxis: { type: 'category', data: xLabels, axisLabel: { color: muted, interval: 2, hideOverlap: true }, axisTick: { show: false }, axisLine: { show: false } },
      yAxis: { type: 'category', data: opts.yLabels, inverse: true, axisLabel: { color: muted }, axisTick: { show: false }, axisLine: { show: false } },
      // #305: a legend with figures
      visualMap: {
        min: 0,
        max,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        itemWidth: 10,
        itemHeight: 120,
        text: scaleText(max, opts.unit),
        textStyle: { color: muted, fontSize: axisPx() },
        inRange: { color: seqRamp() },
      },
      series: [
        {
          type: 'heatmap',
          data: opts.data,
          itemStyle: { borderColor: cssVar('--surface-card'), borderWidth: 2, borderRadius: 3 },
        },
      ],
    },
    { notMerge: true },
  );
}

/** Stacked areas (parts of a whole) plus optional plain lines, e.g. a load curve in W. */
export function areaChart(
  el: HTMLElement,
  opts: { labels: string[]; areas: Series[]; lines?: Series[]; unit: string; zoom?: boolean },
) {
  const chart = instance(el);
  const lines = opts.lines ?? [];
  describe(el, opts.labels, [...lines, ...opts.areas], opts.unit);
  const leg = legendLayout(
    [...opts.areas, ...lines].map((s) => s.name),
    el,
  );
  chart.setOption(
    {
      animationDuration: 300,
      ...axes(opts.labels, el, opts.unit, leg.height, { zero: true }),
      legend: leg.option,
      tooltip: tooltip(null, false, opts.unit),
      dataZoom: opts.zoom ? [{ type: 'inside', minValueSpan: 4 }] : [],
      series: [
        ...opts.areas.map((s) => ({
          type: 'line',
          name: s.name,
          data: s.data,
          stack: 'parts',
          showSymbol: false,
          lineStyle: { width: 0 },
          areaStyle: { color: s.color, opacity: 0.85 },
          itemStyle: { color: s.color },
        })),
        ...lines.map((s) => ({
          type: 'line',
          name: s.name,
          data: s.data,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 2, color: s.color },
          itemStyle: { color: s.color },
        })),
      ],
    },
    { notMerge: true },
  );
}

/**
 * What changed between two periods, room by room: one horizontal bar per room from 0 (rise to
 * the right in red, fall to the left in green), with the start and end totals written above.
 * #304 / audit § 6.1: the former waterfall had to zoom its axis (4 500 → 6 300 kWh) to show the
 * steps, so its bars lied about the totals; an axis through 0 does not.
 */
export function waterfallChart(
  el: HTMLElement,
  opts: { startLabel: string; endLabel: string; start: number; steps: { name: string; delta: number }[] },
) {
  const chart = instance(el);
  const muted = cssVar('--text-muted');
  const end = opts.start + opts.steps.reduce((a, s) => a + s.delta, 0);
  const pctTxt = opts.start > 0 ? ` (${signedPct(((end - opts.start) / opts.start) * 100)})` : '';
  chartCaption(el, `${opts.startLabel} : ${fmtKwh(opts.start)} → ${opts.endLabel} : ${fmtKwh(end)}${pctTxt}`);
  label(el, 'Évolution par pièce', changeSummary({ label: opts.startLabel, value: opts.start }, { label: opts.endLabel, value: end }, opts.steps));
  const steps = opts.steps.slice().sort((a, b) => a.delta - b.delta);
  const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf0.format(Math.abs(v))}`;
  const span = Math.max(1, ...steps.map((s) => Math.abs(s.delta)));
  // room for the value written past the end of the longest bar, on the side(s) used
  const maxUp = Math.max(0, ...steps.map((s) => s.delta));
  const maxDown = Math.max(0, ...steps.map((s) => -s.delta));
  const width = el.clientWidth || 360;
  el.style.height = `${Math.max(160, steps.length * 34 + 60)}px`;
  chart.setOption(
    {
      animationDuration: 300,
      grid: { left: 8, right: 16, top: 8, bottom: 8, ...FIT },
      tooltip: {
        ...ttBase(),
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: tip((ps: { dataIndex: number }[]) => {
          const s = steps[ps[0].dataIndex];
          return `<div class="tt"><div class="tt-title">${escapeHtml(s.name)}</div><strong>${escapeHtml(signed(s.delta))} kWh</strong><div class="tt-note">${escapeHtml(`${opts.startLabel} → ${opts.endLabel}`)}</div></div>`;
        }),
      },
      yAxis: {
        type: 'category',
        data: steps.map((s) => s.name),
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: cssVar('--text'), width: Math.round(Math.min(140, width * 0.32)), overflow: 'break', interval: 0, hideOverlap: false },
      },
      xAxis: {
        type: 'value',
        // one scale on both sides of 0, with room for the value written at the end of each bar
        min: maxDown ? -(maxDown + span * 0.9) : -span * 0.1,
        max: maxUp ? maxUp + span * 0.9 : span * 0.1,
        splitNumber: 2,
        axisLabel: { show: false },
        splitLine: { show: false },
        axisLine: { show: false },
      },
      series: [
        {
          type: 'bar',
          name: 'Écart',
          barMaxWidth: 18,
          data: steps.map((s) => ({
            value: Math.round(s.delta),
            itemStyle: { color: cssVar(s.delta > 0 ? '--state-bad' : '--state-good'), borderRadius: s.delta > 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] },
            label: { position: s.delta > 0 ? 'right' : 'left' },
          })),
          label: { show: true, color: muted, fontSize: axisPx(), formatter: (p: { value: number }) => `${signed(p.value)} kWh` },
          markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: cssVar('--border-strong'), type: 'solid', width: 1 }, data: [{ xAxis: 0 }] },
        },
      ],
    },
    { notMerge: true },
  );
}
