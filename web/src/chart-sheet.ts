// #20: the « Réglages du graphique » sheet, common to every chart of the app. A modal dialog
// (bottom sheet on a phone, a window on a wide screen; Échap closes it), opened by the button
// that charts.ts writes under each chart. Each choice applies at once to all the charts and is
// kept on this device (app.ts state.chart, state.showTables). The period is not here: it is the
// one of the screen, chosen once at the top of it (docs/design/architecture-cible.md § 2).
import { setState, state } from './app';
import { CHART_DEFAULT, type ChartPrefs, SMOOTH_DAYS } from './chart-prefs';
import { switchField } from './components';
import { onceReady } from './ready';
import { html } from './trusted';

type Key = keyof ChartPrefs | 'values';

/** The choices, in the order of the sheet: label and the sentence that says what it changes. */
export const CHOICES: [Key, string, string][] = [
  ['values', 'Afficher les valeurs sous chaque graphique', 'Le tableau des valeurs, ouvert d’emblée (lisible au lecteur d’écran et en grand texte).'],
  ['points', 'Un point sur chaque valeur', 'Sinon, un point seulement là où une valeur serait isolée.'],
  ['zero', 'Axe des valeurs à partir de 0', 'Pour les températures, le CO₂ et l’humidité, qui suivent sinon leurs valeurs ; pas pour un graphique qui a sa propre plage. Les kWh et les € partent toujours de 0.'],
  ['lastYear', 'Comparer avec l’an dernier', 'La même période un an plus tôt, sur les graphiques qui la proposent.'],
  ['smooth', 'Lisser les courbes jour par jour', `Moyenne des ${SMOOTH_DAYS} derniers jours, sur les courbes d’un mois ou plus ; les valeurs exactes restent dans le tableau.`],
];

const value = (k: Key) => (k === 'values' ? state.showTables : state.chart[k]);

function form(): string {
  return `<form method="dialog" class="sheet-form">
    <div class="sheet-head"><h2 id="chart-sheet-title">Réglages du graphique</h2></div>
    <p class="hint muted">Pour tous les graphiques, sur cet appareil. La période se choisit en tête de chaque écran.</p>
    ${CHOICES.map(([k, label, hint], i) => `<div class="sheet-choice">${switchField(label, value(k), { 'data-chart-pref': k, 'aria-describedby': `chart-pref-hint-${i}` })}<p class="hint muted" id="chart-pref-hint-${i}">${hint}</p></div>`).join('')}
    <div class="sheet-actions">
      <button type="button" class="btn secondary" data-chart-reset>Rétablir les réglages d’origine</button>
      <button type="submit" class="btn primary">Fermer</button>
    </div>
  </form>`;
}

/** Apply one choice of the sheet (exported for the unit tests). */
export function applyChoice(k: Key, on: boolean) {
  if (k === 'values') setState({ showTables: on });
  else setState({ chart: { ...state.chart, [k]: on } });
}

let opener = 0;

/** Open the sheet; `from`: the place of its button among those of the page, to give the focus back to it. */
export function openChartSheet(from: number) {
  opener = from;
  let dlg = document.getElementById('chart-sheet') as HTMLDialogElement | null;
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'chart-sheet';
    dlg.className = 'sheet';
    dlg.setAttribute('aria-labelledby', 'chart-sheet-title');
    document.body.append(dlg);
    const d = dlg;
    d.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      const k = t.dataset.chartPref as Key | undefined;
      if (k) applyChoice(k, t.checked);
    });
    d.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-chart-reset]')) {
        setState({ chart: CHART_DEFAULT, showTables: false });
        for (const [k] of CHOICES) {
          const box = d.querySelector<HTMLInputElement>(`[data-chart-pref="${k}"]`);
          if (box) box.checked = value(k);
        }
      } else if (t === d) d.close(); // a tap on the backdrop
    });
    // the page was redrawn meanwhile: the focus goes back to the same chart's button
    d.addEventListener('close', () => {
      const give = () => {
        const all = document.querySelectorAll<HTMLElement>('[data-chart-settings]');
        (all[opener] ?? all[0])?.focus();
      };
      give();
      // a redraw still running when the sheet closed replaces the button: once more after it
      if (document.querySelector('#view[data-ready]')) return;
      const until = performance.now() + 3000; // never later, when the reader is elsewhere
      onceReady(() => d.open || performance.now() > until || (document.activeElement && document.activeElement !== document.body) || give());
    });
  }
  dlg.innerHTML = html(form());
  dlg.showModal();
}
