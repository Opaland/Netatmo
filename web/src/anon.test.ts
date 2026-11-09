// S-6.4 (anonymised report) and S-6.3 (offers and maximum power in the annual report).
import { describe, expect, it } from 'vitest';
import { type AnonReport, anonReportHtml, leaks, pseudonyms } from './anon';
import type { TempoRow, TrveRow } from './analysis';
import { offersForYear, offersSectionHtml, pmaxForYear, pmaxSectionHtml } from './report-sections';

const rooms = [
  { id: '2871340912', category: 'heating' as const, now: 900, before: 1000 },
  { id: '1029384756', category: 'heating' as const, now: 1500, before: 1400 },
  { id: '5647382910', category: 'water_heater' as const, now: 1200, before: 1250 },
];

describe('pseudonyms', () => {
  it('names heating rooms by decreasing consumption and the water heater generically', () => {
    const p = pseudonyms(rooms);
    expect(p.get('1029384756')).toBe('Pièce A');
    expect(p.get('2871340912')).toBe('Pièce B');
    expect(p.get('5647382910')).toBe('Chauffe-eau');
  });
  it('numbers several water heaters and goes past Z', () => {
    const many = Array.from({ length: 28 }, (_, i) => ({ id: `r${i}`, category: 'heating' as const, now: 100 - i, before: 0 }));
    const p = pseudonyms([...many, { id: 'w1', category: 'water_heater', now: 5, before: 0 }, { id: 'w2', category: 'water_heater', now: 9, before: 0 }]);
    expect(p.get('r26')).toBe('Pièce AA');
    expect(p.get('w2')).toBe('Chauffe-eau 1');
    expect(p.get('w1')).toBe('Chauffe-eau 2');
  });
});

describe('anonymised report', () => {
  const report: AnonReport = {
    year: 2025,
    years: [2024, 2025],
    from: '2025-01-01',
    to: '2025-12-31',
    total: 3600,
    prevTotal: 3650,
    heating: 2400,
    water: 1200,
    cost: 812,
    dju: 2100,
    djuPrev: 2300,
    climateChange: -4.2,
    peak: { day: '2025-01-12', kwh: 41.5 },
    rooms,
    estimated: false,
    sources: 'Intuis, météo Open-Meteo, compteur Linky',
    generated: '2026-11-09',
    extras: '<section id="report-offers"></section>',
  };
  const html = anonReportHtml(report);
  const text = html.replace(/<[^>]+>/g, ' ');

  it('states the period and uses pseudonyms only', () => {
    expect(text).toContain('du 1er janvier 2025 au 31 décembre 2025 (365 jours)');
    expect(text).toContain('Pièce A');
    expect(html).toContain('id="report-offers"');
    for (const r of rooms) expect(html).not.toContain(r.id);
  });

  it('contains no name, id or coordinate of the real home', () => {
    const secrets = ['Villa Les Mimosas', '5f1e2d3c4b5a69788796a5b4', 'Chambre de Léa', 'Bureau de Paul', 'Chauffe-eau', ...rooms.map((r) => r.id)];
    expect(leaks(text, secrets)).toEqual([]);
    expect(text).not.toMatch(/\d{1,2}\.\d{4,}/); // no latitude / longitude
    expect(text).not.toMatch(/\b\d{1,2}:\d{2}\b/); // no time of day
  });

  it('S-12.6: covers the lease only, without any comparison with the year before', () => {
    const lease = anonReportHtml({ ...report, from: '2024-07-01', to: '2025-06-30', lease: true, leaseChoice: true, prevTotal: 0, extras: '' });
    const t = lease.replace(/<[^>]+>/g, ' ');
    expect(t).toContain('période du bail');
    expect(t).toContain('du 1er juillet 2024 au 30 juin 2025 (365 jours)');
    expect(t).not.toContain('vs 2024');
    expect(t).not.toContain('Évolution');
    expect(lease).toContain('<option value="lease" selected>');
  });

  it('leak detector finds whole names and ignores generic or short ones', () => {
    expect(leaks('Pièce A : Chambre de Léa', ['Chambre de Léa', 'Léa', 'Chauffe-eau', 'A'])).toEqual(['Chambre de Léa', 'Léa']);
    expect(leaks('Salonnière', ['Salon'])).toEqual([]);
    expect(leaks('(ID 2871340912)', ['2871340912'])).toEqual(['2871340912']);
  });
});

describe('report sections (S-6.3)', () => {
  it('summarises the maximum power of the year against the subscribed power', () => {
    const pmax = new Map([
      ['2024-12-31', 11],
      ['2025-01-10', 8.4],
      ['2025-01-20', 9.3],
      ['2025-02-03', 6.1],
    ]);
    const p = pmaxForYear(pmax, 2025, () => 9)!;
    expect(p.peak).toEqual({ max: 9.3, day: '2025-01-20', kva: 9 });
    expect(p.months.map((m) => m.month)).toEqual([0, 1]);
    expect(p.daysOver).toBe(1);
    expect(p.daysNear).toBe(2);
    const html = pmaxSectionHtml(p);
    expect(html).toContain('9,3 kVA');
    expect(html).toContain('20 janvier 2025');
    expect(pmaxForYear(pmax, 2023, () => 9)).toBeNull();
    expect(pmaxSectionHtml(null)).toContain('id="report-pmax"');
  });

  it('compares the three offers on the days of the year', () => {
    const row = (hp: number, hc: number): TrveRow => ({ from: '2020-01-01', to: null, kva: 9, fixedYear: 200, hp, hc });
    const tempo: TempoRow = { from: '2020-01-01', to: null, kva: 9, fixedYear: 200, prices: { 1: [0.1, 0.12], 2: [0.14, 0.17], 3: [0.15, 0.6] } };
    const splits = [
      { day: '2025-01-01', hc: 10, hp: 10 },
      { day: '2025-01-02', hc: 10, hp: 10 },
      { day: '2024-12-31', hc: 10, hp: 10 },
    ];
    const o = offersForYear(2025, {
      splits,
      kvaAt: () => 9,
      base: [row(0.25, 0.25)],
      hphc: [row(0.27, 0.2)],
      tempo: [tempo],
      tempoDays: new Map([
        ['2025-01-01', 1],
        ['2025-01-02', 1],
        ['2024-12-31', 1],
      ]),
      scope: 'logement',
    })!;
    expect(o.days).toBe(2);
    expect(o.best).toBe('tempo');
    expect(o.costs.base.energy).toBeCloseTo(10, 5);
    const html = offersSectionHtml(o);
    expect(html).toContain('id="report-offers"');
    expect(html).toContain('<strong>Tempo</strong>');
    expect(offersSectionHtml(null)).toContain('indisponible');
  });
});
