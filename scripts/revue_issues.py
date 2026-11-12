"""S-1.16: turn the findings of a review agent into GitHub issues.

Reads the JSON written by an agent following docs/revues-agents/revue-code.md,
revue-design.md or revue-promesses.md (#365), checks it, and (with --create) opens one issue per
finding, labelled `revue-code` or `revue-design`, `gravité: <level>`, `design` for a design review
and `promesses` for a review of the promises (whose issues are `revue-code` ones).
Findings whose title is already an open issue are skipped, so a re-run does not duplicate.

    python scripts/revue_issues.py revue-constats.json            # check and print (default)
    python scripts/revue_issues.py revue-constats.json --create   # open the issues (gh CLI)

The JSON comes from a language model: it is validated field by field and only plain text
reaches the issues (no labels, assignees or mentions chosen by the model).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

LEVELS = ("critique", "majeure", "mineure", "suggestion")
CATEGORIES = {
    "code": ("justesse", "sécurité", "tests", "performance", "simplicité", "documentation"),
    "design": ("hiérarchie", "lisibilité", "cohérence", "accessibilité", "mobile", "langage"),
    "promesses": ("réseau", "ia", "appareil", "chiffrement", "journaux", "texte"),
}
# #365: every promise read is classified; the ones not kept become findings (issues)
VERDICTS = ("tenue", "non tenue", "invérifiable")
MAX_PROMISES = 200
LABEL_COLOURS = {
    "revue-code": "1d76db",
    "revue-design": "c5def5",
    "promesses": "5319e7",
    "gravité: critique": "b60205",
    "gravité: majeure": "d93f0b",
    "gravité: mineure": "fbca04",
    "gravité: suggestion": "0e8a16",
}
MAX_TITLE = 100
MAX_TEXT = 4000
MAX_FINDINGS = 60


class Invalid(ValueError):
    pass


def _text(item: dict, key: str, limit: int = MAX_TEXT, required: bool = True) -> str:
    value = item.get(key, "")
    if not isinstance(value, str) or (required and not value.strip()):
        raise Invalid(f"champ « {key} » manquant ou vide")
    value = value.strip()
    if len(value) > limit:
        raise Invalid(f"champ « {key} » trop long ({len(value)} > {limit})")
    # no GitHub mention or cross-repo reference chosen by the model
    return re.sub(r"@(?=[A-Za-z0-9])", "@​", value)


def validate(doc: dict) -> dict:
    """The review document, normalised; raises Invalid with a French message."""
    if not isinstance(doc, dict):
        raise Invalid("le document n'est pas un objet JSON")
    kind = doc.get("revue")
    if kind not in CATEGORIES:
        raise Invalid("« revue » doit valoir « code », « design » ou « promesses »")
    findings = doc.get("constats")
    if not isinstance(findings, list):
        raise Invalid("« constats » doit être une liste")
    if len(findings) > MAX_FINDINGS:
        raise Invalid(f"trop de constats ({len(findings)} > {MAX_FINDINGS}) : regrouper")
    out = []
    for i, f in enumerate(findings, 1):
        try:
            if not isinstance(f, dict):
                raise Invalid("constat qui n'est pas un objet")
            level = f.get("gravite")
            if level not in LEVELS:
                raise Invalid(f"gravité « {level} » inconnue")
            category = f.get("categorie")
            if category not in CATEGORIES[kind]:
                raise Invalid(f"catégorie « {category} » inconnue pour une revue {kind}")
            files = f.get("fichiers")
            if not isinstance(files, list) or not files or not all(isinstance(x, str) and x.strip() for x in files):
                raise Invalid("« fichiers » doit lister au moins un emplacement")
            out.append(
                {
                    "titre": " ".join(_text(f, "titre", MAX_TITLE).split()),
                    "gravite": level,
                    "categorie": category,
                    "fichiers": [x.strip()[:200] for x in files[:20]],
                    "constat": _text(f, "constat"),
                    "proposition": _text(f, "proposition"),
                    "verification": _text(f, "verification", required=False),
                }
            )
        except Invalid as err:
            raise Invalid(f"constat {i} : {err}") from None
    order = {lvl: n for n, lvl in enumerate(LEVELS)}
    out.sort(key=lambda f: order[f["gravite"]])
    result = {
        "revue": kind,
        "version": _text(doc, "version", 20, required=False) or "?",
        "perimetre": _text(doc, "perimetre", 200, required=False),
        "constats": out,
    }
    if kind == "promesses":
        result["promesses"] = _promises(doc.get("promesses"), {f["titre"] for f in out})
    return result


def _promises(items: object, titles: set[str]) -> list[dict]:
    """Each promise classified with its proof; a promise not kept names the finding that reports it."""
    if not isinstance(items, list) or not items:
        raise Invalid("« promesses » doit lister chaque promesse relevée")
    if len(items) > MAX_PROMISES:
        raise Invalid(f"trop de promesses ({len(items)} > {MAX_PROMISES})")
    out = []
    for i, p in enumerate(items, 1):
        try:
            if not isinstance(p, dict):
                raise Invalid("promesse qui n'est pas un objet")
            verdict = p.get("classement")
            if verdict not in VERDICTS:
                raise Invalid(f"classement « {verdict} » inconnu")
            item = {
                "texte": _text(p, "texte", 400),
                "emplacement": _text(p, "emplacement", 200),
                "classement": verdict,
                "preuve": _text(p, "preuve"),
            }
            if verdict == "non tenue":
                title = " ".join(_text(p, "constat", MAX_TITLE).split())
                if title not in titles:
                    raise Invalid(f"non tenue sans constat « {title} » dans « constats »")
                item["constat"] = title
            out.append(item)
        except Invalid as err:
            raise Invalid(f"promesse {i} : {err}") from None
    return out


def issue_title(kind: str, f: dict) -> str:
    return f"Revue {kind} · {f['titre']}"


def issue_labels(kind: str, f: dict) -> list[str]:
    labels = [f"revue-{'code' if kind == 'promesses' else kind}", f"gravité: {f['gravite']}"]
    if kind in ("design", "promesses"):
        labels.append(kind)
    return labels


def issue_body(doc: dict, f: dict) -> str:
    files = "\n".join(f"- `{x.replace('`', '')}`" for x in f["fichiers"])
    parts = [
        f"**Gravité** : {f['gravite']} · **catégorie** : {f['categorie']} · "
        f"**version** : {doc['version']}" + (f" · **périmètre** : {doc['perimetre']}" if doc["perimetre"] else ""),
        f"**Emplacements**\n{files}",
        f"**Constat**\n\n{f['constat']}",
        f"**Proposition**\n\n{f['proposition']}",
    ]
    if f["verification"]:
        parts.append(f"**Vérification**\n\n{f['verification']}")
    parts.append(
        f"---\n_Constat d'un agent de revue {doc['revue']} (S-1.16, `docs/revues-agents/revue-{doc['revue']}.md`). "
        "À trier : corriger, reporter ou fermer en « non retenu » avec la raison._"
    )
    return "\n\n".join(parts)


def _gh(*args: str, stdin: str | None = None) -> str:
    return subprocess.run(["gh", *args], input=stdin, text=True, capture_output=True, check=True).stdout


def open_titles(repo: str) -> set[str]:
    out = _gh("issue", "list", "-R", repo, "--state", "open", "--limit", "500", "--json", "title")
    return {i["title"] for i in json.loads(out)}


def ensure_labels(repo: str, kind: str) -> None:
    wanted = {lbl for lvl in LEVELS for lbl in issue_labels(kind, {"gravite": lvl})}
    for name, colour in LABEL_COLOURS.items():
        if name not in wanted:
            continue
        subprocess.run(["gh", "label", "create", name, "-R", repo, "--color", colour, "--force"], check=True)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Constats d'un agent de revue → issues GitHub")
    p.add_argument("fichier", type=Path)
    p.add_argument("--create", action="store_true", help="ouvrir les issues (sinon : vérifier et afficher)")
    p.add_argument("--repo", default="Opaland/Netatmo")
    args = p.parse_args(argv)
    try:
        doc = validate(json.loads(args.fichier.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError, Invalid) as err:
        print(f"Constats invalides : {err}", file=sys.stderr)
        return 1
    kind = doc["revue"]
    counts = {lvl: sum(f["gravite"] == lvl for f in doc["constats"]) for lvl in LEVELS}
    print(f"Revue {kind} {doc['version']} : " + ", ".join(f"{n} {lvl}" for lvl, n in counts.items()))
    if kind == "promesses":
        print(
            "Promesses : " + ", ".join(f"{sum(p['classement'] == v for p in doc['promesses'])} {v}" for v in VERDICTS)
        )
    if not args.create:
        for f in doc["constats"]:
            print(f"- [{f['gravite']}] {issue_title(kind, f)}")
        return 0
    ensure_labels(args.repo, kind)
    existing = open_titles(args.repo)
    created = 0
    for f in doc["constats"]:
        title = issue_title(kind, f)
        if title in existing:
            print(f"déjà ouverte : {title}")
            continue
        label_args = [a for lbl in issue_labels(kind, f) for a in ("--label", lbl)]
        body = issue_body(doc, f)
        _gh("issue", "create", "-R", args.repo, "--title", title, "--body-file", "-", *label_args, stdin=body)
        created += 1
    print(f"{created} issue(s) ouverte(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
