// #637: what deriveKey does with the raw Argon2id key. The derivation itself is replaced (vi.mock)
// by fictitious bytes handed back in a buffer the test keeps, so that what happens to that very
// buffer can be seen: zeroed whether the import succeeds or fails, and the key never extractable.
// The real derivation (shared vector with the collector) is in crypto.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARGON2_MIN, type KeyInfo, InsecureContext, deriveKey } from './crypto';

const handed: Uint8Array[] = [];
let length = 32;

vi.mock('./argon2', () => ({
  argon2idKey: vi.fn(async () => {
    const raw = new Uint8Array(length).fill(7); // fictitious key bytes
    handed.push(raw);
    return raw;
  }),
}));

const info = { v: 2, kdf: 'Argon2id', salt: 'AAAA', ...ARGON2_MIN } as KeyInfo;

describe('#637 la clé Argon2id brute : effacée, jamais exportable', () => {
  afterEach(() => {
    handed.length = 0;
    length = 32;
    vi.unstubAllGlobals();
  });

  it('import réussi : la clé n’est pas exportable et ses octets bruts sont remis à zéro', async () => {
    const key = await deriveKey('phrase fictive', info);
    expect(key.extractable).toBe(false);
    expect(key.usages.sort()).toEqual(['decrypt', 'encrypt']);
    expect(handed).toHaveLength(1);
    expect(Array.from(handed[0]!)).toEqual(new Array(32).fill(0));
  });

  it('import refusé (clé de mauvaise longueur) : les octets bruts sont remis à zéro quand même', async () => {
    length = 31; // AES-GCM refuses a 31-byte key
    await expect(deriveKey('phrase fictive', info)).rejects.toThrow();
    expect(handed).toHaveLength(1);
    expect(Array.from(handed[0]!)).toEqual(new Array(31).fill(0));
  });

  it('hors contexte sûr, la dérivation Argon2id (plusieurs secondes) ne commence même pas', async () => {
    vi.stubGlobal('isSecureContext', false);
    await expect(deriveKey('phrase fictive', info)).rejects.toThrow(InsecureContext);
    expect(handed).toHaveLength(0);
  });
});
