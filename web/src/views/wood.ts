// #366: ⚙ Mon logement → « Poêle à bois » (réglage foyer). The wood bought (day, stères, species,
// moisture, price) and the assumptions that turn it into heat (kWh per stère at 20 %, efficiency),
// shown and editable. Applied on this device at once (encrypted draft); saved for the household
// in the repository secret WOOD_JSON, sealed in this browser (#459; the nightly collection copies
// it into the encrypted meta).
import { ds, rerender } from '../app';
import { alertHtml, howDetails } from '../components';
import { dayShort, seasonLabel } from '../glossary';
import { hasToken } from '../settings';
import { html } from '../trusted';
import { avgPrice, esc, fmtEur, fmtKwh, lastDay, nf0 } from '../ui';
import {
  DEFAULT_EFFICIENCY,
  KWH_PER_STERE,
  REF_MOISTURE,
  SPECIES,
  type Species,
  WET_MOISTURE,
  type WoodPurchase,
  type WoodSettings,
  heatOf,
  moistureFactor,
  parseWood,
  purchaseText,
  woodJson,
  woodSeasons,
} from '../wood';
import { bindMigrate, checkPlain, plainOffer, saveSecret, secretWhere, tokenHint } from './household-secret';
import { setWoodDraft, sharedWood, stoveName, woodDraft, woodPersisted, woodSettings } from './wood-state';
import '../simulators.css';

export const WOOD_VARIABLE = 'WOOD_JSON';
let message: { ok: boolean; text: string } | null = null;

const n1 = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const cents = (eurPerKwh: number) => `${(eurPerKwh * 100).toFixed(1).replace('.', ',')} c€`;

export function mountWood(card: HTMLElement | null, repo: () => string) {
  if (!card || !ds) return;
  const w = woodSettings();
  const shared = sharedWood();
  const pending = woodDraft() !== null && woodJson(w) !== woodJson(shared);
  const demo = ds.source === 'demo';
  const canWrite = !demo && hasToken();
  const elec = avgPrice();
  const seasons = woodSeasons(w).reverse();
  const stove = stoveName() !== 'Poêle à bois'; // a room declared heated by a stove (#346)
  card.innerHTML = html(`<section class="card" id="wood-card" aria-labelledby="wood-title">
    <div class="card-head"><h2 id="wood-title">${esc(stoveName())}</h2><span class="tag scope">foyer</span></div>
    <p class="hint muted">Le bois ne passe pas par le compteur : notez vos achats pour que le coût du chauffage (Accueil, hiver contre hiver, « Expliquer un mois ») compte l’électricité <strong>et</strong> le bois. Chaque achat est brûlé pendant la saison de chauffe qui suit (acheté de janvier à mars : la saison en cours), réparti selon le froid de chaque jour (degrés-jours).</p>
    ${
      seasons.length
        ? `<ul class="list" aria-label="Bois par saison">${seasons
            .map(
              (s) =>
                `<li><div class="row"><span class="swatch" style="background:var(--usage-heating)" aria-hidden="true"></span><span><span class="t">Saison ${esc(seasonLabel(s.season))}</span><span class="s">${esc(
                  `${n1(s.steres)} stère${s.steres >= 2 ? 's' : ''} · ≈ ${fmtKwh(s.kwh)} de chaleur · ${s.kwh > 0 ? `${cents(s.eur / s.kwh)} le kWh` : ''}${elec ? ` (électricité : ${cents(elec)})` : ''}`,
                )}</span></span><span class="v">${esc(fmtEur(s.eur))}</span><span></span></div></li>`,
            )
            .join('')}</ul>`
        : '<p class="hint">Aucun achat de bois noté.</p>'
    }
    ${
      w.purchases.length
        ? `<details class="table-details"><summary>Achats (${w.purchases.length})</summary><ul class="list" aria-label="Achats de bois">${w.purchases
            .map(
              (p, i) =>
                `<li><div class="row"><span></span><span><span class="t">${esc(dayShort(p.day, true))}</span><span class="s">${esc(`${purchaseText(p)} · ≈ ${fmtKwh(heatOf(p, w))}`)}${
                  p.moisture > WET_MOISTURE ? ` · <span class="muted">bois humide : brûle mal</span>` : ''
                }</span></span><span class="v">${esc(fmtEur(p.price))} <button type="button" class="link" data-wood-remove="${i}">Retirer<span class="sr-only"> l’achat du ${esc(dayShort(p.day, true))}</span></button></span><span></span></div></li>`,
            )
            .join('')}</ul></details>`
        : ''
    }
    <details class="table-details" id="wood-new"${!w.purchases.length && stove ? ' open' : ''}><summary>Noter un achat de bois</summary>
    <div class="sim-form" role="group" aria-label="Noter un achat de bois">
      <label>Livré le<input type="date" id="wood-day" value="${esc(lastDay())}" max="${esc(lastDay())}"></label>
      <label>Stères<input type="number" id="wood-steres" min="0.1" max="100" step="0.1" value="1" inputmode="decimal"></label>
      <label>Essence<select id="wood-species">${(Object.keys(SPECIES) as Species[]).map((k) => `<option value="${k}"${k === 'chene' ? ' selected' : ''}>${esc(SPECIES[k])}</option>`).join('')}</select></label>
      <label>Humidité (%)<input type="number" id="wood-moisture" min="5" max="60" step="1" value="${REF_MOISTURE}" inputmode="numeric"></label>
      <label>Prix payé (€)<input type="number" id="wood-price" min="0" max="100000" step="1" value="" inputmode="decimal"></label>
    </div>
    <div class="controls"><button type="button" class="btn secondary" id="wood-add">Noter l’achat</button></div></details>
    ${howDetails(
      'Hypothèses (modifiables)',
      `<p class="hint">Chaleur d’un achat = stères × kWh par stère de l’essence (bûches d’1 m à ${REF_MOISTURE} % d’humidité) × correction d’humidité × rendement du poêle. Valeurs courantes des guides du bois-énergie, à remplacer par celles de votre fournisseur ou de la notice du poêle.</p>
      <div class="sim-form" role="group" aria-label="Hypothèses du bois">
        <label>Rendement du poêle (%)<input type="number" id="wood-eff" min="10" max="100" step="1" value="${w.efficiency}" inputmode="numeric"></label>
        ${(Object.keys(SPECIES) as Species[])
          .map((k) => `<label>${esc(SPECIES[k])} (kWh par stère)<input type="number" data-wood-kwh="${k}" min="500" max="3000" step="50" value="${w.kwhPerStere[k]}" inputmode="numeric"></label>`)
          .join('')}
      </div>
      <p class="hint muted">Humidité : la chaleur prise par l’eau à évaporer, à bois sec égal (${n1(moistureFactor(15) * 100)} % de l’énergie à 15 %, ${n1(moistureFactor(30) * 100)} % à 30 %). Au-delà de ${WET_MOISTURE} %, le bois brûle mal : le vrai rendement est bien plus bas que l’hypothèse. Par défaut : rendement ${DEFAULT_EFFICIENCY} % (poêle à bûches récent), ${nf0.format(KWH_PER_STERE.chene)} kWh par stère de chêne, ${nf0.format(KWH_PER_STERE.resineux)} de résineux. Tout le bois d’une saison est supposé brûlé dans cette saison.</p>
      <div class="controls"><button type="button" class="btn secondary" id="wood-assume">Appliquer les hypothèses</button></div>`,
    )}
    <p class="hint muted">${pending ? 'Appliqué sur cet appareil, pas encore pour le foyer.' : shared.purchases.length ? 'Enregistré pour le foyer.' : 'Rien d’enregistré pour le foyer.'} ${secretWhere(WOOD_VARIABLE)}</p>
    <code class="sim-json">${esc(woodJson(w))}</code>
    <div class="controls">
      <button type="button" class="btn secondary" id="wood-save" ${canWrite && pending ? '' : 'disabled'}>Enregistrer pour le foyer</button>
      ${pending ? '<button type="button" class="link" id="wood-reset">Revenir à la version du foyer</button>' : ''}
    </div>
    <p class="hint muted">${demo ? 'Démo : appliqué sur cet appareil seulement, rien n’est envoyé.' : hasToken() ? 'Jamais dans le journal public.' : tokenHint}${
      woodPersisted() ? '' : ' Cet appareil n’a pas pu garder la version chiffrée : elle durera jusqu’au verrouillage.'
    }</p>
    ${plainOffer(repo(), WOOD_VARIABLE, canWrite)}
    ${message ? alertHtml(message.ok ? 'info' : 'bad', esc(message.text), { role: 'status' }) : ''}
  </section>`);
  const remount = () => (card.isConnected ? mountWood(card, repo) : rerender());
  if (canWrite) checkPlain(repo(), WOOD_VARIABLE, remount);
  bindMigrate(card, repo(), WOOD_VARIABLE, (m) => (message = m), remount);
  const apply = (next: WoodSettings) => {
    message = null;
    void setWoodDraft(parseWood(next)).then(() => rerender());
  };
  const val = (id: string) => Number(card.querySelector<HTMLInputElement>(`#${id}`)!.value.replace(',', '.'));
  card.querySelector('#wood-add')?.addEventListener('click', () => {
    const p: WoodPurchase = {
      day: card.querySelector<HTMLInputElement>('#wood-day')!.value,
      steres: val('wood-steres'),
      species: card.querySelector<HTMLSelectElement>('#wood-species')!.value as Species,
      moisture: val('wood-moisture'),
      price: val('wood-price'),
    };
    const next = parseWood({ ...w, purchases: [...w.purchases, p] });
    if (next.purchases.length === w.purchases.length) {
      message = { ok: false, text: 'Achat non noté : jour, stères (0,1 à 100), humidité (5 à 60 %) et prix attendus.' };
      return mountWood(card, repo);
    }
    apply(next);
  });
  for (const b of card.querySelectorAll<HTMLButtonElement>('[data-wood-remove]'))
    b.addEventListener('click', () => apply({ ...w, purchases: w.purchases.filter((_, i) => String(i) !== b.dataset.woodRemove) }));
  card.querySelector('#wood-assume')?.addEventListener('click', () => {
    const kwh = { ...w.kwhPerStere };
    for (const i of card.querySelectorAll<HTMLInputElement>('[data-wood-kwh]')) kwh[i.dataset.woodKwh as Species] = Number(i.value);
    const next = parseWood({ ...w, efficiency: val('wood-eff'), kwhPerStere: kwh });
    apply(next);
  });
  card.querySelector('#wood-reset')?.addEventListener('click', () => apply(shared));
  card.querySelector('#wood-save')?.addEventListener('click', () => {
    message = { ok: true, text: 'En cours…' };
    mountWood(card, repo);
    void saveSecret(repo(), WOOD_VARIABLE, woodJson(w), (m) => (message = m)).finally(remount);
  });
}
