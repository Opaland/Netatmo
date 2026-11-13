// #316: the « vue Proche » (simple mode), maquette simple.html. Three tabs: Accueil (verdict of
// the month, my room, the month's spending, the words to know), Ma pièce (the pinned room, or a
// choice of room) and Aide (glossary, whom to call). « Voir plus de détails » is always visible
// and asks for a confirmation in the page before showing the whole app. Plain language (S-7.13,
// plain.ts): short sentences, rounded figures, no technical word. Every figure is computed over
// the whole home (the selection made in the full view does not apply here).
import { type Category, type DayRecord, MONTHS_LONG, applyFilter, minusYears, total } from '../aggregate';
import { writtenGap } from '../home';
import { activeRooms, ds, setState, state } from '../app';
import type { Handlers } from '../events';
import { localDay } from '../glossary';
import {
  comparedPct,
  comparedToLastYear,
  glossarySection,
  heatingSentence,
  homeMonthTitle,
  leftSentence,
  monthLabel,
  pinnedTemp,
  plainEur,
  plainNum,
  roomFeel,
  term,
  verdictSentences,
  verdictTitle,
  whenWord,
} from '../plain';
import type { Route } from '../router';
import { html } from '../trusted';
import { costOf, esc, lastDay } from '../ui';
import { offlineNow } from './offline-rooms';
import { meanTemp } from './pinned';
import { homeScope, yoy } from './verdict-scope';
import { verdictWood } from './wood-state';
import '../proche.css';

const fmtTemp = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const title = (text: string) => `<h1 class="page-title" id="page-title" tabindex="-1">${esc(text)}</h1>`;

/** « Voir plus de détails »: leaving the simple view asks for a confirmation, in the page (main.ts handles it). */
export function simpleExit(): string {
  return `<div class="simple-exit"><button type="button" class="btn secondary block" data-simple-exit="ask">Voir plus de détails</button>
    <div class="simple-confirm" hidden role="group" aria-label="Quitter la vue simple ?"><p>Quitter la vue simple ? L'appli montrera tous les onglets et les graphiques.</p>
    <button type="button" class="btn primary" data-simple-exit="yes">Oui, voir tout</button> <button type="button" class="btn secondary" data-simple-exit="no">Rester en vue simple</button></div></div>`;
}

// ------------------------------------------------------------------ cards
/**
 * #400: the verdict of the Accueil, the same figures in plain words: the same scope (homeScope:
 * the rooms out of reach left out, and named), the same gap in euros as « 5 € de moins que
 * d'habitude » (writtenGap), the same change on last year as the month tile (yoy).
 */
function verdictCard(from: string, to: string): string {
  // #433: with the stove's wood, as the Accueil counts it with nothing narrowed
  const sc = homeScope(wholeHome(), from, to, verdictWood('all', null));
  const v = sc.v;
  if (!v || !sc.m) return '';
  const eur = sc.m.unit === '€' ? writtenGap(sc.m) : null;
  const sentences = verdictSentences({ ...v, eur, wood: sc.wood }, from, '{kwh}');
  // the euros say it all; without prices, the two figures in kWh
  const shown = eur !== null && Math.round(Math.abs(eur)) >= 1 ? [sentences[sentences.length - 1]] : sentences.slice(0, 2);
  const mark = { low: '▼', normal: '=', high: '▲' }[v.level];
  return `<section class="card proche-verdict verdict-${v.level}">
    <span class="mark" aria-hidden="true">${mark}</span>
    <div><p class="proche-strong">${esc(verdictTitle(v.level))}</p>
    <p>${shown.map((s) => esc(s).replace('{kwh}', term('kwh'))).join(' ')}</p>${leftNote(sc.left)}${sc.unmeasured.phrase ? `<p>${esc(sc.unmeasured.phrase.replace(/^h/, 'H'))}.</p>` : ''}</div>
  </section>`;
}

/** Last measured day of a room (mean of the day) and the temperature asked for that day. */
function lastTemp(roomId: string): { day: string; temp: number; asked: number | null } | null {
  const days = ds!.temps.get(roomId);
  let best: string | null = null;
  for (const [d, [t]] of days ?? []) if (typeof t === 'number' && Number.isFinite(t) && (!best || d > best)) best = d;
  if (!best) return null;
  const [temp, asked] = days!.get(best)!;
  return { day: best, temp, asked };
}

function roomTodayCard(roomId: string, name: string, heading = true): string {
  const t = lastTemp(roomId);
  if (!t) return `<section class="card"><p class="muted">${esc(name)}</p><p>Pas encore de température mesurée dans cette pièce.</p></section>`;
  const when = whenWord(t.day, localDay());
  return `<section class="card proche-room">
    ${heading ? `<h3 class="muted">${esc(name)}, ${esc(when)}</h3>` : `<h3 class="muted">Température, ${esc(when)}</h3>`}
    <p class="proche-big">${fmtTemp.format(t.temp)} °C</p>
    <p>${esc(roomFeel(t.temp, state.comfortThreshold))} ${esc(heatingSentence(t.temp, t.asked))}</p>
  </section>`;
}

/** The whole home, as the Accueil counts it with nothing narrowed (heating and hot water). */
const wholeHome = () => applyFilter(ds!.records, { cats: new Set<Category>(['heating', 'water_heater']), rooms: null });

/** #400: the rooms left out of the figures, in plain words. */
function leftNote(left: string[]): string {
  if (!left.length) return '';
  const now = new Map(offlineNow().map((o) => [o.name, o.run.from]));
  return left.map((name) => `<p>${esc(leftSentence(name, now.get(name) ?? null))}</p>`).join('');
}

/** #400: the month of the home: the amount and the change of the Accueil month tile, same scope. */
function homeMonthCard(last: string): string {
  const from = `${last.slice(0, 8)}01`;
  const all = wholeHome();
  const sc = homeScope(all, from, last);
  return `<section class="card proche-month">
    <h3 class="muted">${esc(homeMonthTitle(last))}</h3>
    <p class="proche-big">${sc.spent.unit === '€' ? plainEur(sc.spent.value) : `${plainNum(sc.spent.kwh)} kWh`}</p>
    <p>${esc(comparedPct(yoy(all, from, last)))}</p>${leftNote(sc.left)}
  </section>`;
}

/** Spending of the month so far (euros when prices are known, else kWh), compared to last year. */
function monthCard(records: DayRecord[], last: string, label = monthLabel(last)): string {
  const from = `${last.slice(0, 8)}01`;
  const kwh = total(records, from, last);
  const before = total(records, minusYears(from), minusYears(last));
  const eur = costOf(records, from, last);
  return `<section class="card proche-month">
    <h3 class="muted">${esc(label)}</h3>
    <p class="proche-big">${eur === null ? `${plainNum(kwh)} kWh` : plainEur(eur)}</p>
    <p>${esc(comparedToLastYear(kwh, before > 0 ? before : null))}</p>
  </section>`;
}

function chooseRoomCard(): string {
  return `<section class="card"><h3>Votre pièce</h3>
    <p>Choisissez la pièce où vous vivez le plus : sa température s'affichera ici.</p>
    <a class="btn secondary block" href="#pieces">Choisir ma pièce</a></section>`;
}

const pinned = () => (state.pinnedRoom ? activeRooms().find((r) => r.id === state.pinnedRoom) : undefined);

// ------------------------------------------------------------------ pages
function renderHome(view: HTMLElement) {
  const last = lastDay();
  const from = `${last.slice(0, 8)}01`;
  const room = pinned();
  view.innerHTML = html`<h1 class="sr-only" id="page-title" tabindex="-1">Accueil</h1>
  ${verdictCard(from, last)}
  ${room ? roomTodayCard(room.id, room.name) : chooseRoomCard()}
  ${homeMonthCard(last)}
  <section class="card">${glossarySection()}</section>
  ${simpleExit()}`;
}

/** Ma pièce: today, the month (mean temperature, cold days) and its spending. */
function renderRoom(view: HTMLElement, route: Route) {
  const id = route.page === 'piece' ? route.room : '';
  const room = activeRooms().find((r) => r.id === id);
  // the pinned room is a tab (no back arrow): its title is drawn here; another room has the sub-page bar
  const own = id === state.pinnedRoom;
  if (!room) {
    view.innerHTML = html`${own ? title('Ma pièce') : ''}<section class="card"><p>Cette pièce n'est plus affichée.</p><a class="btn secondary block" href="#pieces">Choisir ma pièce</a></section>`;
    return;
  }
  const last = lastDay();
  const from = `${last.slice(0, 8)}01`;
  const month = MONTHS_LONG[Number(last.slice(5, 7)) - 1];
  const days = ds!.temps.get(room.id);
  const mean = meanTemp(days, from, last);
  let cold = 0;
  for (const [d, [t]] of days ?? []) if (d >= from && d <= last && typeof t === 'number' && t < state.comfortThreshold) cold++;
  const p = mean === null ? null : pinnedTemp(mean, cold, state.comfortThreshold);
  const mine = ds!.records.filter((r) => r.room === room.id);
  view.innerHTML = html`${own ? title(room.name) : ''}
  ${roomTodayCard(room.id, room.name, false)}
  ${p ? `<section class="card"><h3 class="muted">En ${esc(month)}, en moyenne</h3><p class="proche-big">${esc(p.value)}</p><p>${esc(p.sub)}</p></section>` : ''}
  ${monthCard(mine, last, `Cette pièce, ${monthLabel(last).toLowerCase()}`)}
  <a class="btn secondary block" href="#pieces">${own ? 'Choisir une autre pièce' : 'Voir les autres pièces'}</a>`;
}

/** Ma pièce without a pinned room: choose it (it becomes the tab). */
function renderChooser(view: HTMLElement) {
  const rooms = activeRooms().filter((r) => r.category !== 'water_heater');
  view.innerHTML = html`${title('Quelle est votre pièce ?')}
  <p>Touchez la pièce où vous vivez le plus. Vous pourrez en changer.</p>
  <ul class="proche-rooms">${rooms
    .map(
      (r) =>
        `<li><button type="button" class="btn ${r.id === state.pinnedRoom ? 'primary' : 'secondary'} block" data-pin-room="${esc(r.id)}"${
          r.id === state.pinnedRoom ? ' aria-current="true"' : ''
        }>${esc(r.name)}</button></li>`,
    )
    .join('')}</ul>`;
}

/** Aide: the words to know, whom to call, and the way out to the whole app. */
export function renderAide(view: HTMLElement) {
  view.innerHTML = html`${state.simple ? title('Aide') : ''}
  <section class="card">${glossarySection()}</section>
  <section class="card"><h2>Qui appeler ?</h2>
    <p>Appelez la personne qui vous a installé l'appli : c'est elle qui gère le chauffage du logement.</p>
    <ul class="proche-list">
      <li>Une pièce reste froide plusieurs jours.</li>
      <li>L'appli affiche « Données arrêtées ».</li>
      <li>L'appli demande la phrase de passe et vous ne l'avez plus.</li>
    </ul>
    <p>La phrase de passe se donne de vive voix, jamais par message.</p></section>
  <section class="card"><h2>Lire les chiffres</h2>
    <p>Les montants sont arrondis à l'euro. Ils comparent toujours aux mêmes jours de l'an dernier.</p>
    <p><a href="#bienvenue">Revoir la présentation de l'appli</a></p></section>
  ${state.simple ? `<section class="card"><h2>Voir toute l'appli</h2><p>La vue simple montre l'essentiel. Pour tous les détails :</p>${simpleExit()}</section>` : ''}`;
}

const handlers: Handlers = {
  click(el) {
    const id = el.dataset.pinRoom;
    if (id === undefined) return false;
    setState({ pinnedRoom: id });
    // a history entry of its own (Back returns to the choice); main.ts follows the address
    location.hash = `#piece-${encodeURIComponent(id)}`;
    return true;
  },
};

/** Pages of the simple view; the others (Paramètres, État…) stay those of the full view. */
export const SIMPLE_PAGES: Partial<Record<Route['page'], { render(view: HTMLElement, route: Route): void; handlers?: Handlers[] }>> = {
  accueil: { render: renderHome },
  pieces: { render: renderChooser, handlers: [handlers] },
  piece: { render: renderRoom },
  aide: { render: renderAide },
};
