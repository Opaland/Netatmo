// #453: « Et pour l'eau chaude ? » The water heater's real daily energy (Intuis, per tariff column)
// over its last 365 days, confronted with what the owner could do at the end of life of the
// current tank: lower its setpoint, heat everything in the off-peak hours, or replace it with a
// heat-pump water heater (« thermodynamique ») of a typed COP. Every assumption is typed by the
// owner (sim-inputs.ts); the only value offered is the COP, shown as such and never saved until
// typed. Pure functions, no DOM, no app state: unit-tested in hotwater.test.ts, fuzzed in
// fuzz.test.ts (parseHotWaterInputs).
import { type NumberField, parseNumberFields, payback } from './sim-inputs';

/** One day of the water heater: energy, and its off-peak part when the meter column is known. */
export interface HotWaterDay {
  day: string;
  kwh: number;
  /** kWh in the off-peak column of the readings (≤ kwh), or null when the day has no split. */
  off: number | null;
}

/** Off-peak / peak €/kWh in force on a day (the regulated tariff that day, or the typed prices). */
export interface DayPrice {
  hc: number;
  hp: number;
}

export interface HotWaterInputs {
  cop: number | null; // seasonal COP of the heat-pump water heater, as installed
  thermoKw: number | null; // electric power of the heat-pump water heater, heat-pump mode (kW)
  heaterKw: number | null; // power of the current resistive heater (kW)
  setpoint: number | null; // °C, today
  newSetpoint: number | null; // °C, considered
  coldWater: number | null; // °C of the cold water coming in
  cost: number | null; // € of the heat-pump water heater, fitted
  replacement: number | null; // € of a new resistive tank, fitted (the decision at end of life)
}

/** Field, label, bounds. */
export const HW_FIELDS: NumberField<keyof HotWaterInputs>[] = [
  ['cop', 'COP moyen du chauffe-eau thermodynamique', 1, 6],
  ['thermoKw', 'puissance électrique du thermodynamique', 0.1, 6],
  ['heaterKw', 'puissance du chauffe-eau actuel', 0.1, 12],
  ['setpoint', 'consigne actuelle', 30, 90],
  ['newSetpoint', 'consigne envisagée', 30, 90],
  ['coldWater', 'température de l’eau froide', 0, 30],
  ['cost', 'coût du thermodynamique posé', 1, 20000],
  ['replacement', 'coût d’un chauffe-eau électrique neuf posé', 0, 20000],
];

/** The inputs read back (localStorage, a form): each field null (not typed) or in its bounds. */
export const parseHotWaterInputs = (v: unknown): HotWaterInputs => parseNumberFields(HW_FIELDS, v);

/**
 * The COP offered in the form until the owner types one: the low end of the « 2,5 to 3 times less »
 * of the issue (#453). An assumption, said as such next to the field and under the result.
 */
export const OFFERED_COP = 2.5;

/** One option over the window: electricity, off-peak part, cost (null without prices). */
export interface HwOption {
  kwh: number;
  off: number;
  eur: number | null;
}

export interface HwRow {
  key: 'now' | 'setpoint' | 'offpeak' | 'thermo';
  /** Over one year (the window scaled to 365 days), null when an input it needs is missing. */
  year: HwOption | null;
  /** kWh and € saved a year against today (null: not computable). */
  savedKwh: number | null;
  savedEur: number | null;
  /** Days of the window where the heating would not fit in the off-peak hours of that day. */
  overflowDays: number;
  /** Labels of the inputs this option needs and the owner has not typed. */
  missing: string[];
  /** Years to pay back (cost − replacement) / saving, thermodynamic only. */
  payback: number | null;
}

export interface HwSim {
  days: number; // days of the window with energy (the ones simulated)
  /**
   * #502: days of the window read at 0 kWh (heater switched off, absence…), left out of the
   * simulation: the year is the `days` with energy scaled to 365, so each of them counts as an
   * average day. Said under the result; which rule to keep is the owner's decision (#502).
   */
  zeroDays: number;
  splitDays: number; // of which with the off-peak / peak split read
  share: number | null; // off-peak share of the window (used for the days without split)
  rows: HwRow[];
}

/**
 * The options over the window. `price(day)`: prices in force that day (null: unknown, then no €);
 * `offPeakHours(day)`: hours of off-peak that day (#441, the ranges in force that day), which,
 * times a typed power, caps what can heat in the off-peak hours.
 *
 * - today: the energy read, each kWh at the price of its column that day;
 * - setpoint: E × (new − cold) / (today − cold), same split (losses scaled the same way: simple);
 * - off-peak: everything in the off-peak hours, within power × off-peak hours when the power is typed;
 * - thermodynamic: E / COP with today's split, the off-peak part within thermoKw × off-peak hours.
 */
export function simulateHotWater(
  days: readonly HotWaterDay[],
  i: HotWaterInputs,
  price: (day: string) => DayPrice | null,
  offPeakHours: (day: string) => number,
): HwSim | null {
  const used = days.filter((d) => d.kwh > 0);
  if (!used.length) return null;
  const split = used.filter((d) => d.off !== null);
  const total = split.reduce((s, d) => s + d.kwh, 0);
  const share = total > 0 ? split.reduce((s, d) => s + Math.min(d.kwh, Math.max(0, d.off!)), 0) / total : null;
  const scale = 365 / used.length;
  // every day priced, or the € of the window is unknown (a partial sum would be wrong)
  const priced = share !== null && used.every((d) => price(d.day) !== null);

  /** Run one option: per day, the electricity and its off-peak part (and whether it overflowed). */
  const run = (f: (d: HotWaterDay, offShare: number) => { kwh: number; off: number; over: boolean }): { year: HwOption; overflowDays: number } => {
    let kwh = 0;
    let off = 0;
    let eur = 0;
    let over = 0;
    for (const d of used) {
      const s = d.off !== null ? Math.min(1, Math.max(0, d.off / d.kwh)) : (share ?? 0);
      const r = f(d, s);
      kwh += r.kwh;
      off += r.off;
      if (r.over) over++;
      const p = priced ? price(d.day)! : null;
      if (p) eur += r.off * p.hc + (r.kwh - r.off) * p.hp;
    }
    return { year: { kwh: kwh * scale, off: off * scale, eur: priced ? eur * scale : null }, overflowDays: over };
  };
  /** At most `kw` × the off-peak hours of the day can heat then; the rest goes to the peak hours. */
  const capped = (day: string, want: number, kw: number | null) => {
    if (kw === null) return { off: want, over: false };
    const cap = kw * offPeakHours(day);
    return { off: Math.min(want, cap), over: want > cap + 1e-9 };
  };

  const now = run((d, s) => ({ kwh: d.kwh, off: d.kwh * s, over: false }));
  const vs = (key: HwRow['key'], missing: string[], f: Parameters<typeof run>[0] | null): HwRow => {
    if (missing.length || !f) return { key, year: null, savedKwh: null, savedEur: null, overflowDays: 0, missing, payback: null };
    const r = run(f);
    const savedEur = r.year.eur !== null && now.year.eur !== null ? now.year.eur - r.year.eur : null;
    return { key, year: r.year, savedKwh: now.year.kwh - r.year.kwh, savedEur, overflowDays: r.overflowDays, missing, payback: null };
  };
  const label = (k: keyof HotWaterInputs) => HW_FIELDS.find(([f]) => f === k)![1];
  const need = (...ks: (keyof HotWaterInputs)[]) => ks.filter((k) => i[k] === null).map(label);

  // setpoint: only a lower setpoint above the cold water makes sense
  const spMissing = need('setpoint', 'newSetpoint', 'coldWater');
  const { setpoint: ts, newSetpoint: tn, coldWater: tc } = i;
  const spOk = !spMissing.length && ts! > tc! && tn! > tc! && tn! <= ts!;
  const ratio = spOk ? (tn! - tc!) / (ts! - tc!) : 0;
  const setpoint = vs('setpoint', spMissing.length ? spMissing : spOk ? [] : ['une consigne envisagée plus basse que l’actuelle et au-dessus de l’eau froide'], (d, s) => ({
    kwh: d.kwh * ratio,
    off: d.kwh * ratio * s,
    over: false,
  }));

  const offpeak = vs('offpeak', share === null ? ['la répartition heures pleines / creuses des relevés'] : [], (d) => {
    const c = capped(d.day, d.kwh, i.heaterKw);
    return { kwh: d.kwh, off: c.off, over: c.over };
  });

  const thermo = vs('thermo', need('cop'), (d, s) => {
    const e = d.kwh / i.cop!;
    const c = capped(d.day, e * s, i.thermoKw);
    return { kwh: e, off: c.off, over: c.over };
  });
  if (i.cost !== null && thermo.savedEur !== null) {
    // at the end of life of the tank, what the heat pump costs MORE than a new resistive tank
    const extra = i.cost - (i.replacement ?? 0);
    thermo.payback = extra <= 0 ? 0 : payback(extra, thermo.savedEur);
  }

  return {
    days: used.length,
    zeroDays: days.length - used.length,
    splitDays: split.length,
    share,
    rows: [{ key: 'now', year: now.year, savedKwh: 0, savedEur: now.year.eur === null ? null : 0, overflowDays: 0, missing: [], payback: null }, setpoint, offpeak, thermo],
  };
}

const int = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** « 12 jours à 0 kWh »: the days read at zero (#502). */
export const zeroText = (n: number) => `${int.format(n)} jour${n > 1 ? 's' : ''} à 0\u00a0kWh`;

/**
 * #502: what happens to the days read at 0 kWh, said plainly: they are left out, and the year is
 * the days with energy scaled to 365, so each one counts as an average day. Whether they should
 * count as days of the year (absences included) is the owner's decision, not settled here.
 */
export function zeroAssumption(sim: Pick<HwSim, 'days' | 'zeroDays'>): string {
  const s = sim.zeroDays > 1 ? 's' : '';
  return `${zeroText(sim.zeroDays)} relevé${s} dans la période (chauffe-eau coupé, absence ?) ${sim.zeroDays > 1 ? 'sont écartés' : 'est écarté'} : l’année est ramenée à 365 jours à partir des ${int.format(sim.days)} jours avec de l’énergie, comme si ${sim.zeroDays > 1 ? 'chacun était un jour moyen' : 'c’était un jour moyen'}. Une année avec ses absences consommerait moins, et les économies de chaque piste seraient plus petites d’autant.`;
}
