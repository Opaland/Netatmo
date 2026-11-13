// #533 (revue v2.0, #229): the repository the app is built from, in one place. The links to its
// documentation (lock screen in HTTP, Cadre juridique) and the repository proposed by default in
// ⚙ Sources de données follow it, so that a copy points at itself, not at the repository of origin.
// GitHub Actions sets GITHUB_REPOSITORY (vite.config.ts → VITE_SOURCE_REPO); a build without it
// (local, NAS copy without the variable) falls back on the repository of origin, the only line of
// web/src that names it (transfer list, docs/etudes/origine-dediee.md).

/** The repository of origin: the fallback of a build that does not know its repository. */
export const ORIGIN_REPO = 'Opaland/Netatmo';

/** owner/repo as GitHub accepts it; anything else is refused before building a link or a call. */
export const validRepo = (repo: string) => /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repo) && !repo.endsWith('/.') && !repo.endsWith('/..');

/** The repository named at build time, if it is one; otherwise the repository of origin. */
export const sourceRepo = (built: string | undefined): string => (built && validRepo(built) ? built : ORIGIN_REPO);

/** The repository this build comes from. */
export const SOURCE_REPO = sourceRepo(import.meta.env.VITE_SOURCE_REPO as string | undefined);

/** A file of the repository on GitHub (branch main). */
export const repoDoc = (path: string, repo = SOURCE_REPO) => `https://github.com/${repo}/blob/main/${path}`;
