# Audit des données (S-1.19)

> Ce que chaque appareil **peut** fournir, ce que le collecteur **garde**, ce que l'application
> **exploite**, et ce qu'il reste à ajouter. Établi le 9 novembre 2026 par lecture du code
> (`collector/`, `web/src/`) et de la documentation des API. Les cases marquées
> **« à confirmer par le diagnostic »** attendent le premier passage de l'inventaire sur le
> compte réel (§ 1 et § 5).

## 1. Méthode et inventaire automatique

L'inventaire interroge chaque source et n'affiche que des **noms** : champs, types de
mesure, codes de type de module, nombre de points, échelles acceptées, statuts HTTP et profondeur
d'historique (en jours). Jamais une valeur, un identifiant, un nom, une adresse MAC, des coordonnées
ni le PRM : le journal d'un dépôt public est public (tests : `tests/test_inventory.py`).

| Source | Ce qui est inventorié | Où le lancer |
|---|---|---|
| Intuis | champs de `homesdata` à tous les niveaux, **plannings compris** (`home.schedules[].timetable[]`, `zones[]`, `rooms_temp[]`…), champs de `homestatus` par type de module, `gethomemeasure` pour 8 types × 4 échelles (5 min, 30 min, heure, jour), profondeur par échelle (une fenêtre courte il y a 7 j … 5 ans) | workflow **Diagnostic**, case « Inventaire » (`diagnose --inventory`) |
| Station Netatmo | champs de `getstationsdata` (dont `dashboard_data`, `place`, champs de santé : batterie, radio, wifi, firmware, `reachable`, `last_seen`), `getmeasure` par module : types candidats (`pressure`, `noise`, `sum_rain`, `windstrength`…), échelles de 30 min à 1 mois, profondeur au pas de 30 min | workflow **Collecte quotidienne**, case « inventaire » (après la collecte) |
| Linky (Conso API) | statut HTTP et nombre de points datés des 5 séries, sous leur nom 2026 et leur ancien nom, sur 7 jours, puis la consommation quotidienne d'il y a 3 ans. Les points d'accès identité, adresse et contrat ne sont **jamais** appelés | workflow **Diagnostic**, case « Inventaire » |

**Pourquoi la station passe par la collecte** : son jeton de rafraîchissement change à chaque usage
et le workflow Diagnostic ne peut pas enregistrer le nouveau (il ne commite pas). L'inventaire de la
station tourne donc à la fin de la collecte (`sync` avec `STATION_INVENTORY=true`), avec le jeton
d'accès que la collecte vient d'obtenir : aucune nouvelle connexion, et le jeton renouvelé est
enregistré chiffré dans `netatmo-token.enc.json` puis commité comme chaque nuit. Rien à générer à la
main. Un échec de l'inventaire n'interrompt jamais la collecte.

Les noms de champs déjà vus sur le compte réel (diagnostics précédents, #162, S-13.1) sont repris
ci-dessous ; le reste vient de la documentation publique (Netatmo Weather API, Conso API) et des
intégrations open source qui lisent le même serveur Intuis.

## 2. Tableaux de synthèse

Légende : **Effort** S (moins d'une demi-journée), M (une à deux journées), L (plus). **Risque vie
privée** : ce que la donnée révèle des habitudes du foyer, une fois chiffrée (faible / moyen / élevé).

### 2.1 Intuis : `homesdata` (inventaire de la maison)

| Donnée | Disponible | Collectée | Exploitée | Valeur possible | Effort | Risque |
|---|---|---|---|---|---|---|
| Pièces : `id`, `name`, `type`, `module_ids` | oui | `meta.rooms` (id, nom, catégorie, types de module) — `collector/model.py` `parse_homes` | partout (noms, regroupement vue foyer `web/src/household.ts`) | — | — | moyen (noms de pièces) |
| Modules : `type`, `bridge`, `room_id`, `subtype`, `muller_type` | oui | type seulement (`Room.module_types`) ; `room_id` sert à placer le chauffe-eau | catégorie de pièce, chauffe-eau (`views/waterheater.ts`) | distinguer modèles (sèche-serviettes, `subtype`) | S | faible |
| `setup_date` des modules | oui | **non** (lu par `diagnose --history`) | — | dater le début réel de l'historique, une « mise en service » sur la frise | S | faible |
| `capabilities`, `schedule_limits`, `modules_bridged`, `router_id` | oui (champs vus) | non | — | aucune utile à l'analyse | — | faible |
| Coordonnées, `altitude`, `timezone` | oui | `timezone` dans `meta.home` ; coordonnées lues pour Open-Meteo (`model.Home.latitude`) et non stockées | météo de la commune | localisation exacte : #204 | — | élevé (adresse) |
| **Plannings** (`schedules[]` : `timetable`, `zones`, consignes par pièce, `selected`) | oui, structure **à confirmer par le diagnostic** | **non** | — | planning vs heures creuses, consommation et confort : **#211 (S-4.13)** | M | moyen (horaires de vie) |
| `therm_mode`, consignes par défaut `hg_temp`, `away_temp` | à confirmer par le diagnostic | non | — | contexte des modes (#210, #175) | S | faible |

### 2.2 Intuis : `homestatus` (état instantané)

Champs vus sur le compte réel. Pièces : `anticipating`, `boost_status`, `lowering`, `muller_type`,
`open_window`, `pairing`, `presence`, `therm_measured_temperature`, `therm_setpoint_end_time`,
`therm_setpoint_mode`, `therm_setpoint_temperature`. Modules : `boiler_status`, `brand_label`,
`bridge`, `configure`, `connection_status`, `contactor_mode`, `debug_enabled`, `firmware_revision`,
`hardware_version`, `install_progress`, `last_seen`, `muller_type`, `offload`, `open_zigbee`,
`outdoor_temperature`, `presence_sensor`, `radiator_state`, `reachable`, `router_id`, `subtype`…
Aucun historique n'est servi pour ces états (S-13.1) : seul le relevé horaire (S-13.2) les garde.

| Donnée | Collectée | Exploitée | Valeur possible | Effort | Risque |
|---|---|---|---|---|---|
| `open_window` | `roomstate.enc.json` → `open_window_h` par pièce et par jour (`collector/roomstate.py`) | `views/windows.ts`, `web/src/windows.ts` | — | — | moyen |
| `boost_status`, `therm_setpoint_mode` | `boost_h`, `mode_h` | `views/windows.ts` ; absences #210 | — | — | moyen |
| `radiator_state` | `heating_h` | `windows.ts` (part du chauffage pendant fenêtre ouverte) | — | — | faible |
| `offload` | `offload_h` | `windows.ts` `offloadDays` (croisé avec le pic Linky) | — | — | faible |
| `contactor_mode` (chauffe-eau) | `contactor_h` | `windows.ts` `contactor`, `checks.ts` | — | — | faible |
| `presence` | `presence_h`, **seulement** avec `ROOM_STATE_PRESENCE` (S-13.5) | `windows.ts` | — | — | élevé |
| `anticipating`, `lowering` | **non** | — | heures de pré-chauffe et d'abaissement par pièce : la relance démarre-t-elle en heures creuses ? (alimente #211) | S | faible |
| `reachable`, `connection_status`, `last_seen` | **non** | — | **radiateur ou chauffe-eau hors ligne** : alerte (une pièce à 0 kWh n'est pas forcément économe) | S | faible |
| `firmware_revision`, `hardware_version` | **non** | — | note « mise à jour du firmware le … » pour expliquer une rupture de consommation | S | faible |
| `therm_measured_temperature`, `therm_setpoint_temperature` | non (la température et la consigne viennent des mesures, § 2.3) | — | doublon des mesures | — | moyen |
| `therm_setpoint_end_time` | non | — | durée des boosts et dérogations (complète #175) | S | faible |
| `outdoor_temperature` (passerelle) | non | — | doublon d'Open-Meteo / station | — | faible |
| `boiler_status`, `heating_power_request` | `heating_power_request` est dans la liste blanche de `roomstate.py` mais **absent** des réponses réelles (voir G3) | — | — | — | faible |
| `pairing`, `configure`, `debug_enabled`, `install_progress`, `open_zigbee`, `brand_label` | non | — | aucune utile | — | — |

### 2.3 Intuis : mesures (`gethomemeasure`, `getroommeasure`)

Types vus : `sum_energy_elec`, `sum_energy_elec$0/$1/$2` (base / heures pleines / heures creuses),
`sum_energy_elec_heating`, `sum_energy_elec_hot_water` ; `temperature`, `sp_temperature`. Pas de type
historique pour fenêtres, boost, présence (S-13.1).

| Donnée | Échelles disponibles | Collectée | Exploitée | Valeur possible | Effort | Risque |
|---|---|---|---|---|---|---|
| Énergie par pièce, par jour | 1day (et 1week, 1month) | `YYYY.enc.json` `daily` (max des familles de types, `collector/sync.py`) ; trous comblés depuis le mois (`estimated`) | presque toutes les vues (`views/overview.ts`, `analyse.ts`, `compare.ts`, `invoice.ts`, `report.ts`…) | — | — | moyen |
| Énergie par tarif `$0/$1/$2` | 1day | `tariffs` (jour seulement) | `compare.ts`, `invoice.ts`, `budget.ts`, `waterheater.ts`, `setpoint.ts` | part HP/HC **horaire** : déductible de l'heure et du contrat, donc inutile | — | faible |
| Énergie par pièce, par heure | 1hour | `YYYY.hourly.enc.json` (365 j au premier passage, puis 4 j) | `analyse.ts`, `breakdown.ts`, `shutters.ts`, `linky.ts`, `research.ts` | — | — | moyen |
| Énergie au pas de 5 min / 30 min | **à confirmer par le diagnostic** | non | rapprochement fin avec la courbe Linky 30 min | M | moyen |
| Température mesurée et consigne par pièce | 1day ; **1hour à confirmer par le diagnostic** | `temps` (jour seulement) | `rooms.ts`, `comfort.ts`, `windows.ts`, `research.ts`, `pinned.ts` | **horaire** : temps de montée en température, inertie, consigne atteinte ou non (#211, persona #194) | S | moyen |
| Profondeur d'historique | 2022 → aujourd'hui au jour (S-1.10) ; horaire : **à confirmer par le diagnostic** | 365 j d'horaire au premier passage | — | allonger le rattrapage horaire si l'API le sert | S | — |

### 2.4 Station Netatmo (`getstationsdata`, `getmeasure`)

| Donnée | Disponible | Collectée | Exploitée | Valeur possible | Effort | Risque |
|---|---|---|---|---|---|---|
| Température, humidité (tous modules), CO₂ (intérieurs) | `getmeasure` toutes échelles | `station.enc.json` `daily` [min, max, moyenne, humidité, CO₂] ; `YYYY.station_h` horaire ; agrégats `nightly`, `hours` ; extérieur → `weather.outdoor` (DJU) ; principal → `weather.indoor` | `views/comfort.ts`, `rooms.ts`, `indoorsig.ts`, `analyse.ts`, `annual-share.ts`, `research.ts`, `household.ts` | — | — | moyen (CO₂ de la chambre ≈ occupation) |
| **Pression** (`pressure`, `AbsolutePressure`, `pressure_trend`) | module principal ; **à confirmer par le diagnostic** | non | — | contexte météo des journées froides, tendance | S | faible |
| **Bruit** (`noise`, dB) | module principal ; **à confirmer par le diagnostic** | non | — | occupation du séjour, soirées, télévision : à manier avec l'accord du foyer | S | **élevé** |
| Vent (`NAModule2` : `windstrength`, `guststrength`, angles) | si le foyer a l'anémomètre ; **à confirmer par le diagnostic** | non (aucun module de ce type connu sur le compte) | — | effet du vent sur les déperditions (signature à 2 variables) | M | faible |
| Pluie (`NAModule3` : `rain`, `sum_rain`) | si pluviomètre ; à confirmer | non | — | faible pour l'énergie (humidité de la cave) | S | faible |
| `min_temp` / `max_temp` et `date_min_temp` / `date_max_temp` | 1day et plus | min, max oui ; heures du min / max non | `comfort.ts` | heure du minimum intérieur (relance tardive) | S | faible |
| **Batterie** (`battery_percent`, `battery_vp`), **radio** (`rf_status`), `wifi_status`, `reachable`, `last_seen` | réponse de `getstationsdata`, déjà appelée chaque nuit | **non** | — | **alerte pile faible / module muet** avant un trou dans les séries | S | faible |
| `firmware` des modules | idem | non | — | note de version, comme pour Intuis | S | faible |
| `place` (ville, coordonnées, altitude), `station_name`, `module_name`, `_id` (MAC) | oui | nom et type du module dans `station.modules` ; identifiants : #213 | noms des modules dans les vues | altitude, coordonnées : #204 | — | élevé (adresse) |
| Autres stations du compte, `home_id` | oui | seule la **première** station est lue (G6) | — | plusieurs logements (feuille de route n° 18) | M | — |

### 2.5 Linky (Conso API, conso.boris.sh → Enedis)

Noms 2026 et anciens noms : `consommation_quotidienne` (`daily_consumption`),
`courbe_de_charge_consommation` (`consumption_load_curve`), `puissance_conso_max_quotidienne`
(`consumption_max_power`), `production_quotidienne` (`daily_production`), `courbe_de_charge_production`
(`production_load_curve`). Paramètres `pointId`, `dateDebut`, `dateFin` ; pour la puissance maximale,
`mesuresPas` (`P1D` / `P1M`) et `grandeurPhysique` (`PMA` / `TOUT`). Les anciens types cessent de
fonctionner après l'arrêt des API Enedis historiques (mi-octobre 2026). Source :
[conso.boris.sh/migration-2026](https://conso.boris.sh/migration-2026).

| Donnée | Disponible | Collectée | Exploitée | Valeur possible | Effort | Risque |
|---|---|---|---|---|---|---|
| Consommation quotidienne (≈ 3 ans) | oui | `linky.enc.json` `daily` | `overview.ts`, `compare.ts`, `invoice.ts`, `reconstitution.ts`, `breakdown.ts`, `report.ts`, `habits.ts` | — | — | faible |
| Courbe de charge 30 min (si activée chez Enedis) | oui, 7 jours par requête (à confirmer) | `YYYY.linky30.enc.json` | `views/linky.ts`, `breakdown.ts`, `research.ts` | — | — | **élevé** |
| Puissance maximale quotidienne | oui | `linky.pmax` (kVA) ; **l'heure du pic est jetée** (`_readings` ne garde que `[:10]`, G5) | `prices.ts`, `compare.ts`, `overview.ts`, `windows.ts` (délestage) | heure du pic : quel appareil le provoque | S | moyen |
| Production quotidienne et courbe de production | seulement avec des panneaux ; **à confirmer par le diagnostic** | non | — | autoconsommation (si le foyer produit) | M | faible |
| Index, identité, adresse, contrat | non servis par la Conso API ou hors du besoin | non | — | puissance souscrite : saisie à la main dans le contrat (`contract.ts`) | — | élevé |

### 2.6 Autres sources

| Source | Collectée | Exploitée | Non exploité / possible | Suite |
|---|---|---|---|---|
| Open-Meteo (archive ERA5) | `weather.outdoor` [min, max, moyenne] si pas de station | DJU, signature (`analysis.ts`, `views/analyse.ts`, `overview.ts`…) | ensoleillement, rayonnement : #117 ; vent `wind_speed_10m` (même appel) : S-3.12 (#221) | — |
| Shelly Cloud | `shelly.enc.json` `daily` par prise | `views/breakdown.ts`, `views/settings.ts` | puissance instantanée, température de la prise : sans historique, pas d'intérêt | — |
| Home Assistant (import manuel) | `ha.enc.json` | **aucune vue** : seulement la sauvegarde (`web/src/backup.ts`) | affichage et accord capteur ↔ `open_window` | critère encore ouvert de **#178** |
| Relevé horaire (`roomstate.enc.json`) | voir § 2.2 | `views/windows.ts` | `values` (noms d'états vus) : contrôlé dans `windows.ts` | — |

**Complétude par mois** : déjà calculée pour l'énergie Intuis (`coverage` par pièce et par mois,
`Store.update_coverage`, vue Qualité `views/quality.ts`) et pour le relevé horaire (`coverage`, 7 jours,
résumé du job). Pour la station et Linky, la complétude se lit avec `python -m collector verify` et
la vue Qualité ne la montre pas encore : à ajouter lors du lancement réel si un trou apparaît.

## 3. Trous de collecte repérés dans le code

| # | Trou | Effet | Correction |
|---|---|---|---|
| G1 | Températures des pièces lues **au jour seulement** (`TEMPERATURES` à l'échelle `1day`, `sync.py` `_temperatures`) | pas de courbe de montée en température | issue S-1.23 (#217) (après confirmation de l'échelle `1hour` par le diagnostic) |
| G2 | Énergie horaire collectée seulement si la méthode retenue passe par `gethomemeasure` (`strategy[0] == "home"`) | sur un compte qui ne répond qu'à `getroommeasure`, aucune donnée horaire | expliqué : `getroommeasure` = un appel par pièce et par jour, trop coûteux pour le plafond d'appels. Rien à faire tant que `home` répond (cas du compte réel) |
| G3 | `heating_power_request` dans la liste blanche du relevé horaire (`roomstate.ROOM_FIELDS`) alors que le champ n'existe pas dans les réponses Intuis réelles | aucun : `heating_h` vient de `radiator_state` des modules | laissé en place (inoffensif, utile si Intuis l'ajoute) ; documenté ici |
| G4 | La collecte quotidienne de la station demande `min_temp,max_temp,temperature,humidity` à **tous** les modules, anémomètre et pluviomètre compris (`station.py` `collect`). Si l'API refuse ces types pour ces modules, l'erreur arrête toute la collecte de la station | latent : le compte réel n'a ni anémomètre ni pluviomètre | l'inventaire le vérifie (`temperature` est demandé au vent et à la pluie). Correctif d'une ligne (ignorer les modules absents de `HOURLY_TYPES`) **à faire après la fusion de #213**, qui réécrit cette boucle ; repris dans S-3.12 (#221) |
| G5 | Heure du pic de puissance Linky perdue (`enedis._readings` tronque la date à 10 caractères) | on sait le jour du pic, pas l'heure | issue S-1.25 (#219) (format exact **à confirmer par le diagnostic**) |
| G6 | Une seule maison Intuis (`Syncer.home`, avertissement dans le journal) et une seule station (`devices[0]`) | un second logement est ignoré | expliqué : feuille de route n° 18 « plusieurs maisons » |
| G7 | Santé des modules (batterie, radio, `reachable`, `last_seen`, firmware) reçue chaque nuit dans `getstationsdata` / chaque heure dans `homestatus`, puis jetée | une pile vide ou un radiateur muet se voit seulement par un trou dans les courbes | issues S-1.20 (#214), S-1.21 (#215), S-1.22 (#216) |
| G8 | `ha.enc.json` collecté mais affiché nulle part | import sans retour visible | suivi par #178 |
| G9 | `setup_date` des modules non gardé | le début de l'historique d'un radiateur ajouté est deviné | petit ajout possible dans S-1.22 (#216) (même document « appareils ») |

Aucun de ces trous n'est corrigé dans cette PR : G4, le seul qui puisse casser une collecte, touche
le code que modifie #213 ; les autres demandent un nouveau champ stocké, donc une issue.

## 4. Données non exploitées : liste priorisée

| Priorité | Donnée | Usage proposé | Issue | Jalon |
|---|---|---|---|---|
| 1 | `reachable`, `connection_status`, `last_seen` des radiateurs et du chauffe-eau | heures hors ligne par pièce, alerte « radiateur muet » | S-1.20 (#214) | v1.5 |
| 1 | Batterie et radio des modules de la station | alerte pile faible / module muet | S-1.21 (#215) | v1.5 |
| 1 | Températures horaires des pièces (`temperature`, `sp_temperature` au pas d'une heure) | montée en température, inertie, consigne atteinte (alimente #211, #194) | S-1.23 (#217) | v1.5 |
| 1 | `anticipating`, `lowering` | heures de pré-chauffe et d'abaissement par pièce (alimente #211) | S-13.8 (#218) | v1.5 |
| 2 | Plannings (`homesdata.schedules`) | vérifier les plannings | **#211** (existe) | v1.6 |
| 2 | Firmware Intuis et station, `setup_date` | note de version sur les graphiques | S-1.22 (#216) | v1.5 |
| 2 | Heure du pic de puissance Linky | quel usage fait le pic | S-1.25 (#219) | v1.5 |
| 2 | Pression et bruit du module principal | contexte météo ; bruit seulement avec accord explicite | S-11.4 (#220) | v1.6 |
| 3 | Vent (station ou Open-Meteo), pluie | signature à deux variables ; corrige G4 | S-3.12 (#221) | v1.6 |
| 3 | Production Linky | autoconsommation, si le foyer produit | S-1.24 (#222) | v1.5 |
| — | Coordonnées précises | voir **#204** | — | — |
| — | Ensoleillement | voir **#117** | — | — |
| — | Export Home Assistant | voir **#178** | — | — |

Règle commune : toute nouvelle donnée passe par la minimisation de S-13.5 (agrégats journaliers quand
c'est possible, chiffrement, regroupement des chambres en vue foyer, rien vers l'IA sans revue) et
par [juridique.md](juridique.md).

## 5. Ce que le propriétaire doit lancer

1. Actions → **Diagnostic** → cocher « Inventaire des données Intuis et Linky » (secrets existants :
   `INTUIS_*`, `ENEDIS_TOKEN`, `ENEDIS_PRM`).
2. Actions → **Collecte quotidienne** → *Run workflow* en cochant « inventaire » (laisser « historique »
   décoché). La collecte se fait normalement, puis l'inventaire de la station s'affiche dans le journal
   de l'étape « Collecte ». Aucun secret à ajouter.
3. Reporter dans ce document, à la place des « à confirmer par le diagnostic » : la structure des
   plannings, les échelles acceptées (5 min, 30 min, `temperature` à l'heure), la profondeur horaire,
   les types de la station acceptés (`pressure`, `noise`, refus de `temperature` par un anémomètre),
   les séries Linky qui répondent (production, ancien nom de type encore accepté ou non).
4. Fermer les issues dont la donnée n'existe pas sur le compte (par exemple S-1.24 (#222) sans production).
