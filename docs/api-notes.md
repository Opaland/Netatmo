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
| `POST /syncapi/v1/homestatus` | État courant des pièces et modules. Relevé chaque heure si le relevé horaire est activé (voir « Fenêtre ouverte ») ; `diagnose --status` en liste les noms de champs |

## Types de mesure

- `sum_energy_elec$0`, `$1`, `$2` : énergie en Wh par tarif (base / heures pleines / heures creuses ; la
  correspondance exacte de `$1`/`$2` varie selon les sources). **Le suffixe dépend du tarif saisi dans
  l'application**, et un type qui fonctionnait peut cesser de répondre après un changement de tarif.
  Le collecteur demande donc les trois en même temps et les additionne.
- `sum_energy_elec` (sans suffixe) : total, selon les comptes.
- `sum_energy_elec_heating` : **seul type qui répond pour les données les plus anciennes** (2022-2023 sur une installation réelle). `sum_energy_elec` sans suffixe couvre la période sans tarif (2024), les suffixes `$1`/`$2` la période avec tarifs (2025+). Le collecteur demande les trois familles et garde, par pièce et par jour, la plus grande valeur (jamais la somme).
- `sum_energy_elec_hot_water` existe aussi (vu dans l.application).
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

- **Chauffe-eau (module `NMW`, Aqua Manager)** : la pièce qui le contient ne renvoie **aucune**
  consommation ; il faut l'interroger **au niveau du module** (liste `home.modules` de
  `gethomemeasure`). Constaté sur une installation réelle avec `python -m collector diagnose` :
  pièce = 0 jour de données, module = données en `$1` et `$2`. Les types `sum_energy_elec_heating`
  et `sum_energy_elec_hot_water` ne renvoient rien, ni par pièce ni par module.
- Les radiateurs `NMH` en fil pilote (`muller_type` FPN) remontent bien leur consommation au niveau
  de la pièce. Les modules `NMR` ne renvoient rien.

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

## Fenêtre ouverte (`open_window`, #162)

L'API Netatmo Energy expose `open_window` par pièce dans `homestatus` pour ses thermostats. Les
radiateurs Intuitiv détectent aussi une fenêtre ouverte (chute anormale de température), mais **rien
ne dit encore que le serveur Intuis renvoie ce champ**. **À vérifier sur un vrai compte** :
lancer **Actions → Diagnostic** (ou `python -m collector diagnose --status` en local). La sortie
liste seulement les **noms** des champs des objets `rooms` et `modules` de
`/syncapi/v1/homestatus` (triés, sans doublon, identifiants uniquement), jamais les valeurs, ids ni
noms de pièces, et indique si `open_window` (ou `window_open`, `open_window_detected`) est présent.

| Vérification | Résultat |
|---|---|
| Champs `rooms` de `homestatus` | `open_window`, `presence`, `anticipating`, `boost_status`, `therm_setpoint_mode`, `therm_setpoint_temperature`, `therm_setpoint_end_time`, `therm_measured_temperature`… (diagnostic réel, v1.4) |
| Champs `modules` de `homestatus` | `radiator_state`, `presence_sensor`, `offload`, `contactor_mode`… |
| `open_window` présent ? | **oui**, en instantané seulement |

### Un historique déjà servi ? (S-13.1, #172)

`python -m collector diagnose --probe-history` (ou **Actions → Diagnostic**, case « Chercher un
historique des fenêtres / boost ») essaie une vingtaine de types de mesure candidats sur les
7 derniers jours, échelle `1hour`, avec `gethomemeasure` (toutes les pièces) et `getroommeasure`
(première pièce) : `open_window`, `sum_open_window`, `window_open`, `boost`, `sum_boost`,
`boost_status`, `sum_boost_duration`, `presence`, `sum_presence`, `therm_setpoint_mode`,
`heating_power_request`, `sum_heating_power_request`, `sum_boiler_on`, `boileron`,
`radiator_state`, `sum_radiator_state`, `offload`, `sum_offload`, `anticipating`, et `temperature`
comme témoin (il répond). Les noms viennent des champs de `homestatus` et des types de l'API
Netatmo Energy publique (`heating_power_request`, `sum_boiler_on`, `boileron`) ; aucun n'est
documenté pour Intuis. La sortie ne donne, par type et par point d'accès, que « accepté, N points »
(points non nuls) ou « refusé (HTTP 400) » : ni valeur, ni identifiant, ni texte de l'erreur
(il peut recopier la requête). Une quarantaine d'appels.

| Type | `gethomemeasure` | `getroommeasure` |
|---|---|---|
| (à compléter après le diagnostic réel) | | |

**Décision** (à noter aussi dans #162) : si un type répond avec des points, une collecte nocturne de
ce type remplace le relevé horaire ; sinon le relevé horaire ci-dessous est activé.

### Relevé horaire de `homestatus` (S-13.2 à S-13.6)

Sans historique servi par l'API, le workflow **« Relevé horaire des pièces »**
(`.github/workflows/releve-horaire.yml`, minute 23 de chaque heure) fait `python -m collector
snapshot` : jeton + **une** requête `homestatus` (l'identifiant de la maison est lu dans
`data/meta.enc.json`, donc pas de `homesdata`), soit 2 appels par heure, 48 par jour, plafonnés à
4 par relevé (`MAX_CALLS_INTUIS_HOURLY`). Il est **désactivé** tant que la variable de dépôt
`ROOM_STATE_HOURLY` ne vaut pas `true`.

- **Ce qui est gardé du relevé** : par pièce `open_window`, `boost_status`, `therm_setpoint_mode`,
  `heating_power_request` (s'il existe) ; par module `radiator_state`, `offload`, `contactor_mode`.
  Textes réduits à un identifiant court (sinon « autre »). Températures, noms, horaires de fin de
  consigne : jetés. `presence` : jamais lu sans l'option `ROOM_STATE_PRESENCE=true`.
- **Où** : le relevé est chiffré (AES-GCM, clé de `DATA_PASSPHRASE` et sel de `data/keyinfo.json`,
  comme `data/`) puis gardé **3 jours** comme artefact Actions `etat-pieces-<run>`. Aucun commit,
  permissions `contents: read`. Le cache Actions a été écarté : ses entrées sont immuables, ne se
  listent pas depuis un autre workflow et sont évincées sans préavis.
- **Agrégation** : la collecte nocturne (`actions: read`) télécharge les artefacts non expirés et
  ajoute à `roomstate.enc.json` les **jours locaux terminés** (le jour en cours attend la nuit
  suivante). Chaque heure locale n'est comptée qu'une fois (`seen`) : relire un artefact, deux
  relevés dans la même heure ou un relevé arrivé en retard ne faussent rien.
- **Prorata** : heures = relevés « oui » × heures du jour (23, 24 ou 25) ÷ relevés reçus `n`.
  La couverture (relevés reçus sur 7 jours) est dans l'état de la source `releve-horaire` et le
  résumé de la collecte ; les appels des relevés y figurent sous `intuis-horaire`.
- **Interprétation** (valeurs exactes à vérifier, gardées chiffrées dans `values` pour contrôle) :
  vrai, nombre > 0 ou texte autre que `off`, `disabled`, `idle`, `standby`, `stand_by`, `none`,
  `0`, `false`… = « oui ». Boost = `boost_status` actif ou mode `max` / `boost`. Les modes autres
  que `schedule` / `program` / `home` / `auto` vont dans `mode_h` (`away`, `hg`, `manual`, `off`).
  Chauffe = `radiator_state` actif d'un module de la pièce (ou `heating_power_request` > 0).

```jsonc
// roomstate.enc.json (chiffré, chargé à la demande par la vue Confort)
{"seen":  {"2025-01-15": 16777211},   // heures locales relevées (bit h = heure h)
 "rooms": {"<pièce>": {"2025-01-15": {"n": 22, "open_window_h": 2.2, "boost_h": 1.1,
                                      "heating_h": 7.6, "offload_h": 0.0,
                                      "mode_h": {"away": 12.0},          // hors programme
                                      "contactor_h": {"auto": 24.0},     // chauffe-eau
                                      "presence_h": 9.8}}},              // option seulement
 "values": {"radiator_state": ["heating", "idle"], "therm_setpoint_mode": ["away", "schedule"]}}
```

### Données d'occupation : analyse d'impact courte (S-13.5)

| Question | Réponse |
|---|---|
| Finalité | Expliquer la consommation et le confort (aération, boost, absences, délestage). Pas de surveillance des personnes. |
| Données | Heures par pièce et par jour de fenêtre ouverte, boost, chauffe, délestage, mode de consigne. **Présence** : non lue par défaut ; avec `ROOM_STATE_PRESENCE=true`, seulement des heures par jour. Jamais d'horodatage heure par heure dans le dépôt. |
| Durée | Relevés horaires : 3 jours (expiration des artefacts). Agrégats quotidiens : comme le reste de l'archive, jusqu'à suppression par le propriétaire. |
| Qui voit quoi | Dépôt public : fichiers chiffrés seulement ; artefacts chiffrés (téléchargeables par un compte GitHub connecté, illisibles sans la phrase de passe) ; journaux : des comptes, jamais une valeur ni un nom. Appli : les membres du foyer qui ont la phrase ; les chambres sont **regroupées** tant que personne ne demande leur détail (même geste que pour le CO₂ de la nuit). |
| IA | Rien de ces agrégats n'est envoyé à l'analyse IA pour l'instant ; s'ils l'étaient, seulement en totaux mensuels pseudonymisés (S-5.10). |
| Risque résiduel | Un agrégat « fenêtre ouverte / absence par jour » révèle des habitudes : il reste chiffré comme le reste, et l'option présence est à n'activer qu'avec l'accord du foyer. |

## Schémas de référence et changements de format (S-1.13)

`collector/schema.py` décrit, pour chaque réponse utilisée, les champs attendus et leur type :

| Source | Réponse | Champs vérifiés |
|---|---|---|
| Intuis | `/oauth2/token` | `access_token` |
| Intuis | `/api/homesdata` | `body.homes[].id`, `rooms[].id`, `modules[].id` (et `type`, `module_ids` s'ils sont là) |
| Intuis | `/api/gethomemeasure` | `body.home`, `rooms[].id`, `modules[].id`, `measures` (blocs `beg_time` + `value`, ou objet horodaté) |
| Intuis | `/api/getroommeasure` | `body` (blocs ou objet horodaté) |
| Intuis | `/syncapi/v1/homestatus` | `body.home` |
| Netatmo | `/oauth2/token` | `access_token`, `refresh_token` |
| Netatmo | `/api/getstationsdata` | `body.devices[]._id`, `modules[]._id` |
| Netatmo | `/api/getmeasure` | `body` (blocs ou objet horodaté) |
| Open-Meteo | `archive`, `forecast` | `daily.time`, `daily.temperature_2m_min/max/mean` |
| Conso API | les trois points d'accès | voir ci-dessous |

Un champ absent ou d'un autre type lève `FormatError` : « *source* : format de réponse inattendu
(*point d'accès*), champ « *chemin* » absent ». Le message ne cite **jamais une valeur** (journal
public). Une liste vide reste « pas de données », pas un changement de format.

Conso API change de forme sans prévenir (2026) et le collecteur reconnaît plusieurs noms de champs
(`d`/`date`…, `v`/`value`/`valeur`…). Le contrôle y est donc différent : si la réponse contient des
objets « à plat » portant une date (des relevés) mais qu'aucun n'est reconnu, c'est un changement de
format, et le message liste les **noms** des champs vus (ex. `champs vus : jour, wh`). Aucun relevé :
pas de données.

Conséquences : Intuis en échec arrête la collecte (issue d'alerte, résumé « Collecte interrompue ») ;
une source facultative en échec est notée dans `meta.sources.<source>.format` (point d'accès et champ)
et dans la section « Format de réponse changé » du résumé de la collecte. Limite connue : `measures`
reste facultatif dans `gethomemeasure` (une pièce sans mesure peut l'omettre) ; un renommage de ce
seul champ ressemblerait donc à « pas de données ».

## Nombre d'appels par collecte (S-1.14)

Chaque requête HTTP passe par un compteur par source (`collector/budget.py`) : nombre d'appels et
durée cumulée des appels, affichés en fin de collecte et dans le résumé du job (« Appels API »).
Plafonds par collecte, réglables par variable de dépôt (transmise par `collect.yml`) :

| Source | Plafond | Variable |
|---|---|---|
| Intuis | 300 (3 000 lors d'une récupération de l'historique) | `MAX_CALLS_INTUIS` |
| Netatmo | 400 (l'API publique autorise 500 / h) | `MAX_CALLS_NETATMO` |
| Linky (Conso API) | 200 | `MAX_CALLS_LINKY` |
| Open-Meteo | 20 | `MAX_CALLS_OPEN_METEO` |

Les nouvelles tentatives (429, 5xx) comptent. Plafond atteint : la source s'arrête proprement, ce qui
a été récupéré est enregistré, et la collecte se termine sans erreur (avertissement dans le journal).
Si c'était une récupération d'historique Intuis, `meta.backfill_pending` la relance la nuit suivante.

## Station météo Netatmo (API publique)

Indépendante d'Intuis : `api.netatmo.com`, application créée sur dev.netatmo.com, scope
`read_station`, jeton de rafraîchissement renouvelé à chaque usage (`collector/station.py`).

- `getstationsdata` : le module principal (`NAMain`, intérieur) puis ses modules radio, dans
  l'ordre renvoyé. Ils deviennent les clés `m0`, `m1`, … (`m0` = module principal). Seuls
  `NAMain` et `NAModule4` (intérieurs) mesurent le CO₂ ; `NAModule1` est l'extérieur ; `NAModule2`
  (vent) et `NAModule3` (pluie) n'ont pas de température.
- `getmeasure` : au plus **1024 points par appel**. Débit documenté : 50 requêtes / 10 s et
  500 / h par utilisateur ; le collecteur espace ses appels d'au moins 0,5 s.
  - Échelle `1day`, types `min_temp,max_temp,temperature,humidity[,co2]` : séries quotidiennes.
  - Échelle `1hour`, types `temperature,humidity,co2` (`NAMain`, `NAModule4`) ou
    `temperature,humidity` (`NAModule1`), par tranches de 40 jours (960 points). Premier passage :
    les 365 derniers jours ; ensuite depuis la dernière heure gardée, au moins les 3 derniers jours.
    L'horodatage d'un point horaire (début ou milieu de l'heure, à vérifier) est rangé dans l'heure
    locale qui le contient.

### Documents produits

Tous chiffrés comme les autres (`data/*.enc.json`). Heures et jours en **heure locale de la
maison** (`meta.home.timezone`).

`station.enc.json` (chargé au démarrage de l'appli) :

```jsonc
{
  "modules": {"m0": {"name": "Salon", "type": "NAMain", "indoor": true}, ...},
  "daily":   {"m0": {"YYYY-MM-DD": [min °C, max °C, moyenne °C, humidité %, CO₂ ppm | null]}},
  // Nuit du jour D = D 22:00 → D+1 07:00 (7 h exclue), rangée sous D. Modules intérieurs seulement.
  "nightly": {"m2": {"YYYY-MM-DD": {"n": 9,             // heures de la nuit avec un CO₂ (9 = complète)
                                    "co2_max": 1640,    // ppm, maximum horaire de la nuit
                                    "h_co2_1000": 7,    // heures > 1000 ppm
                                    "h_co2_1400": 4,    // heures > 1400 ppm (seuil du récit S-11.1)
                                    "h_co2_1500": 3}}}, // heures > 1500 ppm
  // Heures du jour D (0 h → 23 h). « cold » seulement pour les modules intérieurs.
  "hours":   {"m0": {"YYYY-MM-DD": {"n": 24,      // heures avec un relevé
                                    "humid": 2,   // heures avec humidité > 65 %
                                    "cold": 5}}}  // heures avec température < 19 °C
}
```

`YYYY.station_h.enc.json` (un par année, chargé à la demande ; années listées dans
`meta.station_hourly_years`) :

```jsonc
{"hourly": {"m0": {"YYYY-MM-DDTHH": [température °C (0,1), humidité % (entier), CO₂ ppm (entier) | null]}}}
```

Règles utiles à l'affichage :

- Les seuils sont **stricts** (`>` 1000 ppm, `>` 65 %, `<` 19 °C). Pour un autre seuil (S-11.3,
  « seuil réglable »), recalculer à partir des documents `station_h`.
- `n` dit si le jour ou la nuit est complet : la nuit en cours ou une panne donnent `n` < 9 (nuit)
  ou < 24 (jour). Une journée ou une nuit sans relevé est absente, pas à zéro.
- Changement d'heure : au printemps l'heure `02` n'existe pas (23 heures) ; à l'automne les deux
  relevés de `02` sont moyennés (24 clés au lieu de 25 heures).
- Le module extérieur a `null` en CO₂, ni `nightly` ni `cold`.
- Une cave est un module intérieur : elle a `cold` (presque toujours 24) ; c'est à l'appli de ne pas
  la compter comme pièce chauffée. Le point de rosée (S-11.2) se calcule à partir de la température
  et de l'humidité (horaires ou moyennes quotidiennes de `daily`).
- Les jours sont recalculés à chaque collecte sur la fenêtre téléchargée (plus la veille, pour la
  nuit à cheval) : une nuit incomplète le matin est complétée le lendemain.

## Sources

- [antoine-pyre/intuis-connect](https://github.com/antoine-pyre/intuis-connect) : intégration Home Assistant la plus complète (docs `02-api-reference.md`, `06-energy-consumption.md`)
- [tramsdale/muller_intuis](https://github.com/tramsdale/muller_intuis) : chauffe-eau (`NMW`), énergie chauffage / eau chaude
- [Flow Node-RED « Intuis connect »](https://flows.nodered.org/flow/3d7f77cef8a7c6aa4fc33e2dbf26f15e) : `gethomemeasure` en JSON
- [Forum Netatmo : changement de getmeasure](https://helpcenter.netatmo.com/hc/en-us/community/posts/19559698051474-API-getmeasure-change)
