// S-8.14: « Cadre juridique » (Paramètres). Each service, its terms as read, the date they
// were read and the risk that access stops. Keep in step with docs/juridique.md; re-read at
// each version review (a reading older than a year is flagged « à relire »).
// Lazy module: loaded when the page is opened.

export type Risk = 'faible' | 'moyen' | 'élevé';

export interface LegalService {
  name: string;
  frame: string; // how the project uses it
  terms: string; // what was read, in short
  url: string; // where to read it
  read: string; // YYYY-MM-DD
  risk: Risk;
}

export const LEGAL_REVIEW = '2026-11-09';

export const SERVICES: LegalService[] = [
  {
    name: 'Intuis / Muller Intuitiv',
    frame: 'API non officielle : le serveur de l\'application mobile, en lecture seule, une collecte par nuit avec plafond d\'appels.',
    terms:
      'CGU de l\'application non publiées sur intuis.fr (seules CGV, mentions légales et politique de confidentialité y sont) : acceptées dans l\'application à la création du compte, à y relire. Accès ni autorisé ni interdit explicitement à notre connaissance ; il peut être coupé à tout moment.',
    url: 'https://www.intuis.fr/politique-de-confidentialite',
    read: '2026-11-09',
    risk: 'élevé',
  },
  {
    name: 'Netatmo Connect (station)',
    frame: 'API officielle, application créée par le foyer sur dev.netatmo.com.',
    terms: 'Guidelines et page Legal de Netatmo Connect ; l\'usage commercial demande un accord de Netatmo. Pages dynamiques : texte complet à relire en ligne.',
    url: 'https://dev.netatmo.com/guideline',
    read: '2026-11-09',
    risk: 'faible',
  },
  {
    name: 'Conso API (conso.boris.sh) → Enedis',
    frame: 'Service gratuit et open source qui relaie l\'API Enedis ; accord donné par le titulaire du contrat, révocable dans l\'espace Enedis.',
    terms:
      'Pas de CGU publiées. Quotas Enedis partagés (5 requêtes/s, 10 000/h), blocage possible sans préavis en cas d\'abus, rien n\'est stocké, serveurs européens. Arrêt des anciennes API Enedis annoncé vers mi-octobre 2026.',
    url: 'https://conso.boris.sh',
    read: '2026-11-09',
    risk: 'moyen',
  },
  {
    name: 'Open-Meteo',
    frame: 'Météo de la commune, API gratuite sans compte.',
    terms: 'Usage non commercial uniquement (domotique personnelle admise), moins de 10 000 appels par jour. Données sous licence CC BY 4.0 : « Météo : Open-Meteo.com ».',
    url: 'https://open-meteo.com/en/terms',
    read: '2026-11-09',
    risk: 'faible',
  },
  {
    name: 'CRE (data.gouv.fr)',
    frame: 'Historique des tarifs réglementés, données publiques ouvertes.',
    terms: 'Licence indiquée sur la fiche du jeu de données (Licence Ouverte Etalab pour la plupart des jeux publics, à confirmer).',
    url: 'https://www.data.gouv.fr/datasets/historique-des-tarifs-reglementes-de-vente-delectricite-pour-les-consommateurs-residentiels',
    read: '2026-11-09',
    risk: 'faible',
  },
  {
    name: 'api-couleur-tempo.fr',
    frame: 'Couleur Tempo de chaque jour, API gratuite sans compte.',
    terms: 'Pas de conditions trouvées. Sans elle, seul le comparateur Tempo est touché.',
    url: 'https://www.api-couleur-tempo.fr',
    read: '2026-11-09',
    risk: 'moyen',
  },
  {
    name: 'Shelly Cloud (prises, facultatif)',
    frame: 'API officielle « Cloud Control » avec la clé cloud du foyer, en lecture seule, une collecte par nuit (2 appels pour 10 prises).',
    terms:
      'Ouverte à tout utilisateur enregistré pour ses propres appareils, 1 appel par seconde, clé à ne pas partager. La liste des appareils passe par deux points d\'accès non documentés (le second en repli) : s\'ils disparaissent, la source Shelly est marquée en échec, sans autre essai, et l\'historique gardé reste lisible. Conditions du compte Shelly acceptées dans l\'application.',
    url: 'https://shelly-api-docs.shelly.cloud/cloud-control-api/',
    read: '2026-11-09',
    risk: 'moyen',
  },
  {
    name: 'Home Assistant (import manuel, facultatif)',
    frame: 'Logiciel libre installé chez le foyer ; export local, puis import par le collecteur sur votre ordinateur. Aucun service tiers, aucun jeton HA chez GitHub.',
    terms: 'Licence Apache 2.0 du logiciel ; pas de conditions de service. Seuls des agrégats quotidiens par capteur sont gardés, chiffrés ; le fichier d\'export, en clair, est à supprimer après l\'import.',
    url: 'https://www.home-assistant.io/docs/authentication/',
    read: '2026-11-09',
    risk: 'faible',
  },
  {
    name: 'Anthropic (analyse IA, facultative)',
    frame: 'API payante, clé du foyer ; seuls des totaux mensuels sont envoyés, les pièces et capteurs sous pseudonyme (« Pièce A », « Capteur B »), jamais leurs noms.',
    terms: 'Conditions commerciales d\'Anthropic, acceptées à la création de la clé ; non relues en détail pour cette page.',
    url: 'https://www.anthropic.com/legal/commercial-terms',
    read: '2026-11-09',
    risk: 'faible',
  },
];

/** Days since `read`, as of `today` (both YYYY-MM-DD). */
export const ageDays = (read: string, today: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${read}T00:00:00Z`)) / 86_400_000);
/** A reading older than a year must be done again at the next version review. */
export const stale = (read: string, today: string) => ageDays(read, today) > 365;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Content of the « Cadre juridique » card. */
export function legalHtml(today = new Date().toISOString().slice(0, 10)): string {
  const docUrl = 'https://github.com/Opaland/Netatmo/blob/main/docs/juridique.md';
  return `<p class="notice"><strong>Ceci n'est pas un avis juridique.</strong> Résumé de ce que le projet a lu des conditions des services qu'il appelle, à la date indiquée.</p>
    <p class="hint">Cadre : un <strong>usage domestique</strong> de vos propres données (radiateurs, station, compteur), chiffrées, dans votre propre dépôt ; rien n'est vendu ni partagé.
      Le RGPD exempte en principe l'usage strictement personnel ou domestique (article 2.2.c, à vérifier si l'usage change). Pour les membres du foyer : vue foyer (chambres regroupées), verrouillage automatique.</p>
    <ul class="legal-list" style="list-style:none;padding:0;margin:12px 0">${SERVICES.map(
      (s) => `<li style="padding:10px 0;border-top:1px solid var(--border)">
        <h3 style="font-size:0.95rem">${esc(s.name)}</h3>
        <p class="hint muted" style="margin:2px 0">${esc(s.frame)}</p>
        <p style="margin:4px 0">${esc(s.terms)} <a href="${esc(s.url)}" target="_blank" rel="noopener">Source</a></p>
        <p class="hint" style="margin:2px 0">Lu le ${fmt(s.read)}${stale(s.read, today) ? ' <strong class="ko-red">à relire</strong>' : ''} · risque d'arrêt <strong${s.risk === 'élevé' ? ' class="ko-red"' : ''}>${s.risk}</strong></p></li>`,
    ).join('')}</ul>
    <p class="hint muted">Si l'accès Intuis est coupé, l'historique déjà collecté reste dans le dépôt et dans vos sauvegardes chiffrées (Outils → Exporter mes données, ou ⚙ Sécurité). Accord Enedis révocable depuis l'espace Enedis, « partage des données avec des tiers ».
      Détails, RGPD, licences : <a href="${docUrl}" target="_blank" rel="noopener">docs/juridique.md</a> (revue du ${fmt(LEGAL_REVIEW)}).</p>`;
}
