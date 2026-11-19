// #583: the reference captures (web/e2e/screenshots/) are written only in the CI's font; the folder
// is said in one module (e2e/captures.mjs), not in each script. Seen red: with the guard removed
// (capturesDir returning the folder asked), « sous une autre police » fails.
import { describe, expect, it } from "vitest";

const load = async <T>(rel: string): Promise<T> =>
  (await import(/* @vite-ignore */ new URL(rel, import.meta.url).href)) as T;
const fsName = "node:fs";
const fs = (await import(/* @vite-ignore */ fsName)) as {
  readFileSync: (u: URL | string, enc: "utf8") => string;
  readdirSync: (u: URL) => string[];
  mkdtempSync: (p: string) => string;
  writeFileSync: (p: string, s: string) => void;
};
const osName = "node:os";
const { tmpdir } = (await import(/* @vite-ignore */ osName)) as {
  tmpdir: () => string;
};

type Where = { dir: string; why: string | null };
type Run = (
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
) => string | null;
type Host = { platform: string; run: Run };
const { capturesDir, REFERENCE, WORKSTATION, FONT_CONF } = await load<{
  capturesDir: (
    env: Record<string, string | undefined>,
    cwd?: string,
    host?: Host,
  ) => Where;
  REFERENCE: string;
  WORKSTATION: string;
  FONT_CONF: string;
}>("../e2e/captures.mjs");

/** A fontconfig file that gives another font than the CI's for the app's families. */
function otherFont(): string {
  const dir = fs.mkdtempSync(`${tmpdir()}/polices-`);
  const file = `${dir}/autre.conf`;
  fs.writeFileSync(
    file,
    `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include>` +
      `<alias binding="strong"><family>sans-serif</family><prefer><family>DejaVu Serif</family></prefer></alias>` +
      `<alias binding="strong"><family>system-ui</family><prefer><family>DejaVu Serif</family></prefer></alias></fontconfig>`,
  );
  return file;
}
const env = (extra: Record<string, string | undefined>) => ({
  ...(
    globalThis as unknown as {
      process: { env: Record<string, string | undefined> };
    }
  ).process.env,
  E2E_OUT: undefined,
  ...extra,
});

describe("#583 : les captures de référence, seulement dans la police de la CI", () => {
  it("sous une autre police, les captures ne vont pas dans le dossier des références, et le script dit pourquoi", () => {
    const w = capturesDir(env({ FONTCONFIG_FILE: otherFont() }));
    expect(w.dir).toBe(WORKSTATION);
    expect(w.dir).not.toBe(REFERENCE);
    expect(w.why).toContain("sans-serif → DejaVu Serif");
    expect(w.why).toContain("A15, A19");
    expect(w.why).toContain("FONTCONFIG_FILE=");
  });

  it("demandé explicitement (E2E_OUT), le dossier des références est gardé de même", () => {
    const w = capturesDir(
      env({ FONTCONFIG_FILE: otherFont(), E2E_OUT: REFERENCE }),
    );
    expect(w.dir).toBe(WORKSTATION);
  });

  it("dans la police de la CI (le fichier du dépôt, ou le runner), rien ne change", () => {
    expect(capturesDir(env({ FONTCONFIG_FILE: FONT_CONF }))).toEqual({
      dir: REFERENCE,
      why: null,
    });
  });

  it("un autre dossier demandé est gardé tel quel, sans rien vérifier", () => {
    expect(capturesDir(env({ E2E_OUT: "ailleurs" }), "/tmp/x")).toEqual({
      dir: "/tmp/x/ailleurs",
      why: null,
    });
  });

  // #655 (#590 n° 2): the advice is the one of the workstation's case. fontconfig is simulated by
  // an injected function, not by a fake command in PATH (A11). Seen red with the old single advice
  // (each of the three expects its own sentence) and, for macOS, with the platform not looked at.
  /** A workstation: what fc-match answers for the app's families (null: no fc-match), and
   * whether fc-list knows DejaVu Sans. */
  const host = (
    font: string | null,
    dejavu: boolean,
    platform = "linux",
  ): Host => ({
    platform,
    run: (command, args) => {
      if (font === null) return null;
      if (command === "fc-match") return font;
      if (command === "fc-list")
        return args[0] === "DejaVu Sans" && dejavu
          ? "DejaVu Sans\nDejaVu Sans\n"
          : "";
      return null;
    },
  });
  const ref = env({});

  it("#655 : DejaVu Sans absente du poste, le conseil dit de l'installer (le fichier du dépôt ne fait que la préférer)", () => {
    const w = capturesDir(ref, undefined, host("WenQuanYi Zen Hei", false));
    expect(w.dir).toBe(WORKSTATION);
    expect(w.why).toContain("sans-serif → WenQuanYi Zen Hei");
    expect(w.why).toContain("n'est pas installée");
    expect(w.why).toContain("fonts-dejavu-core");
  });

  it("#655 : DejaVu Sans installée mais pas choisie, le conseil reste le fichier du dépôt", () => {
    const w = capturesDir(ref, undefined, host("Inter", true));
    expect(w.dir).toBe(WORKSTATION);
    expect(w.why).toContain(`FONTCONFIG_FILE="${FONT_CONF}"`);
    expect(w.why).not.toContain("fonts-dejavu-core");
  });

  it("#655 : sans fc-match, le conseil renvoie à la CI (artefact captures-demo) ou à Linux, pas à fc-match", () => {
    const w = capturesDir(ref, undefined, host(null, false));
    expect(w.dir).toBe(WORKSTATION);
    expect(w.why).toContain("fc-match absent");
    expect(w.why).toContain("captures-demo");
    expect(w.why).not.toContain("FONTCONFIG_FILE");
  });

  it("#655 : sur macOS, jamais dans les références, même si fontconfig répond DejaVu Sans (Chromium y dessine avec CoreText)", () => {
    const w = capturesDir(ref, undefined, host("DejaVu Sans", true, "darwin"));
    expect(w.dir).toBe(WORKSTATION);
    expect(w.why).toContain("CoreText");
    expect(w.why).toContain("captures-demo");
  });

  it("#655 : un poste Linux où tout répond DejaVu Sans garde le dossier des références", () => {
    expect(capturesDir(ref, undefined, host("DejaVu Sans", true))).toEqual({
      dir: REFERENCE,
      why: null,
    });
  });

  it("le nom de l'artefact cité dans le conseil est celui que la CI publie", () => {
    const ci = fs.readFileSync(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );
    expect(ci).toContain("name: captures-demo");
  });

  it("un seul endroit : aucun script e2e ne choisit lui-même son dossier de captures", () => {
    const dir = new URL("../e2e/", import.meta.url);
    const scripts = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".mjs") && f !== "captures.mjs");
    const shooting = scripts.filter((f) =>
      fs.readFileSync(new URL(f, dir), "utf8").includes("screenshot("),
    );
    expect(shooting.length).toBeGreaterThan(10);
    for (const f of scripts) {
      const src = fs.readFileSync(new URL(f, dir), "utf8");
      expect(src, f).not.toMatch(/E2E_OUT|e2e\/screenshots['`]/);
      if (shooting.includes(f)) expect(src, f).toContain("capturesOut()");
    }
  });
});
