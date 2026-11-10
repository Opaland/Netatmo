"""#366: the wood bought for a stove (repository variable WOOD_JSON, set from ⚙ Mon logement):
checked by the collection, copied into the encrypted meta, never quoted in the public log. The app
reads it with the same limits (web/src/wood.ts, parseWood)."""

import json

import pytest

from collector import devices
from collector.__main__ import wood_config
from collector.demo import WOOD

PURCHASE = {"day": "2025-09-27", "steres": 1.5, "species": "chene", "moisture": 20, "price": 150}


def test_parse_wood_keeps_the_purchases_sorted_and_the_assumptions():
    raw = json.dumps(
        {
            "purchases": [{**PURCHASE, "day": "2026-01-24"}, PURCHASE],
            "efficiency": 65,
            "kwhPerStere": {"chene": 1900, "hetre": 99999, "constructor": 1},
        }
    )
    out = devices.parse_wood(raw)
    assert [p["day"] for p in out["purchases"]] == ["2025-09-27", "2026-01-24"]
    assert out["efficiency"] == 65
    assert out["kwhPerStere"] == {"chene": 1900}  # out of range and unknown keys dropped


@pytest.mark.parametrize(
    "bad",
    [
        "{",
        "[]",
        json.dumps({"purchases": [{**PURCHASE, "day": "2026-02-30"}]}),
        json.dumps({"purchases": [{**PURCHASE, "species": "__proto__"}]}),
        json.dumps({"purchases": [{**PURCHASE, "steres": 0}]}),
        json.dumps({"purchases": [{**PURCHASE, "moisture": True}]}),
        json.dumps({"purchases": [{**PURCHASE, "price": "150 €"}]}),
        json.dumps({"purchases": [PURCHASE] * 61}),
    ],
)
def test_parse_wood_refuses_without_quoting_the_value(bad):
    with pytest.raises(devices.WoodError) as err:
        devices.parse_wood(bad)
    assert "150" not in str(err.value) and "2026-02-30" not in str(err.value)


def test_wood_config_from_the_variable(monkeypatch, capsys):
    monkeypatch.delenv("WOOD_JSON", raising=False)
    assert wood_config() is None
    monkeypatch.setenv("WOOD_JSON", json.dumps({"purchases": [PURCHASE]}))
    assert wood_config() == {"purchases": [PURCHASE]}
    monkeypatch.setenv("WOOD_JSON", json.dumps({"purchases": [{**PURCHASE, "price": 123456789}]}))
    assert wood_config() is None
    out = capsys.readouterr()
    assert "123456789" not in out.out + out.err


def test_demo_wood_is_valid_and_in_the_meta(tmp_path):
    from collector.demo import generate
    from collector.storage import Store

    assert devices.parse_wood(json.dumps(WOOD))["purchases"] == sorted(WOOD["purchases"], key=lambda p: p["day"])
    generate(tmp_path)
    assert Store(tmp_path, "demo").meta["wood"] == WOOD
