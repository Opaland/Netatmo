// "Questions types" card (S-5.9), loaded on demand by the report view: answers computed
// by the code, no AI, no network.
import { ds } from '../app';
import { type Dataset, loadRoomState } from '../data';
import { BEDROOMS_ID } from '../household';
import { QUESTIONS, type QuestionId, answer, answerableMonths, defaultMonth, monthLabel } from '../questions';
import { activeRooms, costAvailable, costOf, esc, lastDay } from '../ui';
import { html } from '../trusted';
import { type RoomState, bedroomGrouping } from '../windows';

let month: string | null = null;
let question: QuestionId | null = null;
// S-13.3: room states for « pourquoi cette pièce était froide ? », loaded when that question is asked
let states: { ds: Dataset; doc: RoomState | null } | null = null;
let statesFailed = false;

export function mountQuestions(el: HTMLElement | null) {
  if (!el || !ds) return;
  const last = lastDay();
  const months = answerableMonths(ds.records, last);
  if (!month || !months.includes(month)) month = defaultMonth(months, last);
  el.removeAttribute('aria-busy');
  if (!month) {
    el.innerHTML = html('<h2>Questions types</h2><p class="hint muted">Je ne peux pas répondre : aucune consommation relevée pour l’instant.</p>');
    return;
  }
  const names = new Map(activeRooms().map((r) => [r.id, r.name]));
  const records = ds.records.filter((r) => r.cat !== 'ignore');
  if (question === 'cold' && ds.meta.has_roomstate && states?.ds !== ds && !statesFailed) {
    const forDs = ds;
    loadRoomState(forDs)
      .then((doc) => (states = { ds: forDs, doc }))
      .catch(() => (statesFailed = true))
      .finally(() => el.isConnected && ds === forDs && mountQuestions(el));
  }
  const waiting = question === 'cold' && ds.meta.has_roomstate && states?.ds !== ds && !statesFailed;
  const roomName = (id: string) => (id === BEDROOMS_ID ? 'Chambres (regroupées)' : (names.get(id) ?? 'pièce inconnue'));
  const res = waiting
    ? { ok: true, lines: ['Chargement des relevés de l’état des pièces…'] }
    : question
    ? answer(question, month, {
        records,
        weather: ds.weather,
        lastDay: last,
        cost: costAvailable() ? (from, to) => costOf(records, from, to) : null,
        roomName,
        temps: ds.temps,
        roomState: states?.ds === ds ? states.doc : null,
        groupOf: bedroomGrouping(ds.meta.rooms, false),
      })
    : null;
  el.innerHTML = html`<div class="card-head"><h2>Questions types <small class="muted">réponses calculées, sans IA</small></h2>
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
