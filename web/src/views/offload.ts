// S-13.6, loaded on demand: load shedding per room next to the Linky peak (Synthèse, power
// section) and the contactor mode of the water heater (Analyse, water heater card), from the
// hourly room-state snapshots (roomstate.enc.json).
import { addDays } from '../aggregate';
import { ds } from '../app';
import { loadRoomState } from '../data';
import { html } from '../trusted';
import { esc, lastDay, longDate, nf0, table } from '../ui';
import { bedroomGrouping, contactor, lastStateDay, offloadByRoom, offloadDays, peakVsOffload } from '../windows';

const f1 = (v: number) => v.toFixed(1).replace('.', ',');
const DAYS = 365; // load shedding happens on the coldest days: a whole year

export async function fillOffload(el: HTMLElement) {
  const rs = await loadRoomState(ds!);
  const last = rs ? lastStateDay(rs) : null;
  if (!rs || !last || !el.isConnected) return el.remove();
  const to = last < lastDay() ? last : lastDay();
  const from = addDays(to, -(DAYS - 1));
  const days = offloadDays(rs, ds!.pmax, from, to);
  const names = new Map(ds!.meta.rooms.map((r) => [r.id, r.name]));
  if (!days.length) {
    el.innerHTML = html`<h3>Délestage <small class="muted">12 derniers mois</small></h3><p class="hint muted">Aucun radiateur délesté sur la période : la puissance souscrite suffit à vos pics de chauffage.</p>`;
    el.hidden = false;
    return;
  }
  const per = [...offloadByRoom(rs, from, to, bedroomGrouping(ds!.meta.rooms, true))].sort((a, b) => b[1].hours - a[1].hours);
  const peak = peakVsOffload(rs, ds!.pmax, from, to);
  const top = days.reduce((a, b) => ((b.pmax ?? -1) > (a.pmax ?? -1) ? b : a));
  el.innerHTML = html`<h3>Délestage <small class="muted">12 derniers mois, relevé horaire</small></h3>
    <p class="hint muted" id="offload-summary">${days.length} jour${days.length > 1 ? 's' : ''} avec au moins un radiateur délesté (coupé par le gestionnaire d'énergie quand la puissance appelée approche de l'abonnement).${
      peak.withShed !== null && peak.without !== null
        ? ` Pic Linky moyen ces jours-là : <strong>${f1(peak.withShed)} kVA</strong>, contre ${f1(peak.without)} kVA les autres jours.`
        : ''
    }${top.pmax !== null ? ` Plus fort pic un jour de délestage : ${f1(top.pmax)} kVA le ${esc(longDate(top.day))}.` : ''}</p>
    ${table(
      ['Pièce', 'Jours délestés', 'Heures'],
      per.map(([room, v]) => [esc(names.get(room) ?? 'Pièce inconnue'), nf0.format(v.days), `${f1(v.hours)} h`]),
    )}`;
  el.hidden = false;
}

export async function fillContactor(el: HTMLElement) {
  const rs = await loadRoomState(ds!);
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
