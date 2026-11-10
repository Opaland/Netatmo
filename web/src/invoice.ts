// S-2.3: reconcile the cost computed by the app with a real invoice. Pure functions (no DOM,
// no app state): the view (views/invoice.ts) passes the Linky days, the heating and
// water-heater kWh, the regulated price of each day and the off-peak share.
//
// The app prices the meter (Linky) consumption of the invoice period with the regulated
// tariff of the contract (TTC: VAT, excise and CTA included in the CRE prices), adds the
// subscription prorated per day, then splits the gap with the invoice into what it can
// name: kWh billed vs kWh metered (estimated reading, shifted reading dates), meter days
// missing, and a residual (taxes rounded by the supplier, subscription billed in advance
// by month, another price than the regulated one). Heating and water heater are only a
// part of the invoice: their share is given apart.
import { addDays } from './aggregate';
import type { PriceAt } from './analysis';

export interface Invoice {
  from: string; // first day of consumption billed (YYYY-MM-DD)
  to: string; // last day, inclusive
  amount: number; // € TTC, as on the invoice
  kwh: number | null; // kWh billed, when written on the invoice
  subscription: boolean; // the amount includes the subscription
  estimated: boolean; // the closing index was estimated by the supplier
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** #359: a day that exists (the pattern alone lets 2026-02-30 through, read by Date as 2 March). */
const isDay = (s: string) => {
  if (!DAY_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};
const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < max ? v : null);

/** A clean invoice or null (local storage is not trusted blindly). */
export function validInvoice(v: unknown): Invoice | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.from !== 'string' || typeof o.to !== 'string' || !isDay(o.from) || !isDay(o.to) || o.to < o.from) return null;
  const amount = num(o.amount, 1e6);
  if (amount === null) return null;
  return {
    from: o.from,
    to: o.to,
    amount,
    kwh: num(o.kwh, 1e7),
    subscription: o.subscription !== false,
    estimated: o.estimated === true,
  };
}

export const invoiceKey = (i: Invoice) => `${i.from}|${i.to}|${i.amount}`;

/** Days of the period, both ends included. */
export function periodDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

export interface InvoiceData {
  linky: Map<string, number>; // day -> kWh, whole home
  heat: Map<string, number>; // day -> kWh, radiators (Intuis)
  water: Map<string, number>; // day -> kWh, water heater (Intuis)
  priceAt: PriceAt; // regulated price row of the contract in force that day
  offShare: number; // share of kWh drawn in off-peak hours (0..1); 0 for a single-price offer
  /** Energy cost of the radiators / water heater computed by the app (tariff columns), if any. */
  heatCost?: number | null;
  waterCost?: number | null;
}

export interface GapLine {
  kind: 'kwh' | 'missing' | 'subscription' | 'residual' | 'scope';
  eur: number | null; // part of the gap it explains (null: information only)
  text: string;
}

export interface Reconciliation {
  days: number;
  linkyKwh: number; // metered
  linkyDays: number;
  missingDays: number;
  missingKwh: number; // estimated for the missing days
  appKwh: number; // metered + estimated
  avgPrice: number | null; // €/kWh TTC over the period
  energy: number | null; // € TTC, app
  subscription: number | null; // € TTC prorated, app
  appTotal: number | null; // what the app would bill for the same scope as the invoice
  gap: number | null; // invoice − app
  gapPct: number | null;
  lines: GapLine[];
  residual: number | null;
  tolerance: number; // € under which the residual is considered noise
  verdict: 'ok' | 'unexplained' | 'no-price';
  scope?: 'home' | 'heating'; // what the app priced: the whole home (Linky) or radiators + water heater
  heatKwh: number;
  waterKwh: number;
  heatCost: number | null;
  waterCost: number | null;
  otherCost: number | null; // other uses of the home (Linky − radiators − water heater)
}

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (v: number) => `${nf2.format(Math.abs(v))} €`;
const kwh = (v: number) => `${nf0.format(Math.abs(v))} kWh`;

/** Gap tolerance: 3 % of the invoice, at least 2 €. */
export const tolerance = (amount: number) => Math.max(2, amount * 0.03);

export function reconcile(inv: Invoice, d: InvoiceData): Reconciliation {
  const days = periodDays(inv.from, inv.to);
  let linkyKwh = 0;
  let linkyDays = 0;
  let energy = 0;
  let priced = 0; // kWh with a known price
  let subscription = 0;
  let subDays = 0;
  let heatKwh = 0;
  let waterKwh = 0;
  const s = Math.min(1, Math.max(0, d.offShare));
  const hasLinky = d.linky.size > 0;
  for (let day = inv.from; day <= inv.to; day = addDays(day, 1)) {
    const p = d.priceAt(day);
    // Without a Linky meter, only the radiators and the water heater can be priced.
    const k = hasLinky ? d.linky.get(day) : d.heat.has(day) || d.water.has(day) ? (d.heat.get(day) ?? 0) + (d.water.get(day) ?? 0) : undefined;
    heatKwh += d.heat.get(day) ?? 0;
    waterKwh += d.water.get(day) ?? 0;
    if (p) {
      subscription += p.fixedYear / (Number(day.slice(0, 4)) % 4 === 0 ? 366 : 365);
      subDays++;
    }
    if (k === undefined) continue;
    linkyKwh += k;
    linkyDays++;
    if (p) {
      energy += k * (s * p.hc + (1 - s) * p.hp);
      priced += k;
    }
  }
  const missingDays = days - linkyDays;
  const missingKwh = linkyDays ? (linkyKwh / linkyDays) * missingDays : 0;
  const avgPrice = priced > 0 ? energy / priced : null;
  const tol = tolerance(inv.amount);
  const intuisCost = (v: number | null | undefined, k: number) => (v !== undefined && v !== null ? v : avgPrice !== null ? k * avgPrice : null);
  const heatCost = intuisCost(d.heatCost, heatKwh);
  const waterCost = intuisCost(d.waterCost, waterKwh);
  const base = {
    days,
    linkyKwh,
    linkyDays,
    missingDays,
    missingKwh,
    appKwh: linkyKwh + missingKwh,
    heatKwh,
    waterKwh,
    heatCost,
    waterCost,
    tolerance: tol,
  };
  if (avgPrice === null || subDays === 0) {
    return {
      ...base,
      avgPrice: null,
      energy: null,
      subscription: null,
      appTotal: null,
      gap: null,
      gapPct: null,
      lines: [],
      residual: null,
      verdict: 'no-price',
      otherCost: null,
    };
  }
  const energyAll = energy + missingKwh * avgPrice;
  const sub = inv.subscription ? subscription : 0;
  const appTotal = energyAll + sub;
  const gap = inv.amount - appTotal;
  const lines: GapLine[] = [];
  let explained = 0;
  if (!hasLinky) {
    lines.push({
      kind: 'scope',
      eur: null,
      text: "Sans compteur Linky, l'appli ne connaît que les radiateurs et le chauffe-eau : le reste de la facture correspond aux autres usages (cuisine, éclairage, appareils), l'écart est donc normal.",
    });
  }
  if (inv.kwh !== null) {
    const diff = inv.kwh - base.appKwh;
    const e = diff * avgPrice;
    explained += e;
    if (Math.abs(diff) >= 1) {
      lines.push({
        kind: 'kwh',
        eur: e,
        text: !hasLinky
          ? diff > 0
            ? `La facture compte ${kwh(diff)} de plus que les radiateurs et le chauffe-eau : les autres usages du logement (+${eur(e)}).`
            : // #358 (mutation): fewer kWh than the radiators alone used to read « de plus »
              `La facture compte ${kwh(diff)} de moins que les radiateurs et le chauffe-eau (−${eur(e)}) : relevé estimé ou dates de relevé décalées.`
          : inv.estimated
          ? `Relevé estimé : la facture compte ${kwh(diff)} ${diff > 0 ? 'de plus' : 'de moins'} que le compteur Linky (${diff > 0 ? '+' : '−'}${eur(e)}). Ils seront régularisés sur la prochaine facture relevée.`
          : `La facture compte ${kwh(diff)} ${diff > 0 ? 'de plus' : 'de moins'} que le compteur Linky (${diff > 0 ? '+' : '−'}${eur(e)}) : dates de relevé décalées d'un jour ou deux, ou index estimé non signalé.`,
      });
    } else {
      lines.push({ kind: 'kwh', eur: 0, text: `Mêmes kWh que le compteur Linky (${kwh(inv.kwh)}).` });
    }
  }
  if (missingDays > 0) {
    lines.push({
      kind: 'missing',
      eur: null,
      text: `${missingDays} jour${missingDays > 1 ? 's' : ''} sans relevé${hasLinky ? ' Linky' : ''} dans la période, comptés à la moyenne des autres jours (${kwh(missingKwh)}, ${eur(missingKwh * avgPrice)}).`,
    });
  }
  lines.push({
    kind: 'subscription',
    eur: null,
    text: inv.subscription
      ? `Abonnement compté au prorata des jours : ${eur(subscription)} pour ${days} jours. Un fournisseur le facture souvent par mois entier ou d'avance : quelques euros d'écart en viennent.`
      : 'Abonnement exclu des deux côtés (case décochée).',
  });
  const residual = gap - explained;
  lines.push({
    kind: 'residual',
    eur: residual,
    text:
      Math.abs(residual) <= tol
        ? `Reste ${residual >= 0 ? '+' : '−'}${eur(residual)} : négligeable (moins de 3 % de la facture), arrondis des taxes (TVA, accise, CTA) et de l'abonnement.`
        : `Reste ${residual >= 0 ? '+' : '−'}${eur(residual)} non expliqué : prix différent du tarif réglementé (offre de marché, promotion), taxes ou contributions ajoutées, autre puissance souscrite, frais de service, ou contrat mal saisi dans l'appli.`,
  });
  const otherCost = hasLinky && heatCost !== null && waterCost !== null ? energyAll - heatCost - waterCost : null;
  return {
    ...base,
    avgPrice,
    energy: energyAll,
    subscription: inv.subscription ? subscription : null,
    appTotal,
    gap,
    gapPct: inv.amount > 0 ? (gap / inv.amount) * 100 : null,
    lines,
    residual,
    verdict: Math.abs(residual) <= tol ? 'ok' : 'unexplained',
    scope: hasLinky ? 'home' : 'heating',
    otherCost,
  };
}
