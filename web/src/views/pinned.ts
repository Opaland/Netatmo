// S-7.8: a pinned room ("ma chambre") adds its mean temperature and its cost of the
// month to the key figures of the simple mode. Without a pinned room nothing changes.
import { MONTHS_LONG, total } from '../aggregate';
import { ds, state } from '../app';
import { activeRooms, costOf, esc, fmtEur, fmtKwh, lastDay } from '../ui';
import { pinnedTemp, plainEur, plainNum } from '../plain';

const nfTemp = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

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

/** S-11.3 (light): days of the month whose mean measured temperature stayed under the comfort threshold. */
function coldDays(days: Map<string, [number, number | null]> | undefined, from: string, to: string): string {
  let n = 0;
  for (const [d, [t]] of days ?? []) if (d >= from && d <= to && typeof t === 'number' && t < state.comfortThreshold) n++;
  const thr = `${nfTemp.format(state.comfortThreshold)} °C`;
  return n ? `${n} jour${n > 1 ? 's' : ''} sous ${thr} (moyenne du jour)` : `Aucun jour sous ${thr}`;
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

/** Tiles appended to the key figures of the simple mode (empty without a pinned room). */
export function pinnedTiles(): string {
  const room = state.pinnedRoom ? activeRooms().find((r) => r.id === state.pinnedRoom) : undefined;
  if (!room) return '';
  const last = lastDay();
  const from = `${last.slice(0, 8)}01`;
  const month = `${MONTHS_LONG[Number(last.slice(5, 7)) - 1]}`;
  const records = ds!.records.filter((r) => r.room === room.id);
  const kwh = total(records, from, last);
  const cost = costOf(records, from, last);
  const temp = meanTemp(ds!.temps.get(room.id), from, last);
  const name = esc(room.name);
  if (state.simple) {
    // S-7.13: plain language, rounded figures
    const days = ds!.temps.get(room.id);
    let cold = 0;
    for (const [d, [t]] of days ?? []) if (d >= from && d <= last && typeof t === 'number' && t < state.comfortThreshold) cold++;
    const p = temp === null ? null : pinnedTemp(temp, cold, state.comfortThreshold);
    return `${p ? `<article class="kpi pinned"><h3>${name} : température en ${month}</h3>
    <p class="kpi-value">${p.value}</p>
    <p class="kpi-sub">${p.sub}</p></article>` : ''}<article class="kpi pinned"><h3>${name} : ${cost === null ? 'consommation' : 'coût'} en ${month}</h3>
    <p class="kpi-value">${cost === null ? `${plainNum(kwh)} kWh` : plainEur(cost)}</p>
    ${cost === null ? '' : `<p class="kpi-sub">Pour ${plainNum(kwh)} kWh.</p>`}</article>`;
  }
  const tempTile =
    temp === null
      ? ''
      : `<article class="kpi pinned"><h3>${name} · température moyenne en ${month}</h3>
    <p class="kpi-value">${nfTemp.format(temp)} °C</p>
    <p class="kpi-sub">${coldDays(ds!.temps.get(room.id), from, last)}</p></article>`;
  return `${tempTile}<article class="kpi pinned"><h3>${name} · ${cost === null ? 'consommation' : 'coût'} de ${month}</h3>
    <p class="kpi-value">${cost === null ? fmtKwh(kwh) : fmtEur(cost)}</p>
    ${cost === null ? '' : `<p class="kpi-sub">${fmtKwh(kwh)}</p>`}</article>`;
}
