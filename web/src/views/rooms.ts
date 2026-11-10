// Rooms ("Pièces"): consumption per room, year-over-year waterfall and per-room detail.
import { CATEGORY_LABEL, type DayRecord, minusYears, pctChange, totalsBy } from '../aggregate';
import { roomDeltas } from '../analysis';
import { ds, setState, state } from '../app';
import { cssVar, hbarChart } from '../charts';
import { uncertainDays } from '../checks';
import { cutDays } from './quality';
import { effectiveMapping } from '../comfort';
import { type YoyWindow, shortDate, windowSuffix, yoyCaveat, yoyWindow } from '../periods';
import { homePeriod, homeRange, scopeTitle } from '../home';
import { countedNote } from '../components';
import {
  activeRooms,
  avgPrice,
  drawWaterfall,
  esc,
  fmt1,
  firstDay,
  lastDay,
  longDate,
  nf0,
  pct,
  roomColor,
  table,
} from '../ui';
import { html } from '../trusted';
import { offlineText } from '../room-offline';
import { offlineRun } from './offline-rooms';

/**
 * #308: « list » (Pièces, under the list by cost of #313: this year against the last one, room
 * by room, each opening its page) or « changes » (Historique: what changed, room by room).
 * The page of one room is views/piece.ts.
 */
export function renderRooms(view: HTMLElement, records: DayRecord[], part: 'list' | 'changes' = 'list') {
  const years = ds!.meta.years;
  const year = state.roomsYear ?? years[years.length - 1];
  const last = lastDay();
  const isCurrent = year === Number(last.slice(0, 4));
  const end = isCurrent ? last : `${year}-12-31`;
  // #297: year over year on the same window (to date; from the first data day when N-1 started late)
  const first = records.reduce((a, r) => (r.day < a ? r.day : a), records[0]?.day ?? firstDay());
  const uncertain = uncertainDays(records, ds!.estimated, first, last);
  const win = yoyWindow(year, first, last);
  const suffix = windowSuffix(win);
  const hasTemps = activeRooms().some((r) => ds!.temps.has(r.id));
  const thr = state.comfortThreshold;
  const thrLabel = `${thr.toString().replace('.', ',')}\u00a0°C`;

  // #388: on Pièces, the period of the page (Mois · Saison · 12 mois · Année) against the same
  // days a year earlier, no year of its own; temperatures and cold days over the same days.
  const r = homeRange(homePeriod(state.pieces), last);
  const pwin = rangeWindow(r.from, r.to, first);
  const pNow = totalsBy(records, r.from, r.to, (x) => x.room);
  const pCmp = pwin ? totalsBy(records, pwin.from, pwin.to, (x) => x.room) : pNow;
  const pBefore = pwin ? totalsBy(records, pwin.prevFrom, pwin.prevTo, (x) => x.room) : new Map<string, number>();
  const pSum = [...pNow.values()].reduce((a, b) => a + b, 0);
  const pCaveat = yoyCaveat(pwin, uncertain, { toDate: false, cuts: cutDays() });
  const pRooms = activeRooms().filter((x) => pNow.has(x.id) || pBefore.has(x.id));
  const pSorted = pRooms.slice().sort((a, b) => (pNow.get(b.id) ?? 0) - (pNow.get(a.id) ?? 0));
  const listCard = () => `
  <section class="card">
    <div class="card-head">
      <h2>Par pièce, comparé à l'an dernier <small class="muted">kWh</small></h2>
    </div>
    ${countedNote(`${esc(scopeTitle(r))}, comparé aux mêmes jours un an plus tôt${pwin?.cut ? ` (du ${esc(shortDate(pwin.from))} au ${esc(shortDate(pwin.to))} : la collecte a commencé le ${esc(longDate(first))})` : ''}`)}
    <p class="hint muted">${!pwin ? 'Pas de relevé un an plus tôt : pas de comparaison. ' : ''}${
      pCaveat.includes('jour') ? `<strong>Attention</strong> : ${esc(pCaveat.split(' · ').filter((c) => c.includes('jour')).join(', '))}, l'évolution en est faussée. ` : ''
    }Touchez une pièce pour ouvrir sa page.</p>
    <div class="chart" id="rooms-chart" style="height:${Math.max(220, pSorted.length * 52 + 40)}px" role="img" aria-label="Consommation par pièce"></div>
    ${table(
      [
        'Pièce',
        'kWh',
        'Part',
        'Un an plus tôt',
        'Évolution',
        ...(hasTemps ? ['Température moyenne mesurée', 'Température demandée aux radiateurs (consigne), moyenne', `Jours à moyenne sous ${thrLabel}`] : []),
      ],
      pSorted.map((x) => {
        const v = pNow.get(x.id) ?? 0;
        const b = pBefore.get(x.id) ?? 0;
        // #346: a room offline over either window is not « en baisse », it is not measured
        const run = pwin ? offlineRun(x.id, pwin.prevFrom, pwin.to) : null;
        const d = pwin && !run ? pctChange(pCmp.get(x.id) ?? 0, b) : null;
        const tm = rangeTemps(x.id, r.from, r.to);
        const cold = x.category === 'heating' ? coldDays(x.id, r.from, r.to, thr) : null;
        return [
          // #413: the name wraps and its category goes under it, never cut by the table (« Cha… »)
          `<span class="cell-name"><a class="link" href="#piece-${esc(encodeURIComponent(x.id))}" data-room-link="${esc(x.id)}"><span class="swatch" style="background:${roomColor(x.id)}"></span>${esc(x.name)}</a> <small class="muted">${CATEGORY_LABEL[x.category]}</small></span>`,
          v,
          pSum ? `${nf0.format((v / pSum) * 100)}\u00a0%` : '—',
          b,
          run ? `<small>${esc(offlineText(run))}</small>` : d === null ? '—' : pct(d),
          ...(hasTemps
            ? [
                tm ? `${fmt1(tm[0])}\u00a0°C` : '—',
                tm?.[1] != null ? `${fmt1(tm[1])}\u00a0°C` : '—',
                cold ? `${cold.under} j sur ${cold.n} <small class="muted">${cold.source === 'station' ? 'station' : 'radiateur'}</small>` : '—',
              ]
            : []),
        ];
      }),
    )}
    ${hasTemps ? `<p class="hint muted">Températures et jours froids : mêmes jours que les kWh. Jours à moyenne sous ${thrLabel} : jours relevés dont la température moyenne est sous le seuil ; mesurée par la station Netatmo quand la pièce y est liée (« station »), sinon par la sonde du radiateur. Seuil dans ⚙ Paramètres → Objectifs et alertes, heures détaillées dans Air et confort.</p>` : ''}
  </section>`;
  // #346: the rooms offline over either window are left out of « Qu'est-ce qui a changé ? »
  const cFrom = win?.from ?? `${year}-01-01`;
  const cTo = win?.to ?? end;
  const offRooms = activeRooms().filter((r) => offlineRun(r.id, minusYears(cFrom), cTo) && !offlineRun(r.id, minusYears(cFrom), cTo)!.stopped);
  const stoveRooms = activeRooms().filter((r) => offlineRun(r.id, minusYears(cFrom), cTo)?.stopped);
  const offNote = offRooms.length
    ? ` Sans ${esc(offRooms.map((r) => r.name).join(', '))} (${esc(offRooms.map((r) => offlineText(offlineRun(r.id, minusYears(cFrom), cTo)!)).join(' ; '))}) : ${offRooms.length > 1 ? 'elles ne sont' : 'elle n’est'} pas mesurée${offRooms.length > 1 ? 's' : ''} sur toute la période.`
    : '';
  const stoveNote = stoveRooms.length
    ? ` ${esc(stoveRooms.map((r) => `${r.name} : ${offlineText(offlineRun(r.id, minusYears(cFrom), cTo)!)}`).join(' ; '))}, sa baisse vient du changement de mode de chauffage.`
    : '';
  const changesCard = () => `
  <section class="card">
    <h2>Qu'est-ce qui a changé ? <small class="muted">${year - 1} → ${year}${suffix}</small></h2>
    <p class="hint muted">Chaque barre montre de combien une pièce a fait monter (rouge) ou baisser (vert) le total.${offNote}${stoveNote}</p>
    <div class="chart" id="rooms-waterfall" role="img" aria-label="Évolution par pièce"></div>
  </section>`;
  view.innerHTML = html(part === 'list' ? listCard() : changesCard());

  if (part === 'changes') {
    const deltas = roomDeltas(records, cFrom, cTo);
    for (const r of offRooms) deltas.delete(r.id);
    drawWaterfall(document.getElementById('rooms-waterfall')!, deltas, year, suffix);
    return;
  }
  hbarChart(document.getElementById('rooms-chart')!, {
    labels: pSorted.map((x) => x.name),
    series: [
      {
        name: 'Période',
        color: cssVar('--text-muted'),
        data: pSorted.map((x) => Math.round(pNow.get(x.id) ?? 0)),
        colors: pSorted.map((x) => roomColor(x.id)),
      },
      { name: 'Un an plus tôt', color: cssVar('--usage-other'), data: pSorted.map((x) => Math.round(pBefore.get(x.id) ?? 0)) },
    ],
    price: avgPrice(),
    onClick: (i) => (location.hash = `#piece-${encodeURIComponent(pSorted[i].id)}`),
  });
}

/**
 * #388: the window of « a year earlier » for [from, to]: the same days, starting one year after
 * the first day of data when the collection began within the year before (null: nothing to compare).
 */
export function rangeWindow(from: string, to: string, first: string): YoyWindow | null {
  const prevFrom = minusYears(from);
  let start = from;
  if (first > prevFrom) {
    const next = `${Number(first.slice(0, 4)) + 1}${first.slice(4)}`;
    start = next.endsWith('-02-29') ? `${next.slice(0, 4)}-03-01` : next;
  }
  if (start > to) return null;
  const cut = start !== from;
  return { from: start, to, prevFrom: minusYears(start), prevTo: minusYears(to), cut, label: cut ? `du ${shortDate(start)} au ${shortDate(to)}` : null };
}

/** Average measured temperature and setpoint of a room over [from, to] (#388). */
function rangeTemps(room: string, from: string, to: string): [number, number | null] | null {
  const t = ds!.temps.get(room);
  if (!t) return null;
  let s = 0, sp = 0, n = 0, nsp = 0;
  for (const [d, [m, c]] of t) {
    if (d < from || d > to) continue;
    (s += m), n++;
    if (c !== null) (sp += c), nsp++;
  }
  return n ? [s / n, nsp ? sp / nsp : null] : null;
}

/** S-11.3, #388: days of [from, to] whose mean is below `thr`, station if linked (same rule as Confort). */
function coldDays(room: string, from: string, to: string, thr: number): { under: number; n: number; source: 'station' | 'radiator' } | null {
  const st = ds!.station;
  const heating = activeRooms().filter((r) => r.category === 'heating');
  const k = st ? effectiveMapping(heating, st.modules, state.roomModuleMap).get(room) : undefined;
  const means: [string, number | null][] =
    k && st ? Object.entries(st.daily[k] ?? {}).map(([d, v]) => [d, v[2]]) : [...(ds!.temps.get(room) ?? [])].map(([d, v]) => [d, v[0]]);
  let under = 0;
  let n = 0;
  for (const [d, v] of means) {
    if (d < from || d > to || v === null) continue;
    n++;
    if (v < thr) under++;
  }
  return n ? { under, n, source: k ? 'station' : 'radiator' } : null;
}

// ------------------------------------------------------------------ events
/** Year selector. Returns true when the change belonged to this view. */
export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  if (t.dataset.set !== 'roomsYear') return false;
  setState({ roomsYear: Number(t.value) });
  return true;
}
