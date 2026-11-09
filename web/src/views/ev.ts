// S-2.14: "Et avec une voiture électrique ?" — charging simulation in Comparer (lazy module).
// Cost per offer (Base, HP/HC, Tempo) with and without the charge over the last 12 months, and,
// with the Linky 30-min curve, the half hours where the subscribed power would be exceeded.
import { addDays, minusYears } from '../aggregate';
import { KVA_STEPS, compareOffers, daySplits, offPeakShares } from '../analysis';
import { ds, onDatasetLoaded, state } from '../app';
import { type Curve, lastCurveDay } from '../curve';
import { loadCurve } from '../data';
import { type EvInput, HC_END, HC_START, addCharge, chargePeaks, evPlan, kmPerYear } from '../ev';
import { periodAt } from '../offers';
import { tenant } from '../tenant';
import { contracts, fmtEur, lastDay, longDate, nf0, offCol, table } from '../ui';
import { html } from '../trusted';
import '../simulators.css';

const LS = 'intuis-history:ev';
const POWERS: [number, string][] = [
  [2.3, '2,3 kW (prise domestique)'],
  [3.7, '3,7 kW (prise renforcée)'],
  [7.4, '7,4 kW (borne)'],
  [11, '11 kW (borne triphasée)'],
];
const REF_KWH_100 = 17; // kWh/100 km of a typical compact car, for the distance hint only

function load(): EvInput {
  const def: EvInput = { kwhWeek: 40, powerKw: 7.4, startHour: 22 };
  try {
    const o = JSON.parse(localStorage.getItem(LS) ?? '{}') as Partial<EvInput>;
    return {
      kwhWeek: Number(o.kwhWeek) > 0 && Number(o.kwhWeek) <= 500 ? Number(o.kwhWeek) : def.kwhWeek,
      powerKw: POWERS.some(([p]) => p === o.powerKw) ? o.powerKw! : def.powerKw,
      startHour: Number.isInteger(o.startHour) && o.startHour! >= 0 && o.startHour! < 24 ? o.startHour! : def.startHour,
    };
  } catch {
    return def;
  }
}
function save(v: EvInput) {
  try {
    localStorage.setItem(LS, JSON.stringify(v));
  } catch {
    /* kept for this visit */
  }
}

let curve: Curve | null = null;
let curveLoading: Promise<Curve> | null = null;
onDatasetLoaded(() => {
  curve = null;
  curveLoading = null;
});

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const kw = (w: number) => `${nf1.format(w / 1000)} kW`;
const hh = (h: number) => `${String(h % 24).padStart(2, '0')} h`;
const duration = (hours: number) => {
  const m = Math.round(hours * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};
const kvaAt = (day: string) => state.simKva ?? periodAt(contracts(), day)?.kva ?? 9;

/** Entry point: appends the card to the Compare view (once), when the offers can be priced. */
export function mountEv(view: HTMLElement) {
  if (!ds || !view.isConnected || tenant().on || document.getElementById('ev-card')) return;
  if (!ds.offers.size || !ds.tempo.rows.length) return;
  const input = load();
  const hasCurve = !!((ds.meta as { linky_curve_years?: number[] }).linky_curve_years ?? []).length;
  view.insertAdjacentHTML(
    'beforeend',
    html`<section class="card" id="ev-card">
    <div class="card-head"><h2>Et avec une voiture électrique ? <small class="muted">simulation de recharge, 12 derniers mois</small></h2></div>
    <p class="hint muted">Ajoutez une recharge quotidienne à votre consommation réelle : coût par offre avec et sans voiture${hasCurve ? ', et demi-heures où le compteur dépasserait la puissance souscrite' : ''}.</p>
    <div class="sim-form">
      <label>Énergie rechargée par semaine (kWh)<input id="ev-kwh" type="number" inputmode="numeric" min="1" max="500" step="1" value="${input.kwhWeek}"></label>
      <label>Début de la recharge<select id="ev-start">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === input.startHour ? 'selected' : ''}>${hh(h)}</option>`).join('')}</select></label>
      <label>Puissance de charge<select id="ev-power">${POWERS.map(([p, l]) => `<option value="${p}" ${p === input.powerKw ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div id="ev-result" class="sim-result" aria-live="polite"></div>
    <div id="ev-peak" class="sim-result"></div>
    <details class="table-details"><summary>Comment c'est calculé</summary>
      <p class="hint">Chaque jour, la voiture se recharge de l'énergie de la semaine divisée par 7, à puissance constante, à partir de l'heure choisie (au-delà de minuit si besoin). Les heures creuses sont supposées de ${HC_START} h à ${HC_END} h (celles de Tempo ; celles de votre compteur, sur votre facture, peuvent différer). Cette énergie est ajoutée aux heures creuses ou pleines de chaque jour des 12 derniers mois, puis les trois offres sont recalculées comme le comparateur ci-dessus : tarifs réglementés en vigueur chaque jour (CRE), abonnement compris, couleur Tempo réelle du jour où la recharge commence, puissance de votre contrat (ou celle simulée ci-dessus).</p>
      <p class="hint">Dépassements : à chaque demi-heure de la courbe de charge Linky, on ajoute la puissance de la recharge et on compare à la puissance souscrite (kVA assimilés à des kW). La courbe est une moyenne sur 30 minutes : un appel bref plus fort n'y apparaît pas, la marge réelle est donc plus faible.</p>
      <p class="hint muted">Hypothèses : recharge tous les jours à la même heure, pertes de charge comprises dans l'énergie saisie (environ 10 %), aucun changement d'habitude les jours rouges Tempo, pas d'offre spéciale véhicule électrique (heures super creuses). La conversion en kilomètres suppose ${REF_KWH_100} kWh/100 km.</p>
    </details>
  </section>`,
  );
  const card = document.getElementById('ev-card')!;
  const kwhEl = card.querySelector<HTMLInputElement>('#ev-kwh')!;
  const startEl = card.querySelector<HTMLSelectElement>('#ev-start')!;
  const powerEl = card.querySelector<HTMLSelectElement>('#ev-power')!;

  // Same day splits as the comparator, over the last 12 months.
  const d = ds;
  const last = lastDay();
  const from = addDays(minusYears(last), 1);
  const off = offCol();
  const splits = daySplits(d.records, d.tariffs, off, offPeakShares(d.tariffs, off), d.linky.size ? d.linky : null).filter(
    (s) => s.day >= from && s.day <= last,
  );
  const base = d.offers.get('edf-trv-base') ?? [];
  const hphc = d.offers.get('edf-trv-hphc') ?? [];
  const without = compareOffers(splits, kvaAt, base, hphc, d.tempo.rows, d.tempo.days);

  const read = (): EvInput => ({ kwhWeek: Number(kwhEl.value.replace(',', '.')), powerKw: Number(powerEl.value), startHour: Number(startEl.value) });
  const show = () => {
    const v = read();
    const plan = evPlan(v);
    const zone = card.querySelector<HTMLElement>('#ev-result')!;
    const peakZone = card.querySelector<HTMLElement>('#ev-peak')!;
    if (!plan || v.kwhWeek > 500) {
      zone.innerHTML = html('<p class="hint">Saisissez une énergie entre 1 et 500 kWh par semaine : à cette puissance, la recharge doit tenir en moins de 48 h.</p>');
      peakZone.innerHTML = html('');
      return;
    }
    save(v);
    const withEv = compareOffers(addCharge(splits, plan), kvaAt, base, hphc, d.tempo.rows, d.tempo.days);
    const keys = ['base', 'hphc', 'tempo'] as const;
    const names = { base: 'Base', hphc: 'Heures creuses', tempo: 'Tempo' };
    const tot = (r: typeof without, k: (typeof keys)[number]) => r[k].energy + r[k].subscription;
    const best = (r: typeof without) => keys.reduce((a, b) => (tot(r, b) < tot(r, a) ? b : a));
    const bWith = best(withEv);
    const bWithout = best(without);
    const days = withEv.hphc.days;
    if (!days) {
      zone.innerHTML = html('<p class="hint muted">Pas assez de jours chiffrables sur les 12 derniers mois (tarifs ou couleurs Tempo manquants).</p>');
      return;
    }
    const endMin = Math.round((v.startHour + plan.hours) * 60) % 1440;
    const hcPct = (plan.hc / plan.kwhDay) * 100;
    const evKwh = plan.kwhDay * days;
    const bestCost = tot(withEv, bWith) - tot(without, bWith);
    zone.innerHTML = html`<p class="hint">≈ <strong>${nf0.format(kmPerYear(v.kwhWeek, REF_KWH_100))} km par an</strong> pour une voiture à ${REF_KWH_100} kWh/100 km. Chaque jour : ${nf1.format(plan.kwhDay)} kWh en ${duration(plan.hours)}, de ${hh(v.startHour)} à ${hh(Math.floor(endMin / 60))} ${String(endMin % 60).padStart(2, '0')}, dont <strong>${nf0.format(hcPct)} %</strong> en heures creuses.</p>
    <div class="verdict">
      <span class="verdict-icon" aria-hidden="true">${bWith === bWithout ? '=' : '⇄'}</span>
      <div><p class="verdict-title">Avec la voiture, l'offre la moins chère serait ${names[bWith]}</p>
      <p class="verdict-sub">${
        bWith === bWithout ? 'Comme sans voiture.' : `Sans voiture, c'est ${names[bWithout]}.`
      } La recharge y coûterait ${fmtEur(bestCost)} sur ${days} jours (${nf0.format(evKwh)} kWh), soit ${nf1.format(((bestCost / evKwh) * REF_KWH_100) / 0.9)} € pour 100 km.</p></div>
    </div>
    ${table(
      ['Offre (12 mois)', 'Sans voiture', 'Avec', 'Recharge'],
      keys.map((k) => [
        `${names[k]}${k === bWith ? ' <span class="badge">moins chère</span>' : ''}`,
        fmtEur(tot(without, k)),
        fmtEur(tot(withEv, k)),
        `+${fmtEur(tot(withEv, k) - tot(without, k))}`,
      ]),
    )}
    <p class="hint muted">Abonnement compris, ${days} jours chiffrés entre le ${longDate(splits[0]?.day ?? from)} et le ${longDate(last)}, ${
      d.linky.size ? 'tout le logement (Linky)' : 'radiateurs et chauffe-eau seulement (sans Linky, « sans voiture » ne couvre pas tout le logement ; la différence reste juste)'
    }.</p>`;
    drawPeaks(peakZone, plan, hasCurve);
  };
  kwhEl.addEventListener('input', show);
  startEl.addEventListener('change', show);
  powerEl.addEventListener('change', show);
  show();
}

function drawPeaks(zone: HTMLElement, plan: NonNullable<ReturnType<typeof evPlan>>, hasCurve: boolean) {
  if (!ds) return;
  if (!hasCurve) {
    zone.innerHTML = html('<p class="hint muted">Dépassements de la puissance souscrite : disponibles avec la courbe de charge Linky (30 min), à activer dans votre espace Enedis.</p>');
    return;
  }
  if (!curve) {
    zone.innerHTML = html('<p class="hint muted">Chargement de la courbe de charge…</p>');
    const d = ds;
    curveLoading ??= loadCurve(d);
    curveLoading
      .then((c) => {
        if (ds !== d) return;
        curve = c;
        if (zone.isConnected) drawPeaks(zone, plan, hasCurve);
      })
      .catch(() => {
        curveLoading = null;
        if (zone.isConnected) zone.innerHTML = html('<p class="hint muted">Courbe de charge indisponible hors ligne.</p>');
      });
    return;
  }
  const end = lastCurveDay(curve);
  if (!end) {
    zone.innerHTML = html('<p class="hint muted">La courbe de charge Linky ne contient encore aucune mesure.</p>');
    return;
  }
  const from = addDays(minusYears(end), 1);
  const r = chargePeaks(curve, ds.meta.home.timezone, from, end, plan, kvaAt);
  const kva = kvaAt(end);
  const need = KVA_STEPS.find((k) => k * 1000 >= r.maxW) ?? 36;
  const when = r.maxKey ? ` le ${longDate(r.maxKey.slice(0, 10))} à ${r.maxKey.slice(11, 16)}` : '';
  zone.innerHTML = html`<h3>Le compteur tiendrait-il ?</h3>${
    r.slots
      ? `<p class="stale" role="status"><span aria-hidden="true">⚠️</span> Sur ${nf0.format(r.covered / 48)} jours de courbe de charge, <strong>${nf0.format(r.slots)} demi-heure${r.slots > 1 ? 's' : ''}</strong> (${r.days} jour${r.days > 1 ? 's' : ''}) dépasseraient la puissance souscrite (${kva} kVA aujourd'hui) avec la recharge, contre ${nf0.format(r.slotsBefore)} sans. Il faudrait au moins <strong>${need} kVA</strong>, ou une recharge plus lente ou plus tardive.</p>`
      : `<p class="hint"><strong>Aucune demi-heure</strong> au-dessus de la puissance souscrite (${kva} kVA aujourd'hui) sur ${nf0.format(r.covered / 48)} jours de courbe de charge, recharge comprise.</p>`
  }
  <p class="hint muted">Demi-heure la plus chargée avec la recharge : ${kw(r.maxW)}${when} (sans la voiture, le maximum était ${kw(r.maxBeforeW)}).</p>`;
}
