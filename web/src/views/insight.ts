// "Analyse du mois" card (loaded on demand by the Analyse view): text written by the AI,
// what was sent (pseudonyms only, S-5.7), model / tokens / cost and a useful vote (S-5.8).
import { ds } from '../app';
import { type Vote, loadVotes, pseudonymLegend, saveVote, usageLine } from '../insight';
import { renderMarkdown } from '../markdown';
import { esc, longDate } from '../ui';
import { localDateTime } from '../glossary';
import { html } from '../trusted';

/** Summary for Accueil (#308, #311): the first heading of the text and the first two sentences after it. */
export function summaryOf(md: string): string {
  const lines = md.split('\n').map((l) => l.trim()).filter(Boolean);
  const title = lines.find((l) => l.startsWith('#'))?.replace(/^#+\s*/, '');
  const text = lines.find((l) => !/^(#|[-*] |\d+\. |\|)/.test(l));
  const two = text?.split(/(?<=[.!?…])\s+(?=[A-ZÀ-ÖØ-Þ«])/).slice(0, 2).join(' ');
  return [title ? `**${title}**` : '', two ?? ''].filter(Boolean).join('\n\n');
}

export function mountInsight(el: HTMLElement | null, summary = false) {
  const ins = ds?.insights;
  if (!el || !ins) return;
  if (summary) {
    el.removeAttribute('aria-busy');
    el.innerHTML = html`<div class="card-head"><h2>Analyse du mois</h2><span class="tag">rédigée par l'IA</span></div>
    <div class="md">${renderMarkdown(summaryOf(ins.markdown))}</div>
    <p class="card-foot"><a class="link" href="#outils-analyse">Lire l'analyse complète</a></p>`;
    return;
  }
  const vote = loadVotes()[ins.period];
  const legend = pseudonymLegend(ins.pseudonyms);
  const btn = (v: Vote, label: string, icon: string) =>
    `<button type="button" class="chip" data-insight-vote="${v}" aria-pressed="${vote === v}"><span aria-hidden="true">${icon}</span>&nbsp;${label}</button>`;
  el.removeAttribute('aria-busy');
  el.innerHTML = html`<div class="card-head"><h2>Analyse du mois <small class="muted">rédigée par l'IA</small></h2></div>
    <div class="md">${renderMarkdown(ins.markdown)}</div>
    <p class="hint muted">Générée le ${esc(ins.generated.length > 10 ? localDateTime(ins.generated) : longDate(ins.generated))} à partir des chiffres calculés par l'application${
      ins.verified === false ? ' — <strong>attention : certains nombres du texte n\'ont pas pu être vérifiés</strong>' : ''
    }. Les chiffres font foi : l'IA ne fait que les commenter.</p>
    <p class="hint muted insight-usage">${esc(usageLine(ins.model, ins.usage))}</p>
    ${/^\d{4}-\d{2}$/.test(ins.period) ? `<div class="controls insight-vote" role="group" aria-label="Cette analyse vous a-t-elle été utile ?">
      <span class="muted">Cette analyse vous a-t-elle été utile ?</span>
      ${btn('up', 'Utile', '👍')} ${btn('down', 'Pas utile', '👎')}
    </div>` : ''}
    ${
      ins.facts
        ? `<details class="table-details"><summary>Voir exactement ce qui a été envoyé à l'IA</summary>
      <pre class="facts-json">${esc(JSON.stringify(ins.facts, null, 2))}</pre>
      ${
        legend.length
          ? `<p class="hint muted">Les pièces et capteurs sont envoyés sous un pseudonyme. Correspondance, gardée dans vos données chiffrées et jamais envoyée :</p>
      <ul class="facts">${legend.map(([a, n]) => `<li>${esc(a)} = ${esc(n)}</li>`).join('')}</ul>`
          : ''
      }</details>`
        : ''
    }`;
  el.querySelectorAll<HTMLButtonElement>('[data-insight-vote]').forEach((b) =>
    b.addEventListener('click', () => {
      const v = b.dataset.insightVote as Vote;
      saveVote(ins.period, vote === v ? null : v); // a second click withdraws the vote
      mountInsight(el, summary);
    }),
  );
}
