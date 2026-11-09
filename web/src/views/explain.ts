// #337: « Expliquer un mois » (Outils, and the link under the verdict of Accueil): why a month
// cost more or less than the same month a year earlier. One sentence first, then the parts of
// the change drawn from 0 (no zoomed axis), the rooms, the rooms offline (#346), and how it is
// computed. Loaded on demand (pages.ts); the computations are in explain.ts.
import { activeRooms, ds } from '../app';
import { waterfallChart } from '../charts';
import { alert, howDetails, list } from '../components';
import { type Explanation, STEP_LABEL, type Step, explainMonth, explainSentence, explainableMonths, kwhSigned, stepNote } from '../explain';
import { dayShort, monthLong, monthShort, rangeLabel, signedPct } from '../glossary';
import { offlineText } from '../room-offline';
import { routeKey } from '../router';
import { html } from '../trusted';
import { avgPrice, costAvailable, esc, fmtKwh, lastDay, table, tableToggle } from '../ui';
import { offlineInfo } from './offline-rooms';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The month asked (address), else the last one that can be explained. */
function pick(months: string[], asked?: string): string | null {
  if (asked && months.includes(asked)) return asked;
  return months[0] ?? null;
}

export function renderExplain(view: HTMLElement, asked?: string) {
  const d = ds!;
  const last = lastDay();
  const months = explainableMonths(d.records, last);
  const month = pick(months, asked);
  if (!month) {
    view.innerHTML = html`<section class="card"><p class="hint">Il faut un an de données pour comparer un mois au même mois de l’an dernier.</p></section>`;
    return;
  }
  const off = offlineInfo();
  const e = explainMonth({
    month,
    last,
    records: d.records,
    rooms: activeRooms(),
    weather: d.weather,
    linky: d.linky,
    temps: d.temps,
    runs: off.runs,
    estimate: off.estimate,
  });
  const select = `<label class="select"><span>Mois expliqué</span> <select data-explain-month>${months
    .map((m) => `<option value="${m}"${m === month ? ' selected' : ''}>${esc(cap(monthLong(m)))}</option>`)
    .join('')}</select></label>`;
  if (!e) {
    view.innerHTML = html(`<div class="periodbar">${select}</div><section class="card"><p class="hint">Pas de données le même mois de l’an dernier.</p></section>`);
    return;
  }
  const price = costAvailable() ? avgPrice(d.records) : null;
  const counted = `Compté : ${e.basis === 'linky' ? 'tout le logement (compteur Linky)' : 'radiateurs et chauffe-eau (sans compteur Linky)'}, ${rangeLabel(e.from, e.to)}, comparé aux mêmes jours de ${monthLong(e.refFrom)}`;
  const up = e.delta >= 0;
  const head = Math.abs(e.pct) < 3 ? 'Comme l’an dernier' : `${kwhSigned(e.delta)} vs ${monthShort(e.refFrom)}`;
  view.innerHTML = html(`<div class="periodbar">${select}<p class="scope" aria-live="polite">${esc(counted)}</p></div>
  <section class="verdict verdict-${Math.abs(e.pct) < 3 ? 'normal' : up ? 'high' : 'low'}" aria-labelledby="explain-title">
    <span class="verdict-icon" aria-hidden="true">${Math.abs(e.pct) < 3 ? '=' : up ? '▲' : '▼'}</span>
    <div><h2 class="verdict-title" id="explain-title">${esc(cap(monthLong(month)))} : ${esc(head)}</h2>
    <p class="verdict-sub" id="explain-sentence">${esc(explainSentence(e, price))}</p></div>
  </section>
  ${offlineBlock(e)}${stoppedBlock(e)}
  <section class="card" id="explain-steps" aria-labelledby="explain-steps-title">
    <div class="card-head"><h2 id="explain-steps-title">D’où vient l’écart</h2><span class="sub muted">kWh, de ${esc(monthShort(e.refFrom))} à ${esc(monthShort(e.from))}</span></div>
    <p class="card-sub">Chaque barre part de 0 : à droite ce qui a fait monter la consommation, à gauche ce qui l’a fait baisser. Les barres s’additionnent : ${esc(fmtKwh(e.ref))} ${esc(kwhSigned(e.delta).replace(/^([+−])/, '$1 '))} = ${esc(fmtKwh(e.now))}.</p>
    <div class="chart" id="explain-chart" role="img" aria-label="Écart par cause, en kWh"></div>
    ${list(e.steps.map((s) => stepRow(e, s)), 'Écart par cause')}
    ${tableToggle(
      table(
        ['Cause', 'kWh', ...(price ? ['≈ €'] : [])],
        [
          [esc(monthShort(e.refFrom)), Math.round(e.ref), ...(price ? [Math.round(e.ref * price)] : [])],
          ...e.steps.map((s) => [esc(s.label + (s.estimated ? ' (estimée)' : '')), esc(kwhSigned(s.kwh).replace(' kWh', '')), ...(price ? [esc(kwhSigned(s.kwh * price).replace(' kWh', ''))] : [])]),
          [esc(monthShort(e.from)), Math.round(e.now), ...(price ? [Math.round(e.now * price)] : [])],
        ],
      ),
    )}
  </section>
  ${roomsCard(e)}
  <section class="card"><div class="card-head"><h2>Comment c’est calculé</h2></div>
    ${howDetails('Le détail des parts', howText(e))}
    <p class="hint muted">Pour un autre mois : la liste ci-dessus. Pour le détail jour par jour : <a class="link" href="#historique">Historique</a>.</p>
  </section>`);
  const el = document.getElementById('explain-chart');
  if (el)
    waterfallChart(el, {
      startLabel: monthShort(e.refFrom),
      endLabel: monthShort(e.from),
      start: e.ref,
      steps: e.steps.map((s) => ({ name: s.label + (s.estimated ? ' (estimée)' : ''), delta: s.kwh })),
      keepOrder: true,
      title: 'Écart par cause',
    });
}

function stepRow(e: Explanation, s: Step) {
  return {
    title: `${s.label}${s.estimated ? ' (estimée)' : ''}`,
    sub: stepNote(e, s),
    value: kwhSigned(s.kwh),
    color: s.kwh > 0.5 ? '--state-bad' : s.kwh < -0.5 ? '--state-good' : '--text-muted',
  };
}

function offlineBlock(e: Explanation): string {
  if (!e.offline.length) return '';
  return e.offline
    .map((o) =>
      alert(
        'warn',
        `${o.name} : ${offlineText({ from: o.since, to: e.to, ongoing: o.ongoing })}`,
        o.estimated !== null
          ? `Sa consommation n’est plus mesurée. Ce mois-ci, le compteur en voit ≈ ${fmtKwh(o.estimated)} (Linky moins les autres pièces et les usages habituels) : c’est une estimation, comptée dans « ${STEP_LABEL.horsligne} ». Hors ligne, le radiateur garde son dernier réglage : ni planning, ni mode absence.`
          : 'Sa consommation n’est plus mesurée et aucun compteur Linky ne permet de l’estimer : sa baisse n’est pas une économie.',
        `<p><a class="link" href="#${routeKey({ page: 'piece', room: o.id })}">Voir la pièce</a></p>`,
      ),
    )
    .join('');
}

/** #346: a radiator switched off on purpose (a stove…): a change of heating, said once. */
function stoppedBlock(e: Explanation): string {
  return e.stopped
    .map((s) =>
      alert(
        'info',
        `${s.name} : radiateur ${s.text}`,
        `${s.stop.label ? `${s.stop.label.charAt(0).toUpperCase()}${s.stop.label.slice(1)}. ` : ''}Pas de données attendues : sa consommation électrique d’avant compte dans « ${STEP_LABEL.mode} », pas dans vos réglages.`,
      ),
    )
    .join('');
}

function roomsCard(e: Explanation): string {
  if (!e.rooms.length) return '';
  return `<section class="card" id="explain-rooms" aria-labelledby="explain-rooms-title">
    <div class="card-head"><h2 id="explain-rooms-title">Pièce par pièce</h2><span class="sub muted">écart à météo et températures demandées égales</span></div>
    ${list(
      e.rooms.map((r) => ({
        title: r.name,
        sub: r.stopped
          ? `radiateur ${offlineText({ from: r.stopped.from, to: e.to, ongoing: true, stopped: r.stopped })} · changement de mode de chauffage`
          : r.offline
          ? `${offlineText(offlineInfo().runs.filter((x) => x.room === r.id).pop() ?? { from: e.from, to: e.to, ongoing: false })}${r.estimated ? ` · ≈ ${fmtKwh(r.estimated)} estimés` : ' · plus mesurée'}`
          : `${fmtKwh(r.now)} contre ${fmtKwh(r.ref)}${r.setpoint ? ` · températures demandées ${kwhSigned(r.setpoint)}` : ''}`,
        value: kwhSigned(r.rest),
        color: '--usage-heating',
        href: `#${routeKey({ page: 'piece', room: r.id })}`,
      })),
      'Écart par pièce',
    )}
  </section>`;
}

function howText(e: Explanation): string {
  const w = e.weather;
  return `<ul class="hint">
    <li><strong>${STEP_LABEL.meteo}</strong> : le chauffage de ${esc(monthLong(e.refFrom))} multiplié par le rapport des degrés-jours (base 18 °C)${
      w ? `, ${Math.round(w.now)} contre ${Math.round(w.ref)} (${esc(signedPct(((w.now - w.ref) / w.ref) * 100))})` : ' ; météo inconnue sur l’une des périodes : pas de correction'
    }.</li>
    <li><strong>${STEP_LABEL.consignes}</strong> : l’écart de température demandée aux radiateurs, pièce par pièce (moyenne du jour, absences et plannings compris), compté environ 7 % du chauffage par degré (règle de l’ADEME).</li>
    <li><strong>${STEP_LABEL.mode}</strong> : une pièce dont le radiateur est arrêté volontairement (⚙ Mon logement, par exemple chauffée par un poêle) : tout son écart, sans météo ni température demandée.</li>
    <li><strong>${STEP_LABEL.pieces}</strong> : ce que chaque pièce a consommé de plus ou de moins une fois la météo et les températures demandées retirées (fenêtres, habitudes, isolation, radiateur).</li>
    <li><strong>${STEP_LABEL.horsligne}</strong> : les pièces sans relevé pendant au moins 48 h. Leur part est estimée chaque jour : compteur Linky − pièces mesurées − autres usages habituels (ajustés au froid sur l’année d’avant), marquée « estimée ».</li>
    <li><strong>${STEP_LABEL.eau}</strong> : le chauffe-eau, mesuré par Intuis.</li>
    <li><strong>${STEP_LABEL.autres}</strong> : ${e.basis === 'linky' ? 'compteur Linky − chauffage − eau chaude (cuisine, éclairage, appareils, veille)' : 'non comptés sans compteur Linky'}.</li>
  </ul>
  <p class="hint muted">Les parts s’additionnent exactement à l’écart. Comparé jour pour jour : ${esc(dayShort(e.from))} – ${esc(dayShort(e.to, true))} contre ${esc(dayShort(e.refFrom))} – ${esc(dayShort(e.refTo, true))}.</p>`;
}

/** Month chosen in the list: a new address (shareable, Back returns to the previous month). */
export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  if (!('explainMonth' in t.dataset)) return false;
  location.hash = `#${routeKey({ page: 'outil', tool: 'expliquer', month: t.value })}`;
  return true;
}
