// S-7.2, #295: the sentence a screen reader reads instead of a chart. Pure (no DOM, no
// ECharts) so that the wording of each kind of measure is tested.

/**
 * How a series is summed up:
 * - sum: energy, hours, euros (total of the raw values, rounded only at the end);
 * - mean: °C, ppm, % (a total means nothing);
 * - max: a power (kVA, kW, W): the peak;
 * - last: a running total (cumulative curves): the value reached at the last point.
 */
export type Measure = 'sum' | 'mean' | 'max' | 'last';

export interface SummarySeries {
  name: string;
  data: (number | null)[];
  unit?: string;
  measure?: Measure;
  /** Unrounded values behind `data` (sums are made on these). */
  raw?: (number | null)[];
  /** Day reached by a running total when its last point is a month still running (« 8 nov. »). */
  lastLabel?: string;
}

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** Measure implied by a unit when the series does not say. */
export function measureOf(unit: string): Measure {
  if (/^(°C|ppm|%)$/.test(unit)) return 'mean';
  if (/^(k?VA|k?W)$/.test(unit)) return 'max';
  return 'sum';
}

// ------------------------------------------------------------------ #305: one summary per chart type
const fmtU = (v: number, u: string) => `${(Math.abs(v) < 10 && v % 1 ? nf1 : nf0).format(v)} ${u}`;
const signed = (v: number, u: string) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtU(Math.abs(v), u)}`;

/** Ranking (horizontal bars): « Salon 1 263 kWh, Chauffe-eau 1 263 kWh, … » (eight at most). */
export function rankSummary(labels: string[], values: (number | null)[], unit: string): string {
  const rows = labels.map((l, i) => [l, values[i]] as const).filter((r): r is readonly [string, number] => r[1] !== null && r[1] !== undefined);
  if (!rows.length) return 'pas de donnée';
  const sorted = rows.slice().sort((a, b) => b[1] - a[1]);
  const shown = sorted.slice(0, 8).map(([l, v]) => `${l} ${fmtU(v, unit)}`);
  return `du plus au moins : ${shown.join(', ')}${sorted.length > 8 ? `, et ${sorted.length - 8} autres` : ''}`;
}

/** Changes between two periods: start, end, the largest rise and fall. */
export function changeSummary(start: { label: string; value: number }, end: { label: string; value: number }, steps: { name: string; delta: number }[], unit = 'kWh'): string {
  const up = steps.filter((s) => s.delta > 0).sort((a, b) => b.delta - a.delta)[0];
  const down = steps.filter((s) => s.delta < 0).sort((a, b) => a.delta - b.delta)[0];
  const parts = [`de ${fmtU(start.value, unit)} (${start.label}) à ${fmtU(end.value, unit)} (${end.label})`];
  if (down) parts.push(`plus forte baisse : ${down.name} ${signed(down.delta, unit)}`);
  if (up) parts.push(`plus forte hausse : ${up.name} ${signed(up.delta, unit)}`);
  if (!steps.length) parts.push('aucune pièce ne change de plus de 1 kWh');
  return parts.join(' ; ');
}

/** Scatter + line per season: days and slope (« 2025–2026 : 228 jours, pente 2,3 kWh par °C »). */
export function slopeSummary(series: { name: string; days: number; slope: number | null; unit: string }[]): string {
  return series.map((s) => `${s.name} : ${s.days} jours${s.slope !== null ? `, pente ${nf1.format(Math.abs(s.slope))} ${s.unit}` : ''}`).join(' ; ');
}

/** Days of a year (calendar): total, mean and the day that used the most. */
export function daysSummary(days: [string, number][], dayText: (d: string) => string, unit = 'kWh'): string {
  if (!days.length) return 'pas de donnée';
  const [maxD, maxV] = days.reduce((a, b) => (b[1] > a[1] ? b : a));
  const sum = days.reduce((a, [, v]) => a + v, 0);
  return `${days.length} jours, total ${fmtU(sum, unit)}, moyenne ${fmtU(sum / days.length, unit)} par jour ; jour le plus consommateur : ${dayText(maxD)} (${fmtU(maxV, unit)})`;
}

/** Cells of a grid (weekday × hour): the peak and the lowest cell. */
export function gridSummary(xLabels: string[], yLabels: string[], data: [number, number, number][], unit: string): string {
  if (!data.length) return 'pas de donnée';
  const max = data.reduce((a, b) => (b[2] > a[2] ? b : a));
  const min = data.reduce((a, b) => (b[2] < a[2] ? b : a));
  return `pointe : ${yLabels[max[1]]} ${xLabels[max[0]]} (${fmtU(max[2], unit)}) ; creux : ${yLabels[min[1]]} ${xLabels[min[0]]} (${fmtU(min[2], unit)})`;
}

/** One clause per series (six at most), e.g. « 2025 : 8 129 kWh au 31 déc. ». */
export function summarize(labels: string[], series: SummarySeries[], unit = 'kWh'): string[] {
  return series.slice(0, 6).map((s) => {
    const u = s.unit ?? unit;
    const vals = s.data.map((v, i) => [v, i] as const).filter(([v]) => v !== null && v !== undefined) as [number, number][];
    if (!vals.length) return `${s.name} : pas de donnée`;
    const [maxV, maxI] = vals.reduce((a, b) => (b[0] > a[0] ? b : a));
    const peak = `maximum ${nf1.format(maxV)} ${u} (${labels[maxI]})`;
    switch (s.measure ?? measureOf(u)) {
      case 'last': {
        const [v, i] = vals[vals.length - 1];
        const at = s.lastLabel ?? labels[i];
        // a day (« 31 déc. ») or the end of a month (« fin août »)
        return `${s.name} : ${nf0.format(v)} ${u} ${/^\d/.test(at) ? 'au' : 'à fin'} ${at}`;
      }
      case 'max':
        return `${s.name} : ${peak}`;
      case 'mean':
        return `${s.name} : moyenne ${nf1.format(vals.reduce((a, [v]) => a + v, 0) / vals.length)} ${u}, ${peak}`;
      default: {
        const src = s.raw ?? s.data;
        const sum = src.reduce<number>((a, v) => a + (v ?? 0), 0);
        return `${s.name} : total ${nf0.format(sum)} ${u}, ${peak}`;
      }
    }
  });
}
