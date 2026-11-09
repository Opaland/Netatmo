// S-8.10: the deployed version, as written by the deploy workflow (build.json next to
// index.html): commit, build date, workflow run and the SHA-256 of the SHA256SUMS manifest.
// The manifest and the Pages artifact carry a GitHub build-provenance attestation;
// how to verify them is in the README (« Vérifier le site publié »).
import { escapeHtml as esc } from './charts';
import { html } from './trusted';

export interface BuildInfo {
  commit: string;
  date: string;
  repo: string;
  run: string;
  manifest: string;
}

/** Only well-formed values are kept (the file is ours, but nothing is rendered unchecked). */
export function parseBuild(x: unknown): BuildInfo | null {
  const b = x as Partial<Record<keyof BuildInfo, unknown>> | null;
  if (!b || typeof b !== 'object') return null;
  const ok =
    typeof b.commit === 'string' &&
    /^[0-9a-f]{40}$/.test(b.commit) &&
    typeof b.manifest === 'string' &&
    /^[0-9a-f]{64}$/.test(b.manifest) &&
    typeof b.repo === 'string' &&
    /^[\w.-]+\/[\w.-]+$/.test(b.repo) &&
    typeof b.date === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(b.date) &&
    typeof b.run === 'string' &&
    /^\d+$/.test(b.run);
  return ok ? (b as BuildInfo) : null;
}

export function buildCard(b: BuildInfo | null): string {
  if (!b)
    return '<h2>Version déployée</h2><p class="hint muted">Version locale ou hors ligne : pas d\'empreinte publiée à afficher.</p>';
  const gh = `https://github.com/${b.repo}`;
  return `<h2>Version déployée</h2>
    <ul class="status-list">
      <li>Commit <a href="${esc(gh)}/commit/${b.commit}" target="_blank" rel="noopener"><code>${b.commit.slice(0, 12)}</code></a>,
        construit le ${esc(b.date.slice(0, 10))} à ${esc(b.date.slice(11, 16))} UTC
        (<a href="${esc(gh)}/actions/runs/${b.run}" target="_blank" rel="noopener">journal du déploiement</a>)</li>
      <li>Empreinte SHA-256 du manifeste <a href="SHA256SUMS" target="_blank" rel="noopener"><code>SHA256SUMS</code></a> :
        <code class="hash">${b.manifest}</code></li>
    </ul>
    <p class="hint muted">Le manifeste liste l'empreinte de chaque fichier servi ; lui et l'artefact Pages portent une
      <a href="${esc(gh)}/attestations" target="_blank" rel="noopener">attestation de provenance GitHub</a>.
      Pour vérifier que le site sert bien le code du dépôt : README, « Vérifier le site publié ».</p>`;
}

/** Fills the element once build.json is read (network first: it changes at every deploy). */
export async function showBuild(el: HTMLElement | null) {
  if (!el) return;
  let b: BuildInfo | null = null;
  try {
    const r = await fetch('build.json', { cache: 'no-cache' });
    if (r.ok) b = parseBuild(await r.json());
  } catch {
    b = null;
  }
  el.innerHTML = html(buildCard(b));
}
