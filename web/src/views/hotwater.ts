// #453: Outils › Simulateurs › « Un chauffe-eau thermodynamique ? » (lazy chunk). The water
// heater's real energy over its last 365 days of readings, priced at the tariff in force each day,
// confronted with three options for the tank of the time it has to be replaced: a lower setpoint,
// everything in the off-peak hours (#441: those in force each day), a heat-pump water heater of a
// typed COP. Every assumption is typed by the owner (hotwater.ts) and recalled under the result.
import { addDays, minusYears } from '../aggregate';
import { activeRooms, ds } from '../app';
import { alertHtml, list, waiting } from '../components';
import { HW_FIELDS, type HotWaterDay, type HotWaterInputs, type HwRow, type HwSim, OFFERED_COP, parseHotWaterInputs, simulateHotWater, zeroAssumption, zeroText } from '../hotwater';
import { type OffPeak, offPeakSentence, shareOn } from '../offpeak';
import { lsKey } from '../scope';
import { inputStore, readNumberForm } from '../sim-inputs';
import { tenant } from '../tenant';
import { html } from '../trusted';
import { esc, fmtEur, hcHpAt, lastDay, longDate, nf0, offCol } from '../ui';
import { offPeakNow } from './offpeak-state';
import '../simulators.css';

const store = inputStore(lsKey('hotwater'), parseHotWaterInputs);
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const kwh = (v: number) => `${nf0.format(v)} kWh`;

const UNITS: Record<keyof HotWaterInputs, [string, string, string]> = {
  cop: ['COP moyen du thermodynamique', '0.1', ''],
  thermoKw: ['Sa puissance électrique, mode pompe à chaleur (kW)', '0.1', ' kW'],
  heaterKw: ['Puissance du chauffe-eau actuel (kW)', '0.1', ' kW'],
  setpoint: ['Consigne actuelle (°C)', '1', ' °C'],
  newSetpoint: ['Consigne envisagée (°C)', '1', ' °C'],
  coldWater: ['Température de l’eau froide (°C)', '1', ' °C'],
  cost: ['Coût du thermodynamique posé (€)', '10', ' €'],
  replacement: ['Coût d’un chauffe-eau électrique neuf posé (€)', '10', ' €'],
};

/** The water heater's last 365 days: energy, and its off-peak part read in the tariff columns. */
function waterDays(): HotWaterDay[] {
  const d = ds!;
  const rooms = new Set(activeRooms().filter((r) => r.category === 'water_heater').map((r) => r.id));
  const last = lastDay();
  const from = addDays(minusYears(last), 1);
  const off = offCol();
  const on = off === 1 ? 2 : 1;
  const byDay = new Map<string, HotWaterDay>();
  for (const r of d.records) {
    if (r.cat !== 'water_heater' || !rooms.has(r.room) || r.day < from || r.day > last) continue;
    const e = byDay.get(r.day) ?? { day: r.day, kwh: 0, off: 0 };
    e.kwh += r.kwh;
    const t = d.tariffs.get(r.room)?.get(r.day);
    // a day split only when every water heater of the day is (else the off-peak part is unknown)
    e.off = e.off !== null && t && t[1] + t[2] > 0 ? e.off + (r.kwh * t[off]) / (t[off] + t[on]) : null;
    byDay.set(r.day, e);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

export function mountHotWater(view: HTMLElement) {
  if (!ds || !view.isConnected) return;
  const d = ds;
  const typed = store.load();
  const value = (k: keyof HotWaterInputs) => {
    const v = typed[k];
    if (v !== null) return String(v);
    return k === 'cop' ? String(OFFERED_COP) : '';
  };
  const solarLink = tenant().on ? '' : ' Le surplus de panneaux solaires envoyé dans le ballon (routeur ou pilotage) se chiffre dans <a href="#outils-solaire">Des panneaux solaires</a>, scénario « avec pilotage ».';
  view.innerHTML = html(`<section class="card" id="hw-card" aria-labelledby="hw-title">
    <div class="card-head"><h2 id="hw-title">Et pour l’eau chaude ?</h2></div>
    <p class="hint muted">L’énergie réelle de votre chauffe-eau sur ses 365 derniers jours de relevés, comparée à trois pistes, pour préparer la décision le jour où le ballon sera à remplacer : baisser sa consigne, le faire chauffer tout en heures creuses, ou le remplacer par un chauffe-eau thermodynamique (une pompe à chaleur qui prend la chaleur de l’air du local où il est posé).${solarLink}</p>
    <h3>Vos hypothèses</h3>
    <p class="hint muted">Chaque chiffre vient de vous et reste sur cet appareil. Seul le COP est proposé (${nf1.format(OFFERED_COP)}, une hypothèse) : remplacez-le par celui de la fiche du modèle, pour un local à la température du vôtre.</p>
    <div class="sim-form" id="hw-form">${HW_FIELDS.map(
      ([k, , min, max]) => `<label>${esc(UNITS[k][0])}<input type="number" inputmode="decimal" id="hw-${k}" data-hw="${k}" min="${min}" max="${max}" step="${UNITS[k][1]}" value="${esc(value(k))}"></label>`,
    ).join('')}</div>
    <div id="hw-result" class="sim-result" aria-live="polite"></div>
    <details class="table-details"><summary>Comment c’est calculé</summary>
      <p class="hint">Chaque jour, l’énergie du chauffe-eau relevée par Intuis et sa part en heures creuses (la colonne du compteur où il a consommé) sont prises telles quelles, au prix en vigueur ce jour-là (tarif réglementé du jour, ou vos prix saisis). Les 365 derniers jours sont ramenés à une année.</p>
      <p class="hint">Consigne : l’énergie varie comme l’écart entre la consigne et l’eau froide, énergie × (consigne envisagée − eau froide) ÷ (consigne actuelle − eau froide) ; les pertes du ballon sont supposées baisser dans la même proportion, ce qui simplifie. Heures creuses : toute l’énergie passe en heures creuses, dans la limite de la puissance du chauffe-eau multipliée par les heures creuses du jour, si vous la saisissez. Thermodynamique : énergie ÷ COP, avec la même part en heures creuses qu’aujourd’hui, dans la limite de sa puissance multipliée par les heures creuses du jour, si vous la saisissez (le reste passe en heures pleines).</p>
      <p class="hint">Retour : coût du thermodynamique moins celui d’un chauffe-eau électrique neuf (la dépense de toute façon à la fin de vie du ballon), divisé par l’économie d’une année, sans actualisation, entretien ni aides.</p>
    </details>
  </section>`);
  const form = view.querySelector<HTMLElement>('#hw-form')!;
  form.addEventListener('input', () => {
    store.save(parseHotWaterInputs(readNumberForm(form, 'hw')));
    draw(view, d);
  });
  draw(view, d);
}

function draw(view: HTMLElement, d: NonNullable<typeof ds>) {
  if (ds !== d || !view.isConnected) return;
  const zone = view.querySelector<HTMLElement>('#hw-result');
  if (!zone) return;
  const days = waterDays();
  if (!days.some((x) => x.kwh > 0)) {
    zone.innerHTML = html('<p class="hint">Aucun chauffe-eau relevé sur les 365 derniers jours : ce simulateur part de son énergie réelle (catégorie « chauffe-eau » d’une pièce, ⚙ Mon logement).</p>');
    return;
  }
  // #428, #441: the shared off-peak hours, those in force each day
  const hc = offPeakNow(() => view.isConnected && draw(view, d));
  if (!hc) {
    zone.innerHTML = html(waiting('des heures creuses'));
    return;
  }
  const i = store.load();
  if (i.cop === null) i.cop = OFFERED_COP;
  const sim = simulateHotWater(days, i, (day) => hcHpAt(day), (day) => shareOn(hc, day).reduce((s, x) => s + x, 0) / 2)!;
  zone.innerHTML = html(result(sim, i, days, hc, store.load().cop === null));
}

const NAMES: Record<HwRow['key'], string> = {
  now: 'Aujourd’hui',
  setpoint: 'Baisser la consigne',
  offpeak: 'Tout chauffer en heures creuses',
  thermo: 'Un chauffe-eau thermodynamique',
};

function rowSub(r: HwRow, i: HotWaterInputs): string {
  if (!r.year) return `à compléter : ${r.missing.join(', ')}`;
  const parts = [`${kwh(r.year.kwh)} par an`, `${nf0.format(r.year.kwh > 0 ? (r.year.off / r.year.kwh) * 100 : 0)} % en heures creuses`];
  if (r.key !== 'now' && r.savedKwh !== null && Math.round(r.savedKwh) > 0) parts.push(`${kwh(r.savedKwh)} de moins`);
  if (r.key !== 'now' && r.savedEur !== null && Math.round(r.savedEur) !== 0) parts.push(savedText(r.savedEur));
  if (r.key === 'setpoint') parts.push(`${nf0.format(i.newSetpoint!)} °C au lieu de ${nf0.format(i.setpoint!)} °C`);
  if (r.key === 'thermo') parts.push(`COP ${nf1.format(i.cop!)}`);
  if (r.overflowDays) parts.push(`${r.overflowDays} jour${r.overflowDays > 1 ? 's' : ''} où la chauffe dépasserait les heures creuses`);
  if (r.key === 'thermo')
    parts.push(r.payback === 0 ? 'pas plus cher qu’un électrique neuf' : r.payback !== null ? `retour ${nf1.format(r.payback)} ans` : i.cost === null ? 'retour : saisissez son coût' : r.savedEur !== null ? 'ne se rembourse pas' : '');
  return parts.filter(Boolean).join(' · ');
}

/**
 * #499: « 7 € de moins par an », said under the option; the column holds what each option costs a year
 * (a « −7 €/an » beside « 250 €/an » read as a negative cost).
 */
const savedText = (eur: number) => (eur < 0 ? `${fmtEur(-eur)} de plus par an` : `${fmtEur(eur)} de moins par an`);

function result(sim: HwSim, i: HotWaterInputs, days: HotWaterDay[], hc: OffPeak, copOffered: boolean): string {
  const [now, , , thermo] = sim.rows;
  const verdict = thermo.year
    ? `<div class="verdict verdict-low"><span class="verdict-icon" aria-hidden="true">▼</span><div><p class="verdict-title">Avec un COP de ${nf1.format(i.cop!)} : ${kwh(thermo.year.kwh)} par an au lieu de ${kwh(now.year!.kwh)}${
        thermo.savedEur !== null ? `, ${fmtEur(thermo.savedEur)} de moins` : ''
      }</p><p class="verdict-sub">Un chauffe-eau thermodynamique, sur la même eau chaude que vos ${nf0.format(sim.days)} derniers jours de relevés${sim.zeroDays ? ` avec de l’énergie (${zeroText(sim.zeroDays)} écarté${sim.zeroDays > 1 ? 's' : ''}, voir les hypothèses)` : ''}${copOffered ? ', avec le COP proposé (une hypothèse, à remplacer par celui du modèle)' : ''}.</p></div></div>`
    : '';
  const rows = list(
    sim.rows.map((r) => ({
      title: NAMES[r.key],
      sub: rowSub(r, i),
      value: r.year?.eur != null ? `${fmtEur(r.year.eur)}/an` : '', // #499: a column of costs only
    })),
    'Pistes pour l’eau chaude',
  );
  const low = i.newSetpoint !== null && i.newSetpoint < 55;
  const assumptions = [
    `Relevés du chauffe-eau du ${longDate(days[0].day)} au ${longDate(days[days.length - 1].day)} : ${nf0.format(sim.days)} jours avec de l’énergie, dont ${nf0.format(sim.splitDays)} avec la répartition heures pleines / creuses${
      sim.share !== null && sim.splitDays < sim.days ? ` (les autres jours : ${nf0.format(sim.share * 100)} % en heures creuses, la part de la période)` : ''
    }${sim.days < 365 ? ` ; chiffres ramenés à 365 jours (× ${nf2.format(365 / sim.days)})` : ''}.`,
    ...(sim.zeroDays ? [zeroAssumption(sim)] : []),
    now.year?.eur == null ? 'Montants en euros : il manque vos prix (⚙ Paramètres → Contrat et prix) ou la répartition heures pleines / creuses des relevés.' : 'Prix : ceux en vigueur chaque jour (tarif réglementé du jour, ou vos prix saisis), sans abonnement.',
    ...HW_FIELDS.map(([k, label]) => `${label.charAt(0).toUpperCase()}${label.slice(1)} : ${i[k] === null ? '<em>non saisi</em>' : `${nf2.format(i[k]!)}${UNITS[k][2]}${k === 'cop' && copOffered ? ' (proposé, non saisi)' : ''}`}`),
    `${esc(offPeakSentence(hc))}.`,
    'Non comptés : la chaleur que le thermodynamique prend au local (qui se refroidit, et peut demander du chauffage s’il est chauffé) ; ni bruit, ni entretien, ni aides, ni abonnement.',
  ];
  return `${verdict}
    ${low ? alertHtml('warn', 'Une consigne basse favorise le développement des légionelles dans le ballon : les recommandations sanitaires demandent de garder l’eau assez chaude en sortie du ballon (en général au moins 55 °C). À vérifier avant de la baisser.', { role: 'status' }) : ''}
    ${rows}
    <h3>Hypothèses de ce résultat</h3>
    <ul class="sim-assumptions">${assumptions.map((a) => `<li>${a}</li>`).join('')}</ul>`;
}
