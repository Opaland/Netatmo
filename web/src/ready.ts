// #260: « view ready » signal. `#view[data-ready]` is set once the view is drawn AND every
// piece of work it started in the background has settled: lazy cards (lazy.ts), documents
// loaded on demand (app.ts datasetDoc, data.ts), the ECharts chunk (charts.ts), the offline
// prefetch. The e2e tests wait for it instead of fixed delays, and only check that a card is
// ABSENT once the view is ready (a card that would come late must not slip through).
// No import: app.ts, lazy.ts, data.ts and charts.ts all use it without a cycle.

/** Quiet time before the view is declared ready: the redraws chained to a settled load run first. */
export const SETTLE_MS = 50;

/** Pure counter, exported for the unit tests: `idle()` is called once nothing is pending for `delay` ms. */
export class Pending {
  private n = 0;
  private t: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly idle: () => void,
    private readonly busy: () => void,
    private readonly delay = SETTLE_MS,
  ) {}
  get count() {
    return this.n;
  }
  /** Count `p` until it settles (whatever the outcome); returns `p` unchanged. */
  track<T>(p: Promise<T>): Promise<T> {
    this.n++;
    this.busy();
    const done = () => {
      this.n--;
      this.poke();
    };
    p.then(done, done);
    return p;
  }
  /** Something was redrawn: not ready until it is quiet again. */
  poke() {
    this.busy();
    clearTimeout(this.t);
    if (this.n) return;
    this.t = setTimeout(() => {
      if (!this.n) this.idle();
    }, this.delay);
  }
}

const mark = (on: boolean) => {
  if (typeof document === 'undefined') return;
  document.getElementById('view')?.toggleAttribute('data-ready', on);
};
const work = new Pending(
  () => mark(true),
  () => mark(false),
);

/** Count a background task of the view until it settles (returns it unchanged). */
export const track = <T>(p: Promise<T>): Promise<T> => work.track(p);

/** main.ts, after each render of the view: ready again once the background work is done. */
export const viewRendered = () => work.poke();
