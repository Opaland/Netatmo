// #428: ⚙ Mon contrat → « Heures creuses » (lazy). Says which off-peak hours the app applies and
// where they come from (read in the half hours, typed here, or assumed 22 h → 6 h), and lets the
// owner type the ranges of the contract, to the minute (several ranges: night and afternoon).
// Kept on this device, encrypted with the data key; the half hours read win over them.
import { ds } from '../app';
import { alertHtml } from '../components';
import { MAX_RANGES, type TypedRange, offPeakSentence, parseHcRanges, periodsOfTyped, periodsText } from '../offpeak';
import { html } from '../trusted';
import { esc } from '../ui';
import { offPeakNow, setTypedRanges, typedRanges } from './offpeak-state';
import { scopeTag } from './settings';
import '../simulators.css';

let message: { ok: boolean; text: string } | null = null;
/** The form stays open once used (it is redrawn after each save). */
let formOpen = false;

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function mountOffPeak(el: HTMLElement | null) {
  if (!el || !ds) return;
  const hc = offPeakNow(() => el.isConnected && mountOffPeak(el));
  if (!hc) {
    el.innerHTML = html('<section class="card" id="hc-card"><p class="hint muted" role="status">Chargement des heures creuses…</p></section>');
    return;
  }
  const typed = typedRanges();
  // one empty row more than typed, two at least (a night range and an afternoon one are common)
  const rows = [...typed, ...Array<null>(Math.max(0, Math.min(MAX_RANGES, Math.max(2, typed.length + 1)) - typed.length)).fill(null)];
  // #441: « à compter du » (optional): Enedis moves the ranges from a day it notifies
  const field = (r: TypedRange | null, i: number) => `<div class="sim-form" role="group" aria-label="Plage ${i + 1}" data-hc-row="${i}">
      <label>Plage ${i + 1}, début<input type="time" step="60" data-hc="from" value="${r ? hhmm(r.from) : ''}"></label>
      <label>Plage ${i + 1}, fin<input type="time" step="60" data-hc="to" value="${r ? hhmm(r.to) : ''}"></label>
      <label>Plage ${i + 1}, à compter du (facultatif)<input type="date" data-hc="since" value="${r?.since ?? ''}"></label>
    </div>`;
  el.innerHTML = html(`<section class="card" id="hc-card" aria-labelledby="hc-title">
    <div class="card-head"><h2 id="hc-title">Heures creuses</h2>${scopeTag('appareil')}</div>
    <p class="hint" id="hc-now">${esc(offPeakSentence(hc))}.</p>
    <p class="hint muted">Elles servent au simulateur solaire, à la recharge d’une voiture et aux plannings. Les relevés à la demi-heure des radiateurs passent avant ce qui est saisi ici ; sans relevé ni saisie, 22 h → 6 h est supposé.</p>
    <details class="table-details" id="hc-form"${formOpen || hc.source === 'supposees' ? ' open' : ''}><summary>Saisir les plages de votre contrat</summary>
      <p class="hint">Sur votre facture ou dans votre espace Enedis (« heures creuses »), à la minute près ; une plage peut passer minuit. Quand Enedis change vos plages, gardez les anciennes et saisissez les nouvelles « à compter du » jour annoncé : chaque jour est compté avec les siennes.${typed.length ? ` Saisies : ${esc(periodsText(periodsOfTyped(typed)))}.` : ''}</p>
      ${rows.map(field).join('')}
      <div class="controls">
        <button type="button" class="btn secondary" id="hc-save">Enregistrer sur cet appareil</button>
        ${typed.length ? '<button type="button" class="link" id="hc-clear">Effacer les plages saisies</button>' : ''}
      </div>
    </details>
    ${message ? alertHtml(message.ok ? 'info' : 'bad', esc(message.text), { role: 'status' }) : ''}
  </section>`);
  const keep = (ranges: TypedRange[], done: string) =>
    void setTypedRanges(ranges).then((kept) => {
      message = { ok: true, text: kept ? `${done}.` : `${done} (gardées jusqu’au verrouillage seulement : cet appareil n’a pas pu les chiffrer).` };
      if (el.isConnected) mountOffPeak(el);
    });
  el.querySelector('#hc-save')?.addEventListener('click', () => {
    formOpen = true;
    const raw = [...el.querySelectorAll<HTMLElement>('[data-hc-row]')]
      .map((f) => {
        const v = (k: string) => f.querySelector<HTMLInputElement>(`[data-hc="${k}"]`)!.value;
        return { from: v('from'), to: v('to'), since: v('since') };
      })
      .filter((r) => r.from || r.to || r.since);
    const ranges = parseHcRanges(raw);
    if (ranges.length !== raw.length) {
      message = { ok: false, text: 'Plage non enregistrée : un début et une fin différents sont attendus (heures et minutes), et une date valide si elle est saisie.' };
      return mountOffPeak(el);
    }
    keep(ranges, ranges.length ? 'Plages enregistrées, chiffrées sur cet appareil' : 'Aucune plage saisie');
  });
  el.querySelector('#hc-clear')?.addEventListener('click', () => {
    formOpen = true;
    keep([], 'Plages saisies effacées');
  });
}
