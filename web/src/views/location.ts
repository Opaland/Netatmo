// #204: ⚙ Mon logement → « Localisation et toits » (réglage foyer, lazy chunk). The owner types the
// location of the home (commune or coordinates, at the precision they choose) and each roof that
// could carry panels (orientation, tilt, power, losses). Saved for the household ONLY as the
// repository secret HOME_LOCATION_JSON (sealed in this browser, never readable back); the nightly
// collection copies it into the encrypted solar.enc.json and asks PVGIS for the production
// profile with the coordinates rounded to ≈ 1 km. Nothing is kept in clear on this device: the
// draft lives in memory until locking, and the coordinates are shown only while editing.
import { datasetDoc, ds, onLock } from '../app';
import { alertHtml } from '../components';
import { loadSolarDoc } from '../data';
import { hasToken, putSecret } from '../settings';
import { type HomeLocation, type Precision, type Roof, MAX_ROOFS, PRECISIONS, azimuthWord, locationJson, parseLocation, parseSolarDoc, roofsKwc } from '../solar';
import { html } from '../trusted';
import { esc, longDate } from '../ui';
import '../simulators.css';

export const LOCATION_SECRET = 'HOME_LOCATION_JSON';
const solarDoc = datasetDoc((d) => loadSolarDoc(d).then(parseSolarDoc));

let editing = false;
/** Saved from this device during this visit (the doc of the collection comes the next night). */
let sentNow: { at: number; loc: HomeLocation } | null = null;
let message: { ok: boolean; text: string } | null = null;
let draftRoofs: number | null = null;
// what was typed is forgotten on lock, like the decrypted data
onLock(() => {
  editing = false;
  sentNow = null;
  message = null;
  draftRoofs = null;
});

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const EMPTY_ROOF = { name: '', azimuth: '', tilt: '', kwc: '', loss: '' };

/** One line about a location, without its coordinates. */
export function locationSummary(l: HomeLocation): string {
  const roofs = l.roofs.map((r) => `${r.name} (${nf.format(r.kwc)} kWc, ${azimuthWord(r.azimuth)}, ${r.tilt}°)`).join(' ; ');
  return `${l.commune || 'Commune non nommée'}, ${PRECISIONS[l.precision]} · ${l.roofs.length} toit${l.roofs.length > 1 ? 's' : ''}, ${nf.format(roofsKwc(l.roofs))} kWc : ${roofs}`;
}

function roofFields(i: number, r: Partial<Record<keyof Roof, string | number>>) {
  const v = (k: keyof Roof) => esc(String(r[k] ?? ''));
  return `<fieldset class="sim-form loc-roof" data-roof="${i}"><legend>Toit ${i + 1}</legend>
    <label>Nom<input type="text" data-f="name" maxlength="40" value="${v('name')}" placeholder="Abri de jardin"></label>
    <label>Orientation (°, 180 = plein sud)<input type="number" inputmode="numeric" data-f="azimuth" min="0" max="359" step="1" value="${v('azimuth')}" placeholder="180"></label>
    <label>Pente (°)<input type="number" inputmode="numeric" data-f="tilt" min="0" max="90" step="1" value="${v('tilt')}"></label>
    <label>Puissance posable (kWc)<input type="number" inputmode="decimal" data-f="kwc" min="0.1" max="36" step="0.1" value="${v('kwc')}"></label>
    <label>Pertes et ombrages proches (%)<input type="number" inputmode="decimal" data-f="loss" min="0" max="60" step="1" value="${v('loss')}"></label>
    ${i > 0 ? `<div class="controls"><button type="button" class="link" data-roof-remove="${i}">Retirer ce toit</button></div>` : ''}
  </fieldset>`;
}

export function mountLocation(card: HTMLElement | null, repo: () => string) {
  if (!card || !ds) return;
  const d = ds;
  const doc = solarDoc.get(d, () => card.isConnected && mountLocation(card, repo));
  const status = solarDoc.status(d);
  const shared = doc?.location ?? null;
  const current = sentNow?.loc ?? shared;
  const demo = d.source === 'demo';
  card.removeAttribute('aria-busy');
  const state = status === 'loading' ? 'Lecture de la localisation enregistrée…' : status === 'failed' ? 'Localisation enregistrée illisible hors ligne.' : '';
  const savedLine = sentNow
    ? `Envoyée pour le foyer à ${new Date(sentNow.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}, chiffrée : prise en compte à la prochaine collecte.`
    : shared
      ? `Enregistrée pour le foyer, chiffrée${doc?.fetched ? ` ; profil de production ${doc.source === 'demo' ? 'fictif (démo)' : 'PVGIS'} du ${longDate(doc.fetched)}` : ''}.`
      : 'Aucune localisation enregistrée pour le foyer.';
  const roofs = draftRoofs ?? Math.max(1, current?.roofs.length ?? 1);
  const form = editing
    ? `<div class="sim-form" role="group" aria-label="Où est la maison">
      <label>Commune (facultatif, pour vous)<input type="text" id="loc-commune" maxlength="60" value="${esc(current?.commune ?? '')}"></label>
      <label>Latitude (degrés décimaux)<input type="text" id="loc-lat" inputmode="decimal" autocomplete="off" spellcheck="false" value="${current ? esc(String(current.lat)) : ''}" placeholder="45,76"></label>
      <label>Longitude (degrés décimaux)<input type="text" id="loc-lon" inputmode="decimal" autocomplete="off" spellcheck="false" value="${current ? esc(String(current.lon)) : ''}" placeholder="4,84"></label>
      <label>Précision gardée<select id="loc-precision">${([1, 2, 3] as Precision[])
        .map((p) => `<option value="${p}"${p === (current?.precision ?? 2) ? ' selected' : ''}>${esc(PRECISIONS[p])}</option>`)
        .join('')}</select></label>
    </div>
    <p class="hint muted">Les coordonnées de la mairie de votre commune suffisent pour la production solaire : elle change peu sur quelques kilomètres. Saisies ici, elles ne partent qu’au dépôt, chiffrées.</p>
    ${Array.from({ length: roofs }, (_, i) => roofFields(i, current?.roofs[i] ?? EMPTY_ROOF)).join('')}
    <div class="controls">
      ${roofs < MAX_ROOFS ? '<button type="button" class="btn secondary" id="loc-add-roof">Ajouter un toit</button>' : ''}
      <button type="button" class="btn primary" id="loc-save" ${demo || hasToken() ? '' : 'disabled'}>${demo ? 'Appliquer (démo)' : 'Enregistrer pour le foyer'}</button>
      <button type="button" class="link" id="loc-cancel">Annuler</button>
    </div>`
    : `<div class="controls"><button type="button" class="btn secondary" id="loc-edit">${current ? 'Modifier la localisation' : 'Indiquer la localisation'}</button></div>`;
  card.innerHTML = html(`<div class="card-head"><h2 id="loc-title">Localisation et toits</h2><span class="tag scope">foyer</span></div>
    <p class="hint muted">Pour calculer la production de panneaux solaires sur vos toits (<a href="#outils-solaire">Outils › Panneaux solaires</a>) : où est la maison, et comment chaque toit est orienté et penché.</p>
    ${state ? `<p class="hint muted" role="status">${esc(state)}</p>` : ''}
    <p class="hint">${current && !editing ? `<strong>${esc(locationSummary(current))}</strong><br>` : ''}${esc(savedLine)}</p>
    ${form}
    ${message ? alertHtml(message.ok ? 'info' : 'bad', esc(message.text), { role: 'status' }) : ''}
    <details class="table-details"><summary>Où va cette information</summary>
      <p class="hint">Dans le secret <code>${LOCATION_SECRET}</code> du dépôt, chiffré dans ce navigateur avec la clé publique du dépôt : personne ne peut le relire, pas même cette appli. La collecte de la nuit le recopie dans <code>solar.enc.json</code>, chiffré avec votre phrase de passe.</p>
      <p class="hint">PVGIS (Commission européenne) reçoit les coordonnées <strong>arrondies à environ 1 km</strong>, l’orientation et la pente des toits, jamais plus précis. Elles n’apparaissent dans aucun journal de collecte, aucune adresse, aucun export, ni le rapport anonymisé ni ce qui est envoyé à l’IA.</p>
      <p class="hint muted">${demo ? 'Démo : une localisation fictive ; rien n’est envoyé.' : hasToken() ? 'Le jeton GitHub doit avoir la permission « Secrets » en écriture.' : 'Connectez un jeton GitHub (⚙ Sources de données, permission Secrets) pour enregistrer.'}</p>
    </details>`);
  const rerender = () => mountLocation(card, repo);
  card.querySelector('#loc-edit')?.addEventListener('click', () => {
    editing = true;
    message = null;
    draftRoofs = null;
    rerender();
    card.querySelector<HTMLInputElement>('#loc-commune')?.focus();
  });
  card.querySelector('#loc-cancel')?.addEventListener('click', () => {
    editing = false;
    draftRoofs = null;
    rerender();
    card.querySelector<HTMLButtonElement>('#loc-edit')?.focus();
  });
  card.querySelector('#loc-add-roof')?.addEventListener('click', () => {
    const typed = read(card);
    draftRoofs = Math.min(MAX_ROOFS, roofs + 1);
    keepTyped(card, typed, rerender);
  });
  for (const b of card.querySelectorAll<HTMLButtonElement>('[data-roof-remove]'))
    b.addEventListener('click', () => {
      const typed = read(card);
      typed.roofs.splice(Number(b.dataset.roofRemove), 1);
      draftRoofs = Math.max(1, roofs - 1);
      keepTyped(card, typed, rerender);
    });
  card.querySelector('#loc-save')?.addEventListener('click', () => {
    const typed = read(card);
    const loc = parseLocation(typed);
    if (!loc) {
      message = { ok: false, text: problem(typed) };
      keepTyped(card, typed, rerender);
      return;
    }
    if (demo) {
      sentNow = { at: Date.now(), loc };
      editing = false;
      message = { ok: true, text: 'Démo : appliqué pour cette visite, rien n’est envoyé.' };
      return rerender();
    }
    message = { ok: true, text: 'Envoi chiffré en cours…' };
    keepTyped(card, typed, rerender);
    putSecret(repo(), LOCATION_SECRET, locationJson(loc))
      .then(() => {
        sentNow = { at: Date.now(), loc };
        editing = false;
        draftRoofs = null;
        message = { ok: true, text: 'Enregistré pour le foyer, chiffré : la prochaine collecte demandera le profil de production à PVGIS (coordonnées arrondies à environ 1 km).' };
      })
      .catch((err: Error) => (message = { ok: false, text: err.message }))
      .finally(() => card.isConnected && rerender());
  });
}

type Typed = { v: 1; lat: number; lon: number; precision: number; commune: string; roofs: Record<keyof Roof, string | number>[] };

/** The form as typed (numbers parsed with a French comma), for parseLocation. */
function read(card: HTMLElement): Typed {
  const val = (sel: string) => card.querySelector<HTMLInputElement | HTMLSelectElement>(sel)?.value ?? '';
  const n = (s: string) => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')));
  return {
    v: 1,
    lat: n(val('#loc-lat')),
    lon: n(val('#loc-lon')),
    precision: Number(val('#loc-precision')),
    commune: val('#loc-commune'),
    roofs: [...card.querySelectorAll<HTMLElement>('[data-roof]')].map((fs) => {
      const f = (k: keyof Roof) => fs.querySelector<HTMLInputElement>(`[data-f="${k}"]`)?.value ?? '';
      return { name: f('name'), azimuth: n(f('azimuth')), tilt: n(f('tilt')), kwc: n(f('kwc')), loss: n(f('loss')) };
    }),
  };
}

/** Redraw with what was typed (a message or a roof more must not lose it). */
function keepTyped(card: HTMLElement, typed: Typed, rerender: () => void) {
  rerender();
  const set = (sel: string, v: string) => {
    const el = card.querySelector<HTMLInputElement | HTMLSelectElement>(sel);
    if (el) el.value = v;
  };
  const s = (x: number) => (Number.isFinite(x) ? String(x) : '');
  set('#loc-commune', typed.commune);
  set('#loc-lat', s(typed.lat));
  set('#loc-lon', s(typed.lon));
  set('#loc-precision', String(typed.precision));
  card.querySelectorAll<HTMLElement>('[data-roof]').forEach((fs, i) => {
    const r = typed.roofs[i];
    if (!r) return;
    for (const k of ['name', 'azimuth', 'tilt', 'kwc', 'loss'] as const) {
      const el = fs.querySelector<HTMLInputElement>(`[data-f="${k}"]`);
      if (el) el.value = typeof r[k] === 'number' ? s(r[k] as number) : String(r[k]);
    }
  });
}

/** What is wrong, in words (never the values). */
function problem(t: Typed): string {
  if (!(Math.abs(t.lat) <= 90) || !(Math.abs(t.lon) <= 180)) return 'Latitude entre −90 et 90, longitude entre −180 et 180, en degrés décimaux (par exemple 45,76 et 4,84).';
  const i = t.roofs.findIndex((r) => !parseLocation({ v: 1, lat: 0, lon: 0, precision: 1, roofs: [r] }));
  if (i >= 0) return `Toit ${i + 1} : un nom, une orientation de 0 à 359°, une pente de 0 à 90°, une puissance de 0,1 à 36 kWc et des pertes de 0 à 60 %.`;
  return 'Localisation incomplète.';
}
