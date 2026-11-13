"""#550: a day in two year files is read once, the value of the file of its own year, everywhere
the collector reads the year files (verify, the CSV export, the alerts, the monthly report), as
the app and the audit read them. The rule itself is held by a vector shared with the app."""

from __future__ import annotations

import argparse
import csv
import io
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from collector import __main__ as cli
from collector.storage import Store, own_year_first

ROOT = Path(__file__).resolve().parent.parent
VECTOR = json.loads((ROOT / "web/src/__fixtures__/year-files.json").read_text(encoding="utf-8"))
PASS = "phrase-deux-fichiers-123"
ROOMS = [
    {"id": "r1", "name": "Pièce A", "category": "heating"},
    {"id": "r2", "name": "Pièce B", "category": "water_heater"},
]


def test_the_rule_matches_the_app_vector():
    """Same vector as aggregate.test.ts (mergeYear): Python and TypeScript keep the same value."""
    docs = [(y, {"daily": daily}) for y, daily in VECTOR["docs"]]
    assert own_year_first(docs, "daily") == VECTOR["expected"]


@pytest.fixture
def store(tmp_path) -> Store:
    s = Store(tmp_path, PASS)
    for year, daily in VECTOR["docs"]:
        for rid, days in daily.items():
            for day, wh in days.items():
                s.put(year, "daily", rid, day, float(wh))
    s.save({"id": "h", "name": "Maison fictive"}, ROOMS)
    return Store(tmp_path, PASS)


class _S:
    def __init__(self, path: Path):
        self.data_dir = path
        self.passphrase = PASS

    def require(self, *_):
        pass


def _expected_totals() -> dict[int, dict[str, float]]:
    cat = {r["id"]: r["category"] for r in ROOMS}
    out: dict[int, dict[str, float]] = {}
    for rid, days in VECTOR["expected"].items():
        for day, wh in days.items():
            per = out.setdefault(int(day[:4]), {})
            per[cat[rid]] = per.get(cat[rid], 0) + wh
    return out


def test_totals_count_a_day_once_in_its_own_year(store):
    assert store.totals() == _expected_totals()
    # file by file, as verify printed before: the day counted in each file (kept for rekey/compare)
    assert store.file_totals()[2025] == {"heating": 1234 + 2000, "water_heater": 20}


def test_verify_prints_the_app_totals_and_the_old_ones_when_they_differ(store, capsys):
    cli.cmd_verify(_S(store.dir), argparse.Namespace())
    out = capsys.readouterr().out
    head, _, old = out.partition("Totaux fichier par fichier")
    # 2024 as the app: 1000 + 3000 Wh = 4 kWh (not 4 + 1.234 from the 2025 file)
    assert "  2024 : heating 4 kWh\n" in head
    assert "  2022 : water_heater 0 kWh\n" in head  # the day of 2022 is counted in 2022, once
    assert "  2025 : heating 3 kWh, water_heater 0 kWh\n" in old  # 1234 + 2000 Wh, file 2025


def test_verify_says_nothing_more_without_such_a_day(tmp_path, capsys):
    s = Store(tmp_path, PASS)
    s.merge("r1", "2024-01-01", 2000.0)
    s.merge("r1", "2025-01-01", 3000.0)
    s.save({"id": "h", "name": "Maison fictive"}, ROOMS)
    cli.cmd_verify(_S(tmp_path), argparse.Namespace())
    out = capsys.readouterr().out
    assert out.splitlines()[1:] == ["  2024 : heating 2 kWh", "  2025 : heating 3 kWh"]  # as before #550


def test_verify_says_nothing_more_with_tenths_of_wh(tmp_path, capsys):
    """Revue v2.3: the collector stores Wh to the tenth; the totals by day and by file add the same
    values in another order, and floats then differ in their last bits. Without a day in two
    files, verify must not say there is one (it did on the demo)."""
    s = Store(tmp_path, PASS)
    rooms = [*ROOMS, {"id": "r3", "name": "Pièce C", "category": "heating"}]
    for k, rid in enumerate(("r1", "r2", "r3")):
        for n in range(365):
            day = (date(2024, 1, 1) + timedelta(days=n)).isoformat()
            s.merge(rid, day, round(((n * 7919 + k * 104729) % 20000) / 3 + 0.1, 1))
    s.save({"id": "h", "name": "Maison fictive"}, rooms)
    cli.cmd_verify(_S(tmp_path), argparse.Namespace())
    out = capsys.readouterr().out
    assert "Totaux fichier par fichier" not in out
    assert len(out.splitlines()) == 2


def test_export_writes_one_line_per_day_with_the_own_year_value(store, tmp_path):
    target = tmp_path / "export.csv"
    cli.cmd_export(_S(store.dir), argparse.Namespace(output=str(target)))
    rows = list(csv.reader(io.StringIO(target.read_text(encoding="utf-8")), delimiter=";"))
    got = {(r[0], r[1]): r[3] for r in rows[1:]}
    assert len(rows) - 1 == len(got) == 5  # no day twice
    assert got[("2024-03-05", "Pièce A")] == "1,000"
    assert got[("2025-01-01", "Pièce A")] == "2,000"
    assert got[("2022-06-01", "Pièce B")] == "0,010"
    assert [r[0] for r in rows[1:]] == sorted(r[0] for r in rows[1:])


def test_monthly_report_reads_the_year_files_as_the_app(tmp_path):
    """The month of the report counts its days as the app does: once, wherever they are stored
    (here the 31st only in the 2025 file: the app counts it in December 2024, so does the report)."""
    from collector.insights import compute_facts

    s = Store(tmp_path, PASS)
    for d in range(1, 31):
        s.merge("r1", f"2024-12-{d:02d}", 10000.0)
    s.put("2025", "daily", "r1", "2024-12-31", 10000.0)
    s.put("2025", "daily", "r1", "2024-12-30", 99000.0)  # a second value of the 30th: not added
    s.save({"id": "h"}, ROOMS)
    assert compute_facts(Store(tmp_path, PASS), "2024-12")["chauffage_kwh"] == 310.0
