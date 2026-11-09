// Annual report extras, loaded with import() from views/report.ts (nothing here weighs on
// the entry chunk):
// - S-6.3: offer comparator and maximum power (Linky) of the report year;
// - S-6.4: anonymised report for a third party (pseudonyms, no names, ids, hourly data or station).
import { type DayRecord, MONTHS_SHORT, minusYears, monthlyByYear } from '../aggregate';
import { type AnonReport, anonReportHtml, leaks } from '../anon';
import { daySplits, djuBetween, offPeakShares, roomDeltas } from '../analysis';
import { activeRooms, ds } from '../app';
import { barChart, cssVar, disposeAll } from '../charts';
import { periodAt } from '../offers';
import { offersForYear, offersSectionHtml, pmaxForYear, pmaxSectionHtml } from '../report-sections';
import { contracts, costOf, esc, firstDay, lastDay, offCol, yearColor } from '../ui';
import { html } from '../trusted';
import { leaseWindow, tenant } from '../tenant';

function reportWindow(year: number) {
  const last = lastDay();
  const to = `${year}-12-31` < last ? `${year}-12-31` : last;
  return { from: `${year}-01-01`, to };
}

/** S-6.3: HTML of the two sections (offers, maximum power) for the report year. */
export function extrasHtml(year: number): string {
  if (tenant().on) return ''; // S-12.6: offers and Linky power assume the holder's contract and meter
  const d = ds!;
  const kvaAt = (day: string) => periodAt(contracts(), day)?.kva ?? null;
  let offers = null;
  if (d.offers.size && d.tempo.rows.length) {
    const off = offCol();
    const linky = d.linky.size ? d.linky : null;
    offers = offersForYear(year, {
      splits: daySplits(d.records, d.tariffs, off, offPeakShares(d.tariffs, off), linky),
      kvaAt: (day) => kvaAt(day) ?? 9,
      base: d.offers.get('edf-trv-base') ?? [],
      hphc: d.offers.get('edf-trv-hphc') ?? [],
      tempo: d.tempo.rows,
      tempoDays: d.tempo.days,
      scope: linky ? 'logement' : 'chauffage',
    });
  }
  return offersSectionHtml(offers) + pmaxSectionHtml(d.pmax.size ? pmaxForYear(d.pmax, year, kvaAt) : null);
}

/** S-6.3: fill the placeholder of the full report. */
export function renderReportExtras(el: HTMLElement | null, year: number) {
  if (el && ds) el.innerHTML = html(extrasHtml(year));
}

/** Everything the anonymised report shows, as figures and pseudonymisable ids only. */
/** S-12.6: the lease of a tenant, clipped to the archive, or null. */
const lease = () => (tenant().on ? leaseWindow(tenant(), firstDay(), lastDay()) : null);

/** S-12.6: a tenant with a known lease gets the lease report first. */
export const anonDefault = (year: number): number | 'lease' => (lease() ? 'lease' : year);

function anonData(choice: number | 'lease'): AnonReport {
  const d = ds!;
  const isLease = choice === 'lease' && lease() !== null;
  const { from, to } = isLease ? lease()! : reportWindow(choice === 'lease' ? Number(lastDay().slice(0, 4)) : choice);
  const year = Number(to.slice(0, 4));
  const all = d.records;
  const yr = all.filter((r) => r.day >= from && r.day <= to);
  // A lease is never compared with the days before it (another occupant, or none).
  const prev = isLease ? [] : all.filter((r) => r.day >= `${year - 1}-01-01` && r.day <= minusYears(to));
  const sum = (rs: DayRecord[], cat?: string) => rs.reduce((s, r) => s + (!cat || r.cat === cat ? r.kwh : 0), 0);
  const w = d.weather ? djuBetween(d.weather, from, to) : null;
  const wPrev = d.weather && !isLease ? djuBetween(d.weather, `${year - 1}-01-01`, minusYears(to)) : null;
  const byDay = new Map<string, number>();
  for (const r of yr) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.kwh);
  const peak = [...byDay].reduce<{ day: string; kwh: number } | null>((b, [day, kwh]) => (!b || kwh > b.kwh ? { day, kwh } : b), null);
  const deltas = roomDeltas(isLease ? yr : all, from, to);
  const heatNow = sum(yr, 'heating');
  const heatPrev = sum(prev, 'heating');
  const first = yr[0]?.day ?? from;
  return {
    year,
    years: d.meta.years,
    from: first > from ? first : from,
    to,
    total: sum(yr),
    prevTotal: sum(prev),
    heating: heatNow,
    water: sum(yr, 'water_heater'),
    cost: costOf(all, from, to, true),
    dju: w && w.days ? w.dju : null,
    djuPrev: wPrev && wPrev.days ? wPrev.dju : null,
    climateChange:
      w && wPrev && w.dju > 50 && wPrev.dju > 50 && heatPrev > 0 ? ((heatNow / w.dju) / (heatPrev / wPrev.dju) - 1) * 100 : null,
    peak,
    rooms: activeRooms()
      .filter((r) => deltas.has(r.id))
      .map((r) => ({ id: r.id, category: r.category, now: deltas.get(r.id)!.now, before: deltas.get(r.id)!.before })),
    estimated: [...d.estimated].some((k) => (isLease ? k.slice(-10) >= from && k.slice(-10) <= to : k.slice(-10).startsWith(String(year)))),
    sources: ['Intuis', d.weather ? `météo ${d.meta.weather_source === 'netatmo' ? 'station Netatmo (extérieur)' : 'Open-Meteo'}` : '', (d.linky.size || d.pmax.size) && !tenant().on ? 'compteur Linky' : '']
      .filter(Boolean)
      .join(', '),
    generated: new Date().toISOString().slice(0, 10),
    extras: extrasHtml(year),
    lease: isLease,
    leaseChoice: lease() !== null,
  };
}

/** Names and ids that must never appear in the anonymised report. */
function secrets(): string[] {
  const d = ds!;
  return [
    d.meta.home.name,
    d.meta.home.id,
    ...d.meta.rooms.flatMap((r) => [r.id, r.name]),
    ...Object.entries(d.station?.modules ?? {}).flatMap(([id, m]) => [id, m.name]),
  ];
}

/** S-6.4: replace the content of the report view with the anonymised report. */
export function renderAnonymised(view: HTMLElement, year: number | 'lease') {
  disposeAll(view);
  const data = anonData(year);
  const markup = anonReportHtml(data);
  const found = leaks(markup.replace(/<[^>]+>/g, ' '), secrets());
  if (found.length) {
    // Belt and braces: the report is built from pseudonyms only, but never show a leak.
    view.innerHTML = html`<section class="card report"><p class="stale" role="alert">Rapport anonymisé non affiché : il contiendrait « ${esc(found.join(' », « '))} ». Renommez la pièce ou le logement concerné, ou signalez-le.</p><button type="button" class="link" data-view="report">Rapport complet</button></section>`;
    return;
  }
  view.innerHTML = html(markup);
  const chart = view.querySelector<HTMLElement>('#anon-chart')!;
  if (data.lease) {
    // S-12.6: the months of the lease only
    const months = new Map<string, number>();
    for (const r of ds!.records) if (r.day >= data.from && r.day <= data.to) months.set(r.day.slice(0, 7), (months.get(r.day.slice(0, 7)) ?? 0) + r.kwh);
    const keys = [...months.keys()].sort();
    barChart(chart, {
      labels: keys.map((k) => `${MONTHS_SHORT[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`),
      series: [{ name: 'Bail', color: cssVar('--accent'), data: keys.map((k) => Math.round(months.get(k)!)) }],
      stacked: false,
      price: null,
    });
  } else {
    const y = data.year;
    const m = monthlyByYear(ds!.records);
    barChart(chart, {
      labels: MONTHS_SHORT,
      series: [y - 1, y]
        .filter((v) => m.has(v))
        .map((v) => ({ name: String(v), color: yearColor(v), data: m.get(v)!.map((x) => (x === null ? null : Math.round(x))) })),
      stacked: false,
      price: null,
    });
  }
  view.querySelector<HTMLSelectElement>('[data-anon-year]')!.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    renderAnonymised(view, v === 'lease' ? 'lease' : Number(v));
  });
}
