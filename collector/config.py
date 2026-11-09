"""Configuration read from environment variables (GitHub Actions secrets or a local .env)."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_API_BASE = "https://app.muller-intuitiv.net"


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader (KEY=VALUE lines) so local runs need no extra dependency."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass
class Settings:
    username: str = ""
    password: str = ""
    client_id: str = ""
    client_secret: str = ""
    api_base: str = DEFAULT_API_BASE
    user_prefix: str = "muller"
    app_identifier: str = "app_muller"
    passphrase: str = ""
    netatmo_client_id: str = ""
    netatmo_client_secret: str = ""
    netatmo_refresh_token: str = ""
    enedis_token: str = ""
    enedis_prm: str = ""
    shelly_auth_key: str = ""
    shelly_server: str = ""
    data_dir: Path = Path("data")
    # Optional overrides: {"<room_id>": "water_heater" | "heating" | "ignore"}
    room_categories: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_env(cls) -> Settings:
        _load_dotenv(Path(".env"))
        overrides_raw = os.environ.get("INTUIS_ROOM_CATEGORIES", "").strip().strip()
        overrides = json.loads(overrides_raw) if overrides_raw else {}
        return cls(
            username=os.environ.get("INTUIS_USERNAME", "").strip(),
            password=os.environ.get("INTUIS_PASSWORD", "").strip(),
            client_id=os.environ.get("INTUIS_CLIENT_ID", "").strip(),
            client_secret=os.environ.get("INTUIS_CLIENT_SECRET", "").strip(),
            api_base=os.environ.get("INTUIS_API_BASE", DEFAULT_API_BASE).rstrip("/"),
            user_prefix=os.environ.get("INTUIS_USER_PREFIX", "muller"),
            app_identifier=os.environ.get("INTUIS_APP_IDENTIFIER", "app_muller"),
            passphrase=os.environ.get("DATA_PASSPHRASE", "").strip(),
            netatmo_client_id=os.environ.get("NETATMO_CLIENT_ID", "").strip(),
            netatmo_client_secret=os.environ.get("NETATMO_CLIENT_SECRET", "").strip(),
            netatmo_refresh_token=os.environ.get("NETATMO_REFRESH_TOKEN", "").strip(),
            enedis_token=os.environ.get("ENEDIS_TOKEN", "").strip(),
            enedis_prm=os.environ.get("ENEDIS_PRM", "").strip(),
            shelly_auth_key=os.environ.get("SHELLY_AUTH_KEY", "").strip(),
            shelly_server=os.environ.get("SHELLY_SERVER", "").strip(),
            data_dir=Path(os.environ.get("DATA_DIR", "data")),
            room_categories=overrides,
        )

    def require(self, *names: str) -> None:
        missing = [n for n in names if not getattr(self, n)]
        if missing:
            env = {
                "username": "INTUIS_USERNAME",
                "password": "INTUIS_PASSWORD",
                "client_id": "INTUIS_CLIENT_ID",
                "client_secret": "INTUIS_CLIENT_SECRET",
                "passphrase": "DATA_PASSPHRASE",
            }
            raise SystemExit("Variables manquantes : " + ", ".join(env.get(n, n) for n in missing))
