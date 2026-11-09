// ECharts wrapper: modular import (smaller bundle) + theme read from CSS tokens.

import { BarChart, LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

export interface Series {
  name: string;
  color: string;
  data: (number | null)[];
  /** Optional per-bar colours (identity per category on a single series). */
  colors?: string[];
}

export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
export const fmtKwh = (v: number) => `${(Math.abs(v) < 100 ? nf1 : nf0).format(v)} kWh`;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const observed = new WeakSet<HTMLElement>();

function instance(el: HTMLElement): echarts.ECharts {
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

function tooltip(price: number | null, showTotal: boolean) {
  return {
    trigger: 'axis' as const,
    confine: true,
    backgroundColor: cssVar('--surface-raised'),
    borderColor: cssVar('--border'),
    textStyle: { color: cssVar('--text-primary'), fontFamily: 'inherit', fontSize: 12 },
    axisPointer: { type: 'line' as const, lineStyle: { color: cssVar('--text-muted'), width: 1 } },
    formatter: (params: unknown) => {
      const list = (params as { seriesName: string; value: number | null; color: string; axisValueLabel: string }[]).filter(
        (p) => p.value !== null && p.value !== undefined,
      );
      if (!list.length) return '';
      const rows = list
        .map(
          (p) =>
            `<div class="tt-row"><span class="tt-key" style="background:${p.color}"></span><strong>${fmtKwh(p.value!)}</strong><span class="tt-name">${escapeHtml(p.seriesName)}</span></div>`,
        )
        .join('');
      const sum = list.reduce((s, p) => s + (p.value ?? 0), 0);
      const totalRow =
        showTotal && list.length > 1
          ? `<div class="tt-row tt-total"><strong>${fmtKwh(sum)}</strong><span class="tt-name">Total${price ? ` · ${nf0.format(sum * price)} €` : ''}</span></div>`
          : price && list.length === 1
            ? `<div class="tt-row tt-total"><span class="tt-name">${nf0.format(sum * price)} €</span></div>`
            : '';
      return `<div class="tt"><div class="tt-title">${escapeHtml(list[0].axisValueLabel)}</div>${rows}${totalRow}</div>`;
    },
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
      axisLabel: { color: muted, formatter: (v: number) => nf0.format(v) },
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
  opts: { labels: string[]; series: Series[]; stacked: boolean; price: number | null; zoom?: boolean },
) {
  const surface = cssVar('--surface-1');
  const n = opts.series.length;
  const chart = instance(el);
  chart.setOption(
    {
      animationDuration: 300,
      ...axes(opts.labels),
      legend: legend(opts.series),
      tooltip: tooltip(opts.price, opts.stacked),
      dataZoom: opts.zoom ? [{ type: 'inside', minValueSpan: 6 }] : [],
      series: opts.series.map((s, i) => ({
        type: 'bar',
        name: s.name,
        data: s.data,
        stack: opts.stacked ? 'total' : undefined,
        barMaxWidth: 28,
        barGap: '15%',
        itemStyle: {
          color: s.color,
          // rounded data-end only on the top segment of a stack; surface hairline separates segments
          borderRadius: !opts.stacked || i === n - 1 ? [4, 4, 0, 0] : 0,
          borderColor: surface,
          borderWidth: opts.stacked ? 1 : 0,
        },
        emphasis: { focus: 'none', itemStyle: { opacity: 0.85 } },
      })),
    },
    { notMerge: true },
  );
}

export function lineChart(el: HTMLElement, opts: { labels: string[]; series: Series[]; price: number | null; emphasize?: string }) {
  const chart = instance(el);
  chart.setOption(
    {
      animationDuration: 300,
      ...axes(opts.labels),
      legend: { ...legend(opts.series), icon: 'rect', itemWidth: 14, itemHeight: 3 },
      tooltip: tooltip(opts.price, false),
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
          show: opts.series.length <= 4,
          formatter: '{a}',
          color: cssVar('--text-secondary'),
          fontSize: 11,
        },
      })),
      grid: { left: 8, right: opts.series.length <= 4 ? 48 : 12, top: 36, bottom: 8, containLabel: true },
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
