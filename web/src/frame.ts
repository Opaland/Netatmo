// #237, clickjacking. GitHub Pages sends neither X-Frame-Options nor a CSP header, and
// `frame-ancestors` is ignored in a <meta> CSP: nothing stops another site from showing the
// app in a (transparent) frame and making the user click « Collecter maintenant », « Oublier
// le jeton »… So the app checks it itself: inside a frame, it renders no screen at all (no
// unlock form, no data, no settings), only a message and a link that opens it on its own.
// Limit: a page that sandboxes the frame without scripts gets a blank page (the app needs
// JavaScript anyway), and this check cannot replace a real HTTP header (README, sécurité).
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** True when this window is not the top-level one (a cross-origin `top` is still comparable). */
export function isFramed(w: { top: unknown; self: unknown } = window): boolean {
  try {
    return w.top !== w.self;
  } catch {
    return true; // when in doubt, act as framed
  }
}

/** Message shown instead of the app inside a frame. */
export function framedHtml(href: string): string {
  return `<main class="lock">
    <div class="lock-card" id="framed">
      <h1>Historique énergie</h1>
      <p class="notice" role="alert">Pour votre sécurité, l'application ne s'affiche pas à l'intérieur d'une autre page.</p>
      <p><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Ouvrir l'application directement</a></p>
    </div>
  </main>`;
}
