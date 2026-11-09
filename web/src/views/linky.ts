// "Courbe de charge" card (Linky 30 min, S-1.11 / S-4.12): typical day, standby base load,
// busiest half hour and one day's curve. Loaded on demand by the overview, only when
// meta.linky_curve_years exists, so neither this module nor the curve weigh on first paint.
import type { Hourly } from '../analysis';
import { ds, onDatasetLoaded, state } from '../app';
import { areaChart, cssVar } from '../charts';
import {
  type Curve,
  SLOTS,
  dayCurve,
  lastCurveDay,
  measuredWatts,
  peakHalfHour,
  talon,
  typicalDay,
  typicalHourly,
  windowDays,
} from '../curve';
import { loadCurve, loadHourly } from '../data';
import { periodAt } from '../offers';
import { activeRooms, catColor, contracts, fmtEur, longDate, nf0, priceAt, series } from '../ui';

let curve: Curve | null = null;
let hourly: Hourly | null = null;
let loading: Promise<void> | null = null;
let group: 'weekday' | 'weekend' = 'weekday';
let pickedDay: string | null = null;
onDatasetLoaded(() => {
  curve = null;
  hourly = null;
  loading = null;
  pickedDay = null;
});

const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const kw = (w: number) => (w < 1000 ? `${nf0.format(w)} W` : `${nf1.format(w / 1000)} kW`);
const round = (v: number | null) => (v === null ? null : Math.round(v));

/** Price of a kWh drawn evenly around the clock (16 h full, 8 h off-peak), today. */
function flatPrice(day: string): number | null {
  if (state.priceMode === 'trve') {
    const row = priceAt(day);
    if (row) return (16 * row.hp + 8 * row.hc) / 24;
  }
  const p = state.prices;
  if (p.base !== null) return p.base;
  if (p.t1 !== null && p.t2 !== null) return (p.t1 + p.t2) / 2;
  return p.t1 ?? p.t2;
}

function rooms(cat: 'heating' | 'water_heater') {
  return new Set(activeRooms().filter((r) => r.category === cat).map((r) => r.id));
}

/** Entry point: `card` is the empty section placed by the overview. */
export function renderCurveCard(card: HTMLElement) {
  if (!ds) return;
  if (!curve) {
    card.hidden = false;
    card.innerHTML = '<div class="card-head"><h2>Courbe de charge <small class="muted">Linky, pas de 30 min</small></h2></div><p class="hint muted">Chargement de la courbe de charge…</p>';
    loading ??= Promise.all([loadCurve(ds), loadHourly(ds).catch(() => null)]).then(([c, h]) => {
      curve = c;
      hourly = h;
    });
    loading
      .then(() => card.isConnected && renderCurveCard(card))
      .catch(() => {
        loading = null;
        if (card.isConnected) card.hidden = true;
      });
    return;
  }
  const last = lastCurveDay(curve);
  if (!last) {
    card.hidden = true; // collection enabled but nothing received yet: Settings explains it
    return;
  }
  const { from, days } = windowDays(curve, last);
  const first = [...curve.keys()].reduce((a, b) => (b < a ? b : a)).slice(0, 10);
  if (!pickedDay || pickedDay < first || pickedDay > last) pickedDay = last;
  card.hidden = false;
  card.innerHTML = `
    <div class="card-head">
      <h2>Courbe de charge <small class="muted">Linky, puissance moyenne par demi-heure</small></h2>
      <div class="controls">
        <div class="seg" role="radiogroup" aria-label="Jours">
          ${(
            [
              ['weekday', 'Semaine'],
              ['weekend', 'Week-end'],
            ] as const
          )
            .map(([v, l]) => `<button type="button" role="radio" aria-checked="${group === v}" data-curve-group="${v}">${l}</button>`)
            .join('')}
        </div>
      </div>
    </div>
    <p class="hint muted" id="curve-summary"></p>
    <div class="chart" id="curve-typical" role="img" aria-label="Journée type du logement, par demi-heure"></div>
    <h3>Talon de veille</h3>
    <p id="curve-talon"></p>
    <h3>Demi-heure la plus chargée</h3>
    <p id="curve-peak"></p>
    <div class="card-head">
      <h3>Une journée</h3>
      <label class="select"><span class="sr-only">Jour affiché</span><input type="date" id="curve-day" value="${pickedDay}" min="${first}" max="${last}"></label>
    </div>
    <div class="chart" id="curve-day-chart" role="img" aria-label="Courbe de charge du jour choisi"></div>`;
  card.querySelectorAll<HTMLButtonElement>('[data-curve-group]').forEach((b) =>
    b.addEventListener('click', () => {
      group = b.dataset.curveGroup as typeof group;
      renderCurveCard(card);
    }),
  );
  card.querySelector<HTMLInputElement>('#curve-day')!.addEventListener('change', (e) => {
    const v = (e.target as HTMLInputElement).value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      pickedDay = v;
      drawDay(card);
    }
  });
  drawTypical(from, last, days);
  drawTalon(from, last);
  drawPeak(last);
  drawDay(card);
}

function parts(heat: number[] | null, water: number[] | null, total: (number | null)[]) {
  const other = total.map((t, i) => (t === null ? null : Math.max(0, t - (heat?.[i] ?? 0) - (water?.[i] ?? 0))));
  return [
    ...(heat ? [{ name: 'Chauffage', color: catColor('heating'), data: heat.map((v, i) => (total[i] === null ? null : Math.round(Math.min(v, total[i]!)))) }] : []),
    ...(water ? [{ name: 'Chauffe-eau', color: catColor('water_heater'), data: water.map((v, i) => (total[i] === null ? null : Math.round(v))) }] : []),
    { name: 'Autres usages', color: cssVar('--ghost'), data: other.map(round) },
  ];
}

function drawTypical(from: string, last: string, days: Set<string>) {
  const tz = ds!.meta.home.timezone || 'Europe/Paris';
  const typ = typicalDay(curve!, tz, from, last);
  const total = typ[group];
  const h = hourly ? typicalHourly(hourly, rooms('heating'), tz, days) : null;
  const w = hourly ? typicalHourly(hourly, rooms('water_heater'), tz, days) : null;
  const heat = h && rooms('heating').size ? h[group] : null;
  const water = w && rooms('water_heater').size ? w[group] : null;
  areaChart(document.getElementById('curve-typical')!, {
    labels: SLOTS,
    areas: heat || water ? parts(heat, water, total) : [],
    lines: [{ name: 'Logement (Linky)', color: series(0), data: total.map(round) }],
    unit: 'W',
  });
  const n = typ.days[group];
  const vals = total.map((v, i) => [v, i] as const).filter(([v]) => v !== null) as [number, number][];
  if (!vals.length) {
    document.getElementById('curve-summary')!.textContent = `Pas de ${group === 'weekday' ? 'jour de semaine' : 'jour de week-end'} dans les 30 derniers jours.`;
    return;
  }
  const [maxW, maxI] = vals.reduce((a, b) => (b[0] > a[0] ? b : a));
  const mean = vals.reduce((s, [v]) => s + v, 0) / vals.length;
  const typEl = document.getElementById('curve-typical')!;
  typEl.setAttribute(
    'aria-label',
    `Journée type du logement (${group === 'weekday' ? 'semaine' : 'week-end'}), puissance moyenne par demi-heure : ${kw(mean)} en moyenne, maximum ${kw(maxW)} à ${SLOTS[maxI]}.`,
  );
  document.getElementById('curve-summary')!.innerHTML =
    `Journée type sur les 30 jours jusqu'au ${longDate(last)} (${n} ${group === 'weekday' ? 'jours de semaine' : 'jours de week-end'}) : ${kw(mean)} en moyenne, pointe à <strong>${SLOTS[maxI]}</strong> (${kw(maxW)}).` +
    (heat || water ? ' Les aplats montrent ce que mesurent les radiateurs et le chauffe-eau ; le reste, ce sont les autres usages.' : '');
}

function drawTalon(from: string, last: string) {
  const tz = ds!.meta.home.timezone || 'Europe/Paris';
  const measured = new Set([...rooms('heating'), ...rooms('water_heater')]);
  const minus = hourly && measured.size ? measuredWatts(hourly, measured, tz) : undefined;
  const net = minus?.byHour.size ? talon(curve!, tz, from, last, minus) : null;
  const t = net ?? talon(curve!, tz, from, last);
  const el = document.getElementById('curve-talon')!;
  if (!t) {
    el.innerHTML = '<span class="muted">Pas assez de mesures de nuit pour l\'estimer.</span>';
    return;
  }
  const kwhYear = (t.watts * 8760) / 1000;
  const price = flatPrice(last);
  el.innerHTML = `≈ <strong>${nf0.format(t.watts)} W</strong> en permanence, soit ≈ ${nf0.format(kwhYear)} kWh par an${
    price ? ` et ≈ <strong>${fmtEur(kwhYear * price)} par an</strong> au prix actuel` : ''
  }. C'est ce que le logement consomme quand tout dort (box, réfrigérateur, VMC, veilles) : le niveau bas des nuits entre 1 h et 5 h sur 30 jours (10<sup>e</sup> centile)${
    net ? ', radiateurs et chauffe-eau déduits' : ''
  }. Chaque 10 W de veille en moins économise ≈ ${nf0.format(87.6)} kWh${price ? ` (${fmtEur(87.6 * price)})` : ''} par an.`;
}

function drawPeak(last: string) {
  const tz = ds!.meta.home.timezone || 'Europe/Paris';
  const from = new Date(Date.parse(`${last}T00:00:00Z`) - 364 * 86400000).toISOString().slice(0, 10);
  const p = peakHalfHour(curve!, tz, from, last);
  const el = document.getElementById('curve-peak')!;
  if (!p) return;
  const day = p.key.slice(0, 10);
  const kva = periodAt(contracts(), day)?.kva;
  const span = [...curve!.keys()].some((k) => k.slice(0, 10) <= from) ? 'sur 12 mois' : 'depuis le début de la courbe';
  el.innerHTML = `${span[0].toUpperCase()}${span.slice(1)} : <strong>${kw(p.watts)}</strong> en moyenne le ${longDate(day)} de ${p.key.slice(11, 16)} à ${
    SLOTS[(SLOTS.indexOf(p.key.slice(11, 16)) + 1) % 48]
  }${kva ? `, pour ${kva} kVA souscrits (${nf0.format((p.watts / 1000 / kva) * 100)} %)` : ''}. Une moyenne sur 30 minutes lisse les appels brefs (four, bouilloire) : pour le disjoncteur, la puissance maximale du jour ci-dessus reste la référence.`;
}

function drawDay(card: HTMLElement) {
  const el = card.querySelector<HTMLElement>('#curve-day-chart');
  if (!el || !pickedDay) return;
  const tz = ds!.meta.home.timezone || 'Europe/Paris';
  const { labels, values } = dayCurve(curve!, tz, pickedDay);
  const dayset = new Set([pickedDay]);
  const g = new Date(`${pickedDay}T00:00:00Z`).getUTCDay() % 6 === 0 ? 'weekend' : 'weekday';
  const heat = hourly && rooms('heating').size ? typicalHourly(hourly, rooms('heating'), tz, dayset)[g] : null;
  const water = hourly && rooms('water_heater').size ? typicalHourly(hourly, rooms('water_heater'), tz, dayset)[g] : null;
  const any = values.some((v) => v !== null);
  areaChart(el, {
    labels,
    areas: any && (heat || water) ? parts(heat, water, values) : [],
    lines: [{ name: 'Logement (Linky)', color: series(0), data: values.map(round) }],
    unit: 'W',
    zoom: true,
  });
  const vals = values.map((v, i) => [v, i] as const).filter(([v]) => v !== null) as [number, number][];
  const [maxW, maxI] = vals.length ? vals.reduce((a, b) => (b[0] > a[0] ? b : a)) : [0, 0];
  el.setAttribute(
    'aria-label',
    vals.length
      ? `Courbe de charge du ${longDate(pickedDay)} : maximum ${kw(maxW)} à ${labels[maxI]}.`
      : `Pas de courbe de charge le ${longDate(pickedDay)}.`,
  );
}
