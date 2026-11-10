// S-12.5: prolonged cold in a living room (lazy module).
// - Confort: in-app alert for the rooms of the alert recorded by the collection (meta.cold_alert);
// - Paramètres: choose rooms and threshold, see each room's state and its pseudonym, and write
//   the repository variable COLD_ALERT_JSON (the nightly collection opens a GitHub issue).
// Real names stay on this device: the public issue only shows « Pièce A, B… ».
import { ds, householdStatus, rawDataset, rerender } from '../app';
import { BEDROOMS_NAME, isBedroom } from '../household';
import {
  COLD_DAYS,
  COLD_MAX_ROOMS,
  COLD_THRESHOLDS,
  type ColdConfig,
  type Sensor,
  coldJson,
  coldPseudonym,
  coldSensors,
  coldStatus,
  parseColdConfig,
} from '../cold';
import { hasToken, putVariable } from '../settings';
import { esc, lastDay, longDate, table } from '../ui';
import { html } from '../trusted';
import '../simulators.css';
import { lsKey } from '../scope';
import { fmt1 as num1 } from '../glossary';
import { alert, alertHtml, switchField } from '../components';

export const COLD_VARIABLE = 'COLD_ALERT_JSON';
const LS = lsKey('cold-draft');

/** #242: always the raw rooms and modules, whatever the household view shows. */
const sensors = (): Sensor[] => coldSensors(rawDataset() ?? ds!);

const shared = () => parseColdConfig((ds!.meta as { cold_alert?: unknown }).cold_alert);

function draft(): ColdConfig {
  try {
    const o = JSON.parse(localStorage.getItem(LS) ?? 'null') as Partial<ColdConfig> | null;
    if (o && typeof o.threshold === 'number' && Array.isArray(o.rooms)) return { threshold: o.threshold, days: o.days ?? 1, rooms: o.rooms };
  } catch {
    /* default below */
  }
  return shared() ?? { threshold: 14, days: 1, rooms: [] };
}
function saveDraft(c: ColdConfig) {
  try {
    localStorage.setItem(LS, JSON.stringify(c));
  } catch {
    /* kept for this visit */
  }
}

function describe(s: Sensor, c: ColdConfig): string {
  const r = coldStatus(s.means, c.threshold, c.days, lastDay());
  if (r.status === 'stale') return `<span class="muted">aucun relevé récent${r.lastDay ? ` (dernier le ${longDate(r.lastDay)})` : ''}</span>`;
  const last = `${num1(r.lastMean!)} °C en moyenne le ${longDate(r.lastDay!)}`;
  return r.status === 'cold'
    ? `<strong class="ko-red">sous ${num1(c.threshold)} °C depuis ${r.streak} jour${r.streak > 1 ? 's' : ''}</strong> (${last})`
    : `${r.streak ? `sous le seuil depuis ${r.streak} jour${r.streak > 1 ? 's' : ''}, ` : ''}${last}`;
}

// ------------------------------------------------------------------ Confort: in-app alert
export function mountColdBanner(zone: HTMLElement | null) {
  if (!zone || !ds || !zone.isConnected) return;
  const c = shared();
  if (!c) return;
  const byId = new Map(sensors().map((s) => [s.id, s]));
  const cold = c.rooms
    .map((id) => byId.get(id))
    .filter((s): s is Sensor => !!s && coldStatus(s.means, c.threshold, c.days, lastDay()).status === 'cold');
  // #311: among the grouped alerts of Accueil (alert component); nothing when no room is cold
  zone.innerHTML = html(
    cold.length
      ? alert(
          'bad',
          'Froid prolongé',
          '',
          `<p>${cold
            .map((s) => `${esc(householdStatus().active && isBedroom(s.name) ? `${BEDROOMS_NAME} (une chambre)` : s.name)} ${describe(s, c)}`)
            .join(' ; ')}. Une alerte est ouverte dans GitHub par la collecte (sans nom ni température). <a class="link" href="#parametres-objectifs">Réglage</a></p>`,
        )
      : '',
  );
}

// ------------------------------------------------------------------ Paramètres: configuration
let message: { ok: boolean; text: string } | null = null;

export function mountColdSettings(card: HTMLElement | null, repo: () => string, focus?: string) {
  if (!card || !ds || !card.isConnected) return;
  const list = sensors();
  if (!list.length) return card.remove();
  const c = draft();
  const active = shared();
  const demo = ds.source === 'demo';
  const canWrite = !demo && hasToken();
  const chosen = c.rooms.filter((id) => list.some((s) => s.id === id));
  const cfg: ColdConfig = { ...c, rooms: chosen };
  card.hidden = false;
  card.innerHTML = html`<h2>Alerte froid prolongé <small class="muted">désactivée par défaut</small></h2>
    <p class="hint">Pour un proche âgé ou une résidence secondaire : quand une pièce choisie reste sous le seuil sur une journée entière (moyenne de 24 h), la collecte de la nuit ouvre une issue GitHub « 🥶 Alerte froid prolongé » (GitHub vous l'envoie par e-mail), qui se ferme d'elle-même au retour au-dessus du seuil. L'issue est publique : <strong>ni température ni nom de pièce</strong>, seulement un pseudonyme (Pièce A, B…) dont la correspondance n'est visible qu'ici.</p>
    ${alertHtml('warn', "<strong>Ce n'est pas un dispositif de sécurité.</strong> Avec une collecte par nuit, l'alerte peut arriver jusqu'à 24 h après la journée froide, davantage si la collecte échoue ou si une sonde ne remonte plus. Pour une personne fragile, gardez un autre moyen de contact.")}
    <p class="hint">${
      active
        ? `<span class="badge">active</span> Enregistrée par la collecte : ${active.rooms.length} pièce${active.rooms.length > 1 ? 's' : ''}, seuil ${num1(active.threshold)} °C pendant ${active.days} jour${active.days > 1 ? 's' : ''}.`
        : '<span class="muted">Aucune alerte enregistrée par la collecte.</span>'
    }</p>
    <div class="sim-form">
      <label>Seuil (moyenne du jour)<select id="cold-threshold">${COLD_THRESHOLDS.map((t) => `<option value="${t}" ${t === cfg.threshold ? 'selected' : ''}>${t} °C</option>`).join('')}</select></label>
      <label>Pendant<select id="cold-days">${COLD_DAYS.map((d) => `<option value="${d}" ${d === cfg.days ? 'selected' : ''}>${d === 1 ? '1 jour (24 h)' : `${d} jours de suite`}</option>`).join('')}</select></label>
    </div>
    <fieldset class="sim-choices"><legend>Pièces suivies (${COLD_MAX_ROOMS} au plus)</legend>
      ${list
        .map(
          (s) => switchField(s.name, chosen.includes(s.id), { 'data-cold-room': s.id }, { sub: s.kind === 'station' ? 'station' : 'sonde du radiateur' }),
        )
        .join('')}
    </fieldset>
    ${
      chosen.length
        ? table(
            ['Dans l\'issue', 'Pièce', 'État'],
            chosen.map((id, i) => {
              const s = list.find((x) => x.id === id)!;
              return [coldPseudonym(i), esc(s.name), describe(s, cfg)];
            }),
            99,
          )
        : '<p class="hint muted">Activez au moins une pièce.</p>'
    }
    <p class="hint muted">Variable du dépôt <code>${COLD_VARIABLE}</code> (Settings → Secrets and variables → Actions → Variables) :</p>
    <code class="sim-json">${esc(chosen.length ? coldJson(cfg) : '—')}</code>
    <div class="controls">
      <button type="button" class="primary small" id="cold-save" ${canWrite && chosen.length ? '' : 'disabled'}>Enregistrer l'alerte dans GitHub</button>
      <button type="button" class="link" id="cold-off" ${canWrite && active ? '' : 'disabled'}>Désactiver l'alerte</button>
    </div>
    <p class="hint muted">${
      demo ? 'Mode démonstration : rien n\'est enregistré.' : hasToken() ? 'Prise en compte à la prochaine collecte.' : 'Connectez un jeton GitHub ci-dessus (permission Variables) pour enregistrer, ou copiez la variable à la main.'
    }</p>
    ${message ? alertHtml(message.ok ? 'info' : 'bad', esc(message.text), { role: 'status' }) : ''}`;
  if (focus) card.querySelector<HTMLElement>(focus)?.focus();
  const update = (patch: Partial<ColdConfig>, from: string) => {
    saveDraft({ ...cfg, ...patch });
    message = null;
    mountColdSettings(card, repo, from); // keyboard users keep their place
  };
  card.querySelector<HTMLSelectElement>('#cold-threshold')!.addEventListener('change', (e) => update({ threshold: Number((e.target as HTMLSelectElement).value) }, '#cold-threshold'));
  card.querySelector<HTMLSelectElement>('#cold-days')!.addEventListener('change', (e) => update({ days: Number((e.target as HTMLSelectElement).value) }, '#cold-days'));
  for (const box of card.querySelectorAll<HTMLInputElement>('[data-cold-room]')) {
    box.addEventListener('change', () => {
      const id = box.dataset.coldRoom!;
      const next = box.checked ? [...chosen, id] : chosen.filter((r) => r !== id);
      if (next.length > COLD_MAX_ROOMS) return void (box.checked = false);
      update({ rooms: next }, `[data-cold-room="${CSS.escape(id)}"]`);
    });
  }
  const write = (value: string, done: string) => {
    message = { ok: true, text: 'En cours…' };
    mountColdSettings(card, repo);
    putVariable(repo(), COLD_VARIABLE, value)
      .then(() => (message = { ok: true, text: done }))
      .catch((err: Error) => (message = { ok: false, text: err.message }))
      .finally(() => (card.isConnected ? mountColdSettings(card, repo) : rerender()));
  };
  card.querySelector('#cold-save')!.addEventListener('click', () => {
    if (chosen.length) write(coldJson(cfg), `Alerte enregistrée (${chosen.length} pièce${chosen.length > 1 ? 's' : ''}). Elle s'applique à la prochaine collecte.`);
  });
  card.querySelector('#cold-off')!.addEventListener('click', () => {
    write(JSON.stringify({ threshold: cfg.threshold, days: cfg.days, rooms: [] }), 'Alerte désactivée à la prochaine collecte (l\'issue éventuelle se fermera).');
  });
}
