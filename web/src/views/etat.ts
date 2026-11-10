// #318 / #336: État des données, the quality report (lazy module). Answers « a-t-on bien les
// données ? », « est-ce normal qu'il manque des jours en 2023 ? », « quelle qualité en 2024 ? »:
// year by year, then source by source (% of days covered, gaps with their probable cause and
// what can be recovered). Computed here from the decrypted documents (data-quality.ts).
import { ds, rawDataset } from '../app';
import { list, tile } from '../components';
import { loadCurve, loadRoom30, loadRoomState } from '../data';
import {
  type FineInput,
  type Gap,
  LEVEL_LABEL,
  type QualityInput,
  type QualityReport,
  type SourceQuality,
  covered,
  curveParts,
  fineSource,
  gapPeriod,
  monthStatus,
  qualityReport,
  seenParts,
  yearVerdicts,
} from '../data-quality';
import { offlineDays, offlineModules, restarts, setupDates, splitStopped } from '../devices';
import { MONTHS_LONG, dayShort } from '../glossary';
import { suspectDays } from '../reconstitute';
import { html } from '../trusted';
import { esc } from '../ui';
import { stoppedRooms } from './offline-rooms';

const pct = (v: number | null) => (v === null ? '—' : `${Math.floor(v * 100)} %`);
const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;

function input(): QualityInput {
  const d = rawDataset() ?? ds!;
  const doc = d.devices;
  const rooms = d.meta.rooms.filter((r) => r.category !== 'ignore');
  const active = new Set(rooms.map((r) => r.id));
  const records = d.records.filter((r) => active.has(r.room));
  const suspects = d.weather ? suspectDays(records, { weather: d.weather, linky: d.linky, estimated: d.estimated }).map((s) => s.day) : [];
  return {
    last: d.meta.last_day ?? '',
    rooms,
    records,
    estimated: d.estimated,
    linky: d.linky,
    station: d.station,
    devices: {
      offline: offlineDays(doc),
      offlineNow: splitStopped(offlineModules(doc), stoppedRooms()).off,
      boots: restarts(doc).map((b) => b.slice(0, 10)),
      waterSetup: setupDates(doc)
        .filter((s) => s.type === 'NMW')
        .map((s) => s.day),
    },
    suspects,
    // #346: radiators switched off on purpose (⚙ Mon logement): no data expected, not missing
    stopped: stoppedRooms().map((x) => ({
      room: x.room,
      from: x.from,
      text: `radiateur arrêté volontairement depuis le ${dayShort(x.from, true)}${x.label ? ` (${x.label})` : ''}`,
    })),
  };
}

let cache: { key: unknown; stopped: string; report: QualityReport; input: QualityInput } | null = null;
function report() {
  const d = rawDataset() ?? ds!;
  const key = `${JSON.stringify(stoppedRooms())}`;
  if (cache?.key !== d || cache.stopped !== key) {
    const i = input();
    cache = { key: d, stopped: key, report: qualityReport(i), input: i };
  }
  return cache;
}

/** « Vos données, année par année » and the sources, drawn in #etat-bilan. */
export function mountEtat(el: HTMLElement | null) {
  if (!el || !ds) return;
  const { report: r, input: i } = report();
  const m = monthStatus(i);
  const month = MONTHS_LONG[Number(i.last.slice(5, 7)) - 1];
  const verdicts = yearVerdicts(r);
  el.innerHTML = html`<section class="kpis">
      ${tile({
        label: `Radiateurs en ${month}, au ${dayShort(i.last)}`,
        value: `${m.ok + m.estimated} / ${m.expected} jours`,
        sub: esc(m.missing ? `${plural(m.missing, 'jour')} incomplet${m.missing > 1 ? 's' : ''}` : m.estimated ? `dont ${m.estimated} estimé${m.estimated > 1 ? 's' : ''}` : 'tous complets'),
      })}
      ${tile({ label: 'Années suivies', value: String(verdicts.length), sub: esc(`depuis ${r.sources[0]?.first ? dayShort(r.sources[0].first, true) : '—'}`) })}
    </section>
    <section class="card" id="quality-years" aria-labelledby="qy-title">
      <div class="card-head"><h2 id="qy-title">Année par année</h2></div>
      <p class="card-sub">Jours où toutes les pièces ont une valeur (mesurée ou estimée depuis le total du mois), et ce qui explique les manques.</p>
      ${verdicts
        .map(
          (v) => `<div class="year-verdict ${v.level}"><h3>${v.year} <span class="tag level">qualité ${LEVEL_LABEL[v.level]}</span></h3>
        <p>${esc(v.headline)}.</p>${v.reasons.length ? `<ul>${v.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${v.answer ? `<p class="hint${v.reasons.length ? '' : ' muted'}">${esc(v.answer)}</p>` : ''}</div>`,
        )
        .join('')}
    </section>
    <section class="card" id="quality-sources" aria-labelledby="qs-title">
      <div class="card-head"><h2 id="qs-title">Source par source</h2></div>
      <p class="card-sub">Part des jours couverts chaque année, depuis le premier relevé de la source ; trous de 3 jours ou plus, avec leur cause quand elle est connue.</p>
      ${r.sources.map(sourceBlock).join('')}
      <div id="quality-fine"><p class="hint muted" role="status">Relevés à la demi-heure et à l’heure : chargement…</p></div>
    </section>`;
  void fine(i);
}

function sourceBlock(s: SourceQuality): string {
  const shown = s.gaps.slice(0, 8);
  const more = s.gaps.length - shown.length;
  return `<div class="source-quality" data-source="${s.id}">
    <h3>${esc(s.label)}</h3>
    ${list(
      [...s.years].reverse().map((y) => {
        const c = covered(y);
        const parts = [`${y.full} complets`, y.estimated ? `${y.estimated} estimés` : '', y.partial ? `${y.partial} partiels` : '', y.missing ? `${y.missing} manquants` : ''].filter(Boolean);
        return { title: String(y.year), sub: `${parts.join(', ')} sur ${y.expected} jours`, value: pct(c), share: (c ?? 0) * 100, color: (c ?? 0) >= 0.98 ? '--state-good' : (c ?? 0) >= 0.9 ? '--state-warn' : '--state-bad' };
      }),
      `${s.label} : jours couverts par année`,
    )}
    ${shown.length ? `<ul class="gaps">${shown.map(gapItem).join('')}</ul>` : '<p class="hint muted">Aucun trou de 3 jours ou plus.</p>'}
    ${more > 0 ? `<p class="hint muted">Et ${more} autre${more > 1 ? 's trous plus courts' : ' trou plus court'}.</p>` : ''}
    ${s.scattered ? `<p class="hint muted">${plural(s.scattered, 'jour')} isolé${s.scattered > 1 ? 's' : ''} sans valeur (1 ou 2 jours de suite).</p>` : ''}
    ${s.notes.map((n) => `<p class="hint muted">${esc(n)}</p>`).join('')}
  </div>`;
}

function gapItem(g: Gap): string {
  const what = g.kind === 'zero' ? `0 kWh pendant ${g.days} jours` : `${g.ongoing ? 'Muet depuis' : 'Trou de'} ${g.days} jour${g.days > 1 ? 's' : ''}`;
  return `<li><p><strong>${esc(what)}</strong>, ${esc(g.who)}, ${esc(gapPeriod(g))}.</p>
    <p>Cause probable : ${esc(g.cause)}.${g.link ? ` <a href="${esc(g.link)}">Voir l’état des appareils</a>` : ''}</p>
    <p class="muted">Récupérable ? ${esc(g.recover)}</p></li>`;
}

/** The half-hour and hourly sources, loaded on demand (several documents). */
async function fine(i: QualityInput) {
  const d = ds!;
  const raw = rawDataset() ?? d;
  const heating = report().report.sources.find((s) => s.id === 'heating');
  const rooms = i.rooms.map((r) => ({ id: r.id, name: r.name }));
  const tasks: Promise<SourceQuality | null>[] = [];
  if ((raw.meta.room30_years ?? []).length) {
    tasks.push(
      loadRoom30(raw).then((r30): SourceQuality | null => {
        const parts: FineInput['parts'] = [...r30].filter(([id]) => rooms.some((r) => r.id === id)).map(([id, dd]) => ({ name: id, days: new Set(dd.keys()) }));
        const last = parts.flatMap((p) => [...p.days]).reduce((a, b) => (b > a ? b : a), '');
        return fineSource('room30', { parts, last }, heating?.first ?? null, rooms);
      }),
    );
  }
  tasks.push(loadCurve(raw).then((c) => (c.size ? fineSource('linky30', curveParts(c), null) : null)));
  if (raw.meta.has_roomstate) tasks.push(loadRoomState(raw).then((rs) => (rs?.seen ? fineSource('roomstate', seenParts(rs.seen), null) : null)));
  const results = await Promise.allSettled(tasks);
  const zone = document.getElementById('quality-fine');
  if (!zone || ds !== d) return;
  const ok = results.flatMap((x) => (x.status === 'fulfilled' && x.value ? [x.value] : []));
  const failed = results.some((x) => x.status === 'rejected');
  zone.innerHTML = html(
    `${ok.map(sourceBlock).join('')}${failed ? '<p class="hint muted" role="status">Une partie des relevés fins n’a pas pu être chargée (hors connexion ?).</p>' : ''}${
      !ok.length && !failed ? '<p class="hint muted">Pas de relevé à la demi-heure ni à l’heure pour l’instant.</p>' : ''
    }`,
  );
}
