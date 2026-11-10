"""S-12.5: prolonged cold alert, from the repository variable COLD_ALERT_JSON."""

import pytest

from collector.cold import (
    ColdError,
    cold_alerts,
    cold_config,
    cold_status,
    daily_means,
    parse_cold_alert,
    write_cold_file,
)
from collector.storage import Store


def test_config_is_validated_without_quoting_values():
    assert parse_cold_alert('{"threshold": 14, "rooms": ["a", "b", "a"]}') == {
        "threshold": 14,
        "days": 1,
        "rooms": ["a", "b"],
    }
    assert parse_cold_alert('{"threshold": 14, "days": 2, "rooms": []}') is None  # disabled
    bad = {
        "{": "illisible",
        "[]": "objet",
        '{"threshold": 40, "rooms": ["salon-secret"]}': "seuil",
        '{"threshold": true, "rooms": ["salon-secret"]}': "seuil",
        '{"threshold": 14, "days": 0, "rooms": ["salon-secret"]}': "durée",
        '{"threshold": 14, "rooms": "salon-secret"}': "liste",
        '{"threshold": 14, "rooms": [' + ",".join(f'"r{i}"' for i in range(11)) + "]}": "plus de 10",
    }
    for raw, why in bad.items():
        with pytest.raises(ColdError, match=why) as err:
            parse_cold_alert(raw)
        assert "salon-secret" not in str(err.value)


def test_disabled_by_default_and_invalid_value_reported_not_quoted(monkeypatch):
    warnings = []
    monkeypatch.delenv("COLD_ALERT_JSON", raising=False)
    assert cold_config(warnings.append) is None
    monkeypatch.setenv("COLD_ALERT_JSON", '{"threshold": 99, "rooms": ["chambre-de-mamie"]}')
    assert cold_config(warnings.append) is None
    assert len(warnings) == 1 and "chambre-de-mamie" not in warnings[0] and "99" not in warnings[0]


def test_status_counts_consecutive_days_below_the_threshold():
    means = {"2025-01-01": 13.0, "2025-01-02": 15.0, "2025-01-03": 12.0, "2025-01-04": 11.0}
    assert cold_status(means, 14, 1, "2025-01-04") == ("cold", 2)
    assert cold_status(means, 14, 3, "2025-01-04") == ("ok", 2)
    assert cold_status(means, 10, 1, "2025-01-04") == ("ok", 0)
    assert cold_status({"2025-01-01": 10.0, "2025-01-03": 10.0}, 14, 2, "2025-01-03") == ("ok", 1)  # gap
    assert cold_status(means, 14, 1, "2025-01-09") == ("stale", 0)
    assert cold_status({}, 14, 1, "2025-01-09") == ("stale", 0)


def test_alert_file_has_pseudonyms_only(tmp_path, monkeypatch):
    store = Store(tmp_path, "pw")
    for day in ("2025-01-02", "2025-01-03"):
        store.merge("100", day, 1000.0)
        store.put("2025", "temps", "100", day, [12.4, 19.0])  # radiator probe: cold
        store.put("2025", "temps", "200", day, [19.5, 19.0])  # warm
    store.put("station", "daily", "70:ee:50:aa:bb:cc", "2025-01-03", [10.0, 12.0, 11.3, 60, 900])
    assert daily_means(store, "100") == {"2025-01-02": 12.4, "2025-01-03": 12.4}
    cfg = {"threshold": 14, "days": 2, "rooms": ["200", "100", "70:ee:50:aa:bb:cc", "300"]}
    lines, counts = cold_alerts(store, cfg)
    assert lines == ["Pièce B : sous le seuil choisi depuis 2 jours (moyenne journalière)"]
    assert counts == {"suivies": 4, "froides": 1, "sans_mesure": 1}  # module: 1 day only (ok); 300: no reading
    path = tmp_path / "cold.txt"
    monkeypatch.setenv("COLD_FILE", str(path))
    write_cold_file(lines)
    text = path.read_text()
    assert text == "- Pièce B : sous le seuil choisi depuis 2 jours (moyenne journalière)\n"
    for secret in ("100", "12,4", "12.4", "14", "70:ee"):
        assert secret not in text
    write_cold_file([])
    assert path.read_text() == ""
    assert cold_alerts(store, None) == ([], {"suivies": 0, "froides": 0, "sans_mesure": 0})


def test_log_line_gives_counts_only():
    from collector.__main__ import _cold_label

    assert _cold_label(None, {}) == "Alerte froid : désactivée"
    line = _cold_label({"threshold": 14, "days": 1, "rooms": ["100"]}, {"suivies": 1, "froides": 1, "sans_mesure": 0})
    assert line == "Alerte froid : 1 pièce suivie, 1 sous le seuil, 0 sans mesure récente"


def test_nombre_agrees_the_noun():
    """#406: a count agreed with its noun, the French way (plural from 2), never « (s) »."""
    from collector.texte import nombre

    assert nombre(0, "module") == "0 module"
    assert nombre(1, "module") == "1 module"
    assert nombre(2, "module") == "2 modules"
    assert nombre(3, "mise à jour détectée", "mises à jour détectées") == "3 mises à jour détectées"
