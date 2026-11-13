// #370 / #599: a redraw keeps the reader's control where it was ON SCREEN. One rule for both
// redraws of the app: the whole shell (main.ts render, on every change of state) and a card that
// draws itself again around its own control (keepIfRedrawn: ⚙ Alerte froid prolongé…). The geometry is
// pure in scroll-anchor.ts (unit tests); this module measures and applies it.
import { app } from './app';
import { type Anchor, anchorOf, placeAnchor, scrolledAway } from './scroll-anchor';

export type { Anchor };

let release: (() => void) | null = null;
/** Holds started so far (the shell's redraw holds its own anchor: a card's hold stands aside). */
let holds = 0;
/** Let go of the hold in progress, if any (a change of page scrolls to the top). */
export const releaseScroll = () => release?.();

/** Top on screen of the control found by `sel` (its label for a styled box), or null. */
function topOf(sel: string | null): number | null {
  const el = sel ? app.querySelector<HTMLElement>(sel) : null;
  if (!el) return null;
  const r = (el.closest('label') ?? el).getBoundingClientRect();
  return r.width || r.height ? r.top : null;
}

/** The anchor of a redraw about to happen: the control found by `sel`, where it is on screen now. */
export const anchorNow = (sel: string | null): Anchor => anchorOf(window.scrollY, sel, topOf(sel), window.innerHeight);

/**
 * Retours v1.6: the whole shell is drawn again on every change of state, which empties the page
 * for a moment and sends the browser back to the top. Put the control acted on back where it was
 * on screen (#370: not the old scroll position, the content above it may have changed), and hold
 * it there while the lazy cards and charts of the page fill in, until the reader scrolls or the
 * view has settled.
 */
export function holdScroll(a: Anchor) {
  release?.();
  holds++;
  let slack = 0;
  let spacer: HTMLElement | null = null; // room under a page that got shorter than the anchor needs
  /** Scroll so the anchor is where it was; returns how far the page still is from there. */
  const place = () => {
    const doc = document.documentElement.scrollHeight - slack;
    const to = placeAnchor(a, { y: window.scrollY, top: topOf(a.sel), natural: doc, winH: window.innerHeight });
    if (to.slack !== slack) {
      slack = to.slack;
      if (!spacer?.isConnected) spacer = app.appendChild(document.createElement('div'));
      spacer.setAttribute('aria-hidden', 'true');
      spacer.style.height = `${slack}px`;
    }
    if (Math.abs(window.scrollY - to.y) > 1) window.scrollTo(0, to.y);
    return Math.abs(window.scrollY - to.y);
  };
  const y = (place(), window.scrollY);
  if (y <= 0 && !a.sel) return;
  let frame = 0;
  const until = performance.now() + 3000;
  const stop = () => {
    cancelAnimationFrame(frame);
    for (const t of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.removeEventListener(t, stop, true);
    release = null;
  };
  for (const t of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.addEventListener(t, stop, { capture: true, passive: true });
  release = stop;
  // #370: where the hold left the page, and where the control was in it (to tell a redraw, which
  // moves the control, from a scroll by something else, which does not)
  const docTop = () => {
    const t = topOf(a.sel);
    return t === null ? null : window.scrollY + t;
  };
  let lastY = window.scrollY;
  let lastDoc = docTop();
  const tick = () => {
    const doc = docTop();
    const bottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
    if (a.sel && doc !== null && lastDoc !== null && scrolledAway(window.scrollY, lastY, doc - lastDoc, bottom)) return stop();
    const settled = place() <= 1 && document.querySelector('#view[data-ready]');
    lastY = window.scrollY;
    lastDoc = docTop();
    if (settled || performance.now() > until) return stop();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

/**
 * #599: a card that draws itself again around the control acted on (all its HTML written again,
 * in the control's own listener) keeps that control where it was on screen, by the same hold as
 * the whole shell. WebKit (Safari, the iPhone PWA) scrolled the page about 900 px up when a focused
 * list of ⚙ Alerte froid prolongé was replaced while its new value was not laid out yet; Chromium
 * keeps the place by scroll anchoring. Called by the app before the event reaches the control
 * `el` (capture): measures the anchor now (measured 13/11/2026: that layout, taken before the
 * redraw, is enough for WebKit not to jump, e2e/logement.mjs) and, once the control's own
 * listeners have run, holds it if the control was replaced and nothing else (the shell's redraw,
 * which holds its own anchor) took the place meanwhile: the hold puts the control back if a page
 * moves all the same.
 */
export function keepIfRedrawn(e: Event, el: Element | null, sel: string | null) {
  if (!el || !sel || !el.isConnected) return;
  const a = anchorNow(sel);
  const was = holds;
  // added while the event is on its way: runs after the listeners the control already has
  el.addEventListener(e.type, () => !el.isConnected && holds === was && holdScroll(a), { once: true });
}
