// Settings: write GitHub Actions secrets from the browser and trigger the collection.
//
// Security model
// - The GitHub token is typed by the owner, kept in a module variable only (never in
//   localStorage / IndexedDB), and forgotten when the app is locked or reloaded.
// - Secret values are encrypted IN THE BROWSER with the repository public key
//   (libsodium sealed box, the scheme GitHub requires): only GitHub can decrypt them.
// - Values are never read back (GitHub doesn't allow it) nor displayed.

export interface SecretField {
  name: string;
  label: string;
  secret: boolean; // mask the input
  placeholder?: string;
}

export interface SecretGroup {
  id: string;
  title: string;
  help: string;
  fields: SecretField[];
}

export const GROUPS: SecretGroup[] = [
  {
    id: 'intuis',
    title: 'Compte Intuis / Intuitiv (obligatoire)',
    help: "Les mêmes identifiants que l'application mobile. Identifiants d'application : voir le README.",
    fields: [
      { name: 'INTUIS_USERNAME', label: 'E-mail du compte', secret: false, placeholder: 'vous@exemple.fr' },
      { name: 'INTUIS_PASSWORD', label: 'Mot de passe', secret: true },
      { name: 'INTUIS_CLIENT_ID', label: "Identifiant d'application (client_id)", secret: false },
      { name: 'INTUIS_CLIENT_SECRET', label: "Secret d'application (client_secret)", secret: true },
    ],
  },
  {
    id: 'station',
    title: 'Station météo Netatmo (facultatif)',
    help: 'dev.netatmo.com → My apps → votre application → Token generator, scope read_station → refresh token.',
    fields: [
      { name: 'NETATMO_CLIENT_ID', label: 'Client ID', secret: false },
      { name: 'NETATMO_CLIENT_SECRET', label: 'Client secret', secret: true },
      { name: 'NETATMO_REFRESH_TOKEN', label: 'Refresh token', secret: true },
    ],
  },
  {
    id: 'linky',
    title: 'Compteur Linky (facultatif)',
    help: 'conso.boris.sh → accord sur votre compte Enedis → jeton personnel. PDL : 14 chiffres, sur la facture.',
    fields: [
      { name: 'ENEDIS_TOKEN', label: 'Jeton Conso API', secret: true },
      { name: 'ENEDIS_PRM', label: 'Numéro de PDL (14 chiffres)', secret: false, placeholder: '01234567890123' },
    ],
  },
  {
    id: 'ia',
    title: 'Analyse IA mensuelle (facultatif)',
    help: 'console.anthropic.com → clé API. Seuls des totaux mensuels sont envoyés.',
    fields: [{ name: 'ANTHROPIC_API_KEY', label: 'Clé API Anthropic', secret: true, placeholder: 'sk-ant-…' }],
  },
];

export const TOKEN_HELP_URL = 'https://github.com/settings/personal-access-tokens/new';

let token: string | null = null;
let publicKey: { key: string; key_id: string } | null = null;

export const hasToken = () => token !== null;
export function setToken(t: string | null) {
  token = t?.trim() || null;
  publicKey = null;
}

/** owner/repo from https://<owner>.github.io/<repo>/ ; null elsewhere (dev, demo). */
export function repoFromLocation(loc: Location = window.location): string | null {
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(loc.hostname);
  const repo = loc.pathname.split('/').filter(Boolean)[0];
  return m && repo ? `${m[1]}/${repo}` : null;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function gh(path: string, init: RequestInit = {}): Promise<Response> {
  if (!token) throw new GitHubError('Jeton GitHub manquant', 401);
  const resp = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!resp.ok) {
    const hint =
      resp.status === 401
        ? 'jeton invalide ou expiré'
        : resp.status === 403 || resp.status === 404
          ? 'droits insuffisants : le jeton doit viser ce dépôt avec « Secrets : lecture et écriture » et « Actions : lecture et écriture »'
          : `HTTP ${resp.status}`;
    throw new GitHubError(`GitHub : ${hint}`, resp.status);
  }
  return resp;
}

/** Names of the secrets already configured (values are never readable). */
export async function listSecrets(repo: string): Promise<Set<string>> {
  const body = (await (await gh(`/repos/${repo}/actions/secrets?per_page=100`)).json()) as { secrets: { name: string }[] };
  return new Set(body.secrets.map((s) => s.name));
}

/** Encrypt with the repository public key (sealed box) and store the secret. */
/** Secrets the app must never write: changing them here would break existing data. */
export const FORBIDDEN = new Set(['DATA_PASSPHRASE']);

export async function putSecret(repo: string, name: string, value: string): Promise<void> {
  if (FORBIDDEN.has(name) || !GROUPS.some((g) => g.fields.some((f) => f.name === name))) {
    throw new GitHubError(`${name} ne peut pas être modifié depuis l'application`, 400);
  }
  const { default: sodium } = await import('libsodium-wrappers');
  await sodium.ready;
  if (!publicKey) publicKey = (await (await gh(`/repos/${repo}/actions/secrets/public-key`)).json()) as typeof publicKey;
  const key = sodium.from_base64(publicKey!.key, sodium.base64_variants.ORIGINAL);
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), key);
  await gh(`/repos/${repo}/actions/secrets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify({
      encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL),
      key_id: publicKey!.key_id,
    }),
  });
}

export async function runCollect(repo: string, backfill: boolean): Promise<void> {
  await gh(`/repos/${repo}/actions/workflows/collect.yml/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs: { backfill } }),
  });
}

/** Light checks before sending, so obvious typos are caught locally. */
export function validate(name: string, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (name === 'ENEDIS_PRM' && !/^\d{14}$/.test(v)) return 'Le PDL compte 14 chiffres.';
  if (name === 'INTUIS_USERNAME' && !v.includes('@')) return 'Adresse e-mail attendue.';
  if (name === 'ANTHROPIC_API_KEY' && !v.startsWith('sk-ant-')) return 'Une clé Anthropic commence par « sk-ant- ».';
  return null;
}
