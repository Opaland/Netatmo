import { describe, expect, it } from 'vitest';
import { firstSentence, loadVotes, pseudonymLegend, saveVote, usageLine, usefulRate } from './insight';

describe('firstSentence (#314: the row of the monthly analysis in Outils)', () => {
  it('skips the title and the markdown marks', () => {
    expect(firstSentence('## Novembre 2026\n\n**Un mois plus sobre** que l’an dernier. Le salon a moins chauffé.')).toBe('Un mois plus sobre que l’an dernier.');
    expect(firstSentence('- [Lien](x) court')).toBe('Lien court');
    expect(firstSentence('')).toBe('');
  });
  it('cuts a long sentence', () => {
    const s = firstSentence('a'.repeat(200), 20);
    expect(s).toHaveLength(20);
    expect(s.endsWith('…')).toBe(true);
  });
});

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('S-5.8 usefulness votes and cost', () => {
  it('keeps one vote per analysed month on the device, a second click withdraws it', () => {
    const s = memory();
    saveVote('2026-08', 'up', s);
    saveVote('2026-09', 'down', s);
    saveVote('2026-10', 'up', s);
    expect(loadVotes(s)).toEqual({ '2026-08': 'up', '2026-09': 'down', '2026-10': 'up' });
    saveVote('2026-09', null, s);
    expect(loadVotes(s)).toEqual({ '2026-08': 'up', '2026-10': 'up' });
    expect(loadVotes({ getItem: () => '{"x":"up","2026-01":"maybe"}' })).toEqual({});
    expect(loadVotes({ getItem: () => 'not json' })).toEqual({});
    expect(loadVotes(null)).toEqual({});
  });

  it('rates the analyses of the last 3 months (ADR-5)', () => {
    const votes = { '2026-07': 'up', '2026-08': 'up', '2026-09': 'down', '2026-10': 'up' } as const;
    expect(usefulRate(votes, '2026-11-09')).toEqual({ useful: 2, rated: 3, months: ['2026-08', '2026-09', '2026-10'] });
    expect(usefulRate(votes, '2027-01-02')).toMatchObject({ useful: 1, rated: 1, months: ['2026-10', '2026-11', '2026-12'] });
  });

  it('shows model, tokens and estimated cost', () => {
    const line = usageLine('claude-opus-5-5', {
      requests: 2,
      input_tokens: 2000,
      output_tokens: 1000,
      cost_usd: 0.028,
      cost_eur: 0.0244,
      served_by: ['claude-opus-5-5'],
    });
    expect(line).toBe(
      'Modèle claude-opus-5-5 · 2 requêtes · 3 000 jetons (2 000 en entrée, 1 000 en sortie) · coût estimé 0,024 € (0,028 $ au tarif public)',
    );
    expect(usageLine('claude-opus-5-5', undefined)).toContain('non mesurés');
  });
});

describe('S-5.7 pseudonym legend', () => {
  it('lists rooms first, then sensors', () => {
    expect(pseudonymLegend({ 'Capteur A': 'Chambre', 'Pièce B': 'Cuisine', 'Pièce AA': 'Cave', 'Pièce A': 'Salon' })).toEqual([
      ['Pièce A', 'Salon'],
      ['Pièce B', 'Cuisine'],
      ['Pièce AA', 'Cave'],
      ['Capteur A', 'Chambre'],
    ]);
  });
});
