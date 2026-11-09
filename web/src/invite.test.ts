import { describe, expect, it } from 'vitest';
import { INSTALL_HASH, installSteps, inviteUrl } from './invite';

describe('inviteUrl (S-12.3)', () => {
  it('keeps the page address and adds the install fragment', () => {
    expect(inviteUrl('https://opaland.github.io/Netatmo/')).toBe(`https://opaland.github.io/Netatmo/${INSTALL_HASH}`);
    expect(inviteUrl('https://opaland.github.io/Netatmo/index.html')).toBe('https://opaland.github.io/Netatmo/index.html#installer');
  });
  it('drops whatever the query, the fragment or the user info hold', () => {
    const u = inviteUrl('https://moi:secret@opaland.github.io/Netatmo/?pass=phrase#cle=abc')!;
    expect(u).toBe('https://opaland.github.io/Netatmo/#installer');
    for (const s of ['secret', 'phrase', 'abc', 'moi']) expect(u).not.toContain(s);
  });
  it('refuses plain http outside a local address, and garbage', () => {
    expect(inviteUrl('http://exemple.fr/')).toBeNull();
    expect(inviteUrl('http://127.0.0.1:4173/')).toBe('http://127.0.0.1:4173/#installer');
    expect(inviteUrl('file:///tmp/index.html')).toBeNull();
    expect(inviteUrl('pas une adresse')).toBeNull();
  });
  it('explains the installation on iPhone and Android', () => {
    expect(installSteps()).toMatch(/iPhone/);
    expect(installSteps()).toMatch(/Android/);
  });
});
