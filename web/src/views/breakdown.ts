// "Autres usages en détail" page of the Compteur tab (S-4.12, S-1.17): the meter rest (total −
// heating − water heater) split into Shelly plugs, appliances declared by hand, the standby
// (« Veille ») and what stays unexplained, over the tab's period (#301: said on the card).
// Loaded on demand (no weight on first paint).
// Declared appliances stay on this device, encrypted with the data key (like absences).
import type { Hourly } from '../analysis';
import { datasetDoc, ds, onDatasetLoaded } from '../app';
import { addDays, minusYears } from '../aggregate';
import { type Breakdown, type Declared, type Part, breakdown, kwhPerYear, parseDeclared, plugsFrom } from '../breakdown';
import { list, countedNote } from '../components';
import { openLocal, sealLocal } from '../crypto';
import { type Curve, lastCurveDay, measuredWattsCached, talon } from '../curve';
import { type Dataset, loadCurve, loadHourly } from '../data';
import { memo } from '../memo';
import { readPref, writePref } from '../money';
import { html } from '../trusted';
import { coverage, coveredText } from '../meter';
import { activeRooms, avgPrice, esc, fmtEur, lastDay, nf0, table, tableToggle } from '../ui';
import { NS } from '../scope';

// #247: what the card needs, loaded for the dataset shown (a late result of another one is dropped).
const doc = datasetDoc((d) =>
  Promise.all([
    loadDeclared(d),
    curveYears() ? loadCurve(d) : Promise.resolve(new Map<string, number>()),
    // #251: only the hourly years the tab's periods reach (12 months), not the whole history.
    d.linky.size ? loadHourly(d, addDays(minusYears(d.meta.last_day ?? lastDay()), 1)).catch(() => null) : Promise.resolve(null),
  ]),
);
// Set from `doc` at each render; `declared` also by the form (until the dataset changes).
let curve: Curve | null = null;
let hourly: Hourly | null = null;
let declared: Declared[] | null = null;
let formMsg = '';
let range = { from: '', to: '' }; // period of the last render (the form redraws with it)
onDatasetLoaded(() => {
  curve = hourly = declared = null;
  formMsg = '';
});

const lsKey = (d: Pick<Dataset, 'source'> = ds!) => `${NS}:postes:${d.source}`;
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const kwh = (v: number) => `${v < 10 ? nf1.format(v) : nf0.format(v)} kWh`;

async function loadDeclared(d: Dataset): Promise<Declared[]> {
  const raw = readPref(lsKey(d));
  if (!raw) return [];
  try {
    const list = await openLocal<Declared[]>(JSON.parse(raw), d.key);
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
  renderBreakdownCard(card, range);
}

/** kWh per day of one category, from the radiator records (once per dataset). */
function perDay(cat: 'heating' | 'water_heater'): Map<string, number> {
  return memo(ds!.records, `perDay|${cat}`, () => {
    const out = new Map<string, number>();
    for (const r of ds!.records) if (r.cat === cat) out.set(r.day, (out.get(r.day) ?? 0) + r.kwh);
    return out;
  });
}

/** The meter days of the period, in order (once per dataset and period). */
const cardDays = (from: string, to: string) => memo(ds!.linky, `days|${from}|${to}`, () => [...ds!.linky.keys()].filter((d) => d >= from && d <= to).sort());

/** Standby base load (W) over [from, to], radiators and water heater taken out when possible. */
function talonWatts(from: string, to: string): number | null {
  const c = curve;
  if (!c || !memo(c, 'last', () => lastCurveDay(c))) return null;
  const tz = ds!.meta.home.timezone || 'Europe/Paris';
  const measured = new Set(activeRooms().map((r) => r.id));
  // #251: shared with the load-curve card, computed once per window.
  const minus = hourly && measured.size ? measuredWattsCached(hourly, measured, tz, from, to) : undefined;
  const t =
    (minus?.byHour.size ? memo(minus, `talon|${from}|${to}`, () => talon(c, tz, from, to, minus)) : null) ??
    memo(c, `talon|${tz}|${from}|${to}`, () => talon(c, tz, from, to));
  return t?.watts ?? null;
}

const curveYears = () => !!(ds!.meta as { linky_curve_years?: number[] }).linky_curve_years?.length;

export function renderBreakdownCard(card: HTMLElement, r: { from: string; to: string }) {
  if (!ds) return;
  range = r;
  const v = doc.get(ds, () => card.isConnected && renderBreakdownCard(card, r));
  if (!v) {
    if (doc.status(ds) === 'failed') {
      card.hidden = false;
      card.innerHTML = html`<div class="card-head"><h2>Ce qui compose les autres usages</h2></div><p class="hint muted">${
        navigator.onLine ? 'Courbe de charge indisponible.' : 'Courbe de charge : disponible au prochain accès réseau.'
      }</p>`;
    }
    return;
  }
  [declared, curve, hourly] = [declared ?? v[0], v[1], v[2]];
  const days = cardDays(r.from, r.to);
  if (days.length < 7) {
    card.hidden = false;
    card.innerHTML = html`<div class="card-head"><h2>Ce qui compose les autres usages</h2></div><p class="hint muted">Moins de 7 jours relevés par le compteur sur la période : choisissez une période plus longue.</p>`;
    return;
  }
  const { plugs, unusable } = memo(ds, 'plugs', () => plugsFrom(ds!.shelly));
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
    <div class="card-head"><h2>Ce qui compose les autres usages</h2></div>
    <p class="hint" id="bd-summary">${summary(b)}</p>
    <div id="bd-parts">${partsList(b)}</div>
    ${tableToggle(partsTable(b))}
    ${notes(b, unusable, plugs.length > 0)}
    <h3>Postes saisis <small class="muted">gardés sur cet appareil, chiffrés</small></h3>
    ${declaredList()}
    <form id="bd-form" class="inline-form" novalidate>
      <label>Poste<input name="name" maxlength="40" autocomplete="off" placeholder="Box internet"></label>
      <label>Puissance (W)<input name="watts" inputmode="decimal" autocomplete="off" placeholder="12"></label>
      <label>Heures par jour<input name="hours" inputmode="decimal" autocomplete="off" placeholder="24"></label>
      <button class="primary small" type="submit">Ajouter</button>
    </form>
    <p class="hint muted" role="status" id="bd-msg">${esc(formMsg)}</p>
    ${counted(b, plugs.length > 0)}`;
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
  return `Le compteur a relevé ${kwh(b.linky)}, dont chauffage ${kwh(b.heating)} et eau chaude ${kwh(b.water)}. Il reste <strong>${kwh(
    b.rest,
  )}</strong> d'autres usages, soit ≈ ${nf0.format((b.rest * 1000) / (b.days.length * 24))} W en moyenne, décomposés ci-dessous.`;
}

/** #301: what the card counts, on the days of the tab's period that the meter covers. */
function counted(b: Breakdown, hasPlugs: boolean): string {
  const cov = coverage(b.days, range.from, range.to);
  return countedNote(
    `le compteur moins les radiateurs et le chauffe-eau, ${cov ? esc(coveredText(cov)) : ''}${
      hasPlugs ? ' ; une prise mesurée moins longtemps compte à sa moyenne les autres jours' : ''
    } ; les appareils saisis, à leur rythme.`,
  );
}

const KIND_LABEL = { plug: 'mesuré (prise Shelly)', declared: 'saisi', talon: 'nuits, hors appareils permanents', unexplained: 'différence' };

/**
 * #348: the « Veille » row next to the Veille page. That page gives the whole night base load
 * (« 234 W »); here only what the permanent parts above do not already count, so the row says
 * both figures instead of a bare « 0 W ».
 */
function talonSub(b: Breakdown, p: Part): string {
  if (b.talonWatts === null) return `${KIND_LABEL.talon} · ≈ ${nf0.format(p.watts)} W`;
  const all = `veille ${nf0.format(b.talonWatts)} W la nuit`;
  if (b.talonInParts < 1) return `${all}, aucun appareil permanent à déduire`;
  if (p.watts < 1) return `${all}, déjà comptée dans les appareils permanents ci-dessus`;
  return `${all}, dont ${nf0.format(b.talonInParts)} W déjà dans les appareils permanents ci-dessus : reste ≈ ${nf0.format(p.watts)} W`;
}

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
      `Veille (niveau bas des nuits, de 1 h à 5 h, le chiffre de la page Veille) : <strong>${nf0.format(b.talonWatts)} W</strong>, soit ${nf0.format(
        kwhPerYear(b.talonWatts),
      )} kWh par an. Les appareils permanents (débit régulier mesuré, ou saisis à 24 h par jour) tournent aussi la nuit : ${
        b.talonInParts >= 1 ? `${nf0.format(b.talonInParts)} W de cette veille sont déjà dans leurs lignes, ` : ''
      }la ligne « Veille » ne garde que le reste, pour ne rien compter deux fois. C'est approximatif (un réfrigérateur fonctionne par cycles, un circuit du tableau mêle veille et usages de la journée).`,
    );
  } else {
    out.push('Sans courbe de charge du compteur, la veille n’est pas estimée : elle reste dans « Non attribué ».');
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

/**
 * The parts as a list with share bars (#310 component), not a canvas: long names (« Tableau
 * électrique · canal 1 », « Veille ») wrap on one or two lines at 360 px and 200 % text.
 */
function partsList(b: Breakdown): string {
  // #446: one colour per meaning, never a room's. An appliance, measured by a plug or declared, is
  // ink (--series-measure, the colour of a value on its own); its name and « mesuré » / « saisi »
  // tell them apart. Not --series-reference for a declared one: sand 9 is 5 apart (ΔE*ab) from the
  // sand 10 of « Veille » in light, the same step in dark (tokens.test.ts).
  const COLOR: Record<Part['kind'], string> = { plug: '--series-measure', declared: '--series-measure', talon: '--usage-standby', unexplained: '--usage-other' };
  return list(
    b.parts.map((p) => ({
      title: p.name,
      sub: p.kind === 'talon' ? talonSub(b, p) : `${KIND_LABEL[p.kind]} · ≈ ${nf0.format(p.watts)} W`,
      value: kwh(p.kwh),
      color: COLOR[p.kind],
      share: b.rest ? Math.min(100, (p.kwh / b.rest) * 100) : 0,
    })),
    `Décomposition des autres usages, ${b.days.length} jours`,
  );
}
