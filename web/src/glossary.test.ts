import { describe, expect, it } from 'vitest';
import { dayLong, dayShort, hour, hourMin, hourRange, localDateTime, localDay, monthShort, rangeLabel, seasonLabel, signedPct, vsLabel } from './glossary';

describe('glossaire : dates et heures (#299)', () => {
  it('écrit « 1er » et les mois en français', () => {
    expect(dayLong('2026-08-01')).toBe('1er août 2026');
    expect(dayLong('2026-11-08')).toBe('8 novembre 2026');
    expect(dayShort('2026-11-01')).toBe('1er nov.');
    expect(dayShort('2026-11-08', true)).toBe('8 nov. 2026');
    expect(monthShort('2026-02')).toBe('févr. 2026');
    expect(rangeLabel('2025-11-09', '2026-11-08')).toBe('du 9 nov. 2025 au 8 nov. 2026');
    expect(rangeLabel('2026-10-10', '2026-11-08')).toBe('du 10 oct. au 8 nov. 2026');
  });
  it('écrit les heures « 19 h », « 19 h 30 », jamais « 19:00 »', () => {
    expect(hour(19)).toBe('19 h');
    expect(hour(24)).toBe('0 h');
    expect(hourMin('19:30')).toBe('19 h 30');
    expect(hourMin('07:00')).toBe('7 h');
    expect(hourMin(4, 5)).toBe('4 h 05');
    expect(hourRange(22, 7)).toBe('22 h – 7 h');
  });
  it('saisons avec tiret demi-cadratin, jour local', () => {
    expect(seasonLabel(2025)).toBe('2025–2026');
    expect(localDay(new Date(2026, 10, 9, 0, 30))).toBe('2026-11-09');
    expect(localDateTime('not a date')).toBe('not a date');
    expect(localDateTime(new Date(2026, 10, 9, 13, 5).toISOString())).toBe('9 novembre 2026 à 13 h 05');
  });
});

describe('glossaire : nombres et comparaisons (#315)', () => {
  it('pourcentages signés', () => {
    expect(signedPct(-16.4)).toBe('−16 %');
    expect(signedPct(2.6)).toBe('+3 %');
    expect(signedPct(-0.2)).toBe('0 %');
  });
  it('dit toujours à quoi on se compare', () => {
    expect(vsLabel('2026-11-01', '2026-11-08')).toBe('vs nov. 2025 au 8');
    expect(vsLabel('2026-10-01', '2026-10-31')).toBe('vs oct. 2025');
    expect(vsLabel('2026-01-01', '2026-11-08')).toBe('vs 2025 à date');
    expect(vsLabel('2025-01-01', '2025-12-31')).toBe('vs 2024');
    expect(vsLabel('2025-11-09', '2026-11-08')).toBe('vs les 12 mois précédents');
    expect(vsLabel('2026-10-10', '2026-11-08')).toBe("vs la même période l'an dernier");
  });
});
