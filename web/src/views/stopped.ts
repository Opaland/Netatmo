// #346: ⚙ Mon logement → « Radiateurs arrêtés volontairement » (réglage foyer). A room whose
// radiator was switched off on purpose (heated by a stove…) is « arrêté depuis le … (poêle) »,
// not « hors ligne »: no alert, no estimate from the meter, and its fall counts as a change of
// heating. Applied on this device at once; saved for the household in the repository variable
// STOPPED_ROOMS_JSON (the nightly collection copies it into the encrypted meta).
import { ds, rawDataset, rerender } from '../app';
import { alert, alertHtml } from '../components';
import { dayShort } from '../glossary';
import { STOP_REASONS, type StopReason, type StoppedRoom, offlineText, parseStopped, stoppedJson } from '../room-offline';
import { hasToken, putVariable } from '../settings';
import { html } from '../trusted';
import { esc, lastDay, roomColor } from '../ui';
import { offlineInfo, setStoppedDraft, sharedStopped, stoppedDraft, stoppedRooms } from './offline-rooms';
import '../simulators.css';

export const STOPPED_VARIABLE = 'STOPPED_ROOMS_JSON';
let message: { ok: boolean; text: string } | null = null;

/** Heated rooms, raw (a bedroom of the household view keeps its own radiator). */
const heated = () => (rawDataset() ?? ds)!.meta.rooms.filter((r) => r.category === 'heating');
const nameOf = (id: string) => heated().find((r) => r.id === id)?.name ?? id;

export function mountStopped(card: HTMLElement | null, repo: () => string) {
  if (!card || !ds) return;
  const list = stoppedRooms();
  const shared = sharedStopped();
  const pending = stoppedDraft() !== null && stoppedJson(list) !== stoppedJson(shared);
  const demo = ds.source === 'demo';
  const canWrite = !demo && hasToken();
  // rooms out of reach right now, not declared: maybe switched off on purpose
  const suspects = offlineInfo()
    .raw.runs.filter((r) => r.ongoing && !r.stopped)
    .map((r) => r.room)
    .filter((id, i, a) => a.indexOf(id) === i && heated().some((h) => h.id === id));
  const free = heated().filter((r) => !list.some((x) => x.room === r.id));
  const firstSilent = (id: string) => offlineInfo().raw.runs.find((r) => r.room === id && r.ongoing)?.from ?? lastDay();
  card.innerHTML = html(`<section class="card" id="stopped-card" aria-labelledby="stopped-title">
    <div class="card-head"><h2 id="stopped-title">Radiateurs arrêtés volontairement</h2><span class="tag scope">foyer</span></div>
    <p class="hint muted">Une pièce chauffée autrement (un poêle, par exemple) dont vous avez coupé ou retiré les radiateurs : elle n’envoie plus rien, et c’est normal. Elle est alors « arrêtée » et non « hors ligne » : pas d’alerte, pas d’estimation depuis le compteur, et sa baisse compte comme un changement de mode de chauffage, pas comme vos réglages.</p>
    ${
      list.length
        ? `<ul class="list" aria-label="Radiateurs arrêtés">${list
            .map(
              (s) => `<li><div class="row"><span class="swatch" style="background:${esc(roomColor(s.room))}" aria-hidden="true"></span><span><span class="t">${esc(nameOf(s.room))}</span><span class="s">${esc(
                `${offlineText({ from: s.from, to: lastDay(), ongoing: true, stopped: s })}${s.label ? ` · ${s.label}` : ''}`,
              )}</span></span><span class="v"><button type="button" class="link" data-stop-remove="${esc(s.room)}">Retirer</button></span><span></span></div></li>`,
            )
            .join('')}</ul>`
        : '<p class="hint">Aucun radiateur déclaré arrêté.</p>'
    }
    ${suspects
      .filter((id) => !list.some((x) => x.room === id))
      .map((id) => alert('warn', `${nameOf(id)} n’envoie plus rien depuis le ${dayShort(firstSilent(id), true)}`, 'Si son radiateur est coupé exprès (pièce chauffée autrement), déclarez-le ci-dessous ; sinon, c’est une panne probable.'))
      .join('')}
    ${
      free.length
        ? `<div class="sim-form" role="group" aria-label="Déclarer un radiateur arrêté">
      <label>Pièce<select id="stop-room">${free.map((r) => `<option value="${esc(r.id)}"${suspects.includes(r.id) ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
      <label>Arrêté depuis le<input type="date" id="stop-from" value="${esc(firstSilent(suspects.find((id) => free.some((r) => r.id === id)) ?? free[0].id))}" max="${esc(lastDay())}"></label>
      <label>Motif<select id="stop-reason">${(Object.keys(STOP_REASONS) as StopReason[]).map((k) => `<option value="${k}">${esc(STOP_REASONS[k])}</option>`).join('')}</select></label>
      <label>Précision (facultatif)<input type="text" id="stop-label" maxlength="60" placeholder="chauffée par un poêle à granulés"></label>
    </div>
    <div class="controls"><button type="button" class="btn secondary" id="stop-add">Déclarer arrêté</button></div>`
        : ''
    }
    <p class="hint muted">${
      pending
        ? 'Appliqué sur cet appareil, pas encore pour le foyer.'
        : shared.length
          ? 'Enregistré pour le foyer.'
          : 'Rien d’enregistré pour le foyer.'
    } Variable du dépôt <code>${STOPPED_VARIABLE}</code> :</p>
    <code class="sim-json">${esc(stoppedJson(list))}</code>
    <div class="controls">
      <button type="button" class="btn secondary" id="stop-save" ${canWrite && pending ? '' : 'disabled'}>Enregistrer pour le foyer</button>
      ${pending ? '<button type="button" class="link" id="stop-reset">Revenir à la version du foyer</button>' : ''}
    </div>
    <p class="hint muted">${demo ? 'Démo : appliqué sur cet appareil seulement, rien n’est envoyé.' : hasToken() ? 'Pris en compte par la collecte de la nuit (plus d’alerte pour ces pièces).' : 'Connectez un jeton GitHub (⚙ Sources de données, permission Variables) pour enregistrer, ou copiez la variable à la main.'}</p>
    ${message ? alertHtml(message.ok ? 'info' : 'bad', esc(message.text), { role: 'status' }) : ''}
  </section>`);
  const apply = (next: StoppedRoom[]) => {
    setStoppedDraft(stoppedJson(next) === stoppedJson(shared) ? null : parseStopped(next));
    message = null;
    rerender();
  };
  card.querySelector('#stop-add')?.addEventListener('click', () => {
    const room = card.querySelector<HTMLSelectElement>('#stop-room')!.value;
    const from = card.querySelector<HTMLInputElement>('#stop-from')!.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      message = { ok: false, text: 'Indiquez le jour de l’arrêt.' };
      return mountStopped(card, repo);
    }
    const reason = card.querySelector<HTMLSelectElement>('#stop-reason')!.value as StopReason;
    const label = card.querySelector<HTMLInputElement>('#stop-label')!.value.trim();
    apply([...list, { room, from, reason, label }]);
  });
  for (const b of card.querySelectorAll<HTMLButtonElement>('[data-stop-remove]')) b.addEventListener('click', () => apply(list.filter((x) => x.room !== b.dataset.stopRemove)));
  card.querySelector('#stop-reset')?.addEventListener('click', () => apply(shared));
  card.querySelector('#stop-save')?.addEventListener('click', () => {
    message = { ok: true, text: 'En cours…' };
    mountStopped(card, repo);
    putVariable(repo(), STOPPED_VARIABLE, stoppedJson(list))
      .then(() => (message = { ok: true, text: 'Enregistré pour le foyer : pris en compte à la prochaine collecte.' }))
      .catch((err: Error) => (message = { ok: false, text: err.message }))
      .finally(() => (card.isConnected ? mountStopped(card, repo) : rerender()));
  });
}
