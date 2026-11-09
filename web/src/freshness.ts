// #318: state of the header pill « Données du 8 nov. » (pure, unit-tested; in the first screen,
// so kept apart from the quality report of data-quality.ts, which is loaded on demand).

export interface Freshness {
  level: 'ok' | 'warn' | 'bad';
  /** Days since the last day of data. */
  days: number;
  /** Data stopped for more than 2 days (the collection is probably broken). */
  stale: boolean;
  /** Sources whose last attempt failed. */
  failing: string[];
  /** Days of this month estimated from a monthly total. */
  uncertain: number;
  /** Short state in words (never the colour alone). */
  text: string;
}

/**
 * #318: state of the header pill. Red: the data stopped more than 2 days ago. Orange: a source
 * failed at its last attempt, or days of the current month are estimated. Green otherwise.
 * The demo is never late (its data are generated up to the day before it was built).
 */
export function freshness(o: { last: string | null; now: number; demo: boolean; sources?: Record<string, { ok?: string; error?: string }>; uncertain?: number }): Freshness {
  const failing = Object.entries(o.sources ?? {})
    .filter(([, s]) => s.error && (!s.ok || s.error > s.ok))
    .map(([k]) => k)
    .sort();
  const uncertain = o.uncertain ?? 0;
  if (!o.last) return { level: 'warn', days: 0, stale: false, failing, uncertain, text: 'pas encore de données' };
  const days = Math.max(0, Math.floor((o.now - Date.parse(`${o.last}T12:00:00Z`)) / 86_400_000));
  const stale = !o.demo && days > 2;
  const level = stale ? 'bad' : failing.length || uncertain ? 'warn' : 'ok';
  const text = stale
    ? `arrêtées depuis ${days} jours`
    : failing.length
      ? `${failing.length > 1 ? `${failing.length} sources` : 'une source'} en échec`
      : uncertain
        ? `${uncertain} jour${uncertain > 1 ? 's' : ''} estimé${uncertain > 1 ? 's' : ''} ce mois-ci`
        : 'à jour';
  return { level, days, stale, failing, uncertain, text };
}
