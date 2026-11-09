import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import type { Weather } from './analysis';
import { type QuestionInput, answer, answerableMonths, defaultMonth } from './questions';

/** One record per day and room over [from, to]. */
function days(room: string, cat: DayRecord['cat'], from: string, to: string, kwh: (d: string) => number): DayRecord[] {
  const out: DayRecord[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ day: d, room, cat, kwh: kwh(d) });
  return out;
}

function weather(from: string, to: string, mean: (d: string) => number): Weather {
  const w: Weather = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) w.set(d, [mean(d) - 2, mean(d) + 2, mean(d)]);
  return w;
}

const names: Record<string, string> = { salon: 'Salon', ch: 'Chambre', ce: 'Chauffe-eau' };
const base = (records: DayRecord[], extra: Partial<QuestionInput> = {}): QuestionInput => ({
  records,
  weather: null,
  lastDay: '2025-02-28',
  cost: null,
  roomName: (id) => names[id],
  ...extra,
});

// January 2024: salon 10 kWh/day, chambre 5; January 2025: salon 10, chambre 8 (usage up).
const records = [
  ...days('salon', 'heating', '2024-01-01', '2025-02-28', () => 10),
  ...days('ch', 'heating', '2024-01-01', '2024-12-31', () => 5),
  ...days('ch', 'heating', '2025-01-01', '2025-02-28', () => 8),
  ...days('ce', 'water_heater', '2024-01-01', '2025-02-28', () => 3),
];

describe('S-5.9 questions answered by code', () => {
  it('lists months and picks the last complete one', () => {
    const months = answerableMonths(records, '2025-02-14');
    expect(months[0]).toBe('2025-02');
    expect(defaultMonth(months, '2025-02-14')).toBe('2025-01');
  });

  it('why: cost, weather vs usage and the room waterfall', () => {
    const w = weather('2024-01-01', '2025-01-31', () => 6); // same climate both years
    const a = answer('why', '2025-01', base(records, { weather: w, cost: (_f, t) => (t < '2025-01-01' ? 100 : 120) }));
    expect(a.ok).toBe(true);
    expect(a.lines[0]).toBe('Janvier 2025 a coûté environ 120 €, contre 100 € en janvier 2024 (+20 %), pour 651 kWh contre 558 kWh.');
    expect(a.lines[1]).toContain('aussi froid');
    expect(a.lines[2]).toBe('À climat égal, le chauffage par degré-jour a évolué de +20 %.'); // 558/465 kWh heating
    expect(a.lines[3]).toBe('L’écart vient surtout des usages (réglages, présence, aération).');
    expect(a.lines[4]).toBe('Plus fortes variations : Chambre (+93 kWh).');
  });

  it('why: without weather nor prices, says what it cannot separate', () => {
    const a = answer('why', '2025-01', base(records));
    expect(a.lines[0]).toContain('Sans prix renseigné, je compare en kWh');
    expect(a.lines[1]).toContain('je ne peux pas séparer');
  });

  it('cannot answer without a year of history, and says why', () => {
    const a = answer('why', '2024-03', base(records));
    expect(a).toEqual({ ok: false, lines: ['Je ne peux pas répondre : pas de données pour mars 2023, il faut un an d’historique pour comparer.'] });
    expect(answer('room', '2024-03', base(records)).ok).toBe(false);
    expect(answer('normal', '2024-03', base(records)).ok).toBe(false);
    expect(answer('why', '2025-06', base(records)).lines[0]).toContain('aucune donnée relevée en juin 2025');
  });

  it('room: the room that increased the most', () => {
    const a = answer('room', '2025-01', base(records));
    expect(a.lines[0]).toBe('La pièce qui a le plus augmenté : Chambre, +93 kWh (+60 %) : 248 kWh contre 155 kWh en janvier 2024.');
  });

  it('normal: the verdict with its expected value', () => {
    const a = answer('normal', '2025-01', base(records));
    expect(a.lines[0]).toContain('651 kWh, pour 558 kWh attendus d’après les années précédentes');
    expect(a.lines[1]).toBe('C’est plus que d’habitude : plus de 10 % au-dessus de l’attendu.');
  });

  it('priciest: ranks the last 12 months in € or, without prices, in kWh', () => {
    const cost = (f: string) => (f.startsWith('2024-12') ? 300 : 100);
    const a = answer('priciest', '2025-01', base(records, { cost }));
    expect(a.lines[0]).toBe('Sur les 12 mois jusqu’à janvier 2025, le plus cher est décembre 2024 : environ 300 € (558 kWh).');
    const k = answer('priciest', '2025-01', base(records));
    expect(k.lines[0]).toContain('le plus consommateur est janvier 2025 : 651 kWh');
    expect(k.lines).toContain('Sans prix renseigné, je classe les mois en kWh.');
    expect(answer('priciest', '2024-01', base(records)).ok).toBe(false);
  });

  it('flags a month still in progress', () => {
    const a = answer('room', '2025-02', base(records, { lastDay: '2025-02-14' }));
    expect(a.lines.at(-1)).toContain('jusqu’au 14');
  });
});
