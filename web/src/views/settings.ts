// Settings view ("Paramètres et connexions"): sources status, GitHub secrets, manual collection.
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
  listSecrets,
  putSecret,
  putVariable,
  repoFromLocation,
  runCollect,
  setToken,
  validate,
} from '../settings';
import { contractInfo, esc, longDate, table } from '../ui';
import { html } from '../trusted';
import { showBuild } from '../build';
import { loadVotes, usefulRate } from '../insight';
import { tenant, tenantNote } from '../tenant';

let settingsRepo = repoFromLocation() ?? 'Opaland/Netatmo';
let configured: Set<string> | null = null;
let settingsMsg: { ok: boolean; text: string } | null = null;

export function renderSettings(view: HTMLElement) {
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
  const when = (iso?: string) => (iso ? `${longDate(iso.slice(0, 10))} à ${iso.slice(11, 16)} UTC` : '');
  const status = (on: boolean, label: string, key?: string, withExpiry = true) => {
    const s = key ? src[key] : undefined;
    const failing = s?.error && (!s.ok || s.error > s.ok);
    const detail = failing
      ? `<span class="ko-red">échec le ${when(s!.error)}${s!.message ? ` : ${esc(s!.message)}` : ''}</span>`
      : s?.ok
        ? `<span class="muted">dernier succès le ${when(s.ok)}</span>`
        : `<span class="muted">${on ? 'actif' : 'non configuré'}</span>`;
    return `<li><span class="${failing ? 'ko-red' : on ? 'ok' : 'ko'}" aria-hidden="true">${failing ? '⚠️' : on ? '✓' : '○'}</span> ${label} ${detail}${withExpiry ? expiry(s) : ''}</li>`;
  };
  const groups = GROUPS.map(
    (g) => `<fieldset class="secrets" data-group="${g.id}"><legend>${esc(g.title)}</legend>
      <p class="hint muted">${esc(g.help)}</p>
      ${g.fields
        .map(
          (f) => `<label>${esc(f.label)} ${
            configured ? (configured.has(f.name) ? '<span class="ok">✓ enregistré</span>' : '<span class="muted">non enregistré</span>') : ''
          }
          <input name="${f.name}" type="${f.secret ? 'password' : 'text'}" autocomplete="off" spellcheck="false" placeholder="${esc(
            f.placeholder ?? (configured?.has(f.name) ? 'laisser vide pour garder la valeur actuelle' : ''),
          )}" ${hasToken() ? '' : 'disabled'}></label>`,
        )
        .join('')}
    </fieldset>`,
  ).join('');
  view.innerHTML = html`
  <section class="card">
    <div class="card-head"><h2>Paramètres et connexions</h2><button type="button" class="link" data-view="overview">Fermer</button></div>
    <ul class="status-list">
      ${status(true, 'Radiateurs et chauffe-eau Intuis', 'intuis')}
      ${status(!!m.weather_source, `Météo (${m.weather_source === 'netatmo' ? 'station Netatmo' : 'Open-Meteo'})`, m.weather_source === 'netatmo' ? 'netatmo' : 'open-meteo', false)}
      ${status(!!(m as { has_station?: boolean }).has_station, 'Station Netatmo, tous les modules', 'netatmo')}
      ${status(!!m.has_linky || !!src.linky, 'Compteur Linky', 'linky')}
      ${status(!!(m as { has_shelly?: boolean }).has_shelly || !!src.shelly, 'Prises Shelly', 'shelly')}${noteLine(src.shelly)}
      ${src['home-assistant'] ? status(true, 'Home Assistant (import manuel)', 'home-assistant', false) : ''}
      ${status(!!ds!.insights, 'Analyse IA mensuelle', 'ia')}
      ${status(!!m.has_roomstate, `Relevé horaire de l'état des pièces${src['releve-horaire']?.note ? ` (${esc(src['releve-horaire'].note)})` : ''}`, 'releve-horaire', false)}
    </ul>
    ${iaRateLine()}
    <p class="hint muted">Dernière collecte : ${m.updated ? esc(m.updated.replace('T', ' à ').slice(0, 21)) + ' (UTC)' : '—'}.</p>
  </section>
  <section class="card" id="tenant-card" hidden></section>
  <section class="card" id="cold-card" hidden></section>
  ${
    ds!.source === 'demo'
      ? '<section class="card"><p class="notice">Mode démonstration : les paramètres sont désactivés.</p></section>'
      : `<section class="card">
    <h2>1. Autoriser l'application à écrire vos secrets</h2>
    <p class="hint muted">Créez un <a href="${TOKEN_HELP_URL}" target="_blank" rel="noopener">jeton GitHub « fine-grained »</a> :
      accès au seul dépôt <strong>${esc(settingsRepo)}</strong>, permissions <strong>Secrets : lecture et écriture</strong>,
      <strong>Variables : lecture et écriture</strong> (contrat partagé) et
      <strong>Actions : lecture et écriture</strong>, <strong>rien d'autre</strong> (surtout pas « Contents »), expiration courte (7 jours). Le jeton reste en mémoire le temps de la visite :
      il n'est jamais enregistré, ni sur l'appareil, ni ailleurs.</p>
    <form id="gh-login" class="inline-form">
      <label>Dépôt<input name="repo" value="${esc(settingsRepo)}" autocomplete="off" spellcheck="false"></label>
      <label>Jeton GitHub<input name="token" type="password" autocomplete="off" placeholder="github_pat_…" ${hasToken() ? 'value="••••••••" disabled' : ''}></label>
      ${hasToken() ? '<button type="button" id="gh-logout" class="link">Oublier le jeton</button>' : '<button class="primary small" type="submit">Se connecter</button>'}
    </form>
  </section>
  <form class="card" id="secrets-form">
    <h2>2. Vos identifiants</h2>
    <p class="hint muted">Chaque valeur est <strong>chiffrée dans votre navigateur</strong> avec la clé publique du dépôt avant l'envoi :
      seul GitHub peut la déchiffrer, pour la collecte. Seuls les champs remplis sont envoyés ; GitHub ne permet pas de relire une valeur.
      La phrase de passe des données ne se change pas ici (voir « rekey » dans le README).</p>
    ${groups}
    <button class="primary" type="submit" ${hasToken() ? '' : 'disabled'}>Chiffrer et enregistrer dans GitHub</button>
  </form>
  ${tenant().on ? tenantNote('Le contrat partagé est masqué') : contractSection()}
  <section class="card">
    <h2>4. Lancer la collecte</h2>
    <p class="hint muted">Utile après avoir ajouté une connexion. La collecte prend quelques minutes, puis le site se met à jour.</p>
    <div class="controls">
      <button type="button" class="primary small" id="run-collect" ${hasToken() ? '' : 'disabled'}>Collecter maintenant</button>
      <label class="toggle"><input type="checkbox" id="run-backfill"> Tout l'historique</label>
    </div>
  </section>`
  }
  <section class="card">
    <h2>Ce qui est public, ce qui part chez des tiers</h2>
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
      ],
      99,
    )}
    <h3>Services tiers contactés par la collecte</h3>
    ${table(
      ['Service', 'Pour quoi', 'Ce qui lui est envoyé'],
      [
        ['Intuis (Muller)', 'Consommation des radiateurs et du chauffe-eau', 'Vos identifiants Intuis'],
        ['Netatmo', 'Station météo (si activée)', 'Votre jeton Netatmo'],
        ['Conso API (conso.boris.sh) → Enedis', 'Linky (si activé)', 'Votre jeton et votre PDL'],
        ['Shelly Cloud (*.shelly.cloud)', 'Compteurs des prises Shelly (si activé)', 'Votre clé cloud Shelly'],
        ['Open-Meteo', 'Météo de la commune', 'Coordonnées arrondies à ~1 km'],
        ['Anthropic (Claude)', 'Analyse du mois (si activée)', 'Totaux mensuels et noms des pièces'],
        ['CRE, api-couleur-tempo.fr', 'Tarifs et couleurs Tempo publics', 'Rien de personnel'],
      ],
      99,
    )}
  </section>
  <section class="card" id="build-info" aria-live="polite"></section>
  <section class="card" id="legal-card">
    <div class="card-head"><h2>Cadre juridique</h2></div>
    <p class="hint muted">Conditions d'utilisation de chaque service (Intuis, Netatmo, Conso API…), date de lecture et risque d'arrêt ; usage domestique et vie privée du foyer.</p>
    <button type="button" class="primary small" id="legal-open">Ouvrir « Cadre juridique »</button>
  </section>
  ${settingsMsg ? `<p class="settings-msg ${settingsMsg.ok ? 'ok' : 'ko'}" role="status">${esc(settingsMsg.text)}</p>` : ''}`;
  void showBuild(document.getElementById('build-info'));
  // S-12.6 tenant mode, S-12.5 prolonged cold alert: lazy modules
  void import('./tenant-card').then((x) => x.mountTenant(document.getElementById('tenant-card'))).catch(() => {});
  void import('./coldalert').then((x) => x.mountColdSettings(document.getElementById('cold-card'), () => settingsRepo)).catch(() => {});
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
          info.differs ? ' Le contrat saisi sur cet appareil en diffère : il est ignoré (voir le menu Prix).' : ''
        }</p>`
      : info.shared
        ? '<p class="notice"><strong>Modifié sur cet appareil, non partagé</strong> : les autres appareils utilisent encore le contrat partagé.</p>'
        : `<p class="notice">${info.source === 'default' ? 'Aucun contrat saisi : 9 kVA, heures pleines / creuses par défaut.' : 'Ce contrat est enregistré sur cet appareil seulement.'} Les autres appareils ne le connaissent pas.</p>`;
  return `<section class="card" id="contract-share">
    <h2>3. Contrat partagé</h2>
    <p class="hint muted">Le contrat (dates de changement, offre, puissance souscrite) sert au calcul des coûts. Partagé, il est enregistré
      dans la <strong>variable</strong> GitHub <code>CONTRACT_JSON</code> (ce n'est pas un secret), puis recopié chiffré par la collecte :
      tous les appareils affichent alors le même coût. Il n'apparaît jamais dans les journaux publics.</p>
    ${state}
    ${table(['À partir du', 'Offre', 'Puissance'], rows, 99)}
    <button type="button" class="primary small" id="contract-share-btn" ${hasToken() && info.source !== 'shared' ? '' : 'disabled'}>Partager ce contrat</button>
    <p class="hint muted">Modifiable dans le menu ⋮ → Prix. Le partage s'applique sur les autres appareils après la prochaine collecte.</p>
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
export function forgetToken() {
  setToken(null);
  configured = null;
}

// ------------------------------------------------------------------ events
/** GitHub login and secrets forms. */
export function handleSubmit(e: SubmitEvent) {
  const form = e.target as HTMLFormElement;
  if (form.id === 'gh-login') {
    e.preventDefault();
    const data = new FormData(form);
    settingsRepo = String(data.get('repo') ?? '').trim();
    setToken(String(data.get('token') ?? ''));
    void settingsAction(async () => {
      configured = await listSecrets(settingsRepo);
      return `Connecté à ${settingsRepo} : ${configured.size} secret(s) déjà enregistré(s).`;
    });
  }
  if (form.id === 'secrets-form') {
    e.preventDefault();
    const entries = [...new FormData(form).entries()]
      .map(([k, v]) => [k, String(v).trim()] as const)
      .filter(([, v]) => v);
    const errors = entries.map(([k, v]) => validate(k, v)).filter(Boolean);
    if (errors.length) {
      settingsMsg = { ok: false, text: errors.join(' ') };
      return rerender();
    }
    if (!entries.length) {
      settingsMsg = { ok: false, text: 'Aucun champ rempli.' };
      return rerender();
    }
    void settingsAction(async () => {
      for (const [k, v] of entries) await putSecret(settingsRepo, k, v);
      configured = await listSecrets(settingsRepo);
      return `${entries.length} secret(s) chiffré(s) et enregistré(s) : ${entries.map(([k]) => k).join(', ')}.`;
    });
  }
}

/** Forget the token, run the collection. Returns true when the click belonged to this view. */
export function handleClick(btn: HTMLElement): boolean {
  if (btn.id === 'gh-logout') {
    forgetToken();
    settingsMsg = { ok: true, text: 'Jeton oublié.' };
    rerender();
    return true;
  }
  if (btn.id === 'contract-share-btn') {
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
    void import('../legal').then((m) => {
      const card = document.getElementById('legal-card');
      if (card) card.innerHTML = html(`<div class="card-head"><h2>Cadre juridique</h2></div>${m.legalHtml()}`);
    });
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
  } (règle ADR-5 : la garder si elle est utile au moins 2 mois sur 3 ; notez-la dans l'onglet Analyse).</p>`;
}
