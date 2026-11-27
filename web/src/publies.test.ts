// #648: before opening the published page, `en-ligne.mjs` waits (bounded) until each file the page
// will load answers 200 (e2e/publies.mjs). Here against a local HTTP server: a file in 503 for a
// while then 200 is waited for; a file in 503 for good fails at the bound, named with its status.
// Seen red: with the wait loop cut to a single pass, « waits for a file in 503 » fails; with
// `missing` not kept, « names each file » fails; with data/ not filtered, « never data/ » fails.
// End to end (written in the PR): the old en-ligne.mjs fails on a local copy of the site whose
// demo/weather.enc.json answers 503 for 30 s, the new one passes after a 30 s wait.
import { afterEach, describe, expect, it } from 'vitest';

type Missing = { path: string; status: number | string };
type Get = (url: URL | string, ms: number) => Promise<Response>;
const { publishedPaths, waitPublished, publishedReport, WAIT_MS } = (await import(/* @vite-ignore */ new URL('../e2e/publies.mjs', import.meta.url).href)) as {
  publishedPaths: (sw: string, sums: string) => string[];
  waitPublished: (base: string, o: { get: Get; waitMs?: number; pollMs?: number; fetchMs?: number }) => Promise<{ files: number; missing: Missing[]; waitedMs: number }>;
  publishedReport: (missing: Missing[], waitMs?: number) => string[];
  WAIT_MS: number;
};
type Server = { listen: (port: number, cb: () => void) => void; close: () => void; address: () => { port: number } };
type Res = { writeHead: (s: number) => Res; end: (b?: string) => void };
const httpName = 'node:http';
const http = (await import(/* @vite-ignore */ httpName)) as { createServer: (h: (req: { url: string }, res: Res) => void) => Server };

const SW = 'define(["./workbox-1a2b3c"],(function(e){e.precacheAndRoute([{url:"index.html",revision:"x"},{url:"assets/index-AbC.js",revision:null}])}));';
const H = 'e'.repeat(64);
const SUMS = `${H}  assets/index-AbC.js\n${H}  demo/weather.enc.json\n${H}  data/weather.enc.json\n${H}  tarifs/Option_Base.csv\n`;
const get: Get = (url, ms) => fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(ms) });

let server: Server | null = null;
afterEach(() => server?.close());

/** A site at /Netatmo/ whose `flaky` path answers 503 for `ms` (Infinity: for good); the rest 200. */
async function site(flaky: string, ms: number) {
  const t0 = Date.now();
  const hits: string[] = [];
  server = http.createServer((req, res) => {
    const path = req.url.replace(/^\/Netatmo\//, '');
    hits.push(path);
    if (path === flaky && Date.now() - t0 < ms) return res.writeHead(503).end();
    res.writeHead(200).end(path === 'sw.js' ? SW : path === 'SHA256SUMS' ? SUMS : 'ok');
  });
  await new Promise<void>((r) => server!.listen(0, r));
  return { base: `http://localhost:${server.address().port}/Netatmo/`, hits };
}

describe('publishedPaths', () => {
  it('the precache, sw.js and its workbox chunk, and SHA256SUMS: never data/', () => {
    expect(publishedPaths(SW, SUMS)).toEqual(['assets/index-AbC.js', 'demo/weather.enc.json', 'index.html', 'sw.js', 'tarifs/Option_Base.csv', 'workbox-1a2b3c.js']);
  });
});

describe('waitPublished', () => {
  it('waits for a file in 503 until it answers 200, within the bound', async () => {
    const { base, hits } = await site('demo/weather.enc.json', 1200);
    const r = await waitPublished(base, { get, waitMs: 10_000, pollMs: 200 });
    expect(r.missing).toEqual([]);
    expect(r.files).toBe(6);
    expect(r.waitedMs).toBeGreaterThanOrEqual(1000);
    expect(hits.some((h) => h.startsWith('data/'))).toBe(false);
  });
  it('waits for sw.js itself', async () => {
    const { base } = await site('sw.js', 800);
    expect((await waitPublished(base, { get, waitMs: 10_000, pollMs: 200 })).missing).toEqual([]);
  });
  it('names each file still not served at the bound, with its status, and stops there', async () => {
    const { base } = await site('demo/weather.enc.json', Infinity);
    const t = Date.now();
    const r = await waitPublished(base, { get, waitMs: 1500, pollMs: 200 });
    expect(Date.now() - t).toBeLessThan(4000);
    expect(r.missing).toEqual([{ path: 'demo/weather.enc.json', status: 503 }]);
    expect(publishedReport(r.missing, 1500)).toEqual(['fichier publié non servi après 2 s : demo/weather.enc.json (503)']);
  });
  it('a SHA256SUMS never served is named too (no list, no file checked)', async () => {
    const { base } = await site('SHA256SUMS', Infinity);
    const r = await waitPublished(base, { get, waitMs: 800, pollMs: 200 });
    expect(r.missing).toEqual([{ path: 'SHA256SUMS', status: 503 }]);
    expect(r.files).toBe(0);
  });
});

describe('the bound', () => {
  it('5 min: with build.json (2 min) and a normal run, well inside the 20 min of site-en-ligne', () => {
    expect(WAIT_MS).toBe(5 * 60_000);
    expect(publishedReport([{ path: 'x', status: 503 }])).toEqual(['fichier publié non servi après 5 min : x (503)']);
  });
});
