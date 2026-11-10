// #356: Outils › Simulateurs › « Des panneaux solaires ? » (lazy chunk). The real Linky curve at
// the half hour confronted with a production profile (PVGIS through the nightly collection, from
// the location of ⚙ Mon logement, or a PVGIS file imported here), for 3, 4.5 and 6 kWc: production,
// share used at home, surplus, saving, payback; without and with piloting of the water heater
// and the car, then with a 5 or 10 kWh battery. Every price, cost and efficiency is typed by the
// owner and recalled under the result: nothing is assumed by the code.
import { datasetDoc, ds, onLock } from '../app';
import { alert, alertHtml, list } from '../components';
import { lastCurveDay } from '../curve';
import { loadCurve, loadSolarDoc } from '../data';
import { HC_END, HC_START, isOffPeakSlot } from '../ev';
import { loadNote, saveNote } from '../local-store';
import { lsKey } from '../scope';
import {
  INPUT_FIELDS,
  type SizeRows,
  type SolarDoc,
  type SolarInputs,
  SIZES,
  azimuthWord,
  combinedProfile,
  moneyMissing,
  parsePvgisFile,
  parseSolarDoc,
  parseSolarInputs,
  roofsKwc,
  runAll,
  simWindow,
  yearlyPerKwc,
} from '../solar';
import { localDay } from '../glossary';
import { html } from '../trusted';
import { esc, fmtEur, hcHpAt, lastDay, longDate, nf0, table, tableToggle } from '../ui';
import '../simulators.css';

const LS = lsKey('solar');
const IMPORT_NOTE = 'pvgis-import';
const curveDoc = datasetDoc((d) => loadCurve(d));
const solarDoc = datasetDoc((d) => loadSolarDoc(d).then(parseSolarDoc));
/** The PVGIS file imported on this device (encrypted note), read once per dataset. */
const importDoc = datasetDoc((d) => loadNote(IMPORT_NOTE, d.source, d.key, parseSolarDoc, null));
let importMsg: { ok: boolean; text: string } | null = null;
let useImport: boolean | null = null;
/** An import that could not be saved (private browsing…): kept until locking. */
let memoryImport: SolarDoc | null = null;
onLock(() => {
  memoryImport = null;
  importMsg = null;
  useImport = null;
});

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
const pct = (part: number, whole: number) => (whole > 0 ? `${nf0.format((part / whole) * 100)} %` : '—');
const kwh = (v: number) => `${nf0.format(v)} kWh`;

function loadInputs(): SolarInputs {
  try {
    return parseSolarInputs(JSON.parse(localStorage.getItem(LS) ?? '{}'));
  } catch {
    return parseSolarInputs({});
  }
}
function saveInputs(v: SolarInputs) {
  try {
    localStorage.setItem(LS, JSON.stringify(v));
  } catch {
    /* kept for this visit */
  }
}

const UNITS: Record<keyof SolarInputs, [string, string]> = {
  priceHp: ['Prix du kWh, heures pleines (€)', '0.001'],
  priceHc: ['Prix du kWh, heures creuses (€)', '0.001'],
  feedIn: ['Tarif de rachat du surplus (€/kWh)', '0.001'],
  costPerKwc: ['Coût installé par kWc (€)', '10'],
  batteryCostPerKwh: ['Coût installé de la batterie par kWh (€)', '10'],
  batteryEfficiency: ['Rendement de la batterie, aller-retour (%)', '1'],
  heaterKw: ['Puissance du chauffe-eau (kW)', '0.1'],
  evKwhWeek: ['Recharge de la voiture à la maison, la nuit (kWh/semaine)', '1'],
  evKw: ['Puissance de recharge (kW)', '0.1'],
};

/** Daily Wh of the water heater(s) as recorded by Intuis: what piloting may move to the sun. */
function heaterByDay(): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of ds!.records) if (r.cat === 'water_heater') out.set(r.day, (out.get(r.day) ?? 0) + r.kwh * 1000);
  return out;
}

export function mountSolar(view: HTMLElement) {
  if (!ds || !view.isConnected) return;
  const d = ds;
  const typed = loadInputs();
  // prices of the contract in force, offered (not saved) until the owner types their own
  const contract = hcHpAt(lastDay());
  const value = (k: keyof SolarInputs) => {
    const v = typed[k];
    if (v !== null) return String(v);
    if (contract && (k === 'priceHp' || k === 'priceHc')) return String(Math.round((k === 'priceHp' ? contract.hp : contract.hc) * 10000) / 10000);
    return '';
  };
  view.innerHTML = html(`<section class="card" id="solar-card" aria-labelledby="solar-title">
    <div class="card-head"><h2 id="solar-title">Des panneaux solaires ?</h2></div>
    <p class="hint muted">Votre consommation réelle, à la demi-heure (compteur Linky), confrontée à ce que produiraient des panneaux posés sur vos toits : ce que la maison utiliserait elle-même, ce qui partirait sur le réseau, et ce que cela ferait économiser, avec ou sans pilotage, avec ou sans batterie.</p>
    ${alert('warn', 'Toit en fibro-ciment : amiante probable', 'Un toit en fibro-ciment ancien contient souvent de l’amiante. Son retrait est réglementé (diagnostic, entreprise certifiée, déchets spécifiques) et se budgète à part, que l’on pose des panneaux ou non.')}
    ${alertHtml('info', '<p><b>Le pilotage avant la batterie</b></p><p>Faire chauffer l’eau à midi plutôt que la nuit, et recharger la voiture les jours de soleil, absorbe le surplus pour presque rien. Une batterie ne fait que déplacer le surplus d’été vers le soir d’été, pas vers l’hiver du chauffage : elle se juge une fois le pilotage fait, et c’est ainsi qu’elle est calculée ici.</p>')}
    <h3>Profil de production</h3>
    <div id="solar-profile" aria-live="polite"></div>
    <h3>Vos hypothèses</h3>
    <p class="hint muted">Rien n’est supposé à votre place : chaque chiffre vient de vous (les prix de votre contrat sont proposés) et reste sur cet appareil.</p>
    <div class="sim-form" id="solar-form">${INPUT_FIELDS.map(
      ([k, , min, max]) => `<label>${esc(UNITS[k][0])}<input type="number" inputmode="decimal" id="solar-${k}" data-solar="${k}" min="${min}" max="${max}" step="${UNITS[k][1]}" value="${esc(value(k))}"></label>`,
    ).join('')}</div>
    <div id="solar-result" class="sim-result" aria-live="polite"></div>
    <details class="table-details"><summary>Comment c’est calculé</summary>
      <p class="hint">Chaque demi-heure des 365 derniers jours de relevés Linky est confrontée à la production de la même demi-heure, au même jour de l’année, dans le profil (une année de météo réelle, heure par heure). Ce que la maison consomme pendant que les panneaux produisent est autoconsommé ; le reste part sur le réseau (surplus). Un jour sans courbe complète est reconstitué à partir du total du jour Linky, réparti comme une journée moyenne de la courbe.</p>
      <p class="hint">Pilotage : chaque jour, l’énergie du chauffe-eau relevée par Intuis (et la recharge saisie, supposée la nuit dans la courbe) quitte les heures creuses (${HC_START} h → ${HC_END} h) pour les demi-heures où il y a du surplus, dans la limite de la puissance de l’appareil ; ce qui ne trouve pas de soleil reste la nuit.</p>
      <p class="hint">Batterie : après le pilotage, le surplus la charge (avec le rendement saisi), elle rend son énergie dès que la maison tire sur le réseau, d’un jour au suivant. Sa puissance n’est pas limitée et elle ne vieillit pas : le résultat est le meilleur cas.</p>
      <p class="hint">Économie : achats évités (heures pleines ou creuses selon la demi-heure) plus le surplus payé au tarif de rachat, sans abonnement ni taxes nouvelles. Retour : coût installé divisé par l’économie d’une année, sans actualisation ni entretien.</p>
    </details>
  </section>`);
  const form = view.querySelector<HTMLElement>('#solar-form')!;
  form.addEventListener('input', () => {
    const next: Record<string, number> = {};
    for (const el of form.querySelectorAll<HTMLInputElement>('[data-solar]')) {
      const raw = el.value.trim().replace(',', '.');
      if (raw !== '') next[el.dataset.solar!] = Number(raw);
    }
    saveInputs(parseSolarInputs(next));
    draw(view, d);
  });
  draw(view, d);
}

function profileOf(view: HTMLElement): { doc: SolarDoc | null; waiting: boolean } {
  const redraw = () => {
    if (view.isConnected && ds) draw(view, ds);
  };
  const collected = solarDoc.get(ds, redraw);
  const imported = importDoc.get(ds, redraw) ?? memoryImport;
  const waiting = solarDoc.status(ds) === 'loading' || importDoc.status(ds) === 'loading' || curveDoc.status(ds) === 'loading';
  const pick = useImport ?? !!imported;
  return { doc: (pick ? imported : collected) ?? collected ?? imported ?? null, waiting };
}

function draw(view: HTMLElement, d: NonNullable<typeof ds>) {
  if (ds !== d || !view.isConnected) return;
  const zone = view.querySelector<HTMLElement>('#solar-result');
  const pz = view.querySelector<HTMLElement>('#solar-profile');
  if (!zone || !pz) return;
  const { doc, waiting } = profileOf(view);
  drawProfile(pz, view, d, doc, solarDoc.get(d) ?? null, importDoc.get(d) ?? memoryImport);
  const curve = curveDoc.get(d, () => view.isConnected && draw(view, d));
  if (!curve || waiting) {
    const failed = curveDoc.status(d) === 'failed';
    zone.innerHTML = html(`<p class="hint muted" role="status">${failed ? (navigator.onLine ? 'Courbe de charge indisponible.' : 'Courbe de charge indisponible hors ligne.') : 'Chargement de la courbe de charge et du profil…'}</p>`);
    return;
  }
  if (!lastCurveDay(curve)) {
    zone.innerHTML = html('<p class="hint">Ce simulateur a besoin de la courbe de charge Linky à la demi-heure (à activer dans votre espace Enedis, puis ⚙ Sources de données).</p>');
    return;
  }
  if (!doc) {
    zone.innerHTML = html('<p class="hint">Il manque un profil de production : indiquez la localisation et les toits dans <a href="#parametres-logement">⚙ Mon logement</a> (la collecte de la nuit le demandera à PVGIS), ou importez un fichier PVGIS ci-dessus.</p>');
    return;
  }
  const inputs = loadInputs();
  const offered = hcHpAt(lastDay());
  if (inputs.priceHp === null && offered) inputs.priceHp = offered.hp;
  if (inputs.priceHc === null && offered) inputs.priceHc = offered.hc;
  const profile = combinedProfile(doc.roofs);
  const heater = heaterByDay();
  const w = simWindow(curve, d.linky, d.meta.home.timezone, profile, (day) => heater.get(day) ?? 0);
  if (!w || !w.days.length) {
    zone.innerHTML = html('<p class="hint">Pas une seule journée complète dans la courbe de charge : rien à simuler pour l’instant.</p>');
    return;
  }
  const rows = runAll(w, inputs, isOffPeakSlot);
  zone.innerHTML = html(result(rows, inputs, w, doc, profile ? yearlyPerKwc(profile) : 0, heater.size > 0));
}

function drawProfile(pz: HTMLElement, view: HTMLElement, d: NonNullable<typeof ds>, doc: SolarDoc | null, collected: SolarDoc | null, imported: SolarDoc | null) {
  const what = (x: SolarDoc) =>
    x.source === 'import'
      ? `Fichier PVGIS importé sur cet appareil${x.database ? ` (${x.database}${x.year ? `, ${x.year}` : ''})` : ''}`
      : x.source === 'demo'
        ? `Profil fictif de démonstration (${x.roofs.map((r) => r.name).join(', ')})`
        : `PVGIS ${x.database}${x.year ? `, météo ${x.year}` : ''}, demandé par la collecte le ${x.fetched ? longDate(x.fetched) : '—'} pour ${x.roofs.length} toit${x.roofs.length > 1 ? 's' : ''} (${x.roofs.map((r) => r.name).join(', ')})`;
  const roofs = doc?.location?.roofs ?? [];
  pz.innerHTML = html(`${
    doc
      ? `<p class="hint"><strong>${esc(what(doc))}</strong> : ${nf0.format(yearlyPerKwc(combinedProfile(doc.roofs)))} kWh par kWc et par an${roofs.length ? `, toits ${roofs.map((r) => `${esc(r.name)} ${azimuthWord(r.azimuth)} ${r.tilt}°`).join(', ')}` : ''}.</p>`
      : '<p class="hint">Aucun profil de production pour l’instant.</p>'
  }
  ${doc && doc.source !== 'demo' ? '<p class="hint muted">Source : PVGIS © Union européenne.</p>' : ''}
  ${collected && imported ? `<div class="controls"><button type="button" class="link" id="solar-switch">${doc === imported ? 'Utiliser plutôt le profil de la collecte' : 'Utiliser plutôt le fichier importé'}</button></div>` : ''}
  <details class="table-details"${!collected && !imported ? ' open' : ''}><summary>Importer un fichier PVGIS</summary>
    <p class="hint">Sur le site PVGIS de la Commission européenne (re.jrc.ec.europa.eu, « Données horaires »), indiquez votre commune, la pente et l’orientation d’un toit, cochez « Production PV », puis téléchargez le CSV ou le JSON. Le fichier est lu sur cet appareil : seule la production heure par heure est gardée, chiffrée ici, jamais les coordonnées qu’il contient.</p>
    <label class="file-pick">Fichier PVGIS (CSV ou JSON)<input type="file" id="solar-file" accept=".csv,.json,text/csv,application/json"></label>
    ${imported ? '<div class="controls"><button type="button" class="link" id="solar-forget">Oublier le fichier importé</button></div>' : ''}
  </details>
  ${importMsg ? alertHtml(importMsg.ok ? 'info' : 'bad', esc(importMsg.text), { role: 'status' }) : ''}`);
  pz.querySelector('#solar-switch')?.addEventListener('click', () => {
    useImport = doc !== imported;
    draw(view, d);
  });
  pz.querySelector('#solar-forget')?.addEventListener('click', () => {
    memoryImport = null;
    void saveNote(IMPORT_NOTE, d.source, d.key, null).then(() => {
      importDoc.reset();
      useImport = false;
      importMsg = { ok: true, text: 'Fichier oublié.' };
      draw(view, d);
    });
  });
  pz.querySelector<HTMLInputElement>('#solar-file')?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    void file.text().then(async (text) => {
      const r = parsePvgisFile(text);
      if ('error' in r) {
        importMsg = { ok: false, text: r.error };
        return draw(view, d);
      }
      const doc: SolarDoc = { source: 'import', year: r.year, database: r.database, fetched: localDay(), location: null, roofs: [r.roof] };
      const kept = await saveNote(IMPORT_NOTE, d.source, d.key, doc);
      importDoc.reset();
      useImport = true;
      importMsg = { ok: true, text: `Profil importé : ${nf0.format(yearlyPerKwc(r.roof.hours))} kWh par kWc et par an${kept ? ', gardé chiffré sur cet appareil.' : ' (gardé jusqu’au verrouillage seulement).'}` };
      if (!kept) memoryImport = doc;
      draw(view, d);
    });
  });
}

function result(rows: SizeRows[], i: SolarInputs, w: NonNullable<ReturnType<typeof simWindow>>, doc: SolarDoc, perKwc: number, hasHeater: boolean): string {
  const money = moneyMissing(i);
  const mid = rows.find((r) => r.kwc === 4.5) ?? rows[0];
  const [sans, pilote] = mid.rows;
  // a list, not a table: four columns of long scenario names do not fit 360 px (#356)
  const blocks = rows
    .map((s) => {
      const prod = s.rows[0].year?.production ?? 0;
      const head = `<h3>${nf1.format(s.kwc)} kWc · ≈ ${kwh(prod)} produits par an</h3>`;
      const body = list(
        s.rows.map((r) => ({
          title: r.label,
          sub: r.year
            ? `${pct(r.year.selfConsumed, r.year.production)} autoconsommé · ${kwh(r.year.surplus)} de surplus${r.year.moved ? ` · ${kwh(r.year.moved)} déplacés` : ''}${r.year.fromBattery ? ` · ${kwh(r.year.fromBattery)} rendus par la batterie` : ''}${r.payback !== null ? ` · retour ${nf1.format(r.payback)} ans` : ''}`
            : `à compléter : ${r.missing.join(', ')}`,
          value: r.saving !== null ? `${fmtEur(r.saving)}/an` : '',
        })),
        `${nf1.format(s.kwc)} kWc`,
      );
      const detail = tableToggle(
        table(
          ['kWh par an', 'Auto.', 'Surplus', 'Acheté'],
          s.rows.map((r, n) => {
            const name = ['Sans pilotage', 'Pilotage', 'Bat. 5 kWh', 'Bat. 10 kWh'][n] ?? r.label;
            return r.year ? [esc(name), nf0.format(r.year.selfConsumed), nf0.format(r.year.surplus), nf0.format(r.year.bought)] : [esc(name), '—', '—', '—'];
          }),
        ),
      );
      return `${head}${body}${detail}`;
    })
    .join('');
  // what the battery adds on top of piloting, alone (#356 § 3: piloting first)
  const batteryLines = mid.rows
    .slice(2)
    .filter((r) => r.saving !== null && pilote.saving !== null && i.batteryCostPerKwh !== null)
    .map((r) => {
      const gain = r.saving! - pilote.saving!;
      const cost = r.scenario.battery * i.batteryCostPerKwh!;
      return `Batterie de ${r.scenario.battery} kWh, après pilotage, avec ${nf1.format(mid.kwc)} kWc : ${fmtEur(gain)} de plus par an pour ${fmtEur(cost)}, ${gain > 0 ? `soit ${nf1.format(cost / gain)} ans pour la rembourser` : 'elle ne se rembourse pas'}.`;
    });
  const missing = [...new Set(rows.flatMap((s) => s.rows.flatMap((r) => r.missing)))];
  const needs = [...money, ...(i.costPerKwc === null ? ['coût installé par kWc'] : []), ...missing];
  const verdict = sans.year
    ? `<div class="verdict"><span class="verdict-icon" aria-hidden="true">☀</span><div><p class="verdict-title">Avec ${nf1.format(mid.kwc)} kWc, la maison utiliserait ${pct(sans.year.selfConsumed, sans.year.production)} de sa production${
        pilote.year ? `, ${pct(pilote.year.selfConsumed, pilote.year.production)} avec le pilotage` : ''
      }</p><p class="verdict-sub">${kwh(sans.year.production)} produits par an, dont ${kwh(sans.year.surplus)} partiraient sur le réseau sans pilotage. Le chauffage consomme l’hiver, les panneaux produisent l’été : c’est l’écart que mesure ce simulateur.</p></div></div>`
    : '';
  const kwcRoofs = doc.location ? roofsKwc(doc.location.roofs) : null;
  const assumptions = [
    `Relevés Linky du ${longDate(w.days[0].day)} au ${longDate(w.to)} : ${nf0.format(w.days.length)} jours, dont ${nf0.format(w.curveDays)} de courbe à la demi-heure et ${nf0.format(w.rebuiltDays)} reconstitués depuis le total du jour${w.days.length < 365 ? ` ; chiffres ramenés à 365 jours (× ${nf2.format(365 / w.days.length)})` : ''}.`,
    `Profil : ${nf0.format(perKwc)} kWh par kWc et par an ; une installation de 3, 4,5 ou 6 kWc garde la répartition de vos toits${kwcRoofs !== null && SIZES.some((k) => k > kwcRoofs) ? ` (vos toits portent ${nf1.format(kwcRoofs)} kWc : au-delà, c’est une hypothèse)` : ''}.`,
    ...INPUT_FIELDS.map(([k, label]) => `${label.charAt(0).toUpperCase()}${label.slice(1)} : ${i[k] === null ? '<em>non saisi</em>' : `${nf2.format(i[k]!)}${k === 'batteryEfficiency' ? ' %' : k === 'heaterKw' || k === 'evKw' ? ' kW' : k === 'evKwhWeek' ? ' kWh par semaine' : ' €'}`}`),
    `Heures creuses de ${HC_START} h à ${HC_END} h (celles de votre compteur, sur votre facture, peuvent différer)${hasHeater ? ' ; énergie du chauffe-eau relevée chaque jour par Intuis' : ' ; aucun chauffe-eau relevé par Intuis : seule la recharge saisie peut être pilotée'}.`,
  ];
  return `${verdict}
    ${needs.length ? alertHtml('info', `Pour compléter le tableau, indiquez : ${esc([...new Set(needs)].join(', '))}.`, { role: 'status' }) : ''}
    ${blocks}
    ${batteryLines.length ? `<h3>La batterie seule</h3>${batteryLines.map((l) => `<p class="hint">${esc(l)}</p>`).join('')}` : ''}
    <h3>Hypothèses de ce résultat</h3>
    <ul class="sim-assumptions">${assumptions.map((a) => `<li>${a}</li>`).join('')}</ul>`;
}
