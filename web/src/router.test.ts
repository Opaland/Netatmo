import { describe, expect, it, vi } from 'vitest';
import { METER_PAGES, SETTINGS, TABS, TOOLS, allowed, parentOf, parseRoute, routeKey, simpleTabs, tabOf, titleOf, visibleTabs } from './router';
import { fmt1 } from './glossary';
import { dispatch, type Handlers } from './events';

describe('router (#308)', () => {
  it('five tabs, in the order of the mock-ups', () => {
    expect(TABS.map(([, l]) => l)).toEqual(['Accueil', 'Pièces', 'Historique', 'Compteur', 'Outils']);
  });

  it('every address reads back to itself (stable names)', () => {
    const keys = [
      ...TABS.map(([t]) => t),
      'piece-r-salon',
      'confort',
      'chauffe-eau',
      'etat',
      'rapport',
      'aide',
      'parametres',
      ...Object.keys(SETTINGS).map((s) => `parametres-${s}`),
      ...Object.keys(TOOLS).map((t) => `outils-${t}`),
      ...Object.keys(METER_PAGES).map((m) => `compteur-${m}`),
    ];
    for (const k of keys) {
      const r = parseRoute(`#${k}`);
      expect(r, k).not.toBeNull();
      expect(routeKey(r!)).toBe(k);
    }
  });

  it('a room id is encoded in its address', () => {
    const r = { page: 'piece' as const, room: 'Chambre 1/é' };
    expect(parseRoute(routeKey(r))).toEqual(r);
  });

  it('unknown addresses are not routes (anchors, #installer, old names)', () => {
    for (const k of ['#installer', '#quality', '#overview', '#outils-inconnu', '#compteur-inconnu', '#parametres-x', '#piece-%E0%A4%A', '']) expect(parseRoute(k)).toBeNull();
  });

  it('a sub-page lights its tab and goes back to it', () => {
    expect(tabOf({ page: 'piece', room: 'x' })).toBe('pieces');
    expect(parentOf({ page: 'piece', room: 'x' })).toBe('pieces');
    expect(tabOf({ page: 'outil', tool: 'facture' })).toBe('outils');
    expect(parentOf({ page: 'etat' })).toBe('outils');
    expect(parentOf({ page: 'parametres', section: 'contrat' })).toBe('parametres');
    expect(parentOf({ page: 'parametres', section: null })).toBe('accueil');
    expect(parentOf({ page: 'historique' })).toBeNull();
    expect(tabOf({ page: 'parametres', section: null })).toBeNull();
    expect(tabOf({ page: 'compteur-detail', sub: 'veille' })).toBe('compteur');
    expect(parentOf({ page: 'compteur-detail', sub: 'veille' })).toBe('compteur');
  });

  it('titles of the sub-pages', () => {
    expect(titleOf({ page: 'piece', room: 'r1' }, (id) => (id === 'r1' ? 'Salon' : id))).toBe('Salon');
    expect(titleOf({ page: 'parametres', section: 'contrat' })).toBe('Contrat et prix');
    expect(titleOf({ page: 'outil', tool: 'facture' })).toBe('Une facture');
    expect(titleOf({ page: 'compteur-detail', sub: 'heures-creuses' })).toBe('Heures pleines / creuses');
  });

  it('tenant mode: no Compteur tab, its address falls back to Outils', () => {
    expect(visibleTabs(true).map(([t]) => t)).not.toContain('compteur');
    expect(visibleTabs(false)).toHaveLength(5);
    expect(allowed({ page: 'compteur' }, true)).toEqual({ page: 'outils' });
    expect(allowed({ page: 'compteur' }, false)).toEqual({ page: 'compteur' });
    expect(allowed({ page: 'compteur-detail', sub: 'veille' }, true)).toEqual({ page: 'outils' });
  });

  it('simple view: three tabs, « Ma pièce » is the pinned room or the list', () => {
    expect(simpleTabs('r1').map(([k]) => k)).toEqual(['accueil', 'piece-r1', 'aide']);
    expect(simpleTabs(null)[1][0]).toBe('pieces');
  });
});

describe('fmt1 (#258)', () => {
  it('one decimal, comma, typographic minus, never « −0,0 »', () => {
    expect(fmt1(-2.5)).toBe('−2,5');
    expect(fmt1(19)).toBe('19,0');
    expect(fmt1(19.04)).toBe('19,0');
    expect(fmt1(-0.04)).toBe('0,0');
    expect(fmt1(1.25)).toBe('1,3');
  });
});

describe('dispatch (#257)', () => {
  it('stops at the first handler that owns the event, skips sets without that kind', () => {
    const a = vi.fn(() => false);
    const b = vi.fn(() => true);
    const c = vi.fn(() => true);
    const sets: Handlers[] = [{ change: a }, { click: a }, { click: b }, { click: c }];
    expect(dispatch(sets, 'click', {}, {})).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).not.toHaveBeenCalled();
    expect(dispatch(sets, 'submit', {}, {})).toBe(false);
  });
});
