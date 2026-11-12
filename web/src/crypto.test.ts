// #139: Argon2id beside PBKDF2. The shared vector is written by the collector (argon2-cffi) and
// read again by tests/test_argon2.py: one key, two implementations.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { argon2idKey } from './argon2';
import { buildBundle } from './backup';
import {
  ARGON2_MAX,
  ARGON2_MIN,
  MAX_ITERATIONS,
  MIN_ITERATIONS,
  type Argon2Info,
  BadEnvelope,
  type Envelope,
  INSECURE_MESSAGE,
  InsecureContext,
  insecureContext,
  type KeyInfo,
  WrongPassphrase,
  checkEnvelope,
  checkKeyInfo,
  decryptEnvelope,
  deriveKey,
  envelopeFields,
  keyInfoFields,
} from './crypto';
import vector from './__fixtures__/kdf-vector.json';
import pbkdf2 from './__fixtures__/python-vector.json';

const fsName = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, enc: 'utf8') => string };

const info = vector.keyinfo as Argon2Info;
const env = vector.envelope as Envelope;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

describe('#139 bornes de dérivation : une seule règle (collector/kdf.json)', () => {
  it('l’appli accepte exactement les bornes que lit la collecte, et son minimum est ce qu’elle écrit', () => {
    const shared = JSON.parse(readFileSync(new URL('../../collector/kdf.json', import.meta.url), 'utf8'));
    expect({ min: MIN_ITERATIONS, max: MAX_ITERATIONS, written: MIN_ITERATIONS }).toEqual({
      min: shared.pbkdf2.min_iter,
      max: shared.pbkdf2.max_iter,
      written: shared.pbkdf2.iter,
    });
    expect({ ...ARGON2_MIN, max_m: ARGON2_MAX.m, max_t: ARGON2_MAX.t }).toEqual({
      m: shared.argon2id.min_m,
      t: shared.argon2id.min_t,
      p: shared.argon2id.p,
      max_m: shared.argon2id.max_m,
      max_t: shared.argon2id.max_t,
    });
    expect({ m: shared.argon2id.m, t: shared.argon2id.t }).toEqual({ m: ARGON2_MIN.m, t: ARGON2_MIN.t });
    expect(() => checkKeyInfo({ salt: 'AAAA', iter: MAX_ITERATIONS + 1 })).toThrow(/maximum/);
  });
});

describe('#139 Argon2id', () => {
  it('dérive la même clé que la collecte (vecteur partagé), avec les paramètres par défaut', async () => {
    expect({ m: info.m, t: info.t, p: info.p }).toEqual(ARGON2_MIN); // collector/crypto.py writes the app's minimum
    const salt = Uint8Array.from(atob(info.salt), (c) => c.charCodeAt(0));
    expect(hex(await argon2idKey(vector.passphrase, salt, info))).toBe(vector.key_hex);
  });

  it('ouvre un dossier en version 2, et toujours un dossier PBKDF2', async () => {
    expect(await decryptEnvelope(env, await deriveKey(vector.passphrase, info))).toEqual(vector.doc);
    await expect(decryptEnvelope(env, await deriveKey('pas la bonne', info))).rejects.toThrow(WrongPassphrase);
    const old = await deriveKey('test', { salt: pbkdf2.salt, iter: pbkdf2.iter });
    expect(await decryptEnvelope<{ txt: string }>(pbkdf2, old)).toMatchObject({ txt: 'Salle de bain é' });
  });

  it('refuse une dérivation affaiblie ou inconnue avant de dériver, avec un message clair', async () => {
    for (const bad of [{ m: 1024 }, { t: 1 }, { p: 4 }, { m: 10 ** 7 }, { t: 2.5 }, { m: '65536' }]) {
      expect(() => checkKeyInfo({ ...info, ...bad } as KeyInfo)).toThrow(BadEnvelope);
      expect(() => checkEnvelope({ ...env, ...bad } as Envelope)).toThrow(/Argon2id refusés/);
      await expect(deriveKey(vector.passphrase, { ...info, ...bad } as KeyInfo)).rejects.toThrow(BadEnvelope);
    }
    expect(() => checkKeyInfo({ ...info, v: 3 } as unknown as KeyInfo)).toThrow(/version inconnue \(3\)/);
    expect(() => checkKeyInfo({ ...info, kdf: 'scrypt' } as unknown as KeyInfo)).toThrow(BadEnvelope);
    expect(() => checkKeyInfo({ salt: info.salt, iter: 1000 })).toThrow(/itérations/);
    expect(() => checkEnvelope(env)).not.toThrow();
  });

  it('la sauvegarde garde les champs de la dérivation (enveloppe et keyinfo.json)', async () => {
    expect(envelopeFields({ ...env, extra: 'x' } as Envelope)).toEqual(env);
    expect(keyInfoFields({ ...info, extra: 'x' } as KeyInfo)).toEqual(info);
    const served: Record<string, unknown> = { 'keyinfo.json': info, 'meta.enc.json': env };
    const bundle = await buildBundle(async (n) => served[n] ?? null, { years: [] } as never);
    expect(bundle.keyinfo).toEqual(info);
    expect(bundle.files['meta.enc.json']).toEqual(env);
  });
});

describe('#524 page en HTTP hors localhost : WebCrypto absent', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('la garde reconnaît un contexte non sûr ou un crypto.subtle absent, et seulement eux', () => {
    expect(insecureContext({ isSecureContext: true, crypto: { subtle: {} } })).toBe(false);
    expect(insecureContext({ crypto: { subtle: {} } })).toBe(false); // Node: no isSecureContext
    expect(insecureContext({ isSecureContext: false, crypto: { subtle: {} } })).toBe(true);
    expect(insecureContext({ isSecureContext: true, crypto: {} })).toBe(true);
    expect(insecureContext({ isSecureContext: true })).toBe(true);
    expect(INSECURE_MESSAGE).toMatch(/HTTPS ou sur localhost/);
  });

  it('dériver ou déchiffrer le dit en clair, et jamais « phrase de passe incorrecte »', async () => {
    const old: KeyInfo = { salt: pbkdf2.salt, iter: pbkdf2.iter };
    const key = await deriveKey('test', old);
    vi.stubGlobal('isSecureContext', false);
    await expect(deriveKey('test', info)).rejects.toThrow(InsecureContext);
    await expect(deriveKey('test', old)).rejects.toThrow(INSECURE_MESSAGE);
    const err = await decryptEnvelope(pbkdf2 as Envelope, key).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InsecureContext);
    expect(err).not.toBeInstanceOf(WrongPassphrase);
  });
});
