import { describe, expect, it } from 'vitest';
import { framedHtml, isFramed } from './frame';
import { guard } from './trusted';

describe('anti-clickjacking (#237)', () => {
  it('détecte un cadre', () => {
    const self = {};
    expect(isFramed({ top: self, self })).toBe(false);
    expect(isFramed({ top: {}, self })).toBe(true);
    const throwing = Object.defineProperty({ self }, 'top', {
      get() {
        throw new Error('SecurityError');
      },
    }) as { top: unknown; self: unknown };
    expect(isFramed(throwing)).toBe(true);
  });

  it('message sans formulaire, lien échappé et accepté par la politique', () => {
    const h = framedHtml('https://opaland.github.io/Netatmo/?a=1&b="x"');
    expect(h).not.toMatch(/<form|<input/);
    expect(h).toContain('&#38;b=&#34;x&#34;');
    expect(guard(h)).toBe(h);
  });
});
