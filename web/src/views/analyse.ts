// Analyse: AI insight, energy signature, anomalies, calendar, hourly profile,
// peak / off-peak split, Netatmo station and room temperatures.
import { countedNote } from '../components';
import { type DayRecord, addDays, bucketLabel, minusYears, seasonOf } from '../aggregate';
import { anomalies, dayProfile, daysAbove, weekHourGrid } from '../analysis';
import { type CiFit, MIN_DAYS, type SeasonSignatures, seasonSignatures, signatureDays } from '../indoorsig';
import { datasetDoc, ds, rerender, setState, state } from '../app';
import { calendarChart, gridHeatmap, lineChart, scatterChart } from '../charts';
import { loadHourly, loadRoom30, loadRoomState } from '../data';
import { lazyCard } from '../lazy';
import { unavailable } from '../offline';
import { TEMP, dayLong, dayShort, periodLine, seasonLabel } from '../glossary';
import { yearLine } from '../history';
import { countedHtml } from './compare';
import { weeklyMeans } from '../chart-theme';
import { activeRooms, catColor, esc, fmt1, isOutdoor, moduleColor, roomName, fmtKwh, lastDay, longDate, seasonStyle, seg, table, measureColor, referenceColor } from '../ui';
import { hour } from '../glossary';
import { SUSPECT_RATIO } from '../reconstitute';
import { judgedOut } from './quality';
import { sunHint, sunMedian } from '../sun';
import { drawSetpoint, setpointCard } from './setpoint';
import { windBlock } from './windsig';
import { drawWaterHeater, hcAlerts, waterHeaterCard } from './waterheater';
import { html } from '../trusted';
import { tenant, tenantNote } from '../tenant'; // S-12.6: works are the owner's business
import { withWood } from '../isolation';
import { verdictWood } from './wood-state';
import { fillPerM2, isolationBlock } from './isolation';

// #247: documents loaded on demand for the dataset shown; a late result of another dataset is dropped.
// #251: 12 months (water heater), 90 days (profile)
const hourlyDoc = datasetDoc((d) => loadHourly(d, addDays(minusYears(d.meta.last_day ?? lastDay()), 1)));
// S-13.3 / S-13.4: open-window hours and absence-mode days, a possible explanation of an unusual day
const explainDoc = datasetDoc(async (d) => {
  const [rs, w] = await Promise.all([loadRoomState(d), import('../windows')]);
  return rs ? { open: w.openByDay(rs), away: w.absenceDays(rs) } : { open: new Map<string, number>(), away: new Set<string>() };
});
const redraw = () => rerender();

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

/**
 * « fenêtre ouverte N h » / « mode absence » (S-13.3), « journée ensoleillée » for a day heated less
 * than expected (#117, sun.ts), or '—'. `states`: the hourly room states are collected.
 */
function explanation(day: string, below: boolean, states: boolean, cut: number | null): string {
  const parts: string[] = [];
  if (states && explainDoc.status(ds) !== 'failed') {
    const explain = explainDoc.get(ds);
    if (!explain) return '…';
    const open = explain.open.get(day) ?? 0;
    if (open >= 1) parts.push(`fenêtre ouverte ${fmt1(open)} h`);
    if (explain.away.has(day)) parts.push('mode absence');
  }
  const sun = sunHint(day, below, ds!.sun, cut);
  if (sun) parts.push(sun);
  return parts.join(', ') || '—';
}

/** #303: a season with fewer heating days is not compared with the others as if it were complete. */
export const PROVISIONAL_DAYS = 60;
/** « 2025–2026 », « 2026–2027 (provisoire, 31 jours) ». */
export function seasonName(season: string, days: number, current: number): string {
  const y = Number(season.slice(0, 4));
  return `${seasonLabel(y)}${days < PROVISIONAL_DAYS ? ` (provisoire, ${days} jours)` : y >= current ? ' (en cours)' : ''}`;
}
const n2 = (v: number) => v.toFixed(2).replace('.', ',').replace('-', '−');
const ci = (v: number, c: [number, number], f: (x: number) => string) => `${f(v)} <small class="muted">[${f(c[0])} ; ${f(c[1])}]</small>`;
/**
 * #303: the one table of the signature (outdoor, and the indoor − outdoor difference when the
 * station gives it), same days and same fit for both: the latest season first, a short one marked.
 */
export function signatureTable(sigs: SeasonSignatures[], current: number, withDelta: boolean): string {
  if (!sigs.length) return '';
  const fit = (f: CiFit | null, sign: 1 | -1, n: number) =>
    f
      ? [ci(sign * f.slope, sign === 1 ? f.slopeCi : [-f.slopeCi[1], -f.slopeCi[0]], n2), f.threshold !== null && f.thresholdCi ? `${ci(f.threshold, f.thresholdCi, fmt1)} °C` : '—']
      : [`<span class="muted">trop peu de jours (${n}, ${MIN_DAYS} requis)</span>`, '—'];
  return `${table(
    [
      'Saison',
      'Jours de chauffe',
      'kWh de plus par jour pour 1 °C de moins dehors',
      'Plus de chauffage au-dessus de',
      ...(withDelta ? ["kWh de plus par jour pour 1 °C d'écart dedans − dehors", "Chauffage au-delà d'un écart de"] : []),
    ],
    sigs
      .slice()
      .reverse()
      .map((s) => [esc(seasonName(s.season, s.days, current)), s.days, ...fit(s.outdoor, -1, s.days), ...(withDelta ? fit(s.delta, 1, s.deltaDays) : [])]),
  )}<p class="hint muted">Entre crochets, la fourchette où la vraie valeur se trouve 19 fois sur 20. Jours chauffés sous 15 °C dehors ; jours perdus ou estimés exclus. Une saison de moins de ${PROVISIONAL_DAYS} jours est provisoire (droite en pointillé).</p>`;
}

/**
 * #308: the v1.5 « Analyse » cards, spread over the new pages. Each part draws only its cards:
 * the sub-pages of Historique (#386: « signature », the home against the cold; « jours », unusual
 * days; « calendrier », the calendar and the absences; « station »), « compteur » (hourly profile of
 * the radiators and the water heater, on the « Journée type » page, over `range`), « chauffe-eau », a tool of Outils (« consigne », « pac », « teletravail »,
 * « absences », « volets », « ia ») or the works card (« travaux », ⚙ Mon logement), and
 * « temps » for the temperatures of one room (its page).
 */
export type AnalysePart = 'signature' | 'jours' | 'calendrier' | 'station' | 'compteur' | 'chauffe-eau' | 'consigne' | 'pac' | 'teletravail' | 'absences' | 'volets' | 'ia' | 'travaux' | 'temps';

export function renderAnalyse(view: HTMLElement, records: DayRecord[], part: AnalysePart = 'signature', room: string | null = null, range?: [string, string]) {
  const years = ds!.meta.years;
  const year = state.analyseYear ?? years[years.length - 1];
  const last = lastDay();
  const tempRooms = activeRooms().filter((r) => ds!.temps.has(r.id));
  const tempRoom = part === 'temps' ? (tempRooms.find((r) => r.id === room)?.id ?? null) : null;
  // #460: the signature counts the stove's wood by default (one split of the wood: verdictWood);
  // the electricity alone stays one touch away
  const sigWood = part === 'signature' ? verdictWood(state.cat, state.rooms) : null;
  const sigWithWood = !!sigWood && state.sigEnergy !== 'elec';
  const cards: [AnalysePart, () => string][] = [
    ['ia', () => (ds!.insights ? '<section class="card insight" id="insight-card" aria-busy="true"><h2>Analyse du mois</h2></section>' : '<section class="card"><p class="hint muted">Analyse du mois : à activer dans ⚙ Paramètres → Sources de données (clé Anthropic).</p></section>')],
    [
      'signature',
      () =>
        ds!.weather
          ? `<section class="card" id="sig-card">
    <div class="card-head"><h2>Chauffage selon le froid dehors</h2><span class="card-period">${esc(`3 dernières saisons (sept. – août, au ${dayShort(last)})`)}</span></div>
    <p class="hint muted">Chaque point est un jour : le chauffage de la journée selon la température moyenne dehors${ds!.meta.weather_source === 'netatmo' ? ' (station Netatmo)' : ' (Open-Meteo)'}. La droite résume la saison : plus elle <strong>monte vite vers la gauche</strong>, plus la maison consomme pour chaque degré de froid ; là où elle touche zéro, c'est la température à partir de laquelle vous ne chauffez plus.</p>
    ${sigWood ? seg('sigEnergy', sigWithWood ? 'wood' : 'elec', [['wood', 'Électricité + bois'], ['elec', 'Électricité seule']], 'Chauffage compté') : ''}
    <div class="chart tall" id="sig-chart" role="img" aria-label="Chauffage de chaque jour selon la température extérieure"></div>
    <div id="sig-table"></div>
    <div id="sig-isolation"></div>
    <div id="sig-wind-zone"></div>
    ${countedHtml(true, sigWithWood ? 'bois du poêle compris, réparti selon les degrés-jours' : '')}
  </section>
  <section class="card" id="indoor-sig" hidden></section>`
          : `<section class="card"><h2>Chauffage selon le froid dehors</h2><p class="hint muted">Disponible dès que la collecte a récupéré la météo (prochaine collecte).</p></section>`,
    ],
    ['travaux', () => (tenant().on ? tenantNote('Les travaux sont l’affaire du propriétaire : la saisie est masquée') : '<div id="works-zone"></div>')],
    ['consigne', () => setpointCard(records) || '<section class="card"><p class="hint muted">Simulation disponible avec la météo et une saison de chauffe.</p></section>'],
    ['pac', () => (ds!.weather ? '<section class="card" id="hp-card" hidden></section>' : '<section class="card"><p class="hint muted">Simulation disponible avec la météo.</p></section>')],
    ['volets', () => '<div id="shutters-zone"></div>'],
    ['jours', () => anomaliesCard(records) || '<section class="card"><p class="hint muted">Aucun jour inhabituel : le chauffage a suivi la météo.</p></section>'],
    [
      'calendrier',
      () => `<section class="card" id="calendar-card">
    <div class="card-head"><h2>Calendrier <small class="muted">kWh par jour</small></h2><span class="card-period">${esc(yearLine(year, last))}</span>
      <div class="controls"><label class="select"><span class="sr-only">Année</span><select data-set="analyseYear">${years
        .slice()
        .reverse()
        .map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`)
        .join('')}</select></label></div>
    </div>
    <div class="chart" id="cal-chart" style="height:190px" role="img" aria-label="Calendrier de consommation"></div>
    ${countedHtml()}
  </section>
  <div id="hist-absence-zone"></div>`,
    ],
    ['absences', () => '<div id="absence-zone"></div>'],
    [
      'compteur',
      () => `<section class="card" aria-labelledby="hourly-title">
    <div class="card-head"><h2 id="hourly-title">Par jour et par heure</h2></div>
    <div id="hourly-zone"><p class="hint muted">${(ds!.meta.hourly_years ?? []).length ? 'Chargement des données horaires…' : 'Les données horaires arriveront avec la prochaine collecte complète.'}</p></div>
  </section>`,
    ],
    ['teletravail', () => '<div id="telework-zone"></div>'],
    ['chauffe-eau', () => waterHeaterCard() || '<section class="card"><p class="hint muted">Pas de chauffe-eau suivi, ou pas encore de relevé heures pleines / creuses.</p></section>'],
    ['station', () => stationCard() || '<section class="card"><p class="hint muted">Pas de station Netatmo reliée : à activer dans ⚙ Paramètres → Sources de données.</p></section>'],
    [
      'temps',
      () =>
        tempRoom
          ? `<section class="card"><div class="card-head"><h2>Températures de la pièce <small class="muted">${esc(roomName(tempRoom))}, °C, moyenne par semaine, 12 derniers mois</small></h2></div>
      <p class="hint muted">Mesurée par la sonde du radiateur ; la ${TEMP.setpoint} est celle du planning Intuis, en moyenne sur la journée.</p>
      <div class="chart" id="temp-chart" role="img" aria-label="${esc(roomName(tempRoom))} : température mesurée, ${TEMP.setpoint} et température extérieure, par jour"></div></section>`
          : '',
    ],
  ];
  view.innerHTML = html(cards.filter(([p]) => p === part).map(([, c]) => c()).join(''));
  const has = (id: string) => !!document.getElementById(id);

  // signature (#303: the same days as the indoor signature, lost or estimated days and days
  // without heating left out; a season still too short is dashed and called « provisoire »)
  if (ds!.weather && has('sig-chart')) {
    const exclude = judgedOut(ds!.records, '0000-01-01', last); // #394: cut days too
    const both = withWood(records, sigWood);
    const days = signatureDays(sigWithWood ? both : records, ds!.weather, ds!.station ?? null, null, exclude);
    const sigs = seasonSignatures(days).slice(-3);
    const cur = Number(seasonOf(last).slice(0, 4));
    scatterChart(document.getElementById('sig-chart')!, {
      xName: 'Température extérieure moyenne (°C)',
      yName: 'kWh / jour',
      series: sigs.map((sg) => {
        const y = Number(sg.season.slice(0, 4));
        const style = seasonStyle(y, cur);
        const pts = days.get(sg.season)!.map((p) => [Math.round(p.tOut * 10) / 10, Math.round(p.kwh * 10) / 10, dayLong(p.day)] as [number, number, string]);
        const xs = pts.map((p) => p[0]);
        const f = sg.outdoor;
        return {
          name: seasonName(sg.season, sg.days, cur),
          color: style.color,
          provisional: style.dashed || sg.days < PROVISIONAL_DAYS,
          points: pts,
          fit: f ? { slope: f.slope, intercept: f.intercept, from: Math.min(...xs), to: Math.min(15, f.threshold ?? 15) } : null,
        };
      }),
    });
    document.getElementById('sig-table')!.innerHTML = html(signatureTable(sigs, cur, false));
    // #460: the insulation, judged on the electricity + wood whatever the chart shows
    const whole = state.rooms === null && state.cat !== 'water_heater';
    const judged = sigWithWood || !sigWood ? sigs : seasonSignatures(signatureDays(both, ds!.weather, ds!.station ?? null, null, exclude)).slice(-3);
    const alone = sigWood ? (sigWithWood ? seasonSignatures(signatureDays(records, ds!.weather, ds!.station ?? null, null, exclude)).slice(-3) : sigs) : null;
    document.getElementById('sig-isolation')!.innerHTML = html(isolationBlock(whole, judged, alone, cur, PROVISIONAL_DAYS));
    if (whole) fillPerM2(records, sigWood, judgedOut(records, addDays(minusYears(last), 1), last).size);
    // S-3.12 (#221): the wind and the rain, on the same days
    document.getElementById('sig-wind-zone')!.innerHTML = html(windBlock(days, ds!.wind, ds!.rain, cur));
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
  if (has('cal-chart')) calendarChart(document.getElementById('cal-chart')!, cal);
  // S-4.9 telework cost, S-4.10 absences (marks on the calendar), loaded on demand (S-7.10)
  if (has('cal-chart') || has('absence-zone') || has('telework-zone')) {
    void lazyCard(() => import('./habits'), (m) => m.fillAnalyse(cal), { zone: has('absence-zone') ? 'absence-zone' : 'telework-zone', what: 'Absences et télétravail' });
  }
  // S-6.2: surfaces and works markers, signature before / after (lazy module)
  if (has('works-zone')) void lazyCard(() => import('./works'), (m) => m.fillWorks(records), { zone: 'works-zone', what: 'Travaux et surfaces' });
  // temperatures of one room (its page)
  if (tempRoom && has('temp-chart')) {
    const from = addDays(minusYears(last), 1);
    const days: string[] = [];
    for (let d = from; d <= last; d = addDays(d, 1)) days.push(d);
    const t = ds!.temps.get(tempRoom)!;
    lineChart(document.getElementById('temp-chart')!, {
      labels: days.map((d) => bucketLabel(d, 'day')),
      series: [
        { name: TEMP.measured, color: measureColor(), data: days.map((d) => t.get(d)?.[0] ?? null) },
        // decision of the owner (v1.7): the setpoint is a reference, dashed (the outdoor line, same ink, is solid)
        { name: TEMP.setpointShort, color: referenceColor(), data: days.map((d) => t.get(d)?.[1] ?? null), dashed: true },
        ...(ds!.weather ? [{ name: TEMP.outdoor, color: referenceColor(), data: days.map((d) => ds!.weather!.get(d)?.[2] ?? null) }] : []),
      ],
      price: null,
      unit: '°C',
    });
  }
  // S-5.7/S-5.8: AI card loaded on demand (markdown renderer, votes, usage)
  if (ds!.insights && has('insight-card')) void lazyCard(() => import('./insight'), (m) => m.mountInsight(document.getElementById('insight-card')), { zone: 'insight-card', what: 'Analyse IA' });
  drawStation();
  drawHourly(records, range);
  // the water heater's hours need the hourly data: loaded for its page too
  if (has('wh-hours') && (ds!.meta.hourly_years ?? []).length) hourlyDoc.get(ds, redraw);
  drawWaterHeater(hourlyDoc.status(ds) === 'ready' ? hourlyDoc.get(ds)! : null);
  drawSetpoint(records);
  // S-2.15: heat pump estimate, lazy module
  if (has('hp-card')) void lazyCard(() => import('./heatpump'), (m) => m.mountHeatPump(document.getElementById('hp-card'), records), { zone: 'hp-card', what: 'Pompe à chaleur' });
  drawIndoorSignature(sigWithWood ? withWood(records, sigWood) : records); // #460: the same heating as the signature above
  // S-9.6: « volets fermés » journal, lazy module
  if (has('shutters-zone')) {
    void lazyCard(() => import('./shutters'), (m) => {
      const zone = document.getElementById('shutters-zone');
      if (zone) m.renderShutters(zone);
    }, { zone: 'shutters-zone', what: 'Volets fermés' });
  }
}

function anomaliesCard(records: DayRecord[]) {
  if (!ds!.weather) return '';
  // S-1.10: lost or estimated days are not "unusual", they are not measured; #394: nor a day of power or Internet cut
  const list = anomalies(records, ds!.weather, judgedOut(ds!.records, '0000-01-01', lastDay())).slice(0, 12);
  const suspect = (a: (typeof list)[number]) => a.z < 0 && a.kwh < SUSPECT_RATIO * a.expected;
  const alerts = hcAlerts();
  if (!list.length) return alerts ? `<section class="card"><h2>Jours inhabituels</h2>${alerts}${countedHtml(true)}</section>` : '';
  const withStates = !!ds!.meta.has_roomstate;
  if (withStates) loadExplanations();
  // #117: the sun of the day, when the radiation is collected (Open-Meteo)
  const cut = ds!.sun?.size ? sunMedian(ds!.sun, ds!.weather) : null;
  const withExplain = withStates || cut !== null;
  const since = list[list.length - 1].day;
  return `<section class="card" id="unusual-card"><div class="card-head"><h2>Jours inhabituels</h2><span class="card-period">${esc(`les ${list.length} plus récents, depuis le ${dayShort(since, true)}`)}</span></div>
    ${alerts}
    <p class="hint muted">Jours où le chauffage s'écarte nettement de ce qu'annonçait la température dehors (plus de 2 fois l'écart habituel et plus de 3 kWh) : fenêtre ouverte, absence, invités, réglage oublié… « Attendu » : le chauffage d'un jour ordinaire à la même température, lu sur la saison. Les jours perdus chez Intuis ou estimés, et ceux d'une coupure de courant ou d'Internet (journal des incidents), n'y figurent pas ; un jour très en dessous de l'attendu est marqué <strong>à vérifier</strong> (donnée peut-être incomplète, voir « État des données » dans Outils).</p>
    ${withExplain ? `<p class="hint muted">« Explication possible », une piste et non une certitude${withStates ? ' : heures de fenêtre ouverte de toutes les pièces ce jour-là, ou mode absence relevé (relevé horaire de l’état des pièces). Une fenêtre ouverte coupe le radiateur de la pièce, qui relance ensuite : le jour peut se retrouver au-dessus ou en dessous de l’attendu' : ''}${cut !== null ? `${withStates ? '. Pour un jour en dessous de l’attendu' : ' : pour un jour en dessous de l’attendu'}, une journée ensoleillée (plus que la moitié des jours de chauffe : rayonnement du jour au-dessus de ${esc(fmt1(cut))}\u00a0MJ/m², d’après Open-Meteo) : le soleil entré par les fenêtres a pu chauffer à la place des radiateurs` : ''}.</p>` : ''}
    ${table(
      ['Jour', 'Consommé', 'Attendu', 'Écart', ...(withExplain ? ['Explication possible'] : [])],
      list.map((a) => [
        longDate(a.day),
        fmtKwh(a.kwh),
        fmtKwh(Math.max(0, a.expected)),
        `<span class="delta ${a.z > 0 ? 'up' : 'down'}"><span aria-hidden="true">${a.z > 0 ? '▲' : '▼'}</span> ${a.z > 0 ? '+' : '−'}${fmtKwh(Math.abs(a.kwh - a.expected))}</span>${suspect(a) ? ' <span class="badge-suspect" title="Très en dessous de l’attendu : donnée peut-être incomplète chez Intuis">à vérifier</span>' : ''}`,
        ...(withExplain ? [esc(explanation(a.day, a.z < 0, withStates, cut))] : []),
      ]),
    )}${countedHtml(true)}</section>`;
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
    <div class="card-head"><h2>Station météo Netatmo <small class="muted">moyenne par semaine</small></h2><span class="card-period">${esc(periodLine('12m', lastDay()))}</span>
      <div class="controls">${seg('stationMetric', state.stationMetric, [['temp', 'Température'], ['hum', 'Humidité'], ['co2', 'CO₂']], 'Mesure')}</div>
    </div>
    ${state.stationMetric === 'co2' ? '<p class="hint muted">CO₂ : au-delà de 1 000 ppm, l\'air est confiné (aérer) ; 1 500 ppm et plus, aération insuffisante. Mesuré par les modules intérieurs seulement.</p>' : ''}
    <div class="chart" id="station-chart" role="img" aria-label="Mesures de la station Netatmo"></div>
    <div id="station-table"></div>
    ${countedNote("les modules de la station Netatmo (pas les sondes des radiateurs), le CO₂ à l'intérieur seulement.")}
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
  // #399: the colour follows the room the module is linked to (as in Pièces), the outdoor one dashed grey
  const color = (k: string) => moduleColor(st, k);
  // #306: 365 noisy daily values per module → one mean per week (« sem. du 3 nov. »)
  const week = weeklyMeans(
    days,
    keys.map((k) => days.map((d) => st.daily[k]?.[d]?.[col] ?? null)),
  );
  lineChart(el, {
    labels: week.labels.map((d) => `sem. du ${dayShort(d, true)}`),
    series: keys.map((k, i) => ({ name: st.modules[k].name, color: color(k), dashed: isOutdoor(st, k), data: week.data[i] })),
    price: null,
    unit,
    mark: state.stationMetric === 'co2' ? { value: 1000, label: '1 000 ppm' } : state.stationMetric === 'hum' ? { value: 65, label: '65 %' } : undefined,
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
      isOutdoor(st, k)
        ? `<span class="swatch swatch-dashed" style="border-color:${color(k)}"></span>${esc(st.modules[k].name)}`
        : `<span class="swatch" style="background:${color(k)}"></span>${esc(st.modules[k].name)}`,
      fmt(seasonAvg(k, lastSeason - 1)),
      fmt(seasonAvg(k, lastSeason)),
      ...(comfort ? [st.modules[k].indoor || state.stationMetric === 'hum' ? daysAbove(st.daily[k] ?? {}, col, thr, from, last) : '—'] : []),
    ]),
  ));
}

// ------------------------------------------------------------------ hourly profile
function drawHourly(records: DayRecord[], range?: [string, string]) {
  const zone = document.getElementById('hourly-zone');
  if (!zone || !(ds!.meta.hourly_years ?? []).length) return;
  const hourly = hourlyDoc.get(ds, redraw);
  if (!hourly) {
    if (hourlyDoc.status(ds) === 'failed') zone.innerHTML = html`<p class="hint muted">${unavailable('Données horaires')}</p>`;
    return;
  }
  // #301: the period of the Compteur tab (within the 12 months loaded), else the last 90 days
  const last = range?.[1] ?? lastDay();
  const yearAgo = addDays(minusYears(lastDay()), 1);
  const from = range ? (range[0] > yearAgo ? range[0] : yearAgo) : addDays(last, -89);
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
    ${countedNote(
      `les radiateurs et le chauffe-eau (pas tout le logement), kWh moyens par heure, du ${esc(longDate(from))} au ${esc(longDate(last))}${
        byHalf ? ` ; courbe au pas de 30 minutes sur ${halfDays} jours mesurés pièce par pièce` : ''
      }.`,
    )}`;
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
