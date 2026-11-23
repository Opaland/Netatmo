// #671: the WebKit jobs of ci.yml keep the .deb archives of WebKit's system dependencies in the
// Actions cache, so that `npx playwright install --with-deps webkit` no longer downloads 140 MB
// from the Ubuntu mirror on every run (measured on 40 runs: 3 s to 18 min 19 s for that download
// alone; the browser itself, from Playwright's CDN, 2 s to 6 s, so it is not cached).
//
//   node ../scripts/apt-archives.mjs cle      the cache key, written to $GITHUB_OUTPUT
//   node ../scripts/apt-archives.mjs avant    keep apt's downloads, put the cached archives in place
//   node ../scripts/apt-archives.mjs apres    copy apt's archives back into the cached folder
//
// CI only (sudo, /var/cache/apt): the gate (scripts/porte.mjs) does not run the WebKit jobs.
// apt still checks each archive against the hash of its index (apt-get update runs as before): a
// stale or altered archive is downloaded again, never installed. Nothing is retried here.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The folder the Actions cache saves and restores (the `path:` of both cache steps of ci.yml). */
export const DIR = join(homedir(), 'apt-archives');
const APT = '/var/cache/apt/archives';

/**
 * The cache key: the runner image (its OS and version: the image changes, the packages it lacks
 * may change) and the Playwright version (its WebKit decides the list of dependencies).
 * `prefix` restores the latest archives of the same image OS and Playwright when the exact key
 * is missing: apt then downloads only what changed, and the new key is saved.
 */
export function cacheKey({ imageOS, imageVersion, playwright }) {
  for (const [k, v] of Object.entries({ imageOS, imageVersion, playwright }))
    if (!v || !/^[\w.-]+$/.test(v)) throw new Error(`apt-archives : ${k} absent ou illisible (${JSON.stringify(v)})`);
  const prefix = `apt-webkit-${imageOS}-playwright-${playwright}-`;
  return { key: `${prefix}${imageVersion}`, prefix };
}

/** The .deb files of a folder, and their total size in MB (for the job's log). */
function debs(dir) {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.deb')) : [];
  const mb = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0) / 1e6;
  return { files, mb: Math.round(mb) };
}

function sudo(...args) {
  execFileSync('sudo', args, { stdio: 'inherit' });
}

function main(cmd) {
  if (cmd === 'cle') {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/playwright/package.json'), 'utf8'));
    const { key, prefix } = cacheKey({ imageOS: process.env.ImageOS, imageVersion: process.env.ImageVersion, playwright: pkg.version });
    appendFileSync(process.env.GITHUB_OUTPUT, `key=${key}\nprefix=${prefix}\n`);
    console.log(`clé du cache apt : ${key}`);
  } else if (cmd === 'avant') {
    // apt-get keeps its downloads by default; said explicitly, so that an image that changes the
    // default does not empty the cache in silence.
    sudo('sh', '-c', `echo 'APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/99keep-downloaded-packages`);
    const { files, mb } = debs(DIR);
    if (files.length) sudo('cp', '-t', APT, ...files.map((f) => join(DIR, f)));
    console.log(`archives apt reprises du cache : ${files.length} (${mb} Mo)`);
  } else if (cmd === 'apres') {
    // Archives no longer in the index (replaced upstream) are dropped before saving.
    sudo('apt-get', 'autoclean', '-qq');
    mkdirSync(DIR, { recursive: true });
    const { files, mb } = debs(APT);
    // Said in the job's annotations, without failing it: the installation itself went through.
    if (!files.length) return console.log(`::warning::apt-archives : aucune archive dans ${APT} après l'installation, rien à garder (#671)`);
    execFileSync('cp', ['-t', DIR, ...files.map((f) => join(APT, f))]);
    console.log(`archives apt gardées pour le cache : ${files.length} (${mb} Mo)`);
  } else {
    throw new Error(`apt-archives : commande inconnue ${JSON.stringify(cmd)} (cle, avant, apres)`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv[2]);
