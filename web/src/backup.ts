// S-1.15: one-file backup of every encrypted document, still encrypted.
// The bundle is built from the files as served (the envelopes), never from decrypted
// content: it can be stored anywhere, and restored with `python -m collector restore-backup`.
import type { Meta } from './aggregate';
import type { Envelope, KeyInfo } from './crypto';

export const BACKUP_FORMAT = 'intuis-history-backup/1';

export interface Bundle {
  format: typeof BACKUP_FORMAT;
  created: string;
  keyinfo: KeyInfo;
  files: Record<string, Envelope>;
}

type BackupMeta = Meta & { station_hourly_years?: number[]; linky_curve_years?: number[] };

/** Every encrypted document the meta knows about. The Netatmo refresh token is left out on purpose. */
export function backupNames(meta: BackupMeta): string[] {
  const years = (list: number[] | undefined, suffix: string) => (list ?? []).map((y) => `${y}${suffix}`);
  return [
    'meta',
    'weather',
    'linky',
    'station',
    'insights',
    ...(meta.has_roomstate ? ['roomstate'] : []),
    ...years(meta.years, ''),
    ...years(meta.hourly_years, '.hourly'),
    ...years(meta.station_hourly_years, '.station_h'),
    ...years(meta.linky_curve_years, '.linky30'),
  ]
    .filter((n) => n !== 'netatmo-token')
    .map((n) => `${n}.enc.json`);
}

const isEnvelope = (o: unknown): o is Envelope =>
  !!o && typeof o === 'object' && typeof (o as Envelope).ct === 'string' && typeof (o as Envelope).iv === 'string';

/**
 * fetchJson(name) returns the parsed file, or null when it does not exist (optional
 * documents such as station or insights). Anything that is not an envelope is refused,
 * so a plaintext file can never end up in the bundle.
 */
export async function buildBundle(
  fetchJson: (name: string) => Promise<unknown | null>,
  meta: BackupMeta,
  created = new Date(),
): Promise<Bundle> {
  const keyinfo = (await fetchJson('keyinfo.json')) as KeyInfo | null;
  if (!keyinfo?.salt) throw new Error('keyinfo.json introuvable');
  const files: Record<string, Envelope> = {};
  for (const name of backupNames(meta)) {
    const doc = await fetchJson(name);
    if (doc === null) continue;
    if (!isEnvelope(doc)) throw new Error(`${name} n'est pas un fichier chiffré`);
    const { v, kdf, iter, salt, iv, ct } = doc;
    files[name] = { v, kdf, iter, salt, iv, ct };
  }
  return { format: BACKUP_FORMAT, created: created.toISOString(), keyinfo: { salt: keyinfo.salt, iter: keyinfo.iter }, files };
}

export const backupFileName = (d = new Date()) =>
  `sauvegarde-energie-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;

/** Browser side: fetch the encrypted files of `source` and save the bundle. */
export async function downloadBackup(source: string, meta: BackupMeta): Promise<number> {
  const bundle = await buildBundle(async (name) => {
    const resp = await fetch(`${source}/${name}`, { cache: 'no-cache' });
    if (resp.status === 404 || (resp.headers.get('content-type') ?? '').includes('text/html')) return null;
    if (!resp.ok) throw new Error(`${name} : HTTP ${resp.status}`);
    return resp.json();
  }, meta);
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = backupFileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return Object.keys(bundle.files).length;
}
