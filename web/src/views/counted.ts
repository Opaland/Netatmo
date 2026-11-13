// #555: « Compté : … », shared by the cards of Historique, Pièces and the tools; out of
// views/compare.ts so that the first screen does not pull that view in.
import { activeRooms, state } from '../app';
import { countedNote } from '../components';
import { historyCounted } from '../history';
import { esc } from '../ui';

/** « Compté : … » of the cards of Historique (#301): the selection of the moment, named. */
export function countedHtml(heatingOnly = false, more = ''): string {
  const all = activeRooms().length;
  const text = historyCounted({ cat: state.cat, rooms: state.rooms ? state.rooms.length : all, allRooms: all }, heatingOnly);
  return countedNote(`${esc(text)}${more ? ` ; ${esc(more)}` : ''}.`);
}
