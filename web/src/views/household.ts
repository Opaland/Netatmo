// S-12.2: the household-view controls of the ⋮ menu (bedrooms merged into « Chambres »).
import { householdStatus, revealBedrooms, setHousehold } from '../app';
import { keepMenuOpen } from '../ui';

/** Menu entries; nothing when no room is named like a bedroom. */
export function householdMenu(): string {
  const s = householdStatus();
  if (!s.bedrooms) return '';
  const reveal = s.enabled
    ? s.revealed
      ? '<button type="button" data-household="hide">Regrouper à nouveau les chambres</button>'
      : '<button type="button" data-household="reveal" title="Profils horaires, CO₂ et températures de chaque chambre, jusqu\'au prochain verrouillage">Afficher le détail des chambres (jusqu\'au verrouillage)</button>'
    : '';
  return `<label class="check"><input type="checkbox" data-toggle="household" ${s.enabled ? 'checked' : ''}> Vue foyer : chambres regroupées en « Chambres »</label>${reveal}`;
}

export function handleClick(btn: HTMLElement): boolean {
  const v = btn.dataset.household;
  if (!v) return false;
  revealBedrooms(v === 'reveal');
  keepMenuOpen();
  return true;
}

export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  if (t.dataset.toggle !== 'household') return false;
  setHousehold((t as HTMLInputElement).checked);
  keepMenuOpen();
  return true;
}
