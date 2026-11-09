// S-12.2: the household-view controls of ⚙ Affichage (bedrooms merged into « Chambres »).
import { switchField } from '../components';
import { householdStatus, revealBedrooms, setHousehold } from '../app';

/** Menu entries; nothing when no room is named like a bedroom. */
export function householdMenu(): string {
  const s = householdStatus();
  if (!s.bedrooms) return '';
  const reveal = s.enabled
    ? s.revealed
      ? '<button type="button" class="btn secondary" data-household="hide">Regrouper à nouveau les chambres</button>'
      : '<button type="button" class="btn secondary" data-household="reveal" title="Profils horaires, CO₂ et températures de chaque chambre, jusqu\'au prochain verrouillage">Afficher le détail des chambres (jusqu\'au verrouillage)</button>'
    : '';
  return `${switchField('Regrouper les chambres en « Chambres »', s.enabled, { 'data-toggle': 'household' })}<p class="hint muted">Affichage seulement : les calculs restent par pièce.</p>${reveal}`;
}

export function handleClick(btn: HTMLElement): boolean {
  const v = btn.dataset.household;
  if (!v) return false;
  revealBedrooms(v === 'reveal');
  return true;
}

export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  if (t.dataset.toggle !== 'household') return false;
  setHousehold((t as HTMLInputElement).checked);
  return true;
}
