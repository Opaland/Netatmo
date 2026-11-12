// #40 (S-10.3): the first-launch assistant, its pure part (setup.test.ts). What a new repository
// needs before the first collection, step by step, from what the GitHub token of the app can read:
// the secrets present (names only), the state of the collection workflow and its last run.
//
// What the app does itself is only what the token it already asks for allows (« Secrets »,
// « Variables », « Actions »; never « Contents », never « Administration » nor « Pages »): write
// the Intuis secrets, enable the collection workflow, run the first collection. The rest is a
// gesture by hand, with the link to the right GitHub page: the passphrase (DATA_PASSPHRASE is
// never written by the app, settings.ts FORBIDDEN) and GitHub Pages (the token cannot read it;
// a deployment that succeeded, or this very page served by the repository, says it is on).
import { FORBIDDEN, GROUPS } from './settings';

/** The passphrase of the data: a secret the owner types in GitHub, never in the app. */
export const PASSPHRASE_SECRET = 'DATA_PASSPHRASE';
/** The four Intuis secrets, those of « Sources de données » (one list, settings.ts GROUPS). */
export const INTUIS_SECRETS: readonly string[] = GROUPS.find((g) => g.id === 'intuis')!.fields.map((f) => f.name);
/** The secrets the collection needs (docs/INSTALLER.md, step 4; setup.test.ts holds them in agreement). */
export const REQUIRED_SECRETS: readonly string[] = [...INTUIS_SECRETS, PASSPHRASE_SECRET];
/** The collection workflow, run once with the whole history. */
export const COLLECT_WORKFLOW = 'collect.yml';

/** owner/repo as GitHub accepts it; anything else is refused before building a link or a call. */
export const validRepo = (repo: string) => /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repo) && !repo.endsWith('/.') && !repo.endsWith('/..');

/** The GitHub pages of the gestures by hand. */
export const links = (repo: string) => ({
  newSecret: `https://github.com/${repo}/settings/secrets/actions/new`,
  secrets: `https://github.com/${repo}/settings/secrets/actions`,
  pages: `https://github.com/${repo}/settings/pages`,
  actions: `https://github.com/${repo}/actions`,
});

export interface RunInfo {
  status: string; // queued, in_progress, completed…
  conclusion: string | null; // success, failure, cancelled, skipped… (null while running)
  html_url: string;
  created_at: string;
}
export interface JobInfo {
  name: string;
  status: string;
  conclusion: string | null;
}

/** What the assistant knows; `undefined`: not read (no token, or the call failed). */
export interface SetupFacts {
  repo: string;
  token: boolean;
  /** Names of the secrets present. */
  secrets?: Set<string>;
  /** State of collect.yml: active, disabled_fork, disabled_inactivity, disabled_manually… */
  workflow?: string;
  /** Last run of collect.yml; null: it never ran. */
  run?: RunInfo | null;
  /** Jobs of that run. */
  jobs?: JobInfo[];
  /** This page is served by GitHub Pages of the same repository. */
  onOwnSite: boolean;
}

export type StepStatus = 'fait' | 'a-faire' | 'en-cours' | 'echec' | 'a-verifier';
export type StepAction = 'save-intuis' | 'enable-collect' | 'run-collect';
export type StepId = 'jeton' | 'actions' | 'phrase' | 'intuis' | 'pages' | 'collecte';

export interface Step {
  id: StepId;
  title: string;
  status: StepStatus;
  /** Plain text, what to do or what was seen. */
  text: string;
  /** A gesture by hand: the GitHub page where it is done. */
  link?: { href: string; label: string };
  /** What the app can do itself with the token. */
  action?: StepAction;
}

export const STATUS_LABEL: Record<StepStatus, string> = {
  fait: 'fait',
  'a-faire': 'à faire',
  'en-cours': 'en cours',
  echec: 'en échec',
  'a-verifier': 'à vérifier',
};

/** The job of a run that published the site (collect.yml calls deploy.yml: « deploy / deploy »). */
export const deployJob = (jobs: JobInfo[] | undefined) => jobs?.find((j) => /(^|\/ )deploy$/.test(j.name.trim()));
const collectJob = (jobs: JobInfo[] | undefined) => jobs?.find((j) => j.name.trim() === 'collect');
/** A link to a run, only on github.com (the URL comes from the API: data, not trusted as such). */
const runLink = (run: RunInfo) => (/^https:\/\/github\.com\//.test(run.html_url) ? { href: run.html_url, label: 'Voir la collecte sur GitHub' } : undefined);

export function setupSteps(f: SetupFacts): Step[] {
  const l = links(f.repo);
  const has = (name: string) => f.secrets?.has(name) ?? false;
  const steps: Step[] = [];

  steps.push(
    f.token
      ? { id: 'jeton', title: 'Jeton GitHub', status: 'fait', text: 'Le jeton est en mémoire pour cette visite (jamais enregistré).' }
      : {
          id: 'jeton',
          title: 'Jeton GitHub',
          status: 'a-faire',
          text: 'Sans jeton, l’assistant ne peut rien lire : les étapes ci-dessous restent « à vérifier », à faire à la main avec les liens.',
        },
  );

  // collect.yml must run (a fork has its workflows off until they are enabled)
  const wf = f.workflow;
  steps.push(
    wf === undefined
      ? { id: 'actions', title: 'Collecte quotidienne activée', status: 'a-verifier', text: 'Dans un dépôt copié (fork), GitHub laisse les workflows arrêtés tant qu’on ne les a pas activés.', link: { href: l.actions, label: 'Ouvrir l’onglet Actions' } }
      : wf === 'active'
        ? { id: 'actions', title: 'Collecte quotidienne activée', status: 'fait', text: 'Le workflow « Collecte quotidienne » est actif.' }
        : {
            id: 'actions',
            title: 'Collecte quotidienne activée',
            status: 'a-faire',
            text:
              wf === 'disabled_fork'
                ? 'Les workflows de ce dépôt copié sont arrêtés : activez-les dans l’onglet Actions (« I understand my workflows… »), puis activez la collecte.'
                : 'Le workflow « Collecte quotidienne » est arrêté (sans activité, GitHub l’arrête après 60 jours) : l’appli peut le réactiver.',
            link: { href: l.actions, label: 'Ouvrir l’onglet Actions' },
            action: 'enable-collect',
          },
  );

  const phrase = FORBIDDEN.has(PASSPHRASE_SECRET);
  steps.push(
    f.secrets === undefined
      ? { id: 'phrase', title: 'Phrase de passe des données', status: 'a-verifier', text: passphraseText(phrase), link: { href: l.newSecret, label: 'Ajouter le secret DATA_PASSPHRASE' } }
      : has(PASSPHRASE_SECRET)
        ? { id: 'phrase', title: 'Phrase de passe des données', status: 'fait', text: 'Le secret DATA_PASSPHRASE existe (sa valeur n’est jamais lisible).' }
        : { id: 'phrase', title: 'Phrase de passe des données', status: 'a-faire', text: passphraseText(phrase), link: { href: l.newSecret, label: 'Ajouter le secret DATA_PASSPHRASE' } },
  );

  const missing = INTUIS_SECRETS.filter((n) => !has(n));
  steps.push(
    f.secrets === undefined
      ? { id: 'intuis', title: 'Compte Intuis', status: 'a-verifier', text: 'Quatre secrets : l’e-mail et le mot de passe du compte, et les identifiants d’application (guide d’installation, étape 4).', link: { href: l.secrets, label: 'Voir les secrets du dépôt' } }
      : missing.length
        ? { id: 'intuis', title: 'Compte Intuis', status: 'a-faire', text: `Manque${missing.length > 1 ? 'nt' : ''} : ${missing.join(', ')}. L’appli les chiffre dans ce navigateur avec la clé publique du dépôt, puis les enregistre.`, action: 'save-intuis' }
        : { id: 'intuis', title: 'Compte Intuis', status: 'fait', text: 'Les quatre secrets Intuis existent.' },
  );

  const deploy = deployJob(f.jobs);
  steps.push(
    f.onOwnSite
      ? { id: 'pages', title: 'Site publié (GitHub Pages)', status: 'fait', text: 'Cette page est servie par le site du dépôt : GitHub Pages est actif.' }
      : deploy?.conclusion === 'success'
        ? { id: 'pages', title: 'Site publié (GitHub Pages)', status: 'fait', text: 'La dernière collecte a publié le site.' }
        : deploy?.conclusion === 'failure'
          ? { id: 'pages', title: 'Site publié (GitHub Pages)', status: 'echec', text: 'La publication du site a échoué : vérifiez que la source de GitHub Pages est « GitHub Actions », puis relancez la collecte.', link: { href: l.pages, label: 'Ouvrir Settings → Pages' } }
          : {
              id: 'pages',
              title: 'Site publié (GitHub Pages)',
              status: 'a-verifier',
              text: 'À faire une fois : Settings → Pages → Build and deployment → Source : « GitHub Actions ». Le jeton de l’appli ne peut pas le lire (permission « Pages » non demandée) : la première collecte le dira.',
              link: { href: l.pages, label: 'Ouvrir Settings → Pages' },
            },
  );

  steps.push(collectStep(f, missing.length === 0 && has(PASSPHRASE_SECRET)));
  return steps;
}

function passphraseText(neverHere: boolean): string {
  return `Au moins 5 mots au hasard, notée en lieu sûr : sans elle, les données sont perdues. ${
    neverHere ? 'L’appli ne l’écrit jamais (elle chiffre toutes les données) : ajoutez-la vous-même dans GitHub, secret DATA_PASSPHRASE.' : ''
  }`.trim();
}

function collectStep(f: SetupFacts, ready: boolean): Step {
  const title = 'Première collecte';
  const wait = ready ? 'Elle récupère tout l’historique disponible, puis publie le site (quelques minutes).' : 'Après la phrase de passe et le compte Intuis.';
  if (f.run === undefined) return { id: 'collecte', title, status: 'a-verifier', text: `Actions → Collecte quotidienne → Run workflow, en cochant « Récupérer tout l’historique disponible ». ${wait}`, link: { href: links(f.repo).actions, label: 'Ouvrir l’onglet Actions' } };
  if (f.run === null) return { id: 'collecte', title, status: 'a-faire', text: `Jamais lancée. ${wait}`, action: ready ? 'run-collect' : undefined };
  const run = f.run;
  if (run.status !== 'completed') return { id: 'collecte', title, status: 'en-cours', text: 'La collecte tourne : revenez vérifier dans quelques minutes.', link: runLink(run) };
  const job = collectJob(f.jobs);
  if (run.conclusion === 'success' && deployJob(f.jobs)?.conclusion === 'skipped')
    return { id: 'collecte', title, status: 'a-faire', text: `La dernière collecte n’a rien fait : il manquait des secrets. ${wait}`, action: ready ? 'run-collect' : undefined, link: runLink(run) };
  if (run.conclusion === 'success') return { id: 'collecte', title, status: 'fait', text: 'La dernière collecte a réussi.', link: runLink(run) };
  return {
    id: 'collecte',
    title,
    status: 'echec',
    text: `La dernière collecte ${job?.conclusion === 'failure' ? 'a échoué pendant la collecte (identifiants Intuis ?)' : 'n’a pas abouti'} : son journal dit pourquoi (sans valeur ni nom).`,
    action: ready ? 'run-collect' : undefined,
    link: runLink(run),
  };
}

/** « 3 étapes sur 6 faites ». */
export function setupSummary(steps: Step[]): string {
  const done = steps.filter((s) => s.status === 'fait').length;
  return done === steps.length ? 'Tout est prêt : la collecte tourne seule chaque nuit.' : `${done} étape${done > 1 ? 's' : ''} sur ${steps.length} faite${done > 1 ? 's' : ''}`;
}

/** #40: the facts of the demo, fictitious (a repository half set up), no call to GitHub. */
export const DEMO_FACTS: SetupFacts = {
  repo: 'exemple/historique-energie',
  token: true,
  secrets: new Set(['INTUIS_USERNAME', 'INTUIS_PASSWORD']),
  workflow: 'active',
  run: null,
  jobs: [],
  onOwnSite: false,
};
