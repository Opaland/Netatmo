// The demo dataset (public/demo, passphrase « demo ») decrypted in a test: fetch is answered
// from public/, as the preview server would (files bundled by Vite, no Node API needed).
import { type Dataset, load, unlock } from '../data';

const files = import.meta.glob<string>(['../../public/demo/*.json', '../../public/tarifs/*'], { eager: true, query: '?raw', import: 'default' });

let cached: Promise<Dataset> | null = null;

export function demoDataset(): Promise<Dataset> {
  cached ??= (async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = String(input).replace(/^\.?\//, '');
      const body = files[`../../public/${path}`];
      if (body === undefined) return new Response('', { status: 404 });
      return new Response(body, { status: 200, headers: { 'content-type': path.endsWith('.json') ? 'application/json' : 'text/plain' } });
    }) as typeof fetch;
    try {
      return await load('demo', await unlock('demo', 'demo'));
    } finally {
      globalThis.fetch = real;
    }
  })();
  return cached;
}
