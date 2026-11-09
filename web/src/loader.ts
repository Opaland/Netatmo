// Life cycle of the decrypted dataset (#247, #232, #255) and of the lazy cards (#249).
// Pure logic, no DOM and no app state: app.ts and lazy.ts wire it to the page, the tests
// (loader.test.ts) drive it directly.

// ------------------------------------------------------------------ dataset hooks
type Hook = () => void;

function runAll(hooks: Hook[]) {
  for (const fn of hooks) {
    try {
      fn();
    } catch (err) {
      console.error(err); // one broken hook must not keep the others from forgetting their data
    }
  }
}

/**
 * Three moments, three lists of hooks:
 * - `view`: the dataset SHOWN changed (another dataset, the household view toggled) or the app
 *   was locked: every cache computed from the dataset shown is dropped;
 * - `open`: a dataset was freshly decrypted (unlock): what runs once per dataset (inactivity
 *   timer, offline prefetch), not on a mere change of display (#255);
 * - `lock`: the decrypted data must be forgotten (#232): the raw caches (decrypted files,
 *   memoised series) are emptied too.
 */
export class DatasetHooks {
  private view: Hook[] = [];
  private open: Hook[] = [];
  private lock: Hook[] = [];
  onView(fn: Hook) {
    this.view.push(fn);
  }
  onOpen(fn: Hook) {
    this.open.push(fn);
  }
  onLock(fn: Hook) {
    this.lock.push(fn);
  }
  /** `shown`: the dataset now displayed (null when locking); `fresh`: newly decrypted. */
  changed(shown: object | null, fresh: boolean) {
    runAll(this.view);
    if (!shown) runAll(this.lock);
    else if (fresh) runAll(this.open);
  }
}

// ------------------------------------------------------------------ on-demand documents
export type DocStatus = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * A document loaded on demand for ONE dataset (#247): hourly data, Linky curve, room states…
 * The load starts at the first `get(d)`; a result that arrives after the dataset changed
 * (another `get` with another dataset, or `reset()`) is dropped, and the loading flag goes
 * with it, so the new dataset starts its own load instead of waiting for the old one.
 * A failure is kept (no retry loop on every render) until `reset()` or `retry()`.
 */
export class DatasetDoc<D extends object, T> {
  private owner: D | null = null;
  private gen = 0;
  private st: DocStatus = 'idle';
  private val: T | undefined;
  private err: unknown = null;
  private listener: ((ok: boolean) => void) | undefined;

  constructor(private readonly load: (d: D) => Promise<T>) {}

  /**
   * The value for `d` once loaded, else undefined (the load starts if needed). `then` is
   * called once the load settles, if `d` is still the dataset of this document; the last
   * caller's `then` wins (the latest render knows the element to redraw).
   */
  get(d: D | null, then?: (ok: boolean) => void): T | undefined {
    if (!d) return undefined;
    if (this.owner !== d) this.reset(d);
    if (this.st === 'ready') return this.val;
    if (then) this.listener = then;
    if (this.st === 'idle') this.start(d);
    return undefined;
  }

  status(d: D | null): DocStatus {
    return d && this.owner === d ? this.st : 'idle';
  }

  /** The reason of the last failure (for a message), null otherwise. */
  error(): unknown {
    return this.err;
  }

  /** After a failure: forget it, so that the next `get` loads again. */
  retry() {
    if (this.st === 'failed') {
      this.st = 'idle';
      this.err = null;
    }
  }

  /** Forget everything (value, flag, pending result), optionally for a new owner. */
  reset(owner: D | null = null) {
    this.gen++;
    this.owner = owner;
    this.st = 'idle';
    this.val = undefined;
    this.err = null;
    this.listener = undefined;
  }

  private start(d: D) {
    const gen = ++this.gen;
    this.st = 'loading';
    let p: Promise<T>;
    try {
      p = this.load(d);
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then(
      (v) => {
        if (gen !== this.gen) return; // another dataset since: dropped
        this.val = v;
        this.st = 'ready';
        this.settle(true);
      },
      (err) => {
        if (gen !== this.gen) return;
        this.err = err;
        this.st = 'failed';
        this.settle(false);
      },
    );
  }

  private settle(ok: boolean) {
    const fn = this.listener;
    this.listener = undefined;
    fn?.(ok);
  }
}

// ------------------------------------------------------------------ lazy cards
/**
 * - `offline`: no network, the module or its data will come back;
 * - `reload`: the module failed to load earlier, offline: the browser keeps that failure until
 *   the page is reloaded (Chromium does not fetch a failed dynamic import again);
 * - `error`: a bug or a server error, reported with console.error (the e2e tests see it);
 * - `stale`: the dataset changed meanwhile: nothing to show, nothing to report.
 */
export type LazyOutcome = 'ok' | 'offline' | 'reload' | 'error' | 'stale';

export interface LazyEnv {
  online: () => boolean;
  stale: () => boolean;
  what: string;
  /** A module import already failed offline in this page (see `reload`). */
  importFailedOffline?: { value: boolean };
}

/** #249: run a lazy card (import its module, then fill it) and tell what happened instead of swallowing it. */
export async function runLazy<M>(load: () => Promise<M>, fill: (m: M) => unknown, env: LazyEnv): Promise<{ outcome: LazyOutcome; error?: unknown }> {
  let mod: M;
  try {
    mod = await load();
  } catch (error) {
    if (env.stale()) return { outcome: 'stale', error };
    if (!env.online()) {
      if (env.importFailedOffline) env.importFailedOffline.value = true;
      return { outcome: 'offline', error };
    }
    if (env.importFailedOffline?.value) return { outcome: 'reload', error };
    console.error(`${env.what} :`, error);
    return { outcome: 'error', error };
  }
  try {
    await fill(mod);
    return { outcome: 'ok' };
  } catch (error) {
    if (env.stale()) return { outcome: 'stale', error };
    if (!env.online()) return { outcome: 'offline', error };
    console.error(`${env.what} :`, error);
    return { outcome: 'error', error };
  }
}
