// S-6.4: anonymised annual report, to show to a heating engineer or an energy adviser.
// Pure functions (no DOM, no app state): the view (views/annual-share.ts) gathers the
// figures, this module only ever receives pseudonyms, never names nor identifiers.
// Left out on purpose: home name, ids, room names, hourly data, the weather station
// (a bedroom module tells when people sleep), room temperatures.
import type { Category } from './aggregate';

export interface AnonRoomInput {
  id: string;
  category: Category;
  now: number; // kWh over the year
  before: number; // kWh over the same days of the previous year
}

/** Heating rooms become « Pièce A, B… » by decreasing consumption; water heaters « Chauffe-eau (1, 2…) ». */
export function pseudonyms(rooms: AnonRoomInput[]): Map<string, string> {
  const out = new Map<string, string>();
  const sorted = [...rooms].sort((a, b) => b.now - a.now || (a.id < b.id ? -1 : 1));
  const heating = sorted.filter((r) => r.category !== 'water_heater');
  const water = sorted.filter((r) => r.category === 'water_heater');
  const letter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`);
  heating.forEach((r, i) => out.set(r.id, `Pièce ${letter(i)}`));
  water.forEach((r, i) => out.set(r.id, water.length > 1 ? `Chauffe-eau ${i + 1}` : 'Chauffe-eau'));
  return out;
}

export interface AnonReport {
  year: number;
  years: number[]; // for the year selector
  from: string;
  to: string;
  total: number;
  prevTotal: number;
  heating: number;
  water: number;
  cost: number | null;
  dju: number | null;
  djuPrev: number | null;
  climateChange: number | null; // % change of heating kWh per degree-day vs N-1
  peak: { day: string; kwh: number } | null;
  rooms: AnonRoomInput[];
  estimated: boolean;
  sources: string;
  generated: string; // YYYY-MM-DD
  extras: string; // anonymous HTML sections (offers, maximum power)
  /** S-12.6: the report covers the lease only (no comparison with a previous occupant's year). */
  lease?: boolean;
  /** S-12.6: a lease period can be chosen in the selector. */
  leaseChoice?: boolean;
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const kwh = (v: number) => `${nf0.format(v)} kWh`;
const longDate = (d: string) => `${Number(d.slice(8, 10)) === 1 ? '1er' : Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const pct = (p: number) => {
  const r = Math.round(p);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${nf0.format(Math.abs(r))} %`;
};
const change = (now: number, before: number) => (before > 0 ? pct((now / before - 1) * 100) : '—');
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;

export function anonReportHtml(r: AnonReport): string {
  const names = pseudonyms(r.rooms);
  const rows = [...r.rooms].sort((a, b) => b.now - a.now);
  const share = (v: number) => nf0.format((v / Math.max(r.total, 1)) * 100);
  const top = rows.find((x) => x.category !== 'water_heater');
  const lease = !!r.lease;
  return `
  <section class="card report anon-report">
    <style>@media print { @page { margin: 0; } .anon-report { padding: 14mm 16mm; } }</style>
    <div class="card-head no-print">
      <h2>Rapport anonymisé</h2>
      <div class="controls">
        <label class="select"><span class="sr-only">Période</span><select data-anon-year>${r.leaseChoice ? `<option value="lease" ${lease ? 'selected' : ''}>Période du bail</option>` : ''}${r.years
          .slice()
          .reverse()
          .map((y) => `<option value="${y}" ${!lease && y === r.year ? 'selected' : ''}>${y}</option>`)
          .join('')}</select></label>
        <button type="button" class="primary small" id="print">Imprimer / PDF</button>
        <a class="link" href="#rapport">Rapport complet</a>
      </div>
    </div>
    <p class="hint muted no-print">À remettre à un tiers (chauffagiste, conseiller, futur occupant${lease ? ', bailleur' : ''}) : ni nom de logement, ni adresse, ni coordonnées, ni identifiant, ni nom de pièce, ni donnée horaire, ni relevé de la station météo. Dans la boîte d'impression, décochez « En-têtes et pieds de page » si l'adresse du site s'y affiche.</p>
    <h1 class="report-title">${lease ? 'Bilan énergie de la période du bail' : `Bilan énergie ${r.year}`} — logement chauffé à l'électricité</h1>
    <p><strong>Période</strong> : du ${longDate(r.from)} au ${longDate(r.to)} (${daysBetween(r.from, r.to)} jours)${
      lease ? ', <strong>période du bail uniquement</strong> : aucun jour avant ou après n\'est compté.' : `, comparée aux mêmes jours de ${r.year - 1}.`
    }</p>
    <div class="kpis">
      <article class="kpi"><h3>Consommation</h3><p class="kpi-value">${kwh(r.total)}</p>${lease ? '' : `<p class="kpi-sub">${change(r.total, r.prevTotal)} vs ${r.year - 1}</p>`}</article>
      ${r.cost !== null ? `<article class="kpi"><h3>Coût estimé (abonnement inclus)</h3><p class="kpi-value">${nf0.format(r.cost)} €</p></article>` : ''}
      <article class="kpi"><h3>Chauffage / chauffe-eau</h3><p class="kpi-value">${share(r.heating)} % / ${share(r.water)} %</p><p class="kpi-sub">${kwh(r.heating)} · ${kwh(r.water)}</p></article>
      ${r.dju !== null ? `<article class="kpi"><h3>Rigueur de l'hiver (DJU)</h3><p class="kpi-value">${nf0.format(r.dju)}</p>${r.djuPrev && !lease ? `<p class="kpi-sub">${change(r.dju, r.djuPrev)} vs ${r.year - 1}</p>` : ''}</article>` : ''}
    </div>
    <h3>Faits marquants</h3>
    <ul class="facts">
      ${r.peak ? `<li>Jour le plus consommateur : <strong>${longDate(r.peak.day)}</strong> (${kwh(r.peak.kwh)}).</li>` : ''}
      ${top ? `<li>Pièce la plus consommatrice : <strong>${names.get(top.id)}</strong> (${kwh(top.now)}).</li>` : ''}
      ${r.climateChange !== null && !lease ? `<li>À climat égal, le chauffage a évolué de <strong>${pct(r.climateChange)}</strong> par degré-jour par rapport à ${r.year - 1}.</li>` : ''}
      ${r.estimated ? `<li class="muted">Certains jours de ${lease ? 'la période' : r.year} ont été reconstitués à partir des totaux mensuels du serveur (jours estimés).</li>` : ''}
    </ul>
    <h3>Mois par mois</h3>
    <div class="chart" id="anon-chart" role="img" aria-label="${lease ? 'Consommation mensuelle sur la période du bail' : 'Consommation mensuelle comparée à l\'année précédente'}"></div>
    <h3>Par pièce <small class="muted">pseudonymes</small></h3>
    <div class="table-wrap" tabindex="0"><table><thead><tr><th>Pièce</th>${
      lease ? '<th class="num">kWh</th><th class="num">Part</th>' : `<th class="num">${r.year} kWh</th><th class="num">${r.year - 1} kWh</th><th class="num">Évolution</th>`
    }</tr></thead><tbody>${rows
      .map(
        (x) =>
          `<tr><td>${names.get(x.id)}</td><td class="num">${nf0.format(x.now)}</td>${
            lease ? `<td class="num">${share(x.now)} %</td>` : `<td class="num">${nf0.format(x.before)}</td><td class="num">${change(x.now, x.before)}</td>`
          }</tr>`,
      )
      .join('')}</tbody></table></div>
    ${r.extras}
    <p class="hint muted">Document anonymisé généré le ${longDate(r.generated)} par l'application Historique énergie (sources : ${r.sources}). Pièces désignées par des pseudonymes ; aucune adresse, coordonnée, identifiant ni donnée horaire.</p>
  </section>`;
}

/** Labels the report writes itself: a room called like one of them is not a leak. */
const OWN_WORDS = new Set(['chauffe-eau', 'chauffage', 'logement', 'pièce', 'maison', 'électricité']);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Secrets (names, ids) found in the text as whole words; short or generic ones are ignored. */
export function leaks(text: string, secrets: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const s of secrets) {
    const v = s?.trim();
    if (!v || v.length < 3 || OWN_WORDS.has(v.toLowerCase())) continue;
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(v)}($|[^\\p{L}\\p{N}])`, 'u').test(text)) found.add(v);
  }
  return [...found];
}
