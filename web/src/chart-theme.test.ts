import { describe, expect, it } from 'vitest';
import {
  axisHour,
  axisText,
  buildTheme,
  endLabelsFit,
  legendHeight,
  legendRows,
  pointsToShow,
  remPx,
  scaleText,
  splitCount,
  themeKey,
  weeklyMeans,
  zeroBased,
} from './chart-theme';

const TOKENS: Record<string, string> = {
  '--text': '#21201c',
  '--text-muted': '#63635e',
  '--border': '#dad9d6',
  '--grid': '#e9e8e6',
  '--surface-card': '#ffffff',
  '--surface-raised': '#ffffff',
  '--series-reference': '#8d8d86',
  '--font-xs': '0.8125rem',
  '--font-sm': '0.875rem',
  '--usage-heating': '#ef5f00',
  '--usage-water': '#0090ff',
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`--room-${i + 1}`, `#00000${i}`])),
};
const read = (n: string) => TOKENS[n] ?? '';

describe('thème ECharts (#310)', () => {
  it('prend les couleurs des jetons, sans orange ni bleu dans la palette', () => {
    const t = buildTheme(read, 16, 'system-ui');
    expect(t.color).toHaveLength(8);
    expect(t.color).not.toContain(TOKENS['--usage-heating']);
    expect(t.color).not.toContain(TOKENS['--usage-water']);
    expect(t.valueAxis.axisLabel.color).toBe('#63635e');
    expect(t.tooltip.backgroundColor).toBe('#ffffff');
  });
  it('suit la taille du texte du système', () => {
    expect(buildTheme(read, 16, 'x').textStyle.fontSize).toBe(13);
    expect(buildTheme(read, 32, 'x').textStyle.fontSize).toBe(26);
    expect(remPx('12px', 16)).toBe(12);
    expect(themeKey(read, 16)).not.toBe(themeKey(read, 32));
  });
  it('réduit le nombre de graduations sur un petit graphique (#319)', () => {
    expect(splitCount(180)).toBe(2);
    expect(splitCount(1000)).toBe(5);
  });
});

describe('règles de lisibilité (#304, #306)', () => {
  it('légende repliée sur plusieurs lignes au lieu de pages', () => {
    expect(legendRows([], 300, 13)).toBe(0);
    expect(legendRows(['2025', '2026'], 300, 13)).toBe(1);
    expect(legendRows(['Heures > 1 000 ppm', 'Heures > 1 400 ppm', 'Maximum de la nuit'], 300, 13)).toBeGreaterThan(1);
    expect(legendHeight(2, 13)).toBeGreaterThan(legendHeight(1, 13));
  });
  it('étiquettes de fin seulement si elles ne se chevauchent pas', () => {
    const opts = { width: 360, height: 300, px: 13 };
    expect(endLabelsFit([{ name: 'Chauffage', data: [1, 2, 10] }, { name: 'Chauffe-eau', data: [1, 2, 3] }], opts)).toBe(true);
    // Salon and Chambres both end at 19-20 °C
    expect(endLabelsFit([{ name: 'Salon', data: [0, 19.8] }, { name: 'Chambres', data: [0, 19.6] }], opts)).toBe(false);
    // names longer than a third of a phone
    expect(endLabelsFit([{ name: 'Puissance maximale atteinte du mois', data: [1, 5] }], opts)).toBe(false);
    expect(endLabelsFit(new Array(5).fill({ name: 'a', data: [1] }), opts)).toBe(false);
  });
  it('points visibles pour une série courte et pour une valeur isolée entre deux trous', () => {
    expect(pointsToShow([1, 2, null, 3])).toEqual([true, true, false, true]);
    const long = [...new Array(30).fill(1), null, 5, null, 2, 3];
    const p = pointsToShow(long);
    expect(p[0]).toBe(false);
    expect(p[31]).toBe(true);
    expect(p[33]).toBe(false);
  });
  it('kWh à partir de 0, °C, ppm et % jamais', () => {
    expect(zeroBased('kWh')).toBe(true);
    expect(zeroBased('h')).toBe(true);
    expect(zeroBased('°C')).toBe(false);
    expect(zeroBased('ppm')).toBe(false);
    expect(zeroBased('%')).toBe(false);
  });
  it('moyennes hebdomadaires, semaine du lundi, trou si trop peu de jours', () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-09', '2026-11-10'];
    const { labels, data } = weeklyMeans(days, [[10, 12, null, 14, null, null]], 3);
    expect(labels).toEqual(['2026-11-02', '2026-11-09']);
    expect(data[0]).toEqual([12, null]);
  });
  it('heures au format français', () => {
    expect(axisHour('05:30')).toBe('5 h 30');
    expect(axisHour('19:00')).toBe('19 h');
    expect(axisHour('0h')).toBe('0 h');
    expect(axisHour('23h30')).toBe('23 h 30');
    expect(axisHour('nov. 2025')).toBe('nov. 2025');
    expect(axisText('sem. du 3 nov. 2026')).toBe('3 nov. 2026');
    expect(scaleText(48.4, 'kWh')).toEqual(['48 kWh', '0']);
  });
});
