import sodium from 'libsodium-wrappers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ghCall, ghErrorText } from './gh-call';
import { listSecrets, putSecret, putVariable, runCollect, setToken } from './settings';

describe('#463 erreur du jeton : l’appel et la permission en cause', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setToken(null);
  });

  it('nomme chaque appel de l’appli et la permission qu’il demande', () => {
    expect(ghCall('/repos/o/r/actions/secrets?per_page=100')).toEqual({ what: 'la lecture de la liste des secrets', permission: '« Secrets » en lecture' });
    expect(ghCall('/repos/o/r/actions/secrets/public-key').permission).toBe('« Secrets » en lecture');
    expect(ghCall('/repos/o/r/actions/secrets/HOME_LOCATION_JSON', 'PUT')).toEqual({ what: 'l’enregistrement d’un secret', permission: '« Secrets » en écriture' });
    expect(ghCall('/repos/o/r/actions/variables/WOOD_JSON', 'PATCH')).toEqual({ what: 'la mise à jour d’une variable', permission: '« Variables » en écriture' });
    expect(ghCall('/repos/o/r/actions/variables', 'post').what).toBe('la création d’une variable');
    expect(ghCall('/repos/o/r/actions/variables/WOOD_JSON', 'DELETE').what).toBe('la suppression d’une variable'); // #459: migration
    expect(ghCall('/repos/o/r/actions/workflows/collect.yml/dispatches', 'POST')).toEqual({ what: 'le lancement de la collecte', permission: '« Actions » en écriture' });
    expect(ghCall('/user').what).toBe('un appel à GitHub');
  });

  it('dit l’appel, le statut et la permission, jamais le dépôt, le nom du secret ni une valeur', async () => {
    const seen: string[] = [];
    await sodium.ready;
    const key = sodium.to_base64(sodium.crypto_box_keypair().publicKey, sodium.base64_variants.ORIGINAL);
    vi.stubGlobal('fetch', async (url: string) => (url.endsWith('/public-key') ? Response.json({ key, key_id: 'k' }) : new Response('', { status: 403 })));
    setToken('github_pat_secret_du_test');
    for (const call of [
      () => listSecrets('proprio-fictif/depot-fictif'),
      () => putSecret('proprio-fictif/depot-fictif', 'INTUIS_PASSWORD', 'valeur-secrete-du-test'),
      () => putVariable('proprio-fictif/depot-fictif', 'CONTRACT_JSON', '[]'), // #459: WOOD_JSON is a secret now
      () => runCollect('proprio-fictif/depot-fictif', false),
    ])
      seen.push(await call().then(() => '', (e: Error) => e.message));
    expect(seen).toEqual([
      'GitHub : droits insuffisants pour la lecture de la liste des secrets (HTTP 403) : le jeton doit viser ce dépôt avec la permission « Secrets » en lecture.',
      'GitHub : droits insuffisants pour l’enregistrement d’un secret (HTTP 403) : le jeton doit viser ce dépôt avec la permission « Secrets » en écriture.',
      'GitHub : droits insuffisants pour la mise à jour d’une variable (HTTP 403) : le jeton doit viser ce dépôt avec la permission « Variables » en écriture.',
      'GitHub : droits insuffisants pour le lancement de la collecte (HTTP 403) : le jeton doit viser ce dépôt avec la permission « Actions » en écriture.',
    ]);
    for (const m of seen) for (const s of ['proprio-fictif', 'depot-fictif', 'INTUIS_PASSWORD', 'valeur-secrete', 'github_pat', 'WOOD_JSON', 'purchases']) expect(m).not.toContain(s);
  });

  it('distingue le jeton refusé (401) et une panne (5xx)', () => {
    const c = ghCall('/repos/o/r/actions/secrets');
    expect(ghErrorText(401, c)).toBe('GitHub : jeton invalide ou expiré (refusé pour la lecture de la liste des secrets, HTTP 401).');
    expect(ghErrorText(502, c)).toBe('GitHub : échec pour la lecture de la liste des secrets (HTTP 502).');
  });
});
