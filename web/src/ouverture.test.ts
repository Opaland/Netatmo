// #654: the report of an opening that failed (e2e/ouverture.mjs) names the files not served by
// their path only. Seen red: with `pathOnly` returning the URL whole, the « ? » and « # » cases
// fail; with `openingReport` writing the paths of data/ on real data, the quiet case fails.
// The end-to-end proof is the sweep's own self-test (`selfTestOpening`, e2e/sweep.mjs): the app's
// entry script refused with a 404, the opening must fail and its report name the file and status.
import { describe, expect, it } from 'vitest';

const { pathOnly, openingReport, watchOpening } = (await import(/* @vite-ignore */ new URL('../e2e/ouverture.mjs', import.meta.url).href)) as {
  pathOnly: (url: string) => string;
  openingReport: (seen: { document: number | null; bad: { path: string; what: string }[] }, errors?: string[], quiet?: boolean) => string;
  watchOpening: (page: FakePage) => { document: number | null; bad: { path: string; what: string }[] };
};

type Handler = (x: unknown) => void;
type FakePage = { on: (event: string, h: Handler) => void; mainFrame: () => unknown };

describe('pathOnly', () => {
  it('keeps the path, drops parameters, fragment and host', () => {
    expect(pathOnly('https://exemple.test/Netatmo/assets/index-AbC1.js?v=2&jeton=abc#x')).toBe('/Netatmo/assets/index-AbC1.js');
    expect(pathOnly('https://exemple.test/Netatmo/#historique')).toBe('/Netatmo/');
    expect(pathOnly('/relatif/x.js?a=1#b')).toBe('/relatif/x.js');
  });
});

describe('openingReport', () => {
  it('names the document status, each file not served with its status, and the console errors', () => {
    const r = openingReport({ document: 200, bad: [{ path: '/Netatmo/assets/index-AbC1.js', what: '404' }] }, ['Failed to load resource: 404']);
    expect(r).toBe('document 200 · non servis : /Netatmo/assets/index-AbC1.js (404) · console : Failed to load resource: 404');
  });
  it('says when nothing failed, and when the document never answered', () => {
    expect(openingReport({ document: null, bad: [] })).toBe('document sans réponse · aucune requête en échec');
  });
  it('on real data (quiet), never writes a path of data/', () => {
    const r = openingReport({ document: 200, bad: [{ path: '/Netatmo/data/2026-11.enc.json', what: '404' }, { path: '/Netatmo/assets/app-x.js', what: 'net::ERR_FAILED' }] }, ['console'], true);
    expect(r).not.toContain('2026-11');
    expect(r).toContain('fichier de données (404)');
    expect(r).toContain('/Netatmo/assets/app-x.js (net::ERR_FAILED)');
  });
});

describe('watchOpening', () => {
  it('keeps the main document status and the requests ≥ 400 or failed, by path, once each', () => {
    const handlers: Record<string, Handler> = {};
    const main = {};
    const page: FakePage = { on: (e, h) => (handlers[e] = h), mainFrame: () => main };
    const seen = watchOpening(page);
    const response = (url: string, status: number, nav = false, frame: unknown = main) => ({ url: () => url, status: () => status, frame: () => frame, request: () => ({ isNavigationRequest: () => nav }) });
    handlers.response(response('https://exemple.test/N/?fixture=demo#x', 200, true));
    handlers.response(response('https://exemple.test/N/iframe', 404, true, {})); // another frame: not the document
    handlers.response(response('https://exemple.test/N/assets/index-a.js?x=1', 404));
    handlers.response(response('https://exemple.test/N/assets/index-a.js?x=2', 404));
    handlers.response(response('https://exemple.test/N/assets/ok.js', 200));
    handlers.requestfailed({ url: () => 'https://exemple.test/N/assets/b.js#f', failure: () => ({ errorText: 'net::ERR_ABORTED' }) });
    expect(seen.document).toBe(200);
    expect(seen.bad).toEqual([
      { path: '/N/iframe', what: '404' },
      { path: '/N/assets/index-a.js', what: '404' },
      { path: '/N/assets/b.js', what: 'net::ERR_ABORTED' },
    ]);
  });
});
