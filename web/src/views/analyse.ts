// Analyse: AI insight, energy signature, anomalies, calendar, hourly profile,
// peak / off-peak split, Netatmo station and room temperatures.
import { type DayRecord, addDays, bucketLabel, minusYears } from '../aggregate';
import { type Hourly, anomalies, dayProfile, daysAbove, fitSeason, signaturePoints, tariffSplit, weekHourGrid } from '../analysis';
import { ds, onDatasetLoaded, rerender, setState, state } from '../app';
import { calendarChart, cssVar, gridHeatmap, lineChart, scatterChart } from '../charts';
import { loadHourly } from '../data';
import { unavailable } from '../offline';
import { renderMarkdown } from '../markdown';
import { activeRooms, catColor, esc, fmtKwh, lastDay, longDate, seg, series, table, tariffNames } from '../ui';
import { drawSetpoint, setpointCard } from './setpoint';
import { drawWaterHeater, hcAlerts, waterHeaterCard } from './waterheater';

let hourly: Hourly | null = null;
let hourlyLoading = false;
onDatasetLoaded(() => {
  hourly = null;
});

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
  view.innerHTML = `
  ${
    ds!.insights
      ? `<section class="card insight"><div class="card-head"><h2>Analyse du mois <small class="muted">rédigée par l'IA</small></h2></div>
      <div class="md">${renderMarkdown(ds!.insights.markdown)}</div>
      <p class="hint muted">Générée le ${esc(ds!.insights.generated.slice(0, 10))} (${esc(ds!.insights.model)}) à partir des chiffres calculés par l'application${
        ds!.insights.verified === false ? ' — <strong>attention : certains nombres du texte n\'ont pas pu être vérifiés</strong>' : ''
      }. Les chiffres font foi : l'IA ne fait que les commenter.</p>
      ${ds!.insights.facts ? `<details class="table-details"><summary>Voir exactement ce qui a été envoyé à l'IA</summary><pre class="facts-json">${esc(JSON.stringify(ds!.insights.facts, null, 2))}</pre></details>` : ''}</section>`
      : ''
  }
  ${
    ds!.weather
      ? `<section class="card">
    <div class="card-head"><h2>Signature énergétique <small class="muted">chauffage</small></h2></div>
    <p class="hint muted">Chaque point est un jour : consommation de chauffage selon la température extérieure moyenne${ds!.meta.weather_source === 'netatmo' ? ' (station Netatmo)' : ' (Open-Meteo)'}. La droite résume la saison : plus elle est <strong>pentue</strong>, plus la maison consomme par degré de froid ; là où elle touche zéro, c'est la température à partir de laquelle vous ne chauffez plus.</p>
    <div class="chart tall" id="sig-chart" role="img" aria-label="Signature énergétique"></div>
    <div id="sig-table"></div>
  </section>`
      : `<section class="card"><h2>Signature énergétique</h2><p class="hint muted">Disponible dès que la collecte a récupéré la météo (prochaine collecte).</p></section>`
  }
  ${setpointCard(records)}
  ${anomaliesCard(records)}
  <section class="card">
    <div class="card-head"><h2>Calendrier <small class="muted">kWh par jour</small></h2>
      <div class="controls"><label class="select"><span class="sr-only">Année</span><select data-set="analyseYear">${years
        .slice()
        .reverse()
        .map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`)
        .join('')}</select></label></div>
    </div>
    <div class="chart" id="cal-chart" style="height:190px" role="img" aria-label="Calendrier de consommation"></div>
  </section>
  <section class="card">
    <div class="card-head"><h2>Profil horaire <small class="muted">kWh moyens, 90 derniers jours</small></h2></div>
    <div id="hourly-zone"><p class="hint muted">${(ds!.meta.hourly_years ?? []).length ? 'Chargement des données horaires…' : 'Les données horaires arriveront avec la prochaine collecte complète.'}</p></div>
  </section>
  ${
    ds!.meta.has_tariffs && split[1] + split[2] > 0
      ? `<section class="card"><h2>Heures pleines / heures creuses <small class="muted">12 derniers mois</small></h2>
      <div class="share" aria-hidden="true"><span style="flex:${split[1]};background:${series(0)}"></span><span style="flex:${split[2]};background:${series(2)}"></span>${split[0] + split[3] > 0 ? `<span style="flex:${split[0] + split[3]};background:${cssVar('--ghost')}"></span>` : ''}</div>
      <p class="share-legend"><span><i style="background:${series(0)}"></i>${n1} ${fmtKwh(split[1])}</span><span><i style="background:${series(2)}"></i>${n2} ${fmtKwh(split[2])}</span>${split[0] + split[3] > 0 ? `<span><i style="background:${cssVar('--ghost')}"></i>Sans détail ${fmtKwh(split[0] + split[3])}</span>` : ''}</p>
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
    document.getElementById('sig-table')!.innerHTML = rows.length
      ? table(['Saison', 'Pente (kWh par °C en moins)', 'Plus de chauffe au-dessus de', 'Fiabilité (R²)'], rows.reverse())
      : '';
  }
  // calendar
  const perDay = new Map<string, number>();
  for (const r of records) if (r.day.startsWith(String(year))) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.kwh);
  const values = [...perDay.values()];
  const sorted = values.slice().sort((a, b) => a - b);
  calendarChart(document.getElementById('cal-chart')!, {
    year,
    data: [...perDay.entries()].map(([d, v]) => [d, Math.round(v * 10) / 10]),
    max: sorted[Math.floor(sorted.length * 0.97)] ?? 1, // ignore the few extreme days
  });
  // temperatures
  if (tempRoom) {
    const from = addDays(minusYears(last), 1);
    const days: string[] = [];
    for (let d = from; d <= last; d = addDays(d, 1)) days.push(d);
    const t = ds!.temps.get(tempRoom)!;
    lineChart(document.getElementById('temp-chart')!, {
      labels: days.map((d) => bucketLabel(d, 'day')),
      series: [
        { name: 'Mesurée', color: series(0), data: days.map((d) => t.get(d)?.[0] ?? null) },
        { name: 'Consigne', color: series(3), data: days.map((d) => t.get(d)?.[1] ?? null) },
        ...(ds!.weather ? [{ name: 'Extérieure', color: cssVar('--text-muted'), data: days.map((d) => ds!.weather!.get(d)?.[2] ?? null) }] : []),
      ],
      price: null,
      unit: '°C',
    });
  }
  drawStation();
  drawHourly(records);
  drawWaterHeater(hourly);
  drawSetpoint(records);
}

function anomaliesCard(records: DayRecord[]) {
  if (!ds!.weather) return '';
  const list = anomalies(records, ds!.weather).slice(0, 12);
  const alerts = hcAlerts();
  if (!list.length) return alerts ? `<section class="card"><h2>Jours inhabituels</h2>${alerts}</section>` : '';
  return `<section class="card"><h2>Jours inhabituels <small class="muted">chauffage, écart à la signature</small></h2>
    ${alerts}
    <p class="hint muted">Jours où le chauffage s'écarte nettement de ce qu'annonce la température extérieure (plus de 2 fois l'écart habituel et plus de 3 kWh) : fenêtre ouverte, absence, invités, réglage oublié…</p>
    ${table(
      ['Jour', 'Consommé', 'Attendu', 'Écart'],
      list.map((a) => [
        longDate(a.day),
        fmtKwh(a.kwh),
        fmtKwh(Math.max(0, a.expected)),
        `<span class="delta ${a.z > 0 ? 'up' : 'down'}"><span aria-hidden="true">${a.z > 0 ? '▲' : '▼'}</span> ${a.z > 0 ? '+' : '−'}${fmtKwh(Math.abs(a.kwh - a.expected))}</span>`,
      ]),
    )}</section>`;
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
  document.getElementById('station-table')!.innerHTML = table(
    ['Module', `Hiver ${lastSeason - 1}–${lastSeason}`, `Hiver ${lastSeason}–${lastSeason + 1}`, ...(comfort ? [`Jours ${thrLabel}, 12 mois`] : [])],
    keys.map((k) => [
      `<span class="swatch" style="background:${color(k)}"></span>${esc(st.modules[k].name)}`,
      fmt(seasonAvg(k, lastSeason - 1)),
      fmt(seasonAvg(k, lastSeason)),
      ...(comfort ? [st.modules[k].indoor || state.stationMetric === 'hum' ? daysAbove(st.daily[k] ?? {}, col, thr, from, last) : '—'] : []),
    ]),
  );
}

// ------------------------------------------------------------------ hourly profile
function drawHourly(records: DayRecord[]) {
  const zone = document.getElementById('hourly-zone');
  if (!zone || !(ds!.meta.hourly_years ?? []).length) return;
  if (!hourly) {
    if (!hourlyLoading) {
      hourlyLoading = true;
      loadHourly(ds!)
        .then((h) => {
          hourly = h;
          hourlyLoading = false;
          if (state.view === 'analyse') rerender();
        })
        .catch(() => {
          hourlyLoading = false;
          zone.innerHTML = `<p class="hint muted">${unavailable('Données horaires')}</p>`;
        });
    }
    return;
  }
  const last = lastDay();
  const from = addDays(last, -89);
  const rooms = new Set(records.map((r) => r.room));
  const grid = weekHourGrid(hourly, rooms, from, last);
  const hours = Array.from({ length: 24 }, (_, h) => `${h}h`);
  const dows = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  zone.innerHTML = `<div class="chart" id="hour-grid" style="height:280px" role="img" aria-label="Consommation moyenne par jour de semaine et par heure"></div>
    <div class="chart" id="hour-profile" style="height:240px" role="img" aria-label="Journée type"></div>`;
  gridHeatmap(document.getElementById('hour-grid')!, {
    xLabels: hours,
    yLabels: dows,
    data: grid.flatMap((row, y) => row.map((v, x) => [x, y, Math.round(v * 100) / 100] as [number, number, number])),
    unit: 'kWh',
  });
  const heatRooms = new Set(activeRooms().filter((r) => r.category === 'heating' && rooms.has(r.id)).map((r) => r.id));
  const waterRooms = new Set(activeRooms().filter((r) => r.category === 'water_heater' && rooms.has(r.id)).map((r) => r.id));
  lineChart(document.getElementById('hour-profile')!, {
    labels: hours,
    series: [
      ...(heatRooms.size ? [{ name: 'Chauffage', color: catColor('heating'), data: dayProfile(hourly, heatRooms, from, last).map((v) => Math.round(v * 100) / 100) }] : []),
      ...(waterRooms.size ? [{ name: 'Chauffe-eau', color: catColor('water_heater'), data: dayProfile(hourly, waterRooms, from, last).map((v) => Math.round(v * 100) / 100) }] : []),
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
