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

The values checks:
- `somme-jour`: the complete hours (half hours) of a day that do not add up to the day total
  (Intuis hours and 30 min against the Intuis day, Linky curve against the Linky day), outside the
  months already found shifted;
- `pieces-sur-linky`: a day where the Intuis rooms exceed the whole-home meter (the rule of the
  quality report, quality.py `above_meter`);
- `valeur-impossible`: an energy that cannot be (negative, not a number, a room above SUSPECT_WH a
  day: the « suspect » days of the quality report);
- `unite`: a run of days a thousand times smaller than their neighbours (kWh stored as Wh), or a
  day a thousand times larger;
- `valeur-figee`: the same non-zero reading several days in a row (frozen sensor or reading), standby
  energy and temperatures whose half hours move left out (#550);
- `pic-impossible`: an hour or a half hour whose energy needs more power than the meter's maximum
  that day (Linky pmax), or than the largest residential connection (36 kVA) without it;
- `compteur-recule`: a Linky index lower than the day before.
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
from .quality import CROSS_MARGIN_WH, CROSS_RATIO, SUSPECT_WH, Report, above_meter
from .storage import Store, own_year_first
from .sync import HOURLY_DAYS_SYNC, MONTH_GAP_SHARE, MONTH_GAP_WH

# A factor 1 000 (Wh / kWh) less a factor 3 of ordinary day-to-day variation (THRESHOLDS facteur_unite).
UNIT_RATIO = 300
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
    "somme-jour": Check(
        "valeurs",
        "Heures qui ne font pas le jour",
        "les heures (ou demi-heures) complètes du jour ne retrouvent pas le total du jour, au-delà de la tolérance",
        "le total du jour fait foi ; la courbe heure par heure de ce jour ne le retrouve pas",
    ),
    "pieces-sur-linky": Check(
        "valeurs",
        "Radiateurs au-dessus du compteur",
        "les relevés Intuis du jour dépassent ce que le compteur Linky a compté pour toute la maison",
        "le jour est compté tel quel ; le bilan le compte « Intuis > Linky »",
    ),
    "valeur-impossible": Check(
        "valeurs",
        "Énergie impossible",
        "une énergie négative, qui n'est pas un nombre, ou une pièce au-delà de ce qu'elle peut consommer en un jour",
        "le jour est compté et marqué « suspect » dans le bilan",
    ),
    "unite": Check(
        "valeurs",
        "Énergie mille fois trop petite ou trop grande",
        "des jours mille fois plus petits ou plus grands que les jours voisins : kWh rangés comme des Wh, ou l'inverse "
        "(ou un appareil éteint une semaine et plus)",
        "la valeur est comptée telle quelle : elle fausse le total",
        "a-verifier",
    ),
    "valeur-figee": Check(
        "valeurs",
        "Valeur figée",
        "la même valeur non nulle revient plusieurs jours de suite : capteur ou relevé figé ?",
        "les jours sont comptés tels quels",
        "a-verifier",
    ),
    "pic-impossible": Check(
        "valeurs",
        "Pic impossible pour la puissance",
        "l'énergie d'une heure ou d'une demi-heure demande plus de puissance que le maximum du compteur ce jour-là "
        "(ou que le plus gros abonnement d'une maison, sans relevé du maximum)",
        "la valeur est comptée telle quelle",
    ),
    "compteur-recule": Check(
        "valeurs",
        "Index du compteur qui recule",
        "l'index du compteur Linky d'un jour est plus bas que celui de la veille",
        "la consommation déduite des index devient négative ce jour-là",
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
    "facteur_unite": Threshold(
        UNIT_RATIO,
        "×",
        "écart aux jours voisins (médiane de 15 jours de part et d'autre) qui dit une erreur d'unité : un facteur "
        "1 000 (Wh / kWh) moins la variation ordinaire d'un jour à l'autre",
        True,
    ),
    "jours_unite": Threshold(
        7,
        "jours",
        "jours de suite mille fois trop petits avant de parler d'unité : un appareil éteint quelques jours "
        "(veille de 1 à 3 Wh) donne le même rapport ; une erreur d'unité dure",
        True,
    ),
    "jours_figes": Threshold(
        5,
        "jours",
        "jours de suite à la même valeur non nulle avant de parler de valeur figée",
        True,
    ),
    "puissance_max": Threshold(
        36,
        "kVA",
        "le plus gros raccordement d'une maison au tarif bleu ; plafond quand le Linky ne donne pas le maximum du jour "
        "(une moyenne sur une heure ne peut pas dépasser le maximum atteint)",
        False,
    ),
    "suspect_jour": Threshold(
        SUSPECT_WH / 1000,
        "kWh",
        "énergie d'une pièce en un jour au-delà de laquelle elle est impossible (3,3 kW pendant 24 h ; "
        "bilan qualité, quality.py)",
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
UNIT_RUN = int(THRESHOLDS["jours_unite"].value)
FROZEN_DAYS = int(THRESHOLDS["jours_figes"].value)
MAX_KVA = THRESHOLDS["puissance_max"].value
SHIFT_SHARE = THRESHOLDS["part_decalee"].value / 100
CORR_GAIN = THRESHOLDS["gain_correlation"].value
LINKY_MIN = int(THRESHOLDS["jours_linky_min"].value)
SOURCES_MIN = int(THRESHOLDS["jours_sources_min"].value)
# Cap of the detail kept per check (the counts stay complete): the report fits the device's storage.
MAX_SHOWN = 200
TWICE_TEXT = "la somme des heures vaut deux fois le jour : deux familles de mesure additionnées ?"


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
    unit: str | None = None  # #550: of value and other (Wh, °C, kVA, W, jours); None: no unit (a correlation)
    other_unit: str | None = None  # of other, when it is not `unit` (valeur-figee: a number of days)


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
# #550: the unit of the values of a series, said with each value of the report. Series of several
# measures (station, Home Assistant, volets, état des pièces) or of lists have none.
SERIES_UNIT: dict[tuple[str, str], str] = {
    ("", "daily"): "Wh",
    ("", "tariffs"): "Wh",
    ("", "temps"): "°C",
    (".hourly", "hourly"): "Wh",
    (".room30", "rooms"): "Wh",
    (".linky30", "curve"): "Wh",
    ("linky", "daily"): "Wh",
    ("linky", "pmax"): "kVA",
    ("linky", "index"): "Wh",
    ("weather", "outdoor"): "°C",
    ("shelly", "daily"): "Wh",
}
UNIT_OF_LABEL = {SERIES_LABEL[k]: u for k, u in SERIES_UNIT.items()}
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
    _fine_cache: list | None = field(default=None, repr=False)

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
        if "unit" not in kw:  # #550: the unit of the series, unless the check says another
            kw["unit"] = self.unit_of(label)
        if kw.get("value") is None and kw.get("other") is None:  # nothing to say a unit of
            kw.pop("unit", None)
            kw.pop("other_unit", None)
        self.findings.append(Finding(code, doc, label, room=room, **kw))  # type: ignore[arg-type]

    def unit_of(self, label: str) -> str | None:
        """Unit of the values of a series, by its label (the Linky maximum may be stored in VA)."""
        if label == SERIES_LABEL[("linky", "pmax")]:
            return str(self.docs.get("linky", {}).get("pmax_unit") or "kVA")
        return UNIT_OF_LABEL.get(label)

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
            ("heures et jour", self.day_sums),
            ("Intuis et Linky", self.above_linky),
            ("énergies impossibles", self.impossible),
            ("unités", self.units),
            ("valeurs figées", self.frozen),
            ("pics", self.peaks),
            ("index", self.index_back),
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
        """Day -> Wh of the measured hours (Intuis hourly, else 30 min) of a room, when not zero."""
        out: dict[str, float] = {}
        for base, _label, room, fine, _minutes, _daily in self._fine():
            if room != rid or base not in (".hourly", ".room30"):
                continue
            per_day: dict[str, float] = {}
            for k, v in fine.items():
                per_day[k[:10]] = per_day.get(k[:10], 0.0) + v
            for d, total in per_day.items():
                if total and d not in out:
                    out[d] = total
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
        for base, label, room, fine, minutes, daily in self._fine():
            self._shift_fit(fine, daily, minutes, base, label, room)

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
                unit="jours",
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
                unit=None,  # a correlation
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
                unit="jours",
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
                    unit="jours",
                    text=f"{name} donne {same} jours sur {len(both)} la même énergie que cette pièce Intuis",
                )

    # ------------------------------------------------------- values
    def day_sums(self) -> None:
        """Complete days whose hours (half hours) do not add up to the day, outside shifted months."""
        shifted = {(f.doc[4:], f.room, f.at) for f in self.findings if f.code == "decalage-heures"}
        recent = self._recent()
        for base, label, room, fine, minutes, daily in self._fine():
            per_day: dict[str, float] = {}
            for day in sorted({k[:10] for k in fine if valid(k[:10], "day")}):
                slots = day_slots(day, minutes, self.tz)
                if all(k in fine for k in slots):
                    per_day[day] = sum(fine[k] for k in slots)
            for day, total in per_day.items():
                v = daily.get(day)
                if v is None or day >= recent or (base, room, day[:7]) in shifted:
                    continue
                if abs(total - v) <= tolerance(v):
                    continue
                twice = v > MONTH_GAP_WH and abs(total - 2 * v) <= tolerance(2 * v)
                self.add(
                    "somme-jour",
                    None,
                    doc=f"{day[:4]}{base}",
                    series=label,
                    room=room,
                    day=day,
                    at=day,
                    value=round(total, 1),
                    other=round(v, 1),
                    text=TWICE_TEXT if twice else "la somme des heures complètes du jour s'écarte du total du jour",
                )

    def above_linky(self) -> None:
        """Days where Intuis exceeds the whole-home meter (quality.py above_meter, the same rule)."""
        if self.real is None:
            return
        for day, v in sorted(self.real.linky.items()):
            intuis = self.real.real_wh.get(day)
            if intuis is None or _num(v) is None or v < 0 or not above_meter(intuis, float(v)):
                continue
            self.add(
                "pieces-sur-linky",
                None,
                doc="linky",
                series=SERIES_LABEL[("linky", "daily")],
                day=day,
                at=day,
                value=round(intuis, 1),
                other=float(v),
                text="les radiateurs et le chauffe-eau (Intuis) dépassent le compteur de toute la maison",
            )

    def impossible(self) -> None:
        """Energies that cannot be: negative, not a number, a room above SUSPECT_WH in a day."""
        for name, doc in sorted(self.docs.items()):
            m = YEAR_DOC.match(name)
            sections: list[tuple[str, float | None]] = []
            if m and not m.group(2):
                sections = [("daily", SUSPECT_WH)]
            elif m and m.group(2) in (".hourly", ".linky30"):
                sections = [("hourly" if m.group(2) == ".hourly" else "curve", None)]
            elif name in ("linky", "shelly"):
                sections = [("daily", None)]
            for section, cap in sections:
                for s in series_of(name, {section: doc.get(section) or {}}):
                    for k, v in s.data.items():
                        if not isinstance(k, str) or not valid(k[:10], "day"):
                            continue
                        x = _num(v) if not isinstance(v, str) else None
                        if x is not None and x >= 0 and (cap is None or x <= cap):
                            continue
                        if v is None:
                            continue
                        why = (
                            "pas un nombre"
                            if x is None
                            else "énergie négative"
                            if x < 0
                            else f"plus de {_fmt(cap / 1000)} kWh en un jour pour une pièce"  # type: ignore[operator]
                        )
                        self.add("valeur-impossible", s, day=k[:10], at=k, value=x, text=why)

    def units(self) -> None:
        """Runs of days a thousand times below their neighbours, or a day a thousand times above."""
        for label, room, values, doc in self._energy_days():
            days = sorted(d for d in values if valid(d, "day"))
            small: list[str] = []
            med: dict[str, float] = {}

            def close(run: list[str], doc=doc, label=label, room=room, values=values, med=med) -> None:
                if len(run) >= UNIT_RUN:
                    for d in run:
                        self.add(
                            "unite",
                            None,
                            doc=doc(d),
                            series=label,
                            room=room,
                            day=d,
                            at=d,
                            value=values[d],
                            other=round(med[d], 1),
                            text="mille fois plus petit que les jours voisins : kWh rangés comme des Wh, "
                            "ou appareil éteint ?",
                        )

            for i, d in enumerate(days):
                near = [values[x] for x in days[max(0, i - 15) : i + 16] if x != d and values[x] > 0]
                m = _median(near)
                med[d] = m or 0.0
                v = values[d]
                if m and m >= MONTH_GAP_WH and 0 < v < m / UNIT_RATIO:
                    if small and (date.fromisoformat(d) - date.fromisoformat(small[-1])).days == 1:
                        small.append(d)
                    else:
                        close(small)
                        small = [d]
                    continue
                if m and m >= MONTH_GAP_WH and v > m * UNIT_RATIO:  # a plug nearly off, then used: not a unit
                    self.add(
                        "unite",
                        None,
                        doc=doc(d),
                        series=label,
                        room=room,
                        day=d,
                        at=d,
                        value=v,
                        other=round(m, 1),
                        text="mille fois plus grand que les jours voisins : Wh comptés comme des kWh ?",
                    )
            close(small)

    def frozen(self) -> None:
        """The same non-zero reading FROZEN_DAYS days in a row (estimated days excluded: equal by design).

        #550 (revue v2.2): two readings that are not frozen are left out, without a new threshold.
        A daily energy under the absolute gap (`ecart_absolu`, the bound under which `unite` already
        calls a device nearly off) is a device in standby, steady by nature. A room temperature
        whose half hours move within one of the days is a live sensor: a stable room rounded to the
        tenth gives equal days by chance; a frozen sensor is frozen within the day too. Without half
        hours on those days (before they were collected), the days are compared as before."""
        flags = self._year_section("estimated")
        plug_flags = self.docs.get("shelly", {}).get("estimated") or {}
        moving_temps = self._moving_temperatures()
        never: Callable[[str], bool] = lambda _d: False  # noqa: E731
        Candidate = tuple[
            str, str | None, dict[str, object], set[str], Callable[[str], str], bool, Callable[[str], bool]
        ]
        candidates: list[Candidate] = []
        for rid, days in self._year_section("daily").items():
            candidates.append(
                (SERIES_LABEL[("", "daily")], rid, days, set(flags.get(rid, {})), lambda d: d[:4], True, never)
            )
        for rid, days in self._year_section("temps").items():
            moving = moving_temps.get(rid, set())
            candidates.append(
                (SERIES_LABEL[("", "temps")], rid, days, set(), lambda d: d[:4], False, moving.__contains__)
            )
        linky = self.docs.get("linky", {})
        for section in ("daily", "pmax"):
            candidates.append(
                (
                    SERIES_LABEL[("linky", section)],
                    None,
                    linky.get(section) or {},
                    set(),
                    lambda _d: "linky",
                    section == "daily",
                    never,
                )
            )
        for key, days in (self.docs.get("station", {}).get("daily") or {}).items():
            candidates.append(
                (SERIES_LABEL[("station", "daily")], key, days, set(), lambda _d: "station", False, never)
            )
        weather = self.docs.get("weather", {})
        candidates.append(
            (
                SERIES_LABEL[("weather", "outdoor")],
                None,
                weather.get("outdoor") or {},
                set(),
                lambda _d: "weather",
                False,
                never,
            )
        )
        for key, days in (self.docs.get("shelly", {}).get("daily") or {}).items():
            candidates.append(
                (
                    SERIES_LABEL[("shelly", "daily")],
                    key,
                    days,
                    set(plug_flags.get(key, {})),
                    lambda _d: "shelly",
                    True,
                    never,
                )
            )
        for label, room, values, skip, doc, energy, moving in candidates:
            run: list[str] = []

            def close(run: list[str], doc=doc, label=label, room=room, values=values, moving=moving) -> None:
                if len(run) >= FROZEN_DAYS and not any(moving(d) for d in run):
                    value = _num(values[run[0]])
                    self.add(
                        "valeur-figee",
                        None,
                        doc=doc(run[0]),
                        series=label,
                        room=room,
                        day=run[0],
                        at=f"{run[0]}…{run[-1]}",
                        value=value,
                        other=float(len(run)),
                        other_unit="jours",
                        **({} if value is not None else {"unit": None}),
                        text=f"la même valeur {len(run)} jours de suite, du {run[0]} au {run[-1]}",
                    )

            for d in sorted(k for k in values if isinstance(k, str) and valid(k, "day")):
                v = values[d]
                live = d not in skip and v is not None and _nonzero(v)
                if live and energy and (_num(v) or 0) < MONTH_GAP_WH:
                    live = False  # standby: steady by nature
                if (
                    live
                    and run
                    and values[run[-1]] == v
                    and (date.fromisoformat(d) - date.fromisoformat(run[-1])).days == 1
                ):
                    run.append(d)
                    continue
                close(run)
                run = [d] if live else []
            close(run)

    def _moving_temperatures(self) -> dict[str, set[str]]:
        """{room: days whose measured temperature takes two values or more over the half hours}."""
        out: dict[str, set[str]] = {}
        for name, doc in self.docs.items():
            m = YEAR_DOC.match(name)
            if not m or m.group(2) != ".room30":
                continue
            for rid, days in (doc.get("rooms") or {}).items():
                if not isinstance(days, dict):
                    continue
                for day, cols in days.items():
                    if isinstance(cols, list) and len(cols) > 2:
                        seen = {x for i in range(48) if (x := _slot(cols[2], i)) is not None}
                        if len(seen) > 1:
                            out.setdefault(str(rid), set()).add(str(day))
        return out

    def peaks(self) -> None:
        """An hour (half hour) whose energy needs more power than the day's maximum (Linky pmax),
        or than the largest home connection (MAX_KVA) when the maximum is unknown."""
        pmax = {d: float(v) for d, v in (self.docs.get("linky", {}).get("pmax") or {}).items() if _num(v)}
        unit = str(self.docs.get("linky", {}).get("pmax_unit") or "kVA")
        scale = 1.0 if unit == "VA" else 1000.0
        for base, label, room, fine, minutes, _daily in self._fine():
            per_hour = 60 / minutes
            for k, wh in fine.items():
                day = k[:10]
                watts = wh * per_hour
                limit = pmax[day] * scale if day in pmax else MAX_KVA * 1000
                # 1 %: the curve is rounded to 0.1 Wh, the maximum to the VA
                if watts <= limit * 1.01:
                    continue
                self.add(
                    "pic-impossible",
                    None,
                    doc=f"{day[:4]}{base}",
                    series=label,
                    room=room,
                    day=day,
                    at=k,
                    value=round(watts),
                    other=round(limit),
                    unit="W",
                    text=f"{round(watts)} W en moyenne sur {minutes} min, au-delà du maximum "
                    + ("relevé par le Linky ce jour-là" if day in pmax else f"d'une maison ({_fmt(MAX_KVA)} kVA)"),
                )

    def index_back(self) -> None:
        for series, days in (self.docs.get("linky", {}).get("index") or {}).items():
            if not isinstance(days, dict):
                continue
            prev: tuple[str, float] | None = None
            for d in sorted(k for k in days if isinstance(k, str) and valid(k, "day")):
                v = _num(days[d])
                if v is None:
                    continue
                if prev and v < prev[1] - 1:
                    self.add(
                        "compteur-recule",
                        None,
                        doc="linky",
                        series=SERIES_LABEL[("linky", "index")],
                        room=series,
                        day=d,
                        at=d,
                        value=v,
                        other=prev[1],
                        text=f"index plus bas que celui du {prev[0]}",
                    )
                prev = (d, v)

    # ------------------------------------------------------- series shared by the checks
    def _fine(self) -> list[tuple[str, str, str | None, dict[str, float], int, dict[str, float]]]:
        """(base, label, room, fine values by local key, minutes, real day values) for each fine
        series compared with its day: Intuis hours and 30 min per room, the Linky curve. Built once."""
        if self._fine_cache is None:
            self._fine_cache = self._build_fine()
        return self._fine_cache

    def _build_fine(self) -> list[tuple[str, str, str | None, dict[str, float], int, dict[str, float]]]:
        daily = self._year_section("daily")
        flags = self._year_section("estimated")

        def real(rid: str) -> dict[str, float]:
            return {
                d: float(v)
                for d, v in daily.get(rid, {}).items()
                if _num(v) is not None and d not in flags.get(rid, {})
            }

        hourly: dict[str, dict[str, float]] = {}
        r30: dict[str, dict[str, float]] = {}
        curve: dict[str, float] = {}
        for name, doc in self.docs.items():
            m = YEAR_DOC.match(name)
            kind = m.group(2) if m else None
            if kind == ".hourly":
                for rid, hours in (doc.get("hourly") or {}).items():
                    hourly.setdefault(rid, {}).update({k: float(v) for k, v in hours.items() if _num(v) is not None})
            elif kind == ".room30":
                for rid, days in (doc.get("rooms") or {}).items():
                    for day, cols in (days or {}).items():
                        if not isinstance(cols, list) or not valid(day, "day"):
                            continue
                        for i in range(48):
                            hp = _slot(cols[0] if cols else None, i)
                            hc = _slot(cols[1] if len(cols) > 1 else None, i)
                            if hp is not None or hc is not None:
                                r30.setdefault(rid, {})[f"{day}T{i // 2:02d}:{30 * (i % 2):02d}"] = (hp or 0) + (
                                    hc or 0
                                )
            elif kind == ".linky30":
                curve.update({k: float(v) for k, v in (doc.get("curve") or {}).items() if _num(v) is not None})
        out = [(".hourly", SERIES_LABEL[(".hourly", "hourly")], rid, f, 60, real(rid)) for rid, f in hourly.items()]
        out += [(".room30", SERIES_LABEL[(".room30", "rooms")], rid, f, 30, real(rid)) for rid, f in r30.items()]
        linky = {d: float(v) for d, v in (self.docs.get("linky", {}).get("daily") or {}).items() if _num(v) is not None}
        if curve:
            out.append((".linky30", SERIES_LABEL[(".linky30", "curve")], None, curve, 30, linky))
        return out

    def _energy_days(self) -> list[tuple[str, str | None, dict[str, float], Callable[[str], str]]]:
        """Daily energy series (Wh): Intuis rooms (real days), Linky, plugs."""
        flags = self._year_section("estimated")
        out: list[tuple[str, str | None, dict[str, float], Callable[[str], str]]] = []
        for rid, days in self._year_section("daily").items():
            vals = {d: float(v) for d, v in days.items() if _num(v) is not None and d not in flags.get(rid, {})}
            out.append((SERIES_LABEL[("", "daily")], rid, vals, lambda d: d[:4]))
        linky = {d: float(v) for d, v in (self.docs.get("linky", {}).get("daily") or {}).items() if _num(v) is not None}
        out.append((SERIES_LABEL[("linky", "daily")], None, linky, lambda _d: "linky"))
        for key, days in (self.docs.get("shelly", {}).get("daily") or {}).items():
            vals = {d: float(v) for d, v in days.items() if _num(v) is not None}
            out.append((SERIES_LABEL[("shelly", "daily")], key, vals, lambda _d: "shelly"))
        return out

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


def _median(v: list[float]) -> float | None:
    if not v:
        return None
    s = sorted(v)
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def _nonzero(v: object) -> bool:
    """A reading worth comparing: a non-zero number, or a list with a non-zero number."""
    if isinstance(v, list):
        return any(_num(x) for x in v)
    return bool(_num(v))


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
        out += _series_lines(a, code)
    for e in a.errors:
        out.append(f"  Non vérifié : {e}.")
    out.append("Seuils (hypothèse = à confirmer sur ce premier bilan) :")
    for name, t in THRESHOLDS.items():
        out.append(f"  {name} = {_fmt(t.value)} {t.unit}" + (" (hypothèse)" if t.hypothesis else ""))
    return out


KNOWN_LABELS = frozenset(SERIES_LABEL.values())


def _series_lines(a: Audit, code: str) -> list[str]:
    """#568: which kind of series carries the cases of a check, per month, and for `somme-jour`
    whether the hours are above or below their day. Labels are the fixed ones of SERIES_LABEL (a
    series known by its file only is « autre série »): never a room, a module or a value."""
    found = [f for f in a.findings if f.code == code]
    by: dict[str, dict[str, int]] = {}
    for f in found:
        label = f.series if f.series in KNOWN_LABELS else "autre série"
        m = f.day[:7] if f.day else "?"
        by.setdefault(label, {})[m] = by.setdefault(label, {}).get(m, 0) + 1
    out: list[str] = []
    for label, months in sorted(by.items()):
        detail = ", ".join(f"{'sans date' if m == '?' else m} {n}" for m, n in sorted(months.items()))
        out.append(f"      dont {label} : {sum(months.values())} ({detail})")
    if code == "somme-jour" and found:
        above = sum(1 for f in found if (f.value or 0) > (f.other or 0))
        twice = sum(1 for f in found if f.text == TWICE_TEXT)
        out.append(
            f"      heures au-dessus du jour : {above}, dont deux fois le jour : {twice} ; "
            f"au-dessous : {len(found) - above}"
        )
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
