// #139: Argon2id beside PBKDF2. The shared vector is written by the collector (argon2-cffi) and
// read again by tests/test_argon2.py: one key, two implementations.
import { describe, expect, it } from 'vitest';
import { argon2idKey } from './argon2';
import { buildBundle } from './backup';
import {
  ARGON2_MIN,
  type Argon2Info,
  BadEnvelope,
  type Envelope,
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

const info = vector.keyinfo as Argon2Info;
const env = vector.envelope as Envelope;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

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
