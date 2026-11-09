// S-13.6, loaded on demand: load shedding per room next to the meter peak (Compteur, power
// card) and the contactor mode of the water heater (Analyse, water heater card), from the
// hourly room-state snapshots (roomstate.enc.json).
import { addDays } from '../aggregate';
import { ds } from '../app';
import { loadRoomState } from '../data';
import { html } from '../trusted';
import { esc, lastDay, longDate, nf0, table } from '../ui';
import { bedroomGrouping, contactor, lastStateDay, offloadByRoom, offloadDays, peakVsOffload } from '../windows';
import { fmt1 as f1 } from '../glossary';

const DAYS = 365; // load shedding happens on the coldest days: a whole year

/**
 * Load shedding per room over [from, to] (default: the last 365 days of room states), in `el`
 * (a fold of the « Puissance maximale » card). Returns the number of days with a radiator shed,
 * null when the room states are missing (the element is then removed).
 */
export async function fillOffload(el: HTMLElement, from?: string, to?: string): Promise<number | null> {
  const d = ds!;
  const rs = await loadRoomState(d);
  if (ds !== d) return null; // #247: locked or another dataset since
  const last = rs ? lastStateDay(rs) : null;
  if (!rs || !last || !el.isConnected) {
    el.remove();
    return null;
  }
  const end = to ?? (last < lastDay() ? last : lastDay());
  const start = from ?? addDays(end, -(DAYS - 1));
  const days = offloadDays(rs, ds!.pmax, start, end);
  const names = new Map(ds!.meta.rooms.map((r) => [r.id, r.name]));
  if (!days.length) {
    el.innerHTML = html`<p class="hint muted">Aucun radiateur délesté sur la période : la puissance souscrite suffit à vos pics de chauffage.</p>`;
    el.hidden = false;
    return 0;
  }
  const per = [...offloadByRoom(rs, start, end, bedroomGrouping(ds!.meta.rooms, true))].sort((a, b) => b[1].hours - a[1].hours);
  const peak = peakVsOffload(rs, ds!.pmax, start, end);
  const top = days.reduce((a, b) => ((b.pmax ?? -1) > (a.pmax ?? -1) ? b : a));
  el.innerHTML = html`<p class="hint muted" id="offload-summary">${days.length} jour${days.length > 1 ? 's' : ''} avec au moins un radiateur coupé par le gestionnaire d'énergie quand la puissance appelée approche de l'abonnement.${
      peak.withShed !== null && peak.without !== null
        ? ` Pic du compteur ces jours-là : <strong>${f1(peak.withShed)} kVA</strong> en moyenne, contre ${f1(peak.without)} kVA les autres jours.`
        : ''
    }${top.pmax !== null ? ` Plus fort pic un jour de délestage : ${f1(top.pmax)} kVA le ${esc(longDate(top.day))}.` : ''}</p>
    ${table(
      ['Pièce', 'Jours délestés', 'Heures'],
      per.map(([room, v]) => [esc(names.get(room) ?? 'Pièce inconnue'), nf0.format(v.days), `${f1(v.hours)} h`]),
    )}`;
  el.hidden = false;
  return days.length;
}

export async function fillContactor(el: HTMLElement) {
  const d = ds!;
  const rs = await loadRoomState(d);
  if (ds !== d) return; // #247: locked or another dataset since
  const last = rs ? lastStateDay(rs) : null;
  if (!rs || !last || !el.isConnected) return el.remove();
  const c = contactor(rs, addDays(last, -89), last);
  if (!c.lastMode) return el.remove();
  const total = Object.values(c.hours).reduce((a, b) => a + b, 0);
  el.innerHTML = html`<strong>Contacteur du chauffe-eau</strong> (relevé horaire) : mode <strong>${esc(c.lastMode)}</strong> le ${esc(longDate(c.last!))} ; sur 90 jours, ${Object.entries(c.hours)
    .sort((a, b) => b[1] - a[1])
    .map(([m, h]) => `${esc(m)} ${nf0.format(total ? (h / total) * 100 : 0)} %`)
    .join(', ')} du temps. Valeurs brutes d'Intuis, à vérifier : « auto » suit en principe le signal heures creuses du compteur.`;
  el.hidden = false;
}
