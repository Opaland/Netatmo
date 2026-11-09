// "Questions types" card (S-5.9), loaded on demand by the report view: answers computed
// by the code, no AI, no network.
import { ds } from '../app';
import { QUESTIONS, type QuestionId, answer, answerableMonths, defaultMonth, monthLabel } from '../questions';
import { activeRooms, costAvailable, costOf, esc, lastDay } from '../ui';

let month: string | null = null;
let question: QuestionId | null = null;

export function mountQuestions(el: HTMLElement | null) {
  if (!el || !ds) return;
  const last = lastDay();
  const months = answerableMonths(ds.records, last);
  if (!month || !months.includes(month)) month = defaultMonth(months, last);
  el.removeAttribute('aria-busy');
  if (!month) {
    el.innerHTML = '<h2>Questions types</h2><p class="hint muted">Je ne peux pas répondre : aucune consommation relevée pour l’instant.</p>';
    return;
  }
  const names = new Map(activeRooms().map((r) => [r.id, r.name]));
  const records = ds.records.filter((r) => r.cat !== 'ignore');
  const res = question
    ? answer(question, month, {
        records,
        weather: ds.weather,
        lastDay: last,
        cost: costAvailable() ? (from, to) => costOf(records, from, to) : null,
        roomName: (id) => names.get(id) ?? 'pièce inconnue',
      })
    : null;
  el.innerHTML = `<div class="card-head"><h2>Questions types <small class="muted">réponses calculées, sans IA</small></h2>
    <div class="controls"><label class="select"><span class="sr-only">Mois</span><select id="question-month">${months
      .map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${esc(monthLabel(m))}</option>`)
      .join('')}</select></label></div></div>
    <div class="question-list" role="group" aria-label="Choisir une question">${QUESTIONS.map(
      (q) => `<button type="button" class="chip" data-question="${q.id}" aria-pressed="${q.id === question}">${esc(q.label)}</button>`,
    ).join(' ')}</div>
    <div class="question-answer" aria-live="polite">${
      res
        ? `<ul class="facts${res.ok ? '' : ' muted'}">${res.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
        : '<p class="hint muted">Choisissez une question : la réponse est calculée sur vos données, sur cet appareil.</p>'
    }</div>`;
  el.querySelector<HTMLSelectElement>('#question-month')!.addEventListener('change', (e) => {
    e.stopPropagation(); // not a state change of the app
    month = (e.target as HTMLSelectElement).value;
    mountQuestions(el);
  });
  el.querySelectorAll<HTMLButtonElement>('[data-question]').forEach((b) =>
    b.addEventListener('click', () => {
      question = b.dataset.question as QuestionId;
      mountQuestions(el);
      el.querySelector<HTMLElement>(`[data-question="${question}"]`)?.focus();
    }),
  );
}
