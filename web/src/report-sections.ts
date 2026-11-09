// S-6.3: offer comparator and maximum power for one year of the annual report.
// Pure functions (no DOM, no app state), so they are unit tested and shared by the full
// report and the anonymised one (S-6.4). Loaded lazily with the report extras.
import { MONTHS_LONG } from './aggregate';
import { type DaySplit, type OfferCost, type TempoRow, type TrveRow, compareOffers } from './analysis';

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const eur = (v: number) => `${nf0.format(v)} €`;
const longDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS_LONG[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const th = (cells: string[]) => `<tr>${cells.map((c, i) => `<th${i ? ' class="num"' : ''}>${c}</th>`).join('')}</tr>`;
const td = (cells: string[]) => `<tr>${cells.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`;
const tableHtml = (head: string[], rows: string[][]) =>
  `<div class="table-wrap" tabindex="0"><table><thead>${th(head)}</thead><tbody>${rows.map(td).join('')}</tbody></table></div>`;

// ------------------------------------------------------------------ offers
export type OfferKey = 'base' | 'hphc' | 'tempo';
export const OFFER_NAMES: Record<OfferKey, string> = { base: 'Base', hphc: 'Heures pleines / creuses', tempo: 'Tempo' };

export interface OffersInput {
  splits: DaySplit[];
  kvaAt: (day: string) => number;
  base: TrveRow[];
  hphc: TrveRow[];
  tempo: TempoRow[];
  tempoDays: Map<string, number>;
  scope: 'logement' | 'chauffage';
}

export interface OffersYear {
  year: number;
  days: number;
  costs: Record<OfferKey, OfferCost>;
  best: OfferKey;
  scope: OffersInput['scope'];
}

export const offerTotal = (c: OfferCost) => c.energy + c.subscription;

export function offersForYear(year: number, input: OffersInput): OffersYear | null {
  const splits = input.splits.filter((s) => s.day.startsWith(`${year}-`));
  const costs = compareOffers(splits, input.kvaAt, input.base, input.hphc, input.tempo, input.tempoDays);
  if (!costs.hphc.days) return null;
  const best = (['base', 'hphc', 'tempo'] as const).reduce((a, b) => (offerTotal(costs[b]) < offerTotal(costs[a]) ? b : a));
  return { year, days: costs.hphc.days, costs, best, scope: input.scope };
}

export function offersSectionHtml(o: OffersYear | null): string {
  const head = '<h3>Quelle offre EDF aurait coûté le moins ?</h3>';
  if (!o) return `<section class="report-section" id="report-offers">${head}<p class="hint muted">Comparateur indisponible pour cette année : tarifs réglementés ou couleurs Tempo non disponibles.</p></section>`;
  const diff = offerTotal(o.costs.hphc) - offerTotal(o.costs[o.best]);
  return `<section class="report-section" id="report-offers">${head}
    <p>${
      o.best === 'hphc'
        ? `Sur ${o.days} jours, l'option <strong>heures pleines / creuses</strong> a été la moins chère.`
        : `Sur ${o.days} jours, en <strong>${OFFER_NAMES[o.best]}</strong>, la facture aurait été de <strong>${eur(diff)}</strong> plus basse qu'en heures pleines / creuses.`
    }</p>
    ${tableHtml(
      ['Offre', 'Énergie', 'Abonnement', 'Total'],
      (['base', 'hphc', 'tempo'] as const).map((k) => [
        k === o.best ? `<strong>${OFFER_NAMES[k]}</strong>` : OFFER_NAMES[k],
        eur(o.costs[k].energy),
        eur(o.costs[k].subscription),
        k === o.best ? `<strong>${eur(offerTotal(o.costs[k]))}</strong>` : eur(offerTotal(o.costs[k])),
      ]),
    )}
    <p class="hint muted">Tarifs réglementés EDF (CRE, open data) jour par jour, abonnement compris, à la puissance du contrat. Périmètre : ${
      o.scope === 'logement' ? 'tout le logement (compteur Linky)' : 'radiateurs et chauffe-eau seulement'
    }. Tempo : couleur réelle de chaque jour, sans changement d'habitudes.</p>
  </section>`;
}

// ------------------------------------------------------------------ maximum power (Linky)
export interface PmaxMonth {
  month: number; // 0-11
  max: number;
  day: string;
  kva: number | null;
}

export interface PmaxYear {
  year: number;
  peak: { max: number; day: string; kva: number | null };
  months: PmaxMonth[];
  daysOver: number; // days above the subscribed power
  daysNear: number; // days at 90 % of it or more (over included)
}

export function pmaxForYear(pmax: Map<string, number>, year: number, kvaAt: (day: string) => number | null): PmaxYear | null {
  const months = new Map<number, PmaxMonth>();
  let daysOver = 0;
  let daysNear = 0;
  for (const [day, v] of pmax) {
    if (!day.startsWith(`${year}-`) || !Number.isFinite(v)) continue;
    const m = Number(day.slice(5, 7)) - 1;
    const kva = kvaAt(day);
    if (kva) {
      if (v > kva) daysOver++;
      if (v >= 0.9 * kva) daysNear++;
    }
    const cur = months.get(m);
    if (!cur || v > cur.max) months.set(m, { month: m, max: v, day, kva });
  }
  if (!months.size) return null;
  const list = [...months.values()].sort((a, b) => a.month - b.month);
  const top = list.reduce((a, b) => (b.max > a.max ? b : a));
  return { year, peak: { max: top.max, day: top.day, kva: top.kva }, months: list, daysOver, daysNear };
}

export function pmaxSectionHtml(p: PmaxYear | null): string {
  const head = '<h3>Puissance maximale appelée <small class="muted">compteur Linky</small></h3>';
  if (!p) return `<section class="report-section" id="report-pmax">${head}<p class="hint muted">Pas de puissance maximale pour cette année (compteur Linky non relié ou pas encore de relevé).</p></section>`;
  const { max, day, kva } = p.peak;
  const margin = kva ? kva - max : null;
  const verdict =
    margin === null
      ? ''
      : margin > 3.5
        ? ' Marge confortable : une puissance inférieure pourrait suffire, à confirmer sur un hiver très froid.'
        : margin < 0.5
          ? ' La puissance souscrite est atteinte ou presque : risque de disjonction lors des pics.'
          : ' Puissance adaptée aux pics.';
  return `<section class="report-section" id="report-pmax">${head}
    <p>Pic de l'année : <strong>${nf1.format(max)} kVA</strong> le ${longDate(day)}${kva ? `, pour ${nf0.format(kva)} kVA souscrits (${nf0.format((max / kva) * 100)} %)` : ''}.${verdict}${
      kva ? ` ${p.daysOver ? `${p.daysOver} jour(s) au-dessus de la puissance souscrite, ` : ''}${p.daysNear} jour(s) à 90 % ou plus.` : ''
    }</p>
    ${tableHtml(
      ['Mois', 'Pic (kVA)', 'Jour', 'Souscrite (kVA)'],
      p.months.map((m) => [MONTHS_LONG[m.month], nf1.format(m.max), String(Number(m.day.slice(8, 10))), m.kva ? nf0.format(m.kva) : '—']),
    )}
  </section>`;
}
