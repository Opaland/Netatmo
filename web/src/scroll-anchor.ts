// #370: a redraw of the same page keeps the reader's control where it was ON SCREEN, not the old
// scroll position. Ticking a room or linking a module redraws the whole page: a card above the
// control may grow (a new CO₂ card in Air et confort) or the page below it may shrink (« Aucune »
// room in Pièces). Holding the old scrollY then sends the control off screen; anchoring on it
// keeps it under the finger, and a little room is left under a page that got too short.
// Pure, for the unit tests: main.ts measures and applies.

/** The control the reader was acting on, and where it was on screen, before the redraw. */
export interface Anchor {
  /** Scroll position before the redraw (fallback when the control is gone). */
  y: number;
  /** Selector finding the control again (main.ts focusSelector), or null. */
  sel: string | null;
  /** Its top in the viewport before the redraw. */
  top: number;
}

/**
 * The anchor of a redraw: the focused control when it is on screen (a focus left on a title the
 * reader scrolled away from must not pull the page back to it), else the scroll position alone.
 */
export function anchorOf(y: number, sel: string | null, top: number | null, winH: number): Anchor {
  return sel && top !== null && top >= 0 && top < winH ? { y, sel, top } : { y, sel: null, top: 0 };
}

/**
 * Where to scroll after the redraw, and the room needed under the page (`slack`, in px) so that
 * the browser does not clamp that position (only to keep a control found again in place).
 * `top`: the control's top now (null: gone);
 * `natural`: the page height without any room added.
 */
export function placeAnchor(a: Anchor, now: { y: number; top: number | null; natural: number; winH: number }): { y: number; slack: number } {
  const found = !!a.sel && now.top !== null;
  const y = Math.max(0, Math.round(found ? now.y + now.top! - a.top : a.y));
  // room only for a control still there: without one, the lazy cards make the page tall again
  return { y, slack: found ? Math.max(0, y - Math.max(0, now.natural - now.winH)) : 0 };
}
