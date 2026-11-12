import sodium from 'libsodium-wrappers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_SECRETS,
  HOUSEHOLD_SECRETS,
  VARIABLES,
  expiryInfo,
  listSecrets,
  migratePlainVariable,
  noSaveAttrs,
  plainVariable,
  putSecret,
  putVariable,
  repoFromLocation,
  runCollect,
  saveHouseholdSecret,
  setToken,
  validate,
  invalidFields,
} from './settings';

afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

describe('settings', () => {
  it('derives owner/repo from the GitHub Pages address only', () => {
    expect(repoFromLocation({ hostname: 'opaland.github.io', pathname: '/Netatmo/' } as Location)).toBe('opaland/Netatmo');
    expect(repoFromLocation({ hostname: 'localhost', pathname: '/' } as Location)).toBeNull();
  });

  it('#233 : jeton et secrets marqués pour ne pas être proposés à l’enregistrement', () => {
    const secret = noSaveAttrs(true);
    expect(secret).toContain('type="password"');
    expect(secret).toContain('autocomplete="one-time-code"');
    expect(secret).not.toContain('autocomplete="off"');
    for (const a of ['data-1p-ignore', 'data-lpignore="true"', 'data-bwignore']) expect(secret).toContain(a);
    expect(noSaveAttrs(false)).toContain('type="text"');
    expect(noSaveAttrs(false)).toContain('data-lpignore="true"');
  });

  it('catches obvious typos before sending', () => {
    expect(validate('ENEDIS_PRM', '123')).toMatch(/14 chiffres/);
    expect(validate('ENEDIS_PRM', '01234567890123')).toBeNull();
    expect(validate('ANTHROPIC_API_KEY', 'abc')).toMatch(/sk-ant-/);
  });

  it('only accepts a Shelly Cloud server, like the collector (S-1.17)', () => {
    expect(validate('SHELLY_SERVER', 'shelly-103-eu.shelly.cloud')).toBeNull();
    expect(validate('SHELLY_SERVER', 'https://shelly-103-eu.shelly.cloud/')).toBeNull();
    expect(validate('SHELLY_SERVER', 'evil.example.com')).toMatch(/shelly\.cloud/);
    expect(validate('SHELLY_SERVER', 'x.shelly.cloud.evil.com')).toMatch(/shelly\.cloud/);
    expect(validate('SHELLY_AUTH_KEY', 'court')).toMatch(/incomplète/);
  });

  it('seals each value with the repository public key; only the private key opens it', async () => {
    await sodium.ready;
    const pair = sodium.crypto_box_keypair();
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/public-key')) {
        return new Response(JSON.stringify({ key: sodium.to_base64(pair.publicKey, sodium.base64_variants.ORIGINAL), key_id: 'k1' }));
      }
      if (url.includes('/actions/secrets?')) return new Response(JSON.stringify({ secrets: [{ name: 'INTUIS_PASSWORD' }] }));
      return new Response(null, { status: 204 });
    });
    setToken('github_pat_test');
    expect([...(await listSecrets('o/r'))]).toEqual(['INTUIS_PASSWORD']);
    await putSecret('o/r', 'ENEDIS_TOKEN', 'mon-jeton');
    const put = calls.find((c) => c.init?.method === 'PUT')!;
    expect(put.url).toBe('https://api.github.com/repos/o/r/actions/secrets/ENEDIS_TOKEN');
    expect((put.init!.headers as Record<string, string>).Authorization).toBe('Bearer github_pat_test');
    const body = JSON.parse(String(put.init!.body));
    expect(body.key_id).toBe('k1');
    expect(String(put.init!.body)).not.toContain('mon-jeton'); // never in clear
    const opened = sodium.crypto_box_seal_open(
      sodium.from_base64(body.encrypted_value, sodium.base64_variants.ORIGINAL),
      pair.publicKey,
      pair.privateKey,
    );
    expect(sodium.to_string(opened)).toBe('mon-jeton');
  });

  it('refuses to overwrite the data passphrase (it would make the archive unreadable)', async () => {
    setToken('t');
    await expect(putSecret('o/r', 'DATA_PASSPHRASE', 'x')).rejects.toThrow(/ne peut pas/);
  });

  it('explains missing permissions and triggers the collection on main', async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string });
      return url.includes('dispatches') ? new Response(null, { status: 204 }) : new Response('', { status: 403 });
    });
    setToken('t');
    await expect(listSecrets('o/r')).rejects.toThrow(/droits insuffisants/);
    await runCollect('o/r', true);
    expect(JSON.parse(calls[1].body!)).toEqual({ ref: 'main', inputs: { backfill: true } });
  });

  it('shares the contract as a repository variable: update, else create (S-12.1)', async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    let exists = false;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string });
      if (init?.method === 'PATCH') return new Response(null, { status: exists ? 204 : 404 });
      exists = true;
      return new Response(null, { status: 201 });
    });
    setToken('github_pat_test');
    const value = '[{"from":"2022-01-01","offer":"edf-trv-hphc","kva":12}]';
    await putVariable('o/r', 'CONTRACT_JSON', value);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'PATCH https://api.github.com/repos/o/r/actions/variables/CONTRACT_JSON',
      'POST https://api.github.com/repos/o/r/actions/variables',
    ]);
    expect(JSON.parse(calls[1].body!)).toEqual({ name: 'CONTRACT_JSON', value });
    await putVariable('o/r', 'CONTRACT_JSON', value);
    expect(calls).toHaveLength(3);
    expect(calls[2].method).toBe('PATCH');
    await expect(putVariable('o/r', 'INTUIS_ROOM_CATEGORIES', '{}')).rejects.toThrow(/ne peut pas/);
    expect(calls).toHaveLength(3);
  });

  it('reports a missing variables permission instead of creating blindly', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 403 }));
    setToken('t');
    await expect(putVariable('o/r', 'CONTRACT_JSON', '[]')).rejects.toThrow(/Variables/);
  });

  describe('#459: no household setting is ever written in clear', () => {
    const household = [...HOUSEHOLD_SECRETS, 'HOME_LOCATION_JSON'];
    const fakeGitHub = async (plain: Record<string, string>) => {
      await sodium.ready;
      const pair = sodium.crypto_box_keypair();
      const calls: { method: string; url: string; body: string }[] = [];
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ method, url, body: String(init?.body ?? '') });
        if (url.endsWith('/public-key')) return new Response(JSON.stringify({ key: sodium.to_base64(pair.publicKey, sodium.base64_variants.ORIGINAL), key_id: 'k1' }));
        const v = /\/actions\/variables\/([A-Z_]+)$/.exec(url)?.[1];
        const known = v !== undefined && Object.hasOwn(plain, v);
        if (v && method === 'GET') return known ? new Response(JSON.stringify({ name: v, value: plain[v] })) : new Response('', { status: 404 });
        if (v && method === 'DELETE') {
          if (!known) return new Response('', { status: 404 });
          delete plain[v];
        }
        return new Response(null, { status: 204 });
      });
      setToken('github_pat_test');
      const open = (c: { body: string }) =>
        sodium.to_string(
          sodium.crypto_box_seal_open(sodium.from_base64(JSON.parse(c.body).encrypted_value, sodium.base64_variants.ORIGINAL), pair.publicKey, pair.privateKey),
        );
      return { calls, open };
    };

    it('is never a repository variable the app may write', async () => {
      const calls: string[] = [];
      vi.stubGlobal('fetch', async (url: string) => (calls.push(url), new Response(null, { status: 204 })));
      setToken('t');
      for (const name of household) {
        expect(VARIABLES.has(name), name).toBe(false);
        expect(APP_SECRETS.has(name), name).toBe(true);
        await expect(putVariable('o/r', name, '[]')).rejects.toThrow(/ne peut pas/);
      }
      expect(calls).toEqual([]);
    });

    it('is sealed into a secret, then the plaintext variable left is deleted', async () => {
      const value = '[{"room":"r1","from":"2025-07-01","reason":"retires","label":"Valeur-Secrete"}]';
      const { calls, open } = await fakeGitHub({ STOPPED_ROOMS_JSON: '[]' });
      expect(await saveHouseholdSecret('o/r', 'STOPPED_ROOMS_JSON', value)).toEqual({ removedPlain: true });
      expect(calls.filter((c) => !c.url.endsWith('/public-key')).map((c) => `${c.method} ${c.url}`)).toEqual([
        'PUT https://api.github.com/repos/o/r/actions/secrets/STOPPED_ROOMS_JSON',
        'DELETE https://api.github.com/repos/o/r/actions/variables/STOPPED_ROOMS_JSON',
      ]);
      expect(calls.some((c) => c.body.includes('Valeur-Secrete'))).toBe(false);
      expect(open(calls.find((c) => c.method === 'PUT')!)).toBe(value);
      expect(await saveHouseholdSecret('o/r', 'STOPPED_ROOMS_JSON', value)).toEqual({ removedPlain: false });
      await expect(saveHouseholdSecret('o/r', 'CONTRACT_JSON', value)).rejects.toThrow(/ne peut pas/);
    });

    it('migrates a plaintext variable as it is, then deletes it; nothing to do without one', async () => {
      const old = '{"purchases":[{"day":"2025-10-01","steres":2,"species":"chene","moisture":20,"price":777}]}';
      const { calls, open } = await fakeGitHub({ WOOD_JSON: old });
      expect(await plainVariable('o/r', 'WOOD_JSON')).toBe(old);
      expect(await migratePlainVariable('o/r', 'WOOD_JSON')).toBe(true);
      expect(open(calls.find((c) => c.method === 'PUT')!)).toBe(old);
      const writes = calls.filter((c) => c.method !== 'GET');
      expect(writes.map((c) => `${c.method} ${c.url.replace('https://api.github.com/repos/o/r/actions/', '')}`)).toEqual(['PUT secrets/WOOD_JSON', 'DELETE variables/WOOD_JSON']);
      expect(await plainVariable('o/r', 'WOOD_JSON')).toBeNull();
      expect(await migratePlainVariable('o/r', 'WOOD_JSON')).toBe(false);
      await expect(plainVariable('o/r', 'CONTRACT_JSON')).rejects.toThrow(/ne peut pas/);
    });
  });

  it('shows the token expiry, estimated or unknown, and when to renew (S-1.12)', () => {
    const today = '2026-11-09';
    expect(expiryInfo({ credential: 'abc', expires: '2027-06-01', expires_estimated: true }, today)).toMatchObject({
      date: '2027-06-01',
      estimated: true,
      renew: false,
    });
    expect(expiryInfo({ credential: 'abc', expires: '2026-12-01' }, today)).toMatchObject({ renew: true, daysLeft: 22 });
    expect(expiryInfo({ credential: 'abc' }, today)).toMatchObject({ date: null, renew: false }); // « expiration inconnue »
    expect(expiryInfo({ credential: 'abc', auth_expired: true }, today)?.renew).toBe(true);
    expect(expiryInfo({ ok: '2026-11-09T04:00:00+00:00' }, today)).toBeNull(); // no tracked token (Intuis)
  });
});

describe('secrets form: field by field (#259)', () => {
  it('names only the invalid fields, with their label', () => {
    const bad = invalidFields([
      ['INTUIS_USERNAME', 'moi@example.fr'],
      ['ENEDIS_PRM', '123'],
      ['INTUIS_PASSWORD', 'secret'],
      ['ANTHROPIC_API_KEY', ''],
    ]);
    expect(bad).toEqual([{ name: 'ENEDIS_PRM', label: expect.any(String), error: expect.stringMatching(/14 chiffres/) }]);
    expect(bad[0].label).not.toBe('ENEDIS_PRM');
  });
});
