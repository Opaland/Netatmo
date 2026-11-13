// S-2.10: does the water heater (Intuis Aqua Manager) heat in off-peak hours?
// Off-peak share over 12 months and per month, hours it runs, verdict and the extra
// cost of its peak-hour kWh at the current prices.
import { MONTHS_SHORT, addDays, minusYears } from '../aggregate';
import type { Hourly } from '../analysis';
import { ds, rerender } from '../app';
import { chartCaption, cssVar, gridHeatmap, lineChart } from '../charts';
import { belowThreshold, hcVerdict, hourByMonth, peakExtraCost, waterHeaterHc } from '../checks';
import { activeRooms, esc, fmtEur, fmtKwh, hcHpAt, lastDay, nf0, offCol, table, tableToggle } from '../ui';
import { hour } from '../glossary';
import { html } from '../trusted';
import { lsKey } from '../scope';
import { lazyCard } from '../lazy';
import { statusLine, waiting } from '../components';

const LS_THRESHOLD = lsKey('hc-threshold');
function threshold(): number {
  try {
    const v = Number(localStorage.getItem(LS_THRESHOLD));
    return v >= 50 && v <= 100 ? v / 100 : 0.9;
  } catch {
    return 0.9;
  }
}

/** Current off-peak / peak prices (€/kWh): regulated tariff under today's contract, else manual prices. */
export function currentHcHp(): { hc: number; hp: number; source: string } | null {
  const p = hcHpAt(lastDay()); // #252: one rule (ui.ts)
  if (!p) return null;
  const source = { trve: 'tarif réglementé en vigueur', manual: 'prix saisis', tenant: 'prix moyen saisi (locataire)' }[p.source];
  return { hc: p.hc, hp: p.hp, source };
}

function waterRooms() {
  return activeRooms()
    .filter((r) => r.category === 'water_heater')
    .map((r) => r.id);
}

function twelveMonths(): [string, string] {
  const last = lastDay();
  return [addDays(minusYears(last), 1), last];
}

const pctTxt = (s: number | null) => (s === null ? '—' : `${nf0.format(Math.round(s * 100))} %`);
const monthLabel = (m: string) => `${MONTHS_SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Months below the threshold (12 months), for the "Jours inhabituels" card. */
export function hcAlerts(): string {
  if (!ds!.meta.has_tariffs) return '';
  const [from, to] = twelveMonths();
  const thr = threshold();
  const bad = waterHeaterHc(ds!.tariffs, waterRooms(), offCol(), from, to).months.filter(
    (m) => belowThreshold(m.share, thr) && m.month < to.slice(0, 7), // only finished months
  );
  if (!bad.length) return '';
  return `<p class="hint"><strong>Chauffe-eau :</strong> part en heures creuses sous ${nf0.format(thr * 100)} % en ${bad
    .map((m) => `${monthLabel(m.month)} (${pctTxt(m.share)})`)
    .join(', ')}.</p>`;
}

export function waterHeaterCard(): string {
  const rooms = waterRooms();
  if (!rooms.length || !ds!.meta.has_tariffs) return '';
  const [from, to] = twelveMonths();
  const hc = waterHeaterHc(ds!.tariffs, rooms, offCol(), from, to);
  if (hc.share === null) return '';
  const thr = threshold();
  const v = hcVerdict(hc.share, thr);
  const prices = currentHcHp();
  const extra = prices ? peakExtraCost(hc.peak, prices.hp, prices.hc) : null;
  return `<section class="card" id="waterheater-card">
    <div class="card-head"><h2>Chauffe-eau : heures creuses ? <small class="muted">12 derniers mois</small></h2></div>
    <div class="verdict verdict-${v.ok ? 'low' : 'high'}" role="status">
      <span class="verdict-icon" aria-hidden="true">${v.ok ? '✓' : '!'}</span>
      <div><p class="verdict-title">${esc(v.text)}</p>
      <p class="verdict-sub">${fmtKwh(hc.off)} en heures creuses, ${fmtKwh(hc.peak)} en heures pleines${
        prices && hc.peak > 0
          ? ` · les heures pleines coûtent ${fmtEur(hc.peak * prices.hp)}, soit <strong>${fmtEur(extra!)} de plus</strong> que si tout avait chauffé en heures creuses (${prices.source})`
          : ''
      }.</p></div>
    </div>
    <div class="chart" id="wh-month-chart" style="height:220px" role="img" aria-label="Part en heures creuses du chauffe-eau, par mois"></div>
    ${tableToggle(
      table(
        ['Mois', 'Heures creuses', 'Heures pleines', 'Part HC'],
        hc.months
          .slice()
          .reverse()
          .map((m) => [monthLabel(m.month), fmtKwh(m.off), fmtKwh(m.peak), `${pctTxt(m.share)}${belowThreshold(m.share, thr) ? ' (bas)' : ''}`]),
      ),
    )}
    ${ds!.meta.has_roomstate ? '<p class="hint" id="contactor-line" hidden></p>' : ''}
    <h3>Heures de chauffe <small class="muted">kWh moyens par heure, mois par mois</small></h3>
    <div id="wh-hours">${(ds!.meta.hourly_years ?? []).length ? waiting('des données horaires') : statusLine('Les données horaires arriveront avec la prochaine collecte complète.')}</div>
    <p class="hint muted">Les heures creuses sont la colonne tarifaire où le chauffe-eau consomme le plus (détection automatique). Un mois sous le seuil est signalé dans « Jours inhabituels ».
      <label>Seuil d'alerte <input type="number" id="wh-threshold" min="50" max="100" step="1" value="${Math.round(thr * 100)}" style="width:4.5em"> %</label></p>
  </section>`;
}

/** Draw the charts once the card is in the DOM; `hourly` is null until loaded by the Analyse view. */
export function drawWaterHeater(hourly: Hourly | null) {
  const el = document.getElementById('wh-month-chart');
  if (!el) return;
  // S-13.6: contactor mode from the hourly snapshots (lazy module)
  const line = document.getElementById('contactor-line');
  if (line) void lazyCard(() => import('./offload'), (m) => m.fillContactor(line), { zone: line, what: 'Contacteur du chauffe-eau' });
  const [from, to] = twelveMonths();
  const rooms = waterRooms();
  const hc = waterHeaterHc(ds!.tariffs, rooms, offCol(), from, to);
  const thr = threshold();
  // #306: a line against the alert threshold, on 50 – 100 % and in the water-heater blue
  // (13 bars all at 90 % said nothing); a month under the threshold gets a red point.
  const shares = hc.months.map((m) => (m.share === null ? null : Math.round(m.share * 100)));
  const low = Math.min(50, ...shares.filter((v): v is number => v !== null).map((v) => Math.floor(v / 10) * 10));
  lineChart(el, {
    labels: hc.months.map((m) => monthLabel(m.month)),
    series: [{ name: 'Part en heures creuses', color: cssVar('--usage-water'), data: shares }],
    price: null,
    unit: '%',
    min: low,
    max: 100,
    mark: { value: Math.round(thr * 100), label: `seuil d'alerte ${Math.round(thr * 100)} %` },
  });
  const under = hc.months.filter((m) => belowThreshold(m.share, thr)).map((m) => monthLabel(m.month));
  chartCaption(el, under.length ? `Sous le seuil : ${under.join(', ')}.` : `Tous les mois au-dessus du seuil de ${Math.round(thr * 100)} %.`);
  document.getElementById('wh-threshold')?.addEventListener('change', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (!(v >= 50 && v <= 100)) return;
    try {
      localStorage.setItem(LS_THRESHOLD, String(Math.round(v)));
    } catch {
      /* storage unavailable: keep the default */
    }
    rerender();
  });
  const zone = document.getElementById('wh-hours');
  if (!zone || !hourly) return;
  const g = hourByMonth(hourly, new Set(rooms), from, to);
  if (!g.months.length) {
    zone.innerHTML = html('<p class="hint muted">Pas de données horaires pour le chauffe-eau.</p>');
    return;
  }
  // Hours carrying most of the energy, as a quick reading of the schedule.
  const perHour = new Array(24).fill(0).map((_, h) => g.grid.reduce((s, row) => s + row[h], 0));
  const all = perHour.reduce((a, b) => a + b, 0);
  const top = perHour
    .map((v, h) => [v, h] as const)
    .sort((a, b) => b[0] - a[0])
    .filter((_, i, arr) => arr.slice(0, i).reduce((s, x) => s + x[0], 0) < all * 0.8)
    .map(([, h]) => h)
    .sort((a, b) => a - b);
  zone.innerHTML = html`<p class="hint">80 % de l'énergie passe entre ces heures : <strong>${top.map((h) => `${h} h`).join(', ')}</strong>. Si des heures de journée apparaissent, le chauffe-eau chauffe hors des heures creuses.</p>
    <div class="chart" id="wh-hour-grid" style="height:${Math.max(200, 26 * g.months.length + 60)}px" role="img" aria-label="Consommation du chauffe-eau par heure et par mois"></div>`;
  gridHeatmap(document.getElementById('wh-hour-grid')!, {
    xLabels: Array.from({ length: 24 }, (_, h) => hour(h)),
    yLabels: g.months.map(monthLabel),
    data: g.grid.flatMap((row, y) => row.map((v, x) => [x, y, Math.round(v * 100) / 100] as [number, number, number])),
    unit: 'kWh',
  });
}
