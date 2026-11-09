import { describe, expect, it } from 'vitest';
import { canPrefetch } from './offline';
import { step, swipeDirection } from './swipe';

describe('swipeDirection (S-7.11)', () => {
  it('recognises a quick horizontal swipe', () => {
    expect(swipeDirection(-120, 10, 200)).toBe('left');
    expect(swipeDirection(90, -20, 300)).toBe('right');
  });
  it('ignores short, slow or mostly vertical moves (scrolling)', () => {
    expect(swipeDirection(-40, 0, 100)).toBeNull();
    expect(swipeDirection(-200, 0, 1500)).toBeNull();
    expect(swipeDirection(100, 80, 200)).toBeNull();
  });
});

describe('step', () => {
  const list = ['30d', '12m', '2026', '2025', 'all'];
  it('moves within the list and stops at both ends', () => {
    expect(step(list, '12m', 1)).toBe('2026');
    expect(step(list, '12m', -1)).toBe('30d');
    expect(step(list, '30d', -1)).toBeNull();
    expect(step(list, 'all', 1)).toBeNull();
    expect(step(list, 'unknown', 1)).toBeNull();
  });
});

describe('canPrefetch (S-7.12)', () => {
  it('prefetches on an unmetered connection or when the browser says nothing', () => {
    expect(canPrefetch(undefined)).toBe(true);
    expect(canPrefetch({ type: 'wifi', effectiveType: '4g' })).toBe(true);
  });
  it('saves data on mobile, slow networks, Save-Data and offline', () => {
    expect(canPrefetch({ type: 'cellular' })).toBe(false);
    expect(canPrefetch({ saveData: true, type: 'wifi' })).toBe(false);
    expect(canPrefetch({ effectiveType: '2g' })).toBe(false);
    expect(canPrefetch({}, false)).toBe(false);
  });
});
