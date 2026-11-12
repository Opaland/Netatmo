"""#202: the plan of the house (secret FLOOR_PLAN_JSON) is copied into the encrypted meta, its shape
checked, never printed; an invalid one keeps the previous plan; the workflow takes it from a secret."""

import json
from pathlib import Path

import pytest

from collector import __main__ as cli
from collector.floorplan import MAX_BYTES, PlanError, parse_floor_plan

ROOT = Path(__file__).resolve().parents[1]
PLAN = {
    "levels": [
        {"id": "rdc", "rooms": [{"id": "p1", "name": "Nom-Secret-77", "x": 0, "y": 0, "w": 4, "h": 3}], "devices": []}
    ]
}
PREVIOUS = {"levels": [{"id": "etage", "rooms": [], "devices": []}]}


@pytest.fixture
def env(monkeypatch):
    monkeypatch.delenv("FLOOR_PLAN_JSON", raising=False)
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    return monkeypatch


def test_a_valid_plan_is_copied_as_it_is(env, capsys):
    env.setenv("FLOOR_PLAN_JSON", json.dumps(PLAN))
    assert cli.floor_plan(PREVIOUS) == PLAN
    assert capsys.readouterr().out == ""


def test_unset_is_not_recorded(env):
    assert cli.floor_plan(PREVIOUS) is None
    env.setenv("FLOOR_PLAN_JSON", "  ")
    assert cli.floor_plan(PREVIOUS) is None


@pytest.mark.parametrize(
    "raw",
    [
        '{"levels": "Nom-Secret-77"',
        '["Nom-Secret-77"]',
        '{"levels": []}',
        '{"rooms": ["Nom-Secret-77"]}',
        json.dumps({"levels": [{"name": "Nom-Secret-77" * 5000}]}),
    ],
)
def test_an_invalid_plan_keeps_the_previous_one_and_never_quotes_it(env, capsys, raw):
    env.setenv("FLOOR_PLAN_JSON", raw)
    assert cli.floor_plan(PREVIOUS) == PREVIOUS
    out = capsys.readouterr().out
    assert "FLOOR_PLAN_JSON ignoré" in out and "le plan précédent est conservé" in out
    assert "Nom-Secret" not in out


def test_the_size_is_bounded_like_a_github_secret():
    with pytest.raises(PlanError):
        parse_floor_plan(json.dumps({"levels": [{"x": "é" * MAX_BYTES}]}))
    assert parse_floor_plan(json.dumps(PLAN)) == PLAN


def test_extra_keys_are_not_copied():
    assert parse_floor_plan(json.dumps({**PLAN, "autre": "Nom-Secret-77"})) == PLAN


def test_the_collection_reads_the_plan_from_a_secret():
    yaml = pytest.importorskip("yaml")
    steps = yaml.safe_load((ROOT / ".github" / "workflows" / "collect.yml").read_text())["jobs"]["collect"]["steps"]
    collect = next(s for s in steps if s.get("name") == "Collecte")["env"]
    assert collect["FLOOR_PLAN_JSON"] == "${{ secrets.FLOOR_PLAN_JSON }}"
    for wf in (ROOT / ".github" / "workflows").glob("*.yml"):
        assert "vars.FLOOR_PLAN_JSON" not in wf.read_text(), wf.name
