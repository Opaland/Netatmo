// #386 / #301 / #299: what each card of the Historique tab counts and over which period, written
// once. Pure text builders (no DOM, no state), tested in history.test.ts. The views pass the
// selection of the moment (usage and rooms, kept from one visit to the next).
import { periodLine } from './glossary';

export interface Selection {
  /** Usage filter: « all », « heating » or « water_heater ». */
  cat: string;
  /** Rooms shown, and rooms of the home. */
  rooms: number;
  allRooms: number;
}

const usage = (cat: string) => (cat === 'heating' ? 'Chauffage' : cat === 'water_heater' ? 'Chauffe-eau' : '');
const roomsText = (o: Selection) => (o.rooms < o.allRooms ? `${o.rooms} pièce${o.rooms > 1 ? 's' : ''} sur ${o.allRooms}` : '');

/** « Chauffe-eau · 2 pièces sur 7 », or '' when everything is shown. */
export function selectionLabel(o: Selection): string {
  return [usage(o.cat), roomsText(o)].filter(Boolean).join(' · ');
}

/** Whether the usage or the rooms are narrowed (the figures then leave something out). */
export const narrowed = (o: Selection) => selectionLabel(o) !== '';

/**
 * The text after « Compté : » on a card of Historique. `heatingOnly`: a card about the heating
 * alone (the home against the cold, unusual days), whatever the usage chosen.
 */
export function historyCounted(o: Selection, heatingOnly = false): string {
  const what = heatingOnly
    ? o.cat === 'water_heater'
      ? 'rien : ce graphique ne porte que sur les radiateurs, et la sélection « Chauffe-eau » les laisse de côté'
      : 'le chauffage seul, des radiateurs'
    : o.cat === 'heating'
      ? 'les radiateurs seuls'
      : o.cat === 'water_heater'
        ? 'le chauffe-eau seul'
        : 'les radiateurs et le chauffe-eau';
  const rooms = roomsText(o);
  return `${what}${rooms ? `, ${rooms}` : ''} (pas tout le logement)`;
}

/** The period line of a calendar year: « 2026 (au 8 nov.) » while it runs, « 2025 » once over. */
export function yearLine(year: number, last: string): string {
  return Number(last.slice(0, 4)) === year ? periodLine('annee', last) : String(year);
}

/** « 2022 à 2026 (au 8 nov.) »: the calendar years of the data, the last one possibly running. */
export function yearsLine(first: number, last: string): string {
  const y = Number(last.slice(0, 4));
  if (first >= y) return yearLine(y, last);
  return `${first} à ${yearLine(y, last)}`;
}

/**
 * #306: the « An » granularity only makes sense over whole years (« Tout », a calendar year):
 * over a sliding window (30 jours, 12 mois) it draws two partial years side by side.
 */
export function yearGranularityAllowed(period: string): boolean {
  return period !== '30d' && period !== '12m';
}
