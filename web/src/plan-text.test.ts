// #550 (revue v2.2): the plan's drawing is replaced at each render; its ResizeObserver must not
// outlive it. No DOM here: a drawing is a stand-in with what watchPlanText reads.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ui', () => ({ esc: (s: string) => s })); // ui.ts reaches the document at import
const { freeSpan, watchPlanText, watchedPlans } = await import('./plan-text');

class FakeObserver {
  static all: FakeObserver[] = [];
  disconnected = false;
  constructor(readonly cb: () => void) {
    FakeObserver.all.push(this);
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
}

const drawing = () => ({ isConnected: true, getScreenCTM: () => null, querySelectorAll: () => [] }) as unknown as SVGSVGElement & { isConnected: boolean };

afterEach(() => {
  FakeObserver.all = [];
  vi.unstubAllGlobals();
});

describe('watchPlanText (#550)', () => {
  it('stops watching a drawing that left the document', () => {
    vi.stubGlobal('ResizeObserver', FakeObserver);
    const before = watchedPlans();
    const first = drawing();
    watchPlanText(first);
    watchPlanText(first); // the same drawing: one observer
    expect(FakeObserver.all).toHaveLength(1);
    expect(watchedPlans()).toBe(before + 1);

    // a render replaced the drawing: the observer of the old one is told (size 0), and disconnects
    Object.assign(first, { isConnected: false });
    FakeObserver.all[0].cb();
    expect(FakeObserver.all[0].disconnected).toBe(true);
    expect(watchedPlans()).toBe(before);

    // not told: the next drawing watched forgets it all the same
    const second = drawing();
    watchPlanText(second);
    Object.assign(second, { isConnected: false });
    watchPlanText(drawing());
    expect(FakeObserver.all[1].disconnected).toBe(true);
    expect(FakeObserver.all[2].disconnected).toBe(false);
    expect(watchedPlans()).toBe(before + 1);
  });
});

describe('freeSpan: no mark over a word (#550, plan at 200 %)', () => {
  const dot = (x: number, y: number) => ({ x0: x, y0: y, x1: x + 0.7, y1: y + 0.7 });
  it('a mark at the start of the line pushes it right, one further on ends it', () => {
    expect(freeSpan(1.3, 6, 1, 2, [dot(1.15, 1.15)], 1)).toEqual([1.95, 6]);
    expect(freeSpan(1.3, 6, 1, 2, [dot(4, 1.15)], 1)).toEqual([1.3, 3.9]);
  });
  it('a mark above or below the line, or beside the room, changes nothing', () => {
    expect(freeSpan(1.3, 6, 1, 2, [dot(1.15, 2.1), dot(1.15, 0.2), dot(6.2, 1.2)], 1)).toEqual([1.3, 6]);
  });
  it('a line with no room left is empty (fitName then leaves it out)', () => {
    const [a, b] = freeSpan(1.3, 2, 1, 2, [dot(1.2, 1.1), dot(1.8, 1.1)], 1);
    expect(b - a).toBeLessThanOrEqual(0.1);
  });
});
