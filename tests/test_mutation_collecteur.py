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
