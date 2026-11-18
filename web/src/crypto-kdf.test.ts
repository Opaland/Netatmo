// #139: the derivation bounds agree with collector/kdf.json (one rule on both sides). Apart from
// crypto.test.ts (#637): a test file that reads outside web/ is left out of the mutation runs
// (vitest.mutation.config.mjs), and this one took every test of crypto.ts with it.
import { describe, expect, it } from 'vitest';
import { ARGON2_MAX, ARGON2_MIN, MAX_ITERATIONS, MIN_ITERATIONS, checkKeyInfo } from './crypto';

const fsName = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, enc: 'utf8') => string };

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
