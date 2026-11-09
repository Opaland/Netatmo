# Étude : passer, à long terme, sur une plateforme domotique ouverte

*Statut : terminée, novembre 2026. Rien à acheter tant que le besoin (volets, automatisations) n'est
pas confirmé. Prix indicatifs, à vérifier au moment de l'achat.*

## Le standard ouvert et la plateforme

- **Matter** (sur Wi-Fi/Ethernet ou **Thread**) est le standard ouvert de l'industrie. Aucun de vos
  appareils n'est en Thread aujourd'hui.
- **Zigbee 3.0** est le protocole de vos volets Wiser et de vos ampoules Hue.
- **Home Assistant** (open source) est la plateforme qui parle tout cela, en local.

| Appareil | Dans Home Assistant | Remarque |
|---|---|---|
| Radiateurs Intuis + chauffe-eau | Intégration HACS [intuis-connect](https://github.com/antoine-pyre/intuis-connect) | Chauffe-eau Aqua Manager non mentionné (à vérifier) ; ce projet reste la meilleure archive long terme |
| Station Netatmo (salon, chambre, cave, extérieur) | Intégration officielle [Netatmo](https://www.home-assistant.io/integrations/netatmo/) | Cloud, interrogation périodique |
| Volets Wiser | Zigbee direct (ZHA / Zigbee2MQTT) ou HACS via la passerelle | Voir [volets-wiser.md](volets-wiser.md) |
| Hue | Intégration officielle locale (pont Hue) ou Zigbee direct | Les ampoules renforcent le maillage Zigbee |
| Linky | Module [ha-linky](https://github.com/bokub/ha-linky) | Même source (Conso API) que ce projet |
| CPL, box | — | Réseau seulement, rien à piloter |

## Où l'installer

| Option | Pour | Contre | Coût indicatif |
|---|---|---|---|
| **Synology, machine virtuelle HA OS** (Virtual Machine Manager) | Pas de nouveau boîtier ; HA complet (modules complémentaires) | NAS compatible VMM requis (x86, gammes « Plus » ou supérieures), ≥ 2 Go réservés ; clé USB peu fiable sous DSM 7 → coordinateur **réseau** | ≈ 50 € (coordinateur SLZB-06) |
| Synology, conteneur Docker | Simple | **Pas de modules complémentaires**, mises à jour manuelles, pilotes USB retirés de DSM 7 | — (déconseillé) |
| **Votre Raspberry Pi** (à remonter) + HA OS | Matériel déjà là | Pi 4 ≥ 2-4 Go requis ; démarrer sur **SSD** (la carte SD s'use) ; alimentation officielle | ≈ 25-40 € (SSD) + 45 € (clé ZBT-2) |
| Home Assistant Green | Prêt à l'emploi, officiel | Pas de radio intégrée | ≈ 180 € + 45 € (clé) |
| Mini-PC Intel N100 | Puissant, SSD | Plus cher, à installer | ≈ 150-250 € + 45 € |

Sources : [installation officielle](https://www.home-assistant.io/installation/),
[Raspberry Pi](https://www.home-assistant.io/installation/raspberrypi),
[Zigbee2MQTT sur Synology](https://www.zigbee2mqtt.io/guide/installation/docker/docker_synology.html).

## Matériel qui vous manquerait

| Besoin | Matériel | Prix indicatif |
|---|---|---|
| Faire tourner Home Assistant | Rien si NAS compatible VMM ou Pi 4 ≥ 2 Go ; sinon Home Assistant Green | 0 à 180 € |
| Disque pour le Pi | SSD USB (ou NVMe sur Pi 5) | 25-40 € |
| Parler Zigbee (volets, Hue) | Coordinateur : **SLZB-06** (Ethernet, idéal avec le NAS) ou **Connect ZBT-2** (USB, idéal avec le Pi) | 45-60 € |
| Matter / Thread | Rien pour l'instant ; Apple TV, HomePod mini ou Google Nest Hub servent déjà de routeur Thread si vous en avez | 0 € |
| Mesurer une veille (facultatif) | Prise Zigbee avec mesure de consommation | 15-25 € |

**À vérifier avant d'acheter** : le modèle de votre NAS (compatibilité VMM, mémoire libre), le modèle
de votre Raspberry Pi, la présence d'un pont Hue, les références de vos interrupteurs de volets.

## Recommandation

1. **Ne rien acheter maintenant.** Le besoin le plus clair (fermer les volets le soir en hiver) se règle
   avec les programmations de l'application Wiser.
2. Si vous voulez aller plus loin : **remonter le Raspberry Pi** (s'il s'agit d'un Pi 4 ≥ 2 Go) avec
   un SSD et une clé ZBT-2, installer **HA OS**, puis y brancher Intuis, Netatmo, Hue et les volets.
   Budget ≈ 70-90 €. Alternative sans boîtier : VM sur le Synology + SLZB-06 (≈ 50 €).
3. Ce projet reste **l'archive et l'outil d'analyse** (historique depuis 2022, comparaisons, coût,
   comparateur d'offres). Home Assistant devient **l'outil d'action**. Un pont entre les deux n'est
   utile que si une mesure (S-9.0) montre un effet des volets.
