// Unlock screen (passphrase or demo) and loading skeleton.
import { app, rerender, setDataset } from '../app';
import { disposeAll, escapeHtml as esc } from '../charts';
import { WrongPassphrase } from '../crypto';
import { type Source, load, rememberKey, unlock } from '../data';
import { html } from '../trusted';

/** `notice`: an information, not an error (S-7.9: key erased by the browser, data intact). */
export function renderLock(message = '', hasRealData = true, notice = '') {
  disposeAll(app);
  app.innerHTML = html`
  <main class="lock">
    <div class="lock-card">
      <img src="icons/icon.svg" alt="" width="64" height="64">
      <h1>Historique énergie</h1>
      <p class="muted">Radiateurs et chauffe-eau Intuitiv / Intuis — vos données restent chiffrées, elles ne sont déchiffrées que sur cet appareil.</p>
      ${notice ? `<p class="notice" id="lock-notice" role="status">${esc(notice)}</p>` : ''}
      ${
        hasRealData
          ? `<form id="unlock">
        <label for="pass">Phrase de passe</label>
        <input id="pass" type="password" autocomplete="current-password" required autofocus>
        <label class="check"><input id="remember" type="checkbox" checked> Rester connecté sur cet appareil (30 jours au plus)</label>
        <button class="primary" type="submit">Déverrouiller</button>
      </form>`
          : `<p class="notice">Aucune donnée n'a encore été collectée. Suivez le guide d'installation du README, ou essayez la démo.</p>`
      }
      <p class="error" role="alert">${esc(message)}</p>
      <button class="link" id="demo" type="button">Essayer avec des données de démonstration</button>
    </div>
  </main>`;
  const form = document.getElementById('unlock') as HTMLFormElement | null;
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = (document.getElementById('pass') as HTMLInputElement).value;
    const remember = (document.getElementById('remember') as HTMLInputElement).checked;
    await open('data', pass, remember);
  });
  document.getElementById('demo')!.addEventListener('click', () => open('demo', 'demo', false));
}

async function open(source: Source, pass: string, remember: boolean) {
  const btn = app.querySelector<HTMLButtonElement>('button.primary, #demo');
  if (btn) btn.disabled = true;
  app.querySelector('.error')!.textContent = 'Déchiffrement…';
  try {
    const key = await unlock(source, pass);
    if (remember) await rememberKey(source, key);
    renderLoading();
    setDataset(await load(source, key));
    rerender();
  } catch (err) {
    renderLock(err instanceof WrongPassphrase ? 'Phrase de passe incorrecte.' : `Erreur : ${(err as Error).message}`);
  }
}

export function renderLoading() {
  disposeAll(app);
  app.innerHTML = html`<div class="skeleton" aria-busy="true" aria-live="polite">
    <span class="sr-only">Chargement et déchiffrement des données…</span>
    <div class="sk sk-title"></div><div class="sk sk-card"></div>
    <div class="kpis"><div class="sk sk-kpi"></div><div class="sk sk-kpi"></div><div class="sk sk-kpi"></div></div>
    <div class="sk sk-chart"></div></div>`;
}
