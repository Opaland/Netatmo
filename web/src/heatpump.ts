// S-2.15: "Et avec une pompe à chaleur air-air ?" Pure functions, no DOM, no app state.
// Direct electric radiators turn 1 kWh of electricity into 1 kWh of heat: the energy signature
// (kWh per day = slope × (balance − T_ext)) is therefore the heat the home needs. A heat pump
// delivers the same heat with heat / COP kWh of electricity.
import { addDays } from './aggregate';
import type { Fit, Weather } from './analysis';

/** Inputs of the heat-pump card kept on this device. */
export interface HeatPumpInputs {
  mode: 'scop' | 'curve';
  low: number;
  high: number;
  share: number; // 0..1
}
export const HP_DEFAULT: HeatPumpInputs = { mode: 'scop', low: 3, high: 4, share: 1 };

/** #359: inputs read back from this device, each field bounded (anything else: its default). */
export function parseHeatPumpInputs(raw: unknown, shares: readonly number[]): HeatPumpInputs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof HeatPumpInputs, unknown>>;
  const ok = (v: unknown): v is number => typeof v === 'number' && v >= 1 && v <= 8;
  return {
    mode: o.mode === 'curve' ? 'curve' : 'scop',
    low: ok(o.low) ? o.low : HP_DEFAULT.low,
    high: ok(o.high) ? o.high : HP_DEFAULT.high,
    share: shares.includes(o.share as number) ? (o.share as number) : HP_DEFAULT.share,
  };
}

/**
 * Indicative COP of an air-air heat pump by outdoor temperature (indoor ≈ 20 °C).
 * Orders of magnitude from manufacturers' data sheets (EN 14825 test points): to be checked
 * against the data sheet of the model quoted.
 */
export const COP_CURVE: [number, number][] = [
  [-15, 1.8],
  [-7, 2.3],
  [2, 3.0],
  [7, 3.8],
  [12, 4.6],
];

/** COP at temperature t: linear between the curve points, flat beyond the ends. */
export function copAt(t: number, curve: [number, number][] = COP_CURVE): number {
  if (t <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [t1, c1] = curve[i];
    if (t <= t1) {
      const [t0, c0] = curve[i - 1];
      return c0 + ((c1 - c0) * (t - t0)) / (t1 - t0);
    }
  }
  return curve[curve.length - 1][1];
}

export type CopMode = { kind: 'scop'; low: number; high: number } | { kind: 'curve'; curve?: [number, number][] };

export interface HeatPumpSim {
  days: number; // days with weather in the season
  heatKwh: number; // heat needed according to the signature (= electricity today)
  share: number; // part of that heat the heat pump would provide
  lowKwh: number; // electricity with the heat pump, best case (rest still direct electric)
  highKwh: number; // worst case
  savedLow: number; // kWh saved, worst case
  savedHigh: number; // kWh saved, best case
  copLow: number; // seasonal COP used, worst case
  copHigh: number; // best case
}

/**
 * Season [from, to] recomputed day by day from the signature: heat = slope × max(0, balance − T).
 * With a seasonal COP range, electricity = share × heat / SCOP + (1 − share) × heat.
 * With the curve, each day uses COP(T) for the best case and COP(T) − 15 % (defrosting, sizing,
 * real use vs data sheet) for the worst case.
 */
export function simulateHeatPump(weather: Weather, from: string, to: string, fit: Fit, mode: CopMode, share = 1): HeatPumpSim | null {
  if (fit.balance === null || fit.slope >= 0 || !(share > 0)) return null;
  const slope = -fit.slope;
  let heat = 0;
  let curveBest = 0;
  let curveWorst = 0;
  let days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const w = weather.get(d);
    if (!w) continue;
    days++;
    const h = slope * Math.max(0, fit.balance - w[2]);
    heat += h;
    if (mode.kind === 'curve') {
      const cop = copAt(w[2], mode.curve);
      curveBest += h / cop;
      curveWorst += h / Math.max(1, cop * 0.85);
    }
  }
  if (!days || heat <= 0) return null;
  const s = Math.min(1, share);
  const [copLow, copHigh] =
    mode.kind === 'scop' ? [Math.max(1, Math.min(mode.low, mode.high)), Math.max(1, mode.low, mode.high)] : [heat / curveWorst, heat / curveBest];
  const highKwh = s * (heat / copLow) + (1 - s) * heat;
  const lowKwh = s * (heat / copHigh) + (1 - s) * heat;
  return { days, heatKwh: heat, share: s, lowKwh, highKwh, savedLow: heat - highKwh, savedHigh: heat - lowKwh, copLow, copHigh };
}
