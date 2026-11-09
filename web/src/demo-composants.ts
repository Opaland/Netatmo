// #310: living demo of the design-system components (web/composants.html, development only).
// Every block below is produced by the real templates of components.ts with the real tokens.
import './style.css';
import { barChart, cssVar, lineChart } from './charts';
import {
  alert,
  card,
  chip,
  comparison,
  gauge,
  legend,
  list,
  nowPanel,
  periodBar,
  scheduleBand,
  seg,
  stateBlock,
  switchField,
  tile,
} from './components';
import { dayLong, hourRange, vsLabel } from './glossary';
import { html } from './trusted';

const app = document.getElementById('app')!;
const section = (title: string, body: string) => `<h2 class="sub-title">${title}</h2>${body}`;

function render() {
  app.innerHTML = html`
  <header class="top"><div class="title"><h1>Composants <span class="badge">v1.6</span></h1><p class="muted">Design system « Foyer » : jetons, composants, graphiques.</p></div></header>
  ${seg('theme', document.documentElement.dataset.theme ?? 'auto', [['auto', 'Système'], ['light', 'Clair'], ['dark', 'Sombre']], 'Thème')}
  ${section('Sélecteur de période et ligne de portée', periodBar(
    seg('period', 'month', [['month', 'Mois'], ['season', 'Saison'], ['12m', '12 mois'], ['year', 'Année']], 'Période'),
    `Novembre 2026, du 1er au 8 (8 jours sur 30) · chauffage et eau chaude, hors abonnement`,
  ))}
  ${section('Tuiles avec comparaison explicite', `<div class="kpis">
    ${tile({ label: 'Ce mois-ci, au 8', value: '32 €', sub: comparison(-16, vsLabel('2026-11-01', '2026-11-08')) })}
    ${tile({ label: 'Depuis le 1er janvier', value: '978 €', sub: comparison(4.2, vsLabel('2026-01-01', '2026-11-08')) })}
    ${tile({ label: '12 derniers mois', value: '7 137 kWh', sub: comparison(null, '') })}
  </div>`)}
  ${card({
    title: 'Novembre : 3 € de moins que d’habitude',
    sub: `Au ${dayLong('2026-11-08')} · à météo comparable`,
    body: gauge({
      label: 'Mois de novembre : 32 euros dépensés, 35 euros attendus à cette date, environ 118 euros prévus à la fin du mois',
      value: 32,
      expected: 35,
      projected: 118,
      max: 130,
      color: '--usage-heating',
      scale: ['0 €', 'attendu au 8 : 35 €', 'fin du mois ≈ 118 €'],
    }),
    how: '<p class="hint">Attendu = consommation des années passées à la même date, corrigée des degrés-jours.</p>',
  })}
  ${card({
    title: 'Ce qui a compté',
    sub: 'Depuis le 1er janvier · part du total',
    body: list([
      { title: 'Chambres', sub: '−19 % vs 2025 à date', value: '237 €', color: '--room-1', share: 24, href: '#' },
      { title: 'Salon', sub: '−20 % vs 2025 à date', value: '234 €', color: '--room-2', share: 24, href: '#' },
      { title: 'Chauffe-eau', sub: '−3 % vs 2025 à date', value: '201 €', color: '--usage-water', share: 21 },
    ]),
  })}
  ${card({ title: 'Simulation', tag: 'Simulation', variant: 'sim', body: '<p>Une carte de simulation a une bordure pointillée.</p>' })}
  ${card({ title: 'À activer', variant: 'off', body: stateBlock('empty', 'Ajoutez votre compteur Linky pour voir cette carte.', '<button type="button" class="btn secondary">Ajouter</button>') })}
  ${section('Puces et interrupteur', `<div class="chips">${chip('2026', true, {}, '--year-0')}${chip('2025', true, {}, '--year-1')}${chip('2024', false, {}, '--year-2')}</div>
    ${switchField('À climat égal', true, { 'data-demo': 'switch' })}`)}
  ${section('Boutons', `<div class="chips"><button type="button" class="btn primary">Enregistrer</button><button type="button" class="btn secondary">Comparer les offres</button><button type="button" class="btn tertiary">Annuler</button></div>`)}
  ${section('Alertes', [
    alert('info', 'Nouveau tarif depuis le 1er août', '+39 € par an pour votre consommation.', '<a href="#">Comparer les offres</a>'),
    alert('warn', 'Données du 6 novembre', 'La collecte de cette nuit n’a pas abouti.'),
    alert('bad', 'Déchiffrement impossible', 'La clé ne correspond pas.'),
    alert('good', 'Facture rapprochée', 'Écart de 2 € avec le calcul de l’application.'),
  ].join(''))}
  ${section('États', `<div class="kpis">${(['empty', 'loading', 'error', 'offline'] as const)
    .map((k) => `<div class="card">${stateBlock(k, { empty: 'Aucune donnée sur cette période.', loading: 'Chargement…', error: 'Erreur d’affichage.', offline: 'Indisponible hors connexion.' }[k], k === 'loading' ? '' : '<button type="button" class="link">Réessayer</button>')}</div>`)
    .join('')}</div>`)}
  ${card({
    title: 'Salon',
    sub: 'Maintenant',
    body: `${nowPanel({ temp: 19.4, facts: [['Consigne', '19,0 °C'], ['Mode', 'confort jusqu’à 22 h'], ['Fenêtre', 'fermée'], ['Humidité', '52 %']] })}
      ${scheduleBand({
        label: `Planning du jour : confort ${hourRange(6, 8.5)} et ${hourRange(17, 22)}, éco le reste du temps ; heures creuses ${hourRange(22, 6)}`,
        slots: [{ from: 6, to: 8.5, kind: 'comfort' }, { from: 8.5, to: 17, kind: 'eco' }, { from: 17, to: 22, kind: 'comfort' }],
        offPeak: [[22, 6]],
        now: 14.5,
      })}`,
  })}
  ${card({
    title: 'Consommation et froid',
    sub: '12 derniers mois · kWh par mois',
    body: `${legend([
      { label: 'Chauffage', color: '--usage-heating' },
      { label: 'Eau chaude', color: '--usage-water' },
      { label: 'Mois en cours (8 j)', color: '--usage-heating', kind: 'hatch' },
      { label: 'Température extérieure', color: '--series-reference', kind: 'line' },
    ])}<div class="chart" id="demo-bar" role="img" aria-label="Consommation par mois"></div>`,
  })}
  ${card({ title: 'Années', sub: 'Cumul depuis le 1er janvier', body: '<div class="chart" id="demo-line" role="img" aria-label="Cumul par année"></div>' })}
  ${section('Couleurs des pièces', legend(Array.from({ length: 8 }, (_, i) => ({ label: `Pièce ${i + 1}`, color: `--room-${i + 1}` }))))}
  `;
  const months = ['déc. 2025', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.'];
  barChart(document.getElementById('demo-bar')!, {
    labels: months,
    series: [
      { name: 'Chauffage', color: cssVar('--usage-heating'), data: [1050, 1100, 910, 820, 510, 180, 20, 0, 0, 20, 280, 130] },
      { name: 'Eau chaude', color: cssVar('--usage-water'), data: [140, 150, 130, 130, 120, 110, 110, 100, 110, 120, 120, 30] },
    ],
    stacked: true,
    price: 0.2,
    partial: months.map((_, i) => i === months.length - 1),
    notes: months.map((_, i) => (i === months.length - 1 ? '8 jours sur 30' : null)),
  });
  lineChart(document.getElementById('demo-line')!, {
    labels: months.slice(1),
    series: [2026, 2025, 2024].map((y, i) => ({
      name: String(y),
      color: cssVar(`--year-${i}`),
      data: months.slice(1).map((_, m) => (i === 0 && m > 9 ? null : Math.round((m + 1) * (700 - i * 40)))),
    })),
    price: null,
    emphasize: '2026',
  });
}

app.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-set]');
  if (!b) return;
  if (b.dataset.set === 'theme') {
    if (b.dataset.value === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = b.dataset.value;
    render();
  } else {
    b.parentElement!.querySelectorAll('[role=radio]').forEach((r) => r.setAttribute('aria-checked', String(r === b)));
  }
});
render();
