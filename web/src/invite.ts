// S-12.3: invite a member of the household. The QR code holds the PUBLIC address of the app and
// nothing else: no passphrase, no token, no key. The passphrase is told by word of mouth and typed
// once on the member's phone. Threat model: README, « Inviter un membre du foyer ».

/** Fragment that opens the installation help on the lock screen. A fragment never reaches the
 * server (not in requests, not in server logs) and carries no secret anyway. */
export const INSTALL_HASH = '#installer';

/**
 * Address put in the QR code: the page the app is served from, without user info, query or
 * fragment (whatever they hold), plus INSTALL_HASH. Only https (or a local address, for tests).
 */
export function inviteUrl(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
  return `${u.protocol}//${u.host}${u.pathname}${INSTALL_HASH}`;
}

/** The three steps, shared by the invite card and the lock screen (HTML, no user data). */
export function installSteps(): string {
  return `<ul class="plain install-steps">
    <li><strong>iPhone, iPad</strong> : dans Safari, bouton Partager (le carré d'où sort une flèche), puis « Sur l'écran d'accueil ».</li>
    <li><strong>Android</strong> : dans Chrome, menu ⋮, puis « Installer l'application » (ou « Ajouter à l'écran d'accueil »).</li>
    <li>Ouvrez l'appli depuis sa nouvelle icône et saisissez la phrase de passe que l'on vous a dite ; cochez « Rester connecté » pour ne pas la retaper.</li>
  </ul>`;
}
