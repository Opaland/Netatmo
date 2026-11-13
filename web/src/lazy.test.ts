// #593 (#590 n° 4): a zone drawn by `lazyView` stays aria-busy until the LAST draw asked for it
// is done, and only that draw paints it; never left aria-busy (success, failure, a later draw
// with the module already there). No DOM in the unit tests: a zone is a small stand-in.
import { describe, expect, it, vi } from 'vitest';

// app.ts (imported by lazy.ts for the dataset) reads #app when it loads: a bare stand-in.
vi.stubGlobal('document', { getElementById: () => null, querySelector: () => null, addEventListener: () => undefined, documentElement: { dataset: {} } });
const { lazyView } = await import('./lazy');

/** What lazyView touches on its zone. */
function zone() {
  const attrs = new Map<string, string>();
  return {
    isConnected: true,
    innerHTML: '',
    drawn: '',
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    busy: () => attrs.get('aria-busy') === 'true',
  };
}
type Zone = ReturnType<typeof zone>;
const asEl = (z: Zone) => z as unknown as HTMLElement;

/** A module load that the test settles by hand, one per call. */
function loads() {
  const calls: { resolve: (m: { tag: string }) => void; reject: (e: unknown) => void }[] = [];
  const load = () => new Promise<{ tag: string }>((resolve, reject) => void calls.push({ resolve, reject }));
  return { load, calls };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('#593 : lazyView, une zone occupée jusqu’au dernier dessin', () => {
  it('deux dessins sur la même zone : occupée jusqu’à la fin du second, peinte par lui seul', async () => {
    const { load, calls } = loads();
    const view = lazyView(load);
    const z = zone();
    view.draw(asEl(z), () => (z.drawn = 'premier'), 'Vue');
    view.draw(asEl(z), () => (z.drawn = 'second'), 'Vue');
    expect(z.busy()).toBe(true);
    calls[0].resolve({ tag: 'm' });
    await settle();
    expect(z.busy(), 'le premier dessin fini ne libère pas la zone que le second attend').toBe(true);
    calls[1].resolve({ tag: 'm' });
    await settle();
    expect(z.busy()).toBe(false);
    expect(z.drawn).toBe('second');
  });

  it('un dessin immédiat (module déjà là) après un dessin qui attend : la zone est libérée et garde le dernier', async () => {
    const { load, calls } = loads();
    const view = lazyView(load);
    const z = zone();
    view.draw(asEl(z), () => (z.drawn = 'premier'), 'Vue');
    view.warm();
    calls[1].resolve({ tag: 'm' });
    await settle();
    view.draw(asEl(z), () => (z.drawn = 'second'), 'Vue');
    expect(z.busy()).toBe(false);
    expect(z.drawn).toBe('second');
    calls[0].resolve({ tag: 'm' });
    await settle();
    expect(z.busy()).toBe(false);
    expect(z.drawn, 'un dessin plus ancien ne repeint pas la zone').toBe('second');
  });

  it('un seul dessin : occupée pendant l’attente, libérée au succès comme à l’échec', async () => {
    const { load, calls } = loads();
    const view = lazyView(load);
    const ok = zone();
    view.draw(asEl(ok), () => (ok.drawn = 'vue'), 'Vue');
    expect(ok.busy()).toBe(true);
    calls[0].resolve({ tag: 'm' });
    await settle();
    expect([ok.busy(), ok.drawn]).toEqual([false, 'vue']);

    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { load: load2, calls: calls2 } = loads();
    const view2 = lazyView(load2);
    const ko = zone();
    ko.isConnected = false; // the failure message needs a document: the zone has left the page
    view2.draw(asEl(ko), () => (ko.drawn = 'vue'), 'Vue');
    calls2[0].reject(new Error('module absent'));
    await settle();
    expect([ko.busy(), ko.drawn]).toEqual([false, '']);
    expect(view2.get()).toBeNull();
    quiet.mockRestore();
  });
});
