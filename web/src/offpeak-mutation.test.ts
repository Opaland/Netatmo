// #678: the survivors of the first mutation run on offpeak.ts (80,9 %), each test seen red on its
// mutant. Fictitious half hours only (never a real contract). What is left, and why:
// docs/bmad/06-qa-strategy.md § 7.
import { describe, expect, it, vi } from 'vitest';
import { addDays } from './aggregate';
import {
  type HcRange,
  type OffPeak,
  changesFromR30,
  minuteText,
  offPeakSentence,
  periodsOfTyped,
  periodsText,
  rangesFromR30,
  rangesOn,
  rangesText,
  shareOn,
  slotMask,
} from './offpeak';
import type { Day30, Room30 } from './room30';

/** One day: `hc[i]` share of HC in half hour i (undefined: not heated), 300 Wh per heated half hour. */
const day30 = (shares: Record<number, number>, wh = 300): Day30 => {
  const hp = new Array<number>(48).fill(0);
  const hc = new Array<number>(48).fill(0);
  for (const [i, s] of Object.entries(shares)) (hc[Number(i)] = Math.round(s * wh)), (hp[Number(i)] = Math.round((1 - s) * wh));
  return [hp, hc, 20, 19] as Day30;
};
const r30 = (days: [string, Day30][]): Room30 => new Map([['a', new Map(days)]]);
/** Shares of a placement: HC on `hc` half hours, HP on `hp` ones, the rest not heated. */
const place = (hc: number[], hp: number[], extra: Record<number, number> = {}): Record<number, number> => ({
  ...Object.fromEntries(hc.map((i) => [i, 1])),
  ...Object.fromEntries(hp.map((i) => [i, 0])),
  ...extra,
});
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
// A: HC 00:00–06:00, HP 06:00–12:00; B: HC 01:00–07:00, HP 00:00–01:00 and 07:00–12:00
const A = place(range(0, 11), range(12, 23));
const B = place(range(2, 13), [0, 1, ...range(14, 23)]);
const D0 = '2026-01-01';
const seq = (specs: Record<number, number>[], start = D0): [string, Day30][] => specs.map((s, k) => [addDays(start, k), day30(s)]);
const times = (n: number, x: Record<number, number>) => Array.from({ length: n }, () => x);

describe('#678 : les parts et le masque des demi-heures', () => {
  it('une demi-heure creuse à moitié est « surtout creuse »', () => {
    const m = slotMask([{ from: 15, to: 60 }]);
    expect(m.slice(0, 3)).toEqual([true, true, false]);
  });
});

describe('#678 : les plages lues dans les demi-heures', () => {
  const one = (shares: Record<number, number>) => r30([['2026-01-05', day30(shares)]]);
  it('les jours de la fenêtre, bornes comprises', () => {
    const r = one(place(range(0, 3), range(4, 47)));
    expect(rangesFromR30(r, '2026-01-05', '2026-01-05')).toEqual([{ from: 0, to: 120 }]);
    expect(rangesFromR30(r, '2026-01-06', '2026-01-07')).toBeNull();
  });
  it('toutes les demi-heures creuses : rien à lire', () => {
    expect(rangesFromR30(one(place(range(0, 47), [])), '2026-01-05', '2026-01-05')).toBeNull();
  });
  it('deux plages rangées par heure de début, même trouvées dans l’autre ordre', () => {
    const r = one(place([...range(0, 3), ...range(10, 12)], [...range(4, 9), ...range(13, 47)]));
    expect(rangesFromR30(r, '2026-01-05', '2026-01-05')).toEqual([
      { from: 0, to: 120 },
      { from: 300, to: 390 },
    ]);
  });
  it('une demi-heure à moitié creuse, seule : une plage vide, laissée', () => {
    const r = one(place(range(0, 3), [...range(4, 9), ...range(11, 47)], { 10: 0.5 }));
    expect(rangesFromR30(r, '2026-01-05', '2026-01-05')).toEqual([{ from: 0, to: 120 }]);
  });
  it('une demi-heure à moitié creuse après une demi-heure en partie creuse : une plage', () => {
    const r = one(place(range(0, 3), [...range(4, 8), ...range(11, 47)], { 9: 0.3, 10: 0.5 }));
    expect(rangesFromR30(r, '2026-01-05', '2026-01-05')).toEqual([
      { from: 0, to: 120 },
      { from: 9 * 30 + 21, to: 10 * 30 + 15 },
    ]);
  });
});

describe('#678 : la date d’un changement de placement', () => {
  it('cinq jours de suite, rangés même lus dans le désordre', () => {
    const days = seq([...times(3, A), ...times(5, B)]);
    expect(changesFromR30(r30([...days].reverse()), D0, addDays(D0, 7))).toEqual([addDays(D0, 3)]);
    expect(changesFromR30(r30(seq([...times(3, A), ...times(4, B)])), D0, addDays(D0, 6))).toEqual([]);
  });
  it('seuls les jours de la fenêtre, bornes comprises', () => {
    // two days of B before the window, five of A after it
    const days = seq([B, B, A, ...times(5, B), ...times(5, A)]);
    const r = r30(days);
    expect(changesFromR30(r, addDays(D0, 2), addDays(D0, 7))).toEqual([addDays(D0, 3)]);
  });
  it('une demi-heure creuse à 80 % tout juste est creuse, à 19 % pleine', () => {
    const ref = place(range(0, 11), range(12, 23));
    // half hour 12 (06:00) goes from HP to 80 % HC
    expect(changesFromR30(r30(seq([...times(3, ref), ...times(5, { ...ref, 12: 0.8 })])), D0, addDays(D0, 7))).toEqual([addDays(D0, 3)]);
    // half hour 12 at 19 % HC, then all HC (at 20 % exactly it is undecided: #684)
    const low = { ...ref, 12: 0.19 };
    expect(changesFromR30(r30(seq([...times(3, low), ...times(5, { ...ref, 12: 1 })])), D0, addDays(D0, 7))).toEqual([addDays(D0, 3)]);
  });
  it('une demi-heure coupée par une borne (moitié, moitié) ne contredit rien', () => {
    const ref = { ...A, 12: 0.5 };
    expect(changesFromR30(r30(seq([...times(3, ref), ...times(5, { ...A, 12: 1 })])), D0, addDays(D0, 7))).toEqual([]);
    expect(changesFromR30(r30(seq([...times(3, ref), ...times(5, { ...A, 12: 0 })])), D0, addDays(D0, 7))).toEqual([]);
  });
  it('les jours d’une série gardent ce qu’ils disent : un jour suivant qui les contredit seuls la relance', () => {
    // the run's first day tells half hour 30 is HP; a day like B but HC at 30 contradicts the run, not A
    const b30 = { ...B, 30: 0 };
    const c30 = { ...B, 30: 1 };
    // b30 is the run's second day: what it tells joins the run; c30 then conflicts with A and the run,
    // and a run starts again from it
    const days = seq([...times(3, A), B, b30, c30, B, B, B, B]);
    expect(changesFromR30(r30(days), D0, addDays(D0, 9))).toEqual([addDays(D0, 5)]);
  });
  it('un retour à l’ancien placement : la série et le jour du retour rejoignent la référence', () => {
    // the noise days tell half hour 30 is HP; later, five days with 30 HC are a change only if the reference knows it
    const noise = { ...B, 30: 0 };
    const c = { ...A, 30: 1 };
    expect(changesFromR30(r30(seq([...times(3, A), noise, noise, A, ...times(5, c)])), D0, addDays(D0, 10))).toEqual([addDays(D0, 6)]);
    // the same, told by the day of the return
    expect(changesFromR30(r30(seq([...times(3, A), B, B, { ...A, 30: 0 }, ...times(5, c)])), D0, addDays(D0, 10))).toEqual([addDays(D0, 6)]);
  });
  it('un jour qui ne contredit ni la référence ni la série rejoint la série', () => {
    // a day heated only at 30 (HP) during the run; then a day like B with 30 HC contradicts the run
    const only30 = { 30: 0 };
    const c30 = { ...B, 30: 1 };
    expect(changesFromR30(r30(seq([...times(3, A), B, only30, c30, ...times(4, B)])), D0, addDays(D0, 9))).toEqual([addDays(D0, 5)]);
  });
});

describe('#678 : les plages saisies', () => {
  const fresh = async () => {
    vi.resetModules();
    return import('./offpeak');
  };
  it('« à compter du » : un vrai jour seulement (module rechargé)', async () => {
    const m = await fresh();
    const r = (since: unknown) => m.parseHcRanges([{ from: '22:00', to: '06:00', since }]);
    expect(r('2025-03-01')).toEqual([{ from: 1320, to: 360, since: '2025-03-01' }]);
    for (const bad of ['2025-02-30', 'x2025-03-01', '2025-03-01x', '2025-3-01', '2025-03-1', '202-03-01', 'abcd-ef-gh', '2025-ab-01', '2025-03-cd', 20250301]) expect(r(bad), String(bad)).toEqual([]);
  });
  it('« HH:MM » entier seulement, et minuit en nombre (module rechargé)', async () => {
    const m = await fresh();
    expect(m.parseHcRanges([{ from: 0, to: 60 }])).toEqual([{ from: 0, to: 60 }]);
    expect(m.parseHcRanges([{ from: 'x22:00', to: '06:00' }, { from: '22:00', to: '06:00x' }])).toEqual([]);
  });
  it('les périodes saisies : sans date d’abord, puis par date', () => {
    const p = periodsOfTyped([
      { from: 60, to: 120, since: '2025-03-01' },
      { from: 1320, to: 360 },
      { from: 30, to: 90, since: '2024-06-01' },
    ]);
    expect(p.map((x) => x.since)).toEqual([null, '2024-06-01', '2025-03-01']);
    expect(periodsOfTyped([{ from: 30, to: 90, since: '2024-06-01' }, { from: 1320, to: 360 }]).map((x) => x.since)).toEqual([null, '2024-06-01']);
  });
  it('toutes les périodes datées : la plus ancienne couvre aussi les jours d’avant sa date', () => {
    const t = periodsText([
      { since: '2024-06-01', ranges: [{ from: 1320, to: 360 }] },
      { since: '2025-03-01', ranges: [{ from: 60, to: 420 }] },
    ]);
    expect(t.replace(/\u00a0/g, ' ')).toBe('1 h → 7 h depuis le 1er mars 2025 ; avant le 1er mars 2025, 22 h → 6 h');
  });
  it('sans période : aucune plage, la part de repli, aucun texte', () => {
    expect(rangesOn([], '2025-01-01')).toEqual([]);
    const o = { ranges: [], share: [0.5], source: 'supposees', periods: [] } as unknown as OffPeak;
    expect(shareOn(o, '2025-01-01')).toEqual([0.5]);
    expect(periodsText([])).toBe('');
  });
});

/** The texts put a no-break space before « h »: read as a plain space here. */
const sp = (t: string) => t.replace(/\u00a0/g, ' ');
describe('#678 : ce que le module définit au chargement (module rechargé)', () => {
  const fresh = async () => {
    vi.resetModules();
    return import('./offpeak');
  };
  it('le repli 22 h → 6 h, le masque, les heures décimales, la source dite', async () => {
    const m = await fresh();
    const o = m.resolveOffPeak(null, null);
    expect(o.ranges).toEqual([{ from: 1320, to: 360 }]);
    expect(m.FALLBACK_RANGES).toEqual([{ from: 1320, to: 360 }]);
    expect(m.slotMask(o.ranges).filter(Boolean)).toHaveLength(16);
    expect(m.toHours([{ from: 135, to: 465 }])).toEqual([[2.25, 7.75]]);
    expect(sp(m.offPeakSentence(o))).toBe(
      'Heures creuses supposées (celles de votre compteur, sur votre facture, peuvent différer : saisissez-les dans ⚙ Mon contrat) : 22 h → 6 h',
    );
    expect(sp(m.offPeakSentence(m.resolveOffPeak(null, [{ from: 60, to: 120 }])))).toBe('Heures creuses saisies dans ⚙ Mon contrat : 1 h → 2 h');
    const read = m.resolveOffPeak([{ since: null, ranges: [{ from: 60, to: 120 }] }, { since: '2025-03-01', ranges: [{ from: 120, to: 180 }] }], null);
    expect(read.source).toBe('releves');
    expect(m.rangesOn(read.periods, '2025-02-28')).toEqual([{ from: 60, to: 120 }]);
    expect(m.shareOn(read, '2025-03-01')[4]).toBe(1);
    expect(m.rangesText(read.ranges).replace(/\u00a0/g, ' ')).toBe('2 h → 3 h');
    expect(sp(m.offPeakSentence(read))).toContain('Heures creuses lues dans vos relevés : 2 h → 3 h depuis le 1er mars 2025');
  });
  it('les accumulateurs et la contradiction d’un changement de placement', async () => {
    const m = await fresh();
    expect(m.changesFromR30(r30(seq([...times(3, A), ...times(5, B)])), D0, addDays(D0, 7))).toEqual([addDays(D0, 3)]);
  });
});

describe('#678 : les heures creuses dites en mots', () => {
  const R: HcRange[] = [
    { from: 65, to: 120 },
    { from: 1320, to: 360 },
  ];
  it('les minutes sur deux chiffres, l’heure ronde seule, les plages séparées', () => {
    expect(sp(minuteText(65))).toBe('1 h 05');
    expect(sp(minuteText(120))).toBe('2 h');
    expect(sp(rangesText(R))).toBe('1 h 05 → 2 h, 22 h → 6 h');
  });
  it('trois périodes : la plus récente, celle du milieu bornée, la première « avant »', () => {
    const t = periodsText([
      { since: null, ranges: [{ from: 1320, to: 360 }] },
      { since: '2025-03-01', ranges: [{ from: 60, to: 420 }] },
      { since: '2025-09-01', ranges: [{ from: 120, to: 480 }] },
    ]);
    expect(sp(t)).toBe('2 h → 8 h depuis le 1er septembre 2025 ; du 1er mars 2025 au 31 août 2025, 1 h → 7 h ; avant le 1er mars 2025, 22 h → 6 h');
  });
  it('un objet d’avant les périodes : ses plages', () => {
    const o = { ranges: R, share: [], source: 'saisies' } as unknown as OffPeak;
    expect(sp(offPeakSentence(o))).toBe('Heures creuses saisies dans ⚙ Mon contrat : 1 h 05 → 2 h, 22 h → 6 h');
  });
});
