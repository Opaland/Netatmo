// Outils → Exporter mes données → « Export recherche » (S-6.6), loaded on demand: a dialog to choose the licence,
// the date shift, a coarse location and the format, then the file is built on this device,
// checked by the S-6.4 detector, and handed to the user. Nothing is sent anywhere.
import { ds } from '../app';
import { loadCurve, loadHourly, loadStationHourly } from '../data';
import {
  CLIMATE_ZONES,
  type ClimateZone,
  LICENSES,
  type License,
  type ResearchInput,
  researchDocument,
  researchFileName,
  researchLeaks,
  toResearchCsv,
} from '../research';
import { html } from '../trusted';
import { downloadBlob } from '../download';
import { esc } from '../ui';
import { radioField, switchField } from '../components';

function form(): string {
  return `<form method="dialog" class="research-form">
    <h2 id="research-title">Export recherche <small class="muted">anonymisé</small></h2>
    <p class="hint">Un fichier horaire (quand l'heure est connue) et journalier pour caler un modèle thermique : énergie des pièces, du chauffe-eau et du logement, températures, humidité, CO₂, météo extérieure. Les pièces deviennent « Pièce A, B… », les capteurs « Capteur 1, 2… » ; aucun nom, aucun identifiant, aucune coordonnée. Le fichier est préparé sur cet appareil, rien n'est envoyé.</p>
    <label class="money-field">Licence de diffusion
      <select id="research-license" required>
        <option value="">Choisir…</option>
        ${Object.entries(LICENSES)
          .map(([k, l]) => `<option value="${k}">${esc(k)} — ${esc(l)}</option>`)
          .join('')}
      </select></label>
    ${switchField('Décaler les dates (heures comptées depuis une origine relative, dates réelles masquées)', true, { id: 'research-shift' })}
    <label class="money-field">Localisation approximative
      <select id="research-zone">
        <option value="">Non communiquée</option>
        ${CLIMATE_ZONES.map((z) => `<option value="${z}">Zone climatique ${z}</option>`).join('')}
      </select></label>
    <fieldset class="research-format"><legend>Format</legend>
      ${radioField('CSV (en-tête commenté)', true, { name: 'research-format', value: 'csv' })}
      ${radioField('JSON', false, { name: 'research-format', value: 'json' })}
    </fieldset>
    <p class="hint muted">Limites rappelées dans le fichier : un seul logement ; la météo croisée avec une archive peut aider à retrouver la région et les dates. Format décrit dans docs/export-recherche.md.</p>
    <p class="hint" id="research-status" role="status"></p>
    <div class="research-actions">
      <button type="button" class="primary small" id="research-go">Préparer et télécharger</button>
      <button type="submit" class="btn secondary" id="research-close">Fermer</button>
    </div>
  </form>`;
}

export function openResearch() {
  if (!ds) return;
  let dlg = document.getElementById('research-dialog') as HTMLDialogElement | null;
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'research-dialog';
    dlg.className = 'research-dialog';
    dlg.setAttribute('aria-labelledby', 'research-title');
    document.body.append(dlg);
  }
  dlg.innerHTML = html(form());
  const status = dlg.querySelector<HTMLElement>('#research-status')!;
  const go = dlg.querySelector<HTMLButtonElement>('#research-go')!;
  go.addEventListener('click', async () => {
    const license = dlg!.querySelector<HTMLSelectElement>('#research-license')!.value as License | '';
    if (!license) {
      status.textContent = 'Choisissez la licence sous laquelle ces données peuvent être diffusées.';
      dlg!.querySelector<HTMLSelectElement>('#research-license')!.focus();
      return;
    }
    const shift = dlg!.querySelector<HTMLInputElement>('#research-shift')!.checked;
    const zone = (dlg!.querySelector<HTMLSelectElement>('#research-zone')!.value || null) as ClimateZone | null;
    const kind = dlg!.querySelector<HTMLInputElement>('input[name=research-format]:checked')?.value === 'json' ? 'json' : 'csv';
    go.disabled = true;
    status.textContent = 'Préparation (données horaires)…';
    try {
      const text = await build(license, shift, zone, kind, (s) => (status.textContent = s));
      if (!text) return;
      const blob = new Blob([text.body], { type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' });
      downloadBlob(blob, researchFileName(kind));
      status.textContent = `Fichier prêt : ${text.rows.toLocaleString('fr-FR')} lignes, vérifié sans nom ni identifiant${shift ? ' ni date réelle' : ''}.${text.note}`;
    } catch (err) {
      status.textContent = `Export impossible : ${err instanceof Error ? err.message : err}`;
    } finally {
      go.disabled = false;
    }
  });
  dlg.addEventListener('close', () => document.querySelector<HTMLElement>('[data-research]')?.focus(), { once: true });
  dlg.showModal();
}

async function build(
  license: License,
  shift: boolean,
  zone: ClimateZone | null,
  kind: 'csv' | 'json',
  say: (s: string) => void,
): Promise<{ body: string; rows: number; note: string } | null> {
  const d = ds!;
  const missing: string[] = [];
  const opt = <T>(p: Promise<T>, what: string) =>
    p.catch(() => {
      missing.push(what);
      return null;
    });
  const [hourly, stationHourly, curve, works] = await Promise.all([
    (d.meta.hourly_years ?? []).length ? opt(loadHourly(d), 'énergie horaire') : null,
    (d.meta.station_hourly_years ?? []).length && d.station ? opt(loadStationHourly(d), 'relevés horaires de la station') : null,
    opt(loadCurve(d), 'courbe de charge Linky'),
    opt(
      import('./works').then((m) => m.loadWorks()),
      'surfaces et travaux',
    ),
  ]);
  say('Anonymisation et vérification…');
  const input: ResearchInput = {
    meta: d.meta,
    records: d.records,
    temps: d.temps,
    weather: d.weather,
    linky: d.linky,
    station: d.station,
    hourly,
    stationHourly,
    curve,
    surfaces: works?.surfaces,
    markers: works?.markers,
  };
  const doc = researchDocument(input, { license, shift, zone });
  const body = kind === 'csv' ? toResearchCsv(doc) : JSON.stringify(doc);
  const found = researchLeaks(body, input, shift, kind === 'csv' ? toResearchCsv(doc, false) : JSON.stringify({ ...doc, rows: [] }));
  if (found.length) {
    say(`Export refusé : le détecteur a trouvé ${found.length > 1 ? 'des noms ou identifiants' : 'un nom ou un identifiant'} (${found.slice(0, 3).map((f) => `« ${f} »`).join(', ')}). Renommez la pièce ou le module concerné, ou signalez-le.`);
    return null;
  }
  return { body, rows: doc.rows.length, note: missing.length ? ` Hors ligne ou indisponible : ${missing.join(', ')}.` : '' };
}
