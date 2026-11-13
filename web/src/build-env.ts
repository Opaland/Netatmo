// #541: what the build reads from its environment (vite.config.ts), here so that it is tested
// (the configuration itself is not imported by the tests). No import.meta.env: run by Node.

type Env = Record<string, string | undefined>;

/**
 * The repository of this build (src/source-repo.ts): VITE_SOURCE_REPO when it says one, else the
 * one GitHub Actions gives. An empty VITE_SOURCE_REPO is not a repository: it does not hide
 * GITHUB_REPOSITORY (revue v2.1, `??` kept the empty string).
 */
export const builtSourceRepo = (env: Env): string => env.VITE_SOURCE_REPO?.trim() || env.GITHUB_REPOSITORY?.trim() || '';
