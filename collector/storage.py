"""Encrypted, per-year JSON storage committed to the repository.

data/
  keyinfo.json        public: salt + PBKDF2 iterations (no secret)
  meta.enc.json       encrypted: home, rooms (with category), coverage, last update
  2024.enc.json ...   encrypted: {"daily": {room_id: {"YYYY-MM-DD": Wh}}}
"""

from __future__ import annotations

import base64
import json
import os
from datetime import UTC, datetime
from pathlib import Path

from .crypto import ITERATIONS, decrypt_json, encrypt_json

Daily = dict[str, dict[str, float]]  # room_id -> day -> Wh


class Store:
    def __init__(self, data_dir: Path, passphrase: str) -> None:
        self.dir = data_dir
        self.passphrase = passphrase
        self.dir.mkdir(parents=True, exist_ok=True)
        self.salt, self.iterations = self._keyinfo()
        self.meta: dict = self._read("meta") or {}
        self._years: dict[int, Daily] = {}
        self._dirty: set[int] = set()

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

    # ----------------------------------------------------------- data
    def year(self, year: int) -> Daily:
        if year not in self._years:
            raw = self._read(str(year)) or {}
            self._years[year] = raw.get("daily", {})
        return self._years[year]

    def years(self) -> list[int]:
        found = set()
        for p in self.dir.glob("*.enc.json"):
            stem = p.name.split(".")[0]
            if stem.isdigit():
                found.add(int(stem))
        return sorted(found | set(self._years))

    def merge(self, room_id: str, day: str, wh: float) -> None:
        y = int(day[:4])
        rooms = self.year(y)
        prev = rooms.setdefault(room_id, {}).get(day)
        if prev != wh:
            rooms[room_id][day] = wh
            self._dirty.add(y)

    def last_day(self) -> str | None:
        days = [d for y in self.years() for r in self.year(y).values() for d in r]
        return max(days) if days else None

    def first_day(self) -> str | None:
        days = [d for y in self.years() for r in self.year(y).values() for d in r]
        return min(days) if days else None

    def save(self, home: dict, rooms: list[dict]) -> list[str]:
        changed = []
        for y in sorted(self._dirty):
            data = {r: dict(sorted(days.items())) for r, days in sorted(self._years[y].items())}
            if self._write(str(y), {"daily": data}):
                changed.append(f"{y}.enc.json")
        self._dirty.clear()
        meta = {
            "home": home,
            "rooms": rooms,
            "years": self.years(),
            "first_day": self.first_day(),
            "last_day": self.last_day(),
        }
        # Keep `updated` out of the comparison so a no-op run produces no commit.
        if changed or {k: v for k, v in self.meta.items() if k != "updated"} != meta:
            meta["updated"] = datetime.now(UTC).isoformat(timespec="seconds")
            self._write("meta", meta)
            self.meta = meta
            changed.append("meta.enc.json")
        return changed
