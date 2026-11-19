// #654: why an opening failed. The sweep of the published demo failed twice at its opening
// (runs 43311237189 and 44532457570: « locator.click: Timeout 30000ms exceeded » on the demo
// button, nothing else), and the log could not tell a hashed file served 404 just after the
// deployment from a JavaScript error at start-up or a slow network. A page watched from its
// creation keeps the status of its document and the requests that failed or answered ≥ 400; at an
// opening failure, the report joins them to the console and page errors already gathered.
// No retry here, on purpose: it would hide the defect while its cause is unknown.
//
// What is written is the PATH only (never a parameter, a fragment, a host, a body). On real data
// (quiet), a path under data/ is not written either: only « fichier de données ».

const MAX = 8; // a failing deployment can refuse every chunk: the first ones are enough to read

/** The path of `url`, without host, parameters nor fragment (« ? » and « # » never pass). */
export function pathOnly(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return String(url).split(/[?#]/)[0];
  }
}

/** Start watching `page` (call it before the first navigation): its document status and the requests that went wrong. */
export function watchOpening(page) {
  const seen = { document: null, bad: [] };
  const add = (path, what) => {
    if (seen.bad.length < MAX && !seen.bad.some((b) => b.path === path && b.what === what)) seen.bad.push({ path, what });
  };
  page.on('response', (r) => {
    if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) seen.document = r.status();
    if (r.status() >= 400) add(pathOnly(r.url()), String(r.status()));
  });
  page.on('requestfailed', (r) => add(pathOnly(r.url()), (r.failure()?.errorText ?? 'échec').split('\n')[0].slice(0, 60)));
  return seen;
}

/**
 * The diagnosis of an opening, in one line: « document 200 · non servis : /x/assets/index-a.js
 * (404) · console : … ». `errors`: console and page errors already gathered (none on real data).
 * `quiet` (real data): a path under data/ becomes « fichier de données ».
 */
export function openingReport(seen, errors = [], quiet = false) {
  const parts = [`document ${seen.document ?? 'sans réponse'}`];
  const shown = (p) => (quiet && /\/data\//.test(p) ? 'fichier de données' : p);
  if (seen.bad.length) parts.push(`non servis : ${seen.bad.map((b) => `${shown(b.path)} (${b.what})`).join(', ')}`);
  else parts.push('aucune requête en échec');
  if (errors.length) parts.push(`console : ${errors.join(' | ').slice(0, 300)}`);
  return parts.join(' · ');
}
