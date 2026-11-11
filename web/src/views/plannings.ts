// S-4.13 (#211): Outils → « Mes plannings et les heures creuses » (lazy module). For each heated
// room, over the last four weeks of half hours: the share of the heating in off-peak hours, how
// far and how fast the room really warms after each comfort start of its schedule, the warm-up
// hours that served (requested temperature reached) or not, and one figured suggestion. Read-only:
// the app never changes a schedule. The computations are in plannings.ts; days of absence (S-13.7)
// are left out (the schedule did not run). Household view: a group of bedrooms shows its share
// only (one schedule per bedroom, not named).
import { addDays } from '../aggregate';
import { activeRooms, ds } from '../app';
import { homeAwayHours } from '../away';
import { alert, card, legend, list, scheduleBand, tile, countedText } from '../components';
import { loadRoom30, loadRoomState } from '../data';
import { dayShort, fmt1, hourMin, hourRange } from '../glossary';
import { type HcPeriod, periodsFromR30, periodsText, rangesOn, rangesText, slotMask, toHours } from '../offpeak';
import { scheduleOf } from '../piece';
import {
  LATE_SLOTS,
  REACHED_TOL,
  RISE_MIN,
  type RiseGroup,
  type Shift,
  ecoRate,
  energySplit,
  groupRises,
  rises,
  suggestShift,
  verdict,
} from '../plannings';
import { type Room30, unpack } from '../room30';
import { html } from '../trusted';
import { esc, fmtEur, fmtKwh, hcHpAt, nf0 } from '../ui';
import '../plannings.css';

const DAYS = 28;
const at = (slot: number) => hourMin(Math.floor(slot / 2), (slot % 2) * 30);
const dur = (slots: number) => {
  const m = Math.round(slots * 30);
  return m < 60 ? `${m} min` : hourMin(Math.floor(m / 60), m % 60);
};
const pct = (v: number) => `${nf0.format(Math.round(v * 100))} %`;
const range = (lo: number, hi: number) => (hi < 1 ? 'moins de 1 €' : `${lo < 1 ? 'moins de 1' : nf0.format(Math.floor(lo))} à ${fmtEur(Math.ceil(hi))}`);

/** Raw room ids behind a room shown (the bedrooms of « Chambres » in household view). */
function members(id: string): string[] {
  const m = ds!.roomMap;
  if (!m?.size) return [id];
  const raw = [...m].filter(([, g]) => g === id).map(([r]) => r);
  return raw.length ? raw : [id];
}

/** Last day with half hours, any room. */
function lastDay30(r30: Room30): string | null {
  let last: string | null = null;
  for (const days of r30.values()) for (const d of days.keys()) if (!last || d > last) last = d;
  return last;
}

interface RoomResult {
  id: string;
  name: string;
  group: boolean;
  hp: number;
  hc: number;
  groups: { g: RiseGroup; shift: Shift | null }[];
  useful: number; // half hours of warm-up that reached the requested temperature
  wasted: number; // half hours of warm-up that never did
  band: string;
}

export async function mountPlannings(zone: HTMLElement | null) {
  const d = ds!;
  const years = d.meta.room30_years ?? [];
  if (!zone) return;
  if (!years.length || !d.meta.last_day) {
    zone.removeAttribute('aria-busy');
    zone.innerHTML = html(
      card({ title: 'Mes plannings et les heures creuses', body: '<p class="hint">Il faut les relevés à la demi-heure des radiateurs : ils arrivent avec les prochaines collectes (quelques nuits pour tout l’historique).</p>' }),
    );
    return;
  }
  const [r30, rs] = await Promise.all([loadRoom30(d, addDays(d.meta.last_day, -DAYS - 14)), d.meta.has_roomstate ? loadRoomState(d).catch(() => null) : Promise.resolve(null)]);
  if (ds !== d || !zone.isConnected) return;
  zone.removeAttribute('aria-busy');
  zone.innerHTML = html(render(r30, rs ? homeAwayHours(rs) : new Map()));
}

function render(r30: Room30, away: Map<string, number>): string {
  const to = lastDay30(r30);
  if (!to) return card({ title: 'Mes plannings et les heures creuses', body: '<p class="hint">Pas encore de relevé à la demi-heure.</p>' });
  const from = addDays(to, -(DAYS - 1));
  const skip = new Set([...away].filter(([day, h]) => h >= 12 && day >= from && day <= to).map(([day]) => day));
  // #428: the off-peak hours read in the half hours, shared with the simulators (offpeak.ts);
  // #441: dated, the suggestions take those in force on the last day, each band those of its day
  const periods = periodsFromR30(r30, from, to) ?? [];
  const off = rangesOn(periods, to);
  const mask = off.length ? slotMask(off) : null;
  const p = hcHpAt(to);
  const prices = mask && p && p.hp > p.hc ? { hp: p.hp, hc: p.hc } : null;
  const rooms = activeRooms().filter((r) => r.category === 'heating');
  const results: RoomResult[] = [];
  for (const r of rooms) {
    const ids = members(r.id).filter((x) => r30.has(x));
    if (!ids.length) continue;
    const split = energySplit(r30, ids, from, to, skip);
    if (!split.days) continue;
    const group = ids.length > 1;
    const res: RoomResult = { id: r.id, name: r.name, group, hp: split.hp, hc: split.hc, groups: [], useful: 0, wasted: 0, band: '' };
    if (!group) {
      const list = rises(r30, ids[0], from, to, skip);
      const eco = ecoRate(r30, ids[0], from, to, skip);
      res.groups = groupRises(list)
        .slice(0, 3)
        .map((g) => ({ g, shift: prices ? suggestShift(g, mask, eco, prices, (g.n / split.days) * 30) : null }));
      for (const x of list) {
        if (x.reached !== null) res.useful += x.reached;
        else res.wasted += x.span;
      }
      res.band = band(r30, ids[0], from, to, skip, periods, r.name);
    }
    results.push(res);
  }
  const hp = results.reduce((s, r) => s + r.hp, 0);
  const hc = results.reduce((s, r) => s + r.hc, 0);
  const shifts = results.flatMap((r) => r.groups.map((x) => x.shift).filter((s): s is Shift => !!s));
  const low = shifts.reduce((s, x) => s + x.low, 0);
  const high = shifts.reduce((s, x) => s + x.high, 0);
  const counted = countedText(`4 semaines, du ${dayShort(from)} au ${dayShort(to, true)}, relevés à la demi-heure des radiateurs${skip.size ? ` (${skip.size} jour${skip.size > 1 ? 's' : ''} d'absence mis de côté)` : ''}`);

  const head = card({
    id: 'plannings-summary',
    title: 'Chauffage et heures creuses',
    sub: counted,
    body: `${
      mask
        ? `<div class="kpis">${tile({ label: 'En heures creuses', value: hp + hc > 0 ? pct(hc / (hp + hc)) : '—', sub: `<small class="muted">${esc(fmtKwh(hc))} sur ${esc(fmtKwh(hp + hc))}</small>` })}${tile({
            label: 'Gain possible',
            value: shifts.length ? range(low, high) : '0 €',
            sub: `<small class="muted">${shifts.length ? 'par mois de chauffe, en décalant des relances' : 'les relances sont déjà bien placées'}</small>`,
          })}</div>`
        : alert('info', 'Pas d’heures creuses sur cette période', 'Tout le chauffage est payé au même prix : seul le gain réel de température est analysé ci-dessous.')
    }${periods.length > 1 ? `<p class="hint muted" id="plannings-hc-periods">Vos heures creuses ont changé : ${esc(periodsText(periods))}.</p>` : ''}
    ${list(
      results.map((r) => {
        const s = r.groups.map((x) => x.shift).filter((x): x is Shift => !!x);
        const gain = s.length ? ` · gain possible ${range(s.reduce((a, x) => a + x.low, 0), s.reduce((a, x) => a + x.high, 0))} par mois` : '';
        return {
          title: r.name,
          sub: r.hp + r.hc > 0 ? `${mask ? `${pct(r.hc / (r.hp + r.hc))} en heures creuses · ` : ''}${fmtKwh(r.hp + r.hc)}${gain}` : 'pas de chauffage',
          share: r.hp + r.hc > 0 && mask ? (r.hc / (r.hp + r.hc)) * 100 : undefined,
          color: '--usage-heating',
        };
      }),
      'Pièces : part du chauffage en heures creuses',
    )}
    ${alert('info', 'Lecture seule', 'L’application ne modifie jamais les plannings de vos radiateurs : appliquez vous-même une suggestion dans l’application des radiateurs, puis revenez dans quelques semaines pour en voir l’effet ici.')}`,
  });
  return `${head}${results.map((r) => roomCard(r, !!mask)).join('')}${method(!!mask, prices)}`;
}

/** The schedule of the most recent day with one, over the off-peak hours. */
function band(r30: Room30, id: string, from: string, to: string, skip: Set<string>, periods: HcPeriod[], name: string): string {
  const days = [...(r30.get(id) ?? new Map()).keys()].filter((d) => d >= from && d <= to && !skip.has(d)).sort().reverse();
  for (const day of days) {
    const sched = scheduleOf(unpack(r30.get(id)!.get(day)![3]));
    if (!sched) continue;
    const off = rangesOn(periods, day); // #441: the ranges in force that day
    const comfort = sched.slots.filter((s) => s.kind === 'comfort').map((s) => hourRange(s.from, s.to));
    return `${scheduleBand({
      slots: sched.slots,
      offPeak: toHours(off),
      label: `${name}, planning du ${dayShort(day)} : confort (${fmt1(sched.comfort)} °C) ${comfort.join(', ')}, économie (${fmt1(sched.eco)} °C) le reste du temps${off.length ? ` ; heures creuses ${rangesText(off)}` : ''}`,
    })}${legend([
      { label: `Confort ${fmt1(sched.comfort)} °C`, color: '--usage-heating' },
      { label: `Économie ${fmt1(sched.eco)} °C`, color: '--usage-other' },
      ...(off.length ? [{ label: 'Heures creuses', color: '--accent-text', kind: 'hatch' as const }] : []),
    ])}<p class="hint muted">Planning du ${esc(dayShort(day))}, lu dans les températures demandées.</p>`;
  }
  return '';
}

function line(g: RiseGroup, offPeak: boolean): string {
  const reached = `${g.reached === g.n ? 'atteinte à chaque fois' : `atteinte ${g.reached} fois sur ${g.n}`}`;
  const delay = g.delay !== null ? `, en ${dur(g.delay)} en moyenne` : '';
  const gain = g.gain !== null ? ` (${g.gain >= 0 ? '+' : ''}${fmt1(g.gain)} °C)` : '';
  const energy = `${fmtKwh(g.kwh)} par montée${offPeak ? `, dont ${pct(g.hpShare)} en heures pleines` : ''}`;
  return `<b>${esc(at(g.slot))} → ${esc(fmt1(g.target))} °C</b> : ${reached}${delay}${gain} · ${esc(energy)}`;
}

function advice(g: RiseGroup, shift: Shift | null): { kind: 'good' | 'warn' | 'info'; text: string } {
  const t = `${fmt1(g.target)} °C`;
  switch (verdict(g, shift)) {
    case 'shift':
      return {
        kind: 'info',
        text: `Avancer la relance de ${at(shift!.from)} à ${at(shift!.to)} : la montée (≈ ${dur(g.delay!)}) se ferait en heures creuses et la pièce serait à ${t} dès ${at(shift!.from - shift!.gap)}, ${dur(shift!.gap)} plus tôt qu'aujourd'hui. Gain estimé : ${range(shift!.low, shift!.high)} par mois de chauffe.`,
      };
    case 'unreached':
      return {
        kind: 'warn',
        text: `${t} n'est atteint que ${g.reached} fois sur ${g.n}${g.missing !== null ? ` (il manque ${fmt1(g.missing)} °C en moyenne)` : ''} : cette relance chauffe sans donner le confort demandé. Baisser cette consigne ou avancer le créneau ; une fenêtre ouverte ou un radiateur trop juste peuvent aussi l'expliquer.`,
      };
    case 'late':
      return { kind: 'warn', text: `La pièce n'est à ${t} qu'après ${dur(g.delay!)} : pour avoir le confort dès ${at(g.slot)}, avancer le début du créneau d'environ ${dur(g.delay!)}.` };
    case 'warm':
      return { kind: 'info', text: `La pièce est déjà à ${t} au début du créneau ${g.warm} fois sur ${g.n} : l'abaissement d'avant est trop faible pour rapporter, ou ce créneau pourrait commencer plus tard.` };
    default:
      return { kind: 'good', text: `Rien à changer : la pièce atteint ${t} ${g.delay !== null ? `en ${dur(g.delay)} en moyenne` : 'à temps'}.` };
  }
}

function roomCard(r: RoomResult, offPeak: boolean): string {
  if (r.group) {
    return card({
      title: r.name,
      sub: `${fmtKwh(r.hp + r.hc)}${offPeak && r.hp + r.hc > 0 ? ` · ${pct(r.hc / (r.hp + r.hc))} en heures creuses` : ''}`,
      body: '<p class="hint muted">Vue foyer : les chambres sont regroupées, leurs plannings ne sont pas détaillés.</p>',
    });
  }
  const body = r.groups.length
    ? `<ul class="plan-rises">${r.groups
        .map(({ g, shift }) => {
          const a = advice(g, shift);
          return `<li><p>${line(g, offPeak)}</p>${alert(a.kind, a.kind === 'good' ? 'Bien réglé' : a.kind === 'warn' ? 'À revoir' : 'Suggestion', a.text)}</li>`;
        })
        .join('')}</ul>
      <p class="hint">Montée en température : <strong>${dur(r.useful)} utiles</strong> (consigne atteinte)${r.wasted ? `, <strong>${dur(r.wasted)} sans atteindre la consigne</strong>` : ', aucune heure perdue'} sur les 4 semaines.</p>`
    : '<p class="hint">Pas de relance régulière repérée (consigne constante, ou moins de 3 relances à la même heure).</p>';
  return `<section class="card plan-room" id="plan-${esc(r.id)}" aria-labelledby="plan-${esc(r.id)}-title">
    <div class="card-head"><h2 id="plan-${esc(r.id)}-title">${esc(r.name)}</h2></div>
    <p class="card-sub">${esc(fmtKwh(r.hp + r.hc))}${offPeak && r.hp + r.hc > 0 ? ` · ${esc(pct(r.hc / (r.hp + r.hc)))} en heures creuses` : ''}</p>
    ${r.band}${body}
  </section>`;
}

function method(offPeak: boolean, prices: { hp: number; hc: number } | null): string {
  const fmtP = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
  return `<section class="card"><details class="table-details"><summary>Comment c’est calculé</summary>
    <p class="hint">Une <strong>relance</strong> est une hausse d'au moins ${RISE_MIN} °C de la température demandée au radiateur (le début d'un créneau confort du planning), lue demi-heure par demi-heure ; les relances à la même heure sur au moins 3 jours sont regroupées. La pièce est <strong>à température</strong> quand la sonde du radiateur atteint la consigne à ${fmt1(REACHED_TOL)} °C près ; elle est suivie jusqu'à la fin du créneau (6 h au plus). Les kWh d'une montée sont ceux de la pièce entre la relance et ce moment ; une relance qui n'atteint jamais la consigne compte comme des heures « sans atteindre la consigne ». Une montée de plus de ${dur(LATE_SLOTS)} est dite tardive.</p>
    ${
      offPeak
        ? `<p class="hint">Les <strong>heures creuses</strong> sont lues dans les relevés eux-mêmes (là où le compteur range l'énergie). La <strong>suggestion</strong> avance la relance pour que la montée se termine à la fin des heures creuses : ses kWh passent au prix heures creuses${prices ? ` (${fmtP(prices.hc)} €/kWh au lieu de ${fmtP(prices.hp)} €/kWh)` : ''}, mais la pièce est ensuite tenue au confort plus longtemps, en heures pleines. La fourchette prend 70 à 100 % de la montée déplacée et 70 à 130 % de ce maintien supplémentaire (écart entre le maintien au confort et l'économie, mesuré dans la pièce) ; elle est ramenée à un mois de chauffe de 30 jours.</p>`
        : ''
    }
    <p class="hint muted">Les jours d'absence (mode absent des radiateurs au moins 12 h) sont mis de côté. Les couleurs Tempo ne sont pas encore prises en compte. Rien n'est envoyé : tout est calculé sur cet appareil, et l'application ne modifie jamais les radiateurs.</p>
  </details></section>`;
}
