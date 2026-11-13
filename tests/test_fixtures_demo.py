"""#353: the named demo fixtures of the end-to-end tests (collector/fixtures.py)."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from collector.fixtures import FIXTURES, PASSPHRASE, build
from collector.storage import Store


def test_chaque_fixture_se_construit_et_garde_ses_cas_limites(tmp_path):
    names = build(tmp_path)
    assert names == list(FIXTURES)

    def store(name):
        return Store(tmp_path / name, PASSPHRASE)

    meta = {n: store(n).meta for n in names}
    today = datetime.now(ZoneInfo("Europe/Paris")).date()
    # trimmed histories: the first day moves, empty years disappear
    assert meta["quelques-jours"]["first_day"] >= (today - timedelta(days=13)).isoformat()
    assert meta["quelques-jours"]["years"][0] >= today.year - 1
    assert meta["une-annee"]["first_day"] >= (today - timedelta(days=366)).isoformat()
    assert meta["annee-incomplete"]["first_day"].endswith("-07-01")
    assert meta["annee-incomplete"]["contract"][0]["from"] == meta["annee-incomplete"]["first_day"]
    # devices and documents removed
    assert all(r["id"] != "r-ce" for r in meta["sans-chauffe-eau"]["rooms"])
    assert meta["sans-station"]["has_station"] is False
    assert not (tmp_path / "sans-station" / "station.enc.json").exists()
    assert "contract" not in meta["sans-prix"] and meta["sans-prix"]["has_tariffs"] is False
    assert list(store("station-sans-module").doc("station")["modules"]) == ["m0"]
    assert store("module-nom-different").doc("station")["modules"]["m2"]["name"] == "Chambre de Léa"
    # 41 days lost at Intuis, every room; Linky kept them
    s = store("trou-41-jours")
    gap = [(today - timedelta(days=d)).isoformat() for d in range(14, 56)]
    lost = gap[1:]  # [today-55, today-14[
    for d in lost:
        assert all(d not in days for days in s.doc(d[:4]).get("daily", {}).values())
    assert any(d in s.doc("linky").get("daily", {}) for d in lost)
    # the office switched off: 0 Wh, no temperature
    s = store("piece-coupee")
    recent = (today - timedelta(days=3)).isoformat()
    assert s.doc(recent[:4])["daily"]["r-bureau"].get(recent) == 0.0
    assert recent not in s.doc(recent[:4]).get("temps", {}).get("r-bureau", {})
    # null values where the documents allow them
    s = store("valeurs-nulles")
    temps = s.doc(recent[:4])["temps"]["r-salon"]
    assert temps[recent][1] is None
    # a fuller account than the demo (smoke test on real data): ten heated rooms, ids made of
    # digits with their measures, a failed source whose message holds a word without a space
    s = store("compte-charge")
    heated = [r for r in meta["compte-charge"]["rooms"] if r["category"] == "heating"]
    assert len(heated) == 10 and "3180040000" in {r["id"] for r in heated}
    assert s.doc(recent[:4])["temps"]["3180040000"] == s.doc(recent[:4])["temps"]["r-ch1"]
    assert "therm_setpoint_end_time" in meta["compte-charge"]["sources"]["intuis"]["message"]
    assert "home-assistant" in meta["compte-charge"]["sources"]
    # what ⚙ Sources names: a long label without a space, a radiator silent, long clamp names
    assert all(" " not in st["label"].split(" (")[0] for st in meta["compte-charge"]["stopped_rooms"])
    assert meta["compte-charge"]["stopped_rooms"]
    reach = s.doc("devices")["reach"]
    assert any(days.get((today - timedelta(days=1)).isoformat()) == 0 for days in reach.values())
    assert s.doc("shelly")["plugs"]["p4c0"]["name"].startswith("Compteur_à_pinces")
    # #570: the shape of the real gaps (dates only): the water heater missing all of 2024, every
    # room 41 days in 2023 while Linky started later, a room stopped since July 2025, one added
    s = store("trous-reels")
    assert not s.doc("2024")["daily"].get("r-ce")
    assert s.doc("2025")["daily"]["r-ce"].get("2025-01-11") is None
    assert s.doc("2025")["daily"]["r-ce"].get("2025-01-12") is not None
    assert not any("2023-10-01" in days for days in s.doc("2023")["daily"].values())
    assert min(s.doc("linky")["daily"]) == "2023-11-20"
    assert "2024-03-13" in s.doc("linky")["daily"]
    assert not any("2024-03-13" in days for days in s.doc("2024")["daily"].values())
    assert max(s.doc("2025")["daily"]["r-cuisine"]) == "2025-06-15"
    assert min(s.doc("2025")["daily"]["r-bureau"]) == "2025-10-20"
    assert meta["trous-reels"]["stopped_rooms"] == [
        {"room": "r-cuisine", "from": "2025-06-16", "reason": "retires", "label": ""}
    ]
