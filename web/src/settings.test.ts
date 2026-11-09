import sodium from 'libsodium-wrappers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expiryInfo, listSecrets, putSecret, putVariable, repoFromLocation, runCollect, setToken, validate } from './settings';

afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

describe('settings', () => {
  it('derives owner/repo from the GitHub Pages address only', () => {
    expect(repoFromLocation({ hostname: 'opaland.github.io', pathname: '/Netatmo/' } as Location)).toBe('opaland/Netatmo');
    expect(repoFromLocation({ hostname: 'localhost', pathname: '/' } as Location)).toBeNull();
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
