// E13 card in Confort (lazy chunk, document loaded on demand): open windows, boost, setpoint modes,
// heating and load shedding per room, from the hourly room-state snapshots (S-13.3 to S-13.6).
import { addDays, bucketLabel } from '../aggregate';
import { datasetDoc, ds, onDatasetLoaded, rerender, state } from '../app';
import { barChart } from '../charts';
import { isBedroom } from '../comfort';
import { loadRoomState } from '../data';
import { BEDROOMS_ID } from '../household';
import { esc, longDate, nf0, roomColor, table, tableToggle } from '../ui';
import {
  type RoomState,
  anomaliesWithWindows,
  bedroomGrouping,
  boostEnergy,
  coldWithWindow,
  confirmedAbsences,
  contactor,
  coverage,
  dailyOpen,
  daysBetween,
  lastStateDay,
  modeLabel,
  monthlyOpen,
  offloadDays,
  signatureEffect,
  totals,
} from '../windows';

const BEDROOMS = BEDROOMS_ID;
const EXCLUDE_HOURS = 2;
// #247: loaded for the dataset shown; `doc` / `failed` are refreshed from it at each render.
const stateDoc = datasetDoc(async (d) => (await loadRoomState(d)) ?? ({} as RoomState));
let doc: RoomState | null = null;
let failed = false;
let exclude = false;
onDatasetLoaded(() => {
  doc = null;
  failed = false;
  exclude = false;
});

const f1 = (v: number) => v.toFixed(1).replace('.', ',').replace('-', '−');
const h1 = (v: number) => `${f1(v)} h`;

function ensure() {
  doc = stateDoc.get(ds, () => state.view === 'comfort' && rerender()) ?? null;
  failed = stateDoc.status(ds) === 'failed';
}

function roomLabel(id: string) {
  if (id === BEDROOMS) return 'Chambres (regroupées)';
  return ds!.meta.rooms.find((r) => r.id === id)?.name ?? 'Pièce inconnue';
}

/** S-13.5: bedrooms merged into one line unless the household asked to see them. */
const grouping = (showBedrooms: boolean) => bedroomGrouping(ds!.meta.rooms, showBedrooms);

const head = `<div class="card-head"><h2>Fenêtres ouvertes et radiateurs <small class="muted">relevé horaire de l'état des pièces</small></h2></div>`;

export function windowsCard(showBedrooms: boolean): string {
  if (!ds!.meta.has_roomstate)
    return `<section class="card" id="windows-card">${head}
    <p class="hint muted">Pas encore de relevé de l'état des pièces. L'API Intuis ne garde pas l'historique des fenêtres ouvertes ni du boost : un relevé horaire facultatif les note (une requête par heure, chiffrée, sans commit). Pour l'activer, ajoutez la variable de dépôt <code>ROOM_STATE_HOURLY</code> = <code>true</code> (voir le README).</p></section>`;
  ensure();
  if (!doc)
    return `<section class="card" id="windows-card">${head}<p class="hint muted">${failed ? 'Relevés de l\'état des pièces indisponibles.' : 'Chargement des relevés de l\'état des pièces…'}</p></section>`;
  const rs = doc;
  const last = lastStateDay(rs);
  if (!last) return `<section class="card" id="windows-card">${head}<p class="hint muted">Aucun jour complet relevé pour l'instant : la première journée apparaît le lendemain.</p></section>`;
  const from30 = addDays(last, -29);
  const cov = coverage(rs, from30, last);
  const group = grouping(showBedrooms);
  const t30 = totals(rs, from30, last, group);
  const keys = [...t30.keys()].filter((k) => t30.get(k)!.n > 0 && (t30.get(k)!.boost || t30.get(k)!.open || t30.get(k)!.heating || t30.get(k)!.days)).sort((a, b) => t30.get(b)!.open - t30.get(a)!.open);
  const hasBedrooms = ds!.meta.rooms.some((r) => isBedroom(r.name));
  const boost = boostEnergy(ds!.records, rs);
  const boost30 = (k: string) => {
    let kwh = 0;
    for (const [room, months] of boost) if (group(room) === k) for (const [m, v] of months) if (m >= from30.slice(0, 7)) kwh += v.kwh;
    return kwh;
  };
  const rows = keys
    .filter((k) => !ds!.meta.rooms.find((r) => r.id === k && r.category === 'water_heater'))
    .map((k) => {
      const t = t30.get(k)!;
      const modes = Object.entries(t.modes)
        .filter(([, h]) => h >= 0.5)
        .map(([m, h]) => `${esc(modeLabel(m))} ${nf0.format(h)} h`)
        .join(', ');
      return [esc(roomLabel(k)), h1(t.open), h1(t.boost), t.boost && k !== BEDROOMS ? `≈ ${f1(boost30(k))} kWh` : '—', h1(t.heating), h1(t.offload), modes || '—', `${nf0.format((t.n / (t.days * 24)) * 100)} %`];
    });
  // monthly open-window hours, last 12 months
  const monthly = monthlyOpen(rs, group);
  const months = [...new Set([...monthly.values()].flatMap((m) => [...m.keys()]))].sort().slice(-12);
  const monthRows = [...monthly.keys()]
    .sort()
    .map((k) => [esc(roomLabel(k)), ...months.map((m) => (monthly.get(k)!.has(m) ? nf0.format(monthly.get(k)!.get(m)!) : '—'))]);
  return `<section class="card" id="windows-card">${head}
    <p class="hint muted">Relevés reçus sur les 30 derniers jours : <strong>${nf0.format(cov.hours)} h sur ${nf0.format(cov.expected)}</strong> (${nf0.format((cov.hours / cov.expected) * 100)} %). Les heures sont estimées au prorata des relevés reçus chaque jour.${
      hasBedrooms && !showBedrooms ? ' Les chambres sont regroupées par respect pour leurs occupants.' : ''
    }</p>
    <div class="chart" id="windows-chart" role="img" aria-label="Heures de fenêtre ouverte par jour et par pièce, 30 derniers jours"></div>
    ${table(['Pièce (30 jours)', 'Fenêtre ouverte', 'Boost', 'Pendant le boost', 'Radiateur en chauffe', 'Délestage', 'Autres modes', 'Couverture'], rows)}
    ${hasBedrooms && !showBedrooms ? '<button type="button" class="toggle" data-comfort="show-bedrooms">Afficher le détail des chambres</button>' : ''}
    <h3 class="sub-title">Par mois <small class="muted">heures de fenêtre ouverte</small></h3>
    ${tableToggle(table(['Pièce', ...months.map((m) => bucketLabel(`${m}-01`, 'month'))], monthRows))}
    ${explanations(rs, last, group)}
    ${signatureBlock(rs)}
    ${absencesBlock(rs)}
    ${offloadBlock(rs, last)}
    <details class="method"><summary>Méthode</summary>
      <p class="hint">Chaque heure, un workflow GitHub demande l'état courant des pièces à Intuis (<code>homestatus</code> : fenêtre ouverte détectée par le radiateur, boost, mode de consigne, chauffe, délestage). Le relevé est chiffré et gardé trois jours hors du dépôt ; chaque nuit, la collecte le transforme en <strong>heures par pièce et par jour</strong> et l'efface de fait (expiration). Un relevé manqué (GitHub retarde parfois ses tâches horaires) est compensé au prorata : 2 relevés « fenêtre ouverte » sur 22 reçus font 2,2 h. Rien n'est gardé heure par heure et la présence n'est pas conservée.</p>
      <p class="hint">« Fenêtre ouverte » est la détection du radiateur (chute rapide de température), pas un capteur sur la fenêtre. « Pendant le boost » : énergie du jour de la pièce × part des heures de chauffe passées en boost (estimation). Valeurs relevées : ${
        Object.entries(rs.values ?? {})
          .map(([k, v]) => `<code>${esc(k)}</code> ${v.map((x) => esc(x)).join(', ')}`)
          .join(' · ') || '—'
      }.</p>
    </details>
  </section>`;
}

function explanations(rs: RoomState, last: string, group: (r: string) => string) {
  const from = addDays(last, -89);
  const allCold = coldWithWindow(ds!.temps, rs, from, last);
  const cold = allCold.filter((c) => group(c.room) === c.room).slice(0, 8);
  const hidden = allCold.some((c) => group(c.room) !== c.room);
  const unusual = ds!.weather ? anomaliesWithWindows(ds!.records, ds!.weather, rs).filter((a) => a.day >= from).slice(0, 5) : [];
  const items = [
    ...cold.map((c) => `<li>${esc(longDate(c.day))} — <strong>${esc(roomLabel(c.room))}</strong> à ${f1(c.temp)} °C en moyenne : fenêtre ouverte ${h1(c.open)}.</li>`),
    ...unusual.map((a) => `<li>${esc(longDate(a.day))} — jour inhabituel (${a.z > 0 ? 'plus' : 'moins'} de chauffage que prévu par la météo) : fenêtres ouvertes ${h1(a.open)} au total.</li>`),
  ];
  return `<h3 class="sub-title">Pourquoi cette pièce était froide ? <small class="muted">90 derniers jours</small></h3>
    ${
      items.length
        ? `<p class="hint muted">Jours sous 19 °C (sonde du radiateur) ou inhabituels avec une fenêtre ouverte : explication possible, pas certaine.${hidden ? ' Les chambres regroupées ne sont pas détaillées.' : ''}</p><ul class="plain">${items.join('')}</ul>`
        : '<p class="hint muted">Aucun jour froid ou inhabituel avec une fenêtre ouverte sur les 90 derniers jours.</p>'
    }`;
}

function signatureBlock(rs: RoomState) {
  if (!ds!.weather) return '';
  const e = signatureEffect(ds!.records, ds!.weather, rs, EXCLUDE_HOURS);
  if (!e) return '';
  const slope = (v: number) => `${f1(-v)} kWh/°C`;
  const bal = (v: number | null) => (v === null ? '—' : `${f1(v)} °C`);
  const w = e.without;
  const diff = w ? `Pente ${slope(w.slope)} au lieu de ${slope(e.all.slope)} (${w.slope === e.all.slope ? 'inchangée' : `${f1(-(w.slope - e.all.slope))} kWh/°C d'écart`}), seuil de chauffe ${bal(w.balance)} au lieu de ${bal(e.all.balance)}.` : 'Trop peu de jours restants pour recalculer la signature.';
  return `<h3 class="sub-title">Effet sur la signature énergétique <small class="muted">saison ${esc(e.season)}</small></h3>
    <label class="toggle"><input type="checkbox" data-windows="exclude" ${exclude ? 'checked' : ''}> Exclure les jours avec une fenêtre ouverte plus de ${EXCLUDE_HOURS} h</label>
    <p class="hint muted">Signature de la saison : ${slope(e.all.slope)} par degré plus froid, seuil de chauffe ${bal(e.all.balance)}, sur ${e.all.n} jours de chauffe.</p>
    ${exclude ? `<p id="windows-signature">${e.excluded} jour${e.excluded > 1 ? 's' : ''} exclu${e.excluded > 1 ? 's' : ''}. ${diff}</p>` : ''}`;
}

function absencesBlock(rs: RoomState) {
  const runs = confirmedAbsences(rs);
  if (!runs.length) return '';
  const total = runs.reduce((s, [a, b]) => s + daysBetween(a, b).length, 0);
  const [a, b] = runs[runs.length - 1];
  return `<h3 class="sub-title">Absences confirmées par le mode de consigne</h3>
    <p>${total} jour${total > 1 ? 's' : ''} en mode absence ou hors-gel (au moins 12 h dans toutes les pièces) ; dernière période : ${a === b ? `le ${esc(longDate(a))}` : `du ${esc(longDate(a))} au ${esc(longDate(b))}`}. Ces jours sont des absences « confirmées par le mode de consigne », pas seulement devinées par la consommation.</p>`;
}

function offloadBlock(rs: RoomState, last: string) {
  const from = addDays(last, -89);
  const days = offloadDays(rs, ds!.pmax, from, last);
  const c = contactor(rs, from, last);
  const parts: string[] = [];
  if (days.length)
    parts.push(`<p class="hint muted">Le délestage coupe des radiateurs quand la puissance appelée approche de l'abonnement. ${days.length} jour${days.length > 1 ? 's' : ''} avec délestage sur 90 jours.</p>
    ${tableToggle(table(['Jour', 'Pièces délestées', 'Heures (toutes pièces)', 'Pic Linky du jour'], days.slice(0, 30).map((d) => [esc(longDate(d.day)), d.rooms, h1(d.hours), d.pmax === null ? '—' : `${f1(d.pmax)} kVA`])))}`);
  if (c.lastMode)
    parts.push(`<p class="hint muted">Contacteur du chauffe-eau : mode relevé <strong>${esc(c.lastMode)}</strong> le ${esc(longDate(c.last!))} (${Object.entries(c.hours)
      .map(([m, h]) => `${esc(m)} ${nf0.format(h)} h`)
      .join(', ')} sur 90 jours ; valeurs à vérifier).</p>`);
  return parts.length ? `<h3 class="sub-title">Délestage et contacteur <small class="muted">90 derniers jours</small></h3>${parts.join('')}` : '';
}

const firstBedroom = () => ds!.meta.rooms.find((r) => isBedroom(r.name))?.id ?? '';

export function drawWindows(showBedrooms: boolean) {
  const el = document.getElementById('windows-chart');
  const rs = doc;
  if (!el || !rs) return;
  const last = lastStateDay(rs)!;
  const days = daysBetween(addDays(last, -29), last);
  const per = dailyOpen(rs, days, grouping(showBedrooms));
  barChart(el, {
    labels: days.map((d) => bucketLabel(d, 'day')),
    series: [...per.keys()]
      .sort()
      .map((k) => ({ name: roomLabel(k), color: roomColor(k === BEDROOMS && !ds!.meta.rooms.some((r) => r.id === BEDROOMS) ? firstBedroom() : k), data: per.get(k)! })),
    stacked: true,
    price: null,
    unit: 'h',
  });
}

export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  if (t.dataset.windows === 'exclude') {
    exclude = (t as HTMLInputElement).checked;
    rerender();
    return true;
  }
  return false;
}
