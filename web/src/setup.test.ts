// #40: the first-launch assistant, from what the token reads to the steps. Fictitious repository.
import { describe, expect, it } from 'vitest';
import { ghCall } from './gh-call';
import { FORBIDDEN } from './settings';
import { DEMO_FACTS, INTUIS_SECRETS, PASSPHRASE_SECRET, REQUIRED_SECRETS, type JobInfo, type SetupFacts, type Step, links, setupSteps, setupSummary, validRepo } from './setup';

const fsName = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, enc: 'utf8') => string };

const REPO = 'proprio-fictif/depot-fictif';
const ALL = new Set(REQUIRED_SECRETS);
const RUN = { status: 'completed', conclusion: 'success', html_url: `https://github.com/${REPO}/actions/runs/1`, created_at: '2026-11-01T05:00:00Z' };
const JOBS = (deploy: string | null, collect = 'success'): JobInfo[] => [
  { name: 'collect', status: 'completed', conclusion: collect },
  ...(deploy === null ? [] : [{ name: 'deploy / build', status: 'completed', conclusion: deploy }, { name: 'deploy / deploy', status: 'completed', conclusion: deploy }]),
];
const base: SetupFacts = { repo: REPO, token: true, secrets: new Set(), workflow: 'active', run: null, jobs: [], onOwnSite: false };
const step = (steps: Step[], id: Step['id']) => steps.find((s) => s.id === id)!;

describe('#40 assistant de premier lancement', () => {
  it('dépôt vierge, jeton présent : phrase à la main, Intuis par l’appli, collecte après les secrets', () => {
    const s = setupSteps(base);
    expect(s.map((x) => x.id)).toEqual(['jeton', 'actions', 'phrase', 'intuis', 'pages', 'collecte']);
    const phrase = step(s, 'phrase');
    expect(phrase.status).toBe('a-faire');
    expect(phrase.action).toBeUndefined(); // never written by the app
    expect(phrase.link?.href).toBe(`https://github.com/${REPO}/settings/secrets/actions/new`);
    expect(step(s, 'intuis')).toMatchObject({ status: 'a-faire', action: 'save-intuis' });
    expect(step(s, 'intuis').text).toContain(INTUIS_SECRETS.join(', '));
    expect(step(s, 'pages')).toMatchObject({ status: 'a-verifier', link: { href: `https://github.com/${REPO}/settings/pages` } });
    expect(step(s, 'collecte')).toMatchObject({ status: 'a-faire', action: undefined });
    expect(setupSummary(s)).toBe('2 étapes faites sur 6');
  });

  it('secrets en place, jamais lancée : la collecte se lance d’ici', () => {
    expect(step(setupSteps({ ...base, secrets: ALL }), 'collecte')).toMatchObject({ status: 'a-faire', action: 'run-collect' });
  });

  it('la phrase de passe n’est jamais écrite par l’appli (règle de sécurité)', () => {
    expect(FORBIDDEN.has(PASSPHRASE_SECRET)).toBe(true);
    for (const f of [base, { ...base, secrets: undefined }, { ...base, token: false, secrets: undefined }]) expect(step(setupSteps(f), 'phrase').action).toBeUndefined();
  });

  it('collecte réussie et site publié : tout est prêt', () => {
    const s = setupSteps({ ...base, secrets: ALL, run: RUN, jobs: JOBS('success') });
    expect(s.every((x) => x.status === 'fait')).toBe(true);
    expect(setupSummary(s)).toBe('Tout est prêt : la collecte tourne seule chaque nuit.');
    expect(step(s, 'collecte').link?.href).toBe(RUN.html_url);
  });

  it('collecte passée sans secrets (publication sautée) : à refaire, pas « fait »', () => {
    const s = setupSteps({ ...base, secrets: ALL, run: RUN, jobs: JOBS('skipped') });
    expect(step(s, 'collecte')).toMatchObject({ status: 'a-faire', action: 'run-collect' });
    expect(step(s, 'pages').status).toBe('a-verifier');
  });

  it('publication en échec : Pages à activer, avec le lien', () => {
    const s = setupSteps({ ...base, secrets: ALL, run: { ...RUN, conclusion: 'failure' }, jobs: JOBS('failure') });
    expect(step(s, 'pages')).toMatchObject({ status: 'echec', link: { href: links(REPO).pages } });
    expect(step(s, 'collecte').status).toBe('echec');
  });

  it('collecte en échec (identifiants) ou en cours', () => {
    const failed = setupSteps({ ...base, secrets: ALL, run: { ...RUN, conclusion: 'failure' }, jobs: JOBS('skipped', 'failure') });
    expect(step(failed, 'collecte')).toMatchObject({ status: 'echec', action: 'run-collect' });
    expect(step(failed, 'collecte').text).toMatch(/identifiants Intuis/);
    expect(step(setupSteps({ ...base, secrets: ALL, run: { ...RUN, status: 'in_progress', conclusion: null } }), 'collecte').status).toBe('en-cours');
  });

  it('sur le site du dépôt lui-même, Pages est actif', () => {
    expect(step(setupSteps({ ...base, onOwnSite: true }), 'pages').status).toBe('fait');
  });

  it('workflow arrêté (fork, 60 jours sans activité) : l’appli propose de l’activer', () => {
    for (const state of ['disabled_fork', 'disabled_inactivity', 'disabled_manually'])
      expect(step(setupSteps({ ...base, workflow: state }), 'actions')).toMatchObject({ status: 'a-faire', action: 'enable-collect', link: { href: links(REPO).actions } });
  });

  it('#533 : un état de workflow non lu (« unknown », supprimé) reste « à vérifier », sans proposer de le réactiver', () => {
    for (const state of ['unknown', 'deleted', '']) {
      const s = step(setupSteps({ ...base, workflow: state }), 'actions');
      expect(s).toMatchObject({ status: 'a-verifier', link: { href: links(REPO).actions } });
      expect(s.action).toBeUndefined();
      expect(s.text).not.toContain('réactiver');
    }
  });

  it('#533 : le résumé se lit comme une phrase (aucune, une, plusieurs étapes faites)', () => {
    const steps = (done: number) => setupSteps(base).map((x, i) => ({ ...x, status: i < done ? ('fait' as const) : ('a-faire' as const) }));
    expect(setupSummary(steps(0))).toBe('Aucune étape faite sur 6');
    expect(setupSummary(steps(1))).toBe('1 étape faite sur 6');
    expect(setupSummary(steps(5))).toBe('5 étapes faites sur 6');
  });

  it('sans jeton : tout reste « à vérifier », avec le geste à la main et son lien', () => {
    const s = setupSteps({ repo: REPO, token: false, onOwnSite: false });
    expect(step(s, 'jeton').status).toBe('a-faire');
    for (const id of ['actions', 'phrase', 'intuis', 'pages', 'collecte'] as const) {
      expect(step(s, id).status).toBe('a-verifier');
      expect(step(s, id).action).toBeUndefined();
      expect(step(s, id).link?.href.startsWith(`https://github.com/${REPO}/`)).toBe(true);
    }
  });

  it('un lien de collecte hors de github.com n’est pas repris (donnée de l’API)', () => {
    expect(step(setupSteps({ ...base, secrets: ALL, run: { ...RUN, html_url: 'javascript:alert(1)' }, jobs: JOBS('success') }), 'collecte').link).toBeUndefined();
  });

  it('dépôt : propriétaire/nom seulement', () => {
    expect(validRepo(REPO)).toBe(true);
    for (const bad of ['', 'sans-barre', 'a/b/c', 'a/../x', 'proprio/..', 'a b/c', 'https://github.com/a/b', 'a/b?x=1']) expect(validRepo(bad)).toBe(false);
  });

  it('la démo est fictive et à moitié faite', () => {
    const s = setupSteps(DEMO_FACTS);
    expect(DEMO_FACTS.repo).toBe('exemple/historique-energie');
    expect(s.some((x) => x.status === 'fait') && s.some((x) => x.status !== 'fait')).toBe(true);
  });

  it('les secrets requis sont ceux du guide d’installation (étape 4) : une seule liste (AGENTS.md § 5)', () => {
    const guide = readFileSync(new URL('../../docs/INSTALLER.md', import.meta.url), 'utf8');
    const part = guide.slice(guide.indexOf('### Les cinq secrets obligatoires'), guide.indexOf('### Autre voie'));
    const names = [...part.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1]);
    expect(names).toEqual([...REQUIRED_SECRETS]);
  });

  it('chaque appel de l’assistant est nommé avec sa permission, sans en demander une nouvelle', () => {
    expect(ghCall(`/repos/${REPO}/actions/workflows/collect.yml`)).toEqual({ what: 'la lecture de l’état de la collecte', permission: '« Actions » en lecture' });
    expect(ghCall(`/repos/${REPO}/actions/workflows/collect.yml/runs?per_page=1`).what).toBe('la lecture des collectes passées');
    expect(ghCall(`/repos/${REPO}/actions/runs/42/jobs?per_page=30`).permission).toBe('« Actions » en lecture');
    expect(ghCall(`/repos/${REPO}/actions/workflows/collect.yml/enable`, 'PUT')).toEqual({ what: 'l’activation de la collecte', permission: '« Actions » en écriture' });
  });
});
