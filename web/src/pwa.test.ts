import { describe, expect, it, vi } from 'vitest';
import { type SwContainer, type SwRegistration, cachesToClear, createUpdater, reloadApp } from './pwa';
import { IOS_GESTURE, installState } from './install';
import { MANIFEST, SHORTCUTS, THEME_COLOR } from './manifest';
import { parseRoute } from './router';
import { installSteps } from './invite';
import { appCardHtml } from './views/app-card';

// Read from disk (as tokens.test.ts: no @types/node in this project).
const fsName = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, enc: 'utf8') => string };

// ------------------------------------------------------------------ fakes of the service worker API
class FakeWorker extends EventTarget {
  state = 'installing';
  messages: unknown[] = [];
  postMessage(m: unknown) {
    this.messages.push(m);
  }
}
class FakeReg extends EventTarget implements SwRegistration {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  update = vi.fn(async () => undefined);
  /** A new version is downloaded, then installed (it waits). */
  newVersion() {
    const w = new FakeWorker();
    this.installing = w;
    this.dispatchEvent(new Event('updatefound'));
    w.state = 'installed';
    this.installing = null;
    this.waiting = w;
    w.dispatchEvent(new Event('statechange'));
    return w;
  }
}
class FakeSw extends EventTarget implements SwContainer {
  constructor(
    public controller: unknown,
    public reg: FakeReg,
  ) {
    super();
  }
  async getRegistration() {
    return this.reg;
  }
  /** The waiting worker takes over (SKIP_WAITING here or in another tab): « activating », then the controller changes. */
  activate() {
    const w = this.reg.waiting;
    this.controller = w;
    this.reg.waiting = null;
    if (w) (w.state = 'activating'), w.dispatchEvent(new Event('statechange'));
    this.dispatchEvent(new Event('controllerchange'));
    return w;
  }
  /** …then its activate event is done: « activated ». */
  activated(w: FakeWorker | null) {
    if (!w) return;
    w.state = 'activated';
    w.dispatchEvent(new Event('statechange'));
  }
}

function setup(controller: unknown = {}) {
  const reg = new FakeReg();
  const sw = new FakeSw(controller, reg);
  const updates: string[] = [];
  const reload = vi.fn();
  const timers: (() => void)[] = [];
  const u = createUpdater({ sw, onUpdate: (k) => updates.push(k), reload, later: (fn) => timers.push(fn) });
  u.watch(reg);
  return { reg, sw, updates, reload, timers, u };
}

describe('nouvelle version (#357)', () => {
  it('announces a version that waits, and never reloads by itself', () => {
    const { reg, updates, reload } = setup();
    reg.newVersion();
    expect(updates).toEqual(['waiting']);
    expect(reload).not.toHaveBeenCalled();
  });

  it('says nothing at the first visit when clients.claim() is seen before « installed » (WebKit under load, PR #438)', () => {
    const { reg, sw, updates } = setup(null);
    const w = new FakeWorker();
    reg.installing = w;
    reg.dispatchEvent(new Event('updatefound'));
    // the first worker already took the page before its « installed » event reached it
    sw.controller = w;
    sw.dispatchEvent(new Event('controllerchange'));
    w.state = 'installed';
    reg.installing = null;
    reg.waiting = w;
    w.dispatchEvent(new Event('statechange'));
    expect(updates).toEqual([]);
    // a real new version later in the same page is still announced
    reg.waiting = null;
    reg.newVersion();
    expect(updates).toEqual(['waiting']);
  });

  it('says nothing at the first visit (no controller yet), even when clients.claim() takes over', () => {
    const { reg, sw, updates, reload } = setup(null);
    reg.newVersion();
    sw.activate(); // clients.claim() of the first installation: null → worker
    expect(updates).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('« Recharger » sends SKIP_WAITING to the waiting worker, then reloads once it has taken over', async () => {
    const { reg, sw, reload, u } = setup();
    const w = reg.newVersion();
    await u.apply();
    expect(w.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(reload).not.toHaveBeenCalled(); // not before the new worker is in charge
    const active = sw.activate();
    // #606: not at the controller change either: the worker is still « activating » (WebKit then
    // leaves the reloaded page with a worker that stays « activating »)
    expect(reload).not.toHaveBeenCalled();
    sw.activated(active);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads only once, even if the fallback fires after the controller change', async () => {
    const { reg, sw, reload, timers, u } = setup();
    reg.newVersion();
    await u.apply();
    sw.activated(sw.activate());
    timers.forEach((t) => t());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('another tab activated the version: this one is not reloaded, its banner says so and its button reloads', async () => {
    const { reg, sw, updates, reload, u } = setup();
    reg.newVersion();
    sw.activate(); // the other tab touched « Recharger »
    expect(updates).toEqual(['waiting', 'elsewhere']);
    expect(reload).not.toHaveBeenCalled();
    await u.apply(); // nothing waits any more
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a version already waiting when the page opens (#334: stuck for days) is announced and can be activated', async () => {
    const reg = new FakeReg();
    reg.waiting = new FakeWorker();
    const sw = new FakeSw({}, reg);
    const updates: string[] = [];
    const u = createUpdater({ sw, onUpdate: (k) => updates.push(k), reload: () => {}, later: () => {} });
    u.watch(reg);
    expect(updates).toEqual(['waiting']);
    await u.apply();
    expect(reg.waiting.messages).toEqual([{ type: 'SKIP_WAITING' }]);
  });

  it('the build has no forced skipWaiting any more (#334 replaced by the banner)', () => {
    const cfg = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    expect(cfg).not.toMatch(/skipWaiting\s*:\s*true/);
    expect(cfg).toMatch(/registerType:\s*'prompt'/);
  });
});

describe('« Recharger l’application » ne touche qu’au code (#357)', () => {
  const scope = 'https://opaland.github.io/Netatmo/';
  const names = [
    `workbox-precache-v2-${scope}`,
    'workbox-precache-v2-https://opaland.github.io/Autre/', // another Pages site of the account
    'energy-data@Netatmo',
    'energy-tariffs@Netatmo',
    'energy-data@Autre',
    'intuis-history@Netatmo',
  ];
  it('empties this app’s precache and the public tariffs', () => {
    expect(cachesToClear(names, scope, 'energy-tariffs@Netatmo', 'energy-data@Netatmo')).toEqual([`workbox-precache-v2-${scope}`, 'energy-tariffs@Netatmo']);
  });
  it('never the encrypted data kept offline, never another site’s caches', () => {
    const out = cachesToClear(names, scope, 'energy-tariffs@Netatmo', 'energy-data@Netatmo');
    expect(out).not.toContain('energy-data@Netatmo');
    expect(out.some((n) => n.includes('Autre'))).toBe(false);
    // even a misconfiguration naming the data cache as the tariff one keeps it
    expect(cachesToClear(names, scope, 'energy-data@Netatmo', 'energy-data@Netatmo')).not.toContain('energy-data@Netatmo');
  });
  /** Runs reloadApp against fakes; `revived`: the browser revives the registration being removed (Chromium). */
  async function reloadSteps(revived: boolean) {
    const steps: string[] = [];
    const scope = 'https://opaland.github.io/Netatmo/';
    const reg = { scope, unregister: async () => (steps.push('unregister'), true) };
    const worker = Object.assign(new EventTarget(), { state: 'installed' });
    const next = revived ? { ...reg, installing: null, waiting: null } : { installing: worker, waiting: null };
    vi.stubGlobal('navigator', {
      onLine: true,
      serviceWorker: { getRegistration: async () => reg, register: async (url: string) => (steps.push(`register ${url}`), next) },
    });
    vi.stubGlobal('caches', { keys: async () => [`workbox-precache-v2-${scope}`, 'energy-data'], delete: async (n: string) => (steps.push(`delete ${n}`), true) });
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('location', { reload: () => steps.push('reload') });
    try {
      const done = reloadApp();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      steps.push('—');
      worker.state = 'activated';
      worker.dispatchEvent(new Event('statechange'));
      expect(await done).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
    return steps;
  }
  it('#604: registers the current version again and waits for it BEFORE the reload (WebKit empties the origin’s caches without one)', async () => {
    expect(await reloadSteps(false)).toEqual(['delete workbox-precache-v2-https://opaland.github.io/Netatmo/', 'unregister', 'register sw.js', '—', 'reload']);
  });
  it('#604: a revived registration (Chromium) is removed again, then the page reloads', async () => {
    expect(await reloadSteps(true)).toEqual(['delete workbox-precache-v2-https://opaland.github.io/Netatmo/', 'unregister', 'register sw.js', 'unregister', 'reload', '—']);
  });
  it('the card says what is kept', () => {
    const h = appCardHtml({ install: 'installed', persisted: true, offline: true });
    expect(h).toMatch(/clé mémorisée/);
    expect(h).toMatch(/notes chiffrées/);
    expect(h).toMatch(/données chiffrées gardées pour le hors connexion/);
    expect(h).toMatch(/réseau nécessaire/);
  });
});

describe('installer (#357)', () => {
  it('offers nothing once installed or opened from the icon', () => {
    expect(installState({ standalone: true, installed: false, prompt: true, ios: false })).toBe('installed');
    expect(installState({ standalone: false, installed: true, prompt: true, ios: false })).toBe('installed');
    expect(appCardHtml({ install: 'installed', persisted: null, offline: true })).not.toMatch(/Installer/);
  });
  it('a button when the browser offers the installation, the Safari gesture on iPhone, never an idle button', () => {
    expect(installState({ standalone: false, installed: false, prompt: true, ios: false })).toBe('prompt');
    expect(appCardHtml({ install: 'prompt', persisted: null, offline: true })).toMatch(/id="install-app"/);
    expect(installState({ standalone: false, installed: false, prompt: false, ios: true })).toBe('ios');
    const ios = appCardHtml({ install: 'ios', persisted: null, offline: true });
    expect(ios).not.toMatch(/id="install-app"/);
    expect(ios).toMatch(/Partager/);
    expect(ios).toMatch(/Sur l'écran d'accueil|Sur l&#39;écran d&#39;accueil/);
  });
  it('the iPhone gesture is the one of the invitation (installSteps)', () => {
    expect(installSteps()).toContain(IOS_GESTURE.replace(/^Dans/, 'dans'));
  });
  it('says whether the browser keeps the storage', () => {
    expect(appCardHtml({ install: 'installed', persisted: true, offline: true })).toMatch(/garde le stockage/);
    expect(appCardHtml({ install: 'installed', persisted: false, offline: true })).toMatch(/peut effacer/);
    expect(appCardHtml({ install: 'installed', persisted: null, offline: false })).toMatch(/Pas encore prête hors connexion/);
  });
});

describe('manifeste (#357)', () => {
  it('has an id and shortcuts to real pages', () => {
    expect(MANIFEST.id).toBe('./');
    expect(MANIFEST.shortcuts.length).toBeGreaterThanOrEqual(3);
    for (const s of MANIFEST.shortcuts) {
      expect(s.url).toMatch(/^\.\/#/);
      expect(parseRoute(s.url.slice(2))).not.toBeNull();
    }
    expect(SHORTCUTS.map((s) => s.hash)).toEqual(['accueil', 'pieces', 'compteur', 'etat']);
  });
  it('keeps a maskable icon', () => {
    expect(MANIFEST.icons.some((i) => 'purpose' in i && i.purpose === 'maskable')).toBe(true);
  });
  it('theme colour = the light page surface of the tokens and of index.html', () => {
    const primitives = readFileSync(new URL('./styles/tokens.primitives.css', import.meta.url), 'utf8');
    const tokens = readFileSync(new URL('./styles/tokens.css', import.meta.url), 'utf8');
    const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(tokens).toMatch(/--surface-page:\s*var\(--sand-2\)/);
    expect(primitives).toContain(`--sand-2: ${THEME_COLOR};`);
    expect(index).toContain(`<meta name="theme-color" content="${THEME_COLOR}" media="(prefers-color-scheme: light)" />`);
    expect(MANIFEST.theme_color).toBe(THEME_COLOR);
  });
});
