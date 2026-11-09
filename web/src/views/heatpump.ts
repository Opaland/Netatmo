// S-2.15: "Et avec une pompe à chaleur air-air ?" — estimate from the energy signature of the
// last complete heating season (lazy module, placed in Analyse under the setpoint simulation).
import type { DayRecord } from '../aggregate';
import { offPeakShares, signaturePoints } from '../analysis';
import { activeRooms, ds } from '../app';
import { referenceSeason } from '../checks';
import { displayId } from '../household';
import { COP_CURVE, type CopMode, simulateHeatPump } from '../heatpump';
import { esc, fmtEur, fmtKwh, lastDay, nf0, offCol, table } from '../ui';
import { currentHcHp } from './waterheater';
import { html } from '../trusted';
import '../simulators.css';
import { lsKey } from '../scope';
import { fmt1 as num1 } from '../glossary';

const LS = lsKey('heatpump');
const FRANCE_RENOV = 'https://france-renov.gouv.fr/';
interface Inputs {
  mode: 'scop' | 'curve';
  low: number;
  high: number;
  share: number; // 0..1
}
const SHARES: [number, string][] = [
  [1, 'tout le chauffage'],
  [0.75, 'les trois quarts'],
  [0.5, 'la moitié (pièces de vie)'],
];

function load(): Inputs {
  const def: Inputs = { mode: 'scop', low: 3, high: 4, share: 1 };
  try {
    const o = JSON.parse(localStorage.getItem(LS) ?? '{}') as Partial<Inputs>;
    const ok = (v: unknown) => typeof v === 'number' && v >= 1 && v <= 8;
    return {
      mode: o.mode === 'curve' ? 'curve' : 'scop',
      low: ok(o.low) ? o.low! : def.low,
      high: ok(o.high) ? o.high! : def.high,
      share: SHARES.some(([s]) => s === o.share) ? o.share! : def.share,
    };
  } catch {
    return def;
  }
}
function save(v: Inputs) {
  try {
    localStorage.setItem(LS, JSON.stringify(v));
  } catch {
    /* kept for this visit */
  }
}


/** Price of a heating kWh: current HP/HC prices mixed with the heating's own off-peak share. */
function heatingPrice(): { price: number; source: string } | null {
  const p = currentHcHp();
  if (!p) return null;
  const heating = new Set(activeRooms().filter((r) => r.category === 'heating').map((r) => r.id));
  const shares = offPeakShares(new Map([...ds!.tariffs].filter(([room]) => heating.has(displayId(ds!, room)))), offCol());
  return { price: shares.overall * p.hc + (1 - shares.overall) * p.hp, source: p.source };
}

/** Entry point: fills the placeholder section of Analyse, or removes it without a signature. */
export function mountHeatPump(card: HTMLElement | null, records: DayRecord[]) {
  if (!card || !ds || !card.isConnected) return;
  const ref = ds.weather ? referenceSeason(signaturePoints(records, ds.weather), lastDay()) : null;
  if (!ref) return card.remove();
  const input = load();
  const measured = records.filter((r) => r.cat === 'heating' && r.day >= ref.from && r.day <= ref.to).reduce((s, r) => s + r.kwh, 0);
  const season = esc(ref.season.replace('-', '–'));
  card.hidden = false;
  card.innerHTML = html`<div class="card-head"><h2>Et avec une pompe à chaleur ? <small class="muted">estimation, air-air</small></h2></div>
    <p class="hint muted">Ce qu'aurait consommé le chauffage de la saison ${season}${ref.complete ? '' : ' (en cours)'} avec une pompe à chaleur air-air, à partir de votre signature énergétique. <strong>C'est une estimation, pas une étude thermique.</strong></p>
    <div class="sim-form">
      <label>Rendement<select id="hp-mode">
        <option value="scop" ${input.mode === 'scop' ? 'selected' : ''}>SCOP saisi</option>
        <option value="curve" ${input.mode === 'curve' ? 'selected' : ''}>Selon la température</option>
      </select></label>
      <label>SCOP bas<input id="hp-low" type="number" inputmode="decimal" min="1" max="8" step="0.1" value="${input.low}" ${input.mode === 'curve' ? 'disabled' : ''}></label>
      <label>SCOP haut<input id="hp-high" type="number" inputmode="decimal" min="1" max="8" step="0.1" value="${input.high}" ${input.mode === 'curve' ? 'disabled' : ''}></label>
      <label>Part chauffée par la PAC<select id="hp-share">${SHARES.map(([v, l]) => `<option value="${v}" ${v === input.share ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div id="hp-result" class="sim-result" aria-live="polite"></div>
    <details class="table-details"><summary>Comment c'est calculé</summary>
      <p class="hint">Un radiateur électrique transforme 1 kWh d'électricité en 1 kWh de chaleur : la signature de la saison (pente ${num1(-ref.fit.slope)} kWh par °C, plus de chauffage au-dessus de ${num1(ref.fit.balance ?? 0)} °C) donne donc la chaleur dont le logement a besoin chaque jour, chaleur = pente × max(0, seuil − T<sub>ext</sub>), avec la température extérieure réelle du jour. Une pompe à chaleur fournit cette chaleur avec chaleur ÷ COP kWh d'électricité ; la part non couverte reste chauffée par les radiateurs.</p>
      <p class="hint">COP saisonnier : la fourchette saisie (le SCOP de l'étiquette énergie est mesuré en laboratoire, souvent plus haut qu'en usage réel). COP selon la température : courbe indicative d'une PAC air-air (${COP_CURVE.map(([t, c]) => `${t} °C → ${num1(c)}`).join(', ')}), interpolée chaque jour ; le bas de la fourchette retire 15 % (dégivrage, dimensionnement). <strong>Valeurs à vérifier</strong> sur la fiche du modèle proposé.</p>
      <p class="hint muted">Hypothèses : même confort (mêmes consignes), même isolation, apports inchangés ; ni le prix de l'installation, ni l'entretien, ni le changement d'abonnement, ni la climatisation d'été ne sont comptés. Le prix du kWh est celui d'aujourd'hui, avec la répartition heures pleines / creuses de votre chauffage.</p>
    </details>
    <p class="hint">Avant un devis, un conseiller <a href="${FRANCE_RENOV}" target="_blank" rel="noopener">France Rénov'</a> (service public, gratuit) peut vérifier le projet et les aides.</p>`;
  const modeEl = card.querySelector<HTMLSelectElement>('#hp-mode')!;
  const lowEl = card.querySelector<HTMLInputElement>('#hp-low')!;
  const highEl = card.querySelector<HTMLInputElement>('#hp-high')!;
  const shareEl = card.querySelector<HTMLSelectElement>('#hp-share')!;
  const price = heatingPrice();
  const show = () => {
    const v: Inputs = {
      mode: modeEl.value === 'curve' ? 'curve' : 'scop',
      low: Number(lowEl.value.replace(',', '.')),
      high: Number(highEl.value.replace(',', '.')),
      share: Number(shareEl.value),
    };
    lowEl.disabled = highEl.disabled = v.mode === 'curve';
    const zone = card.querySelector<HTMLElement>('#hp-result')!;
    if (v.mode === 'scop' && !(v.low >= 1 && v.high >= 1 && v.low <= 8 && v.high <= 8)) {
      zone.innerHTML = html('<p class="hint">Saisissez un SCOP entre 1 et 8 (une PAC air-air récente : souvent 3 à 4,5 en usage réel).</p>');
      return;
    }
    save(v);
    const mode: CopMode = v.mode === 'scop' ? { kind: 'scop', low: v.low, high: v.high } : { kind: 'curve' };
    const sim = simulateHeatPump(ds!.weather!, ref.from, ref.to, ref.fit, mode, v.share);
    if (!sim) {
      zone.innerHTML = html('<p class="hint muted">Signature insuffisante pour estimer.</p>');
      return;
    }
    const eur = (k: number) => (price ? fmtEur(k * price.price) : '—');
    const range = (a: number, b: number, f: (x: number) => string) => (Math.round(a) === Math.round(b) ? f(a) : `${f(a)} à ${f(b)}`);
    zone.innerHTML = html`<div class="verdict verdict-low">
      <span class="verdict-icon" aria-hidden="true">▼</span>
      <div><p class="verdict-title">Économie estimée : ${range(sim.savedLow, sim.savedHigh, fmtKwh)}${price ? ` · ${range(sim.savedLow * price.price, sim.savedHigh * price.price, fmtEur)}` : ''} sur la saison</p>
      <p class="verdict-sub">Saison ${season} : ${fmtKwh(sim.heatKwh)} de chauffage selon la signature (${fmtKwh(measured)} mesurés) → ${range(sim.lowKwh, sim.highKwh, fmtKwh)} d'électricité avec la PAC, COP saisonnier ${num1(sim.copLow)} à ${num1(sim.copHigh)}${sim.share < 1 ? `, ${nf0.format(sim.share * 100)} % du chauffage par la PAC` : ''}.</p></div>
    </div>
    ${table(
      ['Chauffage', 'kWh', '€', 'Économie'],
      [
        ['Radiateurs (modèle)', fmtKwh(sim.heatKwh), eur(sim.heatKwh), '—'],
        [`PAC favorable (COP ${num1(sim.copHigh)})`, fmtKwh(sim.lowKwh), eur(sim.lowKwh), `−${eur(sim.savedHigh)}`],
        [`PAC prudente (COP ${num1(sim.copLow)})`, fmtKwh(sim.highKwh), eur(sim.highKwh), `−${eur(sim.savedLow)}`],
      ],
    )}
    <p class="hint muted">Montants aux prix actuels. ${price ? `Prix du kWh de chauffage : ${num1(price.price * 100)} c€ (${esc(price.source)}).` : 'Ajoutez vos prix (⚙ Paramètres → Contrat et prix) pour voir les montants en euros.'} ${sim.days} jours avec météo.</p>`;
  };
  modeEl.addEventListener('change', show);
  lowEl.addEventListener('input', show);
  highEl.addEventListener('input', show);
  shareEl.addEventListener('change', show);
  show();
}
