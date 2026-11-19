"""The catalogue of the audit (#532, #656): what each check means and does in the app (CHECKS), and the
thresholds with their value, reason and whether each is only a hypothesis (THRESHOLDS).

Data only: no state, no call into the audit. Moved out of collector/audit.py unchanged (#656); audit.py
imports every name back, so `audit.CHECKS`, `audit.THRESHOLDS`, `audit.MIN_DAYS`… still read as before.
The report carries both lists, so the app shows them without a list of its own (AGENTS.md §5).
"""

from __future__ import annotations

from dataclasses import dataclass

from .quality import CROSS_MARGIN_WH, CROSS_RATIO, SUSPECT_WH
from .sync import HOURLY_DAYS_SYNC, MONTH_GAP_SHARE, MONTH_GAP_WH

# A factor 1 000 (Wh / kWh) less a factor 3 of ordinary day-to-day variation (THRESHOLDS facteur_unite).
UNIT_RATIO = 300


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


def tolerance(wh: float) -> float:
    """The gap allowed between two scales of the same energy (THRESHOLDS ecart_*)."""
    return max(MONTH_GAP_WH, MONTH_GAP_SHARE * abs(wh))
