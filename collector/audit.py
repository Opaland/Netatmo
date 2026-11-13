"""Audit of the dates and overlaps of the encrypted archive (#532): `diagnose --qualite --rapport DIR`.

Two outputs, never mixed:
- `public_lines`: printed in the log of a PUBLIC repository, so COUNTS per check and per month only
  (the rule of collector/quality.py): never a value, a name, an id, nor a date finer than the month;
- `private_doc`: the detail (exact day or hour, the values, the file and the series, the cause), for
  the owner only. It is encrypted with the data key (`encrypt_json`, the envelope of every file of
  data/, same salt and derivation as keyinfo.json, so the app opens it with the key it already has)
  and written to DIR; the workflow Diagnostic keeps it as a short-lived artifact. It is read in the
  app, État des données (web/src/audit-report.ts).

Nothing of the archive is ever written back: the audit only reads.

The checks are named in CHECKS (title, what it means, what the app does with such a day) and the
thresholds in THRESHOLDS (value, why, and whether it is only a hypothesis): the report carries both,
so the app shows them without a list of its own (AGENTS.md §5).

Every series is found by walking the documents: any object whose keys are dates ("YYYY-MM",
"YYYY-MM-DD", "YYYY-MM-DDTHH", "YYYY-MM-DDTHH:MM") is a dated series, whatever the source (Intuis
day, hour, half hour, tariffs, temperatures; Linky; station; weather; Shelly; Home Assistant;
shutters; devices). The dates and overlap checks:
- `cle-invalide`: a key that is not a date of its series' form, or an impossible date (30 February);
- `doublon-horodatage`: two keys for the same moment written differently ("2024-1-5" and
  "2024-01-05"), or the same key twice in one JSON object (the last silently wins on read);
- `mauvais-fichier`: a day stored in the file of another year (2025-01-01 in 2024.enc.json);
- `deux-fichiers`: the same day of the same series in two year files: the app reads both;
- `heure-inexistante`: a local hour that does not exist (the spring change in Europe/Paris), or a
  half hour of that hour filled in a 30-min day;
- `decalage-heures`: hours (half hours) whose sum fits the day only once shifted by one or two hours
  (stored in UTC instead of local time?) or by a whole day (stored under the wrong day);
- `decalage-jour-linky`: Intuis above the Linky meter on many days of a month, but not once one of
  the two is shifted by a day;
- `estime-sur-reel`: a day flagged « estimé » (spread from the monthly total) that has measured
  hours (Intuis hourly or 30 min): a measure exists for a day the app counts as estimated. (Two
  estimated days of a month may differ: the backfill spreads a month cut by two of its yearly
  windows twice, collector/sync.py, so a different share is not a finding.) And
  `marque-sans-valeur`: a day flagged estimated with no value;
- `tarifs-additionnes`: a day whose energy is twice the sum of its tariffs (two measure families
  added) or below it (impossible: the day keeps the largest family, collector/sync.py);
- `deux-sources`: a plug (Shelly) or a Home Assistant energy sensor that measures the same energy
  as an Intuis room, day after day: the app counts it in « autres usages » on top of the room.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Callable, Iterator
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .crypto import decrypt_bytes, encrypt_json
from .quality import CROSS_MARGIN_WH, CROSS_RATIO, Report, above_meter
from .storage import Store, own_year_first
from .sync import HOURLY_DAYS_SYNC, MONTH_GAP_SHARE, MONTH_GAP_WH

REPORT_NAME = "audit-donnees.enc.json"
REPORT_KIND = "audit-donnees"
REPORT_VERSION = 1
# Never read: secrets, not data (the rotating refresh token of the station).
SKIPPED = {"netatmo-token"}


@dataclass(frozen=True)
class Check:
    group: str  # "dates" (PR 1 of #532), "valeurs", "trous"
    title: str
    what: str
    app: str  # what the app does with such a day (« compté une fois », « compté deux fois »…)
    level: str = "defaut"  # "defaut" (cannot be right) or "a-verifier" (probably wrong)


CHECKS: dict[str, Check] = {
    "cle-invalide": Check(
        "dates",
        "Date illisible ou impossible",
        "une clé de la série n'est pas une date de la forme attendue, ou n'existe pas au calendrier",
        "la valeur est ignorée ou rangée à part : elle ne compte dans aucun jour",
    ),
    "doublon-horodatage": Check(
        "dates",
        "Même instant écrit deux fois",
        "deux clés désignent le même jour ou la même heure (écritures différentes, ou clé répétée dans le fichier)",
        "une seule des deux valeurs est lue, l'autre est perdue sans le dire",
    ),
    "mauvais-fichier": Check(
        "dates",
        "Jour rangé dans le fichier d'une autre année",
        "le jour est daté d'une année et rangé dans le fichier d'une autre, souvent à la borne de fin d'année",
        "le jour est lu, mais la couverture de l'année le compte du mauvais côté",
    ),
    "deux-fichiers": Check(
        "dates",
        "Même jour dans deux fichiers d'année",
        "la même série a une valeur pour ce jour dans deux fichiers d'année",
        "une seule valeur est lue, celle du fichier de l'année du jour (jamais la somme des deux)",
    ),
    "heure-inexistante": Check(
        "dates",
        "Heure qui n'existe pas (changement d'heure)",
        "une valeur est posée sur une heure locale qui n'existe pas, celle que le passage à l'heure d'été saute",
        "la valeur compte dans le jour, mais à une heure qu'aucune horloge n'a affichée",
    ),
    "decalage-heures": Check(
        "dates",
        "Heures décalées par rapport au jour",
        "la somme des heures (ou demi-heures) ne retrouve le total du jour qu'une fois décalée : "
        "heures en UTC au lieu de l'heure de Paris, ou rangées sous le mauvais jour",
        "les courbes heure par heure sont décalées d'autant ; les totaux par jour ne changent pas",
        "a-verifier",
    ),
    "decalage-fuseau": Check(
        "dates",
        "Heures d'Intuis et du Linky décalées",
        "la courbe heure par heure des radiateurs suit celle du compteur Linky avec une ou deux heures d'écart : "
        "l'une des deux est rangée en UTC au lieu de l'heure de Paris ?",
        "les courbes heure par heure et le partage heures pleines / creuses sont décalés d'autant",
        "a-verifier",
    ),
    "decalage-jour-linky": Check(
        "dates",
        "Intuis et Linky décalés d'un jour",
        "les radiateurs dépassent le compteur Linky plusieurs jours du mois, mais plus du tout si l'un "
        "est décalé d'un jour",
        "le recoupement Intuis / Linky et la reconstitution des jours perdus se trompent de jour",
        "a-verifier",
    ),
    "estime-sur-reel": Check(
        "dates",
        "Jour estimé qui a des heures mesurées",
        "le jour est marqué « estimé » (part du total du mois), mais Intuis a des relevés à l'heure ou à la "
        "demi-heure ce jour-là : une mesure existe",
        "le jour est compté une fois, comme estimé : jamais ajouté aux heures mesurées",
        "a-verifier",
    ),
    "marque-sans-valeur": Check(
        "dates",
        "Jour marqué estimé sans valeur",
        "le jour est marqué « estimé » mais aucune valeur n'est rangée ce jour-là",
        "l'application le compte comme estimé, à 0 kWh",
    ),
    "tarifs-additionnes": Check(
        "dates",
        "Jour et tarifs qui ne s'accordent pas",
        "l'énergie du jour vaut deux fois la somme de ses tarifs (deux familles de mesure additionnées) "
        "ou moins que cette somme (impossible : le jour garde la plus grande famille)",
        "le total du jour et le partage heures pleines / creuses ne disent pas la même chose",
    ),
    "deux-sources": Check(
        "dates",
        "Deux sources pour la même énergie",
        "une prise ou un capteur mesure jour après jour la même énergie qu'une pièce Intuis",
        "« Autres usages » la retire une seconde fois du Linky : elle y est comptée deux fois",
        "a-verifier",
    ),
}


@dataclass(frozen=True)
class Threshold:
    value: float
    unit: str
    why: str
    hypothesis: bool  # True: not justified by a measure or a rule, to be confirmed on the first report


THRESHOLDS: dict[str, Threshold] = {
    "ecart_absolu": Threshold(
        MONTH_GAP_WH,
        "Wh",
        "écart toléré entre deux échelles d'une même série (heures et jour, tarifs et jour) : celui que la "
        "collecte accepte entre le total du mois et ses jours (collector/sync.py)",
        True,
    ),
    "ecart_relatif": Threshold(
        MONTH_GAP_SHARE * 100,
        "%",
        "même origine que l'écart absolu ; le plus grand des deux s'applique",
        True,
    ),
    "jours_recents": Threshold(
        HOURLY_DAYS_SYNC,
        "jours",
        "les derniers jours ne sont pas comparés : la collecte relit leurs heures chaque nuit, les "
        "valeurs arrivent en retard",
        False,
    ),
    "jours_min_mois": Threshold(
        7,
        "jours",
        "jours comparables d'un mois en dessous desquels on ne conclut pas à un décalage (une semaine)",
        True,
    ),
    "part_decalee": Threshold(
        80,
        "%",
        "part des jours comparables qui doivent coller avec un même décalage, alors que la moitié au plus collent sans",
        True,
    ),
    "gain_correlation": Threshold(
        0.1,
        "",
        "gain de corrélation entre les heures d'Intuis et du Linky, une fois décalées, au-delà duquel on "
        "signale le décalage "
        "(sur au moins une semaine d'heures communes)",
        True,
    ),
    "jours_linky_min": Threshold(
        3,
        "jours",
        "jours d'un mois où Intuis dépasse le Linky avant de chercher un décalage d'un jour (un ou deux jours "
        "isolés sont déjà comptés dans le bilan)",
        True,
    ),
    "jours_sources_min": Threshold(
        14,
        "jours",
        "jours communs (les deux sources au-dessus de l'écart absolu) avant de dire que deux sources "
        "mesurent la même chose",
        True,
    ),
    "depassement_linky": Threshold(
        round((CROSS_RATIO - 1) * 100),
        "%",
        f"Intuis au-dessus du Linky de plus de 10 % et {CROSS_MARGIN_WH} Wh : impossible (bilan qualité, "
        f"collector/quality.py)",
        False,
    ),
}
MIN_DAYS = int(THRESHOLDS["jours_min_mois"].value)
SHIFT_SHARE = THRESHOLDS["part_decalee"].value / 100
CORR_GAIN = THRESHOLDS["gain_correlation"].value
LINKY_MIN = int(THRESHOLDS["jours_linky_min"].value)
SOURCES_MIN = int(THRESHOLDS["jours_sources_min"].value)
# Cap of the detail kept per check (the counts stay complete): the report fits the device's storage.
MAX_SHOWN = 200


def tolerance(wh: float) -> float:
    """The gap allowed between two scales of the same energy (THRESHOLDS ecart_*)."""
    return max(MONTH_GAP_WH, MONTH_GAP_SHARE * abs(wh))


@dataclass
class Finding:
    code: str
    doc: str  # file, without .enc.json
    series: str  # label of the series (French)
    day: str | None = None  # YYYY-MM-DD (private)
    at: str | None = None  # the key as stored (private)
    room: str | None = None  # room id, module or plug key: the app gives its name
    value: float | None = None
    other: float | None = None
    text: str = ""


# ---------------------------------------------------------------- reading
class _Obj(dict):
    """A JSON object that remembers the keys it had twice (json keeps the last silently)."""

    __slots__ = ("dupes",)


def _hook(pairs: list[tuple[str, object]]) -> _Obj:
    out = _Obj()
    out.dupes = []
    for k, v in pairs:
        if k in out:
            out.dupes.append(k)
        out[k] = v
    return out


def read_docs(data_dir: Path, passphrase: str, errors: list[str] | None = None) -> dict[str, dict]:
    """Every encrypted document of data/, decrypted and parsed with duplicate keys remembered. A file
    that cannot be read is named in `errors` (file name and error type) and left out."""
    out: dict[str, dict] = {}
    for p in sorted(data_dir.glob("*.enc.json")):
        name = p.name.removesuffix(".enc.json")
        if name in SKIPPED:
            continue
        try:
            obj = json.loads(decrypt_bytes(json.loads(p.read_text()), passphrase), object_pairs_hook=_hook)
        except Exception as err:  # noqa: BLE001 - one unreadable file must not hide the others
            if errors is not None:
                errors.append(f"{_public_name(name)} illisible : {type(err).__name__}")
            continue
        if isinstance(obj, dict):
            out[name] = obj
    return out


def _public_name(name: str) -> str:
    """A file name safe for the public log: its kind, the year shown as « AAAA »."""
    return re.sub(r"^\d{4}", "AAAA", name) + ".enc.json"


# ---------------------------------------------------------------- dated keys
FORMS = {
    "month": re.compile(r"\d{4}-\d{2}"),
    "day": re.compile(r"\d{4}-\d{2}-\d{2}"),
    "hour": re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}"),
    "minute": re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}"),
}
DATEISH = re.compile(r"^\d{4}-\d")
LOOSE = re.compile(r"^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?(?:[T ](\d{1,2})(?::(\d{1,2}))?.*)?$")


def form_of(key: str) -> str | None:
    return next((f for f, rx in FORMS.items() if rx.fullmatch(key)), None)


# Series stored on a half-hour grid: a key between two half hours is not one of their keys.
HALF_HOURLY = {".linky30"}


def valid(key: str, form: str, half: bool = False) -> bool:
    """A canonical key of `form` that exists on the calendar (hour 0-23, minute 0-59, and on a
    half-hour grid when `half`)."""
    try:
        date.fromisoformat((key + "-01")[:10] if form == "month" else key[:10])
    except ValueError:
        return False
    if form in ("hour", "minute") and int(key[11:13]) > 23:
        return False
    return not (form == "minute" and (int(key[14:16]) > 59 or (half and key[14:16] not in ("00", "30"))))


def canonical(key: str, form: str) -> str | None:
    """The canonical spelling of a loosely written date key in `form`, or None."""
    m = LOOSE.match(key.strip())
    if not m:
        return None
    y, mo, d, h, mi = m.groups()
    out = f"{y}-{int(mo):02d}"
    if form == "month":
        return out
    if d is None:
        return None
    out += f"-{int(d):02d}"
    if form == "day":
        return out
    if h is None:
        return None
    out += f"T{int(h):02d}"
    return out if form == "hour" else out + f":{int(mi or 0):02d}"


def local_exists(key: str, tz: ZoneInfo) -> bool:
    """False for a local wall time skipped by the spring change ("2024-03-31T02" in Paris)."""
    hh = int(key[11:13])
    mm = int(key[14:16]) if len(key) > 13 else 0
    wall = datetime(int(key[:4]), int(key[5:7]), int(key[8:10]), hh, mm, tzinfo=tz)
    back = wall.astimezone(UTC).astimezone(tz)
    return (back.hour, back.minute) == (hh, mm)


def day_slots(day: str, minutes: int, tz: ZoneInfo) -> list[str]:
    """The keys of the local wall times of `day`, every `minutes` (23 hours in spring; in autumn the
    repeated hour is one key, its energy added: collector/sync.py, enedis.py, room30.py)."""
    out: list[str] = []
    for i in range(0, 24 * 60, minutes):
        key = f"{day}T{i // 60:02d}" + (f":{i % 60:02d}" if minutes < 60 else "")
        if local_exists(key, tz):
            out.append(key)
    return out


@dataclass
class Series:
    doc: str
    path: tuple[str, ...]
    data: dict
    form: str = "day"
    year: int | None = None  # year of the file (YYYY…enc.json)
    base: str = ""  # name of the file without its year ("", ".hourly"…), the series' identity across years

    @property
    def section(self) -> str:
        return self.path[0] if self.path else ""

    @property
    def room(self) -> str | None:
        return self.path[1] if len(self.path) > 1 else None

    @property
    def label(self) -> str:
        known = SERIES_LABEL.get((self.base if self.year is not None else self.doc, self.section))
        return known or " › ".join((self.doc, *self.path[:1])) or self.doc


SERIES_LABEL: dict[tuple[str, str], str] = {
    ("", "daily"): "énergie du jour (Intuis)",
    ("", "tariffs"): "énergie du jour par tarif (Intuis)",
    ("", "temps"): "température et consigne du jour (Intuis)",
    ("", "estimated"): "jours estimés depuis le total du mois (Intuis)",
    ("", "coverage"): "couverture par mois (Intuis)",
    (".hourly", "hourly"): "énergie par heure (Intuis)",
    (".room30", "rooms"): "pièces à la demi-heure (Intuis)",
    (".linky30", "curve"): "courbe de charge à la demi-heure (Linky)",
    (".station_h", "hourly"): "station, relevés horaires",
    ("linky", "daily"): "consommation du jour (Linky)",
    ("linky", "pmax"): "puissance maximale du jour (Linky)",
    ("linky", "pmax_at"): "heure de la puissance maximale (Linky)",
    ("linky", "index"): "index du compteur (Linky)",
    ("station", "daily"): "station, relevé du jour",
    ("weather", "outdoor"): "météo extérieure du jour",
    ("shelly", "daily"): "prise connectée, énergie du jour",
    ("ha", "daily"): "Home Assistant, relevé du jour",
    ("volets", "days"): "volets, relevé du jour",
    ("roomstate", "seen"): "relevé horaire de l'état des pièces",
}
YEAR_DOC = re.compile(r"^(\d{4})(\..+)?$")


def series_of(name: str, obj: dict) -> Iterator[Series]:
    """Every dated series of a document: an object most of whose keys look like dates."""
    m = YEAR_DOC.match(name)
    year, base = (int(m.group(1)), m.group(2) or "") if m else (None, "")

    def walk(o: object, path: tuple[str, ...]) -> Iterator[Series]:
        if not isinstance(o, dict) or not o:
            return
        keys = [k for k in o if isinstance(k, str)]
        dated = [k for k in keys if DATEISH.match(k)]
        if dated and 2 * len(dated) >= len(keys):
            forms = [f for f in map(form_of, dated) if f]
            form = max(set(forms), key=forms.count) if forms else "day"
            yield Series(name, path, o, form, year, base)
            return
        for k, v in o.items():
            yield from walk(v, (*path, str(k)))

    yield from walk(obj, ())


# ---------------------------------------------------------------- the audit
@dataclass
class Audit:
    docs: dict[str, dict]
    tz: ZoneInfo
    last: str | None
    kinds: dict[str, str] = field(default_factory=dict)  # room id -> category
    # the quality report of the same archive: Intuis real Wh per day and Linky, read by its rules
    real: Report | None = None
    findings: list[Finding] = field(default_factory=list)
    # checks or files that could not be read: their name and the type of error, never a value
    errors: list[str] = field(default_factory=list)

    @classmethod
    def of(cls, store: Store, docs: dict[str, dict]) -> Audit:
        home = store.meta.get("home") or {}
        tz = ZoneInfo(str(home.get("timezone") or "Europe/Paris"))
        kinds = {str(r.get("id")): str(r.get("category")) for r in store.meta.get("rooms") or [] if isinstance(r, dict)}
        # the last valid day (Store.last_day compares strings: « 2024-4-5 » would come after April 30)
        days = [
            d
            for name, doc in docs.items()
            if YEAR_DOC.match(name) and "." not in name
            for r in (doc.get("daily") or {}).values()
            if isinstance(r, dict)
            for d in r
        ]
        last = max((d for d in days if isinstance(d, str) and form_of(d) == "day" and valid(d, "day")), default=None)
        try:
            real: Report | None = Report(store, [])
        except ValueError:  # an unreadable day key: the audit names it, the cross-checks are skipped
            real = None
        return cls(docs, tz, last, kinds, real)

    def add(self, code: str, s: Series | None, **kw: object) -> None:
        doc = s.doc if s else str(kw.pop("doc", ""))
        label = s.label if s else str(kw.pop("series", ""))
        room = kw.pop("room", s.room if s else None)
        self.findings.append(Finding(code, doc, label, room=room, **kw))  # type: ignore[arg-type]

    def series(self) -> list[Series]:
        return [s for name, obj in self.docs.items() for s in series_of(name, obj)]

    def run(self) -> Audit:
        """Every check; one that fails on an unexpected structure is named (its error type only) and
        the others still run: the audit never stops the quality report."""
        steps: list[tuple[str, Callable[[], None]]] = [("doublons du JSON", self.duplicate_json)]
        all_series: list[Series] = []

        def keys() -> None:
            all_series.extend(self.series())
            for s in all_series:
                self.keys(s)

        steps += [
            ("clés", keys),
            ("fichiers d'année", lambda: self.across_years(all_series)),
            ("jours estimés", self.estimated),
            ("tarifs", self.tariffs),
            ("heures décalées", self.shifts),
            ("fuseau", self.hours_vs_linky),
            ("jour Linky", self.linky_lag),
            ("deux sources", self.two_sources),
        ]
        for what, step in steps:
            try:
                step()
            except Exception as err:  # noqa: BLE001 - a malformed archive must not stop the report
                self.errors.append(f"{what} : {type(err).__name__}")
        return self

    # ------------------------------------------------------- keys
    def duplicate_json(self) -> None:
        def walk(o: object, name: str, path: tuple[str, ...]) -> None:
            if isinstance(o, _Obj):
                for k in o.dupes:
                    s = Series(name, path, o)
                    day = k[:10] if form_of(k) and valid(k, form_of(k) or "day") and len(k) >= 10 else None
                    self.add(
                        "doublon-horodatage",
                        s,
                        day=day,
                        at=k,
                        text=f"la clé « {k} » est écrite deux fois dans {name}.enc.json : seule la dernière est lue",
                    )
                for k, v in o.items():
                    walk(v, name, (*path, str(k)))
            elif isinstance(o, list):
                for v in o:
                    walk(v, name, path)

        for name, obj in self.docs.items():
            walk(obj, name, ())

    def keys(self, s: Series) -> None:
        half = s.base in HALF_HOURLY
        canon = {k for k in s.data if isinstance(k, str) and form_of(k) == s.form and valid(k, s.form, half)}
        local = s.form in ("hour", "minute")
        for k in s.data:
            if not isinstance(k, str):
                continue
            if k in canon:
                if s.year is not None and int(k[:4]) != s.year:
                    self.add(
                        "mauvais-fichier",
                        s,
                        day=k[:10] if len(k) >= 10 else None,
                        at=k,
                        text=f"« {k} » est rangé dans {s.doc}.enc.json, le fichier de {s.year}",
                    )
                if local and not local_exists(k, self.tz):
                    self.add(
                        "heure-inexistante",
                        s,
                        day=k[:10],
                        at=k,
                        value=_num(s.data[k]),
                        text=f"« {k} » n'existe pas à l'heure locale ({self.tz.key}) : le passage à "
                        f"l'heure d'été la saute",
                    )
                continue
            if not DATEISH.match(k):
                continue  # a field of the document next to its series (unit, status…)
            c = canonical(k, s.form)
            if c and c in canon:
                self.add(
                    "doublon-horodatage",
                    s,
                    day=c[:10] if len(c) >= 10 else None,
                    at=k,
                    value=_num(s.data[k]),
                    other=_num(s.data[c]),
                    text=f"« {k} » et « {c} » désignent le même instant : deux valeurs pour une",
                )
            else:
                self.add(
                    "cle-invalide",
                    s,
                    at=k,
                    value=_num(s.data[k]),
                    text=f"« {k} » n'est pas une date valide de la forme attendue "
                    f"({FORM_LABEL[s.form]}{', à la demi-heure' if half else ''})",
                )
        if s.base == ".room30" and s.section == "rooms" and len(s.path) == 2:
            self.room30_hours(s)

    def room30_hours(self, s: Series) -> None:
        """The two half hours skipped in spring hold no energy (collector/room30.py leaves them empty)."""
        for day, cols in s.data.items():
            if not isinstance(cols, list) or not isinstance(day, str) or not valid(day, "day"):
                continue
            skipped = [i for i in range(48) if not local_exists(f"{day}T{i // 2:02d}:{30 * (i % 2):02d}", self.tz)]
            if not skipped:
                continue
            filled = [i for i in skipped if any(_slot(c, i) for c in cols[:2])]  # 0 Wh there changes nothing
            for i in filled:
                at = f"{day}T{i // 2:02d}:{30 * (i % 2):02d}"
                self.add(
                    "heure-inexistante",
                    s,
                    day=day,
                    at=at,
                    value=_num(sum(_slot(c, i) or 0 for c in cols[:2])),
                    text=f"la demi-heure de {at[11:]} a une énergie le jour du passage à l'heure d'été, "
                    f"où elle n'existe pas",
                )

    def across_years(self, all_series: list[Series]) -> None:
        """The same day of the same series in two year files: the app reads both files."""
        seen: dict[tuple[str, tuple[str, ...]], dict[str, Series]] = {}
        for s in all_series:
            if s.year is None:
                continue
            first = seen.setdefault((s.base, s.path), {})
            for k in s.data:
                if not isinstance(k, str) or form_of(k) != s.form or not valid(k, s.form):
                    continue
                other = first.get(k)
                if other is None:
                    first[k] = s
                    continue
                self.add(
                    "deux-fichiers",
                    s,
                    day=k[:10] if len(k) >= 10 else None,
                    at=k,
                    value=_num(s.data[k]),
                    other=_num(other.data[k]),
                    text=f"« {k} » est dans {other.doc}.enc.json et dans {s.doc}.enc.json",
                )

    # ------------------------------------------------------- overlaps
    def _year_section(self, section: str) -> dict[str, dict[str, object]]:
        """{room: {day: value}} of a section of the year documents, read as the app reads them."""
        years = [(name, doc) for name, doc in sorted(self.docs.items()) if YEAR_DOC.match(name) and "." not in name]
        return own_year_first(years, section)

    def estimated(self) -> None:
        daily = self._year_section("daily")
        flags = self._year_section("estimated")
        for rid, days in flags.items():
            values = daily.get(rid, {})
            by_month: dict[str, list[tuple[str, float]]] = {}
            for d in sorted(days):
                v = values.get(d)
                if not isinstance(d, str) or not valid(d, "day"):
                    continue
                if v is None:
                    self.add(
                        "marque-sans-valeur",
                        None,
                        doc=d[:4],
                        series=SERIES_LABEL[("", "estimated")],
                        room=rid,
                        day=d,
                        at=d,
                        text="le jour est marqué estimé, mais aucune énergie n'est rangée ce jour-là",
                    )
                elif _num(v) is not None:
                    by_month.setdefault(d[:7], []).append((d, float(v)))  # type: ignore[arg-type]
            measured = self._measured_hours(rid)
            for d, v in (x for pts in by_month.values() for x in pts):
                hours = measured.get(d)
                if hours:
                    self.add(
                        "estime-sur-reel",
                        None,
                        doc=d[:4],
                        series=SERIES_LABEL[("", "daily")],
                        room=rid,
                        day=d,
                        at=d,
                        value=round(hours, 1),
                        other=round(v, 1),
                        text="marqué estimé, alors que des heures mesurées existent ce jour-là (leur "
                        "somme, puis l'estimation)",
                    )

    def _measured_hours(self, rid: str) -> dict[str, float]:
        """Day -> Wh of the measured hours (Intuis hourly, else 30 min) of a room, when any is non-zero."""
        out: dict[str, float] = {}
        for name, doc in self.docs.items():
            m = YEAR_DOC.match(name)
            if m and m.group(2) == ".hourly":
                hours = (doc.get("hourly") or {}).get(rid)
                for k, v in hours.items() if isinstance(hours, dict) else []:
                    if isinstance(k, str) and _num(v):
                        out[k[:10]] = out.get(k[:10], 0.0) + float(v)  # type: ignore[arg-type]
        for name, doc in self.docs.items():
            m = YEAR_DOC.match(name)
            if m and m.group(2) == ".room30":
                days = (doc.get("rooms") or {}).get(rid)
                for day, cols in days.items() if isinstance(days, dict) else []:
                    if day in out or not isinstance(cols, list):
                        continue
                    total = sum((_slot(c, i) or 0.0) for c in cols[:2] for i in range(48))
                    if total:
                        out[day] = total
        return out

    def tariffs(self) -> None:
        daily = self._year_section("daily")
        flags = self._year_section("estimated")
        for rid, days in self._year_section("tariffs").items():
            for d, cols in sorted(days.items()):
                v = _num(daily.get(rid, {}).get(d))
                if v is None or not isinstance(cols, list) or d in flags.get(rid, {}):
                    continue
                parts = [_num(c) or 0.0 for c in cols]
                total = sum(parts)
                if total <= MONTH_GAP_WH:
                    continue
                if abs(v - 2 * total) <= tolerance(total) and abs(v - total) > tolerance(total):
                    why = "le jour vaut deux fois ses tarifs : deux familles de mesure additionnées ?"
                elif v < total - tolerance(total):
                    why = "le jour est inférieur à la somme de ses tarifs"
                else:
                    continue
                self.add(
                    "tarifs-additionnes",
                    None,
                    doc=d[:4],
                    series=SERIES_LABEL[("", "daily")],
                    room=rid,
                    day=d,
                    at=d,
                    value=round(v, 1),
                    other=round(total, 1),
                    text=why,
                )

    # ------------------------------------------------------- shifts
    def _recent(self) -> str:
        """First day too recent to be compared (values still arriving)."""
        if not self.last:
            return "0000"
        return (date.fromisoformat(self.last) - timedelta(days=HOURLY_DAYS_SYNC - 1)).isoformat()

    def shifts(self) -> None:
        daily = self._year_section("daily")
        flags = self._year_section("estimated")
        hourly: dict[str, dict[str, float]] = {}
        r30: dict[str, dict[str, float]] = {}
        for name, doc in self.docs.items():
            m = YEAR_DOC.match(name)
            if m and m.group(2) == ".hourly":
                for rid, hours in (doc.get("hourly") or {}).items():
                    hourly.setdefault(rid, {}).update({k: float(v) for k, v in hours.items() if _num(v) is not None})
            if m and m.group(2) == ".room30":
                for rid, days in (doc.get("rooms") or {}).items():
                    for day, cols in (days or {}).items():
                        if isinstance(cols, list) and valid(day, "day"):
                            for i in range(48):
                                hp, hc = (
                                    _slot(cols[0] if cols else None, i),
                                    _slot(cols[1] if len(cols) > 1 else None, i),
                                )
                                if hp is not None or hc is not None:
                                    r30.setdefault(rid, {})[f"{day}T{i // 2:02d}:{30 * (i % 2):02d}"] = (hp or 0) + (
                                        hc or 0
                                    )
        for rid, fine in hourly.items():
            day_values = {
                d: float(v)
                for d, v in daily.get(rid, {}).items()
                if _num(v) is not None and d not in flags.get(rid, {})
            }
            self._shift_fit(fine, day_values, 60, ".hourly", SERIES_LABEL[(".hourly", "hourly")], rid)
        for rid, fine in r30.items():
            day_values = {
                d: float(v)
                for d, v in daily.get(rid, {}).items()
                if _num(v) is not None and d not in flags.get(rid, {})
            }
            self._shift_fit(fine, day_values, 30, ".room30", SERIES_LABEL[(".room30", "rooms")], rid)
        curve: dict[str, float] = {}
        for name, doc in self.docs.items():
            m = YEAR_DOC.match(name)
            if m and m.group(2) == ".linky30":
                curve.update({k: float(v) for k, v in (doc.get("curve") or {}).items() if _num(v) is not None})
        linky = {d: float(v) for d, v in (self.docs.get("linky", {}).get("daily") or {}).items() if _num(v) is not None}
        if curve and linky:
            self._shift_fit(curve, linky, 30, ".linky30", SERIES_LABEL[(".linky30", "curve")], None)

    def _shift_fit(
        self, fine: dict[str, float], daily: dict[str, float], minutes: int, base: str, label: str, room: str | None
    ) -> None:
        """Per month, how many comparable days fit the day total with the fine values shifted by k
        steps (k = 0, ±1 h, ±2 h, ±1 day). A finding when the fit is good only once shifted."""
        per_hour = 60 // minutes
        shifts = [k * per_hour for k in (-24, -2, -1, 1, 2, 24)]
        recent = self._recent()
        days = sorted({k[:10] for k in fine if valid(k[:10], "day")})
        if not days:
            return
        seq: list[float | None] = []
        start: dict[str, tuple[int, int]] = {}
        d = date.fromisoformat(days[0]) - timedelta(days=1)
        end = date.fromisoformat(days[-1]) + timedelta(days=1)
        while d <= end:
            slots = day_slots(d.isoformat(), minutes, self.tz)
            start[d.isoformat()] = (len(seq), len(slots))
            seq += [fine.get(k) for k in slots]
            d += timedelta(days=1)

        def window(day: str, k: int) -> float | None:
            i, n = start[day]
            if i + k < 0 or i + k + n > len(seq):
                return None
            part = seq[i + k : i + k + n]
            return None if any(v is None for v in part) else sum(part)  # type: ignore[arg-type]

        months: dict[str, list[int]] = {}  # month -> [comparable days, fit at 0, fit at each shift…]
        for day in days:
            v = daily.get(day)
            if v is None or v < MONTH_GAP_WH or day >= recent:
                continue
            s0 = window(day, 0)
            if s0 is None:
                continue
            cell = months.setdefault(day[:7], [0, 0] + [0] * len(shifts))
            cell[0] += 1
            cell[1] += abs(s0 - v) <= tolerance(v)
            for j, k in enumerate(shifts):
                sk = window(day, k)
                cell[2 + j] += sk is not None and abs(sk - v) <= tolerance(v)
        for month, cell in sorted(months.items()):
            n, ok0 = cell[0], cell[1]
            if n < MIN_DAYS or 2 * ok0 > n:
                continue
            best = max(range(len(shifts)), key=lambda j: cell[2 + j])
            if cell[2 + best] < SHIFT_SHARE * n:
                continue
            k = shifts[best] // per_hour
            what = (
                f"d'un jour {'plus tôt' if k < 0 else 'plus tard'}"
                if abs(k) == 24
                else f"de {abs(k)} h {'plus tôt' if k < 0 else 'plus tard'}"
            )
            year = month[:4]
            self.add(
                "decalage-heures",
                None,
                doc=f"{year}{base}",
                series=label,
                room=room,
                day=f"{month}-01",
                at=month,
                value=float(cell[2 + best]),
                other=float(ok0),
                text=f"{month} : {cell[2 + best]} jours sur {n} retrouvent le total du jour avec les "
                f"heures décalées {what}, {ok0} sans décalage",
            )

    def hours_vs_linky(self) -> None:
        """Per month, the lag (in hours) that best lines up the hourly energy of all the Intuis rooms
        with the Linky curve summed per hour: 0 when both are stored in local time."""
        intuis: dict[str, float] = {}
        for name, doc in self.docs.items():
            m = YEAR_DOC.match(name)
            if m and m.group(2) == ".hourly":
                for rid, hours in (doc.get("hourly") or {}).items():
                    if self.kinds.get(rid) == "ignore":
                        continue
                    for k, v in hours.items():
                        if _num(v) is not None and valid(k, "hour"):
                            intuis[k] = intuis.get(k, 0.0) + float(v)
        meter: dict[str, float] = {}
        for name, doc in self.docs.items():
            m = YEAR_DOC.match(name)
            if m and m.group(2) == ".linky30":
                for k, v in (doc.get("curve") or {}).items():
                    if _num(v) is not None and valid(k, "minute", True):
                        meter[k[:13]] = meter.get(k[:13], 0.0) + float(v)
        if not intuis or not meter:
            return
        recent = self._recent()
        months = sorted({k[:7] for k in intuis if k[:10] < recent})
        for month in months:
            # an hourly timeline of the month and its neighbours (local keys, in order)
            first = date.fromisoformat(f"{month}-01")
            after = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
            d = first - timedelta(days=1)
            keys: list[str] = []
            while d <= after:
                keys += day_slots(d.isoformat(), 60, self.tz)
                d += timedelta(days=1)
            idx = [i for i, k in enumerate(keys) if k[:7] == month and k in intuis and k[:10] < recent]
            if len(idx) < MIN_DAYS * 24:
                continue
            corr: dict[int, float] = {}
            for lag in (-2, -1, 0, 1, 2):
                pairs = [
                    (intuis[keys[i]], meter[keys[i + lag]])
                    for i in idx
                    if 0 <= i + lag < len(keys) and keys[i + lag] in meter
                ]
                if len(pairs) >= MIN_DAYS * 24:
                    corr[lag] = _pearson(pairs)
            if 0 not in corr:
                continue
            lag = max(corr, key=lambda k: corr[k])
            if lag == 0 or corr[lag] - corr[0] < CORR_GAIN:
                continue
            self.add(
                "decalage-fuseau",
                None,
                doc=f"{month[:4]}.hourly",
                series=SERIES_LABEL[(".hourly", "hourly")],
                day=f"{month}-01",
                at=month,
                value=round(corr[lag], 2),
                other=round(corr[0], 2),
                text=f"{month} : les heures d'Intuis suivent le Linky {abs(lag)} h "
                f"{'plus tôt' if lag > 0 else 'plus tard'} "
                f"(corrélation {corr[lag]:.2f} décalée, {corr[0]:.2f} sans décalage)",
            )

    def linky_lag(self) -> None:
        if self.real is None or not self.real.linky:
            return
        linky = {d: float(v) for d, v in self.real.linky.items() if _num(v) is not None and v >= 0}
        intuis = self.real.real_wh

        def above(d: str, k: int) -> bool | None:
            other = (date.fromisoformat(d) + timedelta(days=k)).isoformat()
            if other not in linky:
                return None
            return above_meter(intuis[d], linky[other])

        months: dict[str, list[int]] = {}  # month -> [above at 0, at -1, at +1, days compared at ±1]
        for d in sorted(intuis):
            if not valid(d, "day") or d not in linky:
                continue
            a0, am, ap = above(d, 0), above(d, -1), above(d, 1)
            cell = months.setdefault(d[:7], [0, 0, 0, 0])
            cell[0] += bool(a0)
            if am is not None and ap is not None:
                cell[1] += am
                cell[2] += ap
                cell[3] += 1
        for month, (a0, am, ap, n) in sorted(months.items()):
            if a0 < LINKY_MIN or n < MIN_DAYS:
                continue
            best, k = (am, -1) if am <= ap else (ap, 1)
            if 4 * best > a0:
                continue
            self.add(
                "decalage-jour-linky",
                None,
                doc="linky",
                series=SERIES_LABEL[("linky", "daily")],
                day=f"{month}-01",
                at=month,
                value=float(a0),
                other=float(best),
                text=f"{month} : Intuis dépasse le Linky {a0} jours, {best} seulement si le Linky est "
                f"pris {'la veille' if k < 0 else 'le lendemain'}",
            )

    def two_sources(self) -> None:
        daily = self._year_section("daily")
        rooms = {
            rid: {d: float(v) for d, v in days.items() if _num(v) is not None}
            for rid, days in daily.items()
            if self.kinds.get(rid) != "ignore"
        }
        others: list[tuple[str, str, str, dict[str, float]]] = []
        shelly, ha = self.docs.get("shelly", {}), self.docs.get("ha", {})
        for key, days in (shelly.get("daily") or {}).items():
            name = _name(shelly.get("plugs"), key, "la prise")
            others.append(("shelly", name, key, {d: float(v) for d, v in days.items() if _num(v) is not None}))
        for key, days in (ha.get("daily") or {}).items():
            kwh = {
                d: 1000 * float(v["kwh"])
                for d, v in days.items()
                if isinstance(v, dict) and _num(v.get("kwh")) is not None
            }
            if kwh:
                others.append(("ha", _name(ha.get("sensors"), key, "le capteur"), key, kwh))
        for doc, name, _key, values in others:
            for rid, own in rooms.items():
                both = [d for d in values if d in own and values[d] >= MONTH_GAP_WH and own[d] >= MONTH_GAP_WH]
                if len(both) < SOURCES_MIN:
                    continue
                same = sum(1 for d in both if abs(values[d] - own[d]) <= tolerance(own[d]))
                if same < SHIFT_SHARE * len(both):
                    continue
                first = min(both)
                self.add(
                    "deux-sources",
                    None,
                    doc=doc,
                    series=SERIES_LABEL[(doc, "daily")],
                    room=rid,
                    day=first,
                    at=f"{first}…{max(both)}",
                    value=float(same),
                    other=float(len(both)),
                    text=f"{name} donne {same} jours sur {len(both)} la même énergie que cette pièce Intuis",
                )

    # ------------------------------------------------------- outputs
    def counts(self) -> dict[str, dict[str, int]]:
        """{code: {"YYYY-MM" | "?": findings}} — the only thing the public log shows."""
        out: dict[str, dict[str, int]] = {c: {} for c in CHECKS}
        for f in self.findings:
            m = f.day[:7] if f.day else "?"
            out[f.code][m] = out[f.code].get(m, 0) + 1
        return out


FORM_LABEL = {"month": "AAAA-MM", "day": "AAAA-MM-JJ", "hour": "AAAA-MM-JJTHH", "minute": "AAAA-MM-JJTHH:MM"}


def _num(v: object) -> float | None:
    if isinstance(v, bool) or not isinstance(v, int | float) or not math.isfinite(v):
        return None
    return float(v)


def _pearson(pairs: list[tuple[float, float]]) -> float:
    n = len(pairs)
    mx = sum(x for x, _ in pairs) / n
    my = sum(y for _, y in pairs) / n
    sxy = sum((x - mx) * (y - my) for x, y in pairs)
    sxx = sum((x - mx) ** 2 for x, _ in pairs)
    syy = sum((y - my) ** 2 for _, y in pairs)
    return sxy / math.sqrt(sxx * syy) if sxx and syy else 0.0


def _name(entries: object, key: str, fallback: str) -> str:
    """« la prise « Frigo » » from the plugs (sensors) of the document itself (private report)."""
    entry = entries.get(key) if isinstance(entries, dict) else None
    name = entry.get("name") if isinstance(entry, dict) else None
    return f"{fallback} « {name} »" if isinstance(name, str) and name else f"{fallback} {key}"


def _slot(cell: object, i: int) -> float | None:
    """Half hour `i` of a compacted room30 column (null, one number, or a list of 48)."""
    if isinstance(cell, list):
        return _num(cell[i]) if i < len(cell) else None
    return _num(cell)


def audit(store: Store) -> Audit:
    errors: list[str] = []
    a = Audit.of(store, read_docs(store.dir, store.passphrase, errors))
    a.errors += errors
    return a.run()


def public_lines(a: Audit) -> list[str]:
    """Counts per check and per month: safe for a public log (no value, name, id, day)."""
    out = [
        "",
        "Audit des données (#532) : nombre de cas par contrôle et par mois, aucune valeur, aucun nom, aucun jour.",
        f"Fichiers lus : {len(a.docs)} ; séries datées : {len(a.series())}.",
    ]
    for code, months in a.counts().items():
        c = CHECKS[code]
        total = sum(months.values())
        detail = ", ".join(f"{'sans date' if m == '?' else m} {n}" for m, n in sorted(months.items()))
        out.append(f"  {c.title} [{code}] : {total}" + (f" ({detail})" if detail else ""))
    for e in a.errors:
        out.append(f"  Non vérifié : {e}.")
    out.append("Seuils (hypothèse = à confirmer sur ce premier bilan) :")
    for name, t in THRESHOLDS.items():
        out.append(f"  {name} = {_fmt(t.value)} {t.unit}" + (" (hypothèse)" if t.hypothesis else ""))
    return out


def _fmt(v: float) -> str:
    return str(int(v)) if v == int(v) else str(v)


def private_doc(a: Audit, made: str) -> dict:
    """The detail for the owner, to encrypt: every count, and up to MAX_SHOWN cases per check."""
    counts = a.counts()
    shown: dict[str, int] = {}
    findings = []
    for f in sorted(a.findings, key=lambda f: (f.code, f.day or "", f.doc, f.at or "")):
        if shown.get(f.code, 0) >= MAX_SHOWN:
            continue
        shown[f.code] = shown.get(f.code, 0) + 1
        findings.append({k: v for k, v in asdict(f).items() if v is not None})
    return {
        "kind": REPORT_KIND,
        "v": REPORT_VERSION,
        "made": made,
        "last": a.last,
        "timezone": a.tz.key,
        "checks": [
            {
                "code": code,
                **asdict(c),
                "count": sum(counts[code].values()),
                "months": counts[code],
                "shown": shown.get(code, 0),
            }
            for code, c in CHECKS.items()
        ],
        "thresholds": [{"name": n, **asdict(t)} for n, t in THRESHOLDS.items()],
        "findings": findings,
        "errors": list(a.errors),
    }


def write_report(a: Audit, store: Store, out_dir: Path, made: str | None = None) -> Path:
    """The detail, encrypted with the data key (same salt and derivation as keyinfo.json)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = private_doc(a, made or datetime.now(a.tz).date().isoformat())
    path = out_dir / REPORT_NAME
    path.write_text(json.dumps(encrypt_json(doc, store.passphrase, store.salt, store.kdf)) + "\n")
    return path
