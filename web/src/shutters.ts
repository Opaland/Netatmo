// S-9.6: evenings with the shutters closed, noted by hand on this device, and the
// comparison that makes the S-9.0 measurement possible: night heating with / without
// closed shutters, as a gap to the night signature, with its uncertainty.
// Pure functions except the two storage helpers (localStorage, never sent anywhere).
import { addDays } from './aggregate';
import { type Fit, type Hourly, type Weather, linearFit } from './analysis';
import { lsKey } from './scope';

const LS_KEY = lsKey('shutters');
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Evenings noted « volets fermés » on this device, sorted. */
export function loadNotes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
    return Array.isArray(v) ? [...new Set(v.filter((d): d is string => typeof d === 'string' && DAY.test(d)))].sort() : [];
  } catch {
    return [];
  }
}

export function saveNotes(days: Iterable<string>): string[] {
  const list = [...new Set([...days].filter((d) => DAY.test(d)))].sort();
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: kept for this visit only */
  }
  return list;
}

/** CSV export (`;` separator, for Excel), one line per noted evening. */
export function notesCsv(days: string[]): string {
  return ['date;volets_fermes', ...days.map((d) => `${d};1`)].join('\r\n') + '\r\n';
}

/** Dates found in an exported CSV (or any text: one YYYY-MM-DD per line, value 0 drops it). */
export function parseNotesCsv(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*"?(\d{4}-\d{2}-\d{2})"?\s*(?:[;,]\s*"?(\w+)"?)?/);
    if (m && !['0', 'non', 'false'].includes((m[2] ?? '1').toLowerCase())) out.push(m[1]);
  }
  return [...new Set(out)].sort();
}

// ------------------------------------------------------------------ comparison
// ------------------------------------------------------------------ automatic readings (#200)
/** One shutter on one day (volets.enc.json, collector/volets.py). */
export interface ShutterDay {
  open?: string; // HH:MM, first opening (from closed) before noon
  close?: string; // HH:MM, last closing (to closed) after noon
  close_src?: string;
  mean?: number; // mean position 0-100 (100 = open)
  at22?: number | null; // position at 22 h, null when unknown
  moves?: number;
}
export interface VoletsDay {
  cov?: number[]; // successful readings per local hour
  ko?: number;
  err?: string[];
  shutters?: Record<string, ShutterDay>;
  evening?: [number, number]; // shutters closed at 22 h, shutters known at 22 h
}
export interface VoletsDoc {
  shutters?: Record<string, { name?: string }>;
  days?: Record<string, VoletsDay>;
  received?: string;
}

/** What the NAS reported instead of readings (codes of collector/volets.py). */
export const VOLETS_ERRORS: Record<string, string> = {
  hub_injoignable: 'passerelle injoignable depuis le NAS',
  secret_refuse: 'secret de la passerelle refusé',
  http_erreur: 'réponse inattendue de la passerelle',
  reponse_illisible: 'réponse illisible de la passerelle',
  aucun_volet: 'aucun volet dans la réponse de la passerelle',
  aucun_releve: 'aucun relevé ce jour-là',
  journal_trop_gros: 'journal trop gros pour être envoyé',
  certificat_absent: 'certificat absent sur le NAS',
  chiffrement_impossible: 'chiffrement impossible sur le NAS',
};

// The decrypted document is read defensively: any shape that is not the expected one is ignored.
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** [day, record] of the real days of the document. */
function dayEntries(doc: VoletsDoc | null): [string, VoletsDay][] {
  const days = isObj(doc) ? doc.days : undefined;
  return isObj(days) ? (Object.entries(days).filter(([d, v]) => DAY.test(d) && isObj(v)) as [string, VoletsDay][]) : [];
}
const shutterOf = (v: VoletsDay, key: string): ShutterDay | null => {
  const sh = v.shutters;
  return isObj(sh) && Object.hasOwn(sh, key) && isObj(sh[key]) ? (sh[key] as ShutterDay) : null;
};

export interface Evenings {
  known: Set<string> | null; // evenings whose state is known (null: no readings, every evening counts)
  closed: Set<string>;
  auto: number; // evenings known from the readings
}

/**
 * Evenings for the comparison. Without readings: the notes, as before (an evening not noted
 * counts as open). With readings (#200), only KNOWN evenings count: an evening read at 22 h is
 * « fermé » when every shutter read was closed (position 0) and open otherwise, and the
 * reading replaces the note of that evening; an evening without reading keeps its note
 * (closed); an evening with neither is left out, never guessed.
 */
export function evenings(doc: VoletsDoc | null, notes: Iterable<string>): Evenings {
  const noted = new Set(notes);
  const read = dayEntries(doc).filter(([, v]) => isEvening(v.evening));
  if (!read.length) return { known: null, closed: noted, auto: 0 };
  const known = new Set<string>();
  const closed = new Set<string>();
  for (const [d, v] of read) {
    const [c, n] = v.evening!;
    known.add(d);
    if (c === n) closed.add(d);
  }
  for (const d of noted) {
    if (known.has(d)) continue;
    known.add(d);
    closed.add(d);
  }
  return { known, closed, auto: read.length };
}

const isEvening = (e: unknown): e is [number, number] =>
  Array.isArray(e) && e.length === 2 && e.every((x) => Number.isInteger(x) && x >= 0) && e[0] <= e[1] && e[1] > 0;

/** The last day received from the NAS, or null. */
export function lastReceived(doc: VoletsDoc | null): string | null {
  const r = isObj(doc) ? doc.received : null;
  return typeof r === 'string' && DAY.test(r) ? r : null;
}

/** Display name of each shutter key (« Volet A »… when the hub gave none). */
export function shutterNames(doc: VoletsDoc | null): Map<string, string> {
  const out = new Map<string, string>();
  const named = isObj(doc) && isObj(doc.shutters) ? doc.shutters : {};
  const keys = new Set(
    [...Object.keys(named), ...dayEntries(doc).flatMap(([, v]) => (isObj(v.shutters) ? Object.keys(v.shutters) : []))].filter((k) => /^v\d{1,3}$/.test(k)),
  );
  [...keys].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).forEach((k, i) => {
    const entry = Object.hasOwn(named, k) ? (named as Record<string, unknown>)[k] : null;
    const raw = isObj(entry) && typeof entry.name === 'string' ? entry.name.trim().slice(0, 60) : '';
    out.set(k, raw || `Volet ${String.fromCharCode(65 + (i % 26))}`);
  });
  return out;
}

export interface ShutterSummary {
  key: string;
  name: string;
  close: number | null; // median closing time after noon, minutes since midnight
  closedAt22: number; // evenings closed at 22 h
  knownAt22: number; // evenings whose position at 22 h is known
  mean: number | null; // mean position 0-100 over the days read
  days: number; // days read
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Per shutter, over the `n` days of readings up to `until` (included): what the card shows. */
export function summarize(doc: VoletsDoc | null, until: string, n = 14): ShutterSummary[] {
  const names = shutterNames(doc);
  const from = addDays(until, 1 - n);
  const days = dayEntries(doc).filter(([d]) => d >= from && d <= until);
  return [...names].map(([key, name]) => {
    const closes: number[] = [];
    const means: number[] = [];
    let closedAt22 = 0;
    let knownAt22 = 0;
    let read = 0;
    for (const [, v] of days) {
      const r = shutterOf(v, key);
      if (!r) continue;
      read++;
      const m = typeof r.close === 'string' ? r.close.match(HHMM) : null;
      if (m) closes.push(Number(m[1]) * 60 + Number(m[2]));
      if (typeof r.mean === 'number' && r.mean >= 0 && r.mean <= 100) means.push(r.mean);
      if (typeof r.at22 === 'number' && r.at22 >= 0 && r.at22 <= 100) {
        knownAt22++;
        if (r.at22 === 0) closedAt22++;
      }
    }
    return {
      key,
      name,
      close: closes.length ? Math.round(median(closes)) : null,
      closedAt22,
      knownAt22,
      mean: means.length ? means.reduce((a, b) => a + b, 0) / means.length : null,
      days: read,
    };
  });
}

/** The NAS failures of the `n` days up to `until`, newest first: [day, message]. */
export function recentFailures(doc: VoletsDoc | null, until: string, n = 7): [string, string][] {
  const from = addDays(until, 1 - n);
  return dayEntries(doc)
    .filter(([d, v]) => d >= from && d <= until && Array.isArray(v.err))
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .flatMap(([d, v]) => v.err!.filter((c) => typeof c === 'string' && Object.hasOwn(VOLETS_ERRORS, c)).map((c) => [d, VOLETS_ERRORS[c]] as [string, string]));
}

/** Hours of the night that follows evening D: D 22 h → D+1 7 h (9 hours). */
export function nightHours(evening: string): string[] {
  const next = addDays(evening, 1);
  return [`${evening}T22`, `${evening}T23`, ...Array.from({ length: 7 }, (_, h) => `${next}T0${h}`)];
}

export interface Night {
  day: string; // the evening
  t: number; // outdoor mean °C, average of the two days
  kwh: number; // heating, 22 h → 7 h
  closed: boolean;
}

/** Heating nights of [from, to] with a complete hourly record and an outdoor temperature; with
 * `known`, only those evenings (#200: an evening whose shutters are unknown is left out). */
export function nights(
  hourly: Hourly,
  heatRooms: string[],
  weather: Weather,
  closed: Set<string>,
  from: string,
  to: string,
  known: Set<string> | null = null,
): Night[] {
  const out: Night[] = [];
  const series = heatRooms.map((r) => hourly.get(r)).filter((m): m is Map<string, number> => !!m);
  if (!series.length) return out;
  for (let d = from; d < to; d = addDays(d, 1)) {
    if (known && !known.has(d)) continue;
    const w0 = weather.get(d);
    const w1 = weather.get(addDays(d, 1));
    if (!w0 || !w1) continue;
    const hours = nightHours(d);
    // a night counts only if at least one room reported every hour
    if (!series.some((m) => hours.every((h) => m.has(h)))) continue;
    const kwh = series.reduce((s, m) => s + hours.reduce((a, h) => a + (m.get(h) ?? 0), 0), 0);
    out.push({ day: d, t: (w0[2] + w1[2]) / 2, kwh, closed: closed.has(d) });
  }
  return out;
}

export interface ShutterComparison {
  fit: Fit; // night signature, fitted on the nights with open shutters
  closed: Night[];
  open: Night[];
  meanClosed: number; // kWh per night, measured
  meanOpen: number;
  gap: number; // mean gap to the signature, closed minus open (kWh per night, negative = saving)
  gapPct: number | null; // relative to what the signature expected for the closed nights
  ci95: number; // ± half-width of the 95 % interval of the gap
  significant: boolean;
}

export const MIN_CLOSED = 7;
export const MIN_OPEN = 10;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const variance = (xs: number[]) => {
  const m = mean(xs);
  return xs.length > 1 ? xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1) : 0;
};

/**
 * Closed vs open nights, each as its gap to the night signature (kWh vs outdoor °C, fitted
 * on the open nights only), so that a colder week of notes does not pass for a loss.
 * Null until MIN_CLOSED closed and MIN_OPEN open heating nights exist.
 */
export function compareShutters(all: Night[]): ShutterComparison | null {
  const heating = all.filter((n) => n.t < 15 && n.kwh > 0.1);
  const closed = heating.filter((n) => n.closed);
  const open = heating.filter((n) => !n.closed);
  if (closed.length < MIN_CLOSED || open.length < MIN_OPEN) return null;
  const fit = linearFit(open.map((n) => [n.t, n.kwh]));
  if (!fit) return null;
  const expected = (n: Night) => Math.max(0, fit.slope * n.t + fit.intercept);
  const rc = closed.map((n) => n.kwh - expected(n));
  const ro = open.map((n) => n.kwh - expected(n));
  const gap = mean(rc) - mean(ro);
  const se = Math.sqrt(variance(rc) / rc.length + variance(ro) / ro.length);
  const ci95 = 1.96 * se;
  const exp = mean(closed.map(expected));
  return {
    fit,
    closed,
    open,
    meanClosed: mean(closed.map((n) => n.kwh)),
    meanOpen: mean(open.map((n) => n.kwh)),
    gap,
    gapPct: exp > 0 ? (gap / exp) * 100 : null,
    ci95,
    significant: Math.abs(gap) > ci95,
  };
}
