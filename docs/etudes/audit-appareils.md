# Étude : tous les appareils de la maison, ce qu'ils peuvent dire à l'archive

*Statut : terminée, novembre 2026. Complète [audit-donnees.md](../audit-donnees.md) (champs des
sources déjà collectées, résultats réels du § 6), [volets-wiser.md](volets-wiser.md),
[plateforme-domotique.md](plateforme-domotique.md), [home-assistant-zigbee.md](home-assistant-zigbee.md)
et [module-interieur.md](module-interieur.md). Prix indicatifs relevés en novembre 2026 (France,
TTC), à vérifier au moment de l'achat. Aucun code n'est modifié par cette étude : elle propose des
issues (liste au § 10).*

## 1. Le principe qui commande tout : cloud ou réseau local ?

La collecte tourne dans **GitHub Actions**, donc dans le cloud. Elle atteint tout ce qui a une API
sur Internet (Intuis, Netatmo, Enedis via Conso API, Shelly Cloud) et **rien** de ce qui ne répond
que sur le réseau de la maison (Livebox, Synology, CPL devolo, lecteur TIC, Zigbee). Pour ces
appareils, il faut un **relais allumé en permanence à la maison** : le Synology est le candidat
naturel (§ 9).

| Appareil | Où sont les données | Accès depuis GitHub Actions | Déjà collecté |
|---|---|---|---|
| Volets Wiser (passerelle Zigbee fermée) | passerelle + cloud de l'application, sans API publique | **non** | non (saisie manuelle des soirs « volets fermés », S-9.6) |
| Intuis (radiateurs, chauffe-eau, passerelle NMG, relais NMR) | cloud Intuis (API non officielle) | **oui** | oui, largement (§ 3) |
| Linky | Enedis, via Conso API (cloud) ; prise TIC du compteur (local) | oui (cloud) / non (TIC) | oui : quotidien, courbe 30 min, puissance max |
| Livebox | interface locale de la box | **non** | non |
| Synology | DSM (API web locale, SNMP) | **non** (sauf exposition, à proscrire) | non |
| CPL devolo | API locale des adaptateurs | **non** | non |
| Station Netatmo | API officielle Netatmo (cloud) | **oui** | oui, largement (§ 8) |

Légende des tableaux : **Effort** S (moins d'une demi-journée), M (une à deux journées), L (plus).
**Valeur** pour l'analyse énergie / confort : forte, moyenne, faible. **Risque vie privée** : ce que la
donnée révèle des habitudes du foyer une fois chiffrée.

## 2. Volets Schneider Wiser

**Disponible**

| Voie | Ce qu'on obtient | Accès | Source |
|---|---|---|---|
| API cloud officielle | **aucune documentée** (ni pour la gamme Odace / passerelle Gen 2 CCT501801) | — | [forum Schneider, 2023](https://community.se.com/t5/SpaceLogic-C-Bus-Forum/Schneider-Weiser-and-home-assistant/td-p/425367) |
| Cloud de l'application (plateforme Tuya) | Schneider s'appuie sur la plateforme IoT de Tuya pour Wiser ; des utilisateurs disent voir des appareils Wiser dans l'API cloud Tuya (via LocalTuya). **Non confirmé pour les volets** | cloud, compte développeur Tuya, risque CGU | [partenariat Tuya / Schneider](https://prnewswire.com/news-releases/tuya-smart-has-signed-a-global-partnership-with-schneider-electric-to-cloud-service-its-wiser-home-automation-solution-starting-in-asia-300969208.html), [forum HA](https://community.home-assistant.io/t/wiser-schneider/106527/70) |
| Intégration HACS « Wiser » | locale, vise surtout le hub chauffage Drayton / Wiser ; « certaines versions européennes Schneider, lumières et volets ». **Passerelle française Gen 2 non confirmée** ; casse signalée sur les volets en 2023 | local (LAN) | [wiserHomeAssistantPlatform](https://github.com/asantaga/wiserHomeAssistantPlatform), [forum HA](https://community.home-assistant.io/t/wiser-integration/367980) |
| Zigbee direct (ZHA / Zigbee2MQTT) | **position (0-100 %)**, état, commande ; l'interrupteur S520567 et le micromodule CCT5015-0002W sont reconnus | local, coordinateur Zigbee ; les volets quittent la passerelle Wiser (et donc l'application Wiser) | [Zigbee2MQTT S520567](https://www.zigbee2mqtt.io/devices/S520567.html), [micromodule](https://www.domadoo.fr/en/devices/5724-schneider-electric-zigbee-30-wiser-roller-shutter-micromodule-3606481048189.html) |

| | |
|---|---|
| **Collecté** | rien ; soirs « volets fermés » saisis à la main (S-9.6, #141) |
| **Manque** | heure de fermeture et d'ouverture par volet ou par façade, chaque jour |
| **Valeur** | moyenne : l'étude [volets-wiser.md](volets-wiser.md) chiffre le gain à 1-5 % du chauffage (15 à 70 €/an) ; la donnée sert surtout à **mesurer** cet effet (S-9.0, S-9.2, #200) |
| **Comment** | voie Zigbee via Home Assistant sur le Synology (§ 9) : agrégat quotidien « heure de première fermeture après 16 h », « heures fermé la nuit » par volet, importé par le pont local ou l'import HA (S-1.18) |
| **Effort** | L (HA + coordinateur + réappairage des volets) |
| **Risques** | réappairer les volets hors de la passerelle supprime l'application Wiser (à accepter ou à tester sur un seul volet) ; voie Tuya : identifiants cloud d'un tiers, CGU, fragile. Vie privée : **moyenne** (heures de lever et de coucher) → agrégats quotidiens seulement |

**Verdict** : pas de voie cloud fiable. #200 reste en v1.6 mais **dépend du pont local** (§ 9) ;
la saisie manuelle reste le repli. Un commentaire est ajouté à #200.

## 3. Intuis (radiateurs Muller, chauffe-eau, passerelle NMG, relais NMR)

**Disponible** : voir [audit-donnees.md § 2.1 à 2.3 et § 6](../audit-donnees.md). Seule voie :
l'API non officielle de l'application (cloud). L'intégration HACS
[intuis-connect](https://github.com/antoine-pyre/intuis-connect) lit le même serveur : Home Assistant
n'apporterait **aucune donnée Intuis nouvelle**.

**Collecté et exploité** : énergie par pièce (jour, heure sur un an), HP/HC, températures et consignes
au jour, chauffe-eau au niveau du module NMW, état horaire (`open_window`, boost, mode, `radiator_state`,
`offload`, `contactor_mode`, présence en option).

**Déjà en issues** : #214 (`reachable` des modules), #216 (firmware, `setup_date`), #217 / #224
(températures et énergie au pas horaire / 30 min sur 4 ans), #218 (`anticipating`, `lowering`),
#211 (plannings), #210 (absences).

**Relecture du § 6 de l'audit : ce qui a été vu sur le compte réel et n'a pas d'issue**

| Donnée vue | Où | Usage proposé | Valeur | Effort | Issue |
|---|---|---|---|---|---|
| `uptime` de la passerelle NMG | `homestatus`, module NMG | **une remise à zéro = coupure de courant ou redémarrage** de la passerelle, datée à l'heure près. Distingue un trou « secteur coupé » d'un trou « Internet coupé » ou « serveur Intuis en retard » | **forte** (qualité des données) | S | S-1.27 (#276) |
| `wifi_strength` de la passerelle | idem | Wi-Fi faible → trous ; justifie un CPL Wi-Fi près de la passerelle | moyenne | S | S-1.27 (#276) |
| `therm_setpoint_day_color_type` | idem | couleur Tempo **vue par la passerelle** : secours si api-couleur-tempo.fr tombe (risque « moyen » dans [juridique.md](../juridique.md)), contrôle croisé | moyenne | S | S-1.29 (#278) |
| `contract_power_unit`, `zones[].price`, `price_type`, `tariff`, `tariff_option` des plannings | `homesdata` | vérifier que le contrat saisi dans l'application Intuis (option, prix) est cohérent avec celui de l'archive (`contract.ts`) ; un mauvais tarif chez Intuis fausse son découpage `$1`/`$2` | moyenne | S | S-1.29 (#278) |
| `therm_absence_autoaway`, `therm_absence_notification`, `temperature_control_mode` | `homesdata` | contexte de #210 (absences) : savoir si l'absence automatique est active | faible | S | ajouté en commentaire de #210 si besoin, pas d'issue |
| Relais **NMR** (×5) | modules | aucune mesure servie (« ne renvoient rien », [api-notes.md](../api-notes.md)) ; seulement `reachable` / `last_seen`, couverts par #214 | — | — | #214 |

**À noter** : la mesure du chauffe-eau par Intuis (`$1`/`$2` au module NMW) n'est pas documentée :
mesure réelle ou estimation (temps de contacteur × puissance nominale) ? Une **pince** sur son circuit
(§ 11) tranche la question.

**Risques** : API non officielle (risque d'arrêt **élevé**, [juridique.md](../juridique.md)) ; les
ajouts ci-dessus ne coûtent **aucun appel** (champs déjà reçus). Vie privée : faible (états techniques).

## 4. Enedis / Linky

**Disponible**

| Voie | Données | Accès | Source |
|---|---|---|---|
| Conso API (conso.boris.sh → Enedis « mesures synchrones v2 ») | `consommation_quotidienne`, `courbe_de_charge_consommation` (30 min), `puissance_conso_max_quotidienne` (`mesuresPas` P1D/P1M, `grandeurPhysique` PMA/TOUT), production (sans objet ici), **`index_consommation`** | cloud, jeton Conso API (déjà en secret) | [conso.boris.sh/migration-2026](https://conso.boris.sh/migration-2026) |
| Espace client Enedis | exports CSV manuels (mêmes données) | navigateur | — |
| **Prise TIC du compteur** (téléinformation client) | puissance apparente **en continu** (~ chaque seconde, remontée ~ chaque minute par les modules courants), index **par cadran** (HP/HC, 6 cadrans Tempo), couleur Tempo du jour et du lendemain (mode historique), dépassement de puissance | **local seulement** : module ZLinky (Zigbee) ou TIC Wi-Fi | [ZLinky sur Domadoo](https://www.domadoo.fr/en/home-automation-boxes/5914-lixee-tic-module-to-zigbee-30-for-linky-meter-3770014375148.html), [forum HACF](https://forum.hacf.fr/t/zlinky-tic-ou-connecter-simplement-linky-en-zigbee/7112?page=23) |

| | |
|---|---|
| **Collecté** | quotidien, courbe 30 min, puissance max quotidienne (heure jetée : #219) |
| **Manque (cloud, oublié par l'audit)** | **`index_consommation`** : l'audit (§ 2.5) dit « index non servis par la Conso API » ; la page de migration 2026 annonce le contraire. Format (cadrans distributeur / fournisseur, Tempo) **à confirmer par l'inventaire**. Aussi : `grandeurPhysique=TOUT` (contenu inconnu, à inventorier) |
| **Manque (local)** | puissance à la minute, index par cadran en temps réel, dépassements |
| **Valeur** | index : **forte** pour recouper la facture (relevés d'index = base légale de la facturation), retrouver la part HP/HC ou Tempo **réelle** par jour sans la recalculer depuis la courbe, détecter une programmation HC décalée du compteur. TIC : moyenne, la courbe 30 min couvre déjà l'essentiel ; utile pour attribuer les pics (démarrage du chauffe-eau, des radiateurs) à la minute |
| **Comment** | index : un appel de plus par nuit dans `collector/enedis.py`, inventaire d'abord. TIC : module + pont local (§ 9) |
| **Effort** | index S-M ; TIC M (avec pont existant) à L |
| **Risques** | index : faible (même accord Enedis). TIC à la minute : vie privée **élevée** (signature fine des usages) → agrégats 30 min ou quotidiens seulement dans l'archive |

## 5. Orange Livebox

**Disponible** (API locale « sysbus », JSON, mot de passe administrateur de la box ; aucune API cloud
publique)

| Donnée | Valeur pour l'archive | Vie privée |
|---|---|---|
| État du lien Internet (WAN), type de lien | **forte** pour la qualité : un trou de collecte pendant une coupure Internet n'est pas une panne d'appareil | faible |
| **Uptime** et **raison du dernier redémarrage** | **forte** : redémarrage = coupure secteur ou mise à jour ; recoupe l'`uptime` de la passerelle Intuis | faible |
| Puissance optique fibre Rx/Tx, débits de synchro | faible (santé de la ligne) | faible |
| Débits LAN / Wi-Fi, baux DHCP | faible | moyen |
| **Liste des appareils connectés** (« device tracker »), signal par appareil | **à exclure** : c'est une donnée de **présence** (qui est à la maison, quand) | **élevé** |
| Journal d'appels | **à exclure** : hors sujet | **élevé** |
| Consommation de la box | **non mesurée** par la box ; 7 à 8 W annoncés pour une Livebox 6, soit ≈ 60-70 kWh/an | — |

Sources : intégration HACS [hass-livebox-component](https://github.com/Cyr-ius/hass-livebox-component)
(locale, interrogation chaque minute ; capteurs WAN, uptime, raison du redémarrage, fibre, appareils,
appels ; Livebox 3 à 7, **sauf** Livebox 6+ Arcadyan et 7 ZTE), bibliothèques
[aiosysbus](https://pypi.org/project/aiosysbus/) et [sysbus](https://pypi.org/project/sysbus),
exportateur Prometheus [livebox-exporter](https://github.com/jeanfabrice/livebox-exporter) ;
consommation : [Echosdunet](https://www.echosdunet.net/aide/reduire-facture-electrique-box),
[Selectra](https://selectra.info/telecom/actualites/marche/box-internet-allumee-cout-electricite-an).

| | |
|---|---|
| **Collecté** | rien |
| **Comment** | pont local sur le Synology (§ 9), ou Home Assistant + intégration HACS puis import. Une lecture toutes les 5 à 15 minutes suffit pour dater une coupure ; seuls des **événements datés** (coupure Internet de/à, redémarrage à) et un taux de disponibilité quotidien entrent dans l'archive |
| **Effort** | M (avec pont) |
| **Risques** | API non documentée, change avec les mises à jour Orange (signalé par sysbus) ; mot de passe admin de la box sur le NAS (jamais dans GitHub). **Minimisation** : aucune liste d'appareils, aucun nom, aucune adresse MAC, aucun journal d'appels, même chiffrés ; si un jour on veut un « nombre d'appareils connectés », il faut l'accord explicite du foyer, comme `ROOM_STATE_PRESENCE` |

## 6. Synology (NAS)

**Disponible**

| Voie | Données | Source |
|---|---|---|
| Intégration officielle HA [synology_dsm](https://home-assistant.io/integrations/synology_dsm) (API web DSM, compte administrateur) | température, **uptime** (désactivé par défaut), charge CPU, mémoire, état et remplissage des volumes, température et état SMART des disques | doc HA |
| SNMP (MIB Synology) | température système, **état d'alimentation**, état des disques, onduleur (UPS) | [MIB Guide Synology](https://cndl.synology.cn/download/Document/Software/DeveloperGuide/Firmware/DSM/All/enu/Synology_DiskStation_MIB_Guide.pdf) |
| Journal DSM | coupures de courant et arrêts (avec un onduleur USB : « passage sur batterie », arrêt sûr) | DSM |
| Consommation | **non mesurée** ; fiche d'un modèle courant 2 baies (DS220+) : 14,7 W en accès, 4,4 W disques en veille, soit ≈ 40 à 130 kWh/an selon la mise en veille | [fiche Synology](https://www.synology.com/fr-fr/store/Refurbished%20DS220+) |

| | |
|---|---|
| **Collecté** | rien |
| **Valeur** | santé du NAS : faible pour l'énergie ; **uptime / coupures : forte** pour expliquer les trous (troisième témoin avec la passerelle Intuis et la box) ; consommation : moyenne (poste permanent du talon, réglage de la mise en veille des disques) |
| **Rôle principal** | **relais local** pour tout ce qui n'a pas de cloud (§ 9), et copie locale de l'application (#143) |
| **Effort** | S une fois le pont en place |
| **Risques** | compte DSM en lecture : créer un compte dédié non administrateur si l'API le permet (l'intégration HA exige un administrateur), sinon SNMP v3 en lecture seule. Vie privée : faible si on ne lit **ni** noms de fichiers, **ni** journaux de connexion des utilisateurs |

## 7. CPL devolo

**Disponible** : API locale des adaptateurs (celle de l'application devolo Home Network), lue par
l'intégration officielle HA [devolo Home Network](https://www.home-assistant.io/integrations/devolo_home_network)
et la bibliothèque `devolo_plc_api` : **débit PHY** entre chaque paire d'adaptateurs (montant et
descendant), nombre d'adaptateurs, appareils raccordés (Wi-Fi des modèles Wi-Fi), firmware, LED,
redémarrage. Aucune mesure de consommation. Consommation des fiches : Magic 2 LAN ≈ 2,8 W typique
(4,8 W max) ; LAN triple ≈ 5 W ; modèles Wi-Fi jusqu'à 12 W
([fiche 2024](https://www.secomp.ch/media/pdf/s21/21223856_en_data_2024.pdf),
[IT-Connect](https://www.it-connect.fr/test-devolo-magic-2-wifi-du-cpl-et-du-wifi-mesh-dans-le-meme-boitier/)).

| | |
|---|---|
| **Collecté** | rien |
| **Valeur** | **faible** pour l'énergie. Deux usages réels : (1) le débit PHY baisse quand un appareil bruyant tourne sur le réseau électrique (la doc HA en fait un exemple d'automatisation) : curiosité, pas une mesure ; (2) la disponibilité de l'adaptateur qui sert la passerelle Intuis ou une future pince Shelly explique des trous. Leur veille (≈ 25-45 kWh/an par adaptateur) se mesure une fois avec une prise |
| **Effort** | S avec le pont, sinon rien |
| **Risques** | liste des appareils raccordés = **présence** → à exclure. Vie privée sinon faible |

**Verdict** : la dernière source à brancher ; à faire seulement si le pont tourne déjà.

## 8. Station Netatmo

**Disponible et collecté** : voir [audit-donnees.md § 2.4 et § 6](../audit-donnees.md). API officielle,
cloud, accessible depuis GitHub Actions.

**Déjà en issues** : #215 (piles, radio, `last_seen`), #216 (firmware), #220 (pression, bruit),
#221 (vent via Open-Meteo), #213 (clés stables, à fusionner **avant** la pose d'un module).

**Relecture : ce qui n'a pas d'issue**

| Donnée | Usage | Valeur | Décision |
|---|---|---|---|
| `wifi_status`, `reachable` du module principal | le module principal est en Wi-Fi : un Wi-Fi faible explique les trous de toute la station | moyenne | **ajouté à #215** (même document, même alerte) |
| `date_min_temp` / `date_max_temp` | heure du minimum intérieur (relance tardive) | faible | déjà listé dans l'audit, sans issue ; à joindre à #217 si utile |
| `co2_calibrating` | marquer les jours de calibrage du CO₂ (valeurs douteuses) | faible | non |
| `getpublicdata` (stations publiques voisines) | vérifier que la sonde extérieure n'est pas au soleil (biais des DJU) en la comparant à la médiane des voisines et à Open-Meteo | faible à moyenne | non, à garder en idée (dépend de #204, coordonnées) |
| **Second module principal** (seconde station) | une station = un module principal, trois modules intérieurs au plus ; une seconde station n'apporte qu'une pièce de plus, plus cher qu'un module | faible | **non** (§ 11) |

Vie privée : bruit (#220) **élevé**, le reste faible à moyen (CO₂ ≈ occupation, déjà traité).

## 9. Le Synology comme passerelle locale

### 9.1 Ce qui tournerait sur le NAS

| Brique | Rôle | Prérequis |
|---|---|---|
| **Container Manager** (Docker) : conteneur « pont » | une image Python légère, la même base de code que `collector/` (nouveau sous-module `collector/local/`), lancée toutes les 10 minutes pour les sondes locales et une fois par nuit pour l'envoi | DSM 7.2+, ≈ 100 Mo de mémoire |
| Sondes locales du pont | Livebox (sysbus, mot de passe admin local), DSM (API ou SNMP), devolo (API locale), onduleur (NUT, intégré à DSM) | rien d'autre |
| **Home Assistant** (facultatif, VM Virtual Machine Manager) + Zigbee2MQTT | volets Wiser en Zigbee, capteurs d'ouverture, ZLinky ; le pont lit l'API REST de HA **sur le réseau local** (jeton HA qui ne quitte pas la maison) | NAS compatible VMM (gamme « Plus » x86, ≥ 2 Go libres) et coordinateur **réseau** SLZB-06 (pas de clé USB, peu fiable sous DSM 7) : voir [plateforme-domotique.md](plateforme-domotique.md) |
| Copie locale de l'application (#143) | clone nocturne du dépôt, sert la PWA sur le réseau local | indépendant du pont |

Le pont garde seulement, dans un petit fichier local, les relevés bruts des dernières 48 h, et en tire
**chaque nuit** des agrégats quotidiens et des événements datés (coupure de/à, redémarrage). Rien de
brut ne quitte la maison.

### 9.2 Pousser des données chiffrées sans mettre de secret dangereux à la maison

L'étude HA (#179) écartait le pont permanent (#25) parce qu'il demandait **la phrase de passe des
données et un jeton GitHub « Contents »** sur un appareil de la maison. Une **enveloppe scellée**
lève ces deux objections :

```
NAS (pont)                                   GitHub Actions (workflow « pont local »)
───────────                                  ──────────────────────────────────────────
agrégats du jour (JSON, quelques Ko)
  └─ chiffrés avec la CLÉ PUBLIQUE du dépôt  ──workflow_dispatch(payload)──▶  déchiffre avec la clé privée
     (boîte scellée X25519, libsodium)        jeton « Actions » seulement      (secret LOCAL_BRIDGE_KEY)
                                                                               valide le schéma (taille, champs)
                                                                               fusionne dans data/local.enc.json
                                                                               avec DATA_PASSPHRASE, commit
```

| Secret | Où | Que permet-il s'il fuit ? |
|---|---|---|
| Clé publique du pont | NAS (pas un secret) | rien |
| Jeton GitHub à grain fin, **dépôt unique, permission « Actions : écriture » seulement**, expiration ≤ 1 an | NAS | lancer des workflows : le workflow « pont local » refuse tout ce qui n'est pas une enveloppe valide ; aucune lecture ni écriture de code ou de données |
| Clé privée du pont | secret GitHub | rien sans les enveloppes |
| `DATA_PASSPHRASE` | secret GitHub, **jamais à la maison** | (inchangé) |
| Mots de passe Livebox, DSM, jeton HA | NAS seulement | accès local à ces appareils (déjà vrai sans le projet) |

Détails à respecter : la charge d'un `workflow_dispatch` est limitée (≈ 64 Ko au total pour les
entrées, à vérifier) → agrégats quotidiens seulement, un envoi par nuit, rattrapage de 7 jours au plus ;
le workflow partage le groupe de concurrence de la collecte nocturne (pas de commit concurrent) ; le
journal public n'affiche que des nombres (« 3 sources, 1 jour, 2 événements ») ; aucun port entrant,
pas d'exposition de HA ni de DSM sur Internet (voie 3 de l'étude HA, toujours écartée).

**Alternative la plus simple** (sans pont) : l'import manuel déjà en place (S-1.18, `import-ha`) avec
Home Assistant comme collecteur. Elle suffit pour les volets et les capteurs ; elle **ne suffit pas**
pour dater des coupures au fil de l'eau ni pour la box, qu'il faudrait de toute façon exporter à la main.

**Recommandation** : rouvrir #25 avec cette architecture (commentaire ajouté), en v2, et y rattacher
les sources locales (Livebox, Synology, devolo, TIC) comme issues filles.

## 10. Issues proposées

| Jalon | Issue | Source |
|---|---|---|
| v1.5 | S-1.27 (#276) · Coupures de courant et Wi-Fi de la passerelle Intuis (`uptime`, `wifi_strength`) | § 3 |
| v1.5 | S-1.28 (#277) · Index Linky par cadran (`index_consommation`) | § 4 |
| v1.5 | S-1.29 (#278) · Tarif, puissance et couleur Tempo connus d'Intuis : contrôle croisé et secours | § 3 |
| v1.5 | S-1.30 (#279) · Compteurs Shelly à pinces (EM Gen3, Pro EM) dans la collecte Shelly Cloud | § 11 |
| v1.6 | S-1.31 (#280) · Journal des incidents (coupures secteur, Internet, modules muets) dans Qualité | § 3, 5, 6 |
| v1.6 | S-4.14 (#281) · Recouper le chauffe-eau et les « autres usages » avec une pince | § 3, 11 |
| v2 | S-9.11 (#282) · Livebox : disponibilité Internet et redémarrages, sans liste d'appareils | § 5 |
| v2 | S-9.12 (#283) · Synology : uptime, coupures, onduleur, santé | § 6 |
| v2 | S-9.13 (#284) · CPL devolo : disponibilité et débits | § 7 |
| v2 | S-9.14 (#285) · Lecteur TIC Linky (ZLinky ou TIC Wi-Fi) | § 4 |
| v2 (#25) | Pont local à enveloppe scellée : commentaire sur #25 | § 9 |
| v1.6 (#200) | Volets Wiser : commentaire sur #200 | § 2 |
| v1.5 (#215) | Wi-Fi du module principal Netatmo : commentaire sur #215 | § 8 |

## 11. Achats recommandés (au-delà des prises Shelly)

### 11.1 Classement valeur / coût pour cette maison

Maison sur deux niveaux, chauffage par radiateurs Muller, chauffe-eau électrique, Linky, volets Wiser,
station Netatmo avec un emplacement intérieur libre.

| Rang | Achat | Prix indicatif | Ce qu'il débloque dans l'application | Dépendances | Fonctionne depuis GitHub Actions ? |
|---|---|---|---|---|---|
| **1** | **Shelly EM Gen3 + pince 50 A sur le circuit du chauffe-eau** (seconde pince facultative sur un autre circuit : cuisson, ou l'arrivée générale) | ≈ 53-58 € ([shelly.com](https://www.shelly.com/fr/collections/30m-devices-sold-regular?page=3), [Domadoo](https://www.domadoo.fr/fr/energie-domotique/7569-shelly-compteur-d-energie-wi-fi-shelly-em-gen3-3800235261873.html?domid=6)) | **mesure réelle** du chauffe-eau, à comparer à la valeur Intuis (mesurée ou estimée ?) ; second canal : un poste des « autres usages » mesuré au lieu d'être déduit ; mieux, sur l'arrivée générale, un recoupement avec le Linky | pose dans le tableau par un électricien (≈ 1 h ; la pince ne coupe rien mais le tableau est sous tension) ; Wi-Fi au tableau ; S-1.30 (#279) car le collecteur actuel ne lit pas `em1data` | **oui** (Shelly Cloud) |
| **2** | **Module intérieur Netatmo** (NIM01) | ≈ 45-80 € selon promotions ([Les Alexiens](https://www.lesalexiens.fr/labo-test-alexa/test-netatmo-module-additionnel-interieur-pour-la-station-meteo), [Domomat](https://www.domomat.com/30160-module-additionnel-interieur-pour-station-meteo-de-netatmo-netatmo-nim01-ww.html)) | chambre des parents : CO₂ de nuit, écart sonde du radiateur / réel (S-3.8), confort mesuré ([module-interieur.md](module-interieur.md)) ; **zéro code** | #213 fusionnée avant la pose | **oui** |
| **3** | **Onduleur** USB pour le NAS et la box (≈ 500-700 VA) | ≈ 70-100 € (à vérifier) | coupures secteur **datées** dans le journal DSM / NUT, et le pont local qui survit à une micro-coupure ; protège le NAS | pont local (v2) pour remonter les événements | non (local) |
| **4** | **Coordinateur Zigbee réseau SLZB-06** + **4 à 6 capteurs d'ouverture** (SONOFF SNZB-04P ou Aqara) | ≈ 35 € ([Domadoo, Domo-blog](https://www.domo-blog.fr/optimisez-domotique-zigbee-avantages-dongle-poe-slzb-06-zigbee2mqtt-zha)) + 4-6 × 10-18 € | fenêtres ouvertes **mesurées** (vérité terrain pour `open_window`), position des volets Wiser si on les passe en Zigbee (#200) | Home Assistant en VM sur le NAS (compatibilité VMM à vérifier) ; décision go / no-go de [home-assistant-zigbee.md](home-assistant-zigbee.md) | non (import HA ou pont) |
| **5** | **Lixee ZLinky** (TIC → Zigbee) | ≈ 47-49 € ([Domo-blog, juillet 2026](https://www.domo-blog.fr/promo-deal-soldes-domotique-lixee/)) | puissance à la minute, index par cadran, couleur Tempo locale, pics attribués à la minute | le coordinateur du rang 4 (même réseau Zigbee) ; alimenté par le compteur, aucune pile | non |
| 6 | Shelly **Pro EM-50** (rail DIN, Ethernet, deux pinces fournies) | ≈ 100 € ([Domadoo](https://www.domadoo.fr/fr/energie-domotique/6804-shelly-compteur-d-energie-monophase-en-rail-din-wi-fi-shelly-pro-em-3800235268148.html?domid=6)) | comme le rang 1 avec deux circuits et une liaison filaire (Ethernet via un adaptateur CPL au tableau, si le Wi-Fi y est faible) | électricien ; place sur le rail | oui |
| 7 | Lecteur **TIC Wi-Fi** (ex. Cartelectronic WIFITIC ≈ 65 €, ou carte ESP32 type Denky D4 ≈ 27 $ à flasher) | 30-70 € ([Domadoo](https://www.domadoo.fr/en/devices/5803-cartelectronic-wi-fi-telematics-interface-3760313520066.html), [Lectronz](https://lectronz.com/products/denky-d4)) | comme le ZLinky, **sans Zigbee** (MQTT ou HTTP local) | pont local ; Wi-Fi au compteur | non |
| — | Shelly Pro 3EM | ≈ 130-150 € (à vérifier) | seulement si l'installation est **triphasée** (à vérifier sur le compteur) | électricien | oui |
| — | **Seconde station** Netatmo | ≈ 150-180 € | une pièce de plus, rien d'autre (une station = un seul module principal) | — | **non recommandé** |

**Pourquoi la pince en premier** : c'est le seul achat qui (a) ajoute une **mesure physique** sur le
plus gros poste après le chauffage, (b) passe par une source **déjà collectée depuis le cloud** (aucun
relais à la maison), (c) répond à une question ouverte de l'archive (fiabilité du chauffe-eau Intuis).

**Pourquoi le TIC n'est que 5ᵉ** : la courbe 30 min et, bientôt, les index (`index_consommation`)
arrivent déjà par le cloud. Le TIC n'apporte que la finesse à la minute, qui n'a de valeur qu'avec
Home Assistant en place.

### 11.2 Paliers de budget

| Palier | Contenu | Total indicatif | Ce que l'archive gagne |
|---|---|---|---|
| **≤ 50 €** | Une prise Shelly sur la multiprise « coin réseau » (box + NAS + CPL) pour mesurer le talon réseau en continu (≈ 20-25 €, déjà gérée par le collecteur) ; **ou** le module Netatmo en promotion (≈ 45-50 €) ; le Shelly EM Gen3 en promotion (≈ 50-53 €) est à la limite du palier | 20-50 € | talon réseau mesuré, ou une pièce de plus mesurée |
| **≤ 150 €** | Shelly EM Gen3 + pince chauffe-eau (≈ 55 €) + module Netatmo (≈ 60-80 €) + prise « coin réseau » (≈ 20 €) | ≈ 135-150 € | chauffe-eau mesuré, chambre des parents suivie, talon réseau mesuré : **tout depuis le cloud, sans relais** |
| **≤ 400 €** | palier 150 € + onduleur (≈ 80 €) + SLZB-06 (≈ 35 €) + 4 capteurs d'ouverture (≈ 50-70 €) + ZLinky (≈ 48 €) | ≈ 350-390 € | en plus : coupures datées, fenêtres réellement ouvertes, Linky à la minute ; **demande le pont local et Home Assistant sur le NAS** (temps d'installation : un à deux week-ends) |

**À vérifier avant tout achat** : monophasé ou triphasé (compteur), place et Wi-Fi dans le tableau,
modèle exact du NAS (VMM, mémoire), modèle de la Livebox (les Livebox 6+ Arcadyan et 7 ZTE ne sont
pas lues par l'intégration HACS), références des interrupteurs de volets.

## 12. Ce qu'il ne faut pas faire

- Exposer HA, DSM ou la box sur Internet pour que GitHub Actions les interroge.
- Collecter la liste des appareils de la box ou des CPL, le journal d'appels, des noms de fichiers du NAS.
- Mettre la phrase de passe des données ou un jeton « Contents » sur le NAS.
- Envoyer des commandes aux appareils depuis la collecte (l'archive lit, Home Assistant agit).

## Sources

Toutes les sources sont citées en ligne. Principales : [Conso API, migration 2026](https://conso.boris.sh/migration-2026) ;
intégrations Home Assistant [Synology DSM](https://home-assistant.io/integrations/synology_dsm),
[devolo Home Network](https://www.home-assistant.io/integrations/devolo_home_network),
[Livebox (HACS)](https://github.com/Cyr-ius/hass-livebox-component),
[Wiser (HACS)](https://github.com/asantaga/wiserHomeAssistantPlatform) ;
[Zigbee2MQTT S520567](https://www.zigbee2mqtt.io/devices/S520567.html) ;
[MIB Synology](https://cndl.synology.cn/download/Document/Software/DeveloperGuide/Firmware/DSM/All/enu/Synology_DiskStation_MIB_Guide.pdf) ;
[API Shelly EM1Data](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/EM1Data)
(`total_act_energy` en Wh) ; [jetons GitHub à grain fin](https://github.blog/security/application-security/introducing-fine-grained-personal-access-tokens-for-github/).
