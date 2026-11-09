// #312: first launch, after the passphrase (never before, never in its place): four screens at
// most (welcome, who uses this phone, data sources, contract), each one skippable. Seen once per
// device: a flag in its own storage key, like tenant.ts (tiny, no import of the app). A device
// that already used an earlier version (its state is saved) is not shown the screens again.
// The passphrase is never asked, read nor kept here. In the demo nothing is written.
import type { OnboardingStep } from './router';
import { lsKey } from './scope';

export type Who = 'gere' | 'proche' | 'locataire';

export const STEP_COUNT = 4;

export interface Flags {
  /** The screens were seen (or skipped) on this device. */
  done: boolean;
  /** The single contextual tip (« Touchez une pièce pour son détail ») is still to show. */
  tip: boolean;
}

const KEY = lsKey('onboarding');
const STATE_KEY = lsKey('state');

/**
 * Flags read back from storage. Nothing saved: a device that already has a saved state (an
 * earlier version was used here) counts as done, without the tip; a fresh device does not.
 */
export function parseFlags(raw: string | null, hasState: boolean): Flags {
  if (raw === null) return { done: hasState, tip: false };
  try {
    const o = JSON.parse(raw) as Partial<Flags> | null;
    return { done: o?.done === true, tip: o?.tip === true };
  } catch {
    return { done: hasState, tip: false };
  }
}

/** Flags of the demo: kept for the visit only (the demo writes nothing, #312). */
let demoFlags: Flags = { done: true, tip: false };

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readFlags(demo = false): Flags {
  if (demo) return demoFlags;
  const s = store();
  try {
    return parseFlags(s?.getItem(KEY) ?? null, s?.getItem(STATE_KEY) != null);
  } catch {
    return { done: true, tip: false };
  }
}

function writeFlags(f: Flags, demo: boolean) {
  if (demo) {
    demoFlags = f;
    return;
  }
  try {
    store()?.setItem(KEY, JSON.stringify(f));
  } catch {
    /* storage unavailable: shown again next time, harmless */
  }
}

/** The first launch opens by itself after the first unlock on a device (never in the demo). */
export const needsOnboarding = (demo: boolean) => !demo && !readFlags(false).done;

/** Seen to the end (`tip`: then show the contextual tip once) or skipped (no tip). */
export function finishOnboarding(demo: boolean, tip = true) {
  writeFlags({ done: true, tip }, demo);
}

export const tipPending = (demo: boolean) => readFlags(demo).tip;
export const dismissTip = (demo: boolean) => writeFlags({ ...readFlags(demo), tip: false }, demo);

/** Choice pre-selected on screen 2, from the settings of this device. */
export function whoOf(simple: boolean, tenant: boolean): Who {
  return tenant ? 'locataire' : simple ? 'proche' : 'gere';
}

/**
 * Screen after `step` for this choice, or null at the end. A relative (« Un proche ») manages
 * nothing: the sources and the contract are left to whoever manages the home.
 */
export function nextStep(step: OnboardingStep, who: Who): OnboardingStep | null {
  if (step === 2 && who === 'proche') return null;
  return step < STEP_COUNT ? ((step + 1) as OnboardingStep) : null;
}

/** « Étape 2 sur 4 », shown and read with the title of each screen. */
export const stepLabel = (step: OnboardingStep) => `Étape ${step} sur ${STEP_COUNT}`;

/** Address of a screen (router.ts). */
export const stepKey = (step: OnboardingStep) => (step > 1 ? `bienvenue-${step}` : 'bienvenue');
