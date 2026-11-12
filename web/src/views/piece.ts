// #313: the Pièces list (by cost, comfort pill, the water heater apart) and the page of one room:
// « maintenant », planning of the day over the off-peak hours, cost and temperature tiles,
// temperature (measured vs requested, cold days marked), « Pourquoi il a fait froid »,
// consumption over 12 months, air (night CO₂) and radiator. Loaded on demand (pages.ts); the
// computations are in piece.ts. The household view (bedrooms grouped, opt-in) is a display
// matter: a group page reads its bedrooms' raw documents (room30, room states) without naming them.
import { type DayRecord, addDays, bucketKeys, bucketLabel, minusYears, pctChange, total } from '../aggregate';
import { activeRooms, datasetDoc, ds, onDatasetLoaded, rerender, setState, state } from '../app';
import { barChart, chartOf, cssVar, lineChart } from '../charts';
import { effectiveMapping, indoorModules, isBedroom, lastNightDay, lastNights, nightVerdict, offsetStats, signed, summarizeNights } from '../comfort';
import { alert, alertHtml, comparison, countedNote, gauge, howDetails, legend, listRow, periodBar, scheduleBand, seg, tile } from '../components';
import { type Dataset, loadRoom30, loadRoomState } from '../data';
import type { DatasetDoc } from '../loader';
import { BEDROOMS_ID } from '../household';
import { periodsFromR30, rangesOn, rangesText, toHours } from '../offpeak';
import { NO_REFERENCE, TEMP, dayLong, dayShort, fmt1, fmtTemp, hourMin, hourRange, plural, signedPct, vsLabel } from '../glossary';
import { GOAL_CHOICES, goalOf, goalProgress, goalSentence, validGoals, withGoal } from '../goal';
import { HOME_PERIODS, type HomeRange, homePeriod, homeRange, scopeTitle } from '../home';
import { daysBetween } from '../periods';
import { bucketMarks } from '../periods';
import {
  type ColdDay,
  byCost,
  coldDays,
  comfortPill,
  lastReading,
  meanIn,
  modeText,
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
import { lastReadingAfterStop, offlineText } from '../room-offline';
import { offlineEstimate, offlineLine, offlineRun } from './offline-rooms';
import { MATCH_DAYS, type ModuleMatch, declinedPairs, linkRoom, pairKey, trackingModules } from '../module-match';
import { roomPerM2Text } from '../isolation';
import { stoveRooms, woodDays, woodSettings } from './wood-state';
import { stoveWarm, stoveWarmText, woodSeasons } from '../wood';

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

/**
 * #388: one period for Pièces and for the page of a room, chosen like the Accueil's (Mois · Saison ·
 * 12 mois · Année) and said once at the top and under each card (« Compté : … »); « Maintenant »
 * is apart. The half hours are loaded for the last 40 days only: the time at the requested
 * temperature and the falls of temperature are said over the month, and only then.
 */
export const piecesRange = (last: string): HomeRange => homeRange(homePeriod(state.pieces), last);
const HALF_HOURS = 40;

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

const heatedRooms = () => activeRooms().filter((r) => r.category === 'heating');
/** Links in force: saved choices, else the suggestion by name (comfort.ts). */
function links(): Map<string, string> {
  const st = ds!.station;
  return st ? effectiveMapping(heatedRooms(), st.modules, state.roomModuleMap) : new Map();
}
/** Station module linked to a heated room (saved choice, or the suggestion by name). */
function stationKey(id: string): string | undefined {
  return links().get(id);
}

/**
 * #467: an unlinked indoor module that follows this room's radiator probe over the last
 * MATCH_DAYS days (module-match.ts), unless that pair was declined on this device.
 */
function proposedModule(id: string): ModuleMatch | undefined {
  const st = ds!.station;
  if (!st || !ds!.temps.has(id)) return undefined;
  const map = links();
  if (map.has(id)) return undefined;
  const linked = new Set(map.values());
  const rooms = heatedRooms()
    .map((r) => r.id)
    .filter((r) => !map.has(r) && ds!.temps.has(r));
  const modules = indoorModules(st.modules).filter((k) => !linked.has(k));
  const to = lastDay();
  const no = declinedPairs(state.moduleMatchNo);
  return trackingModules(ds!.temps, rooms, st.daily, modules, addDays(to, -(MATCH_DAYS - 1)), to).find(
    (m) => m.room === id && !no.has(pairKey(m.room, m.module)),
  );
}

function proposalAlert(m: ModuleMatch): string {
  const name = ds!.station!.modules[m.module]?.name ?? '';
  const data = `data-room="${esc(m.room)}" data-module="${esc(m.module)}"`;
  return alertHtml(
    'info',
    `<p>Le module «\u00a0${esc(name)}\u00a0» de la station suit la sonde du radiateur de cette pièce sur ${esc(plural(m.n, 'jour'))}, à ${esc(
      fmt1(Math.abs(m.offset)),
    )}\u00a0°C ${m.offset >= 0 ? 'au-dessus' : 'au-dessous'}. Lié à la pièce, il donne sa température à la place de la sonde, placée contre le radiateur.</p>
    <div class="controls"><button type="button" class="btn primary" data-piece="link-module" ${data}>Lier ce module à la pièce</button>
    <button type="button" class="btn secondary" data-piece="decline-module" ${data}>Ne pas lier</button></div>`,
    { id: 'piece-link' },
    'Lier ce module à la pièce ?',
  );
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
/** #388: share of the off-peak hours in the water heater's kWh over [from, to] (null: not split). */
function offPeakShare(room: string, from: string, to: string): number | undefined {
  const days = ds!.tariffs.get(room);
  if (!days) return undefined;
  const off = offCol();
  let o = 0;
  let t = 0;
  for (const [d, v] of days) if (d >= from && d <= to) (o += v[off]), (t += v[0] + v[1] + v[2]);
  return t > 0 ? o / t : undefined;
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
  const r = piecesRange(last);
  const { from, to } = r;
  const thr = state.comfortThreshold;
  const rs = doc(stateDoc, 'pieces');
  const rows = activeRooms().map((room) => {
    const mine = ds!.records.filter((x) => x.room === room.id);
    // #346: a room offline counts with its share estimated from the meter (« ≈ »), never 0 kWh
    // sorted on what was measured; the estimate is said under the name, never added in
    const run = offlineRun(room.id, from, to);
    const est = run ? (offlineEstimate(room.id, from, to) ?? 0) : 0;
    return { room, kwh: total(mine, from, to), eur: costOf(mine, from, to), run, est };
  });
  const value = (x: { kwh: number; eur: number | null; run: unknown }) => {
    if (x.run && !x.kwh) return '—'; // nothing measured: not « 0 kWh »
    return x.eur === null ? esc(fmtKwh(x.kwh)) : `${esc(fmtEur(x.eur))}<span class="s">${esc(fmtKwh(x.kwh))}</span>`;
  };
  const heated = byCost(rows.filter((x) => x.room.category === 'heating')).map((x) => {
    const m = measured(x.room.id);
    const t = meanIn(m.days, from, to);
    let cold = 0;
    for (const [d, v] of m.days) if (d >= from && d <= to && v !== null && v < thr) cold++;
    const open = rs ? sumState(rs, members(x.room.id), from, to, (c) => c.open_window_h) : null;
    const pill = comfortPill(cold, open, thr);
    const sub = x.run
      ? `<span class="pill${x.run.stopped ? '' : ' warn'}">${esc(offlineText(x.run))}</span>${x.est ? ` · ≈ ${esc(fmtKwh(x.est))} estimés` : ''}`
      : t
        ? `${fmt1(t.mean)}\u00a0°C · <span class="pill ${pill.level}">${esc(pill.text)}</span>`
        : '<span class="muted">pas de température relevée</span>';
    const tag = x.room.id === BEDROOMS_ID ? ' <span class="tag">regroupées</span>' : '';
    return `<li><a class="row" href="#piece-${esc(encodeURIComponent(x.room.id))}" data-room-link="${esc(x.room.id)}"><span class="swatch" style="background:${esc(roomColor(x.room.id))}" aria-hidden="true"></span><span><span class="t">${esc(x.room.name)}${tag}</span><span class="s">${sub}</span></span><span class="v">${value(x)}</span><span class="chev" aria-hidden="true">›</span></a></li>`;
  });
  const water = byCost(rows.filter((x) => x.room.category === 'water_heater')).map((x) => {
    const s = offPeakShare(x.room.id, from, to);
    const sub = s === undefined ? 'heures creuses, heures de chauffe' : `${nf0.format(s * 100)} % en heures creuses`;
    return `<li><a class="row" href="#chauffe-eau"><span class="swatch" style="background:var(--usage-water)" aria-hidden="true"></span><span><span class="t">${esc(x.room.name)}</span><span class="s">${esc(sub)}</span></span><span class="v">${value(x)}</span><span class="chev" aria-hidden="true">›</span></a></li>`;
  });
  view.innerHTML = html(`<h1 class="page-title" id="page-title" tabindex="-1">Pièces</h1>
  ${periodBar(seg('pieces', r.period, HOME_PERIODS, 'Période'), `${scopeTitle(r)} · coût, température et confort sur la période, trié par coût · froid : moyenne du jour sous ${fmtTemp(thr)}`)}
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
  const r = piecesRange(last);
  const { from, to } = r;
  const counted = countedNote(esc(scopeTitle(r)));
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
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);

  const parts: string[] = [];
  // #346: a room without reading says so first, with its estimate from the meter
  const run = offlineRun(id, minusYears(from), to);
  if (run?.stopped) {
    // switched off on purpose (⚙ Mon logement): expected, not a failure
    const st = run.stopped;
    const last = lastReadingAfterStop(run); // #461: in complement, after the day declared
    parts.push(
      alert(
        'info',
        `Radiateur ${offlineText(run)}`,
        '',
        `<p>${esc(`${st.label ? `${st.label.charAt(0).toUpperCase()}${st.label.slice(1)}. ` : ''}${last ? `Dernière donnée reçue le ${dayShort(last, true)}. ` : ''}Pas de données attendues : la baisse de sa consommation électrique vient du changement de mode de chauffage, pas de vos réglages.`)} <a class="link" href="#parametres-logement">Réglage</a></p>`,
      ),
    );
  } else if (run) {
    const line = offlineLine(id, from, to);
    parts.push(
      alert(
        run.ongoing ? 'warn' : 'info',
        `${room.name} : ${offlineText(run)}`,
        `${run.ongoing ? 'Le module n’envoie plus rien : les jours sans relevé ne sont pas à 0 kWh, ils manquent. ' : 'Les jours sans relevé manquent (ils ne sont pas à 0 kWh). '}${
          line.includes('estimés') ? `Sur la période, ${line.split(' · ')[1]}. ` : ''
        }Les comparaisons avec l’an dernier ne comptent pas cette pièce.${run.ongoing ? ' Hors ligne, le radiateur ne reçoit plus le planning ni le mode absence : vérifier son alimentation, le redémarrer, puis l’associer de nouveau dans l’application Intuis.' : ''}`,
      ),
    );
  }
  // #468: the stove's room kept above 22 °C, and the wood it costs (assumptions said in the text)
  if (heating && !group && stoveRooms().some((s) => (ds!.roomMap?.get(s) ?? s) === id)) {
    const warm = stoveWarm(m.days, woodDays(), woodSeasons(woodSettings()), last);
    if (warm) {
      const t = stoveWarmText(warm);
      parts.push(alertHtml('info', `<p>${esc(t.text)}</p>`, { id: 'stove-warm' }, t.title));
    }
  }
  const proposal = heating && !group ? proposedModule(id) : undefined;
  if (proposal) parts.push(proposalAlert(proposal));
  if (heating) parts.push(nowCard(room.name, ids, group, m, r30, rs, last));
  // #152: a goal at equal climate, over the heating season (apart from the period below, as « Maintenant »)
  if (heating) parts.push(goalCard(id, mine, last));
  // #388: one period for everything below « Maintenant »
  parts.push(periodBar(seg('pieces', r.period, HOME_PERIODS, 'Période'), scopeTitle(r)));
  parts.push(tilesRow(mine, m, r30, ids, r, heating));
  if (heating && [...m.days].some(([d, v]) => d >= from && d <= to && v !== null)) {
    parts.push(`<section class="card" id="piece-temp">
      <div class="card-head"><h2>Température</h2></div>
      ${counted}
      <p class="card-sub">Moyenne par jour, °C.</p>
      ${legend([
        { label: `Mesurée (${sourceLabel(m.source)})`, color: '--series-measure' },
        { label: TEMP.setpointShort, color: '--series-reference', kind: 'line' }, // decision of the owner (v1.7): a reference, not an action
        { label: `Jour sous ${fmt1(thr)}\u00a0°C`, color: '--state-warn' },
      ])}
      <div class="chart" id="piece-temp-chart" role="img" aria-label="${esc(room.name)} : température mesurée et ${esc(TEMP.setpoint)}, par jour"></div>
    </section>`);
    parts.push(coldCard(m, setpoints, ids, group, rs, r30, r, thr, days));
  }
  if (!state.simple) {
    parts.push(consoCard(room.category, mine, r));
    if (heating) parts.push(airCard(id, room.name, r));
    if (heating) parts.push(radiatorCard(id, ids, rs, r));
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
  if (consoEl) drawConso(consoEl, room.category, mine, r);
  if (document.getElementById('piece-surface')) {
    void lazyCard(
      () => import('./works'),
      async (w) => {
        const works = await w.loadWorks();
        const { displaySurfaces } = await import('../household');
        const m2 = displaySurfaces(ds!, works.surfaces)[id];
        const el = document.getElementById('piece-surface');
        if (!el) return;
        const kwh = total(mine, from, to);
        // #460: the stove's room has no electricity: « chauffée au bois », never 0 kWh/m²
        const stove = stoveRooms().some((r) => (ds!.roomMap?.get(r) ?? r) === id);
        el.outerHTML = html(
          m2
            ? listRow({ title: 'Surface · kWh par m²', sub: 'sur la période', value: `${fmt1(m2).replace(/,0$/, '')} m² · ${roomPerM2Text(kwh, m2, stove, (v) => nf0.format(v)).replace(' kWh/m²', '\u00a0kWh/m²')}` })
            : listRow({ title: 'Surface', sub: 'à saisir dans ⚙ Mon logement, pour les kWh par m²', href: '#parametres-logement' }),
        );
      },
      { zone: 'piece-surface', what: 'Surface' },
    );
  }
}

// ------------------------------------------------------------------ #152: a goal at equal climate
/** « Mon défi » of a heated room: a goal of kWh per degree day against last winter, and the way to it. */
function goalCard(id: string, mine: DayRecord[], last: string): string {
  const goal = goalOf(validGoals(state.roomGoals), id);
  const options: [string, string][] = [['', 'Aucun'], ...GOAL_CHOICES.map((g): [string, string] => [String(g), signedPct(-g)])];
  const choices = seg('goal', goal === null ? '' : String(goal), options, 'Objectif face à l’hiver dernier', (v) => ({ 'data-piece': 'goal', 'data-room': id, 'data-goal': v }));
  const head = '<div class="card-head"><h2>Mon défi</h2></div><p class="card-sub">Chauffer moins par degré de froid que l’hiver dernier : un hiver plus froid ne compte pas contre vous.</p>';
  const counted = countedNote('chauffage de la pièce par degré-jour, saison de chauffe en cours face aux mêmes jours de l’hiver dernier');
  if (goal === null) return `<section class="card" id="piece-goal">${head}${choices}${counted}</section>`;
  const w = ds!.weather;
  const p = w ? goalProgress(mine, id, w, last, goal) : null;
  if (!p) {
    const why = w ? 'Pas encore assez de froid cette saison, ou pas de chauffage relevé l’hiver dernier : la progression viendra avec les jours froids.' : 'Disponible dès que la collecte a récupéré la météo.';
    return `<section class="card" id="piece-goal">${head}${choices}<p class="hint muted">${esc(why)}</p>${counted}</section>`;
  }
  const done = Math.min(1, p.share);
  return `<section class="card" id="piece-goal">${head}${choices}
    <p id="goal-progress"><strong>${esc(goalSentence(p))}</strong></p>
    ${gauge({ label: `${Math.round(done * 100)} % de l’objectif de ${signedPct(-goal)}`, value: done, max: 1, scale: ['0', signedPct(-goal)] })}
    ${countedNote(esc(`chauffage de la pièce par degré-jour, du ${dayShort(p.from, true)} au ${dayShort(p.to, true)}, face aux mêmes jours un an plus tôt (${plural(p.days, 'jour')} avec la température dehors les deux années)`))}
  </section>`;
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
    return hi - lo < 0.05 ? `${fmt1(lo)}\u00a0°C` : `${fmt1(lo)} à ${fmt1(hi)}\u00a0°C`;
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
      // #428: the shared reading; #441: dated, the ranges in force on the day of the band
      const off = rangesOn(periodsFromR30(r30!, addDays(day, -27), day) ?? [], day);
      const comfort = sched.slots.filter((s) => s.kind === 'comfort').map((s) => hourRange(s.from, s.to));
      const now = reading.slot / 2 + 0.25;
      band = `<p class="section-title">Planning du ${esc(dayShort(day))}</p>${scheduleBand({
        slots: sched.slots,
        offPeak: toHours(off),
        now,
        label: `Planning du ${dayLong(day, false)} : confort (${fmt1(sched.comfort)}\u00a0°C) ${comfort.join(', ')}, économie (${fmt1(sched.eco)}\u00a0°C) le reste du temps${
          off.length ? ` ; heures creuses ${rangesText(off)}` : ''
        } ; trait : dernier relevé`,
      })}${legend([
        { label: `Confort ${fmt1(sched.comfort)}\u00a0°C`, color: '--usage-heating' },
        { label: `Économie ${fmt1(sched.eco)}\u00a0°C`, color: '--usage-other' },
        ...(off.length ? [{ label: 'Heures creuses', color: '--tariff-offpeak', kind: 'hatch' as const }] : []),
      ])}<p class="hint muted">Lu dans les températures demandées de la journée, demi-heure par demi-heure.</p>`;
    }
  } else {
    // no half hours: the daily mean of the last day
    const v = m.days.get(last) ?? null;
    temp = v;
    when = `moyenne du ${dayShort(last)} (${sourceLabel(m.source)})`;
    const sp = ds!.temps.get(ids.length === 1 ? ids[0] : (group ? BEDROOMS_ID : ids[0]))?.get(last)?.[1];
    if (sp !== null && sp !== undefined) facts.push([TEMP.setpointShort, `${fmt1(sp)}\u00a0°C (moyenne du jour)`]);
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
  r: HomeRange,
  heating: boolean,
): string {
  const { from, to } = r;
  const kwh = total(mine, from, to);
  const eur = costOf(mine, from, to);
  const pFrom = minusYears(from);
  const pTo = minusYears(to);
  const before = total(mine, pFrom, pTo);
  const eurBefore = before > 0 ? costOf(mine, pFrom, pTo) : null;
  // #346: offline this year or the last one: measured days only, not compared
  const run = offlineRun(mine[0]?.room ?? ids[0], pFrom, to);
  const delta = !run && before > 0 ? (eur !== null && eurBefore ? pctChange(eur, eurBefore) : pctChange(kwh, before)) : null;
  const tiles = [
    tile({
      label: `${eur === null ? 'Consommation' : 'Coût'}${run ? ', jours mesurés' : ''}`,
      value: eur === null ? fmtKwh(kwh) : fmtEur(eur),
      sub: `${eur === null ? '' : `${esc(fmtKwh(kwh))} · `}${comparison(delta, vsLabel(from, to), { none: run ? `${offlineText(run)} : ${run.stopped ? 'changement de mode de chauffage' : 'non comparé'}` : NO_REFERENCE })}`,
      id: 'piece-cost',
    }),
  ];
  if (heating) {
    const t = meanIn(m.days, from, to);
    const sp = meanIn([...(ds!.temps.get(ids.length === 1 ? ids[0] : BEDROOMS_ID) ?? [])].map(([d, v]) => [d, v[1]]), from, to);
    if (t)
      tiles.push(
        tile({
          label: 'Température moyenne',
          value: `${fmt1(t.mean)}\u00a0°C`,
          sub: esc(`${sourceLabel(m.source)}${sp ? ` · demandée ${fmtTemp(sp.mean)}` : ''}`),
          id: 'piece-mean',
        }),
      );
    // the half hours cover the last 40 days: said over the month only (#388)
    const at = r30 && daysBetween(from, to) <= HALF_HOURS ? timeAtSetpoint(r30, ids, from, to) : null;
    if (at)
      tiles.push(
        tile({
          label: 'Temps à la consigne',
          value: `${nf0.format(at.share * 100)}\u00a0%`,
          sub: 'part des heures',
          id: 'piece-at-setpoint',
        }),
      );
  }
  const note = tiles.some((t) => t.includes('piece-at-setpoint'))
    ? `<p class="hint muted" id="piece-at-setpoint-def">Temps à la consigne : part des heures où la pièce était à la température demandée aux radiateurs, à 0,5 °C près, sans compter les heures en hors-gel.</p>`
    : heating && r30 && daysBetween(from, to) > HALF_HOURS
      ? '<p class="hint muted">Temps à la consigne : sur la période « Mois » seulement (relevés à la demi-heure des 40 derniers jours).</p>'
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
  el.setAttribute('aria-label', `${name}, ${days.length > 1 ? `du ${dayShort(days[0])} au ${dayShort(days[days.length - 1])}` : dayShort(days[0] ?? '')} : ${n ? `${plural(n, 'jour')} sous ${fmt1(thr)}\u00a0°C` : `aucun jour sous ${fmt1(thr)}\u00a0°C`}`);
  const labels = days.map((d) => dayShort(d));
  lineChart(el, {
    labels,
    series: [
      { name: `Mesurée (${sourceLabel(m.source)})`, color: cssVar('--series-measure'), data: meas },
      { name: 'Demandée (consigne)', color: cssVar('--series-reference'), data: req, dashed: true },
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
        name: `Jour sous ${fmt1(thr)}\u00a0°C`,
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
  r: HomeRange,
  thr: number,
  days: string[],
): string {
  const head = (sub: string) => `<div class="card-head"><h2>Pourquoi il a fait froid</h2></div>${countedNote(esc(scopeTitle(r)))}<p class="card-sub">${esc(sub)}</p>`;
  const rows = days.map((d) => ({ day: d, temp: m.days.get(d) ?? null, setpoint: sp?.get(d)?.[1] ?? null }));
  const n = rows.filter((r) => r.temp !== null && r.temp < thr).length;
  const sub = n ? `${plural(n, 'jour')} sous ${fmtTemp(thr)}` : `aucun jour sous ${fmtTemp(thr)}`;
  if (!n) return `<section class="card" id="froid">${head(sub)}<p>La pièce n’a pas eu de journée froide : sa température moyenne est restée au-dessus de ${esc(fmt1(thr))}\u00a0°C chaque jour relevé.</p></section>`;
  if (rs === undefined || r30 === undefined) return `<section class="card" id="froid" aria-busy="true">${head(sub)}<p class="hint muted" role="status">Chargement de l’état des radiateurs…</p></section>`;
  const drops = r30 ? tempDrops(new Map(ids.filter((i) => r30.has(i)).map((i) => [i, r30.get(i)!])), r.from, r.to) : null;
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
    return `<li><b>${esc(dayLong(c.day, false))}</b> (${esc(fmt1(c.temp))}\u00a0°C) : ${esc(text)}${group && reasons.some((r) => r.kind !== 'none') ? ' <small class="muted">(une des chambres)</small>' : ''}.</li>`;
  });
  return `<section class="card" id="froid">${head(sub)}
    <ul class="cold-days">${items.join('')}</ul>
    ${list.length > shown.length ? `<p class="hint muted">Et ${plural(list.length - shown.length, 'autre jour')} plus ancien${list.length - shown.length > 1 ? 's' : ''}.</p>` : ''}
    ${rs ? '' : '<p class="hint muted">L’état des radiateurs (fenêtre, délestage, mode) n’est pas relevé pour ce logement : seules la température demandée et les chutes brusques de température sont lues.</p>'}
    ${howDetails(
      'Comment c’est calculé',
      `<p class="hint">Un jour est froid quand sa température moyenne (${esc(sourceLabel(m.source))}) est sous le seuil de ${esc(fmt1(thr))}\u00a0°C, réglable dans ⚙ Paramètres → Objectifs et alertes. Pour chacun, l’application regarde l’état des radiateurs relevé chaque heure (fenêtre ouverte, délestage, mode absence ou hors-gel), la température demandée ce jour-là, et les chutes brusques de la température de la demi-heure (au moins 1,5 °C en une heure sans baisse de la consigne).</p>`,
    )}
  </section>`;
}

// ------------------------------------------------------------------ consumption and cost (#388: over the period)
function consoCard(cat: string, mine: DayRecord[], r: HomeRange): string {
  const kwh = total(mine, r.from, r.to);
  const eur = costOf(mine, r.from, r.to);
  const before = total(mine, minusYears(r.from), minusYears(r.to));
  const eurBefore = before > 0 ? costOf(mine, minusYears(r.from), minusYears(r.to)) : null;
  const amount = (k: number, e: number | null) => (e === null ? esc(fmtKwh(k)) : `${esc(fmtEur(e))} (${esc(fmtKwh(k))})`);
  return `<section class="card" id="piece-conso">
    <div class="card-head"><h2>Consommation et coût</h2></div>
    ${countedNote(`${esc(scopeTitle(r))} ; le graphique : kWh par mois, ${esc(r.period === 'month' ? 'les 12 derniers mois' : 'les mois de la période')}, comparés aux mêmes mois un an plus tôt`)}
    <p><b>${amount(kwh, eur)}</b>${before > 0 ? `, contre ${amount(before, eurBefore)} un an plus tôt aux mêmes dates` : ''}.</p>
    <div class="chart" id="room-detail" role="img" aria-label="${esc(cat === 'water_heater' ? 'Chauffe-eau' : 'Chauffage de la pièce')}, kWh par mois"></div>
  </section>`;
}

function drawConso(el: HTMLElement, cat: string, mine: DayRecord[], r: HomeRange) {
  // the months of the period (the month in its 12 months of context, as on Accueil)
  const keys = bucketKeys(r.chartFrom, r.chartTo, 'month');
  const last = r.to;
  const per = new Map<string, number>();
  for (const x of mine) per.set(x.day.slice(0, 7), (per.get(x.day.slice(0, 7)) ?? 0) + x.kwh);
  const prevKey = (k: string) => `${Number(k.slice(0, 4)) - 1}${k.slice(4)}`;
  const first = mine.reduce((a, x) => (x.day < a ? x.day : a), last);
  const marks = bucketMarks(keys, 'month', first, last);
  const labels = keys.map((k, i) => (i === 0 || k.endsWith('-01') ? bucketLabel(k, 'month') : bucketLabel(k, 'month').split(' ')[0]));
  const val = (k: string) => (per.has(k) ? Math.round(per.get(k)!) : null);
  barChart(el, {
    labels,
    series: [
      {
        name: 'Période',
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
function airCard(id: string, name: string, r: HomeRange): string {
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
  // the nights of the period (22 h → 7 h), the last one at most the last night measured
  const end = lastNight && lastNight < r.to ? lastNight : r.to;
  const count = end >= r.from ? daysBetween(r.from, end) : 0;
  const verdict = nightly && lastNight && count > 0 ? nightVerdict(summarizeNights(lastNights(nightly, end, count))) : null;
  const hum = meanIn(Object.entries(st.daily[k] ?? {}).map(([d, v]) => [d, v[3]]), r.from, r.to);
  return `<section class="card" id="piece-air">${head}
    ${countedNote(`${esc(scopeTitle(r))} ; CO₂ des nuits, de 22 h à 7 h`)}
    ${verdict ? `<p>CO₂ la nuit : ${esc(verdict.text)}</p>` : '<p class="hint muted">Pas de nuit relevée pour le CO₂ sur la période.</p>'}
    ${hum ? `<p>Humidité moyenne : <b>${nf0.format(hum.mean)}\u00a0%</b>${hum.mean > 65 ? ' (élevée : aérer, surveiller la condensation)' : hum.mean < 35 ? ' (air sec)' : ''}.</p>` : ''}
    ${foot}
  </section>`;
}

// ------------------------------------------------------------------ radiator
function radiatorCard(id: string, ids: string[], rs: RoomState | null | undefined, r: HomeRange): string {
  const rows: string[] = [];
  if (rs) {
    const open = sumState(rs, ids, r.from, r.to, (c) => c.open_window_h);
    if (open !== null) rows.push(listRow({ title: 'Fenêtre ouverte', value: h1(open) }));
    const shed = sumState(rs, ids, r.from, r.to, (c) => c.offload_h);
    if (shed !== null) rows.push(listRow({ title: 'Délestage (radiateur coupé)', value: h1(shed) }));
  } else if (rs === undefined) rows.push('<li><div class="row"><span></span><span class="s" role="status">Chargement de l’état des radiateurs…</span><span></span><span></span></div></li>');
  const k = stationKey(id);
  const st = ds!.station;
  if (k && st) {
    const o = offsetStats(ds!.temps.get(id), st.daily[k], r.from, r.to);
    if (o) rows.push(listRow({ title: 'Sonde du radiateur − station', sub: `${plural(o.n, 'jour')} de chauffe`, value: `${signed(o.mean)}\u00a0°C` }));
  }
  rows.push(`<li id="piece-surface"><div class="row"><span></span><span><span class="t">Surface</span><span class="s" role="status">…</span></span><span></span><span></span></div></li>`);
  return `<section class="card" id="piece-radiator"><div class="card-head"><h2>Radiateur</h2></div>${countedNote(esc(scopeTitle(r)))}<ul class="list">${rows.join('')}</ul></section>`;
}

// ------------------------------------------------------------------ events
export function handleClick(el: HTMLElement): boolean {
  const { room, module } = el.dataset;
  if (el.dataset.piece === 'link-module' && room && module) {
    // #467: from now on the module's reading is the room's (measured(), effectiveMapping)
    setState({ roomModuleMap: linkRoom(links(), heatedRooms().map((r) => r.id), room, module) });
    return true;
  }
  if (el.dataset.piece === 'goal' && room) {
    const g = Number(el.dataset.goal);
    setState({ roomGoals: withGoal(validGoals(state.roomGoals), room, el.dataset.goal && Number.isInteger(g) ? g : null) });
    return true;
  }
  if (el.dataset.piece === 'decline-module' && room && module) {
    setState({ moduleMatchNo: [...declinedPairs(state.moduleMatchNo), pairKey(room, module)] });
    return true;
  }
  if (el.dataset.piece !== 'show-air') return false;
  airShown = true;
  rerender();
  return true;
}
