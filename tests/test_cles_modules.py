"""v1.6 (PR #213 redone): stable module keys without any device id in clear.

Station modules (m0…), Intuis modules of devices.enc.json (i0…) and Shelly plugs (p0…) keep
their keys; the documents hold only salted hashes of the ids (MAC addresses). Each station
module resumes its daily readings from its own last day. Every source is simulated."""

import json
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from collector import devices
from collector.station import Station
from collector.storage import KeyMap, Store

TZ = "Europe/Paris"
PARIS = ZoneInfo(TZ)
MAC = re.compile(r"[0-9a-f]{2}(?::[0-9a-f]{2}){5}", re.I)
MAIN, OUT, KIDS, CELLAR, NEW = (
    "70:ee:50:00:00:01",
    "02:00:00:00:00:aa",
    "03:00:00:00:00:bb",
    "03:00:00:00:00:cc",
    "03:00:00:00:00:dd",
)


def _station(radio: list[dict], days: dict[str, list], calls: list | None = None) -> httpx.Client:
    """Mock station whose radio modules (`radio`) and daily values per module id
    (`days`: id → [(ts, [min, max, mean, hum, co2])]) can change between collections."""

    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(request)
        path = request.url.path
        if path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "a", "refresh_token": "r"})
        if path == "/api/getstationsdata":
            device = {"_id": MAIN, "type": "NAMain", "module_name": "Salon", "modules": radio}
            return httpx.Response(200, json={"body": {"devices": [device]}})
        if path == "/api/getmeasure":
            p = request.url.params
            if p["scale"] == "1hour":
                return httpx.Response(200, json={"body": []})
            module = p.get("module_id") or MAIN
            begin, end = int(p["date_begin"]), int(p["date_end"])
            return httpx.Response(200, json={"body": {str(t): v for t, v in days.get(module, []) if begin <= t <= end}})
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


def _noon(day: str) -> int:
    return int(datetime.fromisoformat(f"{day}T12:00").replace(tzinfo=PARIS).timestamp())


def _mod(mid: str, kind: str, name: str) -> dict:
    return {"_id": mid, "type": kind, "module_name": name}


def _collect(store: Store, http: httpx.Client, first_day: str) -> None:
    Station(store, "id", "secret", "seed", http=http, min_interval=0).collect(TZ, first_day)


def _decrypted(tmp_path, passphrase: str = "pw") -> dict[str, str]:
    """Every document written to disk, decrypted, as JSON text."""
    store = Store(tmp_path, passphrase)
    return {p.name: json.dumps(store.doc(p.name.removesuffix(".enc.json"))) for p in tmp_path.glob("*.enc.json")}


def test_station_module_inserted_removed_and_back_keeps_every_key_and_history(tmp_path):
    today = datetime.now(PARIS).date()
    d1, d2, d3 = ((today - timedelta(days=n)).isoformat() for n in (30, 20, 1))
    radio = [_mod(OUT, "NAModule1", "Extérieur"), _mod(KIDS, "NAModule4", "Chambre"), _mod(CELLAR, "NAModule4", "Cave")]
    value = {MAIN: 20.0, OUT: 5.0, KIDS: 19.0, CELLAR: 12.0, NEW: 17.0}
    row = lambda v: [v - 1, v + 1, v, 50, 600]  # noqa: E731
    days = {i: [(_noon(d1), row(v))] for i, v in value.items() if i != NEW}
    store = Store(tmp_path, "pw")
    http = _station(radio, days)

    _collect(store, http, d1)
    before = {k: dict(v) for k, v in store.doc("station")["daily"].items()}
    assert {k: v[d1][2] for k, v in before.items()} == {"m0": 20.0, "m1": 5.0, "m2": 19.0, "m3": 12.0}

    # A new indoor module, listed by the API in the middle of the others.
    radio.insert(1, _mod(NEW, "NAModule4", "Bureau"))
    for i, v in value.items():
        days.setdefault(i, []).append((_noon(d2), row(v)))
    _collect(store, http, d1)
    station = store.doc("station")
    for k, hist in before.items():  # every existing key keeps its history, then its own new day
        assert station["daily"][k][d1] == hist[d1]
        assert station["daily"][k][d2][2] == hist[d1][2]
    assert station["daily"]["m4"] == {d2: [16.0, 18.0, 17.0, 50, 600]}  # next free key, own data only
    assert {k: m["name"] for k, m in station["modules"].items()} == {
        "m0": "Salon",
        "m4": "Bureau",
        "m1": "Extérieur",
        "m2": "Chambre",
        "m3": "Cave",
    }

    # The kids' module is removed: no key shifts, its history stays, the others go on.
    radio[:] = [m for m in radio if m["_id"] != KIDS]
    for i, v in value.items():
        days[i].append((_noon(d3), row(v)))
    store.save({"id": "h"}, [])
    store = Store(tmp_path, "pw")
    _collect(store, http, d1)
    station = store.doc("station")
    assert {k: station["daily"][k][d3][2] for k in ("m0", "m1", "m3", "m4")} == {
        "m0": 20.0,
        "m1": 5.0,
        "m3": 12.0,
        "m4": 17.0,
    }
    assert d3 not in station["daily"]["m2"] and station["daily"]["m2"][d2][2] == 19.0
    assert "m2" not in station["modules"]

    # Next run: each module resumes from its own last day; the removed module's older last day
    # does not pull the others back (with the old rule, all would restart from d2 - 10 days).
    calls: list = []
    _collect(store, _station(radio, days, calls), d1)
    begins = [
        int(r.url.params["date_begin"])
        for r in calls
        if r.url.params.get("scale") == "1day" and "pressure" not in r.url.params["type"]
    ]
    assert len(begins) == 4 and min(begins) >= _noon(d3) - 11 * 86400

    # Back again later: it finds its own key and history.
    radio.append(_mod(KIDS, "NAModule4", "Chambre"))
    st = Station(store, "id", "secret", "seed", http=_station(radio, days), min_interval=0)
    assert st.module_keys(st.modules()) == ["m0", "m1", "m4", "m3", "m2"]

    # Only salted hashes of the module ids are stored, never the ids.
    store.save({"id": "h"}, [])
    assert set(store.doc("station")["module_keys"]) == {"salt", "keys"}
    for name, text in _decrypted(tmp_path).items():
        assert not MAC.search(text), name


def test_station_new_module_starts_from_the_first_day_of_the_home(tmp_path):
    today = datetime.now(PARIS).date()
    first, last = (today - timedelta(days=200)).isoformat(), (today - timedelta(days=2)).isoformat()
    store = Store(tmp_path, "pw")
    store.put("station", "daily", "m0", last, [19, 21, 20, 50, 600])
    store.set_top("station", "ids", {MAIN: "m0"})  # written by v1.5
    calls: list = []
    _collect(store, _station([_mod(OUT, "NAModule1", "Extérieur")], {}, calls), first)
    begins = {
        r.url.params.get("module_id"): int(r.url.params["date_begin"])
        for r in calls
        if r.url.params.get("scale") == "1day" and "pressure" not in r.url.params["type"]
    }
    assert begins[None] >= _noon(last) - 11 * 86400  # the main module resumes from its last day
    assert begins[OUT] <= _noon(first) - 9 * 86400  # the new one from the first day of the home


def test_station_ids_table_of_the_previous_version_is_hashed_once_and_dropped(tmp_path):
    store = Store(tmp_path, "pw")
    # Written by v1.5: raw id → key, with a module added in the middle since.
    store.set_top("station", "ids", {MAIN: "m0", OUT: "m1", NEW: "m2", KIDS: "m3"})
    st = Station(store, "id", "secret", "tok", http=object())
    mods = [{"id": MAIN, "module": None}] + [{"id": MAIN, "module": i} for i in (OUT, KIDS, NEW, CELLAR)]
    assert st.module_keys(mods) == ["m0", "m1", "m3", "m2", "m4"]
    doc = store.doc("station")
    assert "ids" not in doc and not MAC.search(json.dumps(doc))
    # The salt is drawn once: the same ids give the same keys on the next run.
    salt = doc["module_keys"]["salt"]
    store.save({"id": "h"}, [])
    st2 = Station(Store(tmp_path, "pw"), "id", "secret", "tok", http=object())
    assert st2.module_keys(list(reversed(mods))) == ["m4", "m2", "m3", "m1", "m0"]
    assert st2.store.doc("station")["module_keys"]["salt"] == salt


def _intuis(mids: list[str]) -> tuple[dict, dict]:
    homesdata = {"body": {"homes": [{"id": "h", "modules": [{"id": m, "type": "NMH"} for m in mids]}]}}
    homestatus = {"body": {"home": {"modules": [{"id": m, "type": "NMH", "reachable": True} for m in mids]}}}
    return homesdata, homestatus


def test_devices_ids_table_is_migrated_and_keys_stay(tmp_path):
    a, b, c = "09:00:00:00:00:0a", "09:00:00:00:00:0b", "09:00:00:00:00:0c"
    store = Store(tmp_path, "pw")
    # Written by v1.5: API id in clear → key, with history under the keys.
    store.set_top("devices", "ids", {a: "i0", b: "i1"})
    store.put("devices", "reach", "i1", "2025-01-09", 0)
    now = int(datetime(2025, 1, 10, 5, tzinfo=PARIS).timestamp())
    devices.collect_status(store, *_intuis([c, b, a]), TZ, {b: "100"}, now=now)
    doc = store.doc("devices")
    assert "ids" not in doc
    assert devices.module_keys(store, [a, b, c]) == {a: "i0", b: "i1", c: "i2"}
    assert doc["reach"]["i1"] == {"2025-01-09": 0, "2025-01-10": 1}
    assert doc["modules"]["i1"]["room"] == "100"
    store.save({"id": "h"}, [])
    for name, text in _decrypted(tmp_path).items():
        assert not MAC.search(text), name


def test_key_map_gives_the_first_free_key_and_never_stores_the_id(tmp_path):
    store = Store(tmp_path, "pw")
    keys = KeyMap(store, "x", "p", field="k", reserved={"p0", "p1c0"})
    assert [keys.key("aa"), keys.key("bb"), keys.key("aa")] == ["p1", "p2", "p1"]
    assert keys.get("cc") is None
    keys.save()
    doc = store.doc("x")["k"]
    assert sorted(doc["keys"].values()) == ["p1", "p2"] and "aa" not in doc["keys"]
    # A fresh map on the same document finds the same keys.
    assert KeyMap(store, "x", "p", field="k").get("bb") == "p2"


def test_demo_documents_hold_no_mac_address(tmp_path):
    from collector.demo import generate

    generate(tmp_path)
    texts = _decrypted(tmp_path, "demo")
    assert "station.enc.json" in texts and "shelly.enc.json" in texts
    for name, text in texts.items():
        assert not MAC.search(text), name
    shelly = json.loads(texts["shelly.enc.json"])
    assert not any("id" in p for p in shelly["plugs"].values())
