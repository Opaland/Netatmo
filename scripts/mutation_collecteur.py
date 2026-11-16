"""Mutation testing of one collector module, with the standard library only (#624).

    python scripts/mutation_collecteur.py collector/audit.py            # the whole collector suite
    python scripts/mutation_collecteur.py collector/audit.py tests/test_audit.py   # faster, fewer tests
    python scripts/mutation_collecteur.py collector/audit.py --fonction _pearson --fonction day_sums

Run by hand only (like `npm run mutation` for the app), never by the CI or the gate: a measure takes
minutes. Decision D86 (keep this script, adopt `mutmut`, or nothing) belongs to the owner.

How it works:
- the repository's files (tracked and untracked, ignored ones and `data/` left out) are copied into a
  temporary folder, once per process: the working tree and `data/` are never written;
- a first run of the tests records, with `sys.monitoring`, which lines of the module each test
  executes (tests that fail without any mutant are set aside and named);
- five operators, as in the probe of the v2.7 scoping: comparison inverted or widened (`<` → `<=`,
  `<` → `>=`…, `==` ↔ `!=`, `in` ↔ `not in`, `is` ↔ `is not`), `+ −` and `× ÷` swapped, `and` ↔ `or`,
  `not` removed, integer + 1. Each mutant is a text edit at the operator's place, so line numbers do
  not move;
- each mutant runs only the tests that execute the lines of its expression (a test that never
  reaches a line cannot see it change), the fastest first; an expression run at import time
  (constants, defaults) runs every test that reaches the module. A test that fails or times out
  kills the mutant. A mutant reached by no test is « non couvert » and counts as a survivor in the
  score.

Limit: a test that reaches the module only through a subprocess (`python -m collector …`) is not seen
by the coverage, so it is not run; none of the collector's tests does so for `audit.py` today.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXCLUDED_TOP = {"data", ".git"}

# Coverage plugin, written into the copy and loaded by pytest (`-p _mutation_cover`).
PLUGIN = r"""
import json, os, sys
import pytest

TARGET = os.path.realpath(os.environ["MUTATION_TARGET"])
OUT = os.environ["MUTATION_COVER_OUT"]
TOOL = sys.monitoring.PROFILER_ID if sys.monitoring.get_tool(sys.monitoring.COVERAGE_ID) else sys.monitoring.COVERAGE_ID
_current = ["<import>"]
_took: dict[str, float] = {}
_lines: dict[str, set[int]] = {"<import>": set()}
_names: dict[int, tuple[object, bool]] = {}  # the code is kept alive: its id() cannot be reused


def _on_line(code, line):
    seen = _names.get(id(code))
    if seen is None:
        seen = _names[id(code)] = (code, os.path.realpath(code.co_filename) == TARGET)
    ok = seen[1]
    if not ok:
        return sys.monitoring.DISABLE
    _lines.setdefault(_current[0], set()).add(line)
    return sys.monitoring.DISABLE


sys.monitoring.use_tool_id(TOOL, "mutation")
sys.monitoring.register_callback(TOOL, sys.monitoring.events.LINE, _on_line)
sys.monitoring.set_events(TOOL, sys.monitoring.events.LINE)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_protocol(item, nextitem):
    _current[0] = item.nodeid
    sys.monitoring.restart_events()
    yield
    _current[0] = "<import>"


def pytest_runtest_logreport(report):
    _took[report.nodeid] = _took.get(report.nodeid, 0.0) + report.duration


def pytest_sessionfinish(session, exitstatus):
    sys.monitoring.set_events(TOOL, 0)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"lines": {k: sorted(v) for k, v in _lines.items()}, "took": _took}, f)
"""

CMP_SWAPS = {
    ast.Lt: [("<=", ast.LtE), (">=", ast.GtE)],
    ast.LtE: [("<", ast.Lt), (">", ast.Gt)],
    ast.Gt: [(">=", ast.GtE), ("<=", ast.LtE)],
    ast.GtE: [(">", ast.Gt), ("<", ast.Lt)],
    ast.Eq: [("!=", ast.NotEq)],
    ast.NotEq: [("==", ast.Eq)],
    ast.In: [("not in", ast.NotIn)],
    ast.NotIn: [("in", ast.In)],
    ast.Is: [("is not", ast.IsNot)],
    ast.IsNot: [("is", ast.Is)],
}
CMP_TEXT = {
    ast.Lt: "<",
    ast.LtE: "<=",
    ast.Gt: ">",
    ast.GtE: ">=",
    ast.Eq: "==",
    ast.NotEq: "!=",
    ast.In: "in",
    ast.NotIn: "not in",
    ast.Is: "is",
    ast.IsNot: "is not",
}
BIN_SWAPS = {ast.Add: ("+", "-"), ast.Sub: ("-", "+"), ast.Mult: ("*", "/"), ast.Div: ("/", "*")}


@dataclass
class Mutant:
    id: int
    line: int
    function: str
    operator: str
    before: str
    after: str
    start: int  # byte offsets in the source
    end: int
    replacement: str
    span: tuple[int, int]  # the lines of the mutated expression
    at_import: bool
    status: str = ""
    tests: list[str] = field(default_factory=list)


def _offsets(src: bytes) -> list[int]:
    starts = [0]
    for i, b in enumerate(src):
        if b == 10:
            starts.append(i + 1)
    return starts


def _gap_token(src: bytes, a: int, b: int, text: str) -> tuple[int, int] | None:
    """Byte span of the operator `text` in src[a:b], which holds only spaces, brackets, comments,
    line continuations and the operator."""
    gap = src[a:b].decode("utf-8")
    clean = re.sub(r"#[^\n]*", lambda m: " " * len(m.group(0)), gap)
    pattern = r"\s+".join(re.escape(w) for w in text.split())
    if text.isalpha() or " " in text:
        pattern = r"(?<![A-Za-z0-9_])" + pattern + r"(?![A-Za-z0-9_])"
    else:
        pattern = r"(?<![<>=!*/+\-])" + pattern + r"(?![<>=*/])"
    m = re.search(pattern, clean)
    if not m:
        return None
    start = a + len(clean[: m.start()].encode("utf-8"))
    end = a + len(clean[: m.end()].encode("utf-8"))
    return start, end


def mutants_of(path: Path, functions: set[str] | None = None) -> list[Mutant]:
    src = path.read_bytes()
    tree = ast.parse(src)
    starts = _offsets(src)

    def pos(line: int, col: int) -> int:
        return starts[line - 1] + col

    out: list[Mutant] = []
    docstrings: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                docstrings.add(id(body[0].value))

    def visit(node: ast.AST, func: str, stmt: ast.stmt | None, at_import: bool) -> None:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            name = func if isinstance(node, ast.Lambda) else node.name
            for d in getattr(node, "decorator_list", []):
                visit(d, func, stmt, at_import)
            for d in node.args.defaults + [d for d in node.args.kw_defaults if d is not None]:
                visit(d, func, stmt, at_import)
            body = node.body if isinstance(node.body, list) else [node.body]
            for child in body:
                visit(child, name, child if isinstance(child, ast.stmt) else stmt, False)
            return
        if isinstance(node, ast.ClassDef):
            for child in node.body:
                visit(child, node.name if func == "<module>" else func, child, at_import)
            return
        if isinstance(node, (ast.AnnAssign, ast.arg)) or (
            isinstance(node, ast.stmt) and isinstance(node, (ast.Import, ast.ImportFrom))
        ):
            if isinstance(node, ast.AnnAssign) and node.value is not None:
                visit(node.value, func, stmt, at_import)
            return
        if isinstance(node, ast.stmt):
            stmt = node
        if stmt is not None:
            _mutate(node, func, stmt, at_import)
        for child in ast.iter_child_nodes(node):
            visit(child, func, stmt, at_import)

    def add(node: ast.AST, op: str, a: int, b: int, repl: str, func: str, stmt: ast.stmt, imp: bool) -> None:
        if functions and func not in functions:
            return
        before = src[a:b].decode("utf-8")
        out.append(
            Mutant(
                id=len(out),
                line=node.lineno,
                function=func,
                operator=op,
                before=before,
                after=repl,
                start=a,
                end=b,
                replacement=repl,
                span=(node.lineno, node.end_lineno or node.lineno),
                at_import=imp,
            )
        )

    def _mutate(node: ast.AST, func: str, stmt: ast.stmt, imp: bool) -> None:
        if isinstance(node, ast.Compare):
            left = node.left
            for op, right in zip(node.ops, node.comparators, strict=True):
                span = _gap_token(
                    src,
                    pos(left.end_lineno, left.end_col_offset),
                    pos(right.lineno, right.col_offset),
                    CMP_TEXT[type(op)],
                )
                if span:
                    for text, _ in CMP_SWAPS[type(op)]:
                        add(node, "comparaison", span[0], span[1], text, func, stmt, imp)
                left = right
        elif isinstance(node, ast.BinOp) and type(node.op) in BIN_SWAPS:
            old, new = BIN_SWAPS[type(node.op)]
            lhs, r = node.left, node.right
            span = _gap_token(src, pos(lhs.end_lineno, lhs.end_col_offset), pos(r.lineno, r.col_offset), old)
            if span:
                add(node, "arithmétique", span[0], span[1], new, func, stmt, imp)
        elif isinstance(node, ast.BoolOp):
            old, new = ("and", "or") if isinstance(node.op, ast.And) else ("or", "and")
            for lhs, r in zip(node.values, node.values[1:], strict=False):
                span = _gap_token(src, pos(lhs.end_lineno, lhs.end_col_offset), pos(r.lineno, r.col_offset), old)
                if span:
                    add(node, "logique", span[0], span[1], new, func, stmt, imp)
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            a = pos(node.lineno, node.col_offset)
            b = pos(node.operand.lineno, node.operand.col_offset)
            if src[a:b].decode("utf-8").strip() == "not":
                add(node, "not retiré", a, b, "", func, stmt, imp)
        elif (
            isinstance(node, ast.Constant)
            and type(node.value) is int
            and id(node) not in docstrings
            and node.end_lineno is not None
        ):
            a = pos(node.lineno, node.col_offset)
            b = pos(node.end_lineno, node.end_col_offset)
            add(node, "entier + 1", a, b, str(node.value + 1), func, stmt, imp)

    for child in tree.body:
        visit(child, "<module>", child, True)
    return out


def _files_to_copy() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-co", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.splitlines()
    return [f for f in out if f.split("/", 1)[0] not in EXCLUDED_TOP and (ROOT / f).is_file()]


def _make_copy(dest: Path, files: list[str]) -> None:
    for f in files:
        target = dest / f
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / f, target)
    (dest / "_mutation_cover.py").write_text(PLUGIN, encoding="utf-8")


def _env(copy: Path, extra: dict[str, str] | None = None) -> dict[str, str]:
    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONPATH"] = str(copy)
    env.pop("GITHUB_ACTIONS", None)
    env.update(extra or {})
    return env


def _pytest(copy: Path, args: list[str], timeout: float | None, env_extra: dict[str, str] | None = None):
    cmd = [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-x", *args]
    return subprocess.run(cmd, cwd=copy, env=_env(copy, env_extra), capture_output=True, text=True, timeout=timeout)


def _clear_pyc(copy: Path) -> None:
    for d in copy.rglob("__pycache__"):
        shutil.rmtree(d, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("module", help="le module à muter, par ex. collector/audit.py")
    p.add_argument(
        "tests", nargs="*", help="limiter aux tests de ces fichiers (plus rapide ; par défaut toute la suite)"
    )
    p.add_argument("--fonction", action="append", default=[], help="ne muter que cette fonction (répétable)")
    p.add_argument("--processus", type=int, default=os.cpu_count() or 2)
    p.add_argument("--json", type=Path, help="écrire le détail des mutants dans ce fichier")
    p.add_argument("--liste", action="store_true", help="lister les mutants sans rien lancer")
    a = p.parse_args(argv)

    module = Path(a.module)
    if not (ROOT / module).is_file() or module.suffix != ".py":
        p.error(f"module introuvable : {module}")
    mutants = mutants_of(ROOT / module, set(a.fonction) or None)
    if a.liste:
        for m in mutants:
            print(f"{module}:{m.line} {m.function} {m.operator} {m.before!r} -> {m.after!r}")
        print(f"{len(mutants)} mutants")
        return 0

    t0 = time.monotonic()
    files = _files_to_copy()
    work = Path(tempfile.mkdtemp(prefix="mutation-collecteur-"))
    try:
        base = work / "w0"
        _make_copy(base, files)
        cover = work / "cover.json"
        target = str(base / module)
        print(f"Copie : {len(files)} fichiers dans {work}. Mesure de la couverture par test…", flush=True)
        t_base = time.monotonic()
        r = subprocess.run(
            [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-p", "_mutation_cover", "-rf", *a.tests],
            cwd=base,
            env=_env(base, {"MUTATION_TARGET": target, "MUTATION_COVER_OUT": str(cover)}),
            capture_output=True,
            text=True,
        )
        base_s = time.monotonic() - t_base
        failed = sorted(
            set(re.findall(r"^FAILED (\S+)", r.stdout, re.M)) | set(re.findall(r"^ERROR (\S+)", r.stdout, re.M))
        )
        if r.returncode not in (0, 1) or not cover.exists():
            print(r.stdout[-3000:], r.stderr[-3000:])
            print("La suite ne tourne pas dans la copie : mesure arrêtée.")
            return 2
        measured = json.loads(cover.read_text(encoding="utf-8"))
        lines = {k: set(v) for k, v in measured["lines"].items()}
        took = measured["took"]
        failing = {t.split(" ")[0] for t in failed}
        if failing:
            print(f"Tests rouges sans mutant dans la copie, écartés ({len(failing)}) : {', '.join(sorted(failing))}")
        # the fastest tests first: a killed mutant stops at its first red test (-x)
        touching = sorted(
            (t for t, ls in lines.items() if t != "<import>" and ls and t not in failing),
            key=lambda t: (took.get(t, 0.0), t),
        )
        print(f"Suite sans mutant : {base_s:.0f} s ; {len(touching)} tests atteignent {module}.", flush=True)
        timeout = max(60.0, base_s * 3)

        for m in mutants:
            if m.at_import:
                m.tests = touching
            else:
                span = set(range(m.span[0], m.span[1] + 1))
                m.tests = [t for t in touching if lines[t] & span]

        copies = [base] + [work / f"w{i}" for i in range(1, max(1, a.processus))]
        for c in copies[1:]:
            shutil.copytree(base, c)
        for c in copies:
            _clear_pyc(c)
        free = list(copies)
        src = (ROOT / module).read_bytes()
        done = [0]

        def run(m: Mutant) -> None:
            if not m.tests:
                m.status = "non couvert"
                return
            c = free.pop()
            try:
                mutated = src[: m.start] + m.replacement.encode("utf-8") + src[m.end :]
                (c / module).write_bytes(mutated)
                try:
                    res = _pytest(c, m.tests, timeout)
                    # 0: all green; 4/5: pytest could not run the selection (a tool error, not a kill).
                    codes = {0: "survivant", 4: "erreur", 5: "erreur"}
                    m.status = codes.get(res.returncode, "tué")
                except subprocess.TimeoutExpired:
                    m.status = "tué (délai)"
                (c / module).write_bytes(src)
            finally:
                free.append(c)
                done[0] += 1
                if done[0] % 25 == 0:
                    print(f"  {done[0]}/{len(mutants)} ({time.monotonic() - t0:.0f} s)", flush=True)

        with ThreadPoolExecutor(max_workers=len(copies)) as ex:
            list(ex.map(run, mutants))
    finally:
        shutil.rmtree(work, ignore_errors=True)

    took = time.monotonic() - t0
    killed = [m for m in mutants if m.status.startswith("tué")]
    survivors = [m for m in mutants if m.status == "survivant"]
    uncovered = [m for m in mutants if m.status == "non couvert"]
    errors = [m for m in mutants if m.status == "erreur"]
    total = len(killed) + len(survivors) + len(uncovered)
    score = 100 * len(killed) / total if total else 100.0
    print()
    for m in sorted(survivors + uncovered + errors, key=lambda m: (m.line, m.id)):
        print(f"{m.status:11} {module}:{m.line} {m.function} — {m.operator} : {m.before!r} → {m.after!r}")
    print()
    print(
        f"{module} : {len(mutants)} mutants, {len(killed)} tués, {len(survivors)} survivants, "
        f"{len(uncovered)} non couverts, {len(errors)} erreurs — score {score:.1f} % — {took:.0f} s "
        f"({len(copies)} processus, {'toute la suite' if not a.tests else ', '.join(a.tests)})"
    )
    by_func: dict[str, list[Mutant]] = {}
    for m in mutants:
        by_func.setdefault(m.function, []).append(m)
    print("Par fonction (les plus faibles d'abord) :")
    rows = []
    for f, ms in by_func.items():
        k = sum(1 for m in ms if m.status.startswith("tué"))
        n = sum(1 for m in ms if m.status != "erreur")
        rows.append((k / n if n else 1.0, f, k, n))
    for s, f, k, n in sorted(rows)[:15]:
        print(f"  {f:28} {k:4}/{n:<4} {100 * s:5.1f} %")
    if a.json:
        a.json.write_text(
            json.dumps(
                {
                    "module": str(module),
                    "score": round(score, 1),
                    "seconds": round(took),
                    "mutants": [
                        {k: v for k, v in m.__dict__.items() if k not in ("tests", "start", "end", "replacement")}
                        for m in mutants
                    ],
                },
                ensure_ascii=False,
                indent=1,
            ),
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
