"""S-8.3 (#23): the data in a branch of its own, chosen by the repository variable DATA_BRANCH.

Fictitious data only. The scripts run against local bare repositories (no network).
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from collector.compare import CompareError, compare_dirs
from collector.storage import Store

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"
SCRIPT = ROOT / "scripts" / "donnees.sh"
COMMIT = ROOT / "scripts" / "commit-data.sh"
PASS = "phrase fictive des tests"

needs_git = pytest.mark.skipif(shutil.which("git") is None, reason="git absent")


def _git(cwd: Path, *args: str) -> str:
    env_args = ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main"]
    return subprocess.run(["git", *env_args, *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


def _env(tmp_path: Path, **extra: str) -> dict[str, str]:
    env = {
        "PATH": "/usr/bin:/bin",
        "HOME": str(tmp_path),
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.com",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.com",
        "GITHUB_REF_NAME": "main",
        "PUSH_PAUSE": "0",
    }
    env.update(extra)
    return env


def _run(cwd: Path, env: dict[str, str], *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", *args], cwd=cwd, env=env, capture_output=True, text=True)


def _folder(path: Path) -> None:
    store = Store(path, PASS)
    store.merge("100", "2025-01-01", 1200.0)
    store.merge("100", "2026-01-01", 300.5)
    store.save({"id": "h", "name": "Maison fictive"}, [{"id": "100", "category": "heating"}])


def _repo(tmp_path: Path) -> tuple[Path, Path]:
    """A bare origin whose main holds code and data/, and a clone of it (the runner)."""
    origin, seed = tmp_path / "origin.git", tmp_path / "seed"
    _git(tmp_path, "init", "-q", "--bare", str(origin))
    _git(tmp_path, "clone", "-q", str(origin), str(seed))
    (seed / "README").write_text("code\n")
    _folder(seed / "data")
    _git(seed, "add", ".")
    _git(seed, "commit", "-q", "-m", "init")
    _git(seed, "push", "-q", "origin", "HEAD:main")
    runner = tmp_path / "runner"
    _git(tmp_path, "clone", "-q", str(origin), str(runner))
    return origin, runner


def _env_file(path: Path) -> dict[str, str]:
    return dict(line.split("=", 1) for line in path.read_text().splitlines())


# ---------------------------------------------------------------- copier / pousser
@needs_git
def test_main_to_data_creates_a_branch_with_the_same_tree_and_leaves_main_alone(tmp_path):
    origin, runner = _repo(tmp_path)
    main_before = _git(origin, "rev-parse", "main")
    out = tmp_path / "copie"
    env = _env(tmp_path)
    r = _run(runner, env, str(SCRIPT), "copier", "main", "data", str(out))
    assert r.returncode == 0, r.stdout + r.stderr
    assert "rien n'est encore envoyé" in r.stdout
    assert _git(origin, "branch", "--list", "data") == ""  # nothing sent before the push
    compare_dirs(out / "source" / "data", out / "copie" / "data", PASS)
    r = _run(runner, env, str(SCRIPT), "pousser", str(out), "data")
    assert r.returncode == 0, r.stdout + r.stderr
    # The very same git tree, and nothing but data/ in the branch.
    assert _git(origin, "rev-parse", "data:data") == _git(origin, "rev-parse", "main:data")
    assert _git(origin, "ls-tree", "--name-only", "data").split() == ["data"]
    assert _git(origin, "rev-parse", "main") == main_before  # main untouched, nothing deleted
    # Run again: nothing to copy, nothing sent.
    r = _run(runner, env, str(SCRIPT), "copier", "main", "data", str(out))
    assert r.returncode == 0 and "Rien à copier" in r.stdout
    assert (out / "commit").read_text() == ""
    assert "Rien à envoyer" in _run(runner, env, str(SCRIPT), "pousser", str(out), "data").stdout


@needs_git
def test_main_to_data_updates_the_branch_without_forcing(tmp_path):
    origin, runner = _repo(tmp_path)
    env = _env(tmp_path)
    out = tmp_path / "copie"
    assert _run(runner, env, str(SCRIPT), "copier", "main", "data", str(out)).returncode == 0
    assert _run(runner, env, str(SCRIPT), "pousser", str(out), "data").returncode == 0
    first = _git(origin, "rev-parse", "data").strip()
    # A night collected on main before DATA_BRANCH is set: the copy is redone on top.
    seed = tmp_path / "seed"
    _git(seed, "pull", "-q", "origin", "main")
    (seed / "data" / "volets.enc.json").write_text((seed / "data" / "meta.enc.json").read_text())
    _git(seed, "add", ".")
    _git(seed, "commit", "-q", "-m", "data: nuit")
    _git(seed, "push", "-q", "origin", "HEAD:main")
    r = _run(runner, env, str(SCRIPT), "copier", "main", "data", str(out))
    assert r.returncode == 0, r.stderr
    assert _run(runner, env, str(SCRIPT), "pousser", str(out), "data").returncode == 0
    assert _git(origin, "rev-parse", "data~1").strip() == first  # history kept, fast-forward
    assert _git(origin, "rev-parse", "data:data") == _git(origin, "rev-parse", "main:data")


@needs_git
def test_a_copy_from_an_absent_branch_or_with_a_wrong_variable_is_refused(tmp_path):
    _, runner = _repo(tmp_path)
    out = tmp_path / "copie"
    r = _run(runner, _env(tmp_path), str(SCRIPT), "copier", "data", "main", str(out))
    assert r.returncode != 0 and "n'existe pas" in r.stderr
    for cmd in (["ouvrir", str(tmp_path / "d")], ["copier", "main", "data", str(out)]):
        r = _run(runner, _env(tmp_path, DATA_BRANCH="autre"), str(SCRIPT), *cmd)
        assert r.returncode != 0 and "« main » ou « data »" in r.stderr


@needs_git
def test_a_push_is_refused_when_the_destination_moved(tmp_path):
    origin, runner = _repo(tmp_path)
    env = _env(tmp_path)
    out = tmp_path / "copie"
    _run(runner, env, str(SCRIPT), "copier", "main", "data", str(out))
    _run(runner, env, str(SCRIPT), "pousser", str(out), "data")
    seed = tmp_path / "seed"
    (seed / "data" / "volets.enc.json").write_text("{}\n")
    _git(seed, "add", ".")
    _git(seed, "commit", "-q", "-m", "data: nuit")
    _git(seed, "push", "-q", "origin", "HEAD:main")
    assert _run(runner, env, str(SCRIPT), "copier", "main", "data", str(out)).returncode == 0
    # Meanwhile, something else lands on data: the prepared copy must not overwrite it.
    other = tmp_path / "other"
    _git(tmp_path, "clone", "-q", "-b", "data", str(origin), str(other))
    (other / "data" / "x.enc.json").write_text("{}\n")
    _git(other, "add", ".")
    _git(other, "commit", "-q", "-m", "data: autre")
    _git(other, "push", "-q", "origin", "HEAD:data")
    r = _run(runner, env, str(SCRIPT), "pousser", str(out), "data")
    assert r.returncode != 0 and "a bougé" in r.stderr
    assert "x.enc.json" in _git(origin, "ls-tree", "--name-only", "data:data")


@needs_git
def test_round_trip_data_then_back_to_main(tmp_path):
    """Collect on the data branch, then the way back: main gets data/ of the branch, code kept."""
    origin, runner = _repo(tmp_path)
    out = tmp_path / "copie"
    env = _env(tmp_path)
    _run(runner, env, str(SCRIPT), "copier", "main", "data", str(out))
    _run(runner, env, str(SCRIPT), "pousser", str(out), "data")
    # DATA_BRANCH=data: a collection opens the branch and commits there with commit-data.sh.
    genv = tmp_path / "github.env"
    denv = _env(tmp_path, DATA_BRANCH="data", GITHUB_ENV=str(genv))
    r = _run(runner, denv, str(SCRIPT), "ouvrir", str(tmp_path / "donnees"))
    assert r.returncode == 0, r.stderr
    opened = _env_file(genv)
    assert opened["DATA_BRANCH"] == "data" and opened["DATA_DIR"] == str(tmp_path / "donnees" / "data")
    store = Store(Path(opened["DATA_DIR"]), PASS)
    store.merge("100", "2026-01-02", 99.0)
    store.save({"id": "h", "name": "Maison fictive"}, [{"id": "100", "category": "heating"}])
    main_before = _git(origin, "rev-parse", "main")
    r = _run(Path(opened["DATA_REPO"]), _env(tmp_path, DATA_BRANCH="data"), str(COMMIT), "data: nuit", "data/")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "envoyées sur data" in r.stdout
    assert _git(origin, "rev-parse", "main") == main_before  # main receives no data commit
    assert _git(origin, "rev-parse", "data:data") != _git(origin, "rev-parse", "main:data")
    # The way back, while DATA_BRANCH is still data.
    r = _run(runner, _env(tmp_path, DATA_BRANCH="data"), str(SCRIPT), "copier", "data", "main", str(out))
    assert r.returncode == 0, r.stderr
    compare_dirs(out / "source" / "data", out / "copie" / "data", PASS)
    assert _run(runner, env, str(SCRIPT), "pousser", str(out), "main").returncode == 0
    assert _git(origin, "rev-parse", "data:data") == _git(origin, "rev-parse", "main:data")
    assert _git(origin, "show", "main:README") == "code\n"
    assert _git(origin, "rev-parse", "main~1") == main_before


@needs_git
def test_open_on_main_changes_nothing_and_sparse_open_checks_out_only_the_paths(tmp_path):
    _, runner = _repo(tmp_path)
    genv = tmp_path / "github.env"
    r = _run(runner, _env(tmp_path, GITHUB_ENV=str(genv)), str(SCRIPT), "ouvrir", str(tmp_path / "d"))
    assert r.returncode == 0, r.stderr
    assert _env_file(genv) == {"DATA_REPO": str(runner), "DATA_DIR": str(runner / "data")}
    assert not (tmp_path / "d").exists()
    # Branch absent: a clear message, not a git error.
    r = _run(runner, _env(tmp_path, DATA_BRANCH="data"), str(SCRIPT), "ouvrir", str(tmp_path / "d"))
    assert r.returncode != 0 and "Branche des données" in r.stderr
    out = tmp_path / "copie"
    _run(runner, _env(tmp_path), str(SCRIPT), "copier", "main", "data", str(out))
    _run(runner, _env(tmp_path), str(SCRIPT), "pousser", str(out), "data")
    r = _run(runner, _env(tmp_path, DATA_BRANCH="data"), str(SCRIPT), "ouvrir", str(tmp_path / "d"),
             "data/keyinfo.json", "data/meta.enc.json")  # fmt: skip
    assert r.returncode == 0, r.stderr
    assert sorted(p.name for p in (tmp_path / "d" / "data").iterdir()) == ["keyinfo.json", "meta.enc.json"]


# ---------------------------------------------------------------- collector comparer
def test_compare_accepts_a_copy_and_names_what_differs(tmp_path, capsys):
    a, b = tmp_path / "a", tmp_path / "b"
    _folder(a)
    shutil.copytree(a, b)
    assert compare_dirs(a, b, PASS) == (len(list(a.glob("*.json"))), 2)
    with pytest.raises(CompareError, match="contenu déchiffré différent|Fichiers différents|Totaux"):
        store = Store(b, PASS)
        store.merge("100", "2026-01-01", 1.0)
        store.save({"id": "h", "name": "Maison fictive"}, [{"id": "100", "category": "heating"}])
        compare_dirs(a, b, PASS)
    shutil.rmtree(b)
    shutil.copytree(a, b)
    (b / "2025.enc.json").unlink()
    with pytest.raises(CompareError, match="manquants \\['2025.enc.json'\\]"):
        compare_dirs(a, b, PASS)
    from collector.crypto import DecryptError

    with pytest.raises(DecryptError):
        compare_dirs(a, a, "pas la bonne")


def test_compare_command_prints_counts_only(tmp_path, capsys):
    from collector.__main__ import cmd_compare

    a, b = tmp_path / "a", tmp_path / "b"
    _folder(a)
    shutil.copytree(a, b)

    class S:
        passphrase = PASS

        def require(self, *_):
            pass

    cmd_compare(S(), argparse.Namespace(source=str(a), copie=str(b)))
    out = capsys.readouterr().out
    assert "totaux identiques sur 2 années" in out
    assert "Maison fictive" not in out and "1200" not in out and "1,2" not in out


# ---------------------------------------------------------------- workflows
def _text(name: str) -> str:
    return (WORKFLOWS / name).read_text()


def test_every_workflow_that_reads_the_data_opens_the_chosen_branch():
    """A workflow that decrypts or serves data/ goes through scripts/donnees.sh ouvrir, with
    DATA_BRANCH from the repository variable, before any step that reads it."""
    yaml = pytest.importorskip("yaml")
    readers = set()
    for wf in WORKFLOWS.glob("*.yml"):
        text = wf.read_text()
        if wf.name == "branche-donnees.yml":
            continue  # it reads both branches explicitly
        if "secrets.DATA_PASSPHRASE" in text or re.search(r"cp -r \S*data", text, re.I):
            readers.add(wf.name)
            for job in yaml.safe_load(text)["jobs"].values():
                steps = job.get("steps", [])
                names = [s.get("name") for s in steps]
                uses_data = [
                    i
                    for i, s in enumerate(steps)
                    if "DATA_PASSPHRASE" in s.get("env", {}) or "cp -r" in s.get("run", "")
                ]
                if not uses_data:
                    continue
                assert "Données (branche choisie)" in names, wf.name
                opener = steps[names.index("Données (branche choisie)")]
                assert opener["run"].startswith("scripts/donnees.sh ouvrir"), wf.name
                assert opener["env"]["DATA_BRANCH"] == "${{ vars.DATA_BRANCH }}", wf.name
                assert names.index("Données (branche choisie)") < min(uses_data), wf.name
        # Never a hard-coded path to the data of the checkout in a command.
        for line in text.splitlines():
            if line.strip().startswith("#"):
                continue
            assert not re.search(r"(\.\./data\b|cp -r data\b|-f data/keyinfo)", line), (wf.name, line)
    assert readers >= {"collect.yml", "volets.yml", "rekey.yml", "deploy.yml", "smoke-reel.yml",
                       "diagnostic.yml", "releve-horaire.yml"}  # fmt: skip


def test_every_writer_commits_from_the_opened_checkout_to_the_chosen_branch():
    for name in ("collect.yml", "volets.yml"):
        text = _text(name)
        for m in re.finditer(r"commit-data\.sh", text):
            before = text[: m.start()].rsplit("run: |", 1)[1]
            assert 'cd "$DATA_REPO"' in before, name
    rekey = _text("rekey.yml")
    assert 'cd "$DATA_REPO"' in rekey and 'git push origin "HEAD:${DATA_BRANCH:-$GITHUB_REF_NAME}"' in rekey
    assert "--force" not in rekey and " -f " not in rekey


def test_the_move_workflow_is_manual_compares_totals_and_waits_for_every_writer():
    yaml = pytest.importorskip("yaml")
    wf = yaml.safe_load(_text("branche-donnees.yml"))
    assert list(wf[True]) == ["workflow_dispatch"]  # `on:` reads as True in YAML 1.1
    job = wf["jobs"]["copie"]
    assert wf["concurrency"]["group"] == "collect" and job["concurrency"]["group"] == "volets"
    runs = [s.get("run", "") for s in job["steps"]]
    i_copy = next(i for i, r in enumerate(runs) if "donnees.sh copier" in r)
    i_cmp = next(i for i, r in enumerate(runs) if "collector comparer" in r)
    i_push = next(i for i, r in enumerate(runs) if "donnees.sh pousser" in r)
    assert i_copy < i_cmp < i_push  # nothing sent before the totals are compared
    assert "--avant" in runs[i_cmp]  # and the destination before loses no file (#523 review)
    assert all("--force" not in r and "git rm" not in r for r in runs)
    assert job["permissions"] == {"contents": "write"}


@needs_git
def test_sparse_open_from_a_sparse_shallow_checkout_like_the_hourly_reading(tmp_path):
    """releve-horaire.yml checks out a few paths of main at depth 1, then opens the data branch."""
    origin, runner = _repo(tmp_path)
    out = tmp_path / "copie"
    _run(runner, _env(tmp_path), str(SCRIPT), "copier", "main", "data", str(out))
    _run(runner, _env(tmp_path), str(SCRIPT), "pousser", str(out), "data")
    sparse = tmp_path / "sparse"
    _git(tmp_path, "clone", "-q", "--depth=1", f"file://{origin}", str(sparse))
    _git(sparse, "sparse-checkout", "set", "--no-cone", "README", "data/keyinfo.json")
    genv = tmp_path / "github.env"
    r = _run(sparse, _env(tmp_path, DATA_BRANCH="data", GITHUB_ENV=str(genv)), str(SCRIPT), "ouvrir",
             str(tmp_path / "d"), "data/keyinfo.json", "data/meta.enc.json")  # fmt: skip
    assert r.returncode == 0, r.stderr
    assert sorted(p.name for p in Path(_env_file(genv)["DATA_DIR"]).iterdir()) == ["keyinfo.json", "meta.enc.json"]
    assert sorted(p.name for p in (sparse / "data").iterdir()) == ["keyinfo.json"]  # the root stays sparse


# ---------------------------------------------------------------- relecture adverse de #523
def _night(repo: Path, branch: str, amount: float) -> None:
    """A collection on `branch`: MODIFIES existing files (year, meta) and pushes."""
    _git(repo, "fetch", "-q", "origin", branch)
    _git(repo, "checkout", "-q", "-B", branch, f"origin/{branch}")
    store = Store(repo / "data", PASS)
    store.merge("100", "2026-01-03", amount)
    store.save({"id": "h", "name": "Maison fictive"}, [{"id": "100", "category": "heating"}])
    _git(repo, "add", "data")
    _git(repo, "commit", "-q", "-m", "data: nuit")
    _git(repo, "push", "-q", "origin", f"HEAD:{branch}")


@needs_git
def test_update_after_a_night_that_modified_files_with_an_up_to_date_checkout(tmp_path):
    """Bloquant 1: a night MODIFIES files; the runner's checkout is up to date (actions/checkout)."""
    origin, runner = _repo(tmp_path)
    out = tmp_path / "copie"
    env = _env(tmp_path)
    assert _run(runner, env, str(SCRIPT), "copier", "main", "data", str(out)).returncode == 0
    assert _run(runner, env, str(SCRIPT), "pousser", str(out), "data").returncode == 0
    _night(tmp_path / "seed", "main", 42.0)
    _git(runner, "pull", "-q", "origin", "main")
    r = _run(runner, env, str(SCRIPT), "copier", "main", "data", str(out))
    assert r.returncode == 0, r.stdout + r.stderr
    assert _run(runner, env, str(SCRIPT), "pousser", str(out), "data").returncode == 0
    assert _git(origin, "rev-parse", "data:data") == _git(origin, "rev-parse", "main:data")
    # The way back, after a night that modified data, from an up-to-date checkout of main.
    _night(tmp_path / "seed", "data", 7.0)
    _git(runner, "pull", "-q", "origin", "main")
    denv = _env(tmp_path, DATA_BRANCH="data")
    r = _run(runner, denv, str(SCRIPT), "copier", "data", "main", str(out))
    assert r.returncode == 0, r.stdout + r.stderr
    assert _run(runner, env, str(SCRIPT), "pousser", str(out), "main").returncode == 0
    assert _git(origin, "rev-parse", "main:data") == _git(origin, "rev-parse", "data:data")
    assert _git(origin, "show", "main:README") == "code\n"


@needs_git
def test_catch_up_after_the_variable_is_set_when_data_did_not_move(tmp_path):
    """Bloquant 2: a night on main between the copy and DATA_BRANCH=data (token rotated) is
    caught up by copying again, as long as nothing was written on data since the copy."""
    origin, runner = _repo(tmp_path)
    out = tmp_path / "copie"
    env = _env(tmp_path)
    _run(runner, env, str(SCRIPT), "copier", "main", "data", str(out))
    _run(runner, env, str(SCRIPT), "pousser", str(out), "data")
    _night(tmp_path / "seed", "main", 42.0)
    denv = _env(tmp_path, DATA_BRANCH="data")
    r = _run(runner, denv, str(SCRIPT), "copier", "main", "data", str(out))
    assert r.returncode == 0, r.stdout + r.stderr
    assert _run(runner, env, str(SCRIPT), "pousser", str(out), "data").returncode == 0
    assert _git(origin, "rev-parse", "data:data") == _git(origin, "rev-parse", "main:data")


@needs_git
def test_a_copy_never_moves_the_destination_back(tmp_path):
    """Mineur 3: once a night was written on data, copying main over it is refused, whatever
    DATA_BRANCH says."""
    origin, runner = _repo(tmp_path)
    out = tmp_path / "copie"
    env = _env(tmp_path)
    _run(runner, env, str(SCRIPT), "copier", "main", "data", str(out))
    _run(runner, env, str(SCRIPT), "pousser", str(out), "data")
    _night(tmp_path / "seed", "data", 7.0)
    after_night = _git(origin, "rev-parse", "data")
    for extra in ({}, {"DATA_BRANCH": "data"}):
        r = _run(runner, _env(tmp_path, **extra), str(SCRIPT), "copier", "main", "data", str(out))
        assert r.returncode != 0 and "reculer" in r.stderr, r.stdout + r.stderr
        assert "autre sens" not in r.stderr
    assert _git(origin, "rev-parse", "data") == after_night  # the night is still there


@needs_git
def test_open_with_the_variable_set_too_early_says_to_remove_it(tmp_path):
    _, runner = _repo(tmp_path)
    r = _run(runner, _env(tmp_path, DATA_BRANCH="data"), str(SCRIPT), "ouvrir", str(tmp_path / "d"))
    assert r.returncode != 0 and "retirez la variable DATA_BRANCH" in r.stderr


def test_compare_with_the_destination_before_refuses_a_lost_file(tmp_path):
    from collector.compare import compare_before

    a, before = tmp_path / "a", tmp_path / "avant"
    _folder(a)
    shutil.copytree(a, before)
    store = Store(a, PASS)
    store.merge("100", "2026-01-05", 5.0)
    store.save({"id": "h", "name": "Maison fictive"}, [{"id": "100", "category": "heating"}])
    assert compare_before(before, a, PASS) == 1  # one year changed
    (before / "volets.enc.json").write_text((before / "meta.enc.json").read_text())
    with pytest.raises(CompareError, match="volets.enc.json"):
        compare_before(before, a, PASS)
    assert compare_before(tmp_path / "absente", a, PASS) == 0  # no destination before: nothing to lose


def test_readme_warns_that_a_relaunch_cancels_a_pending_collection():
    text = (ROOT / "README.md").read_text()
    section = text.split("### Branche des données", 1)[1].split("\n### ", 1)[0]
    assert "annule" in section and "en attente" in section


# ---------------------------------------------------------------- #529: the guard has no depth limit
def _long_history(repo: Path, branch: str, count: int) -> None:
    """`count` commits on `branch` keeping its data/ tree (fast-import: seconds, not minutes)."""
    _git(repo, "fetch", "-q", "origin", branch)
    tip = _git(repo, "rev-parse", f"origin/{branch}").strip()
    tree = _git(repo, "rev-parse", f"{tip}:data").strip()
    lines = []
    for i in range(count):
        msg = f"data: nuit {i}\n"
        lines += [f"commit refs/heads/{branch}", "committer t <t@example.com> 1700000000 +0000",
                  f"data {len(msg.encode())}", msg.rstrip("\n"), *([f"from {tip}"] if i == 0 else []),
                  f"M 040000 {tree} data", ""]  # fmt: skip
    subprocess.run(["git", "fast-import", "--quiet"], cwd=repo, input="\n".join(lines) + "\n", text=True, check=True)
    _git(repo, "push", "-q", "origin", f"refs/heads/{branch}:refs/heads/{branch}")


@needs_git
def test_the_way_back_is_accepted_however_long_the_data_branch_grew(tmp_path):
    """#529, 1: main's data/ is only in the first commit of data; more nights than the old fetch
    depth on data must not refuse the way back (HISTORY_DEPTH=3 was the old limit, now ignored)."""
    origin, runner = _repo(tmp_path)
    out = tmp_path / "copie"
    env = _env(tmp_path)
    _run(runner, env, str(SCRIPT), "copier", "main", "data", str(out))
    _run(runner, env, str(SCRIPT), "pousser", str(out), "data")
    for amount in range(5):
        _night(tmp_path / "seed", "data", float(amount))
    denv = _env(tmp_path, DATA_BRANCH="data", HISTORY_DEPTH="3")
    r = _run(runner, denv, str(SCRIPT), "copier", "data", "main", str(out))
    assert r.returncode == 0, r.stdout + r.stderr
    assert _run(runner, env, str(SCRIPT), "pousser", str(out), "main").returncode == 0
    assert _git(origin, "rev-parse", "main:data") == _git(origin, "rev-parse", "data:data")


@needs_git
def test_the_guard_reads_thousands_of_commits_without_a_broken_pipe(tmp_path):
    """#529, 2: DEST's data/ found near the tip of a long SOURCE history: the old
    `git log | { … exit 0; }` under pipefail ended in SIGPIPE (141) and refused the copy."""
    origin, runner = _repo(tmp_path)
    out = tmp_path / "copie"
    env = _env(tmp_path)
    _run(runner, env, str(SCRIPT), "copier", "main", "data", str(out))
    _run(runner, env, str(SCRIPT), "pousser", str(out), "data")
    _long_history(tmp_path / "seed", "data", 3000)  # main's data/ is now in data~1 … data~3000
    _night(tmp_path / "seed", "data", 7.0)
    denv = _env(tmp_path, DATA_BRANCH="data", HISTORY_DEPTH="5000")
    r = _run(runner, denv, str(SCRIPT), "copier", "data", "main", str(out))
    assert r.returncode == 0, r.stdout + r.stderr
    assert not any(n in ("commits", "chemins", "arbres") for n in (p.name for p in out.iterdir()))


@needs_git
def test_a_refusal_says_how_many_commits_were_searched_and_both_causes(tmp_path):
    """#529, 1 and 3: a refusal is not « not found in the last N » any more; it says every commit
    of the source was searched, and names the two causes (nights on DEST, phrase changed on DEST)."""
    _, runner = _repo(tmp_path)
    out = tmp_path / "copie"
    env = _env(tmp_path)
    _run(runner, env, str(SCRIPT), "copier", "main", "data", str(out))
    _run(runner, env, str(SCRIPT), "pousser", str(out), "data")
    _night(tmp_path / "seed", "data", 7.0)
    _night(tmp_path / "seed", "main", 1.0)
    r = _run(runner, env, str(SCRIPT), "copier", "main", "data", str(out))
    assert r.returncode != 0
    assert "n'est dans aucun des 2 commits de « main »" in r.stderr, r.stderr
    assert "nuits collectées" in r.stderr and "phrase de passe changée" in r.stderr


def test_compare_before_names_a_passphrase_changed_since_the_last_copy(tmp_path):
    """#529, 3: the destination before does not open with the current phrase (rekeyed between two
    copies): a clear refusal, not a decryption traceback."""
    from collector.compare import compare_before
    from collector.rekey import rekey

    a, before = tmp_path / "a", tmp_path / "avant"
    _folder(before)
    shutil.copytree(before, a)
    rekey(a, PASS, "nouvelle phrase fictive des tests")
    with pytest.raises(CompareError, match="phrase de passe"):
        compare_before(before, a, "nouvelle phrase fictive des tests")


def test_readme_says_a_rekey_between_two_copies_is_refused():
    text = (ROOT / "README.md").read_text()
    section = text.split("### Branche des données", 1)[1].split("\n### ", 1)[0]
    assert "Changer la phrase de passe" in section and "tout** l'historique" in section
