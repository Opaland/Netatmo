import { describe, expect, it } from 'vitest';
import { toCsv } from './aggregate';
import { textCell, untextCell } from './csv';
import { parseLongCsv, toLongCsv } from './export';

describe('CSV : injection de formule (#235)', () => {
  it('préfixe d’une apostrophe les cellules texte qui commencent par = + - @ tabulation ou CR', () => {
    expect(textCell('=1+1', ';')).toBe("'=1+1");
    expect(textCell('+33', ',')).toBe("'+33");
    expect(textCell('-2', ',')).toBe("'-2");
    expect(textCell('@SUM(A1)', ',')).toBe("'@SUM(A1)");
    expect(textCell('\t=x', ',')).toBe("'\t=x");
    expect(textCell('\r=x', ',')).toBe(`"'\r=x"`);
    expect(textCell('=HYPERLINK("https://x","y")', ',')).toBe(`"'=HYPERLINK(""https://x"",""y"")"`);
    expect(textCell('=a;b', ';')).toBe(`"'=a;b"`);
    expect(textCell('Salon', ',')).toBe('Salon');
    expect(textCell('Chambre = bureau', ',')).toBe('Chambre = bureau');
    for (const s of ['=1+1', '-x', 'Salon', "'déjà"]) expect(untextCell(s.startsWith("'") ? s : textCell(s, ';'))).toBe(s);
  });

  it('toCsv : nom de pièce neutralisé, nombres intacts', () => {
    const csv = toCsv([{ day: '2024-01-01', room: 'a', cat: 'heating', kwh: 1.5 }], [{ id: 'a', name: '=1+1', category: 'heating', module_types: [] }]);
    expect(csv).toBe("date;piece;categorie;kwh\n2024-01-01;'=1+1;Chauffage;1,500\n");
  });

  it('toLongCsv : entité neutralisée, températures négatives restent des nombres, aller-retour', () => {
    const rows = [
      { date: '2025-01-01', source: 'station' as const, entity: '=1+1', metric: 'temperature_min', value: -3.5, unit: '°C' as const },
      { date: '2025-01-01', source: 'station' as const, entity: '@cmd', metric: 'temperature_max', value: -0.5, unit: '°C' as const },
    ];
    const csv = toLongCsv(rows);
    expect(csv).toContain("2025-01-01,station,'=1+1,temperature_min,-3.5,°C");
    expect(csv).toContain("2025-01-01,station,'@cmd,temperature_max,-0.5,°C");
    expect(parseLongCsv(csv)).toEqual(rows);
  });
});
