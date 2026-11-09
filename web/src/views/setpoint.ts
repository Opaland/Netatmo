// S-4.11: "Et si je baissais la consigne de 1 °C ?" — simulation from the energy signature.
// Hidden when there is no usable signature.
import type { DayRecord } from '../aggregate';
import { offPeakShares, signaturePoints } from '../analysis';
import { ds } from '../app';
import { referenceSeason, roomShares, simulateSetpoint } from '../checks';
import { displayId } from '../household';
import { activeRooms, esc, fmtEur, fmtKwh, lastDay, nf0, offCol, table } from '../ui';
import { currentHcHp } from './waterheater';
import { html } from '../trusted';
import { fmt1 as num1 } from '../glossary';

let dT = -1; // °C, negative = lower setpoint (kept while the app is open)

const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num1(Math.abs(v))}`;

function reference(records: DayRecord[]) {
  if (!ds!.weather) return null;
  return referenceSeason(signaturePoints(records, ds!.weather), lastDay());
}

export function setpointCard(records: DayRecord[]): string {
  const ref = reference(records);
  if (!ref) return '';
  return `<section class="card" id="setpoint-card">
    <div class="card-head"><h2>Et si je demandais 1 °C de moins aux radiateurs ? <small class="muted">estimation, toutes les pièces</small></h2></div>
    <label class="setpoint-slider">Changer la température demandée aux radiateurs (consigne) de toutes les pièces de <strong id="sp-value">${signed(dT)} °C</strong>
      <input type="range" id="sp-range" min="-2" max="2" step="0.5" value="${dT}" aria-describedby="sp-result" style="width:100%"></label>
    <div id="sp-result" aria-live="polite"></div>
    <details class="table-details"><summary>Méthode</summary>
      <p class="hint">La signature énergétique de la saison ${esc(ref.season.replace('-', '–'))}${ref.complete ? '' : ' (en cours, faute de saison complète)'} donne la pente (kWh par °C d'écart) et la température de non-chauffage, au-dessus de laquelle les radiateurs ne chauffent plus. Celle-ci suit la consigne : baisser la consigne de ΔT l'abaisse aussi de ΔT. On recalcule alors chaque jour de la saison avec sa température extérieure réelle : kWh = pente × max(0, seuil + ΔT − T<sub>ext</sub>). La répartition par pièce suit la part de chaque pièce dans le chauffage de la saison.</p>
      <p class="hint muted">C'est une estimation : elle suppose que toutes les pièces baissent d'autant, que l'isolation et les apports (soleil, occupants) ne changent pas, et elle ne tient pas compte du confort. La règle ADEME (environ 7 % par degré) sert de garde-fou.</p>
    </details>
  </section>`;
}

export function drawSetpoint(records: DayRecord[]) {
  const zone = document.getElementById('sp-result');
  const range = document.getElementById('sp-range') as HTMLInputElement | null;
  if (!zone || !range) return;
  const ref = reference(records)!;
  // Heating price: current off-peak / peak prices mixed with the heating's own off-peak share.
  const prices = currentHcHp();
  const heating = new Set(activeRooms().filter((r) => r.category === 'heating').map((r) => r.id));
  const shares = offPeakShares(new Map([...ds!.tariffs].filter(([room]) => heating.has(displayId(ds!, room)))), offCol());
  const price = prices ? shares.overall * prices.hc + (1 - shares.overall) * prices.hp : null;
  const perRoom = roomShares(records, ref.from, ref.to);
  const show = () => {
    document.getElementById('sp-value')!.textContent = `${signed(dT)} °C`;
    if (dT === 0) {
      zone.innerHTML = html('<p class="hint muted">Déplacez le curseur pour simuler une température demandée plus basse (à gauche) ou plus haute (à droite).</p>');
      return;
    }
    const sim = simulateSetpoint(ds!.weather!, ref.from, ref.to, ref.fit, dT, ref.season);
    if (!sim) {
      zone.innerHTML = html('<p class="hint muted">Signature insuffisante pour simuler.</p>');
      return;
    }
    const gain = sim.savedKwh >= 0;
    const eur = price !== null ? Math.abs(sim.savedKwh) * price : null;
    const gap = Math.abs(sim.pct) - Math.abs(sim.ademePct);
    zone.innerHTML = html`<div class="verdict verdict-${gain ? 'low' : 'high'}">
      <span class="verdict-icon" aria-hidden="true">${gain ? '▼' : '▲'}</span>
      <div><p class="verdict-title">${gain ? 'Économie' : 'Surcoût'} estimé${gain ? 'e' : ''} : ${fmtKwh(Math.abs(sim.savedKwh))} (${nf0.format(Math.abs(sim.pct))} %)${eur !== null ? ` · ${fmtEur(eur)}` : ''} sur la saison</p>
      <p class="verdict-sub">Saison ${esc(sim.season.replace('-', '–'))} : pente ${num1(sim.slope)} kWh/°C, plus de chauffage au-dessus de ${num1(sim.balance)} °C, qui passerait à ${num1(sim.balance + dT)} °C. Chauffage modélisé ${fmtKwh(sim.modelKwh)} → ${fmtKwh(sim.newKwh)}${price !== null ? `, à ${num1(price * 100)} c€/kWh (prix actuels)` : ''}.</p></div>
    </div>
    <p class="hint">Règle ADEME : environ ${nf0.format(Math.abs(sim.ademePct))} % pour ${num1(Math.abs(dT))} °C. ${
      Math.abs(gap) <= 4
        ? 'La simulation est cohérente avec cet ordre de grandeur.'
        : `Écart de ${nf0.format(Math.abs(gap))} points avec la simulation : <strong>à vérifier</strong> (signature peu fiable, R² ${num1(ref.fit.r2)}, ou maison atypique).`
    }</p>
    ${table(
      ['Pièce', 'Part du chauffage', 'kWh', ...(eur !== null ? ['€'] : [])],
      activeRooms()
        .filter((r) => (perRoom.get(r.id) ?? 0) > 0)
        .sort((a, b) => perRoom.get(b.id)! - perRoom.get(a.id)!)
        .map((r) => {
          const s = perRoom.get(r.id)!;
          return [
            esc(r.name),
            `${nf0.format(s * 100)} %`,
            `${gain ? '−' : '+'}${fmtKwh(Math.abs(sim.savedKwh) * s)}`,
            ...(eur !== null ? [`${gain ? '−' : '+'}${fmtEur(eur * s)}`] : []),
          ];
        }),
    )}`;
  };
  range.addEventListener('input', () => {
    dT = Number(range.value);
    show();
  });
  show();
}
