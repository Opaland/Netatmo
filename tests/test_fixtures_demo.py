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
