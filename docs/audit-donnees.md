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
| `open_window` | `roomstate.enc.json` → `open_window_h` par pièce et par jour (`collector/roomstate.py`) | `views/windows.ts`, `web/src/windows.ts`, question « pièce froide » (`questions.ts`), jours inhabituels (`views/analyse.ts`), accord HA (`ha.ts`), faits IA mensuels (`insights.py`, S-5.10) | — | — | moyen |
| `boost_status`, `therm_setpoint_mode` | `boost_h`, `mode_h` | `views/windows.ts` ; absences confirmées (`habits.ts` `withModeAbsences`) ; boost dans les faits IA (S-5.10) | — | — | moyen |
| `radiator_state` | `heating_h` | `windows.ts` (part du chauffage pendant fenêtre ouverte) | — | — | faible |
| `offload` | `offload_h` | `windows.ts` `offloadDays`, `offloadByRoom` (Synthèse, sous la puissance maximale, croisé avec le pic Linky) | — | — | faible |
| `contactor_mode` (chauffe-eau) | `contactor_h` | `windows.ts` `contactor` (carte chauffe-eau de l'Analyse et carte Confort), `checks.ts` | — | — | faible |
| `presence` | `presence_h`, **seulement** avec `ROOM_STATE_PRESENCE` (S-13.5) | `windows.ts` | — | — | élevé |
| `anticipating`, `lowering` | `anticipating_h`, `lowering_h` (v1.5, #218) | Paramètres → État des appareils | heures de pré-chauffe et d'abaissement par pièce : la relance démarre-t-elle en heures creuses ? (alimente #211) | S | faible |
| `reachable`, `connection_status`, `last_seen` | `offline_h` (relevé horaire) et `devices.enc.json` `reach` (lecture nocturne), v1.5 #214 | Paramètres → État des appareils, vue Qualité, issue facultative | **radiateur ou chauffe-eau hors ligne** : alerte (une pièce à 0 kWh n'est pas forcément économe) | S | faible |
| `firmware_revision`, `hardware_version` | `firmware_revision` : changements datés dans `devices.enc.json` (v1.5, #216) | vue Qualité | note « mise à jour du firmware le … » pour expliquer une rupture de consommation | S | faible |
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
| **Index** (`index_consommation`, API v2) | **oui** d'après [la page de migration 2026](https://conso.boris.sh/migration-2026), format à confirmer par l'inventaire (correction de la ligne précédente, voir [etudes/audit-appareils.md](etudes/audit-appareils.md) § 4) | non | — | recouper la facture, part HP/HC ou Tempo réelle par jour | S-M | faible |

### 2.6 Autres sources

| Source | Collectée | Exploitée | Non exploité / possible | Suite |
|---|---|---|---|---|
| Open-Meteo (archive ERA5) | `weather.outdoor` [min, max, moyenne] si pas de station ; `weather.sun` rayonnement quotidien `shortwave_radiation_sum` (MJ/m², #452), vent et pluie (S-3.12, #221) dans tous les cas | DJU, signature (`analysis.ts`, `views/analyse.ts`, `overview.ts`…) ; rayonnement : niveau inférieur (`lower.ts`) et « Explication possible » des jours inhabituels (`sun.ts`, #117) | — | fait (#117) |
| Shelly Cloud | `shelly.enc.json` `daily` par prise | `views/breakdown.ts`, `views/settings.ts` | puissance instantanée, température de la prise : sans historique, pas d'intérêt | — |
| Home Assistant (import manuel) | `ha.enc.json` | `views/ha.ts` (carte Confort : capteurs importés, accord capteur d'ouverture ↔ `open_window`, `ha.ts`), sauvegarde | — | fait (#178) |
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
| G8 | `ha.enc.json` collecté mais affiché nulle part | import sans retour visible | corrigé (#178) : carte « Capteurs Home Assistant » |
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

## 6. Résultats du passage réel (9 novembre 2026)

Diagnostic « Inventaire » (Intuis, Linky) et collecte avec la case « inventaire » (station).
Noms et volumes seulement.

**Intuis**
- 1 logement, 7 pièces, 13 modules : passerelle NMG ×1, radiateurs NMH ×6, relais NMR ×5,
  chauffe-eau NMW ×1.
- `homesdata` : **6 plannings** (`schedules[]` : `timetable` en minutes depuis lundi 0 h,
  `zones[]` avec `rooms_temp`, `price`, `price_type`, `tariff`, `tariff_option`) et
  3 `therm_schedules`. Réglages d'absence automatique au niveau du logement :
  `therm_absence_autoaway`, `therm_absence_notification`. Également : `altitude`,
  `coordinates`, `contract_power_unit`, `therm_mode`, `temperature_control_mode`.
- `homestatus` : 5 pièces renvoyées ; côté modules, `last_seen`, `reachable`, `radiator_state`,
  `offload`, `presence_sensor`, `firmware_revision*`. Sur la passerelle : `wifi_strength`, `uptime`,
  `outdoor_temperature`, `therm_setpoint_day_color_type` (couleur Tempo connue de la passerelle).
- Mesures `gethomemeasure` : seules `sum_energy_elec$1` et `$2` répondent pour l'énergie, aux pas
  **5 min, 30 min, 1 h et 1 jour**. Les types `sum_energy_elec`, `$0`, `_heating` et `_hot_water`
  sont vides sur la période récente. `temperature` et `sp_temperature` répondent par pièce, à tous
  les pas.
- Profondeur : **au moins 1 460 jours à tous les pas**. Rien à 1 825 jours.

**Station Netatmo** (NAMain, 2 × NAModule4, NAModule1 ; ni anémomètre ni pluviomètre)
- `dashboard_data` du module principal : `Pressure`, `AbsolutePressure`, `Noise`, `pressure_trend`.
  Les modules exposent `battery_percent`, `battery_vp`, `rf_status`, `last_seen`, `firmware`.
- `getmeasure` accepte `pressure`, `noise`, `min/max_hum`, `min/max_pressure`, `min/max_noise` et
  `date_max_temp` / `date_min_temp`.

**Linky (Conso API)**
- Quotidien, courbe 30 min et puissance max : HTTP 200. L'historique remonte au moins à 3 ans.
- Production : HTTP 400, pas de production (#222 fermée). Les anciens noms d'endpoints répondent
  aussi 400.

**Décisions**
- Nouvelle issue #224 : collecter l'énergie et les températures au pas 30 min, sur 4 ans.
- #211 (plannings) et #210 (absences) : toutes les données nécessaires sont disponibles.
- #215, #220 confirmées (batteries, radio, pression, bruit).
- #221 : vent via Open-Meteo uniquement.

## 7. Bilan qualité des données (S-1.32, #336) : gabarit à remplir

Réponse aux questions du propriétaire : « a-t-on bien les données ? la qualité est-elle bonne ?
2023 : données manquantes normal ? qualité de 2024 ? ». Le bilan se lit **sur l'archive chiffrée**
du dépôt, sans aucun appel aux API, et n'écrit que des **nombres** par mois : ni valeur, ni nom, ni
identifiant, ni date plus fine que le mois (le journal d'un dépôt public est public ; test :
`tests/test_qualite.py`).

**Le lancer** : Actions → **Diagnostic** → *Run workflow* → cocher seulement « Bilan qualité des
données ». Aucun secret à ajouter (`DATA_PASSPHRASE` existe déjà ; la variable `STOPPED_ROOMS_JSON`
de ⚙ Mon logement est lue pour compter les pièces arrêtées volontairement). Le bilan est dans
le journal de l'étape « Bilan qualité des données ».

**La règle**, la même que l'écran État des données (`web/src/data-quality.ts` `roomDays`, tenue
d'accord avec `collector/quality.py` par `web/src/__fixtures__/quality-rule.json`, lu par les deux
suites de tests) : chaque jour d'une pièce, de sa première valeur au dernier jour de l'archive,
est **estimé** (réparti depuis le total du mois), sinon **réel** (une valeur ; **suspect** en plus
si elle est impossible : négative, pas un nombre ou plus de 80 kWh en un jour), sinon **arrêté**
(pièce déclarée arrêtée volontairement, à partir de sa date), sinon **manquant**. Recoupement :
un jour où les relevés Intuis (réels et possibles) dépassent 1,1 × Linky + 0,5 kWh est impossible.

**Où lire la cause d'un trou** : l'appli, État des données → « Année par année » et « Source par
source » (trou chez Intuis, coupure de courant ou d'Internet, appareil injoignable, collecte en
échec ou arrêtée, pièce arrêtée volontairement, chauffe-eau réinstallé). Le journal public ne
peut pas la donner : elle demande les dates et les noms.

Remplir le tableau ci-dessous à partir de la sortie (`Total AAAA`, `plus long trou`), sans recopier
de valeur ni de nom. Les cases restent vides tant que le bilan n'a pas été relancé avec cette
version (date de passage à indiquer).

Passage du : _(date)_ — version : _(commit)_

| Année | Chauffage, pièces-jours r / e / m / s / a | Plus long trou (toutes les pièces) | Plus long trou (au moins une pièce) | Chauffe-eau r / e / m | Linky jour présents / manquants | Intuis > Linky / Linky sans Intuis | Station : plus long trou |
|---|---|---|---|---|---|---|---|
| 2022 | | | | | | | |
| 2023 | | | | | | | |
| 2024 | | | | | | | |
| 2025 | | | | | | | |
| 2026 | | | | | | | |

**Réponses** (à rédiger d'après le tableau et l'écran État des données) :

- *A-t-on bien les données ?* — _(couverture de chaque source ; ce qui manque encore)_
- *2023 : est-ce normal qu'il manque des jours ?* — _(trou commun à toutes les pièces = perdu chez
  Intuis, non récupérable ; cause affichée dans l'appli)_
- *Quelle qualité en 2024 ?* — _(jours manquants, suspects, recoupement Linky ; les valeurs trop
  basses un jour froid relèvent des « jours suspects » de l'appli, pas de ce bilan)_
- *Pièce arrêtée volontairement* — _(ses jours sont comptés « a », pas « m » : vérifier qu'aucune
  pièce ne reste en manquants chaque mois sans raison)_

## 8. Audit des données : dates, chevauchements et valeurs (#532)

Demande du propriétaire (12/11/2026) : « reprendre toutes les données, existantes et récupérées :
bonne date, bonne valeur ; pour les trous, vérifier qu'on n'a pas de chevauchement ou d'autre
problème ». Le bilan du § 7 compte les jours ; l'audit regarde **chaque date et chaque série** de
l'archive chiffrée (`collector/audit.py`), sans rien appeler ni rien réécrire.

### Mode d'emploi (geste du propriétaire)

1. GitHub → onglet **Actions** → workflow **Diagnostic** → *Run workflow* → cocher seulement
   **« Bilan qualité et audit des données »**. Aucun secret à ajouter.
2. Le journal de l'étape « Bilan qualité des données » donne, après le bilan du § 7, le **nombre de
   cas par contrôle et par mois** (jamais une valeur, un nom, un identifiant ni un jour : le journal
   est public ; test : `tests/test_audit.py`), puis les seuils utilisés. Sous chaque contrôle qui a
   des cas, une ligne « dont … » par **genre de série** (étiquette fixe : « courbe de charge à la
   demi-heure (Linky) », « énergie par heure (Intuis) »…, jamais une pièce) et, pour `somme-jour`,
   combien de jours ont des heures au-dessus ou au-dessous du jour (#568).
3. Le **détail** (jour ou heure exacts, valeurs, fichier, série, pièce) est l'artefact
   **`audit-donnees`** du même passage (en bas de la page du passage, gardé 7 jours). Il est
   **chiffré avec la clé des données**, comme les fichiers de `data/` : sans la phrase de passe, il ne
   dit rien. Le télécharger, le décompresser (c'est un `.zip`).
4. Dans l'appli : **État des données** → repli **« Année par année »** → **« Audit détaillé des données »** → *Ouvrir le
   rapport…* → choisir `audit-donnees.enc.json`. Il est déchiffré sur l'appareil avec la clé déjà
   ouverte, rien n'est envoyé ; il reste gardé chiffré sur cet appareil (« Oublier ce rapport »
   l'efface).

### Les contrôles

Toutes les séries datées de tous les fichiers sont lues, quelle que soit la source (Intuis jour,
heure, demi-heure, tarifs, températures ; Linky ; station ; météo ; prises ; Home Assistant ; volets ;
appareils) : est une série tout objet dont les clés sont des dates.

| Contrôle | Ce qu'il cherche | Ce que fait l'appli d'un tel jour |
|---|---|---|
| `cle-invalide` | une clé qui n'est pas une date de la forme de sa série, ou une date impossible (30 février) | ignorée |
| `doublon-horodatage` | deux écritures du même instant (« 2024-1-5 » et « 2024-01-05 »), ou la même clé deux fois dans un fichier | une seule valeur lue, l'autre perdue sans le dire |
| `mauvais-fichier` | un jour rangé dans le fichier d'une autre année (borne de fin d'année) | lu, mais compté dans la couverture de la mauvaise année |
| `deux-fichiers` | le même jour d'une même série dans deux fichiers d'année | **une seule valeur, celle du fichier de l'année du jour** (avant #532, l'appli additionnait les deux ; corrigé, `aggregate.ts` `toRecords`, et le bilan du § 7, `storage.py` `own_year_first` ; depuis #550, aussi `verify`, l'export CSV, le rapport mensuel, l'alerte des pièces muettes, et dans l'appli les heures, les demi-heures, la station et la courbe Linky, `mergeYear`) |
| `heure-inexistante` | une valeur sur l'heure que le passage à l'heure d'été saute (2 h–3 h, heure de Paris), dans une série horaire ou à la demi-heure | comptée dans le jour, à une heure qu'aucune horloge n'a affichée |
| `decalage-heures` | des heures (demi-heures) dont la somme ne retrouve le total du jour qu'une fois décalées d'1 ou 2 h (UTC au lieu de l'heure de Paris) ou d'un jour (rangées sous le mauvais jour) ; Intuis heure et demi-heure contre le jour, courbe Linky contre le jour Linky | courbes heure par heure décalées d'autant |
| `decalage-fuseau` | la courbe heure par heure des radiateurs suit celle du Linky avec 1 ou 2 h d'écart (corrélation) | idem, et partage heures pleines / creuses décalé |
| `decalage-jour-linky` | Intuis dépasse le Linky plusieurs jours d'un mois, mais plus si l'un des deux est pris un jour plus tôt ou plus tard | recoupement et reconstitution sur le mauvais jour |
| `estime-sur-reel` | un jour marqué estimé (part du total du mois) pour lequel Intuis a pourtant des heures ou des demi-heures mesurées (deux parts différentes dans un même mois ne sont pas un défaut : la reprise d'historique répartit deux fois un mois coupé par deux de ses fenêtres d'un an) | compté une fois, comme estimé : jamais ajouté aux heures mesurées |
| `marque-sans-valeur` | un jour marqué estimé sans valeur | compté estimé, à 0 kWh |
| `tarifs-additionnes` | un jour qui vaut deux fois la somme de ses tarifs (deux familles de mesure additionnées) ou moins qu'elle | total du jour et partage HP / HC en désaccord |
| `deux-sources` | une prise ou un capteur Home Assistant qui mesure jour après jour la même énergie qu'une pièce Intuis | « Autres usages » la retire deux fois du Linky |

Robustesse : un fichier illisible ou une structure inattendue n'arrête ni le bilan du § 7 ni les autres contrôles ; le journal dit « Non vérifié : … » avec le nom du contrôle (ou le genre de fichier, l'année masquée) et le type d'erreur, l'appli le redit en tête du rapport.

Limite connue : un décalage d'une heure se voit mal dans les **totaux** d'un jour quand la
consommation varie peu autour de minuit ; c'est pourquoi `decalage-fuseau` compare aussi les
**profils** horaires d'Intuis et du Linky. Sans courbe Linky, seul le décalage d'un jour est sûr.

### Les contrôles des valeurs

| Contrôle | Ce qu'il cherche | Ce que fait l'appli d'un tel jour |
|---|---|---|
| `somme-jour` | les heures (demi-heures) complètes d'un jour qui ne retrouvent pas le total du jour (Intuis heure et 30 min contre le jour Intuis, courbe Linky contre le jour Linky), hors des mois déjà signalés décalés ; « deux fois le jour » est nommé (deux familles de mesure additionnées) | le total du jour fait foi ; la courbe de ce jour ne le retrouve pas |
| `pieces-sur-linky` | les jours où Intuis dépasse le compteur de toute la maison (la règle du bilan § 7, `quality.py` `above_meter`) | compté tel quel, « Intuis > Linky » au bilan |
| `valeur-impossible` | énergie négative, pas un nombre, ou une pièce au-delà de 80 kWh en un jour (les jours « suspects » du bilan) | compté, marqué suspect |
| `unite` | une semaine (ou plus) de jours mille fois plus petits que les voisins, ou un jour mille fois plus grand : kWh rangés comme Wh, ou l'inverse (à vérifier : un appareil éteint donne le même rapport) | compté tel quel |
| `valeur-figee` | la même lecture non nulle 5 jours de suite (énergie, température et consigne, Linky, station, météo, prises ; jours estimés exclus, égaux par construction). Depuis #550 : une énergie du jour sous l'écart absolu (100 Wh, appareil en veille, la borne de `unite`) n'est pas comparée ; une température dont les demi-heures bougent dans l'un des jours non plus (une pièce stable, arrondie au dixième, donne des jours égaux par hasard ; un capteur figé l'est aussi dans la journée) ; sans demi-heures ces jours-là, comparée comme avant | compté tel quel |
| `pic-impossible` | une heure ou une demi-heure qui demande plus de puissance que le maximum relevé par le Linky ce jour-là, ou que 36 kVA sans ce relevé | compté tel quel |
| `compteur-recule` | un index Linky plus bas que celui de la veille | la consommation déduite des index devient négative |

### Les seuils

Chaque seuil qui change ce qui est signalé est nommé une fois (`THRESHOLDS`, `collector/audit.py`),
avec sa raison ; le rapport les porte et l'appli les affiche (« Seuils utilisés »). Ceux qui ne
viennent pas d'une mesure ou d'une règle sont marqués **hypothèse** : à confirmer sur le premier
rapport réel.

| Seuil | Valeur | Raison | Statut |
|---|---|---|---|
| `ecart_absolu`, `ecart_relatif` | 100 Wh, 5 % (le plus grand) | l'écart que la collecte accepte déjà entre le total du mois et ses jours (`sync.py`, `MONTH_GAP_*`), repris pour deux échelles d'une même série | hypothèse |
| `jours_recents` | 4 jours | la collecte relit les heures des 4 derniers jours chaque nuit (`HOURLY_DAYS_SYNC`) : valeurs pas encore définitives | justifié |
| `jours_min_mois` | 7 jours | jours comparables d'un mois en dessous desquels on ne conclut pas à un décalage | hypothèse |
| `part_decalee` | 80 % | part des jours qui doivent coller avec un même décalage (et la moitié au plus sans) | hypothèse |
| `gain_correlation` | 0,1 | gain de corrélation Intuis / Linky d'un décalage avant de le signaler | hypothèse |
| `jours_linky_min` | 3 jours | jours où Intuis dépasse le Linky avant de chercher un décalage d'un jour | hypothèse |
| `jours_sources_min` | 14 jours | jours communs avant de dire que deux sources mesurent la même chose | hypothèse |
| `facteur_unite` | 300 × | un facteur 1 000 (Wh / kWh) moins la variation ordinaire d'un jour à l'autre (facteur 3) ; médiane de 15 jours de part et d'autre, au moins 100 Wh | hypothèse |
| `jours_unite` | 7 jours | un appareil éteint quelques jours donne le même rapport ; une erreur d'unité dure | hypothèse |
| `jours_figes` | 5 jours | lecture identique avant de parler de valeur figée | hypothèse |
| `puissance_max` | 36 kVA | plus gros raccordement d'une maison au tarif bleu ; une moyenne sur une heure ne dépasse pas le maximum atteint (1 % d'arrondi) | justifié |
| `suspect_jour` | 80 kWh | une pièce à 3,3 kW pendant 24 h (bilan § 7) | hypothèse |
| `depassement_linky` | 10 % et 500 Wh | Intuis ne peut pas dépasser le compteur qui le mesure (bilan § 7, `quality.py`) | justifié |

### Ce que le propriétaire regarde

- Dans le **journal** : une ligne non nulle autre que `heure-inexistante` en mars ou `decalage-*`
  isolé sur un mois mérite l'ouverture du détail.
- Dans le **détail** : pour chaque cas, le fichier et la série disent d'où il vient ; un
  `deux-fichiers` ou un `doublon-horodatage` dit une valeur perdue ; un `decalage-*` sur plusieurs
  mois de suite dit une série rangée dans le mauvais fuseau.
- Chaque défaut confirmé devient une **issue** (constat, scénario, impact) ; une correction de
  l'archive réelle reste un geste du propriétaire, avec sauvegarde et vérification des totaux
  (`python -m collector verify` avant et après) : l'audit, lui, ne réécrit jamais rien.

## 9. Les trous : cause probable et traitement par l'appli (#532)

La liste des trous vit dans l'appli (État des données → « Source par source », chaque source dépliée),
calculée sur l'appareil à partir des documents déchiffrés (`web/src/data-quality.ts`) : elle a besoin
des dates et des noms, que le journal public ne peut pas montrer. Chaque trou de 3 jours ou plus dit :

- **sa cause probable**, de la plus sûre à la moins sûre : chauffe-eau réinstallé ; même trou que les
  radiateurs ; appareil injoignable (relevé de nuit des modules) ; coupure de courant (redémarrage de
  la passerelle) ou d'Internet (journal des incidents) ; **collecte Intuis en échec** (toutes les nuits
  après le trou ont échoué, d'après le journal des appareils, jusqu'à ce que ses jours sortent des
  35 jours que chaque collecte redemande : une seule nuit réussie entre-temps les a redemandés, et le
  trou est alors chez Intuis ; revue de fin de v2.2 ; la même règle pour le Linky et la station, sur
  les 10 jours qu'ils redemandent, #550) ; **collecte arrêtée** (le
  compteur Linky et la station manquent aussi ces jours-là) ; sinon, l'historique Intuis n'a rien
  renvoyé (ni les jours ni le total du mois). Une pièce **arrêtée volontairement** (⚙ Mon logement)
  n'a pas de trou : pas de données attendues ;
- **s'il est récupérable** : un trou de collecte (échec, arrêt) est encore chez Intuis, qui garde son
  historique : relancer « Collecte quotidienne » en cochant « Récupérer tout l'historique disponible » ;
  un trou chez Intuis ne l'est pas ;
- **ce qu'en fait l'appli** (« Dans l'appli : … », `gapTreatment`) : un jour manquant est **laissé
  vide**, rien n'est ajouté aux totaux, il est écarté des comparaisons (signature, jours inhabituels,
  « Expliquer un mois ») ; « Jours perdus chez Intuis » peut l'estimer **à part**, jamais ajouté aux
  mesures ; un jour estimé depuis le total du mois est compté une fois, comme estimé ; une suite de
  0 kWh est une mesure, pas un manque.

**Jamais de double compte** : la reconstitution ne vise que des pièces-jours sans aucune valeur et ne
change pas le total mesuré (test à graine fixe, `reconstitute.test.ts`) ; un jour présent dans deux
fichiers d'année est lu une fois (§ 8, `deux-fichiers`) ; un jour estimé qui a des heures mesurées est
signalé (§ 8, `estime-sur-reel`), compté une seule fois.

**L'absence du foyer n'explique pas un trou** : absent, les radiateurs continuent d'envoyer leurs
relevés (hors-gel, 0 kWh) ; elle peut expliquer une suite de 0 kWh, pas un jour sans valeur. C'est
pourquoi elle n'est pas proposée comme cause d'un manque.
