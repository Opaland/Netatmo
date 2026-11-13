"""Encrypted JSON documents committed to the repository.

data/
  keyinfo.json            public: salt + key derivation (PBKDF2 iterations, or Argon2id since #139; no secret)
  meta.enc.json           home, rooms (with category), coverage, available extras, last update
  2024.enc.json ...       {"daily":   {room: {"YYYY-MM-DD": Wh}},
                           "tariffs": {room: {"YYYY-MM-DD": [Wh $0, Wh $1, Wh $2]}},
                           "temps":   {room: {"YYYY-MM-DD": [measured °C, setpoint °C]}},
                           "estimated": {room: {"YYYY-MM-DD": 1}}  (day spread from a monthly total),
                           "coverage": {room: {"YYYY-MM": [real, estimated, missing]}}  (days)}
  2024.hourly.enc.json    {"hourly":  {room: {"YYYY-MM-DDTHH": Wh}}}   (loaded on demand by the app)
  weather.enc.json        {"source": "...", "outdoor": {"YYYY-MM-DD": [min, max, mean]},
                           "indoor": {"YYYY-MM-DD": mean}}
  linky.enc.json          {"daily": {"YYYY-MM-DD": Wh}, "pmax": {"YYYY-MM-DD": kVA},
                           "pmax_at": {"YYYY-MM-DD": "HH:MM"}, "index": {series: {"YYYY-MM-DD": Wh}},
                           "curve_scan": "YYYY-MM-DD" (last day asked for the load curve),
                           "unit": "Wh" | "kWh", "pmax_unit": "VA" | "kVA" (unit of the RAW API
                           values, decided once and kept: enedis.py; daily and pmax are stored
                           converted, in Wh and kVA, whatever these say: #567)}
  2025.linky30.enc.json   {"curve":   {"YYYY-MM-DDTHH:MM": Wh}}  Linky load curve, local start of
                           each half hour (optional, loaded on demand)
  station.enc.json        Netatmo weather station: modules, daily [min, max, mean, hum, co2],
                          small daily aggregates "nightly" / "hours" and "module_keys" (salted
                          hash of each module id → stable key "m0"…; see docs/api-notes.md)
  2025.room30.enc.json    {"rooms": {room: {"YYYY-MM-DD": [hp, hc, °C, setpoint °C]}}} per-room half hours
                          of the local day, compacted (collector/room30.py; loaded on demand)
  room30.enc.json         progress of the 30-min history: {"newest": day, "progress": {room: {...}}}
  2025.station_h.enc.json {"hourly": {"m0": {"YYYY-MM-DDTHH": [°C, %, ppm]}}} (loaded on demand)
  netatmo-token.enc.json  rotating refresh token of the Netatmo weather station (optional)
  shelly.enc.json         Shelly plugs: daily Wh per plug from cumulative counters (collector/shelly.py)
  ha.enc.json             Home Assistant daily aggregates per sensor, imported by hand (homeassistant.py)
  volets.enc.json         #200: Wiser shutters read by the owner's NAS, one record per day and shutter
                          (closing / opening times, mean position, position at 22 h): collector/volets.py
  devices.enc.json        v1.5: health of the devices (modules answering, firmware changes, gateway
                          restarts and Wi-Fi, Tempo colour of the gateway): collector/devices.py
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from .crypto import Kdf, decrypt_json, encrypt_json, keyinfo_doc, parse_keyinfo

Daily = dict[str, dict[str, float]]  # room_id -> day -> Wh


class Store:
    def __init__(self, data_dir: Path, passphrase: str) -> None:
        self.dir = data_dir
        self.passphrase = passphrase
        self.dir.mkdir(parents=True, exist_ok=True)
        self.salt, self.kdf = self._keyinfo()
        self.meta: dict = self._read("meta") or {}
        self._docs: dict[str, dict] = {}
        self._dirty: set[str] = set()

    # ----------------------------------------------------------- files
    def _keyinfo(self) -> tuple[bytes, Kdf]:
        path = self.dir / "keyinfo.json"
        if path.exists():
            return parse_keyinfo(json.loads(path.read_text()))
        # A new folder keeps PBKDF2 (#139): Argon2id only comes through `rekey`, a gesture of the owner.
        salt, kdf = os.urandom(16), Kdf.pbkdf2()
        path.write_text(json.dumps(keyinfo_doc(salt, kdf)) + "\n")
        return salt, kdf

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
        env = encrypt_json(obj, self.passphrase, self.salt, self.kdf)
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

    def drop_top(self, name: str, key: str) -> None:
        doc = self.doc(name)
        if key in doc:
            del doc[key]
            self._dirty.add(name)

    def replace(self, name: str, obj: dict) -> None:
        if self.doc(name) != obj:
            self._docs[name] = obj
            self._dirty.add(name)

    def flush(self, name: str) -> bool:
        """Write one document now (encrypted) instead of waiting for `save`. Used for state that
        must survive a failure later in the run, such as a rotated refresh token (#262)."""
        if name not in self._docs:
            return False
        self._dirty.discard(name)
        return self._write(name, _sorted(self._docs[name]))

    def unflag(self, name: str, section: str, key: str, sub: str) -> None:
        """Remove doc[section][key][sub] if present (and the emptied doc[section][key])."""
        target = self.doc(name).get(section, {})
        inner = target.get(key)
        if isinstance(inner, dict) and sub in inner:
            del inner[sub]
            if not inner:
                del target[key]
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

    def room30_years(self) -> list[int]:
        """Years with per-room 30-min documents "YYYY.room30.enc.json" (S-1.26)."""
        return self._years_of(".room30")

    def station_hourly_years(self) -> list[int]:
        """Years with hourly weather-station readings "YYYY.station_h.enc.json"."""
        return self._years_of(".station_h")

    def section(self, name: str) -> dict[str, dict[str, Any]]:
        """{room: {day: value}} of one section of the year files ("daily", "tariffs", "temps"…), read
        as the app reads it (#550): a day in two year files once, from the file of its own year
        (`own_year_first`)."""
        return own_year_first([(str(y), self.doc(str(y))) for y in self.years()], name)

    def daily(self) -> dict[str, dict[str, float]]:
        """{room: {day: Wh}} as the app reads it (#550): `verify`, the CSV export, the alerts."""
        return self.section("daily")

    def totals(self) -> dict[int, dict[str, float]]:
        """Wh per year and room category, as the app counts them (#550): a day in two year files
        once, from the file of its own year, and in the year of the day. What `verify` prints;
        `rekey` and `compare` check it with `file_totals`."""
        rooms = {r["id"]: r for r in self.meta.get("rooms", [])}
        out: dict[int, dict[str, float]] = {}
        for rid, days in self.daily().items():
            cat = rooms.get(rid, {}).get("category", "?")
            for d, wh in days.items():
                per_cat = out.setdefault(int(d[:4]), {})
                per_cat[cat] = per_cat.get(cat, 0) + wh
        return dict(sorted(out.items()))

    def file_totals(self) -> dict[int, dict[str, float]]:
        """Wh per year file and room category, file by file (what `verify` printed before #550): a
        day in two year files counted in each. `rekey` and `compare` check it too: a copy that
        lost the second value of such a day keeps the totals of `totals`, not these."""
        rooms = {r["id"]: r for r in self.meta.get("rooms", [])}
        out: dict[int, dict[str, float]] = {}
        for y in self.years():
            per_cat = out.setdefault(y, {})
            for rid, days in self.year(y).items():
                cat = rooms.get(rid, {}).get("category", "?")
                per_cat[cat] = per_cat.get(cat, 0) + sum(days.values())
        return out

    def all_totals(self) -> tuple[dict[int, dict[str, float]], dict[int, dict[str, float]]]:
        """(`totals`, `file_totals`): what `rekey` and `compare` compare between two copies."""
        return self.totals(), self.file_totals()

    def delete_room(self, room_id: str) -> None:
        """Remove a room from every yearly document (daily, tariffs, temps, hourly, 30 min)."""
        names = [str(y) for y in self.years()] + [f"{y}.hourly" for y in self.hourly_years()]
        names += [f"{y}.room30" for y in self.room30_years()]
        for name in names:
            doc = self.doc(name)
            for section in doc.values():
                if isinstance(section, dict) and room_id in section:
                    del section[room_id]
                    self._dirty.add(name)
        progress = self.doc("room30").get("progress", {})  # its 30-min history is fetched again
        if room_id in progress:
            del progress[room_id]
            self._dirty.add("room30")

    def update_coverage(self) -> None:
        """Per room and month, days with a real value, estimated, or missing (S-1.10).

        Computed from what is stored, so already-stored years get it too. A room is
        counted from its first stored day to the last day of the archive.
        """
        last = self.last_day()
        if not last:
            return
        years = self.years()
        daily = {y: self.year(y) for y in years}
        estimated = {y: self.doc(str(y)).get("estimated", {}) for y in years}
        firsts: dict[str, str] = {}
        for days in daily.values():
            for rid, d in days.items():
                if d:
                    firsts[rid] = min(firsts.get(rid, "9999"), min(d))
        for y in years:
            cov = month_coverage(daily[y], estimated[y], firsts, last, y)
            if cov or "coverage" in self.doc(str(y)):
                self.set_top(str(y), "coverage", cov)

    def merge(self, room_id: str, day: str, wh: float) -> None:
        self.put(day[:4], "daily", room_id, day, wh)

    def merge_real(self, room_id: str, day: str, wh: float) -> bool:
        """A value read from the source (not spread from a monthly total). A real non-zero value
        replaces an estimate and clears its "estimated" flag (#269); a zero does not erase an
        estimate (the backend fills values in late). Returns False when nothing was stored."""
        flagged = day in self.doc(day[:4]).get("estimated", {}).get(room_id, {})
        if flagged and not wh:
            return False
        self.put(day[:4], "daily", room_id, day, wh)
        if flagged:
            self.unflag(day[:4], "estimated", room_id, day)
        return True

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
            "room30_years": self.room30_years(),
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


class KeyMap:
    """Stable opaque keys ("m0", "i3", "p1"…) for device ids that must not be stored in clear
    (MAC addresses, serial-like ids). The document keeps, under `field`,
    {"salt": random hex, "keys": {sha256("<salt>:<id>")[:16]: key}}: the id itself is never
    written, only its salted hash, and the key never changes once given. A new id gets the first
    free key `prefix`N (also free of `reserved`, keys already used elsewhere in the document); a
    known id finds its key again, even after being absent for a while. `legacy` is a map
    id → key written in clear by an earlier version: it is hashed once (the caller then removes
    it from the document). `save` writes the map back."""

    def __init__(
        self,
        store: Store,
        name: str,
        prefix: str,
        field: str = "module_keys",
        legacy: dict[str, str] | None = None,
        reserved: set[str] | None = None,
    ) -> None:
        self.store, self.name, self.prefix, self.field = store, name, prefix, field
        stored = store.doc(name).get(field) or {}
        self.salt: str = stored.get("salt") or secrets.token_hex(8)
        self.keys: dict[str, str] = dict(stored.get("keys") or {})
        for raw, key in (legacy or {}).items():
            self.keys.setdefault(self.hash(raw), key)
        self.used = set(self.keys.values()) | set(reserved or ())
        self._n = 0

    def hash(self, raw: str) -> str:
        return hashlib.sha256(f"{self.salt}:{raw}".encode()).hexdigest()[:16]

    def get(self, raw: str) -> str | None:
        return self.keys.get(self.hash(raw))

    def key(self, raw: str) -> str:
        """The key of this id, given now if it has none."""
        h = self.hash(raw)
        if h not in self.keys:
            while f"{self.prefix}{self._n}" in self.used:
                self._n += 1
            self.keys[h] = f"{self.prefix}{self._n}"
            self.used.add(self.keys[h])
        return self.keys[h]

    def save(self) -> None:
        if self.keys:
            self.store.set_top(self.name, self.field, {"salt": self.salt, "keys": dict(self.keys)})


def own_year_first(docs: list[tuple[str, dict]], section: str) -> dict[str, dict[str, Any]]:
    """{room: {day: value}} of one section of the year documents [(year, doc)]. A day found in two
    year files (#532, `deux-fichiers` of the audit) is read once, never added: the value of the file
    of its own year wins, else the first read. The app applies the same rule (aggregate.ts toRecords)."""
    out: dict[str, dict[str, Any]] = {}
    for year, doc in docs:
        for rid, days in (doc.get(section) or {}).items():
            if not isinstance(days, dict):
                continue
            cur = out.setdefault(rid, {})
            for d, v in days.items():
                if d not in cur or str(d)[:4] == str(year):
                    cur[d] = v
    return out


def month_coverage(
    daily: dict[str, dict[str, float]],
    estimated: dict[str, dict[str, Any]],
    firsts: dict[str, str],
    last_day: str,
    year: int,
) -> dict[str, dict[str, list[int]]]:
    """{room: {"YYYY-MM": [real, estimated, missing]}} for one year.

    A day present in `daily` is real unless flagged in `estimated`; a day absent
    between the room's first day and `last_day` is missing (lost on the server side).
    """
    out: dict[str, dict[str, list[int]]] = {}
    for rid, first in firsts.items():
        days = daily.get(rid, {})
        est = estimated.get(rid, {})
        d = max(date(year, 1, 1), date.fromisoformat(first))
        end = min(date(year, 12, 31), date.fromisoformat(last_day))
        months: dict[str, list[int]] = {}
        while d <= end:
            key = d.isoformat()
            cell = months.setdefault(key[:7], [0, 0, 0])
            cell[1 if key in est else 0 if key in days else 2] += 1
            d += timedelta(days=1)
        if months:
            out[rid] = months
    return out


def _sorted(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _sorted(obj[k]) for k in sorted(obj)}
    return obj
