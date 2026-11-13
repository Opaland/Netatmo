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

// #570: the water heater without any reading in January 2024 (a real account: Sept. 2023 – Jan. 2025)
describe('a device without any reading a year earlier (#570)', () => {
  const gone = records.filter((r) => !(r.room === 'ce' && r.day < '2024-02-01'));
  it('« pourquoi » leaves it out of both months and says so, no rise made of it', () => {
    const a = answer('why', '2025-01', base(gone));
    expect(a.lines[0]).toBe('Hors Chauffe-eau : aucun relevé sur l’un des deux mois.');
    expect(a.lines[1]).toMatch(/^Janvier 2025 : 558 kWh, contre 465 kWh en janvier 2024 \(\+20/);
    expect(a.lines.join(' ')).not.toMatch(/Chauffe-eau \(\+/);
  });
  it('« normal » takes no reference year without it', () => {
    const extra = [...days('salon', 'heating', '2023-01-01', '2023-12-31', () => 10), ...days('ch', 'heating', '2023-01-01', '2023-12-31', () => 5), ...days('ce', 'water_heater', '2023-01-01', '2023-12-31', () => 3)];
    const a = answer('normal', '2025-01', base([...extra, ...gone]));
    // January 2023 (with the water heater): 18 kWh a day expected, not the 15 of January 2024 mixed in
    expect(a.lines[0]).toMatch(/pour 558 kWh attendus/);
  });
});

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

  describe('cold: why was this room cold (S-13.3)', () => {
    const temps = new Map<string, Map<string, [number, number | null]>>();
    const salon = new Map<string, [number, number | null]>();
    const ch = new Map<string, [number, number | null]>();
    for (let d = '2025-01-01'; d <= '2025-01-31'; d = addDays(d, 1)) {
      salon.set(d, [d <= '2025-01-05' ? 17 : 20.5, 20]);
      ch.set(d, [d <= '2025-01-02' ? 17.5 : 19.2, 18]);
    }
    temps.set('salon', salon);
    temps.set('ch', ch);
    const seen: Record<string, number> = {};
    const cells: Record<string, { n: number; open_window_h?: number; mode_h?: Record<string, number> }> = {};
    for (let d = '2025-01-01'; d <= '2025-01-31'; d = addDays(d, 1)) {
      seen[d] = 0xffffff;
      cells[d] = { n: 24, open_window_h: 0 };
    }
    cells['2025-01-01'] = { n: 24, open_window_h: 2 };
    cells['2025-01-02'] = { n: 24, open_window_h: 1.5 };
    cells['2025-01-03'] = { n: 24, open_window_h: 3 };
    cells['2025-01-04'] = { n: 24, open_window_h: 0, mode_h: { away: 20 } };
    const roomState = { seen, rooms: { salon: cells, ch: { '2025-01-01': { n: 24 } } } };
    const input = base(records, { temps, roomState, groupOf: (r) => (r === 'ch' ? 'chambres' : r), roomName: (id) => ({ salon: 'Salon', chambres: 'Chambres (regroupées)' })[id]! });

    it('counts the cold days and explains them, window first', () => {
      const a = answer('cold', '2025-01', input);
      expect(a.ok).toBe(true);
      expect(a.lines[0]).toBe('En janvier 2025, 5 jours avec au moins une pièce sous 19 °C en moyenne (sonde des radiateurs).');
      expect(a.lines[1]).toBe('Salon : 5 jours, dont 3 avec une fenêtre ouverte (6,5 h au total), 1 en mode absence ou hors-gel, 1 sans explication relevée.');
      expect(a.lines[2]).toBe('Chambres (regroupées) : 2 jours, dont 2 avec une consigne sous 19 °C.');
      expect(a.lines[3]).toContain('une fenêtre était ouverte');
      expect(a.lines[4]).toContain('100 % des heures du mois');
    });

    it('S-1.26: a sharp fall of the half-hour temperature explains the day the snapshots missed', () => {
      const drops = new Map([['salon', new Map([['2025-01-05', { at: '07:00', fall: 2.1 }]])]]);
      const a = answer('cold', '2025-01', { ...input, drops });
      expect(a.lines[1]).toBe(
        'Salon : 5 jours, dont 4 avec une fenêtre ouverte (6,5 h au total, dont 1 jour vu seulement par une chute de température au pas de 30 min), 1 en mode absence ou hors-gel.',
      );
    });

    it('says why it cannot answer without the hourly snapshots', () => {
      expect(answer('cold', '2025-01', base(records, { temps, roomState: null })).lines[0]).toContain('relevé horaire');
      expect(answer('cold', '2024-06', base(records, { temps, roomState })).lines[0]).toContain('aucun relevé de l’état des pièces en juin 2024');
    });

    it('says so when no room was cold', () => {
      const a = answer('cold', '2025-02', base(records, { temps, roomState: { seen: { '2025-02-03': 0xffffff }, rooms: {} } }));
      expect(a.lines[0]).toContain('aucune pièce n’est descendue sous 19 °C');
    });
  });
});
