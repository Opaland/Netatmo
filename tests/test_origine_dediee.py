"""#229 (revue de fin de v2.0): the transfer to the dedicated organisation lists, in
docs/etudes/origine-dediee.md, every file that names the current account (« Ce qui nomme l'ancien
compte »). Three files of the v2.0 named it without being listed: two lists of the same rule
(AGENTS.md §5), held here in agreement. Code and configuration only: the documentation that cites
the address is renamed with the README, and tests may keep it as an example (made-up data)."""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STUDY = ROOT / "docs" / "etudes" / "origine-dediee.md"
ACCOUNT = ("Opaland/Netatmo", "opaland.github.io")


def tracked_code_files() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    keep = []
    for path in out.split():
        if path.endswith((".md", ".png", ".json", ".lock", ".txt")) or path.startswith(("docs/", "tests/", "data/")):
            continue
        if ".test." in path or path.startswith("web/e2e/"):
            continue
        keep.append(path)
    return keep


def names_the_account(path: str) -> bool:
    try:
        text = (ROOT / path).read_text(encoding="utf-8")
    except (UnicodeDecodeError, FileNotFoundError):
        return False
    return any(a in text for a in ACCOUNT)


def test_every_file_naming_the_account_is_in_the_transfer_list():
    section = STUDY.read_text(encoding="utf-8").split("**Ce qui nomme l'ancien compte**", 1)[1]
    section = section.split("**Après, sur chaque appareil**", 1)[0]
    missing = [p for p in tracked_code_files() if names_the_account(p) and p not in section]
    assert not missing, f"à ajouter à « Ce qui nomme l'ancien compte » (origine-dediee.md) : {missing}"
