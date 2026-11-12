// #359: fixed-seed fuzz of the entry points that read data the app did not just write:
// preferences read back from localStorage, the private notes (encrypted), the invoice typed by
// hand, the addresses (routes, invitation) and the CSV cells. Each gate is tried on CASES
// generated values biased towards the real shapes (known keys, valid days) and the unexpected
// ones (`__proto__`, NaN, 1e308, 5 000 characters, half a UTF-16 pair, 2026-02-30, crossed
// types). A failure prints the seed and the case number: `fuzzCase(SEED, n)` replays it.
//
// Model: Mousse de Poche, tests/unit/fuzz.test.ts (S282), itself from ÉtapeForge.
// Every invariant was seen red by removing its guard (CSV FORMULA regex, the real-day check of
// validInvoice, Object.hasOwn in parseRoute and parseStopped, the days check of the cold draft).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLD_DAYS, COLD_MAX_ROOMS, parseColdConfig, parseColdDraft } from './cold';
import { BadEnvelope, checkEnvelope } from './crypto';
import { textCell, untextCell } from './csv';
import { parseEvInput } from './ev';
import { parseHaLinks } from './ha';
import { parseHeatPumpInputs } from './heatpump';
import { loadVotes } from './insight';
import { INSTALL_HASH, inviteUrl } from './invite';
import { validInvoice } from './invoice';
import { loadNote } from './local-store';
import { declinedPairs } from './module-match';
import { MAX_RANGES, parseHcRanges, periodsOfTyped, resolveOffPeak, shareOn, slotShares } from './offpeak';
import { agreePlurals } from './glossary';
import { parseFlags } from './onboarding';
import { STOP_REASONS, parseStopped } from './room-offline';
import { MAX_PURCHASES, SPECIES, parseWood } from './wood';
import { HISTORY_PAGES, METER_PAGES, SETTINGS, TOOLS, parseRoute, routeKey } from './router';
import { lockNotice } from './session';
import { readShellyPrefs } from './shelly-prefs';
import { INPUT_FIELDS, MAX_ROOFS, ROOF_FIELDS, parseLocation, parseLocationDraft, parsePvgisFile, parseSolarDoc, parseSolarInputs } from './solar';
import { type VoletsDoc, evenings, loadNotes, recentFailures, shutterNames, summarize } from './shutters';
import { readMark } from './storage';
import { parseTenant } from './tenant';

const SEED = 20261110;
const CASES = 2000;

/** mulberry32: small, fast, good enough to spread cases; same seed, same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const KEYS = [
  // fields of the readers fuzzed here
  'threshold', 'days', 'rooms', 'kwhWeek', 'powerKw', 'startHour', 'mode', 'low', 'high', 'share',
  'done', 'tip', 'on', 'leaseFrom', 'leaseTo', 'room', 'from', 'to', 'reason', 'label', 'names',
  'roles', 'amount', 'kwh', 'subscription', 'estimated', 'v', 'kdf', 'iter', 'salt', 'iv', 'ct',
  'at', 'source', 'minutes', '2026-01', '2025-12', 'r-salon',
  'lat', 'lon', 'precision', 'commune', 'roofs', 'name', 'azimuth', 'tilt', 'kwc', 'loss', 'hours', '06-21', 'year', 'priceHp', 'batteryEfficiency',
  // the dangerous ones
  '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', '',
];
const STRINGS = [
  '', ' ', 'scop', 'curve', 'up', 'down', 'idle', 'main', 'water', 'poele', 'autre', 'constructor',
  '__proto__', 'toString', '2026-01-15', '2026-02-30', '2026-13-01', '0000-00-00', '2026-1-5', '2026-01',
  '9999-12-31', 'PBKDF2-SHA256', '=HYPERLINK("https://x")', '+33 6', '-12', '@SUM(A1)', '\t=1', '\r=1',
  ' =1', 'a;b', 'a,b', 'a"b', 'a\nb', '\ud83d', '\ude00x', '😀', 'é', 'javascript:alert(1)', '%', '%E0%A4%A',
  '<img src=x onerror=alert(1)>', 'x'.repeat(5000), 'NaN', '1e308', '7.4', 'true', 'null',
];
const NUMBERS = [0, -0, 1, -1, 2, 3, 7, 8, 14, 22, 23, 24, 0.5, 2.3, 3.7, 7.4, 11, 40, 500, 501, 600_000, 1e6, 1e7, 1e308, -1e308, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, 1.5];

/** A value of any type, biased towards the shapes the readers expect. */
function anyValue(r: Rng, depth = 0): unknown {
  const k = r();
  if (k < 0.18) return pick(r, NUMBERS);
  if (k < 0.36) return pick(r, STRINGS);
  if (k < 0.42) return r() < 0.5;
  if (k < 0.47) return null;
  if (k < 0.5) return undefined;
  if (k < 0.55) return randomString(r);
  if (depth > 2) return pick(r, NUMBERS);
  if (k < 0.72) return Array.from({ length: Math.floor(r() * 5) }, () => anyValue(r, depth + 1));
  const o: Record<string, unknown> = {};
  const n = Math.floor(r() * 7);
  // defineProperty: an own « __proto__ » key, as JSON.parse would create it
  for (let i = 0; i < n; i++) Object.defineProperty(o, pick(r, KEYS), { value: anyValue(r, depth + 1), enumerable: true, configurable: true, writable: true });
  return o;
}

function randomString(r: Rng): string {
  const n = Math.floor(r() * 40);
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(r() < 0.8 ? 32 + Math.floor(r() * 95) : Math.floor(r() * 0x10000));
  return s;
}

/** The text a reader finds in storage: usually JSON of a value, sometimes garbage. */
function storedText(r: Rng): string | null {
  const k = r();
  if (k < 0.05) return null;
  if (k < 0.15) return randomString(r);
  if (k < 0.2) return pick(r, ['{', '[', 'undefined', '{"__proto__":{"polluted":1}}', '{"constructor":{"prototype":{"polluted":1}}}']);
  try {
    return JSON.stringify(anyValue(r)) ?? 'null';
  } catch {
    return 'null';
  }
}

/** Runs `check` on CASES values; the message names the seed and the case. */
function fuzz(name: string, check: (r: Rng, n: number) => void) {
  const r = mulberry32(SEED ^ hash(name));
  for (let n = 0; n < CASES; n++) {
    try {
      check(r, n);
    } catch (e) {
      throw new Error(`${name} : cas n° ${n} (graine ${SEED}) : ${(e as Error).message}`);
    }
  }
}
async function fuzzAsync(name: string, cases: number, check: (r: Rng, n: number) => Promise<void>) {
  const r = mulberry32(SEED ^ hash(name));
  for (let n = 0; n < cases; n++) {
    try {
      await check(r, n);
    } catch (e) {
      throw new Error(`${name} : cas n° ${n} (graine ${SEED}) : ${(e as Error).message}`);
    }
  }
}
function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A calendar day that exists (2026-02-30 does not). */
const realDay = (s: unknown) => {
  if (typeof s !== 'string' || !DAY.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};
const isStr = (v: unknown): v is string => typeof v === 'string';
function assert(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(what);
}
function notPolluted() {
  assert(!('polluted' in Object.prototype) && ({} as { polluted?: unknown }).polluted === undefined, 'Object.prototype pollué');
}

/** One-slot localStorage: every key reads `raw`. */
function storageWith(raw: string | null): Storage {
  return {
    length: raw === null ? 0 : 1,
    key: () => null,
    getItem: () => raw,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('#359 fuzz : préférences relues de cet appareil', () => {
  it('brouillon de l\'alerte froid : null ou des champs bornés (days ∈ 1, 2, 3)', () => {
    fuzz('parseColdDraft', (r) => {
      const raw = r() < 0.5 ? anyValue(r) : { threshold: pick(r, NUMBERS), days: anyValue(r), rooms: anyValue(r) };
      const c = parseColdDraft(raw);
      if (c === null) return;
      assert(Number.isFinite(c.threshold) && c.threshold >= 5 && c.threshold <= 22, `seuil ${c.threshold}`);
      assert(COLD_DAYS.includes(c.days), `days ${String(c.days)}`);
      assert(Array.isArray(c.rooms) && c.rooms.every((x) => isStr(x) && x.length > 0 && x.length <= 64), 'pièces');
      assert(new Set(c.rooms).size === c.rooms.length, 'pièces en double');
    });
  });

  it('alerte froid partagée : null ou une configuration valide', () => {
    fuzz('parseColdConfig', (r) => {
      const c = parseColdConfig(r() < 0.5 ? anyValue(r) : { threshold: pick(r, NUMBERS), days: anyValue(r), rooms: anyValue(r) });
      if (c === null) return;
      assert(Number.isInteger(c.days) && c.days >= 1 && c.days <= 7, 'days');
      assert(c.rooms.length >= 1 && c.rooms.length <= COLD_MAX_ROOMS && c.rooms.every(isStr), 'pièces');
    });
  });

  it('recharge du véhicule : chaque champ du bon type et borné', () => {
    const powers = [2.3, 3.7, 7.4, 11];
    fuzz('parseEvInput', (r) => {
      const v = parseEvInput(r() < 0.5 ? anyValue(r) : { kwhWeek: anyValue(r), powerKw: anyValue(r), startHour: anyValue(r) }, powers);
      assert(typeof v.kwhWeek === 'number' && v.kwhWeek > 0 && v.kwhWeek <= 500, `kwhWeek ${v.kwhWeek}`);
      assert(powers.includes(v.powerKw), `powerKw ${v.powerKw}`);
      assert(Number.isInteger(v.startHour) && v.startHour >= 0 && v.startHour < 24, `startHour ${v.startHour}`);
    });
  });

  it('#428 #441 heures creuses saisies : des minutes entières bornées, début ≠ fin, une vraie date ou aucune, 8 plages au plus', () => {
    const m = (r: Rng) => (r() < 0.5 ? pick(r, [...NUMBERS, 0, 135, 465, 1439, 1440, 795]) : pick(r, ['02:15', '07:45', '23:59', '24:00', '7:45', '13:15', '13:60', ...STRINGS]));
    // #441: « à compter du », a real day or nothing (2026-02-30 and 2026-1-5 are among STRINGS)
    const since = (r: Rng) => (r() < 0.5 ? pick(r, ['2026-03-01', '2025-12-28', '2024-02-29', '2025-02-29', '', null, undefined]) : anyValue(r));
    fuzz('parseHcRanges', (r) => {
      const raw =
        r() < 0.4
          ? anyValue(r)
          : Array.from({ length: Math.floor(r() * 11) }, () => (r() < 0.7 ? (r() < 0.5 ? { from: m(r), to: m(r) } : { from: m(r), to: m(r), since: since(r) }) : anyValue(r)));
      const v = parseHcRanges(raw);
      assert(Array.isArray(v) && v.length <= MAX_RANGES, `longueur ${v.length}`);
      for (const x of v) {
        const keys = Object.keys(x).join();
        assert(keys === 'from,to' || keys === 'from,to,since', `clés ${keys}`);
        for (const k of [x.from, x.to]) assert(Number.isInteger(k) && k >= 0 && k < 1440, `minute ${k}`);
        assert(x.from !== x.to, 'début = fin');
        if (x.since !== undefined) {
          assert(typeof x.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.since), `date ${String(x.since)}`);
          assert(new Date(`${x.since}T00:00:00Z`).toISOString().slice(0, 10) === x.since, `date réelle ${x.since}`);
        }
      }
      const share = slotShares(v);
      assert(share.length === 48 && share.every((f) => f >= 0 && f <= 1), 'parts');
      // the periods: every range kept once, sorted by day, the undated one first
      const ps = periodsOfTyped(v);
      assert(ps.reduce((s, p) => s + p.ranges.length, 0) === v.length, 'plages perdues');
      for (let k = 1; k < ps.length; k++) assert(ps[k].since !== null && (ps[k - 1].since === null || ps[k - 1].since! < ps[k].since!), 'ordre des périodes');
      const o = resolveOffPeak(null, v);
      for (const day of ['1990-01-01', '2026-03-01', '2099-12-31']) assert(shareOn(o, day).length === 48, 'parts du jour');
      notPolluted();
    });
  });

  it('pompe à chaleur : chaque champ du bon type et borné', () => {
    const shares = [1, 0.75, 0.5];
    fuzz('parseHeatPumpInputs', (r) => {
      const v = parseHeatPumpInputs(r() < 0.5 ? anyValue(r) : { mode: anyValue(r), low: anyValue(r), high: anyValue(r), share: anyValue(r) }, shares);
      assert(v.mode === 'scop' || v.mode === 'curve', 'mode');
      for (const x of [v.low, v.high]) assert(typeof x === 'number' && x >= 1 && x <= 8, `COP ${x}`);
      assert(shares.includes(v.share), 'part');
    });
  });

  it('liens Home Assistant : des chaînes seulement, sans pollution', () => {
    fuzz('parseHaLinks', (r) => {
      const text = storedText(r);
      let v: unknown = null;
      try {
        v = JSON.parse(text ?? '{}');
      } catch {
        return; // the view catches it and falls back to {}
      }
      const links = parseHaLinks(v);
      assert(Object.getPrototypeOf(links) === Object.prototype, 'prototype remplacé');
      assert(Object.values(links).every(isStr), 'valeur non textuelle');
      notPolluted();
    });
  });

  it('votes de l\'analyse : mois → up | down', () => {
    fuzz('loadVotes', (r) => {
      const votes = loadVotes(storageWith(storedText(r)));
      for (const [k, x] of Object.entries(votes)) assert(/^\d{4}-\d{2}$/.test(k) && (x === 'up' || x === 'down'), `vote ${k}`);
      notPolluted();
    });
  });

  it('premier lancement : deux booléens', () => {
    fuzz('parseFlags', (r) => {
      const f = parseFlags(storedText(r), r() < 0.5);
      assert(typeof f.done === 'boolean' && typeof f.tip === 'boolean', 'drapeaux');
    });
  });

  it('mode locataire : jours valides et bail ordonné', () => {
    fuzz('parseTenant', (r) => {
      const t = parseTenant(r() < 0.5 ? anyValue(r) : { on: anyValue(r), leaseFrom: anyValue(r), leaseTo: anyValue(r) });
      assert(typeof t.on === 'boolean', 'on');
      assert(t.leaseFrom === null || DAY.test(t.leaseFrom), 'leaseFrom');
      assert(t.leaseTo === null || (DAY.test(t.leaseTo) && (!t.leaseFrom || t.leaseTo >= t.leaseFrom)), 'leaseTo');
    });
  });

  it('pièces arrêtées : une raison connue (pas « constructor »), un libellé ≤ 60', () => {
    fuzz('parseStopped', (r) => {
      const raw = r() < 0.5 ? anyValue(r) : Array.from({ length: 3 }, () => ({ room: pick(r, STRINGS), from: pick(r, STRINGS), reason: pick(r, STRINGS), label: anyValue(r) }));
      for (const s of parseStopped(raw)) {
        assert(Object.hasOwn(STOP_REASONS, s.reason), `raison ${s.reason}`);
        assert(isStr(s.room) && s.room.length > 0 && s.room.length <= 64 && DAY.test(s.from), 'pièce');
        assert(isStr(s.label) && s.label.length <= 60, 'libellé');
      }
    });
  });

  it('#366 bois du poêle : essence connue, jours réels, valeurs bornées, 60 achats au plus', () => {
    fuzz('parseWood', (r) => {
      const field = () => (r() < 0.2 ? anyValue(r) : r() < 0.2 ? pick(r, STRINGS) : r() < 0.5 ? 1 + Math.floor(r() * 50) : (r() - 0.3) * 10 ** Math.floor(r() * 6));
      const raw =
        r() < 0.3
          ? anyValue(r)
          : {
              purchases: Array.from({ length: Math.floor(r() * 70) }, () => ({ day: r() < 0.5 ? '2026-01-15' : pick(r, STRINGS), steres: field(), species: r() < 0.5 ? pick(r, ['chene', 'resineux']) : pick(r, STRINGS), moisture: field(), price: field() })),
              efficiency: field(),
              kwhPerStere: r() < 0.5 ? anyValue(r) : { chene: field(), [pick(r, KEYS)]: field() },
            };
      const w = parseWood(raw);
      assert(w.purchases.length <= MAX_PURCHASES, 'trop d’achats');
      for (const p of w.purchases) {
        assert(Object.hasOwn(SPECIES, p.species), `essence ${p.species}`);
        assert(DAY.test(p.day) && new Date(`${p.day}T00:00:00Z`).toISOString().startsWith(p.day), `jour ${p.day}`);
        assert(p.steres >= 0.1 && p.steres <= 100 && p.moisture >= 5 && p.moisture <= 60 && p.price >= 0 && p.price <= 100000, 'valeurs');
      }
      assert(w.efficiency >= 10 && w.efficiency <= 100, 'rendement');
      assert(Object.keys(w.kwhPerStere).every((k) => Object.hasOwn(SPECIES, k)) && Object.values(w.kwhPerStere).every((v) => v >= 500 && v <= 3000), 'kWh par stère');
    });
  });

  it('prises Shelly : noms ≤ 60 caractères, rôles main | water', () => {
    fuzz('readShellyPrefs', (r) => {
      vi.stubGlobal('localStorage', storageWith(storedText(r)));
      const p = readShellyPrefs();
      assert(Object.values(p.names).every((n) => isStr(n) && n.length > 0 && n.length <= 60), 'noms');
      assert(Object.values(p.roles).every((x) => x === 'main' || x === 'water'), 'rôles');
      notPolluted();
    });
  });

  it('#467 liaisons module ↔ pièce refusées : un ensemble de chaînes, jamais d’exception', () => {
    fuzz('declinedPairs', (r) => {
      const v = anyValue(r);
      const s = declinedPairs(Array.isArray(v) || r() < 0.5 ? v : [v, randomString(r)]);
      assert([...s].every(isStr), 'chaînes');
    });
  });

  it('soirs volets fermés : des jours triés, sans doublon', () => {
    fuzz('loadNotes', (r) => {
      vi.stubGlobal('localStorage', storageWith(storedText(r)));
      const days = loadNotes();
      assert(days.every((d) => DAY.test(d)), 'jour');
      assert(days.every((d, i) => i === 0 || days[i - 1] < d), 'ordre ou doublon');
    });
  });

  it('relevé des volets (#200) : document déchiffré quelconque, jamais d\'exception', () => {
    fuzz('volets', (r) => {
      const day = () => pick(r, ['2026-01-01', '2026-01-02', '2026-01-03', '__proto__', 'x', ...STRINGS]);
      const doc =
        r() < 0.5
          ? (anyValue(r) as VoletsDoc)
          : ({
              received: pick(r, ['2026-01-03', 5, null]),
              shutters: r() < 0.5 ? anyValue(r) : { v0: { name: anyValue(r, 2) }, __proto__: { name: 'x' } },
              days: Object.fromEntries(
                Array.from({ length: 4 }, () => [
                  day(),
                  r() < 0.3
                    ? anyValue(r)
                    : { evening: anyValue(r, 2), err: anyValue(r, 2), shutters: { v0: { close: anyValue(r, 2), at22: anyValue(r, 2), mean: anyValue(r, 2) } } },
                ]),
              ),
            } as unknown as VoletsDoc);
      const ev = evenings(doc, ['2026-01-02']);
      assert(ev.known === null || [...ev.known].every((d) => DAY.test(d)), 'soirs connus : des jours');
      assert([...ev.closed].every((d) => DAY.test(d) && (ev.known === null || ev.known.has(d))), 'soirs fermés connus');
      const names = shutterNames(doc);
      assert([...names.values()].every((n) => isStr(n) && n.length > 0), 'noms');
      for (const s of summarize(doc, '2026-01-03')) {
        assert(s.close === null || (Number.isInteger(s.close) && s.close >= 0 && s.close < 1440), 'heure');
        assert(s.mean === null || (s.mean >= 0 && s.mean <= 100), 'position');
        assert(s.closedAt22 <= s.knownAt22 && s.knownAt22 <= s.days, 'décomptes');
      }
      assert(recentFailures(doc, '2026-01-03').every(([d, m]) => DAY.test(d) && isStr(m)), 'échecs');
      notPolluted();
    });
  });

  it('marque « rester connecté » et raison du verrouillage : jamais d\'exception', () => {
    fuzz('readMark+lockNotice', (r) => {
      vi.stubGlobal('localStorage', storageWith(storedText(r)));
      const m = readMark();
      assert(m === null || (typeof m.at === 'number' && isStr(m.source)), 'marque');
      assert(isStr(lockNotice()), 'message');
    });
  });
});

describe('#359 fuzz : adresses, facture, CSV, enveloppes', () => {
  const ROUTE_WORDS = ['', '#', '#/', 'accueil', 'pieces', 'historique', 'compteur', 'outils', 'parametres', 'piece-', 'outils-', 'parametres-', 'compteur-', 'bienvenue', 'bienvenue-', 'expliquer-', '2026-01', '2026-13', 'constructor', '__proto__', 'toString', 'hasOwnProperty', '%', '%20', '%E2%82%AC', '\ud83d', '😀', ...Object.keys(TOOLS), ...Object.keys(SETTINGS), ...Object.keys(METER_PAGES), 'historique-', ...Object.keys(HISTORY_PAGES), '1', '5'];

  it('routes : null, ou une route connue que routeKey redonne à l\'identique', () => {
    fuzz('parseRoute', (r, n) => {
      const fixed = ['piece-\ud83d', 'piece-a%ED%A0%BD', 'parametres-constructor', 'outils-toString', 'compteur-__proto__', 'piece-%'];
      const hash = n < fixed.length ? fixed[n] : r() < 0.15 ? randomString(r) : Array.from({ length: 1 + Math.floor(r() * 4) }, () => pick(r, ROUTE_WORDS)).join('');
      const route = parseRoute(hash);
      if (route === null) return;
      if (route.page === 'outil') assert(Object.hasOwn(TOOLS, route.tool), `outil ${route.tool}`);
      if (route.page === 'parametres' && route.section !== null) assert(Object.hasOwn(SETTINGS, route.section), `section ${route.section}`);
      if (route.page === 'compteur-detail') assert(Object.hasOwn(METER_PAGES, route.sub), `page ${route.sub}`);
      if (route.page === 'historique-detail') assert(Object.hasOwn(HISTORY_PAGES, route.sub), `page ${route.sub}`);
      const key = routeKey(route); // must not throw (half a UTF-16 pair: encodeURIComponent throws)
      expect(parseRoute(key)).toEqual(route);
    });
  });

  it('invitation : null, ou une adresse https (ou locale) sans identifiants, requête ni autre fragment', () => {
    const PARTS = ['https://', 'http://', 'javascript:', 'data:', 'file:///', 'user:pass@', 'opaland.github.io', 'localhost', '127.0.0.1', 'evil.example', ':8080', '/Netatmo/', '/', '?code=secret', '#cle', '#installer', '@', '%40', '\\', ' '];
    fuzz('inviteUrl', (r) => {
      const href = r() < 0.1 ? randomString(r) : Array.from({ length: 1 + Math.floor(r() * 6) }, () => pick(r, PARTS)).join('');
      const out = inviteUrl(href);
      if (out === null) return;
      const u = new URL(out);
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      assert(u.protocol === 'https:' || (local && u.protocol === 'http:'), `protocole ${u.protocol}`);
      assert(!u.username && !u.password && !u.search && u.hash === INSTALL_HASH, `adresse ${out}`);
    });
  });

  it('cellules CSV : jamais de formule en tête, et untextCell redonne le texte', () => {
    fuzz('textCell', (r) => {
      const s = r() < 0.5 ? pick(r, STRINGS) + randomString(r) : randomString(r);
      const sep = r() < 0.5 ? ',' : ';';
      const cell = textCell(s, sep);
      const inner = cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
      assert(!/^[=+\-@\t\r]/.test(inner), `formule en tête : ${JSON.stringify(inner.slice(0, 20))}`);
      assert(untextCell(inner) === s, 'aller-retour');
    });
  });

  it('notes du collecteur (#406) : plus aucun « (s) » après un mot, le reste intact, sans exception', () => {
    fuzz('agreePlurals', (r) => {
      const words = ['module(s)', 'injoignable(s)', '2', '1', '0', '12 345', 'prise(s)', '(s)', 'mot(x)', ' ', ', ', 'é(s)'];
      const s = r() < 0.5 ? Array.from({ length: 1 + Math.floor(r() * 8) }, () => pick(r, words)).join(' ') : randomString(r);
      const out = agreePlurals(s);
      assert(typeof out === 'string', 'une chaîne');
      assert(!/[\p{L}'’-]\((s|x)\)/u.test(out), `reste un « (s) » : ${JSON.stringify(out.slice(0, 60))}`);
      assert(out.replace(/[sx]/g, '') === s.replace(/[\p{L}'’-]\((s|x)\)/gu, (m) => m.slice(0, -3)).replace(/[sx]/g, ''), 'seuls les « (s) » changent');
    });
  });

  it('facture : null, ou des montants finis et des jours qui existent', () => {
    fuzz('validInvoice', (r) => {
      const raw = r() < 0.3 ? anyValue(r) : { from: pick(r, STRINGS), to: pick(r, STRINGS), amount: anyValue(r), kwh: anyValue(r), subscription: anyValue(r), estimated: anyValue(r) };
      const inv = validInvoice(raw);
      if (inv === null) return;
      assert(realDay(inv.from) && realDay(inv.to) && inv.from <= inv.to, `période ${inv.from} → ${inv.to}`);
      assert(Number.isFinite(inv.amount) && inv.amount >= 0, 'montant');
      assert(inv.kwh === null || (Number.isFinite(inv.kwh) && inv.kwh >= 0), 'kWh');
      assert(typeof inv.subscription === 'boolean' && typeof inv.estimated === 'boolean', 'booléens');
    });
  });

  it('enveloppe chiffrée : refusée par BadEnvelope, jamais une autre exception', () => {
    fuzz('checkEnvelope', (r) => {
      const env = r() < 0.5 ? anyValue(r) : { v: pick(r, [1, 2, '1', null]), kdf: pick(r, ['PBKDF2-SHA256', 'scrypt', 1]), iter: pick(r, NUMBERS), salt: anyValue(r), iv: anyValue(r), ct: anyValue(r) };
      try {
        checkEnvelope(env as never);
      } catch (e) {
        assert(e instanceof BadEnvelope, `exception ${(e as Error).name}`);
      }
    });
  });

  it('note privée illisible (autre clé, texte forgé) : la valeur de repli, sans exception', async () => {
    const key = await crypto.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const B64 = ['', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '!!!', '=', 'abcd'];
    await fuzzAsync('loadNote', CASES, async (r) => {
      const raw = r() < 0.5 ? storedText(r) : JSON.stringify({ iv: r() < 0.5 ? pick(r, B64) : anyValue(r), ct: r() < 0.5 ? pick(r, B64) : anyValue(r) });
      vi.stubGlobal('localStorage', storageWith(raw));
      const fallback: object = { repli: true };
      const v = await loadNote<object>('fuzz', 'demo', key, () => ({ lu: true }), fallback);
      assert(v === fallback, 'une note forgée a été lue');
    });
  });
});

describe('#204 #356 fuzz : localisation et profil solaire', () => {
  const roof = (r: Rng) => ({ name: anyValue(r), azimuth: pick(r, NUMBERS), tilt: pick(r, NUMBERS), kwc: pick(r, NUMBERS), loss: pick(r, NUMBERS) });
  const CONTROL = /[\u0000-\u001f\u007f]/;
  it('localisation : null, ou des coordonnées et des toits bornés, relus à l’identique', () => {
    fuzz('parseLocation', (r) => {
      const raw =
        r() < 0.3
          ? anyValue(r)
          : {
              v: r() < 0.8 ? 1 : anyValue(r),
              lat: pick(r, NUMBERS),
              lon: pick(r, NUMBERS),
              precision: r() < 0.7 ? pick(r, [1, 2, 3]) : anyValue(r),
              commune: r() < 0.5 ? pick(r, STRINGS) : anyValue(r),
              roofs: r() < 0.8 ? Array.from({ length: Math.floor(r() * 8) }, () => roof(r)) : anyValue(r),
            };
      const l = parseLocation(raw);
      notPolluted();
      if (l === null) return;
      assert(Math.abs(l.lat) <= 90 && Math.abs(l.lon) <= 180, 'coordonnées');
      assert([1, 2, 3].includes(l.precision), 'précision');
      assert(isStr(l.commune) && Array.from(l.commune).length <= 60 && !CONTROL.test(l.commune), 'commune');
      assert(l.roofs.length >= 1 && l.roofs.length <= MAX_ROOFS, 'toits');
      for (const t of l.roofs)
        assert(t.name.length > 0 && !CONTROL.test(t.name) && t.azimuth >= 0 && t.azimuth < 360 && t.tilt >= 0 && t.tilt <= 90 && t.kwc > 0 && t.kwc <= 36 && t.loss >= 0 && t.loss <= 60, 'toit hors bornes');
      assert(JSON.stringify(parseLocation(JSON.parse(JSON.stringify(l)))) === JSON.stringify(l), 'relecture différente');
    });
  });
  it('#462 brouillon de localisation relu : null, ou des champs texte bornés, un à six toits, relus à l’identique', () => {
    fuzz('parseLocationDraft', (r) => {
      const raw =
        r() < 0.3
          ? anyValue(r)
          : {
              commune: anyValue(r),
              lat: r() < 0.5 ? pick(r, STRINGS) : anyValue(r),
              lon: r() < 0.5 ? pick(r, STRINGS) : anyValue(r),
              precision: r() < 0.5 ? pick(r, ['1', '2', '3', 3, '4', '__proto__']) : anyValue(r),
              roofs: r() < 0.8 ? Array.from({ length: Math.floor(r() * 9) }, () => (r() < 0.8 ? roof(r) : anyValue(r))) : anyValue(r),
            };
      const t = parseLocationDraft(raw);
      notPolluted();
      if (t === null) return;
      assert(['1', '2', '3'].includes(t.precision), 'précision');
      for (const s of [t.commune, t.lat, t.lon]) assert(isStr(s) && Array.from(s).length <= 60, 'champ');
      assert(t.roofs.length >= 1 && t.roofs.length <= MAX_ROOFS, 'toits');
      for (const x of t.roofs) {
        assert(Object.keys(x).join() === ROOF_FIELDS.join(), 'champs du toit');
        for (const k of ROOF_FIELDS) assert(isStr(x[k]) && Array.from(x[k]).length <= 40, k);
      }
      assert(JSON.stringify(parseLocationDraft(JSON.parse(JSON.stringify(t)))) === JSON.stringify(t), 'relecture différente');
    });
  });
  it('document solaire déchiffré : null ou des heures bornées, jamais d’exception', () => {
    fuzz('parseSolarDoc', (r) => {
      const hours: Record<string, unknown> = {};
      if (r() < 0.5)
        for (let i = 0; i < 310; i++) hours[`${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + Math.floor(i / 12)).padStart(2, '0')}`] = r() < 0.98 ? new Array(24).fill(pick(r, NUMBERS)) : anyValue(r);
      const doc = parseSolarDoc(r() < 0.3 ? anyValue(r) : { source: pick(r, ['pvgis', 'import', 'demo', 'x', '__proto__']), year: anyValue(r), roofs: [{ name: anyValue(r), kwc: pick(r, NUMBERS), hours: r() < 0.7 ? hours : anyValue(r) }] });
      notPolluted();
      if (!doc) return;
      for (const t of doc.roofs) for (const row of Object.values(t.hours)) assert(row.length === 24 && row.every((x) => Number.isFinite(x) && x >= 0 && x <= 1500), 'heure hors bornes');
    });
  });
  it('fichier PVGIS : une erreur en français ou un profil fini, sans les coordonnées', () => {
    fuzz('parsePvgisFile', (r) => {
      const lines = Array.from({ length: Math.floor(r() * 30) }, () =>
        r() < 0.5 ? `2023${pick(r, ['0101', '0229', '1301', '0621'])}:${pick(r, ['00', '12', '24', '99'])}10,${pick(r, NUMBERS)},0` : randomString(r),
      );
      const text = r() < 0.2 ? anyValue(r) : r() < 0.5 ? storedText(r) : ['Latitude (decimal degrees):\t45.76', `Nominal power of the PV system (c-Si) (kWp):\t${pick(r, NUMBERS)}`, ...lines].join('\n');
      const out = parsePvgisFile(text);
      notPolluted();
      if ('error' in out) return assert(isStr(out.error) && out.error.length > 0, 'message');
      assert(!JSON.stringify(out).includes('45.76'), 'coordonnée gardée');
      for (const row of Object.values(out.roof.hours)) assert(row.every((x) => Number.isFinite(x) && x >= 0), 'heure');
    });
  });
  it('hypothèses du simulateur : chaque champ null ou dans ses bornes', () => {
    fuzz('parseSolarInputs', (r) => {
      const v = parseSolarInputs(r() < 0.3 ? anyValue(r) : Object.fromEntries(INPUT_FIELDS.map(([k]) => [k, r() < 0.5 ? pick(r, NUMBERS) : anyValue(r)])));
      notPolluted();
      for (const [k, , min, max] of INPUT_FIELDS) {
        const x = v[k];
        assert(x === null || (Number.isFinite(x) && x >= min && x <= max), k);
      }
      assert(Object.keys(v).length === INPUT_FIELDS.length, 'clé en trop');
    });
  });
});

describe('#359 défauts trouvés par le fuzz, gardés comme exemples', () => {
  it('une route « constructor » ou « hasOwnProperty » est inconnue', () => {
    for (const h of ['#parametres-constructor', '#outils-toString', '#compteur-hasOwnProperty', '#compteur-__proto__']) expect(parseRoute(h)).toBeNull();
    expect(parseRoute('#piece-\ud83d')).toBeNull();
  });
  it('une facture du 30 février est refusée', () => {
    const ok = { from: '2026-01-01', to: '2026-01-31', amount: 80 };
    expect(validInvoice(ok)).not.toBeNull();
    expect(validInvoice({ ...ok, to: '2026-02-30' })).toBeNull();
    expect(validInvoice({ ...ok, from: '2026-13-01' })).toBeNull();
  });
  it("une raison d'arrêt « constructor » devient « autre »", () => {
    expect(parseStopped([{ room: 'r1', from: '2026-01-01', reason: 'constructor' }])[0].reason).toBe('autre');
  });
  it("le brouillon de l'alerte froid ne reprend pas un nombre de jours en texte", () => {
    expect(parseColdDraft({ threshold: 14, days: '2', rooms: ['r1'] })?.days).toBe(1);
    expect(parseColdDraft({ threshold: 14, days: 3, rooms: ['r1', 'r1', 5] })).toEqual({ threshold: 14, days: 3, rooms: ['r1'] });
  });
  it("un seuil d'alerte froid en objet (« toString » à soi) ne fait pas planter la lecture", () => {
    expect(parseColdConfig({ threshold: { toString: 1 }, rooms: ['r1'] })).toBeNull();
    expect(parseColdConfig({ threshold: '14', rooms: ['r1'] })).toEqual({ threshold: 14, days: 1, rooms: ['r1'] });
  });
});
