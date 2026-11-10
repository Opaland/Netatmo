// #309: settings pages « Sources de données », « Contrat et prix » (shared contract), « Foyer et partage »,
// « Objectifs et alertes » (cold alert), « À propos » and the sources of « État des données ».
// The GitHub API logic lives in ../settings.ts; this module only renders and handles the forms.
import { ds, rerender, setState } from '../app';
import { contractJson } from '../contract';
import { OFFERS } from '../offers';
import {
  GROUPS,
  type SourceStatus,
  TOKEN_HELP_URL,
  expiryInfo,
  hasToken,
  noSaveAttrs,
  listSecrets,
  putSecret,
  putVariable,
  repoFromLocation,
  runCollect,
  setToken,
  invalidFields,
} from '../settings';
import { contractInfo, esc, longDate, table } from '../ui';
import { localDateTime } from '../glossary';
import { html } from '../trusted';
import { lazyAction, lazyCard } from '../lazy';
import { showBuild } from '../build';
import { track } from '../ready';
import { handleAppClick, mountAppCard } from './app-card';
import { loadVotes, usefulRate } from '../insight';
import { tenant, tenantNote } from '../tenant';
import { intuisContractLine } from './devices-quality';
import { alertHtml, formMsg, switchField } from '../components';

let settingsRepo = repoFromLocation() ?? 'Opaland/Netatmo';
/** The repository the settings write to (#346: radiators switched off, ⚙ Mon logement). */
export const currentRepo = () => settingsRepo;
let configured: Set<string> | null = null;
let settingsMsg: { ok: boolean; text: string } | null = null;

/** #309: the settings pages that come from this module (État des données reuses the sources). */
export type SettingsSection = 'sources' | 'etat' | 'contrat' | 'foyer' | 'objectifs' | 'apropos';

/** « foyer » (written in the repository, every device) or « ce téléphone » (this device only). */
export function scopeTag(kind: 'foyer' | 'appareil'): string {
  return kind === 'foyer'
    ? '<span class="tag scope" title="Tout le foyer : enregistré dans le dépôt, valable sur tous les appareils">foyer</span>'
    : '<span class="tag scope" title="Cet appareil : gardé dans ce navigateur seulement">ce téléphone</span>';
}

export function renderSettings(view: HTMLElement, section: SettingsSection) {
  const m = ds!.meta;
  const src = ((m as { sources?: Record<string, SourceStatus> }).sources ?? {}) as Record<string, SourceStatus>;
  const today = new Date().toISOString().slice(0, 10);
  /** S-1.12: expiry of the token, or "expiration inconnue" (never a made-up date). */
  const expiry = (s?: SourceStatus) => {
    const e = expiryInfo(s, today);
    if (!e) return '';
    const when = e.date ? `expiration ${e.estimated ? 'estimée ' : ''}le ${longDate(e.date)}` : 'expiration inconnue';
    return ` <span class="${e.renew ? 'ko-red' : 'muted'}">· ${when}${e.renew ? ' — <strong>⚠️ à renouveler</strong>' : ''}</span>`;
  };
  const when = (iso?: string) => (iso ? localDateTime(iso) : '');
  const status = (on: boolean, label: string, key?: string, withExpiry = true) => {
    const s = key ? src[key] : undefined;
    const failing = s?.error && (!s.ok || s.error > s.ok);
    const detail = failing
      ? `<span class="ko-red">échec le ${when(s!.error)}${s!.message ? ` : ${esc(s!.message)}` : ''}</span>`
      : s?.ok
        ? `<span class="muted">dernier succès le ${when(s.ok)}</span>`
        : `<span class="muted">${on ? 'actif' : 'non configuré'}</span>`;
    return `<li><span class="${failing ? 'ko-red' : on ? 'pill ok' : 'muted'}" aria-hidden="true">${failing ? '⚠️' : on ? '✓' : '○'}</span> ${label} ${detail}${withExpiry ? expiry(s) : ''}</li>`;
  };
  const groups = GROUPS.map(
    (g) => `<fieldset class="secrets" data-group="${g.id}"><legend>${esc(g.title)}</legend>
      <p class="hint muted">${esc(g.help)}</p>
      ${g.fields
        .map(
          (f) => `<label>${esc(f.label)} ${
            configured ? (configured.has(f.name) ? '<span class="pill ok">✓ enregistré</span>' : '<span class="muted">non enregistré</span>') : ''
          }
          <input name="${f.name}" ${noSaveAttrs(f.secret)} placeholder="${esc(
            f.placeholder ?? (configured?.has(f.name) ? 'laisser vide pour garder la valeur actuelle' : ''),
          )}" ${hasToken() ? '' : 'disabled'}></label>`,
        )
        .join('')}
    </fieldset>`,
  ).join('');
  const demo = ds!.source === 'demo';
  const statusCard = `
  <section class="card">
    <div class="card-head"><h2>État des sources</h2>${scopeTag('foyer')}</div>
    <ul class="status-list">
      ${status(true, 'Radiateurs et chauffe-eau Intuis', 'intuis')}
      ${status(!!m.weather_source, `Météo (${m.weather_source === 'netatmo' ? 'station Netatmo' : 'Open-Meteo'})`, m.weather_source === 'netatmo' ? 'netatmo' : 'open-meteo', false)}
      ${status(!!(m as { has_station?: boolean }).has_station, 'Station Netatmo, tous les modules', 'netatmo')}${noteLine(src.netatmo)}
      ${status(!!m.has_linky || !!src.linky, 'Compteur Linky', 'linky')}
      ${status(!!(m as { has_shelly?: boolean }).has_shelly || !!src.shelly, 'Prises Shelly', 'shelly')}${noteLine(src.shelly)}
      ${src['home-assistant'] ? status(true, 'Home Assistant (import manuel)', 'home-assistant', false) : ''}
      ${status(!!ds!.insights, 'Analyse IA mensuelle', 'ia')}
      ${src.appareils ? status(true, `État des appareils Intuis${src.appareils.note ? ` (${esc(src.appareils.note)})` : ''}`, 'appareils', false) : ''}
      ${status(!!m.has_roomstate, `Relevé horaire de l'état des pièces${src['releve-horaire']?.note ? ` (${esc(src['releve-horaire'].note)})` : ''}`, 'releve-horaire', false)}
    </ul>
    ${iaRateLine()}
    <p class="hint muted">Dernière collecte : ${m.updated ? esc(localDateTime(m.updated)) : '—'}.</p>
  </section>`;
  const loginCard = `<section class="card">
    <div class="card-head"><h2>1. Autoriser l'application à écrire vos secrets</h2>${scopeTag('foyer')}</div>
    <p class="hint muted">Créez un <a href="${TOKEN_HELP_URL}" target="_blank" rel="noopener">jeton GitHub « fine-grained »</a> :
      accès au seul dépôt <strong>${esc(settingsRepo)}</strong>, permissions <strong>Secrets : lecture et écriture</strong>,
      <strong>Variables : lecture et écriture</strong> (contrat partagé) et
      <strong>Actions : lecture et écriture</strong>, <strong>rien d'autre</strong> (surtout pas « Contents »), expiration courte (7 jours). Le jeton reste en mémoire le temps de la visite :
      l'application ne l'enregistre jamais, ni sur l'appareil, ni ailleurs. Les champs du jeton et des identifiants sont marqués pour que
      le navigateur ne propose pas de les mémoriser ; si votre navigateur ou votre gestionnaire de mots de passe le propose quand même, refusez.</p>
    <div id="gh-login" class="inline-form" role="group" aria-label="Connexion à GitHub">
      <label>Dépôt<input name="repo" value="${esc(settingsRepo)}" ${noSaveAttrs(false)}${demo ? ' disabled' : ''}></label>
      <label>Jeton GitHub<input name="token" ${noSaveAttrs(true)} placeholder="github_pat_…" ${hasToken() ? 'value="••••••••" disabled' : demo ? 'disabled' : ''}></label>
      ${hasToken() ? '<button type="button" id="gh-logout" class="link">Oublier le jeton</button>' : `<button class="primary small" type="button" id="gh-login-btn"${demo ? ' disabled' : ''}>Se connecter</button>`}
    </div>
  </section>`;
  const secretsCard = `<section class="card" id="secrets-form" aria-labelledby="secrets-title">
    <h2 id="secrets-title">2. Vos identifiants</h2>
    <p class="hint muted">Chaque valeur est <strong>chiffrée dans votre navigateur</strong> avec la clé publique du dépôt avant l'envoi :
      seul GitHub peut la déchiffrer, pour la collecte. Seuls les champs remplis sont envoyés ; GitHub ne permet pas de relire une valeur.
      La phrase de passe des données ne se change pas ici (voir « rekey » dans le README).</p>
    ${groups}
    <button class="primary" type="button" id="secrets-save" ${hasToken() ? '' : 'disabled'}>Chiffrer et enregistrer dans GitHub</button>
    ${formMsg('', { id: 'secrets-msg' })}
  </section>`;
  const collectCard = `<section class="card">
    <h2>3. Lancer la collecte</h2>
    <p class="hint muted">Utile après avoir ajouté une connexion. La collecte prend quelques minutes, puis le site se met à jour.</p>
    <div class="controls">
      <button type="button" class="primary small" id="run-collect" ${hasToken() ? '' : 'disabled'}>Collecter maintenant</button>
      ${switchField("Tout l'historique", false, { id: 'run-backfill' })}
    </div>
  </section>`;
  const publicCard = `
  <section class="card">
    <div class="card-head"><h2>Ce qui est public, ce qui part chez des tiers</h2></div>
    ${table(
      ['Donnée', 'Où', 'Qui peut la lire'],
      [
        ['Consommation, météo, station, Linky, analyse IA', 'Dépôt GitHub public (dossier data/)', 'Personne sans votre phrase de passe : fichiers chiffrés AES-256'],
        ['Identifiants et jetons', 'Secrets GitHub', 'Uniquement la collecte automatique ; illisibles même pour vous'],
        ['Code de l\'application', 'Dépôt public', 'Tout le monde (aucune donnée personnelle)'],
        ['Journaux de collecte', 'GitHub Actions (public)', 'Tout le monde : uniquement des comptes et des codes, jamais de valeur'],
        ['Prix saisis ici, contrat non partagé', 'Votre appareil (stockage du navigateur)', 'Vous seul'],
        ['Contrat partagé (dates, offre, puissance)', 'Variable GitHub CONTRACT_JSON, puis données chiffrées', 'Les administrateurs du dépôt ; chiffré dans data/'],
        ['Alerte froid prolongé (pièces suivies, seuil)', 'Variable GitHub COLD_ALERT_JSON ; issue publique', 'Variable : les administrateurs du dépôt ; issue : tout le monde, avec des pseudonymes seulement (ni nom ni température)'],
        [
          'Clé « Rester connecté », notes chiffrées, réglages, cache hors ligne',
          'Ce navigateur, sur l\'origine de l\'appli',
          'Vous, et tout script de la même origine : sur &lt;compte&gt;.github.io, c\'est aussi chaque autre site GitHub Pages du compte',
        ],
      ],
      99,
    )}
    ${sharedOriginWarning(location.hostname)}
    <h3>Services tiers contactés par la collecte</h3>
    ${table(
      ['Service', 'Pour quoi', 'Ce qui lui est envoyé'],
      [
        ['Intuis (Muller)', 'Consommation des radiateurs et du chauffe-eau', 'Vos identifiants Intuis'],
        ['Netatmo', 'Station météo (si activée)', 'Votre jeton Netatmo'],
        ['Conso API (conso.boris.sh) → Enedis', 'Linky (si activé)', 'Votre jeton et votre PDL'],
        ['Shelly Cloud (*.shelly.cloud)', 'Compteurs des prises Shelly (si activé)', 'Votre clé cloud Shelly'],
        ['Open-Meteo', 'Météo de la commune', 'Coordonnées arrondies à ~1 km'],
        ['PVGIS (Commission européenne)', 'Production solaire de vos toits (si localisation saisie)', 'Coordonnées arrondies à ~1 km, orientation et pente des toits'],
        ['Anthropic (Claude)', 'Analyse du mois (si activée)', 'Totaux mensuels, pièces sous pseudonyme (fenêtres ouvertes et boost : chambres regroupées)'],
        ['CRE, api-couleur-tempo.fr', 'Tarifs et couleurs Tempo publics', 'Rien de personnel'],
      ],
      99,
    )}
  </section>`;
  const inviteCard = `
  <section class="card" id="invite-card">
    <div class="card-head"><h2>Inviter un membre du foyer</h2>${scopeTag('foyer')}</div>
    <p class="hint muted">Un QR code de l'adresse de l'appli et un mode d'emploi en 3 étapes, pour l'installer sur le téléphone d'un proche. Il ne contient ni phrase de passe ni jeton : la phrase se dit de vive voix.</p>
    <button type="button" class="primary small" id="invite-open">Inviter</button>
  </section>`;
  const legalCard = `
  <section class="card" id="legal-card">
    <div class="card-head"><h2>Cadre juridique</h2></div>
    <p class="hint muted">Conditions d'utilisation de chaque service (Intuis, Netatmo, Conso API…), date de lecture et risque d'arrêt ; usage domestique et vie privée du foyer.</p>
    <button type="button" class="primary small" id="legal-open">Ouvrir « Cadre juridique »</button>
  </section>`;
  const msg = settingsMsg ? alertHtml(settingsMsg.ok ? 'info' : 'bad', esc(settingsMsg.text), { role: 'status' }) : '';
  const body: Record<SettingsSection, string> = {
    sources: `${statusCard}
  <section class="card" id="devices-card" hidden></section>
  <section class="card"><div class="card-head"><h2>Home Assistant, liaison des pièces</h2></div>
    <p class="hint muted">L'état des capteurs Home Assistant importés et l'accord fenêtre / radiateur se lisent dans <a href="#confort">Pièces → Air et confort</a>, comme la liaison entre pièces et modules de la station.</p></section>
  ${loginCard}${demo ? '' : secretsCard + collectCard}${msg}`,
    etat: `${statusCard}<section class="card" id="devices-card" hidden></section>`,
    contrat: `${tenant().on ? tenantNote('Le contrat partagé est masqué') : contractSection()}${demo || hasToken() ? '' : '<p class="hint muted">Pour partager le contrat, connectez-vous à GitHub dans <a href="#parametres-sources">Sources de données</a>.</p>'}${msg}`,
    foyer: `${inviteCard}
  <section class="card" id="tenant-card" hidden></section>${msg}`,
    objectifs: '<section class="card" id="cold-card" hidden></section>',
    apropos: `<section class="card app-card" id="app-card" aria-labelledby="app-card-title"></section>
  ${publicCard}
  <section class="card" id="build-info" aria-live="polite"></section>
  ${legalCard}`,
  };
  view.innerHTML = html(body[section]);
  const has = (id: string) => !!document.getElementById(id);
  // the card fills from build.json: the view is not ready before (the sweep saw it empty under load)
  if (has('build-info')) void track(showBuild(document.getElementById('build-info')));
  if (has('app-card')) void mountAppCard(document.getElementById('app-card')); // #357
  // S-12.6 tenant mode, S-12.5 prolonged cold alert: lazy modules
  if (has('tenant-card')) void lazyCard(() => import('./tenant-card'), (x) => x.mountTenant(document.getElementById('tenant-card')), { zone: 'tenant-card', what: 'Mode locataire' });
  if (has('devices-card')) void lazyCard(() => import('./devices-card'), (x) => x.mountDevices(document.getElementById('devices-card')), { zone: 'devices-card', what: 'État des appareils' });
  if (has('cold-card')) void lazyCard(() => import('./coldalert'), (x) => x.mountColdSettings(document.getElementById('cold-card'), () => settingsRepo), { zone: 'cold-card', what: 'Alerte froid prolongé' });
}


/** Informative note of a source (counts only, written by the collector), e.g. plugs without a counter. */
function noteLine(s?: SourceStatus) {
  return s?.note && !(s.error && (!s.ok || s.error > s.ok)) ? `<li class="hint muted">${esc(s.note)}</li>` : '';
}

/** S-12.1: the contract used on this device, and the button that shares it with the others. */
function contractSection() {
  const info = contractInfo();
  const offer = (id: string) => OFFERS.find((o) => o.id === id);
  const rows = info.periods.map((c) => [longDate(c.from), esc(`${offer(c.offer)?.supplier ?? ''} ${offer(c.offer)?.label ?? c.offer}`), `${c.kva} kVA`]);
  const n = info.periods.length;
  const state =
    info.source === 'shared'
      ? `<p><span class="badge">partagé</span> Ce contrat (${n} période${n > 1 ? 's' : ''}) s'applique sur tous les appareils.${
          info.differs ? ' Le contrat saisi sur cet appareil en diffère : il est ignoré (voir « Mon contrat » ci-dessus).' : ''
        }</p>`
      : info.shared
        ? alertHtml('info', '<strong>Modifié sur cet appareil, non partagé</strong> : les autres appareils utilisent encore le contrat partagé.')
        : alertHtml('info', `${info.source === 'default' ? 'Aucun contrat saisi : 9 kVA, heures pleines / creuses par défaut.' : 'Ce contrat est enregistré sur cet appareil seulement.'} Les autres appareils ne le connaissent pas.`);
  return `<section class="card" id="contract-share">
    <div class="card-head"><h2>Contrat partagé</h2>${scopeTag('foyer')}</div>
    <p class="hint muted">Le contrat (dates de changement, offre, puissance souscrite) sert au calcul des coûts. Partagé, il est enregistré
      dans la <strong>variable</strong> GitHub <code>CONTRACT_JSON</code> (ce n'est pas un secret), puis recopié chiffré par la collecte :
      tous les appareils affichent alors le même coût. Il n'apparaît jamais dans les journaux publics.</p>
    ${state}
    ${table(['À partir du', 'Offre', 'Puissance'], rows, 99)}
    ${intuisContractLine()}
    <button type="button" class="primary small" id="contract-share-btn" ${hasToken() && info.source !== 'shared' ? '' : 'disabled'}>Partager ce contrat</button>
    <p class="hint muted">Modifiable ci-dessus (« Mon contrat »). Le partage s'applique sur les autres appareils après la prochaine collecte. Bouton actif une fois connecté à GitHub (Sources de données).</p>
  </section>`;
}

async function settingsAction(fn: () => Promise<string>) {
  settingsMsg = { ok: true, text: 'En cours…' };
  rerender();
  try {
    settingsMsg = { ok: true, text: await fn() };
  } catch (err) {
    settingsMsg = { ok: false, text: (err as Error).message };
  }
  rerender();
}

/** Forget the GitHub token and what it revealed (on lock). */
/**
 * #229: on <compte>.github.io the origin (storage, IndexedDB, caches) is shared by every Pages
 * site of the account. Exported for the unit tests.
 */
export function sharedOriginWarning(host: string): string {
  if (!host.endsWith('.github.io')) return '';
  return alertHtml(
    'warn',
    `<strong>« Rester connecté » sur ${esc(host)} :</strong> cette adresse est partagée par tous les sites GitHub Pages du compte
      ${esc(host.replace(/\.github\.io$/, ''))}. La clé gardée sur cet appareil ne peut pas être copiée, mais un script d'un autre site
      Pages de ce compte, ouvert dans ce navigateur, pourrait s'en servir pour déchiffrer vos données et vos notes.
      Ne publiez aucun autre site Pages sur ce compte, ou désactivez « Rester connecté » (la phrase de passe est alors demandée
      à chaque ouverture). Un domaine personnel dédié supprime ce risque (README, section Sécurité).`,
    { id: 'shared-origin' },
  );
}

export function forgetToken() {
  setToken(null);
  configured = null;
}

// ------------------------------------------------------------------ events
/**
 * #233: the values of the inputs of a group (no <form>, so no FormData and no submission that
 * would make the browser offer to save a password); the inputs are emptied right away.
 */
function takeValues(group: Element): [string, string][] {
  return [...group.querySelectorAll<HTMLInputElement>('input[name]')].map((i) => {
    const v: [string, string] = [i.name, i.disabled ? '' : i.value.trim()];
    i.value = '';
    return v;
  });
}

/** GitHub login. */
function login(group: Element) {
  const data = Object.fromEntries(takeValues(group));
  settingsRepo = data.repo ?? '';
  setToken(data.token ?? '');
  void settingsAction(async () => {
    configured = await listSecrets(settingsRepo);
    return `Connecté à ${settingsRepo} : ${configured.size} secret(s) déjà enregistré(s).`;
  });
}

/** Seal and store the filled secrets. */
function saveSecrets(group: Element) {
  // #259: checked field by field BEFORE anything is emptied or redrawn: on an error the
  // message sits next to the button, the faulty fields are marked and every value stays.
  const inputs = [...group.querySelectorAll<HTMLInputElement>('input[name]')].filter((i) => !i.disabled);
  const msg = group.querySelector<HTMLElement>('#secrets-msg');
  const bad = invalidFields(inputs.map((i) => [i.name, i.value.trim()]));
  for (const i of inputs) {
    const wrong = bad.some((b) => b.name === i.name);
    if (wrong) {
      i.setAttribute('aria-invalid', 'true');
      i.setAttribute('aria-describedby', 'secrets-msg');
    } else {
      i.removeAttribute('aria-invalid');
      i.removeAttribute('aria-describedby');
    }
  }
  if (bad.length || !inputs.some((i) => i.value.trim())) {
    if (msg) msg.textContent = bad.length ? bad.map((b) => `${b.label} : ${b.error}`).join(' ') : 'Aucun champ rempli.';
    inputs.find((i) => bad.some((b) => b.name === i.name))?.focus();
    return;
  }
  if (msg) msg.textContent = '';
  const entries = takeValues(group).filter(([, v]) => v);
  void settingsAction(async () => {
    for (const [k, v] of entries) await putSecret(settingsRepo, k, v);
    configured = await listSecrets(settingsRepo);
    return `${entries.length} secret(s) chiffré(s) et enregistré(s) : ${entries.map(([k]) => k).join(', ')}.`;
  });
}

/** Enter in a field of the GitHub login or of the secrets acts like its button (no <form> any more). */
export function handleKeydown(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (e.key !== 'Enter' || !(t instanceof HTMLInputElement)) return;
  const btn = t.closest('#gh-login, #secrets-form')?.querySelector<HTMLButtonElement>('#gh-login-btn, #secrets-save');
  if (!btn || btn.disabled) return;
  e.preventDefault();
  btn.click();
}

/** Forget the token, run the collection. Returns true when the click belonged to this view. */
export function handleClick(btn: HTMLElement): boolean {
  if (handleAppClick(btn)) return true; // #357: install, « Recharger l'application »
  if (btn.id === 'gh-login-btn') {
    login(btn.closest('#gh-login')!);
    return true;
  }
  if (btn.id === 'secrets-save') {
    saveSecrets(btn.closest('#secrets-form')!);
    return true;
  }
  if (btn.id === 'gh-logout') {
    forgetToken();
    settingsMsg = { ok: true, text: 'Jeton oublié.' };
    rerender();
    return true;
  }
  if (btn.id === 'contract-share-btn' || btn.dataset.shareContract !== undefined) {
    const periods = contractInfo().periods;
    void settingsAction(async () => {
      await putVariable(settingsRepo, 'CONTRACT_JSON', contractJson(periods));
      // Keep using this device's contract until the collection copies the shared one.
      if (contractInfo().source === 'default') setState({ contracts: periods.map((c) => ({ ...c })) });
      return `Contrat partagé (${periods.length} période${periods.length > 1 ? 's' : ''}). Lancez la collecte pour l'appliquer sur tous les appareils.`;
    });
    return true;
  }
  if (btn.id === 'legal-open') {
    // S-8.14: lazy module, only for whoever opens it
    void lazyAction(btn, () => import('../legal'), (m) => {
      const card = document.getElementById('legal-card');
      if (card) card.innerHTML = html(`<div class="card-head"><h2>Cadre juridique</h2></div>${m.legalHtml()}`);
    }, 'Cadre juridique');
    return true;
  }
  if (btn.id === 'invite-open') {
    // S-12.3: lazy module (QR encoder), only for whoever opens it
    void lazyAction(btn, () => import('./invite'), (m) => {
      const card = document.getElementById('invite-card');
      if (!card) return;
      card.innerHTML = html(m.inviteHtml());
      m.bindInvite(card);
      card.querySelector<HTMLElement>('h2')?.setAttribute('tabindex', '-1');
      card.querySelector<HTMLElement>('h2')?.focus();
    }, 'Invitation');
    return true;
  }
  if (btn.id === 'run-collect') {
    const backfill = (document.getElementById('run-backfill') as HTMLInputElement | null)?.checked ?? false;
    void settingsAction(async () => {
      await runCollect(settingsRepo, backfill);
      return `Collecte lancée${backfill ? ' (tout l\'historique)' : ''}. Revenez dans quelques minutes.`;
    });
    return true;
  }
  return false;
}

/** S-5.8 / ADR-5: share of the last 3 monthly analyses judged useful on this device. */
function iaRateLine() {
  if (!ds!.insights) return '';
  const r = usefulRate(loadVotes(), new Date().toISOString().slice(0, 10));
  return `<p class="hint muted">Analyse IA jugée utile sur cet appareil : ${
    r.rated ? `<strong>${r.useful} sur ${r.rated}</strong> analyse${r.rated > 1 ? 's' : ''} notée${r.rated > 1 ? 's' : ''} des 3 derniers mois` : 'aucune analyse notée sur les 3 derniers mois'
  } (règle ADR-5 : la garder si elle est utile au moins 2 mois sur 3 ; notez-la dans Outils → Analyse du mois).</p>`;
}
