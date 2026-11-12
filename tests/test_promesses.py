"""#365: the strongest privacy promises of the screens, held by tests on the demo rather than by a
reading. What the app says is sent to the AI (web/src/legal.ts, views/settings.ts,
views/insight.ts, README, docs/juridique.md): the month's totals and at most five unusual days,
rooms and sensors under a pseudonym, never their names."""

import json
import re
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

from collector.insights import MAX_UNUSUAL_DAYS
from collector.storage import Store

ROOT = Path(__file__).parent.parent
WORDS = {5: "cinq"}

TODAY = date(2026, 11, 9)


@pytest.fixture(scope="module")
def sent(tmp_path_factory):
    """Generate the demo, then ask for its analysis with a fake client: what would leave."""
    from collector.demo import generate as demo
    from collector.insights import generate

    path = tmp_path_factory.mktemp("demo")
    demo(path, "demo", today=TODAY)
    store = Store(path, "demo")
    calls = []

    def create(**kw):
        calls.append(kw)
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text="### Bilan\nRien.")])

    client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)))
    assert generate(store, today=TODAY, force=True, client=client)
    assert calls, "aucun appel à l'IA : le test ne prouverait rien"
    blob = "".join(json.dumps(c["messages"], ensure_ascii=False) + c["system"] for c in calls)
    return store, blob, store.doc("insights")["facts"]


def test_no_room_module_or_home_name_reaches_the_ai(sent):
    store, blob, _facts = sent
    rooms = store.meta["rooms"]
    modules = store.doc("station")["modules"]
    names = [r["name"] for r in rooms] + [m["name"] for m in modules.values()]
    assert len(names) >= 8  # the demo's rooms and station modules: the test would prove nothing without them
    for name in names:
        # as typed (the usage « chauffe-eau », in lower case, is a category, not the room's name)
        assert not re.search(rf"\b{re.escape(name)}\b", blob), "un nom de pièce ou de module part chez l'IA"
    for secret in [r["id"] for r in rooms] + [store.meta["home"]["name"]]:
        assert secret not in blob
    assert "Pièce A" in blob  # pseudonyms instead


def test_only_the_month_totals_and_at_most_five_unusual_days(sent):
    _store, blob, facts = sent
    # no ISO day nor hour anywhere in what is sent
    assert not re.search(r"\d{4}-\d{2}-\d{2}", blob)
    # the only daily values: the unusual days, five at most
    assert len(facts.get("jours_inhabituels", [])) <= MAX_UNUSUAL_DAYS

    def lists(o, path=""):
        if isinstance(o, dict):
            for k, v in o.items():
                yield from lists(v, f"{path}/{k}")
        elif isinstance(o, list):
            yield path, o
            for v in o:
                yield from lists(v, path)

    for path, value in lists(facts):
        # a list of more than five items would be a series (days, hours), not a total
        assert len(value) <= MAX_UNUSUAL_DAYS or path == "/pieces", (
            f"série envoyée à l'IA : {path} ({len(value)} éléments)"
        )


# Every surface that says what leaves for the AI says the same thing, with the collector's number.
SURFACES = {
    "web/src/legal.ts": "Anthropic (analyse IA",
    "web/src/settings.ts": "console.anthropic.com",
    "web/src/views/settings.ts": "'Anthropic (Claude)'",
    "README.md": "Ce qui est envoyé à Anthropic",
    "docs/juridique.md": "**IA** : seuls",
    "CONTRIBUTING.md": "**IA** : seuls",
    "docs/PROJET.md": "- IA : seuls",
}


@pytest.mark.parametrize("path", sorted(SURFACES))
def test_every_surface_promises_what_the_collector_sends(path):
    text = (ROOT / path).read_text(encoding="utf-8")
    i = text.index(SURFACES[path])
    near = " ".join(text[i : i + 700].split())  # the sentence about the AI, wrapped lines joined
    assert f"au plus {WORDS[MAX_UNUSUAL_DAYS]} jours inhabituels" in near, f"{path} : limite des jours envoyés non dite"
    assert "pseudonyme" in near, f"{path} : les pseudonymes ne sont pas dits"
    for wrong in ("seuls des totaux mensuels", "seuls des agrégats mensuels", "et les noms des pièces"):
        assert wrong not in near, f"{path} : « {wrong} » promet autre chose que ce qui est envoyé"
