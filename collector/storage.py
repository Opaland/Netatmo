"""Encrypted JSON documents committed to the repository.

data/
  keyinfo.json            public: salt + PBKDF2 iterations (no secret)
  meta.enc.json           home, rooms (with category), coverage, available extras, last update
  2024.enc.json ...       {"daily":   {room: {"YYYY-MM-DD": Wh}},
                           "tariffs": {room: {"YYYY-MM-DD": [Wh $0, Wh $1, Wh $2]}},
                           "temps":   {room: {"YYYY-MM-DD": [measured °C, setpoint °C]}}}
  2024.hourly.enc.json    {"hourly":  {room: {"YYYY-MM-DDTHH": Wh}}}   (loaded on demand by the app)
  weather.enc.json        {"source": "...", "outdoor": {"YYYY-MM-DD": [min, max, mean]},
                           "indoor": {"YYYY-MM-DD": mean}}
  linky.enc.json          {"daily": {"YYYY-MM-DD": Wh}, "pmax": {"YYYY-MM-DD": kVA},
                           "curve_scan": "YYYY-MM-DD" (last day asked for the load curve)}
  2025.linky30.enc.json   {"curve":   {"YYYY-MM-DDTHH:MM": Wh}}  Linky load curve, local start of
                           each half hour (optional, loaded on demand)
  station.enc.json        Netatmo weather station: modules, daily [min, max, mean, hum, co2] and
                          small daily aggregates "nightly" / "hours" (see docs/api-notes.md)
  2025.station_h.enc.json {"hourly": {"m0": {"YYYY-MM-DDTHH": [°C, %, ppm]}}} (loaded on demand)
  netatmo-token.enc.json  rotating refresh token of the Netatmo weather station (optional)
"""

from __future__ import annotations

import base64
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .crypto import ITERATIONS, decrypt_json, encrypt_json

Daily = dict[str, dict[str, float]]  # room_id -> day -> Wh


class Store:
    def __init__(self, data_dir: Path, passphrase: str) -> None:
        self.dir = data_dir
        self.passphrase = passphrase
        self.dir.mkdir(parents=True, exist_ok=True)
        self.salt, self.iterations = self._keyinfo()
        self.meta: dict = self._read("meta") or {}
        self._docs: dict[str, dict] = {}
        self._dirty: set[str] = set()

    # ----------------------------------------------------------- files
    def _keyinfo(self) -> tuple[bytes, int]:
        path = self.dir / "keyinfo.json"
        if path.exists():
            info = json.loads(path.read_text())
            return base64.b64decode(info["salt"]), int(info["iter"])
        salt = os.urandom(16)
        path.write_text(json.dumps({"salt": base64.b64encode(salt).decode(), "iter": ITERATIONS}) + "\n")
        return salt, ITERATIONS

    def _path(self, name: str) -> Path:
        return self.dir / f"{name}.enc.json"

    def _read(self, name: str) -> dict | None:
        path = self._path(name)
        if not path.exists():
            return None
        return decrypt_json(json.loads(path.read_text()), self.passphrase)  # type: ignore[return-value]

    def _write(self, name: str, obj: dict) -> bool:
        """Write only if content changed (encryption is randomised, so compare plaintext)."""
        if self._read(name) == obj:
            return False
        env = encrypt_json(obj, self.passphrase, self.salt, self.iterations)
        self._path(name).write_text(json.dumps(env) + "\n")
        return True

    # ----------------------------------------------------------- generic documents
    def doc(self, name: str) -> dict:
        if name not in self._docs:
            self._docs[name] = self._read(name) or {}
        return self._docs[name]

    def put(self, name: str, section: str, key: str, sub: str | None, value: Any) -> None:
        """doc[section][key][sub] = value (or doc[section][key] = value when sub is None)."""
        target = self.doc(name).setdefault(section, {})
        if sub is not None:
            target = target.setdefault(key, {})
            key = sub
        if target.get(key) != value:
            target[key] = value
            self._dirty.add(name)

    def set_top(self, name: str, key: str, value: Any) -> None:
        doc = self.doc(name)
        if doc.get(key) != value:
            doc[key] = value
            self._dirty.add(name)

    def replace(self, name: str, obj: dict) -> None:
        if self.doc(name) != obj:
            self._docs[name] = obj
            self._dirty.add(name)

    # ----------------------------------------------------------- energy
    def year(self, year: int) -> Daily:
        return self.doc(str(year)).setdefault("daily", {})

    def years(self) -> list[int]:
        return self._years_of("")

    def hourly_years(self) -> list[int]:
        return self._years_of(".hourly")

    def linky_curve_years(self) -> list[int]:
        return self._years_of(".linky30")

    def _years_of(self, suffix: str) -> list[int]:
        """Years with a document named YYYY<suffix> (on disk or in memory)."""
        names = {p.name.removesuffix(".enc.json") for p in self.dir.glob("*.enc.json")}
        names |= {n for n, doc in self._docs.items() if doc}  # a document only read (absent) does not count
        return sorted(int(n[:4]) for n in names if n[:4].isdigit() and n[4:] == suffix)

    def station_hourly_years(self) -> list[int]:
        """Years with hourly weather-station readings "YYYY.station_h.enc.json"."""
        return self._years_of(".station_h")

    def delete_room(self, room_id: str) -> None:
        """Remove a room from every yearly document (daily, tariffs, temps, hourly)."""
        names = [str(y) for y in self.years()] + [f"{y}.hourly" for y in self.hourly_years()]
        for name in names:
            doc = self.doc(name)
            for section in doc.values():
                if isinstance(section, dict) and room_id in section:
                    del section[room_id]
                    self._dirty.add(name)

    def merge(self, room_id: str, day: str, wh: float) -> None:
        self.put(day[:4], "daily", room_id, day, wh)

    def _days(self) -> list[str]:
        return [d for y in self.years() for r in self.year(y).values() for d in r]

    def last_day(self) -> str | None:
        days = self._days()
        return max(days) if days else None

    def first_day(self) -> str | None:
        days = self._days()
        return min(days) if days else None

    def save(self, home: dict, rooms: list[dict], extra: dict | None = None) -> list[str]:
        changed = []
        for name in sorted(self._dirty):
            obj = _sorted(self._docs[name])
            if self._write(name, obj):
                changed.append(f"{name}.enc.json")
        self._dirty.clear()
        meta = {
            "home": home,
            "rooms": rooms,
            "years": self.years(),
            "hourly_years": self.hourly_years(),
            "linky_curve_years": self.linky_curve_years(),
            "station_hourly_years": self.station_hourly_years(),
            "first_day": self.first_day(),
            "last_day": self.last_day(),
            **(extra or {}),
        }
        # Keep `updated` out of the comparison so a no-op run produces no commit.
        if changed or {k: v for k, v in self.meta.items() if k != "updated"} != meta:
            meta["updated"] = datetime.now(UTC).isoformat(timespec="seconds")
            self._write("meta", meta)
            self.meta = meta
            changed.append("meta.enc.json")
        return changed


def _sorted(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _sorted(obj[k]) for k in sorted(obj)}
    return obj
