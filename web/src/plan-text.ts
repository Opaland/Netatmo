// #541 (revue design v2.1): the words drawn on the plan of the house (names and values of the
// rooms, letters of the devices), in Pièces → Plan and in the editor. They are written in units
// of the drawing (cells), which the screen scales: at 360 px a cell is about 14 px, so a name of
// 0.9 cell was under the floor of text (--font-xs), and it did not follow the system text size
// (200 %). Here, once the drawing is laid out, every word is given at least --font-xs on the
// screen, and the names are cut again for that size (fitName, the one rule); a line that no
// longer fits in its room is left out (the table under the plan says everything). A device's
// mark grows with its letters, around the centre of its cell, or becomes a dot when its letters
// would cover the next cells. Called after each drawing and when the drawing changes width.
import { CHAR_EM, fitName } from './floorplan';
import { esc } from './ui';

/** Height of a line of a room's label, in font sizes. */
const LINE = 1.22;
/** Space above the first line and left of every line, in cells. */
const PAD_Y = 0.2;
const PAD_X = 0.3;
/**
 * A letter taller than this (in cells) would cover the neighbouring cells: the mark is then a dot,
 * and the table under the plan says which device it is. Chosen by eye on the demo plan at 360 px
 * (a presentation threshold: at 100 % the letters need about 1 cell and stay; at 200 % they
 * would need 1.9 and covered the names). Kept letters at any size: rejected, they hid the rooms.
 */
const MAX_MARK_FONT = 1.3;

/** --font-xs on this screen, in CSS px (it follows the system text size). */
function floorPx(): number {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;font-size:var(--font-xs)';
  document.body.append(probe);
  const px = parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  return Number.isFinite(px) ? px : 0;
}

/** The floor of text in cells for this drawing now (0 when it is not laid out: hidden, the base sizes). */
export function floorCells(svg: SVGSVGElement): number {
  const scale = svg.getScreenCTM()?.a ?? 0; // px per cell
  return scale > 0 ? floorPx() / scale : 0;
}

/** A room's label, to be laid out by fitPlanText: one <text data-full> per line. */
export function roomLabel(box: { x: number; y: number; w: number; h: number }, lines: string[], font: number): string {
  const texts = lines.map((l, i) => `<text class="plan-label${i ? ' plan-value' : ''}" data-full="${esc(l)}"></text>`).join('');
  return `<g class="plan-text" data-box="${box.x} ${box.y} ${box.w} ${box.h}" data-font="${font}">${texts}</g>`;
}

/** A device's mark, to be laid out by fitPlanText around the centre of its cell; `cls` and `attrs` (already escaped) for the editor. */
export function deviceMark(x: number, y: number, mark: string, cls = '', attrs = ''): string {
  return `<g class="plan-device${cls ? ` ${cls}` : ''}"${attrs ? ` ${attrs}` : ''} data-cell="${x} ${y}" data-font="${mark.length > 1 ? 0.42 : 0.55}"><rect rx="0.2"></rect><text text-anchor="middle">${esc(mark)}</text></g>`;
}

/** Cut a text again until what the browser draws fits [start, end] (fitName estimates; DejaVu Sans bold is wider). */
function cutToWidth(t: SVGTextElement, full: string, start: number, end: number, font: number) {
  const room = end - start;
  let width = room + PAD_X + 0.1; // the width of a room whose line starts at PAD_X: fitName keeps its margin
  t.setAttribute('x', String(start));
  t.textContent = fitName(full, width, font);
  for (let i = 0; i < 60 && t.textContent && t.getComputedTextLength() > room; i++) {
    width -= (font * CHAR_EM) / 2;
    t.textContent = fitName(full, width, font);
  }
}

type Box = { x0: number; y0: number; x1: number; y1: number };
/** The square of a laid-out mark (placeMark), in cells. */
function markBox(g: SVGGElement): Box | null {
  const r = g.querySelector('rect');
  const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((a) => Number(r?.getAttribute(a)));
  return [x, y, w, h].every(Number.isFinite) ? { x0: x, y0: y, x1: x + w, y1: y + h } : null;
}

/**
 * #550 (revue v2.2, plan at 200 %): the part of a line [start, end] that no mark covers. A mark at
 * the start of the line pushes it right; a mark further on ends it before the mark. A line left
 * too short is cut, or left out by fitName (the table under the plan says everything).
 */
export function freeSpan(start: number, end: number, top: number, bottom: number, marks: Box[], font: number): [number, number] {
  const gap = 0.1;
  for (const m of [...marks].sort((a, b) => a.x0 - b.x0)) {
    if (m.y1 <= top || m.y0 >= bottom || m.x1 <= start || m.x0 >= end) continue;
    if (m.x0 <= start + font) start = Math.max(start, m.x1 + gap);
    else end = Math.min(end, m.x0 - gap);
  }
  return [start, Math.max(start, end)];
}

/** Lay out the words of a drawing for its size on the screen (see above): the marks first, then
 * the lines of the rooms around them, so that no mark is painted over a word (#550). */
export function fitPlanText(svg: SVGSVGElement) {
  const floor = floorCells(svg);
  const marks: Box[] = [];
  for (const g of svg.querySelectorAll<SVGGElement>('g.plan-device')) {
    placeMark(g, floor);
    const box = markBox(g);
    if (box) marks.push(box);
  }
  for (const g of svg.querySelectorAll<SVGGElement>('g.plan-text')) {
    const [x, y, w, h] = (g.dataset.box ?? '').split(' ').map(Number);
    const font = Math.max(Number(g.dataset.font), floor);
    g.querySelectorAll<SVGTextElement>('text').forEach((t, i) => {
      const base = y + PAD_Y + font * (1 + LINE * i);
      t.setAttribute('x', String(x + PAD_X));
      t.setAttribute('y', String(base));
      t.setAttribute('font-size', String(font));
      if (base + font * 0.3 > y + h) {
        t.textContent = '';
        return;
      }
      const [start, end] = freeSpan(x + PAD_X, x + w - 0.1, base - font * 0.85, base + font * 0.25, marks, font);
      cutToWidth(t, t.dataset.full ?? '', start, end, font);
    });
  }
}

/** A device's mark at its cell (data-cell), its letters at least `floor` cells high, or a dot; also called while it is dragged. */
export function placeMark(g: SVGGElement, floor: number) {
  const [x, y] = (g.dataset.cell ?? '').split(' ').map(Number);
  const text = g.querySelector('text');
  const rect = g.querySelector('rect');
  const font = Math.max(Number(g.dataset.font), floor);
  const dot = font > MAX_MARK_FONT;
  const letters = text?.textContent?.length ?? 1;
  const side = dot ? 0.7 : Math.max(0.8, font * (letters > 1 ? 1.75 : 1.2));
  const cx = x + 0.5;
  const cy = y + 0.5;
  g.classList.toggle('is-dot', dot);
  rect?.setAttribute('x', String(cx - side / 2));
  rect?.setAttribute('y', String(cy - side / 2));
  rect?.setAttribute('width', String(side));
  rect?.setAttribute('height', String(side));
  rect?.setAttribute('rx', String(dot ? side / 2 : 0.2));
  text?.setAttribute('visibility', dot ? 'hidden' : 'visible');
  text?.setAttribute('x', String(cx));
  text?.setAttribute('y', String(cy + font * 0.35));
  text?.setAttribute('font-size', String(font));
}

/** The drawings watched, with their observer (#550: each render replaces the drawing). */
const watched = new Map<SVGSVGElement, ResizeObserver>();
/** Lay out now, and again whenever the drawing changes width (a rotation, a resized window). A
 * drawing that left the document stops being watched: when its observer is told (a removed
 * element is reported at size 0), and at the latest when the next drawing is watched. */
export function watchPlanText(svg: SVGSVGElement | null) {
  for (const [old, obs] of watched) if (!old.isConnected) forget(old, obs);
  if (!svg) return;
  fitPlanText(svg);
  if (watched.has(svg) || typeof ResizeObserver === 'undefined') return;
  const obs = new ResizeObserver(() => (svg.isConnected ? fitPlanText(svg) : forget(svg, obs)));
  watched.set(svg, obs);
  obs.observe(svg);
}
function forget(svg: SVGSVGElement, obs: ResizeObserver) {
  obs.disconnect();
  watched.delete(svg);
}
/** For the tests: how many drawings are watched. */
export const watchedPlans = () => watched.size;
