// Synthèse, loaded on demand: reconcile the cost with a real invoice (S-2.3).
// Fills the placeholder #invoice-zone left by overview.ts. The invoices typed here stay on
// this device, encrypted with the data key (local-store.ts), and are never sent anywhere.
import type { DayRecord } from '../aggregate';
import { type PriceAt, offPeakShares } from '../analysis';
import { ds, onDatasetLoaded, state } from '../app';
import { type Invoice, type Reconciliation, invoiceKey, reconcile, validInvoice } from '../invoice';
import { loadNote, saveNote } from '../local-store';
import { costAvailable, costOf, esc, fmtKwh, firstDay, lastDay, longDate, nf0, offCol, priceAt, priceMode } from '../ui';
import { html } from '../trusted';

const NOTE = 'invoices';
let invoices: Invoice[] | null = null;
let selected: string | null = null;
let persisted = true;
onDatasetLoaded(() => {
  invoices = null;
  selected = null;
  persisted = true;
});

const validList = (v: unknown): Invoice[] => (Array.isArray(v) ? v.map(validInvoice).filter((x): x is Invoice => !!x) : []);
const eur2 = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${eur2(Math.abs(v))}`;

/** Called by overview.ts once this module is loaded. */
export async function fillInvoice() {
  const zone = document.getElementById('invoice-zone');
  if (!zone) return;
  invoices ??= await loadNote(NOTE, ds!.source, ds!.key, validList, []);
  draw();
}

function draw() {
  const el = document.getElementById('invoice-zone') ?? document.getElementById('invoice-card');
  if (!el || !ds) return;
  el.outerHTML = html(card());
  bind();
}

/** Price of each day: regulated tariff of the contract, or the prices typed in the menu. */
function priceFn(): PriceAt {
  if (priceMode() === 'trve' && ds!.offers.size) return priceAt;
  const p = state.prices;
  const base = p.base ?? p.t1 ?? p.t2 ?? 0;
  const off = offCol();
  const row = {
    from: '0000-01-01',
    to: null,
    kva: 0,
    fixedYear: (p.sub ?? 0) * 12,
    hc: (off === 2 ? p.t2 : p.t1) ?? base,
    hp: (off === 2 ? p.t1 : p.t2) ?? base,
  };
  return () => row;
}

function compute(inv: Invoice): Reconciliation {
  const heat = new Map<string, number>();
  const water = new Map<string, number>();
  const heatRecs: DayRecord[] = [];
  const waterRecs: DayRecord[] = [];
  for (const r of ds!.records) {
    if (r.day < inv.from || r.day > inv.to) continue;
    const m = r.cat === 'water_heater' ? water : heat;
    m.set(r.day, (m.get(r.day) ?? 0) + r.kwh);
    (r.cat === 'water_heater' ? waterRecs : heatRecs).push(r);
  }
  const off = offCol();
  const p = priceFn();
  // Off-peak share of the whole home: the radiators' and water heater's, the only one known
  // (irrelevant for a single-price offer, whose two prices are equal).
  const offShare = offPeakShares(ds!.tariffs, off).overall;
  return reconcile(inv, {
    linky: ds!.linky,
    heat,
    water,
    priceAt: p,
    offShare,
    heatCost: costOf(heatRecs, inv.from, inv.to),
    waterCost: costOf(waterRecs, inv.from, inv.to),
  });
}

function result(inv: Invoice): string {
  const r = compute(inv);
  const period = `du ${longDate(inv.from)} au ${longDate(inv.to)} (${r.days} jours)`;
  const outside = inv.from < firstDay() || inv.to > lastDay();
  if (r.verdict === 'no-price' || r.appTotal === null || r.gap === null) {
    return `<p class="notice">Facture ${period} : aucun prix connu pour cette période (contrat ou tarifs à renseigner dans le menu, ou période hors des données).</p>`;
  }
  const share = (v: number | null) => (v === null || inv.amount <= 0 ? '' : ` (${nf0.format((v / inv.amount) * 100)} % de la facture)`);
  const sourceKwh = r.scope === 'heating' ? 'radiateurs et chauffe-eau (pas de compteur Linky)' : 'compteur Linky';
  return `<div class="invoice-result">
    <p><strong>Facture ${period}</strong> <span class="badge-${r.verdict === 'ok' ? 'ok' : 'warn'}">${r.verdict === 'ok' ? 'écart expliqué' : 'écart en partie inexpliqué'}</span></p>
    ${outside ? `<p class="hint">La période dépasse les données de l'appli (du ${longDate(firstDay())} au ${longDate(lastDay())}) : les jours hors données sont comptés comme manquants.</p>` : ''}
    <div class="table-wrap" tabindex="0"><table><tbody>
      <tr><th scope="row">Montant de la facture</th><td class="num">${eur2(inv.amount)}${inv.kwh !== null ? ` · ${fmtKwh(inv.kwh)}` : ''}</td></tr>
      <tr><th scope="row">Calculé par l'appli</th><td class="num">${eur2(r.appTotal)} · ${fmtKwh(r.appKwh)}</td></tr>
      <tr><th scope="row">dont énergie <small class="muted">${sourceKwh} × ${r.avgPrice!.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} €/kWh en moyenne</small></th><td class="num">${eur2(r.energy!)}</td></tr>
      ${r.subscription !== null ? `<tr><th scope="row">dont abonnement <small class="muted">au prorata</small></th><td class="num">${eur2(r.subscription)}</td></tr>` : ''}
      <tr><th scope="row">Écart (facture − appli)</th><td class="num"><strong>${signed(r.gap)}</strong>${r.gapPct !== null ? ` (${r.gapPct > 0 ? '+' : r.gapPct < 0 ? '−' : ''}${nf0.format(Math.abs(r.gapPct))} %)` : ''}</td></tr>
    </tbody></table></div>
    <h3 class="money-h">D'où vient l'écart</h3>
    <ul class="facts">${r.lines.map((l) => `<li>${esc(l.text)}</li>`).join('')}</ul>
    <h3 class="money-h">Part du chauffage et de l'eau chaude</h3>
    <p>Radiateurs : <strong>${fmtKwh(r.heatKwh)}</strong>${r.heatCost !== null ? `, ${eur2(r.heatCost)}${share(r.heatCost)}` : ''} · chauffe-eau : <strong>${fmtKwh(r.waterKwh)}</strong>${r.waterCost !== null ? `, ${eur2(r.waterCost)}${share(r.waterCost)}` : ''}${r.otherCost !== null ? ` · autres usages du logement (compteur moins radiateurs et chauffe-eau) : ${eur2(r.otherCost)}${share(r.otherCost)}` : ''}.</p>
    <p class="hint muted">L'appli ne suit que le chauffage et l'eau chaude : le reste de la facture (cuisine, éclairage, appareils) n'est connu que par le compteur Linky.</p>
  </div>`;
}

function card(): string {
  const list = invoices ?? [];
  const current = list.find((i) => invoiceKey(i) === selected) ?? list[list.length - 1] ?? null;
  const min = firstDay();
  const max = lastDay();
  return `<section class="card" id="invoice-card">
    <div class="card-head"><h2>Recouper avec une facture <small class="muted">écart expliqué</small></h2></div>
    ${
      !costAvailable()
        ? '<p class="hint">Renseignez votre contrat ou vos prix (menu ⋮) pour comparer une facture.</p>'
        : `<p class="hint muted">Recopiez la période de consommation et le montant TTC d'une facture d'électricité : l'appli calcule ce qu'elle aurait facturé avec ${ds!.linky.size ? 'le compteur Linky' : 'les radiateurs et le chauffe-eau'} et le tarif de votre contrat, puis explique l'écart.</p>
    ${current ? result(current) : ''}
    <div class="absence-add invoice-form">
      <label class="money-field">Du <input type="date" id="inv-from" min="${min}" max="${max}" required></label>
      <label class="money-field">Au <input type="date" id="inv-to" min="${min}" max="${max}" required></label>
      <label class="money-field">Montant TTC (€) <input type="number" id="inv-amount" min="0" step="0.01" inputmode="decimal" required></label>
      <label class="money-field">kWh facturés <small>(facultatif)</small> <input type="number" id="inv-kwh" min="0" step="1" inputmode="numeric"></label>
    </div>
    <label class="check"><input type="checkbox" id="inv-sub" checked> Le montant comprend l'abonnement</label>
    <label class="check"><input type="checkbox" id="inv-est"> Index de fin <strong>estimé</strong> par le fournisseur</label>
    <p><button type="button" class="primary small" id="inv-add">Comparer cette facture</button> <span class="hint" id="inv-msg" role="status"></span></p>
    ${
      list.length
        ? `<ul class="absence-list">${list
            .map(
              (i, n) => `<li><div><strong>${longDate(i.from)} → ${longDate(i.to)}</strong> · ${eur2(i.amount)}${i.estimated ? ' · <small class="muted">index estimé</small>' : ''}</div>
              ${current && invoiceKey(i) === invoiceKey(current) ? '<small class="muted">affichée ci-dessus</small> ' : `<button type="button" class="link" data-inv-show="${n}">Afficher</button> `}<button type="button" class="link" data-inv-del="${n}">Retirer</button></li>`,
            )
            .join('')}</ul>`
        : ''
    }
    ${persisted ? '' : '<p class="hint muted">Ces factures dureront jusqu\'au verrouillage : reconnectez-vous avec la phrase de passe pour qu\'elles soient enregistrées (chiffrées) sur cet appareil.</p>'}
    <details class="table-details"><summary>Comment c'est calculé</summary>
      <p class="hint">Chaque jour de la période, la consommation du compteur Linky est comptée au prix du tarif réglementé du contrat en vigueur ce jour-là (prix TTC publiés par la CRE : TVA, accise et contribution d'acheminement comprises), avec la part d'heures creuses mesurée sur vos radiateurs et votre chauffe-eau ; l'abonnement est compté au prorata des jours. Les jours sans relevé sont comptés à la moyenne des autres. L'écart est ensuite expliqué par les kWh facturés en plus ou en moins que le compteur (relevé estimé), puis le reste est jugé négligeable sous 3 % de la facture (2 € au moins).</p>
      <p class="hint muted">Les factures saisies restent sur cet appareil, chiffrées avec votre phrase de passe ; elles ne sont jamais envoyées (ni à GitHub, ni à l'IA).</p>
    </details>`
    }
  </section>`;
}

async function save(list: Invoice[]) {
  invoices = list;
  persisted = await saveNote(NOTE, ds!.source, ds!.key, list);
  draw();
}

function bind() {
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
  const checked = (id: string) => !!(document.getElementById(id) as HTMLInputElement | null)?.checked;
  const add = document.getElementById('inv-add');
  if (add) {
    add.onclick = () => {
      const kwh = val('inv-kwh');
      const inv = validInvoice({
        from: val('inv-from'),
        to: val('inv-to'),
        amount: Number(val('inv-amount').replace(',', '.')),
        kwh: kwh === '' ? null : Number(kwh.replace(',', '.')),
        subscription: checked('inv-sub'),
        estimated: checked('inv-est'),
      });
      if (!inv || !val('inv-amount')) {
        document.getElementById('inv-msg')!.textContent = 'Indiquez les deux dates (la fin après le début) et le montant.';
        return;
      }
      selected = invoiceKey(inv);
      const list = (invoices ?? []).filter((i) => invoiceKey(i) !== selected);
      void save([...list, inv].sort((a, b) => (a.from < b.from ? -1 : 1)));
    };
  }
  document.querySelectorAll<HTMLButtonElement>('[data-inv-show]').forEach((b) => {
    b.onclick = () => {
      const i = invoices?.[Number(b.dataset.invShow)];
      if (i) selected = invoiceKey(i);
      draw();
    };
  });
  document.querySelectorAll<HTMLButtonElement>('[data-inv-del]').forEach((b) => {
    b.onclick = () => {
      const n = Number(b.dataset.invDel);
      void save((invoices ?? []).filter((_, i) => i !== n));
    };
  });
}
