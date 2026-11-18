// The e2e scripts forward intercepted requests to the preview server through one function
// (e2e/relais.mjs). Seen red: with the old one-shot forward (no retry), « retries a connection the
// server dropped » fails, and the old inline `r.fetch` in six scripts fails « the only way ».
// #640: a request `relay` gives up on is counted (seen red with the count removed), every script that
// relays reports the count (seen red with the line removed from one script), and the « only way »
// guard sees `route.fetch()` without an object and `.fetch(` with `{` on the next line (seen red on a
// throwaway e2e file written that way, then removed).
import { describe, expect, it } from 'vitest';

type Route = { fetch: () => Promise<unknown>; fulfill: () => Promise<void>; abort: () => Promise<void> };
const { relay, unservedRequests } = (await import(/* @vite-ignore */ new URL('../e2e/relais.mjs', import.meta.url).href)) as {
  relay: (route: Route, url: string, tries?: number) => Promise<void>;
  unservedRequests: () => string[];
};
const fsName = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsName)) as {
  readFileSync: (u: URL, enc: 'utf8') => string;
  readdirSync: (u: URL) => string[];
};

/** A fake Playwright route: `fetch` fails with the given errors, in order, then answers. */
function fakeRoute(failures: string[]) {
  const calls = { fetch: 0, fulfill: 0, abort: 0 };
  return {
    calls,
    async fetch() {
      calls.fetch++;
      const err = failures.shift();
      if (err) throw new Error(err);
      return { status: 200 };
    },
    async fulfill() {
      calls.fulfill++;
    },
    async abort() {
      calls.abort++;
    },
  };
}

describe('relay (e2e: forward an intercepted request to the preview server)', () => {
  it('retries a connection the server dropped, then answers', async () => {
    const r = fakeRoute(['route.fetch: read ECONNRESET']);
    await relay(r, 'http://localhost/x');
    expect(r.calls).toEqual({ fetch: 2, fulfill: 1, abort: 0 });
  });

  it('never rejects: another error, or a connection dropped every time, aborts the request', async () => {
    const other = fakeRoute(['route.fetch: net::ERR_FAILED']);
    await expect(relay(other, 'http://localhost/x')).resolves.toBeUndefined();
    expect(other.calls).toEqual({ fetch: 1, fulfill: 0, abort: 1 });
    const dropped = fakeRoute(['read ECONNRESET', 'read ECONNRESET', 'read ECONNRESET']);
    await expect(relay(dropped, 'http://localhost/x', 3)).resolves.toBeUndefined();
    expect(dropped.calls).toEqual({ fetch: 3, fulfill: 0, abort: 1 });
  });

  it('counts a request it gave up on, but not one cut short by a closed page (#640)', async () => {
    const before = unservedRequests().length;
    await relay(fakeRoute(['route.fetch: net::ERR_FAILED']), 'http://localhost/non-servi');
    await relay(fakeRoute(['route.fetch: Target page, context or browser has been closed']), 'http://localhost/ferme');
    const added = unservedRequests().slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toContain('http://localhost/non-servi');
  });

  it('every script that relays turns red on an unserved request (#640)', () => {
    const silent = e2eScripts().filter(
      ([f, src]) => f !== 'relais.mjs' && /\brelay\b/.test(src) && !/errors\.push\(\.\.\.unservedRequests\(\)\)/.test(src),
    );
    expect(silent.map(([f]) => f)).toEqual([]);
  });

  it('sees a hand-made forward however it is written', () => {
    expect(forwardsByHand('await route.fetch({ url })')).toBe(true);
    expect(forwardsByHand('await route.fetch()')).toBe(true);
    expect(forwardsByHand('await r.fetch(\n  { url })')).toBe(true);
    expect(forwardsByHand('route?.fetch ({ url })')).toBe(true);
    expect(forwardsByHand('if ((await fetch(base)).ok) return;')).toBe(false);
  });

  it('is the only way the e2e scripts forward a request (AGENTS.md §5)', () => {
    const raw = e2eScripts().filter(([f, src]) => f !== 'relais.mjs' && forwardsByHand(src));
    expect(raw.map(([f]) => f)).toEqual([]);
  });
});

/** A method call `.fetch(`: Playwright's `route.fetch`, with or without an object, on one line or not.
 * The global `fetch(` the scripts use to wait for the preview server has no dot before it. */
function forwardsByHand(src: string) {
  return /\.\s*fetch\s*\(/.test(src);
}

function e2eScripts(): [string, string][] {
  const dir = new URL('../e2e/', import.meta.url);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.mjs'))
    .map((f): [string, string] => [f, fs.readFileSync(new URL(f, dir), 'utf8')]);
}
