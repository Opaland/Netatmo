// #335: « Afficher la phrase de passe », an eye button next to a masked field.
//
// - A toggle button (aria-pressed), its name stays the same in both states, so a screen reader
//   says « Afficher la phrase de passe, bouton bascule, activé / désactivé ».
// - Shown, the field becomes type="text" with autocomplete="off": the browser keeps nothing in
//   its autofill history; its own autocomplete value comes back once masked again (#233: the
//   secrets of Paramètres keep « one-time-code », never offered for saving).
// - hideSecrets() masks every field again: call it before reading or sending (after a submit).

const EYE = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF =
  '<path d="M3 3l18 18"/><path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';
const svg = (paths: string, cls: string) =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

/** The toggle button for the masked input `id` (markup, to place right after the input). */
export function revealButton(id: string, label = 'Afficher la phrase de passe'): string {
  return `<button type="button" class="reveal" data-reveal="${id}" aria-controls="${id}" aria-pressed="false" title="${label}">${svg(EYE, 'reveal-show')}${svg(EYE_OFF, 'reveal-hide')}<span class="sr-only">${label}</span></button>`;
}

/** Show or mask the field of a toggle button. */
export function setRevealed(btn: HTMLElement, shown: boolean, doc: Document = btn.ownerDocument) {
  const input = doc.getElementById(btn.dataset.reveal ?? '') as HTMLInputElement | null;
  if (!input) return;
  if (shown && input.type === 'password') {
    input.dataset.autocomplete = input.getAttribute('autocomplete') ?? '';
    input.setAttribute('autocomplete', 'off');
    input.type = 'text';
  } else if (!shown && input.type !== 'password') {
    input.type = 'password';
    if (input.dataset.autocomplete) input.setAttribute('autocomplete', input.dataset.autocomplete);
    else input.removeAttribute('autocomplete');
    delete input.dataset.autocomplete;
  }
  btn.setAttribute('aria-pressed', String(shown));
}

/** Handles the clicks on the toggle buttons inside `root` (delegated, once per root). */
export function bindReveal(root: HTMLElement) {
  if (root.dataset.revealBound) return;
  root.dataset.revealBound = '1';
  root.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-reveal]');
    if (btn && root.contains(btn)) setRevealed(btn, btn.getAttribute('aria-pressed') !== 'true');
  });
}

/** Mask again every field shown inside `root` (after a submit, before the value is used). */
export function hideSecrets(root: ParentNode) {
  for (const btn of root.querySelectorAll<HTMLElement>('[data-reveal][aria-pressed="true"]')) setRevealed(btn, false);
}
