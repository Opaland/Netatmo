"""#459: the household settings of ⚙ Mon logement (STOPPED_ROOMS_JSON, WOOD_JSON) are repository
secrets, sealed in the browser like HOME_LOCATION_JSON (#204). During the migration the collection
still reads an older plaintext variable, after the secret, and names it in the log without its
value; the workflow never hands a plaintext variable to the collector under the setting's name.
"""

import json
from pathlib import Path

import pytest

from collector import __main__ as cli

ROOT = Path(__file__).resolve().parents[1]
STOPPED = [{"room": "r1", "from": "2025-07-01", "reason": "retires", "label": "Valeur-Secrete-42"}]
OLD = [{"room": "r2", "from": "2024-01-01", "reason": "poele", "label": "Valeur-En-Clair-17"}]


@pytest.fixture
def env(monkeypatch):
    for name in cli.HOUSEHOLD_SETTINGS:
        monkeypatch.delenv(name, raising=False)
        monkeypatch.delenv(name + cli.PLAIN_SUFFIX, raising=False)
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    return monkeypatch


def test_the_secret_comes_first_and_a_plaintext_variable_left_is_named_without_its_value(env, capsys):
    env.setenv("STOPPED_ROOMS_JSON", json.dumps(STOPPED))
    env.setenv("STOPPED_ROOMS_JSON_VARIABLE", json.dumps(OLD))
    assert [s["room"] for s in cli.stopped_config()] == ["r1"]
    out = capsys.readouterr().out
    assert "Variable en clair STOPPED_ROOMS_JSON encore présente : à migrer en secret" in out
    assert "Valeur" not in out and "r2" not in out


def test_the_plaintext_variable_is_still_read_until_it_is_migrated(env, capsys):
    purchase = {"day": "2025-10-01", "steres": 2, "species": "chene", "moisture": 20, "price": 777}
    env.setenv("WOOD_JSON_VARIABLE", json.dumps({"purchases": [purchase]}))
    assert cli.wood_config()["purchases"][0]["price"] == 777
    assert cli.household_setting_set("WOOD_JSON")
    out = capsys.readouterr().out
    assert "Variable en clair WOOD_JSON" in out and "777" not in out


def test_a_secret_alone_says_nothing_and_an_unset_setting_is_not_recorded(env, capsys):
    env.setenv("STOPPED_ROOMS_JSON", json.dumps(STOPPED))
    assert cli.stopped_config()
    assert capsys.readouterr().out == ""
    assert not cli.household_setting_set("WOOD_JSON") and cli.wood_config() is None


def test_the_collection_reads_each_household_setting_from_a_secret():
    yaml = pytest.importorskip("yaml")
    steps = yaml.safe_load((ROOT / ".github" / "workflows" / "collect.yml").read_text())["jobs"]["collect"]["steps"]
    collect = next(s for s in steps if s.get("name") == "Collecte")["env"]
    for name in (*cli.HOUSEHOLD_SETTINGS, "HOME_LOCATION_JSON"):
        assert collect[name] == f"${{{{ secrets.{name} }}}}", name
    for name in cli.HOUSEHOLD_SETTINGS:  # the migration: the old variable under another name only
        assert collect[name + cli.PLAIN_SUFFIX] == f"${{{{ vars.{name} }}}}"
    # No workflow passes a household setting from a plaintext variable under its own name.
    for wf in (ROOT / ".github" / "workflows").glob("*.yml"):
        for name in (*cli.HOUSEHOLD_SETTINGS, "HOME_LOCATION_JSON"):
            assert f"{name}: ${{{{ vars." not in wf.read_text(), (wf.name, name)


def test_the_same_household_settings_as_the_app():
    """One list each side (AGENTS.md §5): web/src/settings.ts HOUSEHOLD_SECRETS."""
    src = (ROOT / "web" / "src" / "settings.ts").read_text()
    line = next(x for x in src.splitlines() if x.startswith("export const HOUSEHOLD_SECRETS"))
    assert sorted(x for x in line.split("'")[1::2]) == sorted(cli.HOUSEHOLD_SETTINGS)
