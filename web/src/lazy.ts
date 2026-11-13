// #249: the one way to load a card or an action on demand. Offline, the card says so and
// offers to try again; any other failure (a bug in the card, a server error) leaves a
// visible error state and a console.error (the e2e tests fail on it). Never a silent
// `.catch(() => {})`, never a card that just disappears.
import { ds } from './app';
import { waiting } from './components';
import { runLazy } from './loader';
import { track } from './ready';
import { html } from './trusted';

type Zone = HTMLElement | string | null | undefined;

const online = () => navigator.onLine !== false;
/** A module could not be fetched offline: the browser keeps that failure until a reload. */
const importFailedOffline = { value: false };

function zoneOf(zone: Zone): HTMLElement | null {
  return typeof zone === 'string' ? document.getElementById(zone) : (zone ?? null);
}

const MESSAGES: Record<'offline' | 'reload' | 'error', [string, string]> = {
  offline: ['indisponible hors connexion.', 'Réessayer'],
  reload: ['de retour en ligne, rechargez la page pour l’afficher.', 'Recharger'],
  error: ['erreur d’affichage (détail dans la console du navigateur).', 'Réessayer'],
};

/** Replace the content of `el` with the failure message and its button (no innerHTML). */
function showFailure(el: HTMLElement, what: string, outcome: 'offline' | 'reload' | 'error', retry: () => void) {
  el.hidden = false;
  el.removeAttribute('aria-busy');
  const [text, label] = MESSAGES[outcome];
  const p = document.createElement('p');
  p.className = outcome === 'error' ? 'hint lazy-failed lazy-error' : 'hint muted lazy-failed';
  p.setAttribute('role', 'status');
  p.textContent = `${what} : ${text} `;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'link';
  b.textContent = label;
  b.dataset.lazyRetry = outcome;
  b.addEventListener('click', (e) => {
    e.stopPropagation(); // not an app-level click
    // back online after a module failed offline: only a reload fetches it again
    if (outcome === 'reload' || (online() && importFailedOffline.value)) return location.reload();
    p.remove();
    retry();
  });
  p.append(b);
  el.replaceChildren(p);
}

/**
 * Import a card module and fill the card. `zone`: where the failure is shown (the card or
 * its placeholder, by element or id); without a zone in the page, nothing is shown, but an
 * error is still reported. `what`: name of the card in the message (« Budget »).
 */
export function lazyCard<M>(load: () => Promise<M>, fill: (m: M) => unknown, opts: { zone: Zone; what: string }): Promise<void> {
  const d = ds;
  const run = (): Promise<void> =>
    track(runLazy(load, fill, { online, stale: () => ds !== d, what: opts.what, importFailedOffline }).then(({ outcome }) => {
      if (outcome === 'ok' || outcome === 'stale') return;
      const el = zoneOf(opts.zone);
      if (el?.isConnected) showFailure(el, opts.what, outcome, () => void run());
    }));
  return run();
}

/**
 * A menu or settings button that loads its module on click (exports, legal frame,
 * invitation…): on failure the button says it for a few seconds; a real error is reported.
 */
export function lazyAction<M>(btn: HTMLElement, load: () => Promise<M>, run: (m: M) => unknown, what: string): Promise<void> {
  const d = ds;
  return track(runLazy(load, run, { online, stale: () => ds !== d, what, importFailedOffline })).then(({ outcome }) => {
    if (outcome === 'ok' || outcome === 'stale' || !btn.isConnected) return;
    const label = btn.textContent;
    btn.textContent =
      outcome === 'offline'
        ? `${what} : indisponible hors connexion, réessayez une fois en ligne`
        : outcome === 'reload'
          ? `${what} : rechargez la page pour l’ouvrir`
          : `${what} : erreur (détail dans la console)`;
    setTimeout(() => {
      if (btn.isConnected) btn.textContent = label;
    }, 4000);
  });
}

/**
 * #555: the view module of pages that the first screen does not show (Historique, Compteur, the
 * tools): imported by `lazyCard` the first time one of them is drawn, then drawn at once on every
 * redraw (no « Chargement… » between two choices of a list).
 */
export function lazyView<M>(load: () => Promise<M>) {
  let mod: M | null = null;
  return {
    /** The module once loaded: the page's event handlers have nothing to handle before. */
    get: () => mod,
    /**
     * Load the module ahead of its page (views/lazy-views.ts, browser idle). A failure changes
     * nothing: the page that needs the view loads it again with `lazyCard`, which reports it.
     */
    warm() {
      if (!mod) void load().then((m) => (mod ??= m), () => undefined);
    },
    /**
     * Draw `el` with the module: now when it is loaded, else after a wait that a screen reader
     * announces (#579: role="status", and `el` aria-busy until it is drawn or says its failure).
     */
    draw(el: HTMLElement, fn: (m: M) => void, what: string) {
      if (mod) return fn(mod);
      el.setAttribute('aria-busy', 'true');
      el.innerHTML = html(waiting('', 'empty'));
      void lazyCard(
        load,
        (m) => {
          mod = m;
          if (el.isConnected) fn(m);
        },
        { zone: el, what },
      ).finally(() => el.removeAttribute('aria-busy'));
    },
  };
}
