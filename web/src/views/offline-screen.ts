// #357: offline, and nothing kept on this device yet (the app was never opened here with the
// network, or its storage was erased). A passphrase form could only fail: this screen says why,
// what to do, and tries again by itself when the network comes back.
import { app } from '../app';
import { disposeAll } from '../charts';
import { html } from '../trusted';
import { DATA_CACHE } from '../scope';

/** No encrypted file kept for offline use (neither the data nor the demo): nothing can open. */
export async function nothingKept(): Promise<boolean> {
  try {
    if (!('caches' in window)) return true;
    return (await (await caches.open(DATA_CACHE)).keys()).length === 0;
  } catch {
    return true;
  }
}

export function renderOfflineScreen(retry: () => void) {
  disposeAll(app);
  app.innerHTML = html`
  <main class="lock offline-screen">
    <div class="lock-card">
      <img src="icons/icon.svg" alt="" width="64" height="64">
      <h1>Hors connexion</h1>
      <p>Les données n'ont pas encore été gardées sur cet appareil : il faut les ouvrir une première fois avec le réseau.</p>
      <ul class="plain">
        <li>Reconnectez-vous (Wi-Fi ou données mobiles) : l'appli réessaie toute seule.</li>
        <li>Ensuite, elle s'ouvrira aussi sans réseau, avec les données du dernier passage.</li>
      </ul>
      <button class="primary" type="button" id="offline-retry">Réessayer</button>
    </div>
  </main>`;
  const again = () => {
    window.removeEventListener('online', again);
    retry();
  };
  window.addEventListener('online', again);
  document.getElementById('offline-retry')!.addEventListener('click', again);
}
