"""#29: « mon dépôt est prêt » — read-only checks of a new household's copy (docs/INSTALLER.md).

    python scripts/depot_pret.py                         offline: data/ emptied or yours? model copy?
    DATA_PASSPHRASE=… python scripts/depot_pret.py       + data/ opens with this passphrase
    python scripts/depot_pret.py --github owner/repo     + required secrets (names only) and Pages, via `gh`

Nothing is written, no secret value is ever read (GitHub only lists secret names) and nothing about
the data is printed beyond « opens » / « does not open ». Exit code 1 while something is « À FAIRE ».
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:  # run as a script from the repository: the collector is not installed
    sys.path.insert(0, str(ROOT))

# The repository the copies are made from. Running the checks on it is not an error, only said.
MODEL = "Opaland/Netatmo"

# The secrets without which the nightly collection does nothing: the table of docs/INSTALLER.md
# lists exactly these (tests/test_depot_pret.py holds the two in step, and checks collect.yml uses them).
REQUIRED_SECRETS = (
    "INTUIS_USERNAME",
    "INTUIS_PASSWORD",
    "INTUIS_CLIENT_ID",
    "INTUIS_CLIENT_SECRET",
    "DATA_PASSPHRASE",
)

OK, TODO, CHECK = "OK", "À FAIRE", "À VÉRIFIER"

Gh = Callable[[list[str]], str]


def check_data(data_dir: Path, passphrase: str | None) -> tuple[str, str]:
    """data/ must be empty (first collection to come) or open with the household's passphrase."""
    files = sorted(p.name for p in data_dir.glob("*")) if data_dir.is_dir() else []
    if not files:
        return OK, "data/ est vide : la première collecte le remplira avec votre phrase de passe."
    if not (data_dir / "meta.enc.json").exists():
        return TODO, (
            f"data/ contient {len(files)} fichier(s) sans meta.enc.json : un reste incomplet, "
            "à supprimer en entier (docs/INSTALLER.md, étape 2)."
        )
    if not passphrase:
        return CHECK, (
            f"data/ contient {len(files)} fichier(s) chiffré(s) : ceux du foyer d'origine (à supprimer, "
            "étape 2) ou les vôtres. Relancez avec DATA_PASSPHRASE pour le savoir."
        )
    from collector.crypto import DecryptError, decrypt_json

    try:
        decrypt_json(json.loads((data_dir / "meta.enc.json").read_text()), passphrase)
    except (DecryptError, ValueError, KeyError, TypeError):
        return TODO, (
            "data/meta.enc.json ne s'ouvre pas avec cette phrase : données d'un autre foyer (ou autre "
            "phrase). Supprimez data/ en entier (docs/INSTALLER.md, étape 2)."
        )
    return OK, f"data/ s'ouvre avec votre phrase de passe ({len(files)} fichier(s))."


def check_origin(remote: str | None) -> tuple[str, str]:
    """A copy pushes to its own repository, not to the model."""
    if remote is None:
        return CHECK, "pas de dépôt distant « origin » : vérifiez que ce dossier est un clone de votre copie."
    name = repo_from_url(remote)
    if name is not None and name.lower() == MODEL.lower():
        return CHECK, (
            f"ce clone pointe sur le dépôt d'origine ({MODEL}) : pour un nouveau foyer, clonez votre "
            "copie (docs/INSTALLER.md, étape 1)."
        )
    return OK, f"dépôt distant : {name or 'autre que le dépôt d’origine'}."


def repo_from_url(url: str) -> str | None:
    """owner/name of a GitHub remote (https or ssh), None for anything else."""
    url = url.strip()
    for prefix in ("https://github.com/", "http://github.com/", "git@github.com:", "ssh://git@github.com/"):
        if url.startswith(prefix):
            rest = url[len(prefix) :].removesuffix("/").removesuffix(".git")
            parts = rest.split("/")
            if len(parts) == 2 and all(parts):
                return rest
    return None


def check_github(repo: str, gh: Gh) -> list[tuple[str, str]]:
    """Secret names and the Pages source, read through `gh api` (never a secret value)."""
    out: list[tuple[str, str]] = []
    try:
        names = set(gh(["api", f"repos/{repo}/actions/secrets", "--paginate", "--jq", ".secrets[].name"]).split())
    except RuntimeError as err:
        out.append((CHECK, f"secrets illisibles ({err}) : `gh auth login`, et un compte qui administre {repo}."))
    else:
        missing = [s for s in REQUIRED_SECRETS if s not in names]
        if missing:
            out.append((TODO, f"secrets manquants : {', '.join(missing)} (docs/INSTALLER.md, étape 4)."))
        else:
            out.append((OK, "les cinq secrets obligatoires existent (valeurs non lues)."))
    try:
        build = gh(["api", f"repos/{repo}/pages", "--jq", ".build_type"]).strip()
    except RuntimeError:
        out.append((TODO, "GitHub Pages n'est pas activé : Settings → Pages → Source : GitHub Actions (étape 5)."))
    else:
        if build == "workflow":
            out.append((OK, "GitHub Pages publie depuis GitHub Actions."))
        else:
            out.append((TODO, f"GitHub Pages publie depuis « {build} » : choisir Source : GitHub Actions (étape 5)."))
    try:
        private = gh(["api", f"repos/{repo}", "--jq", ".private"]).strip()
    except RuntimeError as err:
        out.append((CHECK, f"visibilité du dépôt illisible ({err})."))
    else:
        if private == "true":
            out.append((CHECK, "dépôt privé : Pages n'y est gratuit qu'avec certains abonnements (guide, en-tête)."))
    return out


def run_gh(args: list[str]) -> str:
    try:
        res = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=60, check=False)
    except (OSError, subprocess.TimeoutExpired) as err:
        raise RuntimeError(f"gh indisponible : {type(err).__name__}") from err
    if res.returncode != 0:
        # gh's message names the HTTP status (« Not Found », « 403 »…), never a secret value
        raise RuntimeError((res.stderr.strip().splitlines() or ["échec"])[-1][:200])
    return res.stdout


def git_origin(root: Path) -> str | None:
    try:
        res = subprocess.run(
            ["git", "-C", str(root), "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if res.returncode != 0:
        return None
    return res.stdout.strip() or None


def main(argv: list[str] | None = None, gh: Gh = run_gh, root: Path = ROOT) -> int:
    ap = argparse.ArgumentParser(description="Vérifie qu'une copie du dépôt est prête (docs/INSTALLER.md).")
    ap.add_argument("--github", metavar="PROPRIETAIRE/DEPOT", help="vérifie aussi les secrets et Pages avec `gh`")
    ap.add_argument("--data", type=Path, default=None, help="dossier des données (défaut : data/ du dépôt)")
    args = ap.parse_args(argv)
    if args.github and repo_from_url(f"https://github.com/{args.github}") is None:
        ap.error("--github attend PROPRIETAIRE/DEPOT")

    results = [
        check_data(args.data or root / "data", os.environ.get("DATA_PASSPHRASE") or None),
        check_origin(git_origin(root)),
    ]
    if args.github:
        results += check_github(args.github, gh)
    else:
        results.append((CHECK, "secrets et Pages non vérifiés : relancez avec --github PROPRIETAIRE/DEPOT."))
    for status, text in results:
        print(f"[{status}] {text}")
    todo = sum(s == TODO for s, _ in results)
    check = sum(s == CHECK for s, _ in results)
    if todo:
        print(f"{todo} point(s) à faire avant la première collecte.")
    elif check:
        print(f"Rien à faire repéré, mais {check} point(s) à vérifier ci-dessus.")
    else:
        print("Prêt.")
    return 1 if todo else 0


if __name__ == "__main__":
    raise SystemExit(main())
