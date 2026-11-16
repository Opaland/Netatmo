// One way to forward an intercepted request to the preview server (AGENTS.md §5).
// The preview server (vite preview) sometimes drops a kept-alive connection under load: Playwright's
// `route.fetch` then rejects with ECONNRESET, inside a route handler, so the rejection was uncaught and
// stopped the whole script (CI runs 43948255421 and the one of #572). A dropped connection is retried
// a few times; any other error, or a connection still refused, aborts the request (the page sees a
// network error and the script's own checks report it) instead of killing the process.

const DROPPED = /ECONNRESET|socket hang up|EPIPE/;

/** Answer `route` with what the preview server gives for `url`. */
export async function relay(route, url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await route.fulfill({ response: await route.fetch({ url }) });
    } catch (err) {
      if (DROPPED.test(String(err)) && i < tries) continue;
      console.error(`relais : ${url} non servi (${String(err).split('\n')[0]})`);
      return route.abort().catch(() => {});
    }
  }
}
