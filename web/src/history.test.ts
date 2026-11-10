import { describe, expect, it } from 'vitest';
import { historyCounted, narrowed, selectionLabel, yearGranularityAllowed, yearLine, yearsLine } from './history';

const all = { cat: 'all', rooms: 7, allRooms: 7 };

describe('Historique : ce que compte chaque carte (#386, #301)', () => {
  it('la sélection se nomme, et rien quand tout est affiché', () => {
    expect(selectionLabel(all)).toBe('');
    expect(narrowed(all)).toBe(false);
    expect(selectionLabel({ cat: 'water_heater', rooms: 2, allRooms: 7 })).toBe('Eau chaude · 2 pièces sur 7');
    expect(selectionLabel({ cat: 'all', rooms: 1, allRooms: 7 })).toBe('1 pièce sur 7');
    expect(narrowed({ cat: 'heating', rooms: 7, allRooms: 7 })).toBe(true);
  });

  it('« Compté : » dit les appareils et les pièces, jamais tout le logement', () => {
    expect(historyCounted(all)).toMatch(/^les radiateurs et le chauffe-eau \(pas tout le logement/);
    expect(historyCounted({ cat: 'heating', rooms: 3, allRooms: 7 })).toMatch(/^les radiateurs seuls, 3 pièces sur 7 /);
    expect(historyCounted({ cat: 'water_heater', rooms: 7, allRooms: 7 })).toMatch(/^le chauffe-eau seul /);
  });

  it('une carte du chauffage seul le dit, et dit quand la sélection la vide', () => {
    expect(historyCounted(all, true)).toMatch(/^le chauffage seul, des radiateurs \(pas tout/);
    expect(historyCounted({ cat: 'water_heater', rooms: 7, allRooms: 7 }, true)).toMatch(/^rien : .*« Eau chaude »/);
  });
});

describe('Historique : périodes (#299)', () => {
  it('une année en cours dit jusqu’où elle va, une année finie non', () => {
    expect(yearLine(2026, '2026-11-08')).toBe('2026 (au 8 nov.)');
    expect(yearLine(2025, '2026-11-08')).toBe('2025');
    expect(yearLine(2026, '2026-12-31')).toBe('2026');
  });

  it('les années de la collecte', () => {
    expect(yearsLine(2022, '2026-11-08')).toBe('2022 à 2026 (au 8 nov.)');
    expect(yearsLine(2026, '2026-11-08')).toBe('2026 (au 8 nov.)');
  });

  it('#306 : « An » seulement sur des années entières', () => {
    expect(yearGranularityAllowed('12m')).toBe(false);
    expect(yearGranularityAllowed('30d')).toBe(false);
    expect(yearGranularityAllowed('all')).toBe(true);
    expect(yearGranularityAllowed('2025')).toBe(true);
  });
});
