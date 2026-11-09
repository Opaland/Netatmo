// #257: one event-delegation pattern for the whole app. main.ts listens once on #app (click,
// change, input, submit, keydown) and calls, in order, the handlers of the page shown (its entry
// in the page registry, pages.ts) then the handlers registered here by the cards loaded on
// demand. A handler returns true when the event was its own; the others are then not called.
// No card binds `onclick =` properties nor listens on #app by itself.

export type Ctl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface Handlers {
  /** `el`: the button, link or [data-*] element clicked (closest actionable ancestor). */
  click?(el: HTMLElement, e: MouseEvent): boolean | void;
  change?(t: Ctl, e: Event): boolean | void;
  input?(t: Ctl, e: Event): boolean | void;
  submit?(form: HTMLFormElement, e: SubmitEvent): boolean | void;
  keydown?(e: KeyboardEvent): boolean | void;
}

const cards: Handlers[] = [];

/**
 * Handlers of a card module loaded on demand, registered once when the module is evaluated.
 * They test their own ids or data-* attributes: a card that is not on screen never matches.
 */
export function onCard(h: Handlers): void {
  cards.push(h);
}

/** Registered card handlers (main.ts dispatches to them after the page's own). */
export const cardHandlers = (): readonly Handlers[] => cards;

type Fn = (...a: unknown[]) => boolean | void;
/** Call the `kind` handler of each set until one returns true; true when one did. */
export function dispatch(sets: readonly Handlers[], kind: keyof Handlers, ...args: unknown[]): boolean {
  for (const h of sets) {
    const fn = h[kind] as Fn | undefined;
    if (fn && fn.apply(h, args) === true) return true;
  }
  return false;
}
