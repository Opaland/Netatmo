// #533: the repository a build comes from, one place (fictitious copies only).
import { describe, expect, it } from 'vitest';
import { INSECURE_DOC } from './crypto';
import { ORIGIN_REPO, SOURCE_REPO, repoDoc, sourceRepo } from './source-repo';

describe('#533 dépôt de la construction', () => {
  it('une copie construite par GitHub Actions pointe sur elle-même', () => {
    expect(sourceRepo('copie-fictive/historique')).toBe('copie-fictive/historique');
    expect(repoDoc('docs/nas-copie-locale.md', 'copie-fictive/historique')).toBe('https://github.com/copie-fictive/historique/blob/main/docs/nas-copie-locale.md');
  });

  it('sans dépôt connu, ou un nom qui n’en est pas un, le dépôt d’origine', () => {
    for (const v of [undefined, '', 'pas-un-depot', 'x/..', 'a/b"><script>', 'a/b/c']) expect(sourceRepo(v)).toBe(ORIGIN_REPO);
  });

  it('le lien de l’écran en HTTP suit le dépôt de la construction', () => {
    expect(INSECURE_DOC).toBe(`https://github.com/${SOURCE_REPO}/blob/main/docs/nas-copie-locale.md`);
  });
});
