import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdleLock, REMEMBER_DAYS, freshKey, idleSince } from './session';

const DAY = 86_400_000;
const key = { type: 'secret' } as unknown as CryptoKey;

describe('remembered key (S-8.11)', () => {
  it('lasts 30 days at most', () => {
    const now = Date.UTC(2026, 10, 9);
    expect(REMEMBER_DAYS).toBe(30);
    expect(freshKey({ key, at: now - 29 * DAY }, now)).toBe(key);
    expect(freshKey({ key, at: now - 31 * DAY }, now)).toBeNull();
    expect(freshKey({ key, at: now + DAY }, now)).toBeNull(); // clock moved back
  });

  it('forgets a key remembered without a date (v1.2)', () => {
    expect(freshKey(key, Date.now())).toBeNull();
    expect(freshKey(undefined)).toBeNull();
  });
});

describe('inactivity lock (S-8.11)', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 9, 12));
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const target = () => {
    const t = new EventTarget();
    return t;
  };

  it('locks after 15 minutes without interaction, not before', () => {
    const onLock = vi.fn();
    const t = target();
    const idle = new IdleLock(onLock, () => Date.now(), t);
    idle.start(15);
    vi.advanceTimersByTime(14 * 60_000);
    t.dispatchEvent(new Event('keydown')); // activity restarts the countdown
    vi.advanceTimersByTime(14 * 60_000);
    expect(onLock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_001);
    expect(onLock).toHaveBeenCalledTimes(1);
    // Once locked, it no longer listens.
    t.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(60 * 60_000);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('can be set to 5 or 60 minutes, or never on this device', () => {
    const onLock = vi.fn();
    const idle = new IdleLock(onLock, () => Date.now(), target());
    idle.start(60);
    vi.advanceTimersByTime(59 * 60_000);
    idle.configure(0);
    vi.advanceTimersByTime(24 * 60 * 60_000);
    expect(onLock).not.toHaveBeenCalled();
    idle.configure(5);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('remembers the last interaction, so closing the tab does not reset the timer', () => {
    const idle = new IdleLock(() => {}, () => Date.now(), target());
    idle.start(15);
    idle.stop();
    vi.advanceTimersByTime(10 * 60_000);
    expect(idleSince(15)).toBe(false);
    vi.advanceTimersByTime(6 * 60_000);
    expect(idleSince(15)).toBe(true);
    expect(idleSince(0)).toBe(false); // never
    expect(idleSince(60)).toBe(false);
  });
});
