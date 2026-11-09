// "Courbe de charge" card (Linky 30 min, S-1.11 / S-4.12): typical day, standby base load,
// busiest half hour and one day's curve. Loaded on demand by the overview, only when
// meta.linky_curve_years exists, so neither this module nor the curve weigh on first paint.
import type { Hourly } from '../analysis';
import { datasetDoc, ds, onDatasetLoaded } from '../app';
import { areaChart, cssVar } from '../charts';
import {
  type Curve,
  SLOTS,
  dayCurve,
  lastCurveDay,
  measuredWattsCached,
  peakHalfHour,
  talon,
  typicalDay,
  typicalHourlyCached,
  windowDays,
} from '../curve';
import { loadCurve, loadHourly } from '../data';
import { memo } from '../memo';
import { periodAt } from '../offers';
import { activeRooms, catColor, contracts, flatPriceAt, fmtEur, longDate, nf0, measureColor } from '../ui';
import { html } from '../trusted';

// #247: the curve first, then only the hourly years of its 30-day window (#251), for the
// dataset shown; a result arriving after the dataset changed is dropped.
const doc = datasetDoc(async (d) => {
  const c = await loadCurve(d);
  const last = lastCurveDay(c);
  const since = last ? windowDays(c, last).from : '';
  const h = last ? await loadHourly(d, since).catch(() => null) : null;
  return { curve: c, hourly: h, since: h ? `${since.slice(0, 4)}-01-01` : '' };
});
// Set from `doc` at each render; `wider`: older hourly years loaded for a day picked further back.
let curve: Curve | null = null;
let hourly: Hourly | null = null;
let hourlySince = ''; // first day the loaded hourly years cover (#251: not the whole history)
let wider: { hourly: Hourly; since: string } | null = null;
let group: 'weekday' | 'weekend' = 'weekday';
let pickedDay: string | null = null;
onDatasetLoaded(() => {
  curve = null;
  hourly = null;
  hourlySince = '';
  wider = null;
  pickedDay = null;
});

const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const kw = (w: number) => (w < 1000 ? `${nf0.format(w)} W` : `${nf1.format(w / 1000)} kW`);
const round = (v: number | null) => (v === null ? null : Math.round(v));

function rooms(cat: 'heating' | 'water_heater') {
  return new Set(activeRooms().filter((r) => r.category === cat).map((r) => r.id));
}

/** Entry point: `card` is the empty section placed by the overview. */
export function renderCurveCard(card: HTMLElement) {
  if (!ds) return;
  const v = doc.get(ds, () => card.isConnected && renderCurveCard(card));
  if (!v) {
    const failed = doc.status(ds) === 'failed';
    card.hidden = false;
    card.innerHTML = html`<div class="card-head"><h2>Courbe de charge <small class="muted">Linky, pas de 30 min</small></h2></div><p class="hint muted">${
      !failed ? 'Chargement de la courbe de charge…' : navigator.onLine ? 'Courbe de charge indisponible.' : 'Courbe de charge : disponible au prochain accès réseau.'
    }</p>`;
    return;
  }
  const c = (curve = v.curve);
  hourly = wider?.hourly ?? v.hourly;
  hourlySince = wider?.since ?? v.since;
  const last = memo(c, 'last', () => lastCurveDay(c));
  if (!last) {
    card.hidden = true; // collection enabled but nothing received yet: Settings explains it
    return;
  }
  const { from, days } = memo(c, `win|${last}`, () => windowDays(c, last));
  const first = memo(c, 'first', () => [...c.keys()].reduce((a, b) => (b < a ? b : a)).slice(0, 10));
  if (!pickedDay || pickedDay < first || pickedDay > last) pickedDay = last;
  card.hidden = false;
  card.innerHTML = html`
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
      if (hourly && v < hourlySince) {
        // An older day than the loaded hourly years: load from that year, then redraw.
        const d = ds!;
        void loadHourly(d, v).then(
          (h) => {
            if (ds !== d) return; // #247: another dataset since
            wider = { hourly: h, since: `${v.slice(0, 4)}-01-01` };
            hourly = h;
            hourlySince = wider.since;
            if (card.isConnected) drawDay(card);
          },
          () => {}, // that day is drawn without the radiators, as before the load
        );
      }
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
    { name: 'Autres usages', color: cssVar('--usage-other'), data: other.map(round) },
  ];
}

function drawTypical(from: string, last: string, days: Set<string>) {
  const tz = ds!.meta.home.timezone || 'Europe/Paris';
  const typ = memo(curve!, `typ|${tz}|${from}|${last}`, () => typicalDay(curve!, tz, from, last));
  const total = typ[group];
  const h = hourly ? typicalHourlyCached(hourly, rooms('heating'), tz, days) : null;
  const w = hourly ? typicalHourlyCached(hourly, rooms('water_heater'), tz, days) : null;
  const heat = h && rooms('heating').size ? h[group] : null;
  const water = w && rooms('water_heater').size ? w[group] : null;
  areaChart(document.getElementById('curve-typical')!, {
    labels: SLOTS,
    areas: heat || water ? parts(heat, water, total) : [],
    lines: [{ name: 'Logement (Linky)', color: measureColor(), data: total.map(round) }],
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
  document.getElementById('curve-summary')!.innerHTML = html(
    `Journée type sur les 30 jours jusqu'au ${longDate(last)} (${n} ${group === 'weekday' ? 'jours de semaine' : 'jours de week-end'}) : ${kw(mean)} en moyenne, pointe à <strong>${SLOTS[maxI]}</strong> (${kw(maxW)}).` +
    (heat || water ? ' Les aplats montrent ce que mesurent les radiateurs et le chauffe-eau ; le reste, ce sont les autres usages.' : ''),
  );
}

function drawTalon(from: string, last: string) {
  const tz = ds!.meta.home.timezone || 'Europe/Paris';
  const measured = new Set([...rooms('heating'), ...rooms('water_heater')]);
  const minus = hourly && measured.size ? measuredWattsCached(hourly, measured, tz, from, last) : undefined;
  const net = minus?.byHour.size ? memo(minus, `talon|${from}|${last}`, () => talon(curve!, tz, from, last, minus)) : null;
  const t = net ?? memo(curve!, `talon|${tz}|${from}|${last}`, () => talon(curve!, tz, from, last));
  const el = document.getElementById('curve-talon')!;
  if (!t) {
    el.innerHTML = html('<span class="muted">Pas assez de mesures de nuit pour l\'estimer.</span>');
    return;
  }
  const kwhYear = (t.watts * 8760) / 1000;
  const price = flatPriceAt(last); // #252: 16 h peak, 8 h off-peak, under the price mode in force
  el.innerHTML = html`≈ <strong>${nf0.format(t.watts)} W</strong> en permanence, soit ≈ ${nf0.format(kwhYear)} kWh par an${
    price ? ` et ≈ <strong>${fmtEur(kwhYear * price)} par an</strong> au prix actuel` : ''
  }. C'est ce que le logement consomme quand tout dort (box, réfrigérateur, VMC, veilles) : le niveau bas des nuits entre 1 h et 5 h sur 30 jours (10<sup>e</sup> centile)${
    net ? ', radiateurs et chauffe-eau déduits' : ''
  }. Chaque 10 W de veille en moins économise ≈ ${nf0.format(87.6)} kWh${price ? ` (${fmtEur(87.6 * price)})` : ''} par an.`;
}

function drawPeak(last: string) {
  const tz = ds!.meta.home.timezone || 'Europe/Paris';
  const from = new Date(Date.parse(`${last}T00:00:00Z`) - 364 * 86400000).toISOString().slice(0, 10);
  const p = memo(curve!, `peak|${tz}|${from}|${last}`, () => peakHalfHour(curve!, tz, from, last));
  const el = document.getElementById('curve-peak')!;
  if (!p) return;
  const day = p.key.slice(0, 10);
  const kva = periodAt(contracts(), day)?.kva;
  const span = memo(curve!, 'first', () => [...curve!.keys()].reduce((a, b) => (b < a ? b : a)).slice(0, 10)) <= from ? 'sur 12 mois' : 'depuis le début de la courbe';
  el.innerHTML = html`${span[0].toUpperCase()}${span.slice(1)} : <strong>${kw(p.watts)}</strong> en moyenne le ${longDate(day)} de ${p.key.slice(11, 16)} à ${
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
  const heat = hourly && rooms('heating').size ? typicalHourlyCached(hourly, rooms('heating'), tz, dayset)[g] : null;
  const water = hourly && rooms('water_heater').size ? typicalHourlyCached(hourly, rooms('water_heater'), tz, dayset)[g] : null;
  const any = values.some((v) => v !== null);
  areaChart(el, {
    labels,
    areas: any && (heat || water) ? parts(heat, water, values) : [],
    lines: [{ name: 'Logement (Linky)', color: measureColor(), data: values.map(round) }],
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
