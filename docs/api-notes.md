# Notes sur l'API Intuis / Muller Intuitiv

Ce que le collecteur sait de l'API, et d'où vient chaque information. **L'API n'est pas
documentée publiquement** : elle sert à l'application mobile et peut changer.

## Serveur et authentification

| Élément | Valeur |
|---|---|
| URL principale | `https://app.muller-intuitiv.net` |
| URL de secours | `https://app-prod.intuis-sas.com` (utilisée automatiquement si la première est injoignable) |
| Jeton | `POST /oauth2/token` (formulaire), `grant_type=password`, `user_prefix=muller`, `scope=read_muller write_muller` |
| Identifiants d'application | `client_id` / `client_secret` de l'application mobile, à fournir en secret (jamais dans le dépôt) |
| Durée du jeton | 1 h à 3 h selon les sources, rafraîchi automatiquement |

Le backend est exploité par Netatmo, mais il est **séparé** de l'API publique
dev.netatmo.com : les radiateurs Intuitiv n'apparaissent pas avec une application
créée sur dev.netatmo.com, ce qui explique aussi pourquoi l'intégration Netatmo
officielle de Home Assistant ne les voit pas.

## Points d'accès utilisés

| Point d'accès | Usage |
|---|---|
| `GET /api/homesdata` | Maison, pièces, modules (`NMG` = passerelle, `NMH` = radiateur, `NMW` = Aqua Manager / chauffe-eau) |
| `POST /api/gethomemeasure` (JSON) | Mesures de toutes les pièces en un appel. Corps : `home.id`, `home.rooms[] = {id, bridge, type}`, `scale`, `date_begin`, `date_end`, `app_identifier=app_muller` |
| `POST /api/getroommeasure` (formulaire) | Une pièce par appel. Repli si `gethomemeasure` renvoie des mesures vides (constaté avec certains identifiants d'application) |
| `POST /syncapi/v1/homestatus` | État courant (températures, consignes). Pas encore utilisé pour l'historique |

## Types de mesure

- `sum_energy_elec$0`, `$1`, `$2` : énergie en Wh par tarif (base / heures pleines / heures creuses ; la
  correspondance exacte de `$1`/`$2` varie selon les sources). **Le suffixe dépend du tarif saisi dans
  l'application**, et un type qui fonctionnait peut cesser de répondre après un changement de tarif.
  Le collecteur demande donc les trois en même temps et les additionne.
- `sum_energy_elec` (sans suffixe) : total, selon les comptes.
- `sum_energy_elec_heating` et `sum_energy_elec_hot_water` existent aussi (vus dans l'application).
  Le collecteur ne les utilise pas pour l'instant : le chauffe-eau est rattaché à **sa propre pièce**
  dans l'application, et c'est la pièce qui porte la catégorie.
- Échelles : `30min`, `1hour`, `3hours`, `1day`, `1week`, `1month`. Au plus **1024 points par appel**.

Au premier lancement, le collecteur essaie plusieurs combinaisons (point d'accès × type) sur les
60 derniers jours et retient la première qui renvoie des valeurs (`python -m collector -v sync`
affiche la méthode retenue).

## Format des réponses

Mesures « optimisées » : `[{"beg_time": t0, "step_time": 86400, "value": [[v1, v2, v3], ...]}]`,
une colonne par type demandé ; ou forme simple `{"<timestamp>": [v, ...]}`. Les deux sont gérées
(`collector/model.py`).

## Comportements à connaître

- **Les données arrivent en retard** (jusqu'à un jour). Chaque collecte re-télécharge les 35 derniers
  jours et remplace les valeurs.
- **La consommation est mesurée par pièce**, pas par radiateur : plusieurs radiateurs d'une même pièce
  sont additionnés par le serveur.
- Les radiateurs **fil pilote** (`muller_type` FPN) peuvent ne remonter aucune consommation.
- **Profondeur d'historique** : aucune limite documentée. Le `backfill` remonte année par année jusqu'à
  deux années vides de suite (ou 2015).
- **Débit** : aucune limite publiée par Intuis (Netatmo documente 50 requêtes / 10 s et 500 / h pour son
  API publique). Le collecteur fait au plus un appel par seconde, respecte `Retry-After` et ralentit
  sur les réponses 429. Une collecte quotidienne coûte une poignée d'appels.

## Sources

- [antoine-pyre/intuis-connect](https://github.com/antoine-pyre/intuis-connect) : intégration Home Assistant la plus complète (docs `02-api-reference.md`, `06-energy-consumption.md`)
- [tramsdale/muller_intuis](https://github.com/tramsdale/muller_intuis) : chauffe-eau (`NMW`), énergie chauffage / eau chaude
- [Flow Node-RED « Intuis connect »](https://flows.nodered.org/flow/3d7f77cef8a7c6aa4fc33e2dbf26f15e) : `gethomemeasure` en JSON
- [Forum Netatmo : changement de getmeasure](https://helpcenter.netatmo.com/hc/en-us/community/posts/19559698051474-API-getmeasure-change)
