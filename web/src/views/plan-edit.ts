// #202: ⚙ Mon logement → « Plan de la maison », the editor. The simplest one that holds the
// criteria (proposed in the PR, the owner decides the rest):
// - rooms are rectangles on a grid of 50 cm, one plan per level (ground floor and first floor; the
//   cellar is added on demand);
// - a room or a device moves by dragging it (finger or mouse, by whole cells), and every position
//   and size is also a field (keyboard, screen reader, text at 200 %): the drawing is never the
//   only way;
// - a room is linked to an Intuis room and to a station module; a device says which one it is
//   among those the app knows (radiators by room, water heater, station modules, plugs, meter,
//   shutters).
// Each change is applied on this device at once (draft sealed with the data key, plan-state.ts);
// « Enregistrer pour le foyer » seals the plan in the repository secret FLOOR_PLAN_JSON (never
// readable back), copied encrypted by the next collection. Loaded on demand.
import { ds, rawDataset, rerender } from '../app';
import { alert, alertHtml, seg } from '../components';
import {
  CELL_M,
  DEVICE_KINDS,
  type DeviceKind,
  type FloorPlan,
  GRID,
  LEVELS,
  LEVEL_ORDER,
  type LevelId,
  MAX_DEVICES,
  MAX_NAME,
  MAX_ROOMS,
  type PlanDevice,
  type PlanLevel,
  type PlanRoom,
  cleanName,
  emptyPlan,
  extent,
  freeId,
  overlaps,
  parsePlan,
  planJson,
} from '../floorplan';
import { fmt1 } from '../glossary';
import { hasToken, putSecret, secretTooBig } from '../settings';
import { deviceMark, fitPlanText, roomLabel, watchPlanText } from '../plan-text';
import { html } from '../trusted';
import { esc } from '../ui';
import { secretWhere, tokenHint } from './household-secret';
import { PLAN_SECRET, currentPlan, planDraft, planPersisted, setPlanDraft, sharedPlan } from './plan-state';
import '../plan.css';
import '../simulators.css';

let level: LevelId = 'rdc';
let selected: string | null = null;
let message: { ok: boolean; text: string } | null = null;
/** #541: the list of the devices is folded (⚙ Mon logement ran to 8,4 screens at 360 px); open when the reader opened it or chose a device. */
let devicesOpen = false;

const meta = () => (rawDataset() ?? ds)!;
/** The Intuis rooms a plan room or a radiator may be linked to (raw: the editor names them all). */
const intuisRooms = (cat: 'heating' | 'water_heater' | null) => meta().meta.rooms.filter((r) => (cat ? r.category === cat : r.category === 'heating' || r.category === 'water_heater'));
const modules = () => Object.entries(meta().station?.modules ?? {});
const plugs = () => Object.entries(meta().shelly?.plugs ?? {}).filter(([, p]) => !p.parent);

/** The known devices a kind may be, [value, name]; empty: the kind says it all (meter, shutter). */
function refs(kind: DeviceKind): [string, string][] {
  if (kind === 'radiateur') return intuisRooms('heating').map((r) => [r.id, r.name]);
  if (kind === 'chauffe-eau') return intuisRooms('water_heater').map((r) => [r.id, r.name]);
  if (kind === 'station') return modules().map(([k, m]) => [k, m.name]);
  if (kind === 'prise') return plugs().map(([k, p]) => [k, p.name]);
  return [];
}

const metres = (cells: number) => `${fmt1(cells * CELL_M).replace(/,0$/, '')} m`;
const clone = (p: FloorPlan): FloorPlan => parsePlan(JSON.parse(planJson(p))) ?? emptyPlan();
const levelOf = (p: FloorPlan) => p.levels.find((l) => l.id === level) ?? p.levels[0];
const itemOf = (l: PlanLevel, id: string | null): PlanRoom | PlanDevice | undefined => (id ? (l.rooms.find((r) => r.id === id) ?? l.devices.find((d) => d.id === id)) : undefined);
const isRoom = (x: PlanRoom | PlanDevice): x is PlanRoom => 'w' in x;
const label = (x: PlanRoom | PlanDevice) => (isRoom(x) ? x.name || 'Pièce sans nom' : deviceLabel(x));
function deviceLabel(d: PlanDevice): string {
  const name = refs(d.kind).find(([v]) => v === d.ref)?.[1];
  return `${DEVICE_KINDS[d.kind].label}${name ? ` (${name})` : ''}`;
}

/** The plan being edited: this device's draft, else the household's, else a new one. */
const working = (): FloorPlan => clone(currentPlan() ?? emptyPlan());

/**
 * Apply a change on this device and redraw at once (in the same task as the gesture: main.ts then
 * gives the focus back to the control, #353). The draft is taken synchronously by setPlanDraft;
 * its sealing ends later, and the card says it when this browser could not keep it.
 */
function commit(card: HTMLElement, repo: () => string, next: FloorPlan, redraw: 'all' | 'drawing' = 'all') {
  message = null;
  const saved = setPlanDraft(next);
  if (redraw === 'all') mountPlanEditor(card, repo);
  else drawParts(card, repo, next);
  void saved.then((ok) => !ok && card.isConnected && mountPlanEditor(card, repo));
}

// ------------------------------------------------------------------ drawing
function drawingSvg(l: PlanLevel): string {
  const box = extent(l);
  const w = Math.max(box.w + 2, 12);
  const h = Math.max(box.h + 2, 8);
  const grid = `<pattern id="plan-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path class="plan-grid-line" d="M 1 0 L 0 0 0 1"></path></pattern><rect x="0" y="0" width="${w}" height="${h}" fill="url(#plan-grid)"></rect>`;
  const rooms = l.rooms
    .map(
      (r) =>
        `<rect class="plan-room heat-none plan-edit-item${r.id === selected ? ' is-selected' : ''}" data-plan-item="${esc(r.id)}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"></rect>`,
    )
    .join('');
  const names = l.rooms
    .map((r) => (r.name ? roomLabel(r, [r.name], 0.9, `data-plan-label="${esc(r.id)}"`) : ''))
    .join('');
  const devices = l.devices.map((d) => deviceMark(d.x, d.y, DEVICE_KINDS[d.kind].mark, `plan-edit-item${d.id === selected ? ' is-selected' : ''}`, `data-plan-item="${esc(d.id)}"`)).join('');
  return `<svg class="plan-svg plan-edit-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(
    `Dessin du niveau ${LEVELS[l.id].toLowerCase()} : ${l.rooms.length} pièces, ${l.devices.length} appareils. Les mêmes positions se règlent dans les champs ci-dessous.`,
  )}">${grid}${rooms}<g class="plan-overlay" aria-hidden="true">${names}</g>${devices}</svg>`;
}

function itemsList(l: PlanLevel): string {
  const row = (x: PlanRoom | PlanDevice) =>
    `<li><button type="button" class="chip" aria-pressed="${x.id === selected}" data-plan-select="${esc(x.id)}">${esc(label(x))}</button></li>`;
  return `<p class="section-title">Pièces de ce niveau</p>${l.rooms.length ? `<ul class="plan-items" aria-label="Pièces de ce niveau">${l.rooms.map(row).join('')}</ul>` : '<p class="hint">Aucune pièce.</p>'}
  ${
    l.devices.length
      ? `<details class="plan-fold" id="plan-devices"${devicesOpen || l.devices.some((d) => d.id === selected) ? ' open' : ''}><summary>${esc(`Appareils de ce niveau (${l.devices.length})`)}</summary><ul class="plan-items" aria-label="Appareils de ce niveau">${l.devices.map(row).join('')}</ul></details>`
      : '<p class="section-title">Appareils de ce niveau</p><p class="hint">Aucun appareil.</p>'
  }`;
}

const num = (f: string, labelText: string, v: number, min: number, max: number) =>
  `<label><span data-plan-l="${f}">${esc(labelText)}</span><input type="number" inputmode="numeric" data-plan-f="${f}" value="${v}" min="${min}" max="${max}" step="1"></label>`;
const options = (list: [string, string][], value: string, none: string) =>
  `<option value="">${esc(none)}</option>${list.map(([v, n]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(n)}</option>`).join('')}`;

/** « Largeur (6 m) »: the label of a size field, said again after each change (#541). */
const sizeLabel = (f: 'w' | 'h', cells: number) => `${f === 'w' ? 'Largeur' : 'Profondeur'} (${metres(cells)})`;

function itemForm(x: PlanRoom | PlanDevice | undefined): string {
  if (!x) return '<p class="hint">Touchez une pièce ou un appareil, sur le dessin ou dans la liste, pour le régler.</p>';
  const pos = `<p class="hint muted">Positions en cases de ${esc(metres(1))}, depuis le coin en haut à gauche.</p>`;
  if (isRoom(x))
    return `<div class="sim-form" role="group" aria-label="${esc(`Régler « ${label(x)} »`)}">
      <label>Nom<input type="text" data-plan-f="name" value="${esc(x.name)}" maxlength="${MAX_NAME}"></label>
      <label>Pièce Intuis<select data-plan-f="room">${options(intuisRooms(null).map((r) => [r.id, r.name]), x.room ?? '', 'aucune')}</select></label>
      <label>Module de la station<select data-plan-f="module" aria-describedby="plan-module-hint">${options(modules().map(([k, m]) => [k, m.name]), x.module ?? '', 'aucun')}</select></label>
      <p class="hint muted" id="plan-module-hint">Gardé avec le plan, pas encore lu : il servira à montrer l’air de la pièce (CO₂) si cette lecture est retenue.</p>
      ${num('x', 'Colonne', x.x, 0, GRID - 1)}${num('y', 'Ligne', x.y, 0, GRID - 1)}${num('w', sizeLabel('w', x.w), x.w, 1, GRID)}${num('h', sizeLabel('h', x.h), x.h, 1, GRID)}
    </div>${pos}
    <div class="controls"><button type="button" class="btn secondary" data-plan-remove="${esc(x.id)}">Retirer cette pièce</button></div>`;
  const choices = refs(x.kind);
  return `<div class="sim-form" role="group" aria-label="${esc(`Régler « ${label(x)} »`)}">
      <label>Appareil<select data-plan-f="kind">${(Object.keys(DEVICE_KINDS) as DeviceKind[]).map((k) => `<option value="${k}"${k === x.kind ? ' selected' : ''}>${esc(DEVICE_KINDS[k].label)}</option>`).join('')}</select></label>
      ${choices.length ? `<label>Lequel<select data-plan-f="ref">${options(choices, x.ref, 'non précisé')}</select></label>` : ''}
      ${num('x', 'Colonne', x.x, 0, GRID - 1)}${num('y', 'Ligne', x.y, 0, GRID - 1)}
    </div>${pos}
    <div class="controls"><button type="button" class="btn secondary" data-plan-remove="${esc(x.id)}">Retirer cet appareil</button></div>`;
}

/** Redraw the drawing and the list, not the form (the caret stays in the field being typed). */
function drawParts(card: HTMLElement, repo: () => string, p: FloorPlan) {
  const l = levelOf(p);
  const zone = card.querySelector<HTMLElement>('#plan-edit-drawing');
  const list = card.querySelector<HTMLElement>('#plan-edit-items');
  if (zone) zone.innerHTML = html(drawingSvg(l));
  if (list) list.innerHTML = html(itemsList(l));
  bindDrawing(card, repo);
  bindList(card, repo);
}

// ------------------------------------------------------------------ the card
export function mountPlanEditor(card: HTMLElement | null, repo: () => string) {
  if (!card || !ds) return;
  const p = working();
  const shared = sharedPlan();
  const pending = planDraft() !== null;
  const demo = ds.source === 'demo';
  const canWrite = !demo && hasToken();
  if (!p.levels.some((l) => l.id === level)) level = p.levels.some((l) => l.id === 'rdc') ? 'rdc' : p.levels[0].id;
  const l = levelOf(p);
  const sel = itemOf(l, selected);
  if (!sel) selected = null;
  const crossed = overlaps(l);
  const tooBig = secretTooBig(planJson(p)); // #541: refused before sending, with its size
  const missing = LEVEL_ORDER.filter((id) => !p.levels.some((x) => x.id === id));
  card.innerHTML = html(`<section class="card" id="plan-edit-card" aria-labelledby="plan-edit-title">
    <div class="card-head"><h2 id="plan-edit-title">Plan de la maison</h2><span class="tag scope">foyer</span></div>
    <p class="hint muted">Dessinez les pièces en rectangles et placez les appareils : Pièces les montre alors sur le plan, colorées par la consommation, la température ou le confort. Un plan seulement, sans adresse ni rien qui situe la maison.</p>
    <div class="controls plan-controls">
      ${seg('plan-edit-level', l.id, p.levels.map((x) => [x.id, LEVELS[x.id]] as [LevelId, string]), 'Niveau', (v) => ({ 'data-plan-edit-level': v }))}
      ${missing.map((id) => `<button type="button" class="btn secondary" data-plan-add-level="${id}">Ajouter : ${esc(LEVELS[id].toLowerCase())}</button>`).join('')}
    </div>
    <div class="plan-frame" id="plan-edit-drawing">${drawingSvg(l)}</div>
    <p class="hint muted">Faites glisser une pièce ou un appareil pour le déplacer (par cases de ${esc(metres(1))}) ; tout se règle aussi dans les champs.</p>
    ${crossed.length ? alert('warn', 'Des pièces se chevauchent', crossed.map(([a, b]) => `${label(a)} et ${label(b)}`).join(' ; ')) : ''}
    <div class="controls">
      <button type="button" class="btn secondary" id="plan-add-room" ${l.rooms.length >= MAX_ROOMS ? 'disabled' : ''}>Ajouter une pièce</button>
      <button type="button" class="btn secondary" id="plan-add-device" ${l.devices.length >= MAX_DEVICES ? 'disabled' : ''}>Ajouter un appareil</button>
    </div>
    <div id="plan-edit-items">${itemsList(l)}</div>
    <div id="plan-edit-form">${itemForm(sel)}</div>
    ${tooBig ? alert('warn', 'Plan trop grand pour le foyer', `${tooBig}. Retirez des pièces ou des appareils, ou raccourcissez des noms.`) : ''}
    <p class="hint muted">${pending ? (planPersisted() ? 'Appliqué sur cet appareil, pas encore pour le foyer.' : 'Appliqué jusqu’au verrouillage : ce navigateur ne peut pas le garder.') : shared ? 'Enregistré pour le foyer.' : 'Rien d’enregistré pour le foyer.'} ${secretWhere(PLAN_SECRET).replace(' Contenu envoyé :', '')}</p>
    <div class="controls">
      <button type="button" class="btn secondary" id="plan-save" ${canWrite && pending && !tooBig ? '' : 'disabled'}>Enregistrer pour le foyer</button>
      ${pending && shared ? '<button type="button" class="link" id="plan-reset">Revenir à la version du foyer</button>' : ''}
    </div>
    <p class="hint muted">${demo ? 'Démo : appliqué sur cet appareil seulement, rien n’est envoyé.' : hasToken() ? 'Partagé avec les autres appareils après la prochaine collecte.' : tokenHint}</p>
    ${message ? alertHtml(message.ok ? 'info' : 'bad', esc(message.text), { role: 'status' }) : ''}
  </section>`);
  const remount = () => (card.isConnected ? mountPlanEditor(card, repo) : rerender());
  card.querySelectorAll<HTMLButtonElement>('[data-plan-edit-level]').forEach((b) =>
    b.addEventListener('click', () => {
      level = b.dataset.planEditLevel as LevelId;
      selected = null;
      remount();
    }),
  );
  card.querySelectorAll<HTMLButtonElement>('[data-plan-add-level]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.planAddLevel as LevelId;
      const next = working(); // at the time of the gesture: a field typed just before is in it
      next.levels.push({ id, rooms: [], devices: [] });
      level = id;
      selected = null;
      commit(card, repo, parsePlan(next) ?? next);
    }),
  );
  card.querySelector('#plan-add-room')?.addEventListener('click', () => {
    const next = working(); // at the time of the gesture: a field typed just before is in it
    const lv = levelOf(next);
    const id = freeId(next, 'p');
    const y = Math.min(extent(lv).h, GRID - 4);
    lv.rooms.push({ id, name: `Pièce ${lv.rooms.length + 1}`, x: 0, y, w: 6, h: 4 });
    selected = id;
    commit(card, repo, next);
  });
  card.querySelector('#plan-add-device')?.addEventListener('click', () => {
    const next = working(); // at the time of the gesture: a field typed just before is in it
    const lv = levelOf(next);
    const id = freeId(next, 'a');
    const room = lv.rooms.find((r) => r.id === selected) ?? lv.rooms[0];
    lv.devices.push({ id, kind: 'radiateur', ref: room?.room ?? '', x: room ? room.x : 0, y: room ? room.y : 0 });
    selected = id;
    commit(card, repo, next);
  });
  card.querySelectorAll<HTMLButtonElement>('[data-plan-remove]').forEach((b) =>
    b.addEventListener('click', () => {
      const next = working(); // at the time of the gesture: a field typed just before is in it
      const lv = levelOf(next);
      lv.rooms = lv.rooms.filter((r) => r.id !== b.dataset.planRemove);
      lv.devices = lv.devices.filter((d) => d.id !== b.dataset.planRemove);
      selected = null;
      commit(card, repo, next);
    }),
  );
  // a field: the model changes, the drawing follows; a select (kind) changes the form itself
  card.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-plan-f]').forEach((f) =>
    f.addEventListener('change', () => {
      const next = working(); // at the time of the gesture: a field typed just before is in it
      const x = itemOf(levelOf(next), selected);
      if (!x) return;
      const k = f.dataset.planF!;
      const v = f.value;
      const n = Number(v);
      if (k === 'name' && isRoom(x)) x.name = cleanName(v);
      else if ((k === 'room' || k === 'module') && isRoom(x)) {
        if (v) x[k] = v;
        else delete x[k];
      } else if (k === 'kind' && !isRoom(x) && Object.hasOwn(DEVICE_KINDS, v)) {
        x.kind = v as DeviceKind;
        x.ref = '';
      } else if (k === 'ref' && !isRoom(x)) x.ref = v;
      else if (['x', 'y', 'w', 'h'].includes(k) && Number.isInteger(n)) (x as unknown as Record<string, number>)[k] = n;
      clamp(x);
      const typed = f instanceof HTMLInputElement;
      commit(card, repo, parsePlan(next) ?? next, typed ? 'drawing' : 'all');
      if (typed && f.value !== String((x as unknown as Record<string, unknown>)[k] ?? f.value)) f.value = String((x as unknown as Record<string, unknown>)[k]);
      // the labels in metres follow the sizes (the form is not redrawn: the caret stays, #541)
      if (typed && isRoom(x)) for (const d of ['w', 'h'] as const) card.querySelector(`[data-plan-l="${d}"]`)?.replaceChildren(sizeLabel(d, x[d]));
    }),
  );
  card.querySelector('#plan-reset')?.addEventListener('click', () => {
    selected = null;
    void setPlanDraft(null).then(remount);
  });
  card.querySelector('#plan-save')?.addEventListener('click', () => {
    message = { ok: true, text: 'Envoi chiffré en cours…' };
    remount();
    putSecret(repo(), PLAN_SECRET, planJson(working()))
      .then(() => (message = { ok: true, text: 'Enregistré pour le foyer, scellé en secret : partagé avec les autres appareils après la prochaine collecte.' }))
      .catch((err: Error) => (message = { ok: false, text: err.message }))
      .finally(remount);
  });
  bindDrawing(card, repo);
  bindList(card, repo);
}

/** Keep a room or a device inside the grid (a size first, then the position). */
function clamp(x: PlanRoom | PlanDevice) {
  const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
  if (isRoom(x)) {
    x.w = c(x.w, 1, GRID);
    x.h = c(x.h, 1, GRID);
    x.x = c(x.x, 0, GRID - x.w);
    x.y = c(x.y, 0, GRID - x.h);
  } else {
    x.x = c(x.x, 0, GRID - 1);
    x.y = c(x.y, 0, GRID - 1);
  }
}

function bindList(card: HTMLElement, repo: () => string) {
  card.querySelector<HTMLDetailsElement>('#plan-devices')?.addEventListener('toggle', (e) => (devicesOpen = (e.target as HTMLDetailsElement).open));
  card.querySelectorAll<HTMLButtonElement>('[data-plan-select]').forEach((b) =>
    b.addEventListener('click', () => {
      selected = b.dataset.planSelect!;
      mountPlanEditor(card, repo);
    }),
  );
}

/**
 * Drag on the drawing: a press on a room or a device, then a move by whole cells (pointer events:
 * finger, pen and mouse alike). A press without a move selects it. The drawing takes the touch
 * (`touch-action: none`, plan.css), and is kept under half a screen so that the page still scrolls.
 * #597: while the gesture lasts, the words are laid out by the same rule as the drawing laid down
 * (fitPlanText: the marks first, then the names around them), at most once per image: a dragged
 * mark never covers a name, and a dragged room carries its name.
 */
function bindDrawing(card: HTMLElement, repo: () => string) {
  const svg = card.querySelector<SVGSVGElement>('.plan-edit-svg');
  if (!svg) return;
  watchPlanText(svg);
  svg.querySelectorAll<SVGElement>('[data-plan-item]').forEach((shape) =>
    shape.addEventListener('pointerdown', (e) => {
      const id = shape.dataset.planItem!;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const toCell = (ev: PointerEvent) => {
        const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
        return { x: pt.x, y: pt.y };
      };
      const start = toCell(e);
      const p = working();
      const x = itemOf(levelOf(p), id);
      if (!x) return;
      const origin = { x: x.x, y: x.y };
      const name = [...svg.querySelectorAll<SVGGElement>('g.plan-text')].find((g) => g.dataset.planLabel === id);
      let moved = false;
      let frame = 0;
      const layout = () => {
        frame = 0;
        fitPlanText(svg);
      };
      shape.setPointerCapture(e.pointerId);
      e.preventDefault();
      const move = (ev: PointerEvent) => {
        const at = toCell(ev);
        const dx = Math.round(at.x - start.x);
        const dy = Math.round(at.y - start.y);
        if (!dx && !dy && !moved) return;
        moved = true;
        x.x = origin.x + dx;
        x.y = origin.y + dy;
        clamp(x);
        if (shape instanceof SVGRectElement && isRoom(x)) {
          shape.setAttribute('x', String(x.x));
          shape.setAttribute('y', String(x.y));
          if (name) name.dataset.box = `${x.x} ${x.y} ${x.w} ${x.h}`;
        } else if (shape instanceof SVGGElement) shape.dataset.cell = `${x.x} ${x.y}`;
        if (!frame) frame = requestAnimationFrame(layout);
      };
      const end = () => {
        cancelAnimationFrame(frame);
        shape.removeEventListener('pointermove', move);
        shape.removeEventListener('pointerup', end);
        shape.removeEventListener('pointercancel', end);
        selected = id;
        if (moved) commit(card, repo, p);
        else mountPlanEditor(card, repo);
      };
      shape.addEventListener('pointermove', move);
      shape.addEventListener('pointerup', end);
      shape.addEventListener('pointercancel', end);
    }),
  );
}
