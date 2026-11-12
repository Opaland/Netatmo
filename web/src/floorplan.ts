// #202: the plan of the house, drawn by the owner: rooms as rectangles on a grid, one plan per
// level (ground floor and first floor by default, the cellar optional), and where the devices are
// (radiators, water heater, station modules, plugs, meter, shutters). A plan room may be linked to
// an Intuis room and to a station module, which is how the plan reads the data.
//
// Where it lives: like the other household settings, sealed in the browser into the repository
// secret FLOOR_PLAN_JSON, copied by the nightly collection into the encrypted meta (meta.floor_plan);
// this device's draft is a sealed note (views/plan-state.ts). Never in clear, never an address:
// the plan holds rectangles, short names and ids, nothing that places the house.
//
// This module is the one reader of a plan (AGENTS.md §5): whatever comes back (meta, sealed note,
// a hand-edited secret) goes through parsePlan, and planJson writes the one canonical form.
// Pure functions, no DOM.

/** Side of a cell of the grid, in metres: the editor moves and sizes by whole cells. */
export const CELL_M = 0.5;
/** Cells per side of a level: 48 × 0.5 m = 24 m, more than a house. */
export const GRID = 48;
export const MAX_ROOMS = 30;
export const MAX_DEVICES = 60;
export const MAX_NAME = 30;
const MAX_REF = 40;

export type LevelId = 'cave' | 'rdc' | 'etage';
/** Levels, from the bottom up (the order of the tabs). The owner's house: ground floor and first floor; the cellar is added on demand. */
export const LEVELS: Record<LevelId, string> = { cave: 'Cave', rdc: 'Rez-de-chaussée', etage: 'Étage' };
export const LEVEL_ORDER: LevelId[] = ['cave', 'rdc', 'etage'];
export const DEFAULT_LEVELS: LevelId[] = ['rdc', 'etage'];

export type DeviceKind = 'radiateur' | 'chauffe-eau' | 'station' | 'prise' | 'compteur' | 'volet';
/** Name of a kind and its mark on the plan (two letters at most, read with the table). */
export const DEVICE_KINDS: Record<DeviceKind, { label: string; mark: string }> = {
  radiateur: { label: 'Radiateur', mark: 'R' },
  'chauffe-eau': { label: 'Chauffe-eau', mark: 'CE' },
  station: { label: 'Module de la station', mark: 'S' },
  prise: { label: 'Prise mesurée', mark: 'P' },
  compteur: { label: 'Compteur Linky', mark: 'L' },
  volet: { label: 'Volet', mark: 'V' },
};

export interface PlanRoom {
  id: string;
  name: string;
  /** Top-left cell and size, in cells (CELL_M). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Linked Intuis room (raw id), when there is one. */
  room?: string;
  /** Linked station module (its key), when there is one. */
  module?: string;
}
export interface PlanDevice {
  id: string;
  kind: DeviceKind;
  /** What it is among the known devices (an Intuis room, a module, a plug…); '' when not said. */
  ref: string;
  /** The cell it sits in. */
  x: number;
  y: number;
}
export interface PlanLevel {
  id: LevelId;
  rooms: PlanRoom[];
  devices: PlanDevice[];
}
export interface FloorPlan {
  levels: PlanLevel[];
}

/** A new plan: the default levels, empty. */
export const emptyPlan = (): FloorPlan => ({ levels: DEFAULT_LEVELS.map((id) => ({ id, rooms: [], devices: [] })) });

const ID = /^[a-z0-9-]{1,12}$/;
const REF = new RegExp(`^[A-Za-z0-9_:.-]{1,${MAX_REF}}$`);
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const own = (o: Record<string, unknown>, k: string) => (Object.hasOwn(o, k) ? o[k] : undefined);
/** A whole number in [lo, hi], else null (no rounding of a value that was not one). */
const int = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const ref = (v: unknown) => (typeof v === 'string' && REF.test(v) ? v : undefined);

/** A name as shown: no control character nor half surrogate pair, trimmed, MAX_NAME characters at most. */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.replace(LONE, '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, MAX_NAME).join('').trim();
}

function parseRoom(v: unknown): PlanRoom | null {
  const o = obj(v);
  if (!o) return null;
  const id = own(o, 'id');
  const x = int(own(o, 'x'), 0, GRID - 1);
  const y = int(own(o, 'y'), 0, GRID - 1);
  if (typeof id !== 'string' || !ID.test(id) || x === null || y === null) return null;
  const w = int(own(o, 'w'), 1, GRID - x);
  const h = int(own(o, 'h'), 1, GRID - y);
  if (w === null || h === null) return null;
  const room = ref(own(o, 'room'));
  const module = ref(own(o, 'module'));
  return { id, name: cleanName(own(o, 'name')), x, y, w, h, ...(room ? { room } : {}), ...(module ? { module } : {}) };
}

function parseDevice(v: unknown): PlanDevice | null {
  const o = obj(v);
  if (!o) return null;
  const id = own(o, 'id');
  const kind = own(o, 'kind');
  const x = int(own(o, 'x'), 0, GRID - 1);
  const y = int(own(o, 'y'), 0, GRID - 1);
  if (typeof id !== 'string' || !ID.test(id) || typeof kind !== 'string' || !Object.hasOwn(DEVICE_KINDS, kind) || x === null || y === null) return null;
  return { id, kind: kind as DeviceKind, ref: ref(own(o, 'ref')) ?? '', x, y };
}

/**
 * The plan read back (meta, sealed note, secret written by hand): what is valid is kept, the rest
 * dropped (an unknown level, a room out of the grid, an id seen twice); null when no level is left.
 */
export function parsePlan(v: unknown): FloorPlan | null {
  const o = obj(v);
  const raw = o ? own(o, 'levels') : undefined;
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const fresh = (id: string) => !seen.has(id) && !!seen.add(id);
  const byId = new Map<LevelId, PlanLevel>();
  for (const l of raw.slice(0, LEVEL_ORDER.length * 2)) {
    const lo = obj(l);
    const id = lo ? own(lo, 'id') : undefined;
    if (!lo || typeof id !== 'string' || !Object.hasOwn(LEVELS, id) || byId.has(id as LevelId)) continue;
    const rooms: PlanRoom[] = [];
    for (const r of Array.isArray(own(lo, 'rooms')) ? (own(lo, 'rooms') as unknown[]).slice(0, MAX_ROOMS * 2) : []) {
      const p = parseRoom(r);
      if (p && rooms.length < MAX_ROOMS && fresh(p.id)) rooms.push(p);
    }
    const devices: PlanDevice[] = [];
    for (const d of Array.isArray(own(lo, 'devices')) ? (own(lo, 'devices') as unknown[]).slice(0, MAX_DEVICES * 2) : []) {
      const p = parseDevice(d);
      if (p && devices.length < MAX_DEVICES && fresh(p.id)) devices.push(p);
    }
    byId.set(id as LevelId, { id: id as LevelId, rooms, devices });
  }
  if (!byId.size) return null;
  return { levels: LEVEL_ORDER.filter((id) => byId.has(id)).map((id) => byId.get(id)!) };
}

/** The canonical text of a plan (fields in a fixed order): what is sealed, and how two plans compare. */
export function planJson(p: FloorPlan): string {
  const c = parsePlan(p) ?? emptyPlan();
  return JSON.stringify({
    levels: c.levels.map((l) => ({
      id: l.id,
      rooms: l.rooms.map((r) => ({ id: r.id, name: r.name, x: r.x, y: r.y, w: r.w, h: r.h, ...(r.room ? { room: r.room } : {}), ...(r.module ? { module: r.module } : {}) })),
      devices: l.devices.map((d) => ({ id: d.id, kind: d.kind, ref: d.ref, x: d.x, y: d.y })),
    })),
  });
}

/** The plan room a cell falls in (the last drawn wins, as on the screen); undefined: in no room. */
export function roomAt(level: PlanLevel, x: number, y: number): PlanRoom | undefined {
  return [...level.rooms].reverse().find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}

/** Pairs of rooms of a level that overlap (said by the editor, not refused: a plan is a sketch). */
export function overlaps(level: PlanLevel): [PlanRoom, PlanRoom][] {
  const out: [PlanRoom, PlanRoom][] = [];
  level.rooms.forEach((a, i) =>
    level.rooms.slice(i + 1).forEach((b) => {
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push([a, b]);
    }),
  );
  return out;
}

/** Cells used by a level (at least one room or device): the plan is drawn on this box only. */
export function extent(level: PlanLevel): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const r of level.rooms) (w = Math.max(w, r.x + r.w)), (h = Math.max(h, r.y + r.h));
  for (const d of level.devices) (w = Math.max(w, d.x + 1)), (h = Math.max(h, d.y + 1));
  return { w, h };
}

/** An id not used anywhere in the plan, `prefix` + a number. */
export function freeId(p: FloorPlan, prefix: 'p' | 'a'): string {
  const used = new Set(p.levels.flatMap((l) => [...l.rooms.map((r) => r.id), ...l.devices.map((d) => d.id)]));
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

/** Number of classes of the plan's colour ramp (--seq-1 … --seq-5). */
export const HEAT_CLASSES = 5;
const MID = Math.ceil(HEAT_CLASSES / 2);
/**
 * The classes of a heat map: HEAT_CLASSES equal steps between the lowest and the highest value
 * shown (one scale for every level, so that two levels compare). Equal steps, not quantiles: a
 * room twice as high reads twice as far up the ramp; with a handful of rooms, quantiles would
 * stretch a small gap. When every value is the same, one class (the middle). Returns, for each
 * value, its class from 1 to HEAT_CLASSES (null stays null), and the bounds of each class used.
 */
export interface HeatBound {
  cls: number;
  lo: number;
  hi: number;
}
export function heatClasses(values: (number | null)[]): { classes: (number | null)[]; bounds: HeatBound[] } {
  const ok = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!ok.length) return { classes: values.map(() => null), bounds: [] };
  const lo = Math.min(...ok);
  const hi = Math.max(...ok);
  if (hi === lo) return { classes: values.map((v) => (v === null || !Number.isFinite(v) ? null : MID)), bounds: [{ cls: MID, lo, hi }] };
  const step = (hi - lo) / HEAT_CLASSES;
  const classOf = (v: number) => Math.min(HEAT_CLASSES, 1 + Math.floor((v - lo) / step));
  return {
    classes: values.map((v) => (v === null || !Number.isFinite(v) ? null : classOf(v))),
    bounds: Array.from({ length: HEAT_CLASSES }, (_, i) => ({ cls: i + 1, lo: lo + i * step, hi: i === HEAT_CLASSES - 1 ? hi : lo + (i + 1) * step })),
  };
}
