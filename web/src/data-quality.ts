// #318 / #336: the data-quality report of the État des données page, computed on this device
// from the decrypted documents already loaded (the same logic as `diagnose --qualite`,
// collector/quality.py). Pure: no DOM, no state, unit-tested. For each source and each year:
// days covered, gaps with their probable cause when it is known, and what can be recovered.
import { type DayRecord, MONTHS_SHORT, addDays, rawRecords } from './aggregate';
import { dayShort, plural, rangeLabel, withUnit } from './glossary';
import type { CutKind } from './periods';

export type SourceId = 'heating' | 'water' | 'linky' | 'station' | 'room30' | 'linky30' | 'roomstate';

/** Days of one year for one source. A day is « complet » when every part (room, module) that
 * existed then has a value, « estimé » when one comes from a monthly total, « partiel » when
 * some parts are missing (or a half-hour day is thin), « manquant » when none has a value. */
export interface YearCover {
  year: number;
  expected: number;
  full: number;
  estimated: number;
  partial: number;
  missing: number;
}

export interface Gap {
  from: string;
  to: string;
  days: number;
  /** « toutes les pièces », a room or module name. */
  who: string;
  all: boolean;
  /** Still going on the last day of the data. */
  ongoing: boolean;
  cause: string;
  recover: string;
  /** Page that tells more (« #parametres-sources » for the devices). */
  link?: string;
  /** zero: a run of 0 kWh days, not a missing value. */
  kind?: 'missing' | 'zero';
  /** The same days are missing for the radiators (water heater): said once, under the radiators. */
  same?: boolean;
}

export interface SourceQuality {
  id: SourceId;
  label: string;
  first: string | null;
  last: string | null;
  years: YearCover[];
  gaps: Gap[];
  /** Short runs left out of `gaps` (scattered single days). */
  scattered: number;
  notes: string[];
}

/** Share of the expected days that are complete or estimated (0-1), null when nothing is expected. */
export const covered = (y: YearCover) => (y.expected ? (y.full + y.estimated) / y.expected : null);

// ------------------------------------------------------------------ dates
const MIN_GAP = 3; // shorter runs are counted as « scattered »

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
const span = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
/** « sept.–oct. 2023 », « nov. 2024 », « déc. 2023–janv. 2024 ». */
export function monthSpan(from: string, to: string): string {
  const m = (d: string) => MONTHS_SHORT[Number(d.slice(5, 7)) - 1];
  if (from.slice(0, 7) === to.slice(0, 7)) return `${m(from)} ${from.slice(0, 4)}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${m(from)}–${m(to)} ${to.slice(0, 4)}`;
  return `${m(from)} ${from.slice(0, 4)}–${m(to)} ${to.slice(0, 4)}`;
}
export const gapPeriod = (g: Pick<Gap, 'from' | 'to'>) => (g.from === g.to ? `le ${dayShort(g.from, true)}` : rangeLabel(g.from, g.to));

/** Runs of consecutive days of a sorted list. */
export function runs(sorted: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && addDays(last[1], 1) === d) last[1] = d;
    else out.push([d, d]);
  }
  return out;
}

// ------------------------------------------------------------------ coverage of parts
export interface Part {
  name: string;
  days: Set<string>;
  /** First day the part is expected (its first value by default). */
  first?: string;
  estimated?: Set<string>;
  /** Days present but incomplete (a half-hour day with few half hours). */
  thin?: Set<string>;
}

interface Cover {
  years: YearCover[];
  allMissing: string[];
  /** part -> days missing while at least one other part had a value */
  partMissing: Map<string, string[]>;
  first: string | null;
}

/** Days covered per year by a set of parts, from the first part's first day to `last`. */
export function coverParts(parts: Part[], last: string): Cover {
  const live = parts.filter((p) => p.days.size);
  const firstOf = (p: Part) => p.first ?? [...p.days].reduce((a, b) => (b < a ? b : a));
  const firsts = new Map(live.map((p) => [p.name, firstOf(p)]));
  const first = [...firsts.values()].reduce<string | null>((a, b) => (a === null || b < a ? b : a), null);
  const years = new Map<number, YearCover>();
  const allMissing: string[] = [];
  const partMissing = new Map<string, string[]>();
  if (first === null || first > last) return { years: [], allMissing, partMissing, first };
  for (const d of days(first, last)) {
    const active = live.filter((p) => firsts.get(p.name)! <= d);
    if (!active.length) continue;
    const y = Number(d.slice(0, 4));
    const c = years.get(y) ?? { year: y, expected: 0, full: 0, estimated: 0, partial: 0, missing: 0 };
    years.set(y, c);
    c.expected++;
    const absent = active.filter((p) => !p.days.has(d));
    if (absent.length === active.length) {
      c.missing++;
      allMissing.push(d);
    } else if (absent.length) {
      c.partial++;
      for (const p of absent) (partMissing.get(p.name) ?? partMissing.set(p.name, []).get(p.name)!).push(d);
    } else if (active.some((p) => p.thin?.has(d))) c.partial++;
    else if (active.some((p) => p.estimated?.has(d))) c.estimated++;
    else c.full++;
  }
  return { years: [...years.values()].sort((a, b) => a.year - b.year), allMissing, partMissing, first };
}

// ------------------------------------------------------------------ inputs
export interface DevicesInfo {
  /** room -> days a module of the room did not answer (nightly status). */
  offline?: Map<string, Set<string>>;
  /** Modules not answering at the last collection, with the first day of the run. */
  offlineNow?: { room?: string; since: string; type?: string }[];
  /** Days the Intuis gateway restarted (power cut). */
  boots?: string[];
  /** Days a water heater was set up (« mise en service »). */
  waterSetup?: string[];
  /** #394: days touched by a power or Internet cut (incidents.ts `cutCauses`). */
  cuts?: Map<string, CutKind>;
  /** #280: night -> sources whose collection failed (« linky », « netatmo », « intuis »…). */
  failures?: Record<string, string[]>;
}

export interface QualityInput {
  /** Last day of the archive. */
  last: string;
  rooms: { id: string; name: string; category: string }[];
  records: DayRecord[];
  estimated: Set<string>;
  linky?: Map<string, number>;
  station?: { modules: Record<string, { name: string }>; daily: Record<string, Record<string, unknown>>; health?: Record<string, Record<string, [number | null, number | null, number]>> } | null;
  devices?: DevicesInfo;
  /** Day -> kWh the radiators recorded far too low (suspects, computed by reconstitute.ts). */
  suspects?: string[];
  /** #346: radiators switched off on purpose (⚙ Mon logement): no data expected from `from` on. */
  stopped?: { room: string; from: string; text: string }[];
}

/** Days a stopped room is not expected to send anything, up to `last`. */
function stoppedDays(input: Pick<QualityInput, 'stopped' | 'last'>, room: string): string[] {
  const s = input.stopped?.find((x) => x.room === room);
  return s && s.from <= input.last ? days(s.from, input.last) : [];
}

/** The first cut (power wins) on the days [from - 1, to]: a cut the evening before counts. */
function cutIn(cuts: Map<string, CutKind> | undefined, from: string, to: string): { day: string; kind: CutKind } | null {
  if (!cuts?.size) return null;
  const list = days(addDays(from, -1), to).filter((d) => cuts.has(d));
  const day = list.find((d) => cuts.get(d) === 'power') ?? list[0];
  return day ? { day, kind: cuts.get(day)! } : null;
}
const cutCause = (c: { day: string; kind: CutKind }, what: string) =>
  c.kind === 'power' ? `coupure de courant le ${dayShort(c.day, true)} : ${what}` : `coupure Internet le ${dayShort(c.day, true)} : ${what}`;

/**
 * Nights whose collection of `source` failed and could have fetched these days: the collection
 * asks again for the 10 days before it (Linky, station), so a day is lost when the nights up to
 * 10 days after it all failed.
 */
function failedNights(input: QualityInput, source: string, from: string, to: string): number {
  const f = input.devices?.failures;
  if (!f) return 0;
  const end = addDays(to, 10);
  return Object.entries(f).filter(([d, list]) => d >= from && d <= end && list.includes(source)).length;
}
/** At least 80 % of [from, to] in `set`. */
const mostlyIn = (set: Set<string> | null, from: string, to: string) => {
  if (!set?.size) return false;
  const list = days(from, to);
  return list.filter((d) => set.has(d)).length >= 0.8 * list.length;
};

const NOT_AT_INTUIS = 'Non chez Intuis (ni les jours ni le total du mois) ; une estimation à part reste possible (« Reconstituer », plus bas).';

/** Days of [from, to] a module of one of `rooms` did not answer (nightly status). */
function offlineIn(input: QualityInput, rooms: { id: string }[], from: string, to: string): number {
  const off = rooms.map((r) => input.devices?.offline?.get(r.id)).filter((x): x is Set<string> => !!x);
  return off.length ? days(from, to).filter((d) => off.some((s) => s.has(d))).length : 0;
}

// ------------------------------------------------------------------ Intuis (radiators, water heater)
function intuis(input: QualityInput, kind: 'heating' | 'water'): SourceQuality | null {
  const cat = kind === 'water' ? 'water_heater' : 'heating';
  const rooms = input.rooms.filter((r) => r.category === cat);
  const ids = new Set(rooms.map((r) => r.id));
  const byRoom = new Map<string, Set<string>>();
  const zeros = new Map<string, string[]>();
  for (const r of rawRecords(input.records)) {
    if (!ids.has(r.room)) continue;
    (byRoom.get(r.room) ?? byRoom.set(r.room, new Set()).get(r.room)!).add(r.day);
    if (kind === 'water' && r.kwh === 0) (zeros.get(r.room) ?? zeros.set(r.room, []).get(r.room)!).push(r.day);
  }
  // #346: a radiator switched off on purpose sends nothing, as expected: not a missing day
  const stoppedNotes: string[] = [];
  for (const [room, set] of byRoom) {
    const off = stoppedDays(input, room);
    if (!off.length) continue;
    const any = new Set(rawRecords(input.records).filter((r) => r.room !== room && ids.has(r.room)).map((r) => r.day));
    for (const d of off) if (any.has(d)) set.add(d);
    const s = input.stopped!.find((x) => x.room === room)!;
    stoppedNotes.push(`${rooms.find((r) => r.id === room)?.name ?? room} : ${s.text} : pas de données attendues, ces jours ne comptent pas comme manquants.`);
  }
  if (!byRoom.size) return null;
  const name = (id: string) => rooms.find((r) => r.id === id)?.name ?? id;
  const parts: Part[] = [...byRoom].map(([id, set]) => ({
    name: id,
    days: set,
    estimated: new Set([...input.estimated].filter((k) => k.startsWith(`${id}|`)).map((k) => k.slice(id.length + 1))),
  }));
  const cov = coverParts(parts, input.last);
  const label = kind === 'water' ? 'Chauffe-eau (Intuis)' : 'Radiateurs (Intuis)';
  const what = kind === 'water' ? 'le chauffe-eau' : 'toutes les pièces';
  const gaps: Gap[] = [];
  let scattered = 0;
  const linkyHas = (from: string, to: string) => {
    if (!input.linky?.size) return false;
    const list = days(from, to);
    return list.filter((d) => input.linky!.has(d)).length >= 0.8 * list.length;
  };
  const heatingLost = kind === 'water' ? new Set(intuis({ ...input }, 'heating')?.gaps.filter((g) => g.all).flatMap((g) => days(g.from, g.to)) ?? []) : null;
  for (const [from, to] of runs(cov.allMissing)) {
    const n = span(from, to);
    if (n < MIN_GAP) {
      scattered += n;
      continue;
    }
    const boot = input.devices?.boots?.find((b) => b >= addDays(from, -1) && b <= to);
    const setup = kind === 'water' ? input.devices?.waterSetup?.find((s) => s >= addDays(to, -30) && s <= addDays(to, 30)) : undefined;
    const cut = cutIn(input.devices?.cuts, from, to);
    const waterOff = kind === 'water' ? offlineIn(input, rooms, from, to) : 0;
    let cause = "l'historique Intuis n'a rien renvoyé pour ces jours (ni les jours, ni le total du mois)";
    const sameAsRadiators = !!heatingLost && days(from, to).some((d) => heatingLost.has(d));
    if (setup) cause = `chauffe-eau absent, puis remis en service le ${dayShort(setup, true)} (réinstallé)`;
    else if (sameAsRadiators) cause = "même trou que les radiateurs : l'historique Intuis n'a rien renvoyé pour ces jours";
    else if (waterOff) cause = `chauffe-eau injoignable ${waterOff > 1 ? `${waterOff} de ces jours` : 'ce jour-là'} (il ne répondait pas à la passerelle)`;
    else if (heatingLost) cause = 'seul le chauffe-eau manque : il ne renvoyait rien (débranché, retiré ou hors ligne ?)';
    // radiators: a cut of the whole home (a cut cannot explain the water heater alone)
    else if (boot) cause = `coupure de courant probable (la passerelle Intuis a redémarré le ${dayShort(boot, true)})`;
    else if (cut) cause = cutCause(cut, 'la passerelle Intuis ne pouvait plus envoyer ses relevés');
    gaps.push({
      from,
      to,
      days: n,
      who: what,
      all: true,
      ongoing: false,
      cause,
      same: !setup && !!heatingLost && days(from, to).every((d) => heatingLost.has(d)),
      link: waterOff && !setup ? '#parametres-sources' : undefined,
      recover: setup ? 'Non : le chauffe-eau ne mesurait rien pendant cette période.' : `${NOT_AT_INTUIS}${linkyHas(from, to) ? ' Le compteur Linky a ces jours : la reconstitution s’appuie dessus.' : ''}`,
    });
  }
  const offlineNow = input.devices?.offlineNow ?? [];
  for (const [room, missing] of cov.partMissing) {
    for (const [from, to] of runs(missing)) {
      const n = span(from, to);
      const ongoing = to === input.last;
      if (n < MIN_GAP && !ongoing) {
        scattered += n;
        continue;
      }
      const off = input.devices?.offline?.get(room);
      const now = offlineNow.find((m) => m.room === room);
      const offDays = off ? days(from, to).filter((d) => off.has(d)).length : 0;
      const cause = ongoing
        ? now
          ? `pièce muette depuis le ${dayShort(from, true)} : module injoignable (il ne répond plus à la passerelle)`
          : `plus aucune donnée depuis le ${dayShort(from, true)} : radiateur injoignable, débranché ou retiré ?`
        : offDays
          ? `module hors ligne ${offDays > 1 ? `${offDays} de ces jours` : 'ce jour-là'} (il ne répondait pas à la passerelle)`
          : "l'historique Intuis n'a rien renvoyé pour cette pièce";
      gaps.push({
        from,
        to,
        days: n,
        who: name(room),
        all: false,
        ongoing,
        cause,
        recover: ongoing ? 'Les jours reviendront quand le module répondra à nouveau ; les jours passés sont perdus chez Intuis.' : NOT_AT_INTUIS,
        link: ongoing || offDays ? '#parametres-sources' : undefined,
      });
    }
  }
  // a water heater at 0 kWh for two weeks or more: switched off, unplugged or not answering
  for (const [room, list] of zeros) {
    for (const [from, to] of runs(list.sort())) {
      const n = span(from, to);
      if (n < 14) continue;
      gaps.push({
        from,
        to,
        days: n,
        who: name(room),
        all: true,
        ongoing: to === input.last,
        kind: 'zero',
        cause: 'le chauffe-eau a relevé 0 kWh chaque jour : éteint, débranché ou absence prolongée ?',
        recover: 'Rien à récupérer si le chauffe-eau était vraiment éteint.',
      });
    }
  }
  const notes: string[] = [...stoppedNotes];
  const est = cov.years.reduce((a, y) => a + y.estimated, 0);
  if (est) notes.push(`${est} jour${est > 1 ? 's' : ''} estimé${est > 1 ? 's' : ''} : Intuis a gardé le total du mois mais perdu le détail du jour ; le total du mois reste juste.`);
  return { id: kind, label, first: cov.first, last: input.last, years: cov.years, gaps: tidy(gaps, ['pièce', 'pièces']), scattered, notes };
}

const sortGaps = (g: Gap[]) => g.sort((a, b) => b.days - a.days || (a.from < b.from ? -1 : 1));

/** The same hole in several rooms (or modules) is listed once: « pièces : Cuisine, Salon ». */
function tidy(gaps: Gap[], unit: [string, string]): Gap[] {
  const out = new Map<string, Gap & { names: string[] }>();
  for (const g of gaps) {
    const k = [g.from, g.to, g.cause, g.all, g.kind ?? ''].join('|');
    const cur = out.get(k);
    if (cur && !g.all) cur.names.push(g.who);
    else out.set(k, { ...g, names: [g.who] });
  }
  return sortGaps(
    [...out.values()].map(({ names, ...g }) => (g.all ? g : { ...g, who: `${names.length > 1 ? unit[1] : unit[0]} : ${names.sort((a, b) => a.localeCompare(b, 'fr')).join(', ')}` })),
  );
}

// ------------------------------------------------------------------ Linky
function linky(input: QualityInput): SourceQuality | null {
  const m = input.linky;
  if (!m?.size) return null;
  const sorted = [...m.keys()].sort();
  const last = sorted[sorted.length - 1];
  const cov = coverParts([{ name: 'linky', days: new Set(sorted) }], last);
  const limit = addDays(input.last, -3 * 365);
  const gaps: Gap[] = [];
  let scattered = 0;
  for (const [from, to] of runs(cov.allMissing)) {
    const n = span(from, to);
    if (n < MIN_GAP) {
      scattered += n;
      continue;
    }
    const old = to < limit;
    const failed = failedNights(input, 'linky', from, to);
    gaps.push({
      from,
      to,
      days: n,
      who: 'compteur',
      all: true,
      ongoing: false,
      cause: failed
        ? `collecte Linky en échec (${failed} nuit${failed > 1 ? 's' : ''}) : ces jours n’ont pas été redemandés à temps`
        : mostlyIn(absentWithin(stationDays(input), from, to), from, to)
          ? 'collecte arrêtée : la station manque aussi ces jours-là'
          : 'Enedis n’a pas transmis ces jours',
      recover: old ? 'Non : Enedis ne garde que 3 ans.' : 'Encore chez Enedis (moins de 3 ans), mais la collecte ne redemande que les 10 derniers jours.',
    });
  }
  const notes = last < addDays(input.last, -3) ? [`Dernier relevé Linky le ${dayShort(last, true)} : la collecte Linky est peut-être en échec (voir l’état des sources).`] : [];
  return { id: 'linky', label: 'Compteur Linky (par jour)', first: cov.first, last, years: cov.years, gaps: sortGaps(gaps), scattered, notes };
}

/** Days with at least one station module (null: no station). */
function stationDays(input: QualityInput): Set<string> | null {
  const daily = input.station?.daily;
  return daily ? new Set(Object.values(daily).flatMap((d) => Object.keys(d))) : null;
}
/** Days of [from, to] absent from `have`, within its own first and last day (null: no source). */
function absentWithin(have: Set<string> | null, from: string, to: string): Set<string> | null {
  if (!have?.size) return null;
  let lo = '9999';
  let hi = '';
  for (const d of have) {
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return new Set(days(from, to).filter((d) => d >= lo && d <= hi && !have.has(d)));
}

// ------------------------------------------------------------------ station
function station(input: QualityInput): SourceQuality | null {
  const s = input.station;
  if (!s) return null;
  const parts: Part[] = Object.entries(s.daily ?? {})
    .filter(([, d]) => Object.keys(d).length)
    .map(([key, d]) => ({ name: key, days: new Set(Object.keys(d)) }));
  if (!parts.length) return null;
  const last = parts.flatMap((p) => [...p.days]).reduce((a, b) => (b > a ? b : a));
  const cov = coverParts(parts, last);
  const name = (k: string) => s.modules?.[k]?.name ?? 'module';
  const gaps: Gap[] = [];
  let scattered = 0;
  const recover = 'Netatmo garde l’historique de la station, mais la collecte ne redemande que les 10 jours avant le dernier relevé.';
  for (const [from, to] of runs(cov.allMissing)) {
    const n = span(from, to);
    if (n < MIN_GAP) {
      scattered += n;
      continue;
    }
    const failed = failedNights(input, 'netatmo', from, to);
    const cause = failed
      ? `collecte de la station en échec (${failed} nuit${failed > 1 ? 's' : ''}) : connexion Netatmo à renouveler ?`
      : mostlyIn(absentWithin(input.linky ? new Set(input.linky.keys()) : null, from, to), from, to)
        ? 'collecte arrêtée : le compteur Linky manque aussi ces jours-là'
        : 'collecte de la station interrompue (connexion Netatmo à renouveler ?)';
    gaps.push({ from, to, days: n, who: 'tous les modules', all: true, ongoing: false, cause, recover });
  }
  for (const [key, missing] of cov.partMissing) {
    const health = s.health?.[key] ?? {};
    for (const [from, to] of runs(missing)) {
      const n = span(from, to);
      const ongoing = to === last;
      if (n < MIN_GAP && !ongoing) {
        scattered += n;
        continue;
      }
      const before = Object.keys(health)
        .filter((d) => d >= addDays(from, -10) && d <= to)
        .map((d) => health[d]);
      const low = before.some((h) => h[0] !== null && h[0] < 15);
      const mute = before.some((h) => h[2] === 0);
      gaps.push({
        from,
        to,
        days: n,
        who: name(key),
        all: false,
        ongoing,
        cause: low ? 'pile faible juste avant : le module s’est arrêté' : mute ? 'module injoignable (hors de portée de la station ?)' : 'le module n’a rien renvoyé',
        recover: low ? 'Changer la pile ; les jours sans relevé sont perdus.' : recover,
        link: low || mute ? '#parametres-sources' : undefined,
      });
    }
  }
  return { id: 'station', label: 'Station Netatmo', first: cov.first, last, years: cov.years, gaps: tidy(gaps, ['module', 'modules']), scattered, notes: [] };
}

// ------------------------------------------------------------------ half hours and hourly states
/** Days with values of a per-half-hour or per-hour source (loaded on demand by the view). */
export interface FineInput {
  /** room30: room -> days with at least one half hour; linky30 / roomstate: one part. */
  parts: Part[];
  last: string;
}

export function fineSource(
  id: 'room30' | 'linky30' | 'roomstate',
  f: FineInput,
  intuisFirst: string | null,
  rooms: { id: string; name: string }[] = [],
  cuts?: Map<string, CutKind>,
): SourceQuality | null {
  if (!f.parts.some((p) => p.days.size)) return null;
  const cov = coverParts(f.parts, f.last);
  const label = { room30: 'Pièces à la demi-heure (Intuis)', linky30: 'Compteur Linky à la demi-heure', roomstate: 'Relevé horaire de l’état des pièces' }[id];
  const cause = {
    room30: "Intuis n'a rien renvoyé à la demi-heure",
    linky30: 'courbe de charge non transmise par Enedis',
    roomstate: 'relevé horaire non passé (collecte sautée par GitHub ou en échec)',
  }[id];
  const recover = {
    room30: 'La collecte redemande l’historique à la demi-heure nuit après nuit ; un trou déjà parcouru n’est pas redemandé.',
    linky30: 'Les jours anciens ne sont pas redemandés à Enedis.',
    roomstate: 'Non : c’est un relevé de l’instant, Intuis n’en garde pas l’historique.',
  }[id];
  const name = (k: string) => rooms.find((r) => r.id === k)?.name ?? k;
  const gaps: Gap[] = [];
  let scattered = 0;
  for (const [from, to] of runs(cov.allMissing)) {
    const n = span(from, to);
    if (n < MIN_GAP) scattered += n;
    else {
      // #394: the hourly snapshot needs the home online; a cut explains its gap (not Intuis history)
      const cut = id === 'roomstate' ? cutIn(cuts, from, to) : null;
      gaps.push({ from, to, days: n, who: id === 'room30' ? 'toutes les pièces' : 'tout', all: true, ongoing: false, cause: cut ? cutCause(cut, 'la maison était injoignable') : cause, recover });
    }
  }
  for (const [part, missing] of cov.partMissing) {
    for (const [from, to] of runs(missing)) {
      const n = span(from, to);
      if (n < MIN_GAP) scattered += n;
      else gaps.push({ from, to, days: n, who: name(part), all: false, ongoing: to === f.last, cause, recover });
    }
  }
  const notes: string[] = [];
  if (id === 'room30' && cov.first && intuisFirst && cov.first > addDays(intuisFirst, 30)) {
    notes.push(`Historique rattrapé du plus récent au plus ancien, quelques semaines par nuit : disponible depuis le ${dayShort(cov.first, true)} pour l’instant.`);
  }
  const thin = cov.years.reduce((a, y) => a + y.partial, 0);
  if (id !== 'room30' && thin) notes.push(`${thin} jour${thin > 1 ? 's' : ''} incomplet${thin > 1 ? 's' : ''} (une partie des ${id === 'roomstate' ? 'heures' : 'demi-heures'} seulement).`);
  return { id, label, first: cov.first, last: f.last, years: cov.years, gaps: tidy(gaps, ['pièce', 'pièces']), scattered, notes };
}

/** Parts of the 30-min Linky curve (keys « YYYY-MM-DDTHH:MM »): a day with fewer than 40 half hours is thin. */
export function curveParts(curve: Map<string, number>): FineInput {
  const n = new Map<string, number>();
  for (const k of curve.keys()) n.set(k.slice(0, 10), (n.get(k.slice(0, 10)) ?? 0) + 1);
  const all = [...n.keys()].sort();
  return { parts: [{ name: 'linky30', days: new Set(all), thin: new Set(all.filter((d) => n.get(d)! < 40)) }], last: all[all.length - 1] ?? '' };
}

/** Parts of the hourly snapshots (day -> bitmask of the hours seen): fewer than 20 hours is thin. */
export function seenParts(seen: Record<string, number>): FineInput {
  const bits = (m: number) => {
    let c = 0;
    for (let v = m >>> 0; v; v &= v - 1) c++;
    return c;
  };
  const all = Object.keys(seen)
    .filter((d) => bits(seen[d]) > 0)
    .sort();
  return { parts: [{ name: 'roomstate', days: new Set(all), thin: new Set(all.filter((d) => bits(seen[d]) < 20)) }], last: all[all.length - 1] ?? '' };
}

// ------------------------------------------------------------------ values that look wrong
export interface LowYear {
  year: number;
  /** Intuis heating as a share of the Linky meter, winter days (Nov–Mar) fully measured. */
  share: number;
  /** Median share of the other years. */
  usual: number;
}

/**
 * Years whose radiators recorded far less than usual compared with the meter: the share of
 * Linky that Intuis heating represents on the winter days, below 60 % of the other years'
 * median. Needs Linky and at least two years with 30 such days.
 */
export function lowYears(records: DayRecord[], linkyDaily: Map<string, number>, uncertain: Set<string>): LowYear[] {
  const heat = new Map<string, number>();
  for (const r of rawRecords(records)) if (r.cat === 'heating') heat.set(r.day, (heat.get(r.day) ?? 0) + r.kwh);
  const per = new Map<number, [number, number, number]>(); // year -> [intuis, linky, days]
  for (const [d, kwh] of heat) {
    const m = Number(d.slice(5, 7));
    const l = linkyDaily.get(d);
    if (!(m >= 11 || m <= 3) || l === undefined || !(l > 0) || uncertain.has(d)) continue;
    const c = per.get(Number(d.slice(0, 4))) ?? [0, 0, 0];
    c[0] += kwh;
    c[1] += l;
    c[2]++;
    per.set(Number(d.slice(0, 4)), c);
  }
  const shares = [...per].filter(([, c]) => c[2] >= 30).map(([y, c]) => ({ year: y, share: c[0] / c[1] }));
  if (shares.length < 2) return [];
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  return shares
    .map((s) => ({ ...s, usual: median(shares.filter((o) => o.year !== s.year).map((o) => o.share)) }))
    .filter((s) => s.usual > 0 && s.share < 0.6 * s.usual);
}

// #336: the rule of a room-day, shared with `diagnose --qualite` (collector/quality.py). Both test
// suites read web/src/__fixtures__/quality-rule.json and must find the same counts (AGENTS.md §5).
/** A room using more than this in a day (3.3 kW for 24 h) is not credible. */
export const SUSPECT_KWH_DAY = 80;
/** Intuis above Linky by more than this is impossible (Intuis counts a part of what the meter sees). */
export const ABOVE_RATIO = 1.1;
export const ABOVE_MARGIN_KWH = 0.5;
/** A daily value that can be: a number, not negative, at most SUSPECT_KWH_DAY. */
export const plausibleKwh = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= SUSPECT_KWH_DAY;

/**
 * Days where the radiators and water heater recorded more than the whole home's meter
 * (impossible). Measured values of the followed rooms only: an estimated day (spread from a
 * monthly total), an impossible value or an ignored room says nothing about this day.
 */
export function aboveMeter(records: DayRecord[], linkyDaily: Map<string, number>, estimated: Set<string> = new Set()): string[] {
  const tot = new Map<string, number>();
  for (const r of rawRecords(records)) if (r.cat !== 'ignore' && !estimated.has(`${r.room}|${r.day}`) && plausibleKwh(r.kwh)) tot.set(r.day, (tot.get(r.day) ?? 0) + r.kwh);
  return [...tot]
    .filter(([d, v]) => {
      const l = linkyDaily.get(d);
      return typeof l === 'number' && Number.isFinite(l) && l >= 0 && v > ABOVE_RATIO * l + ABOVE_MARGIN_KWH;
    })
    .map(([d]) => d)
    .sort();
}

/** Room-days of a month: « réel », « estimé », « manquant », « suspect » (also real), « arrêté ». */
export interface RoomDays {
  real: number;
  estimated: number;
  missing: number;
  /** A real value that cannot be (negative, not a number, above SUSPECT_KWH_DAY): counted in `real` too. */
  suspect: number;
  /** #346 / #440: a room switched off on purpose, from its declared day: not expected, not missing. */
  stopped: number;
}
export type RoomKind = 'heating' | 'water';
export const emptyRoomDays = (): RoomDays => ({ real: 0, estimated: 0, missing: 0, suspect: 0, stopped: 0 });

/**
 * #336: every room-day from the room's first value to the last day of the archive, per month
 * (« YYYY-MM ») and kind: estimated (flagged), else real (a value), else stopped (declared off),
 * else missing. The same rule as `diagnose --qualite`.
 */
export function roomDays(input: Pick<QualityInput, 'last' | 'rooms' | 'records' | 'estimated' | 'stopped'>): Map<string, Partial<Record<RoomKind, RoomDays>>> {
  const kind = new Map<string, RoomKind>();
  for (const r of input.rooms) if (r.category === 'heating' || r.category === 'water_heater') kind.set(r.id, r.category === 'heating' ? 'heating' : 'water');
  const values = new Map<string, Map<string, number>>();
  for (const r of rawRecords(input.records)) if (kind.has(r.room)) (values.get(r.room) ?? values.set(r.room, new Map()).get(r.room)!).set(r.day, r.kwh);
  const out = new Map<string, Partial<Record<RoomKind, RoomDays>>>();
  for (const [room, vals] of values) {
    let first = '9999';
    for (const d of vals.keys()) if (d < first) first = d;
    const k = kind.get(room)!;
    const stop = input.stopped?.find((s) => s.room === room);
    for (const d of days(first, input.last)) {
      const month = out.get(d.slice(0, 7)) ?? out.set(d.slice(0, 7), {}).get(d.slice(0, 7))!;
      const c = (month[k] ??= emptyRoomDays());
      if (input.estimated.has(`${room}|${d}`)) c.estimated++;
      else if (vals.has(d)) {
        c.real++;
        if (!plausibleKwh(vals.get(d))) c.suspect++;
      } else if (stop && stop.from <= d) c.stopped++;
      else c.missing++;
    }
  }
  return out;
}

/** The room-days of a year, added up over its months. */
export function yearRoomDays(cells: Map<string, Partial<Record<RoomKind, RoomDays>>>, year: number, k: RoomKind): RoomDays | null {
  let out: RoomDays | null = null;
  for (const [m, c] of cells) {
    const v = c[k];
    if (!v || m.slice(0, 4) !== String(year)) continue;
    out ??= emptyRoomDays();
    for (const key of Object.keys(out) as (keyof RoomDays)[]) out[key] += v[key];
  }
  return out;
}

// ------------------------------------------------------------------ report
export interface QualityReport {
  sources: SourceQuality[];
  low: LowYear[];
  above: string[];
  suspects: string[];
  /** #336: room-days per month, as counted by `diagnose --qualite`. */
  roomDays: Map<string, Partial<Record<RoomKind, RoomDays>>>;
  /** #346 / #440: rooms switched off on purpose (name, first day, sentence). */
  stopped: { who: string; from: string; text: string }[];
}

export function qualityReport(input: QualityInput): QualityReport {
  const sources = [intuis(input, 'heating'), intuis(input, 'water'), linky(input), station(input)].filter((s): s is SourceQuality => !!s);
  const lost = new Set(sources.filter((s) => s.id === 'heating').flatMap((s) => s.gaps.filter((g) => g.kind !== 'zero').flatMap((g) => days(g.from, g.to))));
  for (const k of input.estimated) lost.add(k.slice(k.indexOf('|') + 1));
  const linkyDaily = input.linky ?? new Map<string, number>();
  return {
    sources,
    low: lowYears(input.records, linkyDaily, lost),
    above: aboveMeter(input.records, linkyDaily, input.estimated),
    suspects: [...(input.suspects ?? [])].sort(),
    roomDays: roomDays(input),
    stopped: (input.stopped ?? []).map((s) => ({ who: input.rooms.find((r) => r.id === s.room)?.name ?? 'une pièce', from: s.from, text: s.text })),
  };
}

export type Level = 'good' | 'fair' | 'poor';
export const LEVEL_LABEL: Record<Level, string> = { good: 'bonne', fair: 'correcte', poor: 'à vérifier' };

export interface YearVerdict {
  year: number;
  level: Level;
  /** « 88 % des jours complets pour les radiateurs » */
  headline: string;
  /** The explanations, one sentence each. */
  reasons: string[];
  /** « Est-ce normal ? » in one sentence. */
  answer: string;
  /** #336: the radiators' room-days of the year, as `diagnose --qualite` counts them ('' when none). */
  counts: string;
}

const int = (n: number) => n.toLocaleString('fr-FR');
const pctText = (v: number) => withUnit(String(Math.floor(v * 100)), '%');

/** One answer per year, radiators first: « est-ce normal ? », « quelle qualité ? ». */
export function yearVerdicts(r: QualityReport): YearVerdict[] {
  const heating = r.sources.find((s) => s.id === 'heating');
  const years = [...new Set(r.sources.flatMap((s) => s.years.map((y) => y.year)))].sort((a, b) => b - a);
  return years.map((year) => {
    const reasons: string[] = [];
    const h = heating?.years.find((y) => y.year === year);
    const c = h ? covered(h) : null;
    let level: Level = c === null ? 'good' : c >= 0.98 ? 'good' : c >= 0.9 ? 'fair' : 'poor';
    const inYear = (g: Gap) => g.from.slice(0, 4) === String(year) || g.to.slice(0, 4) === String(year);
    for (const s of r.sources) {
      for (const g of s.gaps.filter((x) => inYear(x) && !x.same).slice(0, 3)) {
        if (g.days < 7 && s.id !== 'heating' && s.id !== 'water') continue;
        reasons.push(`${s.label} : ${g.kind === 'zero' ? '0 kWh' : 'trou'} de ${g.days} jours ${g.all ? `sur ${g.who}` : `(${g.who})`} (${monthSpan(g.from, g.to)}) : ${g.cause}.`);
      }
      const est = s.years.find((y) => y.year === year)?.estimated ?? 0;
      if (est && s.id === 'heating') reasons.push(`${est} jour${est > 1 ? 's' : ''} estimé${est > 1 ? 's' : ''} depuis le total du mois (le total reste juste).`);
    }
    const low = r.low.find((l) => l.year === year);
    if (low) {
      reasons.push(`Valeurs basses : en hiver, les radiateurs représentent ${pctText(low.share)} du compteur Linky, contre ${pctText(low.usual)} les autres années.`);
      if (level === 'good') level = 'fair';
    }
    const sus = r.suspects.filter((d) => d.startsWith(String(year))).length;
    if (sus) {
      reasons.push(`${sus} jour${sus > 1 ? 's' : ''} suspect${sus > 1 ? 's' : ''} : chauffage relevé bien trop bas un jour froid, alors que le compteur a vu la consommation.`);
      if (level === 'good' && sus >= 5) level = 'fair';
    }
    const above = r.above.filter((d) => d.startsWith(String(year))).length;
    if (above) reasons.push(`${above} jour${above > 1 ? 's' : ''} où les radiateurs dépassent le compteur Linky (impossible : valeurs Intuis douteuses ces jours-là).`);
    const rd = yearRoomDays(r.roomDays, year, 'heating');
    if (rd?.suspect) reasons.push(`${plural(rd.suspect, 'valeur impossible', 'valeurs impossibles')} (négative ou au-dessus de ${withUnit(String(SUSPECT_KWH_DAY), 'kWh')} pour une pièce en un jour) : comptée${rd.suspect > 1 ? 's' : ''} comme relevée${rd.suspect > 1 ? 's' : ''} mais douteuse${rd.suspect > 1 ? 's' : ''}.`);
    // #346 / #440: a room switched off on purpose is not a hole: said once per year it covers
    for (const st of r.stopped) if (st.from.slice(0, 4) <= String(year)) reasons.push(`${st.who} : ${st.text} : pas de données attendues, ce n’est pas un trou.`);
    const intuisLost = r.sources.some((s) => (s.id === 'heating' || s.id === 'water') && s.gaps.some((g) => inYear(g) && g.kind !== 'zero' && /Intuis n'a rien renvoyé/.test(g.cause)));
    const answer = intuisLost
      ? 'Ce n’est pas une panne de l’application : ces jours n’existent plus chez Intuis. Ils ne peuvent pas être récupérés, seulement estimés à part (« Reconstituer », plus bas).'
      : reasons.length
        ? ''
        : 'Rien à signaler.';
    const headline = h && c !== null ? `${pctText(c)} des jours complets pour les radiateurs (${h.full + h.estimated} sur ${h.expected})` : 'pas de relevé des radiateurs cette année';
    const counts = rd
      ? `En jours × pièces : ${[`${int(rd.real)} relevés`, rd.estimated ? `${int(rd.estimated)} estimés` : '', rd.missing ? `${int(rd.missing)} manquants` : '', rd.stopped ? `${int(rd.stopped)} arrêtés volontairement` : ''].filter(Boolean).join(', ')}.`
      : '';
    return { year, level, headline, reasons, answer, counts };
  });
}

/** This month so far, radiators: complete, estimated and incomplete days (a room without value). */
export function monthStatus(input: Pick<QualityInput, 'last' | 'rooms' | 'records' | 'estimated' | 'stopped'>): { expected: number; ok: number; estimated: number; missing: number } {
  const from = `${input.last.slice(0, 8)}01`;
  const res = { expected: 0, ok: 0, estimated: 0, missing: 0 };
  // #346: a radiator switched off on purpose before the month is not expected
  const off = new Set((input.stopped ?? []).filter((s) => s.from <= from).map((s) => s.room));
  const heating = new Set(input.rooms.filter((x) => x.category === 'heating' && !off.has(x.id)).map((x) => x.id));
  const byDay = new Map<string, Set<string>>();
  for (const rec of rawRecords(input.records)) if (heating.has(rec.room) && rec.day >= from) (byDay.get(rec.day) ?? byDay.set(rec.day, new Set()).get(rec.day)!).add(rec.room);
  const active = new Set<string>();
  for (const rec of rawRecords(input.records)) if (heating.has(rec.room) && rec.day < from) active.add(rec.room);
  for (const d of days(from, input.last)) {
    for (const x of byDay.get(d) ?? []) active.add(x);
    if (!active.size) continue;
    res.expected++;
    const got = byDay.get(d) ?? new Set();
    const est = [...got].some((x) => input.estimated.has(`${x}|${d}`));
    if ([...active].some((x) => !got.has(x))) res.missing++;
    else if (est) res.estimated++;
    else res.ok++;
  }
  return res;
}

/** Level of a share of covered days: the thresholds of the year verdicts and of the bars. */
export const coverLevel = (c: number | null): Level => (c === null || c >= 0.98 ? 'good' : c >= 0.9 ? 'fair' : 'poor');

export interface SourceVerdict {
  level: Level;
  /** Covered share over every year of the source (null: nothing expected). */
  overall: number | null;
  /** The year with the lowest share, when it is under 98 %. */
  worst: { year: number; covered: number } | null;
  /** One line: « complet depuis 2022 », « à vérifier : 2024 (89 %) · muet depuis 4 jours ». */
  text: string;
}

/**
 * #387: one line per source at the top of État des données, its detail by year folded below.
 * The level is the worst year's (a single bad year is what one comes to this page to find); a
 * source silent right now is at least « correct ».
 */
export function sourceVerdict(s: SourceQuality): SourceVerdict {
  const exp = s.years.reduce((a, y) => a + y.expected, 0);
  const overall = exp ? s.years.reduce((a, y) => a + y.full + y.estimated, 0) / exp : null;
  let worst: SourceVerdict['worst'] = null;
  for (const y of s.years) {
    const c = covered(y);
    if (c !== null && c < 0.98 && (!worst || c < worst.covered)) worst = { year: y.year, covered: c };
  }
  const level = coverLevel(worst?.covered ?? null);
  const since = s.years.reduce((a, y) => (y.expected && y.year < a ? y.year : a), Infinity);
  const head = worst
    ? `${level === 'poor' ? 'à vérifier' : 'presque complet'} : ${worst.year} (${pctText(worst.covered)})`
    : overall === null
      ? 'aucun jour attendu'
      : `complet depuis ${since}`;
  const ongoing = s.gaps.find((g) => g.ongoing && g.kind !== 'zero');
  const parts = [head, ...(ongoing ? [`muet depuis ${ongoing.days} jour${ongoing.days > 1 ? 's' : ''} (${ongoing.who})`] : [])];
  return { level: ongoing && level === 'good' ? 'fair' : level, overall, worst, text: parts.join(' · ') };
}
