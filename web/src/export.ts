// S-9.7: "long" export (one row per day, entity and metric), JSON and CSV, for Home Assistant,
// Node-RED or a spreadsheet. Built in the browser from the decrypted dataset: nothing is sent
// anywhere. Format documented in docs/export-long.md, JSON Schema in docs/export-long.schema.json.
// Loaded with import() from the menu, so it does not weigh on the entry chunk.
import type { Dataset } from './data';
import { textCell, untextCell } from './csv';

export const LONG_FORMAT = 'intuis-history-long';
/** Bump on any incompatible change (column, metric or unit renamed), and update the schema. */
export const LONG_VERSION = 1;
export const LONG_COLUMNS = ['date', 'source', 'entity', 'metric', 'value', 'unit'] as const;

export type LongSource = 'intuis' | 'linky' | 'weather' | 'station';
export type LongUnit = 'kWh' | '°C' | 'kVA' | '%' | 'ppm';

export interface LongRow {
  date: string; // YYYY-MM-DD, local day of the home
  source: LongSource;
  entity: string;
  metric: string;
  value: number;
  unit: LongUnit;
}

export interface LongDocument {
  format: typeof LONG_FORMAT;
  version: typeof LONG_VERSION;
  generated: string;
  timezone: string;
  first_day: string | null;
  last_day: string | null;
  columns: typeof LONG_COLUMNS;
  rows: LongRow[];
}

/** What the export reads: a decrypted Dataset fits. */
export type LongInput = Pick<Dataset, 'meta' | 'records' | 'temps' | 'weather' | 'linky' | 'pmax' | 'station'>;

const round = (v: number, digits: number) => {
  const r = Number(v.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Every daily value of the dataset, sorted by date, source, entity, metric. */
export function longRows(ds: LongInput): LongRow[] {
  const rows: LongRow[] = [];
  const push = (date: string, source: LongSource, entity: string, metric: string, v: unknown, unit: LongUnit, digits: number) => {
    if (ok(v) && /^\d{4}-\d{2}-\d{2}$/.test(date)) rows.push({ date, source, entity, metric, value: round(v, digits), unit });
  };
  const rooms = new Map(ds.meta.rooms.filter((r) => r.category !== 'ignore').map((r) => [r.id, r.name || r.id]));
  for (const r of ds.records) if (rooms.has(r.room)) push(r.day, 'intuis', rooms.get(r.room)!, 'energy', r.kwh, 'kWh', 3);
  for (const [room, days] of ds.temps) {
    const name = rooms.get(room);
    if (!name) continue;
    for (const [d, [measured, setpoint]] of days) {
      push(d, 'intuis', name, 'temperature', measured, '°C', 2);
      push(d, 'intuis', name, 'setpoint', setpoint, '°C', 2);
    }
  }
  for (const [d, kwh] of ds.linky) push(d, 'linky', 'logement', 'energy', kwh, 'kWh', 3);
  for (const [d, kva] of ds.pmax) push(d, 'linky', 'logement', 'power_max', kva, 'kVA', 2);
  for (const [d, [min, max, mean]] of ds.weather ?? []) {
    push(d, 'weather', 'exterieur', 'temperature_min', min, '°C', 2);
    push(d, 'weather', 'exterieur', 'temperature_max', max, '°C', 2);
    push(d, 'weather', 'exterieur', 'temperature_mean', mean, '°C', 2);
  }
  for (const [id, days] of Object.entries(ds.station?.daily ?? {})) {
    const name = ds.station!.modules[id]?.name || id;
    for (const [d, [min, max, mean, hum, co2]] of Object.entries(days)) {
      push(d, 'station', name, 'temperature_min', min, '°C', 2);
      push(d, 'station', name, 'temperature_max', max, '°C', 2);
      push(d, 'station', name, 'temperature_mean', mean, '°C', 2);
      push(d, 'station', name, 'humidity', hum, '%', 1);
      push(d, 'station', name, 'co2', co2, 'ppm', 0);
    }
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return rows.sort((a, b) => cmp(a.date, b.date) || cmp(a.source, b.source) || cmp(a.entity, b.entity) || cmp(a.metric, b.metric));
}

export function longDocument(ds: LongInput, generated = new Date()): LongDocument {
  const rows = longRows(ds);
  return {
    format: LONG_FORMAT,
    version: LONG_VERSION,
    generated: generated.toISOString(),
    timezone: ds.meta.home.timezone || 'Europe/Paris',
    first_day: rows[0]?.date ?? null,
    last_day: rows[rows.length - 1]?.date ?? null,
    columns: LONG_COLUMNS,
    rows,
  };
}

/** RFC 4180: comma separator, text cells neutralised against formulas (#235), decimal point, quotes only when needed, UTF-8 without BOM. */
export function toLongCsv(rows: LongRow[]): string {
  const lines = [LONG_COLUMNS.join(',')];
  for (const r of rows) lines.push([r.date, r.source, textCell(r.entity, ','), r.metric, String(r.value), r.unit].join(','));
  return lines.join('\n') + '\n';
}

/** Minimal RFC 4180 reader (tests and round trips). */
export function parseLongCsv(text: string): LongRow[] {
  const records: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(cur), (cur = '');
    else if (c === '\n') row.push(cur), records.push(row), (row = []), (cur = '');
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) row.push(cur), records.push(row);
  const [head, ...body] = records;
  if (head?.join(',') !== LONG_COLUMNS.join(',')) throw new Error('en-tête CSV inattendu');
  return body.map(([date, source, entity, metric, value, unit]) => ({
    date,
    source: source as LongSource,
    entity: untextCell(entity),
    metric,
    value: Number(value),
    unit: unit as LongUnit,
  }));
}

export const longFileName = (ext: 'csv' | 'json', d = new Date()) =>
  `energie-long-v${LONG_VERSION}-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.${ext}`;

/** Browser side: build the file locally and hand it to the user (never uploaded). Returns the row count. */
export function downloadLong(ds: LongInput, kind: 'csv' | 'json'): number {
  const doc = longDocument(ds);
  const blob =
    kind === 'csv'
      ? new Blob([toLongCsv(doc.rows)], { type: 'text/csv;charset=utf-8' })
      : new Blob([JSON.stringify(doc)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = longFileName(kind);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return doc.rows.length;
}
