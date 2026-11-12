// Analyse, loaded on demand (S-7.10): cost of a telework day (S-4.9) and probable
// absences with what was consumed meanwhile (S-4.10). Filled into placeholders left by
// analyse.ts. Absences are computed here only: the edits are kept on this device,
// encrypted with the data key, and never sent anywhere (the AI included).
import { MONTHS_SHORT, addDays, minusYears } from '../aggregate';
import { ds, onDatasetLoaded, rerender } from '../app';
import { calendarChart } from '../charts';
import { openLocal } from '../crypto';
import { writeSealed } from '../local-store';
import { loadRoomState } from '../data';
import { bedroomGrouping } from '../windows';
import { AUTO_AWAY_DELAY_H, type AwayRun, absenceSaving, homeAbsences, roomOnlyAway, shiftBack } from '../away';
import { dayShort, seasonLabel } from '../glossary';
import {
  ABSENCE_MIN_DAYS,
  ABSENCE_RATIO,
  type AbsenceEdits,
  LINKY_RATIO,
  MIN_DJU_DAY,
  NO_EDITS,
  type Period,
  absencePeriods,
  dayTypeCost,
  lowDays,
  mergeAbsences,
  signatureExpect,
  summarizeAbsence,
  teleworkPlan,
  waterTalon,
  withModeAbsences,
} from '../habits';
import { readPref, writePref } from '../money';
import { activeRooms, avgPrice, costOf, esc, firstDay, fmtEur, fmtKwh, lastDay, nf0, roomName, table } from '../ui';
import { currentHcHp } from './waterheater';
import { cutDays } from './quality';
import { html } from '../trusted';
import { onCard } from '../events';
import { NS, lsKey } from '../scope';
import { switchField, countedText } from '../components';

const num1 = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const shortDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS_SHORT[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

function put(id: string, markup: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (markup) el.outerHTML = html(markup);
  else el.remove();
}

export interface CalendarOpts {
  year: number;
  data: [string, number][];
  max: number;
}

/** Called by analyse.ts once this module is loaded. */
export async function fillAnalyse(cal: CalendarOpts) {
  put('telework-zone', teleworkCard());
  const d = ds;
  const edits = await loadEdits();
  await loadModeAbsences();
  if (ds !== d) return; // #247: another dataset (or the lock) since: its own render fills the card
  const list = absences(edits);
  const el = document.getElementById('cal-chart');
  const marks = list.flatMap((p) => daysOf(p)).filter((d) => d.startsWith(String(cal.year)));
  if (el && marks.length) calendarChart(el, { ...cal, marks, markLabel: 'Absence probable' });
  put('absence-zone', absenceCard(list, edits));
  put('hist-absence-zone', historyAbsences(list));
  bindAbsences(edits);
}

function daysOf(p: Period): string[] {
  const out: string[] = [];
  for (let d = p.from; d <= p.to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ------------------------------------------------------------------ S-4.9 telework
const LS_ROOM = lsKey('telework-room');
const LS_DAYS = lsKey('telework-days');
const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];

function teleworkRoom(): string | null {
  const rooms = activeRooms().filter((r) => r.category === 'heating');
  const saved = readPref(LS_ROOM);
  return (rooms.find((r) => r.id === saved) ?? rooms.find((r) => /bureau/i.test(r.name)) ?? rooms[0])?.id ?? null;
}
function teleworkDays(): Set<number> {
  return new Set(
    (readPref(LS_DAYS) ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number)
      .filter((d) => d >= 0 && d <= 4),
  );
}

function teleworkCard(): string {
  const room = teleworkRoom();
  if (!room) return '';
  const rooms = activeRooms().filter((r) => r.category === 'heating');
  const name = rooms.find((r) => r.id === room)!.name;
  const last = lastDay();
  const from = addDays(minusYears(last), 1);
  const recs = ds!.records.filter((r) => r.room === room && r.day >= from && r.day <= last);
  const perDay = new Map<string, number>();
  for (const r of recs) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.kwh);
  const tw = teleworkDays();
  const kwhAll = recs.reduce((s, r) => s + r.kwh, 0);
  const cost = costOf(recs, from, last);
  const price = cost !== null && kwhAll > 0 ? cost / kwhAll : avgPrice();
  const head = `<div class="card-head"><h2>Coût d'une journée de télétravail <small class="muted">chauffage d'une pièce, 12 derniers mois</small></h2></div>
    <label class="money-field">Pièce
      <select id="tw-room">${rooms.map((r) => `<option value="${esc(r.id)}" ${r.id === room ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
    <fieldset class="days-pick"><legend class="hint">Mes jours de télétravail habituels</legend>${DOW.map(
      (l, i) => switchField(l, tw.has(i), { 'data-tw-day': i }),
    ).join('')}</fieldset>`;
  if (!ds!.weather) {
    return `<section class="card" id="telework-card">${head}<p class="hint muted">Il faut la météo (prochaine collecte) pour comparer les jours à climat égal.</p></section>`;
  }
  const plan = teleworkPlan(tw);
  const kinds = plan.kinds;
  const res = dayTypeCost(perDay, ds!.weather, from, last, plan.group);
  const label: Record<string, string> = { telework: 'Jour de télétravail', office: 'Jour ouvré au bureau', weekday: 'Jour ouvré (lun.–ven.)', weekend: 'Jour de week-end' };
  if (!res || kinds.some((k) => !res.groups.has(k))) {
    return `<section class="card" id="telework-card">${head}<p class="hint muted">Pas assez de jours chauffés dans cette pièce sur 12 mois pour comparer (au moins 3 jours de chaque sorte, à plus de ${MIN_DJU_DAY} degrés-jours).</p></section>`;
  }
  const money = (k: number) => (price !== null ? `${(k * price).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : '—');
  const g = (k: string) => res.groups.get(k)!;
  const [a, b] = plan.compare;
  const diff = g(a).kwh - g(b).kwh;
  const more = diff >= 0 ? 'de plus' : 'de moins';
  const delta = `(${diff >= 0 ? '+' : '−'}${fmtKwh(Math.abs(diff))})`;
  const sentence =
    b === 'office'
      ? `Une journée de télétravail coûte <strong>${money(Math.abs(diff))} ${more}</strong> qu'une journée au bureau pour chauffer « ${esc(name)} » ${delta}, à climat égal.`
      : a === 'telework'
        ? `Tous vos jours ouvrés sont en télétravail : dans « ${esc(name)} », une journée de télétravail coûte <strong>${money(g('telework').kwh)}</strong> et un jour de week-end <strong>${money(g('weekend').kwh)}</strong>, à climat égal, soit ${money(Math.abs(diff))} ${more} ${delta}. Sans jour au bureau, le week-end sert de point de comparaison.`
        : `Dans « ${esc(name)} », un jour ouvré coûte <strong>${money(g('weekday').kwh)}</strong> et un jour de week-end <strong>${money(g('weekend').kwh)}</strong>, à climat égal : écart de ${money(Math.abs(diff))} par jour. Activez vos jours de télétravail pour isoler leur coût.`;
  return `<section class="card" id="telework-card">${head}
    <p>${sentence}</p>
    ${table(
      ['Jour', 'kWh / jour', '€ / jour', 'Jours comptés'],
      kinds.map((k) => [label[k], num1(g(k).kwh), money(g(k).kwh), g(k).n]),
    )}
    <details class="table-details"><summary>Comment c'est calculé</summary>
      <p class="hint">Jours chauffés des 12 derniers mois (au moins ${MIN_DJU_DAY} degrés-jours) de la pièce choisie, classés par sorte de jour. Pour chaque sorte, une droite kWh = a + b × DJU est ajustée${[...res.groups.values()].some((x) => x.method === 'ratio') ? ' (ou, avec moins de 10 jours, le rapport kWh / DJU)' : ''}, puis lue au même climat pour toutes : ${num1(res.dju)} degrés-jours, la moyenne des ${res.days} jours. Prix : ${
        price !== null ? `${price.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} €/kWh, coût moyen de cette pièce sur la période` : 'aucun prix renseigné'
      }. Les jours fériés et les congés comptent comme des jours ouvrés : ils diluent un peu l'écart.</p>
    </details>
  </section>`;
}

// ------------------------------------------------------------------ S-4.10 absences
let cachedEdits: AbsenceEdits | null = null;
let persisted = true; // false: the key cannot encrypt (remembered by an older version), edits last until locking
let detected: { key: string; list: Period[] } | null = null;
let byMode: Period[] | null = null; // S-13.4: absences confirmed by the setpoint mode
let runs: AwayRun[] = []; // S-13.7: the same, with their hours
let roomOnly = new Map<string, { days: number; hours: number }>(); // a room alone in the absence mode
onDatasetLoaded(() => {
  cachedEdits = null;
  detected = null;
  byMode = null;
  runs = [];
  roomOnly = new Map();
  persisted = true;
});

async function loadModeAbsences() {
  const d = ds!;
  if (byMode || !d.meta.has_roomstate) return;
  let found: AwayRun[];
  let only = new Map<string, { days: number; hours: number }>();
  try {
    const rs = await loadRoomState(d);
    found = rs ? homeAbsences(rs) : [];
    if (rs) only = roomOnlyAway(rs, bedroomGrouping(d.meta.rooms, true));
  } catch {
    found = []; // the detection by consumption stays
  }
  if (ds !== d) return; // #247: never another dataset's absences
  runs = found;
  roomOnly = only;
  byMode = found.map(({ from, to }) => ({ from, to }));
}

/** The run of the absence mode behind a period (S-13.7), when it is the whole period (not merged with days found by consumption). */
const runOf = (p: Period) => runs.find((r) => r.from === p.from && r.to === p.to) ?? null;

/** « jeu. 24 sept. 20 h » */
const at = (day: string, hour: number | null) => `${dayShort(day)}${hour !== null ? ` ${hour} h` : ''}`;
const duration = (h: number) => (h < 48 ? `${Math.round(h)} h` : `${Math.floor(h / 24)} j${Math.round(h % 24) ? ` ${Math.round(h % 24)} h` : ''}`);

/** Hours of absence per day of a period: the run's when the mode saw it (moved back if corrected), else whole days. */
export function periodHours(p: Period, run: AwayRun | null, earlier: boolean): [string, number][] {
  if (!run) return daysOf(p).map((d) => [d, 24]);
  const days = run.days.map(([d, h]) => [d, h] as [string, number]);
  if (earlier && run.startHour !== null) {
    let left = AUTO_AWAY_DELAY_H;
    const first = days[0];
    const add = Math.min(left, 24 - first[1]);
    first[1] += add;
    left -= add;
    if (left > 0) days.unshift([addDays(first[0], -1), left]);
  }
  return days;
}
const lsAbsences = () => `${NS}:absences:${ds!.source}`;

async function loadEdits(): Promise<AbsenceEdits> {
  if (cachedEdits) return cachedEdits;
  const d = ds!;
  const raw = readPref(lsAbsences());
  let edits = NO_EDITS;
  if (raw) {
    try {
      edits = { ...NO_EDITS, ...(await openLocal<AbsenceEdits>(JSON.parse(raw), d.key)) };
    } catch {
      /* written with another passphrase: start again */
    }
  }
  if (ds === d) cachedEdits = edits;
  return edits;
}

async function saveEdits(edits: AbsenceEdits) {
  cachedEdits = edits;
  persisted = await writeSealed(lsAbsences(), ds!.key, edits); // #139: never over an unreadable note
  rerender();
}

function absences(edits: AbsenceEdits) {
  const key = `${ds!.records.length}|${lastDay()}|${byMode?.length ?? -1}`;
  if (!detected || detected.key !== key) {
    detected = { key, list: withModeAbsences(absencePeriods(lowDays(ds!.records, ds!.weather, ds!.linky, firstDay(), lastDay(), new Set(cutDays().keys()))), byMode ?? []) };
  }
  return mergeAbsences(detected.list, edits);
}

function absenceCard(list: ReturnType<typeof absences>, edits: AbsenceEdits): string {
  const heat = new Map<string, number>();
  const water = new Map<string, number>();
  for (const r of ds!.records) {
    const m = r.cat === 'water_heater' ? water : heat;
    m.set(r.day, (m.get(r.day) ?? 0) + r.kwh);
  }
  const expect = ds!.weather ? signatureExpect(ds!.records, ds!.weather) : null;
  const absent = new Set(list.flatMap(daysOf));
  const hp = currentHcHp();
  const waterPrice = hp?.hc ?? avgPrice();
  const shown = list.slice(0, 12);
  const heatPrice = avgPrice();
  const earlier = new Set(edits.earlier ?? []);
  let totalExcess = 0;
  let totalSaved = 0;
  const rows = shown.map((p, i) => {
    const talon = water.size ? waterTalon(water, (d) => absent.has(d), addDays(p.to, -365), p.to) : null;
    const s = summarizeAbsence(p, heat, water, expect, talon);
    const heatPct = s.heatExpected ? Math.round((s.heat / s.heatExpected) * 100) : null;
    const excess = s.waterExcess !== null && s.waterExcess >= 0.5 ? s.waterExcess : 0;
    totalExcess += excess;
    const eur = waterPrice !== null ? excess * waterPrice : null;
    const water_ = !water.size
      ? ''
      : talon === null
        ? ` · chauffe-eau ${fmtKwh(s.water)}`
        : ` · chauffe-eau ${fmtKwh(s.water)} pour un talon de ${fmtKwh(talon * s.days)}${
            excess ? ` : <strong class="ko-red">${eur === null ? fmtKwh(excess) : eur < 1 ? 'moins de 1 €' : fmtEur(eur)} de trop</strong>` : ' : rien de trop'
          }`;
    // S-13.7: hours of the absence mode, the detection delay, the heating saved
    const run = p.confirmed && !p.manual ? runOf(p) : null;
    const moved = !!run && earlier.has(p.from);
    const hours = periodHours(p, run, moved);
    const start = run && run.startHour !== null ? (moved ? shiftBack(run.from, run.startHour, AUTO_AWAY_DELAY_H) : { day: run.from, hour: run.startHour }) : null;
    const span = run
      ? `<strong>du ${esc(start ? at(start.day, start.hour) : at(run.from, null))} au ${esc(at(run.to, run.endHour))}</strong> <small class="muted">${duration(hours.reduce((a, [, h]) => a + h, 0))}, <span class="badge">confirmée par le mode de consigne</span></small>`
      : `<strong>${shortDate(p.from)} → ${shortDate(p.to)}</strong> <small class="muted">${s.days} jours, ${p.manual ? 'ajoutée' : p.confirmed ? '<span class="badge">confirmée par le mode de consigne</span>' : 'détectée'}</small>`;
    const saving = expect ? absenceSaving(hours, heat, expect) : null;
    const savedEur = saving && heatPrice !== null ? saving.kwh * heatPrice : null;
    if (savedEur !== null) totalSaved += savedEur;
    const saved = saving && saving.kwh >= 1 ? ` · économie estimée <strong>${savedEur !== null ? (savedEur < 1 ? 'moins de 1 €' : fmtEur(savedEur)) : fmtKwh(saving.kwh)}</strong> (${fmtKwh(saving.kwh)} de chauffage en moins qu'à cette météo)` : '';
    const delay =
      run && run.startHour !== null
        ? moved
          ? `<p class="hint muted">Début avancé de ${AUTO_AWAY_DELAY_H} h (délai de détection du mode absent). <button type="button" class="link" data-absence-earlier="${i}">Revenir au début vu par les radiateurs</button></p>`
          : (() => {
              const b = shiftBack(run.from, run.startHour!, AUTO_AWAY_DELAY_H);
              return `<p class="hint muted">Les radiateurs passent en mode absent après environ ${AUTO_AWAY_DELAY_H} h sans personne : l'absence a sans doute commencé vers le ${esc(at(b.day, b.hour))}. <button type="button" class="link" data-absence-earlier="${i}">Compter depuis le ${esc(at(b.day, b.hour))}</button></p>`;
            })()
        : '';
    return `<li><div>${span}</div>
      <div class="hint">Chauffage ${fmtKwh(s.heat)}${heatPct !== null ? ` (${heatPct} % de l'habituel à cette météo)` : ''}${saved}${water_}</div>
      ${delay}
      <button type="button" class="link" data-absence="${i}">${p.manual ? 'Retirer cette période' : 'Ce n\'était pas une absence'}</button></li>`;
  });
  const only = [...roomOnly].filter(([, v]) => v.days > 0);
  const onlyLine = only.length
    ? `<p class="hint muted">Une pièce seule en mode absent n'est pas une absence du logement : ${only
        .map(([k, v]) => `${esc(roomName(k))} ${v.days} jour${v.days > 1 ? 's' : ''}`)
        .join(', ')} sur l'année (non comptés ci-dessus).</p>`
    : '';
  return `<section class="card" id="absence-card">
    <div class="card-head"><h2>Absences probables <small class="muted">et consommation pendant celles-ci</small></h2></div>
    ${
      list.length
        ? `<p>${list.length} période${list.length > 1 ? 's' : ''} (points sur le calendrier).${totalSaved >= 1 ? ` Chauffage économisé pendant ces absences : <strong>${fmtEur(totalSaved)}</strong> environ.` : ''}${
            totalExcess > 0 && waterPrice !== null
              ? ` Le chauffe-eau a chauffé pour personne : <strong>${fmtEur(totalExcess * waterPrice)}</strong> au-dessus de son talon sur les absences listées — pensez au mode vacances.`
              : water.size
                ? ' Le chauffe-eau est resté à son talon pendant les absences listées.'
                : ''
          }</p>
           <ul class="absence-list">${rows.join('')}</ul>${onlyLine}`
        : '<p class="hint">Aucune absence détectée. Vous pouvez en ajouter une pour juger la consommation de cette période.</p>'
    }
    <div class="absence-add">
      <label class="money-field">Du <input type="date" id="abs-from" min="${firstDay()}" max="${lastDay()}"></label>
      <label class="money-field">Au <input type="date" id="abs-to" min="${firstDay()}" max="${lastDay()}"></label>
      <button type="button" class="primary small" id="abs-add">Ajouter une absence</button>
    </div>
    ${edits.dismissed.length ? `<button type="button" class="link" id="abs-restore">Rétablir les ${edits.dismissed.length} période${edits.dismissed.length > 1 ? 's' : ''} écartée${edits.dismissed.length > 1 ? 's' : ''}</button>` : ''}
    ${persisted ? '' : '<p class="hint muted">Vos corrections dureront jusqu\'au verrouillage : reconnectez-vous avec la phrase de passe pour qu\'elles soient enregistrées (chiffrées) sur cet appareil.</p>'}
    <details class="table-details"><summary>Comment c'est calculé</summary>
      <p class="hint">Un jour est « vide » quand, par temps froid (moins de 12 °C dehors), le chauffage reste sous ${nf0.format(ABSENCE_RATIO * 100)} % de ce qu'annonce la signature énergétique de la saison ; hors saison de chauffe, quand les autres usages relevés par le compteur Linky (compteur moins radiateurs et chauffe-eau) tombent sous ${nf0.format(LINKY_RATIO * 100)} % de leur médiane des 60 jours précédents. ${ABSENCE_MIN_DAYS} jours vides d'affilée ou plus font une absence probable.${byMode !== null && ds!.meta.has_roomstate ? ' Quand le relevé horaire de l\'état des pièces montre le mode <strong>absence</strong> ou <strong>hors-gel</strong> (dans toutes les pièces), la période est « confirmée par le mode de consigne », même courte, et ses heures de début et de fin sont reconstituées à l\'heure près à partir des heures en mode absent du premier et du dernier jour ; la consommation reste le repli les jours sans relevé. L\'<strong>économie estimée</strong> compare le chauffage mesuré à celui qu\'annonce la signature énergétique à la même météo, au prorata des heures d\'absence, au prix moyen du kWh.' : ''} Le <strong>talon</strong> du chauffe-eau est sa consommation d'entretien : le 10<sup>e</sup> centile de ses jours hors absence sur l'année précédente ; ce qu'il consomme au-delà pendant une absence est compté comme surcoût, au prix ${hp ? `heures creuses (${hp.hc.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} €/kWh, ${esc(hp.source)})` : 'moyen du kWh'}.</p>
      <p class="hint muted">Les absences sont calculées sur cet appareil seulement : elles ne sont jamais écrites en clair (vos corrections sont chiffrées avec votre phrase de passe), ni envoyées à l'IA.</p>
    </details>
  </section>`;
}

/**
 * S-13.7 in Historique: the absences of the last two winters, so that the comparisons above are read
 * with them in mind (a week away lowers a winter's consumption). Nothing when there is none.
 */
function historyAbsences(list: ReturnType<typeof absences>): string {
  const last = lastDay();
  const season = (y: number) => [`${y}-09-01`, `${y + 1}-08-31`] as const;
  const cur = Number(last.slice(5, 7)) >= 9 ? Number(last.slice(0, 4)) : Number(last.slice(0, 4)) - 1;
  const days = (from: string, to: string) => list.reduce((n, p) => n + daysOf(p).filter((d) => d >= from && d <= to).length, 0);
  const now = days(...season(cur));
  const before = days(...season(cur - 1));
  if (!now && !before) return '';
  const label = seasonLabel;
  const recent = list.filter((p) => p.to >= season(cur - 1)[0]).slice(0, 4);
  return `<section class="card" id="hist-absences" aria-labelledby="hist-absences-title">
    <div class="card-head"><h2 id="hist-absences-title">Absences</h2></div>
    <p class="card-sub">${esc(countedText(`hivers ${label(cur - 1)} et ${label(cur)} (septembre à août) · mode absent des radiateurs, sinon consommation`))}</p>
    <p>Ces jours restent comptés dans les comparaisons de cette page : <strong>${now} jour${now > 1 ? 's' : ''} d'absence l'hiver ${label(cur)}</strong>, ${before ? `${before} l'hiver ${label(cur - 1)}` : `aucun l'hiver ${label(cur - 1)}`}. Une absence fait baisser la consommation d'un hiver sans que le logement chauffe mieux.</p>
    <ul class="absence-list">${recent.map((p) => `<li>${esc(shortDate(p.from))} → ${esc(shortDate(p.to))} <small class="muted">${daysOf(p).length} jour${daysOf(p).length > 1 ? 's' : ''}${p.confirmed ? ', mode absent' : p.manual ? ', ajoutée' : ', détectée'}</small></li>`).join('')}</ul>
    <a class="link" href="#outils-absences">Heures, économie estimée et corrections</a>
  </section>`;
}

/** Edits of the absences shown, for the buttons of the card (#257: registered handlers). */
let shownEdits: AbsenceEdits | null = null;
function bindAbsences(edits: AbsenceEdits) {
  shownEdits = edits;
}

// #257: the telework and absence controls, dispatched by main.ts (no `onclick =` on the elements).
onCard({
  change(t) {
    if (t.id === 'tw-room') {
      writePref(LS_ROOM, t.value);
      rerender();
      return true;
    }
    if (t instanceof HTMLInputElement && t.dataset.twDay !== undefined) {
      const cur = teleworkDays();
      const d = Number(t.dataset.twDay);
      if (t.checked) cur.add(d);
      else cur.delete(d);
      writePref(LS_DAYS, [...cur].sort().join(','));
      rerender();
      return true;
    }
    return false;
  },
  click(el) {
    const edits = shownEdits;
    if (!edits) return false;
    if (el.dataset.absence !== undefined) {
      const p = absences(edits).slice(0, 12)[Number(el.dataset.absence)];
      if (p) {
        void saveEdits(
          p.manual
            ? { ...edits, added: edits.added.filter((a) => !(a.from === p.from && a.to === p.to)) }
            : { ...edits, dismissed: [...edits.dismissed, p.from] },
        );
      }
      return true;
    }
    if (el.dataset.absenceEarlier !== undefined) {
      const p = absences(edits).slice(0, 12)[Number(el.dataset.absenceEarlier)];
      if (p) {
        const cur = edits.earlier ?? [];
        void saveEdits({ ...edits, earlier: cur.includes(p.from) ? cur.filter((d) => d !== p.from) : [...cur, p.from] });
      }
      return true;
    }
    if (el.id === 'abs-add') {
      const f = (document.getElementById('abs-from') as HTMLInputElement).value;
      let t = (document.getElementById('abs-to') as HTMLInputElement).value || f;
      if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
        if (t < f) t = f;
        void saveEdits({ ...edits, added: [...edits.added, { from: f, to: t }] });
      }
      return true;
    }
    if (el.id === 'abs-restore') {
      void saveEdits({ ...edits, dismissed: [] });
      return true;
    }
    return false;
  },
});

