// AI analysis helpers (pure, no DOM): usefulness votes kept on this device (S-5.8),
// usage and cost line, pseudonym legend (S-5.7).
import type { InsightUsage } from './data';
import { lsKey } from './scope';

export type Vote = 'up' | 'down';
export type Votes = Record<string, Vote>; // analysed month "YYYY-MM" -> vote

const KEY = lsKey('insight-votes');

export function loadVotes(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Votes {
  try {
    const v = JSON.parse(storage?.getItem(KEY) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([k, x]) => /^\d{4}-\d{2}$/.test(k) && (x === 'up' || x === 'down'))) as Votes;
  } catch {
    return {};
  }
}

/** Records (or clears, with null) the vote for one analysed month; returns the new votes. */
export function saveVote(period: string, vote: Vote | null, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): Votes {
  const votes = loadVotes(storage);
  if (vote) votes[period] = vote;
  else delete votes[period];
  try {
    storage?.setItem(KEY, JSON.stringify(votes));
  } catch {
    /* private browsing: the vote lasts for this page only */
  }
  return votes;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const monthsBack = (month: string, n: number) => {
  const i = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 - n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};

/**
 * ADR-5: analyses of the last 3 months (the 3 months before the current one, the
 * analysis of month M being written early in M+1) judged useful on this device.
 */
export function usefulRate(votes: Votes, today: string): { useful: number; rated: number; months: string[] } {
  const cur = today.slice(0, 7);
  const months = [3, 2, 1].map((n) => monthsBack(cur, n));
  const rated = months.filter((m) => votes[m]);
  return { useful: rated.filter((m) => votes[m] === 'up').length, rated: rated.length, months };
}

const nf = (digits: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits });
const money = (v: number) => nf(v < 0.1 ? 3 : 2).format(v);

/** "claude-opus-5-5 · 1 requête · 3 000 jetons (2 000 en entrée, 1 000 en sortie) · environ 0,024 € (0,028 $)". */
export function usageLine(model: string, u: InsightUsage | undefined): string {
  if (!u) return `Modèle ${model} · jetons et coût non mesurés pour cette analyse (antérieure à la v1.3)`;
  const served = u.served_by?.length ? u.served_by.join(', ') : model;
  const input = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  return [
    `Modèle ${served}`,
    `${u.requests} requête${u.requests > 1 ? 's' : ''}`,
    `${nf(0).format(input + u.output_tokens)} jetons (${nf(0).format(input)} en entrée, ${nf(0).format(u.output_tokens)} en sortie)`,
    `coût estimé ${money(u.cost_eur)} € (${money(u.cost_usd)} $ au tarif public)`,
  ].join(' · ');
}

/** "Pièce A = Salon" pairs: rooms first, then sensors, A…Z before AA. */
export function pseudonymLegend(map: Record<string, string> | undefined): [string, string][] {
  const rank = (s: string) => [s.startsWith('Pièce') ? 0 : 1, s.length] as const;
  return Object.entries(map ?? {}).sort(([a], [b]) => {
    const [ra, rb] = [rank(a), rank(b)];
    return ra[0] - rb[0] || ra[1] - rb[1] || a.localeCompare(b);
  });
}

/** First sentence of the monthly analysis, without the markdown marks (« Un mois plus sobre… »). */
export function firstSentence(md: string, max = 90): string {
  const line =
    md
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('---')) ?? '';
  const plain = line.replace(/^[-*>]\s+/, '').replace(/[*_`]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  const s = /^(.*?[.!?])(\s|$)/.exec(plain)?.[1] ?? plain;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
