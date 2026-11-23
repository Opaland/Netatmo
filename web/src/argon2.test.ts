// #649 n° 5 (revue de code v3.0): the output of hash-wasm is erased once copied. The derivation is
// replaced by fictitious bytes in a buffer the test keeps, to see what happens to that very buffer;
// the real derivation (vector shared with the collector) is in crypto.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { argon2idKey } from './argon2';

const handed: Uint8Array[] = [];

vi.mock('hash-wasm', () => ({
  argon2id: vi.fn(async () => {
    const out = Uint8Array.from({ length: 32 }, (_, i) => i + 1); // fictitious key bytes
    handed.push(out);
    return out;
  }),
}));

describe('#649 n° 5 la sortie d’Argon2id', () => {
  it('est copiée dans la clé rendue, puis remise à zéro', async () => {
    const key = await argon2idKey('phrase fictive', new Uint8Array(16), { m: 64 * 1024, t: 2, p: 1 });
    expect(Array.from(key)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    expect(handed).toHaveLength(1);
    expect(handed[0]).not.toBe(key);
    expect(Array.from(handed[0]!)).toEqual(new Array(32).fill(0));
  });
});
