// #312: the four screens of the first launch (maquette onboarding.html), shown after the
// passphrase screen, full screen (own header with « Passer », no tab bar). Each screen has its
// address (« #bienvenue-2 »: Back works), its title takes the focus and says « Étape 2 sur 4 ».
// Nothing here asks for or keeps the passphrase. Choices are those of the settings centre
// (#309): « ce téléphone » (who uses it, prices typed here) or « foyer » (shared contract).
import { ds, setState, state } from '../app';
import { alert, list } from '../components';
import { validContract } from '../contract';
import type { Handlers } from '../events';
import { type Who, STEP_COUNT, finishOnboarding, nextStep, stepKey, stepLabel, whoOf } from '../onboarding';
import { OFFERS } from '../offers';
import type { OnboardingStep, Route } from '../router';
import { setTenant, tenant } from '../tenant';
import { html } from '../trusted';
import { contracts, esc } from '../ui';
import { scopeTag } from './settings';
import * as prices from './prices';
import '../proche.css';

const demo = () => ds!.source === 'demo';

/** Header of the first launch: its name and the way out (main.ts draws it instead of the tabs). */
export const onboardingHeader = () =>
  `<header class="top onboarding-top"><div class="title"><p class="home-name">Bienvenue</p></div><button type="button" class="btn tertiary" data-onb-skip>Passer</button></header>`;

function steps(step: OnboardingStep) {
  const dots = Array.from({ length: STEP_COUNT }, (_, i) => `<i${i + 1 === step ? ' class="on"' : ''}></i>`).join('');
  return `<div class="onb-steps" aria-hidden="true">${dots}</div>`;
}

/** Title of a screen: focused on arrival, with the progress read first (« Étape 2 sur 4 »). */
function head(step: OnboardingStep, text: string) {
  return `${steps(step)}<p class="onb-progress" id="onb-progress">${stepLabel(step)}</p>
  <h1 class="onb-hero" id="page-title" tabindex="-1" aria-describedby="onb-progress">${esc(text)}</h1>`;
}

const next = (step: OnboardingStep, who: Who) => nextStep(step, who);
/** « Continuer » to the next screen, or the last button of the journey. */
function forward(step: OnboardingStep, label = 'Continuer') {
  const n = next(step, currentWho());
  return n
    ? `<a class="btn primary block" href="#${stepKey(n)}">${esc(label)}</a>`
    : `<button type="button" class="btn primary block" data-onb-finish>Voir ma consommation</button>`;
}
function later(step: OnboardingStep) {
  const n = next(step, currentWho());
  return n ? `<a class="btn secondary block" href="#${stepKey(n)}">Plus tard</a>` : '';
}

const currentWho = () => whoOf(state.simple, tenant().on);

// ------------------------------------------------------------------ screens
function welcome() {
  return `${head(1, "Votre consommation d'énergie, pièce par pièce, année après année.")}
  <p>Vos données restent chiffrées : elles ne sont lisibles que sur vos appareils, avec votre phrase de passe.</p>
  <ul class="onb-points"><li>Combien vous dépensez, et si c'est normal</li><li>Quelle pièce coûte le plus</li><li>Comparer les hivers à climat égal</li></ul>
  <a class="btn primary block" href="#${stepKey(2)}">Commencer</a>`;
}

const WHO: [Who, string, string][] = [
  ['gere', 'Moi, je gère le logement', 'Tout voir : pièces, historique, compteur, outils.'],
  ['proche', 'Un proche', 'Vue simple : grands caractères, phrases courtes, une pièce.'],
  ['locataire', 'Je suis locataire', 'Sans le compteur ni le contrat du titulaire.'],
];

function who() {
  const cur = currentWho();
  return `${head(2, 'Qui utilise ce téléphone ?')}
  <fieldset class="onb-choice"><legend class="sr-only">Qui utilise ce téléphone ?</legend>
    ${WHO.map(
      ([v, t, s]) =>
        `<label class="radio-card"><input type="radio" name="onb-who" data-onb-who="${v}" value="${v}"${v === cur ? ' checked' : ''}><span><b>${esc(t)}</b><br><span class="sub">${esc(s)}</span></span></label>`,
    ).join('')}
  </fieldset>
  <p class="hint muted">${scopeTag('appareil')} Réglage de ce téléphone seulement ; il se change dans ⚙ Paramètres.</p>
  ${forward(2)}`;
}

function sources() {
  const m = ds!.meta as { has_shelly?: boolean; has_linky?: boolean; weather_source?: string | null };
  const on = (v: unknown) => (v ? 'actif' : 'à activer');
  const href = '#parametres-sources';
  const years = ds!.meta.years;
  const rows = [
    { title: 'Radiateurs et chauffe-eau', sub: `Intuis${years.length ? ` · depuis ${years[0]}` : ''}`, value: 'actif' },
    { title: 'Météo', sub: m.weather_source === 'netatmo' ? 'station Netatmo' : 'Open-Meteo (service public)', value: on(m.weather_source || ds!.weather) },
    ...(tenant().on ? [] : [{ title: 'Compteur Linky', sub: 'part du chauffage, puissance', value: on(m.has_linky || ds!.linky.size) }]),
    { title: 'Prises Shelly', sub: 'gros appareils', value: on(m.has_shelly || ds!.shelly) },
    { title: "Analyse du mois par l'IA", sub: 'facultatif, quelques centimes par mois', value: on(ds!.insights) },
  ].map((r) => (r.value === 'actif' ? r : { ...r, href }));
  return `${head(3, 'Vos sources de données')}
  ${list(rows, 'Sources de données')}
  <p class="hint muted">${scopeTag('foyer')} Les sources valent pour tout le foyer ; « à activer » ouvre ⚙ Paramètres → Sources de données.</p>
  ${forward(3)}${later(3)}`;
}

function contract() {
  const finish = `<button type="button" class="btn primary block" data-onb-finish>Voir ma consommation</button>`;
  if (tenant().on) {
    const base = state.prices.base;
    return `${head(4, 'Votre prix du kWh')}
    <p>En location, le coût se calcule avec un prix moyen, tiré de vos factures.</p>
    <label class="field">Prix moyen du kWh (€/kWh) ${scopeTag('appareil')}<input data-price="base" type="number" inputmode="decimal" step="0.0001" min="0" placeholder="ex. 0,2516" value="${base ?? ''}"></label>
    ${finish}<a class="btn secondary block" href="#parametres-contrat">Plus de réglages</a>`;
  }
  const shared = validContract(ds!.meta.contract);
  if (shared) {
    return `${head(4, 'Votre contrat')}
    ${alert('good', 'Contrat du foyer trouvé', `${prices.contractSummary()}. Les coûts seront calculés au tarif de chaque jour.`)}
    <p class="hint muted">${scopeTag('foyer')} Le même contrat sert sur tous les appareils.</p>
    ${finish}<a class="btn secondary block" href="#parametres-contrat">Modifier le contrat</a>`;
  }
  const list = contracts();
  const i = list.length - 1;
  const c = list[i];
  const kvas = [...new Set(ds!.trve.map((r) => r.kva))].sort((a, b) => a - b);
  const fields =
    ds!.offers.size && c && kvas.length
      ? `<label class="field">Offre<select data-contract="${i}" data-field="offer">${OFFERS.map((o) => `<option value="${esc(o.id)}"${o.id === c.offer ? ' selected' : ''}>${esc(`${o.supplier} ${o.label}`)}</option>`).join('')}</select></label>
    <label class="field">Puissance souscrite<select data-contract="${i}" data-field="kva">${kvas.map((k) => `<option value="${k}"${k === c.kva ? ' selected' : ''}>${k} kVA</option>`).join('')}</select></label>
    <p class="hint muted">Elles figurent sur votre facture. Les coûts seront calculés au tarif officiel de chaque jour.</p>`
      : `<label class="field">Prix du kWh (€/kWh)<input data-price="base" type="number" inputmode="decimal" step="0.0001" min="0" placeholder="ex. 0,2516" value="${state.prices.base ?? ''}"></label>`;
  return `${head(4, 'Votre contrat')}
  <p>Aucun contrat partagé n'a été trouvé. Deux renseignements suffisent :</p>
  ${fields}
  <p class="hint muted">${scopeTag('appareil')} Enregistré sur ce téléphone ; vous pourrez le partager au foyer dans ⚙ Paramètres → Contrat et prix.</p>
  ${finish}<a class="btn secondary block" href="#parametres-contrat">Plus de réglages</a>`;
}

export function renderOnboarding(view: HTMLElement, route: Route) {
  const step = route.page === 'bienvenue' ? route.step : 1;
  const body = step === 1 ? welcome() : step === 2 ? who() : step === 3 ? sources() : contract();
  view.innerHTML = html`<section class="onb-step" aria-labelledby="page-title">${body}</section>
  ${demo() ? '<p class="hint muted onb-demo">Démo : ce parcours n\'enregistre rien.</p>' : ''}`;
}

// ------------------------------------------------------------------ events
/** Leave the first launch for Accueil (main.ts follows the address). */
function leave(tip: boolean) {
  finishOnboarding(demo(), tip);
  location.hash = '#accueil';
}

const own: Handlers = {
  click(el) {
    const end = el.dataset.onbFinish !== undefined ? true : el.dataset.onbSkip !== undefined ? false : null;
    if (end === null) return false;
    leave(end);
    return true;
  },
  change(t) {
    const v = t.dataset.onbWho as Who | undefined;
    if (!v) return false;
    // applied at once, as the same settings in ⚙ (simple view: Affichage; tenant: Foyer)
    if (tenant().on !== (v === 'locataire')) setTenant({ on: v === 'locataire' });
    setState({ simple: v === 'proche' });
    return true;
  },
};

export const onboardingHandlers: Handlers[] = [
  own,
  { change: (t) => prices.handleChange(t as HTMLInputElement | HTMLSelectElement) },
];
