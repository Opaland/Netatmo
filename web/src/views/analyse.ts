// Analyse: AI insight, energy signature, anomalies, calendar, hourly profile,
// peak / off-peak split, Netatmo station and room temperatures.
import { type DayRecord, addDays, bucketLabel, minusYears } from '../aggregate';
import { anomalies, dayProfile, daysAbove, fitSeason, signaturePoints, tariffSplit, weekHourGrid } from '../analysis';
import { datasetDoc, ds, rerender, setState, state } from '../app';
import { calendarChart, cssVar, gridHeatmap, lineChart, scatterChart } from '../charts';
import { loadHourly, loadRoom30, loadRoomState } from '../data';
import { lazyCard } from '../lazy';
import { unavailable } from '../offline';
import { activeRooms, catColor, esc, fmtKwh, lastDay, longDate, seg, series, table, tariffNames, measureColor, referenceColor } from '../ui';
import { hour } from '../glossary';
import { SUSPECT_RATIO } from '../reconstitute';
import { uncertainDays } from './quality';
import { drawSetpoint, setpointCard } from './setpoint';
import { drawWaterHeater, hcAlerts, waterHeaterCard } from './waterheater';
import { html } from '../trusted';
import { tenant } from '../tenant'; // S-12.6: works are the owner's business

// #247: documents loaded on demand for the dataset shown; a late result of another dataset is dropped.
// #251: 12 months (water heater), 90 days (profile)
const hourlyDoc = datasetDoc((d) => loadHourly(d, addDays(minusYears(d.meta.last_day ?? lastDay()), 1)));
// S-13.3 / S-13.4: open-window hours and absence-mode days, a possible explanation of an unusual day
const explainDoc = datasetDoc(async (d) => {
  const [rs, w] = await Promise.all([loadRoomState(d), import('../windows')]);
  return rs ? { open: w.openByDay(rs), away: w.absenceDays(rs) } : { open: new Map<string, number>(), away: new Set<string>() };
});
const redraw = () => state.view === 'analyse' && rerender();

// S-1.26: per-room half hours of the profile's 90 days, preferred when present (#247: dataset shown only)
const r30Doc = datasetDoc(async (d) => {
  const [data, mod] = await Promise.all([loadRoom30(d, addDays(d.meta.last_day ?? lastDay(), -89)), import('../room30')]);
  return { data, mod };
});

/** Minimum days of half hours in the 90-day window for the half-hour « journée type ». */
const HALF_HOUR_MIN_DAYS = 28;

function loadExplanations() {
  if (ds!.meta.has_roomstate) explainDoc.get(ds, (ok) => ok && redraw());
}

/** « fenêtre ouverte N h » / « mode absence », or '—' (S-13.3). */
function explanation(day: string): string {
  if (explainDoc.status(ds) === 'failed') return '—';
  const explain = explainDoc.get(ds);
  if (!explain) return '…';
  const parts: string[] = [];
  const open = explain.open.get(day) ?? 0;
  if (open >= 1) parts.push(`fenêtre ouverte ${open.toFixed(1).replace('.', ',')} h`);
  if (explain.away.has(day)) parts.push('mode absence');
  return parts.join(', ') || '—';
}

function seasonColor(season: string, seasons: string[]) {
  // most recent season = slot 1, then 2, 3… (identity follows the season)
  const i = seasons.length - 1 - seasons.indexOf(season);
  return series(i);
}

export function renderAnalyse(view: HTMLElement, records: DayRecord[]) {
  const years = ds!.meta.years;
  const year = state.analyseYear ?? years[years.length - 1];
  const last = lastDay();
  const tempRooms = activeRooms().filter((r) => ds!.temps.has(r.id));
  const tempRoom = tempRooms.find((r) => r.id === state.tempRoom)?.id ?? tempRooms[0]?.id ?? null;
  const split = tariffSplit(records.filter((r) => r.day >= addDays(minusYears(last), 1)), ds!.tariffs);
  const [n1, n2] = tariffNames();
  view.innerHTML = html`
  ${ds!.insights ? '<section class="card insight" id="insight-card" aria-busy="true"><h2>Analyse du mois</h2></section>' : ''}
  ${
    ds!.weather
      ? `<section class="card">
    <div class="card-head"><h2>Signature énergétique <small class="muted">chauffage</small></h2></div>
    <p class="hint muted">Chaque point est un jour : consommation de chauffage selon la température extérieure moyenne${ds!.meta.weather_source === 'netatmo' ? ' (station Netatmo)' : ' (Open-Meteo)'}. La droite résume la saison : plus elle est <strong>pentue</strong>, plus la maison consomme par degré de froid ; là où elle touche zéro, c'est la température à partir de laquelle vous ne chauffez plus.</p>
    <div class="chart tall" id="sig-chart" role="img" aria-label="Signature énergétique"></div>
    <div id="sig-table"></div>
  </section>
  <section class="card" id="indoor-sig" hidden></section>`
      : `<section class="card"><h2>Signature énergétique</h2><p class="hint muted">Disponible dès que la collecte a récupéré la météo (prochaine collecte).</p></section>`
  }
  ${tenant().on ? '' : '<div id="works-zone"></div>'}
  ${setpointCard(records)}
  ${ds!.weather ? '<section class="card" id="hp-card" hidden></section>' : ''}
  <div id="shutters-zone"></div>
  ${anomaliesCard(records)}
  <section class="card" id="calendar-card">
    <div class="card-head"><h2>Calendrier <small class="muted">kWh par jour</small></h2>
      <div class="controls"><label class="select"><span class="sr-only">Année</span><select data-set="analyseYear">${years
        .slice()
        .reverse()
        .map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`)
        .join('')}</select></label></div>
    </div>
    <div class="chart" id="cal-chart" style="height:190px" role="img" aria-label="Calendrier de consommation"></div>
  </section>
  <div id="absence-zone"></div>
  <section class="card">
    <div class="card-head"><h2>Profil horaire <small class="muted">kWh moyens, 90 derniers jours</small></h2></div>
    <div id="hourly-zone"><p class="hint muted">${(ds!.meta.hourly_years ?? []).length ? 'Chargement des données horaires…' : 'Les données horaires arriveront avec la prochaine collecte complète.'}</p></div>
  </section>
  <div id="telework-zone"></div>
  ${
    ds!.meta.has_tariffs && split[1] + split[2] > 0
      ? `<section class="card"><h2>Heures pleines / heures creuses <small class="muted">12 derniers mois</small></h2>
      <div class="share" aria-hidden="true"><span style="flex:${split[1]};background:${series(0)}"></span><span style="flex:${split[2]};background:${series(2)}"></span>${split[0] + split[3] > 0 ? `<span style="flex:${split[0] + split[3]};background:${cssVar('--usage-other')}"></span>` : ''}</div>
      <p class="share-legend"><span><i style="background:${series(0)}"></i>${n1} ${fmtKwh(split[1])}</span><span><i style="background:${series(2)}"></i>${n2} ${fmtKwh(split[2])}</span>${split[0] + split[3] > 0 ? `<span><i style="background:${cssVar('--usage-other')}"></i>Sans détail ${fmtKwh(split[0] + split[3])}</span>` : ''}</p>
      <p class="hint muted">Détection automatique : la colonne où le chauffe-eau consomme le plus est considérée comme les heures creuses.</p></section>`
      : ''
  }
  ${waterHeaterCard()}
  ${stationCard()}
  ${
    tempRoom
      ? `<section class="card"><div class="card-head"><h2>Températures <small class="muted">°C, moyenne par jour</small></h2>
      <div class="controls"><label class="select"><span class="sr-only">Pièce</span><select data-set="tempRoom">${tempRooms
        .map((r) => `<option value="${esc(r.id)}" ${r.id === tempRoom ? 'selected' : ''}>${esc(r.name)}</option>`)
        .join('')}</select></label></div></div>
      <div class="chart" id="temp-chart" role="img" aria-label="Températures de la pièce"></div></section>`
      : ''
  }`;

  // signature
  if (ds!.weather) {
    const sig = signaturePoints(records, ds!.weather);
    const seasons = [...sig.keys()].sort().slice(-3);
    const rows: (string | number)[][] = [];
    scatterChart(document.getElementById('sig-chart')!, {
      xName: 'Température extérieure moyenne (°C)',
      yName: 'kWh / jour',
      series: seasons.map((s) => {
        const pts = sig.get(s)!;
        const fit = fitSeason(pts);
        if (fit) {
          rows.push([
            esc(s.replace('-', '–')),
            `${(-fit.slope).toFixed(2).replace('.', ',')} kWh/°C`,
            fit.balance !== null ? `${fit.balance.toFixed(1).replace('.', ',')} °C` : '—',
            fit.r2.toFixed(2).replace('.', ','),
          ]);
        }
        const xs = pts.map((p) => p[0]);
        return {
          name: s.replace('-', '–'),
          color: seasonColor(s, seasons),
          points: pts,
          fit: fit ? { slope: fit.slope, intercept: fit.intercept, from: Math.min(...xs), to: Math.min(15, fit.balance ?? 15) } : null,
        };
      }),
    });
    document.getElementById('sig-table')!.innerHTML = html(
      rows.length ? table(['Saison', 'Pente (kWh par °C en moins)', 'Plus de chauffe au-dessus de', 'Fiabilité (R²)'], rows.reverse()) : '',
    );
  }
  // calendar
  const perDay = new Map<string, number>();
  for (const r of records) if (r.day.startsWith(String(year))) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.kwh);
  const values = [...perDay.values()];
  const sorted = values.slice().sort((a, b) => a - b);
  const cal = {
    year,
    data: [...perDay.entries()].map(([d, v]) => [d, Math.round(v * 10) / 10] as [string, number]),
    max: sorted[Math.floor(sorted.length * 0.97)] ?? 1, // ignore the few extreme days
  };
  calendarChart(document.getElementById('cal-chart')!, cal);
  // S-4.9 telework cost, S-4.10 absences (marks on the calendar), loaded on demand (S-7.10)
  void lazyCard(() => import('./habits'), (m) => m.fillAnalyse(cal), { zone: 'absence-zone', what: 'Absences et télétravail' });
  // S-6.2: surfaces and works markers, signature before / after (lazy module)
  if (document.getElementById('works-zone')) void lazyCard(() => import('./works'), (m) => m.fillWorks(records), { zone: 'works-zone', what: 'Travaux et surfaces' });
  // temperatures
  if (tempRoom) {
    const from = addDays(minusYears(last), 1);
    const days: string[] = [];
    for (let d = from; d <= last; d = addDays(d, 1)) days.push(d);
    const t = ds!.temps.get(tempRoom)!;
    lineChart(document.getElementById('temp-chart')!, {
      labels: days.map((d) => bucketLabel(d, 'day')),
      series: [
        { name: 'Mesurée', color: measureColor(), data: days.map((d) => t.get(d)?.[0] ?? null) },
        { name: 'Consigne', color: cssVar('--accent'), data: days.map((d) => t.get(d)?.[1] ?? null) },
        ...(ds!.weather ? [{ name: 'Extérieure', color: referenceColor(), data: days.map((d) => ds!.weather!.get(d)?.[2] ?? null) }] : []),
      ],
      price: null,
      unit: '°C',
    });
  }
  // S-5.7/S-5.8: AI card loaded on demand (markdown renderer, votes, usage)
  if (ds!.insights) void lazyCard(() => import('./insight'), (m) => m.mountInsight(document.getElementById('insight-card')), { zone: 'insight-card', what: 'Analyse IA' });
  drawStation();
  drawHourly(records);
  drawWaterHeater(hourlyDoc.status(ds) === 'ready' ? hourlyDoc.get(ds)! : null);
  drawSetpoint(records);
  // S-2.15: heat pump estimate, lazy module
  if (document.getElementById('hp-card')) void lazyCard(() => import('./heatpump'), (m) => m.mountHeatPump(document.getElementById('hp-card'), records), { zone: 'hp-card', what: 'Pompe à chaleur' });
  drawIndoorSignature(records);
  // S-9.6: « volets fermés » journal, lazy module
  void lazyCard(() => import('./shutters'), (m) => {
    const zone = document.getElementById('shutters-zone');
    if (zone) m.renderShutters(zone);
  }, { zone: 'shutters-zone', what: 'Volets fermés' });
}

function anomaliesCard(records: DayRecord[]) {
  if (!ds!.weather) return '';
  // S-1.10: lost or estimated days are not "unusual", they are not measured
  const list = anomalies(records, ds!.weather, uncertainDays(ds!.records, ds!.estimated, '0000-01-01', lastDay())).slice(0, 12);
  const suspect = (a: (typeof list)[number]) => a.z < 0 && a.kwh < SUSPECT_RATIO * a.expected;
  const alerts = hcAlerts();
  if (!list.length) return alerts ? `<section class="card"><h2>Jours inhabituels</h2>${alerts}</section>` : '';
  const withStates = !!ds!.meta.has_roomstate;
  if (withStates) loadExplanations();
  return `<section class="card" id="unusual-card"><h2>Jours inhabituels <small class="muted">chauffage, écart à la signature</small></h2>
    ${alerts}
    <p class="hint muted">Jours où le chauffage s'écarte nettement de ce qu'annonce la température extérieure (plus de 2 fois l'écart habituel et plus de 3 kWh) : fenêtre ouverte, absence, invités, réglage oublié… Les jours perdus chez Intuis ou estimés n'y figurent pas ; un jour très en dessous de la signature est marqué <strong>suspect</strong> (donnée peut-être incomplète, voir « Qualité des données » dans la Synthèse).</p>
    ${withStates ? '<p class="hint muted">« Explication possible » : heures de fenêtre ouverte de toutes les pièces ce jour-là, ou mode absence relevé (relevé horaire de l’état des pièces). Une fenêtre ouverte coupe le radiateur de la pièce, qui relance ensuite : le jour peut se retrouver au-dessus ou en dessous de l’attendu.</p>' : ''}
    ${table(
      ['Jour', 'Consommé', 'Attendu', 'Écart', ...(withStates ? ['Explication possible'] : [])],
      list.map((a) => [
        longDate(a.day),
        fmtKwh(a.kwh),
        fmtKwh(Math.max(0, a.expected)),
        `<span class="delta ${a.z > 0 ? 'up' : 'down'}"><span aria-hidden="true">${a.z > 0 ? '▲' : '▼'}</span> ${a.z > 0 ? '+' : '−'}${fmtKwh(Math.abs(a.kwh - a.expected))}</span>${suspect(a) ? ' <span class="badge-suspect" title="Très en dessous de la signature : donnée peut-être incomplète chez Intuis">suspect</span>' : ''}`,
        ...(withStates ? [explanation(a.day)] : []),
      ]),
    )}</section>`;
}

/** S-3.7: indoor − outdoor signature, a lazily loaded card under the signature. */
function drawIndoorSignature(records: DayRecord[]) {
  const card = document.getElementById('indoor-sig');
  if (!card || !ds!.station) return card?.remove();
  void lazyCard(() => import('./indoorsig'), (m) => card.isConnected && m.renderIndoorSignature(card, records), { zone: card, what: 'Signature intérieure' });
}

// ------------------------------------------------------------------ Netatmo weather station
const STATION_METRICS = { temp: ['Température', '°C', 2], hum: ['Humidité', '%', 3], co2: ['CO₂', 'ppm', 4] } as const;

function stationCard() {
  const st = ds!.station;
  if (!st) return '';
  return `<section class="card">
    <div class="card-head"><h2>Station météo Netatmo <small class="muted">moyenne par jour, 12 derniers mois</small></h2>
      <div class="controls">${seg('stationMetric', state.stationMetric, [['temp', 'Température'], ['hum', 'Humidité'], ['co2', 'CO₂']], 'Mesure')}</div>
    </div>
    ${state.stationMetric === 'co2' ? '<p class="hint muted">CO₂ : au-delà de 1 000 ppm, l\'air est confiné (aérer) ; 1 500 ppm et plus, aération insuffisante. Mesuré par les modules intérieurs seulement.</p>' : ''}
    <div class="chart" id="station-chart" role="img" aria-label="Mesures de la station Netatmo"></div>
    <div id="station-table"></div>
  </section>`;
}

function drawStation() {
  const st = ds!.station;
  const el = document.getElementById('station-chart');
  if (!st || !el) return;
  const [, unit, col] = STATION_METRICS[state.stationMetric];
  const last = lastDay();
  const from = addDays(minusYears(last), 1);
  const days: string[] = [];
  for (let d = from; d <= last; d = addDays(d, 1)) days.push(d);
  const keys = Object.keys(st.modules).filter((k) => state.stationMetric !== 'co2' || st.modules[k].indoor);
  // identity follows the module (its order in the station), never its rank
  const color = (k: string) => (st.modules[k].type === 'NAModule1' ? cssVar('--text-muted') : series(2 + Object.keys(st.modules).indexOf(k)));
  lineChart(el, {
    labels: days.map((d) => bucketLabel(d, 'day')),
    series: keys.map((k) => ({ name: st.modules[k].name, color: color(k), data: days.map((d) => st.daily[k]?.[d]?.[col] ?? null) })),
    price: null,
    unit,
  });
  // winter averages (Nov–Mar) per module, last two seasons
  const seasonAvg = (k: string, season: number) => {
    const vals: number[] = [];
    for (const [d, v] of Object.entries(st.daily[k] ?? {})) {
      const y = Number(d.slice(0, 4));
      const m = Number(d.slice(5, 7));
      const s = m >= 11 ? y : m <= 3 ? y - 1 : null;
      if (s === season && v[col] !== null) vals.push(v[col] as number);
    }
    return vals.length > 20 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const lastSeason = Number(last.slice(5, 7)) >= 11 ? Number(last.slice(0, 4)) : Number(last.slice(0, 4)) - 1;
  const fmt = (v: number | null) => (v === null ? '—' : `${(state.stationMetric === 'co2' ? Math.round(v) : Math.round(v * 10) / 10).toString().replace('.', ',')} ${unit}`);
  const comfort = state.stationMetric !== 'temp';
  const [thr, thrLabel] = state.stationMetric === 'co2' ? [1000, '> 1 000 ppm'] : [65, '> 65 % (risque de moisissure)'];
  document.getElementById('station-table')!.innerHTML = html(table(
    ['Module', `Hiver ${lastSeason - 1}–${lastSeason}`, `Hiver ${lastSeason}–${lastSeason + 1}`, ...(comfort ? [`Jours ${thrLabel}, 12 mois`] : [])],
    keys.map((k) => [
      `<span class="swatch" style="background:${color(k)}"></span>${esc(st.modules[k].name)}`,
      fmt(seasonAvg(k, lastSeason - 1)),
      fmt(seasonAvg(k, lastSeason)),
      ...(comfort ? [st.modules[k].indoor || state.stationMetric === 'hum' ? daysAbove(st.daily[k] ?? {}, col, thr, from, last) : '—'] : []),
    ]),
  ));
}

// ------------------------------------------------------------------ hourly profile
function drawHourly(records: DayRecord[]) {
  const zone = document.getElementById('hourly-zone');
  if (!zone || !(ds!.meta.hourly_years ?? []).length) return;
  const hourly = hourlyDoc.get(ds, redraw);
  if (!hourly) {
    if (hourlyDoc.status(ds) === 'failed') zone.innerHTML = html`<p class="hint muted">${unavailable('Données horaires')}</p>`;
    return;
  }
  const last = lastDay();
  const from = addDays(last, -89);
  const rooms = new Set(records.map((r) => r.room));
  const r30 = (ds!.meta.room30_years ?? []).length ? (r30Doc.get(ds, (ok) => ok && redraw()) ?? null) : null;
  // S-1.26: hours rebuilt from the half hours where they exist (more complete), the hourly data elsewhere
  const from30 = r30 ? r30.mod.hourlyFrom30(r30.data, from, last, ds!.roomMap) : null;
  const best = r30 && from30?.size ? r30.mod.preferRoom30(hourly, from30) : hourly;
  const grid = weekHourGrid(best, rooms, from, last);
  const hours = Array.from({ length: 24 }, (_, h) => hour(h));
  const dows = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const heatRooms = new Set(activeRooms().filter((r) => r.category === 'heating' && rooms.has(r.id)).map((r) => r.id));
  const waterRooms = new Set(activeRooms().filter((r) => r.category === 'water_heater' && rooms.has(r.id)).map((r) => r.id));
  const half = r30 ? (set: Set<string>) => r30!.mod.halfHourProfile(r30!.data, set, from, last, ds!.roomMap) : null;
  const halfDays = half ? half(new Set([...heatRooms, ...waterRooms])).days : 0;
  const byHalf = !!half && halfDays >= HALF_HOUR_MIN_DAYS;
  zone.innerHTML = html`<div class="chart" id="hour-grid" style="height:280px" role="img" aria-label="Consommation moyenne par jour de semaine et par heure"></div>
    <div class="chart" id="hour-profile" style="height:240px" role="img" aria-label="Journée type${byHalf ? ' au pas de 30 minutes' : ''}"></div>
    ${byHalf ? `<p class="hint muted">Journée type au pas de 30 minutes (${halfDays} jours mesurés pièce par pièce).</p>` : ''}`;
  gridHeatmap(document.getElementById('hour-grid')!, {
    xLabels: hours,
    yLabels: dows,
    data: grid.flatMap((row, y) => row.map((v, x) => [x, y, Math.round(v * 100) / 100] as [number, number, number])),
    unit: 'kWh',
  });
  const profile = (set: Set<string>) => (byHalf ? half!(set).profile : dayProfile(best, set, from, last)).map((v) => Math.round(v * 100) / 100);
  lineChart(document.getElementById('hour-profile')!, {
    labels: byHalf ? Array.from({ length: 48 }, (_, i) => `${Math.floor(i / 2)}h${i % 2 ? '30' : ''}`) : hours,
    series: [
      ...(heatRooms.size ? [{ name: 'Chauffage', color: catColor('heating'), data: profile(heatRooms) }] : []),
      ...(waterRooms.size ? [{ name: 'Chauffe-eau', color: catColor('water_heater'), data: profile(waterRooms) }] : []),
    ],
    price: null,
  });
}

// ------------------------------------------------------------------ events
/** Calendar year and temperature room. Returns true when the change belonged to this view. */
export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  if (t.dataset.set === 'analyseYear') {
    setState({ analyseYear: Number(t.value) });
    return true;
  }
  if (t.dataset.set === 'tempRoom') {
    setState({ tempRoom: t.value });
    return true;
  }
  return false;
}
