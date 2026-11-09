import { afterEach, describe, expect, it, vi } from 'vitest';
import { STEP_COUNT, dismissTip, finishOnboarding, needsOnboarding, nextStep, parseFlags, readFlags, stepKey, stepLabel, tipPending, whoOf } from './onboarding';
import { parseRoute, routeKey } from './router';

function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('premier lancement (#312)', () => {
  it('quatre écrans, chacun avec son adresse', () => {
    expect(STEP_COUNT).toBe(4);
    for (const s of [1, 2, 3, 4] as const) {
      const r = parseRoute(`#${stepKey(s)}`);
      expect(r).toEqual({ page: 'bienvenue', step: s });
      expect(routeKey(r!)).toBe(stepKey(s));
    }
    expect(stepKey(1)).toBe('bienvenue');
    expect(parseRoute('#bienvenue-5')).toBeNull();
    expect(parseRoute('#bienvenue-1')).toBeNull();
    expect(stepLabel(2)).toBe('Étape 2 sur 4');
  });

  it('un proche ne règle ni les sources ni le contrat', () => {
    expect(nextStep(1, 'proche')).toBe(2);
    expect(nextStep(2, 'proche')).toBeNull();
    expect(nextStep(2, 'gere')).toBe(3);
    expect(nextStep(3, 'locataire')).toBe(4);
    expect(nextStep(4, 'gere')).toBeNull();
  });

  it('pré-sélectionne le réglage actuel de ce téléphone', () => {
    expect(whoOf(false, false)).toBe('gere');
    expect(whoOf(true, false)).toBe('proche');
    expect(whoOf(true, true)).toBe('locataire');
  });

  it('un appareil déjà utilisé (état enregistré) ne revoit pas les écrans', () => {
    expect(parseFlags(null, false)).toEqual({ done: false, tip: false });
    expect(parseFlags(null, true)).toEqual({ done: true, tip: false });
    expect(parseFlags('{"done":true,"tip":true}', false)).toEqual({ done: true, tip: true });
    expect(parseFlags('pas du json', true)).toEqual({ done: true, tip: false });
    expect(parseFlags('null', false)).toEqual({ done: false, tip: false });
  });

  it('vu une fois : la bulle d’aide ensuite, une seule fois', () => {
    const s = fakeStorage();
    vi.stubGlobal('localStorage', s);
    expect(needsOnboarding(false)).toBe(true);
    finishOnboarding(false);
    expect(needsOnboarding(false)).toBe(false);
    expect(tipPending(false)).toBe(true);
    dismissTip(false);
    expect(tipPending(false)).toBe(false);
    expect(readFlags(false)).toEqual({ done: true, tip: false });
    // passer : pas de bulle
    s.map.clear();
    finishOnboarding(false, false);
    expect(tipPending(false)).toBe(false);
    // jamais la phrase de passe ni autre chose que les deux drapeaux
    expect([...s.map.keys()]).toEqual(['intuis-history:onboarding']);
    expect(Object.keys(JSON.parse(s.map.get('intuis-history:onboarding')!))).toEqual(['done', 'tip']);
  });

  it('en démo : jamais ouvert de lui-même, rien n’est enregistré', () => {
    const s = fakeStorage();
    vi.stubGlobal('localStorage', s);
    expect(needsOnboarding(true)).toBe(false);
    finishOnboarding(true);
    expect(tipPending(true)).toBe(true);
    dismissTip(true);
    expect(tipPending(true)).toBe(false);
    expect(s.map.size).toBe(0);
  });

  it('stockage indisponible : on ne bloque pas l’appli', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('bloqué');
      },
      setItem: () => {
        throw new Error('bloqué');
      },
    });
    expect(needsOnboarding(false)).toBe(false);
    expect(() => finishOnboarding(false)).not.toThrow();
  });
});
