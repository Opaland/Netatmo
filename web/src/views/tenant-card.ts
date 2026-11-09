// S-12.6: "Mode locataire" card of the Settings view (lazy module). Per-device setting.
import { ds, setState, state } from '../app';
import { firstDay, lastDay, longDate } from '../ui';
import { leaseWindow, setTenant, tenant } from '../tenant';
import { html } from '../trusted';
import '../simulators.css';

let pendingFocus: string | null = null;

export function mountTenant(card: HTMLElement | null) {
  if (!card || !ds || !card.isConnected) return;
  const t = tenant();
  const price = state.prices.base;
  const lease = leaseWindow(t, firstDay(), lastDay());
  card.hidden = false;
  card.innerHTML = html`<h2>Mode locataire <small class="muted">sur cet appareil</small></h2>
    <p class="hint muted">Pour suivre son chauffage sans le compteur Linky ni le contrat du titulaire (propriétaire, bailleur), avec un coût juste et un bilan de fin de bail.</p>
    <label class="check"><input type="checkbox" id="tenant-on" ${t.on ? 'checked' : ''}> Je suis locataire</label>
    ${
      t.on
        ? `<div class="sim-form">
      <label>Prix moyen du kWh (€)<input id="tenant-price" type="number" inputmode="decimal" min="0" step="0.0001" placeholder="ex. 0,2516" value="${price ?? ''}"></label>
      <label>Début du bail<input id="tenant-from" type="date" value="${t.leaseFrom ?? ''}"></label>
      <label>Fin du bail (facultatif)<input id="tenant-to" type="date" value="${t.leaseTo ?? ''}"></label>
    </div>
    <p class="hint">${price === null ? '<strong>Saisissez un prix moyen</strong> (total de vos factures ÷ kWh facturés) : sans lui, aucun coût n\'est affiché.' : `Tous les coûts utilisent ${String(price).replace('.', ',')} € par kWh, quel que soit l'horaire.`} ${
      lease ? `Le rapport anonymisé couvre le bail : du ${longDate(lease.from)} au ${longDate(lease.to)}.` : 'Avec la date de début du bail, le rapport anonymisé ne couvre que le bail.'
    }</p>`
        : ''
    }
    <details class="table-details" ${t.on ? 'open' : ''}><summary>Ce qui change en mode locataire</summary>
      <ul class="facts">
        <li><strong>Coûts</strong> : votre prix moyen au kWh (et, si vous le saisissez dans ⚙ Paramètres → Contrat et prix, votre abonnement), jamais le contrat du titulaire.</li>
        <li><strong>Masqués, avec une phrase d'explication</strong> : les cartes Linky (part du logement, puissance maximale, courbe de charge), le comparateur d'offres et la simulation de recharge, le contrat partagé, les travaux (avant / après, affaire du propriétaire). Ils supposent le compteur et le contrat du titulaire.</li>
        <li><strong>Rapport anonymisé</strong> : la période du bail seulement, sans comparaison avec l'année d'avant (un autre occupant).</li>
        <li><strong>Inchangé</strong> : consommation des radiateurs et du chauffe-eau, comparaison des années, signature énergétique, consigne, pompe à chaleur, confort.</li>
      </ul>
    </details>`;
  if (pendingFocus) card.querySelector<HTMLElement>(pendingFocus)?.focus();
  pendingFocus = null;
  const on = (sel: string, fn: (el: HTMLInputElement) => void) => {
    const el = card.querySelector<HTMLInputElement>(sel);
    el?.addEventListener('change', () => {
      pendingFocus = sel; // the view re-renders: keyboard users keep their place
      fn(el);
    });
  };
  on('#tenant-on', (el) => {
    setTenant({ on: el.checked });
    setState({});
  });
  on('#tenant-price', (el) => {
    const v = parseFloat(el.value.replace(',', '.'));
    setState({ prices: { ...state.prices, base: Number.isFinite(v) && v > 0 ? v : null } });
  });
  on('#tenant-from', (el) => {
    setTenant({ leaseFrom: el.value || null });
    setState({});
  });
  on('#tenant-to', (el) => {
    setTenant({ leaseTo: el.value || null });
    setState({});
  });
}
