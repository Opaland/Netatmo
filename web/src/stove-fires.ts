// #469: the evenings the wood stove burnt, as the nightly collection read them in the per-room
// half hours (collector/stove.py, detect_fires: the one detection, kept in the encrypted meta,
// meta.stove_fires) — read back here, never trusted (#359). Pure functions, no DOM.
//
//   covered: the days the detection could see (two rooms that witnessed a fire sent their evening);
//   fires:   day -> [first half hour, half hours, witness rooms, smallest rise in tenths of °C].
//
// They choose the days of the stove's wood (wood.ts woodDaily), draw the calendar of the fires
// (Historique › Flambées du poêle) and meet the owner's answers « poêle allumé ce soir ? ».
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const realDay = (d: unknown): d is string => typeof d === 'string' && DAY_RE.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const int = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);

/** Smallest rise (°C) of a witness, as collector/stove.py RISE_MIN (kept equal by tests/test_flambees.py). */
export const RISE_MIN = 0.45;
/** Bounds of what is read back: ten years of evenings at most. */
export const MAX_FIRE_DAYS = 3660;
export const MAX_RANGES = 3660;

export interface Fire {
  /** First half hour of the rise (2 × hour + minute / 30, local). */
  start: number;
  /** Half hours the rooms kept warming at 0 W (the estimated burn). */
  slots: number;
  /** Rooms that showed it. */
  witnesses: number;
  /** Smallest rise of a witness, °C. */
  rise: number;
}
export interface StoveFires {
  covered: [string, string][];
  fires: Map<string, Fire>;
}

/** meta.stove_fires, cleaned: real days, bounded numbers, ranges in order, fires inside them. */
export function parseFires(v: unknown): StoveFires | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const covered: [string, string][] = [];
  for (const r of Array.isArray(o.covered) ? o.covered.slice(0, MAX_RANGES) : []) {
    if (!Array.isArray(r) || r.length !== 2 || !realDay(r[0]) || !realDay(r[1]) || r[0] > r[1]) continue;
    if (covered.length && r[0] <= covered[covered.length - 1][1]) continue; // overlapping or out of order
    covered.push([r[0], r[1]]);
  }
  const fires = new Map<string, Fire>();
  const raw = o.fires && typeof o.fires === 'object' && !Array.isArray(o.fires) ? (o.fires as Record<string, unknown>) : {};
  for (const day of Object.keys(raw).sort().slice(0, MAX_FIRE_DAYS)) {
    const f = raw[day];
    if (!realDay(day) || !Array.isArray(f) || f.length !== 4 || !inRanges(covered, day)) continue;
    const start = int(f[0], 0, 47);
    const slots = int(f[1], 1, 48);
    const witnesses = int(f[2], 1, 100);
    const rise = int(f[3], 0, 400);
    if (start === null || slots === null || witnesses === null || rise === null) continue;
    fires.set(day, { start, slots, witnesses, rise: rise / 10 });
  }
  return { covered, fires };
}

function inRanges(covered: [string, string][], day: string): boolean {
  let lo = 0;
  let hi = covered.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (day < covered[m][0]) hi = m - 1;
    else if (day > covered[m][1]) lo = m + 1;
    else return true;
  }
  return false;
}
/** The detection could see this evening: a fire would have been found. */
export const isCovered = (f: StoveFires, day: string) => inRanges(f.covered, day);

/**
 * How clearly a fire stands out, said in words (a threshold of PRESENTATION: it changes no figure).
 * « nette » when its weakest witness rose twice the threshold or more (well above the noise of the
 * demo, 0.3 °C, collector/stove.py), else « à peine marquée ». More witnesses than two
 * also makes it « nette ». Chosen by judgement; the other path considered, a percentage, would
 * claim a precision the twenty-odd calibration evenings do not have.
 */
export const fireClarity = (f: Fire): 'nette' | 'à peine marquée' => (f.rise >= 2 * RISE_MIN || f.witnesses > 2 ? 'nette' : 'à peine marquée');

/** « 19 h 30 » of a half hour. */
export const slotTime = (i: number) => `${Math.floor(i / 2)} h${i % 2 ? ' 30' : ''}`;
/** « ≈ 3 h 30 » of a number of half hours. */
export function spanText(slots: number): string {
  const h = Math.floor(slots / 2);
  return `≈ ${h ? `${h} h` : ''}${slots % 2 ? (h ? ' 30' : '30 min') : ''}`;
}

/** The owner's answers « poêle allumé ce soir ? », day -> yes / no (kept encrypted on the device). */
export type Answers = Map<string, boolean>;
export const MAX_ANSWERS = 400;
/** The answers read back from the device, cleaned (real days, booleans, the newest kept). */
export function parseAnswers(v: unknown): Answers {
  const out: Answers = new Map();
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  for (const day of Object.keys(o).sort().reverse()) {
    if (out.size >= MAX_ANSWERS) break;
    if (realDay(day) && typeof o[day] === 'boolean') out.set(day, o[day] as boolean);
  }
  return out;
}

export interface Check {
  /** Answers on evenings the detection could see. */
  compared: number;
  agree: number;
  /** « oui » on an evening without a fire found / « non » on an evening with one. */
  missed: string[];
  wrong: string[];
  /** Answers on evenings it could not see (no reading, a room out of reach, a mild spell, not yet collected). */
  unseen: number;
}
/** The detection against the owner's answers: what the confidence on the screen says. */
export function checkAnswers(f: StoveFires, answers: Answers): Check {
  const c: Check = { compared: 0, agree: 0, missed: [], wrong: [], unseen: 0 };
  for (const [day, yes] of [...answers].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!isCovered(f, day)) {
      c.unseen++;
      continue;
    }
    c.compared++;
    const found = f.fires.has(day);
    if (found === yes) c.agree++;
    else (yes ? c.missed : c.wrong).push(day);
  }
  return c;
}
