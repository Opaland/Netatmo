// #260: the « view ready » signal waits for every background task, and for the quiet time
// after the last one (the redraw chained to a settled load runs first).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pending, SETTLE_MS } from './ready';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('view ready once its background work has settled', () => {
  it('ready after the render when nothing is pending, after the quiet time only', () => {
    const idle = vi.fn();
    const p = new Pending(idle, () => {});
    p.poke();
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(idle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('waits for every tracked task, failed ones included', async () => {
    const idle = vi.fn();
    const busy = vi.fn();
    const p = new Pending(idle, busy);
    const a = deferred();
    const b = deferred();
    p.track(a.promise);
    p.track(b.promise).catch(() => {});
    p.poke();
    expect(busy).toHaveBeenCalled();
    expect(p.count).toBe(2);
    a.resolve();
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    expect(idle).not.toHaveBeenCalled();
    b.reject(new Error('hors ligne'));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(p.count).toBe(0);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('a redraw or a new task during the quiet time puts the signal off again', async () => {
    const idle = vi.fn();
    const p = new Pending(idle, () => {});
    p.poke();
    vi.advanceTimersByTime(SETTLE_MS - 10);
    p.poke(); // the view was drawn again
    vi.advanceTimersByTime(SETTLE_MS - 10);
    expect(idle).not.toHaveBeenCalled();
    const c = deferred();
    p.track(c.promise);
    vi.advanceTimersByTime(SETTLE_MS * 2);
    expect(idle).not.toHaveBeenCalled();
    c.resolve();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('track returns the promise unchanged', async () => {
    const p = new Pending(() => {}, () => {});
    const v = Promise.resolve(42);
    expect(p.track(v)).toBe(v);
    await expect(v).resolves.toBe(42);
  });
});
