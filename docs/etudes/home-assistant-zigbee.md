# Étude : Home Assistant et Zigbee au service de l'archive

*Statut : terminée, novembre 2026. Récit S-9.9 (#179). Complète
[plateforme-domotique.md](plateforme-domotique.md) (où installer Home Assistant, pour piloter) et
[volets-wiser.md](volets-wiser.md) (faut-il automatiser les volets) : ici, la seule question est
**ce que Home Assistant et des capteurs Zigbee apporteraient à l'archive**, et comment leurs
données y entreraient. Prix indicatifs relevés en novembre 2026, à vérifier au moment de l'achat.
Décision en fin de document.*

## Ce que l'archive sait déjà, sans rien acheter

| Question | Source actuelle | Limite |
|---|---|---|
| Combien chaque pièce et le chauffe-eau consomment, par heure | Intuis (radiateurs, Aqua Manager) | — |
| Combien consomme tout le logement, par demi-heure | Linky (Conso API) | « Autres usages » non détaillés |
| Température réelle et CO₂ du salon, de la chambre des enfants, de la cave ; extérieur | Station Netatmo (4 modules, un emplacement intérieur libre : [module-interieur.md](module-interieur.md)) | Pièces sans module |
| Fenêtre ouverte, présence, boost, état des radiateurs | `homestatus` Intuis (#162, épopée E13) | **Instantané seulement**, détection par chute de température (déduite, pas mesurée) |
| Gros appareils (réfrigérateur, lave-linge…) | Prises Shelly via le Shelly Cloud, sans hub (S-1.17, #158) | Une prise par appareil |

## Ce que Home Assistant et Zigbee ajouteraient

| Capteur | Prix indicatif | Ce qu'il apporte à l'archive | Déjà couvert ailleurs ? | Valeur pour l'archive |
|---|---|---|---|---|
| **Ouverture de fenêtre** Zigbee (ex. SONOFF SNZB-04P, Aqara) | 10-18 € pièce | La **vérité terrain** des fenêtres ouvertes : durée d'ouverture par pièce et par jour, à croiser avec la consommation et avec `open_window` d'Intuis (taux d'accord, S-1.18) | En partie : `open_window` Intuis, déduit et seulement si E13 l'historise | **Forte**, si E13 montre que les aérations pèsent (pics de consommation inexpliqués) |
| **Sonde de température / humidité** Zigbee (ex. SONOFF SNZB-02P, Aqara) | 10-20 € pièce | Température réelle d'une pièce sans module Netatmo | Oui pour une pièce : l'emplacement libre de la station (S-3.10) ; sonde du radiateur partout | Moyenne : utile au-delà de la 4ᵉ pièce mesurée |
| **Prise avec mesure** Zigbee | 15-25 € pièce | Énergie par appareil | Oui : prises Shelly via le cloud (S-1.17), sans hub | Faible : doublon de S-1.17 tant que Home Assistant n'existe pas |
| **Position des volets** Wiser (Zigbee direct ou passerelle) | 0 € (déjà installés) | Heure de fermeture réelle, pour mesurer l'effet des volets dans la signature (S-9.2) | Non (journal manuel de S-9.0) | Moyenne, seulement si S-9.0 montre un effet |
| **Pince ou module de tableau** (ex. Shelly EM, Zigbee) | 40-80 € | Un circuit entier (four, plaques) | Linky pour le total | Faible ici |

Ce que Home Assistant n'apporte **pas** : une meilleure mesure du chauffage (Intuis reste la
source, l'intégration HACS [intuis-connect](https://github.com/antoine-pyre/intuis-connect) lit la
même API), ni du Linky (le module [ha-linky](https://github.com/bokub/ha-linky) lit la même Conso
API), ni de la station (l'intégration [Netatmo](https://www.home-assistant.io/integrations/netatmo/)
lit le même cloud). **Les seules données nouvelles sont celles des capteurs locaux.**

## Matériel et coût

L'hôte et la clé sont détaillés dans [plateforme-domotique.md](plateforme-domotique.md#où-linstaller).
En bref :

| Option | Hôte | Clé Zigbee | Coût hors capteurs |
|---|---|---|---|
| A · Raspberry Pi déjà possédé (Pi 4 ≥ 2 Go) | HA OS sur SSD (25-40 €) | **Home Assistant Connect ZBT-2** (USB, lancée en novembre 2025 à 49 $) | ≈ 75-90 € |
| B · Synology compatible Virtual Machine Manager | HA OS en machine virtuelle (≥ 2 Go réservés) | Coordinateur réseau **SLZB-06** (la clé USB est peu fiable sous DSM 7) | ≈ 50-60 € |
| C · Home Assistant Green | boîtier officiel | ZBT-2 | ≈ 230 € |

**À vérifier avant tout achat** : le modèle exact du NAS (gamme « Plus » x86, mémoire libre) et du
Raspberry Pi (Pi 4 ≥ 2 Go). Une installation en simple conteneur Docker sur le NAS est déconseillée
(pas de modules complémentaires, pilotes USB retirés de DSM 7).

Kit minimal utile à l'archive : option A ou B + **4 à 6 capteurs d'ouverture** sur les fenêtres des
pièces qui consomment le plus (≈ 50-90 €), soit **≈ 100-180 €** en tout.

## Comment les données arriveraient dans l'archive

Contraintes du projet : GitHub Actions est dans le cloud et **ne peut pas joindre** une machine de la
maison sans l'exposer ; les données doivent être **chiffrées** avant d'entrer dans le dépôt (AES-GCM,
clé dérivée de la phrase de passe) ; le jeton GitHub de l'application n'a volontairement que le droit
« Actions » (pas « Contents »).

### Ce que Home Assistant garde

- Tout capteur numérique avec une *state class* (`measurement`, `total`, `total_increasing`) a des
  **statistiques long terme** : agrégats toutes les 5 minutes (purgés avec l'historique, 10 jours par
  défaut), puis **par heure, jamais purgés** (moyenne / min / max pour une mesure ; `state` et `sum`
  pour un compteur, la consommation d'une période étant la différence des `sum`).
- Un capteur d'ouverture est un `binary_sensor` : il **n'a pas** de statistiques long terme. Il faut
  lui ajouter une aide **history_stats** (« durée ouverte aujourd'hui », en heures) par fenêtre, qui,
  elle, devient une statistique conservée.
- Les compteurs de prises (Shelly comme Zigbee) repartent parfois de zéro au redémarrage : la
  différence des `sum` le gère, pas un relevé brut.

### Trois chemins possibles

| Chemin | Fonctionnement | Secrets à la maison | Verdict |
|---|---|---|---|
| 1 · **Import à la main** (S-1.18) | Une fois par mois : export des statistiques depuis Home Assistant (CSV de l'historique, ou intégration [homeassistant-statistics](https://github.com/klausj1/homeassistant-statistics)), dépôt du fichier dans l'application, qui en tire des **agrégats quotidiens par capteur**, les **chiffre dans le navigateur** et les envoie à un workflow `workflow_dispatch` (le jeton « Actions » suffit) qui les commit | Aucun | **Retenu** : rien d'exposé, aucun service permanent, même modèle de confiance que Paramètres |
| 2 · Pont local permanent (S-9.1) | Conteneur sur le NAS ou le Pi qui, chaque nuit, lit l'API de Home Assistant, chiffre et pousse `local-YYYY.enc.json` | La phrase de passe des données **et** un jeton GitHub « Contents » sur un appareil allumé en permanence | Écarté tant que le chemin 1 suffit |
| 3 · La collecte nocturne interroge Home Assistant | GitHub Actions appelle Home Assistant par une URL publique (Nabu Casa ou tunnel) avec un jeton longue durée | Home Assistant exposé sur Internet, jeton d'administration en secret GitHub | **Écarté** : surface d'attaque disproportionnée |

Le format d'import suivrait l'**export long** déjà documenté
([`docs/export-long.md`](../export-long.md) : `date, source, entity, metric, value, unit`), avec
`source = home-assistant` et des métriques quotidiennes (`open_hours`, `temp_mean`, `energy_kwh`).
Les noms des capteurs sont des données personnelles (« fenêtre chambre ») : chiffrés comme le reste,
pseudonymisés dans tout envoi à l'IA.

## Face à Shelly Cloud et à `open_window` d'Intuis

- **Shelly Cloud (S-1.17)** couvre les prises **sans** Home Assistant ni clé Zigbee : c'est la voie
  la moins chère pour expliquer « autres usages ». Home Assistant n'y ajoute rien pour l'archive.
- **`open_window` d'Intuis** (E13, #162) est gratuit mais **déduit** (chute brutale de la température
  mesurée par le radiateur) et **instantané** : l'archive ne le voit que si la collecte l'interroge au
  bon moment. Un capteur d'ouverture est la seule façon de savoir si cette détection est fiable et
  ce qu'une aération coûte vraiment. C'est **le seul apport net** de Zigbee à l'archive.

## Risques

| Risque | Effet | Parade |
|---|---|---|
| Matériel acheté pour rien | 100-180 € | Attendre la mesure d'E13 (ci-dessous) |
| Maintenance (mises à jour HA, piles CR2477 tous les 2-5 ans, SSD) | Temps, pannes silencieuses | Import mensuel à la main : un mois manqué se rattrape, rien ne casse la collecte |
| Données d'occupation (fenêtres, présence) | Révèlent les habitudes du foyer | Agrégats quotidiens seulement, chiffrés ; cadre de S-13.5 appliqué avant tout import |
| Compatibilité NAS / Pi non vérifiée | Option d'hôte impossible | Vérifier les modèles avant achat ; option C en repli |
| Format d'export de Home Assistant qui change | Import cassé | Convertir côté application, tests sur des fichiers d'exemple anonymes |

## Décision

| Question | Décision | Condition de réouverture |
|---|---|---|
| Acheter Home Assistant + Zigbee **pour l'archive** cet hiver | **No-go** | **Go** si, après un hiver d'historique `open_window` (E13), les jours avec fenêtre ouverte représentent plus de 5 % du chauffage ou si la détection paraît incohérente (fenêtres signalées dans des pièces jamais aérées), **ou** si Home Assistant est installé de toute façon pour les volets |
| En cas de go | Kit minimal : hôte A ou B + ZBT-2 ou SLZB-06 + 4 à 6 capteurs d'ouverture ; pas de prises Zigbee (Shelly Cloud), pas de sondes tant que l'emplacement Netatmo libre n'est pas occupé | — |
| S-1.18 (#178) Import des statistiques HA | **Garder**, au jalon où le go est donné ; chemin 1 (import à la main chiffré dans le navigateur, workflow `workflow_dispatch`) | — |
| S-9.1 (#25) Pont local permanent | **À fermer, remplacé par S-1.18** : le pont demanderait la phrase de passe et un jeton « Contents » sur un appareil de la maison | Rouvrir seulement si l'import mensuel devient pénible |
| S-9.2 (#26) Effet des volets dans la signature | **Garder, conditionnel** : sa source reste le journal manuel de S-9.0 ; la position des volets via Home Assistant ne viendra qu'avec le go | — |
| Prises | **S-1.17 via Shelly Cloud**, sans hub | — |

La fermeture de S-9.1 et le passage de S-1.18 au jalon du go sont des propositions : le propriétaire
les applique lors du tri des issues.

## Sources

- Home Assistant, [statistiques long terme](https://contributors.home-assistant.io/data/reference/statistics/)
  (5 minutes purgées, heure jamais purgée ; `sum` pour les compteurs) et
  [entités capteur](https://contributors.home-assistant.io/core/entities/sensor/) (la *state class*
  active les statistiques) ; [Recorder](https://www.home-assistant.io/integrations/recorder/)
  (`purge_keep_days` = 10).
- Export / import de statistiques : intégration communautaire
  [klausj1/homeassistant-statistics](https://github.com/klausj1/homeassistant-statistics) ;
  [discussion sur l'export CSV](https://community.home-assistant.io/t/custom-integration-to-import-long-term-statistics-from-a-file-like-csv-or-tsv/689793).
- Clé ZBT-2 : [CNX Software, 20 novembre 2025](https://www.cnx-software.com/2025/11/20/home-assistant-connect-zbt-2-zigbee-thread-usb-adapter/),
  [Android Authority](https://www.androidauthority.com/home-assistant-connect-zbt-2-3617640) (49 $).
- Capteur d'ouverture : [SONOFF SNZB-04P](https://sonoff.tech/product/gateway-and-sensors/snzb-04p/)
  (ZHA et Zigbee2MQTT) ; [exposition dans Zigbee2MQTT](https://privatehomelab.com/sonoff-snzb-04p-door-window-sensor-zigbee2mqtt-home-assistant/).
- Prises Shelly et remise à zéro du compteur :
  [forum Home Assistant](https://community.home-assistant.io/t/power-consumption-reset-on-power-cycle/491724).
- Hôte (NAS, Pi, Green) : voir les sources de [plateforme-domotique.md](plateforme-domotique.md).
