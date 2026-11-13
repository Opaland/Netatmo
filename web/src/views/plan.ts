// #202: Pièces on the plan of the house (« Liste | Plan »). Each room of the plan linked to an
// Intuis room is coloured by what is chosen over the period of Pièces (kWh, mean temperature, days
// under the comfort threshold, hours of open window), with its legend; touching it opens the page
// of the room. The table under the plan says the same in text (the alternative to the drawing:
// screen readers, text at 200 %), with the devices of each room. Household view: a bedroom of the
// plan shows « Chambres » and the group's figures, never its own (S-12.2). Loaded on demand.
import { activeRooms, ds, state } from '../app';
import { cardTable, esc, fmtKwh, tableToggle } from '../ui';
import { countedNote, legend, seg } from '../components';
import { fmt1, fmtTemp, plural } from '../glossary';
import { BEDROOMS_ID, BEDROOMS_NAME, displayId } from '../household';
import {
  DEVICE_KINDS,
  type FloorPlan,
  HEAT_CLASSES,
  LEVELS,
  type LevelId,
  type PlanDevice,
  type PlanLevel,
  type PlanRoom,
  extent,
  heatClasses,
  roomAt,
} from '../floorplan';
import { html } from '../trusted';
import type { RoomFigures } from './piece';
import '../plan.css';

export type Metric = keyof RoomFigures;
const METRICS: Record<Metric, { label: string; fmt: (v: number) => string }> = {
  kwh: { label: 'Consommation', fmt: (v) => fmtKwh(v) },
  temp: { label: 'Température moyenne', fmt: (v) => fmtTemp(v) },
  cold: { label: 'Jours sous le seuil de confort', fmt: (v) => plural(Math.round(v), 'jour') },
  open: { label: 'Fenêtre ouverte', fmt: (v) => `${fmt1(v).replace(/,0$/, '')} h` },
};

export interface ReadingOpts {
  plan: FloorPlan;
  from: string;
  to: string;
  /** The period, as Pièces says it (« Novembre 2026, du 1er au 8 »). */
  scope: string;
  figures: (id: string, from: string, to: string) => RoomFigures;
}

let metric: Metric = 'kwh';
let level: LevelId | null = null;

/** The room shown for a raw Intuis room (the household view groups the bedrooms); null: not shown. */
function shownRoom(raw: string | undefined): { id: string; name: string } | null {
  if (!raw) return null;
  const id = displayId(ds!, raw);
  const r = activeRooms().find((x) => x.id === id);
  return r ? { id, name: id === BEDROOMS_ID ? BEDROOMS_NAME : r.name } : null;
}

/** What a device is, in words (its room, its module or its plug when the plan says which). */
function deviceName(d: PlanDevice): string {
  const kind = DEVICE_KINDS[d.kind].label;
  if (!d.ref) return kind;
  if (d.kind === 'radiateur' || d.kind === 'chauffe-eau') {
    const r = shownRoom(d.ref);
    return r ? `${kind} (${r.name})` : kind;
  }
  if (d.kind === 'station') {
    const name = ds!.station?.modules[d.ref]?.name;
    return name ? `${kind} « ${name} »` : kind;
  }
  if (d.kind === 'prise') {
    const name = ds!.shelly?.plugs?.[d.ref]?.name;
    return name ? `${kind} « ${name} »` : kind;
  }
  return kind;
}

interface Cell {
  level: PlanLevel;
  room: PlanRoom;
  shown: { id: string; name: string } | null;
  name: string;
  value: number | null;
}

/** About the width of a character, in font sizes (to cut a name that would leave its room). */
const CHAR_EM = 0.58;
const FONT = 0.9; // cells
function fit(text: string, width: number, font: number): string {
  const max = Math.floor((width - 0.5) / (font * CHAR_EM));
  if (max < 2) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The shape of a room: a link to its page when it is linked to a room shown (its name is said by aria-label). */
function roomSvg(c: Cell, cls: number | null): string {
  const { room: r } = c;
  const rect = `<rect class="plan-room heat-${cls ?? 'none'}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"></rect>`;
  if (!c.shown) return rect;
  const label = `${c.name} : ${METRICS[metric].label.toLowerCase()} ${valueText(c)}, ouvrir la page de la pièce`;
  return `<a href="#piece-${esc(encodeURIComponent(c.shown.id))}" aria-label="${esc(label)}">${rect}</a>`;
}
const valueText = (c: Cell) => (c.value === null ? '—' : METRICS[metric].fmt(c.value));

/**
 * The words written on a room (name, value), in a layer of their own above the shapes: hidden from
 * the accessibility tree (the link and the table say them) and letting a touch through to the room.
 */
function labelSvg(c: Cell): string {
  const { room: r } = c;
  const name = fit(c.name, r.w, FONT);
  const val = r.h >= 2.6 ? fit(valueText(c), r.w, FONT) : '';
  return `${name ? `<text class="plan-label" x="${r.x + 0.3}" y="${r.y + 1.1}" font-size="${FONT}">${esc(name)}</text>` : ''}${
    val ? `<text class="plan-label plan-value" x="${r.x + 0.3}" y="${r.y + 2.2}" font-size="${FONT}">${esc(val)}</text>` : ''
  }`;
}

function deviceSvg(d: PlanDevice): string {
  const mark = DEVICE_KINDS[d.kind].mark;
  return `<g class="plan-device"><rect x="${d.x + 0.1}" y="${d.y + 0.1}" width="0.8" height="0.8" rx="0.2"></rect><text x="${d.x + 0.5}" y="${d.y + 0.68}" font-size="${
    mark.length > 1 ? 0.42 : 0.55
  }" text-anchor="middle">${esc(mark)}</text></g>`;
}

/** Draws the card; a level or a value chosen redraws it (main.ts puts the focus back on the control, #353). */
export function mountPlanReading(el: HTMLElement, o: ReadingOpts) {
  const levels = o.plan.levels;
  if (!level || !levels.some((l) => l.id === level)) level = (levels.find((l) => l.id === 'rdc') ?? levels[0]).id;
  const cells: Cell[] = levels.flatMap((l) =>
    l.rooms.map((room) => {
      const shown = shownRoom(room.room);
      const name = shown?.id === BEDROOMS_ID ? BEDROOMS_NAME : room.name || shown?.name || 'Pièce sans nom';
      return { level: l, room, shown, name, value: shown ? o.figures(shown.id, o.from, o.to)[metric] : null };
    }),
  );
  // one scale for every level, so that two levels compare
  const { classes, bounds } = heatClasses(cells.map((c) => c.value));
  const lv = levels.find((l) => l.id === level)!;
  const box = extent(lv);
  const drawn = cells.map((c, i) => ({ c, cls: classes[i] })).filter((x) => x.c.level === lv);
  const svg = box.w
    ? `<svg class="plan-svg" viewBox="-0.25 -0.25 ${box.w + 0.5} ${box.h + 0.5}" role="group" aria-label="${esc(`Plan : ${LEVELS[lv.id].toLowerCase()}`)}">${drawn
        .map((x) => roomSvg(x.c, x.cls))
        .join('')}<g class="plan-overlay" aria-hidden="true">${drawn.map((x) => labelSvg(x.c)).join('')}${lv.devices.map(deviceSvg).join('')}</g></svg>`
    : `<p class="hint">Rien n’est dessiné à ce niveau.</p>`;
  const m = METRICS[metric];
  const keys = bounds.length
    ? legend([
        ...bounds.map((b) => ({ label: b.lo === b.hi ? m.fmt(b.lo) : `${m.fmt(b.lo)} à ${m.fmt(b.hi)}`, color: `--seq-${b.cls}` })),
        { label: 'sans valeur', color: '--surface-sunken' },
      ])
    : '<p class="hint">Aucune valeur sur la période pour les pièces du plan.</p>';
  const rows = levels.flatMap((l) => {
    const inRooms = new Map<string, string[]>();
    const outside: string[] = [];
    for (const d of l.devices) {
      const r = roomAt(l, d.x, d.y);
      if (r) inRooms.set(r.id, [...(inRooms.get(r.id) ?? []), deviceName(d)]);
      else outside.push(deviceName(d));
    }
    const out = cells
      .filter((c) => c.level === l)
      .map((c) => [
        c.shown ? `<a href="#piece-${esc(encodeURIComponent(c.shown.id))}">${esc(c.name)}</a>` : esc(c.name),
        esc(LEVELS[l.id]),
        c.value === null ? '—' : esc(m.fmt(c.value)),
        c.shown ? esc(c.shown.name) : 'aucune',
        esc((inRooms.get(c.room.id) ?? []).join(', ') || 'aucun'),
      ]);
    if (outside.length) out.push(['Hors des pièces', esc(LEVELS[l.id]), '—', '—', esc(outside.join(', '))]);
    return out;
  });
  el.innerHTML = html(`<section class="card" id="plan-card" aria-labelledby="plan-title">
    <div class="card-head"><h2 id="plan-title">Plan de la maison</h2></div>
    ${countedNote(esc(o.scope))}
    <div class="controls plan-controls">
      ${levels.length > 1 ? seg('plan-level', lv.id, levels.map((l) => [l.id, LEVELS[l.id]] as [LevelId, string]), 'Niveau', (v) => ({ 'data-plan-level': v })) : ''}
      <label class="select">Colorer par <select data-plan-metric>${(Object.keys(METRICS) as Metric[])
        .map((k) => `<option value="${k}"${k === metric ? ' selected' : ''}>${esc(METRICS[k].label)}</option>`)
        .join('')}</select></label>
    </div>
    <div class="plan-frame">${svg}</div>
    ${keys}
    <p class="hint muted">Plus la couleur est foncée, plus la valeur est haute (${HEAT_CLASSES} paliers égaux, une échelle pour tous les niveaux). Touchez une pièce pour ouvrir sa page. Lettres : ${Object.values(
      DEVICE_KINDS,
    )
      .map((k) => `${k.mark} ${k.label.toLowerCase()}`)
      .join(', ')}.${metric === 'cold' ? ` Seuil : ${esc(fmtTemp(state.comfortThreshold))}.` : ''}</p>
    ${tableToggle(cardTable(['Pièce du plan', 'Niveau', m.label, 'Pièce liée', 'Appareils'], rows, 'Le plan en tableau : pièces et appareils'))}
  </section>`);
  el.querySelectorAll<HTMLButtonElement>('[data-plan-level]').forEach((b) =>
    b.addEventListener('click', () => {
      level = b.dataset.planLevel as LevelId;
      mountPlanReading(el, o);
    }),
  );
  el.querySelector<HTMLSelectElement>('[data-plan-metric]')?.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    if (Object.hasOwn(METRICS, v)) metric = v as Metric;
    mountPlanReading(el, o);
  });
}
