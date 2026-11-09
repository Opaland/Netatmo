"""Fetch daily energy per room and merge it into the encrypted store."""

from __future__ import annotations

import logging
import time
from dataclasses import asdict

from .api import SCALE_SECONDS, ApiError, IntuisClient, chunk_ranges
from .model import IGNORE, Home, parse_homes, parse_measure_blocks, parse_room_measures, to_local_day
from .storage import Store

log = logging.getLogger(__name__)

DAY = 86400
EARLIEST_YEAR = 2015
SCALE = "1day"
# The suffix ($0 base, $1/$2 peak/off-peak) depends on the tariff set in the app, and
# a type that worked can stop answering after a tariff change: ask for all of them
# at once and sum. Then try simpler forms, then the per-room endpoint.
MEASURE_TYPES = (
    "sum_energy_elec$0,sum_energy_elec$1,sum_energy_elec$2",
    "sum_energy_elec",
    "sum_energy_elec$0",
)
STRATEGIES = [("home", t) for t in MEASURE_TYPES] + [("room", t) for t in MEASURE_TYPES]

Series = dict[str, list[tuple[int, float]]]


class Syncer:
    def __init__(self, client: IntuisClient, store: Store, overrides: dict[str, str] | None = None) -> None:
        self.client = client
        self.store = store
        self.overrides = overrides or {}
        self.strategy: tuple[str, str] | None = None

    def home(self) -> Home:
        homes = parse_homes(self.client.homesdata(), self.overrides)
        if not homes:
            raise ApiError("Aucune maison trouvée sur ce compte")
        if len(homes) > 1:
            log.warning("Plusieurs maisons trouvées, seule la première est collectée : %s", homes[0].name)
        return homes[0]

    # ------------------------------------------------------------ fetching
    def _fetch_with(self, strategy: tuple[str, str], home: Home, begin: int, end: int) -> Series:
        endpoint, mtype = strategy
        rooms = [r.id for r in home.rooms if r.category != IGNORE]
        out: Series = {rid: [] for rid in rooms}
        for b, e in chunk_ranges(begin, end, SCALE):
            if endpoint == "home":
                payload = self.client.home_measure(
                    home.id, home.bridge_id, rooms, measure_type=mtype, scale=SCALE, date_begin=b, date_end=e
                )
                for rid, pts in parse_room_measures(payload, SCALE_SECONDS[SCALE]).items():
                    out.setdefault(rid, []).extend(pts)
            else:
                for rid in rooms:
                    payload = self.client.room_measure(
                        home.id, rid, measure_type=mtype, scale=SCALE, date_begin=b, date_end=e
                    )
                    out[rid].extend(parse_measure_blocks(payload.get("body", []), SCALE_SECONDS[SCALE]))
        return out

    def detect_strategy(self, home: Home, now: int) -> tuple[str, str]:
        """Pick the first endpoint/type combination that returns non-zero data."""
        if self.strategy:
            return self.strategy
        errors = []
        for strategy in STRATEGIES:
            try:
                data = self._fetch_with(strategy, home, now - 60 * DAY, now)
            except ApiError as err:
                errors.append(f"{strategy}: {err}")
                continue
            if any(v for pts in data.values() for _ts, v in pts):
                log.info("Méthode retenue : %s %s", *strategy)
                self.strategy = strategy
                return strategy
            log.info("Méthode %s %s : aucune donnée", *strategy)
        if len(errors) == len(STRATEGIES):
            raise ApiError("Aucune méthode de mesure ne répond :\n  " + "\n  ".join(errors))
        log.warning("Aucune consommation sur les 60 derniers jours, méthode par défaut")
        self.strategy = STRATEGIES[0]
        return self.strategy

    def _merge(self, home: Home, data: Series) -> int:
        n = 0
        for rid, pts in data.items():
            for ts, wh in pts:
                self.store.merge(rid, to_local_day(ts, home.timezone), round(wh, 1))
                n += 1
        return n

    # ------------------------------------------------------------ entry points
    def run(self, days: int = 35, backfill: bool = False) -> list[str]:
        home = self.home()
        now = int(time.time())
        strategy = self.detect_strategy(home, now)
        if backfill or self.store.last_day() is None:
            self._backfill(home, strategy, now)
        else:
            # Re-download a few weeks: the backend fills values in late (up to a day).
            self._merge(home, self._fetch_with(strategy, home, now - days * DAY, now))
        return self.store.save(
            {"id": home.id, "name": home.name, "timezone": home.timezone},
            [asdict(r) for r in home.rooms],
        )

    def _backfill(self, home: Home, strategy: tuple[str, str], now: int) -> None:
        """Walk back one year at a time until two consecutive years return nothing."""
        empty_streak = 0
        end = now
        while empty_streak < 2:
            begin = end - 365 * DAY
            if time.gmtime(begin).tm_year < EARLIEST_YEAR:
                break
            data = self._fetch_with(strategy, home, begin, end)
            count = sum(1 for pts in data.values() for _ts, v in pts if v)
            if count:
                empty_streak = 0
                self._merge(home, data)
            else:
                empty_streak += 1
            log.info(
                "Historique %s → %s : %d jours non nuls",
                time.strftime("%Y-%m-%d", time.gmtime(begin)),
                time.strftime("%Y-%m-%d", time.gmtime(end)),
                count,
            )
            end = begin
