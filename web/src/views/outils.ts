// #314: the Outils tab (maquette outils.html). Simulators (« et si… »), checks, journals, the
// monthly analysis and the reports, each row with a figure that helps decide to open it.
// Rows whose figure is kept encrypted on this device (invoices, works) are filled once read.
import { ds } from '../app';
import { alert, list } from '../components';
import { type Tool, TOOLS, routeKey } from '../router';
import { MIN_CLOSED, loadNotes } from '../shutters';
import { tenant } from '../tenant';
import { html } from '../trusted';
import { dayShort, monthLong, monthShort } from '../glossary';
import { loadNote } from '../local-store';
import { validWorks, WORK_KINDS } from '../works';
import { offersLine } from './compare';
import type { Freshness } from '../freshness';
import { firstSentence } from '../insight';

const href = (tool: Tool) => `#${routeKey({ page: 'outil', tool })}`;
const row = (tool: Tool, sub: string) => ({ title: TOOLS[tool], sub, href: href(tool) });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function renderOutils(view: HTMLElement, status: Freshness & { label: string }, activeSources: number) {
  const t = tenant().on;
  const d = ds!;
  const offers = t ? '' : offersLine();
  const closed = loadNotes().length;
  const last = d.meta.last_day;
  const etatSub = [
    status.stale ? `arrêtées au ${last ? dayShort(last) : '—'}` : `${status.level === 'ok' ? 'à jour' : status.text}${last ? ` (${dayShort(last)})` : ''}`,
    `${activeSources} source${activeSources > 1 ? 's' : ''} active${activeSources > 1 ? 's' : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const ins = d.insights;
  view.innerHTML = html`<h2 class="page-title" id="page-title" tabindex="-1">Outils</h2>
  ${t ? alert('info', 'Mode locataire', 'L’onglet Compteur est masqué : la part du logement, la puissance et la courbe de charge supposent le compteur Linky et le contrat du titulaire.') : ''}
  <p class="section-title">Simulateurs <span class="tag">et si&nbsp;?</span></p>
  ${list(
    [
      ...(t ? [] : [row('offres', offers || 'Base, heures creuses ou Tempo, sur votre consommation réelle')]),
      row('consigne', '≈ −7 % de chauffage par degré, recalculé sur votre saison'),
      ...(t ? [] : [row('voiture', 'recharge, offre, dépassement de puissance')]),
      row('pac', 'économie estimée selon le COP'),
      row('teletravail', 'coût d’une journée au bureau chauffé'),
    ],
    'Simulateurs',
  )}
  <p class="section-title">Vérifier</p>
  ${list(
    [
      row('facture', 'recouper le coût avec une facture'),
      row('plannings', 'chauffe-t-on en heures creuses, la pièce monte-t-elle vraiment ?'),
      { title: 'État des données', sub: etatSub, href: '#etat', color: status.level === 'ok' ? '--state-good' : status.level === 'warn' ? '--state-warn' : '--state-bad', value: status.level === 'ok' ? '' : status.stale ? 'en retard' : 'à vérifier' },
    ],
    'Vérifier',
  )}
  <p class="section-title">Journaux</p>
  ${list(
    [
      row('absences', 'absences repérées par la consommation, confirmées par le mode absence'),
      row('volets', closed ? `${closed} soir${closed > 1 ? 's notés' : ' noté'}, ${closed >= MIN_CLOSED ? 'assez pour comparer' : `${MIN_CLOSED} nécessaires pour comparer`}` : `aucun soir noté (${MIN_CLOSED} nécessaires pour comparer)`),
      ...(t ? [] : [{ title: 'Travaux', sub: 'saisis dans ⚙ Mon logement, avec les surfaces ; avant / après', href: '#parametres-logement' }]),
    ],
    'Journaux',
  )}
  <p class="section-title" id="ia">Analyse du mois</p>
  ${list(
    [
      // #337: why a month cost more or less than a year earlier (calculated, no AI)
      row('expliquer', 'pourquoi un mois a coûté plus ou moins que l’an dernier : météo, pièces, températures demandées, pièces hors ligne'),
      ins ? { title: /^\d{4}-\d{2}$/.test(ins.period) ? cap(monthLong(ins.period)) : TOOLS.analyse, sub: firstSentence(ins.markdown) || 'rédigée par l’IA, avec ce qui a été envoyé', value: 'IA', href: href('analyse') } : row('analyse', 'à activer (⚙ Sources de données, clé Anthropic)'),
    ],
    'Analyse du mois',
  )}
  <p class="section-title">Rapports et exports</p>
  ${list(
    [
      { title: 'Rapport annuel', sub: 'à imprimer ou en PDF, version anonymisée', href: '#rapport' },
      row('questions', 'réponses calculées, sans IA'),
      row('exports', 'CSV, export long, export recherche'),
      { title: 'Sauvegarde chiffrée', sub: 'un fichier, toujours chiffré', href: '#parametres-securite' },
    ],
    'Rapports et exports',
  )}`;
  void fillLocal(view);
}

/** Invoices and works are encrypted on this device: their figure comes once decrypted. */
async function fillLocal(view: HTMLElement) {
  const d = ds!;
  const [invoices, works] = await Promise.all([
    loadNote('invoices', d.source, d.key, (v) => (Array.isArray(v) ? v.length : 0), 0),
    tenant().on ? Promise.resolve(null) : loadNote('works', d.source, d.key, validWorks, null),
  ]);
  if (ds !== d || !view.isConnected) return;
  const set = (sel: string, text: string) => {
    const s = view.querySelector(`a[href="${sel}"] .s`);
    if (s) s.textContent = text;
  };
  if (invoices) set(href('facture'), `${invoices > 1 ? `${invoices} factures saisies` : '1 facture saisie'} · rouvrir, recouper`);
  const n = works?.markers.length ?? 0;
  const last = n ? [...works!.markers].sort((a, b) => (a.day < b.day ? 1 : -1))[0] : null;
  if (last) set('#parametres-logement', `${n > 1 ? `${n} chantiers datés · dernier : ` : ''}${last.label || WORK_KINDS[last.kind]}, ${monthShort(last.day)}`);
}
