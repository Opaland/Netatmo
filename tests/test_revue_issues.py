"""S-1.16: findings of a review agent → issues (validation and rendering only, no network)."""

import importlib.util
import json
from pathlib import Path

import pytest

_path = Path(__file__).parent.parent / "scripts" / "revue_issues.py"
_spec = importlib.util.spec_from_file_location("revue_issues", _path)
ri = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ri)


def finding(**kw):
    f = {
        "titre": "Nom de pièce dans un journal",
        "gravite": "majeure",
        "categorie": "sécurité",
        "fichiers": ["collector/__main__.py:12"],
        "constat": "Le nom est écrit dans le journal public.",
        "proposition": "Écrire un compte à la place.",
        "verification": "Test sur la sortie du journal.",
    }
    f.update(kw)
    return f


def doc(*findings, kind="code"):
    return {"revue": kind, "version": "v1.4", "perimetre": "git diff v1.3..HEAD", "constats": list(findings)}


def test_valid_document_sorted_by_severity():
    d = ri.validate(doc(finding(gravite="mineure", titre="b"), finding(gravite="critique", titre="a")))
    assert [f["gravite"] for f in d["constats"]] == ["critique", "mineure"]


def test_empty_review_is_valid():
    assert ri.validate(doc())["constats"] == []


@pytest.mark.parametrize(
    "bad",
    [
        {"gravite": "bloquante"},
        {"categorie": "goût"},
        {"fichiers": []},
        {"titre": ""},
        {"titre": "x" * 101},
        {"constat": None},
    ],
)
def test_invalid_findings_are_refused(bad):
    with pytest.raises(ri.Invalid, match="constat 1"):
        ri.validate(doc(finding(**bad)))


def test_design_categories_differ_from_code():
    ri.validate(doc(finding(categorie="accessibilité"), kind="design"))
    with pytest.raises(ri.Invalid):
        ri.validate(doc(finding(categorie="accessibilité"), kind="code"))


def test_labels_title_and_body():
    d = ri.validate(doc(finding(constat="Voir @quelquun et `code`", categorie="mobile"), kind="design"))
    f = d["constats"][0]
    assert ri.issue_labels("design", f) == ["revue-design", "gravité: majeure", "design"]
    assert ri.issue_title("design", f) == "Revue design · Nom de pièce dans un journal"
    body = ri.issue_body(d, f)
    assert "@quelquun" not in body  # no mention chosen by the model
    assert "`collector/__main__.py:12`" in body
    assert "**Vérification**" in body


def test_cli_check_mode(tmp_path, capsys):
    p = tmp_path / "c.json"
    p.write_text(json.dumps(doc(finding())), encoding="utf-8")
    assert ri.main([str(p)]) == 0
    assert "1 majeure" in capsys.readouterr().out
    p.write_text("{", encoding="utf-8")
    assert ri.main([str(p)]) == 1
