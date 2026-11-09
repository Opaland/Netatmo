// S-2.3: reconciling the app's cost with an invoice.
import { describe, expect, it } from 'vitest';
import { addDays } from './aggregate';
import type { TrveRow } from './analysis';
import { type Invoice, periodDays, reconcile, tolerance, validInvoice } from './invoice';

const row: TrveRow = { from: '2025-02-01', to: null, kva: 9, fixedYear: 365, hc: 0.2, hp: 0.25 };
const priceAt = (d: string) => (d >= row.from ? row : null);

function days(from: string, n: number, v: number) {
  const m = new Map<string, number>();
  for (let i = 0; i < n; i++) m.set(addDays(from, i), v);
  return m;
}

const inv = (o: Partial<Invoice> = {}): Invoice => ({
  from: '2025-03-01',
  to: '2025-03-31',
  amount: 0,
  kwh: null,
  subscription: true,
  estimated: false,
  ...o,
});

describe('validInvoice', () => {
  it('keeps a clean invoice and rejects broken ones', () => {
    expect(validInvoice({ from: '2025-03-01', to: '2025-03-31', amount: 120.5, kwh: 400 })).toEqual(inv({ amount: 120.5, kwh: 400 }));
    expect(validInvoice({ from: '2025-03-31', to: '2025-03-01', amount: 1 })).toBeNull();
    expect(validInvoice({ from: '2025-03-01', to: '2025-03-31', amount: -1 })).toBeNull();
    expect(validInvoice({ from: 'mars', to: '2025-03-31', amount: 1 })).toBeNull();
    expect(validInvoice(null)).toBeNull();
    expect(validInvoice({ from: '2025-03-01', to: '2025-03-02', amount: 3, kwh: 'x', estimated: true })?.kwh).toBeNull();
  });
  it('counts both ends of the period', () => {
    expect(periodDays('2025-03-01', '2025-03-31')).toBe(31);
    expect(periodDays('2024-02-01', '2024-02-29')).toBe(29);
  });
});

describe('reconcile', () => {
  const data = {
    linky: days('2025-03-01', 31, 20), // 620 kWh
    heat: days('2025-03-01', 31, 10),
    water: days('2025-03-01', 31, 4),
    priceAt,
    offShare: 0.4, // 0.4 × 0.20 + 0.6 × 0.25 = 0.23 €/kWh
  };
  const energy = 620 * 0.23; // 142.6
  const sub = 31; // 365 € a year, 1 € a day

  it('finds an invoice that matches the meter and the regulated tariff', () => {
    const r = reconcile(inv({ amount: energy + sub + 1, kwh: 620 }), data);
    expect(r.avgPrice).toBeCloseTo(0.23);
    expect(r.appTotal).toBeCloseTo(energy + sub);
    expect(r.gap).toBeCloseTo(1);
    expect(r.verdict).toBe('ok');
    expect(r.lines.find((l) => l.kind === 'residual')!.text).toMatch(/négligeable/);
    // heating + water heater share, priced at the average price when no cost is given
    expect(r.heatCost).toBeCloseTo(310 * 0.23);
    expect(r.waterCost).toBeCloseTo(124 * 0.23);
    expect(r.otherCost).toBeCloseTo(186 * 0.23);
  });

  it('explains an estimated reading by the kWh billed in excess', () => {
    const r = reconcile(inv({ amount: energy + sub + 50 * 0.23, kwh: 670, estimated: true }), data);
    const k = r.lines.find((l) => l.kind === 'kwh')!;
    expect(k.eur).toBeCloseTo(11.5);
    expect(k.text).toMatch(/Relevé estimé.*50 kWh de plus/);
    expect(r.residual).toBeCloseTo(0);
    expect(r.verdict).toBe('ok');
  });

  it('flags what it cannot explain', () => {
    const r = reconcile(inv({ amount: energy + sub + 40 }), data);
    expect(r.verdict).toBe('unexplained');
    expect(r.residual).toBeCloseTo(40);
    expect(r.lines.find((l) => l.kind === 'residual')!.text).toMatch(/non expliqué/);
  });

  it('leaves the subscription out when the invoice does', () => {
    const r = reconcile(inv({ amount: energy, subscription: false }), data);
    expect(r.subscription).toBeNull();
    expect(r.gap).toBeCloseTo(0);
  });

  it('fills missing meter days with the average of the others', () => {
    const linky = new Map(data.linky);
    linky.delete('2025-03-10');
    linky.delete('2025-03-11');
    const r = reconcile(inv({ amount: energy + sub }), { ...data, linky });
    expect(r.missingDays).toBe(2);
    expect(r.missingKwh).toBeCloseTo(40);
    expect(r.appTotal).toBeCloseTo(energy + sub);
    expect(r.lines.some((l) => l.kind === 'missing' && /2 jours sans relevé Linky/.test(l.text))).toBe(true);
  });

  it('prices only the radiators and the water heater without a Linky meter', () => {
    const r = reconcile(inv({ amount: 434 * 0.23 + sub + 30 }), { ...data, linky: new Map() });
    expect(r.scope).toBe('heating');
    expect(r.appKwh).toBe(434);
    expect(r.lines[0].kind).toBe('scope');
    expect(r.otherCost).toBeNull();
  });

  it('says so when no price is known for the period', () => {
    const r = reconcile(inv({ from: '2025-01-01', to: '2025-01-31', amount: 100 }), data);
    expect(r.verdict).toBe('no-price');
    expect(r.gap).toBeNull();
  });

  it('tolerates 3 % of the invoice, 2 € at least', () => {
    expect(tolerance(10)).toBe(2);
    expect(tolerance(300)).toBeCloseTo(9);
  });
});
