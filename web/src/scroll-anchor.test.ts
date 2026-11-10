import { describe, expect, it } from 'vitest';
import { anchorOf, placeAnchor, scrolledAway } from './scroll-anchor';

describe('anchorOf (#370)', () => {
  it('anchors on the control when it is on screen', () => {
    expect(anchorOf(1200, '#x', 300, 740)).toEqual({ y: 1200, sel: '#x', top: 300 });
  });
  it('keeps the scroll position alone when the focus is off screen or absent', () => {
    expect(anchorOf(1200, '#page-title', -900, 740)).toEqual({ y: 1200, sel: null, top: 0 });
    expect(anchorOf(1200, '#x', 800, 740)).toEqual({ y: 1200, sel: null, top: 0 });
    expect(anchorOf(1200, '#x', null, 740)).toEqual({ y: 1200, sel: null, top: 0 });
    expect(anchorOf(1200, null, 300, 740)).toEqual({ y: 1200, sel: null, top: 0 });
  });
});

describe('placeAnchor (#370)', () => {
  const a = { y: 8423, sel: '#m', top: 430 };
  it('a card grew above the control: scroll down by as much, the control stays put', () => {
    // Air et confort: a module linked to a room adds a CO₂ card above the list
    expect(placeAnchor(a, { y: 8423, top: 3060, natural: 11620, winH: 740 })).toEqual({ y: 11053, slack: 173 });
    expect(placeAnchor(a, { y: 8423, top: 3060, natural: 12000, winH: 740 })).toEqual({ y: 11053, slack: 0 });
  });
  it('content shrank above: scroll up by as much', () => {
    expect(placeAnchor(a, { y: 8423, top: 130, natural: 20000, winH: 740 })).toEqual({ y: 8123, slack: 0 });
  });
  it('the page got shorter below the control: room under it instead of a clamped scroll', () => {
    // Pièces, every room unticked: the comparison under the picker empties
    const b = { y: 1548, sel: '#r', top: 232 };
    expect(placeAnchor(b, { y: 1161, top: 619, natural: 1901, winH: 740 })).toEqual({ y: 1548, slack: 387 });
  });
  it('without a control (or once it is gone), the old scroll position', () => {
    expect(placeAnchor({ y: 900, sel: null, top: 0 }, { y: 0, top: 50, natural: 5000, winH: 740 })).toEqual({ y: 900, slack: 0 });
    expect(placeAnchor(a, { y: 0, top: null, natural: 5000, winH: 740 })).toEqual({ y: 8423, slack: 0 });
  });
  it('never above the top of the page', () => {
    expect(placeAnchor(a, { y: 100, top: 0, natural: 5000, winH: 740 })).toEqual({ y: 0, slack: 0 });
  });
});

describe('scrolledAway (#370)', () => {
  it('a scroll by something else: the control did not move in the page', () => {
    expect(scrolledAway(1317, 0, 0, false)).toBe(true);
  });
  it('a redraw moved the control (the browser followed it): keep holding', () => {
    expect(scrolledAway(1338, 1317, 21, false)).toBe(false);
  });
  it('the page got shorter and the browser clamped it at its end: keep holding', () => {
    expect(scrolledAway(1161, 1548, 0, true)).toBe(false);
  });
  it('nothing moved', () => expect(scrolledAway(500, 500, 0, false)).toBe(false));
});
