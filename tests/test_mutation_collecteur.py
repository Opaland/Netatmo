"""#640: how scripts/mutation_collecteur.py reads pytest's exit code, without running pytest.

Seen red with the old table (`{0: survivant, 4: erreur, 5: erreur}`, any other code « tué »): code 3,
pytest's internal error, counted as a killed mutant and raised the score."""

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("mutation_collecteur", ROOT / "scripts" / "mutation_collecteur.py")
assert _spec and _spec.loader
mc = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = mc  # its dataclasses look their module up
_spec.loader.exec_module(mc)


@pytest.mark.parametrize(
    ("code", "status"),
    [
        (0, "survivant"),
        (1, "tué"),  # a test failed
        (2, "tué"),  # the run stopped: a collection error, the mutant broke the import
        (3, "erreur"),  # pytest's internal error (a plugin): says nothing of the mutant
        (4, "erreur"),  # usage error
        (5, "erreur"),  # no test ran
        (7, "erreur"),  # unknown: never raises the score
        (-9, "tué (signal)"),  # pytest killed (memory run out under the mutant)
    ],
)
def test_code_de_sortie(code, status):
    assert mc.classify(code) == status


def test_une_erreur_ne_compte_pas_dans_le_score():
    # The score counts what starts with « tué » as killed (main): an error must not.
    assert not mc.classify(3).startswith("tué")


def _git(root: Path, *args: str) -> None:
    import subprocess

    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", *args],
        cwd=root,
        check=True,
        capture_output=True,
    )


def test_la_copie_ne_prend_que_les_fichiers_suivis(tmp_path):
    """#655 (#634 n° 4): an untracked, non-ignored file of the tree (an export put at the root) is not
    copied; the mutated module and a test file named on the command line are, even untracked; `data/`
    never. Seen red on the old `git ls-files -co --exclude-standard` (the export was copied)."""
    _git(tmp_path, "init", "-q")
    (tmp_path / "collector").mkdir()
    (tmp_path / "collector" / "suivi.py").write_text("X = 1\n")
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "jour.json").write_text("{}\n")
    _git(tmp_path, "add", "-f", "collector/suivi.py", "data/jour.json")
    _git(tmp_path, "commit", "-q", "-m", "init")
    (tmp_path / "export-perso.csv").write_text("fictif\n")  # untracked, not ignored
    (tmp_path / "collector" / "neuf.py").write_text("Y = 2\n")  # the module, not tracked yet
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_neuf.py").write_text("")

    files = mc._files_to_copy(["collector/neuf.py", "tests/test_neuf.py"], root=tmp_path)

    assert "export-perso.csv" not in files
    assert "data/jour.json" not in files
    assert sorted(files) == ["collector/neuf.py", "collector/suivi.py", "tests/test_neuf.py"]


def test_un_chemin_hors_du_depot_n_est_pas_copie(tmp_path):
    _git(tmp_path, "init", "-q")
    outside = tmp_path.parent / f"{tmp_path.name}-dehors.py"
    outside.write_text("")
    try:
        assert mc._files_to_copy([str(outside)], root=tmp_path) == []
        # Revue v2.9: the same file named by a relative path that climbs out (`../`) is not copied
        # either (it was: `dest / "../x.py"` would have written outside the temporary copy).
        assert mc._files_to_copy([f"../{outside.name}"], root=tmp_path) == []
        assert mc._files_to_copy([f"collector/../../{outside.name}"], root=tmp_path) == []
    finally:
        outside.unlink()
