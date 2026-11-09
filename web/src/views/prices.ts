// Prices and contract form, shown in the header menu.
import { type Prices, inferKvaChange } from '../analysis';
import { type State, ds, setState, state } from '../app';
import { OFFERS, periodAt } from '../offers';
import { contractInfo, contracts, esc, keepMenuOpen, lastDay, longDate, nf0, priceAt, priceMode, tariffNames } from '../ui';
import { tenant, tenantPricesForm } from '../tenant';

export function pricesForm() {
  const p = state.prices;
  if (tenant().on) return tenantPricesForm(p.base, p.sub); // S-12.6
  const [n1, n2] = tariffNames();
  const input = (key: keyof Prices, label: string, ph: string) =>
    `<label>${esc(label)}<input data-price="${key}" type="number" inputmode="decimal" step="0.0001" min="0" placeholder="${ph}" value="${p[key] ?? ''}"></label>`;
  const kvas = [...new Set(ds!.trve.map((r) => r.kva))].sort((a, b) => a - b);
  const now = priceAt(lastDay());
  const fmt4 = (v: number) => v.toFixed(4).replace('.', ',');
  const rows = contracts()
    .map(
      (c, i) => `<div class="contract-row">
        <input type="date" aria-label="À partir du" data-contract="${i}" data-field="from" value="${c.from}">
        <select aria-label="Offre" data-contract="${i}" data-field="offer">${OFFERS.map((o) => `<option value="${o.id}" ${o.id === c.offer ? 'selected' : ''}>${esc(o.supplier)} ${esc(o.label)}</option>`).join('')}</select>
        <select aria-label="Puissance" data-contract="${i}" data-field="kva">${kvas.map((k) => `<option value="${k}" ${k === c.kva ? 'selected' : ''}>${k} kVA</option>`).join('')}</select>
        ${i > 0 ? `<button type="button" class="link" data-contract-del="${i}" aria-label="Supprimer cette période">✕</button>` : ''}
      </div>`,
    )
    .join('');
  const mode = priceMode();
  const trve = ds!.offers.size
    ? `<label class="check"><input type="radio" name="pmode" data-pmode="trve" ${mode === 'trve' ? 'checked' : ''}> Tarifs officiels selon mon contrat</label>
      ${
        mode === 'trve'
          ? `<p class="hint muted">Mon contrat, période par période (date de début, offre, puissance souscrite) :</p>${sharing()}${rows}
        <button type="button" class="link" id="contract-add">+ Ajouter un changement (puissance, offre)</button>
        ${kvaHint()}
        ${now ? `<p class="hint muted">Aujourd'hui : HP ${fmt4(now.hp)} €, HC ${fmt4(now.hc)} €/kWh, abonnement ${nf0.format(now.fixedYear / 12)} €/mois TTC. Chaque jour est compté au tarif en vigueur ce jour-là (CRE, open data).</p>` : ''}`
          : ''
      }
      <label class="check"><input type="radio" name="pmode" data-pmode="manual" ${mode === 'manual' ? 'checked' : ''}> Mes propres prix</label>
      ${mode === 'manual' ? sharing() : ''}`
    : '';
  const manual =
    mode === 'manual' || !ds!.trve.length
      ? `${input('base', ds!.meta.has_tariffs ? 'Prix unique / avant HP-HC (€/kWh)' : 'Prix du kWh (€/kWh)', 'ex. 0,2516')}
    ${ds!.meta.has_tariffs ? input('t1', `${n1} (€/kWh)`, 'ex. 0,27') + input('t2', `${n2} (€/kWh)`, 'ex. 0,20') : ''}
    ${input('sub', 'Abonnement (€/mois)', 'ex. 15,65')}`
      : '';
  return `<fieldset class="prices"><legend>Prix</legend>${trve}${manual}</fieldset>`;
}

/** S-12.1: where the contract comes from, and how to share it or go back to the shared one. */
function sharing() {
  const info = contractInfo();
  const demo = ds!.source === 'demo';
  const share = demo ? '' : '<button type="button" class="link" data-view="settings">Partager</button>';
  if (info.source === 'shared') {
    return `<p class="hint"><span class="badge">partagé</span> <span class="muted">Contrat commun à tous les appareils (enregistré par la collecte).</span></p>${
      info.differs
        ? `<div class="notice"><p>Le contrat saisi sur cet appareil diffère du contrat partagé : c'est le contrat partagé qui s'applique.</p>
        <button type="button" class="link" id="contract-use-local">Utiliser plutôt celui de cet appareil</button>
        <button type="button" class="link" id="contract-forget-local">Oublier celui de cet appareil</button></div>`
        : ''
    }`;
  }
  if (info.shared) {
    return `<div class="notice"><p><strong>Modifié sur cet appareil, non partagé</strong> : les autres appareils gardent le contrat partagé.</p>
      ${share} <button type="button" class="link" id="contract-revert">Revenir au contrat partagé</button></div>`;
  }
  return demo ? '' : `<p class="hint muted">Enregistré sur cet appareil seulement. ${share.replace('>Partager<', '>Le partager avec les autres appareils<')}</p>`;
}

/** S-2.8: propose the subscribed-power change the Linky max power reveals. */
function kvaHint() {
  if (!ds!.pmax.size) return '';
  const list = contracts();
  const first = list[0];
  const change = inferKvaChange(ds!.pmax, first.kva);
  if (!change) return `<p class="hint muted">Linky : votre puissance maximale n'a jamais dépassé ${first.kva} kVA.</p>`;
  const known = list.some((c) => c.kva >= change.to && c.from <= change.firstOver);
  if (known) return `<p class="hint muted">Linky : cohérent avec votre contrat (dépassement de ${first.kva} kVA le ${longDate(change.firstOver)}).</p>`;
  return `<div class="notice"><p>Votre Linky a dépassé <strong>${change.from} kVA</strong> pour la première fois le <strong>${longDate(change.firstOver)}</strong> : le compteur coupe au-delà de la puissance souscrite, vous étiez donc déjà en <strong>${change.to} kVA</strong> ce jour-là${
    change.lastWithin ? ` (passage entre le ${longDate(change.lastWithin)} et le ${longDate(change.firstOver)}, ou plus tôt)` : ''
  }.</p>
    <button type="button" class="primary small" id="kva-apply" data-day="${change.firstOver}" data-kva="${change.to}">Ajouter ce changement à mon contrat</button></div>`;
}

// ------------------------------------------------------------------ events
/** Contract periods buttons. Returns true when the click belonged to this form. */
export function handleClick(btn: HTMLElement): boolean {
  if (btn.id === 'contract-revert' || btn.id === 'contract-forget-local') {
    setState({ contracts: [], contractLocalEdit: false });
    keepMenuOpen();
    return true;
  }
  if (btn.id === 'contract-use-local') {
    setState({ contractLocalEdit: true });
    keepMenuOpen();
    return true;
  }
  if (btn.id === 'kva-apply') {
    const list = contracts().map((c) => ({ ...c }));
    const prev = periodAt(list, btn.dataset.day!)!;
    list.push({ from: btn.dataset.day!, offer: prev.offer, kva: Number(btn.dataset.kva) });
    setState({ contracts: list.sort((a, b) => (a.from < b.from ? -1 : 1)), contractLocalEdit: contractInfo().shared });
    keepMenuOpen();
    return true;
  }
  if (btn.id === 'contract-add' || btn.dataset.contractDel !== undefined) {
    const list = contracts().map((c) => ({ ...c }));
    if (btn.id === 'contract-add') list.push({ ...list[list.length - 1], from: lastDay() });
    else list.splice(Number(btn.dataset.contractDel), 1);
    setState({ contracts: list, contractLocalEdit: contractInfo().shared });
    keepMenuOpen();
    return true;
  }
  return false;
}

/** Prices, price mode and contract fields. Returns true when the change belonged to this form. */
export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  if (t.dataset.price) {
    const v = parseFloat(t.value.replace(',', '.'));
    setState({ prices: { ...state.prices, [t.dataset.price]: Number.isFinite(v) && v > 0 ? v : null } });
    keepMenuOpen();
    return true;
  }
  if (t.dataset.pmode) {
    const next = t.dataset.pmode as State['priceMode'];
    const info = contractInfo();
    // Leaving the official tariffs while a shared contract applies is a change made here only.
    if (info.source === 'shared' && next === 'manual') setState({ priceMode: next, contracts: info.periods.map((c) => ({ ...c })), contractLocalEdit: true });
    else setState({ priceMode: next });
    keepMenuOpen();
    return true;
  }
  if (t.dataset.contract !== undefined) {
    const list = contracts().map((c) => ({ ...c }));
    const c = list[Number(t.dataset.contract)];
    if (t.dataset.field === 'kva') c.kva = Number(t.value);
    else if (t.dataset.field === 'offer') c.offer = t.value;
    else if (t.value) c.from = t.value;
    setState({ contracts: list.sort((a, b) => (a.from < b.from ? -1 : 1)), contractLocalEdit: contractInfo().shared });
    keepMenuOpen();
    return true;
  }
  return false;
}
