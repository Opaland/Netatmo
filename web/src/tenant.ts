// S-12.6: tenant mode, a per-device setting. No Linky nor contract of the account holder:
// costs use an average price per kWh entered by the tenant, the Linky cards, the offer
// comparator and the shared contract are hidden with a sentence, and the anonymised report
// can cover the lease only. Kept in its own storage key (not in State): tiny, entry chunk.
// No import of the app: the caller re-renders after setTenant().
import { lsKey } from './scope';

export interface Tenant {
  on: boolean;
  leaseFrom: string | null; // YYYY-MM-DD, start of the lease
  leaseTo: string | null; // YYYY-MM-DD, end of the lease (null = still running)
}

const KEY = lsKey('tenant');
const OFF: Tenant = { on: false, leaseFrom: null, leaseTo: null };
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Validated tenant settings (anything unexpected falls back to « off »). */
export function parseTenant(raw: unknown): Tenant {
  if (!raw || typeof raw !== 'object') return { ...OFF };
  const o = raw as Record<string, unknown>;
  const from = isDay(o.leaseFrom) ? o.leaseFrom : null;
  const to = isDay(o.leaseTo) && (!from || o.leaseTo >= from) ? o.leaseTo : null;
  return { on: o.on === true, leaseFrom: from, leaseTo: to };
}

let cached: Tenant | null = null;
export function tenant(): Tenant {
  if (!cached) {
    try {
      cached = parseTenant(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
    } catch {
      cached = { ...OFF };
    }
  }
  return cached;
}

export function setTenant(patch: Partial<Tenant>) {
  cached = parseTenant({ ...tenant(), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    /* storage unavailable: kept for this visit */
  }
}

/** Lease window clipped to the archive, or null when no lease start is known. */
export function leaseWindow(t: Tenant, first: string, last: string): { from: string; to: string } | null {
  if (!t.leaseFrom) return null;
  const from = t.leaseFrom > first ? t.leaseFrom : first;
  const to = t.leaseTo && t.leaseTo < last ? t.leaseTo : last;
  return from <= to ? { from, to } : null;
}

/** The sentence that replaces a card hidden in tenant mode. */
export function tenantNote(what: string): string {
  return `<section class="card tenant-note"><p class="hint"><span class="badge">locataire</span> ${what} en mode locataire : ce calcul suppose le compteur Linky et le contrat du titulaire. Vos coûts utilisent votre prix moyen au kWh (menu ⋮ → Prix). Réglage : Paramètres → Mode locataire.</p></section>`;
}

/** Menu ⋮ → Prix in tenant mode: one average price (and an optional subscription). */
export function tenantPricesForm(base: number | null, sub: number | null): string {
  return `<fieldset class="prices"><legend>Prix</legend>
    <p class="hint muted"><span class="badge">locataire</span> Un prix moyen, abonnement compris ou non, tiré de vos factures.</p>
    <label>Prix moyen du kWh (€/kWh)<input data-price="base" type="number" inputmode="decimal" step="0.0001" min="0" placeholder="ex. 0,2516" value="${base ?? ''}"></label>
    <label>Abonnement (€/mois, facultatif)<input data-price="sub" type="number" inputmode="decimal" step="0.01" min="0" placeholder="ex. 15,65" value="${sub ?? ''}"></label>
  </fieldset>`;
}
