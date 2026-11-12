// #464: the degree days — base, method and source said, a short year never passed as a mild one,
// and the same rule in the app and in the collector (AGENTS.md §5).
import { describe, expect, it } from 'vitest';
import { DJU_BASE, type Weather, dju } from './analysis';
import { djuMethodText, djuSpan, weatherSourceLabel, yearCold } from './dju';
import { addDays } from './aggregate';
import { GLOSSARY } from './plain';

const fsName = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, enc: 'utf8') => string };
const root = new URL('../../', import.meta.url);

/** A year of constant days [min, max]: each one is 18 − (min + max) / 2 degree days. */
function year(y: number, min: number, max: number, skip: (d: string) => boolean = () => false): Weather {
  const w: Weather = new Map();
  for (let d = `${y}-01-01`; d <= `${y}-12-31`; d = addDays(d, 1)) if (!skip(d)) w.set(d, [min, max, (min + max) / 2]);
  return w;
}

describe('degrés-jours (#464)', () => {
  it('méthode météo : base 18 °C, moyenne du minimum et du maximum, zéro quand il fait plus doux', () => {
    expect(DJU_BASE).toBe(18);
    expect(dju([2, 10, 99])).toBe(12); // the mean column is NOT used: (2 + 10) / 2 = 6
    expect(dju([15, 25, 0])).toBe(0);
    expect(dju([-4, 0, 0])).toBe(20);
  });

  it('la même base dans le collecteur (collector/weather.py)', () => {
    const py = readFileSync(new URL('collector/weather.py', root), 'utf8');
    const m = py.match(/^DJU_BASE = (\d+(?:\.\d+)?)$/m);
    expect(m, 'DJU_BASE introuvable dans collector/weather.py').not.toBeNull();
    expect(Number(m![1])).toBe(DJU_BASE);
    expect(py).toMatch(/return max\(0\.0, base - \(tmin \+ tmax\) \/ 2\)/);
  });

  it('la phrase dit la base, la méthode et la source', () => {
    const om = djuMethodText('open-meteo');
    expect(om).toMatch(/base 18\u00a0°C/);
    expect(om).toMatch(/moyenne du minimum et du maximum/);
    expect(om).toMatch(/Open-Meteo/);
    expect(djuMethodText('netatmo')).toMatch(/station Netatmo/);
    expect(djuMethodText(null)).toBe(om); // no station: Open-Meteo, as the collector does
    expect(weatherSourceLabel('netatmo')).not.toMatch(/Open-Meteo/);
    expect(GLOSSARY.dju.def).toContain(`${DJU_BASE} °C`); // the term touched in « Année par année »
  });

  it('une période sans trou : rien de manquant', () => {
    const s = djuSpan(year(2025, 2, 10), '2025-01-01', '2025-12-31');
    expect(s).toEqual({ dju: 365 * 12, days: 365, missing: 0 });
  });

  it('une année complète donne un nombre, sans réserve', () => {
    const c = yearCold(year(2025, 2, 10), 2025, '2025-01-01', '2025-12-31', () => 365 * 24);
    expect(c.cell).toBe(365 * 12);
    expect(c.caveat).toBeNull();
    expect(c.perDju).toBe('2,00');
  });

  it('une année à trous dit « au moins » et garde les mêmes jours pour le chauffage par degré-jour', () => {
    // January without temperature: 31 days missing, the heating of those days set aside
    const w = year(2025, 2, 10, (d) => d < '2025-02-01');
    const heatPerDay = 24;
    const c = yearCold(w, 2025, '2025-01-01', '2025-12-31', (has) => {
      let s = 0;
      for (let d = '2025-01-01'; d <= '2025-12-31'; d = addDays(d, 1)) if (has(d)) s += heatPerDay;
      return s;
    });
    expect(c.cell).toBe('4\u202f008 *');
    expect(c.caveat).toMatch(/^Froid de 2025 : 31 jours sans température extérieure, comptés zéro : au moins 4.008 degrés-jours/);
    expect(c.caveat).toMatch(/les 334 jours mesurés/);
    // same days on both sides: 24 kWh / 12 DJ, not 365 × 24 / (334 × 12)
    expect(c.perDju).toBe('2,00');
  });

  it('sans aucune température : un tiret, pas zéro degré-jour', () => {
    const c = yearCold(new Map(), 2025, '2025-01-01', '2025-12-31', () => 100);
    expect(c).toEqual({ cell: '—', perDju: '—', caveat: null });
  });
});
