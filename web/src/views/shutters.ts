// S-9.6: « Volets fermés ce soir » card of the Analyse tab (lazy module).
// Notes stay on this device (localStorage), exportable / importable as CSV; the
// comparison with the night signature appears once enough evenings are noted.
import { addDays, minusYears } from '../aggregate';
import { ds } from '../app';
import { cssVar, scatterChart } from '../charts';
import { loadHourly } from '../data';
import { unavailable } from '../offline';
import {
  MIN_CLOSED,
  type ShutterComparison,
  compareShutters,
  loadNotes,
  nights,
  notesCsv,
  parseNotesCsv,
  saveNotes,
} from '../shutters';
import { html } from '../trusted';
import { activeRooms, esc, fmtKwh, lastDay, longDate, table } from '../ui';

const num1 = (v: number) => v.toFixed(1).replace('.', ',');
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num1(Math.abs(v))}`;
/** Today in the device's time zone (the evening being noted). */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let notes: string[] = [];
let msg = '';

/** Fill the zone with the card and keep it up to date by itself (no global re-render). */
export function renderShutters(zone: HTMLElement) {
  if (zone.dataset.bound) return; // two renders resolved the lazy import: draw once
  zone.dataset.bound = '1';
  notes = loadNotes();
  draw(zone);
  zone.addEventListener('change', (e) => onChange(zone, e.target as HTMLInputElement));
  zone.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-shutters]');
    if (btn) onClick(zone, btn);
  });
}

function draw(zone: HTMLElement) {
  const t = today();
  const recent = notes.slice(-8).reverse();
  zone.innerHTML = html`<section class="card" id="shutters-card">
    <div class="card-head"><h2>Volets fermés le soir <small class="muted">journal de cet appareil</small></h2></div>
    <label class="check"><input type="checkbox" data-shutters="tonight" ${notes.includes(t) ? 'checked' : ''}> Volets fermés ce soir (${esc(longDate(t))})</label>
    <div class="controls" style="align-items:center;margin:6px 0">
      <label>Autre soir <input type="date" data-shutters="day" max="${t}" value="${addDays(t, -1)}" style="padding:6px;border:1px solid var(--border);border-radius:8px;background:var(--surface-card)"></label>
      <button type="button" class="primary small" data-shutters="add">Noter</button>
    </div>
    <p class="hint muted">${notes.length ? `${notes.length} soir${notes.length > 1 ? 's' : ''} noté${notes.length > 1 ? 's' : ''}` : 'Aucun soir noté.'}
      Les notes restent sur cet appareil (rien n'est envoyé) : exportez-les pour les garder ou les reprendre sur un autre appareil.</p>
    ${
      recent.length
        ? `<ul class="shutters-list" style="margin:.25rem 0;padding-left:1.2rem">${recent
            .map((d) => `<li>${esc(longDate(d))} <button type="button" class="link" data-shutters="del" data-day="${d}" aria-label="Retirer le ${esc(longDate(d))}">retirer</button></li>`)
            .join('')}</ul>`
        : ''
    }
    <div class="rooms-actions">
      <button type="button" data-shutters="export" ${notes.length ? '' : 'disabled'}>Exporter (CSV)</button>
      <button type="button" data-shutters="pick">Importer un CSV</button>
      <input type="file" accept=".csv,text/csv,text/plain" data-shutters="import" hidden>
    </div>
    ${msg ? `<p class="hint" role="status">${esc(msg)}</p>` : ''}
    <div id="shutters-result" aria-live="polite"></div>
  </section>`;
  msg = '';
  void drawComparison();
}

async function drawComparison() {
  const out = document.getElementById('shutters-result');
  if (!out || !ds) return;
  if (!ds.weather) return void (out.innerHTML = html('<p class="hint muted">La comparaison demande la météo (prochaine collecte).</p>'));
  if (!(ds.meta.hourly_years ?? []).length) {
    out.innerHTML = html('<p class="hint muted">La comparaison demande les données horaires (prochaine collecte complète).</p>');
    return;
  }
  out.innerHTML = html('<p class="hint muted">Chargement des données horaires…</p>');
  const d = ds;
  const weather = ds.weather;
  let hourly;
  try {
    hourly = await loadHourly(d, addDays(minusYears(lastDay()), 1)); // #251: the 12 months compared below
  } catch {
    if (ds === d) out.innerHTML = html(`<p class="hint muted">${esc(unavailable('Données horaires'))}</p>`);
    return;
  }
  if (ds !== d) return; // #247: locked or another dataset since: the hourly data belong to the old one
  const last = lastDay();
  const heat = activeRooms().filter((r) => r.category === 'heating').map((r) => r.id);
  const all = nights(hourly, heat, weather, new Set(notes), addDays(minusYears(last), 1), last);
  const cmp = compareShutters(all);
  if (!document.body.contains(out)) return;
  if (!cmp) {
    const n = all.filter((x) => x.closed && x.t < 15).length;
    out.innerHTML = html`<p class="hint muted">Comparaison avec / sans volets fermés dès ${MIN_CLOSED} soirs notés en période de chauffe avec données horaires (${n} pour l'instant) ; comptez environ 4 semaines en alternant les soirs.</p>`;
    return;
  }
  out.innerHTML = html(result(cmp));
  const el = document.getElementById('shutters-chart');
  if (!el) return;
  const xs = [...cmp.open, ...cmp.closed].map((n) => n.t);
  scatterChart(el, {
    xName: 'Température extérieure moyenne (°C)',
    yName: 'kWh, nuit 22 h → 7 h',
    series: [
      {
        name: 'Volets ouverts',
        color: cssVar('--text-muted'),
        points: cmp.open.map((n) => [n.t, Math.round(n.kwh * 100) / 100, n.day]),
        fit: { slope: cmp.fit.slope, intercept: cmp.fit.intercept, from: Math.min(...xs), to: Math.min(15, Math.max(...xs), cmp.fit.balance ?? 15) },
      },
      { name: 'Volets fermés', color: cssVar('--accent'), points: cmp.closed.map((n) => [n.t, Math.round(n.kwh * 100) / 100, n.day]) },
    ],
  });
}

function result(c: ShutterComparison) {
  const verdict = c.significant
    ? c.gap < 0
      ? `Les soirs volets fermés, le chauffage de nuit est <strong>plus bas de ${fmtKwh(-c.gap)}</strong> que ne le prévoit la température extérieure, par rapport aux autres soirs`
      : `Les soirs volets fermés, le chauffage de nuit est <strong>plus haut de ${fmtKwh(c.gap)}</strong> que ne le prévoit la température extérieure, par rapport aux autres soirs`
    : `<strong>Pas d'écart mesurable</strong> pour l'instant : l'écart (${signed(c.gap)} kWh par nuit) reste dans la marge d'incertitude`;
  return `<p>${verdict}${c.gapPct !== null ? ` (${signed(c.gapPct)} %)` : ''}, à ± ${num1(c.ci95)} kWh près (intervalle à 95 %).</p>
    ${table(
      ['Nuits de chauffe, 12 mois', 'Nombre', 'kWh moyens par nuit', 'Écart à la signature'],
      [
        ['Volets fermés', c.closed.length, num1(c.meanClosed), `${signed(c.gap)} kWh`],
        ['Volets ouverts (référence)', c.open.length, num1(c.meanOpen), '0'],
      ],
    )}
    <div class="chart" id="shutters-chart" role="img" aria-label="Chauffage de nuit selon la température extérieure, volets fermés ou non"></div>
    <details class="table-details"><summary>Méthode</summary>
      <p class="hint">Chauffage (toutes les pièces chauffées, données horaires) de 22 h à 7 h après chaque soir, face à la moyenne des températures extérieures des deux jours. La droite (signature de nuit) est calculée sur les nuits sans note ; chaque nuit est comparée à cette droite, puis on compare l'écart moyen des nuits volets fermés à celui des autres. L'intervalle à 95 % vaut 1,96 fois l'erreur type de la différence : un écart plus petit que lui peut venir du hasard (vent, soleil, présence). Une nuit sans note compte comme volets ouverts : notez aussi les soirs où vous les fermez sans y penser. Ensoleillement, absences et consignes modifiées ne sont pas corrigés.</p>
    </details>`;
}

function update(zone: HTMLElement, next: string[], text = '') {
  notes = saveNotes(next);
  msg = text;
  draw(zone);
}

function onClick(zone: HTMLElement, btn: HTMLButtonElement) {
  const action = btn.dataset.shutters;
  if (action === 'add') {
    const day = zone.querySelector<HTMLInputElement>('[data-shutters=day]')?.value ?? '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) update(zone, [...notes, day], `Soir du ${longDate(day)} noté.`);
  } else if (action === 'del' && btn.dataset.day) {
    update(zone, notes.filter((d) => d !== btn.dataset.day));
  } else if (action === 'pick') {
    zone.querySelector<HTMLInputElement>('[data-shutters=import]')?.click();
  } else if (action === 'export') {
    const blob = new Blob(['﻿' + notesCsv(notes)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `volets-fermes-${today()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

function onChange(zone: HTMLElement, t: HTMLInputElement) {
  if (t.dataset.shutters === 'tonight') {
    const d = today();
    update(zone, t.checked ? [...notes, d] : notes.filter((x) => x !== d));
  } else if (t.dataset.shutters === 'import' && t.files?.[0]) {
    void t.files[0].text().then((text) => {
      const days = parseNotesCsv(text);
      update(zone, [...notes, ...days], days.length ? `${days.length} soir(s) importé(s).` : 'Aucune date trouvée dans ce fichier.');
    });
  }
}
