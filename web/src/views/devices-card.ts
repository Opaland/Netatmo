// v1.5: « État des appareils » card of Paramètres (lazy module) and the device section of the
// quality card. #214 modules not answering, #215 station batteries, #216 firmware, #218
// anticipation / lowering, #219 time of the Linky peak, #276 gateway restarts and Wi-Fi,
// #278 contract and Tempo colour seen by Intuis, #279 Shelly channels (names and roles).
import { ds } from '../app';
import { loadRoomState } from '../data';
import { offlineModules, peakHours, splitStopped, restarts, roomStateHours, stationHealth, typeLabel, wifiSummary } from '../devices';
import { ROLE_LABEL, type ShellyRole, readShellyPrefs, writeShellyPrefs } from '../shelly-prefs';
import { addDays } from '../aggregate';
import { esc, lastDay, longDate, table } from '../ui';
import { html } from '../trusted';
import { devicesQualityHtml, f1, intuisContractLine, plural, roomLabel } from './devices-quality';
import { stoppedRooms } from './offline-rooms';
import { alertHtml } from '../components';

const stationName = (key: string) => ds!.station?.modules?.[key]?.name ?? key;

/** Tiny inline battery curve (no chart library: this card must stay light). */
function spark(values: number[]): string {
  if (values.length < 2) return '';
  const w = 90;
  const h = 18;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - (Math.max(0, Math.min(100, v)) / 100) * h).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Batterie sur ${values.length} jours"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${pts}"/></svg>`;
}

/** Paramètres → État des appareils. */
export function mountDevices(el: HTMLElement | null) {
  if (!el) return;
  const d = ds!;
  const last = lastDay();
  const doc = d.devices;
  const parts: string[] = [];
  // #214
  // #346: a radiator switched off on purpose (⚙ Mon logement) is silent as expected, not « injoignable »
  const { off, stopped } = splitStopped(offlineModules(doc), stoppedRooms());
  for (const m of stopped) {
    parts.push(
      `<p class="hint">${esc(typeLabel(m.type).charAt(0).toUpperCase() + typeLabel(m.type).slice(1))} arrêté volontairement : ${esc(roomLabel(m.room))}, depuis le ${esc(longDate(m.stop.from))}${
        m.stop.label ? ` (${esc(m.stop.label)})` : ''
      }. Il ne répond plus et c'est normal ; réglage dans <a class="link" href="#parametres-logement">Mon logement</a>.</p>`,
    );
  }
  if (off.length) {
    parts.push(
      alertHtml(
        'warn',
        `${plural(off.length, 'module')} Intuis ne répond plus : ${off
        .map((m) => `${esc(typeLabel(m.type))} (${esc(roomLabel(m.room))}) depuis le ${esc(longDate(m.since))}`)
        .join(' ; ')}. Les jours concernés, la pièce peut afficher 0 kWh sans avoir rien consommé : ce sont des jours « module hors ligne ».`,
      ),
    );
  } else if (doc?.reach && !stopped.length) parts.push('<p class="hint muted">✓ Tous les radiateurs, relais et le chauffe-eau répondaient lors de la dernière collecte.</p>');
  // #276
  const boots = restarts(doc, addDays(last, -30));
  const wifi = wifiSummary(doc, addDays(last, -30), last);
  if (doc?.gateway) {
    parts.push(
      `<h3>Passerelle Intuis</h3><p class="hint muted">${
        boots.length ? `Redémarrée ${boots.length} fois sur 30 jours (coupure de courant probable) : ${boots.map((b) => `${esc(longDate(b.slice(0, 10)))} vers ${esc(b.slice(11))}`).join(', ')}.` : 'Aucun redémarrage sur 30 jours.'
      }${wifi ? ` Signal Wi-Fi sur ${wifi.days} jours : ${f1(wifi.mean)} en moyenne (de ${wifi.min} à ${wifi.max}, échelle de la passerelle).` : ''}</p>`,
    );
  }
  // #215
  const health = stationHealth(d.station?.health);
  if (health.length) {
    const low = health.filter((h) => h.low);
    parts.push(
      `<h3>Station Netatmo : piles et signal</h3>${
        low.length ? alertHtml('warn', `Pile faible (moins de 15 %) : ${low.map((h) => esc(stationName(h.key))).join(', ')}. Changez-la avant que les relevés s'arrêtent.`) : ''
      }${table(
        ['Module', 'Batterie', 'Évolution (90 j)', 'Signal', 'État'],
        health.map((h) => [
          esc(stationName(h.key)),
          h.battery === null ? 'secteur' : `${h.battery} %${h.low ? ' ⚠️' : ''}`,
          spark(h.trend),
          h.signal === null ? '—' : `${h.signal}${h.weakSignal ? ' (faible)' : ''}`,
          h.answering ? 'répond' : '⚠️ muet depuis plus de 6 h',
        ]),
        99,
      )}<p class="hint muted">Signal : radio (modules) ou Wi-Fi (module principal), plus le nombre est bas, meilleur il est. Une valeur par nuit.</p>`,
    );
  }
  // #219
  if (d.pmaxAt?.size) {
    const from = addDays(last, -90);
    const peak = [...d.pmax].filter(([day]) => day >= from).sort((a, b) => b[1] - a[1])[0];
    const bands = peakHours(d.pmax, d.pmaxAt, from, last)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3);
    parts.push(
      `<h3>Heure du pic de puissance Linky</h3><p class="hint muted">${
        peak && d.pmaxAt.get(peak[0]) ? `Plus fort pic des 90 derniers jours : <strong>${f1(peak[1])} kVA</strong> le ${esc(longDate(peak[0]))} à ${esc(d.pmaxAt.get(peak[0])!)}. ` : ''
      }Heures les plus fréquentes du pic quotidien : ${bands.map((b) => `${b.hour} h (${b.n} j)`).join(', ') || '—'}.</p>`,
    );
  }
  // #218 (and #214 per room), from the hourly snapshots: loaded on demand
  if (d.meta.has_roomstate) parts.push('<div id="devices-rooms"></div>');
  // #279 (#387: the forms only in ⚙ Sources de données; État des données, a reading page, links to them)
  const reading = el.dataset.reading !== undefined;
  const shelly = shellySection();
  if (!reading) parts.push(shelly);
  else if (shelly) parts.push('<p class="hint muted">Nom et rôle des compteurs Shelly à pinces : <a class="link" href="#parametres-sources">⚙ Sources de données</a>.</p>');
  // #387: firmware, power cuts of the year (formerly the « Qualité des données » card of the page)
  if (reading) parts.push(devicesQualityHtml());
  el.hidden = false;
  // #278: shown with the contract when that section is on the page (not in the demo / tenant mode)
  const contractLine = document.getElementById('contract-share') ? '' : intuisContractLine();
  el.innerHTML = html(`${reading ? '' : '<h2>État des appareils</h2>'}${contractLine}${parts.join('')}`);
  if (!reading) bindShelly(el);
  if (d.meta.has_roomstate) {
    void loadRoomState(d).then((rs) => {
      const zone = document.getElementById('devices-rooms');
      if (!zone || ds !== d || !rs?.rooms) return;
      const rows = roomStateHours(rs.rooms as never, addDays(last, -30), last).filter((r) => r.anticipating || r.lowering || r.offline);
      if (!rows.length) return;
      zone.innerHTML = html(
        `<h3>Anticipation et abaissement (30 jours)</h3>${table(
          ['Pièce', 'Anticipation (h/j)', 'Abaissement (h/j)', 'Module hors ligne'],
          rows.map((r) => [esc(roomLabel(r.room)), f1(r.anticipating / r.days), f1(r.lowering / r.days), r.offline ? `${f1(r.offline)} h (${plural(r.offlineDays.length, 'jour')})` : '—']),
          1,
        )}<p class="hint muted">Anticipation : le radiateur chauffe avant l'heure du planning pour l'atteindre à temps. Abaissement : consigne réduite (nuit, absence). Estimé à partir du relevé horaire.</p>`,
      );
    });
  }
}

/** #279: Shelly series (plugs, clamp channels): name and role, on this device only. */
function shellySection(): string {
  const plugs = ds!.shelly?.plugs ?? {};
  const series = Object.entries(plugs).filter(([, p]) => p.usable !== false && !p.channels);
  if (!series.some(([, p]) => p.parent)) return '';
  const prefs = readShellyPrefs();
  const opts = (key: string) =>
    (Object.keys(ROLE_LABEL) as ShellyRole[]).map((r) => `<option value="${r}" ${(prefs.roles[key] ?? '') === r ? 'selected' : ''}>${esc(ROLE_LABEL[r])}</option>`).join('');
  return `<h3>Compteurs Shelly à pinces</h3>
    <p class="hint muted">Une série par canal. Nommez chaque pince et indiquez son rôle : « arrivée générale » sert de contrôle, « chauffe-eau » est déjà compté par Intuis ; les deux restent hors de la décomposition des autres usages. Enregistré sur cet appareil seulement (rechargez pour l'appliquer).</p>
    ${table(
      ['Série', 'Nom', 'Rôle'],
      series
        .filter(([, p]) => p.parent)
        .map(([key, p]) => [
          esc(p.name),
          `<input data-shelly-name="${esc(key)}" value="${esc(prefs.names[key] ?? '')}" placeholder="${esc(p.name)}" maxlength="60" aria-label="Nom de ${esc(p.name)}">`,
          `<select data-shelly-role="${esc(key)}" aria-label="Rôle de ${esc(p.name)}">${opts(key)}</select>`,
        ]),
      99,
    )}`;
}

function bindShelly(el: HTMLElement) {
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const key = t.dataset.shellyName ?? t.dataset.shellyRole;
    if (!key) return;
    const prefs = readShellyPrefs();
    if (t.dataset.shellyName !== undefined) {
      if (t.value.trim()) prefs.names[key] = t.value;
      else delete prefs.names[key];
    } else if (t.value === 'main' || t.value === 'water') prefs.roles[key] = t.value;
    else delete prefs.roles[key];
    writeShellyPrefs(prefs);
  });
}

