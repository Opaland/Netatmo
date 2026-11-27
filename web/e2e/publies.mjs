// #648: wait until the published files answer 200 before the probe opens the page. Run 45634648539
// (collecte du 25/11): build.json already served the deployed commit, yet GitHub Pages answered
// « 503 /Netatmo/demo/weather.enc.json » a moment later. The new page was out, one of its files was
// not yet: the probe failed on the CDN, not on the site. So `en-ligne.mjs`, after build.json, waits
// (bounded) until every file the page will load answers 200, then checks as before.
//
// This is a wait for availability BEFORE checking, not a retry of a failed check: once it is over,
// the page, its worker and the sweep are checked once, and a 4xx / 5xx there still fails.
//
// Which files: the precache list of sw.js (with sw.js and its workbox chunk), and every file of
// SHA256SUMS (published with the site, S-8.10) except data/: the demo's files (demo/*), the public
// tariffs, the icons. data/ (the real encrypted data) is never read here: demo only.

/**
 * Bound of the wait, chosen by judgement (no measure to set it on: one 503 seen, gone by the next
 * deployment). 5 min is more than twice the 2 min already given to build.json for the same
 * propagation, and keeps the job `site-en-ligne` (timeout-minutes: 20, about 3 min when nothing
 * waits) under its bound with a slow browser install. Set aside: 2 min (as build.json: the files
 * follow the page, a lag beyond it would fail a job that only had to wait); 10 min (with the
 * 2 min of build.json and a slow install, the 20 min of the job would cut it before it names the
 * files).
 */
export const WAIT_MS = 5 * 60_000;
export const POLL_MS = 5_000;
const PARALLEL = 8; // about 140 files: a pass in a few seconds without hammering the CDN

/** Relative paths of the files the page loads, from the text of sw.js and of SHA256SUMS. Never data/. */
export function publishedPaths(swText, sumsText) {
  const paths = new Set(['sw.js']);
  for (const m of swText.matchAll(/\burl:\s*"([^"]+)"/g)) paths.add(m[1]);
  for (const m of swText.matchAll(/define\(\s*\[\s*"\.\/(workbox-[\w-]+)"/g)) paths.add(`${m[1]}.js`);
  for (const line of sumsText.split('\n')) {
    const m = /^[0-9a-f]{64} [ *](.+)$/.exec(line.trim());
    if (m) paths.add(m[1]);
  }
  return [...paths].map((p) => p.replace(/^\.\//, '')).filter((p) => p && !/^data\//.test(p) && !/^[a-z]+:|^\//i.test(p)).sort();
}

/** What a read gave: the HTTP status, or why there was none. */
async function statusOf(get, url, ms) {
  try {
    const r = await get(url, ms);
    await r.body?.cancel?.().catch(() => {});
    return r.status;
  } catch (e) {
    return e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'délai dépassé' : 'erreur réseau';
  }
}

/** Each path of `paths` read once (PARALLEL at a time); the ones not answering 200, with their status. */
async function pass(get, base, paths, ms) {
  const bad = [];
  let i = 0;
  const worker = async () => {
    while (i < paths.length) {
      const path = paths[i++];
      const status = await statusOf(get, new URL(path, base), ms);
      if (status !== 200) bad.push({ path, status });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, paths.length) }, worker));
  return bad.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Wait until sw.js and SHA256SUMS, then every published file, answer 200, within `waitMs`.
 * `get(url, ms)`: a bounded read (each read keeps its own timeout, #670; never beyond the deadline).
 * Returns `{ files, missing, waitedMs }`: `missing` lists each file not served at the bound, with its
 * last status (empty: all served).
 */
export async function waitPublished(base, { get, waitMs = WAIT_MS, pollMs = POLL_MS, fetchMs = 20_000 } = {}) {
  const start = Date.now();
  const deadline = start + waitMs;
  // a read never runs far past the deadline, yet never so short that a 503 would read « délai dépassé »
  const left = () => Math.max(Math.min(fetchMs, 5_000), Math.min(fetchMs, deadline - Date.now()));
  const read = async (path) => {
    try {
      const r = await get(new URL(path, base), left());
      return { status: r.status, text: r.status === 200 ? await r.text() : '' };
    } catch (e) {
      return { status: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'délai dépassé' : 'erreur réseau', text: '' };
    }
  };
  // 1. the two lists (sw.js and SHA256SUMS), then 2. every file they name
  let sw = { status: 'non lu', text: '' };
  let sums = { status: 'non lu', text: '' };
  let paths = null;
  let missing = [];
  for (;;) {
    if (sw.status !== 200) sw = await read('sw.js');
    if (sums.status !== 200) sums = await read('SHA256SUMS');
    if (sw.status === 200 && sums.status === 200) {
      paths ??= publishedPaths(sw.text, sums.text);
      missing = await pass(get, base, missing.length ? missing.map((m) => m.path) : paths, left());
      if (!missing.length) break;
    } else {
      missing = [sw.status !== 200 && { path: 'sw.js', status: sw.status }, sums.status !== 200 && { path: 'SHA256SUMS', status: sums.status }].filter(Boolean);
    }
    if (Date.now() + pollMs > deadline) break;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { files: paths?.length ?? 0, missing, waitedMs: Date.now() - start };
}

/** One line per file not served at the bound: « fichier publié non servi après 5 min : demo/x.json (503) ». */
export function publishedReport(missing, waitMs = WAIT_MS) {
  const bound = waitMs >= 60_000 ? `${Math.round(waitMs / 60_000)} min` : `${Math.round(waitMs / 1000)} s`;
  return missing.map((m) => `fichier publié non servi après ${bound} : ${m.path} (${m.status})`);
}
