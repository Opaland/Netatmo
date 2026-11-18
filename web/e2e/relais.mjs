// One way to forward an intercepted request to the preview server (AGENTS.md §5).
// The preview server (vite preview) sometimes drops a kept-alive connection under load: Playwright's
// `route.fetch` then rejects with ECONNRESET, inside a route handler, so the rejection was uncaught and
// stopped the whole script (CI runs 43948255421 and the one of #572). A dropped connection is retried
// a few times; any other error, or a connection still refused, aborts the request instead of killing
// the process — and the request is counted (#640): every script that relays adds `unservedRequests()`
// to its errors before it decides its exit code, so a request the page never got turns the script red,
// as it did before #631 (`relais.test.ts` checks that every script that imports `relay` does so).
// A request cut short because its page, context or browser was closed is not a failure of the
// script: it is left out.

const DROPPED = /ECONNRESET|socket hang up|EPIPE/;
const CLOSED = /has been closed|Target closed|context disposed/i;
const unserved = [];

/** Answer `route` with what the preview server gives for `url`. */
export async function relay(route, url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await route.fulfill({ response: await route.fetch({ url }) });
    } catch (err) {
      if (DROPPED.test(String(err)) && i < tries) continue;
      const why = String(err).split('\n')[0];
      if (!CLOSED.test(why)) {
        unserved.push(`relais : ${url} non servi (${why})`);
        console.error(unserved.at(-1));
      }
      return route.abort().catch(() => {});
    }
  }
}

/** The requests `relay` could not serve so far, one line each, to add to the script's errors. */
export function unservedRequests() {
  return [...unserved];
}
