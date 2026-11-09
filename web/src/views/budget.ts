// Synthèse, loaded on demand (S-7.10): annual budget (S-2.12), CO₂ footprint (S-2.13)
// and the effect of a new regulated tariff (S-2.11). Filled into placeholders left by
// overview.ts; every figure carries its method.
import { addDays, dayOfYear, minusYears, total } from '../aggregate';
import { energyCostTrve, offPeakShares, projectYear } from '../analysis';
import { ds, rerender, state } from '../app';
import { budgetSentences } from '../plain';
import { periodAt } from '../offers';
import {
  CO2_DEFAULT,
  CO2_SOURCE,
  LS_BUDGET,
  LS_CO2,
  LS_GRID_SEEN,
  budgetPref,
  budgetStatus,
  co2Factor,
  co2Of,
  fmtCo2,
  fmtFactor,
  gridImpact,
  newGrid,
  readPref,
  writePref,
} from '../money';
import { contracts, costAvailable, costOf, esc, fmtEur, fmtKwh, lastDay, longDate, nf0, offCol, pct, priceMode } from '../ui';
import { html } from '../trusted';

const signedEur = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtEur(Math.abs(v))}`;
const num = (v: number, d = 2) => v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Replace a placeholder by its content (cards must stay direct children of #view for the simple mode). */
function put(id: string, markup: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (markup) el.outerHTML = html(markup);
  else el.remove();
}

function yearBudget() {
  const all = ds!.records;
  const last = lastDay();
  const year = Number(last.slice(0, 4));
  const from = `${year}-01-01`;
  const budget = budgetPref();
  if (!budget || !costAvailable()) return null;
  const spent = costOf(all, from, last);
  if (spent === null) return null;
  const p = projectYear(all, last);
  const days = year % 4 === 0 ? 366 : 365;
  return { year, ...budgetStatus(budget, spent, total(all, from, last), p ? p.projected : null, dayOfYear(last), days) };
}

/** Called by overview.ts once this module is loaded. */
export function fillOverview() {
  put('grid-zone', gridCard());
  const b = yearBudget();
  const tile = document.getElementById('budget-kpi');
  if (tile && b && state.simple) {
    // S-7.13: plain language in the simple mode
    const p = budgetSentences(b.over, b.gap, b.budget);
    tile.hidden = false;
    tile.innerHTML = html`<h3>Budget ${b.year} : ${b.over ? 'dépassement prévu' : 'marge prévue'}</h3>
      <p class="kpi-value">${p.value}</p>
      <p class="kpi-sub">${p.sub}</p>`;
  } else if (tile && b) {
    tile.hidden = false;
    tile.innerHTML = html`<h3>Budget ${b.year}</h3>
      <p class="kpi-value">${signedEur(b.gap)}</p>
      <p class="kpi-sub"><span class="delta ${b.over ? 'up' : 'down'}"><span aria-hidden="true">${b.over ? '▲' : '▼'}</span> ${b.over ? 'au-dessus du budget' : 'dans le budget'}</span> · ${fmtEur(b.projected)} projetés pour ${fmtEur(b.budget)}</p>`;
  } else tile?.remove();
  put('money-zone', moneyCard(b));
  bind();
}

// ------------------------------------------------------------------ budget + CO₂ card
function moneyCard(b: ReturnType<typeof yearBudget>): string {
  const all = ds!.records;
  const last = lastDay();
  const year = last.slice(0, 4);
  const from = `${year}-01-01`;
  const budget = budgetPref();
  const kwhYtd = total(all, from, last);
  const from12 = addDays(minusYears(last), 1);
  const kwh12 = total(all, from12, last);
  const f = co2Factor();
  let budgetHtml: string;
  if (!costAvailable()) {
    budgetHtml = '<p class="hint muted">Renseignez votre contrat ou vos prix (menu ⋮) pour suivre un budget en euros.</p>';
  } else if (b) {
    const share = Math.min(100, (b.spent / b.budget) * 100);
    budgetHtml = `<p>Dépensé depuis le 1<sup>er</sup> janvier : <strong>${fmtEur(b.spent)}</strong>${
      b.method === 'profile' ? ` (le rythme habituel prévoit ${fmtEur(b.toDate)} à cette date)` : ''
    }. Projeté au 31 décembre : <strong>${fmtEur(b.projected)}</strong> pour un budget de ${fmtEur(b.budget)}, soit <strong class="${b.over ? 'ko-red' : ''}">${
      b.over ? `${fmtEur(b.gap)} au-dessus du budget` : `dans le budget (${fmtEur(-b.gap)} de marge)`
    }</strong>.</p>
    <div class="share" aria-label="Part du budget déjà dépensée"><span style="flex:${share};background:var(--${b.over ? 'bad' : 'accent'})"></span><span style="flex:${100 - share};background:var(--ghost)"></span></div>
    <p class="share-legend"><span>${nf0.format(share)} % du budget dépensé</span></p>`;
  } else {
    budgetHtml = '<p class="hint">Fixez un budget annuel pour le chauffage et l\'eau chaude : l\'écart projeté s\'affichera ici et dans le mode simple.</p>';
  }
  return `<section class="card" id="money-card">
    <div class="card-head"><h2>Budget et empreinte ${year} <small class="muted">chauffage + eau chaude</small></h2></div>
    ${budgetHtml}
    ${
      costAvailable()
        ? `<label class="money-field">Budget annuel (€, sur cet appareil)
      <input type="number" id="budget-input" inputmode="numeric" min="0" step="10" placeholder="ex. 1500" value="${budget ?? ''}"></label>`
        : ''
    }
    <h3 class="money-h">Empreinte carbone</h3>
    <p>≈ <strong>${fmtCo2(co2Of(kwhYtd, f))}</strong> depuis le 1<sup>er</sup> janvier, ${fmtCo2(co2Of(kwh12, f))} sur 12 mois.</p>
    <p class="hint muted">${fmtKwh(kwhYtd)} × ${fmtFactor(f)}${f === CO2_DEFAULT ? ` (facteur par défaut : ${esc(CO2_SOURCE)})` : ' (facteur saisi sur cet appareil)'}.</p>
    <label class="money-field">Facteur d'émission (kgCO₂e par kWh)
      <input type="number" id="co2-input" inputmode="decimal" min="0" max="2" step="0.001" value="${f}"></label>
    ${f !== CO2_DEFAULT ? '<button type="button" class="link" id="co2-reset">Revenir au facteur par défaut</button>' : ''}
    <details class="table-details"><summary>Comment c'est calculé</summary>
      <p class="hint"><strong>Budget</strong> : coût de l'énergie (hors abonnement) du chauffage et du chauffe-eau, au prix de chaque jour selon votre contrat. La projection ajoute aux euros déjà dépensés les kWh encore attendus d'ici au 31 décembre (projection de fin d'année : rythme de l'année × profil des années passées), au prix moyen payé depuis janvier${
        b?.method === 'prorata' ? ' ; faute d\'année précédente, elle est faite ici au prorata des jours écoulés, ce qui sous-estime l\'hiver' : ''
      }. Le budget est gardé sur cet appareil seulement.</p>
      <p class="hint"><strong>CO₂</strong> : kWh × facteur d'émission. Le facteur par défaut (${fmtFactor(CO2_DEFAULT)}) est celui du mix électrique moyen français ; l'ADEME publie aussi un facteur « usage chauffage », plus élevé (de l'ordre de 0,08), car on chauffe l'hiver, quand l'électricité est plus carbonée. Choisissez celui que vous voulez citer : il sert partout, rapport annuel compris.</p>
    </details>
  </section>`;
}

// ------------------------------------------------------------------ S-2.11 new regulated tariff
function gridCard(): string {
  if (priceMode() !== 'trve' || !ds!.offers.size) return '';
  const last = lastDay();
  const c = periodAt(contracts(), last);
  const rows = c ? ds!.offers.get(c.offer) : null;
  if (!c || !rows) return '';
  const g = newGrid(rows, c.kva, last);
  if (!g || readPref(LS_GRID_SEEN) === g.next.from) return '';
  const from = addDays(minusYears(last), 1);
  const recs = ds!.records.filter((r) => r.day >= from && r.day <= last);
  const off = offCol();
  const shares = offPeakShares(ds!.tariffs, off);
  const at = (row: typeof g.prev) => energyCostTrve(recs, ds!.tariffs, () => row, 0, off, shares).energy;
  const imp = gridImpact(at(g.prev), at(g.next), g.prev, g.next);
  const kwh = recs.reduce((s, r) => s + r.kwh, 0);
  const future = g.next.from > last;
  const up = imp.total > 0;
  const priceLine = (r: typeof g.prev) =>
    r.hc === r.hp ? `${num(r.hp, 4)} €/kWh` : `HC ${num(r.hc, 4)} · HP ${num(r.hp, 4)} €/kWh`;
  return `<section class="verdict verdict-${up ? 'high' : 'low'}" id="grid-card" role="status">
    <span class="verdict-icon" aria-hidden="true">${up ? '▲' : '▼'}</span>
    <div><p class="verdict-title">Nouveau tarif réglementé ${future ? 'à partir du' : 'depuis le'} ${longDate(g.next.from)}</p>
    <p class="verdict-sub">Sur votre consommation des 12 derniers mois : <strong>${signedEur(imp.total)} par an</strong>${imp.pct !== null ? ` (${pct(imp.pct)})` : ''}, dont ${signedEur(imp.energy)} d'énergie et ${signedEur(imp.subscription)} d'abonnement.</p>
    <details class="table-details"><summary>Comment c'est calculé</summary>
      <p class="hint">Les mêmes ${fmtKwh(kwh)} (chauffage + chauffe-eau, du ${longDate(from)} au ${longDate(last)}, avec leur répartition heures pleines / creuses) sont chiffrés à l'ancienne grille (${priceLine(g.prev)}, abonnement ${fmtEur(g.prev.fixedYear)} par an) puis à la nouvelle (${priceLine(g.next)}, abonnement ${fmtEur(g.next.fixedYear)} par an), pour ${c.kva} kVA. Source : grille publiée par la CRE (open data EDF). Le reste du logement n'est pas compté.</p>
    </details>
    <button type="button" class="link grid-seen" id="grid-seen">Masquer jusqu'au prochain tarif</button></div>
  </section>`;
}

// ------------------------------------------------------------------ events (bound on the elements: this module is lazy)
function on(id: string, type: 'change' | 'click', fn: (el: HTMLInputElement) => void) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el) el[type === 'change' ? 'onchange' : 'onclick'] = () => fn(el); // property: binding twice is harmless
}

function bind() {
  on('budget-input', 'change', (el) => {
    const v = Number(el.value);
    writePref(LS_BUDGET, v > 0 ? String(Math.round(v)) : null);
    rerender();
  });
  on('co2-input', 'change', (el) => {
    const v = Number(el.value.replace(',', '.'));
    if (!(v > 0 && v < 2)) return;
    writePref(LS_CO2, v === CO2_DEFAULT ? null : String(v));
    rerender();
  });
  on('co2-reset', 'click', () => {
    writePref(LS_CO2, null);
    rerender();
  });
  on('grid-seen', 'click', () => {
    const c = periodAt(contracts(), lastDay());
    const g = c ? newGrid(ds!.offers.get(c.offer) ?? [], c.kva, lastDay()) : null;
    if (g) writePref(LS_GRID_SEEN, g.next.from);
    rerender();
  });
}
