// #583: where the end-to-end scripts write their captures, in one place (AGENTS.md §5), and the
// guard that keeps web/e2e/screenshots/ for images a CI runner produces. The CI renders in DejaVu
// Sans; twice, references were regenerated in the font of a workstation (Inter: A15, #574) and
// committed. The guard runs INSIDE the process that writes the captures (AGENTS.md §6), not in a
// hook before the command: a script asks `capturesOut()` for its folder, and gets the reference
// folder only when fontconfig gives DejaVu Sans for the families of the app (never on macOS, #655; style.css:
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

/** Runs a fontconfig tool and returns what it printed, null when the tool is absent or fails. The
 * checks below take it as a parameter, so a test simulates a workstation without touching PATH
 * (docs/APPRENTISSAGES.md A11). */
export function fontconfig(command, args, env = process.env) {
  try {
    return execFileSync(command, args, {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/** The family fontconfig gives for `family` under `env`, null when it cannot say (no fc-match). */
export function fontOf(family, env = process.env, run = fontconfig) {
  const out = run("fc-match", ["--format=%{family[0]}", family], env);
  return out?.trim() || null;
}

/** #655: whether fontconfig knows the CI font, seen through the repository's file (the setting the
 * advice leads to): false when it is not installed, null when fc-list cannot say. */
export function ciFontInstalled(env = process.env, run = fontconfig) {
  const out = run("fc-list", [CI_FONT, "family"], {
    ...env,
    FONTCONFIG_FILE: FONT_CONF,
  });
  return out === null ? null : out.trim() !== "";
}

const REGENERATE =
  "les références se régénèrent par la CI (artefact « captures-demo » du job e2e) ou sur un poste Linux";

/**
 * { dir, why }: the folder the captures go to, and the sentence that says why it is not the one
 * asked (null when it is). E2E_OUT, when set, is resolved from the current folder, as before.
 * #655 (#590 n° 2): the advice is the one of the case, since only the true one helps:
 * - macOS: Chromium draws with CoreText there, not with fontconfig, so a « DejaVu Sans » answered
 *   by fc-match says nothing of the captures: never the reference folder (the one change of
 *   behaviour; the guard had never seen a macOS workstation);
 * - no fc-match (Windows, macOS without it): nothing can be checked, the references come from the CI;
 * - DejaVu Sans not installed: the repository's fontconfig file only PREFERS it, install it first;
 * - otherwise, the repository's fontconfig file.
 * `host` ({ platform, run }) is injected by the tests (A11).
 */
export function capturesDir(
  env = process.env,
  cwd = process.cwd(),
  host = { platform: process.platform, run: fontconfig },
) {
  const asked = env.E2E_OUT ? resolve(cwd, env.E2E_OUT) : REFERENCE;
  if (asked !== REFERENCE) return { dir: asked, why: null };
  const moved = (reason, advice) => ({
    dir: WORKSTATION,
    why:
      `Captures écrites dans e2e/screenshots-poste/, pas dans e2e/screenshots/ (les références) : ` +
      `${reason}, la CI rend en ${CI_FONT} (docs/APPRENTISSAGES.md A15, A19). ${advice}`,
  });
  if (host.platform === "darwin")
    return moved(
      "macOS, où Chromium dessine avec CoreText et non avec fontconfig",
      `Sur macOS, ${REGENERATE}.`,
    );
  const found = FAMILIES.map((f) => [f, fontOf(f, env, host.run)]);
  if (found.every(([, font]) => font === null))
    return moved(
      "fc-match absent, la police de ce poste ne peut pas être vérifiée",
      `Sans fc-match, ${REGENERATE}.`,
    );
  if (found.every(([, font]) => font === CI_FONT))
    return { dir: asked, why: null };
  const said = `police ${found
    .map(([f, font]) => `${f} → ${font ?? "inconnue"}`)
    .join(", ")}`;
  if (ciFontInstalled(env, host.run) === false)
    return moved(
      said,
      `${CI_FONT} n'est pas installée sur ce poste (fc-list ne la connaît pas) : l'installer ` +
        `(paquet fonts-dejavu-core), puis FONTCONFIG_FILE="${FONT_CONF}" (chemin absolu) et vérifier « fc-match sans-serif ».`,
    );
  return moved(
    said,
    `Pour régénérer les références : FONTCONFIG_FILE="${FONT_CONF}" (chemin absolu), puis vérifier « fc-match sans-serif ».`,
  );
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
