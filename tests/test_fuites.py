"""S-1.16 (#261, #263, #264, #271, #274): no personal data in public logs or exception messages.

Every client is made to fail (HTTP error statuses whose body echoes ids, the PRM and the
coordinates, and network errors whose message holds the full URL); the exception strings,
stdout / stderr, log records, job summary and alert files must never show a coordinate, an
id, a name, the PRM, a token or a response body.
"""

import json
import logging
import sys
import time
from pathlib import Path

import httpx
import pytest

from collector import redact
from collector.config import Settings
from collector.storage import Store

FIX = Path(__file__).parent / "fixtures"

LAT, LON = 48.8567, 2.3456
HOME_ID = "5f1e2d3c4b5a69788796a5b4"
OTHER_HOME_ID = "6a1e2d3c4b5a69788796a5b9"
HOME_NAME = "Famille Zorglub"
ROOMS = {"100": "1234500100", "200": "1234500200", "300": "1234500300"}
ROOM_NAMES = {"Salon": "Salon Zorglub", "Chambre": "Chambre Zorglub"}
MODULES = {"gw": "70:ee:50:aa:bb:cc", "m1": "09:00:00:aa:bb:01", "m4": "09:00:00:aa:bb:04"}
PRM = "12345678901234"
SECRETS = {
    "INTUIS_USERNAME": "zorglub@example.org",
    "INTUIS_PASSWORD": "PASS-XYZ-987",
    "INTUIS_CLIENT_ID": "CLIENT-ID-456",
    "INTUIS_CLIENT_SECRET": "CLIENT-SECRET-654",
    "NETATMO_CLIENT_ID": "NETATMO-ID-321",
    "NETATMO_CLIENT_SECRET": "NETATMO-SECRET-123",
    "NETATMO_REFRESH_TOKEN": "NETATMO-RT-888",
    "ENEDIS_TOKEN": "ENEDIS-TOK-555",
    "ENEDIS_PRM": PRM,
    "SHELLY_AUTH_KEY": "SHELLYKEY-777",
    "SHELLY_SERVER": "shelly-1-eu.shelly.cloud",
}
ACCESS = "INTUIS-ACCESS-TOK"
MARKER = "SECRET-BODY-123"
# An error body that echoes everything a request may carry.
ECHO = {
    "error": {"code": 21, "message": f"{MARKER} home {HOME_ID} room {ROOMS['100']} prm {PRM}"},
    "request": f"latitude={LAT}&longitude={LON}&pointId={PRM}",
}

FORBIDDEN = [
    MARKER,
    "48.86",
    "48.857",
    "48.8567",
    "2.35",
    "2.346",
    "2.3456",
    "latitude=",
    "longitude=",
    HOME_ID,
    OTHER_HOME_ID,
    "Zorglub",
    *ROOMS.values(),
    *MODULES.values(),
    PRM,
    ACCESS,
    *(v for k, v in SECRETS.items() if k != "SHELLY_SERVER"),
]


def assert_clean(text: str, where: str = "") -> None:
    leaks = [f for f in FORBIDDEN if f in text]
    assert not leaks, f"{where}: {leaks} in {text!r}"


def _replace_ids(text: str) -> str:
    for old, new in ROOMS.items():
        text = text.replace(f'"{old}"', f'"{new}"')
    for old, new in {**ROOM_NAMES, **MODULES}.items():
        text = text.replace(f'"{old}"', f'"{new}"')
    return text.replace('"home1"', f'"{HOME_ID}"').replace('"Maison"', f'"{HOME_NAME}"')


def homesdata() -> dict:
    data = json.loads(_replace_ids((FIX / "homesdata.json").read_text()))
    home = data["body"]["homes"][0]
    home["coordinates"] = [LON, LAT]
    # S-1.16 #264: a second home, whose name must not be logged either.
    data["body"]["homes"].append({**home, "id": OTHER_HOME_ID, "name": "Autre Zorglub"})
    return data


def gethomemeasure() -> dict:
    return json.loads(_replace_ids((FIX / "gethomemeasure.json").read_text()))


def _json_or_text(status: int, text: bool = False) -> httpx.Response:
    return httpx.Response(status, text=json.dumps(ECHO)) if text else httpx.Response(status, json=ECHO)


def router(intuis_measures_ok: bool = True):
    def handler(request: httpx.Request) -> httpx.Response:
        host, path = request.url.host, request.url.path
        if host == "app.muller-intuitiv.net":
            if path == "/oauth2/token":
                return httpx.Response(200, json={"access_token": ACCESS, "refresh_token": "R", "expires_in": 10800})
            if path == "/api/homesdata":
                return httpx.Response(200, json=homesdata())
            if path == "/api/gethomemeasure" and intuis_measures_ok:
                return httpx.Response(200, json=gethomemeasure())
            return _json_or_text(400)
        if host == "api.netatmo.com":
            return httpx.Response(400, json={"error": "invalid_grant", "error_description": MARKER})
        if host.endswith("open-meteo.com"):
            return httpx.Response(429, json={"reason": f"{MARKER} latitude={LAT}"})
        if host == "conso.boris.sh":
            return _json_or_text(500)
        if host.endswith("shelly.cloud"):
            return _json_or_text(503, text=True)
        return httpx.Response(404)

    return handler


@pytest.fixture
def all_sources(tmp_path, monkeypatch):
    """Every source configured, every HTTP client routed to the mock, no waiting."""
    monkeypatch.chdir(tmp_path)  # no .env picked up
    for k, v in SECRETS.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("DATA_PASSPHRASE", "pw")
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(tmp_path / "summary.md"))
    monkeypatch.setenv("RENEW_FILE", str(tmp_path / "renew.txt"))
    monkeypatch.setattr(time, "sleep", lambda s: None)

    def use(handler):
        real = httpx.Client

        def client(*a, **kw):
            kw["transport"] = httpx.MockTransport(handler)
            return real(*a, **kw)

        monkeypatch.setattr(httpx, "Client", client)

    return use


def _outputs(tmp_path, capsys, caplog) -> str:
    cap = capsys.readouterr()
    files = [tmp_path / "summary.md", tmp_path / "renew.txt"]
    return "\n".join([cap.out, cap.err, caplog.text, *(f.read_text() for f in files if f.exists())])


@pytest.mark.parametrize("layers", ["errors seulement", "errors + redact"])
def test_collection_with_every_source_failing_leaks_nothing(tmp_path, monkeypatch, capsys, caplog, all_sources, layers):
    from collector.__main__ import main

    if layers == "errors seulement":
        # The first defence alone: no redaction of logs or messages at all.
        monkeypatch.setattr(redact, "redact", lambda text: text)
        monkeypatch.setattr(redact, "install", lambda streams=None: None)
    else:
        monkeypatch.setenv("GITHUB_ACTIONS", "true")
    all_sources(router())
    caplog.set_level(logging.INFO)
    main(["-v", "sync"])
    out = _outputs(tmp_path, capsys, caplog)
    assert_clean(out, layers)
    # The failures are still reported, with what is safe: source, endpoint, status, category.
    assert "Open-Meteo : /v1/archive → HTTP 429 (trop de requêtes)" in out
    assert "Linky (Conso API) : /api/consommation_quotidienne → HTTP 500 (erreur du serveur)" in out
    assert "Shelly : interface/device/list → HTTP 503" in out or "Shelly : device/all_status → HTTP 503" in out
    assert "Station Netatmo : /oauth2/token → HTTP 400 (requête refusée, invalid_grant)" in out
    assert "Plusieurs maisons trouvées (2)" in out
    # The encrypted meta keeps the same safe messages.
    sources = Store(tmp_path / "data", "pw").meta["sources"]
    assert_clean(json.dumps(sources), "sources")
    assert sources["open-meteo"]["message"].startswith("Open-Meteo : /v1/archive → HTTP 429")


def test_fatal_intuis_error_leaks_nothing_in_message_traceback_or_summary(
    tmp_path, monkeypatch, capsys, caplog, all_sources
):
    from collector.__main__ import main
    from collector.api import ApiError

    all_sources(router(intuis_measures_ok=False))
    caplog.set_level(logging.INFO)
    with pytest.raises(ApiError) as err:
        main(["-v", "sync"])
    assert "HTTP 400" in str(err.value)
    assert_clean(str(err.value), "str")
    # What Python prints for the uncaught exception goes through the redacting excepthook.
    sys.excepthook(type(err.value), err.value, err.value.__traceback__)
    out = _outputs(tmp_path, capsys, caplog)
    assert_clean(out, "outputs")
    assert "collector.api.ApiError: Aucune méthode de mesure ne répond" in out


# ---------------------------------------------------------------- each client, unit level
def _http(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _status(code: int):
    return lambda request: httpx.Response(code, json=ECHO)


def _unreachable(kind=httpx.ConnectError):
    def handler(request):
        raise kind(f"failed {request.url} {request.headers.get('Authorization', '')}")

    return handler


def _intuis(handler):
    from collector.api import IntuisClient

    s = Settings(username=SECRETS["INTUIS_USERNAME"], password=SECRETS["INTUIS_PASSWORD"], client_id="c")
    s.client_secret, s.api_base = "s", "https://app.muller-intuitiv.net"
    return IntuisClient(s, http=_http(handler), min_interval=0)


def call_intuis_login(handler):
    _intuis(handler).login()


def call_intuis_measure(handler):
    def wrapped(request):
        if request.url.path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": ACCESS, "expires_in": 3600})
        return handler(request)

    _intuis(wrapped).room_measure(
        HOME_ID, ROOMS["100"], measure_type="sum_energy_elec", scale="1day", date_begin=0, date_end=1
    )


def call_open_meteo(handler):
    from collector.weather import open_meteo

    open_meteo(Store(Path(_tmp()), "pw"), LAT, LON, "Europe/Paris", "2024-01-01", http=_http(handler))


def call_station_login(handler):
    from collector.station import Station

    Station(Store(Path(_tmp()), "pw"), "id", "secret", SECRETS["NETATMO_REFRESH_TOKEN"], http=_http(handler)).login()


def call_station_get(handler):
    from collector.station import Station

    st = Station(Store(Path(_tmp()), "pw"), "id", "secret", "seed", http=_http(handler), min_interval=0)
    st.access = ACCESS
    st._get("/api/getmeasure", {"device_id": MODULES["gw"], "module_id": MODULES["m1"]})


def call_linky(handler):
    from collector.enedis import collect

    collect(Store(Path(_tmp()), "pw"), SECRETS["ENEDIS_TOKEN"], PRM, "2024-01-01", "Europe/Paris", _http(handler), 0)


def call_linky_curve(handler):
    from collector.enedis import collect_curve

    collect_curve(
        Store(Path(_tmp()), "pw"), SECRETS["ENEDIS_TOKEN"], PRM, "2024-01-01", "Europe/Paris", _http(handler), 0
    )


def call_shelly(handler):
    from collector.shelly import collect

    collect(
        Store(Path(_tmp()), "pw"),
        SECRETS["SHELLY_AUTH_KEY"],
        SECRETS["SHELLY_SERVER"],
        "Europe/Paris",
        _http(handler),
        0,
    )


_TMP: list[Path] = []


def _tmp() -> str:
    return str(_TMP[-1])


CLIENTS = [
    call_intuis_login,
    call_intuis_measure,
    call_open_meteo,
    call_station_login,
    call_station_get,
    call_linky,
    call_linky_curve,
    call_shelly,
]


@pytest.mark.parametrize("call", CLIENTS, ids=lambda f: f.__name__.removeprefix("call_"))
@pytest.mark.parametrize(
    "failure",
    [
        _status(400),
        _status(401),
        _status(404),
        _status(429),
        _status(503),
        _unreachable(),
        _unreachable(httpx.ReadTimeout),
    ],
    ids=["400", "401", "404", "429", "503", "connect", "timeout"],
)
def test_every_client_error_carries_only_source_endpoint_status_and_category(tmp_path, monkeypatch, call, failure):
    from collector.errors import SourceError

    monkeypatch.setattr(time, "sleep", lambda s: None)
    _TMP.append(tmp_path)
    with pytest.raises(SourceError) as err:
        call(failure)
    e = err.value
    text = str(e)
    assert_clean(text, call.__name__)
    assert "?" not in text and "://" not in text
    # No httpx error (its message holds the URL) printed as the cause or the context.
    assert e.__cause__ is None and (e.__context__ is None or e.__suppress_context__)
    assert e.source and e.category
    assert e.status is None or f"HTTP {e.status}" in text
    assert_clean(redact.safe_traceback(e), "traceback")


def test_intuis_error_inside_a_200_answer_keeps_only_the_numeric_code():
    from collector.api import ApiError

    def handler(request):
        if request.url.path == "/oauth2/token":
            return httpx.Response(200, json={"access_token": ACCESS, "expires_in": 3600})
        return httpx.Response(200, json=ECHO)

    with pytest.raises(ApiError) as err:
        _intuis(handler).homestatus(HOME_ID)
    assert str(err.value) == "Intuis : /syncapi/v1/homestatus → erreur de l'API (21)"


def test_status_category_and_endpoint_template():
    from collector.errors import SourceError, endpoint_of, safe_code

    assert endpoint_of(f"https://x/v1/archive?latitude={LAT}") == "/v1/archive"
    assert endpoint_of(f"/api/getmeasure?device_id={MODULES['gw']}") == "/api/getmeasure"
    assert endpoint_of(f"/devices/{MODULES['gw']}") == "(chemin)"
    assert safe_code("invalid_grant") == "invalid_grant" and safe_code(21) == "21"
    assert safe_code(f"bad {HOME_ID}") == "" and safe_code(True) == ""
    assert str(SourceError(endpoint="/x", status=429, source="S")) == "S : /x → HTTP 429 (trop de requêtes)"


# ---------------------------------------------------------------- defence in depth
def test_redact_strips_queries_tokens_ids_and_registered_values():
    redact.register(HOME_NAME)
    redact.register_coordinate(LAT)
    text = (
        f"GET https://archive-api.open-meteo.com/v1/archive?latitude=48.86&longitude=2.35 "
        f"Authorization: Bearer {ACCESS} home {HOME_ID} mac {MODULES['gw']} prm {PRM} "
        f'{{"refresh_token": "abc", "home_id": "{OTHER_HOME_ID}"}} mail {SECRETS["INTUIS_USERNAME"]} '
        f"name {HOME_NAME} lat {LAT} jwt eyJhbGciOi.eyJzdWIiOiIx.c2ln"
    )
    out = redact.redact(text)
    assert_clean(out)
    assert "abc" not in out and "eyJ" not in out
    assert "https://archive-api.open-meteo.com/v1/archive?[masqué]" in out
    # Ordinary numbers and words are left alone.
    assert (
        redact.redact("12.357 kWh, 2024-01-01, HTTP 429, 141 appels") == "12.357 kWh, 2024-01-01, HTTP 429, 141 appels"
    )


def test_log_records_and_exceptions_are_redacted_once_installed(caplog):
    redact.install(streams=False)
    log = logging.getLogger("collector.test")
    request = httpx.Request("GET", f"https://archive-api.open-meteo.com/v1/archive?latitude={LAT}&longitude={LON}")
    err = httpx.HTTPStatusError("429 for url " + str(request.url), request=request, response=httpx.Response(429))
    with caplog.at_level(logging.INFO):
        log.info("url %s", request.url)
        try:
            raise KeyError(HOME_ID)
        except KeyError:
            log.exception("échec")
        try:
            raise RuntimeError("wrapped") from err
        except RuntimeError:
            log.exception("échec bis")
    text = caplog.text + "".join(r.exc_text or "" for r in caplog.records)
    assert_clean(text)
    assert "builtins.KeyError: erreur KeyError (message masqué" in text
    assert "httpx.HTTPStatusError" in text


def test_streams_are_redacted_in_github_actions(capsys, monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    redact.register(HOME_NAME)
    redact.install()
    print(f"Maison : {HOME_NAME} https://x/y?pointId={PRM}")
    print(f"erreur {HOME_ID}", file=sys.stderr)
    redact.uninstall()
    cap = capsys.readouterr()
    assert_clean(cap.out + cap.err)
    assert cap.out.startswith("Maison : [masqué] https://x/y?[masqué]")


def test_secrets_of_the_settings_are_registered():
    s = Settings(password=SECRETS["INTUIS_PASSWORD"], enedis_prm=PRM, room_categories={ROOMS["100"]: "ignore"})
    redact.register(*s.secret_values())
    assert_clean(redact.redact(f"{SECRETS['INTUIS_PASSWORD']} {ROOMS['100']}"))


# ---------------------------------------------------------------- #264
def test_several_homes_logs_a_count_never_a_name(caplog):
    from collector.sync import Syncer

    class Client:
        def homesdata(self):
            return homesdata()

    with caplog.at_level(logging.WARNING):
        Syncer(Client(), store=None).home()  # type: ignore[arg-type]
    assert "Plusieurs maisons trouvées (2)" in caplog.text
    assert "Zorglub" not in caplog.text


# ---------------------------------------------------------------- #271
def test_decrypt_refuses_an_unbounded_iteration_count_without_deriving():
    from collector.crypto import DecryptError, decrypt_json, encrypt_json

    env = encrypt_json({"a": 1}, "pw", b"0" * 16, iterations=100_000)
    for bad in (10**9, 1, "600000", True, None):
        start = time.monotonic()
        with pytest.raises(DecryptError):
            decrypt_json({**env, "iter": bad}, "pw")
        assert time.monotonic() - start < 0.5
    with pytest.raises(DecryptError):
        decrypt_json({**env, "kdf": "scrypt"}, "pw")
    with pytest.raises(DecryptError):
        decrypt_json({**env, "v": 2}, "pw")
    assert decrypt_json(env, "pw") == {"a": 1}


def test_snapshot_with_a_huge_iteration_count_is_counted_unreadable(tmp_path):
    from collector.roomstate import read_snapshots

    (tmp_path / "etat-1.enc.json").write_text(
        json.dumps({"v": 1, "kdf": "PBKDF2-SHA256", "iter": 10**10, "salt": "AAAA", "iv": "AAAA", "ct": "AAAA"})
    )
    start = time.monotonic()
    assert read_snapshots(tmp_path, "pw") == ([], 1)
    assert time.monotonic() - start < 0.5


# ---------------------------------------------------------------- #274
def test_tempo_keeps_only_real_dates_of_the_season():
    sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
    import tempo_jours

    payload = [
        {"dateJour": "2024-09-01", "codeJour": 1},
        {"dateJour": "2025-01-15", "codeJour": 3},
        {"dateJour": "<img src=x onerror=alert(1)>", "codeJour": 2},
        {"dateJour": "2025-02-30", "codeJour": 2},
        {"dateJour": "2023-01-15", "codeJour": 2},  # another season
        {"dateJour": "2025-01-16", "codeJour": True},
        {"dateJour": "2025-01-17", "codeJour": 0},  # colour not known yet: skipped silently
        "texte",
    ]
    days, ignored = tempo_jours.parse_season(payload, 2024)
    assert days == {"2024-09-01": 1, "2025-01-15": 3}
    assert ignored == 5
    assert tempo_jours.parse_season({"dateJour": "x"}, 2024) == ({}, 0)
