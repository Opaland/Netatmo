import { describe, expect, it } from 'vitest';
import { LEGAL_REVIEW, SERVICES, legalHtml, stale } from './legal';

describe('cadre juridique (S-8.14)', () => {
  it('cites, dates and rates every service', () => {
    for (const s of SERVICES) {
      expect(s.read).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.read <= LEGAL_REVIEW).toBe(true);
      expect(s.url).toMatch(/^https:\/\//);
      expect(['faible', 'moyen', 'élevé']).toContain(s.risk);
      expect(s.terms.length).toBeGreaterThan(20);
    }
    for (const name of ['Intuis', 'Netatmo', 'Conso API']) expect(SERVICES.some((s) => s.name.includes(name))).toBe(true);
  });

  it('flags a reading older than a year', () => {
    expect(stale('2026-11-09', '2027-11-09')).toBe(false);
    expect(stale('2026-11-09', '2027-11-11')).toBe(true);
    expect(legalHtml('2026-12-01')).not.toContain('<strong class="ko-red">à relire');
    expect(legalHtml('2028-01-01')).toContain('<strong class="ko-red">à relire');
  });
});
