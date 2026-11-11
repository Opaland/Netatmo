import { describe, expect, it } from 'vitest';
import {
  GLOSSARY,
  comparedPct,
  comparedToLastYear,
  leftSentence,
  glossarySection,
  kpiTitle,
  pinnedTemp,
  plainEur,
  plainNum,
  roundKwh,
  sentenceLengths,
  term,
  verdictSentences,
  verdictTitle,
  visibleText,
  whenWord,
  roomFeel,
  heatingSentence,
} from './plain';

/** Every text of the simple mode, for a spread of inputs. */
function allTexts(): string[] {
  const out: string[] = [];
  for (const level of ['low', 'normal', 'high'] as const) out.push(verdictTitle(level));
  for (const climate of [true, false])
    for (const eur of [null, 42.4, -1234.5, 0.2])
      out.push(...verdictSentences({ level: 'high', actual: 1234.56, expected: 987.6, climate, eur }, '2026-11-01'));
  for (const [now, before] of [
    [100, null],
    [100, 0],
    [100, 100],
    [110, 100],
    [90, 100],
  ] as [number, number | null][])
    out.push(comparedToLastYear(now, before));
  for (const k of ['month', 'year', '12m', 'projection'] as const) out.push(kpiTitle(k, '2026-11-09'));
  for (const cold of [0, 1, 5]) out.push(pinnedTemp(18.6, cold, 19).sub);
  out.push(...Object.values(GLOSSARY).map((g) => g.def));
  out.push(visibleText(glossarySection()));
  return out;
}

describe('S-7.13 mode simple en langage clair', () => {
  it('phrases de 15 mots au plus', () => {
    for (const t of allTexts()) for (const n of sentenceLengths(t)) expect(n, t).toBeLessThanOrEqual(15);
  });

  it('aucun sigle sans explication (kWh est un mot du glossaire)', () => {
    for (const t of allTexts()) {
      // An acronym = two capitals or more in a row; N-1, HP/HC and DJU are banned.
      expect(t, t).not.toMatch(/\b[A-Z]{2,}\b|N-1|vs\b/);
    }
  });

  it('chiffres arrondis', () => {
    expect(roundKwh(12.4)).toBe(12);
    expect(roundKwh(1234.56)).toBe(1230);
    expect(plainNum(1234.56)).toMatch(/^1\s230$/);
    expect(plainEur(1234.5)).toMatch(/^1\s230\s€$/);
    expect(plainEur(42.4)).toBe('42\u00a0€');
    expect(pinnedTemp(18.6, 0, 19).value).toBe('19 °C');
    for (const t of allTexts()) expect(t, t).not.toMatch(/\d,\d/); // no decimals
  });

  it('le verdict dit plus ou moins en euros, sans signe', () => {
    const s = verdictSentences({ level: 'low', actual: 900, expected: 1000, climate: true, eur: -25 }, '2026-11-01');
    expect(s[0]).toBe('Depuis le 1er novembre : 900\u00a0kWh consommés.');
    expect(s).toContain('Ce calcul tient compte du froid de ce mois.');
    expect(s.at(-1)).toBe('Cela fait environ 25\u00a0€ de moins.');
    // under one euro: no money sentence
    expect(verdictSentences({ level: 'normal', actual: 900, expected: 900, climate: false, eur: 0.2 }, '2026-11-01')).toHaveLength(2);
  });

  it('un terme se touche : bouton avec sa définition d\'une phrase', () => {
    const h = term('kwh');
    expect(h).toMatch(/<button type="button" class="term" data-term="kwh" aria-expanded="false" aria-controls="def-kwh-\d+">kWh<\/button>/);
    expect(h).toMatch(/<span class="term-def" id="def-kwh-\d+" hidden>/);
    expect(term('kwh')).not.toBe(h); // unique ids
    for (const g of Object.values(GLOSSARY)) expect(sentenceLengths(g.def)).toHaveLength(1);
    for (const t of ['kwh', 'hc', 'dju']) expect(glossarySection()).toContain(`data-term="${t}"`);
  });

  it('compte les mots comme un lecteur', () => {
    expect(sentenceLengths("D'habitude, à cette date : 1 230 kWh. Ce calcul tient compte du froid.")).toEqual([6, 6]);
  });
});

describe('vue Proche (#316)', () => {
  it('dit quand la température a été mesurée', () => {
    expect(whenWord('2026-11-09', '2026-11-09')).toBe("aujourd'hui");
    expect(whenWord('2026-11-08', '2026-11-09')).toBe('hier');
    expect(whenWord('2026-10-31', '2026-11-01')).toBe('hier');
    expect(whenWord('2026-11-01', '2026-11-09')).toBe('le 1er novembre');
  });

  it('décrit la pièce en phrases courtes, sans mot technique', () => {
    expect(roomFeel(19.8, 19)).toBe('Il fait bon.');
    expect(roomFeel(17.5, 19)).toBe('Il fait un peu frais.');
    expect(roomFeel(15, 19)).toBe('Il fait froid.');
    expect(heatingSentence(19.5, 20)).toBe('Le chauffage atteint la température demandée.');
    expect(heatingSentence(17, 20)).toBe('La pièce reste sous la température demandée (20 °C).');
    expect(heatingSentence(17, null)).toBe('');
    for (const s of [roomFeel(15, 19), heatingSentence(17, 20.5)]) {
      expect(s).not.toMatch(/consigne|setpoint|kWh/i);
      for (const n of sentenceLengths(s)) expect(n).toBeLessThanOrEqual(15);
    }
  });
});

// #400: the vue Proche says the change computed by the Accueil, and the room it leaves out
describe('figures shared with the Accueil (#400)', () => {
  it('the change on last year, from the Accueil percentage', () => {
    expect(comparedPct(-14.2)).toBe("C'est 14 % de moins que l'an dernier.");
    expect(comparedPct(3.6)).toBe("C'est 4 % de plus que l'an dernier.");
    expect(comparedPct(0.3)).toBe("C'est autant que l'an dernier.");
    expect(comparedPct(null)).toBe("Pas de comparaison possible avec l'an dernier.");
    expect(comparedToLastYear(86, 100)).toBe(comparedPct(-14));
  });
  it('a room left out, in short plain sentences', () => {
    const s = leftSentence('Chambre enfant', '2026-11-05');
    expect(s).toBe("Chambre enfant ne répond plus depuis le 5 novembre : cette pièce n'est pas comptée.");
    expect(leftSentence('Bureau', null)).toBe("Bureau n'est pas comptée : cette pièce ne répondait pas l'an dernier.");
    for (const n of sentenceLengths(s)) expect(n).toBeLessThanOrEqual(15);
  });
});

// #433: the vue Proche counts the stove's wood as the Accueil does, and says so
describe('verdict sentences with the stove’s wood (#433)', () => {
  it('names the wood in the amount and in the euros', () => {
    const s = verdictSentences({ level: 'normal', actual: 160, expected: 158, climate: true, eur: 2, wood: true }, '2026-11-01');
    expect(s[0]).toBe("Depuis le 1er novembre : 160\u00a0kWh d'électricité et de bois.");
    expect(s.at(-1)).toMatch(/^Cela fait environ 2\s€ de plus, bois compris\.$/);
    expect(verdictSentences({ level: 'normal', actual: 160, expected: 158, climate: true, eur: 2 }, '2026-11-01')[0]).toMatch(/consommés\.$/);
  });
});
