// #469: Historique › « Flambées du poêle », loaded on demand. The evenings the collection found the
// stove burning (collector/stove.py, meta.stove_fires: rooms near the stove warming up at 0 W after
// sunset), as a calendar, with how sure each one is, and the owner's answers to « poêle allumé ce
// soir ? » (kept encrypted on this device, local-store.ts) to check the detection.
import { ds, rerender } from '../app';
import { addDays } from '../aggregate';
import { alertHtml, countedNote } from '../components';
import { dayLong, localDay, monthLong } from '../glossary';
import { loadNote, saveNote } from '../local-store';
import { type Answers, RISE_MIN, type StoveFires, checkAnswers, fireClarity, isCovered, parseAnswers, slotTime, spanText } from '../stove-fires';
import { html } from '../trusted';
import { esc } from '../ui';
import { stoveFires, stoveRooms } from './wood-state';
import '../fires.css';

const NOTE = 'stove-answers';
let answers: Answers = new Map();
let loadedFor: object | null = null;
let saved = true;
/** Months shown open (the newest); the older ones in a fold. */
const OPEN_MONTHS = 2;

/** The months the detection could see, newest first (« 2026-11 »). */
function monthsOf(f: StoveFires): string[] {
  const out = new Set<string>();
  for (const [a, b] of f.covered) for (let m = a.slice(0, 7); m <= b.slice(0, 7); m = addDays(`${m}-28`, 7).slice(0, 7)) out.add(m);
  return [...out].sort().reverse();
}

const WEEK = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
function monthHtml(f: StoveFires, ym: string): string {
  const first = `${ym}-01`;
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday first
  const cells: string[] = WEEK.map((d) => `<span class="fires-wd">${d}</span>`);
  for (let i = 0; i < lead; i++) cells.push('<span></span>');
  const rows: string[] = [];
  for (let d = first; d.startsWith(ym); d = addDays(d, 1)) {
    const fire = f.fires.get(d);
    const kind = fire ? 'fire' : isCovered(f, d) ? 'calm' : 'unseen';
    cells.push(`<span class="fires-day fires-${kind}">${Number(d.slice(8))}</span>`);
    if (fire)
      rows.push(
        `<li data-fire-day="${d}"><span class="t">${esc(dayLong(d, false))}</span> <span class="s">${esc(`à partir de ${slotTime(fire.start)} · ${spanText(fire.slots)} · ${fire.witnesses} pièces témoins · ${fireClarity(fire)}`)}</span></li>`,
      );
  }
  const n = rows.length;
  return `<h3 class="fires-month">${esc(monthLong(ym))} : ${n ? `${n} soir${n > 1 ? 's' : ''} de flambée` : 'aucune flambée trouvée'}</h3>
    <div class="fires-grid" aria-hidden="true">${cells.join('')}</div>
    ${n ? `<ul class="fires-list" aria-label="Flambées de ${esc(monthLong(ym))}">${rows.join('')}</ul>` : ''}`;
}

export function renderFires(el: HTMLElement) {
  const d = ds;
  if (!d) return;
  if (loadedFor !== d) {
    loadedFor = d;
    answers = new Map();
    void loadNote<Answers>(NOTE, d.source, d.key, (v) => parseAnswers(v), new Map()).then((v) => {
      if (ds !== d || !v.size) return;
      answers = v;
      if (el.isConnected) renderFires(el);
      else rerender();
    });
  }
  const f = stoveFires();
  const stove = stoveRooms().length > 0;
  const tonight = localDay();
  const said = answers.get(tonight);
  const question = `<div class="fires-ask" role="group" aria-labelledby="fires-ask-q">
      <p id="fires-ask-q"><strong>Poêle allumé ce soir ?</strong> <span class="hint muted">Facultatif : votre réponse reste chiffrée sur cet appareil et sert à vérifier la détection.</span></p>
      <div class="controls">
        <button type="button" class="btn secondary" data-fire-answer="yes" aria-pressed="${said === true}">Oui</button>
        <button type="button" class="btn secondary" data-fire-answer="no" aria-pressed="${said === false}">Non</button>
        ${said !== undefined ? '<button type="button" class="link" data-fire-answer="none">Effacer ma réponse</button>' : ''}
      </div>
      ${saved ? '' : alertHtml('warn', 'Cet appareil n’a pas pu garder la réponse chiffrée : elle durera jusqu’au verrouillage.', { role: 'status' })}
    </div>`;
  if (!f || !f.covered.length) {
    el.innerHTML = html(`<section class="card" id="fires-card" aria-labelledby="fires-title">
      <div class="card-head"><h2 id="fires-title">Flambées du poêle</h2></div>
      <p class="hint">Aucun soir où la détection peut juger pour l’instant : elle a besoin des relevés à la demi-heure de deux pièces voisines du poêle dont la température monte, radiateur à 0 W, au moins un soir. ${
        stove ? '' : 'Déclarez aussi la pièce du poêle (⚙ Mon logement › Radiateurs arrêtés volontairement).'
      } Sans détection, le bois du poêle est réparti selon les degrés-jours.</p>
      ${question}
    </section>`);
    return wire(el);
  }
  const check = checkAnswers(f, answers);
  const covered = f.covered.reduce((n, [a, b]) => n + (Date.parse(b) - Date.parse(a)) / 864e5 + 1, 0);
  const months = monthsOf(f);
  const confidence = check.compared
    ? `${check.agree} sur ${check.compared} soir${check.compared > 1 ? 's' : ''} confirmé${check.agree > 1 ? 's' : ''} par vos réponses${check.missed.length ? ` ; flambée non trouvée le ${check.missed.map((x) => dayLong(x, false)).join(', ')}` : ''}${
        check.wrong.length ? ` ; trouvée alors que vous avez répondu non le ${check.wrong.map((x) => dayLong(x, false)).join(', ')}` : ''
      }`
    : 'à établir : la détection est réglée sur des données fictives (démo) ; répondez « poêle allumé ce soir ? » quelques soirs pour les vérifier';
  el.innerHTML = html(`<section class="card" id="fires-card" aria-labelledby="fires-title">
    <div class="card-head"><h2 id="fires-title">Flambées du poêle</h2></div>
    ${countedNote(esc(`${f.fires.size} soir${f.fires.size > 1 ? 's' : ''} de flambée sur ${covered} soirs où la détection peut juger, du ${dayLong(f.covered[0][0])} au ${dayLong(f.covered[f.covered.length - 1][1])}`))}
    <p class="hint">Un soir de flambée : après le coucher du soleil, au moins deux pièces voisines du poêle se réchauffent d’un demi-degré environ ou plus (${esc(RISE_MIN.toLocaleString('fr-FR'))} °C) alors que leur radiateur ne consomme rien, sans redoux dehors. ${
      stove ? `Le bois du poêle est réparti sur ces soirs (selon leur durée) plutôt que sur les degrés-jours ; les jours où elle ne peut pas juger gardent les degrés-jours.` : 'Aucun poêle déclaré : rien n’est réparti.'
    }</p>
    <p class="hint fires-confidence"><strong>Confiance :</strong> ${esc(confidence)}.${check.unseen ? ` <span class="hint muted">${esc(`${check.unseen} réponse${check.unseen > 1 ? 's' : ''} sur des soirs où la détection ne peut pas juger (ou pas encore collectés).`)}</span>` : ''}</p>
    ${question}
    <p class="fires-legend hint muted" aria-hidden="true"><span class="fires-day fires-fire">1</span> flambée <span class="fires-day fires-calm">1</span> sans flambée <span class="fires-day fires-unseen">1</span> pas jugé</p>
    ${months.slice(0, OPEN_MONTHS).map((m) => monthHtml(f, m)).join('')}
    ${months.length > OPEN_MONTHS ? `<details class="table-details" id="fires-older"><summary>Mois précédents (${months.length - OPEN_MONTHS})</summary>${months.slice(OPEN_MONTHS).map((m) => monthHtml(f, m)).join('')}</details>` : ''}
    <p class="hint muted">Détection faite chaque nuit par la collecte, d’après les relevés à la demi-heure ; durée estimée : le temps où les pièces montent en température. Une pièce voisine hors de portée, un radiateur qui chauffe ou un redoux empêchent la détection de juger le soir.</p>
  </section>`);
  wire(el);
}

function wire(el: HTMLElement) {
  for (const b of el.querySelectorAll<HTMLButtonElement>('[data-fire-answer]'))
    b.addEventListener('click', () => {
      const d = ds;
      if (!d) return;
      const day = localDay();
      const next = new Map(answers);
      if (b.dataset.fireAnswer === 'none') next.delete(day);
      else next.set(day, b.dataset.fireAnswer === 'yes');
      answers = next;
      const focus = b.dataset.fireAnswer;
      void saveNote(NOTE, d.source, d.key, Object.fromEntries(next)).then((ok) => {
        saved = ok;
        if (!el.isConnected) return;
        renderFires(el);
        el.querySelector<HTMLElement>(`[data-fire-answer="${focus === 'none' ? 'yes' : focus}"]`)?.focus();
      });
    });
}
