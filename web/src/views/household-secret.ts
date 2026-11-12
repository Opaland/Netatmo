// #459: the household settings of ⚙ Mon logement (radiators switched off on purpose, the stove's
// wood; #497: and the shared contract, the cold alert of ⚙ Paramètres) are sealed in this browser
// with the repository public key and stored as secrets, like the location (#204). They used to be plaintext repository variables: when one is still there, the
// card offers to migrate it (secret written, then the variable deleted) and says so on screen.
import { alert } from '../components';
import { hasToken, migratePlainVariable, plainVariable, saveHouseholdSecret } from '../settings';
import { track } from '../ready';
import { esc } from '../ui';

type Plain = 'checking' | 'present' | 'absent' | 'unknown';
const plain = new Map<string, Plain>();
const key = (repo: string, name: string) => `${repo}\n${name}`;

/** Where the setting lives, for the card: one sentence before the JSON sent. */
export const secretWhere = (name: string) =>
  `Secret du dépôt <code>${esc(name)}</code>, scellé dans ce navigateur avec la clé publique du dépôt (personne ne peut le relire, pas même cette appli) ; la collecte de la nuit le recopie chiffré. Contenu envoyé :`;

/** Without a token: what to connect. */
export const tokenHint = 'Connectez un jeton GitHub (⚙ Sources de données, permissions Secrets et Variables) pour enregistrer.';

/** Ask GitHub once whether the old plaintext variable is still there; `done` re-renders the card. */
export function checkPlain(repo: string, name: string, done: () => void): void {
  if (!hasToken() || !repo || plain.has(key(repo, name))) return;
  plain.set(key(repo, name), 'checking');
  void track(
    plainVariable(repo, name)
      .then((v) => plain.set(key(repo, name), v === null ? 'absent' : 'present'))
      .catch(() => plain.set(key(repo, name), 'unknown')) // no right to read variables: nothing to offer
      .finally(done),
  );
}

/** The migration offer, when the old plaintext variable is still in the repository. */
export function plainOffer(repo: string, name: string, canWrite: boolean): string {
  if (!canWrite || plain.get(key(repo, name)) !== 'present') return '';
  return alert(
    'warn',
    `Ancienne variable en clair ${name} dans le dépôt`,
    'Elle est lisible en clair par les collaborateurs du dépôt et par chaque workflow. La migrer la scelle en secret, avec le même contenu, puis la supprime.',
    `<div class="controls"><button type="button" class="btn secondary" data-migrate-plain="${esc(name)}">Migrer en secret</button></div>`,
  );
}

type Report = (m: { ok: boolean; text: string }) => void;

/**
 * Seal and save; the sentence says whether the old plaintext variable was deleted too (`done`:
 * when it applies, « à la prochaine collecte » by default). Rejects with GitHub's message.
 */
export async function saveSecretText(repo: string, name: string, value: string, done = 'pris en compte à la prochaine collecte'): Promise<string> {
  const { removedPlain } = await saveHouseholdSecret(repo, name, value);
  plain.set(key(repo, name), 'absent');
  return `Enregistré pour le foyer, scellé en secret : ${done}.${removedPlain ? ` L’ancienne variable en clair ${name} a été supprimée.` : ''}`;
}

/** Seal and save, the message reported to the card. */
export function saveSecret(repo: string, name: string, value: string, report: Report): Promise<void> {
  return saveSecretText(repo, name, value)
    .then((text) => report({ ok: true, text }))
    .catch((err: Error) => report({ ok: false, text: err.message }));
}

/** Move the old plaintext variable into the secret; the sentence to show. Rejects with GitHub's message. */
export async function migrateText(repo: string, name: string): Promise<string> {
  const moved = await migratePlainVariable(repo, name);
  plain.set(key(repo, name), 'absent');
  return moved
    ? `Migré : le secret ${name} est enregistré avec le contenu de la variable, et la variable en clair a été supprimée.`
    : `La variable en clair ${name} n’existe plus : rien à migrer.`;
}

/** The « Migrer en secret » button of `plainOffer`. */
export function bindMigrate(card: HTMLElement, repo: string, name: string, report: Report, rerender: () => void): void {
  card.querySelector<HTMLButtonElement>(`[data-migrate-plain="${name}"]`)?.addEventListener('click', () => {
    report({ ok: true, text: 'Migration en cours…' });
    rerender();
    migrateText(repo, name)
      .then((text) => report({ ok: true, text }))
      .catch((err: Error) => report({ ok: false, text: err.message }))
      .finally(rerender);
  });
}
