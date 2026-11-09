// ECharts wrapper: modular import (smaller bundle) + theme read from CSS tokens.

import { BarChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { type Measure, summarize } from './summary';
import { node } from './trusted';

echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  CalendarComponent,
  VisualMapComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

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
  return { color: cssVar('--surface-1') || 'rgba(255,255,255,0.7)', symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 3], rotation: -Math.PI / 4 };
}

function instance(el: HTMLElement): echarts.ECharts {
  // S-7.6: a chart with a summary can be reached with the keyboard, which reads that summary.
  if (el.getAttribute('role') === 'img' && !el.hasAttribute('tabindex')) el.tabIndex = 0;
  const chart = echarts.getInstanceByDom(el) ?? echarts.init(el);
  if (!observed.has(el)) {
    new ResizeObserver(() => chart.resize()).observe(el);
    observed.add(el);
  }
  return chart;
}

export function disposeAll(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.chart').forEach((el) => echarts.getInstanceByDom(el)?.dispose());
}

function tooltip(price: number | null, showTotal: boolean, unit = 'kWh', series: Series[] = [], notes?: (string | null)[]) {
  const fmt = (v: number) => (unit === 'kWh' ? fmtKwh(v) : `${nf1.format(v)} ${unit}`);
  const note = (t: string | null | undefined) => (t ? `<div class="tt-note">${escapeHtml(t)}</div>` : '');
  return {
    trigger: 'axis' as const,
    confine: true,
    backgroundColor: cssVar('--surface-raised'),
    borderColor: cssVar('--border'),
    textStyle: { color: cssVar('--text-primary'), fontFamily: 'inherit', fontSize: 12 },
    axisPointer: { type: 'line' as const, lineStyle: { color: cssVar('--text-muted'), width: 1 } },
    formatter: tip((params: unknown) => {
      const list = (
        params as { seriesName: string; seriesIndex: number; dataIndex: number; value: number | null; color: string; axisValueLabel: string }[]
      ).filter((p) => p.value !== null && p.value !== undefined);
      if (!list.length) return '';
      const rows = list
        .map(
          (p) =>
            `<div class="tt-row"><span class="tt-key" style="background:${p.color}"></span><strong>${fmt(p.value!)}</strong><span class="tt-name">${escapeHtml(p.seriesName)}</span></div>${note(series[p.seriesIndex]?.notes?.[p.dataIndex])}`,
        )
        .join('');
      const sum = list.reduce((s, p) => s + (p.value ?? 0), 0);
      const totalRow =
        showTotal && list.length > 1
          ? `<div class="tt-row tt-total"><strong>${fmtKwh(sum)}</strong><span class="tt-name">Total${price ? ` · ${nf0.format(sum * price)} €` : ''}</span></div>`
          : price && list.length === 1
            ? `<div class="tt-row tt-total"><span class="tt-name">${nf0.format(sum * price)} €</span></div>`
            : '';
      return `<div class="tt"><div class="tt-title">${escapeHtml(list[0].axisValueLabel)}</div>${note(notes?.[list[0].dataIndex])}${rows}${totalRow}</div>`;
    }),
  };
}

function axes(labels: string[]) {
  const muted = cssVar('--text-muted');
  return {
    grid: { left: 8, right: 12, top: 36, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category' as const,
      data: labels,
      axisLine: { lineStyle: { color: cssVar('--border') } },
      axisTick: { show: false },
      axisLabel: { color: muted, hideOverlap: true },
    },
    yAxis: {
      type: 'value' as const,
      splitLine: { lineStyle: { color: cssVar('--grid') } },
      axisLabel: { color: muted, formatter: (v: number) => (v !== 0 && Math.abs(v) < 10 ? nf1 : nf0).format(v) },
    },
  };
}

function legend(series: Series[]) {
  return {
    show: series.length > 1,
    top: 0,
    left: 0,
    type: 'scroll' as const,
    icon: 'roundRect',
    itemWidth: 12,
    itemHeight: 12,
    textStyle: { color: cssVar('--text-secondary') },
    pageTextStyle: { color: cssVar('--text-secondary') },
  };
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
  },
) {
  const surface = cssVar('--surface-1');
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
  const chart = instance(el);
  describe(el, opts.labels, opts.series, opts.unit);
  chart.setOption(
    {
      animationDuration: 300,
      ...axes(opts.labels),
      legend: legend(opts.series),
      tooltip: tooltip(opts.price, opts.stacked && !opts.unit, opts.unit, opts.series, opts.notes),
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
      })),
    },
    { notMerge: true },
  );
}

export function lineChart(
  el: HTMLElement,
  opts: { labels: string[]; series: Series[]; price: number | null; emphasize?: string; unit?: string; scale?: boolean; endLabels?: boolean },
) {
  const chart = instance(el);
  describe(el, opts.labels, opts.series, opts.unit);
  const ax = axes(opts.labels);
  const ends = opts.endLabels !== false && opts.series.length <= 4;
  chart.setOption(
    {
      animationDuration: 300,
      ...ax,
      // zoomed axis (°C around 20): keep one decimal so ticks never repeat
      yAxis: opts.scale ? { ...ax.yAxis, scale: true, axisLabel: { ...ax.yAxis.axisLabel, formatter: (v: number) => nf1.format(v) } } : ax.yAxis,
      legend: { ...legend(opts.series), icon: 'rect', itemWidth: 14, itemHeight: 3 },
      tooltip: tooltip(opts.price, false, opts.unit, opts.series),
      series: opts.series.map((s) => ({
        type: 'line',
        name: s.name,
        data: s.data,
        showSymbol: false,
        symbolSize: 8,
        connectNulls: false,
        lineStyle: { width: s.name === opts.emphasize ? 3 : 2, color: s.color },
        itemStyle: { color: s.color, borderColor: cssVar('--surface-1'), borderWidth: 2 },
        // direct label at the line end (few series only)
        endLabel: {
          show: ends,
          formatter: '{a}',
          color: cssVar('--text-secondary'),
          fontSize: 11,
        },
      })),
      grid: { left: 8, right: ends ? 48 : 12, top: 36, bottom: 8, containLabel: true },
    },
    { notMerge: true },
  );
}

export function hbarChart(
  el: HTMLElement,
  opts: { labels: string[]; series: Series[]; price: number | null; onClick?: (index: number) => void },
) {
  const chart = instance(el);
  const muted = cssVar('--text-muted');
  chart.setOption(
    {
      animationDuration: 300,
      grid: { left: 8, right: 64, top: 28, bottom: 4, containLabel: true },
      legend: legend(opts.series),
      tooltip: { ...tooltip(opts.price, false), axisPointer: { type: 'shadow' as const } },
      yAxis: {
        type: 'category',
        data: opts.labels,
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: cssVar('--text-secondary'), width: 110, overflow: 'truncate' },
      },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: cssVar('--grid') } }, axisLabel: { color: muted, formatter: (v: number) => nf0.format(v) } },
      series: opts.series.map((s, i) => ({
        type: 'bar',
        name: s.name,
        data: s.colors ? s.data.map((v, j) => ({ value: v, itemStyle: { color: s.colors![j] } })) : s.data,
        barMaxWidth: 18,
        barGap: '20%',
        itemStyle: { color: s.color, borderRadius: [0, 4, 4, 0] },
        label:
          i === 0
            ? { show: true, position: 'right', color: cssVar('--text-secondary'), formatter: (p: { value: number }) => nf0.format(p.value) }
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
 * Bars (left axis) and lines (right axis) on the same days: hours over a threshold and the
 * value behind it (S-11). `dim` greys out bars of incomplete days or nights.
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
  const chart = instance(el);
  describe(el, opts.labels, [...opts.bars.map((s) => ({ ...s, unit: opts.barUnit })), ...opts.lines.map((s) => ({ ...s, unit: opts.lineUnit }))]);
  const muted = cssVar('--text-muted');
  const base = axes(opts.labels);
  const all = [...opts.bars, ...opts.lines];
  const fmt = (v: number, unit: string) => `${nf1.format(v)} ${unit}`;
  chart.setOption(
    {
      animationDuration: 300,
      grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
      xAxis: base.xAxis,
      yAxis: [
        { ...base.yAxis, max: opts.barMax, minInterval: 1, axisLabel: { color: muted, formatter: (v: number) => `${nf0.format(v)} ${opts.barUnit}` } },
        { type: 'value', scale: true, splitLine: { show: false }, axisLabel: { color: muted, formatter: (v: number) => `${nf0.format(v)} ${opts.lineUnit}` } },
      ],
      legend: legend(all),
      tooltip: {
        ...tooltip(null, false, opts.barUnit),
        formatter: tip((params: unknown) => {
          const list = (params as { seriesIndex: number; seriesName: string; value: number | null; color: string; axisValueLabel: string }[]).filter(
            (p) => p.value !== null && p.value !== undefined,
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
          yAxisIndex: 0,
          data: s.data.map((v, i) => (opts.dim?.[i] && v !== null ? { value: v, itemStyle: { opacity: 0.35 } } : v)),
          barMaxWidth: 16,
          barGap: '10%',
          itemStyle: { color: s.color, borderRadius: [3, 3, 0, 0] },
        })),
        ...opts.lines.map((s, i) => ({
          type: 'line',
          name: s.name,
          yAxisIndex: 1,
          data: s.data,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 2, color: s.color },
          itemStyle: { color: s.color },
          markLine:
            i === 0 && opts.lineMark
              ? {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: muted, type: 'dashed', width: 1 },
                  label: { color: muted, formatter: opts.lineMark.label, position: 'insideEndTop' },
                  data: [{ yAxis: opts.lineMark.value }],
                }
              : undefined,
        })),
      ],
    },
    { notMerge: true },
  );
}

// ------------------------------------------------------------------ extra chart forms
const ttBase = () => ({
  confine: true,
  backgroundColor: cssVar('--surface-raised'),
  borderColor: cssVar('--border'),
  textStyle: { color: cssVar('--text-primary'), fontFamily: 'inherit', fontSize: 12 },
});
/** Sequential blue ramp (light → dark), light/dark mode aware. */
export const seqRamp = () => [cssVar('--seq-1'), cssVar('--seq-2'), cssVar('--seq-3'), cssVar('--seq-4'), cssVar('--seq-5')];

export interface ScatterSeries {
  name: string;
  color: string;
  points: [number, number, string][]; // x °C, y kWh, label (day)
  fit?: { slope: number; intercept: number; from: number; to: number } | null;
}

export function scatterChart(el: HTMLElement, opts: { series: ScatterSeries[]; xName: string; yName: string }) {
  const chart = instance(el);
  const muted = cssVar('--text-muted');
  chart.setOption(
    {
      animationDuration: 300,
      grid: { left: 24, right: 16, top: 36, bottom: 24, containLabel: true },
      legend: legend(opts.series.map((s) => ({ name: s.name, color: s.color, data: [] }))),
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
        nameTextStyle: { color: muted },
        scale: true,
        axisLine: { onZero: false, lineStyle: { color: cssVar('--border') } },
        splitLine: { lineStyle: { color: cssVar('--grid') } },
        axisLabel: { color: muted },
      },
      yAxis: {
        type: 'value',
        name: opts.yName,
        nameLocation: 'middle',
        nameGap: 34,
        nameTextStyle: { color: muted },
        splitLine: { lineStyle: { color: cssVar('--grid') } },
        axisLabel: { color: muted },
      },
      series: opts.series.flatMap((s) => [
        {
          type: 'scatter',
          name: s.name,
          data: s.points,
          symbolSize: 6,
          itemStyle: { color: s.color, opacity: 0.55, borderColor: cssVar('--surface-1'), borderWidth: 0.5 },
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
                lineStyle: { width: 2, color: s.color },
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
  chart.setOption(
    {
      tooltip: {
        ...ttBase(),
        formatter: tip(
          (p: { value: [string, number]; seriesIndex: number }) =>
            p.seriesIndex === 1
              ? `<div class="tt"><div class="tt-title">${escapeHtml(p.value[0])}</div>${escapeHtml(opts.markLabel ?? '')}</div>`
              : `<div class="tt"><div class="tt-title">${escapeHtml(p.value[0])}</div><strong>${fmtKwh(p.value[1])}</strong></div>`,
        ),
      },
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
        text: ['élevée', 'faible'],
        textStyle: { color: muted },
        inRange: { color: seqRamp() },
      },
      calendar: {
        range: String(opts.year),
        top: 28,
        left: 30,
        right: 8,
        cellSize: ['auto', 13],
        splitLine: { show: false },
        itemStyle: { color: cssVar('--surface-0'), borderColor: cssVar('--surface-1'), borderWidth: 2 },
        yearLabel: { show: false },
        dayLabel: { firstDay: 1, nameMap: ['D', 'L', 'M', 'M', 'J', 'V', 'S'], color: muted, fontSize: 10 },
        monthLabel: { nameMap: 'FR', color: muted, fontSize: 10 },
      },
      series: [
        { type: 'heatmap', coordinateSystem: 'calendar', data: opts.data },
        // S-4.10: marked days (probable absences), a dot over the cell
        ...(opts.marks?.length
          ? [{ type: 'scatter', coordinateSystem: 'calendar', data: opts.marks.map((d) => [d, 0]), symbolSize: 5, itemStyle: { color: cssVar('--text-primary') } }]
          : []),
      ],
    },
    { notMerge: true },
  );
}

export function gridHeatmap(
  el: HTMLElement,
  opts: { xLabels: string[]; yLabels: string[]; data: [number, number, number][]; unit: string },
) {
  const chart = instance(el);
  const muted = cssVar('--text-muted');
  const max = Math.max(0.001, ...opts.data.map((d) => d[2]));
  chart.setOption(
    {
      tooltip: {
        ...ttBase(),
        formatter: tip(
          (p: { value: [number, number, number] }) =>
            `<div class="tt"><div class="tt-title">${escapeHtml(opts.yLabels[p.value[1]])} ${escapeHtml(opts.xLabels[p.value[0]])}</div><strong>${nf1.format(p.value[2])} ${escapeHtml(opts.unit)}</strong></div>`,
        ),
      },
      grid: { left: 8, right: 8, top: 8, bottom: 44, containLabel: true },
      xAxis: { type: 'category', data: opts.xLabels, axisLabel: { color: muted, interval: 2 }, axisTick: { show: false }, axisLine: { show: false } },
      yAxis: { type: 'category', data: opts.yLabels, inverse: true, axisLabel: { color: muted }, axisTick: { show: false }, axisLine: { show: false } },
      visualMap: {
        min: 0,
        max,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        itemWidth: 10,
        itemHeight: 120,
        text: ['élevée', 'faible'],
        textStyle: { color: muted },
        inRange: { color: seqRamp() },
      },
      series: [
        {
          type: 'heatmap',
          data: opts.data,
          itemStyle: { borderColor: cssVar('--surface-1'), borderWidth: 2, borderRadius: 3 },
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
  chart.setOption(
    {
      animationDuration: 300,
      ...axes(opts.labels),
      legend: legend([...opts.areas, ...lines]),
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

/** Waterfall: start total → one bar per room delta → end total. */
export function waterfallChart(
  el: HTMLElement,
  opts: { startLabel: string; endLabel: string; start: number; steps: { name: string; delta: number }[] },
) {
  const chart = instance(el);
  const muted = cssVar('--text-muted');
  const labels = [opts.startLabel, ...opts.steps.map((s) => s.name), opts.endLabel];
  const base: (number | string)[] = [0];
  const up: (number | string)[] = ['-'];
  const down: (number | string)[] = ['-'];
  const totals: (number | string)[] = [Math.round(opts.start)];
  let acc = opts.start;
  for (const s of opts.steps) {
    const next = acc + s.delta;
    base.push(Math.round(Math.min(acc, next)));
    up.push(s.delta >= 0 ? Math.round(s.delta) : '-');
    down.push(s.delta < 0 ? Math.round(-s.delta) : '-');
    totals.push('-');
    acc = next;
  }
  base.push(0);
  up.push('-');
  down.push('-');
  totals.push(Math.round(acc));
  const lowest = Math.min(opts.start, acc, ...base.filter((v): v is number => typeof v === 'number' && v > 0));
  chart.setOption(
    {
      grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, textStyle: { color: cssVar('--text-secondary') }, icon: 'roundRect', itemWidth: 12, itemHeight: 12, data: ['Hausse', 'Baisse'] },
      tooltip: {
        ...ttBase(),
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: tip((ps: { dataIndex: number }[]) => {
          const i = ps[0].dataIndex;
          const v = i === 0 ? opts.start : i === labels.length - 1 ? acc : opts.steps[i - 1].delta;
          const txt = i === 0 || i === labels.length - 1 ? fmtKwh(v) : `${v > 0 ? '+' : '−'}${fmtKwh(Math.abs(v))}`;
          return `<div class="tt"><div class="tt-title">${escapeHtml(labels[i])}</div><strong>${txt}</strong></div>`;
        }),
      },
      xAxis: { type: 'category', data: labels, axisLabel: { color: muted, interval: 0, rotate: labels.length > 6 ? 35 : 0 }, axisTick: { show: false } },
      yAxis: {
        type: 'value',
        // Zoom on the band where things change; the totals bars are clipped at the bottom.
        min: Math.max(0, Math.floor((lowest * 0.85) / 100) * 100),
        splitLine: { lineStyle: { color: cssVar('--grid') } },
        axisLabel: { color: muted, formatter: (v: number) => nf0.format(v) },
      },
      series: [
        { type: 'bar', stack: 'w', data: base, itemStyle: { color: 'transparent' }, emphasis: { disabled: true }, tooltip: { show: false } },
        { type: 'bar', stack: 'w', name: 'Total', data: totals, itemStyle: { color: cssVar('--text-secondary'), borderRadius: [4, 4, 0, 0] }, barMaxWidth: 36 },
        { type: 'bar', stack: 'w', name: 'Hausse', data: up, itemStyle: { color: cssVar('--bad'), borderRadius: [4, 4, 0, 0] }, barMaxWidth: 36 },
        { type: 'bar', stack: 'w', name: 'Baisse', data: down, itemStyle: { color: cssVar('--good'), borderRadius: [4, 4, 0, 0] }, barMaxWidth: 36 },
      ],
    },
    { notMerge: true },
  );
}
