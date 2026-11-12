// #117: the sun of the day as a possible explanation. Open-Meteo's daily global radiation (#452,
// weather "sun", MJ/m²) tells the sunny days: the sun through the windows heats the rooms, and the
// radiators then have less to do. One split of the days for the whole app: a heating day is sunny
// when its radiation is ABOVE the median of the heating days (lower.ts keeps the other half, the
// days « peu ensoleillés », with the same median: sunCut). Pure functions, no DOM.
import type { Weather } from './analysis';
import { HEATING_DAY_BELOW } from './works';

/** The median of a list of numbers, or null when it is empty. */
export function median(xs: number[]): number | null {
  const s = xs.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The radiation that splits the heating days (outdoor mean under HEATING_DAY_BELOW, as the
 * signature) into the sunnier half and the other: a split of the days of this home, not a physical
 * threshold (AGENTS.md §2). Null without any radiation on a heating day.
 */
export function sunMedian(sun: Map<string, number>, weather: Weather): number | null {
  const xs: number[] = [];
  for (const [day, mj] of sun) {
    const w = weather.get(day);
    if (w && w[2] < HEATING_DAY_BELOW && typeof mj === 'number') xs.push(mj);
  }
  return median(xs);
}

/** The radiation of a day when it is in the sunnier half of the heating days, else null. */
export function sunnyDay(day: string, sun: Map<string, number> | undefined, cut: number | null): number | null {
  const mj = sun?.get(day);
  return cut !== null && typeof mj === 'number' && Number.isFinite(mj) && mj > cut ? mj : null;
}

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
/**
 * The words of the explanation, a hypothesis (« a pu »): only for a day heated LESS than expected,
 * since the sun can lower the heating, never raise it. Null otherwise.
 */
export function sunHint(day: string, below: boolean, sun: Map<string, number> | undefined, cut: number | null): string | null {
  if (!below) return null;
  const mj = sunnyDay(day, sun, cut);
  return mj === null ? null : `journée ensoleillée (${nf1.format(mj)} MJ/m²) : le soleil a pu chauffer à la place des radiateurs`;
}
