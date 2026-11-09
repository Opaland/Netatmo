// S-5.9: canned questions answered by code, without AI. Pure functions: every number
// comes from the records, the verdict (analysis.verdict), the room waterfall
// (analysis.roomDeltas) and the degree days (analysis.djuBetween).
import { type DayRecord, MONTHS_LONG, minusYears, pctChange } from './aggregate';
import { type Weather, djuBetween, roomDeltas, verdict } from './analysis';
import { type Drops, type RoomState, coldReasons, coverage } from './windows';

export type QuestionId = 'why' | 'normal' | 'room' | 'priciest' | 'cold';

export const QUESTIONS: { id: QuestionId; label: string }[] = [
  { id: 'why', label: 'Pourquoi ce mois a-t-il coûté plus (ou moins) que l’an dernier ?' },
  { id: 'normal', label: 'Ce mois est-il normal ?' },
  { id: 'room', label: 'Quelle pièce a le plus augmenté ?' },
  { id: 'priciest', label: 'Quel a été le mois le plus cher de l’année écoulée ?' },
  { id: 'cold', label: 'Pourquoi cette pièce était froide ?' },
];

export interface QuestionInput {
  records: DayRecord[];
  weather: Weather | null;
  lastDay: string; // last day with data
  cost: ((from: string, to: string) => number | null) | null; // energy cost in €, null without prices
  roomName: (id: string) => string;
  // S-13.3, question « cold »: radiator probe temperatures, room states (undefined: not loaded yet,
  // null: no hourly snapshot) and the grouping of the bedrooms (S-13.5)
  temps?: Map<string, Map<string, [number, number | null]>>;
  roomState?: RoomState | null;
  groupOf?: (room: string) => string;
  drops?: Drops; // S-1.26: sharp falls of the half-hour temperature (raw rooms), when collected
}

/** ok = false: lines[0] says why the question cannot be answered. */
export interface Answer {
  ok: boolean;
  lines: string[];
}

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const kwh = (v: number) => `${nf0.format(v)} kWh`;
const eur = (v: number) => `${nf0.format(v)} €`;
const signedKwh = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf0.format(Math.abs(v))} kWh`;
const pct = (p: number) => {
  const r = Math.round(p);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${nf0.format(Math.abs(r))} %`;
};
const cannot = (why: string): Answer => ({ ok: false, lines: [`Je ne peux pas répondre : ${why}.`] });

export function monthLabel(month: string): string {
  return `${MONTHS_LONG[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

function monthEnd(month: string): string {
  const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return `${month}-${String(days).padStart(2, '0')}`;
}

function shiftMonth(month: string, n: number): string {
  const i = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** Months with consumption, most recent first (24 at most). */
export function answerableMonths(records: DayRecord[], lastDay: string): string[] {
  const set = new Set<string>();
  for (const r of records) if (r.kwh > 0 && r.day <= lastDay) set.add(r.day.slice(0, 7));
  return [...set].sort().reverse().slice(0, 24);
}

/** The month a question is about by default: the last complete one. */
export function defaultMonth(months: string[], lastDay: string): string | null {
  const complete = months.find((m) => monthEnd(m) <= lastDay);
  return complete ?? months[0] ?? null;
}

function sum(records: DayRecord[], from: string, to: string, cat?: string) {
  let s = 0;
  for (const r of records) if (r.day >= from && r.day <= to && (!cat || r.cat === cat)) s += r.kwh;
  return s;
}

export function answer(q: QuestionId, month: string, input: QuestionInput): Answer {
  const first = `${month}-01`;
  const fullEnd = monthEnd(month);
  if (first > input.lastDay) return cannot(`aucune donnée relevée en ${monthLabel(month)}`);
  const end = fullEnd < input.lastDay ? fullEnd : input.lastDay;
  const partial = end < fullEnd;
  const out = (() => {
    switch (q) {
      case 'why':
        return why(month, first, end, input);
      case 'normal':
        return normal(month, first, end, input);
      case 'room':
        return room(month, first, end, input);
      case 'priciest':
        return priciest(month, input);
      case 'cold':
        return cold(month, first, end, input);
    }
  })();
  if (out.ok && partial && q !== 'priciest') out.lines.push(`Mois en cours : la comparaison porte sur les jours déjà relevés (jusqu’au ${Number(end.slice(8))}).`);
  return out;
}

function why(month: string, first: string, end: string, { records, weather, cost, roomName }: QuestionInput): Answer {
  const prevLabel = monthLabel(shiftMonth(month, -12));
  const [pf, pe] = [minusYears(first), minusYears(end)];
  const now = sum(records, first, end);
  const before = sum(records, pf, pe);
  if (now <= 0) return cannot(`aucune consommation relevée en ${monthLabel(month)}`);
  if (before <= 0) return cannot(`pas de données pour ${prevLabel}, il faut un an d’historique pour comparer`);
  const lines: string[] = [];
  const c = cost?.(first, end) ?? null;
  const cb = cost?.(pf, pe) ?? null;
  const p = pctChange(now, before)!;
  if (c !== null && cb) {
    lines.push(`${capital(monthLabel(month))} a coûté environ ${eur(c)}, contre ${eur(cb)} en ${prevLabel} (${pct(pctChange(c, cb)!)}), pour ${kwh(now)} contre ${kwh(before)}.`);
  } else {
    lines.push(`${capital(monthLabel(month))} : ${kwh(now)}, contre ${kwh(before)} en ${prevLabel} (${pct(p)}). Sans prix renseigné, je compare en kWh.`);
  }
  const days = Math.round((Date.parse(end) - Date.parse(first)) / 86400000) + 1;
  const dNow = weather ? djuBetween(weather, first, end) : null;
  const dPrev = weather ? djuBetween(weather, pf, pe) : null;
  if (dNow && dPrev && dNow.days >= days * 0.8 && dPrev.days >= days * 0.8 && dPrev.dju > 0) {
    const climate = pctChange(dNow.dju, dPrev.dju)!;
    const r = Math.round(climate);
    lines.push(`Météo : ${nf0.format(dNow.dju)} degrés-jours contre ${nf0.format(dPrev.dju)} (${pct(climate)}) : il a fait ${r > 0 ? 'plus froid' : r < 0 ? 'plus doux' : 'aussi froid'}.`);
    const hNow = sum(records, first, end, 'heating');
    const hPrev = sum(records, pf, pe, 'heating');
    if (hPrev > 0 && dNow.dju > 5 && dPrev.dju > 5) {
      const usage = ((hNow / dNow.dju) / (hPrev / dPrev.dju) - 1) * 100;
      lines.push(`À climat égal, le chauffage par degré-jour a évolué de ${pct(usage)}.`);
      lines.push(Math.abs(climate) >= Math.abs(usage) ? 'L’écart vient surtout de la météo.' : 'L’écart vient surtout des usages (réglages, présence, aération).');
    } else {
      lines.push('Trop peu de chauffage pour séparer l’effet du froid de celui des usages.');
    }
  } else {
    lines.push('Météo incomplète pour ces deux mois : je ne peux pas séparer l’effet du froid de celui des usages.');
  }
  const top = [...roomDeltas(records, first, end)]
    .map(([id, d]) => ({ id, diff: d.now - d.before }))
    .filter((d) => Math.abs(d.diff) >= 1)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 2);
  if (top.length) lines.push(`Plus fortes variations : ${top.map((d) => `${roomName(d.id)} (${signedKwh(d.diff)})`).join(', ')}.`);
  return { ok: true, lines };
}

function normal(month: string, first: string, end: string, { records, weather }: QuestionInput): Answer {
  const v = verdict(records, first, end, weather);
  if (!v) return cannot(`il n’y a ni consommation en ${monthLabel(month)}, ni le même mois une année précédente pour comparer`);
  const lines = [
    `${capital(monthLabel(month))} : ${kwh(v.actual)}, pour ${kwh(v.expected)} attendus ${v.climate ? 'à climat égal (degrés-jours des années précédentes)' : 'd’après les années précédentes (sans correction météo)'}, soit ${pct(v.pct)}.`,
    v.level === 'normal'
      ? 'C’est normal : moins de 10 % d’écart.'
      : v.level === 'high'
        ? 'C’est plus que d’habitude : plus de 10 % au-dessus de l’attendu.'
        : 'C’est moins que d’habitude : plus de 10 % en dessous de l’attendu.',
  ];
  return { ok: true, lines };
}

function room(month: string, first: string, end: string, { records, roomName }: QuestionInput): Answer {
  const prevLabel = monthLabel(shiftMonth(month, -12));
  const list = [...roomDeltas(records, first, end)].filter(([, d]) => d.before > 0).map(([id, d]) => ({ id, ...d, diff: d.now - d.before }));
  if (!list.length) return cannot(`aucune pièce n’a de consommation en ${prevLabel} pour comparer`);
  list.sort((a, b) => b.diff - a.diff);
  const up = list[0];
  if (up.diff <= 0) {
    const down = list[list.length - 1];
    return {
      ok: true,
      lines: [
        `Aucune pièce n’a augmenté par rapport à ${prevLabel}.`,
        `La plus forte baisse : ${roomName(down.id)}, ${signedKwh(down.diff)} (${pct(pctChange(down.now, down.before)!)}).`,
      ],
    };
  }
  const lines = [`La pièce qui a le plus augmenté : ${roomName(up.id)}, ${signedKwh(up.diff)} (${pct(pctChange(up.now, up.before)!)}) : ${kwh(up.now)} contre ${kwh(up.before)} en ${prevLabel}.`];
  if (list[1] && list[1].diff > 0) lines.push(`Ensuite : ${roomName(list[1].id)}, ${signedKwh(list[1].diff)}.`);
  lines.push('Une hausse peut venir du froid : la question « pourquoi » sépare la météo des usages.');
  return { ok: true, lines };
}

function priciest(month: string, { records, cost, lastDay }: QuestionInput): Answer {
  const rows: { m: string; kwh: number; eur: number | null }[] = [];
  for (let i = 11; i >= 0; i--) {
    const m = shiftMonth(month, -i);
    const from = `${m}-01`;
    if (from > lastDay) continue;
    const to = monthEnd(m) < lastDay ? monthEnd(m) : lastDay;
    const k = sum(records, from, to);
    if (k > 0) rows.push({ m, kwh: k, eur: cost?.(from, to) ?? null });
  }
  if (rows.length < 2) return cannot('il faut au moins deux mois de données pour les classer');
  const withEur = rows.every((r) => r.eur !== null);
  const val = (r: (typeof rows)[number]) => (withEur ? r.eur! : r.kwh);
  const sorted = rows.slice().sort((a, b) => val(b) - val(a));
  const fmt = (r: (typeof rows)[number]) => (withEur ? `environ ${eur(r.eur!)} (${kwh(r.kwh)})` : kwh(r.kwh));
  const top = sorted[0];
  const low = sorted[sorted.length - 1];
  const lines = [
    `Sur les ${rows.length} mois jusqu’à ${monthLabel(month)}, le plus ${withEur ? 'cher' : 'consommateur'} est ${monthLabel(top.m)} : ${fmt(top)}.`,
    `Le moins ${withEur ? 'cher' : 'consommateur'} : ${monthLabel(low.m)}, ${fmt(low)}.`,
  ];
  const rank = sorted.findIndex((r) => r.m === month);
  if (rank > 0) lines.push(`${capital(monthLabel(month))} arrive en position ${rank + 1} sur ${rows.length}.`);
  if (!withEur) lines.push('Sans prix renseigné, je classe les mois en kWh.');
  if (rows.some((r) => r.m === lastDay.slice(0, 7) && monthEnd(r.m) > lastDay)) lines.push('Le mois en cours n’est compté que jusqu’au dernier jour relevé.');
  return { ok: true, lines };
}

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const days = (n: number) => `${n} jour${n > 1 ? 's' : ''}`;

/**
 * S-13.3: cold days of the month and what explains them (open window first). `temps` are the raw
 * rooms (#241): calendar days are counted, a group of bedrooms is cold on a day when one of them is.
 */
function cold(month: string, first: string, end: string, { temps, roomState, groupOf, roomName, drops }: QuestionInput): Answer {
  if (!roomState) return cannot('il faut le relevé horaire de l’état des pièces (fenêtres ouvertes), qui n’est pas activé');
  const cov = coverage(roomState, first, end);
  if (!cov.days) return cannot(`aucun relevé de l’état des pièces en ${monthLabel(month)}`);
  const reasons = [...coldReasons(temps ?? new Map(), roomState, first, end, groupOf, 19, 1, drops)].sort((a, b) => b[1].cold - a[1].cold);
  const coldDays = new Set<string>();
  for (const t of (temps ?? new Map<string, Map<string, [number, number | null]>>()).values()) {
    for (const [d, [mean]] of t) if (d >= first && d <= end && mean < 19) coldDays.add(d);
  }
  const total = coldDays.size;
  const lines: string[] = [];
  if (!total) {
    lines.push(`En ${monthLabel(month)}, aucune pièce n’est descendue sous 19 °C en moyenne sur une journée (sonde des radiateurs).`);
  } else {
    lines.push(`En ${monthLabel(month)}, ${days(total)} avec au moins une pièce sous 19 °C en moyenne (sonde des radiateurs).`);
    for (const [id, r] of reasons.slice(0, 4)) {
      const parts = [
        r.window
          ? `${r.window} avec une fenêtre ouverte (${nf1.format(r.openHours)} h au total${r.drop ? `, dont ${days(r.drop)} vu${r.drop > 1 ? 's' : ''} seulement par une chute de température au pas de 30 min` : ''})`
          : '',
        r.away ? `${r.away} en mode absence ou hors-gel` : '',
        r.lowSetpoint ? `${r.lowSetpoint} avec une consigne sous 19 °C` : '',
        r.unexplained ? `${r.unexplained} sans explication relevée` : '',
        r.noData ? `${r.noData} sans relevé` : '',
      ].filter(Boolean);
      lines.push(`${roomName(id)} : ${days(r.cold)}, dont ${parts.join(', ')}.`);
    }
    const sum = (k: 'window' | 'away' | 'lowSetpoint' | 'unexplained') => reasons.reduce((s, [, r]) => s + r[k], 0);
    const top = (['window', 'away', 'lowSetpoint', 'unexplained'] as const).reduce((a, b) => (sum(b) > sum(a) ? b : a));
    lines.push(
      {
        window: 'Le plus souvent, une fenêtre était ouverte : c’est l’aération, pas un défaut de chauffage.',
        away: 'Le plus souvent, la maison était en mode absence : le froid était voulu.',
        lowSetpoint: 'Le plus souvent, la consigne elle-même était sous 19 °C : c’est un réglage, pas une panne.',
        unexplained: 'Le plus souvent, ni fenêtre ouverte, ni mode absence, ni consigne basse : vérifiez le radiateur (puissance, sonde mal placée) ou l’isolation de la pièce.',
      }[top],
    );
  }
  lines.push(`« Fenêtre ouverte » est la détection du radiateur (chute rapide de température) ; relevés reçus : ${nf0.format((cov.hours / cov.expected) * 100)} % des heures du mois.`);
  return { ok: true, lines };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
