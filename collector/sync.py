"""Fetch energy (daily, hourly), tariffs and room temperatures into the encrypted store."""

from __future__ import annotations

import logging
import time
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from .api import SCALE_SECONDS, ApiError, IntuisClient, chunk_ranges
from .model import (
    IGNORE,
    Columns,
    Home,
    parse_home_columns,
    parse_homes,
    parse_measure_columns,
    to_local_day,
    total,
)
from .storage import Store

log = logging.getLogger(__name__)

DAY = 86400
EARLIEST_YEAR = 2015
# The backend files the same energy under a different measure type depending on the
# era of the installation (seen on a real account):
#   - tariffs set in the app (2025+):  sum_energy_elec$1 / $2 (peak / off-peak), $0 base
#   - before tariffs (2024):           sum_energy_elec
#   - oldest data (2022-2023):         sum_energy_elec_heating (rooms)
#                                       sum_energy_elec_hot_water (water heater module)
# "ALL" fetches every family and keeps, per room and period, the LARGEST value: the
# families describe the same energy, so adding them would count it twice.
TARIFFS = "sum_energy_elec$0,sum_energy_elec$1,sum_energy_elec$2"
TYPE_FAMILIES = (TARIFFS, "sum_energy_elec", "sum_energy_elec_heating", "sum_energy_elec_hot_water")
ALL = "ALL"
MEASURE_TYPES = (TARIFFS, "sum_energy_elec", "sum_energy_elec$0")
STRATEGIES = [("home", ALL)] + [("home", t) for t in MEASURE_TYPES] + [("room", t) for t in MEASURE_TYPES]
# Room temperature (measured) and setpoint, one column each.
TEMPERATURES = "temperature,sp_temperature"
HOURLY_DAYS_BACKFILL = 365
HOURLY_DAYS_SYNC = 4

Series = dict[str, list[tuple[int, float]]]
ColSeries = dict[str, list[tuple[int, Columns]]]


class Syncer:
    def __init__(self, client: IntuisClient, store: Store, overrides: dict[str, str] | None = None) -> None:
        self.client = client
        self.store = store
        self.overrides = overrides or {}
        self.strategy: tuple[str, str] | None = None
        self.tariff_days = 0
        self.temp_days = 0
        self.last_home: Home | None = None

    def home(self) -> Home:
        homes = parse_homes(self.client.homesdata(), self.overrides)
        if not homes:
            raise ApiError("Aucune maison trouvée sur ce compte")
        if len(homes) > 1:
            log.warning("Plusieurs maisons trouvées, seule la première est collectée : %s", homes[0].name)
        return homes[0]

    # ------------------------------------------------------------ low level
    def _fetch_cols(self, endpoint: str, mtype: str, home: Home, begin: int, end: int, scale: str) -> ColSeries:
        """Per-room points with one column per requested type; water heaters read at module level."""
        rooms = home.api_room_ids()
        active = {r.id for r in home.rooms if r.category != IGNORE}
        heaters = {mid: sid for mid, sid in home.water_heaters.items() if sid in active}
        out: ColSeries = {rid: [] for rid in rooms}
        module_pts: ColSeries = {mid: [] for mid in heaters}
        step = SCALE_SECONDS[scale]
        for b, e in chunk_ranges(begin, end, scale):
            if endpoint == "home":
                payload = self.client.home_measure(
                    home.id,
                    home.bridge_id,
                    rooms,
                    measure_type=mtype,
                    scale=scale,
                    date_begin=b,
                    date_end=e,
                    module_ids=list(heaters) or None,
                )
                for rid, pts in parse_home_columns(payload, step, "rooms").items():
                    out.setdefault(rid, []).extend(pts)
                for mid, pts in parse_home_columns(payload, step, "modules").items():
                    if mid in module_pts:
                        module_pts[mid].extend(pts)
            else:
                for rid in rooms:
                    payload = self.client.room_measure(
                        home.id, rid, measure_type=mtype, scale=scale, date_begin=b, date_end=e
                    )
                    out[rid].extend(parse_measure_columns(payload.get("body", []), step))
        # A water heater shows up at room level (older installations) or only at module
        # level (Aqua Manager): per period, keep the larger of the two, never the sum.
        for mid, pts in module_pts.items():
            sid = heaters[mid]
            merged = {ts: c for ts, c in out.get(sid, [])}
            for ts, c in pts:
                if ts not in merged or total(c) > total(merged[ts]):
                    merged[ts] = c
            out[sid] = sorted(merged.items(), key=lambda p: p[0])
        return out

    def _fetch_with(self, strategy: tuple[str, str], home: Home, begin: int, end: int, scale: str = "1day") -> Series:
        """Totals per room and period: one family, or the max over all families (ALL)."""
        endpoint, mtype = strategy
        if mtype != ALL:
            cols = self._fetch_cols(endpoint, mtype, home, begin, end, scale)
            return {rid: [(ts, total(c)) for ts, c in pts] for rid, pts in cols.items()}

        def key(ts: int) -> object:
            return to_local_day(ts, home.timezone) if scale == "1day" else ts

        best: dict[str, dict[object, tuple[int, float]]] = {}
        for family in TYPE_FAMILIES:
            cols = self._fetch_cols(endpoint, family, home, begin, end, scale)
            nonzero = 0
            for rid, pts in cols.items():
                slots = best.setdefault(rid, {})
                for ts, c in pts:
                    v = total(c)
                    k = key(ts)
                    if k not in slots or v > slots[k][1]:
                        slots[k] = (ts, v)
                    nonzero += bool(v)
                    if family == TARIFFS and scale == "1day" and v:
                        self._store_tariffs(home, rid, ts, c)
            log.info("  %s (%s) : %d points non nuls", family, scale, nonzero)
        return {rid: sorted(slots.values()) for rid, slots in best.items()}

    def _store_tariffs(self, home: Home, rid: str, ts: int, cols: Columns) -> None:
        day = to_local_day(ts, home.timezone)
        values = [round(c or 0.0, 1) for c in (list(cols) + [None, None, None])[:3]]
        self.store.put(day[:4], "tariffs", rid, day, values)
        self.tariff_days += 1

    # ------------------------------------------------------------ strategy
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

    # ------------------------------------------------------------ merging
    def _merge(self, home: Home, data: Series) -> int:
        n = 0
        for rid, pts in data.items():
            for ts, wh in pts:
                self.store.merge(rid, to_local_day(ts, home.timezone), round(wh, 1))
                n += 1
        return n

    def _hourly(self, home: Home, strategy: tuple[str, str], begin: int, end: int) -> int:
        """Hourly energy, stored per local hour "YYYY-MM-DDTHH". Best effort."""
        try:
            data = self._fetch_with(strategy, home, begin, end, scale="1hour")
        except ApiError as err:
            log.warning("Données horaires indisponibles : %s", err)
            return 0
        tz = ZoneInfo(home.timezone)
        n = 0
        for rid, pts in data.items():
            for ts, wh in pts:
                hour = datetime.fromtimestamp(ts, tz).strftime("%Y-%m-%dT%H")
                self.store.put(f"{hour[:4]}.hourly", "hourly", rid, hour, round(wh, 1))
                n += bool(wh)
        log.info("Horaire : %d heures non nulles", n)
        return n

    def _fill_from_monthly(self, home: Home, strategy: tuple[str, str], begin: int, end: int) -> int:
        """Some periods keep monthly totals but lost daily values (seen in 2024). When a
        month's total exceeds the sum of its days, spread the difference over the days
        without data, and mark them as estimated so the app can say so."""
        try:
            data = self._fetch_with(strategy, home, begin, end, scale="1month")
        except ApiError as err:
            log.warning("Totaux mensuels indisponibles : %s", err)
            return 0
        filled = 0
        for rid, pts in data.items():
            for ts, month_wh in pts:
                month = to_local_day(ts, home.timezone)[:7]
                year_daily = self.store.year(int(month[:4])).get(rid, {})
                days = {d: v for d, v in year_daily.items() if d.startswith(month)}
                have = sum(days.values())
                gap = month_wh - have
                if gap <= max(100.0, 0.05 * month_wh):
                    continue
                # Never before yesterday: today's values are still arriving.
                limit = to_local_day(int(time.time()) - DAY, home.timezone)
                missing = [d for d in _month_days(month) if d <= limit and not days.get(d)]
                if not missing:
                    continue
                share = round(gap / len(missing), 1)
                for d in missing:
                    self.store.merge(rid, d, share)
                    self.store.put(d[:4], "estimated", rid, d, 1)
                filled += len(missing)
                log.info("  %s : %d jours estimés à partir du total mensuel", month, len(missing))
        return filled

    def _temperatures(self, home: Home, begin: int, end: int) -> int:
        """Daily room temperature and setpoint. Best effort: not every account answers."""
        try:
            cols = self._fetch_cols("home", TEMPERATURES, home, begin, end, "1day")
        except ApiError as err:
            log.info("Températures des pièces indisponibles : %s", str(err)[:120])
            return 0
        n = 0
        for rid, pts in cols.items():
            for ts, c in pts:
                measured, setpoint = (list(c) + [None, None])[:2]
                if measured is None:
                    continue
                day = to_local_day(ts, home.timezone)
                sp = None if setpoint is None else round(setpoint, 1)
                self.store.put(day[:4], "temps", rid, day, [round(measured, 1), sp])
                n += 1
        log.info("Températures : %d jours-pièces", n)
        self.temp_days += n
        return n

    # ------------------------------------------------------------ entry points
    def run(self, days: int = 35, backfill: bool = False, save: bool = True) -> list[str]:
        home = self.last_home = self.home()
        now = int(time.time())
        strategy = self.detect_strategy(home, now)
        if backfill or self.store.last_day() is None:
            # Water heater rooms are rebuilt from scratch: older runs stored room-level
            # data there (see _fetch_cols).
            for sid in set(home.water_heaters.values()):
                self.store.delete_room(sid)
            self._backfill(home, strategy, now)
            if strategy[0] == "home":
                self._hourly(home, strategy, now - HOURLY_DAYS_BACKFILL * DAY, now)
        else:
            # Re-download a few weeks: the backend fills values in late (up to a day).
            self._merge(home, self._fetch_with(strategy, home, now - days * DAY, now))
            self._temperatures(home, now - days * DAY, now)
            if strategy[0] == "home":
                self._hourly(home, strategy, now - HOURLY_DAYS_SYNC * DAY, now)
        return self.save(home) if save else []

    def save(self, home: Home, extra: dict | None = None) -> list[str]:
        keep = {k: self.store.meta[k] for k in ("weather_source", "has_linky", "has_station") if k in self.store.meta}
        meta_extra = {
            "has_tariffs": bool(self.tariff_days or self.store.meta.get("has_tariffs")),
            "has_temps": bool(self.temp_days or self.store.meta.get("has_temps")),
            **keep,
            **(extra or {}),
        }
        self.store.update_coverage()
        return self.store.save(
            {"id": home.id, "name": home.name, "timezone": home.timezone},
            [asdict(r) for r in home.rooms],
            meta_extra,
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
                self._temperatures(home, begin, end)
                self._fill_from_monthly(home, strategy, begin, end)
            else:
                empty_streak += 1
            log.info(
                "Historique %s → %s : %d jours non nuls",
                time.strftime("%Y-%m-%d", time.gmtime(begin)),
                time.strftime("%Y-%m-%d", time.gmtime(end)),
                count,
            )
            end = begin


def _month_days(month: str) -> list[str]:
    y, m = int(month[:4]), int(month[5:7])
    d = datetime(y, m, 1, tzinfo=UTC)
    out = []
    while d.month == m:
        out.append(d.strftime("%Y-%m-%d"))
        d += timedelta(days=1)
    return out
