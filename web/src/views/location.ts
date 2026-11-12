// #204: ⚙ Mon logement → « Localisation et toits » (réglage foyer, lazy chunk). The owner types the
// location of the home (commune or coordinates, at the precision they choose) and each roof that
// could carry panels (orientation, tilt, power, losses). Saved for the household ONLY as the
// repository secret HOME_LOCATION_JSON (sealed in this browser, never readable back); the nightly
// collection copies it into the encrypted solar.enc.json and asks PVGIS for the production
// profile with the coordinates rounded to ≈ 1 km. Nothing is kept in clear on this device: #462,
// the form as typed is a draft encrypted with the data key (local-store.ts, like the wood and the
// radiators switched off), so that a change of tab, a visit to ⚙ Sources de données or a reload
// does not lose it; it is dropped by « Enregistrer pour le foyer » and « Annuler ». The
// coordinates are shown only while editing (a draft read back reopens the form).
import { datasetDoc, ds, onLock } from '../app';
import { alertHtml } from '../components';
import { type Dataset, loadSolarDoc } from '../data';
import { onCard } from '../events';
import { loadNote, saveNote } from '../local-store';
import { hasToken, putSecret } from '../settings';
import {
  type HomeLocation,
  type LocationDraft,
  type Precision,
  type Roof,
  MAX_ROOFS,
  PRECISIONS,
  ROOF_FIELDS,
  azimuthWord,
  locationJson,
  parseLocation,
  parseLocationDraft,
  parseSolarDoc,
  roofsKwc,
} from '../solar';
import { html } from '../trusted';
import { esc, longDate } from '../ui';
import '../simulators.css';

export const LOCATION_SECRET = 'HOME_LOCATION_JSON';
const solarDoc = datasetDoc((d) => loadSolarDoc(d).then(parseSolarDoc));

const NOTE = 'location-draft';
const draftDoc = datasetDoc((d) => loadNote(NOTE, d.source, d.key, parseLocationDraft, null));

let editing = false;
/** Saved from this device during this visit (the doc of the collection comes the next night). */
let sentNow: { at: number; loc: HomeLocation } | null = null;
let message: { ok: boolean; text: string } | null = null;
/** The form as typed (#462), null when not editing or nothing typed yet. */
let draft: LocationDraft | null = null;
/** The dataset whose stored draft was taken up (once: « Annuler » must not bring it back). */
let adoptedFor: Dataset | null = null;
let saving: Promise<unknown> = Promise.resolve();
// what was typed is forgotten in memory on lock, like the decrypted data (it stays encrypted)
onLock(() => {
  editing = false;
  sentNow = null;
  message = null;
  draft = null;
  adoptedFor = null;
});

/** Keep the draft (null: drop it) on this device, encrypted, one write after the other. */
function persist() {
  const d = ds;
  if (!d) return;
  saving = saving.then(() => (ds === d ? saveNote(NOTE, d.source, d.key, draft) : false));
}

const emptyRoof = (): Record<keyof Roof, string> => ({ name: '', azimuth: '', tilt: '', kwc: '', loss: '' });
/** The form's values for a saved location (or an empty form). */
function draftOf(l: HomeLocation | null): LocationDraft {
  const roof = (r: Roof) => Object.fromEntries(ROOF_FIELDS.map((k) => [k, String(r[k])])) as Record<keyof Roof, string>;
  return l
    ? { commune: l.commune, lat: String(l.lat), lon: String(l.lon), precision: String(l.precision), roofs: l.roofs.map(roof) }
    : { commune: '', lat: '', lon: '', precision: '2', roofs: [emptyRoof()] };
}

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** One line about a location, without its coordinates. */
export function locationSummary(l: HomeLocation): string {
  const roofs = l.roofs.map((r) => `${r.name} (${nf.format(r.kwc)} kWc, ${azimuthWord(r.azimuth)}, ${r.tilt}°)`).join(' ; ');
  return `${l.commune || 'Commune non nommée'}, ${PRECISIONS[l.precision]} · ${l.roofs.length} toit${l.roofs.length > 1 ? 's' : ''}, ${nf.format(roofsKwc(l.roofs))} kWc : ${roofs}`;
}

function roofFields(i: number, r: Record<keyof Roof, string>) {
  const v = (k: keyof Roof) => esc(r[k]);
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
  // #462: a draft kept on this device reopens the form where it was left
  const stored = draftDoc.get(d, () => card.isConnected && mountLocation(card, repo));
  if (adoptedFor !== d && draftDoc.status(d) !== 'loading') {
    adoptedFor = d;
    if (stored && !draft) {
      draft = stored;
      editing = true;
    }
  }
  card.removeAttribute('aria-busy');
  const state = status === 'loading' ? 'Lecture de la localisation enregistrée…' : status === 'failed' ? 'Localisation enregistrée illisible hors ligne.' : '';
  const savedLine = sentNow
    ? `Envoyée pour le foyer à ${new Date(sentNow.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}, chiffrée : prise en compte à la prochaine collecte.`
    : shared
      ? `Enregistrée pour le foyer, chiffrée${doc?.fetched ? ` ; profil de production ${doc.source === 'demo' ? 'fictif (démo)' : 'PVGIS'} du ${longDate(doc.fetched)}` : ''}.`
      : 'Aucune localisation enregistrée pour le foyer.';
  const f = editing ? (draft ?? draftOf(current)) : null;
  const roofs = f?.roofs.length ?? 0;
  const form = f
    ? `<div class="sim-form" role="group" aria-label="Où est la maison">
      <label>Commune (facultatif, pour vous)<input type="text" id="loc-commune" maxlength="60" value="${esc(f.commune)}"></label>
      <label>Latitude (degrés décimaux)<input type="text" id="loc-lat" inputmode="decimal" autocomplete="off" spellcheck="false" value="${esc(f.lat)}" placeholder="45,76"></label>
      <label>Longitude (degrés décimaux)<input type="text" id="loc-lon" inputmode="decimal" autocomplete="off" spellcheck="false" value="${esc(f.lon)}" placeholder="4,84"></label>
      <label>Précision gardée<select id="loc-precision">${([1, 2, 3] as Precision[])
        .map((p) => `<option value="${p}"${String(p) === f.precision ? ' selected' : ''}>${esc(PRECISIONS[p])}</option>`)
        .join('')}</select></label>
    </div>
    <p class="hint muted">Les coordonnées de la mairie de votre commune suffisent pour la production solaire : elle change peu sur quelques kilomètres. Saisies ici, elles ne partent qu’au dépôt, chiffrées ; en attendant, la saisie reste chiffrée sur cet appareil.</p>
    ${f.roofs.map((r, i) => roofFields(i, r)).join('')}
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
  /** Keep what is typed, then redraw (a message or a roof more must not lose it). */
  const redraw = (next: LocationDraft) => {
    draft = next;
    persist();
    rerender();
  };
  /** Leave the form: the draft is dropped, here and on this device. */
  const close = () => {
    editing = false;
    draft = null;
    persist();
  };
  card.querySelector('#loc-edit')?.addEventListener('click', () => {
    editing = true;
    message = null;
    draft = null;
    rerender();
    card.querySelector<HTMLInputElement>('#loc-commune')?.focus();
  });
  card.querySelector('#loc-cancel')?.addEventListener('click', () => {
    close();
    message = null;
    rerender();
    card.querySelector<HTMLButtonElement>('#loc-edit')?.focus();
  });
  card.querySelector('#loc-add-roof')?.addEventListener('click', () => {
    const typed = read(card);
    if (typed.roofs.length < MAX_ROOFS) typed.roofs.push(emptyRoof());
    redraw(typed);
  });
  for (const b of card.querySelectorAll<HTMLButtonElement>('[data-roof-remove]'))
    b.addEventListener('click', () => {
      const typed = read(card);
      typed.roofs.splice(Number(b.dataset.roofRemove), 1);
      if (!typed.roofs.length) typed.roofs.push(emptyRoof());
      redraw(typed);
    });
  card.querySelector('#loc-save')?.addEventListener('click', () => {
    const typed = read(card);
    const loc = parseLocation(asLocation(typed));
    if (!loc) {
      message = { ok: false, text: problem(asLocation(typed)) };
      return redraw(typed);
    }
    if (demo) {
      sentNow = { at: Date.now(), loc };
      close();
      message = { ok: true, text: 'Démo : appliqué pour cette visite, rien n’est envoyé.' };
      return rerender();
    }
    message = { ok: true, text: 'Envoi chiffré en cours…' };
    redraw(typed);
    putSecret(repo(), LOCATION_SECRET, locationJson(loc))
      .then(() => {
        sentNow = { at: Date.now(), loc };
        close();
        message = { ok: true, text: 'Enregistré pour le foyer, chiffré : la prochaine collecte demandera le profil de production à PVGIS (coordonnées arrondies à environ 1 km).' };
      })
      .catch((err: Error) => (message = { ok: false, text: err.message }))
      .finally(() => card.isConnected && rerender());
  });
}

// #462: each keystroke updates the draft kept on this device (no redraw: the caret stays)
onCard({
  input(t) {
    const card = t.closest<HTMLElement>('#location-card');
    if (!card || !editing || !ds) return false;
    draft = read(card);
    persist();
    return true;
  },
});

type Typed = { v: 1; lat: number; lon: number; precision: number; commune: string; roofs: Record<keyof Roof, string | number>[] };

/** The form as typed (the draft). */
function read(card: HTMLElement): LocationDraft {
  const val = (sel: string) => card.querySelector<HTMLInputElement | HTMLSelectElement>(sel)?.value ?? '';
  return {
    commune: val('#loc-commune'),
    lat: val('#loc-lat'),
    lon: val('#loc-lon'),
    precision: val('#loc-precision'),
    roofs: [...card.querySelectorAll<HTMLElement>('[data-roof]')].map(
      (fs) => Object.fromEntries(ROOF_FIELDS.map((k) => [k, fs.querySelector<HTMLInputElement>(`[data-f="${k}"]`)?.value ?? ''])) as Record<keyof Roof, string>,
    ),
  };
}

/** The draft with its numbers parsed (a French comma accepted), for parseLocation. */
function asLocation(t: LocationDraft): Typed {
  const n = (s: string) => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')));
  return {
    v: 1,
    lat: n(t.lat),
    lon: n(t.lon),
    precision: Number(t.precision),
    commune: t.commune,
    roofs: t.roofs.map((r) => ({ name: r.name, azimuth: n(r.azimuth), tilt: n(r.tilt), kwc: n(r.kwc), loss: n(r.loss) })),
  };
}

/** What is wrong, in words (never the values). */
function problem(t: Typed): string {
  if (!(Math.abs(t.lat) <= 90) || !(Math.abs(t.lon) <= 180)) return 'Latitude entre −90 et 90, longitude entre −180 et 180, en degrés décimaux (par exemple 45,76 et 4,84).';
  const i = t.roofs.findIndex((r) => !parseLocation({ v: 1, lat: 0, lon: 0, precision: 1, roofs: [r] }));
  if (i >= 0) return `Toit ${i + 1} : un nom, une orientation de 0 à 359°, une pente de 0 à 90°, une puissance de 0,1 à 36 kWc et des pertes de 0 à 60 %.`;
  return 'Localisation incomplète.';
}
