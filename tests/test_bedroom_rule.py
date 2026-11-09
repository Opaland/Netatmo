"""#234: the AI facts recognise bedrooms with the same rule as the app (web/src/household.ts)."""

import json
import re
from pathlib import Path

from collector.insights import BEDROOM_WORDS, is_bedroom

ROOT = Path(__file__).resolve().parent.parent
VECTOR = json.loads((ROOT / "web/src/__fixtures__/bedroom-names.json").read_text(encoding="utf-8"))


def test_same_words_as_the_shared_vector():
    assert list(BEDROOM_WORDS) == VECTOR["words"]


def test_same_words_as_the_app():
    src = (ROOT / "web/src/household.ts").read_text(encoding="utf-8")
    m = re.search(r"export const BEDROOM_WORDS = \[([^\]]*)\]", src)
    assert m, "BEDROOM_WORDS introuvable dans household.ts"
    assert re.findall(r"'([^']*)'", m.group(1)) == list(BEDROOM_WORDS)


def test_shared_cases():
    for name, expected in VECTOR["cases"]:
        assert is_bedroom(name) is expected, name
