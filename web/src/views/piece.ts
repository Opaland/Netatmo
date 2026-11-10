// #313: the Pièces list (by cost, comfort pill, the water heater apart) and the page of one room:
// « maintenant », planning of the day over the off-peak hours, cost and temperature tiles,
// temperature (measured vs requested, cold days marked), « Pourquoi il a fait froid »,
// consumption over 12 months, air (night CO₂) and radiator. Loaded on demand (pages.ts); the
// computations are in piece.ts. The household view (bedrooms grouped, opt-in) is a display
// matter: a group page reads its bedrooms' raw documents (room30, room states) without naming them.
import { type DayRecord, addDays, bucketKeys, bucketLabel, minusYears, pctChange, total } from '../aggregate';
import { activeRooms, datasetDoc, ds, onDatasetLoaded, rerender, state } from '../app';
import { barChart, chartOf, cssVar, lineChart } from '../charts';
import { effectiveMapping, isBedroom, lastNightDay, lastNights, nightVerdict, offsetStats, signed, summarizeNights } from '../comfort';
import { alert, comparison, howDetails, legend, listRow, scheduleBand, tile } from '../components';
import { type Dataset, loadRoom30, loadRoomState } from '../data';
import type { DatasetDoc } from '../loader';
import { BEDROOMS_ID } from '../household';
import { NO_REFERENCE, PERIOD, TEMP, dayLong, dayShort, fmt1, hourMin, hourRange, vsLabel } from '../glossary';
import { offPeakShares } from '../analysis';
import { bucketMarks } from '../periods';
import {
  type ColdDay,
  byCost,
  coldDays,
  comfortPill,
  lastReading,
  meanIn,
  modeText,
  offPeakRanges,
  reasonText,
  scheduleOf,
  tempAxis,
  timeAtSetpoint,
} from '../piece';
import { type Room30, tempDrops, unpack } from '../room30';
import { html } from '../trusted';
import { avgPrice, costOf, esc, fmtEur, fmtKwh, lastDay, nf0, offCol, roomColor } from '../ui';
import { ABSENCE_MODES, type RoomState, type StateCell, bits, modeLabel } from '../windows';
import { lazyCard } from '../lazy';
import { offlineText } from '../room-offline';
import { offlineEstimate, offlineLine, offlineRun } from './offline-rooms';

// ------------------------------------------------------------------ documents (loaded on demand)
/** Hourly room states (window, load shedding, modes): one document, a year of daily aggregates. */
const stateDoc = datasetDoc(async (d) => (d.meta.has_roomstate ? await loadRoomState(d) : null));
/** Half hours of the last weeks (now, schedule, time at the requested temperature, falls). */
const r30Doc = datasetDoc(async (d) => ((d.meta.room30_years ?? []).length && d.meta.last_day ? await loadRoom30(d, addDays(d.meta.last_day, -40)) : null));
/** Night CO₂ of a bedroom: shown after a deliberate gesture, until the next lock (as in Air et confort). */
let airShown = false;
onDatasetLoaded(() => {
  airShown = false;
});

const DAYS = 30;
const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;

/** A document, redrawing the page shown once it arrives; undefined while loading, null when absent. */
function doc<T>(d: DatasetDoc<Dataset, T | null>, key: string): T | null | undefined {
  const v = d.get(ds, () => state.view === key && rerender());
  if (v !== undefined) return v;
  return d.status(ds) === 'failed' ? null : undefined;
}

// ------------------------------------------------------------------ rooms, sources
/** Raw room ids behind a room shown (the bedrooms of « Chambres » in household view). */
function members(id: string): string[] {
  const m = ds!.roomMap;
  if (!m?.size) return [id];
  const raw = [...m].filter(([, g]) => g === id).map(([r]) => r);
  return raw.length ? raw : [id];
}

/** Station module linked to a heated room (saved choice, or the suggestion by name). */
function stationKey(id: string): string | undefined {
  const st = ds!.station;
  if (!st) return undefined;
  return effectiveMapping(
    activeRooms().filter((r) => r.category === 'heating'),
    st.modules,
    state.roomModuleMap,
  ).get(id);
}

/** Daily mean temperature of a room: the station when a module is linked, else the radiator probe. */
function measured(id: string): { days: Map<string, number | null>; source: 'station' | 'radiator' } {
  const k = stationKey(id);
  const daily = k ? ds!.station!.daily[k] : undefined;
  if (k && daily) return { days: new Map(Object.entries(daily).map(([d, v]) => [d, v[2]])), source: 'station' };
  return { days: new Map([...(ds!.temps.get(id) ?? [])].map(([d, v]) => [d, v[0]])), source: 'radiator' };
}
const sourceLabel = (s: 'station' | 'radiator') => (s === 'station' ? 'station' : 'sonde du radiateur');

/** Room-state cells of the room's members on a day; null when no snapshot covers that day. */
function cellsOf(rs: RoomState, ids: string[]) {
  return (day: string): StateCell[] | null => {
    const c = ids.map((m) => rs.rooms?.[m]?.[day]).filter((x): x is StateCell => !!x);
    return c.length || bits(rs.seen?.[day] ?? 0) > 0 ? c : null;
  };
}
function sumState(rs: RoomState, ids: string[], from: string, to: string, f: (c: StateCell) => number | undefined): number | null {
  let s = 0;
  let any = false;
  for (const m of ids) {
    for (const [d, c] of Object.entries(rs.rooms?.[m] ?? {})) {
      if (d < from || d > to) continue;
      any = true;
      s += f(c) ?? 0;
    }
  }
  return any ? Math.round(s * 10) / 10 : null;
}
const h1 = (v: number) => `${fmt1(v).replace(/,0$/, '')} h`;

// ------------------------------------------------------------------ Pièces
export interface PiecesOpts {
  /** Rooms picker and selection chip (shell, pages.ts): they apply to the other pages. */
  picker: string;
  /** Draws the « compare with last year » card (chart and table by room) in its element. */
  compare: (el: HTMLElement) => void;
}

export function renderPieces(view: HTMLElement, o: PiecesOpts) {
  const last = lastDay();
  const yearStart = `${last.slice(0, 4)}-01-01`;
  const from30 = addDays(last, -(DAYS - 1));
  const thr = state.comfortThreshold;
  const rs = doc(stateDoc, 'pieces');
  const rows = activeRooms().map((r) => {
    const mine = ds!.records.filter((x) => x.room === r.id);
    // #346: a room offline counts with its share estimated from the meter (« ≈ »), never 0 kWh
    // sorted on what was measured; the estimate is said under the name, never added in
    const run = offlineRun(r.id, yearStart, last);
    const est = run ? (offlineEstimate(r.id, yearStart, last) ?? 0) : 0;
    return { room: r, kwh: total(mine, yearStart, last), eur: costOf(mine, yearStart, last), run, est };
  });
  const value = (x: { kwh: number; eur: number | null; run: unknown }) => {
    if (x.run && !x.kwh) return '—'; // nothing measured: not « 0 kWh »
    return x.eur === null ? esc(fmtKwh(x.kwh)) : `${esc(fmtEur(x.eur))}<span class="s">${esc(fmtKwh(x.kwh))}</span>`;
  };
  const heated = byCost(rows.filter((x) => x.room.category === 'heating')).map((x) => {
    const m = measured(x.room.id);
    const t = meanIn(m.days, from30, last);
    let cold = 0;
    for (const [d, v] of m.days) if (d >= from30 && d <= last && v !== null && v < thr) cold++;
    const open = rs ? sumState(rs, members(x.room.id), from30, last, (c) => c.open_window_h) : null;
    const pill = comfortPill(cold, open, thr);
    const sub = x.run
      ? `<span class="pill${x.run.stopped ? '' : ' warn'}">${esc(offlineText(x.run))}</span>${x.est ? ` · ≈ ${esc(fmtKwh(x.est))} estimés` : ''}`
      : t
        ? `${fmt1(t.mean)} °C · <span class="pill ${pill.level}">${esc(pill.text)}</span>`
        : '<span class="muted">pas de température relevée</span>';
    const tag = x.room.id === BEDROOMS_ID ? ' <span class="tag">regroupées</span>' : '';
    return `<li><a class="row" href="#piece-${esc(encodeURIComponent(x.room.id))}" data-room-link="${esc(x.room.id)}"><span class="swatch" style="background:${esc(roomColor(x.room.id))}" aria-hidden="true"></span><span><span class="t">${esc(x.room.name)}${tag}</span><span class="s">${sub}</span></span><span class="v">${value(x)}</span><span class="chev" aria-hidden="true">›</span></a></li>`;
  });
  const shares = offPeakShares(ds!.tariffs, offCol()).perRoom;
  const water = byCost(rows.filter((x) => x.room.category === 'water_heater')).map((x) => {
    const s = shares.get(x.room.id);
    const sub = s === undefined ? 'heures creuses, heures de chauffe' : `${nf0.format(s * 100)} % en heures creuses`;
    return `<li><a class="row" href="#chauffe-eau"><span class="swatch" style="background:var(--usage-water)" aria-hidden="true"></span><span><span class="t">${esc(x.room.name)}</span><span class="s">${esc(sub)}</span></span><span class="v">${value(x)}</span><span class="chev" aria-hidden="true">›</span></a></li>`;
  });
  view.innerHTML = html(`<h2 class="page-title" id="page-title" tabindex="-1">Pièces</h2>
  <p class="card-sub">${esc(`${PERIOD.ytd} (au ${dayShort(last)}), trié par coût · température et confort : ${PERIOD['30d'].toLowerCase()}, seuil ${fmt1(thr)} °C`)}</p>
  ${heated.length ? `<ul class="list" aria-label="Pièces chauffées, de la plus chère à la moins chère">${heated.join('')}</ul>` : ''}
  ${water.length ? `<p class="section-title">Appareils</p><ul class="list" aria-label="Appareils">${water.join('')}</ul>` : ''}
  <p class="section-title">Tout le logement</p>
  <ul class="list">${listRow({ title: 'Air et confort', sub: 'CO₂ des nuits, humidité, heures sous le seuil, fenêtres, capteurs', href: '#confort' })}</ul>
  <p class="section-title">Comparer avec l’an dernier</p>
  ${o.picker}
  <div class="part" id="pieces-compare"></div>`);
  o.compare(document.getElementById('pieces-compare')!);
}

// ------------------------------------------------------------------ Pièce
export function renderPiece(view: HTMLElement, id: string) {
  const room = activeRooms().find((r) => r.id === id)!;
  const key = `piece-${encodeURIComponent(id)}`;
  const last = lastDay();
  const from30 = addDays(last, -(DAYS - 1));
  const yearStart = `${last.slice(0, 4)}-01-01`;
  const thr = state.comfortThreshold;
  const heating = room.category === 'heating';
  const ids = members(id);
  const group = id === BEDROOMS_ID;
  const mine = ds!.records.filter((r) => r.room === id);
  const rs = heating ? doc(stateDoc, key) : null;
  const r30 = heating ? doc(r30Doc, key) : null;
  const m = measured(id);
  const setpoints = ds!.temps.get(id);
  const days: string[] = [];
  for (let d = from30; d <= last; d = addDays(d, 1)) days.push(d);

  const parts: string[] = [];
  // #346: a room without reading says so first, with its estimate from the meter
  const run = offlineRun(id, minusYears(yearStart), last);
  if (run?.stopped) {
    // switched off on purpose (⚙ Mon logement): expected, not a failure
    const st = run.stopped;
    parts.push(
      alert(
        'info',
        `Radiateur ${offlineText(run)}`,
        '',
        `<p>${esc(`${st.label ? `${st.label.charAt(0).toUpperCase()}${st.label.slice(1)}. ` : ''}Pas de données attendues : la baisse de sa consommation électrique vient du changement de mode de chauffage, pas de vos réglages.`)} <a class="link" href="#parametres-logement">Réglage</a></p>`,
      ),
    );
  } else if (run) {
    const line = offlineLine(id, yearStart, last);
    parts.push(
      alert(
        run.ongoing ? 'warn' : 'info',
        `${room.name} : ${offlineText(run)}`,
        `${run.ongoing ? 'Le module n’envoie plus rien : les jours sans relevé ne sont pas à 0 kWh, ils manquent. ' : 'Les jours sans relevé manquent (ils ne sont pas à 0 kWh). '}${
          line.includes('estimés') ? `Depuis le 1er janvier, ${line.split(' · ')[1]}. ` : ''
        }Les comparaisons avec l’an dernier ne comptent pas cette pièce.${run.ongoing ? ' Hors ligne, le radiateur ne reçoit plus le planning ni le mode absence : vérifier son alimentation, le redémarrer, puis l’associer de nouveau dans l’application Intuis.' : ''}`,
      ),
    );
  }
  if (heating) parts.push(nowCard(room.name, ids, group, m, r30, rs, last));
  parts.push(tilesRow(mine, m, r30, ids, yearStart, from30, last, heating));
  if (heating && [...m.days].some(([d, v]) => d >= from30 && v !== null)) {
    parts.push(`<section class="card" id="piece-temp">
      <div class="card-head"><h2>Température</h2></div>
      <p class="card-sub">${esc(`${PERIOD['30d']} · moyenne par jour, °C`)}</p>
      ${legend([
        { label: `Mesurée (${sourceLabel(m.source)})`, color: '--series-measure' },
        { label: TEMP.setpointShort, color: '--accent', kind: 'line' },
        { label: `Jour sous ${fmt1(thr)} °C`, color: '--state-warn' },
      ])}
      <div class="chart" id="piece-temp-chart" role="img" aria-label="${esc(room.name)} : température mesurée et ${esc(TEMP.setpoint)}, par jour"></div>
    </section>`);
    parts.push(coldCard(m, setpoints, ids, group, rs, r30, from30, last, thr, days));
  }
  if (!state.simple) {
    parts.push(consoCard(room.category, mine, yearStart, last));
    if (heating) parts.push(airCard(id, room.name, from30, last));
    if (heating) parts.push(radiatorCard(id, ids, rs, from30, last));
  }
  parts.push(`<section class="card"><div class="card-head"><h2>Pour aller plus loin</h2></div><ul class="list">${[
    room.category === 'water_heater' ? listRow({ title: 'Chauffe-eau', sub: 'heures creuses, heures de chauffe, contacteur', href: '#chauffe-eau' }) : '',
    listRow({ title: 'Air et confort', sub: 'toutes les pièces : heures sous le seuil, fenêtres, CO₂, sondes', href: '#confort' }),
    listRow({ title: 'Qu’est-ce qui a changé ?', sub: 'pièce par pièce, dans Historique', href: '#historique' }),
  ].join('')}</ul></section>`);
  view.innerHTML = html(parts.join(''));

  const tempEl = document.getElementById('piece-temp-chart');
  if (tempEl) drawTemp(tempEl, room.name, m, setpoints, days, thr);
  const consoEl = document.getElementById('room-detail');
  if (consoEl) drawConso(consoEl, room.category, mine, last);
  if (document.getElementById('piece-surface')) {
    void lazyCard(
      () => import('./works'),
      async (w) => {
        const works = await w.loadWorks();
        const { displaySurfaces } = await import('../household');
        const m2 = displaySurfaces(ds!, works.surfaces)[id];
        const el = document.getElementById('piece-surface');
        if (!el) return;
        const kwh = total(mine, addDays(last, -364), last);
        el.outerHTML = html(
          m2
            ? listRow({ title: 'Surface · par m²', sub: PERIOD['12m'], value: `${fmt1(m2).replace(/,0$/, '')} m² · ${nf0.format(kwh / m2)} kWh` })
            : listRow({ title: 'Surface', sub: 'à saisir dans ⚙ Mon logement, pour les kWh par m²', href: '#parametres-logement' }),
        );
      },
      { zone: 'piece-surface', what: 'Surface' },
    );
  }
}

// ------------------------------------------------------------------ « maintenant » and planning
function nowCard(
  name: string,
  ids: string[],
  group: boolean,
  m: ReturnType<typeof measured>,
  r30: Room30 | null | undefined,
  rs: RoomState | null | undefined,
  last: string,
): string {
  const reading = r30 ? lastReading(r30, ids) : null;
  const facts: [string, string][] = [];
  let temp: number | null = null;
  let when = '';
  let band = '';
  const range = (v: number[]) => {
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    return hi - lo < 0.05 ? `${fmt1(lo)} °C` : `${fmt1(lo)} à ${fmt1(hi)} °C`;
  };
  let day = last;
  if (reading && reading.temps.length) {
    day = reading.day;
    temp = reading.temps.reduce((a, b) => a + b, 0) / reading.temps.length;
    when = `relevé du ${dayShort(day)} à ${hourMin(Math.floor(reading.slot / 2), (reading.slot % 2) * 30)}${group ? ', moyenne des chambres' : ''}`;
    if (reading.setpoints.length) facts.push([TEMP.setpointShort, range(reading.setpoints)]);
    const sp = !group ? unpack(r30!.get(ids[0])?.get(day)?.[3]) : null;
    const sched = sp ? scheduleOf(sp) : null;
    const away = rs ? Math.max(0, ...ids.map((i) => ABSENCE_MODES.reduce((s, k) => s + (rs.rooms?.[i]?.[day]?.mode_h?.[k] ?? 0), 0))) : 0;
    if (away >= 12) facts.push(['Mode', `${modeLabel('away')} (presque toute la journée du ${dayShort(day)})`]);
    else if (sched) facts.push(['Mode', modeText(sched, reading.slot)]);
    else if (sp && sp.some((v) => v !== null)) facts.push(['Mode', 'température demandée constante']);
    if (sched) {
      const off = offPeakRanges(r30!, addDays(day, -6), day);
      const comfort = sched.slots.filter((s) => s.kind === 'comfort').map((s) => hourRange(s.from, s.to));
      const now = reading.slot / 2 + 0.25;
      band = `<p class="section-title">Planning du ${esc(dayShort(day))}</p>${scheduleBand({
        slots: sched.slots,
        offPeak: off,
        now,
        label: `Planning du ${dayLong(day, false)} : confort (${fmt1(sched.comfort)} °C) ${comfort.join(', ')}, économie (${fmt1(sched.eco)} °C) le reste du temps${
          off.length ? ` ; heures creuses ${off.map(([a, b]) => hourRange(a, b)).join(', ')}` : ''
        } ; trait : dernier relevé`,
      })}${legend([
        { label: `Confort ${fmt1(sched.comfort)} °C`, color: '--usage-heating' },
        { label: `Économie ${fmt1(sched.eco)} °C`, color: '--usage-other' },
        ...(off.length ? [{ label: 'Heures creuses', color: '--accent-text', kind: 'hatch' as const }] : []),
      ])}<p class="hint muted">Lu dans les températures demandées de la journée, demi-heure par demi-heure.</p>`;
    }
  } else {
    // no half hours: the daily mean of the last day
    const v = m.days.get(last) ?? null;
    temp = v;
    when = `moyenne du ${dayShort(last)} (${sourceLabel(m.source)})`;
    const sp = ds!.temps.get(ids.length === 1 ? ids[0] : (group ? BEDROOMS_ID : ids[0]))?.get(last)?.[1];
    if (sp !== null && sp !== undefined) facts.push([TEMP.setpointShort, `${fmt1(sp)} °C (moyenne du jour)`]);
  }
  if (rs) {
    const c = ids.map((i) => rs.rooms?.[i]?.[day]).filter((x): x is StateCell => !!x);
    if (c.length) {
      const open = c.reduce((s, x) => s + (x.open_window_h ?? 0), 0);
      facts.push(['Fenêtre', open >= 0.5 ? `ouverte ${h1(Math.round(open * 10) / 10)} le ${dayShort(day)}` : `fermée le ${dayShort(day)}`]);
    }
  }
  const k = stationKey(group ? BEDROOMS_ID : ids[0]);
  const sd = k ? ds!.station!.daily[k]?.[day] : undefined;
  if (sd && (sd[3] !== null || sd[4] !== null) && (!isBedroom(name) || airShown)) {
    facts.push(['Humidité · CO₂', `${sd[3] !== null ? `${nf0.format(sd[3])} %` : '—'} · ${sd[4] !== null ? `${nf0.format(sd[4])} ppm` : '—'} (moyenne du jour)`]);
  }
  const loading = r30 === undefined ? '<p class="hint muted" role="status">Chargement des relevés de la demi-heure…</p>' : '';
  return `<section class="card" id="piece-now" aria-labelledby="piece-now-title">
    <div class="card-head"><h2 id="piece-now-title">Maintenant</h2></div>
    <p class="card-sub">${esc(when ? `Dernier ${when}` : 'Pas de relevé récent')}</p>
    <div class="now"><p class="temp">${temp === null ? '—' : esc(fmt1(temp))}<small> °C</small></p><dl>${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>${band}${loading}
  </section>`;
}

// ------------------------------------------------------------------ tiles
function tilesRow(
  mine: DayRecord[],
  m: ReturnType<typeof measured>,
  r30: Room30 | null | undefined,
  ids: string[],
  yearStart: string,
  from30: string,
  last: string,
  heating: boolean,
): string {
  const kwh = total(mine, yearStart, last);
  const eur = costOf(mine, yearStart, last);
  const pFrom = minusYears(yearStart);
  const pTo = minusYears(last);
  const before = total(mine, pFrom, pTo);
  const eurBefore = before > 0 ? costOf(mine, pFrom, pTo) : null;
  // #346: offline this year or the last one: measured days only, not compared
  const run = offlineRun(mine[0]?.room ?? ids[0], pFrom, last);
  const delta = !run && before > 0 ? (eur !== null && eurBefore ? pctChange(eur, eurBefore) : pctChange(kwh, before)) : null;
  const tiles = [
    tile({
      label: run ? `${PERIOD.ytd}, jours mesurés` : PERIOD.ytd,
      value: eur === null ? fmtKwh(kwh) : fmtEur(eur),
      sub: `${eur === null ? '' : `${esc(fmtKwh(kwh))} · `}${comparison(delta, vsLabel(yearStart, last), { none: run ? `${offlineText(run)} : ${run.stopped ? 'changement de mode de chauffage' : 'non comparé'}` : NO_REFERENCE })}`,
      id: 'piece-cost',
    }),
  ];
  if (heating) {
    const t = meanIn(m.days, from30, last);
    const sp = meanIn([...(ds!.temps.get(ids.length === 1 ? ids[0] : BEDROOMS_ID) ?? [])].map(([d, v]) => [d, v[1]]), from30, last);
    if (t)
      tiles.push(
        tile({
          label: 'Température moyenne',
          value: `${fmt1(t.mean)} °C`,
          sub: esc(`${PERIOD['30d'].toLowerCase()} · ${sourceLabel(m.source)}${sp ? ` · demandée ${fmt1(sp.mean)} °C` : ''}`),
          id: 'piece-mean',
        }),
      );
    const at = r30 ? timeAtSetpoint(r30, ids, from30, last) : null;
    if (at)
      tiles.push(
        tile({
          label: 'Temps à la consigne',
          value: `${nf0.format(at.share * 100)} %`,
          sub: esc(PERIOD['30d']),
          id: 'piece-at-setpoint',
        }),
      );
  }
  const note = tiles.some((t) => t.includes('piece-at-setpoint'))
    ? `<p class="hint muted" id="piece-at-setpoint-def">Temps à la consigne : part des heures où la pièce était à la température demandée aux radiateurs, à 0,5 °C près (hors hors-gel).</p>`
    : '';
  return `<section class="kpis" aria-label="Chiffres clés">${tiles.join('')}</section>${note}`;
}

// ------------------------------------------------------------------ temperature chart
function drawTemp(el: HTMLElement, name: string, m: ReturnType<typeof measured>, sp: Map<string, [number, number | null]> | undefined, days: string[], thr: number) {
  const meas = days.map((d) => {
    const v = m.days.get(d);
    return v === null || v === undefined ? null : Math.round(v * 10) / 10;
  });
  const req = days.map((d) => sp?.get(d)?.[1] ?? null);
  const cold = meas.map((v) => (v !== null && v < thr ? v : null));
  const n = cold.filter((v) => v !== null).length;
  const axis = tempAxis([...meas, ...req]);
  el.setAttribute('aria-label', `${name}, ${PERIOD['30d'].toLowerCase()} : ${n ? `${plural(n, 'jour')} sous ${fmt1(thr)} °C` : `aucun jour sous ${fmt1(thr)} °C`}`);
  const labels = days.map((d) => dayShort(d));
  lineChart(el, {
    labels,
    series: [
      { name: `Mesurée (${sourceLabel(m.source)})`, color: cssVar('--series-measure'), data: meas },
      { name: 'Demandée (consigne)', color: cssVar('--accent'), data: req },
    ],
    price: null,
    unit: '°C',
    scale: true,
    endLabels: false,
  });
  // points visible, requested temperature dashed, cold days marked, axis around the data (never 0)
  chartOf(el).setOption({
    legend: { show: false },
    yAxis: axis ? { min: axis.min, max: axis.max } : {},
    series: [
      { showSymbol: true, symbolSize: 6 },
      { lineStyle: { type: 'dashed' } },
      {
        type: 'scatter',
        name: `Jour sous ${fmt1(thr)} °C`,
        data: cold,
        symbolSize: 11,
        itemStyle: { color: cssVar('--state-warn'), borderColor: cssVar('--surface-card'), borderWidth: 2 },
        z: 5,
        tooltip: { show: false },
      },
    ],
  });
}

// ------------------------------------------------------------------ « Pourquoi il a fait froid »
function coldCard(
  m: ReturnType<typeof measured>,
  sp: Map<string, [number, number | null]> | undefined,
  ids: string[],
  group: boolean,
  rs: RoomState | null | undefined,
  r30: Room30 | null | undefined,
  from30: string,
  last: string,
  thr: number,
  days: string[],
): string {
  const head = (sub: string) => `<div class="card-head"><h2>Pourquoi il a fait froid</h2></div><p class="card-sub">${esc(sub)}</p>`;
  const rows = days.map((d) => ({ day: d, temp: m.days.get(d) ?? null, setpoint: sp?.get(d)?.[1] ?? null }));
  const n = rows.filter((r) => r.temp !== null && r.temp < thr).length;
  const sub = `${n ? `${plural(n, 'jour')} sous ${fmt1(thr)} °C` : `aucun jour sous ${fmt1(thr)} °C`} · ${PERIOD['30d'].toLowerCase()}`;
  if (!n) return `<section class="card" id="froid">${head(sub)}<p>La pièce n’a pas eu de journée froide : sa température moyenne est restée au-dessus de ${esc(fmt1(thr))} °C chaque jour relevé.</p></section>`;
  if (rs === undefined || r30 === undefined) return `<section class="card" id="froid" aria-busy="true">${head(sub)}<p class="hint muted" role="status">Chargement de l’état des radiateurs…</p></section>`;
  const drops = r30 ? tempDrops(new Map(ids.filter((i) => r30.has(i)).map((i) => [i, r30.get(i)!])), from30, last) : null;
  const dropOf = (d: string) => {
    for (const i of ids) {
      const x = drops?.get(i)?.get(d);
      if (x) return x;
    }
    return undefined;
  };
  const list: ColdDay[] = coldDays(rows, thr, rs ? cellsOf(rs, ids) : () => null, dropOf);
  const shown = list.slice(0, 10);
  const items = shown.map((c) => {
    const reasons = c.reasons.filter((r) => rs || r.kind !== 'nodata');
    const text = reasons.length ? reasons.map((r) => reasonText(r, thr)).join(' ; ') : 'état des radiateurs non relevé';
    return `<li><b>${esc(dayLong(c.day, false))}</b> (${esc(fmt1(c.temp))} °C) : ${esc(text)}${group && reasons.some((r) => r.kind !== 'none') ? ' <small class="muted">(une des chambres)</small>' : ''}.</li>`;
  });
  return `<section class="card" id="froid">${head(sub)}
    <ul class="cold-days">${items.join('')}</ul>
    ${list.length > shown.length ? `<p class="hint muted">Et ${plural(list.length - shown.length, 'autre jour')} plus ancien${list.length - shown.length > 1 ? 's' : ''}.</p>` : ''}
    ${rs ? '' : '<p class="hint muted">L’état des radiateurs (fenêtre, délestage, mode) n’est pas relevé pour ce logement : seules la température demandée et les chutes brusques de température sont lues.</p>'}
    ${howDetails(
      'Comment c’est calculé',
      `<p class="hint">Un jour est froid quand sa température moyenne (${esc(sourceLabel(m.source))}) est sous le seuil de ${esc(fmt1(thr))} °C, réglable dans ⚙ Paramètres → Objectifs et alertes. Pour chacun, l’application regarde l’état des radiateurs relevé chaque heure (fenêtre ouverte, délestage, mode absence ou hors-gel), la température demandée ce jour-là, et les chutes brusques de la température de la demi-heure (au moins 1,5 °C en une heure sans baisse de la consigne).</p>`,
    )}
  </section>`;
}

// ------------------------------------------------------------------ consumption over 12 months
function consoCard(cat: string, mine: DayRecord[], yearStart: string, last: string): string {
  const kwh = total(mine, yearStart, last);
  const before = total(mine, minusYears(yearStart), minusYears(last));
  const y = Number(last.slice(0, 4));
  return `<section class="card">
    <div class="card-head"><h2>Consommation</h2></div>
    <p class="card-sub">${esc(`${PERIOD['12m']} · kWh par mois, comparé aux mêmes mois un an plus tôt`)}</p>
    <p><b>${esc(fmtKwh(kwh))}</b> en ${y} au ${esc(dayShort(last))}${before > 0 ? `, contre ${esc(fmtKwh(before))} en ${y - 1} à la même date` : ''}.</p>
    <div class="chart" id="room-detail" role="img" aria-label="${esc(cat === 'water_heater' ? 'Chauffe-eau' : 'Chauffage de la pièce')}, kWh par mois"></div>
  </section>`;
}

function drawConso(el: HTMLElement, cat: string, mine: DayRecord[], last: string) {
  // the 12 months ending with the month of the last day
  const keys = bucketKeys(addDays(last, -400), last, 'month').slice(-12);
  const per = new Map<string, number>();
  for (const r of mine) per.set(r.day.slice(0, 7), (per.get(r.day.slice(0, 7)) ?? 0) + r.kwh);
  const prevKey = (k: string) => `${Number(k.slice(0, 4)) - 1}${k.slice(4)}`;
  const first = mine.reduce((a, r) => (r.day < a ? r.day : a), last);
  const marks = bucketMarks(keys, 'month', first, last);
  const labels = keys.map((k, i) => (i === 0 || k.endsWith('-01') ? bucketLabel(k, 'month') : bucketLabel(k, 'month').split(' ')[0]));
  const val = (k: string) => (per.has(k) ? Math.round(per.get(k)!) : null);
  barChart(el, {
    labels,
    series: [
      {
        name: '12 derniers mois',
        color: cssVar(cat === 'water_heater' ? '--usage-water' : '--usage-heating'),
        data: keys.map(val),
        raw: keys.map((k) => per.get(k) ?? null),
        notes: marks.map((x) => x.note),
        marks: marks.map((x) => x.partial),
      },
      { name: 'Un an plus tôt', color: cssVar('--usage-other'), data: keys.map((k) => val(prevKey(k))), lastYear: true },
    ],
    stacked: false,
    price: avgPrice(),
  });
}

// ------------------------------------------------------------------ air
function airCard(id: string, name: string, from30: string, last: string): string {
  const st = ds!.station;
  if (!st) return '';
  const k = stationKey(id);
  const head = '<div class="card-head"><h2>Air</h2></div>';
  if (!k)
    return `<section class="card" id="piece-air">${head}<p class="hint muted">Aucun module de la station n’est lié à cette pièce : liez-en un dans <a href="#confort">Air et confort</a> pour le CO₂ des nuits et l’humidité.</p></section>`;
  const mod = st.modules[k]?.name ?? '';
  const foot = `<p class="hint muted">Module « ${esc(mod)} » de la station · <a href="#confort">changer le module lié</a></p>`;
  if (isBedroom(name) && !airShown)
    return `<section class="card" id="piece-air">${head}<p class="hint muted">Le CO₂ et l’humidité des chambres sont masqués par défaut, par respect pour leurs occupants. Ils restent affichés jusqu’au prochain verrouillage.</p>
      <button type="button" class="btn secondary" data-piece="show-air">Afficher l’air de cette pièce</button>${foot}</section>`;
  const nightly = st.nightly?.[k];
  const lastNight = nightly ? lastNightDay(nightly) : null;
  const verdict = nightly && lastNight ? nightVerdict(summarizeNights(lastNights(nightly, lastNight, 30))) : null;
  const hum = meanIn(Object.entries(st.daily[k] ?? {}).map(([d, v]) => [d, v[3]]), from30, last);
  return `<section class="card" id="piece-air">${head}
    <p class="card-sub">${esc(`CO₂ : 30 dernières nuits (22 h → 7 h) · humidité : ${PERIOD['30d'].toLowerCase()}`)}</p>
    ${verdict ? `<p>CO₂ la nuit : ${esc(verdict.text)}</p>` : '<p class="hint muted">Pas encore de nuit relevée pour le CO₂.</p>'}
    ${hum ? `<p>Humidité moyenne : <b>${nf0.format(hum.mean)} %</b>${hum.mean > 65 ? ' (élevée : aérer, surveiller la condensation)' : hum.mean < 35 ? ' (air sec)' : ''}.</p>` : ''}
    ${foot}
  </section>`;
}

// ------------------------------------------------------------------ radiator
function radiatorCard(id: string, ids: string[], rs: RoomState | null | undefined, from30: string, last: string): string {
  const rows: string[] = [];
  if (rs) {
    const open = sumState(rs, ids, from30, last, (c) => c.open_window_h);
    if (open !== null) rows.push(listRow({ title: 'Fenêtre ouverte', sub: PERIOD['30d'], value: h1(open) }));
    const shed = sumState(rs, ids, addDays(last, -364), last, (c) => c.offload_h);
    if (shed !== null) rows.push(listRow({ title: 'Délestage (radiateur coupé)', sub: PERIOD['12m'], value: h1(shed) }));
  } else if (rs === undefined) rows.push('<li><div class="row"><span></span><span class="s" role="status">Chargement de l’état des radiateurs…</span><span></span><span></span></div></li>');
  const k = stationKey(id);
  const st = ds!.station;
  if (k && st) {
    const o = offsetStats(ds!.temps.get(id), st.daily[k], addDays(last, -364), last);
    if (o) {
      const v = o.recent && o.recent.n >= 7 ? o.recent : { mean: o.mean, n: o.n };
      rows.push(listRow({ title: 'Sonde du radiateur − station', sub: o.recent && o.recent.n >= 7 ? PERIOD['30d'] : 'jours de chauffe, 12 mois', value: `${signed(v.mean)} °C` }));
    }
  }
  rows.push(`<li id="piece-surface"><div class="row"><span></span><span><span class="t">Surface</span><span class="s" role="status">…</span></span><span></span><span></span></div></li>`);
  return `<section class="card" id="piece-radiator"><div class="card-head"><h2>Radiateur</h2></div><ul class="list">${rows.join('')}</ul></section>`;
}

// ------------------------------------------------------------------ events
export function handleClick(el: HTMLElement): boolean {
  if (el.dataset.piece !== 'show-air') return false;
  airShown = true;
  rerender();
  return true;
}
