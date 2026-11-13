// #583: where the end-to-end scripts write their captures, in one place (AGENTS.md §5), and the
// guard that keeps web/e2e/screenshots/ for images a CI runner produces. The CI renders in DejaVu
// Sans; twice, references were regenerated in the font of a workstation (Inter: A15, #574) and
// committed. The guard runs INSIDE the process that writes the captures (AGENTS.md §6), not in a
// hook before the command: a script asks `capturesOut()` for its folder, and gets the reference
// folder only when fontconfig gives DejaVu Sans for the families of the app (style.css:
// `system-ui, …, sans-serif`). Otherwise the captures go to e2e/screenshots-poste/ (never
// committed) and the script says why and what to do. Nothing is stopped: the gate still runs on a
// workstation, and the CI (DejaVu Sans) writes where it always did.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
/** The reference captures, committed (and uploaded by ci.yml). */
export const REFERENCE = resolve(web, "e2e/screenshots");
/** Captures made in another font: kept on the workstation, ignored by git. */
export const WORKSTATION = resolve(web, "e2e/screenshots-poste");
/** The font of the CI runner (A6, A15). */
export const CI_FONT = "DejaVu Sans";
/** The families the app asks for (style.css), as fontconfig names them. */
const FAMILIES = ["sans-serif", "system-ui"];
/** A fontconfig file that gives the CI font on a workstation (A15, A19). */
export const FONT_CONF = resolve(web, "e2e/polices-ci.conf");

/** The family fontconfig gives for `family` under `env`, null when it cannot say (no fc-match). */
export function fontOf(family, env = process.env) {
  try {
    const out = execFileSync("fc-match", ["--format=%{family[0]}", family], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/** { dir, why }: the folder the captures go to, and the sentence that says why it is not the one
 * asked (null when it is). E2E_OUT, when set, is resolved from the current folder, as before. */
export function capturesDir(env = process.env, cwd = process.cwd()) {
  const asked = env.E2E_OUT ? resolve(cwd, env.E2E_OUT) : REFERENCE;
  if (asked !== REFERENCE) return { dir: asked, why: null };
  const found = FAMILIES.map((f) => [f, fontOf(f, env)]);
  if (found.every(([, font]) => font === CI_FONT))
    return { dir: asked, why: null };
  const said = found
    .map(([f, font]) => `${f} → ${font ?? "inconnue (fc-match absent)"}`)
    .join(", ");
  return {
    dir: WORKSTATION,
    why:
      `Captures écrites dans e2e/screenshots-poste/, pas dans e2e/screenshots/ (les références) : ` +
      `police ${said}, la CI rend en ${CI_FONT} (docs/APPRENTISSAGES.md A15, A19). ` +
      `Pour régénérer les références : FONTCONFIG_FILE="${FONT_CONF}" (chemin absolu), puis vérifier « fc-match sans-serif ».`,
  };
}

/** The folder where this script writes its captures, created; the reason said once if moved. */
export function capturesOut() {
  const { dir, why } = capturesDir();
  if (why) console.warn(why);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * #596: the engine a script runs in (E2E_BROWSER=webkit, else Chromium), and the prefix of its
 * captures: a script ported to WebKit writes « webkit-<name>.png », never over the Chromium
 * references of the same name.
 */
export const BROWSER = process.env.E2E_BROWSER === "webkit" ? "webkit" : "chromium";
export const SHOT = BROWSER === "webkit" ? "webkit-" : "";
