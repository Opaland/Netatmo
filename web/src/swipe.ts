// S-7.11: optional horizontal swipe on the header (period) and on the tab bar (view).
// Only zones marked data-swipe react, never the charts (their zoom and scroll keep the
// gesture), and only to touch: the buttons stay the reference, for keyboards and screen readers.

export type SwipeDir = 'left' | 'right';

const MIN_DX = 60; // px
const MAX_MS = 800;

/** Direction of a gesture, or null when it is too short, too slow or not horizontal enough. */
export function swipeDirection(dx: number, dy: number, ms: number): SwipeDir | null {
  if (ms > MAX_MS || Math.abs(dx) < MIN_DX || Math.abs(dx) < 2 * Math.abs(dy)) return null;
  return dx < 0 ? 'left' : 'right';
}

/** Next value in a list, clamped at both ends (null when already at the end). */
export function step<T>(list: readonly T[], current: T, delta: 1 | -1): T | null {
  const i = list.indexOf(current);
  const j = i + delta;
  return i < 0 || j < 0 || j >= list.length ? null : list[j];
}

export function onSwipe(root: HTMLElement, fn: (zone: string, dir: SwipeDir) => void) {
  let start: { x: number; y: number; t: number; zone: string; id: number } | null = null;
  root.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    const zone = t.closest<HTMLElement>('[data-swipe]');
    if (e.pointerType !== 'touch' || !zone || t.closest('.menu-panel, .rooms-panel, input, select, .chart')) {
      start = null;
      return;
    }
    start = { x: e.clientX, y: e.clientY, t: e.timeStamp, zone: zone.dataset.swipe!, id: e.pointerId };
  });
  const end = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const dir = swipeDirection(e.clientX - start.x, e.clientY - start.y, e.timeStamp - start.t);
    const zone = start.zone;
    start = null;
    if (dir) fn(zone, dir);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', () => (start = null));
}
