// The e2e scripts forward intercepted requests to the preview server through one function
// (e2e/relais.mjs). Seen red: with the old one-shot forward (no retry), « retries a connection the
// server dropped » fails, and the old inline `r.fetch` in six scripts fails the last test.
import { describe, expect, it } from 'vitest';

type Route = { fetch: () => Promise<unknown>; fulfill: () => Promise<void>; abort: () => Promise<void> };
const { relay } = (await import(/* @vite-ignore */ new URL('../e2e/relais.mjs', import.meta.url).href)) as {
  relay: (route: Route, url: string, tries?: number) => Promise<void>;
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

  it('is the only way the e2e scripts forward a request (AGENTS.md §5)', () => {
    const dir = new URL('../e2e/', import.meta.url);
    const raw = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.mjs') && f !== 'relais.mjs' && /\.fetch\(\{/.test(fs.readFileSync(new URL(f, dir), 'utf8')));
    expect(raw).toEqual([]);
  });
});
