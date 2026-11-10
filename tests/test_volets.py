"""#200: shutter readings from the NAS — decryption, strict validation, daily aggregation, refusal
of crafted inputs, and the NAS script itself (dash / busybox) against a fake hub and a fake GitHub.

Keys and certificates are made on the fly for the tests: no real key, secret or reading here."""

import base64
import json
import os
import shutil
import subprocess
import threading
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs7
from cryptography.x509.oid import NameOID

from collector import __main__ as cli
from collector import volets
from collector.storage import Store
from collector.volets import VoletsError, aggregate, parse, receive

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "nas" / "volets.sh"
FIX = Path(__file__).parent / "fixtures" / "wiser-domain.json"
TZ = "Europe/Paris"
PARIS = ZoneInfo(TZ)
DAY = "2026-01-15"
PASS = "phrase de test"


def make_pair(cn="volets-test"):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    now = datetime.now(PARIS)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=30))
        .sign(key, hashes.SHA256())
    )
    key_pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    return key_pem, cert.public_bytes(serialization.Encoding.PEM).decode(), cert


@pytest.fixture(scope="module")
def pair():
    return make_pair()


def seal(text: str, cert) -> str:
    """What the NAS sends: CMS enveloped data (AES-256), DER, base64."""
    der = (
        pkcs7.PKCS7EnvelopeBuilder()
        .set_data(text.encode())
        .add_recipient(cert)
        .set_content_encryption_algorithm(_aes256())
        .encrypt(serialization.Encoding.DER, [pkcs7.PKCS7Options.Binary])
    )
    return base64.b64encode(der).decode()


def _aes256():
    from cryptography.hazmat.primitives.ciphers import algorithms

    return algorithms.AES256


def at(hhmm: str, day: str = DAY) -> int:
    h, m = map(int, hhmm.split(":"))
    return int(datetime.fromisoformat(day).replace(hour=h, minute=m, tzinfo=PARIS).timestamp())


def counts(hours=range(24), ko=0, day=DAY):
    c = [6 if h in hours else 0 for h in range(24)]
    return f"C;{day};{','.join(map(str, c))};{ko}"


def journal(*lines, day=DAY, c=None):
    return "\n".join([f"J;1;{day}", *lines, c or counts(day=day)]) + "\n"


EXAMPLE = journal(
    "N;1;Salon",
    "N;2;Chambre",
    f"S;{at('00:05')};1;0;Stopped;FromSchedule",
    f"S;{at('00:05')};2;0;Stopped;FromSchedule",
    f"S;{at('07:30')};1;100;Stopped;FromSchedule",
    f"S;{at('08:10')};2;50;Stopped;FromManualControl",
    f"S;{at('18:00')};1;40;Closing;FromSchedule",
    f"S;{at('18:01')};1;0;Stopped;FromSchedule",
    f"S;{at('23:10')};2;0;Stopped;FromManualControl",
)


def store(tmp_path):
    return Store(tmp_path / "data", PASS)


# ------------------------------------------------------------------ round trip
def test_un_journal_chiffre_est_verse_agrege_et_pseudonymise(tmp_path, pair):
    key_pem, cert_pem, cert = pair
    s = store(tmp_path)
    summary, rec = receive(s, DAY, seal(EXAMPLE, cert), "", key_pem + cert_pem, None, TZ)
    assert summary == f"relevé du {DAY} enregistré : 24/24 heures relevées"
    doc = Store(tmp_path / "data", PASS).doc("volets")
    assert doc["v"] == 1 and doc["received"] == DAY
    # hub ids never stored: stable keys, names kept (encrypted)
    assert {v["name"] for v in doc["shutters"].values()} == {"Salon", "Chambre"}
    assert set(doc["shutters"]) == {"v0", "v1"}
    assert "1" not in json.dumps(doc["module_keys"]["keys"]).split('"')[3::4]
    day = doc["days"][DAY]
    by_name = {doc["shutters"][k]["name"]: v for k, v in day["shutters"].items()}
    salon, chambre = by_name["Salon"], by_name["Chambre"]
    assert salon["open"] == "07:30" and salon["close"] == "18:01" and salon["close_src"] == "FromSchedule"
    assert salon["at22"] == 0 and salon["moves"] == 3
    # Salon: 0 from 00:05 to 07:30, 100 to 18:00, 40 for a minute, 0 to 24:00
    expected = (0 * 445 + 100 * 630 + 40 * 1 + 0 * 359) / (24 * 60 - 5)
    assert salon["mean"] == round(expected, 1)
    # Chambre: opened halfway in the morning, closed after 22 h (late) → open at 22 h
    assert chambre["open"] == "08:10" and "close" in chambre and chambre["close"] == "23:10"
    assert chambre["at22"] == 50
    assert day["evening"] == [1, 2]
    assert day["cov"] == [6] * 24 and day["ko"] == 0


def test_renvoyer_le_meme_jour_ne_change_rien(tmp_path, pair):
    key_pem, cert_pem, cert = pair
    s = store(tmp_path)
    receive(s, DAY, seal(EXAMPLE, cert), "", key_pem + cert_pem, None, TZ)
    first = (tmp_path / "data" / "volets.enc.json").read_text()
    s2 = store(tmp_path)
    receive(s2, DAY, seal(EXAMPLE, cert), "", key_pem + cert_pem, None, TZ)
    assert (tmp_path / "data" / "volets.enc.json").read_text() == first  # plaintext unchanged: not rewritten


def test_certificat_du_depot_prefere_et_verifie(tmp_path, pair):
    key_pem, cert_pem, cert = pair
    published = tmp_path / "volets-certificat.pem"
    published.write_text(cert_pem)
    receive(store(tmp_path), DAY, seal(EXAMPLE, cert), "", key_pem, published, TZ)
    other_key, other_cert_pem, _ = make_pair("autre")
    published.write_text(other_cert_pem)
    with pytest.raises(VoletsError, match="ne correspond pas"):
        receive(store(tmp_path), DAY, seal(EXAMPLE, cert), "", key_pem, published, TZ)
    with pytest.raises(VoletsError, match="certificat introuvable"):
        receive(store(tmp_path), DAY, seal(EXAMPLE, cert), "", key_pem, None, TZ)


# ------------------------------------------------------------------ the evening is never guessed
def test_soir_sans_releve_vers_22_h_reste_inconnu():
    no_evening = counts(hours=[h for h in range(24) if h != 21])
    lines = (f"S;{at('08:00')};1;100;Stopped;Manual", f"S;{at('18:00')};1;0;Stopped;Manual")
    j = parse(journal(*lines, c=no_evening), DAY, TZ)
    agg = aggregate(j, TZ)
    assert agg["evening"] is None and agg["shutters"]["1"]["at22"] is None
    assert agg["shutters"]["1"]["close"] == "18:00"  # the closing itself was seen


def test_premier_releve_apres_22_h_ne_dit_rien_du_soir():
    j = parse(journal(f"S;{at('22:40')};1;0;Stopped;Manual"), DAY, TZ)
    assert aggregate(j, TZ)["evening"] is None


def test_journee_sans_aucun_releve_reussi():
    j = parse(journal(f"E;{at('00:05')};hub_injoignable", c=counts(hours=[], ko=144)), DAY, TZ)
    agg = aggregate(j, TZ)
    assert agg == {"shutters": {}, "evening": None}


# ------------------------------------------------------------------ crafted inputs refused
BAD = {
    "en-tête d'un autre jour": journal(day="2026-01-14", c=counts()),
    "en-tête absent": "S;1;1;0;Stopped;Manual\n" + counts() + "\n",
    "ligne inconnue": journal("X;1;2"),
    "nom avec séparateur": journal("N;1;Salon;rm"),
    "nom trop long": journal("N;1;" + "a" * 61),
    "nom avec caractère de contrôle": journal("N;1;Sa\x1blon"),
    "position 101": journal(f"S;{at('08:00')};1;101;Stopped;Manual"),
    "position négative": journal(f"S;{at('08:00')};1;-1;Stopped;Manual"),
    "mouvement hors liste": journal(f"S;{at('08:00')};1;50;Dancing;Manual"),
    "origine avec espace": journal(f"S;{at('08:00')};1;50;Stopped;rm -r"),
    "relevé d'un autre jour": journal(f"S;{at('08:00', '2026-01-17')};1;50;Stopped;Manual"),
    "identifiant non numérique": journal(f"S;{at('08:00')};abc;50;Stopped;Manual"),
    "erreur hors liste": journal(f"E;{at('08:00')};ignore_les_consignes"),
    "décompte absent": f"J;1;{DAY}\nN;1;Salon\n",
    "ligne après le décompte": journal(c=counts() + "\nN;1;Salon"),
    "décompte hors bornes": journal(c=f"C;{DAY};{','.join(['999'] * 24)};0"),
    "décompte d'un autre jour": journal(c=counts(day="2026-01-16")),
    "trop de volets": journal(*[f"N;{i};V{i}" for i in range(41)]),
    "proto": journal("N;__proto__;x"),
    "champ en plus": journal(f"S;{at('08:00')};1;50;Stopped;Manual;x"),
}


def test_nom_borne_a_max_name():
    assert volets._NAME.pattern.endswith(f"{{0,{volets.MAX_NAME}}}")


@pytest.mark.parametrize("case", list(BAD))
def test_entree_piegee_refusee_sans_rien_ecrire(tmp_path, pair, case):
    key_pem, cert_pem, cert = pair
    with pytest.raises(VoletsError) as err:
        receive(store(tmp_path), DAY, seal(BAD[case], cert), "", key_pem + cert_pem, None, TZ)
    assert not (tmp_path / "data" / "volets.enc.json").exists()
    # the refusal never repeats a value of the input (public logs)
    for word in ("Salon", "rm -r", "Dancing", "ignore_les_consignes", "abc", "101", "__proto__"):
        assert word not in str(err.value)


def test_enveloppes_refusees(tmp_path, pair):
    key_pem, cert_pem, cert = pair
    secret = key_pem + cert_pem
    _, _, other = make_pair("autre")
    cases = {
        "vide": "",
        "pas du base64": "%%%",
        "trop long": "A" * (volets.MAX_INPUT + 4),
        "chiffré pour une autre clé": seal(EXAMPLE, other),
        "pas du CMS": base64.b64encode(b"bonjour").decode(),
        "trop gros une fois ouvert": seal(journal(*["N;1;" + "a" * 60] * 800), cert),
    }
    for name, b64 in cases.items():
        with pytest.raises(VoletsError):
            receive(store(tmp_path), DAY, b64, "", secret, None, TZ)
        assert not (tmp_path / "data" / "volets.enc.json").exists(), name
    with pytest.raises(VoletsError, match="jour invalide"):
        receive(store(tmp_path), "2026-02-30", seal(EXAMPLE, cert), "", secret, None, TZ)
    with pytest.raises(VoletsError, match="jour invalide"):
        receive(store(tmp_path), "../x", "", "aucun_releve", secret, None, TZ)
    with pytest.raises(VoletsError, match="inconnu"):
        receive(store(tmp_path), DAY, "", "rm_rf", secret, None, TZ)
    with pytest.raises(VoletsError, match="à la fois"):
        receive(store(tmp_path), DAY, seal(EXAMPLE, cert), "aucun_releve", secret, None, TZ)
    with pytest.raises(VoletsError, match="illisible"):
        receive(store(tmp_path), DAY, seal(EXAMPLE, cert), "", "pas une clé", None, TZ)


def test_un_echec_signale_n_efface_pas_un_jour_recu(tmp_path, pair):
    key_pem, cert_pem, cert = pair
    receive(store(tmp_path), DAY, seal(EXAMPLE, cert), "", key_pem + cert_pem, None, TZ)
    summary, rec = receive(store(tmp_path), DAY, "", "hub_injoignable", key_pem + cert_pem, None, TZ)
    assert "passerelle injoignable" in summary
    day = Store(tmp_path / "data", PASS).doc("volets")["days"][DAY]
    assert day["err"] == ["hub_injoignable"] and len(day["shutters"]) == 2
    _, rec = receive(store(tmp_path), "2026-01-16", "", "aucun_releve", "", None, TZ)
    assert rec == {"err": ["aucun_releve"]}


# ------------------------------------------------------------------ the CLI and its public log
def test_commande_volets_journal_public_sans_nom_ni_valeur(tmp_path, pair, monkeypatch, capsys):
    key_pem, cert_pem, cert = pair
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATA_PASSPHRASE", PASS)
    monkeypatch.setenv("VOLETS_PRIVATE_KEY", key_pem + cert_pem)
    monkeypatch.setenv("VOLETS_JOUR", DAY)
    monkeypatch.setenv("VOLETS_JOURNAL", seal(EXAMPLE, cert))
    monkeypatch.setenv("VOLETS_ERREUR", "")
    alert = tmp_path / "alerte.txt"
    cli.main(["volets", "--certificat", str(tmp_path / "absent.pem"), "--alerte", str(alert)])
    out = capsys.readouterr()
    text = out.out + out.err
    assert "enregistré" in text and not alert.exists()
    for word in ("Salon", "Chambre", "07:30", "18:01", "BEGIN"):
        assert word not in text
    # a failure reported by the NAS is saved, then written for the step that fails the run
    monkeypatch.setenv("VOLETS_JOURNAL", "")
    monkeypatch.setenv("VOLETS_ERREUR", "secret_refuse")
    cli.main(["volets", "--alerte", str(alert)])
    assert "secret de la passerelle refusé" in alert.read_text()
    # a refused input stops the run with an error, nothing written
    monkeypatch.setenv("VOLETS_ERREUR", "")
    monkeypatch.setenv("VOLETS_JOURNAL", seal(BAD["ligne inconnue"], cert))
    with pytest.raises(SystemExit, match="refusé"):
        cli.main(["volets", "--certificat", str(tmp_path / "absent.pem")])


def test_workflow_volets_passe_les_entrees_par_l_environnement():
    import yaml

    wf = yaml.safe_load((ROOT / ".github" / "workflows" / "volets.yml").read_text())
    steps = wf["jobs"]["volets"]["steps"]
    for st in steps:
        # an input expanded inside a script would be a command injection
        assert "inputs." not in st.get("run", ""), st.get("name")
        # secrets only where needed
        if "secrets." in json.dumps(st.get("env", {})):
            assert st.get("name") in {None, "Vérification et agrégation"} or st.get("id") == "check"
    assert wf["permissions"] == {"contents": "read"}
    assert wf["jobs"]["volets"]["permissions"] == {"contents": "write"}
    pip = [st for st in steps if "pip install" in st.get("run", "")]
    assert pip and "--require-hashes" in pip[0]["run"] and "env" not in pip[0]


# ------------------------------------------------------------------ the NAS script
SHELLS = [s for s in (["dash"], ["busybox", "sh"]) if shutil.which(s[0])] or [["sh"]]


class Fake(BaseHTTPRequestHandler):
    hub_body = b""
    hub_status = 200
    requests: list = []

    def log_message(self, *a):
        pass

    def do_GET(self):
        Fake.requests.append(("GET", self.path, dict(self.headers), b""))
        self.send_response(Fake.hub_status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(Fake.hub_body)

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        Fake.requests.append(("POST", self.path, dict(self.headers), body))
        self.send_response(204)
        self.end_headers()


@pytest.fixture
def server():
    Fake.requests = []
    Fake.hub_status = 200
    Fake.hub_body = FIX.read_bytes()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    yield srv
    srv.shutdown()


def nas(tmp_path, server, cert_pem=None):
    """A NAS folder: the script, its configuration (600) and a fake clock."""
    home = tmp_path / "nas"
    home.mkdir()
    shutil.copy(SCRIPT, home / "volets.sh")
    if cert_pem:
        (home / "volets-certificat.pem").write_text(cert_pem)
    port = server.server_address[1]
    conf = home / "volets.conf"
    conf.write_text(
        f"HUB=127.0.0.1:{port}\nHUB_SECRET='s3cr3t-du-hub\"x'\nGITHUB_TOKEN=github_pat_FAUX\n"
        f"GITHUB_API=http://127.0.0.1:{port}\n"
    )
    conf.chmod(0o600)
    bin_ = home / "bin"
    bin_.mkdir()
    real = shutil.which("date")
    (bin_ / "date").write_text(
        f'#!/bin/sh\ncase "$*" in *-d*) exec {real} "$@" ;; esac\nexec {real} -d "@$FAKE_NOW" "$@"\n'
    )
    (bin_ / "date").chmod(0o755)
    return home


def run(shell, home, cmd, now):
    env = {**os.environ, "PATH": f"{home / 'bin'}:{os.environ['PATH']}", "FAKE_NOW": str(now), "TZ": TZ}
    return subprocess.run([*shell, str(home / "volets.sh"), cmd], env=env, capture_output=True, text=True, timeout=60)


@pytest.mark.parametrize("shell", SHELLS, ids=lambda s: s[0])
def test_script_nas_releve_puis_envoi_de_bout_en_bout(tmp_path, server, pair, shell):
    key_pem, cert_pem, _ = pair
    home = nas(tmp_path, server, cert_pem)
    data = home / "donnees"
    r = run(shell, home, "releve", at("21:30"))
    assert r.returncode == 0, r.stderr
    hub = [q for q in Fake.requests if q[0] == "GET"]
    assert hub[0][1] == "/data/v2/domain/" and hub[0][2]["SECRET"] == 's3cr3t-du-hub"x'
    lines = (data / f"journal-{DAY}.txt").read_text().splitlines()
    assert lines[0] == f"J;1;{DAY}"
    assert f"S;{at('21:30')};1;100;Stopped;FromSchedule" in lines
    assert f"S;{at('21:30')};3;44;Other;Other" in lines  # crafted movement and origin normalised
    assert "N;2;Chambre  parents" in lines  # no field separator left in a name
    # nothing changed: nothing written
    run(shell, home, "releve", at("21:40"))
    assert len((data / f"journal-{DAY}.txt").read_text().splitlines()) == len(lines)
    # one shutter closes
    Fake.hub_body = FIX.read_bytes().replace(b'"CurrentLift":100,"TargetLift"', b'"CurrentLift":0,"TargetLift"')
    run(shell, home, "releve", at("22:20"))
    after = (data / f"journal-{DAY}.txt").read_text().splitlines()
    assert after[len(lines) :] == [f"S;{at('22:20')};1;0;Stopped;FromSchedule"]
    # the hub fails: one error line, then silence until it answers again
    Fake.hub_status = 401
    assert run(shell, home, "releve", at("22:30")).returncode == 2
    run(shell, home, "releve", at("22:40"))
    errs = [x for x in (data / f"journal-{DAY}.txt").read_text().splitlines() if x.startswith("E;")]
    assert errs == [f"E;{at('22:30')};secret_refuse"]
    # the secret and the token are in no file of the NAS folder
    for f in data.rglob("*"):
        if f.is_file():
            assert b"s3cr3t" not in f.read_bytes() and b"github_pat" not in f.read_bytes()
    # next night: the finished day is encrypted and sent, then not sent again
    Fake.requests = []
    r = run(shell, home, "envoi", at("00:30", "2026-01-16"))
    assert r.returncode == 0, r.stderr + (data / "volets.log").read_text()
    posts = [q for q in Fake.requests if q[0] == "POST"]
    assert len(posts) == 1
    assert posts[0][1] == "/repos/Opaland/Netatmo/actions/workflows/volets.yml/dispatches"
    assert posts[0][2]["Authorization"] == "Bearer github_pat_FAUX"
    body = json.loads(posts[0][3])
    assert body["ref"] == "main" and body["inputs"]["jour"] == DAY and "erreur" not in body["inputs"]
    assert b"Salon" not in posts[0][3] and b"FromSchedule" not in posts[0][3]  # encrypted
    # what the workflow does with it: decrypted, validated and aggregated
    s = Store(tmp_path / "data", PASS)
    _, rec = receive(s, DAY, body["inputs"]["journal"], "", key_pem + cert_pem, None, TZ)
    assert rec["cov"][21] == 2 and rec["cov"][22] == 1 and rec["ko"] == 2
    assert rec["err"] == ["secret_refuse"]
    assert rec["evening"] == [1, 3]  # at 22 h: the shutter 2 closed, 1 and 3 not yet
    names = {v["name"] for v in s.doc("volets")["shutters"].values()}
    assert names == {'Séjour "sud"', "Chambre  parents", ""}
    Fake.requests = []
    run(shell, home, "envoi", at("00:40", "2026-01-16"))
    assert not [q for q in Fake.requests if q[0] == "POST"]


@pytest.mark.parametrize("shell", SHELLS, ids=lambda s: s[0])
def test_script_nas_envoie_une_erreur_plutot_que_rien(tmp_path, server, shell):
    home = nas(tmp_path, server)  # no certificate on the NAS
    run(shell, home, "releve", at("10:00"))
    r = run(shell, home, "envoi", at("00:30", "2026-01-16"))
    assert r.returncode == 0, r.stderr
    body = json.loads([q for q in Fake.requests if q[0] == "POST"][0][3])
    assert body["inputs"] == {"jour": DAY, "erreur": "certificat_absent"}
    # a night with no reading at all is reported too
    Fake.requests = []
    run(shell, home, "envoi", at("00:30", "2026-01-18"))
    body = json.loads([q for q in Fake.requests if q[0] == "POST"][0][3])
    assert body["inputs"] == {"jour": "2026-01-17", "erreur": "aucun_releve"}


@pytest.mark.parametrize("shell", SHELLS, ids=lambda s: s[0])
def test_script_nas_refuse_une_configuration_lisible_par_tous(tmp_path, server, shell):
    home = nas(tmp_path, server)
    (home / "volets.conf").chmod(0o644)
    r = run(shell, home, "releve", at("10:00"))
    assert r.returncode != 0 and "chmod 600" in r.stderr
    assert not [q for q in Fake.requests if q[0] == "GET"]


@pytest.mark.parametrize("shell", SHELLS, ids=lambda s: s[0])
def test_script_nas_test_affiche_sans_le_secret(tmp_path, server, shell):
    home = nas(tmp_path, server)
    r = run(shell, home, "test", at("10:00"))
    assert r.returncode == 0, r.stderr
    assert "génération 1" in r.stdout and "3 volet(s)" in r.stdout and "fermé" in r.stdout
    assert "s3cr3t" not in r.stdout + r.stderr
    assert not (home / "donnees" / f"journal-{DAY}.txt").exists()


def test_script_nas_ne_fait_que_lire_la_passerelle():
    """Read only: the hub is only ever asked with GET (no -X, no data towards it)."""
    text = SCRIPT.read_text()
    hub_calls = [line for line in text.splitlines() if "$url" in line and "curl" in line]
    assert hub_calls and all("-X" not in c and "--data" not in c for c in hub_calls)
    assert text.count("-X POST") == 1 and "dispatches" in text
