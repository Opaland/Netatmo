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
