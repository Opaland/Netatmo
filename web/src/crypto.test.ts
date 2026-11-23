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
  openLocal,
  sealLocal,
  toB64,
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

// #637: each bound seen from both sides, on fictitious keyinfo.json files (no derivation runs:
// checkKeyInfo and checkEnvelope refuse before any key work). The values come from crypto.ts,
// itself held to collector/kdf.json by crypto-kdf.test.ts.
describe('#637 bornes vues des deux côtés, keyinfo.json contrôlé', () => {
  const salt = 'AAAA';
  const pbkdf = (iter: unknown) => ({ salt, iter }) as KeyInfo;
  const argon = (o: Record<string, unknown>) => ({ v: 2, kdf: 'Argon2id', salt, ...ARGON2_MIN, ...o }) as KeyInfo;

  it('PBKDF2 : le minimum et le maximum passent, un de moins ou de plus est refusé avec son message', () => {
    expect(() => checkKeyInfo(pbkdf(MIN_ITERATIONS))).not.toThrow();
    expect(() => checkKeyInfo(pbkdf(MAX_ITERATIONS))).not.toThrow();
    expect(() => checkKeyInfo(pbkdf(MIN_ITERATIONS - 1))).toThrow(/trop faible \(599999 itérations, minimum 600/);
    expect(() => checkKeyInfo(pbkdf(MAX_ITERATIONS + 1))).toThrow(/refusée \(2000001 itérations, maximum 2/);
    // a fraction or a string is not a number of iterations, even inside the bounds
    expect(() => checkKeyInfo(pbkdf(MIN_ITERATIONS + 0.5))).toThrow(/trop faible/);
    expect(() => checkKeyInfo(pbkdf(String(MIN_ITERATIONS)))).toThrow(/trop faible/);
    const e = pbkdf2 as Envelope;
    expect(() => checkEnvelope({ ...e, iter: MAX_ITERATIONS })).not.toThrow();
    expect(() => checkEnvelope({ ...e, iter: MAX_ITERATIONS + 1 })).toThrow(/maximum/);
  });

  it('Argon2id : mémoire et passes aux bornes passent, au-delà refusées ; une seule voie', () => {
    for (const ok of [{}, { m: ARGON2_MAX.m }, { t: ARGON2_MAX.t }, { m: ARGON2_MAX.m, t: ARGON2_MAX.t }])
      expect(() => checkKeyInfo(argon(ok))).not.toThrow();
    for (const bad of [{ m: ARGON2_MIN.m - 1 }, { m: ARGON2_MAX.m + 1 }, { t: ARGON2_MIN.t - 1 }, { t: ARGON2_MAX.t + 1 }, { p: 0 }, { p: 2 }]) {
      expect(() => checkKeyInfo(argon(bad))).toThrow(/Paramètres Argon2id refusés/);
      expect(() => checkEnvelope({ ...env, ...bad } as Envelope)).toThrow(/Paramètres Argon2id refusés/);
    }
  });

  it('un keyinfo.json sans sel, de version 3 ou au kdf inconnu est refusé, et la sauvegarde ne le recopie pas', () => {
    expect(() => checkKeyInfo({ iter: MIN_ITERATIONS } as unknown as KeyInfo)).toThrow(/keyinfo\.json illisible/);
    expect(() => checkKeyInfo({ ...info, salt: 42 } as unknown as KeyInfo)).toThrow(/keyinfo\.json illisible/);
    expect(() => checkKeyInfo(null as unknown as KeyInfo)).toThrow(/keyinfo\.json illisible/);
    expect(() => checkKeyInfo({ ...info, v: 3 } as unknown as KeyInfo)).toThrow(/version inconnue/);
    expect(() => checkKeyInfo({ ...info, kdf: 'scrypt' } as unknown as KeyInfo)).toThrow(/version inconnue \(2\)/);
    expect(() => keyInfoFields(pbkdf(MIN_ITERATIONS - 1))).toThrow(BadEnvelope);
    expect(() => keyInfoFields(argon({ p: 2 }))).toThrow(BadEnvelope);
    expect(keyInfoFields(pbkdf(MIN_ITERATIONS))).toEqual({ salt, iter: MIN_ITERATIONS });
  });
});

describe('revue de code v3.0 : le sel de keyinfo.json, base64 strict comme au collecteur', () => {
  const pbkdf = (salt: string) => ({ salt, iter: MIN_ITERATIONS }) as KeyInfo;
  it('un sel qui n’est pas du base64 est refusé avant toute dérivation, avec le message de keyinfo.json', async () => {
    for (const salt of ['!!!!', 'AAA', 'AA AA', 'AAAA====', 'A=AA']) expect(() => checkKeyInfo(pbkdf(salt)), salt).toThrow('keyinfo.json illisible.');
    await expect(deriveKey('phrase fictive', pbkdf('!!!!'))).rejects.toThrow(BadEnvelope);
  });
  it('le sel que le collecteur écrit passe', () => {
    for (const salt of ['AAAA', 'c2Vs', 'c2U=', 'cw==', pbkdf2.salt]) expect(() => checkKeyInfo(pbkdf(salt)), salt).not.toThrow();
  });
});

describe('revue de code v3.0 : une note scellée de grande taille', () => {
  it('toB64 rend le base64 standard, par tranches comme d’un seul tenant', () => {
    const bytes = Uint8Array.from({ length: 70_001 }, (_, i) => (i * 37) % 256);
    expect(toB64(bytes)).toBe(btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))); // one char at a time: no argument limit
    expect(toB64(new Uint8Array())).toBe('');
  });

  it('une note de 300 Ko se scelle et se rouvre (au-delà de la limite d’arguments des moteurs)', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const value = { hours: 'x'.repeat(300_000) }; // fictitious, as large as an audit report can be
    const sealed = await sealLocal(value, key);
    expect(await openLocal(sealed, key)).toEqual(value);
  });
});
