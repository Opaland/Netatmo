import { describe, expect, it } from 'vitest';
import { changeSummary, daysSummary, gridSummary, rankSummary, slopeSummary } from './summary';

// #305: every type of chart has a sentence with figures for a screen reader.
const sp = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ');

describe('résumés par type de graphique (#305)', () => {
  it('classement des pièces, du plus au moins', () => {
    expect(sp(rankSummary(['Bureau', 'Salon', 'Cuisine'], [432, 1263, null], 'kWh'))).toBe('du plus au moins : Salon 1 263 kWh, Bureau 432 kWh');
    expect(rankSummary([], [], 'kWh')).toBe('pas de donnée');
  });
  it('évolution : départ, arrivée, plus forte hausse et baisse', () => {
    const s = sp(changeSummary({ label: '2025', value: 6265 }, { label: '2026', value: 5273 }, [
      { name: 'Salon', delta: -310 },
      { name: 'Bureau', delta: 12 },
    ]));
    expect(s).toContain('de 6 265 kWh (2025) à 5 273 kWh (2026)');
    expect(s).toContain('plus forte baisse : Salon −310 kWh');
    expect(s).toContain('plus forte hausse : Bureau +12 kWh');
  });
  it('chauffage selon le froid : jours et kWh par degré, sans le mot « pente » (#386)', () => {
    expect(slopeSummary([{ name: '2025–2026', days: 228, slope: -2.33, unit: 'kWh de plus par °C de froid' }])).toBe('2025–2026 : 228 jours, 2,3 kWh de plus par °C de froid');
  });
  it('calendrier : total, moyenne et jour le plus consommateur', () => {
    const s = daysSummary(
      [
        ['2026-01-01', 40],
        ['2026-01-02', 20],
      ],
      (d) => d,
    );
    expect(s).toBe('2 jours, total 60 kWh, moyenne 30 kWh par jour ; jour le plus consommateur : 2026-01-01 (40 kWh)');
  });
  it('carte de chaleur : pointe et creux', () => {
    expect(gridSummary(['0 h', '1 h'], ['Lun'], [[0, 0, 0.4], [1, 0, 0.1]], 'kWh')).toBe('pointe : Lun 0 h (0,4 kWh) ; creux : Lun 1 h (0,1 kWh)');
  });
});
