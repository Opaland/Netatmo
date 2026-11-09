import { describe, expect, it } from 'vitest';
import { buildTheme, remPx, splitCount, themeKey } from './chart-theme';

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
