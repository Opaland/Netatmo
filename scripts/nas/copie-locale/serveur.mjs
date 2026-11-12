// Serves the local copy (issue #143) on the home network: the files of SITE/actuelle, read-only.
// No dependency (Node's http only), no directory listing, nothing outside the published copy, GET
// and HEAD only. HTTP on purpose: HTTPS is added in front by the NAS's reverse proxy (the app's
// decryption needs a secure context, docs/nas-copie-locale.md).
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, sep } from 'node:path';

const SITE = process.env.SITE ?? '/copie/site';
const PORT = Number(process.env.PORT ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// Files that change at each publication are revalidated; the hashed assets can be cached.
const REVALIDATE = /(^|\/)(index\.html|sw\.js|manifest\.webmanifest|registerSW\.js|build\.json)$|^data\//;

const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // only frame-ancestors: the page's own policy (meta) stays the one that applies to the rest
  'Content-Security-Policy': "frame-ancestors 'none'",
};

/** The file a URL path names inside root (resolved, links included), or null. */
export async function resolve(root, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const base = await realpath(root);
  let file;
  try {
    // realpath also refuses a NUL byte (it throws): the catch answers 404
    file = await realpath(join(base, rel));
  } catch {
    return null;
  }
  if (file !== base && !file.startsWith(base + sep)) return null;
  const st = await stat(file);
  return st.isFile() ? { file, size: st.size, rel: file.slice(base.length + 1) } : null;
}

export function handler(site = SITE) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...HEADERS, Allow: 'GET, HEAD' }).end();
      return;
    }
    let found = null;
    try {
      found = await resolve(join(site, 'actuelle'), new URL(req.url ?? '/', 'http://copie').pathname);
    } catch {
      found = null;
    }
    if (!found) {
      res.writeHead(404, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable\n');
      return;
    }
    res.writeHead(200, {
      ...HEADERS,
      'Content-Type': TYPES[extname(found.file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': found.size,
      'Cache-Control': REVALIDATE.test(found.rel) ? 'no-cache' : 'public, max-age=604800',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(found.file).pipe(res);
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer(handler());
  server.listen(PORT, () => {
    // no address, no file name: the log says only that the server is up, and on which port
    console.log(`copie-locale : serveur prêt sur le port ${server.address().port}`);
  });
}
