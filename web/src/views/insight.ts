// "Analyse du mois" card (loaded on demand by the Analyse view): text written by the AI,
// what was sent (pseudonyms only, S-5.7), model / tokens / cost and a useful vote (S-5.8).
import { ds } from '../app';
import { type Vote, loadVotes, pseudonymLegend, saveVote, usageLine } from '../insight';
import { renderMarkdown } from '../markdown';
import { esc } from '../ui';

export function mountInsight(el: HTMLElement | null) {
  const ins = ds?.insights;
  if (!el || !ins) return;
  const vote = loadVotes()[ins.period];
  const legend = pseudonymLegend(ins.pseudonyms);
  const btn = (v: Vote, label: string, icon: string) =>
    `<button type="button" class="chip" data-insight-vote="${v}" aria-pressed="${vote === v}"><span aria-hidden="true">${icon}</span>&nbsp;${label}</button>`;
  el.removeAttribute('aria-busy');
  el.innerHTML = `<div class="card-head"><h2>Analyse du mois <small class="muted">rédigée par l'IA</small></h2></div>
    <div class="md">${renderMarkdown(ins.markdown)}</div>
    <p class="hint muted">Générée le ${esc(ins.generated.slice(0, 10))} à partir des chiffres calculés par l'application${
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
      mountInsight(el);
    }),
  );
}
