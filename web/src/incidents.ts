// #280 (S-1.31): the incident log of « État des données ». Pure functions, no DOM.
//
// Sources, all already collected (collector/devices.py, collector/station.py):
//   - devices.gateway.offline: local hours when every Intuis module was out of reach at once;
//   - devices.gateway.boots: restarts of the Intuis gateway (inferred from its uptime);
//   - devices.reach: nightly status of each Intuis module (radiators, water heater, relays);
//   - station.health: nightly [battery %, signal, answering] of each station module;
//   - devices.failures: the sources whose collection failed, per night.
// Cross-checks (#280): hours cut off ending with a restart of the gateway = power cut; cut off
// without a restart = Internet cut; a restart alone = a power cut shorter than the hour between two
// readings. Rooms whose radiator was switched off on purpose (#346) are left out from their date.
import { addDays } from './aggregate';
import { plural } from './glossary';
import type { CutKind } from './periods';
export type { CutKind };
import { type DevicesDoc, LOW_BATTERY, type StationHealth, typeLabel } from './devices';
import { stoppedOn } from './room-offline';

export type IncidentKind = 'power' | 'internet' | 'module' | 'station' | 'battery' | 'collect';

export interface Incident {
  kind: IncidentKind;
  /** First day (YYYY-MM-DD) and, for the cuts, the local start « YYYY-MM-DDTHH:MM ». */
  day: string;
  at?: string;
  /** Last day of a run of days (modules, station), when longer than one day. */
  to?: string;
  /** Duration: hours for the cuts (null: under an hour, between two readings), days otherwise. */
  hours?: number | null;
  days?: number;
  ongoing?: boolean;
  /** Short label (« Coupure de courant », « Radiateur Salon injoignable »). */
  label: string;
  /** Where it is known from. */
  source: string;
}

export const KIND_LABEL: Record<IncidentKind, string> = {
  power: 'coupure de courant',
  internet: 'coupure Internet',
  module: 'appareil Intuis injoignable',
  station: 'module de la station muet',
  battery: 'pile faible',
  collect: 'collecte en échec',
};
export const KIND_ICON: Record<IncidentKind, string> = { power: '⚡', internet: '🌐', module: '📡', station: '📡', battery: '🔋', collect: '⚠' };

export interface IncidentInput {
  devices?: DevicesDoc | null;
  health?: StationHealth | null;
  stationModules?: Record<string, { name: string; type: string }>;
  rooms?: { id: string; name: string }[];
  /** #346: rooms switched off on purpose, from that day. */
  stopped?: { room: string; from: string }[];
  /** Names of the sources (Intuis, Linky…), by collector id. */
  sourceName?: Record<string, string>;
  last: string;
}

const hourAdd = (h: string, n: number) => {
  const d = new Date(`${h.slice(0, 10)}T00:00:00Z`);
  d.setUTCHours(Number(h.slice(11, 13)) + n);
  return d.toISOString().slice(0, 13);
};

/** Runs of consecutive local hours ("YYYY-MM-DDTHH"), as [first, last]. */
export function hourRuns(hours: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (const h of [...new Set(hours)].sort()) {
    const cur = out[out.length - 1];
    if (cur && hourAdd(cur[1], 1) === h) cur[1] = h;
    else out.push([h, h]);
  }
  return out;
}

/** Runs of consecutive days where `bad(day)` holds, from a day → value map. */
function dayRuns<T>(days: Record<string, T>, bad: (v: T, day: string) => boolean): [string, string][] {
  const out: [string, string][] = [];
  for (const d of Object.keys(days).sort()) {
    if (!bad(days[d], d)) continue;
    const cur = out[out.length - 1];
    if (cur && addDays(cur[1], 1) === d) cur[1] = d;
    else out.push([d, d]);
  }
  return out;
}

const spanDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;

/** Every incident, newest first. */
export function incidents(input: IncidentInput): Incident[] {
  const doc = input.devices ?? {};
  const out: Incident[] = [];
  // cuts: power (with a restart of the gateway) or Internet (without)
  const boots = [...(doc.gateway?.boots ?? [])].sort().slice(1); // the first one: start before monitoring
  const used = new Set<string>();
  for (const [a, b] of hourRuns(doc.gateway?.offline ?? [])) {
    const end = hourAdd(b, 1); // the cut lasts until the next reading at most
    const boot = boots.find((x) => x.slice(0, 13) >= a && x.slice(0, 13) <= end);
    const n = (Date.parse(`${hourAdd(b, 1)}:00Z`) - Date.parse(`${a}:00Z`)) / 3600000;
    if (boot) {
      used.add(boot);
      out.push({ kind: 'power', day: a.slice(0, 10), at: `${a}:00`, hours: n, label: 'Coupure de courant', source: `maison injoignable, puis redémarrage de la passerelle Intuis (${boot.slice(11)})` });
    } else {
      out.push({ kind: 'internet', day: a.slice(0, 10), at: `${a}:00`, hours: n, label: 'Coupure Internet', source: 'maison injoignable sans redémarrage de la passerelle Intuis' });
    }
  }
  for (const boot of boots) {
    if (used.has(boot)) continue;
    out.push({ kind: 'power', day: boot.slice(0, 10), at: boot, hours: null, label: 'Coupure de courant', source: 'redémarrage de la passerelle Intuis' });
  }
  // Intuis modules out of reach, except the gateway (counted above) and the rooms stopped on purpose
  const roomName = (id?: string) => input.rooms?.find((r) => r.id === id)?.name;
  for (const [key, days] of Object.entries(doc.reach ?? {})) {
    const m = doc.modules?.[key];
    if (m?.type === 'NMG' || /^m\d+$/.test(key)) continue;
    const sorted = Object.keys(days).sort();
    for (const [a, b] of dayRuns(days, (v, d) => v === 0 && !stoppedOn(input.stopped, m?.room, d))) {
      const name = roomName(m?.room);
      const what = typeLabel(m?.type);
      out.push({
        kind: 'module',
        day: a,
        to: b,
        days: spanDays(a, b),
        ongoing: b === sorted[sorted.length - 1] && b >= addDays(input.last, -1),
        label: `${what.charAt(0).toUpperCase()}${what.slice(1)}${name ? ` ${name}` : ''} injoignable`,
        source: 'relevé de nuit Intuis',
      });
    }
  }
  // station: silent modules and low batteries
  for (const [key, days] of Object.entries(input.health ?? {})) {
    const mod = input.stationModules?.[key];
    const name = mod ? `« ${mod.name} »` : typeLabel();
    const sorted = Object.keys(days).sort();
    const lastDay = sorted[sorted.length - 1];
    for (const [a, b] of dayRuns(days, (v) => v[2] === 0)) {
      out.push({ kind: 'station', day: a, to: b, days: spanDays(a, b), ongoing: b === lastDay && b >= addDays(input.last, -1), label: `Module ${name} de la station muet`, source: 'station Netatmo' });
    }
    for (const [a, b] of dayRuns(days, (v) => v[0] !== null && v[0] < LOW_BATTERY)) {
      const pct = days[b][0];
      out.push({ kind: 'battery', day: a, to: b, days: spanDays(a, b), ongoing: b === lastDay, label: `Pile faible : module ${name} (${pct} %)`, source: 'station Netatmo' });
    }
  }
  // collections that failed
  for (const [day, sources] of Object.entries(doc.failures ?? {})) {
    if (!sources.length) continue;
    const names = sources.map((s) => input.sourceName?.[s] ?? s);
    out.push({ kind: 'collect', day, label: `Collecte en échec : ${names.join(', ')}`, source: 'collecte de la nuit' });
  }
  return out.sort((x, y) => (x.at ?? x.day) < (y.at ?? y.day) ? 1 : (x.at ?? x.day) > (y.at ?? y.day) ? -1 : x.kind.localeCompare(y.kind));
}

export interface MonthIncidents {
  month: string; // YYYY-MM
  events: Incident[]; // newest first
  power: number;
  internetHours: number;
  moduleDays: number; // days with at least one Intuis or station module silent, in the month
  failures: number;
}

/** Incidents grouped by month (of their first day), newest month first; `months` at most. */
export function byMonth(list: Incident[], months = 12): MonthIncidents[] {
  const map = new Map<string, MonthIncidents>();
  for (const e of list) {
    const month = e.day.slice(0, 7);
    const m = map.get(month) ?? map.set(month, { month, events: [], power: 0, internetHours: 0, moduleDays: 0, failures: 0 }).get(month)!;
    m.events.push(e);
  }
  for (const m of map.values()) {
    m.power = m.events.filter((e) => e.kind === 'power').length;
    m.internetHours = m.events.filter((e) => e.kind === 'internet').reduce((s, e) => s + (e.hours ?? 0), 0);
    m.failures = m.events.filter((e) => e.kind === 'collect').length;
    const silent = new Set<string>();
    for (const e of m.events) {
      if (e.kind !== 'module' && e.kind !== 'station') continue;
      for (let d = e.day; d <= (e.to ?? e.day) && d.startsWith(m.month); d = addDays(d, 1)) silent.add(d);
    }
    m.moduleDays = silent.size;
  }
  return [...map.values()].sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, months);
}


/** « 1 coupure de courant, 3 h sans Internet, 2 jours avec un module muet » ('' when nothing). */
export function monthSummary(m: MonthIncidents): string {
  const parts: string[] = [];
  if (m.power) parts.push(plural(m.power, 'coupure de courant', 'coupures de courant'));
  if (m.internetHours) parts.push(`${m.internetHours} h sans Internet`);
  if (m.moduleDays) parts.push(`${plural(m.moduleDays, 'jour', 'jours')} avec un module muet`);
  if (m.failures) parts.push(plural(m.failures, 'collecte en échec', 'collectes en échec'));
  const batteries = m.events.filter((e) => e.kind === 'battery').length;
  if (batteries) parts.push(plural(batteries, 'pile faible', 'piles faibles'));
  return parts.join(', ');
}

/** Simple mode: one sentence about the month of `last` (« 2 coupures de courant ce mois-ci »). */
export function simpleSentence(months: MonthIncidents[], last: string): string {
  const m = months.find((x) => x.month === last.slice(0, 7));
  const s = m ? monthSummary(m) : '';
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)} ce mois-ci.` : 'Aucun incident ce mois-ci.';
}

/** Days touched by a cut (power or Internet), for the causes of the gaps (data-quality.ts). */
export function cutDays(list: Incident[], kind: 'power' | 'internet'): string[] {
  return [...new Set(list.filter((e) => e.kind === kind).map((e) => e.day))].sort();
}

export const CUT_ICON: Record<CutKind, string> = { power: KIND_ICON.power, internet: KIND_ICON.internet };

/**
 * #394: every day touched by a power or Internet cut, with its probable cause (a power cut wins
 * when both touch the same day). A cut that runs past midnight touches both days. Such a day does
 * not measure the household's habits: it is marked on the consumption charts and never judged
 * « économe » (unusual days, absences, signature, « Expliquer un mois »).
 */
export function cutCauses(list: Incident[]): Map<string, CutKind> {
  const out = new Map<string, CutKind>();
  for (const e of list) {
    if (e.kind !== 'power' && e.kind !== 'internet') continue;
    const end = e.at && e.hours ? hourAdd(e.at.slice(0, 13), e.hours - 1).slice(0, 10) : e.day;
    for (let d = e.day; d <= end; d = addDays(d, 1)) if (out.get(d) !== 'power') out.set(d, e.kind);
  }
  return out;
}

/** The cut days of a devices document: only its gateway is read (no module, station nor stopped room). */
export const cutCausesOf = (devices: DevicesDoc | null | undefined): Map<string, CutKind> =>
  cutCauses(incidents({ devices: { gateway: devices?.gateway }, last: '0000-01-01' }));
