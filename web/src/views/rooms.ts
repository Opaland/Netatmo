// Rooms ("Pièces"): consumption per room, year-over-year waterfall and per-room detail.
import { CATEGORY_LABEL, type DayRecord, MONTHS_SHORT, minusYears, monthlyByYear, pctChange, totalsBy } from '../aggregate';
import { roomDeltas } from '../analysis';
import { ds, setState, state } from '../app';
import { barChart, cssVar, hbarChart } from '../charts';
import {
  activeRooms,
  avgPrice,
  drawWaterfall,
  esc,
  lastDay,
  longDate,
  nf0,
  pct,
  roomColor,
  roomName,
  table,
  yearColor,
} from '../ui';

export function renderRooms(view: HTMLElement, records: DayRecord[]) {
  const years = ds!.meta.years;
  const year = state.roomsYear ?? years[years.length - 1];
  const last = lastDay();
  const isCurrent = year === Number(last.slice(0, 4));
  const end = isCurrent ? last : `${year}-12-31`;
  const now = totalsBy(records, `${year}-01-01`, end, (r) => r.room);
  const before = totalsBy(records, `${year - 1}-01-01`, minusYears(end), (r) => r.room);
  const sum = [...now.values()].reduce((a, b) => a + b, 0);
  const rooms = activeRooms().filter((r) => now.has(r.id) || before.has(r.id));
  const sorted = rooms.slice().sort((a, b) => (now.get(b.id) ?? 0) - (now.get(a.id) ?? 0));
  const focus = state.focusRoom && rooms.some((r) => r.id === state.focusRoom) ? state.focusRoom : null;
  const hasTemps = activeRooms().some((r) => ds!.temps.has(r.id));

  view.innerHTML = `
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
    <p class="hint muted">${isCurrent ? `Du 1er janvier au ${longDate(last)}, comparé à la même période de ${year - 1}.` : `Année ${year} complète, comparée à ${year - 1}.`} Touchez une pièce pour voir son détail.</p>
    <div class="chart" id="rooms-chart" style="height:${Math.max(220, sorted.length * 52 + 40)}px" role="img" aria-label="Consommation par pièce"></div>
    ${table(
      ['Pièce', 'kWh', 'Part', `${year - 1}`, 'Évolution', ...(hasTemps ? ['Temp. moy.', 'Consigne moy.'] : [])],
      sorted.map((r) => {
        const v = now.get(r.id) ?? 0;
        const b = before.get(r.id) ?? 0;
        const d = pctChange(v, b);
        const tm = winterTemps(r.id, year);
        return [
          `<button type="button" class="link" data-focus="${esc(r.id)}"><span class="swatch" style="background:${roomColor(r.id)}"></span>${esc(r.name)}</button> <small class="muted">${CATEGORY_LABEL[r.category]}</small>`,
          v,
          sum ? `${nf0.format((v / sum) * 100)} %` : '—',
          b,
          d === null ? '—' : pct(d),
          ...(hasTemps ? [tm ? `${tm[0].toFixed(1).replace('.', ',')} °C` : '—', tm?.[1] != null ? `${tm[1].toFixed(1).replace('.', ',')} °C` : '—'] : []),
        ];
      }),
    )}
    ${hasTemps ? '<p class="hint muted">Températures : moyennes des jours chauffés de l\'année (novembre à mars).</p>' : ''}
  </section>
  <section class="card">
    <h2>Qu'est-ce qui a changé ? <small class="muted">${year - 1} → ${year}${isCurrent ? ', à date' : ''}</small></h2>
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
        color: cssVar('--text-secondary'),
        data: sorted.map((r) => Math.round(now.get(r.id) ?? 0)),
        colors: sorted.map((r) => roomColor(r.id)),
      },
      { name: `${year - 1} (même période)`, color: cssVar('--ghost'), data: sorted.map((r) => Math.round(before.get(r.id) ?? 0)) },
    ],
    price: avgPrice(),
    onClick: (i) => setState({ focusRoom: sorted[i].id }),
  });
  drawWaterfall(document.getElementById('rooms-waterfall')!, roomDeltas(records, `${year}-01-01`, end), year);
  if (focus) {
    const m = monthlyByYear(records.filter((r) => r.room === focus));
    const shown = years.filter((y) => y >= year - 2 && y <= year);
    barChart(document.getElementById('room-detail')!, {
      labels: MONTHS_SHORT,
      series: shown.map((y) => ({ name: String(y), color: yearColor(y), data: (m.get(y) ?? []).map((v) => (v === null ? null : Math.round(v))) })),
      stacked: false,
      price: avgPrice(),
    });
  }
}

/** Average measured temperature and setpoint over Nov–Mar days of that year. */
function winterTemps(room: string, year: number): [number, number | null] | null {
  const t = ds!.temps.get(room);
  if (!t) return null;
  let s = 0, sp = 0, n = 0, nsp = 0;
  for (const [d, [m, c]] of t) {
    const mo = Number(d.slice(5, 7));
    if (!d.startsWith(String(year)) || (mo > 3 && mo < 11)) continue;
    (s += m), n++;
    if (c !== null) (sp += c), nsp++;
  }
  return n ? [s / n, nsp ? sp / nsp : null] : null;
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
