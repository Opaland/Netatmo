// Linky 30-min load curve (S-1.11 / S-4.12), loaded on demand by the Compteur tab (views/meter.ts)
// only when meta.linky_curve_years exists: « Journée type » (typical day, busiest half hour, one
// day) and « Veille » (the standby base load) on their detail pages, and the standby line of the
// Compteur list. #301: every card counts the days of the tab's period that the curve covers,
// and says so.
import { addDays, minusYears } from '../aggregate';
import type { Hourly } from '../analysis';
import { datasetDoc, ds, onDatasetLoaded } from '../app';
import { areaChart, cssVar } from '../charts';
import { type Curve, SLOTS, curveVsDay, dayCurve, dayNote, lastCurveDay, measuredWattsCached, peakHalfHour, talon, typicalDay, typicalHourlyCached } from '../curve';
import { loadCurve, loadHourly } from '../data';
import { hourMin } from '../glossary';
import { memo } from '../memo';
import { type Coverage, coverage, coveredText, standbyYear } from '../meter';
import { periodAt } from '../offers';
import { term } from '../plain';
import { countedNote, countedInner } from '../components';
import { html } from '../trusted';
import { activeRooms, catColor, contracts, esc, flatPriceAt, fmtEur, longDate, measureColor, nf0 } from '../ui';

export interface Range {
  from: string;
  to: string;
}

// #247: the curve, then the hourly years the tab's periods can reach (12 months at most, #251),
// for the dataset shown; a result arriving after the dataset changed is dropped.
const doc = datasetDoc(async (d) => {
  const c = await loadCurve(d);
  const last = lastCurveDay(c);
  const first = last ? [...c.keys()].reduce((a, b) => (b < a ? b : a)).slice(0, 10) : '';
  const yearAgo = addDays(minusYears(d.meta.last_day ?? last ?? ''), 1);
  const since = first > yearAgo ? first : yearAgo;
  const h = last ? await loadHourly(d, since).catch(() => null) : null;
  return { curve: c, hourly: h, since: h ? `${since.slice(0, 4)}-01-01` : '' };
});
let group: 'weekday' | 'weekend' = 'weekday';
let pickedDay: string | null = null;
let wider: { hourly: Hourly; since: string } | null = null; // older hourly years, for a day picked further back
onDatasetLoaded(() => {
  pickedDay = null;
  wider = null;
});

const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const kw = (w: number) => (w < 1000 ? `${nf0.format(w)} W` : `${nf1.format(w / 1000)} kW`);
const round = (v: number | null) => (v === null ? null : Math.round(v));
const tz = () => ds!.meta.home.timezone || 'Europe/Paris';
const rooms = (cat: 'heating' | 'water_heater') => new Set(activeRooms().filter((r) => r.category === cat).map((r) => r.id));
const counted = countedNote;

interface Loaded {
  curve: Curve;
  hourly: Hourly | null;
  since: string;
}

/**
 * The curve for the dataset shown, or the message to show while it loads or when it failed
 * (`redraw` is called once it has loaded).
 */
function loaded(redraw: () => void): Loaded | string {
  const v = doc.get(ds, redraw);
  if (v) return wider ? { ...v, hourly: wider.hourly, since: wider.since } : v;
  if (doc.status(ds) !== 'failed') return 'Chargement de la courbe de charge…';
  return navigator.onLine ? 'Courbe de charge indisponible.' : 'Courbe de charge : disponible au prochain accès réseau.';
}

/** Days of the period that the curve covers (null: none). */
const curveDays = (c: Curve, r: Range): Coverage | null => memo(c, `cov|${r.from}|${r.to}`, () => coverage(c.keys(), r.from, r.to));

const noCurve = (r: Range) =>
  `<p class="hint muted">Pas de courbe de charge du compteur ${esc(`du ${longDate(r.from)} au ${longDate(r.to)}`)} : choisissez une autre période.</p>`;

// ------------------------------------------------------------------ Veille
/** Standby (W) over the days covered, radiators and water heater taken out when possible. */
function standby(v: Loaded, cov: Coverage): { watts: number; net: boolean } | null {
  const measured = new Set([...rooms('heating'), ...rooms('water_heater')]);
  const minus = v.hourly && measured.size ? measuredWattsCached(v.hourly, measured, tz(), cov.first, cov.last) : undefined;
  const net = minus?.byHour.size ? memo(minus, `talon|${cov.first}|${cov.last}`, () => talon(v.curve, tz(), cov.first, cov.last, minus)) : null;
  const t = net ?? memo(v.curve, `talon|${tz()}|${cov.first}|${cov.last}`, () => talon(v.curve, tz(), cov.first, cov.last));
  return t ? { watts: t.watts, net: !!net } : null;
}

/** « 235 W en permanence · ≈ 400 € par an », the subtitle of the « Veille » row (null: no curve). */
export function standbyRow(el: HTMLElement, r: Range) {
  const v = loaded(() => el.isConnected && standbyRow(el, r));
  if (typeof v === 'string') return;
  const cov = curveDays(v.curve, r);
  const s = cov && standby(v, cov);
  if (!s) return;
  const y = standbyYear(s.watts, flatPriceAt(r.to));
  el.textContent = `${nf0.format(s.watts)} W en permanence · ≈ ${y.eur !== null ? `${fmtEur(y.eur)} par an` : `${nf0.format(y.kwh)} kWh par an`}`;
}

/** The « Veille » detail page. */
export function renderStandby(zone: HTMLElement, r: Range) {
  const v = loaded(() => zone.isConnected && renderStandby(zone, r));
  const head = `<div class="card-head"><h2>Veille</h2></div>`;
  if (typeof v === 'string') {
    zone.innerHTML = html`<section class="card">${head}<p class="hint muted">${v}</p></section>`;
    return;
  }
  const cov = curveDays(v.curve, r);
  const s = cov && standby(v, cov);
  if (!cov || !s) {
    zone.innerHTML = html(`<section class="card">${head}${cov ? '<p class="hint muted">Pas assez de mesures de nuit pour l’estimer.</p>' : noCurve(r)}</section>`);
    return;
  }
  const price = flatPriceAt(r.to); // #252: 16 h peak, 8 h off-peak, under the price mode in force
  const y = standbyYear(s.watts, price);
  const ten = standbyYear(10, price);
  zone.innerHTML = html(`<section class="card" id="standby-card" aria-labelledby="standby-title">
    <div class="card-head"><h2 id="standby-title">Veille</h2></div>
    <p class="meter-big"><span class="big num">${nf0.format(s.watts)} W</span> <span class="muted">en permanence</span></p>
    <p id="curve-talon">Soit ≈ <strong>${nf0.format(y.kwh)} kWh par an</strong>${y.eur !== null ? ` et ≈ <strong>${fmtEur(y.eur)} par an</strong> au prix actuel` : ''}.
    C'est ce que le logement consomme quand tout dort : box, réfrigérateur, ventilation, appareils en ${term('veille')}.</p>
    <p>Chaque 10 W de veille en moins économise ≈ ${nf0.format(ten.kwh)} kWh${ten.eur !== null ? ` (${fmtEur(ten.eur)})` : ''} par an.</p>
    ${counted(`le niveau bas des nuits, de 1 h à 5 h, ${esc(coveredText(cov, 'nuit'))}${s.net ? ', radiateurs et chauffe-eau déduits' : ''}. Courbe de charge du compteur, tout le logement.`)}
  </section>`);
}

// ------------------------------------------------------------------ Journée type
/** The « Journée type » detail page: typical day, busiest half hour, one day's curve. */
export function renderTypical(zone: HTMLElement, r: Range) {
  const v = loaded(() => zone.isConnected && renderTypical(zone, r));
  if (typeof v === 'string') {
    zone.innerHTML = html`<section class="card"><div class="card-head"><h2>Journée type</h2></div><p class="hint muted">${v}</p></section>`;
    return;
  }
  const c = v.curve;
  const cov = curveDays(c, r);
  if (!cov) {
    zone.innerHTML = html(`<section class="card"><div class="card-head"><h2>Journée type</h2></div>${noCurve(r)}</section>`);
    return;
  }
  const first = memo(c, 'first', () => [...c.keys()].reduce((a, b) => (b < a ? b : a)).slice(0, 10));
  const last = memo(c, 'last', () => lastCurveDay(c))!;
  if (!pickedDay || pickedDay < first || pickedDay > last) pickedDay = cov.last;
  zone.innerHTML = html`
  <section class="card" id="curve-card" aria-labelledby="curve-title">
    <div class="card-head">
      <h2 id="curve-title">Journée type</h2>
      <div class="controls">
        <div class="seg" role="radiogroup" aria-label="Jours">
          ${(
            [
              ['weekday', 'Semaine'],
              ['weekend', 'Week-end'],
            ] as const
          )
            .map(([g, l]) => `<button type="button" role="radio" aria-checked="${group === g}" data-curve-group="${g}">${l}</button>`)
            .join('')}
        </div>
      </div>
    </div>
    <p class="hint" id="curve-summary"></p>
    <div class="chart" id="curve-typical" role="img" aria-label="Journée type du logement, par demi-heure"></div>
    <p id="curve-peak"></p>
    <p class="counted" id="curve-counted"></p>
  </section>
  <section class="card" aria-labelledby="curve-day-title">
    <div class="card-head">
      <h2 id="curve-day-title">Une journée</h2>
      <label class="select"><span class="sr-only">Jour affiché</span><input type="date" id="curve-day" value="${pickedDay}" min="${first}" max="${last}"></label>
    </div>
    <div class="chart" id="curve-day-chart" role="img" aria-label="Courbe de charge du jour choisi"></div>
    <p class="hint" id="curve-day-total"></p>
  </section>`;
  zone.querySelectorAll<HTMLButtonElement>('[data-curve-group]').forEach((b) =>
    b.addEventListener('click', () => {
      group = b.dataset.curveGroup as typeof group;
      renderTypical(zone, r);
      zone.querySelector<HTMLElement>(`[data-curve-group="${group}"]`)?.focus();
    }),
  );
  zone.querySelector<HTMLInputElement>('#curve-day')!.addEventListener('change', (e) => {
    const day = (e.target as HTMLInputElement).value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    pickedDay = day;
    if (v.hourly && day < v.since) {
      // an older day than the loaded hourly years: load from that year, then redraw
      const d = ds!;
      void loadHourly(d, day).then(
        (h) => {
          if (ds !== d) return; // #247: another dataset since
          wider = { hourly: h, since: `${day.slice(0, 4)}-01-01` };
          if (zone.isConnected) drawDay(zone, { ...v, hourly: h, since: wider.since });
        },
        () => {}, // that day is drawn without the radiators, as before the load
      );
    }
    drawDay(zone, v);
  });
  drawTypical(v, cov);
  drawPeak(c, cov);
  drawDay(zone, v);
}

function parts(heat: number[] | null, water: number[] | null, total: (number | null)[]) {
  const other = total.map((t, i) => (t === null ? null : Math.max(0, t - (heat?.[i] ?? 0) - (water?.[i] ?? 0))));
  return [
    ...(heat ? [{ name: 'Chauffage', color: catColor('heating'), data: heat.map((x, i) => (total[i] === null ? null : Math.round(Math.min(x, total[i]!)))) }] : []),
    ...(water ? [{ name: 'Eau chaude', color: catColor('water_heater'), data: water.map((x, i) => (total[i] === null ? null : Math.round(x))) }] : []),
    { name: 'Autres usages', color: cssVar('--usage-other'), data: other.map(round) },
  ];
}

function drawTypical(v: Loaded, cov: Coverage) {
  const c = v.curve;
  const typ = memo(c, `typ|${tz()}|${cov.first}|${cov.last}`, () => typicalDay(c, tz(), cov.first, cov.last));
  const total = typ[group];
  const days = memo(c, `days|${cov.first}|${cov.last}`, () => new Set([...c.keys()].map((k) => k.slice(0, 10)).filter((d) => d >= cov.first && d <= cov.last)));
  const heatRooms = rooms('heating');
  const waterRooms = rooms('water_heater');
  const heat = v.hourly && heatRooms.size ? typicalHourlyCached(v.hourly, heatRooms, tz(), days)[group] : null;
  const water = v.hourly && waterRooms.size ? typicalHourlyCached(v.hourly, waterRooms, tz(), days)[group] : null;
  const el = document.getElementById('curve-typical')!;
  areaChart(el, {
    labels: SLOTS,
    areas: heat || water ? parts(heat, water, total) : [],
    lines: [{ name: 'Tout le logement', color: measureColor(), data: total.map(round) }],
    unit: 'W',
  });
  const n = typ.days[group];
  const what = group === 'weekday' ? 'jours de semaine' : 'jours de week-end';
  document.getElementById('curve-counted')!.innerHTML = html(
    countedInner(`la courbe par demi-heure du compteur, tout le logement, ${esc(coveredText(cov))}, dont ${n} ${what}.${
      heat || water ? ' Chauffage et eau chaude : ce que mesurent les radiateurs et le chauffe-eau ; autres usages : le reste.' : ''
    }`),
  );
  const vals = total.map((x, i) => [x, i] as const).filter(([x]) => x !== null) as [number, number][];
  const summary = document.getElementById('curve-summary')!;
  if (!vals.length) {
    summary.textContent = `Pas de ${group === 'weekday' ? 'jour de semaine' : 'jour de week-end'} sur ces dates.`;
    return;
  }
  const [maxW, maxI] = vals.reduce((a, b) => (b[0] > a[0] ? b : a));
  const mean = vals.reduce((s, [x]) => s + x, 0) / vals.length;
  el.setAttribute('aria-label', `Journée type du logement (${group === 'weekday' ? 'semaine' : 'week-end'}), puissance moyenne par demi-heure : ${kw(mean)} en moyenne, maximum ${kw(maxW)} à ${SLOTS[maxI]}.`);
  summary.innerHTML = html`En moyenne <strong>${kw(mean)}</strong>, pointe vers <strong>${hourMin(SLOTS[maxI])}</strong> (${kw(maxW)}).`;
}

function drawPeak(c: Curve, cov: Coverage) {
  const p = memo(c, `peak|${tz()}|${cov.first}|${cov.last}`, () => peakHalfHour(c, tz(), cov.first, cov.last));
  const el = document.getElementById('curve-peak')!;
  if (!p) return;
  const day = p.key.slice(0, 10);
  const kva = periodAt(contracts(), day)?.kva;
  const end = SLOTS[(SLOTS.indexOf(p.key.slice(11, 16)) + 1) % 48];
  el.innerHTML = html`Demi-heure la plus chargée : <strong>${kw(p.watts)}</strong> le ${longDate(day)} de ${hourMin(p.key.slice(11, 16))} à ${hourMin(end)}${
    kva ? ` (${nf0.format((p.watts / 1000 / kva) * 100)} % des ${kva} kVA souscrits)` : ''
  }. Une moyenne sur 30 minutes lisse les appels brefs (four, bouilloire) : pour la puissance souscrite, la « Puissance maximale » du Compteur reste la référence.`;
}

function drawDay(zone: HTMLElement, v: Loaded) {
  const el = zone.querySelector<HTMLElement>('#curve-day-chart');
  if (!el || !pickedDay) return;
  const { labels, values } = dayCurve(v.curve, tz(), pickedDay);
  const dayset = new Set([pickedDay]);
  const g = new Date(`${pickedDay}T00:00:00Z`).getUTCDay() % 6 === 0 ? 'weekend' : 'weekday';
  const heatRooms = rooms('heating');
  const waterRooms = rooms('water_heater');
  const heat = v.hourly && heatRooms.size ? typicalHourlyCached(v.hourly, heatRooms, tz(), dayset)[g] : null;
  const water = v.hourly && waterRooms.size ? typicalHourlyCached(v.hourly, waterRooms, tz(), dayset)[g] : null;
  const any = values.some((x) => x !== null);
  areaChart(el, {
    labels,
    areas: any && (heat || water) ? parts(heat, water, values) : [],
    lines: [{ name: 'Tout le logement', color: measureColor(), data: values.map(round) }],
    unit: 'W',
    zoom: true,
  });
  const vals = values.map((x, i) => [x, i] as const).filter(([x]) => x !== null) as [number, number][];
  const [maxW, maxI] = vals.length ? vals.reduce((a, b) => (b[0] > a[0] ? b : a)) : [0, 0];
  const note = dayNote(curveVsDay(v.curve, tz(), pickedDay, ds!.linky.get(pickedDay)));
  el.setAttribute(
    'aria-label',
    vals.length ? `Courbe de charge du ${longDate(pickedDay)} : maximum ${kw(maxW)} à ${labels[maxI]}.` : `Pas de courbe de charge le ${longDate(pickedDay)}.`,
  );
  // #568: the day total is said once, in the visible text under the chart (not again in the label)
  const total = zone.querySelector<HTMLElement>('#curve-day-total');
  if (total) total.textContent = note;
}
