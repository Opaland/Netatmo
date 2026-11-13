"""#29: the install guide (docs/INSTALLER.md) and its readiness script (scripts/depot_pret.py).

Only made-up passphrases and repositories here; no network (`gh` is replaced by a function)."""

import importlib.util
import json
import os
import re
import subprocess
from pathlib import Path

import pytest

from collector.crypto import encrypt_json

ROOT = Path(__file__).resolve().parents[1]
GUIDE = ROOT / "docs" / "INSTALLER.md"
README = ROOT / "README.md"

_spec = importlib.util.spec_from_file_location("depot_pret", ROOT / "scripts" / "depot_pret.py")
assert _spec and _spec.loader
dp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dp)


def _seal(path: Path, obj: object, passphrase: str) -> None:
    path.write_text(json.dumps(encrypt_json(obj, passphrase, os.urandom(16))))


# ---------------------------------------------------------------- data/


def test_data_absente_ou_vide(tmp_path):
    assert dp.check_data(tmp_path / "data", None)[0] == dp.OK
    (tmp_path / "data").mkdir()
    assert dp.check_data(tmp_path / "data", "x")[0] == dp.OK


def test_data_d_un_autre_foyer_est_a_vider(tmp_path):
    _seal(tmp_path / "meta.enc.json", {"home": {}}, "phrase du foyer d'origine")
    (tmp_path / "keyinfo.json").write_text("{}")
    status, text = dp.check_data(tmp_path, "ma phrase à moi")
    assert status == dp.TODO
    assert "étape 2" in text
    # without the passphrase, the script cannot know: it says so instead of guessing
    assert dp.check_data(tmp_path, None)[0] == dp.CHECK


def test_data_a_soi_est_ok_et_ne_dit_rien_du_contenu(tmp_path):
    _seal(tmp_path / "meta.enc.json", {"home": {"name": "Maison fictive"}}, "ma phrase à moi")
    status, text = dp.check_data(tmp_path, "ma phrase à moi")
    assert status == dp.OK
    assert "Maison fictive" not in text


def test_data_sans_meta_est_un_reste_a_vider(tmp_path):
    (tmp_path / "keyinfo.json").write_text("{}")
    assert dp.check_data(tmp_path, "x")[0] == dp.TODO


def test_meta_abime_n_est_pas_une_exception(tmp_path):
    (tmp_path / "meta.enc.json").write_text('{"v": 1}')
    assert dp.check_data(tmp_path, "x")[0] == dp.TODO


# ---------------------------------------------------------------- origin


@pytest.mark.parametrize(
    "url, name",
    [
        ("https://github.com/moi/mon-depot.git", "moi/mon-depot"),
        ("git@github.com:moi/mon-depot.git", "moi/mon-depot"),
        ("https://github.com/moi/mon-depot/", "moi/mon-depot"),
        ("https://gitlab.com/moi/mon-depot.git", None),
        ("https://github.com/moi", None),
    ],
)
def test_repo_from_url(url, name):
    assert dp.repo_from_url(url) == name


def test_origine_du_modele_est_signalee():
    assert dp.check_origin(f"https://github.com/{dp.MODEL}.git")[0] == dp.CHECK
    assert dp.check_origin(f"git@github.com:{dp.MODEL.lower()}.git")[0] == dp.CHECK
    assert dp.check_origin("https://github.com/moi/mon-depot.git")[0] == dp.OK
    assert dp.check_origin(None)[0] == dp.CHECK


# ---------------------------------------------------------------- GitHub (gh replaced)


def fake_gh(secrets=dp.REQUIRED_SECRETS, pages="workflow", private="false"):
    calls = []

    def gh(args):
        calls.append(args)
        path = args[1]
        if path.endswith("/actions/secrets"):
            return "\n".join(secrets) + "\n"
        if path.endswith("/pages"):
            if pages is None:
                raise RuntimeError("gh: Not Found (HTTP 404)")
            if isinstance(pages, RuntimeError):
                raise pages
            return pages + "\n"
        return private + "\n"

    gh.calls = calls
    return gh


def test_github_pret():
    gh = fake_gh()
    out = dp.check_github("moi/mon-depot", gh)
    assert [s for s, _ in out] == [dp.OK, dp.OK]
    # names only: never the endpoint that would give a secret's value (there is none, but no other call either)
    assert all(c[0] == "api" and c[1].startswith("repos/moi/mon-depot") for c in gh.calls)


def test_github_secret_manquant_nomme():
    out = dp.check_github("moi/mon-depot", fake_gh(secrets=dp.REQUIRED_SECRETS[:-1]))
    assert out[0][0] == dp.TODO
    assert "DATA_PASSPHRASE" in out[0][1]


def test_github_pages_absent_ou_mal_regle():
    assert dp.check_github("moi/d", fake_gh(pages=None))[1][0] == dp.TODO
    assert dp.check_github("moi/d", fake_gh(pages="legacy"))[1][0] == dp.TODO


def test_github_pages_illisible_n_est_pas_a_faire():
    # #533: a refusal or a missing `gh` says nothing of Pages (« À VÉRIFIER », like the secrets)
    for err in ("gh: Resource not accessible by integration (HTTP 403)", "gh indisponible : FileNotFoundError"):
        status, text = dp.check_github("moi/d", fake_gh(pages=RuntimeError(err)))[1]
        assert status == dp.CHECK and err in text


def test_github_prive_signale():
    out = dp.check_github("moi/d", fake_gh(private="true"))
    assert out[-1][0] == dp.CHECK


def test_main_code_de_sortie(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("DATA_PASSPHRASE", raising=False)
    data = tmp_path / "data"
    data.mkdir()
    assert dp.main(["--data", str(data), "--github", "moi/d"], gh=fake_gh(), root=tmp_path) == 0
    out = capsys.readouterr().out
    # the origin is unknown in tmp_path (no git): « Prêt. » would hide it
    assert "Prêt." not in out and "1 point(s) à vérifier" in out
    assert dp.main(["--data", str(data), "--github", "moi/d"], gh=fake_gh(pages=None), root=tmp_path) == 1
    with pytest.raises(SystemExit):
        dp.main(["--github", "pas un dépôt"], gh=fake_gh(), root=tmp_path)


def test_script_se_lance_depuis_le_depot(tmp_path):
    """Run as the guide says (python scripts/depot_pret.py): imports the collector without install."""
    env = {k: v for k, v in os.environ.items() if k not in ("DATA_PASSPHRASE", "PYTHONPATH")}
    res = subprocess.run(
        ["python", str(ROOT / "scripts" / "depot_pret.py"), "--data", str(tmp_path)],
        capture_output=True,
        text=True,
        cwd=tmp_path,
        env=env,
        check=False,
    )
    assert res.returncode == 0, res.stderr
    assert "[OK] data/ est vide" in res.stdout


# ---------------------------------------------------------------- one rule, one place (AGENTS.md §5)


def _guide_secret_table() -> list[str]:
    text = GUIDE.read_text()
    section = text.split("### Les cinq secrets obligatoires", 1)[1].split("\n### ", 1)[0]
    return re.findall(r"^\| `([A-Z_]+)` \|", section, re.M)


def test_le_guide_liste_exactement_les_secrets_obligatoires():
    assert _guide_secret_table() == list(dp.REQUIRED_SECRETS)


def test_les_secrets_obligatoires_sont_ceux_de_la_collecte():
    collect = (ROOT / ".github" / "workflows" / "collect.yml").read_text()
    for name in dp.REQUIRED_SECRETS:
        assert f"secrets.{name}" in collect, name


def test_le_readme_renvoie_au_guide_sans_recopier_les_etapes():
    readme = README.read_text()
    assert "(docs/INSTALLER.md)" in readme
    # the steps live in the guide only: the README does not list the secrets again
    assert not re.search(r"^\| `INTUIS_[A-Z_]+` \|", readme, re.M)
    assert "Use this template" not in readme


def test_le_guide_ne_promet_pas_ce_que_le_script_ne_fait_pas():
    guide = GUIDE.read_text()
    assert "scripts/depot_pret.py" in guide
    for word in (dp.OK, dp.TODO, dp.CHECK):
        assert f"**{word}**" in guide, word
