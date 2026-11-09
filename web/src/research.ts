// S-6.6: anonymised research dataset (hourly when available), for a thermal model of a
// single home without personal data. Built in the browser from the decrypted data, nothing
// is sent anywhere. Format documented in docs/export-recherche.md.
//
// - Rooms become pseudonyms (« Pièce A, B… » by decreasing consumption, as the anonymised
//   report of S-6.4), station modules « Capteur 1, 2… », the outdoor module « exterieur ».
// - Dates are shifted to a relative origin by default: `time` counts hours from midnight
//   (local time) of the first exported day, which is never written.
// - Location: a climate zone chosen by the user, or nothing. No coordinates, no id, no
//   name, no free text (works labels stay on the device; only their nature is exported).
// - The S-6.4 detector (anon.ts `leaks`) checks the result before it is offered.
import type { DayRecord, Meta } from './aggregate';
import type { Hourly, Weather } from './analysis';
import { leaks, pseudonyms } from './anon';
import { textCell } from './csv';
import type { StationHourly } from './comfort';
import type { Station } from './data';
import { WORK_KINDS, type WorkKind } from './works';

export const RESEARCH_FORMAT = 'energie-recherche';
export const RESEARCH_VERSION = 1;
export const RESEARCH_COLUMNS = ['time', 'step_h', 'entity', 'metric', 'value', 'unit'] as const;

export const LICENSES = {
  'CC-BY-4.0': 'Creative Commons Attribution 4.0',
  'CC0-1.0': 'Creative Commons Zero 1.0 (domaine public)',
  'ODbL-1.0': 'Open Database License 1.0',
  'CC-BY-NC-4.0': 'Creative Commons Attribution, pas d’utilisation commerciale 4.0',
} as const;
export type License = keyof typeof LICENSES;

/** French climate zones (RE 2020 / RT 2012). */
export const CLIMATE_ZONES = ['H1a', 'H1b', 'H1c', 'H2a', 'H2b', 'H2c', 'H2d', 'H3'] as const;
export type ClimateZone = (typeof CLIMATE_ZONES)[number];

export interface ResearchOptions {
  license: License;
  shift: boolean; // dates shifted to a relative origin (default)
  zone: ClimateZone | null;
  generated?: Date;
}

export interface ResearchInput {
  meta: Pick<Meta, 'home' | 'rooms'>;
  records: DayRecord[];
  temps: Map<string, Map<string, [number, number | null]>>;
  weather: Weather | null;
  linky: Map<string, number>;
  station: Station | null;
  hourly: Hourly | null; // room -> "YYYY-MM-DDTHH" -> kWh
  stationHourly: StationHourly | null; // module -> "YYYY-MM-DDTHH" -> [°C, %, ppm]
  curve: Map<string, number> | null; // "YYYY-MM-DDTHH:MM" -> Wh (Linky, 30 min)
  surfaces?: Record<string, number>; // room id -> m²
  markers?: { day: string; kind: WorkKind }[];
}

export type ResearchUnit = 'kWh' | '°C' | '%' | 'ppm';
export interface ResearchRow {
  time: number | string; // hours since the origin, or local "YYYY-MM-DDTHH:00" when not shifted
  step_h: 1 | 24;
  entity: string;
  metric: string;
  value: number;
  unit: ResearchUnit;
}

export interface ResearchEntity {
  entity: string;
  kind: 'chauffage' | 'chauffe-eau' | 'logement' | 'exterieur' | 'capteur';
  surface_m2?: number;
}

export interface ResearchDocument {
  format: typeof RESEARCH_FORMAT;
  version: typeof RESEARCH_VERSION;
  license: License;
  license_name: string;
  limits: string[];
  time: { shifted: boolean; origin: string; unit: 'h'; timezone: 'locale' };
  location: { climate_zone: ClimateZone | null };
  generated: string | null; // not written when dates are shifted (it would date the data)
  entities: ResearchEntity[];
  events: { time: number | string; kind: WorkKind; label: string }[];
  openings: null; // window openings: not recorded yet (instant state only, see #162)
  columns: typeof RESEARCH_COLUMNS;
  rows: ResearchRow[];
}

export const LIMITS = [
  'Un seul logement : aucune généralisation possible, ni moyenne, ni tendance nationale.',
  'Énergie des radiateurs et du chauffe-eau mesurée par les appareils Intuis (pas un compteur certifié) ; jours perdus reconstitués depuis les totaux mensuels.',
  'Températures des pièces : moyennes journalières des radiateurs ; heures et capteurs selon le matériel du logement.',
  'Météo extérieure : moyennes journalières (Open-Meteo ou station du logement). Croisée avec une archive météo, elle peut aider à retrouver la région et les dates : ne publiez pas ce fichier avec d’autres indices.',
  'Ouvertures de fenêtres et présence : non disponibles (non relevées dans la durée).',
];

const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (v: number, digits: number) => {
  const r = Number(v.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function researchDocument(input: ResearchInput, opts: ResearchOptions): ResearchDocument {
  const rooms = input.meta.rooms.filter((r) => r.category !== 'ignore');
  const total = new Map<string, number>();
  for (const r of input.records) total.set(r.room, (total.get(r.room) ?? 0) + r.kwh);
  const kept = rooms.filter((r) => total.has(r.id) || input.temps.has(r.id) || input.hourly?.has(r.id));
  const names = pseudonyms(kept.map((r) => ({ id: r.id, category: r.category, now: total.get(r.id) ?? 0, before: 0 })));

  // Station modules: the outdoor one is « exterieur_station », the others « Capteur n » (station order).
  const modules = new Map<string, string>();
  let n = 0;
  for (const [id, m] of Object.entries(input.station?.modules ?? {})) {
    modules.set(id, m.type === 'NAModule1' || !m.indoor ? 'exterieur_station' : `Capteur ${++n}`);
  }

  // Rows are gathered with their real day, then dated from the origin (first day with a value).
  const raw: (Omit<ResearchRow, 'time'> & { day: string; hour: number })[] = [];
  const push = (day: string, hour: number, step: 1 | 24, entity: string, metric: string, v: unknown, unit: ResearchUnit, digits: number) => {
    if (ok(v) && /^\d{4}-\d{2}-\d{2}$/.test(day)) raw.push({ day, hour, step_h: step, entity, metric, value: round(v, digits), unit });
  };
  const hourKey = (k: string): [string, number] | null => {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})/.exec(k);
    return m ? [m[1], Number(m[2])] : null;
  };

  // Daily values
  for (const r of input.records) if (names.has(r.room)) push(r.day, 0, 24, names.get(r.room)!, 'energy', r.kwh, 'kWh', 3);
  for (const [room, m] of input.temps) {
    const name = names.get(room);
    if (!name) continue;
    for (const [d, [measured, setpoint]] of m) {
      push(d, 0, 24, name, 'temperature', measured, '°C', 2);
      push(d, 0, 24, name, 'setpoint', setpoint, '°C', 2);
    }
  }
  for (const [d, k] of input.linky) push(d, 0, 24, 'logement', 'energy', k, 'kWh', 3);
  for (const [d, [min, max, mean]] of input.weather ?? []) {
    push(d, 0, 24, 'exterieur', 'temperature_min', min, '°C', 2);
    push(d, 0, 24, 'exterieur', 'temperature_max', max, '°C', 2);
    push(d, 0, 24, 'exterieur', 'temperature_mean', mean, '°C', 2);
  }
  // Hourly values
  for (const [room, m] of input.hourly ?? []) {
    const name = names.get(room);
    if (!name) continue;
    for (const [k, v] of m) {
      const h = hourKey(k);
      if (h) push(h[0], h[1], 1, name, 'energy', v, 'kWh', 4);
    }
  }
  const linkyHours = new Map<string, number>();
  for (const [k, wh] of input.curve ?? []) {
    const hk = k.slice(0, 13);
    if (ok(wh)) linkyHours.set(hk, (linkyHours.get(hk) ?? 0) + wh / 1000);
  }
  for (const [k, v] of linkyHours) {
    const h = hourKey(k);
    if (h) push(h[0], h[1], 1, 'logement', 'energy', v, 'kWh', 4);
  }
  for (const [id, m] of input.stationHourly ?? []) {
    const name = modules.get(id);
    if (!name) continue;
    for (const [k, [t, hum, co2]] of m) {
      const h = hourKey(k);
      if (!h) continue;
      push(h[0], h[1], 1, name, 'temperature', t, '°C', 2);
      push(h[0], h[1], 1, name, 'humidity', hum, '%', 1);
      push(h[0], h[1], 1, name, 'co2', co2, 'ppm', 0);
    }
  }
  const origin = raw.length ? raw.reduce((m, r) => (r.day < m ? r.day : m), raw[0].day) : '1970-01-01';
  const o = dayMs(origin);
  // Local hours, every day counted as 24 h (DST days included): see docs/export-recherche.md.
  const at = (day: string, hour = 0): number | string =>
    opts.shift ? Math.round((dayMs(day) - o) / 3_600_000) + hour : `${day}T${String(hour).padStart(2, '0')}:00`;
  const rows: ResearchRow[] = raw.map(({ day, hour, ...r }) => ({ time: at(day, hour), ...r }));
  const key = (t: number | string) => (typeof t === 'number' ? String(t).padStart(12, '0') : t);
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  rows.sort((a, b) => cmp(key(a.time), key(b.time)) || b.step_h - a.step_h || cmp(a.entity, b.entity) || cmp(a.metric, b.metric));

  const entities: ResearchEntity[] = kept
    .map((r) => ({
      entity: names.get(r.id)!,
      kind: (r.category === 'water_heater' ? 'chauffe-eau' : 'chauffage') as ResearchEntity['kind'],
      ...(input.surfaces?.[r.id] ? { surface_m2: input.surfaces[r.id] } : {}),
    }))
    .sort((a, b) => cmp(a.entity, b.entity));
  if (input.linky.size || input.curve?.size) entities.push({ entity: 'logement', kind: 'logement' });
  if (input.weather?.size) entities.push({ entity: 'exterieur', kind: 'exterieur' });
  for (const name of new Set(modules.values())) entities.push({ entity: name, kind: name === 'exterieur_station' ? 'exterieur' : 'capteur' });

  return {
    format: RESEARCH_FORMAT,
    version: RESEARCH_VERSION,
    license: opts.license,
    license_name: LICENSES[opts.license],
    limits: LIMITS,
    time: {
      shifted: opts.shift,
      origin: opts.shift ? 'time = 0 : minuit (heure locale) du premier jour exporté, date non communiquée' : 'dates réelles, heure locale',
      unit: 'h',
      timezone: 'locale',
    },
    location: { climate_zone: opts.zone },
    generated: opts.shift ? null : (opts.generated ?? new Date()).toISOString(),
    entities,
    events: (input.markers ?? [])
      .filter((m) => m.day >= origin)
      .map((m) => ({ time: at(m.day), kind: m.kind, label: WORK_KINDS[m.kind] })),
    openings: null,
    columns: RESEARCH_COLUMNS,
    rows,
  };
}

/** CSV with a commented header (« # »): licence, limits, time origin, entities, works. */
export function toResearchCsv(doc: ResearchDocument, withRows = true): string {
  const head = [
    `# ${doc.format} v${doc.version} — jeu de données de recherche anonymisé, un seul logement chauffé à l'électricité`,
    `# Licence : ${doc.license} (${doc.license_name}), choisie par la personne qui a exporté ces données`,
    ...doc.limits.map((l) => `# Limite : ${l}`),
    `# Temps : ${doc.time.origin} ; step_h = 1 (valeur horaire) ou 24 (valeur journalière, time = minuit)`,
    `# Localisation : ${doc.location.climate_zone ? `zone climatique ${doc.location.climate_zone}` : 'non communiquée'}`,
    `# Entités : ${doc.entities.map((e) => `${e.entity} (${e.kind}${e.surface_m2 ? `, ${e.surface_m2} m²` : ''})`).join(' ; ')}`,
    ...(doc.events.length ? [`# Travaux : ${doc.events.map((e) => `time ${e.time} ${e.label}`).join(' ; ')}`] : []),
    '# Documentation : docs/export-recherche.md',
  ];
  const lines = [...head, RESEARCH_COLUMNS.join(',')];
  for (const r of withRows ? doc.rows : []) lines.push([String(r.time), String(r.step_h), textCell(r.entity, ','), r.metric, String(r.value), r.unit].join(','));
  return lines.join('\n') + '\n';
}

/** Everything that must never appear: home name and id, room and module names and ids. */
export function researchSecrets(input: Pick<ResearchInput, 'meta' | 'station'>): string[] {
  const out: string[] = [input.meta.home.id, input.meta.home.name];
  for (const r of input.meta.rooms) out.push(r.id, r.name);
  for (const [id, m] of Object.entries(input.station?.modules ?? {})) out.push(id, m.name);
  return out.filter(Boolean);
}

/**
 * S-6.4 detector, plus real dates when they were meant to be shifted. A name that is one of
 * the words the export writes itself (`template`: the same document without rows, e.g. a
 * module called « exterieur ») cannot be told apart and is not reported.
 */
export function researchLeaks(text: string, input: Pick<ResearchInput, 'meta' | 'station'>, shifted: boolean, template = ''): string[] {
  const own = template + ' energy temperature setpoint humidity co2 time step_h entity metric value unit kWh';
  const found = leaks(text, researchSecrets(input).filter((s) => !leaks(own, [s]).length));
  if (shifted) {
    const date = /\b(19|20)\d{2}-\d{2}-\d{2}/.exec(text);
    if (date) found.push(`date ${date[0]}`);
  }
  return found;
}

export const researchFileName = (ext: 'csv' | 'json') => `energie-recherche-v${RESEARCH_VERSION}.${ext}`;
