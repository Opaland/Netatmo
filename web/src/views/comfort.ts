// Comfort ("Confort"), loaded on demand: night CO₂ (S-11.1), cellar humidity (S-11.2),
// hours under a threshold per room (S-11.3) and radiator probe vs station (S-3.8).
import { addDays, bucketLabel, minusYears } from '../aggregate';
import { datasetDoc, ds, householdStatus, onDatasetLoaded, rerender, revealBedrooms, setState, state } from '../app';
import {
  type NightRow,
  type StationHourly,
  co2Modules,
  coldWinterDays,
  dewPoint,
  heatedModules,
  hoursBelow,
  indoorModules,
  humidRuns,
  isCellar,
  isBedroom,
  lastNightDay,
  lastNights,
  nameSimilarity,
  nightVerdict,
  offsetAdvice,
  offsetStats,
  seasonOf,
  signed,
  suggestMapping,
  sumSeason,
  summarizeNights,
  wetStreak,
} from '../comfort';
import { comboChart, cssVar, lineChart, seqRamp } from '../charts';
import { type Station, loadStationHourly } from '../data';
import { activeRooms, esc, lastDay, longDate, moduleColor, nf0, stationMapping, table, tableToggle, measureColor, referenceColor } from '../ui';
import { html } from '../trusted';
import * as windows from './windows';
import * as ha from './ha';
import { fmt1 as f1 } from '../glossary';
import { alertHtml } from '../components';
import { pressureCard } from './pressure';
import { lazyCard } from '../lazy';

// #247: station hourly readings of the dataset shown; `hourly` / `hourlyFailed` refreshed from it.
const stationDoc = datasetDoc((d) => loadStationHourly(d));
let hourly: StationHourly | null = null;
let hourlyFailed = false;
/** S-11.1 / S-12.2: bedroom detail hidden until a deliberate gesture, forgotten at the next lock. */
let showBedrooms = false;
/** The module choices stay unfolded after a change (the view is drawn again). */
let linksOpen = false;
onDatasetLoaded(() => {
  linksOpen = false;
  hourly = null;
  hourlyFailed = false;
  showBedrooms = false;
});

export const THRESHOLDS = [17, 17.5, 18, 18.5, 19, 19.5, 20, 20.5, 21];
const HUMID_HOURS = 65; // % — threshold of the collected `hours.humid`
const HUMID_DAYS = 70; // % daily mean, more than 7 days in a row (S-11.2, to be confirmed)
const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
const dayLabel = (d: string) => bucketLabel(d, 'day');
const verdictBox = (level: 'low' | 'mid' | 'high', title: string, sub = '') =>
  `<div class="verdict verdict-${level}" role="status"><span class="verdict-icon" aria-hidden="true">${level === 'low' ? '✓' : level === 'high' ? '!' : '~'}</span><div><p class="verdict-title">${title}</p>${sub ? `<p class="verdict-sub">${sub}</p>` : ''}</div></div>`;

function heatingRooms() {
  return activeRooms().filter((r) => r.category === 'heating');
}
const mapping = stationMapping;
/**
 * Name shown for a station module: the room it is linked to when the names differ (a module
 * « Cave » placed in « Chambre bleue » reads « Chambre bleue (module Cave) »), else its own name.
 */
function moduleLabel(st: Station, map: Map<string, string>, k: string): string {
  const name = st.modules[k].name;
  const room = heatingRooms().find((r) => map.get(r.id) === k);
  return room && nameSimilarity(room.name, name) < 1 ? `${room.name} (module ${name})` : name;
}

export function renderComfort(view: HTMLElement) {
  const st = ds!.station;
  const map = mapping(st);
  view.innerHTML = html`
  <section class="card">
    <h2>Confort <small class="muted">air, humidité, froid</small></h2>
    <p class="hint muted">${
      st
        ? 'Relevés de la station Netatmo (moyennes horaires) et des sondes des radiateurs. Les seuils sont stricts : « au-dessus de 1 400 ppm » veut dire plus de 1 400.'
        : 'Aucune station Netatmo n\'est reliée : seules les températures mesurées par les radiateurs sont utilisées (moyennes par jour). Ajoutez la station dans Paramètres pour le CO₂ de la nuit et l\'humidité de la cave.'
    }</p>
  </section>
  ${pressureCard(st, ds!, lastDay())}
  ${st ? co2Cards(st, map) : ''}
  ${st ? cellarCards(st, map) : ''}
  ${coldCard(st, map)}
  <div id="lower-zone"></div>
  ${windows.windowsCard(showBedrooms)}
  ${ha.haCard(showBedrooms)}
  ${st ? probeCard(st, map) : ''}`;
  if (st) {
    drawCo2(st, map);
    drawCellar(st, map);
    drawProbes(st, map);
  }
  drawCold(st, map);
  windows.drawWindows(showBedrooms);
  // #452: the lower level, loaded on demand (its rooms and changes are read from this device)
  void lazyCard(() => import('./lower'), (m) => m.fillLower(showBedrooms), { zone: 'lower-zone', what: 'Niveau inférieur' });
}

// ------------------------------------------------------------------ S-11.1 night CO₂
function nightsOf(st: Station, k: string): (NightRow | null)[] | null {
  const nightly = st.nightly?.[k];
  if (!nightly) return null;
  const last = lastNightDay(nightly);
  if (!last) return null;
  return lastNights(nightly, last, 30);
}

function co2Cards(st: Station, map: Map<string, string>) {
  const keys = co2Modules(st.modules, st.nightly ?? {}, map.values());
  if (!keys.length)
    return `<section class="card"><h2>CO₂ de la nuit</h2><p class="hint muted">Les agrégats de nuit arriveront avec la prochaine collecte de la station (relevés horaires).</p></section>`;
  return keys
    .map((k, i) => {
      const name = moduleLabel(st, map, k);
      const head = `<h2>CO₂ de la nuit — ${esc(name)} <small class="muted">22 h → 7 h, 30 dernières nuits</small></h2>`;
      if (isBedroom(name) && !showBedrooms)
        return `<section class="card">${head}
        <p class="hint muted">Le détail des chambres est masqué par défaut, par respect pour leurs occupants. Il reste affiché jusqu'au prochain verrouillage.</p>
        <button type="button" class="btn secondary" data-comfort="show-bedrooms">Afficher le détail des chambres</button></section>`;
      const rows = nightsOf(st, k) ?? [];
      const s = summarizeNights(rows);
      const v = nightVerdict(s);
      const sub = [
        s.maxPpm !== null ? `Pic des nuits complètes : ${nf0.format(s.maxPpm)} ppm.` : '',
        `En moyenne ${f1(s.meanHours1000)} h par nuit au-dessus de 1 000 ppm.`,
        s.incomplete ? `${s.incomplete} nuit${s.incomplete > 1 ? 's' : ''} incomplète${s.incomplete > 1 ? 's' : ''} (moins de 9 heures relevées, en pâle) non comptée${s.incomplete > 1 ? 's' : ''}.` : '',
        s.missing ? `${s.missing} sans relevé.` : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<section class="card">${head}
      ${verdictBox(v.level, esc(v.text), sub)}
      <p class="hint muted">Barres : heures de la nuit au-dessus de 1 000 ppm (air confiné) et de 1 400 ppm (aération insuffisante). Ligne : maximum horaire de la nuit. La nuit d'un jour va de 22 h à 7 h le lendemain.</p>
      <div class="chart" id="co2-${i}" role="img" aria-label="CO₂ de la nuit, ${esc(name)}"></div>
      ${tableToggle(
        table(
          ['Nuit du', 'Heures > 1 000 ppm', 'Heures > 1 400 ppm', 'Maximum', 'Relevés'],
          rows
            .slice()
            .reverse()
            .filter((r): r is NightRow => !!r)
            .map((r) => [
              longDate(r.day),
              r.h_co2_1000,
              r.h_co2_1400,
              r.co2_max === null ? '—' : `${nf0.format(r.co2_max)} ppm`,
              r.complete ? `${r.n} h` : `${r.n} h (incomplète)`,
            ]),
        ),
      )}</section>`;
    })
    .join('');
}

function drawCo2(st: Station, map: Map<string, string>) {
  co2Modules(st.modules, st.nightly ?? {}, map.values()).forEach((k, i) => {
    const el = document.getElementById(`co2-${i}`);
    const rows = nightsOf(st, k);
    if (!el || !rows) return;
    const ramp = seqRamp();
    comboChart(el, {
      labels: rows.map((r, j) => (r ? `${dayLabel(r.day)}${r.complete ? '' : ' (incomplète)'}` : dayLabel(addDays(lastNightDay(st.nightly![k])!, j - rows.length + 1)))),
      bars: [
        { name: 'Heures > 1 000 ppm', color: ramp[1], data: rows.map((r) => r?.h_co2_1000 ?? null) },
        { name: 'Heures > 1 400 ppm', color: ramp[3], data: rows.map((r) => r?.h_co2_1400 ?? null) },
      ],
      lines: [{ name: 'Maximum de la nuit', color: cssVar('--text-muted'), data: rows.map((r) => r?.co2_max ?? null) }],
      barUnit: 'h',
      lineUnit: 'ppm',
      barMax: 9,
      dim: rows.map((r) => !!r && !r.complete),
      lineMark: { value: 1400, label: '1 400 ppm' },
    });
  });
}

// ------------------------------------------------------------------ S-11.2 cellar humidity
/** Cellar-like modules, except one the user linked to a heated room: it is in that room, not in a cellar. */
function cellarKeys(st: Station, map: Map<string, string>) {
  const linked = new Set(map.values());
  return Object.keys(st.modules).filter((k) => st.modules[k].indoor && isCellar(st.modules[k].name) && !linked.has(k));
}

function cellarCards(st: Station, map: Map<string, string>) {
  const last = lastDay();
  const from = addDays(last, -89);
  return cellarKeys(st, map)
    .map((k, i) => {
      const name = st.modules[k].name;
      const daily = st.daily[k] ?? {};
      const hrs = st.hours?.[k] ?? {};
      let humidHours = 0;
      let wetDays = 0;
      for (const d of days(from, last)) {
        const h = hrs[d]?.humid ?? 0;
        humidHours += h;
        if (h >= 12) wetDays++;
      }
      const run = humidRuns(daily, HUMID_DAYS, from, last);
      // spread temperature − dew point over the last 7 days
      const spreads = days(addDays(last, -6), last)
        .map((d) => daily[d])
        .filter((v) => v && v[3] !== null)
        .map((v) => v[2] - (dewPoint(v[2], v[3] as number) ?? v[2]));
      const spread = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null;
      const streak = wetStreak(hrs, last);
      const level = run.current > 7 || streak > 7 || (spread !== null && spread < 3) ? 'high' : run.longest > 7 || wetDays > 0 ? 'mid' : 'low';
      const title =
        run.current > 7
          ? `Humidité au-dessus de ${HUMID_DAYS}\u00a0% depuis ${run.current} jours : risque de moisissure, aérer par temps sec ou déshumidifier.`
          : streak > 7
            ? `Plus de 12 h par jour au-dessus de ${HUMID_HOURS}\u00a0% depuis ${streak >= 90 ? 'plus de 90' : streak} jours : risque de moisissure, aérer par temps sec ou déshumidifier.`
            : run.longest > 7
            ? `Humidité au-dessus de ${HUMID_DAYS}\u00a0% pendant ${run.longest} jours d'affilée (jusqu'au ${longDate(run.longestEnd!)}) sur les 90 derniers jours.`
            : wetDays
              ? `${wetDays} jour${wetDays > 1 ? 's' : ''} sur 90 avec au moins 12 h au-dessus de ${HUMID_HOURS}\u00a0% : à surveiller.`
              : `Pas d'humidité prolongée sur les 90 derniers jours.`;
      const sub = `${nf0.format(humidHours)} h au-dessus de ${HUMID_HOURS}\u00a0% en 90 jours.${
        spread !== null ? ` Cette semaine, la cave est en moyenne ${f1(spread)}\u00a0°C au-dessus de son point de rosée${spread < 3 ? ' : un mur plus froid de quelques degrés se couvre de condensation' : ''}.` : ''
      }`;
      return `<section class="card">
      <h2>Humidité — ${esc(name)} <small class="muted">90 derniers jours</small></h2>
      ${verdictBox(level, esc(title), sub)}
      <p class="hint muted">Le <strong>point de rosée</strong> est la température à laquelle l'humidité de l'air se condense. Il est calculé ici à partir des moyennes du jour (température et humidité). Plus il est proche de la température de la cave, plus les surfaces froides se mouillent. Repères : au-delà de ${HUMID_HOURS}\u00a0% d'humidité les moisissures peuvent se développer ; au-delà de ${HUMID_DAYS}\u00a0% plus de 7 jours d'affilée, le risque est installé (seuils indicatifs, à confirmer).</p>
      <div class="chart" id="cellar-${i}" role="img" aria-label="Humidité et point de rosée, ${esc(name)}"></div>
      ${tableToggle(
        table(
          ['Jour', `Heures > ${HUMID_HOURS}\u00a0%`, 'Humidité moyenne', 'Température moyenne', 'Point de rosée', 'Écart'],
          days(from, last)
            .reverse()
            .filter((d) => daily[d] || hrs[d])
            .map((d) => {
              const v = daily[d];
              const dp = v && v[3] !== null ? dewPoint(v[2], v[3]) : null;
              return [
                longDate(d),
                hrs[d] ? `${hrs[d].humid}${hrs[d].n < 24 ? ` sur ${hrs[d].n}` : ''}` : '—',
                v && v[3] !== null ? `${v[3]}\u00a0%` : '—',
                v ? `${f1(v[2])}\u00a0°C` : '—',
                dp !== null ? `${f1(dp)}\u00a0°C` : '—',
                dp !== null ? `${f1(v[2] - dp)}\u00a0°C` : '—',
              ];
            }),
        ),
      )}</section>`;
    })
    .join('');
}

function drawCellar(st: Station, map: Map<string, string>) {
  const last = lastDay();
  const ds90 = days(addDays(last, -89), last);
  cellarKeys(st, map).forEach((k, i) => {
    const el = document.getElementById(`cellar-${i}`);
    if (!el) return;
    const daily = st.daily[k] ?? {};
    const hrs = st.hours?.[k] ?? {};
    comboChart(el, {
      labels: ds90.map(dayLabel),
      bars: [{ name: `Heures > ${HUMID_HOURS}\u00a0%`, color: seqRamp()[2], data: ds90.map((d) => hrs[d]?.humid ?? null) }],
      lines: [
        { name: 'Température moyenne', color: measureColor(), data: ds90.map((d) => daily[d]?.[2] ?? null) },
        {
          name: 'Point de rosée',
          // #446: a threshold computed from the measure (condensation below it), not a room
          color: referenceColor(),
          dashed: true,
          data: ds90.map((d) => {
            const v = daily[d];
            const dp = v && v[3] !== null ? dewPoint(v[2], v[3]) : null;
            return dp === null ? null : Math.round(dp * 10) / 10;
          }),
        },
      ],
      barUnit: 'h',
      lineUnit: '°C',
      barMax: 24,
      dim: ds90.map((d) => !!hrs[d] && hrs[d].n < 24),
    });
  });
}

// ------------------------------------------------------------------ S-11.3 hours under a threshold
interface ComfortRoom {
  label: string;
  source: 'station' | 'radiator';
  module?: string;
  room?: string;
}

/** Heated rooms for comfort: Intuis rooms (station when linked, radiator otherwise) + unlinked heated modules. */
function comfortRooms(st: Station | null, map: Map<string, string>): ComfortRoom[] {
  const out: ComfortRoom[] = heatingRooms().map((r) =>
    map.has(r.id) ? { label: r.name, source: 'station', module: map.get(r.id)!, room: r.id } : { label: r.name, source: 'radiator', room: r.id },
  );
  if (st) {
    const linked = new Set(map.values());
    for (const k of heatedModules(st.modules)) if (!linked.has(k)) out.push({ label: st.modules[k].name, source: 'station', module: k });
  }
  return out.filter((r) => r.source === 'station' || ds!.temps.has(r.room!));
}

/** Per-day hours below the threshold for a module: collected aggregate at 19 °C, else hourly docs. */
function coldPerDay(st: Station, k: string, thr: number): Map<string, { n: number; cold: number }> | null {
  if (thr === 19 && st.hours?.[k]) {
    const out = new Map<string, { n: number; cold: number }>();
    for (const [d, v] of Object.entries(st.hours[k])) if (v.cold !== undefined) out.set(d, { n: v.n, cold: v.cold });
    return out;
  }
  return hourly ? hoursBelow(hourly.get(k), thr) : null;
}

function ensureHourly() {
  if (!(ds!.meta.station_hourly_years ?? []).length) return;
  hourly = stationDoc.get(ds, () => state.view === 'confort' && rerender()) ?? null;
  hourlyFailed = stationDoc.status(ds) === 'failed';
}

function currentSeason() {
  const last = lastDay();
  return seasonOf(last) ?? Number(last.slice(0, 4)) - (Number(last.slice(5, 7)) < 11 ? 1 : 0);
}

function coldCard(st: Station | null, map: Map<string, string>) {
  const thr = state.comfortThreshold;
  const rooms = comfortRooms(st, map);
  const needHourly = !!st && thr !== 19;
  if (needHourly) ensureHourly();
  const waiting = needHourly && !hourly;
  const s = currentSeason();
  const t = `${f1(thr)}\u00a0°C`;
  // #294: one definition of a cold day everywhere (Pièces too): the day's mean under the threshold
  const coldDaysCell = (r: ComfortRoom, season: number) => {
    const means: [string, number | null][] =
      r.source === 'radiator'
        ? [...ds!.temps.get(r.room!)!].map(([d, [m]]) => [d, m])
        : Object.entries(st!.daily[r.module!] ?? {}).map(([d, v]) => [d, v[2]]);
    const c = coldWinterDays(means, season, thr);
    return c ? `${c.under} j sur ${c.n}` : null;
  };
  const cell = (r: ComfortRoom, season: number) => {
    const days = coldDaysCell(r, season);
    if (r.source === 'radiator') return days ?? '—';
    const per = coldPerDay(st!, r.module!, thr);
    const sum = per && sumSeason(per, season);
    return sum ? `${nf0.format(sum.hours)} h (${nf0.format((sum.hours / sum.n) * 100)}\u00a0%)${days ? ` · ${days}` : ''}` : waiting ? '…' : (days ?? '—');
  };
  const stationRooms = rooms.filter((r) => r.source === 'station');
  return `<section class="card">
    <div class="card-head"><h2>Heures sous ${t} <small class="muted">pièces chauffées</small></h2>
      <div class="controls"><label class="select"><span class="sr-only">Seuil</span><select data-comfort="threshold">${THRESHOLDS.map(
        (v) => `<option value="${v}" ${v === thr ? 'selected' : ''}>Sous ${f1(v)}\u00a0°C</option>`,
      ).join('')}</select></label></div></div>
    <p class="hint muted">Source : <strong>station Netatmo</strong> (relevés horaires) quand la pièce est liée à un module, sinon <strong>sonde du radiateur</strong> (moyenne du jour : on compte alors des jours, pas des heures). La cave et l'extérieur ne sont pas des pièces chauffées.${
      waiting ? (hourlyFailed ? ' Relevés horaires indisponibles pour ce seuil.' : ' Chargement des relevés horaires pour ce seuil…') : ''
    }</p>
    ${stationRooms.length ? `<div class="chart" id="cold-chart" role="img" aria-label="Heures sous ${t} par jour, 30 derniers jours"></div>` : ''}
    ${table(
      ['Pièce', 'Source', `Hiver ${s - 1}–${s}`, `Hiver ${s}–${s + 1}`],
      rooms.map((r) => [esc(r.label), r.source === 'station' ? `Station (${esc(st!.modules[r.module!].name)})` : 'Radiateur', cell(r, s - 1), cell(r, s)]),
      2,
    )}
    <p class="hint muted">Hiver = 1er novembre → 31 mars. « h (%) » : heures sous le seuil et part des heures relevées (station) ; « j sur N » : <strong>jours à moyenne sous le seuil</strong> sur les jours relevés, même définition que dans Pièces, quelle que soit la source.</p>
  </section>`;
}

function drawCold(st: Station | null, map: Map<string, string>) {
  const el = document.getElementById('cold-chart');
  if (!el || !st) return;
  const thr = state.comfortThreshold;
  const last = lastDay();
  const d30 = days(addDays(last, -29), last);
  const rooms = comfortRooms(st, map).filter((r) => r.source === 'station');
  // #306: one line per room (60 thin grouped bars were unreadable on a phone)
  lineChart(el, {
    labels: d30.map(dayLabel),
    series: rooms.map((r) => {
      const per = coldPerDay(st, r.module!, thr);
      // #399: the colour follows the room (same as in Pièces and in Historique › Station météo)
      return { name: r.label, color: moduleColor(st, r.module!), data: d30.map((d) => per?.get(d)?.cold ?? null) };
    }),
    price: null,
    unit: 'h',
    max: 24,
  });
}

// ------------------------------------------------------------------ S-3.8 radiator probe vs station
/** Rooms compared on the card: every heated room linked to a station module, in the same order for the charts. */
function probeRooms(map: Map<string, string>) {
  return heatingRooms().filter((r) => map.has(r.id));
}

function probeCard(st: Station, map: Map<string, string>) {
  const rooms = heatingRooms();
  if (!rooms.length) return '';
  // every indoor module, whatever its name (a « Cave » module may sit in « Chambre bleue »)
  const candidates = indoorModules(st.modules);
  if (!candidates.length) return '';
  const suggested = suggestMapping(rooms, st.modules);
  const last = lastDay();
  const from = addDays(minusYears(last), 1);
  const linked = probeRooms(map);
  const pair = (r: { name: string }, k: string) =>
    `<h3 class="sub-title">${esc(r.name)} <small class="muted">sonde du radiateur ↔ module « ${esc(st.modules[k].name)} »</small></h3>`;
  const compared = linked
    .map((r, i) => {
      const k = map.get(r.id)!;
      if (!ds!.temps.has(r.id)) return `${pair(r, k)}<p class="hint muted">Pas de température relevée par les radiateurs de cette pièce : rien à comparer.</p>`;
      const o = offsetStats(ds!.temps.get(r.id), st.daily[k], from, last);
      if (!o) return `${pair(r, k)}<p class="hint muted">Pas de jour de chauffe (novembre à mars) avec les deux mesures sur les 12 derniers mois.</p>`;
      return `${pair(r, k)}
        <p>Écart moyen <strong>${signed(o.mean)}\u00a0°C</strong> : la sonde du radiateur lit ${o.mean >= 0 ? 'plus chaud' : 'plus froid'} que la station, sur ${o.n} jours de chauffe ; d'un jour à l'autre, l'écart ${o.stable ? 'reste stable' : 'varie'} (±\u00a0${f1(o.sd)}\u00a0°C).</p>
        ${offsetAdvice(o, state.comfortThreshold)
          .map((p) => `<p class="hint">${esc(p)}</p>`)
          .join('')}
        <div class="chart" id="probe-${i}" role="img" aria-label="Température du radiateur et de la station, ${esc(r.name)}"></div>
        ${tableToggle(
          table(
            ['Mois', 'Radiateur', 'Station', 'Écart', 'Jours'],
            o.months
              .slice()
              .reverse()
              .map((m) => [bucketLabel(`${m.month}-01`, 'month'), `${f1(m.radiator)}\u00a0°C`, `${f1(m.station)}\u00a0°C`, `${signed(m.offset)}\u00a0°C`, m.n]),
          ),
        )}`;
    })
    .join('');
  return `<section class="card" id="probe-card">
    <h2>Radiateur et station : écart de température <small class="muted">pièces liées à un module</small></h2>
    <p class="hint muted">Le radiateur règle sa chauffe sur sa propre sonde, placée contre l'appareil ; le module de la station, posé dans la pièce, mesure ce que vous ressentez. L'<strong>écart moyen</strong> (radiateur − station, jours de chauffe des 12 derniers mois) dit de combien la sonde se trompe : s'il est stable, recalez la consigne d'autant pour obtenir la température voulue à la station.</p>
    ${compared || alertHtml('info', "Aucune pièce n'est liée à un module de la station : choisissez son module ci-dessous pour comparer.")}
    <details class="table-details" id="probe-links" ${linked.length && !linksOpen ? '' : 'open'}><summary>Choisir le module de chaque pièce</summary>
    <p class="hint muted">Tous les modules intérieurs de la station sont proposés, quel que soit leur nom : un module « Cave » posé dans une chambre peut lui être lié. Une pièce liée utilise la station pour le confort ; sinon, la sonde du radiateur. Choix gardé sur cet appareil.</p>
    ${table(
      ['Pièce (radiateurs)', 'Module de la station'],
      rooms.map((r) => [
        esc(r.name),
        `<label class="select"><span class="sr-only">Module lié à ${esc(r.name)}</span><select data-map-room="${esc(r.id)}">
          <option value="" ${map.has(r.id) ? '' : 'selected'}>— aucun —</option>
          ${candidates.map((k) => `<option value="${esc(k)}" ${map.get(r.id) === k ? 'selected' : ''}>${esc(st.modules[k].name)}${suggested[r.id] === k ? ' (suggéré)' : ''}</option>`).join('')}
        </select></label>`,
      ]),
      2,
    )}
    ${Object.keys(state.roomModuleMap).length ? '<p><button type="button" class="link" data-comfort="reset-map">Revenir aux suggestions</button></p>' : ''}
    </details>
  </section>`;
}

function drawProbes(st: Station, map: Map<string, string>) {
  const last = lastDay();
  const from = addDays(minusYears(last), 1);
  const heat = days(from, last).filter((d) => seasonOf(d) !== null);
  probeRooms(map).forEach((r, i) => {
    const el = document.getElementById(`probe-${i}`);
    const t = ds!.temps.get(r.id);
    if (!el || !t) return;
    const k = map.get(r.id)!;
    lineChart(el, {
      labels: heat.map(dayLabel),
      series: [
        { name: 'Sonde du radiateur', color: measureColor(), data: heat.map((d) => t.get(d)?.[0] ?? null) },
        { name: `Station (${st.modules[k].name})`, color: cssVar('--series-reference'), data: heat.map((d) => st.daily[k]?.[d]?.[2] ?? null) },
      ],
      price: null,
      unit: '°C',
      scale: true,
      endLabels: false,
    });
  });
}

// ------------------------------------------------------------------ events
export function handleClick(btn: HTMLElement): boolean {
  if (btn.dataset.comfort === 'show-bedrooms') {
    // S-12.2: the same gesture also lifts the household view (bedrooms merged elsewhere);
    // it changes the dataset shown, which resets this view: set the flag afterwards, then one
    // render only (#255).
    if (householdStatus().active) revealBedrooms(true, false);
    showBedrooms = true;
    rerender();
    return true;
  }
  if (btn.dataset.comfort === 'reset-map') {
    linksOpen = true;
    setState({ roomModuleMap: {} });
    return true;
  }
  return false;
}

export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  if (windows.handleChange(t)) return true;
  if (ha.handleChange(t)) return true;
  if (t.dataset.comfort === 'threshold') {
    setState({ comfortThreshold: Number(t.value) });
    return true;
  }
  if (t.dataset.mapRoom !== undefined) {
    // Freeze the current links so that unlinking one room does not re-suggest its module elsewhere.
    linksOpen = true;
    const cur = Object.fromEntries(heatingRooms().map((r) => [r.id, mapping(ds!.station).get(r.id) ?? '']));
    setState({ roomModuleMap: { ...cur, [t.dataset.mapRoom]: t.value } });
    return true;
  }
  return false;
}
