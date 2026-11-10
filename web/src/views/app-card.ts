// #357: Paramètres → À propos, card « Application sur cet appareil »: install, offline readiness,
// whether the browser keeps the storage (storage.persisted()), and « Recharger l'application ».
import { escapeHtml as esc } from '../charts';
import { html } from '../trusted';
import { INSTALL_EVENT, IOS_GESTURE, MENU_GESTURE, type InstallState, currentInstallState, promptInstall } from '../install';
import { offlineReady, reloadApp } from '../pwa';

export interface AppCardInfo {
  install: InstallState;
  /** navigator.storage.persisted(): null when the browser does not say. */
  persisted: boolean | null;
  offline: boolean;
  message?: string;
}

function installPart(s: InstallState): string {
  if (s === 'installed') return '';
  const how =
    s === 'prompt'
      ? `<button type="button" class="btn primary" id="install-app">Installer l'application</button>`
      : `<p id="install-how"><strong>${s === 'ios' ? 'iPhone, iPad' : 'Pour l’installer'} :</strong> ${esc(s === 'ios' ? IOS_GESTURE : MENU_GESTURE)}</p>`;
  return `<h3>Installer</h3>
    <p class="hint muted">Une icône sur l'écran d'accueil, l'appli en plein écran, utilisable hors connexion.</p>
    ${how}`;
}

function persistLine(p: boolean | null): string {
  if (p === true) return 'Le navigateur garde le stockage de cette application : il ne l’effacera pas pour faire de la place.';
  if (p === false)
    return 'Le navigateur peut effacer le stockage de cette application s’il manque de place (la clé mémorisée et les données hors ligne ; vos données restent chiffrées dans le dépôt). Cocher « Rester connecté » le lui demande.';
  return 'Ce navigateur ne dit pas s’il garde le stockage de cette application.';
}

export function appCardHtml(i: AppCardInfo): string {
  return `<div class="card-head"><h2 id="app-card-title" tabindex="-1">Application sur cet appareil</h2></div>
    ${installPart(i.install)}
    <h3>Hors connexion</h3>
    <p id="offline-ready">${
      i.offline
        ? 'Prête pour une utilisation hors connexion sur cet appareil : l’application et les données déjà ouvertes.'
        : 'Pas encore prête hors connexion : ouvrez-la une fois avec le réseau, puis rechargez.'
    }</p>
    <p id="persist-state">${esc(persistLine(i.persisted))}</p>
    <h3>Recharger l'application</h3>
    <p class="hint muted">Si l'appli semble bloquée sur une ancienne version : elle est retéléchargée (réseau nécessaire).
      <strong>Gardés</strong> : la clé mémorisée (« Rester connecté »), vos notes chiffrées (factures, travaux, corrections),
      les données chiffrées gardées pour le hors connexion et vos réglages.</p>
    <div class="controls"><button type="button" class="btn secondary" id="reload-app">Recharger l'application</button></div>
    ${i.message ? `<p class="settings-msg ko" role="status">${esc(i.message)}</p>` : ''}`;
}

async function persisted(): Promise<boolean | null> {
  try {
    const s = navigator.storage;
    return s?.persisted ? await s.persisted() : null;
  } catch {
    return null;
  }
}

let message = '';

export async function mountAppCard(el: HTMLElement | null) {
  if (!el) return;
  const p = await persisted();
  if (!el.isConnected) return;
  // the button that had the focus may go (installed): the focus stays in the card
  const hadFocus = el.contains(document.activeElement) && document.activeElement !== el;
  el.innerHTML = html(appCardHtml({ install: currentInstallState(), persisted: p, offline: offlineReady(), message }));
  message = '';
  if (hadFocus && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('#app-card-title')?.focus();
}

// the browser says the app can be installed (or was): the card follows, if it is shown
globalThis.window?.addEventListener(INSTALL_EVENT, () => void mountAppCard(document.getElementById('app-card')));

/** Clicks of the card. Returns true when the click belonged to it. */
export function handleAppClick(btn: HTMLElement): boolean {
  if (btn.id === 'install-app') {
    void promptInstall();
    return true;
  }
  if (btn.id === 'reload-app') {
    (btn as HTMLButtonElement).disabled = true;
    btn.textContent = 'Rechargement…';
    void reloadApp().then((err) => {
      if (!err) return;
      message = err;
      void mountAppCard(document.getElementById('app-card'));
    });
    return true;
  }
  return false;
}
