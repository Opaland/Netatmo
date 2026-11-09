// S-12.3: « Inviter un membre du foyer » (Paramètres), loaded on demand. A QR code of the public
// address of the app and three steps. The passphrase is never in the QR code, the link, the
// clipboard or the history: it is told by word of mouth.
import { inviteUrl, installSteps } from '../invite';
import { qrSvg } from '../qr';
import { esc } from '../ui';
import { onCard } from '../events';

export function inviteHtml(href = location.href): string {
  const url = inviteUrl(href);
  if (!url)
    return `<div class="card-head"><h2>Inviter un membre du foyer</h2></div>
      <p class="hint muted">L'invitation demande l'adresse https de l'appli (GitHub Pages) : ouvrez l'appli depuis cette adresse pour afficher le QR code.</p>`;
  return `<div class="card-head"><h2>Inviter un membre du foyer</h2></div>
    <div class="invite">
      ${qrSvg(url, "QR code de l'adresse de l'appli")}
      <div>
        <p class="invite-url"><code>${esc(url)}</code></p>
        <button type="button" class="link" id="invite-copy">Copier le lien</button>
        <ol class="invite-steps">
          <li>Le proche <strong>scanne ce QR code</strong> avec l'appareil photo de son téléphone (ou ouvre le lien).</li>
          <li>Il <strong>installe l'appli</strong> sur l'écran d'accueil :${installSteps()}</li>
          <li>Vous lui <strong>dites la phrase de passe de vive voix</strong> ; il la saisit une fois.</li>
        </ol>
      </div>
    </div>
    <p class="hint muted">Le QR code ne contient que l'adresse publique de l'appli : <strong>ni phrase de passe, ni jeton</strong>. Sans la phrase, on ne voit que l'écran de déverrouillage. Ne l'envoyez pas avec le lien dans le même message (un SMS ou un courriel se transfère, se sauvegarde et se lit par-dessus l'épaule).</p>`;
}

/** Kept for the callers: the copy button is handled by the registered handler below (#257). */
export function bindInvite(_card: HTMLElement) {}

onCard({
  click(el) {
    if (el.id !== 'invite-copy') return false;
    const url = inviteUrl(location.href);
    if (!url) return true;
    navigator.clipboard?.writeText(url).then(
      () => (el.textContent = 'Lien copié'),
      () => (el.textContent = 'Copie impossible : recopiez le lien'),
    );
    return true;
  },
});
