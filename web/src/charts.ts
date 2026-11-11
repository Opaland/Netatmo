// ECharts wrapper: modular import (smaller bundle) + theme read from CSS tokens.

import type { ECharts, EChartsCoreOption, SetOptionOpts } from 'echarts/core';
import {
  axisHour,
  axisText,
  buildTheme,
  categoryLabels,
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
import { dayLong, signedPct, withUnit } from './glossary';
import { type Measure, changeSummary, daysSummary, gridSummary, rankSummary, slopeSummary, summarize } from './summary';
import { html, node } from './trusted';
import { track } from './ready';
import { CHART_DEFAULT, type ChartPrefs, keepLastYear, movingAverage, SMOOTH_DAYS, smoothable, zeroAxis } from './chart-prefs';

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
  /** #20: the same period a year before (« Un an plus tôt »), hidden by the chart settings. */
  lastYear?: boolean;
}

// #20: « Réglages du graphique » of this device (chart-prefs.ts), set by main.ts before each render
let prefs: ChartPrefs = CHART_DEFAULT;
export const useChartPrefs = (p: ChartPrefs) => void (prefs = p);

export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
export const fmtKwh = (v: number) => withUnit((Math.abs(v) < 100 ? nf1 : nf0).format(v), 'kWh');

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

/**
 * #439: dispose a chart that may still be painting. zrender paints a layer of « incremental »
 * elements in slices of 15 ms and schedules the next slice with requestAnimationFrame; dispose()
 * does not cancel it, and the slice then paints a disposed painter (« Cannot read properties of
 * null (reading 'layerStack') », zrender 6.1 Painter._paintList). ECharts 6.1 marks every heatmap
 * cell incremental, so a slow device (a loaded CI runner) leaving « Journée type » mid-paint threw.
 * A pending slice stops when the painter's redraw id is no longer its own (the check _paintList
 * makes first): clearing it before dispose() ends the slice instead of painting nothing into null.
 * Seen red without it in e2e/compteur.mjs (a clock that makes every slice run out).
 */
function disposeChart(chart: ECharts) {
  const painter = (chart.getZr() as unknown as { painter?: { _redrawId?: unknown } } | null)?.painter;
  if (painter) painter._redrawId = null;
  chart.dispose();
}

function real(el: HTMLElement, l: Lib): ECharts {
  const key = currentTheme(l);
  let chart = l.getInstanceByDom(el);
  if (chart && themeOf.get(chart) !== key) {
    disposeChart(chart);
    chart = undefined;
  }
  if (!chart) {
    chart = l.init(el, key);
    themeOf.set(chart, key);
  }
  if (!observed.has(el)) {
    // #439: the chart of the element now (one recreated for another theme replaces the first),
    // never a disposed one, nothing once the element has left the page
    new ResizeObserver(() => {
      if (el.isConnected) l.getInstanceByDom(el)?.resize();
    }).observe(el);
    observed.add(el);
  }
  return chart;
}

/** Runs f on the element's chart now if ECharts is there, else in call order once it has loaded. */
function run(el: HTMLElement, f: (c: ECharts) => void) {
  // #413: a chart drawn in HTML rows meanwhile is not redrawn on a canvas
  if (el.hasAttribute('data-rows')) return;
  if (lib) return f(real(el, lib));
  loadCharts().then(
    (l) => {
      // the view was replaced meanwhile: nothing to draw
      if (el.isConnected && !el.hasAttribute('data-rows')) f(real(el, l));
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

/** Sliders, the icon of « Réglages du graphique ». */
const SLIDERS =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>';

/**
 * #20: the button that opens the « Réglages du graphique » sheet (chart-sheet.ts), written once
 * under every chart of the app; the sheet is common to all of them.
 */
function settingsButton(el: HTMLElement) {
  const next = el.nextElementSibling;
  if (next instanceof HTMLElement && next.dataset.chartSettings !== undefined) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn tertiary chart-settings';
  b.dataset.chartSettings = el.id || '';
  b.setAttribute('aria-haspopup', 'dialog');
  // a short visible label, so that it shares the line of « Voir les valeurs » (the Accueil holds
  // in 3 phone screens, #311); the full name for assistive tech (it contains the visible word)
  b.setAttribute('aria-label', 'Réglages du graphique');
  b.innerHTML = html(`${SLIDERS}<span>Réglages</span>`);
  el.after(b);
}

function instance(el: HTMLElement): ChartHandle {
  // S-7.6: a chart with a summary can be reached with the keyboard, which reads that summary.
  if (el.getAttribute('role') === 'img' && !el.hasAttribute('tabindex')) el.tabIndex = 0;
  if (el.isConnected) settingsButton(el);
  return chartOf(el);
}

export function disposeAll(root: HTMLElement) {
  const l = lib;
  if (!l) return;
  root.querySelectorAll<HTMLElement>('.chart').forEach((el) => {
    const chart = l.getInstanceByDom(el);
    if (chart) disposeChart(chart);
  });
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
      // #311: a series in another unit (outdoor temperature over kWh bars) is shown with its unit, out of the total
      const own = (p: { seriesIndex: number }) => {
        const u = series[p.seriesIndex]?.unit;
        return u && u !== unit ? u : null;
      };
      const rows = list
        .map(
          (p) =>
            `<div class="tt-row"><span class="tt-key" style="background:${p.color}"></span><strong>${fmt(p.value!, series[p.seriesIndex]?.unit ?? unit)}</strong><span class="tt-name">${escapeHtml(p.seriesName)}</span></div>${note(series[p.seriesIndex]?.notes?.[p.dataIndex])}`,
        )
        .join('');
      const counted = list.filter((p) => !own(p));
      const sum = counted.reduce((s, p) => s + (p.value ?? 0), 0);
      const totalRow =
        showTotal && counted.length > 1
          ? `<div class="tt-row tt-total"><strong>${fmtKwh(sum)}</strong><span class="tt-name">Total${price ? ` · ≈ ${nf0.format(sum * price)} €` : ''}</span></div>`
          : price && counted.length === 1
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

/**
 * #398: decimals a tick needs to be written exactly — 20 → 0, 19,5 → 1, 0,25 → 2 (at most 3).
 * Every tick of a value axis is a multiple of its step, so a tick shows the precision of the step
 * wherever it is not on a coarser multiple, and two different ticks never read the same (the old
 * « one decimal under 10 » wrote 19,5 and 20,5 as « 20 » and « 21 »: « 21, 21, 20, 20 »).
 * ECharts gives a formatter the value, not the step: the precision is read on the value.
 */
export function tickDecimals(v: number): number {
  for (let d = 0; d < 3; d++) {
    const x = v * 10 ** d;
    if (Math.abs(x - Math.round(x)) < 1e-6) return d;
  }
  return 3;
}
const nfd = [0, 1, 2, 3].map((d) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }));
/** Label of a value-axis tick (every value axis of every chart): « 19,5 », « 1 500 », « −0,2 ». */
export const tickFmt = (v: number) => minus(nfd[tickDecimals(v)].format(v));
/**
 * The tick formatter of one value axis of one chart. It also notes, for the sweep (e2e/sweep.mjs,
 * invariant « etiquettes-axe-en-double »), the labels it wrote for two different values in its
 * last drawing: `data-axis-dup-<axis>` on the chart element, absent when every label differs.
 * Values with more than two decimals (an axis pointer, not a tick) are not noted.
 */
function axisFmt(el: HTMLElement, axis: string, suffix = '') {
  let seen: Map<string, Set<number>> | null = null;
  return (v: number) => {
    const label = tickFmt(v);
    if (tickDecimals(v) < 3) {
      if (!seen) {
        const batch = (seen = new Map());
        // one drawing calls the formatter for every tick in a row: read them once it is done
        queueMicrotask(() => {
          const dup = [...batch].filter(([, vals]) => vals.size > 1).map(([l]) => l);
          if (dup.length) el.setAttribute(`data-axis-dup-${axis}`, dup.join(' | '));
          else el.removeAttribute(`data-axis-dup-${axis}`);
          if (seen === batch) seen = null;
        });
      }
      const vals = seen.get(label) ?? new Set<number>();
      vals.add(Math.round(v * 1e6) / 1e6);
      seen.set(label, vals);
    }
    return suffix ? `${label} ${suffix}` : label;
  };
}
/**
 * #413: notes on the chart element, for the sweep (e2e/sweep.mjs, invariant
 * « etiquettes-axe-recouvertes »), the neighbouring category labels whose estimated boxes cross
 * (`data-axis-overlap-y`, absent when they all fit): the canvas has no text the sweep can read.
 */
function noteOverlap(el: HTMLElement, overlaps: string[]) {
  if (overlaps.length) el.setAttribute('data-axis-overlap-y', overlaps.join(' | '));
  else el.removeAttribute('data-axis-overlap-y');
}
/** Width of the category labels of a horizontal bar chart (they wrap inside it). */
const hLabelWidth = (width: number) => Math.round(Math.min(140, width * 0.32));

/** #413: one row of a horizontal bar chart drawn in HTML: a name, then one bar per series. */
interface BarRow {
  label: string;
  bars: { value: number; color: string; text: string; alt?: boolean }[];
}

/**
 * #413: a horizontal bar chart drawn in HTML rows — the name above its bar(s), the value at the
 * end, as the cascade of « Expliquer un mois » (#369) — when its canvas labels would not fit
 * (text 200 %, narrow screen: « Chauffe-eau » drawn over « Chambre parentale »). The names wrap
 * like any text, never over each other, and the sweep reads them in the DOM. `min` < 0 for a
 * chart on both sides of 0; `valueWidth`: the same value column on every row, so 0 stays aligned.
 * The rows are hidden from screen readers: the element's summary (role="img") reads them.
 */
function barRows(
  el: HTMLElement,
  rows: BarRow[],
  opts: { min: number; max: number; valueWidth: string; legend?: { name: string; color: string }[]; onClick?: (index: number) => void },
) {
  const drawn = lib?.getInstanceByDom(el);
  if (drawn) disposeChart(drawn); // #439: it may still be painting
  el.setAttribute('data-rows', '');
  el.removeAttribute('data-axis-overlap-y');
  if (el.dataset.canvasHeight === undefined) el.dataset.canvasHeight = el.style.height;
  el.style.height = 'auto';
  const span = opts.max - opts.min || 1;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / span) * 100)).toFixed(2)}%`;
  const zero = -opts.min;
  const legend =
    opts.legend && opts.legend.length > 1
      ? `<p class="hbars-legend">${opts.legend.map((l) => `<span><i style="background:${escapeHtml(l.color)}"></i>${escapeHtml(l.name)}</span>`).join('')}</p>`
      : '';
  const bar = (b: BarRow['bars'][number]) =>
    `<span class="hbar-bar"><span class="hbar-track"><i${b.alt ? ' class="alt"' : ''} style="left:${pct(b.value < 0 ? zero + b.value : zero)};width:${pct(Math.abs(b.value))};background-color:${escapeHtml(b.color)}"></i></span><span class="hbar-value${b.alt ? ' muted' : ''}">${escapeHtml(b.text)}</span></span>`;
  el.innerHTML = html(
    `<div class="hbars" aria-hidden="true" style="--zero:${pct(zero)};--value-w:${opts.valueWidth}">${legend}${rows
      .map((r, i) => `<div class="hbar-row${opts.onClick ? ' hbar-link' : ''}" data-index="${i}"><span class="hbar-label">${escapeHtml(r.label)}</span>${r.bars.map(bar).join('')}</div>`)
      .join('')}</div>`,
  );
  el.onclick = opts.onClick
    ? (e) => {
        const row = (e.target as Element).closest<HTMLElement>('.hbar-row');
        if (row) opts.onClick!(Number(row.dataset.index));
      }
    : null;
}

/** #413: back to the canvas after HTML rows (the same element redrawn wider or in smaller text). */
function canvasMode(el: HTMLElement) {
  if (!el.hasAttribute('data-rows')) return;
  el.removeAttribute('data-rows');
  el.onclick = null;
  el.replaceChildren();
  el.style.height = el.dataset.canvasHeight ?? '';
  delete el.dataset.canvasHeight;
}

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
      axisLabel: { formatter: axisFmt(el, 'y') },
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
    /** #311: a dashed line on a right axis, in its own unit (outdoor temperature over the kWh). */
    line?: Series & { unit: string };
    /** #311: false when the card draws its own legend (series, hatching, line). */
    legend?: boolean;
    /** A reference line (subscribed power, alert threshold), dashed, labelled on the line. */
    mark?: { value: number; label: string };
    /** #394: per bucket, an icon above the bar (a power or Internet cut), said in the summary by `text`. */
    flags?: { icons: (string | null)[]; text: string };
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
  opts = { ...opts, series: keepLastYear(opts.series, prefs) };
  const n = opts.series.length;
  const unit = opts.unit ?? 'kWh';
  const chart = instance(el);
  const all = opts.line ? [...opts.series, opts.line] : opts.series;
  describe(el, opts.labels, all, unit);
  const flags = opts.flags;
  if (flags) el.setAttribute('aria-label', `${el.getAttribute('aria-label')} ${flags.text}.`);
  // #394: a dotted vertical line through the bucket, its icon on top (a day at 0 kWh has no bar to carry it)
  const flagLines = flags
    ? flags.icons.flatMap((f, j) =>
        f
          ? [{ xAxis: j, lineStyle: { color: cssVar('--text-muted'), type: 'dotted' as const, width: 1 }, label: { show: true, formatter: f, position: 'end' as const, fontSize: axisPx() } }]
          : [],
      )
    : [];
  const markLines = (i: number) => {
    const ref = i === 0 && opts.mark ? refLine(opts.mark) : null;
    const extra = i === n - 1 ? flagLines : [];
    if (!extra.length) return ref ?? undefined;
    return { ...(ref ?? { silent: true, symbol: 'none' }), data: [...(ref?.data ?? []), ...extra] };
  };
  const leg = legendLayout(
    all.map((s) => s.name),
    el,
  );
  const ax = axes(opts.labels, el, unit, opts.legend === false ? 0 : leg.height, { zero: true });
  const line = opts.line;
  chart.setOption(
    {
      animationDuration: 300,
      ...ax,
      ...(opts.legend === false ? { grid: { ...ax.grid, top: 12 } } : {}),
      ...(line
        ? {
            yAxis: [
              ax.yAxis,
              {
                type: 'value' as const,
                scale: true,
                splitLine: { show: false },
                axisLabel: { formatter: axisFmt(el, 'y2', line.unit) },
              },
            ],
          }
        : {}),
      legend: opts.legend === false ? { show: false } : leg.option,
      tooltip: tooltip(opts.price, opts.stacked && !opts.unit, unit, all, opts.notes),
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
        markLine: markLines(i),
      })).concat(
        line
          ? [
              {
                type: 'line',
                name: line.name,
                data: line.data,
                yAxisIndex: 1,
                showSymbol: true,
                symbolSize: 4,
                connectNulls: false,
                lineStyle: { width: 2, type: 'dashed', color: line.color },
                itemStyle: { color: line.color },
                z: 3,
              } as never,
            ]
          : [],
      ),
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
  const shown = keepLastYear(opts.series, prefs);
  describe(el, opts.labels, shown, unit);
  // #20: day-by-day curves smoothed when asked (the summary above keeps the raw values)
  const smooth = smoothable(prefs, opts.labels.length);
  opts = { ...opts, series: smooth ? shown.map((s) => ({ ...s, name: `${s.name} (moyenne sur ${SMOOTH_DAYS} jours)`, data: movingAverage(s.data) })) : shown };
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
  const own = opts.min !== undefined || opts.max !== undefined;
  const zero = zeroAxis(prefs, opts.scale === undefined ? zeroBased(unit) : !opts.scale, own);
  const ax = axes(opts.labels, el, unit, leg.height, { zero, ends: room });
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
        // #20: or on every value, when asked in the chart settings
        const pts = prefs.points ? s.data.map((v) => v !== null) : pointsToShow(s.data);
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

/** The distinct colours of a series coloured bar by bar, in order (its legend swatch, #300). */
const spread = (colors: string[]) => [...new Set(colors)];

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
  const top = Math.max(8, leg.height + 4);
  canvasMode(el);
  // plot height: the grid less the value axis written under it (labels and unit, one line)
  const plot = (el.clientHeight || 220) - top - 4 - (axisPx() + 16);
  const fit = categoryLabels(opts.labels, { labelWidth: hLabelWidth(width), plot, px: axisPx() });
  if (fit.overlaps.length || fit.broken.length) {
    // #413: the names do not fit beside their bars: one row per name, the name above
    const max = Math.max(1, ...opts.series.flatMap((s) => s.data.map((v) => v ?? 0)));
    barRows(
      el,
      opts.labels.map((l, i) => ({
        label: l,
        bars: opts.series.map((s, k) => {
          const v = s.data[i];
          return { value: Math.max(0, v ?? 0), color: s.colors?.[i] ?? s.color, text: v == null ? '—' : nf0.format(v), alt: k > 0 };
        }),
      })),
      { min: 0, max, valueWidth: '3.5em', legend: opts.series.map((s) => ({ name: s.name, color: s.colors?.length ? `linear-gradient(90deg, ${spread(s.colors).join(', ')})` : s.color })), onClick: opts.onClick },
    );
    return;
  }
  noteOverlap(el, fit.overlaps);
  chart.setOption(
    {
      animationDuration: 300,
      grid: { left: 8, right: 56, top, bottom: 4, ...FIT },
      legend: leg.option,
      tooltip: { ...tooltip(opts.price, false, unit), axisPointer: { type: 'shadow' as const } },
      yAxis: {
        type: 'category',
        data: opts.labels,
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        // every room named (a label hidden by overlap left a bar without a name)
        axisLabel: { color: cssVar('--text'), width: hLabelWidth(width), overflow: 'break', interval: 0, hideOverlap: false },
      },
      // #304: 3 ticks at most (« 0 300 600 9001 2001 500 » overlapped at 360 px)
      xAxis: {
        type: 'value',
        name: unit,
        nameLocation: 'end',
        nameGap: 6,
        nameTextStyle: { color: cssVar('--text-muted'), fontSize: axisPx(), verticalAlign: 'top', padding: [8, 0, 0, 0] },
        splitNumber: Math.min(3, splitCount(width - 180)),
        axisLabel: { hideOverlap: true, formatter: axisFmt(el, 'x') },
      },
      series: opts.series.map((s, i) => ({
        type: 'bar',
        name: s.name,
        data: s.colors ? s.data.map((v, j) => ({ value: v, itemStyle: { color: s.colors![j] } })) : s.data,
        barMaxWidth: 18,
        barGap: '20%',
        // #300: a series coloured bar by bar (a room each) has a legend in all its colours, not a grey
        itemStyle: {
          color: s.colors?.length ? { type: 'linear' as const, x: 0, y: 0, x2: 1, y2: 0, colorStops: spread(s.colors).map((c, j, a) => ({ offset: a.length > 1 ? j / (a.length - 1) : 0, color: c })) } : s.color,
          borderRadius: [0, 4, 4, 0],
        },
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
        { type: 'value', gridIndex: 0, max: opts.barMax, minInterval: 1, splitNumber: 2, ...yName(opts.barUnit), axisLabel: { formatter: axisFmt(el, 'y') } },
        {
          type: 'value',
          gridIndex: 1,
          scale: !zeroAxis(prefs, zeroBased(opts.lineUnit), false),
          splitNumber: 3,
          max: markMax,
          ...yName(opts.lineUnit),
          axisLabel: { formatter: axisFmt(el, 'y2') },
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
          const pts = prefs.points ? s.data.map((v) => v !== null) : pointsToShow(s.data);
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
    'Chauffage selon le froid',
    slopeSummary(opts.series.map((s) => ({ name: s.name, days: s.points.length, slope: s.fit?.slope ?? null, unit: opts.slopeUnit ?? 'kWh de plus par °C de froid' }))),
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
        axisLabel: { color: muted, hideOverlap: true, formatter: axisFmt(el, 'x') },
      },
      yAxis: {
        type: 'value',
        name: opts.yName,
        nameLocation: 'middle',
        nameGap: 34,
        min: 0,
        nameTextStyle: { color: muted, fontSize: axisPx() },
        splitLine: { lineStyle: { color: grid } },
        axisLabel: { color: muted, formatter: axisFmt(el, 'y') },
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
  const height = Math.max(160, steps.length * 34 + 60);
  canvasMode(el);
  const fit = categoryLabels(
    steps.map((s) => s.name),
    { labelWidth: hLabelWidth(width), plot: height - 16, px: axisPx() },
  );
  if (fit.overlaps.length || fit.broken.length) {
    // #413: the names do not fit beside their bars: one row per room, the name above
    barRows(
      el,
      steps.map((s) => ({ label: s.name, bars: [{ value: s.delta, color: cssVar(s.delta > 0 ? '--state-bad' : '--state-good'), text: `${signed(Math.round(s.delta))} kWh` }] })),
      { min: -maxDown, max: maxUp, valueWidth: '6.5em' },
    );
    return;
  }
  el.style.height = `${height}px`;
  noteOverlap(el, fit.overlaps);
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
        axisLabel: { color: cssVar('--text'), width: hLabelWidth(width), overflow: 'break', interval: 0, hideOverlap: false },
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
