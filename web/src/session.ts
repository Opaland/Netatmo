// S-8.11: how long the app stays open on this device.
//
// - "Rester connecté" keeps the derived key in IndexedDB for REMEMBER_DAYS at most.
// - After `minutes` without interaction (pointer, keyboard, the page coming back to the
//   foreground), the app locks: decrypted data, the remembered key and the GitHub token
//   are forgotten. The last interaction is also saved, so closing the tab or reloading
//   the page does not get around the timer.

export const REMEMBER_DAYS = 30;
const DAY_MS = 86_400_000;
/** Inactivity delays offered in the menu, in minutes; 0 = never on this device. */
export const LOCK_CHOICES = [5, 15, 60, 0] as const;
export const DEFAULT_LOCK_MINUTES = 15;

export interface RememberedKey {
  key: CryptoKey;
  at: number; // ms since epoch, when "Rester connecté" was ticked
}

/** The remembered key if still within REMEMBER_DAYS; null when expired or of an older format. */
export function freshKey(entry: unknown, now = Date.now()): CryptoKey | null {
  if (!entry || typeof entry !== 'object' || !('at' in entry) || !('key' in entry)) return null; // v1.2: no date
  const { key, at } = entry as RememberedKey;
  if (typeof at !== 'number' || at > now + 60_000 || now - at > REMEMBER_DAYS * DAY_MS) return null;
  return key;
}

const ACTIVITY_KEY = 'intuis-history:activity';
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

function storedActivity(): number | null {
  try {
    const v = Number(localStorage.getItem(ACTIVITY_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** True when the last interaction saved on this device is older than `minutes` (0 = never). */
export function idleSince(minutes: number, now = Date.now()): boolean {
  const last = storedActivity();
  return minutes > 0 && last !== null && now - last > minutes * 60_000;
}

/** Locks after `minutes` without interaction. Call start() once unlocked, stop() once locked. */
export class IdleLock {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last = 0;
  private saved = 0;
  private minutes = DEFAULT_LOCK_MINUTES;
  private running = false;

  constructor(
    private readonly onLock: () => void,
    private readonly now: () => number = () => Date.now(),
    private readonly target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null = typeof document !== 'undefined'
      ? document
      : null,
  ) {}

  private readonly onActivity = () => this.touch();
  private readonly onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    // Timers are throttled in the background: check the real elapsed time first.
    if (!this.check()) this.touch();
  };

  start(minutes: number) {
    this.minutes = minutes;
    if (!this.running && this.target) {
      for (const e of EVENTS) this.target.addEventListener(e, this.onActivity, { passive: true, capture: true });
      this.target.addEventListener('visibilitychange', this.onVisibility);
    }
    this.running = true;
    this.touch();
  }

  /** Change the delay (menu); 0 disables the lock on this device. */
  configure(minutes: number) {
    if (this.running) this.start(minutes);
    else this.minutes = minutes;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running && this.target) {
      for (const e of EVENTS) this.target.removeEventListener(e, this.onActivity, { capture: true });
      this.target.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.running = false;
  }

  /** An interaction: restart the countdown (saved at most every 30 s). */
  touch() {
    if (!this.running) return;
    this.last = this.now();
    if (this.last - this.saved > 30_000) {
      this.saved = this.last;
      try {
        localStorage.setItem(ACTIVITY_KEY, String(this.last));
      } catch {
        /* storage unavailable: the in-page timer still works */
      }
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = this.minutes > 0 ? setTimeout(() => this.check(), this.minutes * 60_000) : null;
  }

  /** Lock if the delay has elapsed. Returns true when it locked. */
  check(): boolean {
    if (!this.running || this.minutes <= 0) return false;
    const left = this.last + this.minutes * 60_000 - this.now();
    if (left > 0) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.check(), left);
      return false;
    }
    this.stop();
    this.onLock();
    return true;
  }
}
