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
| `POST /syncapi/v1/homestatus` | État courant (températures, consignes). Pas encore utilisé pour l'historique ; `diagnose` en liste les noms de champs (voir « Fenêtre ouverte ») |

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

Rien n'est enregistré pour l'instant. Si le champ existe, l'étape suivante serait un instantané
nocturne (l'API ne donne pas d'historique) ; sinon, le noter ici.

| Vérification | Résultat |
|---|---|
| Champs `rooms` de `homestatus` | à compléter après un diagnostic réel |
| Champs `modules` de `homestatus` | à compléter après un diagnostic réel |
| `open_window` présent ? | à vérifier |

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
| Shelly Cloud | `interface/device/list`, `device/all_status` | `isok` (et `data`, `errors` s'ils sont là) |
| Shelly Cloud | `v2/devices/api/get` | liste de `{id, online?, status?, settings?}` |
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
| Shelly Cloud | 30 | `MAX_CALLS_SHELLY` |

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

## Prises Shelly (Shelly Cloud Control API, S-1.17)

Source facultative (`collector/shelly.py`). Secrets : `SHELLY_AUTH_KEY` (clé) et `SHELLY_SERVER`
(« server uri »), tous deux affichés dans l'application Shelly → *Paramètres utilisateur* →
*Clé d'autorisation cloud*. La clé change si le mot de passe Shelly change. Le collecteur
n'envoie la clé qu'à un hôte `*.shelly.cloud` (vérifié, comme dans l'écran Paramètres).

Vérifié le 9 novembre 2026 sur la [documentation officielle](https://shelly-api-docs.shelly.cloud/cloud-control-api/) :

| Point d'accès | Statut | Usage |
|---|---|---|
| `POST https://<serveur>/v2/devices/api/get?auth_key=<clé>` (JSON `{"ids": [1 à 10 ids], "select": ["status", "settings"]}`) | officiel (« v2.0-beta ») | État de 10 appareils au plus : liste de `{id, type, code, gen, online (0/1), status, settings}` |
| `POST https://<serveur>/interface/device/list` (formulaire `auth_key`) | **non documenté** (utilisé par la communauté, à vérifier) | Liste des appareils : `{"isok": true, "data": {"devices": {id: {name, type, gen, …}}}}` |
| `POST https://<serveur>/device/all_status` (formulaire `auth_key`) | **non documenté** (repli) | `{"isok": true, "data": {"devices_status": {id: {…}}}}` : sert seulement à connaître les ids |

- **Débit** : 1 requête par seconde (documenté) ; le collecteur espace ses appels de 1,1 s.
  Une collecte coûte 2 appels pour 10 prises au plus (plafond `MAX_CALLS_SHELLY`, 30 par défaut).
- **Pas d'historique** dans l'API officielle : `/statistics/relay/consumption`, cité sur le forum,
  n'est pas documenté et n'est pas utilisé. Le collecteur lit donc le **compteur cumulé** :
  Gen2+ `switch:N.aenergy.total` (Wh), Gen1 `meters[].total` (**watt-minutes**, divisé par 60) ou
  `emeters[].total` (Wh). L'horloge de l'appareil (`sys.unixtime`, Gen1 `unixtime`) date le relevé.
- **Énergie par jour** : différence entre deux relevés, répartie sur les jours locaux couverts au
  prorata du temps (une collecte nocturne : chaque jour reçoit une part de deux intervalles ; exact
  pour un réfrigérateur, approché pour un lave-linge). Compteur en baisse (redémarrage, coupure) :
  seule la nouvelle valeur compte, jours marqués estimés. Intervalle de plus de 30 h (prise hors
  ligne, collecte manquée) : jours marqués estimés ; au-delà de 45 jours, l'intervalle est ignoré.
- **Prise sans compteur** (puissance instantanée seulement) : gardée avec `usable: false` et signalée
  « non exploitable sans hub » dans l'état des sources. Les appareils sans mesure (capteurs) sont ignorés.
- Erreurs : HTTP 401/403 ou `isok: false` avec une erreur de clé → jeton refusé (issue « 🔑 Jeton à
  renouveler »). Les messages ne citent ni la clé, ni un id, ni un nom ; les URL (qui portent la clé
  pour `v2`) ne sont jamais journalisées (le journal `httpx` est coupé au niveau INFO).

Document `data/shelly.enc.json` (chiffré, chargé au démarrage de l'appli, petit) :

```jsonc
{
  "plugs":     {"p0": {"id": "<id Shelly>", "name": "Réfrigérateur", "model": "SNPL-00112EU", "gen": "G2", "usable": true}},
  "last":      {"p0": {"ts": 1731130000, "total": 123456.7}},  // dernier relevé (s, Wh)
  "daily":     {"p0": {"YYYY-MM-DD": 1012.4}},                // Wh par jour local
  "estimated": {"p0": {"YYYY-MM-DD": 1}},
  "until":     {"p0": "YYYY-MM-DD"}                           // jours antérieurs complets
}
```

## Sources

- [Shelly Cloud Control API](https://shelly-api-docs.shelly.cloud/cloud-control-api/) et sa
  [communication v2](https://shelly-api-docs.shelly.cloud/cloud-control-api/communication-v2)
- [antoine-pyre/intuis-connect](https://github.com/antoine-pyre/intuis-connect) : intégration Home Assistant la plus complète (docs `02-api-reference.md`, `06-energy-consumption.md`)
- [tramsdale/muller_intuis](https://github.com/tramsdale/muller_intuis) : chauffe-eau (`NMW`), énergie chauffage / eau chaude
- [Flow Node-RED « Intuis connect »](https://flows.nodered.org/flow/3d7f77cef8a7c6aa4fc33e2dbf26f15e) : `gethomemeasure` en JSON
- [Forum Netatmo : changement de getmeasure](https://helpcenter.netatmo.com/hc/en-us/community/posts/19559698051474-API-getmeasure-change)
