// S-1.30 (#279): names and roles of the Shelly series (one per plug, one per clamp-meter channel),
// chosen in Paramètres and kept on this device only (names of circuits can say a lot about a
// home: never sent anywhere). A channel marked « arrivée générale » is a control of the whole
// supply, « chauffe-eau » is already counted by Intuis: both stay out of the breakdown of the
// other usages (counting them would add energy twice).
export type ShellyRole = '' | 'main' | 'water';

export interface ShellyPrefs {
  names: Record<string, string>;
  roles: Record<string, ShellyRole>;
}

const KEY = 'intuis-history:shelly';
export const ROLE_LABEL: Record<ShellyRole, string> = { '': 'usage mesuré', main: 'arrivée générale (contrôle)', water: 'chauffe-eau' };

function valid(v: unknown): ShellyPrefs {
  const out: ShellyPrefs = { names: {}, roles: {} };
  if (!v || typeof v !== 'object') return out;
  const o = v as Partial<ShellyPrefs>;
  for (const [k, n] of Object.entries(o.names ?? {})) if (typeof n === 'string' && n.trim()) out.names[k] = n.trim().slice(0, 60);
  for (const [k, r] of Object.entries(o.roles ?? {})) if (r === 'main' || r === 'water') out.roles[k] = r;
  return out;
}

export function readShellyPrefs(): ShellyPrefs {
  try {
    return valid(JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null'));
  } catch {
    return { names: {}, roles: {} };
  }
}

export function writeShellyPrefs(p: ShellyPrefs): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(valid(p)));
  } catch {
    /* storage unavailable: the choice lasts for this visit only */
  }
}
