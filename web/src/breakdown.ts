// S-4.12 / S-1.17: what the "other usages" of the Linky meter are made of. Pure, no DOM.
//
// rest = Linky − heating − water heater (same days). It is split into
// - plugs measured by Shelly smart plugs (daily kWh from the collector, shelly.enc.json);
// - appliances declared by hand (name, W, hours per day);
// - the standby base load (talon, from the 30-min curve) not already explained by an
//   appliance that runs around the clock (a fridge on a plug, a box declared at 24 h/day);
// - what remains unexplained (cooking, lighting, short uses…).
// Approximations, said in the card: a fridge cycles, so its average power is only roughly
// what it adds to the night base load.
import { type ShellyPrefs, readShellyPrefs } from './shelly-prefs';

export interface ShellyDoc {
  // S-1.30: `channels` on a clamp meter (its series are the channel keys pNcM, with `parent`)
  plugs?: Record<string, { name: string; model?: string; gen?: string; usable?: boolean; channels?: number; parent?: string; channel?: string }>;
  daily?: Record<string, Record<string, number>>; // plug -> day -> Wh
  estimated?: Record<string, Record<string, number>>;
  until?: Record<string, string>; // days before are complete
}

export interface Declared {
  name: string;
  watts: number;
  hours: number; // per day, 24 = always on (part of the standby base load)
}

export interface Plug {
  key: string;
  name: string;
  daily: Map<string, number>; // day -> kWh, complete days only
}

export interface Part {
  name: string;
  kind: 'plug' | 'declared' | 'talon' | 'unexplained';
  kwh: number; // over the window
  watts: number; // average power over the window
  permanent: boolean; // runs around the clock (counted inside the talon)
  measuredDays?: number; // plugs: days actually measured in the window
}

export interface Breakdown {
  days: string[];
  linky: number;
  heating: number;
  water: number;
  rest: number;
  parts: Part[];
  talonWatts: number | null; // gross standby base load from the curve
  over: number; // kWh by which plugs + declared + talon exceed the rest (0 when consistent)
}

const PERMANENT_CV = 0.3; // daily kWh this steady (coefficient of variation) = always-on appliance

/** Plugs of the collector's document: usable ones, complete days only, kWh. */
export function plugsFrom(doc: ShellyDoc | null | undefined, prefs: ShellyPrefs = readShellyPrefs()): { plugs: Plug[]; unusable: string[] } {
  const plugs: Plug[] = [];
  const unusable: string[] = [];
  for (const [key, p] of Object.entries(doc?.plugs ?? {})) {
    const name = prefs.names[key] ?? p.name;
    if (p.usable === false) {
      unusable.push(name);
      continue;
    }
    // A clamp meter is read channel by channel; a channel on the main supply or on the water
    // heater (already counted by Intuis) is not an "other usage".
    if (p.channels || prefs.roles[key]) continue;
    const until = doc?.until?.[key] ?? '9999-12-31';
    const daily = new Map<string, number>();
    for (const [d, wh] of Object.entries(doc?.daily?.[key] ?? {})) if (d < until) daily.set(d, wh / 1000);
    if (daily.size) plugs.push({ key, name, daily });
  }
  return { plugs, unusable };
}

/** Last `n` days with a Linky value, up to `last` (the last day of the radiator data). */
export function windowDays(linky: Map<string, number>, last: string, n = 30): string[] {
  return [...linky.keys()]
    .filter((d) => d <= last)
    .sort()
    .slice(-n);
}

function steady(values: number[]): boolean {
  if (values.length < 5 || values.some((v) => v <= 0)) return false;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return sd / mean < PERMANENT_CV;
}

export function breakdown(opts: {
  days: string[];
  linky: Map<string, number>; // kWh
  heating: Map<string, number>; // kWh per day
  water: Map<string, number>;
  plugs: Plug[];
  declared: Declared[];
  talonWatts: number | null;
}): Breakdown {
  const n = opts.days.length;
  const sum = (m: Map<string, number>) => opts.days.reduce((s, d) => s + (m.get(d) ?? 0), 0);
  const linky = sum(opts.linky);
  const heating = sum(opts.heating);
  const water = sum(opts.water);
  const rest = Math.max(0, linky - heating - water);
  const hours = n * 24;
  const parts: Part[] = [];
  for (const p of opts.plugs) {
    const vals = opts.days.filter((d) => p.daily.has(d)).map((d) => p.daily.get(d)!);
    if (!vals.length) continue;
    const kwh = (vals.reduce((s, v) => s + v, 0) / vals.length) * n; // missing days at the plug's mean
    parts.push({ name: p.name, kind: 'plug', kwh, watts: (kwh * 1000) / hours, permanent: steady(vals), measuredDays: vals.length });
  }
  for (const d of opts.declared) {
    const h = Math.min(24, Math.max(0, d.hours));
    const kwh = (d.watts * h * n) / 1000;
    parts.push({ name: d.name, kind: 'declared', kwh, watts: (kwh * 1000) / hours, permanent: h >= 24 });
  }
  if (opts.talonWatts !== null && n) {
    const always = parts.filter((p) => p.permanent).reduce((s, p) => s + p.watts, 0);
    const watts = Math.max(0, opts.talonWatts - always);
    parts.push({ name: 'Veille', kind: 'talon', watts, kwh: (watts * hours) / 1000, permanent: true });
  }
  const explained = parts.reduce((s, p) => s + p.kwh, 0);
  const left = rest - explained;
  if (n) parts.push({ name: 'Non attribué', kind: 'unexplained', kwh: Math.max(0, left), watts: (Math.max(0, left) * 1000) / hours, permanent: false });
  return { days: opts.days, linky, heating, water, rest, parts, talonWatts: opts.talonWatts, over: Math.max(0, -left) };
}

/** kWh per year of a constant power. */
export const kwhPerYear = (watts: number) => (watts * 8760) / 1000;

/** Validated appliance typed by the user, or an error message. */
export function parseDeclared(name: string, watts: string, hours: string): Declared | string {
  const n = name.trim().slice(0, 40);
  const w = Number(watts.replace(',', '.'));
  const h = Number(hours.replace(',', '.'));
  if (!n) return 'Nom du poste manquant.';
  if (!Number.isFinite(w) || w <= 0 || w > 10000) return 'Puissance entre 0 et 10 000 W.';
  if (!Number.isFinite(h) || h <= 0 || h > 24) return 'Durée entre 0 et 24 h par jour.';
  return { name: n, watts: w, hours: h };
}
