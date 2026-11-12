# Historique énergie — Intuitiv with Netatmo

Archive **sur plusieurs années** la consommation de vos radiateurs **Muller Intuitiv / Intuis**
(Airelec, Noirot, Applimo, Campa) et de votre **chauffe-eau** (Aqua Manager), et l'affiche dans une
application web installable sur **Android et iPhone**.

Ce que l'application mobile ne fait pas, et que celle-ci fait :

- garder **tout l'historique** (depuis 2022 sur l'installation de référence), sans limite de durée ;
- **comparer les années** : mois par mois, cumul, saison de chauffe, et **à climat égal**
  (degrés-jours) ;
- un **verdict** du mois en euros (« conforme / plus élevé / plus économe que d'habitude ») et une
  **projection** de fin d'année ;
- le **coût réel** au tarif EDF en vigueur chaque jour, selon **votre contrat période par période**
  (offre, puissance souscrite), et un **comparateur Base / heures creuses / Tempo** ;
- la **puissance maximale appelée** (Linky) face à la puissance souscrite ;
- l'historique complet de la **station météo Netatmo** (tous les modules : température, humidité, CO₂) ;
- la **signature énergétique** du logement (kWh par jour selon la température extérieure), et selon
  l'**écart intérieur − extérieur** mesuré par la station, avec intervalles de confiance à 95 % ;
- un **calendrier** de consommation, des **profils horaires**, les **températures** des pièces ;
- la **part du chauffage et du chauffe-eau** dans la consommation totale (compteur **Linky**) ;
- **par pièce** : classement, évolution N-1 → N en cascade, détail mensuel ;
- un **rapport annuel** imprimable (PDF), avec le comparateur d'offres et la puissance maximale, et sa
  version **anonymisée** à remettre à un tiers (pièces en pseudonymes, ni nom, ni identifiant, ni
  donnée horaire, ni station) ;
- l'**export CSV** pour Excel et un **export long** JSON / CSV au format documenté
  ([docs/export-long.md](docs/export-long.md), schéma JSON publié) pour Home Assistant ou Node-RED,
  préparés dans le navigateur, sans rien envoyer ;
- un **export recherche** horaire anonymisé (pièces en pseudonymes, dates décalées, licence au choix,
  zone climatique facultative), vérifié par le détecteur du rapport anonymisé
  ([docs/export-recherche.md](docs/export-recherche.md)) ;
- le **recoupement avec une facture** : la période et le montant TTC d'une facture, comparés au coût
  calculé (compteur Linky × tarif du contrat + abonnement au prorata), écart expliqué (relevé estimé,
  jours manquants, abonnement, taxes) et part du chauffage et de l'eau chaude ;
- les **surfaces** des pièces et des **marqueurs « travaux »** datés (isolation, fenêtres,
  radiateur…) : signature avant / après (deux droites), kWh/m² et kWh par degré-jour ; ces saisies et
  les factures restent **chiffrées sur l'appareil** ;
- une **analyse du mois rédigée par l'IA** (Claude), facultative.

Tout tourne sur GitHub, gratuitement, sans serveur à maintenir :

```
GitHub Actions (chaque nuit)                       GitHub Pages
  collecteur Python ── API Intuis ──► data/*.enc.json ──► application (PWA)
  (chiffre les données avant commit)   (illisibles)        déchiffre sur votre téléphone
```

Les données sont **chiffrées** (AES-256-GCM) avant d'être enregistrées dans le dépôt, qui peut donc
rester public. Seule votre phrase de passe permet de les lire, et le déchiffrement se fait
uniquement dans votre navigateur.

> **Avertissement** : l'application Intuis n'a pas d'API publique. Ce projet utilise le même serveur
> que l'application mobile, comme les intégrations Home Assistant existantes. Ce n'est ni officiel ni
> garanti : l'accès peut changer ou être coupé. Les données déjà collectées restent dans votre dépôt.
> Détails dans [docs/api-notes.md](docs/api-notes.md) et [docs/etude-marche.md](docs/etude-marche.md) ;
> conditions d'utilisation de chaque service, date de lecture et risque d'arrêt dans
> [docs/juridique.md](docs/juridique.md) (aussi dans l'appli : Paramètres → **Cadre juridique**).

## Essayer sans compte

L'application contient des **données de démonstration** : ouvrez-la et touchez
« Essayer avec des données de démonstration ». Elles montrent toutes les vues : station météo
(avec relevés horaires), Linky et sa courbe de charge, contrat en deux périodes (Base puis heures
creuses), comparateur Tempo, et des trous de données comme sur un vrai compte (jours perdus chez
Intuis en février-mars et novembre 2024, jours estimés en décembre 2023, deux jours « suspects » en
janvier 2025).

## Installation (une seule fois, environ 15 minutes)

### 1. Choisir une phrase de passe

Elle chiffre vos données. Prenez **au moins 5 mots** au hasard (ex. `pivoine tracteur lagune
moustache onze`) : le dépôt étant public, une phrase courte pourrait être devinée. Notez-la : sans
elle, les données sont perdues.

### 2. Identifiants d'application

Le serveur Intuis demande, en plus de votre e-mail et de votre mot de passe, les identifiants OAuth
(`client_id` et `client_secret`) **de l'application mobile**. Ils ne sont délivrés à personne
officiellement. Les intégrations open source les incluent dans leur code, par exemple
[intuis-connect](https://github.com/antoine-pyre/intuis-connect) (fichier `const.py`). Ce dépôt ne les
contient pas : vous les ajoutez en secret.

### 3. Ajouter les secrets dans GitHub

Dans le dépôt : **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Valeur |
|---|---|
| `INTUIS_USERNAME` | e-mail du compte Intuis / Intuitiv |
| `INTUIS_PASSWORD` | mot de passe du compte |
| `INTUIS_CLIENT_ID` | voir étape 2 |
| `INTUIS_CLIENT_SECRET` | voir étape 2 |
| `DATA_PASSPHRASE` | votre phrase de passe (étape 1) |

### 4. Activer GitHub Pages

**Settings → Pages → Build and deployment → Source : GitHub Actions**.

### 5. Première collecte

**Actions → Collecte quotidienne → Run workflow**, en cochant **« Récupérer tout l'historique
disponible »**. La collecte remonte année par année tant que le serveur renvoie des données, puis
publie le site. Ensuite, elle tourne seule chaque nuit (vers 5 h-6 h, heure de Paris).

L'adresse du site s'affiche dans **Settings → Pages** (de la forme
`https://<utilisateur>.github.io/<dépôt>/`).

### 6. Installer sur le téléphone

- **iPhone** : ouvrir l'adresse dans Safari → bouton Partager → **Sur l'écran d'accueil**.
- **Android** : ouvrir l'adresse dans Chrome → menu ⋮ → **Installer l'application**, ou le bouton
  **Installer l'application** de ⚙ Paramètres → À propos quand Chrome le propose.

**Mises à jour** (#357) : une nouvelle version attend qu'on la demande ; un bandeau « Nouvelle version
disponible » propose **Recharger** (rien ne se recharge tout seul). Une appli qui semble bloquée sur une
ancienne version : ⚙ Paramètres → À propos → **Recharger l'application** retélécharge le code sans
toucher à la clé mémorisée, aux notes chiffrées ni aux données gardées hors connexion.

**Inviter un membre du foyer** : Paramètres → **Inviter** affiche un QR code de l'adresse de l'appli
et ces étapes ; le proche le scanne, installe l'appli, et vous lui **dites la phrase de passe de vive
voix**. Voir [Inviter un membre du foyer](#inviter-un-membre-du-foyer-s-123) pour ce que contient le
QR code (et ce qu'il ne contient jamais).

Entrez votre phrase de passe une fois ; « Rester connecté sur cet appareil » garde une clé
non exportable dans le navigateur, **30 jours au plus** (⚙ Paramètres → Verrouiller maintenant l'efface).
Sans activité (toucher, clavier) pendant **15 minutes**, l'application se verrouille d'elle-même :
les données déchiffrées, la clé mémorisée et le jeton GitHub sont oubliés, la phrase est redemandée.
Le délai se règle dans ⚙ Paramètres → Sécurité (5 min, 15 min, 1 h, ou jamais sur cet appareil) ; il compte aussi
quand l'onglet est fermé, si bien qu'un téléphone volé ne livre pas l'historique.

Sur iPhone, iOS peut **effacer la clé mémorisée** (quelques jours sans ouvrir l'appli dans Safari, ou
manque de place) : l'appli le détecte et l'écrit (« iOS a effacé la clé, vos données sont intactes »),
puis redemande la phrase. Les données ne sont pas touchées : elles restent chiffrées dans le dépôt.
L'appli demande au navigateur de conserver son stockage (`navigator.storage.persist()`) ; l'installer
sur l'écran d'accueil le protège mieux. Les notes privées de l'appareil (absences, factures, travaux)
sont, elles, perdues avec le stockage. Chaque version est testée sur WebKit (moteur de Safari) en CI.

### Le plus simple : l'écran Paramètres

Une fois l'application ouverte (⚙ Paramètres → **Sources de données**), vous pouvez saisir vos
identifiants directement : l'application les **chiffre dans votre navigateur** avec la clé publique du
dépôt (le procédé imposé par GitHub) et les enregistre comme secrets, puis peut lancer la collecte.

Il faut pour cela un [jeton GitHub « fine-grained »](https://github.com/settings/personal-access-tokens/new) :
accès au seul dépôt, permissions **Secrets : lecture et écriture**, **Variables : lecture et écriture**
(pour lire puis supprimer les anciennes variables en clair en les migrant en secret : réglages du foyer, contrat partagé, alerte froid) et **Actions : lecture et écriture**, rien d'autre, expiration courte. Le jeton reste en mémoire le temps de la visite et
l'application ne l'enregistre jamais. Les champs du jeton et des identifiants ne sont pas dans un formulaire
et sont marqués pour que le navigateur et les gestionnaires de mots de passe courants ne proposent pas de
les mémoriser ; aucun navigateur ne le garantit : s'il le propose quand même, refusez.
La phrase de passe des données ne se change pas ici (voir plus bas).

### Changer de phrase de passe

1. Ajoutez le secret `NEW_DATA_PASSPHRASE` (la nouvelle phrase, 5 mots ou plus).
2. Lancez **Actions → Changer la phrase de passe** : tout est rechiffré et la robustesse vérifiée.
3. Remplacez la valeur de `DATA_PASSPHRASE` par la nouvelle phrase, puis supprimez `NEW_DATA_PASSPHRASE`.

En local : `python -m collector strength` estime la robustesse de la phrase actuelle.

### Sauvegarde chiffrée (hors GitHub)

Tout l'historique tient dans le dépôt. Pour ne pas dépendre d'un seul compte, Outils → Exporter mes données (ou ⚙ Sécurité) →
**Télécharger une sauvegarde chiffrée** : un seul fichier `sauvegarde-energie-AAAA-MM-JJ.json`
contient `keyinfo.json` et tous les fichiers `*.enc.json` connus (années, horaires, station,
courbe Linky, météo, analyse…), **toujours chiffrés** : rien n'est déchiffré pour le construire.
Le jeton Netatmo (`netatmo-token.enc.json`) n'y est pas : il change à chaque collecte. Gardez ce
fichier où vous voulez (clé USB, NAS) ; sans la phrase de passe il est illisible.

Pour restaurer (nouveau dépôt, autre machine) :

```bash
export DATA_PASSPHRASE="la phrase de passe"
python -m collector restore-backup sauvegarde-energie-2026-11-09.json --dry-run   # vérifie sans écrire
python -m collector restore-backup sauvegarde-energie-2026-11-09.json             # écrit dans data/
python -m collector verify                                                        # mêmes totaux que l'appli
```

Chaque fichier est déchiffré en mémoire avec `DATA_PASSPHRASE` avant d'écrire quoi que ce soit :
une mauvaise phrase ou un fichier abîmé arrête la restauration. Les fichiers sont ensuite écrits
tels quels (toujours chiffrés) dans `data/` (ou `DATA_DIR`), en remplaçant ceux du même nom ;
commitez-les pour que le site les serve.

### Options (facultatives)

Chaque option s'active en ajoutant des secrets. Sans eux, l'application fonctionne normalement.

**Météo.** Rien à faire : les températures de votre commune viennent d'[Open-Meteo](https://open-meteo.com)
(gratuit, sans compte), à partir des coordonnées de la maison connues de l'application Intuis.

**Station météo Netatmo** (température réelle chez vous, plus précise) :
1. Sur [dev.netatmo.com](https://dev.netatmo.com) → *My apps* → *Create*, créez une application
   (nom libre).
2. Dans la page de l'application, section *Token generator* : cochez le scope `read_station`,
   cliquez *Generate token*, puis copiez le **refresh token**.
3. Ajoutez les secrets `NETATMO_CLIENT_ID`, `NETATMO_CLIENT_SECRET` et `NETATMO_REFRESH_TOKEN`.

Tous les modules sont archivés (module principal, modules intérieurs additionnels, module extérieur) :
température min / max / moyenne, humidité et CO₂ par jour. Le module extérieur remplace Open-Meteo
pour les degrés-jours.

Les relevés **horaires** (température, humidité, CO₂ des modules intérieurs) sont aussi gardés,
un fichier par année (`data/AAAA.station_h.enc.json`) : un an au premier passage, puis les derniers
jours à chaque collecte. Le collecteur en tire, par module et par jour, le CO₂ de la nuit (22 h → 7 h :
maximum, heures au-dessus de 1 000 / 1 400 / 1 500 ppm), les heures d'humidité au-dessus de 65 % et
les heures sous 19 °C. Formats détaillés dans [docs/api-notes.md](docs/api-notes.md#station-météo-netatmo-api-publique).

**Pièces au pas de 30 minutes** : énergie heures pleines / creuses, température et consigne de chaque
pièce, toutes les 30 minutes, dans `data/AAAA.room30.enc.json` (un fichier par année, chargé à la
demande). Intuis garde environ quatre ans : le collecteur les rattrape en quelques nuits (3 pour une
maison de 7 pièces), pièce par pièce, sans dépasser son plafond d'appels. L'Analyse s'en sert pour le
profil horaire (journée type au pas de 30 minutes) et les explications des pièces froides (chute
rapide de température). Détails dans [docs/api-notes.md](docs/api-notes.md#pièces-au-pas-de-30-minutes-s-126).

Netatmo renouvelle le jeton à chaque utilisation : le collecteur garde le nouveau, chiffré, dans
`data/netatmo-token.enc.json`. Vous n'avez rien à refaire, sauf si vous révoquez l'accès.

**Compteur Linky** (part du chauffage et du chauffe-eau dans le total du logement) :
1. Sur [conso.boris.sh](https://conso.boris.sh), donnez votre accord sur votre compte Enedis : vous
   obtenez un **jeton personnel**. Ce service gratuit relaie l'API d'Enedis, réservée aux entreprises.
   C'est celui qu'utilise l'intégration Linky de Home Assistant.
2. Ajoutez les secrets `ENEDIS_TOKEN` et `ENEDIS_PRM` (numéro de point de livraison à 14 chiffres,
   visible sur votre facture ou dans l'espace Enedis).
3. Facultatif : pour la **courbe de charge** (consommation par demi-heure, utile pour la vraie
   répartition heures pleines / heures creuses et le talon de nuit), activez la « collecte de la
   courbe de charge » dans votre espace client Enedis (intitulé à vérifier). Enedis ne la garde
   qu'à partir de cette activation. Le collecteur récupère au plus les 12 derniers mois, par
   tranches de 7 jours, puis seulement les jours manquants (les 3 derniers jours chaque nuit) ;
   elle est rangée chiffrée dans `data/AAAA.linky30.enc.json`. Sans cette activation, rien
   n'échoue : l'état de la source `linky-30min` l'indique.

   Dès qu'elle existe, la Synthèse affiche sous la carte Linky une carte **Courbe de charge**
   (chargée à la demande) : la journée type des 30 derniers jours (semaine ou week-end), avec le
   chauffage et le chauffe-eau mesurés en aplats et les autres usages en différence ; le **talon de
   veille** (10ᵉ centile des demi-heures entre 1 h et 5 h, radiateurs et chauffe-eau déduits quand
   les données horaires existent) en W, kWh/an et €/an au prix du moment ; la demi-heure la plus
   chargée des 12 derniers mois face à la puissance souscrite ; et la courbe d'un jour au choix.

**Prises connectées Shelly** (consommation des gros appareils : réfrigérateur, congélateur,
lave-linge…) :
1. Dans l'application Shelly : *Paramètres utilisateur* → *Clé d'autorisation cloud* → *Obtenir la
   clé*. Copiez la **clé** et le **serveur** affiché (par exemple `shelly-103-eu.shelly.cloud`).
2. Ajoutez les secrets `SHELLY_AUTH_KEY` et `SHELLY_SERVER` (ou dans l'écran Paramètres de l'appli).

Chaque nuit, le collecteur lit le **compteur d'énergie cumulé** de chaque prise (Plus Plug S, Plug S
et toute prise ou relais Shelly qui mesure l'énergie) et en déduit les kWh par jour, chiffrés dans
`data/shelly.enc.json` avec le nom de la prise. L'API officielle ne donne pas d'historique : les
kWh sont comptés à partir de la première collecte, et une prise débranchée ou redémarrée est
rattrapée (jours « estimés »). Une prise qui n'affiche que la puissance instantanée est signalée
« non exploitable sans hub » dans Paramètres. Détails dans
[docs/api-notes.md](docs/api-notes.md#prises-shelly-shelly-cloud-control-api-s-117). La Synthèse
affiche alors, sous la courbe de charge, la carte **Autres usages en détail** : le reste du Linky
(total − chauffage − chauffe-eau, 30 derniers jours) découpé en prises mesurées, **postes saisis à la
main** (nom, puissance, heures par jour, gardés chiffrés sur l'appareil), **talon de veille** non
attribué (courbe de charge, appareils permanents déduits) et reste non attribué, en kWh, W moyens,
part du reste et coût par an. La carte s'affiche dès qu'il y a un Linky, même sans prise.

**Home Assistant** (capteurs d'ouverture, prises, sondes Zigbee) : export local puis
`python -m collector import-ha FICHIER`, qui verse des agrégats quotidiens par capteur, chiffrés,
dans `data/ha.enc.json`. Formats et procédure : [docs/import-ha.md](docs/import-ha.md). La vue
**Confort** affiche alors la carte **Capteurs Home Assistant** (ce qui a été importé, 30 derniers
jours) et, pour chaque capteur d'ouverture rattaché à une pièce, le **taux d'accord par jour** avec la
fenêtre ouverte détectée par le radiateur (relevé horaire ci-dessous).

**Expiration des accès.** Le résumé de chaque collecte affiche la date d'expiration des jetons
quand elle est connue (lue dans le jeton Conso API s'il la contient, sinon estimée à 3 ans après
sa première utilisation, durée à vérifier). 30 jours avant, ou dès qu'un jeton Linky ou Netatmo
est refusé, un avertissement « Renouveler le jeton … » apparaît dans le run GitHub Actions, avec
la marche à suivre, et **une issue « 🔑 Jeton à renouveler »** s'ouvre (GitHub vous l'envoie par
e-mail) ; elle se ferme seule quand plus rien n'est à renouveler. L'écran Paramètres affiche pour
chaque source la date d'expiration (« estimée » le cas échéant), ou « expiration inconnue ». Seule une empreinte courte du jeton est gardée (chiffrée), jamais le jeton.

**Analyse du mois par l'IA (Claude)** :
1. Créez une clé sur [console.anthropic.com](https://console.anthropic.com) (service payant ; une
   analyse mensuelle coûte quelques centimes).
2. Ajoutez le secret `ANTHROPIC_API_KEY`.

Une fois par mois, l'application calcule elle-même tous les chiffres du mois écoulé, et Claude
rédige le commentaire. Chaque nombre du texte est comparé aux chiffres calculés : s'il en invente un,
le texte est réécrit. **Ce qui est envoyé à Anthropic** : des totaux mensuels (kWh, coût estimé en €
si un contrat est partagé, °C, degrés-jours, pourcentages), au plus cinq jours inhabituels, le talon
et la puissance maximale Linky, des compteurs de confort de la station (CO₂, humidité, heures sous
19 °C) et la couverture des données. Les pièces et capteurs partent sous un **pseudonyme**
(« Pièce A », « Capteur B ») : leurs vrais noms sont remis dans le texte localement, avant
l'enregistrement chiffré. Ni nom du logement, ni adresse, ni coordonnées, ni identifiants, ni autre donnée
journalière (`tests/test_promesses.py` le vérifie sur la démonstration). La clé reste un secret GitHub : elle n'est jamais dans le site.

Dans l'onglet Analyse, la carte affiche le modèle, les jetons consommés et le **coût estimé** de
l'analyse ; un bouton « Utile / Pas utile » garde votre avis sur l'appareil, et Paramètres montre la
part des analyses des 3 derniers mois jugées utiles (règle ADR-5). Le rapport annuel propose des
**questions types** (« ce mois est-il normal ? », « quelle pièce a le plus augmenté ? »…) répondues
par le code, sans IA ni réseau.

**Prix et contrat.** Dans ⚙ Paramètres → Contrat et prix, décrivez votre contrat période par période (date de début, offre,
puissance souscrite, par exemple 9 kVA puis 12 kVA). Pour que **tous les appareils du foyer**
utilisent le même contrat, ouvrez Paramètres → **Contrat partagé** → *Partager ce contrat* : il est
scellé dans le navigateur et enregistré dans le **secret** du dépôt `CONTRACT_JSON` (#497 : dates, offre et
puissance, par exemple `[{"from":"2022-01-01","offer":"edf-trv-hphc","kva":12},{"from":"2025-10-14","offer":"edf-trv-hphc","kva":9}]`),
que la collecte vérifie puis recopie dans les données chiffrées ; le journal public n'indique que
« Contrat partagé : oui (N périodes) ». Le contrat partagé s'applique alors partout (badge
« partagé ») ; une modification faite dans le menu reste propre à l'appareil (« modifié sur cet
appareil, non partagé ») jusqu'à ce que vous la partagiez. Chaque jour est compté avec le prix et
l'abonnement en vigueur ce jour-là (historique officiel publié par la
CRE en [open data](https://www.data.gouv.fr/datasets/historique-des-tarifs-reglementes-de-vente-delectricite-pour-les-consommateurs-residentiels),
mis à jour à chaque déploiement). Pour ajouter un autre fournisseur, il suffit d'un fichier de tarifs
au même format dans `web/public/tarifs/` et d'une ligne dans `web/src/offers.ts`. Le comparateur
(onglet Comparer) recalcule Base, heures creuses et Tempo sur les mêmes jours, avec la couleur Tempo
réelle de chaque jour ([api-couleur-tempo.fr](https://www.api-couleur-tempo.fr)). Avant
l'activation des tarifs dans l'application Intuis (2025), la répartition heures pleines / creuses
n'existe pas : elle est estimée pour chaque pièce à partir de sa répartition mesurée depuis. Vous
pouvez aussi saisir vos propres prix. Ces réglages restent sur votre appareil.

**Poêle à bois.** Le bois ne passe pas par le compteur : dans ⚙ Paramètres → Mon logement → *Poêle à
bois*, notez chaque achat (date, stères, essence, humidité, prix). L'appli le convertit en chaleur avec
des hypothèses affichées et modifiables (kWh par stère selon l'essence à 20 % d'humidité, correction
d'humidité, rendement du poêle), le répartit sur la saison de chauffe qui suit l'achat au prorata des
degrés-jours, et compte électricité **et** bois dans le coût du chauffage (Accueil, hiver contre hiver,
« Expliquer un mois »). Sans relevé, une saison est supposée brûler tout le bois qu'elle a ; sous
*Bois réellement brûlé* (facultatif), notez les stères brûlés d'une saison ou le stock restant au
printemps : le relevé remplace l'hypothèse et le reste passe à la saison suivante (le plus ancien
brûle d'abord). Enregistré pour le foyer dans le **secret** du dépôt `WOOD_JSON`, scellé dans
le navigateur comme la localisation, recopié chiffré par la collecte ; le journal public n'en dit rien.

**Flambées du poêle.** Chaque nuit, la collecte cherche les soirs où le poêle a chauffé dans les
relevés à la demi-heure : après le coucher du soleil, au moins deux pièces voisines se réchauffent alors
que leur radiateur ne consomme rien, sans redoux dehors (`collector/stove.py`). Les seuils sont réglés
sur la démo, d'après ce que vous avez observé (+1 à +2 °C dans deux chambres entre 19 h et 23 h), et
dits dans le code ; *Historique → Flambées du poêle* montre le calendrier (heure de début, durée
estimée, pièces témoins, netteté) et pose la question « poêle allumé ce soir ? » : vos réponses restent
chiffrées sur l'appareil et disent combien de soirs la détection a vus juste. Le bois du poêle est alors
réparti sur ces soirs plutôt que sur les degrés-jours (les jours non lisibles gardent les degrés-jours).
Rien de tout cela n'entre dans le journal public.

**Radiateur arrêté ou retiré.** Une pièce chauffée autrement dont les radiateurs sont coupés ou
démontés se déclare dans ⚙ Paramètres → Mon logement → *Radiateurs arrêtés volontairement*, avec une
date et un motif (poêle, radiateurs retirés, autre chauffage, pièce inoccupée, autre). À partir de cette
date, ses modules ne déclenchent plus d'alerte (« ne répond plus », firmware, heures hors ligne, issue
de la collecte), la pièce n'est pas « hors ligne », et une comparaison avec l'an dernier qui couvre la
date parle d'un changement de mode de chauffage, pas d'une économie. Son historique d'avant reste
visible : si ses modules, ou la pièce, disparaissent de l'application Intuis, la collecte garde la pièce
et ses jours (**secret** du dépôt `STOPPED_ROOMS_JSON`, scellé dans le navigateur).

Ces deux réglages du foyer étaient avant la v1.8 des variables du dépôt, lisibles en clair par les
collaborateurs et les workflows (#459). Si l'une existe encore, sa carte propose « Migrer en secret » :
l'appli écrit le secret avec le même contenu, puis supprime la variable, et le dit. D'ici là, la
collecte lit le secret d'abord, la variable ensuite, et signale dans son journal, par son nom seul,
la variable en clair qui reste à migrer.

**Fenêtres ouvertes, boost et état des radiateurs** (relevé horaire, facultatif) : l'API Intuis ne
donne l'état des pièces qu'en instantané. Pour en garder l'historique :
1. D'abord, **Actions → Diagnostic → Run workflow**, case « Chercher un historique des fenêtres /
   boost » : si un type de mesure répond, le relevé horaire est inutile (voir
   [docs/api-notes.md](docs/api-notes.md#un-historique-déjà-servi--s-131-172)).
2. Sinon, ajoutez la **variable** (onglet *Variables*) `ROOM_STATE_HOURLY` = `true`. Le workflow
   « Relevé horaire des pièces » fait alors une requête par heure (48 appels Intuis par jour, jeton
   compris), chiffre le relevé avec votre phrase de passe et le garde 3 jours hors du dépôt (artefact
   GitHub), **sans aucun commit**. Chaque nuit, la collecte en tire les heures par pièce et par jour
   de fenêtre ouverte, boost, chauffe, délestage et mode de consigne (absence, hors-gel, manuel).
   Un relevé manqué est compensé au prorata et la couverture est affichée.
3. La vue **Confort** affiche alors la carte « Fenêtres ouvertes et radiateurs » : heures par pièce
   (30 jours et par mois), « pourquoi cette pièce était froide ? », la signature énergétique sans
   les jours d'aération, l'énergie estimée pendant les boosts, les absences confirmées par le mode
   de consigne et les délestages face au pic Linky. Les chambres y sont regroupées par défaut.
4. Ailleurs dans l'appli : « Pourquoi cette pièce était froide ? » dans les **Questions types**
   (rapport), une colonne « Explication possible » (fenêtre ouverte N h, mode absence ; et, pour un
   jour sous l'attendu, une journée ensoleillée d'après le rayonnement Open-Meteo, en hypothèse) dans
   les **Jours inhabituels** (Analyse), les **absences confirmées par le mode de consigne** dans « Absences
   probables » (la détection par la consommation reste le repli), le **délestage par pièce** sous la
   puissance maximale (Synthèse), le **mode du contacteur** dans la carte chauffe-eau (Analyse). Si
   l'analyse IA est activée, elle reçoit les heures de fenêtre ouverte et de boost **du mois**, par
   pseudonyme, chambres regroupées en une ligne (S-5.10).

La **présence** détectée par les radiateurs n'est jamais lue, sauf si vous ajoutez la variable
`ROOM_STATE_PRESENCE` = `true` (avec l'accord du foyer) : seules des heures par jour sont alors
gardées. Analyse d'impact courte dans [docs/api-notes.md](docs/api-notes.md#données-doccupation--analyse-dimpact-courte-s-135).

De même, le **bruit** du séjour mesuré par la station Netatmo (S-11.4) n'est lu que si vous ajoutez la
variable `STATION_NOISE` = `true` (avec l'accord du foyer) : la collecte n'en garde que le nombre
d'heures bruyantes par jour (moyenne horaire au-dessus de 55 dB), jamais l'heure. La **pression** est
gardée par jour sans réglage ; le **vent** et la **pluie** du jour viennent d'Open-Meteo (S-3.12) et
s'ajoutent à la signature énergétique.
### Vue foyer : chambres regroupées

Les consommations, profils horaires, températures et le CO₂ par chambre disent beaucoup des
habitudes de chacun. La case **« Vue foyer »** de ⚙ Paramètres → Affichage (désactivée par défaut depuis la v1.5, sur
cet appareil seulement) regroupe sur tous les écrans les pièces dont le nom contient « chambre »,
« bedroom », « dortoir » ou « suite parentale » en une seule pièce **« Chambres »** : totaux
additionnés, températures et CO₂ moyennés, modules de la station compris ; dans l'analyse IA, leurs
noms sont remplacés par « Chambres ». Le détail s'affiche alors par un geste volontaire, ⚙ Affichage →
**Afficher le détail des chambres**, et seulement jusqu'au verrouillage suivant. C'est une
protection d'affichage : toute personne qui connaît la phrase de passe peut voir le détail.

Le regroupement ne change **aucun calcul** : coûts, partage heures pleines / creuses, jours perdus
ou estimés, signature, jours inhabituels, reconstitution, pièce froide, alerte froid prolongé et
surfaces sont calculés pièce par pièce, puis seulement additionnés pour l'affichage (un jour de
« Chambres » est perdu ou estimé si une chambre l'est ; une journée froide est comptée si une
chambre l'est). Les totaux sont identiques avec ou sans la vue foyer.

### Soirs « volets fermés »

Onglet Analyse, carte **Volets fermés le soir** : cochez « volets fermés ce soir » (ou notez un autre
soir). Les dates restent sur l'appareil ; exportez-les en CSV pour les garder ou les reprendre sur un
autre appareil (bouton Importer). Dès 7 soirs notés en période de chauffe (environ 4
semaines en alternant), la carte compare le chauffage de nuit (22 h → 7 h, données horaires) des
soirs volets fermés aux autres, chacun ramené à la température extérieure (signature de nuit), avec
l'intervalle d'incertitude à 95 %. C'est la mesure prévue par l'étude
[volets Wiser](docs/etudes/volets-wiser.md) (S-9.0).

**Relevé automatique** (facultatif, #200) : un NAS allumé chez vous lit la passerelle Wiser toutes les
10 minutes (lecture seule, `scripts/nas/volets.sh`) et envoie chaque nuit le journal du jour, chiffré
avec une clé publique, au workflow **Volets**, qui le vérifie et le range chiffré dans
`data/volets.enc.json` (secret `VOLETS_PRIVATE_KEY`). Les soirs relevés à 22 h remplacent alors les
notes ; un soir sans relevé ni note est laissé de côté. Installation pas à pas :
[docs/etudes/volets-wiser.md](docs/etudes/volets-wiser.md#relevé-automatique-par-le-nas-200).

### Alertes

Si la collecte nocturne échoue (mot de passe changé, serveur indisponible…), une *issue* GitHub
s'ouvre et GitHub vous prévient par e-mail. Elle se ferme toute seule à la prochaine collecte réussie.

### Alerte froid prolongé (facultative, désactivée par défaut)

Pour un proche âgé vivant seul ou une résidence secondaire : quand une pièce choisie reste **sous un
seuil sur une journée entière** (moyenne journalière de la sonde du radiateur ou d'un module intérieur
de la station), la collecte de la nuit ouvre une *issue* « 🥶 Alerte froid prolongé » (GitHub vous
prévient par e-mail) ; elle se ferme seule au retour au-dessus du seuil.

Réglage : Paramètres → **Alerte froid prolongé** (pièces, seuil, durée de 1 à 3 jours), scellé dans le
navigateur et enregistré dans le **secret** du dépôt `COLD_ALERT_JSON` (#497), par exemple `{"threshold": 14, "days": 1, "rooms": ["1234567890"]}`
(identifiants Intuis ou de modules de la station, dans l'ordre des pseudonymes). L'issue étant
publique, elle ne donne **ni température ni nom de pièce** : seulement « Pièce A », « Pièce B »… dans
l'ordre de la liste ; la correspondance n'est affichée que dans l'application. Le journal public
n'indique que des nombres (pièces suivies, sous le seuil, sans mesure récente). La vue Confort
affiche aussi l'alerte, avec les vrais noms.

Alerte « appareil injoignable » (facultative, v1.5) : avec la **variable** du dépôt
`DEVICE_ALERT=true`, la collecte ouvre une issue tant qu'un radiateur, un relais, le chauffe-eau ou la
passerelle ne répond plus, ou qu'une pile de la station passe sous 15 % (types de module et dates
seulement, jamais un nom). Le détail est dans Paramètres → État des appareils.

> **Ce n'est pas un dispositif de sécurité.** Avec une collecte par nuit, le délai peut atteindre
> **24 h** après la journée froide (davantage si la collecte échoue ou si une sonde ne remonte plus).
> Pour une personne fragile, gardez un autre moyen de contact.

### Mode locataire

Paramètres → **Mode locataire** (réglage propre à l'appareil) : sans le Linky ni le contrat du
titulaire, les coûts utilisent **votre prix moyen au kWh** (⚙ Paramètres → Contrat et prix) ; les cartes Linky, le
comparateur d'offres, la simulation de recharge et le contrat partagé sont masqués avec une phrase
d'explication. Avec la date de début (et de fin) du bail, le **rapport anonymisé** couvre la seule
période du bail, sans comparaison avec l'année d'avant.

### Simulations : voiture électrique, pompe à chaleur, panneaux solaires, eau chaude

- **Voiture électrique** (onglet Comparer) : énergie rechargée par semaine, heure de début et puissance
  de charge ; coût par offre (Base, heures creuses, Tempo) avec et sans voiture sur 12 mois, et, avec
  la courbe de charge Linky, le nombre de demi-heures où la puissance souscrite serait dépassée.
- **Pompe à chaleur air-air** (onglet Analyse) : à partir de la signature énergétique de la dernière
  saison et de la température extérieure de chaque jour, l'électricité qu'aurait consommée une PAC
  (fourchette de COP saisonnier saisie, ou COP selon la température, valeurs indicatives à vérifier) et
  l'économie en kWh et en euros. C'est une estimation, pas une étude thermique : un conseiller
  [France Rénov'](https://france-renov.gouv.fr/) peut vérifier le projet.

- **Panneaux solaires** (Outils › Simulateurs, #356) : la vraie courbe Linky à la demi-heure,
  confrontée à un profil de production heure par heure (PVGIS, demandé par la collecte à partir de
  la localisation et des toits saisis dans ⚙ Mon logement, ou fichier PVGIS importé) ; pour 3, 4,5
  et 6 kWc : production, part autoconsommée, surplus, économie et retour, sans puis avec pilotage du
  chauffe-eau et de la recharge, puis avec une batterie de 5 ou 10 kWh (le pilotage d'abord). Prix,
  tarif de rachat, coûts et rendement sont saisis par vous et rappelés sous le résultat ; mention de
  l'amiante des toits en fibro-ciment.
- **Chauffe-eau thermodynamique** (Outils › Simulateurs, #453) : l'énergie réelle du chauffe-eau sur ses
  365 derniers jours, au prix en vigueur chaque jour, face à trois pistes pour préparer son
  remplacement : baisser la consigne, tout chauffer en heures creuses (celles en vigueur chaque jour,
  dans la limite de la puissance saisie), ou un chauffe-eau thermodynamique d'un COP saisi (2,5 est
  proposé comme hypothèse) ; kWh et euros économisés par an, retour sur le surcoût face à un chauffe-eau
  électrique neuf. Toutes les hypothèses sont saisies et rappelées sous le résultat.
- **Localisation de la maison** (⚙ Mon logement, #204) : commune ou coordonnées, à la précision
  choisie, et chaque toit (orientation, pente, puissance, pertes). Gardée **seulement chiffrée** (secret
  `HOME_LOCATION_JSON`, puis `solar.enc.json`) ; PVGIS la reçoit arrondie à environ 1 km ; jamais dans
  un journal, une adresse ni un export ([`docs/juridique.md`](docs/juridique.md)).

Chaque carte détaille sa méthode et ses hypothèses (« Comment c'est calculé »).

### Format des API et nombre d'appels

Chaque réponse d'Intuis, de la station Netatmo, de Conso API (Linky) et d'Open-Meteo est comparée à
un **schéma de référence**. Si un champ attendu disparaît ou change de nom, la collecte le dit
clairement (« format de réponse inattendu », avec la source et le nom du champ, jamais une valeur)
au lieu d'enregistrer des jours vides. Une réponse sans mesure reste un simple « pas de données ».
Pour Intuis, la collecte échoue (et l'issue d'alerte s'ouvre) ; pour les sources facultatives,
l'erreur est notée dans l'état des sources et le résumé de la collecte.

Le résumé de chaque collecte donne aussi le **nombre d'appels et leur durée par source**. Chaque
source a un plafond par collecte : Intuis 300 (3 000 pour la récupération de tout l'historique),
station Netatmo 400, Linky 200, Open-Meteo 20, Shelly 30, PVGIS 8. Plafond atteint : la collecte s'arrête proprement
pour cette source, garde ce qui a été récupéré et reprend la nuit suivante (une récupération
d'historique interrompue continue d'elle-même). Pour changer un plafond, ajoutez une **variable**
(onglet *Variables*, pas *Secrets*) `MAX_CALLS_INTUIS`, `MAX_CALLS_NETATMO`, `MAX_CALLS_LINKY` ou
`MAX_CALLS_OPEN_METEO` ou `MAX_CALLS_SHELLY` (un nombre entier). Les pièces au pas de 30 minutes ont leur
propre budget dans celui d'Intuis (`MAX_CALLS_INTUIS_30MIN`, 50 par défaut).

### Jours « estimés »

Pour certaines périodes, le serveur Intuis a perdu le détail jour par jour mais garde le total du mois.
Le collecteur répartit alors l'écart sur les jours manquants : le total du mois est juste, la
répartition entre ces jours est une estimation. L'application signale ces jours.

### Pièce mal classée ?

Le collecteur classe chaque pièce en **chauffage** ou **chauffe-eau** d'après son nom (« chauffe-eau »,
« ballon », « cumulus », « eau chaude ») et ses modules (`NMW`). Pour corriger, ajoutez une
**variable** (onglet *Variables*, pas *Secrets*) `INTUIS_ROOM_CATEGORIES` :

```json
{"1234567890": "water_heater", "9876543210": "ignore"}
```

Les identifiants de pièces s'obtiennent avec `python -m collector discover` (voir plus bas).

## Jours estimés

Le serveur Intuis perd parfois le détail journalier (constaté sur février et mars 2024, également visible dans l'application officielle). La collecte distingue trois cas, pièce par pièce et jour par jour :

- **réel** : la valeur du jour vient du serveur ;
- **estimé** : le jour manque mais le total du mois est connu ; l'écart entre ce total et la somme des jours présents est réparti sur les jours manquants, qui sont marqués « estimés » (`estimated` dans le fichier de l'année) ;
- **perdu chez Intuis** : ni le jour ni le total du mois ne sont disponibles ; rien n'est reconstitué et la consommation de ces jours manque dans les totaux.

À chaque enregistrement, le collecteur recalcule pour chaque pièce et chaque mois le nombre de jours réels, estimés et perdus (`coverage` dans le fichier de l'année, y compris pour les années déjà stockées). Dans l'application, la Synthèse affiche le nombre de jours estimés ou manquants de la période, une carte repliable **Qualité des données** liste les mois incomplets, et les barres des graphiques par jour et par semaine qui contiennent de tels jours sont dessinées plus pâles. Les comparaisons d'une année touchée (2024) avec les autres sont donc à lire avec prudence.

Dans cette carte, la case **Reconstituer les jours perdus** (mémorisée sur l'appareil) estime à part
la consommation des pièces perdues, jour par jour : par le **compteur Linky** du jour, moins les autres
usages du logement (médiane « Linky − Intuis » des jours complets à ± 3 semaines) et moins ce que les
autres pièces ont mesuré ; sans Linky, par la **signature** de la saison × la température du jour, au
prorata de la part habituelle des pièces. Ces valeurs forment une **série « reconstitué » distincte**
(graphique mensuel, totaux par année « mesuré », « reconstitué », « mesuré + reconstitué ») et ne sont
jamais mêlées aux données mesurées. La carte liste aussi les **jours suspects** : des jours mesurés où le
chauffage est très en dessous de la signature par temps froid (moins de 35 %) alors que Linky indique
davantage. Les jours perdus ou estimés sont exclus des **Jours inhabituels** (et de la droite qui sert
à les repérer) ; un jour très en dessous de la signature y porte la mention « suspect ».

## Utilisation en local (facultatif)

```bash
pip install -e ".[dev]"
```

```bash
cp .env.example .env
```

Remplissez `.env`, puis :

```bash
python -m collector discover
```

| Commande | Rôle |
|---|---|
| `python -m collector discover` | Connexion et inventaire : pièces, modules, catégorie retenue |
| `python -m collector sync` | Récupère les 35 derniers jours (ou tout l'historique au premier lancement) |
| `python -m collector backfill` | Force la récupération de tout l'historique |
| `python -m collector verify` | Déchiffre les données locales et affiche les totaux par année |
| `python -m collector export-csv -o conso.csv` | Export CSV (séparateur `;`, décimales `,`, pour Excel) |
| `python -m collector insights [--force]` | Analyse du dernier mois par Claude (`ANTHROPIC_API_KEY`) |
| `python -m collector diagnose [--history]` | Diagnostic anonyme de l'API (modules, types de mesure, profondeur, noms des champs de `homestatus`) |
| `python -m collector diagnose --status` | Seulement les noms des champs des pièces et modules de `homestatus` (fenêtre ouverte ?) |
| `python -m collector diagnose --probe-history` | Types de mesure candidats pour un historique des fenêtres / du boost : accepté ou refusé, nombre de points (S-13.1) |
| `python -m collector diagnose --qualite` | Bilan qualité de l'archive chiffrée (`DATA_PASSPHRASE`), par année et par mois : jours réels / estimés / manquants / suspects / arrêtés volontairement (chauffage en pièces-jours, chauffe-eau ; même règle que l'écran État des données), Linky jour, couverture des demi-heures (Linky, pièces) et du relevé horaire, jours de station par module, recoupement Linky / Intuis, plus long trou de l'année. Nombres seulement, aucune valeur ni nom (S-1.32). Workflow **Diagnostic**, case « Bilan qualité des données » |
| `python -m collector snapshot --out DOSSIER` | Un relevé chiffré de l'état des pièces (utilisé par le workflow « Relevé horaire ») |
| `python -m collector restore-backup FICHIER [--dry-run]` | Restaure dans `data/` une sauvegarde chiffrée téléchargée depuis l'appli |
| `python -m collector demo` | Régénère les données de démonstration |
| `python -m collector fixtures` | Jeux de démo nommés (cas limites : année incomplète, trou de 41 jours, sans chauffe-eau, sans prix…) dans `web/dist/demo-fixtures`, pour `npm run e2e:sweep` (balayage de toutes les pages, `?fixture=<nom>` en démo seulement) ; jamais publiés |

Application web :

```bash
cd web && npm install && npm run dev
```

## Structure

```
collector/          collecteur Python (API, chiffrement, stockage par année)
tests/              tests du collecteur (API simulée, aucun appel réseau)
data/               données chiffrées, écrites par la collecte (créé au premier lancement)
web/                application PWA (Vite + TypeScript + ECharts)
  public/demo/      données de démonstration chiffrées (phrase « demo »)
docs/               notes sur l'API, étude de l'existant, feuille de route, règles du projet (PROJET.md)
  etudes/           études « faut-il le faire ? » (volets Wiser, plateforme domotique, Home Assistant
                    et Zigbee, module intérieur de la station, audit de tous les appareils et achats, origine dédiée)
  design/           inventaire de l'interface (couleurs, typographie, composants), base du design system
  revues-agents/    consignes des revues de code, design et promesses par agents (à chaque version)
  bmad/             cadrage BMAD : brief, revue des 72 personas, PRD, architecture, epics, QA
.github/workflows/  CI, collecte quotidienne, déploiement GitHub Pages, revue par agents (à la demande)
scripts/            outils ponctuels (jours Tempo, constats de revue → issues)
```

## Sécurité

Une faille se signale **en privé** : voir [`SECURITY.md`](SECURITY.md) (comment, périmètre, ce qui
est déjà vérifié).

- Identifiants et phrase de passe : uniquement dans les **secrets GitHub**, jamais dans le dépôt.
- Données : AES-256-GCM, clé dérivée par PBKDF2-SHA256 (600 000 itérations). Le sel est public
  (`data/keyinfo.json`), c'est normal. L'application refuse un `keyinfo.json` ou un fichier chiffré
  annonçant moins de 600 000 itérations, une autre version de format ou une autre dérivation, avec un
  message clair (un `keyinfo.json` modifié ne peut pas affaiblir la clé en silence). Limite connue : le
  nom du fichier n'est pas lié au chiffré (pas de données associées GCM) ; quelqu'un qui peut écrire
  dans le dépôt pourrait intervertir deux fichiers chiffrés. Le lier demande un format v2 et un rekey
  complet (tant que les fichiers v1 restent lisibles, un ancien fichier pourrait remplacer un nouveau) :
  reporté à la prochaine évolution du format.
- Exports CSV (application et `export-csv`) : une cellule texte (nom de pièce, de module) qui commence
  par `=`, `+`, `-`, `@`, une tabulation ou un retour chariot est préfixée d'une apostrophe, pour qu'un
  tableur ne l'exécute pas comme une formule. Les colonnes numériques (températures négatives) sont
  écrites telles quelles.
- Affichage dans un cadre (clickjacking) : GitHub Pages n'envoie ni `X-Frame-Options` ni CSP en en-tête,
  et `frame-ancestors` est ignoré dans une CSP en `<meta>`. L'application vérifie donc elle-même qu'elle
  n'est pas affichée dans la page d'un autre site : dans un cadre, elle n'affiche ni l'écran de
  déverrouillage ni aucune donnée, seulement un lien pour l'ouvrir directement. Ce contrôle en JavaScript
  ne remplace pas un vrai en-tête HTTP (impossible sur GitHub Pages).
- Le site ne contacte aucun service tiers et n'envoie rien : il lit les fichiers chiffrés du dépôt.
- Verrouiller (ou quitter la démo) oublie les données déchiffrées : jeu de données, fichiers chargés à
  la demande (horaire, courbe Linky, état des pièces…), notes déchiffrées (travaux, factures) et calculs
  mis en cache dans les vues. Un résultat qui arrive après le verrouillage ou l'ouverture d'un autre jeu
  est ignoré.
- Politique de sécurité du contenu (CSP) stricte, dans `web/index.html`, avec **Trusted Types** :
  le navigateur refuse toute chaîne brute affectée à `innerHTML`. Tout le HTML de l'application passe
  par une seule politique nommée (`web/src/trusted.ts`), qui refuse en plus le balisage exécutable
  (`<script>`, `<iframe>`, gestionnaires `on…=` même après une barre oblique, URL `javascript:` même
  écrite avec des entités). Elle analyse les balises comme le navigateur (petit analyseur, pas une
  expression régulière) : un texte échappé contenant « javascript: » ne bloque jamais l'affichage, et
  ce que l'analyseur ne sait pas trancher (commentaires, `<title>` contenant `<`…) est refusé. La politique `default` n'accepte que la chaîne vide
  (ECharts vide ses infobulles) et le service worker de l'appli, à son chemin exact. Le test de bout
  en bout échoue à la moindre violation de la CSP.
- **Origine partagée de GitHub Pages (risque résiduel, #229).** Sous `https://<compte>.github.io/<dépôt>/`,
  l'origine du navigateur est `https://<compte>.github.io`, commune à **tous** les sites Pages du
  compte. La clé « Rester connecté » (IndexedDB), les notes et réglages (localStorage) et le cache hors
  ligne sont donc à la portée de tout script d'un autre site Pages de ce compte ouvert dans le même
  navigateur : la clé n'est pas copiable, mais un tel script peut s'en servir pour déchiffrer
  l'historique (public) et les notes ; il pourrait aussi ouvrir l'appli et lire la phrase tapée. Ce
  que fait l'appli : noms rangés sous le chemin du dépôt (`intuis-history@<dépôt>`, caches
  `energy-data@<dépôt>`, pour qu'une autre copie de l'appli sur le compte ne réutilise pas la clé par
  mégarde ; ce n'est pas une isolation), service worker accepté à son chemin exact seulement,
  avertissement dans Paramètres. **Ce qu'il faut faire** : ne publier aucun autre site GitHub Pages
  sur ce compte, ou ne pas cocher « Rester connecté » ; la vraie parade est un domaine personnel dédié
  (origine propre, quelques euros par an) : voir [docs/etudes/origine-dediee.md](docs/etudes/origine-dediee.md).

### Inviter un membre du foyer (S-12.3)

Le QR code de Paramètres → **Inviter** ne contient que **l'adresse publique** de l'appli (celle de
GitHub Pages, sans paramètre), suivie de `#installer`, qui ouvre l'aide d'installation sur l'écran de
déverrouillage. Pas de phrase de passe, pas de jeton, pas de clé : sans la phrase, le proche ne voit
que l'écran de déverrouillage, comme n'importe qui.

| Menace | Réponse |
|---|---|
| Phrase de passe dans une URL : historique du navigateur, journaux du serveur GitHub Pages, aperçu de lien d'une messagerie, sauvegarde du téléphone | Jamais dans l'URL ni le QR code. `#installer` est un fragment (jamais envoyé au serveur) et ne contient rien de secret ; il est retiré de la barre d'adresse après le déverrouillage. |
| QR code photographié ou transféré | Il ne livre que l'adresse du site, déjà publique (dépôt public). |
| Phrase envoyée avec le lien (SMS, courriel) | L'appli demande de la **dire de vive voix** et de ne pas l'envoyer dans le même message. |
| Lien piégé vers un faux site qui demande la phrase | Le lien est construit à partir de l'adresse de la page ouverte (https seulement), le proche voit l'adresse sous le QR code. |

Écarté : une invitation qui contiendrait la clé chiffrée par un code court (dit à l'oral). Un code
court se casse hors ligne en quelques secondes dès que le QR code est copié ; la sécurité réelle
reposerait sur la phrase de toute façon. La phrase dite une fois, puis « Rester connecté », est plus
simple et plus sûre.

### Vérifier le site publié

Chaque déploiement publie, avec le site :

- `SHA256SUMS` : l'empreinte SHA-256 de chaque fichier servi (code et données chiffrées) ;
- `build.json` : le commit déployé, la date, le numéro du déploiement et l'empreinte de `SHA256SUMS`,
  affichés dans **Paramètres → Version déployée** ;
- une **attestation de provenance GitHub** (SLSA, signée via Sigstore) pour `SHA256SUMS`,
  `build.json`, chacun des fichiers listés et l'artefact Pages (`artifact.tar`).

Pour vérifier, avec [`gh`](https://cli.github.com/) (remplacer l'adresse par celle de votre site) :

```bash
SITE=https://opaland.github.io/Netatmo
mkdir verif && cd verif
curl -fsSO "$SITE/SHA256SUMS"
sha256sum SHA256SUMS                       # = l'empreinte affichée dans Paramètres
gh attestation verify SHA256SUMS -R Opaland/Netatmo   # construit par le workflow de ce dépôt
# Télécharger chaque fichier servi et comparer à son empreinte :
while read -r _ f; do mkdir -p "$(dirname "$f")"; curl -fsS "$SITE/$f" -o "$f"; done < SHA256SUMS
sha256sum -c SHA256SUMS                    # chaque ligne doit finir par « OK »
```

`gh attestation verify` indique aussi le commit et le workflow (`deploy.yml`) qui ont produit le
fichier ; il fonctionne sur n'importe quel fichier téléchargé du site (par exemple
`gh attestation verify index.html -R Opaland/Netatmo`). L'artefact Pages lui-même se télécharge depuis
le déploiement (onglet Actions, conservé un jour) : décompresser le zip puis
`gh attestation verify artifact.tar -R Opaland/Netatmo`. Le déploiement ne crée pas de release GitHub.

## Contribuer

Voir [`CONTRIBUTING.md`](CONTRIBUTING.md) : devcontainer prêt à l'emploi (démo, tests Python et
Vitest sans configuration), commandes de vérification, cycle des PR et règles de sécurité.

## Gestion du projet

Le projet suit la méthode BMAD : voir [`docs/PROJET.md`](docs/PROJET.md) (cycle issue → branche → PR →
CI → fusion, étiquettes, jalons, revue multi-personas et revues de code et design par agents à chaque
version, définition de « fini »). Le travail
à venir est dans les [issues](https://github.com/Opaland/Netatmo/issues), rangées par jalon ; l'historique
des versions dans [`CHANGELOG.md`](CHANGELOG.md).
