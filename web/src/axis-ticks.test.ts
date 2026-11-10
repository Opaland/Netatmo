// #398: value-axis labels. « 21, 21, 20, 20, 19, 19 » on a half-degree axis: the old formatter
// wrote one decimal only under 10. Every label of an axis must differ from the others, whatever
// the unit and the range.
import { describe, expect, it } from 'vitest';
import { tickDecimals, tickFmt } from './charts';

/** Ticks the way ECharts lays a value axis: multiples of a nice step, summed in floating point. */
const ticks = (min: number, max: number, step: number) => {
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step / 1e6; v += step) out.push(v);
  return out;
};

describe('#398 étiquettes des axes de valeurs', () => {
  const cases: [string, number, number, number][] = [
    ['°C, salon 19–21,5', 19, 21.5, 0.5],
    ['°C, 18–22 au pas de 0,2', 18, 22, 0.2],
    ['°C, écart radiateur −0,6–0,4', -0.6, 0.4, 0.1],
    ['°C, extérieur −5–30', -5, 30, 5],
    ['ppm, 400–1 600', 400, 1600, 200],
    ['%, humidité 40–70 au pas de 2,5', 40, 70, 2.5],
    ['kWh, 0–1 500', 0, 1500, 250],
    ['kWh, 0–2 au pas de 0,25', 0, 2, 0.25],
    ['€, 0–0,30 au pas de 0,05', 0, 0.3, 0.05],
    ['€, 0–12 000', 0, 12000, 2000],
  ];
  for (const [name, min, max, step] of cases)
    it(`${name} : toutes les étiquettes diffèrent`, () => {
      const labels = ticks(min, max, step).map(tickFmt);
      expect(labels.length).toBeGreaterThan(2);
      expect(new Set(labels).size).toBe(labels.length);
    });

  it('écrit la précision du pas, en français, avec le signe moins typographique', () => {
    expect([19, 19.5, 20, 20.5, 21].map(tickFmt)).toEqual(['19', '19,5', '20', '20,5', '21']);
    expect(tickFmt(1500)).toBe('1 500');
    expect(tickFmt(-0.2)).toBe('−0,2');
    expect(tickFmt(0.1 + 0.2)).toBe('0,3');
    expect(tickFmt(0.25)).toBe('0,25');
    expect(tickDecimals(20)).toBe(0);
    expect(tickDecimals(0.05)).toBe(2);
  });
});
