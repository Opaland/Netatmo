// Comfort ("Confort"), loaded on demand: night CO₂ (S-11.1), cellar humidity (S-11.2),
// hours under a threshold per room (S-11.3) and radiator probe vs station (S-3.8).
import { addDays, bucketLabel, minusYears } from '../aggregate';
import { ds, householdStatus, onDatasetLoaded, rerender, revealBedrooms, setState, state } from '../app';
import {
  type NightRow,
  type StationHourly,
  co2Modules,
  dewPoint,
  effectiveMapping,
  heatedModules,
  hoursBelow,
  humidRuns,
  isCellar,
  isBedroom,
  lastNightDay,
  lastNights,
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
import { barChart, comboChart, cssVar, lineChart, seqRamp } from '../charts';
import { type Station, loadStationHourly } from '../data';
import { activeRooms, esc, lastDay, longDate, nf0, series, table, tableToggle } from '../ui';

let hourly: StationHourly | null = null;
let hourlyLoading = false;
let hourlyFailed = false;
/** S-11.1 / S-12.2: bedroom detail hidden until a deliberate gesture, forgotten at the next lock. */
let showBedrooms = false;
onDatasetLoaded(() => {
  hourly = null;
  hourlyFailed = false;
  showBedrooms = false;
});

export const THRESHOLDS = [17, 17.5, 18, 18.5, 19, 19.5, 20, 20.5, 21];
const HUMID_HOURS = 65; // % — threshold of the collected `hours.humid`
const HUMID_DAYS = 70; // % daily mean, more than 7 days in a row (S-11.2, to be confirmed)
const f1 = (v: number) => v.toFixed(1).replace('.', ',').replace('-', '−');
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
function mapping(st: Station | null) {
  return st ? effectiveMapping(heatingRooms(), st.modules, state.roomModuleMap) : new Map<string, string>();
}

export function renderComfort(view: HTMLElement) {
  const st = ds!.station;
  const map = mapping(st);
  view.innerHTML = `
  <section class="card">
    <h2>Confort <small class="muted">air, humidité, froid</small></h2>
    <p class="hint muted">${
      st
        ? 'Relevés de la station Netatmo (moyennes horaires) et des sondes des radiateurs. Les seuils sont stricts : « au-dessus de 1 400 ppm » veut dire plus de 1 400.'
        : 'Aucune station Netatmo n\'est reliée : seules les températures mesurées par les radiateurs sont utilisées (moyennes par jour). Ajoutez la station dans Paramètres pour le CO₂ de la nuit et l\'humidité de la cave.'
    }</p>
  </section>
  ${st ? co2Cards(st) : ''}
  ${st ? cellarCards(st) : ''}
  ${coldCard(st, map)}
  ${st ? probeCard(st, map) : ''}`;
  if (st) {
    drawCo2(st);
    drawCellar(st);
    drawProbes(st, map);
  }
  drawCold(st, map);
}

// ------------------------------------------------------------------ S-11.1 night CO₂
function nightsOf(st: Station, k: string): (NightRow | null)[] | null {
  const nightly = st.nightly?.[k];
  if (!nightly) return null;
  const last = lastNightDay(nightly);
  if (!last) return null;
  return lastNights(nightly, last, 30);
}

function co2Cards(st: Station) {
  const keys = co2Modules(st.modules, st.nightly ?? {});
  if (!keys.length)
    return `<section class="card"><h2>CO₂ de la nuit</h2><p class="hint muted">Les agrégats de nuit arriveront avec la prochaine collecte de la station (relevés horaires).</p></section>`;
  return keys
    .map((k, i) => {
      const name = st.modules[k].name;
      const head = `<h2>CO₂ de la nuit — ${esc(name)} <small class="muted">22 h → 7 h, 30 dernières nuits</small></h2>`;
      if (isBedroom(name) && !showBedrooms)
        return `<section class="card">${head}
        <p class="hint muted">Le détail des chambres est masqué par défaut, par respect pour leurs occupants. Il reste affiché jusqu'au prochain verrouillage.</p>
        <button type="button" class="toggle" data-comfort="show-bedrooms">Afficher le détail des chambres</button></section>`;
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

function drawCo2(st: Station) {
  co2Modules(st.modules, st.nightly ?? {}).forEach((k, i) => {
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
      lines: [{ name: 'Maximum de la nuit', color: cssVar('--text-secondary'), data: rows.map((r) => r?.co2_max ?? null) }],
      barUnit: 'h',
      lineUnit: 'ppm',
      barMax: 9,
      dim: rows.map((r) => !!r && !r.complete),
      lineMark: { value: 1400, label: '1 400 ppm' },
    });
  });
}

// ------------------------------------------------------------------ S-11.2 cellar humidity
function cellarKeys(st: Station) {
  return Object.keys(st.modules).filter((k) => st.modules[k].indoor && isCellar(st.modules[k].name));
}

function cellarCards(st: Station) {
  const last = lastDay();
  const from = addDays(last, -89);
  return cellarKeys(st)
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
          ? `Humidité au-dessus de ${HUMID_DAYS} % depuis ${run.current} jours : risque de moisissure, aérer par temps sec ou déshumidifier.`
          : streak > 7
            ? `Plus de 12 h par jour au-dessus de ${HUMID_HOURS} % depuis ${streak >= 90 ? 'plus de 90' : streak} jours : risque de moisissure, aérer par temps sec ou déshumidifier.`
            : run.longest > 7
            ? `Humidité au-dessus de ${HUMID_DAYS} % pendant ${run.longest} jours d'affilée (jusqu'au ${longDate(run.longestEnd!)}) sur les 90 derniers jours.`
            : wetDays
              ? `${wetDays} jour${wetDays > 1 ? 's' : ''} sur 90 avec au moins 12 h au-dessus de ${HUMID_HOURS} % : à surveiller.`
              : `Pas d'humidité prolongée sur les 90 derniers jours.`;
      const sub = `${nf0.format(humidHours)} h au-dessus de ${HUMID_HOURS} % en 90 jours.${
        spread !== null ? ` Cette semaine, la cave est en moyenne ${f1(spread)} °C au-dessus de son point de rosée${spread < 3 ? ' : un mur plus froid de quelques degrés se couvre de condensation' : ''}.` : ''
      }`;
      return `<section class="card">
      <h2>Humidité — ${esc(name)} <small class="muted">90 derniers jours</small></h2>
      ${verdictBox(level, esc(title), sub)}
      <p class="hint muted">Le <strong>point de rosée</strong> est la température à laquelle l'humidité de l'air se condense. Il est calculé ici par la formule de Magnus à partir des moyennes du jour (température et humidité). Plus il est proche de la température de la cave, plus les surfaces froides se mouillent. Repères : au-delà de ${HUMID_HOURS} % d'humidité les moisissures peuvent se développer ; au-delà de ${HUMID_DAYS} % plus de 7 jours d'affilée, le risque est installé (seuils indicatifs, à confirmer).</p>
      <div class="chart" id="cellar-${i}" role="img" aria-label="Humidité et point de rosée, ${esc(name)}"></div>
      ${tableToggle(
        table(
          ['Jour', `Heures > ${HUMID_HOURS} %`, 'Humidité moy.', 'Température moy.', 'Point de rosée', 'Écart'],
          days(from, last)
            .reverse()
            .filter((d) => daily[d] || hrs[d])
            .map((d) => {
              const v = daily[d];
              const dp = v && v[3] !== null ? dewPoint(v[2], v[3]) : null;
              return [
                longDate(d),
                hrs[d] ? `${hrs[d].humid}${hrs[d].n < 24 ? ` sur ${hrs[d].n}` : ''}` : '—',
                v && v[3] !== null ? `${v[3]} %` : '—',
                v ? `${f1(v[2])} °C` : '—',
                dp !== null ? `${f1(dp)} °C` : '—',
                dp !== null ? `${f1(v[2] - dp)} °C` : '—',
              ];
            }),
        ),
      )}</section>`;
    })
    .join('');
}

function drawCellar(st: Station) {
  const last = lastDay();
  const ds90 = days(addDays(last, -89), last);
  cellarKeys(st).forEach((k, i) => {
    const el = document.getElementById(`cellar-${i}`);
    if (!el) return;
    const daily = st.daily[k] ?? {};
    const hrs = st.hours?.[k] ?? {};
    comboChart(el, {
      labels: ds90.map(dayLabel),
      bars: [{ name: `Heures > ${HUMID_HOURS} %`, color: seqRamp()[2], data: ds90.map((d) => hrs[d]?.humid ?? null) }],
      lines: [
        { name: 'Température moyenne', color: series(3), data: ds90.map((d) => daily[d]?.[2] ?? null) },
        {
          name: 'Point de rosée',
          color: series(6),
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
  if (hourly || hourlyLoading || hourlyFailed || !(ds!.meta.station_hourly_years ?? []).length) return;
  hourlyLoading = true;
  loadStationHourly(ds!)
    .then((h) => {
      hourly = h;
      if (state.view === 'comfort') rerender();
    })
    .catch(() => {
      hourlyFailed = true;
      if (state.view === 'comfort') rerender();
    })
    .finally(() => {
      hourlyLoading = false;
    });
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
  const t = `${f1(thr)} °C`;
  const cell = (r: ComfortRoom, season: number) => {
    if (r.source === 'radiator') {
      const temps = ds!.temps.get(r.room!)!;
      let n = 0;
      let under = 0;
      for (const [d, [m]] of temps) {
        if (seasonOf(d) !== season) continue;
        n++;
        if (m < thr) under++;
      }
      return n ? `${under} j sur ${n}` : '—';
    }
    const per = coldPerDay(st!, r.module!, thr);
    const sum = per && sumSeason(per, season);
    return sum ? `${nf0.format(sum.hours)} h (${nf0.format((sum.hours / sum.n) * 100)} %) · ${sum.days} j` : waiting ? '…' : '—';
  };
  const stationRooms = rooms.filter((r) => r.source === 'station');
  return `<section class="card">
    <div class="card-head"><h2>Heures sous ${t} <small class="muted">pièces chauffées</small></h2>
      <div class="controls"><label class="select"><span class="sr-only">Seuil</span><select data-comfort="threshold">${THRESHOLDS.map(
        (v) => `<option value="${v}" ${v === thr ? 'selected' : ''}>Sous ${f1(v)} °C</option>`,
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
    <p class="hint muted">Hiver = novembre à mars. « h (%) » : heures sous le seuil et part des heures relevées ; « j » : jours avec au moins une heure (station) ou une moyenne (radiateur) sous le seuil.</p>
  </section>`;
}

function drawCold(st: Station | null, map: Map<string, string>) {
  const el = document.getElementById('cold-chart');
  if (!el || !st) return;
  const thr = state.comfortThreshold;
  const last = lastDay();
  const d30 = days(addDays(last, -29), last);
  const all = Object.keys(st.modules);
  const rooms = comfortRooms(st, map).filter((r) => r.source === 'station');
  barChart(el, {
    labels: d30.map(dayLabel),
    series: rooms.map((r) => {
      const per = coldPerDay(st, r.module!, thr);
      // identity follows the module (same colour as in Analyse › Station)
      return { name: r.label, color: series(2 + all.indexOf(r.module!)), data: d30.map((d) => per?.get(d)?.cold ?? null) };
    }),
    stacked: false,
    price: null,
    unit: 'h',
  });
}

// ------------------------------------------------------------------ S-3.8 radiator probe vs station
function probeCard(st: Station, map: Map<string, string>) {
  const rooms = heatingRooms().filter((r) => ds!.temps.has(r.id));
  if (!rooms.length) return '';
  const candidates = heatedModules(st.modules);
  const suggested = suggestMapping(heatingRooms(), st.modules);
  const last = lastDay();
  const from = addDays(minusYears(last), 1);
  const linked = rooms.filter((r) => map.has(r.id));
  return `<section class="card">
    <h2>Sonde du radiateur et station <small class="muted">même pièce</small></h2>
    <p class="hint muted">Chaque pièce a deux thermomètres : la sonde du radiateur, qui pilote la chauffe, et le module de la station Netatmo. Liez-les pour comparer. Une pièce liée utilise la <strong>station</strong> pour le confort ; sinon, le <strong>radiateur</strong>. Correspondance gardée sur cet appareil.</p>
    ${table(
      ['Pièce (radiateurs)', 'Module Netatmo'],
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
    ${linked
      .map((r, i) => {
        const k = map.get(r.id)!;
        const o = offsetStats(ds!.temps.get(r.id), st.daily[k], from, last);
        if (!o) return `<h3 class="sub-title">${esc(r.name)} ↔ ${esc(st.modules[k].name)}</h3><p class="hint muted">Pas de jour de chauffe (novembre à mars) avec les deux mesures sur les 12 derniers mois.</p>`;
        return `<h3 class="sub-title">${esc(r.name)} ↔ ${esc(st.modules[k].name)}</h3>
        <p>Écart moyen <strong>${signed(o.mean)} °C</strong> (radiateur − station) sur ${o.n} jours de chauffe, écart-type ${f1(o.sd)} °C : ${o.stable ? 'stable' : 'variable'}.</p>
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
              .map((m) => [bucketLabel(`${m.month}-01`, 'month'), `${f1(m.radiator)} °C`, `${f1(m.station)} °C`, `${signed(m.offset)} °C`, m.n]),
          ),
        )}`;
      })
      .join('')}
  </section>`;
}

function drawProbes(st: Station, map: Map<string, string>) {
  const last = lastDay();
  const from = addDays(minusYears(last), 1);
  const heat = days(from, last).filter((d) => seasonOf(d) !== null);
  heatingRooms()
    .filter((r) => ds!.temps.has(r.id) && map.has(r.id))
    .forEach((r, i) => {
      const el = document.getElementById(`probe-${i}`);
      if (!el) return;
      const k = map.get(r.id)!;
      const t = ds!.temps.get(r.id)!;
      lineChart(el, {
        labels: heat.map(dayLabel),
        series: [
          { name: 'Sonde du radiateur', color: series(0), data: heat.map((d) => t.get(d)?.[0] ?? null) },
          { name: `Station (${st.modules[k].name})`, color: series(2), data: heat.map((d) => st.daily[k]?.[d]?.[2] ?? null) },
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
    // it reloads the dataset, which resets this view: set the flag afterwards.
    if (householdStatus().active) revealBedrooms(true);
    showBedrooms = true;
    rerender();
    return true;
  }
  if (btn.dataset.comfort === 'reset-map') {
    setState({ roomModuleMap: {} });
    return true;
  }
  return false;
}

export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  if (t.dataset.comfort === 'threshold') {
    setState({ comfortThreshold: Number(t.value) });
    return true;
  }
  if (t.dataset.mapRoom !== undefined) {
    // Freeze the current links so that unlinking one room does not re-suggest its module elsewhere.
    const cur = Object.fromEntries(heatingRooms().map((r) => [r.id, mapping(ds!.station).get(r.id) ?? '']));
    setState({ roomModuleMap: { ...cur, [t.dataset.mapRoom]: t.value } });
    return true;
  }
  return false;
}
