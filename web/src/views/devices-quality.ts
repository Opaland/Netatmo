// v1.5: device part of the quality card and the « Intuis indique » line of the contract
// (#214, #216, #276, #277, #278). Small and synchronous: the documents are already loaded.
import { ds, rawDataset } from '../app';
import { addDays } from '../aggregate';
import {
  type IntuisContract,
  contractMismatch,
  firmwareLog,
  firmwareSummary,
  indexCheck,
  intuisOffer,
  restarts,
  setupDates,
  typeLabel,
} from '../devices';
import { OFFERS, periodAt } from '../offers';
import { contracts, esc, lastDay, longDate, table } from '../ui';
import { fmt1 } from '../glossary';

export const roomLabel = (id?: string) => (id ? ((rawDataset() ?? ds!).meta.rooms.find((r) => r.id === id)?.name ?? 'pièce inconnue') : '—');
/** #258: the shared one-decimal format (typographic minus). */
export const f1 = fmt1;
export const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** #278: « Intuis indique : … » and the warning when it differs from the shared contract. */
export function intuisContractLine(): string {
  const ic = (ds!.meta as { intuis_contract?: IntuisContract }).intuis_contract;
  if (!ic) return '';
  const offer = intuisOffer(ic);
  const label = offer === 'tempo' ? 'Tempo' : offer ? (OFFERS.find((o) => o.id === offer)?.label ?? offer) : [ic.tariff_option ?? ic.tariff ?? 'option inconnue'].flat().join(', ');
  const current = periodAt(contracts(), lastDay()) ?? undefined;
  const diff = contractMismatch(ic, current);
  const what = `Intuis indique : option ${esc(label)}${typeof ic.kva === 'number' ? `, ${f1(ic.kva).replace(',0', '')} kVA` : ''}.`;
  return diff.length
    ? `<p class="notice">⚠️ ${what} Cela diffère du contrat en vigueur (${esc(diff.join(' et '))}) : si le tarif saisi dans l'application Intuis est faux, son découpage heures pleines / creuses l'est aussi. Corrigez-le dans l'application Intuis (ou ici, si c'est le contrat partagé qui est faux).</p>`
    : `<p class="hint muted">${what} Conforme au contrat en vigueur.</p>`;
}

/** Device section of the quality card (synchronous: small documents already loaded). */
export function devicesQualityHtml(): string {
  const d = ds!;
  const doc = d.devices;
  const out: string[] = [];
  const fw = firmwareSummary(firmwareLog(doc));
  const setup = setupDates(doc);
  if (fw.length || setup.length) {
    out.push(
      `<h3>Firmware et mise en service</h3>${table(
        ['Date', 'Appareil', 'Changement'],
        [
          ...fw.slice(0, 20).map((e) => [esc(longDate(e.day)), esc(`${e.n > 1 ? `${e.n} × ` : ''}${typeLabel(e.type)}`), `firmware ${esc(e.from)} → ${esc(e.to)}`]),
          ...setup.slice(0, 5).map((s) => [esc(longDate(s.day)), esc(`${s.n > 1 ? `${s.n} × ` : ''}${typeLabel(s.type)}`), 'mise en service']),
        ],
        99,
      )}<p class="hint muted">Une rupture de consommation ou de régulation peut suivre une mise à jour : la date est celle de la collecte qui l'a vue.</p>`,
    );
  }
  const boots = restarts(doc, addDays(lastDay(), -365));
  if (boots.length) {
    const days = [...new Set(boots.map((b) => b.slice(0, 10)))];
    out.push(`<h3>Coupures de courant probables</h3><p class="hint muted">La passerelle Intuis a redémarré ${days.length > 1 ? `ces ${days.length} jours` : 'ce jour'} : ${days.map((x) => esc(longDate(x))).join(', ')}. Un trou dans les courbes ces jours-là vient sans doute de là.</p>`);
  }
  const off = new Map<string, string[]>();
  for (const [key, days] of Object.entries(doc?.reach ?? {})) {
    const room = doc?.modules?.[key]?.room;
    const zero = Object.keys(days).filter((x) => days[x] === 0);
    if (room && zero.length) off.set(room, [...(off.get(room) ?? []), ...zero]);
  }
  if (off.size) {
    out.push(
      `<h3>Modules hors ligne</h3>${table(
        ['Pièce', 'Jours « module hors ligne »'],
        [...off].map(([room, days]) => [esc(roomLabel(room)), esc([...new Set(days)].sort().reverse().slice(0, 6).map(longDate).join(', '))]),
        99,
      )}<p class="hint muted">Ces jours-là, 0 kWh ne veut pas dire « rien consommé » : le module ne répondait pas.</p>`,
    );
  }
  const tc = d.tempoCheck;
  if (tc && (tc.mismatch.length || tc.filled.length)) {
    out.push(
      `<h3>Couleur Tempo</h3><p class="hint muted">${
        tc.mismatch.length ? `La passerelle Intuis et api-couleur-tempo.fr diffèrent ${plural(tc.mismatch.length, 'jour')} (sur ${tc.overlap} connus des deux) : ${tc.mismatch.slice(0, 5).map((x) => esc(longDate(x))).join(', ')}. ` : ''
      }${tc.filled.length ? `${plural(tc.filled.length, 'jour')} sans couleur publique complété${tc.filled.length > 1 ? 's' : ''} par la passerelle (source : passerelle Intuis).` : ''}</p>`,
    );
  }
  if (d.linkyIndex) {
    const chk = indexCheck(d.linkyIndex, d.linky);
    if (chk.off.length) {
      out.push(
        `<h3>Index Linky</h3><p class="hint muted">Sur ${chk.days} jours, la consommation déduite des index s'écarte de plus de 2 % du total quotidien ${chk.off.length} fois : ${chk.off
          .slice(0, 5)
          .map((o) => `${esc(longDate(o.day))} (${f1(o.index)} contre ${f1(o.daily)} kWh)`)
          .join(', ')}.</p>`,
      );
    } else if (chk.days) out.push(`<h3>Index Linky</h3><p class="hint muted">✓ Index par cadran cohérents avec la consommation quotidienne sur ${chk.days} jours.</p>`);
  }
  return out.length ? `<section class="devices-quality">${out.join('')}</section>` : '';
}
