"""#440: a room whose radiators were taken down (heated by a stove). Fictitious fixture only
(tests/fixtures/homesdata.json: Salon 100 with m1 and m2, Chambre 200 with m3, water heater 300
with m4); every source is simulated.

- The reason « retires » is one of STOPPED_ROOMS_JSON, the same list as the app's STOP_REASONS.
- From the declared day on, the modules of the room raise no alert at the nightly read (same rule
  as the app, `stopped_on` / `stoppedOn`), whatever the reason; the days before keep theirs.
- When the room and its modules vanish from homesdata, the archive keeps the room (its entry in
  the meta, its days) and the modules keep their pseudonymous key (KeyMap): nothing is lost, nothing
  is created again when they come back.
"""

import copy
import json
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from collector import devices
from collector.api import IntuisClient
from collector.config import Settings
from collector.storage import Store
from collector.sync import Syncer

ROOT = Path(__file__).resolve().parent.parent
FIX = Path(__file__).parent / "fixtures"
TZ = "Europe/Paris"
SETTINGS = Settings(username="u", password="p", client_id="c", client_secret="s", api_base="https://x")
MOD_ROOM = {"m1": "100", "m2": "100", "m3": "200", "m4": "300"}


def load(name: str) -> dict:
    return json.loads((FIX / name).read_text())


def at(day: str, hour: int) -> int:
    y, m, d = map(int, day.split("-"))
    return int(datetime(y, m, d, hour, tzinfo=ZoneInfo(TZ)).timestamp())


def without_salon(data: dict, *, keep_room: bool = False) -> dict:
    """homesdata once the radiators of the Salon are dissociated in the Intuis app: its modules
    are gone; the room too, unless `keep_room` (then listed with no module)."""
    data = copy.deepcopy(data)
    home = data["body"]["homes"][0]
    home["modules"] = [m for m in home["modules"] if m["id"] not in ("m1", "m2")]
    if keep_room:
        for r in home["rooms"]:
            if r["id"] == "100":
                r["module_ids"] = []
    else:
        home["rooms"] = [r for r in home["rooms"] if r["id"] != "100"]
    return data


def status(mods: list[str], *, reachable: bool = True) -> dict:
    modules = [{"id": "gw", "type": "NMG", "uptime": 3600, "firmware_revision": 300}]
    for mid in mods:
        kind = "NMW" if mid == "m4" else "NMH"
        modules.append({"id": mid, "type": kind, "reachable": reachable if mid in ("m1", "m2") else True})
    return {"body": {"home": {"id": "home1", "modules": modules}}}


# ---------------------------------------------------------------- one list of reasons
def test_reasons_are_the_same_in_the_collector_and_in_the_app():
    """AGENTS.md §5: the reasons checked here are those offered by ⚙ Mon logement."""
    src = (ROOT / "web/src/room-offline.ts").read_text(encoding="utf-8")
    m = re.search(r"export const STOP_REASONS: Record<StopReason, string> = \{(.*?)\n\};", src, re.S)
    assert m, "STOP_REASONS introuvable dans room-offline.ts"
    keys = re.findall(r"^\s+'?([a-z-]+)'?:", m.group(1), re.M)
    assert keys == list(devices.STOPPED_REASONS)
    t = re.search(r"export type StopReason = ([^;]+);", src)
    assert t and re.findall(r"'([a-z-]+)'", t.group(1)) == list(devices.STOPPED_REASONS)
    assert "retires" in devices.STOPPED_REASONS
    raw = json.dumps([{"room": "100", "from": "2026-01-09", "reason": "retires"}])
    assert devices.parse_stopped(raw)[0]["reason"] == "retires"


# ---------------------------------------------------------------- no alert from the declared day
def test_nightly_read_raises_no_alert_for_a_room_stopped_on_purpose(tmp_path):
    """The radiators of the Salon no longer answer. Declared « retires » (or « poele ») from the
    9th: no alert, not counted as out of reach, but the daily status is still recorded (data)."""
    gone = devices.parse_stopped(json.dumps([{"room": "100", "from": "2026-01-09", "reason": "retires"}]))
    for reason in devices.STOPPED_REASONS:
        stopped = [{**gone[0], "reason": reason}]
        store = Store(tmp_path / reason, "pw")
        for day in ("2026-01-09", "2026-01-10"):
            c = devices.collect_status(
                store, load("homesdata.json"), status(["m1", "m2", "m3", "m4"], reachable=False), TZ, MOD_ROOM,
                now=at(day, 5), stopped=stopped,
            )  # fmt: skip
            assert c["unreachable"] == 0 and c["alerts"] == [], reason
        keys = devices.module_keys(store, ["m1"])
        assert store.doc("devices")["reach"][keys["m1"]] == {"2026-01-09": 0, "2026-01-10": 0}
    # before the declared day, and without a declaration: still an alert
    store = Store(tmp_path / "before", "pw")
    c = devices.collect_status(
        store, load("homesdata.json"), status(["m1", "m2", "m3", "m4"], reachable=False), TZ, MOD_ROOM,
        now=at("2026-01-08", 5), stopped=gone,
    )  # fmt: skip
    assert c["unreachable"] == 2 and c["alerts"] == ["2 radiateurs injoignables depuis le 2026-01-08"]
    c = devices.collect_status(
        Store(tmp_path / "none", "pw"), load("homesdata.json"), status(["m1", "m2", "m3", "m4"], reachable=False),
        TZ, MOD_ROOM, now=at("2026-01-09", 5),
    )  # fmt: skip
    assert c["unreachable"] == 2


def test_stopped_on_is_the_one_rule():
    s = [{"room": "100", "from": "2026-01-09", "reason": "retires", "label": ""}]
    assert devices.stopped_on(s, "100", "2026-01-09") and devices.stopped_on(s, "100", "2026-02-01")
    assert not devices.stopped_on(s, "100", "2026-01-08")
    assert not devices.stopped_on(s, "200", "2026-01-10")
    assert not devices.stopped_on(s, None, "2026-01-10") and not devices.stopped_on(None, "100", "2026-01-10")


# ---------------------------------------------------------------- modules gone from homesdata
def test_modules_gone_from_homesdata_keep_their_key_and_their_history(tmp_path):
    store = Store(tmp_path, "pw")
    full = load("homesdata.json")
    devices.collect_status(store, full, status(["m1", "m2", "m3", "m4"]), TZ, MOD_ROOM, now=at("2026-01-08", 5))
    before = devices.module_keys(store, ["m1", "m2", "m3", "m4"])
    doc = store.doc("devices")
    salon = {before["m1"], before["m2"]}
    # the next nights, the Salon and its radiators are gone from homesdata and homestatus
    for day in ("2026-01-09", "2026-01-10"):
        c = devices.collect_status(
            store, without_salon(full), status(["m3", "m4"]), TZ, {"m3": "200", "m4": "300"}, now=at(day, 5)
        )
        assert c["alerts"] == [] and c["unreachable"] == 0
    for key in salon:
        assert doc["modules"][key]["room"] == "100"  # still known, with its room
        assert doc["reach"][key] == {"2026-01-08": 1}  # its history, untouched
    assert devices.module_keys(store, ["m1", "m2", "m3", "m4"]) == before  # no key given twice
    assert len(doc["module_keys"]["keys"]) == 5  # gw, m1 to m4: none given twice
    # a radiator put back: the same key, its history goes on
    devices.collect_status(store, full, status(["m1", "m2", "m3", "m4"]), TZ, MOD_ROOM, now=at("2026-01-11", 5))
    assert devices.module_keys(store, ["m1"]) == {"m1": before["m1"]}
    assert doc["reach"][before["m1"]] == {"2026-01-08": 1, "2026-01-11": 1}


def _client(homes: dict, asked: list[set[str]]) -> IntuisClient:
    measure = load("gethomemeasure.json")

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "t", "refresh_token": "r", "expires_in": 10800})
        if path == "/api/homesdata":
            return httpx.Response(200, json=homes)
        if path == "/api/gethomemeasure":
            ids = {r["id"] for r in json.loads(request.content)["home"]["rooms"]}
            asked.append(ids)
            body = copy.deepcopy(measure)
            body["body"]["home"]["rooms"] = [r for r in body["body"]["home"]["rooms"] if r["id"] in ids]
            return httpx.Response(200, json=body)
        return httpx.Response(404)

    return IntuisClient(SETTINGS, http=httpx.Client(transport=httpx.MockTransport(handler)), min_interval=0)


def test_room_gone_from_homesdata_keeps_its_history_and_its_entry(tmp_path):
    """The room and its modules vanish from homesdata: the next collection keeps the room in the
    meta (same id, name, category) with its days, asks nothing for it, and creates nothing new."""
    store = Store(tmp_path, "pw")
    Syncer(_client(load("homesdata.json"), []), store).run(days=10)
    salon = next(r for r in store.meta["rooms"] if r["id"] == "100")
    assert store.year(2024)["100"] == {"2024-01-01": 1200.0, "2024-01-02": 1500.0}
    for keep_room in (False, True):
        asked: list[set[str]] = []
        store = Store(tmp_path, "pw")
        Syncer(_client(without_salon(load("homesdata.json"), keep_room=keep_room), asked), store).run(days=10)
        store = Store(tmp_path, "pw")  # what the app reads: the saved meta
        rooms = {r["id"]: r for r in store.meta["rooms"]}
        assert set(rooms) == {"100", "200", "300"}
        if not keep_room:
            assert rooms["100"] == salon  # the entry of before, as it was
            assert not any("100" in ids for ids in asked)  # nothing asked for it
        assert store.year(2024)["100"] == {"2024-01-01": 1200.0, "2024-01-02": 1500.0}
        assert [r["id"] for r in store.meta["rooms"]].count("100") == 1


def test_a_room_without_any_day_is_not_kept(tmp_path):
    """Only a room with days in the archive is kept: a room deleted before any reading goes."""
    from collector.sync import keep_gone_rooms

    store = Store(tmp_path, "pw")
    store.merge("100", "2024-01-01", 1200.0)
    store.meta = {"rooms": [{"id": "100", "name": "Salon"}, {"id": "900", "name": "Vide"}]}
    assert keep_gone_rooms(store, [{"id": "200", "name": "Chambre"}]) == [
        {"id": "200", "name": "Chambre"},
        {"id": "100", "name": "Salon"},
    ]
