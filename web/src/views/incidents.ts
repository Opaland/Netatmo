// #280 (S-1.31): « Journal des incidents » of État des données. A timeline per month (one lane per
// kind of incident, hidden from screen readers) and the equivalent list, dated, with the duration
// and the source of each incident. Simple mode: one sentence. Computed in incidents.ts.
import { state } from '../app';
import type { Dataset } from '../data';
import { MONTHS_LONG, dayShort } from '../glossary';
import { type Incident, type IncidentKind, KIND_ICON, type MonthIncidents, byMonth, incidents, monthSummary, simpleSentence } from '../incidents';
import { esc } from '../ui';

const LANES: [string, IncidentKind[]][] = [
  ['Courant', ['power']],
  ['Internet', ['internet']],
  ['Appareils', ['module', 'station', 'battery']],
  ['Collecte', ['collect']],
];

const monthName = (m: string) => `${MONTHS_LONG[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const daysIn = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();

function duration(e: Incident): string {
  if (e.kind === 'power' || e.kind === 'internet') return e.hours == null ? 'moins d’une heure (entre deux relevés)' : `environ ${e.hours} h`;
  if (e.kind === 'collect') return '';
  const n = e.days ?? 1;
  if (e.ongoing) return `en cours depuis ${n} jour${n > 1 ? 's' : ''}`;
  return n > 1 ? `${n} jours, jusqu’au ${dayShort(e.to!)}` : '1 jour';
}

function when(e: Incident): string {
  return `${dayShort(e.day)}${e.at ? `, ${Number(e.at.slice(11, 13))} h${e.at.slice(14, 16) !== '00' ? e.at.slice(14, 16) : ''}` : ''}`;
}

/** The timeline of a month: decoration only (aria-hidden), the list says the same. */
function frise(m: MonthIncidents): string {
  const n = daysIn(m.month);
  const pos = (d: string) => ((Number(d.slice(8, 10)) - 1) / n) * 100;
  const lanes = LANES.filter(([, kinds]) => m.events.some((e) => kinds.includes(e.kind)));
  return `<div class="frise" aria-hidden="true">${lanes
    .map(([label, kinds]) => {
      const marks = m.events
        .filter((e) => kinds.includes(e.kind))
        .map((e) => {
          const left = pos(e.day);
          const end = e.to && e.to.slice(0, 7) === m.month ? pos(e.to) + 100 / n : e.to ? 100 : left + 100 / n;
          const width = Math.max(100 / n, end - left);
          return `<span class="frise-mark k-${e.kind}" style="left:min(${left.toFixed(2)}%, calc(100% - 1.4em));width:${width.toFixed(2)}%" title="${esc(`${when(e)} : ${e.label}`)}">${KIND_ICON[e.kind]}</span>`;
        })
        .join('');
      return `<div class="frise-lane"><span class="frise-label">${label}</span><span class="frise-track">${marks}</span></div>`;
    })
    .join('')}<div class="frise-axis"><span>1</span><span>${Math.ceil(n / 2)}</span><span>${n}</span></div></div>`;
}

function monthBlock(m: MonthIncidents, open: boolean): string {
  const sum = monthSummary(m);
  const body = `${frise(m)}
    <ul class="incident-list">${m.events
      .map((e) => {
        const d = duration(e);
        return `<li class="k-${e.kind}"><span class="incident-icon" aria-hidden="true">${KIND_ICON[e.kind]}</span><p><strong>${esc(when(e))}</strong> : ${esc(e.label)}${d ? `, ${esc(d)}` : ''}.<br><small class="muted">Source : ${esc(e.source)}.</small></p></li>`;
      })
      .join('')}</ul>`;
  return `<details class="incident-month" ${open ? 'open' : ''}><summary><strong>${esc(monthName(m.month))}</strong> : ${esc(sum)}</summary>${body}</details>`;
}

export function incidentsCard(d: Pick<Dataset, 'devices' | 'station' | 'meta'>, stopped: { room: string; from: string }[], sourceName: Record<string, string>): string {
  const last = d.meta.last_day ?? '';
  const list = incidents({
    devices: d.devices,
    health: d.station?.health,
    stationModules: d.station?.modules,
    rooms: d.meta.rooms,
    stopped,
    sourceName,
    last,
  });
  const months = byMonth(list);
  const head = '<div class="card-head"><h2 id="incidents-title">Journal des incidents</h2></div>';
  if (state.simple) return `<section class="card" id="incidents" aria-labelledby="incidents-title">${head}<p>${esc(simpleSentence(months, last))}</p></section>`;
  return `<section class="card" id="incidents" aria-labelledby="incidents-title">${head}
    <p class="card-sub">Coupures de courant et d’Internet, appareils muets, piles faibles et collectes en échec, mois par mois : de quoi expliquer un trou dans une courbe. Les radiateurs arrêtés volontairement n’y figurent pas.</p>
    <p>${esc(simpleSentence(months, last))}</p>
    ${months.length ? months.map((m, i) => monthBlock(m, i === 0)).join('') : '<p class="hint muted">Aucun incident relevé pour l’instant.</p>'}
    <p class="hint muted">Une coupure de courant se reconnaît au redémarrage de la passerelle Intuis ; une maison injoignable sans redémarrage est une coupure Internet. Durées à l’heure près : la maison est interrogée une fois par heure.</p>
  </section>`;
}
