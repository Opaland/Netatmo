// Settings: write GitHub Actions secrets from the browser and trigger the collection.
//
// Security model
// - The GitHub token is typed by the owner, kept in a module variable only (never in
//   localStorage / IndexedDB), and forgotten when the app is locked or reloaded.
// - Secret values are encrypted IN THE BROWSER with the repository public key
//   (libsodium sealed box, the scheme GitHub requires): only GitHub can decrypt them.
// - Values are never read back (GitHub doesn't allow it) nor displayed.
// - S-12.1: the shared contract is not a secret: it goes into the repository VARIABLE
//   CONTRACT_JSON (token permission « Variables : lecture et écriture »), the only variable
//   the app may write.
import { ghCall, ghErrorText } from './gh-call';

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
    id: 'shelly',
    title: 'Prises connectées Shelly (facultatif)',
    help: "Application Shelly → Paramètres utilisateur → Clé d'autorisation cloud : copiez la clé et le serveur (ex. shelly-103-eu.shelly.cloud).",
    fields: [
      { name: 'SHELLY_AUTH_KEY', label: "Clé d'autorisation cloud", secret: true },
      { name: 'SHELLY_SERVER', label: 'Serveur', secret: false, placeholder: 'shelly-103-eu.shelly.cloud' },
    ],
  },
  {
    id: 'ia',
    title: 'Analyse IA mensuelle (facultatif)',
    help: 'console.anthropic.com → clé API. Seuls les totaux du mois et au plus cinq jours inhabituels sont envoyés, pièces sous pseudonyme.',
    fields: [{ name: 'ANTHROPIC_API_KEY', label: 'Clé API Anthropic', secret: true, placeholder: 'sk-ant-…' }],
  },
];

export const TOKEN_HELP_URL = 'https://github.com/settings/personal-access-tokens/new';

/**
 * #233: attributes of the token / secret inputs, so that the browser and the usual password
 * managers do not offer to save them (they are not this site's credentials). A masked field keeps
 * type="password" (screen readers do not read it aloud) with autocomplete="one-time-code", which
 * browsers exclude from password saving and do not fill (`autocomplete="off"` is ignored on a
 * password field); the fields sit outside any <form> and are sent by a plain button, so no
 * "form submitted" heuristic fires. Best effort only: the help text says to refuse if asked.
 */
export function noSaveAttrs(secret: boolean): string {
  const managers = 'data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other"';
  return secret
    ? `type="password" autocomplete="one-time-code" ${managers} spellcheck="false" autocapitalize="off"`
    : `type="text" autocomplete="off" ${managers} spellcheck="false" autocapitalize="off"`;
}

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
  // #463: the call and the permission in cause, never a value nor the repository
  if (!resp.ok) throw new GitHubError(ghErrorText(resp.status, ghCall(path, init.method)), resp.status);
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

/**
 * #204: secrets the app writes from a card of its own (not from « Sources de données »): the
 * home's location and roofs, sealed like the others, never readable back.
 */
export const APP_SECRETS = new Set(['HOME_LOCATION_JSON', 'STOPPED_ROOMS_JSON', 'WOOD_JSON']);

/**
 * #459: the household settings of ⚙ Mon logement, sealed like HOME_LOCATION_JSON and never
 * written in clear (they used to be repository variables). Same list as the collector
 * (collector/__main__.py HOUSEHOLD_SETTINGS, held in agreement by tests/test_reglages_foyer.py).
 */
export const HOUSEHOLD_SECRETS = new Set(['STOPPED_ROOMS_JSON', 'WOOD_JSON']);

export async function putSecret(repo: string, name: string, value: string): Promise<void> {
  if (FORBIDDEN.has(name) || !(APP_SECRETS.has(name) || GROUPS.some((g) => g.fields.some((f) => f.name === name)))) {
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

/** Repository variables the app may write (S-12.1). Never a household setting (#459). */
export const VARIABLES = new Set(['CONTRACT_JSON', 'COLD_ALERT_JSON']);

/** Create or update a repository variable (not secret, so not sealed). */
export async function putVariable(repo: string, name: string, value: string): Promise<void> {
  if (!VARIABLES.has(name)) throw new GitHubError(`${name} ne peut pas être modifié depuis l'application`, 400);
  try {
    await gh(`/repos/${repo}/actions/variables/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify({ name, value }) });
  } catch (err) {
    if (!(err instanceof GitHubError) || err.status !== 404) throw err;
    await gh(`/repos/${repo}/actions/variables`, { method: 'POST', body: JSON.stringify({ name, value }) });
  }
}

const householdOnly = (name: string) => {
  if (!HOUSEHOLD_SECRETS.has(name)) throw new GitHubError(`${name} ne peut pas être modifié depuis l'application`, 400);
};

/** #459: the value of a plaintext variable left from before the migration; null when there is none. */
export async function plainVariable(repo: string, name: string): Promise<string | null> {
  householdOnly(name);
  try {
    const body = (await (await gh(`/repos/${repo}/actions/variables/${encodeURIComponent(name)}`)).json()) as { value?: unknown };
    return typeof body.value === 'string' ? body.value : '';
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null;
    throw err;
  }
}

/** #459: delete that plaintext variable; false when it was already gone. */
async function deletePlainVariable(repo: string, name: string): Promise<boolean> {
  householdOnly(name);
  try {
    await gh(`/repos/${repo}/actions/variables/${encodeURIComponent(name)}`, { method: 'DELETE' });
    return true;
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return false;
    throw err;
  }
}

/**
 * #459: save a household setting for the household: sealed in this browser and stored as a
 * secret, then the plaintext variable of the same name, if one is left, is deleted (the secret
 * is written first: nothing is lost if the deletion fails). Says whether a variable was deleted.
 */
export async function saveHouseholdSecret(repo: string, name: string, value: string): Promise<{ removedPlain: boolean }> {
  householdOnly(name);
  await putSecret(repo, name, value);
  return { removedPlain: await deletePlainVariable(repo, name) };
}

/** #459: move a plaintext variable, as it is, into the secret of the same name; false when there is none. */
export async function migratePlainVariable(repo: string, name: string): Promise<boolean> {
  const value = await plainVariable(repo, name);
  if (value === null) return false;
  await saveHouseholdSecret(repo, name, value);
  return true;
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
  // Same rule as the collector (collector/shelly.py): the key is only ever sent to *.shelly.cloud.
  if (name === 'SHELLY_SERVER' && !/^(https:\/\/)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.shelly\.cloud\/?$/i.test(v))
    return 'Serveur Shelly attendu, par exemple shelly-103-eu.shelly.cloud.';
  if (name === 'SHELLY_AUTH_KEY' && (v.length < 20 || /\s/.test(v))) return 'Clé Shelly incomplète (copiez-la en entier).';
  return null;
}

/**
 * #259: the invalid fields among the typed ones, each with its label and its message, so that
 * the form can point at them and keep every value typed (nothing is re-rendered).
 */
export function invalidFields(entries: [string, string][]): { name: string; label: string; error: string }[] {
  const labels = new Map(GROUPS.flatMap((g) => g.fields.map((f) => [f.name, f.label] as const)));
  return entries.flatMap(([name, value]) => {
    const error = validate(name, value);
    return error ? [{ name, label: labels.get(name) ?? name, error }] : [];
  });
}

// ------------------------------------------------------------------ S-1.12 expiry of tokens
export interface SourceStatus {
  ok?: string;
  error?: string;
  message?: string;
  credential?: string; // short hash of the secret, never the secret
  since?: string;
  auth_expired?: boolean;
  expires?: string; // YYYY-MM-DD
  expires_estimated?: boolean;
  note?: string;
}

export const RENEW_WARNING_DAYS = 30;

/** Expiry of the source's token as shown in Settings; null when the source has no tracked token. */
export function expiryInfo(s: SourceStatus | undefined, today: string): { date: string | null; estimated: boolean; renew: boolean; daysLeft: number | null } | null {
  if (!s || (!s.credential && !s.expires && !s.auth_expired)) return null;
  const date = s.expires && /^\d{4}-\d{2}-\d{2}$/.test(s.expires) ? s.expires : null;
  const daysLeft = date ? Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null;
  return {
    date,
    estimated: !!s.expires_estimated,
    daysLeft,
    renew: !!s.auth_expired || (daysLeft !== null && daysLeft <= RENEW_WARNING_DAYS),
  };
}
