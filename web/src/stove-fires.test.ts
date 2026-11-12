// #469: the fires of the stove read back from the meta (never trusted), the owner's answers, and
// the wood of a season moved to its fires (wood.ts onFireDays, through woodDaily: the one split).
import { describe, expect, it } from 'vitest';
import { addDays } from './aggregate';
import type { Weather } from './analysis';
import { checkAnswers, fireClarity, isCovered, parseAnswers, parseFires, slotTime, spanText } from './stove-fires';
import { onFireDays, parseWood, woodDaily, woodIn } from './wood';

const META = {
  v: 1,
  covered: [
    ['2026-01-10', '2026-01-20'],
    ['2026-01-25', '2026-01-31'],
  ],
  fires: { '2026-01-12': [38, 6, 2, 12], '2026-01-15': [39, 7, 3, 6], '2026-01-22': [38, 6, 2, 12] },
};

describe('#469 fires of the stove', () => {
  it('reads back only fires inside what the detection could see, with bounded numbers', () => {
    const f = parseFires({
      ...META,
      covered: [...META.covered, ['2026-01-05', '2026-01-06'], ['2026-02-30', '2026-03-01'], ['2026-03-05', '2026-03-01'], 'x'],
      fires: { ...META.fires, '2026-01-13': [48, 6, 2, 12], '2026-01-14': [38, 0, 2, 12], '2026-01-16': [38, 6, 2.5, 12], __proto__: [1, 1, 1, 1], '2026-01-17': [38, 6, 2] },
    })!;
    expect(f.covered).toEqual(META.covered); // out of order, impossible day, reversed: dropped
    expect([...f.fires.keys()]).toEqual(['2026-01-12', '2026-01-15']); // 22: not covered
    expect(f.fires.get('2026-01-12')).toEqual({ start: 38, slots: 6, witnesses: 2, rise: 1.2 });
    expect(isCovered(f, '2026-01-20')).toBe(true);
    expect(isCovered(f, '2026-01-21')).toBe(false);
    expect(parseFires(null)).toBeNull();
    expect(parseFires([])).toBeNull();
    expect(parseFires({})).toEqual({ covered: [], fires: new Map() });
  });

  it('says a fire in words: its time, its burn, how clearly it stands out', () => {
    expect(slotTime(39)).toBe('19 h 30');
    expect(slotTime(38)).toBe('19 h');
    expect(spanText(7)).toBe('≈ 3 h 30');
    expect(spanText(1)).toBe('≈ 30 min');
    expect(spanText(4)).toBe('≈ 2 h');
    const f = parseFires(META)!;
    expect(fireClarity(f.fires.get('2026-01-12')!)).toBe('nette'); // 1.2 °C ≥ twice 0.45
    expect(fireClarity({ ...f.fires.get('2026-01-12')!, rise: 0.6 })).toBe('à peine marquée');
    expect(fireClarity(f.fires.get('2026-01-15')!)).toBe('nette'); // three rooms
  });

  it('meets the owner’s answers: agreements, missed fires, fires found on a « non »', () => {
    const answers = parseAnswers({ '2026-01-12': true, '2026-01-13': true, '2026-01-15': false, '2026-01-16': false, '2026-01-22': true, '2026-02-30': true, '2026-01-18': 'oui' });
    expect([...answers.keys()]).toEqual(['2026-01-22', '2026-01-16', '2026-01-15', '2026-01-13', '2026-01-12']);
    expect(checkAnswers(parseFires(META)!, answers)).toEqual({ compared: 4, agree: 2, missed: ['2026-01-13'], wrong: ['2026-01-15'], unseen: 1 });
    expect(parseAnswers(Object.fromEntries(Array.from({ length: 500 }, (_, i) => [addDays('2025-01-01', i), true]))).size).toBe(400);
  });
});

describe('#469 the wood on the fires found (onFireDays, woodDaily)', () => {
  const weather: Weather = new Map();
  for (let d = '2024-09-01'; d <= '2026-08-31'; d = addDays(d, 1)) weather.set(d, [2, 8, 5]); // 13 degree days each, a whole season before
  const wood = parseWood({ purchases: [{ day: '2025-09-20', steres: 2, species: 'chene', moisture: 20, price: 200 }] });

  it('the days it could see give their degree days to the fires, in proportion to the burn', () => {
    const weight = new Map([
      ['2026-01-11', 10],
      ['2026-01-12', 10],
      ['2026-01-15', 10],
      ['2026-01-21', 10],
    ]);
    const out = onFireDays(weight, parseFires(META)!)!;
    expect(out.get('2026-01-11')).toBe(0); // seen, no fire
    expect(out.get('2026-01-12')! / out.get('2026-01-15')!).toBeCloseTo(6 / 7, 9);
    expect(out.get('2026-01-12')! + out.get('2026-01-15')!).toBeCloseTo(30, 9); // the 30 degree days seen
    expect(out.get('2026-01-21')).toBe(10); // not seen: its own
    expect(onFireDays(new Map([['2026-01-11', 10]]), parseFires(META)!)).toBeNull(); // no fire: degree days
  });

  it('the season keeps all its wood; inside what was seen, only the fires get some', () => {
    const daily = woodDaily(wood, weather, '2026-08-31', parseFires(META));
    const plain = woodDaily(wood, weather, '2026-08-31');
    expect(woodIn(daily, '2025-09-01', '2026-08-31').eur).toBeCloseTo(200, 6);
    expect(woodIn(daily, '2026-01-10', '2026-01-20').eur).toBeCloseTo(woodIn(plain, '2026-01-10', '2026-01-20').eur + woodIn(plain, '2026-01-25', '2026-01-31').eur, 6);
    expect(woodIn(daily, '2026-01-11', '2026-01-11').eur).toBe(0);
    expect(woodIn(daily, '2026-01-25', '2026-01-31').eur).toBe(0); // seen, no fire there
    expect(woodIn(daily, '2026-01-12', '2026-01-12').eur).toBeGreaterThan(woodIn(plain, '2026-01-12', '2026-01-12').eur);
    expect(woodIn(daily, '2025-12-01', '2025-12-31').eur).toBeCloseTo(woodIn(plain, '2025-12-01', '2025-12-31').eur, 9); // not seen
    // no fire in a season: the degree days, as before
    expect(woodDaily(wood, weather, '2026-08-31', parseFires({ covered: [['2026-01-10', '2026-01-20']], fires: {} }))).toEqual(plain);
  });

  it('a season still running: its share so far stays the degree days’, the fires choose the days', () => {
    const daily = woodDaily(wood, weather, '2026-01-20', parseFires(META));
    const plain = woodDaily(wood, weather, '2026-01-20');
    expect(woodIn(daily, '2025-09-01', '2026-01-20').eur).toBeCloseTo(woodIn(plain, '2025-09-01', '2026-01-20').eur, 9);
    expect(woodIn(plain, '2025-09-01', '2026-01-20').eur).toBeLessThan(200 * 0.5); // so far: an average season's share
  });
});
