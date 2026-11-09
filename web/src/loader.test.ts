import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatasetDoc, DatasetHooks, runLazy } from './loader';

/** A promise resolved (or rejected) from the test. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('DatasetDoc: one load per dataset, stale results dropped (#247)', () => {
  it('drops the result of dataset A once B is asked for, and B loads on its own', async () => {
    const A = { name: 'A' };
    const B = { name: 'B' };
    const loads = new Map<object, ReturnType<typeof deferred<string>>>();
    const doc = new DatasetDoc<object, string>((d) => {
      const p = deferred<string>();
      loads.set(d, p);
      return p.promise;
    });
    const seen: string[] = [];
    expect(doc.get(A, () => seen.push('A settled'))).toBeUndefined();
    expect(doc.status(A)).toBe('loading');
    // the dataset changes before A's document arrives
    expect(doc.get(B, () => seen.push('B settled'))).toBeUndefined();
    expect(loads.has(B)).toBe(true); // B did not wait for A's load
    loads.get(A)!.resolve('hourly of A');
    await flush();
    expect(seen).toEqual([]); // A's late result is dropped, no redraw
    expect(doc.get(B)).toBeUndefined();
    loads.get(B)!.resolve('hourly of B');
    await flush();
    expect(seen).toEqual(['B settled']);
    expect(doc.get(B)).toBe('hourly of B');
    expect(doc.status(A)).toBe('idle');
  });

  it('loads once per dataset, the last caller is told', async () => {
    const A = {};
    const p = deferred<number>();
    const load = vi.fn(() => p.promise);
    const doc = new DatasetDoc<object, number>(load);
    const first = vi.fn();
    const last = vi.fn();
    doc.get(A, first);
    doc.get(A, last);
    expect(load).toHaveBeenCalledTimes(1);
    p.resolve(7);
    await flush();
    expect(first).not.toHaveBeenCalled();
    expect(last).toHaveBeenCalledWith(true);
    expect(doc.get(A)).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reset (lock) forgets the value, the loading flag and a pending result', async () => {
    const A = {};
    const p = deferred<string>();
    const load = vi.fn(() => p.promise);
    const doc = new DatasetDoc<object, string>(load);
    const then = vi.fn();
    doc.get(A, then);
    doc.reset();
    expect(doc.status(A)).toBe('idle');
    p.resolve('decrypted');
    await flush();
    expect(then).not.toHaveBeenCalled();
    expect(doc.get(A)).toBeUndefined(); // loads again: nothing kept from before the reset
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a failure is kept (no retry loop on every render) until retry()', async () => {
    const A = {};
    const load = vi.fn(() => Promise.reject(new Error('offline')));
    const doc = new DatasetDoc<object, string>(load);
    const then = vi.fn();
    doc.get(A, then);
    await flush();
    expect(then).toHaveBeenCalledWith(false);
    expect(doc.status(A)).toBe('failed');
    expect((doc.error() as Error).message).toBe('offline');
    doc.get(A);
    expect(load).toHaveBeenCalledTimes(1);
    doc.retry();
    doc.get(A);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a load that throws synchronously is a failure, not an exception of the render', async () => {
    const doc = new DatasetDoc<object, string>(() => {
      throw new TypeError('bug');
    });
    expect(() => doc.get({})).not.toThrow();
    await flush();
  });
});

describe('DatasetHooks: display change, new dataset, lock (#232, #255)', () => {
  it('a display change runs the view hooks only; a new dataset also the open hooks; the lock the lock hooks', () => {
    const h = new DatasetHooks();
    const calls: string[] = [];
    h.onView(() => calls.push('view'));
    h.onOpen(() => calls.push('open'));
    h.onLock(() => calls.push('lock'));
    h.changed({}, true);
    expect(calls).toEqual(['view', 'open']);
    calls.length = 0;
    h.changed({}, false); // household view toggled: no prefetch, no idle timer restart
    expect(calls).toEqual(['view']);
    calls.length = 0;
    h.changed(null, false); // lock: every view cache AND the raw caches are emptied
    expect(calls).toEqual(['view', 'lock']);
  });

  it('one hook that throws does not keep the others from clearing', () => {
    const h = new DatasetHooks();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cleared = vi.fn();
    h.onView(() => {
      throw new Error('bug');
    });
    h.onView(cleared);
    h.onLock(cleared);
    h.changed(null, false);
    expect(cleared).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('runLazy: lazy cards never fail silently (#249)', () => {
  afterEach(() => vi.restoreAllMocks());
  const env = (online: boolean, stale = false) => ({ online: () => online, stale: () => stale, what: 'Budget' });

  it('fills the card', async () => {
    const fill = vi.fn();
    expect(await runLazy(() => Promise.resolve({ x: 1 }), fill, env(true))).toEqual({ outcome: 'ok' });
    expect(fill).toHaveBeenCalledWith({ x: 1 });
  });

  it('offline: the import failure is an offline state, not an error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await runLazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')), vi.fn(), env(false));
    expect(r.outcome).toBe('offline');
    expect(err).not.toHaveBeenCalled();
  });

  it('back online after an import failed offline: a reload is asked for, not an error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const flag = { value: false };
    const fail = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
    expect((await runLazy(fail, vi.fn(), { ...env(false), importFailedOffline: flag })).outcome).toBe('offline');
    expect(flag.value).toBe(true);
    expect((await runLazy(fail, vi.fn(), { ...env(true), importFailedOffline: flag })).outcome).toBe('reload');
    expect(err).not.toHaveBeenCalled();
  });

  it('a bug in the card (sync or async) is reported with console.error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sync = await runLazy(
      () => Promise.resolve(null),
      () => {
        throw new TypeError("Cannot read properties of null (reading 'x')");
      },
      env(true),
    );
    expect(sync.outcome).toBe('error');
    const async_ = await runLazy(() => Promise.resolve(null), () => Promise.reject(new Error('HTTP 500')), env(true));
    expect(async_.outcome).toBe('error');
    expect(err).toHaveBeenCalledTimes(2);
    expect(String(err.mock.calls[0][0])).toContain('Budget');
  });

  it('online, an import failure is an error too (stale deployment, server down)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await runLazy(() => Promise.reject(new Error('404')), vi.fn(), env(true))).outcome).toBe('error');
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('the dataset changed meanwhile: nothing to show, nothing to report', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await runLazy(() => Promise.resolve(null), () => Promise.reject(new TypeError('ds is null')), env(true, true))).outcome).toBe('stale');
    expect(err).not.toHaveBeenCalled();
  });
});
