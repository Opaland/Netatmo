"""v1.5 collector robustness: #262 (Netatmo token), #266 (Linky unit), #267 (DST hour),
#269 (estimated flag), #270 / #273 (Intuis client retries), #272 (Home Assistant partial days),
#275 (shared pacing)."""

import json
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

import collector.api as api
from collector.api import ApiError, IntuisClient
from collector.budget import METER, CallCapReached
from collector.config import Settings
from collector.schema import FormatError
from collector.storage import Store

SETTINGS = Settings(username="u", password="p", client_id="c", client_secret="s", api_base="https://x")
ROOT = Path(__file__).parent.parent


@pytest.fixture(autouse=True)
def _fresh_meter():
    METER.reset()
    yield
    METER.reset()


@pytest.fixture
def sleeps(monkeypatch):
    waited: list[float] = []
    monkeypatch.setattr(api.time, "sleep", waited.append)
    return waited


# ---------------------------------------------------------------- #273 / #270 Intuis client
def intuis_client(responses, token_handler=None):
    """Client whose /api/homesdata answers come from `responses` (a list of statuses, httpx
    Responses or exceptions), in order. Returns (client, log of (path, grant_type))."""
    seen: list[tuple[str, str | None]] = []
    queue = list(responses)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/token":
            grant = dict(httpx.QueryParams(request.content.decode())).get("grant_type")
            seen.append(("token", grant))
            if token_handler:
                return token_handler(grant)
            return httpx.Response(200, json={"access_token": "a", "refresh_token": "r", "expires_in": 3600})
        seen.append(("homesdata", None))
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, httpx.Response):
            return item
        return httpx.Response(item, json={"body": {"homes": []}} if item == 200 else {"error": "x"})

    client = IntuisClient(SETTINGS, http=httpx.Client(transport=httpx.MockTransport(handler)), min_interval=0)
    return client, seen


def test_intuis_client_429_then_200_caps_retry_after(sleeps):
    client, seen = intuis_client([httpx.Response(429, headers={"Retry-After": "3600"}), 200])
    assert client.homesdata() == {"body": {"homes": []}}
    assert sleeps == [api.MAX_RETRY_AFTER]  # never an hour
    assert [p for p, _g in seen].count("homesdata") == 2


def test_intuis_client_5xx_backs_off_then_gives_up_after_five_attempts(sleeps):
    client, seen = intuis_client([503] * 5)
    with pytest.raises(ApiError, match="5 tentatives"):
        client.homesdata()
    assert [p for p, _g in seen].count("homesdata") == 5
    assert len(sleeps) == 4 and all(0 < s <= api.MAX_RETRY_AFTER for s in sleeps)  # no wait after the last


def test_intuis_client_network_error_is_retried(sleeps):
    client, _seen = intuis_client([httpx.ReadTimeout("lent"), httpx.ConnectError("coupé"), 200])
    assert client.homesdata() == {"body": {"homes": []}}
    assert len(sleeps) == 2


def test_intuis_client_network_errors_end_in_api_error_without_url(sleeps):
    client, _seen = intuis_client([httpx.ReadTimeout("https://x/secret")] * 5)
    with pytest.raises(ApiError) as err:
        client.homesdata()
    assert "ReadTimeout" in str(err.value) and "secret" not in str(err.value)


def test_intuis_client_retries_stay_within_the_call_budget(sleeps):
    METER.reset({"intuis": 3})
    client, seen = intuis_client([503] * 5)
    with pytest.raises(CallCapReached):
        client.homesdata()
    assert len(seen) == 3  # token + 2 attempts, then the cap stops the retries


def test_intuis_client_401_logs_in_again_once(sleeps):
    client, seen = intuis_client([401, 200])
    assert client.homesdata() == {"body": {"homes": []}}
    assert seen == [("token", "password"), ("homesdata", None), ("token", "password"), ("homesdata", None)]


def test_intuis_client_401_twice_is_an_error(sleeps):
    client, seen = intuis_client([401, 401, 200])
    with pytest.raises(ApiError, match="HTTP 401"):
        client.homesdata()
    assert [g for _p, g in seen if g] == ["password", "password"]  # one re-login, not a loop


def test_intuis_client_refused_refresh_token_falls_back_to_login(sleeps):
    def token(grant):
        if grant == "refresh_token":
            return httpx.Response(400, json={"error": "invalid_grant"})
        return httpx.Response(200, json={"access_token": "a", "refresh_token": "r2", "expires_in": 3600})

    client, seen = intuis_client([200], token_handler=token)
    client._refresh_token, client._expires_at = "r1", 0.0  # access token expired
    client.homesdata()
    assert [g for _p, g in seen if g] == ["refresh_token", "password"]
    assert client._refresh_token == "r2"


def test_one_pacing_helper(monkeypatch):
    """#275: every client waits through collector/http.py."""
    from collector import http as paced

    waited: list[float] = []
    monkeypatch.setattr(paced.time, "sleep", waited.append)
    p = paced.Paced(httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200))), "shelly", 10)
    p.get("https://x/a")
    p.get("https://x/b")
    assert len(waited) == 1 and 9 < waited[0] <= 10
    assert METER.calls["shelly"] == 2
    sources = [f.read_text() for f in (ROOT / "collector").glob("*.py") if f.name not in ("http.py", "budget.py")]
    assert not any("time.monotonic" in text for text in sources)


# ---------------------------------------------------------------- #262 Netatmo token
def test_rotated_netatmo_token_is_on_disk_even_if_the_collection_fails(tmp_path):
    from collector.station import TOKEN_DOC, Station

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": "a", "refresh_token": "nouveau"})
        return httpx.Response(200, text="<html>maintenance</html>")  # 200 but not JSON

    station = Station(
        Store(tmp_path, "pw"),
        "id",
        "s",
        "seed",
        http=httpx.Client(transport=httpx.MockTransport(handler)),
        min_interval=0,
    )
    with pytest.raises(FormatError, match="n'est plus du JSON"):
        station.collect("Europe/Paris", "2024-01-01")
    # Nothing was saved by the collection; the token was written right after the login.
    assert Store(tmp_path, "pw").doc(TOKEN_DOC)["refresh_token"] == "nouveau"
    assert "nouveau" not in (tmp_path / "netatmo-token.enc.json").read_text()  # encrypted


def _git(cwd: Path, *args: str) -> str:
    env_args = ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main"]
    return subprocess.run(["git", *env_args, *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


@pytest.mark.skipif(shutil.which("git") is None, reason="git absent")
def test_commit_script_rebases_when_main_moved(tmp_path):
    origin, runner, other = tmp_path / "origin.git", tmp_path / "runner", tmp_path / "other"
    _git(tmp_path, "init", "-q", "--bare", str(origin))
    _git(tmp_path, "clone", "-q", str(origin), str(other))
    (other / "README").write_text("a\n")
    (other / "data").mkdir()
    (other / "data" / "meta.enc.json").write_text("{}\n")
    _git(other, "add", ".")
    _git(other, "commit", "-q", "-m", "init")
    _git(other, "push", "-q", "origin", "HEAD:main")
    _git(tmp_path, "clone", "-q", str(origin), str(runner))
    # The collection writes data while a pull request is merged on main.
    (runner / "data" / "netatmo-token.enc.json").write_text('{"v": 1}\n')
    (runner / "data" / "meta.enc.json").write_text('{"v": 2}\n')
    (other / "README").write_text("b\n")
    _git(other, "commit", "-q", "-am", "PR fusionnée")
    _git(other, "push", "-q", "origin", "HEAD:main")
    script = ROOT / "scripts" / "commit-data.sh"
    env = {"PATH": "/usr/bin:/bin", "HOME": str(tmp_path), "GITHUB_REF_NAME": "main", "PUSH_PAUSE": "0"}
    # Token only first (what the always() step does after a failed collection), then the rest.
    out = subprocess.run(
        ["bash", str(script), "data: jeton", "data/netatmo-token.enc.json"],
        cwd=runner,
        env=env,
        capture_output=True,
        text=True,
    )
    assert out.returncode == 0, out.stdout + out.stderr
    assert "a bougé" in out.stdout
    log = _git(origin, "log", "--format=%s", "main")
    assert log.splitlines()[:2] == ["data: jeton", "PR fusionnée"]
    assert _git(origin, "show", "main:data/meta.enc.json") == "{}\n"  # only the token was committed
    again = subprocess.run(["bash", str(script), "data: rien", "data/netatmo-token.enc.json"], cwd=runner, env=env,
                           capture_output=True, text=True)  # fmt: skip
    assert again.returncode == 0 and "Aucune nouvelle donnée" in again.stdout


# ---------------------------------------------------------------- #266 Linky unit
def _linky_body(values, unit=None, start=1):
    points = [{"d": f"2024-01-{start + i:02d}", "v": str(v)} for i, v in enumerate(values)]
    grandeur = {"points": points}
    if unit:
        grandeur["unite"] = unit
    return {"grandeur": [grandeur]}


def _linky_collect(store, daily, pmax, today="2024-01-11"):
    from collector import enedis

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=pmax if request.url.path.endswith("max_quotidienne") else daily)

    class Day(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.fromisoformat(today).replace(tzinfo=tz or UTC)

    orig = enedis.datetime
    enedis.datetime = Day
    try:
        http = httpx.Client(transport=httpx.MockTransport(handler))
        return enedis.collect(store, "tok", "1", "2024-01-01", "Europe/Paris", http=http, min_interval=0)
    finally:
        enedis.datetime = orig


def test_linky_low_consumption_in_wh_is_not_multiplied(tmp_path):
    """Empty home: about 300 Wh a day and 80 VA at most, during the 10-day refresh window."""
    store = Store(tmp_path, "pw")
    store.put("linky", "daily", "2023-12-31", None, 12000.0)  # existing archive, in Wh
    _linky_collect(store, _linky_body([300] * 10), _linky_body([80] * 10))
    linky = store.doc("linky")
    assert linky["daily"]["2024-01-05"] == 300.0
    assert linky["pmax"]["2024-01-05"] == 0.08
    assert linky["unit"] == "Wh" and linky["pmax_unit"] == "VA"


def test_linky_first_run_on_an_empty_home_stays_in_wh(tmp_path):
    store = Store(tmp_path, "pw")
    _linky_collect(store, _linky_body([300, 280, 310], unit="Wh"), _linky_body([80, 90, 70]))
    assert store.doc("linky")["daily"]["2024-01-01"] == 300.0


def test_linky_unit_named_in_the_response_wins_and_is_kept(tmp_path):
    store = Store(tmp_path, "pw")
    _linky_collect(store, _linky_body([12, 15], unit="kWh"), _linky_body([6, 7], unit="kVA"))
    assert store.doc("linky")["daily"]["2024-01-01"] == 12000.0
    assert store.doc("linky")["pmax"]["2024-01-02"] == 7.0
    # Next night the response names no unit and the values are whole: the kept unit applies.
    _linky_collect(store, _linky_body([2, 3], start=5), _linky_body([1, 2], start=5))
    linky = store.doc("linky")
    assert linky["daily"]["2024-01-05"] == 2000.0 and linky["pmax"]["2024-01-05"] == 1.0
    assert linky["unit"] == "kWh" and linky["pmax_unit"] == "kVA"


def test_linky_unit_survives_a_save(tmp_path):
    store = Store(tmp_path, "pw")
    _linky_collect(store, _linky_body([21.5, 18.25]), _linky_body([7350]))
    store.save({"id": "h"}, [])
    again = Store(tmp_path, "pw")
    assert again.doc("linky")["unit"] == "kWh" and again.doc("linky")["daily"]["2024-01-01"] == 21500.0
    _linky_collect(again, _linky_body([1, 2], start=5), _linky_body([7000], start=5))
    assert again.doc("linky")["daily"]["2024-01-05"] == 1000.0  # never re-guessed


# ---------------------------------------------------------------- #267 DST repeated hour
def test_intuis_hourly_energy_of_the_repeated_hour_is_summed(tmp_path):
    from collector.sync import Syncer

    store = Store(tmp_path, "pw")
    syncer = Syncer(client=None, store=store)  # type: ignore[arg-type]
    t0 = int(datetime(2025, 10, 26, 0, tzinfo=UTC).timestamp())  # 02:00 CEST
    t1 = int(datetime(2025, 10, 26, 1, tzinfo=UTC).timestamp())  # 02:00 CET
    t2 = int(datetime(2025, 10, 26, 2, tzinfo=UTC).timestamp())  # 03:00 CET
    syncer._fetch_with = lambda *a, **k: {"100": [(t0, 1000.0), (t1, 1000.0), (t2, 500.0)]}
    syncer._hourly(SimpleNamespace(timezone="Europe/Paris"), ("home", "ALL"), t0, t2)
    hourly = store.doc("2025.hourly")["hourly"]["100"]
    assert hourly == {"2025-10-26T02": 2000.0, "2025-10-26T03": 500.0}


# ---------------------------------------------------------------- #269 estimated flag
def test_real_value_clears_the_estimated_flag(tmp_path):
    from collector.sync import Syncer

    store = Store(tmp_path, "pw")
    store.merge("100", "2024-01-01", 900.0)
    store.merge("100", "2024-01-02", 800.0)
    store.put("2024", "estimated", "100", "2024-01-02", 1)
    store.put("2024", "estimated", "200", "2024-01-02", 1)
    syncer = Syncer(client=None, store=store)  # type: ignore[arg-type]
    home = SimpleNamespace(timezone="UTC")
    ts = int(datetime(2024, 1, 2, tzinfo=UTC).timestamp())
    syncer._merge(home, {"100": [(ts, 0.0)], "200": [(ts, 0.0)]})  # not filled in yet: estimate kept
    assert store.year(2024)["100"]["2024-01-02"] == 800.0 and "100" in store.doc("2024")["estimated"]
    syncer._merge(home, {"100": [(ts, 1234.0)]})
    assert store.year(2024)["100"]["2024-01-02"] == 1234.0
    assert store.doc("2024")["estimated"] == {"200": {"2024-01-02": 1}}
    store.update_coverage()
    assert store.doc("2024")["coverage"]["100"]["2024-01"][:2] == [2, 0]


# ---------------------------------------------------------------- #272 Home Assistant partial days
def _hourly_stats(first_hour: str, hours: int, kwh: float = 0.5) -> bytes:
    start = datetime.fromisoformat(first_hour)
    rows = [{"start": int(start.timestamp()) * 1000 + h * 3_600_000, "change": kwh} for h in range(hours)]
    return json.dumps({"units": {"sensor.compteur": "kWh"}, "statistics": {"sensor.compteur": rows}}).encode()


def test_partial_statistics_day_never_replaces_a_complete_one(tmp_path):
    from collector.homeassistant import import_bytes

    store = Store(tmp_path, "pw")
    # January 30-31 in full, then an export starting on January 31 at noon.
    import_bytes(store, _hourly_stats("2025-01-30T00:00:00+01:00", 48), "Europe/Paris")
    daily = next(iter(store.doc("ha")["daily"].values()))
    assert daily["2025-01-31"] == {"kwh": 12.0}
    counts = import_bytes(store, _hourly_stats("2025-01-31T12:00:00+01:00", 36), "Europe/Paris")
    daily = next(iter(store.doc("ha")["daily"].values()))
    assert daily["2025-01-31"] == {"kwh": 12.0}  # the complete day is kept
    assert daily["2025-02-01"] == {"kwh": 12.0}
    assert counts["partial_kept"] == 1
    # A complete day replaces a partial one.
    import_bytes(store, _hourly_stats("2025-02-02T18:00:00+01:00", 6), "Europe/Paris")
    import_bytes(store, _hourly_stats("2025-02-02T00:00:00+01:00", 24, kwh=1.0), "Europe/Paris")
    assert next(iter(store.doc("ha")["daily"].values()))["2025-02-02"] == {"kwh": 24.0}


def test_collect_workflow_commits_the_token_even_after_a_failure():
    yaml = pytest.importorskip("yaml")
    steps = yaml.safe_load((ROOT / ".github" / "workflows" / "collect.yml").read_text())["jobs"]["collect"]["steps"]
    runs = {s.get("name"): s for s in steps}
    assert "scripts/commit-data.sh" in runs["Commit des données chiffrées"]["run"]
    token = runs["Sauvegarde du jeton Netatmo renouvelé"]
    assert token["if"].startswith("always()") and "data/netatmo-token.enc.json" in token["run"]
