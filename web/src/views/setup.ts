// #40 (S-10.3): the first-launch assistant, loaded on demand (⚙ Sources de données, and the lock
// screen when nothing was collected yet). It reads what the token of the app may read, does
// itself only what that token allows (Intuis secrets, enable and run the collection), and points
// at the right GitHub page for the rest (passphrase, GitHub Pages). The logic is in ../setup.ts.
// The token is the one of ../settings.ts: in memory for the visit, never stored.
import { alertHtml, formMsg } from '../components';
import { GROUPS, collectWorkflowState, enableCollect, hasToken, invalidFields, isOwnSite, lastCollect, listSecrets, noSaveAttrs, putSecret, runCollect, setToken } from '../settings';
import { DEMO_FACTS, INTUIS_SECRETS, STATUS_LABEL, type SetupFacts, type Step, setupSteps, setupSummary, validRepo } from '../setup';
import { html } from '../trusted';
import { esc } from '../ui';
import { currentRepo, setCurrentRepo, tokenAdvice } from './settings';

const INTUIS = GROUPS.find((g) => g.id === 'intuis')!;
const MARK: Record<Step['status'], [string, string]> = {
  fait: ['pill ok', '✓'],
  'a-faire': ['muted', '○'],
  'en-cours': ['muted', '…'],
  echec: ['ko-red', '!'],
  'a-verifier': ['muted', '?'],
};

interface Ctx {
  el: HTMLElement;
  demo: boolean;
  facts: SetupFacts;
  msg: { ok: boolean; text: string } | null;
  busy: boolean;
  /** The token to create is told by a card of the same page (⚙ Sources de données). */
  adviceNearby: boolean;
}

/** Mount the assistant in `el` (a card, or a zone of the lock screen). `adviceNearby`: the page
 *  already tells which token to create (⚙ Sources de données, card « 1. Autoriser… »). */
export function mountSetup(el: HTMLElement | null, demo: boolean, adviceNearby = false) {
  if (!el) return;
  const c: Ctx = { el, demo, facts: demo ? DEMO_FACTS : { repo: currentRepo(), token: hasToken(), onOwnSite: isOwnSite(currentRepo()) }, msg: null, busy: false, adviceNearby };
  el.addEventListener('click', (e) => onClick(c, e));
  el.addEventListener('keydown', (e) => onKeydown(e));
  if (!demo && hasToken()) void check(c);
  else draw(c);
  el.querySelector<HTMLElement>('#setup-title')?.focus();
}

function draw(c: Ctx) {
  const f = c.facts;
  const steps = setupSteps(f);
  const off = c.demo || c.busy ? ' disabled' : '';
  const login =
    !c.demo && !f.token
      ? `<div id="setup-login" class="inline-form" role="group" aria-label="Dépôt et jeton GitHub">
        <label>Dépôt<input name="repo" value="${esc(f.repo)}" ${noSaveAttrs(false)}></label>
        <label>Jeton GitHub<input name="token" ${noSaveAttrs(true)} placeholder="github_pat_…"></label>
        <button type="button" class="primary small" id="setup-check"${off}>Vérifier</button>
      </div>
      <p class="hint muted" id="setup-advice">${
        // #533 (revue design v2.0): said once per page; the lock screen has no other card
        c.adviceNearby ? 'Le jeton à créer (dépôt, permissions, expiration) est décrit juste en dessous, dans « 1. Autoriser l’application à écrire vos secrets ».' : tokenAdvice(f.repo)
      }</p>`
      : `<p>Dépôt <strong>${esc(f.repo)}</strong> <button type="button" class="link" id="setup-recheck"${off}>Vérifier à nouveau</button>${
          // revue v2.0: a mistyped repository or a token without the right access is not a dead end
          // (on the lock screen there is no ⚙ Paramètres to change them)
          c.demo ? '' : ` <button type="button" class="link" id="setup-change"${off}>Changer de dépôt ou de jeton</button>`
        }</p>`;
  c.el.innerHTML = html(`<div class="card-head"><h2 id="setup-title" tabindex="-1">Assistant de premier lancement</h2></div>
    ${c.demo ? alertHtml('info', 'Démo : un dépôt fictif à moitié installé. Rien n’est lu ni envoyé à GitHub.', { id: 'setup-demo' }) : ''}
    <p class="hint muted">Il vérifie avec le jeton ce qui est fait, fait lui-même ce que le jeton permet (secrets Intuis, activer et lancer la collecte) et donne le lien de la page GitHub pour le reste.</p>
    ${login}
    <p id="setup-summary" aria-live="polite"><strong>${esc(setupSummary(steps))}</strong></p>
    <ol class="setup-steps">${steps.map((s) => stepHtml(s, off)).join('')}</ol>
    ${formMsg(c.msg?.text ?? '', { id: 'setup-msg' })}`);
}

function stepHtml(s: Step, off: string): string {
  const [cls, mark] = MARK[s.status];
  const link = s.link ? `<p><a class="link" href="${esc(s.link.href)}" target="_blank" rel="noopener noreferrer">${esc(s.link.label)}</a></p>` : '';
  let act = '';
  if (s.action === 'save-intuis')
    act = `<fieldset class="secrets" id="setup-intuis"><legend>${esc(INTUIS.title)}</legend>${INTUIS.fields
      .map((fd) => `<label>${esc(fd.label)}<input name="${fd.name}" ${noSaveAttrs(fd.secret)} placeholder="${esc(fd.placeholder ?? '')}"${off}></label>`)
      .join('')}
      <p class="hint muted">${esc(INTUIS.help)} Seuls les champs remplis sont envoyés.</p>
      <button type="button" class="primary small" id="setup-intuis-save"${off}>Chiffrer et enregistrer dans GitHub</button></fieldset>`;
  if (s.action === 'enable-collect') act = `<button type="button" class="btn secondary small" id="setup-enable"${off}>Activer la collecte quotidienne</button>`;
  if (s.action === 'run-collect') act = `<button type="button" class="primary small" id="setup-run"${off}>Lancer la première collecte (tout l’historique)</button>`;
  return `<li data-step="${s.id}" data-status="${s.status}"><p><span class="${cls}" aria-hidden="true">${mark}</span> <strong>${esc(s.title)}</strong> <span class="muted">· ${esc(STATUS_LABEL[s.status])}</span></p>
    <p class="hint">${esc(s.text)}</p>${link}${act}</li>`;
}

/** Read what the token may read; what fails stays « à vérifier », with the message of GitHub.
 *  `after`: the outcome of the action that came before, said first. */
async function check(c: Ctx, after?: { ok: boolean; text: string }) {
  const repo = c.facts.repo;
  c.busy = true;
  c.msg = { ok: true, text: 'Vérification…' };
  draw(c);
  const [secrets, workflow, runs] = await Promise.allSettled([listSecrets(repo), collectWorkflowState(repo), lastCollect(repo)]);
  const failed = [secrets, workflow, runs].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  c.facts = {
    repo,
    token: hasToken(),
    onOwnSite: isOwnSite(repo),
    secrets: secrets.status === 'fulfilled' ? secrets.value : undefined,
    workflow: workflow.status === 'fulfilled' ? workflow.value : undefined,
    run: runs.status === 'fulfilled' ? runs.value.run : undefined,
    jobs: runs.status === 'fulfilled' ? runs.value.jobs : undefined,
  };
  c.busy = false;
  const readError = failed ? (failed.reason as Error).message : '';
  c.msg = after && !after.ok ? { ok: false, text: [after.text, readError].filter(Boolean).join(' ') } : failed ? { ok: false, text: readError } : (after ?? null);
  draw(c);
}

async function act(c: Ctx, fn: () => Promise<string>) {
  c.busy = true;
  c.msg = { ok: true, text: 'En cours…' };
  draw(c);
  let after: { ok: boolean; text: string };
  try {
    after = { ok: true, text: await fn() };
  } catch (err) {
    // #533: GitHub is read again after a failure too: the first of three secrets may be saved
    after = { ok: false, text: (err as Error).message };
  }
  await check(c, after);
}

/** #233: the values of a group, the inputs emptied right away (no <form>, nothing to save). */
function take(group: Element): Map<string, string> {
  const out = new Map<string, string>();
  for (const i of group.querySelectorAll<HTMLInputElement>('input[name]')) {
    out.set(i.name, i.value.trim());
    i.value = '';
  }
  return out;
}

function say(c: Ctx, text: string) {
  const m = c.el.querySelector<HTMLElement>('#setup-msg');
  if (m) m.textContent = text;
}

/** A field refused before anything is sent: marked, focused, the other fields kept. */
function fault(c: Ctx, input: HTMLInputElement, text: string) {
  for (const i of c.el.querySelectorAll('#setup-login input[aria-invalid]')) i.removeAttribute('aria-invalid');
  input.setAttribute('aria-invalid', 'true');
  input.focus();
  say(c, text);
}

function onClick(c: Ctx, e: Event) {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!btn || btn.disabled || c.demo) return;
  const repo = c.facts.repo;
  if (btn.id === 'setup-check') {
    const login = c.el.querySelector('#setup-login')!;
    const field = (name: string) => login.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    // #533 (#259): nothing emptied on an error, the faulty field is pointed at
    if (!validRepo(field('repo').value.trim())) return fault(c, field('repo'), 'Dépôt attendu sous la forme propriétaire/nom, par exemple vous/historique-energie.');
    if (!field('token').value.trim()) return fault(c, field('token'), 'Collez le jeton GitHub.');
    const v = take(login);
    const r = v.get('repo')!;
    setCurrentRepo(r);
    setToken(v.get('token')!);
    c.facts = { repo: r, token: true, onOwnSite: isOwnSite(r) };
    void check(c);
  } else if (btn.id === 'setup-recheck') void check(c);
  else if (btn.id === 'setup-change') {
    setToken(null); // typed again with the repository, like « Oublier le jeton » in Sources de données
    c.facts = { repo, token: false, onOwnSite: isOwnSite(repo) };
    c.msg = null;
    draw(c);
    c.el.querySelector<HTMLInputElement>('#setup-login input[name="repo"]')?.focus();
  }
  else if (btn.id === 'setup-intuis-save') {
    const group = c.el.querySelector('#setup-intuis')!;
    const inputs = [...group.querySelectorAll<HTMLInputElement>('input[name]')];
    const bad = invalidFields(inputs.map((i) => [i.name, i.value.trim()]));
    if (bad.length || !inputs.some((i) => i.value.trim())) {
      // #259: nothing emptied on an error, the faulty field is pointed at
      for (const i of inputs) {
        if (bad.some((b) => b.name === i.name)) i.setAttribute('aria-invalid', 'true');
        else i.removeAttribute('aria-invalid');
      }
      inputs.find((i) => bad.some((b) => b.name === i.name))?.focus();
      return say(c, bad.length ? bad.map((b) => `${b.label} : ${b.error}`).join(' ') : 'Aucun champ rempli.');
    }
    const entries = [...take(group)].filter(([k, v]) => v && INTUIS_SECRETS.includes(k));
    void act(c, async () => {
      for (const [k, v] of entries) await putSecret(repo, k, v);
      return `${entries.length > 1 ? `${entries.length} secrets chiffrés et enregistrés` : '1 secret chiffré et enregistré'} : ${entries.map(([k]) => k).join(', ')}.`;
    });
  } else if (btn.id === 'setup-enable')
    void act(c, async () => {
      await enableCollect(repo);
      return 'Collecte quotidienne activée.';
    });
  else if (btn.id === 'setup-run')
    void act(c, async () => {
      await runCollect(repo, true);
      return 'Première collecte lancée (tout l’historique) : quelques minutes, puis « Vérifier à nouveau ».';
    });
}

/** Enter in a field acts like the button of its group. */
function onKeydown(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (e.key !== 'Enter' || !(t instanceof HTMLInputElement)) return;
  const btn = t.closest('#setup-login, #setup-intuis')?.querySelector<HTMLButtonElement>('#setup-check, #setup-intuis-save');
  if (!btn || btn.disabled) return;
  e.preventDefault();
  btn.click();
}
