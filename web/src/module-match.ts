// #467: a station module named after another place (« Cave ») may sit in a heated room. When an
// unlinked indoor module follows a room's radiator probe closely for several days, the app offers
// to link them; once linked, the module's reading is the room's (effectiveMapping, comfort.ts).
// Pure rules, no logging: room and module names never reach a journal.

/** Days looked at, ending at the last day of data: long enough for a few changes of weather, short
 * enough that a module moved last month is judged where it is now. */
export const MATCH_DAYS = 28;
/** Fewest days with both readings: below that, a few lucky days could pass the other tests. */
export const MATCH_MIN_DAYS = 10;
/**
 * Thresholds, chosen by judgement (AGENTS.md §2: they gate a proposal the person confirms or
 * declines; nothing computed changes until they accept) and to be checked on real data:
 * - MATCH_MIN_R: the day-to-day ups and downs must go together (Pearson r ≥ 0,8). Two rooms of the
 *   same house share the weather, but their own setpoints, sun and windows should keep r lower.
 *   0,9 was considered: it leaves less room to a probe placed against the radiator, which may
 *   overshoot on heating days (a hypothesis, not measured).
 * - MATCH_MAX_SD: the gap between the two readings stays steady from day to day (spread ≤ 0,5 °C).
 *   Half of STABLE_SD (comfort.ts), the spread allowed for a probe/module pair already linked:
 *   here we must be surer, nothing has been declared yet.
 * - MATCH_MAX_OFFSET: the probe reads 1 to 2 °C too low in the reported case (#467); 3 °C leaves
 *   room for a probe right against the radiator, while a cellar or an unheated room stays out.
 * Rejected: names (already the suggestion of suggestMapping), a single day (a heating relaunch looks
 * the same everywhere), hourly data (loaded on demand only: the daily means are always there).
 */
export const MATCH_MIN_R = 0.8;
export const MATCH_MAX_SD = 0.5;
export const MATCH_MAX_OFFSET = 3;

export interface MatchStats {
  /** Days with both readings. */
  n: number;
  /** Pearson correlation of the daily means. */
  r: number;
  /** Mean of module − probe, °C (positive: the probe reads lower). */
  offset: number;
  /** Day-to-day spread of that gap, °C. */
  sd: number;
}

export interface ModuleMatch extends MatchStats {
  room: string;
  module: string;
}

type Probe = Map<string, [number, number | null]>;
type Daily = Record<string, (number | null)[]>;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Daily mean of the probe vs daily mean of the module (column 2) over [from, to]; null without days. */
export function matchStats(probe: Probe | undefined, module: Daily | undefined, from: string, to: string): MatchStats | null {
  if (!probe || !module) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [d, v] of probe) {
    if (d < from || d > to) continue;
    const s = Object.hasOwn(module, d) ? module[d]?.[2] : undefined;
    if (!num(v?.[0]) || !num(s)) continue;
    xs.push(v[0]);
    ys.push(s);
  }
  const n = xs.length;
  if (!n) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  let sdd = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
    sdd += (ys[i] - xs[i] - (my - mx)) ** 2;
  }
  // a flat series says nothing about following: r = 0, never a match
  const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  return { n, r, offset: my - mx, sd: Math.sqrt(sdd / Math.max(1, n - 1)) };
}

/** True when the module follows the probe closely enough to propose linking them. */
export function follows(s: MatchStats): boolean {
  return s.n >= MATCH_MIN_DAYS && s.r >= MATCH_MIN_R && s.sd <= MATCH_MAX_SD && Math.abs(s.offset) <= MATCH_MAX_OFFSET;
}

/**
 * Proposals: every (room, module) pair, among the rooms and modules given (unlinked ones), that
 * follows. Ambiguous pairs are dropped: a module following two rooms, or a room followed by two
 * modules, is proposed nowhere (better silent than wrong; the manual choice stays).
 */
export function trackingModules(
  probes: Map<string, Probe>,
  rooms: string[],
  daily: Record<string, Daily>,
  modules: string[],
  from: string,
  to: string,
): ModuleMatch[] {
  const hits: ModuleMatch[] = [];
  for (const room of rooms)
    for (const module of modules) {
      const s = matchStats(probes.get(room), Object.hasOwn(daily, module) ? daily[module] : undefined, from, to);
      if (s && follows(s)) hits.push({ room, module, ...s });
    }
  const count = (f: (h: ModuleMatch) => string) => {
    const c = new Map<string, number>();
    for (const h of hits) c.set(f(h), (c.get(f(h)) ?? 0) + 1);
    return c;
  };
  const byRoom = count((h) => h.room);
  const byModule = count((h) => h.module);
  return hits.filter((h) => byRoom.get(h.room) === 1 && byModule.get(h.module) === 1);
}

/** Pair key of a declined proposal (kept in the state, list of « room module »). */
export const pairKey = (room: string, module: string) => `${room} ${module}`;

/** Declined pairs read back from the saved state: anything but a list of strings is ignored. */
export function declinedPairs(v: unknown): Set<string> {
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
}

/**
 * New saved mapping after linking `room` to `module` ('' = no module): the links in force are
 * frozen first, so that this choice does not re-suggest a module elsewhere (S-3.8).
 */
export function linkRoom(current: Map<string, string>, rooms: string[], room: string, module: string): Record<string, string> {
  const out: Record<string, string> = Object.fromEntries(rooms.map((r) => [r, current.get(r) ?? '']));
  out[room] = module;
  return out;
}
