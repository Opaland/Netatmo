// S-1.18: Home Assistant sensors imported into the archive (ha.enc.json, loaded on demand), in
// Confort: what was imported, and the agreement between an opening sensor and the open-window
// detection of the Intuis radiator of the same room.
import { addDays } from '../aggregate';
import { datasetDoc, ds, onDatasetLoaded, rerender, state } from '../app';
import { isBedroom } from '../comfort';
import { loadHa, loadRoomState } from '../data';
import { type HaDoc, KIND_LABEL, agreement, guessRoom, lastHaDay, parseHaLinks, summarize } from '../ha';
import { BEDROOMS_ID } from '../household';
import { readPref, writePref } from '../money';
import { esc, longDate, nf0, table } from '../ui';
import { type RoomState, bedroomGrouping } from '../windows';
import { NS } from '../scope';
import { fmt1 as f1 } from '../glossary';
import { howDetails, statusLine, waiting } from '../components';

// #247: loaded for the dataset shown; `doc` / `rs` / `failed` are refreshed from it at each render.
const haDoc = datasetDoc((d) =>
  Promise.all([loadHa(d), d.meta.has_roomstate ? loadRoomState(d) : Promise.resolve(null)]).then(([h, r]) => ({ doc: h ?? ({} as HaDoc), rs: r })),
);
let doc: HaDoc | null = null;
let rs: RoomState | null = null;
let failed = false;
onDatasetLoaded(() => {
  doc = null;
  rs = null;
  failed = false;
});

const head = `<div class="card-head"><h2>Capteurs Home Assistant <small class="muted">import chiffré</small></h2></div>`;
const lsLinks = () => `${NS}:ha-rooms:${ds!.source}`;

function ensure() {
  const v = haDoc.get(ds, () => state.view === 'confort' && rerender());
  doc = v?.doc ?? null;
  rs = v?.rs ?? null;
  failed = haDoc.status(ds) === 'failed';
}

/** Room chosen on this device for each opening sensor ('' = none), else guessed from the names. */
function links(): Record<string, string> {
  try {
    return parseHaLinks(JSON.parse(readPref(lsLinks()) ?? '{}'));
  } catch {
    return {};
  }
}

function heated() {
  return ds!.meta.rooms.filter((r) => r.category === 'heating');
}

export function haCard(showBedrooms: boolean): string {
  if (!ds!.meta.has_ha) return '';
  ensure();
  if (!doc) return `<section class="card" id="ha-card">${head}${failed ? statusLine('Import Home Assistant indisponible.') : waiting('de l’import Home Assistant')}</section>`;
  const last = lastHaDay(doc);
  if (!last) return '';
  const from = addDays(last, -29);
  const sums = summarize(doc, from, last);
  const rooms = heated();
  const saved = links();
  const roomOf = (key: string) => (key in saved ? saved[key] : guessRoom(doc!.sensors?.[key] ?? {}, rooms)) || '';
  const isPrivate = (key: string, name: string) => {
    const room = rooms.find((r) => r.id === roomOf(key));
    return !showBedrooms && (isBedroom(name) || room?.id === BEDROOMS_ID || (!!room && isBedroom(room.name)));
  };
  const rows = sums.map((s) => {
    const opening = s.kind === 'opening' || s.kind === 'binary';
    const hidden = opening && isPrivate(s.key, s.name);
    const value = !s.days
      ? '—'
      : opening
        ? hidden
          ? 'chambre : détail masqué'
          : `${f1(s.onHours)} h, ${nf0.format(s.openings)} ouverture${s.openings > 1 ? 's' : ''}`
        : s.kind === 'energy'
          ? `${f1(s.kwh)} kWh`
          : s.mean === null
            ? '—'
            : `moyenne ${f1(s.mean)} ${esc(s.unit)} (${f1(s.min ?? s.mean)} à ${f1(s.max ?? s.mean)})`;
    return [esc(s.name), KIND_LABEL[s.kind] ?? esc(s.kind), s.first ? `${esc(longDate(s.first))} → ${esc(longDate(s.last!))}` : '—', value];
  });
  const openings = sums.filter((s) => s.kind === 'opening');
  const anyPrivate = openings.some((s) => isPrivate(s.key, s.name));
  return `<section class="card" id="ha-card">${head}
    <p class="hint muted">Un total par jour, versé depuis Home Assistant${
      doc.imported ? ` (dernier import le ${esc(longDate(doc.imported.slice(0, 10)))})` : ''
    }. GitHub ne lit rien dans Home Assistant.</p>
    ${howDetails("Pour l'installateur", '<p class="hint muted">Import : <code>python -m collector import-ha</code>, décrit dans <code>docs/import-ha.md</code> du dépôt.</p>')}
    ${table(['Capteur', 'Type', 'Jours importés', '30 derniers jours importés'], rows, 99)}
    ${openings.length ? agreementBlock(openings.map((s) => ({ key: s.key, name: s.name, hidden: isPrivate(s.key, s.name) })), roomOf, rooms) : ''}
    ${anyPrivate ? '<button type="button" class="btn secondary" data-comfort="show-bedrooms">Afficher le détail des chambres</button>' : ''}
  </section>`;
}

function agreementBlock(sensors: { key: string; name: string; hidden: boolean }[], roomOf: (k: string) => string, rooms: { id: string; name: string }[]) {
  const items = sensors.map((s) => {
    const room = roomOf(s.key);
    const select = `<label class="select"><span class="sr-only">Pièce Intuis de ${esc(s.name)}</span><select data-ha-room="${esc(s.key)}">
      <option value="">— aucune pièce —</option>${rooms.map((r) => `<option value="${esc(r.id)}" ${r.id === room ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>`;
    let res: string;
    if (!room) res = 'Choisissez la pièce équipée du radiateur pour comparer.';
    else if (!rs) res = 'Pas de relevé horaire de l\'état des pièces : rien à comparer (voir la carte ci-dessus).';
    else {
      const group = bedroomGrouping(ds!.meta.rooms, true);
      const raw = Object.keys(rs.rooms ?? {}).filter((r) => group(r) === room);
      const a = agreement(doc!.daily?.[s.key] ?? {}, rs, raw);
      if (!a.days) res = 'Aucun jour couvert à la fois par le capteur et par le relevé Intuis.';
      else if (s.hidden) res = `Accord sur <strong>${nf0.format(a.rate! * 100)} %</strong> des ${a.days} jours couverts par les deux (détail masqué : chambre).`;
      else
        res = `Accord sur <strong>${nf0.format(a.rate! * 100)} %</strong> des ${a.days} jours couverts par les deux : ouverte pour les deux ${a.bothOpen} j, capteur seul ${a.sensorOnly} j, radiateur seul ${a.intuisOnly} j, fermée pour les deux ${a.bothClosed} j. Heures d'ouverture : capteur ${f1(a.sensorHours)} h, radiateur ${f1(a.intuisHours)} h.`;
    }
    return `<li><div><strong>${esc(s.name)}</strong> ${select}</div><p class="hint" id="ha-agree-${esc(s.key)}">${res}</p></li>`;
  });
  return `<h3 class="sub-title">Capteur d'ouverture et fenêtre ouverte Intuis <small class="muted">taux d'accord par jour</small></h3>
    <ul class="plain ha-agree">${items.join('')}</ul>
    ${howDetails('Comment c’est comparé', "<p class=\"hint muted\">Un jour compte « ouvert » pour une source à partir de 30 minutes d'ouverture. Le radiateur détecte une fenêtre ouverte par une chute rapide de température : une aération courte, ou par temps doux, peut lui échapper (« capteur seul ») ; une porte restée ouverte sur une pièce froide peut le tromper (« radiateur seul »). La pièce choisie est gardée sur cet appareil.</p>")}`;
}

export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  const key = t.dataset.haRoom;
  if (key === undefined) return false;
  writePref(lsLinks(), JSON.stringify({ ...links(), [key]: t.value }));
  rerender();
  return true;
}
