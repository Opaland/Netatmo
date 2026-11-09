// S-8.11: how long the app stays open on this device.
//
// - "Rester connecté" keeps the derived key in IndexedDB for REMEMBER_DAYS at most.
// - After `minutes` without interaction (pointer, keyboard, the page coming back to the
//   foreground), the app locks: decrypted data, the remembered key and the GitHub token
//   are forgotten. The last interaction is also saved, so closing the tab or reloading
//   the page does not get around the timer.
// - #334: that saved interaction is SHARED by every tab (and installed window) of the app on
//   this device, because the key they forget is shared too. Before, a tab left alone counted
//   only its own interactions: after 15 min it locked and erased the remembered key while the
//   user was working in another tab, who was then asked for the passphrase at the next
//   refresh, without a word. Now a tab locks only when NO tab has been used for the delay, and
//   the lock screen says why (lockNotice()).
import { lsKey } from './scope';

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

const ACTIVITY_KEY = lsKey('activity');
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/** The last interaction saved on this device, by any tab of the app (null if none). */
export function storedActivity(): number | null {
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

// #334: why the app locked by itself, shown once on the lock screen (no secret: the delay only).
const LOCK_REASON_KEY = lsKey('locked');

/** Remember that the app locked after `minutes` without interaction (shown by lockNotice). */
export function markIdleLock(minutes: number, now = Date.now()) {
  try {
    localStorage.setItem(LOCK_REASON_KEY, JSON.stringify({ reason: 'idle', minutes, at: now }));
  } catch {
    /* storage unavailable: no explanation, nothing worse */
  }
}

/** Forget why the app locked (unlocked again, or locked on purpose). */
export function clearLockNotice() {
  try {
    localStorage.removeItem(LOCK_REASON_KEY);
  } catch {
    /* nothing to forget */
  }
}

/** The message of the lock screen after a lock due to inactivity ('' if none), until the next unlock. */
export function lockNotice(): string {
  let v: unknown = null;
  try {
    v = JSON.parse(localStorage.getItem(LOCK_REASON_KEY) ?? 'null');
  } catch {
    return '';
  }
  if (!v || typeof v !== 'object' || (v as { reason?: unknown }).reason !== 'idle') return '';
  const m = Number((v as { minutes?: unknown }).minutes);
  if (!Number.isFinite(m) || m <= 0) return '';
  const delay = m < 60 ? `${m} min` : `${m / 60} h`;
  return `Verrouillé après ${delay} sans activité sur cet appareil : ressaisissez la phrase de passe. Vos données sont intactes. Le délai se règle dans Paramètres, Sécurité (« Verrouiller sans activité »).`;
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
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return this.flush();
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

  private save() {
    // Never move the shared mark back (another tab may have saved a later interaction).
    if (this.last <= (storedActivity() ?? 0)) return void (this.saved = this.last);
    this.saved = this.last;
    try {
      localStorage.setItem(ACTIVITY_KEY, String(this.last));
    } catch {
      /* storage unavailable: the in-page timer still works */
    }
  }

  /** #334: the page goes to the background or is being reloaded: save the last interaction now. */
  flush() {
    if (this.running && this.last > this.saved) this.save();
  }

  /** An interaction: restart the countdown (saved at most every 30 s). */
  touch() {
    if (!this.running) return;
    this.last = this.now();
    if (this.last - this.saved > 30_000) this.save();
    if (this.timer) clearTimeout(this.timer);
    this.timer = this.minutes > 0 ? setTimeout(() => this.check(), this.minutes * 60_000) : null;
  }

  /** Lock if the delay has elapsed. Returns true when it locked. */
  check(): boolean {
    if (!this.running || this.minutes <= 0) return false;
    // #334: an interaction in another tab of the app counts too (the key is shared).
    const last = Math.max(this.last, storedActivity() ?? 0);
    const left = last + this.minutes * 60_000 - this.now();
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
