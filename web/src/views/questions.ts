// "Questions types" card (S-5.9), loaded on demand by the report view: answers computed
// by the code, no AI, no network.
import { datasetDoc, ds, onLock, rawDataset } from '../app';
import { type Dataset, loadRoom30, loadRoomState } from '../data';
import { BEDROOMS_ID } from '../household';
import { QUESTIONS, type QuestionId, answer, answerableMonths, defaultMonth, monthLabel } from '../questions';
import { activeRooms, costAvailable, costOf, esc, lastDay } from '../ui';
import { html } from '../trusted';
import { stoppedShown } from './offline-rooms';
import { type Drops, type RoomState, bedroomGrouping } from '../windows';

let month: string | null = null;
let question: QuestionId | null = null;
/** #353: selector of the control last used here, focused again after each redraw. */
let keep: string | null = null;
// S-13.3: room states for « pourquoi cette pièce était froide ? », loaded when that question is asked
// (#247: for the dataset shown only, forgotten on lock)
const states = datasetDoc((d) => loadRoomState(d));
// S-1.26: sharp falls of the half-hour temperature (raw rooms), from the year of the month asked on
let drops: { ds: Dataset; year: string; value: Drops | null } | null = null;
onLock(() => (drops = null));

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
  let roomState: RoomState | null = null;
  if (question === 'cold' && ds.meta.has_roomstate) roomState = states.get(ds, () => el.isConnected && mountQuestions(el)) ?? null;
  const raw = rawDataset() ?? ds;
  const year = month.slice(0, 4);
  const wantDrops = question === 'cold' && (raw.meta.room30_years ?? []).length > 0;
  if (wantDrops && (drops?.ds !== raw || drops.year > year)) {
    const forDs = raw;
    drops = { ds: forDs, year, value: null };
    Promise.all([loadRoom30(forDs, `${year}-01-01`), import('../room30')])
      .then(([r30, m]) => drops?.ds === forDs && drops.year === year && (drops.value = m.tempDrops(r30, `${year}-01-01`, '9999')))
      .catch(() => {})
      .finally(() => el.isConnected && (rawDataset() ?? ds) === forDs && mountQuestions(el));
  }
  const waiting = question === 'cold' && ds.meta.has_roomstate && states.status(ds) === 'loading';
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
        temps: (rawDataset() ?? ds).temps, // #241: raw rooms, never a household-view mean
        roomState,
        groupOf: bedroomGrouping((rawDataset() ?? ds).meta.rooms, false),
        drops: drops?.ds === raw ? (drops.value ?? undefined) : undefined,
        stopped: stoppedShown(),
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
        ? `<ul class="facts${res.ok ? '' : ' muted'}">${res.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>${
            // #313: the day-by-day reasons live on the page of each room
            question === 'cold' && res.ok ? '<p class="hint">Jour par jour, pièce par pièce : rubrique « Pourquoi il a fait froid » de la page de chaque pièce (<a href="#pieces">Pièces</a>).</p>' : ''
          }`
        : '<p class="hint muted">Choisissez une question : la réponse est calculée sur vos données, sur cet appareil.</p>'
    }</div>`;
  el.querySelector<HTMLSelectElement>('#question-month')!.addEventListener('change', (e) => {
    e.stopPropagation(); // not a state change of the app
    month = (e.target as HTMLSelectElement).value;
    keep = '#question-month';
    mountQuestions(el);
  });
  el.querySelectorAll<HTMLButtonElement>('[data-question]').forEach((b) =>
    b.addEventListener('click', () => {
      question = b.dataset.question as QuestionId;
      keep = `[data-question="${question}"]`;
      mountQuestions(el);
    }),
  );
  // #353: the control used keeps the focus, also when the answer is drawn again once loaded
  const a = document.activeElement;
  if (keep && (!a || a === document.body)) el.querySelector<HTMLElement>(keep)?.focus({ preventScroll: true });
}
