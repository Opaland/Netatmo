// Rooms ("Pièces"): consumption per room, year-over-year waterfall and per-room detail.
import { CATEGORY_LABEL, type DayRecord, minusYears, pctChange, totalsBy } from '../aggregate';
import { roomDeltas } from '../analysis';
import { ds, setState, state } from '../app';
import { cssVar, hbarChart } from '../charts';
import { uncertainDays } from '../checks';
import { cutDays } from './quality';
import { coldWinterDays, effectiveMapping, seasonOf as seasonOfWinter } from '../comfort';
import { windowSuffix, yoyCaveat, yoyWindow } from '../periods';
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
import { countedHtml } from './compare';

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
  const caveat = yoyCaveat(win, uncertain, { cuts: cutDays() });
  const suffix = windowSuffix(win);
  const now = totalsBy(records, `${year}-01-01`, end, (r) => r.room);
  const nowCmp = win ? totalsBy(records, win.from, win.to, (r) => r.room) : now;
  const before = win ? totalsBy(records, win.prevFrom, win.prevTo, (r) => r.room) : new Map<string, number>();
  const sum = [...now.values()].reduce((a, b) => a + b, 0);
  // #294: temperatures and cold days on the winter that ends in this year (Nov → Mar), as in Confort
  const winter = year - 1;
  const winterLabel = `hiver ${winter}–${year}`;
  const rooms = activeRooms().filter((r) => now.has(r.id) || before.has(r.id));
  const sorted = rooms.slice().sort((a, b) => (now.get(b.id) ?? 0) - (now.get(a.id) ?? 0));
  const hasTemps = activeRooms().some((r) => ds!.temps.has(r.id));
  const thr = state.comfortThreshold;
  const thrLabel = `${thr.toString().replace('.', ',')} °C`;

  const listCard = () => `
  <section class="card">
    <div class="card-head">
      <h2>Par pièce, comparé à l'an dernier <small class="muted">kWh</small></h2>
      <div class="controls">
        <label class="select"><span class="sr-only">Année</span><select data-set="roomsYear">${years
          .slice()
          .reverse()
          .map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`)
          .join('')}</select></label>
      </div>
    </div>
    <p class="hint muted">${isCurrent ? `Du 1er janvier au ${longDate(last)}, comparé à la même période de ${year - 1}.` : `Année ${year} complète, comparée à ${year - 1}.`}${win?.cut ? ` La collecte a commencé le ${longDate(first)} : l'évolution porte sur la même période des deux années (${win.label}).` : ''}${
      caveat.includes('jour') ? ` <strong>Attention</strong> : ${esc(caveat.split(' · ').filter((c) => c.includes('jour')).join(', '))}, l'évolution en est faussée.` : ''
    } Touchez une pièce pour ouvrir sa page.</p>
    <div class="chart" id="rooms-chart" style="height:${Math.max(220, sorted.length * 52 + 40)}px" role="img" aria-label="Consommation par pièce"></div>
    ${table(
      [
        'Pièce',
        'kWh',
        'Part',
        `${year - 1}${win?.cut ? ' (même période)' : ''}`,
        'Évolution',
        ...(hasTemps ? [`Température moyenne mesurée (${winterLabel})`, 'Température demandée aux radiateurs (consigne), moyenne', `Jours à moyenne sous ${thrLabel}`] : []),
      ],
      sorted.map((r) => {
        const v = now.get(r.id) ?? 0;
        const b = before.get(r.id) ?? 0;
        // #346: a room offline over either window is not « en baisse », it is not measured
        const run = win ? offlineRun(r.id, win.prevFrom, win.to) : null;
        const d = win && !run ? pctChange(nowCmp.get(r.id) ?? 0, b) : null;
        const tm = winterTemps(r.id, winter);
        const cold = r.category === 'heating' ? coldDays(r.id, winter, thr) : null;
        return [
          // #413: the name wraps and its category goes under it, never cut by the table (« Cha… »)
          `<span class="cell-name"><a class="link" href="#piece-${esc(encodeURIComponent(r.id))}" data-room-link="${esc(r.id)}"><span class="swatch" style="background:${roomColor(r.id)}"></span>${esc(r.name)}</a> <small class="muted">${CATEGORY_LABEL[r.category]}</small></span>`,
          v,
          sum ? `${nf0.format((v / sum) * 100)} %` : '—',
          b,
          run ? `<small>${esc(offlineText(run))}</small>` : d === null ? '—' : pct(d),
          ...(hasTemps
            ? [
                tm ? `${fmt1(tm[0])} °C` : '—',
                tm?.[1] != null ? `${fmt1(tm[1])} °C` : '—',
                cold ? `${cold.under} j sur ${cold.n} <small class="muted">${cold.source === 'station' ? 'station' : 'radiateur'}</small>` : '—',
              ]
            : []),
        ];
      }),
    )}
    ${hasTemps ? `<p class="hint muted">Températures et jours froids : ${winterLabel} (1er novembre ${winter} → 31 mars ${year}), comme dans Air et confort. Jours à moyenne sous ${thrLabel} : jours dont la température moyenne est sous le seuil, sur les jours relevés de l'hiver ; mesurée par la station Netatmo quand la pièce y est liée (« station »), sinon par la sonde du radiateur. Seuil dans ⚙ Paramètres → Objectifs et alertes, heures détaillées dans Air et confort.</p>` : ''}
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
  <section class="card" id="changes-card">
    <div class="card-head"><h2>Pièce par pièce</h2><span class="card-period">${esc(`${year - 1} → ${year}${suffix}`)}</span></div>
    <p class="hint muted">Chaque barre montre de combien une pièce a fait monter (rouge) ou baisser (vert) le total.${offNote}${stoveNote}</p>
    <div class="chart" id="rooms-waterfall" role="img" aria-label="Évolution par pièce"></div>
    ${countedHtml()}
  </section>`;
  view.innerHTML = html(part === 'list' ? listCard() : changesCard());

  if (part === 'changes') {
    const deltas = roomDeltas(records, cFrom, cTo);
    for (const r of offRooms) deltas.delete(r.id);
    drawWaterfall(document.getElementById('rooms-waterfall')!, deltas, year, suffix);
    return;
  }
  hbarChart(document.getElementById('rooms-chart')!, {
    labels: sorted.map((r) => r.name),
    series: [
      {
        name: `${year} (couleur de la pièce)`,
        color: cssVar('--text-muted'),
        data: sorted.map((r) => Math.round(now.get(r.id) ?? 0)),
        colors: sorted.map((r) => roomColor(r.id)),
      },
      { name: `${year - 1} (même période)`, color: cssVar('--usage-other'), data: sorted.map((r) => Math.round(before.get(r.id) ?? 0)) },
    ],
    price: avgPrice(),
    onClick: (i) => (location.hash = `#piece-${encodeURIComponent(sorted[i].id)}`),
  });
}

/** Average measured temperature and setpoint over the winter `season` (Nov → Mar, #294). */
function winterTemps(room: string, season: number): [number, number | null] | null {
  const t = ds!.temps.get(room);
  if (!t) return null;
  let s = 0, sp = 0, n = 0, nsp = 0;
  for (const [d, [m, c]] of t) {
    if (seasonOfWinter(d) !== season) continue;
    (s += m), n++;
    if (c !== null) (sp += c), nsp++;
  }
  return n ? [s / n, nsp ? sp / nsp : null] : null;
}

/** S-11.3, #294: days of the winter whose mean is below `thr`, station if linked (same rule as Confort). */
function coldDays(room: string, season: number, thr: number): { under: number; n: number; source: 'station' | 'radiator' } | null {
  const st = ds!.station;
  const heating = activeRooms().filter((r) => r.category === 'heating');
  const k = st ? effectiveMapping(heating, st.modules, state.roomModuleMap).get(room) : undefined;
  const means: [string, number | null][] =
    k && st ? Object.entries(st.daily[k] ?? {}).map(([d, v]) => [d, v[2]]) : [...(ds!.temps.get(room) ?? [])].map(([d, v]) => [d, v[0]]);
  const c = coldWinterDays(means, season, thr);
  return c ? { ...c, source: k ? 'station' : 'radiator' } : null;
}

// ------------------------------------------------------------------ events
/** Year selector. Returns true when the change belonged to this view. */
export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  if (t.dataset.set !== 'roomsYear') return false;
  setState({ roomsYear: Number(t.value) });
  return true;
}
