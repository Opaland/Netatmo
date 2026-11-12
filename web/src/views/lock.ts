// Unlock screen (passphrase or demo) and loading skeleton.
import { app, rerender, setDataset } from '../app';
import { disposeAll, escapeHtml as esc } from '../charts';
import { WrongPassphrase } from '../crypto';
import { type Dataset, type Source, load, rememberKey, unlock } from '../data';
import { html } from '../trusted';
import { INSTALL_HASH, installSteps } from '../invite';
import { clearLockNotice } from '../session';
import { hideUnreadableNotes, showUnreadableNotes } from '../sealed-notes';
import { bindReveal, hideSecrets, revealButton } from '../reveal';
import { alertHtml, formMsg, switchField } from '../components';
import { lazyAction } from '../lazy';

/** `notice`: an information, not an error (S-7.9: key erased by the browser, data intact). */
export function renderLock(message = '', hasRealData = true, notice = '') {
  hideUnreadableNotes(); // #139: said again at the next unlock if still there
  disposeAll(app);
  app.innerHTML = html`
  <main class="lock">
    <div class="lock-card">
      <img src="icons/icon.svg" alt="" width="64" height="64">
      <h1>Historique énergie</h1>
      <p class="muted">Radiateurs et chauffe-eau Intuitiv / Intuis — vos données restent chiffrées, elles ne sont déchiffrées que sur cet appareil.</p>
      ${notice ? alertHtml('info', esc(notice), { id: 'lock-notice', role: 'status' }) : ''}
      ${
        hasRealData
          ? `<form id="unlock">
        <label for="pass">Phrase de passe</label>
        <div class="secret-field">
          <input id="pass" type="password" autocomplete="current-password" required autofocus spellcheck="false" autocapitalize="off">
          ${revealButton('pass')}
        </div>
        ${switchField('Rester connecté sur cet appareil (30 jours au plus)', true, { id: 'remember' })}
        <button class="primary" type="submit">Déverrouiller</button>
      </form>`
          : `${alertHtml('info', "Aucune donnée n'a encore été collectée. Suivez l'assistant d'installation (ou le guide du README), ou essayez la démo.")}
        <button class="primary" type="button" id="setup-lock">Ouvrir l’assistant d’installation</button>
        <section id="setup-zone" class="setup-lock" hidden></section>`
      }
      ${formMsg(message, { id: 'lock-msg' })}
      <button class="link" id="demo" type="button">Essayer avec des données de démonstration</button>
      <details class="install-help" id="install-help" ${location.hash === INSTALL_HASH ? 'open' : ''}>
        <summary>Installer l'appli sur ce téléphone</summary>
        ${installSteps()}
      </details>
    </div>
  </main>`;
  const form = document.getElementById('unlock') as HTMLFormElement | null;
  if (form) bindReveal(form); // #335
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideSecrets(e.currentTarget as HTMLFormElement); // #335: masked again as soon as it is sent
    const pass = (document.getElementById('pass') as HTMLInputElement).value;
    const remember = (document.getElementById('remember') as HTMLInputElement).checked;
    await open('data', pass, remember);
  });
  document.getElementById('demo')!.addEventListener('click', () => open('demo', 'demo', false));
  // #40: nothing collected yet: the first-launch assistant, loaded on demand
  const setup = document.getElementById('setup-lock');
  setup?.addEventListener('click', () => {
    const zone = document.getElementById('setup-zone');
    void lazyAction(setup, () => import('./setup'), (m) => {
      if (!zone) return;
      zone.hidden = false;
      setup.remove();
      m.mountSetup(zone, false);
    }, 'Assistant d’installation');
  });
  // #229: on <compte>.github.io, a warning next to « Rester connecté » when this browser also keeps
  // something of another Pages site of the account (loaded on demand, and only there).
  if (form && location.hostname.endsWith('.github.io'))
    import('../origin-traces')
      .then((m) => m.warnNear(document.getElementById('remember')?.closest('label') ?? null, location.hostname))
      .catch((err) => console.error(err)); // A2: never a silent catch
}

/** #254: one unlock at a time (passphrase or demo), the other buttons wait. */
let opening = false;

async function open(source: Source, pass: string, remember: boolean) {
  if (opening) return;
  opening = true;
  for (const el of app.querySelectorAll<HTMLButtonElement | HTMLInputElement>('.lock-card button, .lock-card input')) el.disabled = true;
  app.querySelector('.lock-card')?.setAttribute('aria-busy', 'true');
  document.getElementById('lock-msg')!.textContent = 'Déchiffrement…';
  let opened: Dataset;
  try {
    const key = await unlock(source, pass);
    clearLockNotice(); // #334: unlocked again, the « locked after N min » notice has done its job
    if (remember) await rememberKey(source, key);
    // S-12.3: the install fragment of an invitation has done its job
    if (location.hash === INSTALL_HASH) history.replaceState(null, '', location.pathname + location.search);
    renderLoading();
    opened = await load(source, key);
  } catch (err) {
    renderLock(err instanceof WrongPassphrase ? 'Phrase de passe incorrecte.' : `Erreur : ${(err as Error).message}`);
    return;
  } finally {
    opening = false;
  }
  setDataset(opened);
  showApp();
  showUnreadableNotes(source); // #139: device notes this passphrase cannot open, kept untouched
}

/**
 * #250: draw the app once a dataset is installed. A rendering error is a bug, not a lock
 * problem: it gets its own screen (and a console.error), the data stay decrypted until locked.
 */
export function showApp() {
  try {
    rerender();
  } catch (err) {
    console.error(err);
    renderError(err);
  }
}

/** The app could not be drawn: say so, offer to reload or to lock. */
export function renderError(err: unknown) {
  disposeAll(app);
  app.innerHTML = html`
  <main class="lock">
    <div class="lock-card">
      <h1>Affichage impossible</h1>
      ${alertHtml('bad', `Les données sont bien déchiffrées, mais l'affichage a échoué : ${esc(err instanceof Error ? err.message : String(err))}`)}
      <p class="muted">Rechargez la page ; si l'erreur revient, signalez-la (le détail est dans la console du navigateur).</p>
      <button class="primary" type="button" id="reload">Recharger</button>
    </div>
  </main>`;
  document.getElementById('reload')!.addEventListener('click', () => location.reload());
}

export function renderLoading() {
  disposeAll(app);
  app.innerHTML = html`<div class="skeleton" aria-busy="true" aria-live="polite">
    <span class="sr-only">Chargement et déchiffrement des données…</span>
    <div class="sk sk-title"></div><div class="sk sk-card"></div>
    <div class="kpis"><div class="sk sk-kpi"></div><div class="sk sk-kpi"></div><div class="sk sk-kpi"></div></div>
    <div class="sk sk-chart"></div></div>`;
}
