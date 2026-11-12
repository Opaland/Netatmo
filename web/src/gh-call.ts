// #463: which GitHub call failed, and the permission of the token it needs, in words. The
// message names the call and the permission only: never a value, a secret's name nor the
// repository (it is shown on screen, may be read aloud or copied into an issue).
// Pure, unit-tested (gh-call.test.ts); settings.ts builds its errors with it.

export interface GhCall {
  /** « la lecture de la liste des secrets »: what was asked of GitHub. */
  what: string;
  /** « « Secrets » en lecture »: the permission of a fine-grained token it needs. */
  permission: string;
}

const ALL = '« Secrets », « Variables » et « Actions » en lecture et écriture';

/** The call behind an API path (query string ignored) and an HTTP method. */
export function ghCall(path: string, method = 'GET'): GhCall {
  const p = path.split('?')[0];
  const m = method.toUpperCase();
  const write = m !== 'GET' && m !== 'HEAD';
  if (/\/actions\/secrets\/public-key$/.test(p)) return { what: 'la lecture de la clé publique du dépôt (avant de chiffrer)', permission: '« Secrets » en lecture' };
  if (/\/actions\/secrets$/.test(p)) return { what: 'la lecture de la liste des secrets', permission: '« Secrets » en lecture' };
  if (/\/actions\/secrets\/[^/]+$/.test(p))
    return write ? { what: 'l’enregistrement d’un secret', permission: '« Secrets » en écriture' } : { what: 'la lecture d’un secret', permission: '« Secrets » en lecture' };
  if (/\/actions\/variables(\/[^/]+)?$/.test(p))
    return write
      ? { what: m === 'POST' ? 'la création d’une variable' : m === 'DELETE' ? 'la suppression d’une variable' : 'la mise à jour d’une variable', permission: '« Variables » en écriture' }
      : { what: 'la lecture d’une variable', permission: '« Variables » en lecture' };
  if (/\/actions\/workflows\/[^/]+\/dispatches$/.test(p)) return { what: 'le lancement de la collecte', permission: '« Actions » en écriture' };
  return { what: 'un appel à GitHub', permission: ALL };
}

/** The message of a failed call: the call, the HTTP status and, when refused, the permission. */
export function ghErrorText(status: number, call: GhCall): string {
  if (status === 401) return `GitHub : jeton invalide ou expiré (refusé pour ${call.what}, HTTP 401).`;
  // 404: what a fine-grained token gets for a repository or a permission it does not cover
  if (status === 403 || status === 404) return `GitHub : droits insuffisants pour ${call.what} (HTTP ${status}) : le jeton doit viser ce dépôt avec la permission ${call.permission}.`;
  return `GitHub : échec pour ${call.what} (HTTP ${status}).`;
}
