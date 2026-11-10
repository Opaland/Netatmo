// #358: tests that kill the survivors of the first mutation wave (npm run mutation) which change
// a result shown (euros, kWh, dates, a sign, a verdict). Each one was seen red on its mutant: the
// survivor is gone from the next wave. The survivors left, and why (equivalent, no interest), are
// listed in docs/bmad/06-qa-strategy.md (§ « Tests de mutation »).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays } from './aggregate';
import type { TrveRow } from './analysis';
import { BadEnvelope, MIN_ITERATIONS, checkEnvelope, deriveKey, openLocal, sealLocal } from './crypto';
import { type Invoice, type InvoiceData, invoiceKey, reconcile, validInvoice } from './invoice';
import { LS_BUDGET, LS_CO2, budgetPref, budgetStatus, co2Custom, co2Factor, fmtCo2, fmtFactor, gridImpact, newGrid, readPref, writePref } from './money';
import { bucketMarks, bucketRange, countIn, monthsCovered, uncertainText, windowSuffix, yoyCaveat, yoyWindow } from './periods';
import { lostDays, predictHeating, rebuildTotals } from './reconstitute';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('money.ts (#358)', () => {
  it('préférences : budget et facteur CO₂ bornés, valeur absente ou vide = non réglée', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(budgetPref()).toBeNull();
    for (const [raw, want] of [
      ['', null],
      ['abc', null],
      ['0', null],
      ['-5', null],
      ['1000000', null],
      ['999999', 999999],
      ['0.5', 0.5],
    ] as const) {
      writePref(LS_BUDGET, raw);
      expect(budgetPref(), raw).toBe(want);
    }
    expect(co2Factor()).toBe(0.052);
    expect(co2Custom()).toBe(false);
    for (const raw of ['0', '2', '-1', '']) {
      writePref(LS_CO2, raw);
      expect(co2Factor(), raw).toBe(0.052);
    }
    writePref(LS_CO2, '1.99');
    expect(co2Factor()).toBe(1.99);
    expect(co2Custom()).toBe(true);
    writePref(LS_CO2, null);
    expect(readPref(LS_CO2)).toBeNull();
    expect(co2Factor()).toBe(0.052);
    // storage that refuses (private browsing, blocked site data): nothing set, no exception
    const no = () => {
      throw new Error('bloqué');
    };
    vi.stubGlobal('localStorage', { getItem: no, setItem: no, removeItem: no });
    expect(budgetPref()).toBeNull();
    expect(readPref(LS_BUDGET)).toBeNull();
    expect(() => writePref(LS_BUDGET, '5')).not.toThrow();
  });

  it('budget : profil seulement avec une projection ≥ le consommé et des kWh déjà comptés', () => {
    // projection below what is already consumed: prorata
    expect(budgetStatus(1000, 500, 2000, 1500, 100, 365).method).toBe('prorata');
    // projection equal to the consumption: profile, nothing more to come
    const eq = budgetStatus(1000, 500, 2000, 2000, 100, 365);
    expect(eq).toMatchObject({ method: 'profile', projected: 500 });
    // nothing consumed yet: prorata (no price per kWh to extrapolate with)
    expect(budgetStatus(1000, 0, 0, 100, 100, 365).method).toBe('prorata');
    // first day not yet elapsed: the spending stays as it is (no division by zero)
    expect(budgetStatus(1000, 50, 10, null, 0, 365).projected).toBe(50);
    // exactly on budget: not « over »
    const on = budgetStatus(1000, 1000, 2000, 2000, 100, 365);
    expect(on.gap).toBe(0);
    expect(on.over).toBe(false);
  });

  it('CO₂ : une décimale sous 10 kg, en tonnes dès 1 000 kg', () => {
    expect(fmtCo2(5.2)).toBe('5,2 kg CO₂e');
    expect(fmtCo2(10.4)).toBe('10 kg CO₂e');
    expect(fmtCo2(1000)).toBe('1 t CO₂e');
    expect(fmtFactor(0.052)).toBe('0,052 kg CO₂e/kWh');
    expect(fmtFactor(0.0521)).toBe('0,0521 kg CO₂e/kWh');
  });

  it('nouvelle grille : la plus récente de la puissance, triée, changée et dans la fenêtre', () => {
    const r = (from: string, o: Partial<TrveRow> = {}): TrveRow => ({ from, to: null, kva: 9, fixedYear: 200, hc: 0.2, hp: 0.25, ...o });
    const old = r('2025-08-01');
    const fresh = r('2026-02-01', { hc: 0.21 });
    // given unsorted: still the latest as `next`
    expect(newGrid([fresh, old, r('2026-02-01', { kva: 6, hc: 9 })], 9, '2026-03-01')).toEqual({ prev: old, next: fresh });
    expect(newGrid([old], 9, '2026-03-01')).toBeNull();
    expect(newGrid([fresh], 9, '2026-03-01')).toBeNull(); // one grid only, even a recent one
    // only one price moved: still a new grid
    expect(newGrid([old, r('2026-02-01', { hp: 0.26 })], 9, '2026-03-01')).not.toBeNull();
    expect(newGrid([old, r('2026-02-01', { fixedYear: 210 })], 9, '2026-03-01')).not.toBeNull();
    expect(newGrid([old, r('2026-02-01')], 9, '2026-03-01')).toBeNull();
    // a grid that started exactly `window` days before the last day is too old
    expect(newGrid([old, fresh], 9, addDays('2026-02-01', 30), 30)).toBeNull();
    expect(newGrid([old, fresh], 9, addDays('2026-02-01', 29), 30)).not.toBeNull();
  });

  it('impact d\'une grille : pas de pourcentage sur un coût ancien nul', () => {
    const z: TrveRow = { from: '2025-01-01', to: null, kva: 9, fixedYear: 0, hc: 0, hp: 0 };
    expect(gridImpact(0, 10, z, { ...z, fixedYear: 5 }).pct).toBeNull();
    expect(gridImpact(100, 110, { ...z, fixedYear: 100 }, { ...z, fixedYear: 100 }).pct).toBe(5);
  });
});

describe('periods.ts (#358)', () => {
  it('bornes d\'un seau : le jour, le mois (dernier jour réel)', () => {
    expect(bucketRange('2026-03-05', 'day')).toEqual(['2026-03-05', '2026-03-05']);
    expect(bucketRange('2026-11', 'month')).toEqual(['2026-11-01', '2026-11-30']);
    expect(bucketRange('2024-02', 'month')).toEqual(['2024-02-01', '2024-02-29']);
  });

  it('pluriels', () => {
    expect(uncertainText(1)).toBe('1 jour estimé ou manquant');
    expect(uncertainText(2)).toBe('2 jours estimés ou manquants');
  });

  it('seaux : jours incertains comptés bornes comprises, un seul jour couvert', () => {
    const lost = new Set(['2026-03-09', '2026-03-10', '2026-03-20', '2026-03-21']);
    const [m] = bucketMarks(['2026-03'], 'month', '2026-03-10', '2026-03-20', lost);
    expect(m).toMatchObject({ covered: 11, uncertain: 2 });
    expect(m.note).toBe('11 jours sur 31 (du 10 mars au 20 mars) · 2 jours estimés ou manquants');
    const [one] = bucketMarks(['2026-03'], 'month', '2026-03-10', '2026-03-10');
    expect(one).toMatchObject({ covered: 1, partial: true, note: '1 jour sur 31 (le 10 mars)' });
    const [day] = bucketMarks(['2026-03-10'], 'day', '2026-03-01', '2026-03-31', new Set(['2026-03-10']));
    expect(day.note).toBe('jour estimé ou manquant');
  });

  it('même période : bornes de l\'année, 29 février, fenêtre vide', () => {
    // started on 29 Feb of a leap year: the next year starts on 1 March
    expect(yoyWindow(2025, '2024-02-29', '2025-12-31')?.from).toBe('2025-03-01');
    expect(yoyWindow(2001, '2000-02-29', '2001-12-31')?.from).toBe('2001-03-01');
    // the running year reduced to its first day
    expect(yoyWindow(2026, '2025-01-01', '2026-01-01')).toMatchObject({ from: '2026-01-01', to: '2026-01-01' });
    // data that starts after the last day of the year compared: no window
    expect(yoyWindow(2026, '2025-06-01', '2026-03-01')).toBeNull();
    // data from the last day of the previous year: a one-day window on 31 December
    expect(yoyWindow(2026, '2025-12-31', '2026-12-31')).toMatchObject({ from: '2026-12-31', to: '2026-12-31' });
    expect(yoyWindow(2026, '2025-01-01', '2026-11-08')?.label).toBe('du 1er janv. au 8 nov.');
    const cut = yoyWindow(2026, '2025-06-01', '2026-11-08');
    expect(windowSuffix(cut)).toBe(' (du 1er juin au 8 nov.)');
    expect(windowSuffix(null)).toBe('');
  });

  it('jours comptés bornes comprises, mois couverts', () => {
    expect(countIn(new Set(['2026-01-01', '2026-01-31', '2026-02-01']), '2026-01-01', '2026-01-31')).toBe(2);
    expect(monthsCovered('2026-01-01', '2026-01-01')).toBeCloseTo(1 / 30.4375);
    expect(monthsCovered('2026-02-01', '2026-01-01')).toBe(0);
  });

  it('avertissement : « à date », ou rien quand on ne le veut pas, et les deux années', () => {
    const w = yoyWindow(2026, '2025-01-01', '2026-11-08');
    expect(yoyCaveat(null, new Set())).toBe('');
    expect(yoyCaveat(w, new Set())).toBe('à date');
    expect(yoyCaveat(w, new Set(), { toDate: false })).toBe('');
    expect(yoyCaveat(w, new Set(['2026-03-01', '2025-03-01']), { toDate: false })).toBe('2026 : 1 jour estimé ou manquant · 2025 : 1 jour estimé ou manquant');
  });
});

describe('invoice.ts (#358)', () => {
  const base = { from: '2025-03-01', to: '2025-03-31', amount: 10 };
  it('validInvoice : montants numériques et bornés, dates en texte, cases à cocher', () => {
    expect(validInvoice({ ...base, amount: '5' })).toBeNull();
    expect(validInvoice({ ...base, amount: 1e6 })).toBeNull();
    expect(validInvoice({ ...base, amount: 2e6 })).toBeNull();
    expect(validInvoice({ ...base, amount: 0 })?.amount).toBe(0);
    expect(validInvoice({ ...base, kwh: 0 })?.kwh).toBe(0);
    expect(validInvoice({ ...base, from: ['2025-03-01'] })).toBeNull();
    expect(validInvoice({ ...base, to: ['2025-03-31'] })).toBeNull();
    expect(validInvoice({ ...base, to: '2025-03-01' })).toMatchObject({ from: '2025-03-01', to: '2025-03-01' });
    expect(validInvoice({ ...base, subscription: false })?.subscription).toBe(false);
    expect(validInvoice(base)?.subscription).toBe(true);
    expect(validInvoice({ ...base, estimated: true })?.estimated).toBe(true);
    expect(invoiceKey(validInvoice(base)!)).toBe('2025-03-01|2025-03-31|10');
  });

  // One day, 10 kWh at 0.25 €, subscription 365 €/year: the app counts 2.50 + 1.00 = 3.50 €.
  const flat: TrveRow = { from: '2025-01-01', to: null, kva: 9, fixedYear: 365, hc: 0.25, hp: 0.25 };
  const one = (o: Partial<Invoice> = {}): Invoice => ({ from: '2025-03-01', to: '2025-03-01', amount: 3.5, kwh: null, subscription: true, estimated: false, ...o });
  const data = (o: Partial<InvoiceData> = {}): InvoiceData => ({
    linky: new Map([['2025-03-01', 10]]),
    heat: new Map([['2025-03-01', 4]]),
    water: new Map(),
    priceAt: () => flat,
    offShare: 0,
    ...o,
  });
  const line = (r: ReturnType<typeof reconcile>, kind: string) => r.lines.find((l) => l.kind === kind);

  it('reste égal à la tolérance : négligeable ; signe du reste ; écart en %', () => {
    const r = reconcile(one({ amount: 5.5 }), data());
    expect(r.appTotal).toBe(3.5);
    expect(r.residual).toBe(2);
    expect(r.tolerance).toBe(2);
    expect(r.verdict).toBe('ok');
    expect(line(r, 'residual')!.text).toMatch(/^Reste \+2,00 € : négligeable/);
    expect(r.gapPct).toBeCloseTo((2 / 5.5) * 100);
    expect(r.scope).toBe('home');
    expect(line(reconcile(one({ amount: 2.5 }), data()), 'residual')!.text).toMatch(/^Reste −1,00 €/);
    expect(line(reconcile(one(), data()), 'residual')!.text).toMatch(/^Reste \+0,00 €/);
    expect(reconcile(one({ amount: 0 }), data()).gapPct).toBeNull();
    const above = reconcile(one({ amount: 30 }), data());
    expect(above.verdict).toBe('unexplained');
    expect(line(above, 'residual')!.text).toMatch(/^Reste \+26,50 € non expliqué/);
    expect(line(reconcile(one({ amount: 0.5 }), data()), 'residual')!.text).toMatch(/^Reste −3,00 € non expliqué/);
  });

  it('kWh de la facture : mêmes, de plus, de moins, relevé estimé', () => {
    expect(line(reconcile(one({ kwh: 10 }), data()), 'kwh')).toEqual({ kind: 'kwh', eur: 0, text: 'Mêmes kWh que le compteur Linky (10 kWh).' });
    const plus = line(reconcile(one({ kwh: 11 }), data()), 'kwh')!;
    expect(plus.eur).toBeCloseTo(0.25);
    expect(plus.text).toMatch(/^La facture compte 1 kWh de plus que le compteur Linky \(\+0,25 €\)/);
    expect(line(reconcile(one({ kwh: 6 }), data()), 'kwh')!.text).toMatch(/4 kWh de moins que le compteur Linky \(−1,00 €\) : dates/);
    expect(line(reconcile(one({ kwh: 6, estimated: true }), data()), 'kwh')!.text).toMatch(/^Relevé estimé : la facture compte 4 kWh de moins que le compteur Linky \(−1,00 €\)/);
    expect(line(reconcile(one({ kwh: 12, estimated: true }), data()), 'kwh')!.text).toMatch(/2 kWh de plus que le compteur Linky \(\+0,50 €\)/);
  });

  it('sans Linky : seuls les jours de radiateurs ou de chauffe-eau, et la ligne de périmètre', () => {
    const inv = one({ from: '2025-03-01', to: '2025-03-04', kwh: 20 });
    const d = data({ linky: new Map(), heat: new Map([['2025-03-01', 4]]), water: new Map([['2025-03-02', 2]]) });
    const r = reconcile(inv, d);
    expect(r.linkyDays).toBe(2);
    expect(r.missingDays).toBe(2);
    expect(r.appKwh).toBe(12); // 6 measured + 2 days × 3
    expect(r.scope).toBe('heating');
    expect(line(r, 'scope')!.text).toMatch(/^Sans compteur Linky/);
    expect(line(r, 'kwh')!.text).toMatch(/^La facture compte 8 kWh de plus que les radiateurs et le chauffe-eau .*\(\+2,00 €\)/);
    expect(line(r, 'missing')!.text).toBe('2 jours sans relevé dans la période, comptés à la moyenne des autres jours (6 kWh, 1,50 €).');
    // fewer kWh on the invoice than the radiators: a negative amount, said with « − »
    expect(line(reconcile({ ...inv, kwh: 2 }, d), 'kwh')!.text).toBe(
      'La facture compte 10 kWh de moins que les radiateurs et le chauffe-eau (−2,50 €) : relevé estimé ou dates de relevé décalées.',
    );
    expect(line(reconcile(one(), data()), 'scope')).toBeUndefined();
    expect(line(reconcile(one(), data()), 'missing')).toBeUndefined();
    const oneMissing = reconcile(one({ to: '2025-03-02' }), data());
    expect(line(oneMissing, 'missing')!.text).toMatch(/^1 jour sans relevé Linky dans la période/);
  });

  it('abonnement : année bissextile, case décochée ; jours sans prix', () => {
    const leap = { ...flat, fixedYear: 366 };
    const feb = reconcile(one({ from: '2024-02-01', to: '2024-02-29' }), data({ linky: new Map([['2024-02-01', 1]]), priceAt: () => leap }));
    expect(feb.subscription).toBeCloseTo(29, 9);
    expect(line(feb, 'subscription')!.text).toBe(
      "Abonnement compté au prorata des jours : 29,00 € pour 29 jours. Un fournisseur le facture souvent par mois entier ou d'avance : quelques euros d'écart en viennent.",
    );
    expect(line(reconcile(one({ subscription: false }), data()), 'subscription')!.text).toBe('Abonnement exclu des deux côtés (case décochée).');
    // a day with kWh but no price: not priced, no crash
    const two = reconcile(one({ to: '2025-03-02' }), data({ linky: new Map([['2025-03-01', 10], ['2025-03-02', 10]]), priceAt: (d) => (d === '2025-03-02' ? flat : null) }));
    expect(two.avgPrice).toBe(0.25);
    expect(two.linkyKwh).toBe(20);
    // prices only on days without kWh: no average price, « no-price », nothing computed
    const none = reconcile(one({ to: '2025-03-02' }), data({ linky: new Map([['2025-03-01', 10]]), priceAt: (d) => (d === '2025-03-02' ? flat : null) }));
    expect(none).toMatchObject({ verdict: 'no-price', avgPrice: null, heatCost: null, lines: [] });
  });

  it('coût des radiateurs : celui donné (même nul), sinon au prix moyen', () => {
    expect(reconcile(one(), data({ heatCost: 12 })).heatCost).toBe(12);
    expect(reconcile(one(), data({ heatCost: null })).heatCost).toBe(1);
    expect(reconcile(one(), data({ heatCost: 0 })).heatCost).toBe(0);
  });
});

describe('reconstitute.ts (#358)', () => {
  const rec = (day: string, room = 'a', kwh = 1) => ({ day, room, cat: 'heating' as const, kwh });
  it('jours perdus : relevés donnés dans le désordre', () => {
    expect([...lostDays([rec('2026-01-03'), rec('2026-01-01')]).keys()]).toEqual(['2026-01-02']);
  });
  it('signature : rien au-dessus de 15 °C ni de la température d\'équilibre, jamais négatif', () => {
    const fit = { slope: -2, intercept: 30, r2: 0.9, balance: null, n: 100 };
    expect(predictHeating(fit, 14)).toBe(2);
    expect(predictHeating(fit, 15)).toBe(0);
    expect(predictHeating(fit, 14.9)).toBeCloseTo(0.2);
    expect(predictHeating({ ...fit, balance: 12 }, 12)).toBe(0);
    expect(predictHeating({ ...fit, balance: 12 }, 11)).toBe(8);
    expect(predictHeating({ ...fit, intercept: 10 }, 14)).toBe(0); // the line is below zero: 0
  });
  it('totaux par année, dans l\'ordre des années', () => {
    expect(rebuildTotals([rec('2026-01-01'), rec('2025-01-01'), rec('2024-01-01')], []).map((y) => y.year)).toEqual(['2024', '2025', '2026']);
  });
});

describe('crypto.ts (#358)', () => {
  it('note privée : scellée puis rouverte avec la même clé, refusée avec une autre', async () => {
    const k = (b: number) => crypto.subtle.importKey('raw', new Uint8Array(32).fill(b), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const key = await k(1);
    const sealed = await sealLocal({ facture: 42 }, key);
    expect(Object.keys(sealed).sort()).toEqual(['ct', 'iv']);
    expect(await openLocal(sealed, key)).toEqual({ facture: 42 });
    await expect(openLocal(sealed, await k(2))).rejects.toThrow();
  });
  it('la clé dérivée ne s\'exporte pas, et un KDF inconnu est nommé', async () => {
    const key = await deriveKey('demo', { salt: btoa('sel-de-test-1234'), iter: MIN_ITERATIONS });
    expect(key.extractable).toBe(false);
    expect(() => checkEnvelope({ v: 1, kdf: 'scrypt', iter: MIN_ITERATIONS, salt: '', iv: '', ct: '' })).toThrow(new BadEnvelope('Dérivation de clé inconnue (scrypt).'));
  });
});
