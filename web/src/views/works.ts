// Analyse, loaded on demand: room surfaces and dated works markers (S-6.2).
// Fills the placeholder #works-zone left by analyse.ts: signature before / after the
// chosen marker (two lines), kWh/m², monthly heating with the markers drawn on it.
// Surfaces and markers stay on this device, encrypted with the data key (local-store.ts).
import { type DayRecord, addDays, bucketKey, bucketKeys, bucketLabel, minusYears } from '../aggregate';
import { ds, onDatasetLoaded } from '../app';
import { barChart, chartOf, cssVar, scatterChart } from '../charts';
import { loadNote, saveNote } from '../local-store';
import { BEDROOMS_ID, displaySurfaces } from '../household';
import { html } from '../trusted';
import { onCard } from '../events';
import { activeRooms, catColor, esc, firstDay, fmtKwh, lastDay, longDate, nf0, pct, table, referenceColor } from '../ui';
import {
  type HomeWorks,
  MAX_SURFACE,
  MIN_SIDE_DAYS,
  type Marker,
  NO_WORKS,
  type Side,
  WORK_KINDS,
  type WorkKind,
  beforeAfter,
  heatPerDay,
  perRoomM2,
  sortMarkers,
  surfaceOf,
  validWorks,
} from '../works';

const NOTE = 'works';
let works: HomeWorks | null = null;
let persisted = true;
let chosen: string | null = null; // marker day shown in the before / after chart
onDatasetLoaded(() => {
  works = null;
  persisted = true;
  chosen = null;
});

/** Surfaces and markers of this dataset (also used by the research export, S-6.6). */
export async function loadWorks(): Promise<HomeWorks> {
  if (works) return works;
  const d = ds!;
  const w = await loadNote(NOTE, d.source, d.key, validWorks, NO_WORKS);
  if (ds === d) works = w; // #247: never another dataset's notes
  return w;
}

let lastRecords: DayRecord[] = [];

/** Called by analyse.ts once this module is loaded. */
export async function fillWorks(records: DayRecord[]) {
  lastRecords = records;
  const d = ds;
  await loadWorks();
  if (ds === d) draw(); // #247: else the new dataset's render fills its own card
}

function draw(keepGrid = false) {
  const el = document.getElementById('works-zone') ?? document.getElementById('works-card');
  if (!el || !ds) return;
  const grid = keepGrid ? el.querySelector('#works-surfaces > .works-surfaces') : null;
  if (grid) patchAround(el, card(), grid);
  else el.outerHTML = html(card());
  drawCharts();
}

/**
 * #462: redraw the card around the grid of surfaces, which stays the same element: the field
 * being typed in keeps its focus and caret (a whole redraw dropped them at each value, and the
 * phone keyboard's « next » landed nowhere). Every ancestor of the grid up to the card is kept
 * too; their other children are replaced by the fresh ones, in order.
 */
function patchAround(card: Element, fresh: string, grid: Element) {
  const t = document.createElement('template');
  t.innerHTML = html(fresh);
  const freshCard = t.content.firstElementChild;
  let keep: Element = grid;
  let freshKeep: Element | null | undefined = freshCard?.querySelector('#works-surfaces > .works-surfaces');
  if (!freshCard || !freshKeep) return void (card.outerHTML = html(fresh));
  while (keep !== card) {
    const parent: Element = keep.parentElement!;
    const freshParent: Element = freshKeep.parentElement!;
    // a fold the reader opened stays open (`open` is theirs, not the template's)
    for (const a of [...parent.attributes]) if (a.name !== 'open' && !freshParent.hasAttribute(a.name)) parent.removeAttribute(a.name);
    for (const a of [...freshParent.attributes]) parent.setAttribute(a.name, a.value);
    for (const c of [...parent.childNodes]) if (c !== keep) c.remove();
    const nodes = [...freshParent.childNodes];
    const at = nodes.indexOf(freshKeep);
    keep.before(...nodes.slice(0, at));
    keep.after(...nodes.slice(at + 1));
    keep = parent;
    freshKeep = freshParent;
  }
}

const num1 = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const markerName = (m: Marker) => `${WORK_KINDS[m.kind]}${m.label ? ` — ${m.label}` : ''}`;

function heatingRooms() {
  const inRecords = new Set(lastRecords.map((r) => r.room));
  return activeRooms().filter((r) => r.category === 'heating' && inRecords.has(r.id));
}

/** #243: surfaces are stored by raw room id; « Chambres » gets the sum of its bedrooms. */
const shownSurfaces = () => displaySurfaces(ds!, works!.surfaces);

function current(): Marker | null {
  const list = works!.markers;
  return list.find((m) => m.day === chosen) ?? list[list.length - 1] ?? null;
}

function compare() {
  const m = current();
  if (!m || !ds!.weather) return null;
  const rooms = heatingRooms().map((r) => r.id);
  const surf = surfaceOf(shownSurfaces(), rooms);
  const m2 = surf.known === rooms.length && surf.m2 > 0 ? surf.m2 : null;
  return { m, m2, surf, rooms, r: beforeAfter(heatPerDay(lastRecords), ds!.weather, m.day, firstDay(), lastDay(), m2) };
}

function sideRow(name: string, s: Side | null, m2: number | null): (string | number)[] {
  if (!s) return [name, 'pas assez de jours de chauffe', '—', '—', '—', '—'];
  return [
    `${name} <small class="muted">${longDate(s.from)} → ${longDate(s.to)}</small>`,
    nf0.format(s.days),
    s.fit ? `${num1(-s.fit.slope)} kWh/°C` : '—',
    fmtKwh(s.kwh),
    m2 && s.perM2 !== null ? `${num1(s.perM2)} kWh/m²` : '—',
    s.perDjuM2 !== null ? `${num1(s.perDjuM2)} Wh/DJU${m2 ? '/m²' : ''}` : '—',
  ];
}

function card(): string {
  const w = works!;
  const rooms = heatingRooms();
  const c = compare();
  const last = lastDay();
  const from12 = addDays(minusYears(last), 1);
  const shown = shownSurfaces();
  const perRoom = perRoomM2(lastRecords, shown, from12, last);
  const surf = surfaceOf(shown, rooms.map((r) => r.id));
  const heat12 = lastRecords.filter((r) => r.cat === 'heating' && r.day >= from12 && shown[r.room]).reduce((s, r) => s + r.kwh, 0);
  return `<section class="card" id="works-card">
    <div class="card-head"><h2>Travaux et surfaces <small class="muted">avant / après</small></h2>
      ${
        w.markers.length > 1
          ? `<div class="controls"><label class="select"><span class="sr-only">Travaux comparés</span><select id="works-pick">${w.markers
              .map((m) => `<option value="${m.day}" ${m.day === c?.m.day ? 'selected' : ''}>${longDate(m.day)} · ${esc(markerName(m))}</option>`)
              .join('')}</select></label></div>`
          : ''
      }
    </div>
    ${
      !w.markers.length
        ? '<p class="hint muted">Ajoutez la date de travaux (isolation, nouvelles fenêtres, radiateur changé, pompe à chaleur…) : l\'appli trace la signature énergétique avant et après, et ramène le chauffage au m² et au degré-jour.</p>'
        : !ds!.weather
          ? '<p class="hint muted">La comparaison avant / après a besoin de la météo (prochaine collecte).</p>'
          : `<p>${
              c!.r.change !== null
                ? `À climat égal (par degré-jour), le chauffage a évolué de <strong>${pct(c!.r.change)}</strong> après « ${esc(markerName(c!.m))} » du ${longDate(c!.m.day)}.`
                : `Comparaison avant / après « ${esc(markerName(c!.m))} » du ${longDate(c!.m.day)} : il faut au moins ${MIN_SIDE_DAYS} jours de chauffe de chaque côté.`
            }</p>
    <div class="chart tall" id="works-sig-chart" role="img" aria-label="Signature énergétique avant et après les travaux"></div>
    ${table(['Période', 'Jours', 'Pente', 'Chauffage', 'Par m²', 'Par degré-jour'], [sideRow('Avant', c!.r.before, c!.m2), sideRow('Après', c!.r.after, c!.m2)])}
    ${c!.m2 === null ? `<p class="hint muted">Renseignez la surface de ${rooms.length > 1 ? 'toutes les pièces chauffées' : 'la pièce'} (ci-dessous) pour avoir les kWh/m²${surf.known ? ` (${surf.known}/${rooms.length} renseignées)` : ''}.</p>` : ''}`
    }
    <h3 class="money-h">Chauffage par mois <small class="muted">les travaux en traits verticaux</small></h3>
    <div class="chart" id="works-chart" role="img" aria-label="Chauffage par mois et dates des travaux"></div>
    ${
      w.markers.length
        ? `<ul class="absence-list">${w.markers
            .map(
              (m, i) => `<li><div><strong>${longDate(m.day)}</strong> · ${esc(markerName(m))}</div><button type="button" class="link" data-works-del="${i}">Retirer</button></li>`,
            )
            .join('')}</ul>`
        : ''
    }
    <div class="absence-add">
      <label class="money-field">Date des travaux <input type="date" id="works-day" min="${firstDay()}" max="${addDays(last, 366)}"></label>
      <label class="money-field">Nature <select id="works-kind">${Object.entries(WORK_KINDS)
        .map(([k, l]) => `<option value="${k}">${esc(l)}</option>`)
        .join('')}</select></label>
      <label class="money-field">Précision <small>(facultatif)</small> <input type="text" id="works-label" maxlength="80" autocomplete="off"></label>
      <button type="button" class="primary small" id="works-add">Ajouter</button>
    </div>
    <p class="hint" id="works-msg" role="status"></p>
    <details class="table-details" id="works-surfaces"><summary>Surfaces des pièces chauffées${surf.known ? ` · ${num1(surf.m2)} m² (${surf.known}/${rooms.length})` : ''}</summary>
      <div class="works-surfaces">${rooms
        .map(
          (r) =>
            `<label class="money-field">${esc(r.name)} (m²) <input type="number" min="1" max="${MAX_SURFACE}" step="0.5" inputmode="decimal" data-works-surface="${esc(r.id)}" value="${shown[r.id] ?? ''}"${r.id === BEDROOMS_ID ? ' disabled title="Surface des chambres : affichez leur détail pour la saisir"' : ''}></label>`,
        )
        .join('')}</div>
      ${
        perRoom.size
          ? `<p>12 derniers mois : <strong>${num1(heat12 / Math.max(1, surf.m2))} kWh/m²</strong> de chauffage sur les pièces renseignées.</p>
        ${table(
          ['Pièce', 'Surface', 'Chauffage 12 mois', 'Par m²'],
          rooms.filter((r) => perRoom.has(r.id)).map((r) => {
            const p = perRoom.get(r.id)!;
            return [esc(r.name), `${num1(p.m2)} m²`, fmtKwh(p.kwh), `${num1(p.perM2)} kWh/m²`];
          }),
        )}`
          : ''
      }
    </details>
    ${persisted ? '' : '<p class="hint muted">Ces saisies dureront jusqu\'au verrouillage : reconnectez-vous avec la phrase de passe pour qu\'elles soient enregistrées (chiffrées) sur cet appareil.</p>'}
    <details class="table-details"><summary>Comment c'est calculé</summary>
      <p class="hint">Avant : les 365 jours qui précèdent la date des travaux ; après : les 365 jours qui la suivent (date comprise), dans la limite des données. Chaque côté a sa droite de signature (chauffage du jour selon la température extérieure moyenne, jours sous 15 °C). « Par degré-jour » divise le chauffage par les degrés-jours (base 18 °C) des mêmes jours : c'est la comparaison à climat égal. Les filtres de pièces s'appliquent.</p>
      <p class="hint muted">Surfaces et travaux restent sur cet appareil, chiffrés avec votre phrase de passe : ils ne sont ni envoyés à GitHub, ni à l'IA, et un autre appareil ne les voit pas. L'export recherche n'en garde que la nature et la surface, jamais la précision saisie.</p>
    </details>
  </section>`;
}

function drawCharts() {
  const c = compare();
  const sig = document.getElementById('works-sig-chart');
  if (sig && c) {
    const sides: [string, Side | null, string][] = [
      ['Avant', c.r.before, referenceColor()],
      ['Après', c.r.after, cssVar('--series-measure')],
    ];
    scatterChart(sig, {
      xName: 'Température extérieure moyenne (°C)',
      yName: 'kWh / jour',
      series: sides
        .filter(([, s]) => s)
        .map(([name, s, color]) => {
          const xs = s!.points.map((p) => p[0]);
          return {
            name,
            color,
            points: s!.points,
            fit: s!.fit ? { slope: s!.fit.slope, intercept: s!.fit.intercept, from: Math.min(...xs), to: Math.min(15, s!.fit.balance ?? 15) } : null,
          };
        }),
    });
  }
  const el = document.getElementById('works-chart');
  if (!el) return;
  const keys = bucketKeys(firstDay(), lastDay(), 'month');
  const perMonth = new Map<string, number>();
  for (const r of lastRecords) if (r.cat === 'heating') perMonth.set(bucketKey(r.day, 'month'), (perMonth.get(bucketKey(r.day, 'month')) ?? 0) + r.kwh);
  const labels = keys.map((k) => bucketLabel(k, 'month'));
  barChart(el, {
    labels,
    series: [{ name: 'Chauffage', color: catColor('heating'), data: keys.map((k) => (perMonth.has(k) ? Math.round(perMonth.get(k)!) : null)) }],
    stacked: false,
    price: null,
  });
  // The markers, as vertical lines on their month (merged when two fall in the same month).
  const byMonth = new Map<string, string[]>();
  for (const m of works!.markers) {
    const k = bucketKey(m.day, 'month');
    if (keys.includes(k)) byMonth.set(k, [...(byMonth.get(k) ?? []), WORK_KINDS[m.kind].split(' (')[0]]);
  }
  const chart = chartOf(el);
  if (byMonth.size) {
    const ink = cssVar('--text');
    chart.setOption({
      series: [
        {
          markLine: {
            symbol: 'none',
            silent: true,
            lineStyle: { color: ink, type: 'dashed', width: 1.5 },
            label: { color: ink, formatter: (p: { name: string }) => p.name, position: 'insideEndTop' },
            data: [...byMonth].map(([k, names]) => ({ xAxis: bucketLabel(k, 'month'), name: names.join(', ') })),
          },
        },
      ],
    });
    el.setAttribute('aria-label', `${el.getAttribute('aria-label')} Travaux : ${works!.markers.map((m) => `${longDate(m.day)} (${WORK_KINDS[m.kind]})`).join(', ')}.`);
  }
}

async function save(next: HomeWorks, keepGrid = false) {
  works = next;
  persisted = await saveNote(NOTE, ds!.source, ds!.key, next);
  draw(keepGrid);
}

// #257: the controls of the card, dispatched by main.ts (no `onclick =` on the elements).
onCard({
  change(t) {
    if (!works) return false;
    if (t.id === 'works-pick') {
      chosen = t.value;
      draw();
      return true;
    }
    if (t instanceof HTMLInputElement && t.dataset.worksSurface !== undefined) {
      const v = Number(t.value.replace(',', '.'));
      const surfaces = { ...works.surfaces };
      if (t.value === '' || !(v > 0 && v <= MAX_SURFACE)) delete surfaces[t.dataset.worksSurface];
      else surfaces[t.dataset.worksSurface] = Math.round(v * 10) / 10;
      void save({ ...works, surfaces }, true);
      return true;
    }
    return false;
  },
  click(el) {
    if (!works) return false;
    if (el.id === 'works-add') {
      const day = (document.getElementById('works-day') as HTMLInputElement).value;
      const kind = (document.getElementById('works-kind') as HTMLSelectElement).value as WorkKind;
      const label = (document.getElementById('works-label') as HTMLInputElement).value.trim().slice(0, 80);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        document.getElementById('works-msg')!.textContent = 'Indiquez la date des travaux.';
        return true;
      }
      chosen = day;
      void save({ ...works, markers: sortMarkers([...works.markers.filter((m) => m.day !== day), { day, kind: kind in WORK_KINDS ? kind : 'autre', label }]) });
      return true;
    }
    if (el.dataset.worksDel !== undefined) {
      const i = Number(el.dataset.worksDel);
      void save({ ...works, markers: works.markers.filter((_, j) => j !== i) });
      return true;
    }
    return false;
  },
});
