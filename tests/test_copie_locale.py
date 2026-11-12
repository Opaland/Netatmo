"""#143: the NAS local copy (scripts/nas/copie-locale/) — the nightly script under dash and busybox
against a made-up repository (a local bare repository stands for GitHub), the small static server,
and the container files read statically (no Docker daemon in CI).

Only made-up files here: no real data, no address, no secret."""

import json
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / "scripts" / "nas" / "copie-locale"
SCRIPT = DIR / "copie-locale.sh"
SHELLS = [s for s in (["dash"], ["busybox", "sh"]) if shutil.which(s[0])] or [["sh"]]
NEEDS_GIT = pytest.mark.skipif(not shutil.which("git"), reason="git absent")

# The build stands in for `npm ci && npm run build`: it counts its runs and can be made to fail.
BUILD = 'echo x >> "$COMPTEUR" && [ ! -f ECHEC ] && mkdir -p dist && cp page.html dist/index.html'


def git(cwd, *args):
    subprocess.run(
        ["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
    )


@pytest.fixture
def depot(tmp_path):
    """A working repository pushed to a bare one (the « GitHub » of the test)."""
    origin = tmp_path / "origin.git"
    work = tmp_path / "travail"
    subprocess.run(["git", "init", "--quiet", "--bare", "-b", "main", str(origin)], check=True)
    (work / "web").mkdir(parents=True)
    (work / "data").mkdir()
    (work / "web" / "page.html").write_text("<p>version 1</p>\n")
    (work / "data" / "keyinfo.json").write_text('{"salt": "AAAA", "iter": 1}\n')
    (work / "data" / "2026.enc.json").write_text('{"v": 1}\n')
    git(tmp_path, "init", "--quiet", "-b", "main", str(work))
    git(work, "add", "-A")
    git(work, "commit", "--quiet", "-m", "un")
    git(work, "remote", "add", "origin", str(origin))
    git(work, "push", "--quiet", "origin", "main")
    return work, origin


def commit(work, files, msg):
    for name, text in files.items():
        p = work / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    git(work, "add", "-A")
    git(work, "commit", "--quiet", "-m", msg)
    git(work, "push", "--quiet", "origin", "main")


def run(shell, tmp_path, origin, cmd="synchro", **env):
    base = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": str(tmp_path),
        "COPIE": str(tmp_path / "copie"),
        "DEPOT_URL": f"file://{origin}",
        "CONSTRUIRE": BUILD,
        "COMPTEUR": str(tmp_path / "constructions.txt"),
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_NOSYSTEM": "1",
    }
    base.update(env)
    return subprocess.run([*shell, str(SCRIPT), cmd], env=base, capture_output=True, text=True, timeout=120)


def actuelle(tmp_path) -> Path:
    return (tmp_path / "copie" / "site" / "actuelle").resolve()


def builds(tmp_path) -> int:
    f = tmp_path / "constructions.txt"
    return len(f.read_text().split()) if f.exists() else 0


@NEEDS_GIT
@pytest.mark.parametrize("shell", SHELLS, ids=lambda s: s[0])
def test_synchro_publie_l_appli_et_les_donnees_chiffrees(tmp_path, depot, shell):
    work, origin = depot
    r = run(shell, tmp_path, origin)
    assert r.returncode == 0, r.stderr
    site = actuelle(tmp_path)
    assert (site / "index.html").read_text() == "<p>version 1</p>\n"
    assert (site / "data" / "2026.enc.json").exists()
    assert (site / "data" / "keyinfo.json").exists()
    link = (tmp_path / "copie" / "site" / "actuelle").readlink()
    assert not link.is_absolute(), "relative link: it must resolve inside the web container too"
    assert "copie publiée" in r.stdout + r.stderr
    assert builds(tmp_path) == 1

    # the night after: only data/ changed, the app is not rebuilt, the new file is served
    commit(work, {"data/2027.enc.json": '{"v": 1}\n'}, "data: collecte")
    r = run(shell, tmp_path, origin)
    assert r.returncode == 0, r.stderr
    assert (actuelle(tmp_path) / "data" / "2027.enc.json").exists()
    assert builds(tmp_path) == 1


@NEEDS_GIT
@pytest.mark.parametrize("shell", SHELLS, ids=lambda s: s[0])
def test_une_construction_ratee_laisse_la_copie_precedente(tmp_path, depot, shell):
    work, origin = depot
    assert run(shell, tmp_path, origin).returncode == 0
    before = actuelle(tmp_path)
    commit(work, {"web/page.html": "<p>version 2</p>\n", "web/ECHEC": "1\n", "data/x.enc.json": "{}\n"}, "casse")
    r = run(shell, tmp_path, origin)
    assert r.returncode != 0
    assert "la copie précédente reste servie" in r.stderr
    assert actuelle(tmp_path) == before
    assert (before / "index.html").read_text() == "<p>version 1</p>\n"

    # repaired: rebuilt once, published
    git(work, "rm", "--quiet", "web/ECHEC")
    git(work, "commit", "--quiet", "-m", "répare")
    git(work, "push", "--quiet", "origin", "main")
    assert run(shell, tmp_path, origin).returncode == 0
    assert (actuelle(tmp_path) / "index.html").read_text() == "<p>version 2</p>\n"


@NEEDS_GIT
@pytest.mark.parametrize("shell", SHELLS, ids=lambda s: s[0])
def test_github_indisponible_la_copie_reste_lisible(tmp_path, depot, shell):
    work, origin = depot
    assert run(shell, tmp_path, origin).returncode == 0
    before = actuelle(tmp_path)
    origin.rename(tmp_path / "ailleurs.git")  # the remote is gone
    r = run(shell, tmp_path, origin)
    assert r.returncode != 0
    assert "dépôt injoignable" in r.stderr
    assert actuelle(tmp_path) == before
    assert (before / "data" / "2026.enc.json").read_text() == '{"v": 1}\n'


@NEEDS_GIT
@pytest.mark.parametrize("shell", SHELLS, ids=lambda s: s[0])
def test_garder_limite_les_copies(tmp_path, depot, shell):
    work, origin = depot
    for i in range(4):
        commit(work, {f"data/{i}.enc.json": "{}\n"}, f"data {i}")
        assert run(shell, tmp_path, origin, GARDER="2").returncode == 0
    versions = [p for p in (tmp_path / "copie" / "site" / "versions").iterdir()]
    assert len(versions) == 2
    assert actuelle(tmp_path) in [v.resolve() for v in versions]
    # the builds too: three versions of web/, two builds kept
    for i in range(3):
        commit(work, {"web/page.html": f"<p>version {i + 2}</p>\n"}, f"web {i}")
        assert run(shell, tmp_path, origin, GARDER="2").returncode == 0
    assert len(list((tmp_path / "copie" / "constructions").iterdir())) == 2
    assert (actuelle(tmp_path) / "index.html").read_text() == "<p>version 4</p>\n"


@NEEDS_GIT
def test_la_construction_voit_le_depot_et_suit_ce_qui_n_est_pas_data(tmp_path, depot):
    """The real build reads docs/export-long.schema.json: it runs in the repository, not a copy of web/."""
    work, origin = depot
    commit(work, {"docs/schema.json": "{}\n"}, "docs")
    build = BUILD + " && cat ../docs/schema.json >> dist/index.html"
    assert run(SHELLS[0], tmp_path, origin, CONSTRUIRE=build).returncode == 0
    assert (actuelle(tmp_path) / "index.html").read_text().endswith("{}\n")
    # a change outside web/ and data/ rebuilds; the repository is left clean (no dist/, no node_modules)
    commit(work, {"docs/schema.json": '{"a": 1}\n'}, "docs 2")
    assert run(SHELLS[0], tmp_path, origin, CONSTRUIRE=build).returncode == 0
    assert builds(tmp_path) == 2
    assert (actuelle(tmp_path) / "index.html").read_text().endswith('{"a": 1}\n')
    assert not (tmp_path / "copie" / "depot" / "web" / "dist").exists()


@NEEDS_GIT
@pytest.mark.parametrize("garder", [1, 2])
@pytest.mark.parametrize("shell", SHELLS, ids=lambda s: s[0])
def test_l_elagage_ne_supprime_jamais_la_construction_ou_la_copie_du_jour(tmp_path, depot, shell, garder):
    """Seen on the CI runner (busybox): the pruning sorts by modification time, and a build made in
    the same instant as older ones (or older-looking: mv keeps the build's own mtime) could be the one
    removed, then « publication impossible ». Older entries dated in the future make that certain."""
    work, origin = depot
    for sub in ("constructions", "site/versions"):
        for name in ("vieille-1", "vieille-2"):
            d = tmp_path / "copie" / sub / name
            d.mkdir(parents=True)
            (d / "index.html").write_text("<p>vieille</p>\n")
            os.utime(d, (4_102_444_800, 4_102_444_800))  # 2100-01-01
    r = run(shell, tmp_path, origin, GARDER=str(garder))
    assert r.returncode == 0, r.stderr
    assert (actuelle(tmp_path) / "index.html").read_text() == "<p>version 1</p>\n"
    assert len(list((tmp_path / "copie" / "constructions").iterdir())) == garder
    assert len(list((tmp_path / "copie" / "site" / "versions").iterdir())) == garder


@NEEDS_GIT
def test_sans_donnees_pas_de_dossier_data(tmp_path, depot):
    work, origin = depot
    git(work, "rm", "--quiet", "-r", "data")
    git(work, "commit", "--quiet", "-m", "nouveau foyer")
    git(work, "push", "--quiet", "origin", "main")
    assert run(SHELLS[0], tmp_path, origin).returncode == 0
    assert not (actuelle(tmp_path) / "data").exists()


@pytest.mark.parametrize(
    "env",
    [
        {"DEPOT_URL": "https://jeton:x@github.com/moi/depot.git"},
        {"DEPOT_URL": "git@github.com:moi/depot.git"},
        {"BRANCHE": "--upload-pack=x"},
        {"HEURE": "25:00"},
        {"HEURE": "8h"},
        {"GARDER": "0"},
    ],
)
def test_reglages_refuses(tmp_path, env):
    r = run(SHELLS[0], tmp_path, tmp_path / "rien.git", **env)
    assert r.returncode == 2, r.stderr
    assert not (tmp_path / "copie").exists()


def epoch(iso: str) -> str:
    return str(int(datetime.fromisoformat(iso).replace(tzinfo=UTC).timestamp()))


@pytest.mark.parametrize("shell", SHELLS, ids=lambda s: s[0])
@pytest.mark.parametrize(
    "utc, heure, expected",
    [
        ("2026-01-15T07:00:00", "08:30", 1800),  # 08:00 in Paris (winter)
        ("2026-07-15T06:00:00", "08:30", 1800),  # 08:00 in Paris (summer)
        ("2026-01-15T07:30:00", "08:30", 86400),  # exactly at the hour: the next day
        ("2026-01-15T22:00:00", "00:05", 3900),  # 23:00 in Paris → 00:05 is 65 min
    ],
)
def test_attente_jusqu_a_l_heure_locale(tmp_path, shell, utc, heure, expected):
    r = run(
        shell, tmp_path, tmp_path / "rien.git", "attente", HEURE=heure, TZ="Europe/Paris", COPIE_MAINTENANT=epoch(utc)
    )
    assert r.returncode == 0, r.stderr
    assert int(r.stdout) == expected


# ---------------------------------------------------------------- the static server


@pytest.fixture
def serveur(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("node absent")
    site = tmp_path / "site"
    v = site / "versions" / "abc"
    (v / "data").mkdir(parents=True)
    (v / "assets").mkdir()
    (v / "index.html").write_text("<!doctype html><p>appli</p>")
    (v / "assets" / "index-123.js").write_text("export {};")
    (v / "data" / "2026.enc.json").write_text('{"v": 1}')
    (tmp_path / "secret.txt").write_text("hors du site")
    (v / "lien").symlink_to(tmp_path / "secret.txt")
    (site / "actuelle").symlink_to("versions/abc")
    p = subprocess.Popen(
        [node, str(DIR / "serveur.mjs")],
        env={"SITE": str(site), "PORT": "0", "PATH": "/usr/bin:/bin"},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        line = p.stdout.readline()
        m = re.search(r"port (\d+)", line)
        assert m, line + p.stderr.read()
        yield f"http://127.0.0.1:{m.group(1)}"
    finally:
        p.terminate()
        p.wait(timeout=10)


def get(url, method="GET"):
    req = urllib.request.Request(url, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def test_serveur_sert_la_copie(serveur):
    status, h, body = get(serveur + "/")
    assert status == 200 and b"appli" in body
    assert h["Content-Type"].startswith("text/html")
    assert h["Cache-Control"] == "no-cache"
    assert h["X-Content-Type-Options"] == "nosniff"
    status, h, _ = get(serveur + "/assets/index-123.js")
    assert status == 200 and h["Content-Type"].startswith("text/javascript")
    assert "max-age" in h["Cache-Control"]
    status, h, body = get(serveur + "/data/2026.enc.json?x=1")
    assert status == 200 and json.loads(body) == {"v": 1}
    assert h["Cache-Control"] == "no-cache"


@pytest.mark.parametrize(
    "path",
    ["/../secret.txt", "/%2e%2e/secret.txt", "/%2e%2e%2f%2e%2e%2fsecret.txt", "/lien", "/data/", "/%ff", "/a%00b"],
)
def test_serveur_ne_sort_pas_de_la_copie(serveur, path):
    # urllib would normalise « .. »: send the raw path
    import http.client

    host, port = serveur.removeprefix("http://").split(":")
    c = http.client.HTTPConnection(host, int(port), timeout=10)
    c.request("GET", path)
    r = c.getresponse()
    body = r.read()
    assert r.status == 404, path
    assert b"hors du site" not in body


def test_serveur_lecture_seule(serveur):
    assert get(serveur + "/", "POST")[0] == 405
    assert get(serveur + "/", "PUT")[0] == 405


# ---------------------------------------------------------------- the container files (static)


def test_dockerfile_epingle_node_de_la_ci_et_n_est_pas_root():
    docker = (DIR / "Dockerfile").read_text()
    m = re.search(r"^FROM node:(\d+)\.\d+\.\d+-alpine[\d.]+$", docker, re.M)
    assert m, "FROM node:<x.y.z>-alpine<version> : an exact version, never latest"
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text()
    assert {m.group(1)} == set(re.findall(r"node-version: (\d+)", ci)), "same Node as the CI"
    assert re.search(r"^USER node$", docker, re.M)
    for src in re.findall(r"^COPY (\S+) ", docker, re.M):
        assert (DIR / src).exists(), src


def test_aucun_secret_ni_port_entrant_hors_du_service_web():
    compose = (DIR / "docker-compose.yml").read_text()
    docker = (DIR / "Dockerfile").read_text()
    for text in (compose, docker):
        assert not re.search(r"TOKEN|SECRET|PASSWORD|PASSPHRASE|GITHUB_|ghp_", text), "no secret, no token"
    # one published port, on the « web » service only
    assert compose.count("ports:") == 1
    web = compose.split("\n  web:", 1)[1]
    assert "ports:" in web and "copie:/copie:ro" in web and "read_only: true" in web
    assert re.findall(r'^\s+- "(\d+):(\d+)"$', compose, re.M) == [("8080", "8080")]


def test_le_script_est_executable_et_en_sh_posix():
    assert SCRIPT.stat().st_mode & 0o111
    assert SCRIPT.read_text().startswith("#!/bin/sh\n")
    for shell in SHELLS:
        assert subprocess.run([*shell, "-n", str(SCRIPT)], capture_output=True).returncode == 0
