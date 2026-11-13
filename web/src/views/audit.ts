// #532: the detailed data audit in État des données (lazy module, loaded by views/etat.ts). The
// report is made by the workflow Diagnostic (case « Bilan qualité »), encrypted with the data key,
// and opened here from the file the owner downloaded: decrypted on this device, kept sealed on it.
import { ds, onLock } from '../app';
import { alertHtml } from '../components';
import { type AuditCheck, type AuditFinding, type AuditReport, AUDIT_ARTIFACT, AUDIT_FILE, auditSummary, findingsOf, openAuditFile, parseAuditReport } from '../audit-report';
import { dayShort, plural } from '../glossary';
import { loadNote, saveNote } from '../local-store';
import { html } from '../trusted';
import { esc } from '../ui';

const NOTE = 'audit-donnees';
let memory: AuditReport | null = null; // could not be sealed (private browsing…): until locking
let message: { ok: boolean; text: string } | null = null;
onLock(() => {
  memory = null;
  message = null;
});

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** Names of the rooms, station modules and plugs of this dataset, by the key the report uses. */
function names(): Map<string, string> {
  const d = ds!;
  const out = new Map<string, string>();
  for (const r of d.meta.rooms) out.set(r.id, r.name);
  for (const [k, m] of Object.entries(d.station?.modules ?? {})) out.set(k, m.name);
  for (const [k, p] of Object.entries(d.shelly?.plugs ?? {})) out.set(k, p.name);
  return out;
}

export async function mountAudit(el: HTMLElement | null): Promise<void> {
  if (!el || !ds) return;
  const d = ds;
  const stored = memory ?? (await loadNote<AuditReport | null>(NOTE, d.source, d.key, parseAuditReport, null));
  if (ds !== d || !el.isConnected) return;
  draw(el, stored);
}

/** The summary line of the fold (État des données holds in 4 screens with every card folded, #387). */
function foldSub(r: AuditReport | null): string {
  if (!r) return 'bonnes dates, chevauchements : rapport à ouvrir';
  const s = auditSummary(r);
  return s.found.length ? `${plural(s.defects, 'cas', 'cas')} impossible${s.defects > 1 ? 's' : ''}, ${plural(s.toCheck, 'cas', 'cas')} à vérifier` : 'aucun défaut trouvé';
}

function draw(el: HTMLElement, r: AuditReport | null) {
  const d = ds!;
  const open = !!el.querySelector<HTMLDetailsElement>('#audit-fold')?.open;
  el.innerHTML = html(`<details class="card fold" id="audit-fold"${open ? ' open' : ''}><summary><h2>Audit détaillé des données</h2> <span class="fold-sub">${esc(foldSub(r))}</span></summary>
    ${r ? reportHtml(r) : intro()}
    ${message ? alertHtml(message.ok ? 'info' : 'bad', esc(message.text), { role: 'status' }) : ''}
    <div class="controls">
      <button type="button" class="${r ? 'link' : 'primary'}" id="audit-open">${r ? 'Ouvrir un autre rapport' : 'Ouvrir le rapport…'}</button>
      <input type="file" id="audit-file" accept=".json,application/json" hidden>
      ${r ? '<button type="button" class="link" id="audit-forget">Oublier ce rapport</button>' : ''}
    </div></details>`);
  // a hidden input behind a button: the file input's own box does not fit 360 px at 200 %
  el.querySelector('#audit-open')?.addEventListener('click', () => el.querySelector<HTMLInputElement>('#audit-file')?.click());
  el.querySelector<HTMLInputElement>('#audit-file')?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    void file.text().then(async (content) => {
      const out = await openAuditFile(content, d.key);
      if (ds !== d) return;
      if ('error' in out) {
        message = { ok: false, text: out.error };
        return draw(el, r);
      }
      const kept = await saveNote(NOTE, d.source, d.key, out.report);
      memory = kept ? null : out.report;
      message = { ok: true, text: `Rapport du ${dayShort(out.report.made, true)} ouvert${kept ? ', gardé chiffré sur cet appareil.' : ' (gardé jusqu’au verrouillage seulement).'}` };
      draw(el, out.report);
    });
  });
  el.querySelector('#audit-forget')?.addEventListener('click', () => {
    memory = null;
    void saveNote(NOTE, d.source, d.key, null).then(() => {
      message = { ok: true, text: 'Rapport oublié sur cet appareil.' };
      draw(el, null);
    });
  });
}

function intro(): string {
  return `<p class="card-sub">Le bilan ci-dessus compte les jours. L’audit va plus loin : bonnes dates (fuseau, changements d’heure, fin de mois et d’année), chevauchements (un jour rangé deux fois, deux sources pour la même énergie, un jour estimé posé sur un jour réel), avec le jour exact et les valeurs.</p>
    <p class="hint">Il se lance sur GitHub : onglet <strong>Actions</strong>, workflow <strong>Diagnostic</strong>, « Run workflow », case <strong>Bilan qualité</strong>. Le journal ne montre que des nombres par mois ; le détail est l’artefact <strong>${esc(AUDIT_ARTIFACT)}</strong>, chiffré avec la clé de vos données. Téléchargez-le, décompressez-le, puis ouvrez ici le fichier <strong>${esc(AUDIT_FILE)}</strong> : il est déchiffré sur cet appareil, rien n’est envoyé.</p>`;
}

function reportHtml(r: AuditReport): string {
  const s = auditSummary(r);
  const who = names();
  return `<p class="card-sub">Rapport du ${esc(dayShort(r.made, true))}${r.last ? `, données jusqu’au ${esc(dayShort(r.last, true))}` : ''} : <strong>${esc(foldSub(r))}</strong>. Aucune donnée n’a été modifiée : l’audit ne fait que lire.</p>
    ${s.found.map((c) => checkHtml(r, c, who)).join('')}
    ${s.clean.length ? `<p class="hint muted">Rien trouvé : ${esc(s.clean.map((c) => c.title.toLowerCase()).join(' ; '))}.</p>` : ''}
    <details class="fold" id="audit-thresholds"><summary>Seuils utilisés${s.hypotheses ? ` (${s.hypotheses} à confirmer)` : ''}</summary>
      <ul>${r.thresholds.map((t) => `<li><strong>${esc(nf.format(t.value))}${t.unit ? ` ${esc(t.unit)}` : ''}</strong> : ${esc(t.why)}${t.hypothesis ? ' <span class="tag">hypothèse</span>' : ''}</li>`).join('')}</ul>
    </details>`;
}

function checkHtml(r: AuditReport, c: AuditCheck, who: Map<string, string>): string {
  const list = findingsOf(r, c.code);
  const more = c.count - list.length;
  return `<details class="source-quality" data-audit="${esc(c.code)}" data-level="${c.level === 'defaut' ? 'poor' : 'fair'}">
    <summary><span class="swatch" aria-hidden="true"></span><span class="sq-text"><strong>${esc(c.title)}</strong> <span class="sq-verdict">${c.level === 'defaut' ? 'impossible' : 'à vérifier'}</span></span><b class="sq-pct">${c.count}</b></summary>
    <p>${esc(cap(c.what))}.</p>
    <p class="hint">Dans l’application : ${esc(c.app)}.</p>
    <ul class="gaps">${list.map((f) => findingHtml(f, who)).join('')}</ul>
    ${more > 0 ? `<p class="hint muted">Et ${plural(more, 'autre cas', 'autres cas')}, comptés sans détail.</p>` : ''}
  </details>`;
}

function findingHtml(f: AuditFinding, who: Map<string, string>): string {
  const when = f.day ? dayShort(f.day, true) : f.at ? f.at : 'sans date';
  const name = f.room ? (who.get(f.room) ?? f.room) : '';
  const values = f.value !== undefined ? ` Valeur lue : ${nf.format(f.value)}${f.other !== undefined ? ` ; comparée à : ${nf.format(f.other)}` : ''}.` : '';
  return `<li><p><strong>${esc(when)}</strong>${name ? `, ${esc(name)}` : ''} · ${esc(f.series)}${f.doc ? ` (${esc(f.doc)}.enc.json)` : ''}</p><p>${esc(cap(f.text))}.${esc(values)}</p></li>`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
