// Rooms ("Pièces"): consumption per room, year-over-year waterfall and per-room detail.
import { CATEGORY_LABEL, type DayRecord, MONTHS_SHORT, monthlyByYear, pctChange, totalsBy } from '../aggregate';
import { roomDeltas } from '../analysis';
import { ds, setState, state } from '../app';
import { barChart, cssVar, hbarChart } from '../charts';
import { uncertainDays } from '../checks';
import { coldWinterDays, effectiveMapping, seasonOf as seasonOfWinter } from '../comfort';
import { bucketMarks, monthKeys, windowSuffix, yoyCaveat, yoyWindow } from '../periods';
import {
  activeRooms,
  avgPrice,
  drawWaterfall,
  esc,
  firstDay,
  lastDay,
  longDate,
  nf0,
  pct,
  roomColor,
  roomName,
  table,
  yearColor,
} from '../ui';
import { html } from '../trusted';

export function renderRooms(view: HTMLElement, records: DayRecord[]) {
  const years = ds!.meta.years;
  const year = state.roomsYear ?? years[years.length - 1];
  const last = lastDay();
  const isCurrent = year === Number(last.slice(0, 4));
  const end = isCurrent ? last : `${year}-12-31`;
  // #297: year over year on the same window (to date; from the first data day when N-1 started late)
  const first = records.reduce((a, r) => (r.day < a ? r.day : a), records[0]?.day ?? firstDay());
  const uncertain = uncertainDays(records, ds!.estimated, first, last);
  const win = yoyWindow(year, first, last);
  const caveat = yoyCaveat(win, uncertain);
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
  const focus = state.focusRoom && rooms.some((r) => r.id === state.focusRoom) ? state.focusRoom : null;
  const hasTemps = activeRooms().some((r) => ds!.temps.has(r.id));
  const thr = state.comfortThreshold;
  const thrLabel = `${thr.toString().replace('.', ',')} °C`;

  view.innerHTML = html`
  <section class="card">
    <div class="card-head">
      <h2>Par pièce <small class="muted">kWh</small></h2>
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
    } Touchez une pièce pour voir son détail.</p>
    <div class="chart" id="rooms-chart" style="height:${Math.max(220, sorted.length * 52 + 40)}px" role="img" aria-label="Consommation par pièce"></div>
    ${table(
      [
        'Pièce',
        'kWh',
        'Part',
        `${year - 1}${win?.cut ? ' (même période)' : ''}`,
        'Évolution',
        ...(hasTemps ? [`Temp. moy. (${winterLabel})`, 'Consigne moy.', `Jours à moyenne sous ${thrLabel}`] : []),
      ],
      sorted.map((r) => {
        const v = now.get(r.id) ?? 0;
        const b = before.get(r.id) ?? 0;
        const d = win ? pctChange(nowCmp.get(r.id) ?? 0, b) : null;
        const tm = winterTemps(r.id, winter);
        const cold = r.category === 'heating' ? coldDays(r.id, winter, thr) : null;
        return [
          `<button type="button" class="link" data-focus="${esc(r.id)}"><span class="swatch" style="background:${roomColor(r.id)}"></span>${esc(r.name)}</button> <small class="muted">${CATEGORY_LABEL[r.category]}</small>`,
          v,
          sum ? `${nf0.format((v / sum) * 100)} %` : '—',
          b,
          d === null ? '—' : pct(d),
          ...(hasTemps
            ? [
                tm ? `${tm[0].toFixed(1).replace('.', ',')} °C` : '—',
                tm?.[1] != null ? `${tm[1].toFixed(1).replace('.', ',')} °C` : '—',
                cold ? `${cold.under} j sur ${cold.n} <small class="muted">${cold.source === 'station' ? 'station' : 'radiateur'}</small>` : '—',
              ]
            : []),
        ];
      }),
    )}
    ${hasTemps ? `<p class="hint muted">Températures et jours froids : ${winterLabel} (1er novembre ${winter} → 31 mars ${year}), comme dans Confort. Jours à moyenne sous ${thrLabel} : jours dont la température moyenne est sous le seuil, sur les jours relevés de l'hiver ; mesurée par la station Netatmo quand la pièce y est liée (« station »), sinon par la sonde du radiateur. Seuil et heures détaillées dans Confort.</p>` : ''}
  </section>
  <section class="card">
    <h2>Qu'est-ce qui a changé ? <small class="muted">${year - 1} → ${year}${suffix}</small></h2>
    <p class="hint muted">Chaque barre montre de combien une pièce a fait monter (rouge) ou baisser (vert) le total.</p>
    <div class="chart" id="rooms-waterfall" role="img" aria-label="Évolution par pièce"></div>
  </section>
  ${
    focus
      ? `<section class="card">
    <div class="card-head"><h2>${esc(roomName(focus))} — mois par mois</h2><button type="button" class="link" data-focus="">Fermer</button></div>
    <div class="chart" id="room-detail" role="img" aria-label="Détail mensuel de la pièce"></div>
  </section>`
      : ''
  }`;

  hbarChart(document.getElementById('rooms-chart')!, {
    labels: sorted.map((r) => r.name),
    series: [
      {
        name: String(year),
        color: cssVar('--text-muted'),
        data: sorted.map((r) => Math.round(now.get(r.id) ?? 0)),
        colors: sorted.map((r) => roomColor(r.id)),
      },
      { name: `${year - 1} (même période)`, color: cssVar('--usage-other'), data: sorted.map((r) => Math.round(before.get(r.id) ?? 0)) },
    ],
    price: avgPrice(),
    onClick: (i) => setState({ focusRoom: sorted[i].id }),
  });
  drawWaterfall(document.getElementById('rooms-waterfall')!, roomDeltas(records, win?.from ?? `${year}-01-01`, win?.to ?? end), year, suffix);
  if (focus) {
    const mine = records.filter((r) => r.room === focus);
    const m = monthlyByYear(mine);
    const shown = years.filter((y) => y >= year - 2 && y <= year);
    // #297: partial months and months with estimated or lost days of this room
    const roomFirst = mine[0]?.day ?? first;
    const roomUncertain = uncertainDays(mine, ds!.estimated, roomFirst, last);
    barChart(document.getElementById('room-detail')!, {
      labels: MONTHS_SHORT,
      series: shown.map((y) => {
        const marks = bucketMarks(monthKeys(y), 'month', roomFirst, last, roomUncertain);
        return {
          name: String(y),
          color: yearColor(y),
          data: (m.get(y) ?? []).map((v) => (v === null ? null : Math.round(v))),
          raw: m.get(y) ?? [],
          notes: marks.map((k) => k.note),
          marks: marks.map((k) => k.partial || k.uncertain > 0),
        };
      }),
      stacked: false,
      price: avgPrice(),
    });
  }
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
/** Room focus buttons. Returns true when the click belonged to this view. */
export function handleClick(btn: HTMLElement): boolean {
  if (btn.dataset.focus === undefined) return false;
  setState({ focusRoom: btn.dataset.focus || null });
  return true;
}

/** Year selector. Returns true when the change belonged to this view. */
export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  if (t.dataset.set !== 'roomsYear') return false;
  setState({ roomsYear: Number(t.value), focusRoom: null });
  return true;
}
