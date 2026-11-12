// #452: « Niveau inférieur », loaded on demand in Air et confort. The heat the lower level costs —
// radiators of its heated rooms at equal cold, nights and days with little sun — its trend from
// winter to winter, and a dated « avant / après » for a change (door seals, a curtain). The rooms,
// the probe and the changes stay on this device, encrypted with the data key (local-store.ts).
import { rawRecords } from '../aggregate';
import { ds, householdStatus, onDatasetLoaded } from '../app';
import { isBedroom } from '../comfort';
import { loadRoom30 } from '../data';
import { DJU_BASE } from '../analysis';
import { onCard } from '../events';
import { BEDROOMS_ID } from '../household';
import { loadNote, saveNote } from '../local-store';
import { type Room30, unpack } from '../room30';
import { html } from '../trusted';
import { switchField } from '../components';
import { esc, firstDay, lastDay, longDate, pct, stationMapping, table } from '../ui';
import { fmt1 } from '../glossary';
import { HEATING_DAY_BELOW, MIN_SIDE_DAYS } from '../works';
import {
  LOWER_KINDS,
  type LowerDay,
  type LowerKind,
  type LowerMarker,
  type LowerPrefs,
  type LowerSide,
  MAX_LOWER_ROOMS,
  NO_LOWER,
  lowerBeforeAfter,
  lowerDays,
  lowerSeasons,
  nightKwh,
  sunCut,
  validLower,
} from '../lower';

const NOTE = 'lower';
let prefs: LowerPrefs | null = null;
let persisted = true;
let chosen: string | null = null; // marker day compared
let bedroomsShown = false;
let half: Room30 | null = null;
onDatasetLoaded(() => {
  prefs = null;
  persisted = true;
  chosen = null;
  half = null;
});

async function loadPrefs(): Promise<LowerPrefs> {
  if (prefs) return prefs;
  const d = ds!;
  const p = await loadNote(NOTE, d.source, d.key, validLower, NO_LOWER);
  if (ds === d) prefs = p; // #247: never another dataset's notes
  return p;
}

/** Called by comfort.ts once this module is loaded. */
export async function fillLower(showBedrooms: boolean) {
  bedroomsShown = showBedrooms;
  const d = ds;
  const p = await loadPrefs();
  if (p.rooms.length && (d!.meta.room30_years ?? []).length && !half) {
    const h = await loadRoom30(d!);
    if (ds === d) half = h;
  }
  if (ds === d) draw();
}

function draw() {
  const el = document.getElementById('lower-zone') ?? document.getElementById('lower-card');
  if (!el || !ds) return;
  el.outerHTML = html(card());
}

const rooms = () => ds!.meta.rooms.filter((r) => r.category === 'heating' && r.id !== BEDROOMS_ID);
const roomName = (id: string) => ds!.meta.rooms.find((r) => r.id === id)?.name ?? id;
const markerName = (m: LowerMarker) => `${LOWER_KINDS[m.kind]}${m.label ? ` — ${m.label}` : ''}`;
const deg = (v: number | null) => (v === null ? '—' : `${fmt1(v)} °C`);
const per = (v: number | null) => (v === null ? '—' : `${v.toFixed(2).replace('.', ',')} kWh`);

/** Station modules in a space without radiator (« Cave », a garage): candidates for the probe. */
function freeModules(): [string, string][] {
  const st = ds!.station;
  if (!st) return [];
  const linked = new Set(stationMapping(st).values());
  return Object.entries(st.modules)
    .filter(([k, m]) => m.indoor && !linked.has(k))
    .map(([k, m]) => [k, m.name]);
}

/** The bedroom module: the station module linked to the first chosen room that has one. */
function roomModule(p: LowerPrefs): string | null {
  const st = ds!.station;
  if (!st) return null;
  const map = stationMapping(st);
  for (const r of p.rooms) if (map.get(r)) return map.get(r)!;
  return null;
}

function data(p: LowerPrefs): { days: LowerDay[]; cut: number | null; nights: boolean; roomMod: string | null; radiator: string | null; probe: string | null } {
  const set = new Set(p.rooms);
  const heat = new Map<string, number>();
  for (const r of rawRecords(ds!.records)) if (r.cat === 'heating' && set.has(r.room)) heat.set(r.day, (heat.get(r.day) ?? 0) + r.kwh);
  const perRoom = p.rooms.map((id) => {
    const m = new Map<string, (number | null)[]>();
    for (const [day, d30] of half?.get(id) ?? []) {
      const hp = unpack(d30[0]);
      const hc = unpack(d30[1]);
      m.set(
        day,
        hp.map((v, i) => (v === null && hc[i] === null ? null : (v ?? 0) + (hc[i] ?? 0))),
      );
    }
    return m;
  });
  const night = nightKwh(perRoom);
  const st = ds!.station;
  const roomMod = roomModule(p);
  const probe = p.probe && st?.modules[p.probe] ? p.probe : null;
  const meanOf = (k: string | null) => new Map(k && st ? Object.entries(st.daily[k] ?? {}).map(([day, v]) => [day, v[2]]) : []);
  // the bedroom: its station module, else the temperature measured by its radiator (daily mean)
  const radiator = roomMod ? null : (p.rooms.find((r) => ds!.temps.get(r)?.size) ?? null);
  const room = roomMod ? meanOf(roomMod) : new Map([...(radiator ? ds!.temps.get(radiator)! : [])].map(([day, v]) => [day, v[0]]));
  const days = lowerDays({ heat, night, weather: ds!.weather ?? new Map(), sun: ds!.sun ?? new Map(), room, probe: meanOf(probe) });
  return { days, cut: sunCut(days), nights: night.size > 0, roomMod, radiator, probe };
}

function sideCells(s: LowerSide, probe: boolean): string[] {
  return [
    s.tOut === null ? '—' : deg(s.tOut),
    s.perDju === null ? `pas assez de jours (${s.days})` : per(s.perDju),
    s.nightPerDju === null ? (s.nights ? `pas assez de nuits (${s.nights})` : 'non relevées') : per(s.nightPerDju),
    deg(s.roomOverOut),
    ...(probe ? [deg(s.probeOverOut)] : []),
  ];
}

const kept = (s: LowerSide) => `${s.days} jour${s.days > 1 ? 's' : ''} retenu${s.days > 1 ? 's' : ''}`;

function head(probe: boolean): string[] {
  return ['Période', 'Dehors (moyenne)', 'Jours peu ensoleillés : kWh par degré-jour', 'Nuits : kWh par degré-jour', 'Chambre − dehors', ...(probe ? ['Sonde − dehors'] : [])];
}

function card(): string {
  const p = prefs!;
  const top = `<div class="card-head"><h2>Niveau inférieur <small class="muted">chaleur partie, à froid égal</small></h2></div>`;
  const masked = householdStatus().active || (!bedroomsShown && p.rooms.some((r) => isBedroom(roomName(r))));
  if (masked && p.rooms.length)
    return `<section class="card" id="lower-card">${top}
      <p class="hint muted">Le niveau inférieur compte une chambre : son détail est masqué par défaut, par respect pour ses occupants. Il reste affiché jusqu'au prochain verrouillage.</p>
      <button type="button" class="btn secondary" data-comfort="show-bedrooms">Afficher le détail des chambres</button></section>`;
  const setup = setupHtml(p);
  if (!p.rooms.length)
    return `<section class="card" id="lower-card">${top}
      <p class="hint muted">Choisissez les pièces chauffées du niveau inférieur (une chambre, l'entrée près du garage…) : la carte met en regard la consommation de leurs radiateurs, la température de la chambre et celle du dehors, à froid égal, d'un hiver à l'autre et avant / après un changement (joints de porte, rideau).</p>
      ${setup}</section>`;
  if (!ds!.weather?.size)
    return `<section class="card" id="lower-card">${top}<p class="hint muted">La comparaison à froid égal a besoin de la température extérieure (prochaine collecte).</p>${setup}</section>`;
  const x = data(p);
  const probe = !!x.probe;
  const m = p.markers.find((k) => k.day === chosen) ?? p.markers[p.markers.length - 1] ?? null;
  const ba = m ? lowerBeforeAfter(x.days, x.cut, m.day, firstDay(), lastDay()) : null;
  const seasons = lowerSeasons(x.days, x.cut).filter((s) => s.side.days || s.side.nights);
  const verdict = !m
    ? `<p>Ajoutez la date d'un changement (joints de la porte de garage, rideau…) pour comparer avant et après, à froid égal. En attendant, la consommation des radiateurs du niveau inférieur d'un hiver à l'autre :</p>`
    : `<p>${
        ba!.change !== null
          ? `À froid égal, les jours peu ensoleillés, les radiateurs du niveau inférieur ont demandé <strong>${pct(ba!.change)}</strong> d'énergie par degré-jour après « ${esc(markerName(m))} » du ${longDate(m.day)}.`
          : `Avant / après « ${esc(markerName(m))} » du ${longDate(m.day)} : il faut au moins ${MIN_SIDE_DAYS} jours de chauffe peu ensoleillés de chaque côté (${ba!.before.days} avant, ${ba!.after.days} après).`
      }${ba!.nightChange !== null ? ` La nuit (0 h – 6 h) : <strong>${pct(ba!.nightChange)}</strong>.` : ''}</p>`;
  const rows = ba
    ? [
        [`Avant <small class="muted">${longDate(ba.before.from)} → ${longDate(ba.before.to)}, ${kept(ba.before)}</small>`, ...sideCells(ba.before, probe)],
        [`Après <small class="muted">${longDate(ba.after.from)} → ${longDate(ba.after.to)}, ${kept(ba.after)}</small>`, ...sideCells(ba.after, probe)],
      ]
    : seasons.map((s) => [`Hiver ${s.season.replace('-', '–')} <small class="muted">${kept(s.side)}</small>`, ...sideCells(s.side, probe)]);
  return `<section class="card" id="lower-card">${top}
    ${verdict}
    ${rows.length ? table(head(probe), rows) : '<p class="hint muted">Pas encore de jour de chauffe pour ces pièces.</p>'}
    ${markersHtml(p)}
    ${setup}
    ${persisted ? '' : '<p class="hint muted">Ces saisies dureront jusqu\'au verrouillage : reconnectez-vous avec la phrase de passe pour qu\'elles soient enregistrées (chiffrées) sur cet appareil.</p>'}
    <details class="table-details"><summary>Hypothèses</summary>
      <ul class="hint">
        <li>À froid égal : le chauffage des pièces choisies (${esc(p.rooms.map(roomName).join(', '))}) divisé par les degrés-jours des mêmes jours (base ${DJU_BASE} °C).</li>
        <li>${
          x.cut === null
            ? 'Rayonnement solaire pas encore collecté : tous les jours de chauffe sont comptés, ensoleillés compris. Or l\'entrée et la porte de garage, plein sud, reçoivent assez de soleil pour masquer une partie des pertes.'
            : `Jours retenus : jours de chauffe (moins de ${HEATING_DAY_BELOW} °C dehors en moyenne) peu ensoleillés, c'est-à-dire avec un rayonnement du jour (Open-Meteo) d'au plus ${fmt1(x.cut)} MJ/m², la médiane de ces jours. La moitié la plus ensoleillée est écartée : au sud, le soleil masque une partie des pertes.`
        }</li>
        <li>${x.nights ? 'Nuits : de 0 h à 6 h, d\'après les relevés à la demi-heure des radiateurs, rapportées aux degrés-jours du jour entier ; sans soleil, elles comptent tous les jours de chauffe.' : 'Nuits : les relevés à la demi-heure des radiateurs ne sont pas collectés pour ces pièces.'}</li>
        <li>Avant / après : 365 jours de chaque côté de la date (comprise dans « après »), dans la limite des données ; au moins ${MIN_SIDE_DAYS} jours retenus de chaque côté. Comparez aussi la colonne « Dehors » : un hiver bien plus froid d'un côté pèse sur la comparaison.</li>
        <li>Ce n'est pas la chaleur partie seule : les radiateurs compensent aussi les murs, les fenêtres et l'escalier ouvert vers l'étage. Un changement de consigne, d'occupation ou d'usage du garage dans la même période fausse la comparaison.</li>
        <li>${
          x.roomMod
            ? `Chambre − dehors : module « ${esc(ds!.station!.modules[x.roomMod].name)} » de la station, lié à la pièce (carte « Radiateur et station »)`
            : x.radiator
              ? `Chambre − dehors : température mesurée par le radiateur de « ${esc(roomName(x.radiator))} » (aucun module de la station n'est lié à ces pièces)`
              : 'Chambre − dehors : aucune température de ces pièces'
        } ; chauffée, la pièce reste près de sa consigne : c'est l'énergie qui mesure les pertes.</li>
        ${probe ? `<li>Sonde − dehors : module « ${esc(ds!.station!.modules[x.probe!].name)} », dans un espace sans radiateur ; plus l'écart grandit à froid égal, mieux cet espace garde la chaleur.</li>` : ''}
      </ul>
      <p class="hint muted">Pièces, sonde et changements restent sur cet appareil, chiffrés avec votre phrase de passe : ils ne sont ni envoyés à GitHub, ni à l'IA.</p>
    </details>
  </section>`;
}

function markersHtml(p: LowerPrefs): string {
  const last = lastDay();
  return `<h3 class="money-h">Avant / après</h3>
    ${
      p.markers.length > 1
        ? `<label class="select"><span class="sr-only">Changement comparé</span><select id="lower-pick">${p.markers
            .map((m) => `<option value="${m.day}" ${m.day === (chosen ?? p.markers[p.markers.length - 1].day) ? 'selected' : ''}>${longDate(m.day)} · ${esc(markerName(m))}</option>`)
            .join('')}</select></label>`
        : ''
    }
    ${
      p.markers.length
        ? `<ul class="absence-list">${p.markers
            .map((m, i) => `<li><div><strong>${longDate(m.day)}</strong> · ${esc(markerName(m))}</div><button type="button" class="link" data-lower-del="${i}">Retirer</button></li>`)
            .join('')}</ul>`
        : ''
    }
    <div class="absence-add">
      <label class="money-field">Date du changement <input type="date" id="lower-day" min="${firstDay()}" max="${last}"></label>
      <label class="money-field">Nature <select id="lower-kind">${Object.entries(LOWER_KINDS)
        .map(([k, l]) => `<option value="${k}">${esc(l)}</option>`)
        .join('')}</select></label>
      <label class="money-field">Précision <small>(facultatif)</small> <input type="text" id="lower-label" maxlength="80" autocomplete="off"></label>
      <button type="button" class="primary small" id="lower-add">Ajouter</button>
    </div>
    <p class="hint" id="lower-msg" role="status"></p>`;
}

/**
 * The setup is a `.lower-setup`, not a `.table-details`: it opens by itself while no room is
 * chosen, and main.ts reads the toggle of a `.table-details` as « show every table » (Accueil grew
 * by its values table after a visit to Air et confort).
 */
function setupHtml(p: LowerPrefs): string {
  const free = freeModules();
  return `<details class="lower-setup" id="lower-setup"${p.rooms.length ? '' : ' open'}><summary>Pièces et sonde du niveau inférieur${p.rooms.length ? ` · ${p.rooms.length}` : ''}</summary>
    <fieldset class="lower-rooms"><legend>Pièces chauffées du niveau inférieur</legend>
      ${rooms()
        .map((r) => switchField(r.name, p.rooms.includes(r.id), { 'data-lower-room': r.id }))
        .join('')}
    </fieldset>
    ${
      free.length
        ? `<label class="money-field">Sonde dans un espace sans radiateur (garage, local technique) <select id="lower-probe"><option value="">Aucune</option>${free
            .map(([k, n]) => `<option value="${esc(k)}" ${p.probe === k ? 'selected' : ''}>${esc(n)}</option>`)
            .join('')}</select></label>`
        : '<p class="hint muted">Une sonde de la station placée un jour dans le garage ou le local technique, sans radiateur, sera proposée ici.</p>'
    }
  </details>`;
}

async function save(next: LowerPrefs, keepSetupOpen = false) {
  prefs = next;
  persisted = await saveNote(NOTE, ds!.source, ds!.key, next);
  if (next.rooms.length && !half && (ds!.meta.room30_years ?? []).length) half = await loadRoom30(ds!);
  draw();
  if (keepSetupOpen) document.getElementById('lower-setup')?.setAttribute('open', '');
}

// #257: the controls of the card, dispatched by main.ts.
onCard({
  change(t) {
    if (!prefs) return false;
    if (t.id === 'lower-pick') {
      chosen = t.value;
      draw();
      return true;
    }
    if (t instanceof HTMLInputElement && t.dataset.lowerRoom !== undefined) {
      const id = t.dataset.lowerRoom;
      const list = t.checked ? [...prefs.rooms.filter((r) => r !== id), id].slice(0, MAX_LOWER_ROOMS) : prefs.rooms.filter((r) => r !== id);
      void save({ ...prefs, rooms: list }, true);
      return true;
    }
    if (t.id === 'lower-probe') {
      void save({ ...prefs, probe: t.value || null }, true);
      return true;
    }
    return false;
  },
  click(el) {
    if (!prefs) return false;
    if (el.id === 'lower-add') {
      const day = (document.getElementById('lower-day') as HTMLInputElement).value;
      const kind = (document.getElementById('lower-kind') as HTMLSelectElement).value;
      const label = (document.getElementById('lower-label') as HTMLInputElement).value.trim().slice(0, 80);
      const next = validLower({ ...prefs, markers: [...prefs.markers.filter((m) => m.day !== day), { day, kind: kind as LowerKind, label }] });
      if (!next.markers.some((m) => m.day === day)) {
        document.getElementById('lower-msg')!.textContent = 'Indiquez la date du changement.';
        return true;
      }
      chosen = day;
      void save(next);
      return true;
    }
    if (el.dataset.lowerDel !== undefined) {
      const i = Number(el.dataset.lowerDel);
      void save({ ...prefs, markers: prefs.markers.filter((_, j) => j !== i) });
      return true;
    }
    return false;
  },
});
