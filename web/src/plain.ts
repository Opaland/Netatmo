// S-7.13: the simple mode written in plain language (FALC, « facile à lire et à comprendre »).
// Rules: sentences of 15 words at most, no unexplained acronym, rounded figures, and a
// glossary: touching a term (kWh, heures creuses, degrés-jours) shows a one-sentence
// definition, also announced to screen readers. Pure text builders, tested in plain.test.ts.
import { MONTHS_LONG } from './aggregate';
import { escapeHtml as esc } from './charts';

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

// ------------------------------------------------------------------ glossary
export type Term = 'kwh' | 'hc' | 'dju' | 'kva' | 'delestage' | 'veille';
export const GLOSSARY: Record<Term, { label: string; def: string }> = {
  kwh: { label: 'kWh', def: "Un kWh, c'est l'électricité d'un radiateur de 1 000 watts allumé une heure." },
  hc: { label: 'heures creuses', def: "Les heures creuses sont des heures où l'électricité coûte moins cher, souvent la nuit." },
  dju: { label: 'degrés-jours', def: 'Les degrés-jours mesurent le froid : plus il y en a, plus on chauffe.' },
  kva: { label: 'kVA', def: 'Le kVA mesure la puissance que votre abonnement autorise en même temps.' },
  delestage: { label: 'délestage', def: 'Le délestage coupe un radiateur un moment pour ne pas dépasser votre puissance.' },
  veille: { label: 'veille', def: 'La veille est ce que la maison consomme sans arrêt, même la nuit.' },
};

let uid = 0;
/**
 * A term the reader can touch: a disclosure button followed by its definition (hidden until
 * touched). The definition follows the button in reading order; main.ts also announces it.
 */
export function term(t: Term, label = GLOSSARY[t].label): string {
  const id = `def-${t}-${++uid}`;
  return `<button type="button" class="term" data-term="${t}" aria-expanded="false" aria-controls="${id}">${esc(label)}</button><span class="term-def" id="${id}" hidden> (${esc(GLOSSARY[t].def)})</span>`;
}

/** Toggle a term button; returns the definition to announce when it opens, else null. */
export function toggleTerm(btn: HTMLElement): string | null {
  const def = document.getElementById(btn.getAttribute('aria-controls') ?? '');
  if (!def) return null;
  const open = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', String(open));
  def.hidden = !open;
  return open ? GLOSSARY[btn.dataset.term as Term]?.def ?? null : null;
}

/** "Les mots à connaître": every term of the glossary, in the simple mode only. */
export function glossarySection(): string {
  return `<section class="glossary" aria-labelledby="glossary-title">
    <h2 id="glossary-title">Les mots à connaître</h2>
    <p class="hint">Touchez un mot pour lire son explication.</p>
    <ul>${(Object.keys(GLOSSARY) as Term[]).map((t) => `<li>${term(t)}</li>`).join('')}</ul>
  </section>`;
}

// ------------------------------------------------------------------ rounded figures
/** kWh rounded: to the unit under 100, to the ten above. */
export function roundKwh(v: number): number {
  return Math.abs(v) < 100 ? Math.round(v) : Math.round(v / 10) * 10;
}
/** "820 kWh" (number only: the unit is added by the caller, as a term or plain text). */
export const plainNum = (v: number) => nf0.format(roundKwh(v));
/** Euros rounded to the euro under 100, to the ten above. */
export const plainEur = (v: number) => `${nf0.format(Math.abs(v) < 100 ? Math.round(v) : Math.round(v / 10) * 10)}\u00a0€`;

/** Ordinal day of month for a date "YYYY-MM-DD": "1er", "9". */
const dayOf = (day: string) => {
  const d = Number(day.slice(8, 10));
  return d === 1 ? '1er' : String(d);
};
export const monthOf = (day: string) => MONTHS_LONG[Number(day.slice(5, 7)) - 1];

// ------------------------------------------------------------------ verdict
export interface PlainVerdict {
  level: 'low' | 'normal' | 'high';
  actual: number;
  expected: number;
  climate: boolean;
  /** Euros of difference (actual − expected), or null without prices. */
  eur: number | null;
}

export function verdictTitle(level: PlainVerdict['level']): string {
  return {
    low: "Ce mois-ci, vous consommez moins que d'habitude.",
    normal: "Ce mois-ci, vous consommez comme d'habitude.",
    high: "Ce mois-ci, vous consommez plus que d'habitude.",
  }[level];
}

/** Sentences under the verdict title. `kwh` renders the unit (a glossary term or plain text). */
export function verdictSentences(v: PlainVerdict, from: string, kwh = 'kWh'): string[] {
  const out = [
    // the unit is never last: a touchable term followed by a lone "." would wrap badly
    `Depuis le ${dayOf(from)} ${monthOf(from)} : ${plainNum(v.actual)}\u00a0${kwh} consommés.`,
    `D'habitude, à cette date : ${plainNum(v.expected)}\u00a0kWh.`,
  ];
  if (v.climate) out.push('Ce calcul tient compte du froid de ce mois.');
  if (v.eur !== null && Math.round(Math.abs(v.eur)) >= 1) {
    out.push(`Cela fait environ ${plainEur(Math.abs(v.eur))} ${v.eur > 0 ? 'de plus' : 'de moins'}.`);
  }
  return out;
}

// ------------------------------------------------------------------ key figures
/** Comparison with the same dates one year earlier, in words. */
export function comparedToLastYear(now: number, before: number | null): string {
  if (before === null || before <= 0) return "Pas de comparaison possible avec l'an dernier.";
  const p = Math.round(((now - before) / before) * 100);
  if (p === 0) return "C'est autant que l'an dernier.";
  return `C'est ${nf0.format(Math.abs(p))} % ${p > 0 ? 'de plus' : 'de moins'} que l'an dernier.`;
}

export const costSentence = (eur: number | null) => (eur === null ? '' : `Cela coûte environ ${plainEur(eur)}.`);

export function kpiTitle(kind: 'month' | 'year' | '12m' | 'projection', last: string): string {
  const year = last.slice(0, 4);
  if (kind === 'month') return `${monthOf(last)} ${year}, jusqu'au ${dayOf(last)}`;
  if (kind === 'year') return `Depuis le 1er janvier ${year}`;
  if (kind === '12m') return 'Sur les 12 derniers mois';
  return `Estimation pour toute l'année ${year}`;
}

export function budgetSentences(over: boolean, gap: number, budget: number): { value: string; sub: string } {
  return {
    value: plainEur(Math.abs(gap)),
    sub: over
      ? `Ce sera au-dessus de votre budget de ${plainEur(budget)}.`
      : `Il vous restera cette marge sur votre budget de ${plainEur(budget)}.`,
  };
}

/** Pinned room (S-7.8): mean temperature, rounded to the degree, and cold days. */
export function pinnedTemp(temp: number, coldDays: number, threshold: number): { value: string; sub: string } {
  const thr = `${nf0.format(threshold)} °C`;
  return {
    value: `${nf0.format(Math.round(temp))} °C`,
    sub: coldDays
      ? `${coldDays} jour${coldDays > 1 ? 's' : ''} sous ${thr} en moyenne.`
      : `Aucun jour sous ${thr} en moyenne.`,
  };
}

// ------------------------------------------------------------------ vue Proche (#316)
/** « aujourd'hui », « hier » or « le 7 novembre » for the last day with data. */
export function whenWord(day: string, today: string): string {
  if (day === today) return "aujourd'hui";
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (day === y.toISOString().slice(0, 10)) return 'hier';
  return `le ${dayOf(day)} ${monthOf(day)}`;
}

/** How the room feels, against the comfort threshold of this device. */
export function roomFeel(temp: number, threshold: number): string {
  if (temp >= threshold) return 'Il fait bon.';
  if (temp >= threshold - 2) return 'Il fait un peu frais.';
  return 'Il fait froid.';
}

/** Whether the heating reached the temperature asked for ('' without a request known). */
export function heatingSentence(temp: number, asked: number | null): string {
  if (asked === null || !Number.isFinite(asked)) return '';
  if (temp >= asked - 1) return 'Le chauffage atteint la température demandée.';
  return `La pièce reste sous la température demandée (${nf0.format(Math.round(asked))} °C).`;
}

// ------------------------------------------------------------------ checks (tests and review)
/** Text without tags nor the hidden definitions, as read on screen. */
export function visibleText(htmlText: string): string {
  return htmlText
    .replace(/<span class="term-def"[^>]*>.*?<\/span>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Words of each sentence (punctuation-only tokens and numbers split by a space count once). */
export function sentenceLengths(text: string): number[] {
  return text
    .replace(/(\d)\s(\d{3})/g, '$1$2')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length)
    .filter((n) => n > 0);
}
