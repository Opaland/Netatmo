// "Autres usages en détail" card (S-4.12, S-1.17): the Linky rest (total − heating − water
// heater) split into Shelly plugs, appliances declared by hand, the standby base load (talon)
// and what stays unexplained. Loaded on demand by the overview (no weight on first paint).
// Declared appliances stay on this device, encrypted with the data key (like absences).
import type { Hourly } from '../analysis';
import { ds, onDatasetLoaded } from '../app';
import { type Breakdown, type Declared, breakdown, kwhPerYear, parseDeclared, plugsFrom, windowDays } from '../breakdown';
import { cssVar, hbarChart } from '../charts';
import { openLocal, sealLocal } from '../crypto';
import { type Curve, lastCurveDay, measuredWatts, talon } from '../curve';
import { loadCurve, loadHourly } from '../data';
import { readPref, writePref } from '../money';
import { html } from '../trusted';
import { activeRooms, avgPrice, esc, fmtEur, lastDay, longDate, nf0, series, table } from '../ui';

let curve: Curve | null = null;
let hourly: Hourly | null = null;
let declared: Declared[] | null = null;
let loading: Promise<void> | null = null;
let formMsg = '';
onDatasetLoaded(() => {
  curve = hourly = declared = null;
  loading = null;
  formMsg = '';
});

const lsKey = () => `intuis-history:postes:${ds!.source}`;
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const kwh = (v: number) => `${v < 10 ? nf1.format(v) : nf0.format(v)} kWh`;

async function loadDeclared(): Promise<Declared[]> {
  const raw = readPref(lsKey());
  if (!raw) return [];
  try {
    const list = await openLocal<Declared[]>(JSON.parse(raw), ds!.key);
    return Array.isArray(list) ? list.filter((d) => typeof parseDeclared(d.name, String(d.watts), String(d.hours)) !== 'string') : [];
  } catch {
    return []; // written with another passphrase
  }
}

async function saveDeclared(list: Declared[], card: HTMLElement) {
  declared = list;
  try {
    writePref(lsKey(), list.length ? JSON.stringify(await sealLocal(list, ds!.key)) : null);
    formMsg = '';
  } catch {
    formMsg = 'Enregistré jusqu’au verrouillage seulement (clé non exportable).';
  }
  renderBreakdownCard(card);
}

/** kWh per day of one category, from the radiator records. */
function perDay(cat: 'heating' | 'water_heater'): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of ds!.records) if (r.cat === cat) out.set(r.day, (out.get(r.day) ?? 0) + r.kwh);
  return out;
}

/** Standby base load (W) over [from, to], radiators and water heater taken out when possible. */
function talonWatts(from: string, to: string): number | null {
  if (!curve || !lastCurveDay(curve)) return null;
  const tz = ds!.meta.home.timezone || 'Europe/Paris';
  const measured = new Set(activeRooms().map((r) => r.id));
  const minus = hourly && measured.size ? measuredWatts(hourly, measured, tz) : undefined;
  const t = (minus?.byHour.size ? talon(curve, tz, from, to, minus) : null) ?? talon(curve, tz, from, to);
  return t?.watts ?? null;
}

const curveYears = () => !!(ds!.meta as { linky_curve_years?: number[] }).linky_curve_years?.length;

export function renderBreakdownCard(card: HTMLElement) {
  if (!ds) return;
  if (declared === null || (curve === null && curveYears())) {
    loading ??= Promise.all([
      loadDeclared(),
      curveYears() ? loadCurve(ds) : Promise.resolve(new Map<string, number>()),
      loadHourly(ds).catch(() => null),
    ]).then(([d, c, h]) => {
      declared = d;
      curve = c;
      hourly = h;
    });
    loading.then(() => card.isConnected && renderBreakdownCard(card)).catch(() => card.isConnected && card.remove());
    return;
  }
  const days = windowDays(ds.linky, lastDay());
  if (days.length < 7) {
    card.hidden = true;
    return;
  }
  const { plugs, unusable } = plugsFrom(ds.shelly);
  const b = breakdown({
    days,
    linky: ds.linky,
    heating: perDay('heating'),
    water: perDay('water_heater'),
    plugs,
    declared: declared ?? [],
    talonWatts: talonWatts(days[0], days[days.length - 1]),
  });
  card.hidden = false;
  card.innerHTML = html`
    <div class="card-head"><h2>Autres usages en détail <small class="muted">Linky − chauffage − chauffe-eau</small></h2></div>
    <p class="hint muted" id="bd-summary">${summary(b)}</p>
    <div class="chart" id="bd-chart" role="img" aria-label="${esc(ariaLabel(b))}"></div>
    ${partsTable(b)}
    ${notes(b, unusable, plugs.length > 0)}
    <h3>Postes saisis <small class="muted">gardés sur cet appareil, chiffrés</small></h3>
    ${declaredList()}
    <form id="bd-form" class="inline-form" novalidate>
      <label>Poste<input name="name" maxlength="40" autocomplete="off" placeholder="Box internet"></label>
      <label>Puissance (W)<input name="watts" inputmode="decimal" autocomplete="off" placeholder="12"></label>
      <label>Heures par jour<input name="hours" inputmode="decimal" autocomplete="off" placeholder="24"></label>
      <button class="primary small" type="submit">Ajouter</button>
    </form>
    <p class="hint muted" role="status" id="bd-msg">${esc(formMsg)}</p>`;
  drawChart(b);
  card.querySelector<HTMLFormElement>('#bd-form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const d = parseDeclared(String(f.get('name') ?? ''), String(f.get('watts') ?? ''), String(f.get('hours') ?? ''));
    if (typeof d === 'string') {
      card.querySelector('#bd-msg')!.textContent = d;
      return;
    }
    void saveDeclared([...(declared ?? []), d].slice(0, 30), card);
  });
  card.querySelectorAll<HTMLButtonElement>('[data-bd-remove]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.bdRemove);
      void saveDeclared((declared ?? []).filter((_d, j) => j !== i), card);
    }),
  );
}

function summary(b: Breakdown): string {
  const from = b.days[0];
  const to = b.days[b.days.length - 1];
  return `Du ${longDate(from)} au ${longDate(to)} (${b.days.length} jours) : le compteur a relevé ${kwh(b.linky)}, dont chauffage ${kwh(
    b.heating,
  )} et chauffe-eau ${kwh(b.water)}. Il reste <strong>${kwh(b.rest)}</strong> d'autres usages, soit ≈ ${nf0.format(
    (b.rest * 1000) / (b.days.length * 24),
  )} W en moyenne, décomposés ci-dessous.`;
}

function ariaLabel(b: Breakdown): string {
  return `Décomposition des autres usages sur ${b.days.length} jours : ${b.parts
    .filter((p) => p.kwh > 0)
    .map((p) => `${p.name} ${nf0.format(p.kwh)} kWh`)
    .join(', ')}.`;
}

const KIND_LABEL = { plug: 'mesuré (prise Shelly)', declared: 'saisi', talon: 'courbe de charge', unexplained: 'différence' };

function partsTable(b: Breakdown): string {
  const price = avgPrice();
  const rows = b.parts.map((p) => [
    `${esc(p.name)}${p.kind === 'plug' && p.measuredDays! < b.days.length ? ` <small class="muted">(${p.measuredDays} j mesurés)</small>` : ''}`,
    `${KIND_LABEL[p.kind]}${p.permanent && p.kind !== 'talon' ? ', permanent' : ''}`,
    kwh(p.kwh),
    `${nf0.format(p.watts)} W`,
    b.rest ? `${nf0.format((p.kwh / b.rest) * 100)} %` : '—',
    `${nf0.format(kwhPerYear(p.watts))} kWh${price ? ` · ${fmtEur(kwhPerYear(p.watts) * price)}` : ''}`,
  ]);
  return table(['Poste', 'Origine', `${b.days.length} jours`, 'Moyenne', 'Part du reste', 'Par an (rythme actuel)'], rows, 2);
}

function notes(b: Breakdown, unusable: string[], hasPlugs: boolean): string {
  const out: string[] = [];
  if (b.talonWatts !== null) {
    out.push(
      `Talon de nuit (10<sup>e</sup> centile des demi-heures de 1 h à 5 h) : <strong>${nf0.format(b.talonWatts)} W</strong>, soit ${nf0.format(
        kwhPerYear(b.talonWatts),
      )} kWh par an. Les appareils permanents (débit régulier mesuré, ou saisis à 24 h par jour) en sont déduits pour ne pas les compter deux fois ; c'est approximatif (un réfrigérateur fonctionne par cycles).`,
    );
  } else {
    out.push('Sans courbe de charge 30 min, le talon de nuit n’est pas estimé : il reste dans « Non attribué ».');
  }
  if (b.over > 0.05) {
    out.push(`<span class="ko-red">Les postes dépassent le reste de ${kwh(b.over)} : vérifiez les puissances et durées saisies.</span>`);
  }
  if (!hasPlugs) out.push('Aucune prise Shelly avec compteur : ajoutez la clé Shelly Cloud dans Paramètres pour mesurer des appareils.');
  if (unusable.length) {
    out.push(`${esc(unusable.join(', '))} : puissance instantanée seulement, non exploitable sans hub (aucun compteur d'énergie).`);
  }
  return out.map((t) => `<p class="hint muted">${t}</p>`).join('');
}

function declaredList(): string {
  const list = declared ?? [];
  if (!list.length) return '<p class="hint muted">Aucun poste saisi. Exemple : box internet 12 W, 24 h par jour ; four 2 000 W, 0,5 h par jour.</p>';
  return `<ul class="status-list">${list
    .map(
      (d, i) =>
        `<li>${esc(d.name)} · ${nf1.format(d.watts)} W · ${nf1.format(d.hours)} h/j <button type="button" class="link" data-bd-remove="${i}" aria-label="Retirer ${esc(d.name)}">Retirer</button></li>`,
    )
    .join('')}</ul>`;
}

function drawChart(b: Breakdown) {
  const el = document.getElementById('bd-chart');
  if (!el) return;
  const color = (k: string, i: number) =>
    k === 'talon' ? series(0) : k === 'unexplained' ? cssVar('--ghost') : series(i + 2);
  hbarChart(el, {
    labels: b.parts.map((p) => p.name),
    series: [{ name: `kWh sur ${b.days.length} jours`, color: series(2), data: b.parts.map((p) => Math.round(p.kwh * 10) / 10), colors: b.parts.map((p, i) => color(p.kind, i)) }],
    price: avgPrice(),
  });
}
