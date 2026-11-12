// #464: what a degree-day total is made of — base, method, source — and whether its span is
// complete, said on every screen that shows a total (Historique → Année par année, Rapport).
import { addDays } from './aggregate';
import { DJU_BASE, type Weather, djuBetween } from './analysis';

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** Where the outdoor temperature comes from (meta.weather_source). */
export function weatherSourceLabel(source: string | null | undefined): string {
  return source === 'netatmo'
    ? 'module extérieur de la station Netatmo'
    : 'service Open-Meteo, réanalyse ERA5 à maille d’environ 25 km autour du logement';
}

/** Base, method and source in one sentence. */
export function djuMethodText(source: string | null | undefined): string {
  return `base ${DJU_BASE}\u00a0°C ; chaque jour, ${DJU_BASE}\u00a0°C moins la moyenne du minimum et du maximum, zéro s’il fait plus doux, selon la méthode de Météo-France ; températures du ${weatherSourceLabel(source)}`;
}

/**
 * The degree days of one span with the days it SHOULD have: a day without outdoor temperature
 * counts 0, so a span with missing days under-counts its cold. `missing` lets the screen say
 * « au moins » instead of passing a short total for a mild year.
 */
export function djuSpan(weather: Weather, from: string, to: string): { dju: number; days: number; missing: number } {
  const { dju, days } = djuBetween(weather, from, to);
  let expected = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) expected++;
  return { dju, days, missing: expected - days };
}

/** Under this many degree days, a span is too mild for a heating per degree day (#464; #152). */
export const MIN_DJU = 50;

export interface YearCold {
  /** The total for the table: a number when complete, « 1 930 * » when days are missing. */
  cell: number | string;
  /** kWh of heating per degree day, over the days that HAVE a temperature only. */
  perDju: string;
  /** The caveat to list under the table, or null. */
  caveat: string | null;
}

/**
 * #464: one year of the « Totaux par année » table. Before, a year with up to 65 days without
 * temperature showed its short total as the cold of the year, and divided the heating of the
 * WHOLE year by it. Now the total says what is missing and the ratio keeps the same days.
 * `heatOn(days)`: the heating kWh of the given days.
 */
export function yearCold(weather: Weather, year: number, from: string, to: string, heatOn: (has: (day: string) => boolean) => number): YearCold {
  const s = djuSpan(weather, from, to);
  if (!s.days) return { cell: '—', perDju: '—', caveat: null };
  const heat = heatOn((d) => weather.has(d));
  const perDju = s.dju > MIN_DJU ? (heat / s.dju).toFixed(2).replace('.', ',') : '—';
  if (!s.missing) return { cell: Math.round(s.dju), perDju, caveat: null };
  const n = s.missing;
  return {
    cell: `${nf0.format(Math.round(s.dju))} *`,
    perDju,
    caveat: `Froid de ${year} : ${n} jour${n > 1 ? 's' : ''} sans température extérieure, comptés zéro : au moins ${nf0.format(Math.round(s.dju))} degrés-jours ; le chauffage par degré-jour ne compte que les ${s.days} jours mesurés`,
  };
}
