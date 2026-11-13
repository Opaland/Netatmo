// #555: the EDF offer comparison, shared by its card (views/compare.ts, loaded with Historique and
// the tools) and its one-line summary in Outils (first screen), so that Outils does not pull the
// whole compare view into the first screen.
import { compareOffers, daySplits, offPeakShares } from '../analysis';
import { ds, state } from '../app';
import { periodAt } from '../offers';
import { tenant } from '../tenant';
import { contracts, fmtEur, offCol } from '../ui';

// #256: the comparator card and its chart both need it; the year chips do not change it.
let lastComparison: { deps: unknown[]; value: ReturnType<typeof computeComparison> } | null = null;
export function comparison() {
  const deps = [ds, state.simKva, contracts()];
  if (!lastComparison || deps.some((d, i) => d !== lastComparison!.deps[i])) lastComparison = { deps, value: computeComparison() };
  return lastComparison.value;
}

function computeComparison() {
  const off = offCol();
  const linky = ds!.linky.size ? ds!.linky : null;
  const splits = daySplits(ds!.records, ds!.tariffs, off, offPeakShares(ds!.tariffs, off), linky);
  const kvaAt = (d: string) => state.simKva ?? periodAt(contracts(), d)?.kva ?? 9;
  const base = ds!.offers.get('edf-trv-base') ?? [];
  const hphc = ds!.offers.get('edf-trv-hphc') ?? [];
  const years = [...new Set(splits.map((s) => Number(s.day.slice(0, 4))))].sort();
  const perYear = years.map((y) => ({
    y,
    r: compareOffers(splits.filter((s) => s.day.startsWith(String(y))), kvaAt, base, hphc, ds!.tempo.rows, ds!.tempo.days),
  }));
  const all = compareOffers(splits, kvaAt, base, hphc, ds!.tempo.rows, ds!.tempo.days);
  return { perYear, all, scope: linky ? 'logement' : 'chauffage' };
}

/** #314: one-line summary of the comparator for its row in Outils (last full year, else the latest). */
export function offersLine(): string {
  if (tenant().on || !ds!.offers.size || !ds!.tempo.rows.length) return '';
  const rows = comparison().perYear.filter((p) => p.r.hphc.days > 0);
  const p = [...rows].reverse().find((x) => x.r.hphc.days >= 360) ?? rows[rows.length - 1];
  if (!p) return '';
  const eur = (k: 'base' | 'hphc' | 'tempo') => fmtEur(p.r[k].energy + p.r[k].subscription);
  return `${p.y}${p.r.hphc.days < 360 ? ` (${p.r.hphc.days} j)` : ''} : Base ${eur('base')} · Heures creuses ${eur('hphc')} · Tempo ${eur('tempo')}`;
}
