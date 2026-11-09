// S-7.8: the pinned room ("ma chambre") of the simple view (#316, views/proche.ts): the
// selector of ⚙ Affichage and the mean temperature its « Ma pièce » tab shows.
import { state } from '../app';
import { activeRooms, esc } from '../ui';

/** Mean measured temperature of a room between two days (inclusive), or null. */
export function meanTemp(days: Map<string, [number, number | null]> | undefined, from: string, to: string): number | null {
  let sum = 0;
  let n = 0;
  for (const [d, [t]] of days ?? []) {
    if (d < from || d > to || typeof t !== 'number' || !Number.isFinite(t)) continue;
    sum += t;
    n++;
  }
  return n ? sum / n : null;
}

/** Selector for the menu: which room to pin. */
export function pinSelect(): string {
  return `<label class="pin-room">Pièce épinglée en mode simple
    <select data-pin>
      <option value="">Aucune</option>
      ${activeRooms()
        .map((r) => `<option value="${esc(r.id)}" ${state.pinnedRoom === r.id ? 'selected' : ''}>${esc(r.name)}</option>`)
        .join('')}
    </select>
  </label>`;
}
