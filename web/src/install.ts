// #357: « Installer l'application ». Chrome and Android send `beforeinstallprompt` when the app
// can be installed, sometimes while the page is still loading: main.ts calls listenInstall()
// first thing, and the card of Paramètres → À propos reads what was received. Safari (iPhone,
// iPad) has no such event: the card says the gesture (Partager → « Sur l'écran d'accueil »),
// never a button that does nothing. Opened from its icon (display-mode: standalone), or once
// `appinstalled` has arrived, nothing is offered any more.
import { isIos } from './storage';

/** The event of Chrome and Android, absent from the DOM types. */
export interface InstallPrompt extends Event {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Sent on window when the installation state changes (the card redraws itself). */
export const INSTALL_EVENT = 'energie:installation';

let deferred: InstallPrompt | null = null;
let installed = false;

export function listenInstall(win: Window = window) {
  win.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // our button instead of the browser's mini bar
    deferred = e as InstallPrompt;
    win.dispatchEvent(new Event(INSTALL_EVENT));
  });
  win.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    win.dispatchEvent(new Event(INSTALL_EVENT));
  });
}

/** Launched from its icon: Android, desktop (display-mode) and iOS (navigator.standalone). */
export function isStandalone(win: Window = window): boolean {
  return !!win.matchMedia?.('(display-mode: standalone)').matches || (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export type InstallState = 'installed' | 'prompt' | 'ios' | 'menu';

/** What to offer: nothing (installed), the button (prompt), the Safari gesture, or the menu. */
export function installState(o: { standalone: boolean; installed: boolean; prompt: boolean; ios: boolean }): InstallState {
  if (o.standalone || o.installed) return 'installed';
  if (o.prompt) return 'prompt';
  return o.ios ? 'ios' : 'menu';
}

export function currentInstallState(win: Window = window): InstallState {
  return installState({ standalone: isStandalone(win), installed, prompt: deferred !== null, ios: isIos(win.navigator.userAgent, win.navigator.maxTouchPoints) });
}

/** Opens the browser's installation window; the event can be used once. */
export async function promptInstall(win: Window = window): Promise<'accepted' | 'dismissed' | null> {
  const e = deferred;
  if (!e) return null;
  deferred = null;
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === 'accepted') installed = true;
    return outcome;
  } catch {
    return null;
  } finally {
    win.dispatchEvent(new Event(INSTALL_EVENT));
  }
}

/** Same words as installSteps() (src/invite.ts), for this device only. */
export const IOS_GESTURE = "Dans Safari, bouton Partager (le carré d'où sort une flèche), puis « Sur l'écran d'accueil ».";
export const MENU_GESTURE = "Menu du navigateur (⋮), puis « Installer l'application » (ou « Ajouter à l'écran d'accueil »).";
