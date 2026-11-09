# Étude : piloter les volets Wiser selon la température ou la consommation ?

*Statut : terminée, novembre 2026. Issues : S-9.4, S-9.5. Décision en fin de document.*

## L'idée

Ouvrir ou fermer automatiquement les volets roulants Schneider **Wiser** selon la température mesurée
(station Netatmo, intérieur et extérieur) ou la consommation électrique, et éventuellement mesurer la
part de consommation des volets.

## Ce que sont les volets Wiser (gamme française)

| Produit | Référence | Protocole | Remarque |
|---|---|---|---|
| Interrupteur de volet Wiser Odace | S520567 (W) | Zigbee 3.0 | Reconnu par Zigbee2MQTT (position, durée de course) ; **ne mesure pas la puissance** |
| Micromodule volet Wiser | CCT5015-0002W | Zigbee 3.0 | Annoncé compatible Zigbee2MQTT |
| Passerelle Wiser Gen 2 | CCT501801 | Wi-Fi + Zigbee | Nécessaire pour l'accès à distance ; pont Matter depuis 2025 mais **sans les volets** (à vérifier) |

**À relever chez vous** : la référence imprimée sur le mécanisme (sous l'enjoliveur) et celle de la
passerelle. Sources : [Zigbee2MQTT S520567](https://www.zigbee2mqtt.io/devices/S520567.html),
[FAQ Schneider](https://se.com/fr/fr/faqs/FAQ000264705).

**Il n'existe pas d'API cloud Wiser documentée.** On pilote les volets soit par l'intégration
communautaire Home Assistant [wiserHomeAssistantPlatform](https://github.com/asantaga/wiserHomeAssistantPlatform)
(via la passerelle), soit en appairant les interrupteurs directement à un coordinateur Zigbee
(ZHA ou Zigbee2MQTT, tout en local).

Conséquence pour ce projet : **GitHub Actions, dans le cloud, ne peut pas atteindre les volets.** Toute
commande passe par un équipement allumé en permanence chez vous (voir
[plateforme-domotique.md](plateforme-domotique.md)).

## Le gain attendu

| Levier | Effet | Ordre de grandeur pour la maison |
|---|---|---|
| Volets fermés la nuit en hiver | « jusqu'à 60 % » de pertes en moins **par les fenêtres** (ADEME) ; 15 à 33 % en double vitrage | Fenêtres ≈ 10 à 15 % des déperditions → **1 à 5 % du chauffage**, soit environ 60 à 300 kWh/an, **15 à 70 €/an** |
| Volets ouverts au soleil (façade sud) | Apports solaires gratuits | Faible à modéré, très dépendant de l'orientation |
| Volets fermés au soleil en été | Confort (pas de climatisation ici) | Pas d'économie d'électricité |

Sources : [Selectra / ADEME](https://selectra.info/energie/actualites/marche/volets-fermes-soir-60-pourcent-pertes-fenetres),
[Legrand](https://www.legrand.fr/pro/questions-frequentes/quelle-economie-de-chauffage-peut-on-realiser-grace-a-la-gestion-automatique-des-volets-roulants).
Les pourcentages sur la facture sont **des estimations à vérifier par la mesure**.

**L'essentiel du gain vient d'une règle simple : fermer au coucher du soleil en hiver.** La température
mesurée n'ajoute presque rien l'hiver ; elle sert surtout au confort d'été. La consommation électrique
n'est **pas** un bon déclencheur : elle suit le froid, qui est déjà connu par la température et l'heure.

## La consommation des volets

| Poste | Hypothèse | Par an |
|---|---|---|
| Moteurs | 8 volets × 2 manœuvres/jour × 20 s × 150 W | ≈ 5 kWh |
| Veille des interrupteurs connectés | 0,3 à 1 W chacun (à mesurer) | ≈ 20 à 70 kWh |
| Passerelle | 1 à 2 W | ≈ 10 à 18 kWh |
| **Total** | | **≈ 35 à 95 kWh, moins de 1,5 % du chauffage** |

Ce qui compte, c'est la **veille**, pas les manœuvres. Les interrupteurs S520567 ne mesurent pas la
puissance : un suivi continu demanderait du matériel en plus, pour un poste négligeable.

## Décision

| Question | Décision | Pourquoi |
|---|---|---|
| Construire une passerelle « volets » dans ce projet | **Non** | Gain de 15 à 70 €/an atteignable avec une simple règle horaire ; le pilotage relève d'une plateforme domotique locale, pas d'une application d'analyse dans le cloud |
| Automatiser les volets | **Oui, mais ailleurs, et simplement** | D'abord les programmations de l'application Wiser (coucher du soleil l'hiver). Plus tard, si vous installez Home Assistant : règles soleil + température Netatmo pour l'été |
| Mesurer l'effet | **Oui, avec ce projet** | Récit S-9.0 : noter 4 semaines d'hiver avec ou sans fermeture le soir et comparer la consommation nocturne à la signature énergétique (onglet Analyse) |
| Mesurer la consommation des volets | **Non (en continu)** | ≈ 35 à 95 kWh/an. Une mesure ponctuelle de la veille avec une prise wattmètre (≈ 15 €) suffit |
