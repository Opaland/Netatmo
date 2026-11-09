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
- **Android** : ouvrir l'adresse dans Chrome → menu ⋮ → **Installer l'application**.

Entrez votre phrase de passe une fois ; « Rester connecté sur cet appareil » garde une clé
non exportable dans le navigateur, **30 jours au plus** (le menu ⋮ → Verrouiller l'efface).
Sans activité (toucher, clavier) pendant **15 minutes**, l'application se verrouille d'elle-même :
les données déchiffrées, la clé mémorisée et le jeton GitHub sont oubliés, la phrase est redemandée.
Le délai se règle dans le menu ⋮ (5 min, 15 min, 1 h, ou jamais sur cet appareil) ; il compte aussi
quand l'onglet est fermé, si bien qu'un téléphone volé ne livre pas l'historique.

### Le plus simple : l'écran Paramètres

Une fois l'application ouverte (menu ⋮ → **Paramètres et connexions**), vous pouvez saisir vos
identifiants directement : l'application les **chiffre dans votre navigateur** avec la clé publique du
dépôt (le procédé imposé par GitHub) et les enregistre comme secrets, puis peut lancer la collecte.

Il faut pour cela un [jeton GitHub « fine-grained »](https://github.com/settings/personal-access-tokens/new) :
accès au seul dépôt, permissions **Secrets : lecture et écriture**, **Variables : lecture et écriture**
(pour le contrat partagé) et **Actions : lecture et écriture**, rien d'autre, expiration courte. Le jeton reste en mémoire le temps de la visite et n'est jamais
enregistré. La phrase de passe des données ne se change pas ici (voir plus bas).

### Changer de phrase de passe

1. Ajoutez le secret `NEW_DATA_PASSPHRASE` (la nouvelle phrase, 5 mots ou plus).
2. Lancez **Actions → Changer la phrase de passe** : tout est rechiffré et la robustesse vérifiée.
3. Remplacez la valeur de `DATA_PASSPHRASE` par la nouvelle phrase, puis supprimez `NEW_DATA_PASSPHRASE`.

En local : `python -m collector strength` estime la robustesse de la phrase actuelle.

### Sauvegarde chiffrée (hors GitHub)

Tout l'historique tient dans le dépôt. Pour ne pas dépendre d'un seul compte, menu ⋮ →
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
l'enregistrement chiffré. Ni nom du logement, ni adresse, ni coordonnées, ni identifiants, ni données
journalières. La clé reste un secret GitHub : elle n'est jamais dans le site.

Dans l'onglet Analyse, la carte affiche le modèle, les jetons consommés et le **coût estimé** de
l'analyse ; un bouton « Utile / Pas utile » garde votre avis sur l'appareil, et Paramètres montre la
part des analyses des 3 derniers mois jugées utiles (règle ADR-5). Le rapport annuel propose des
**questions types** (« ce mois est-il normal ? », « quelle pièce a le plus augmenté ? »…) répondues
par le code, sans IA ni réseau.

**Prix et contrat.** Dans le menu ⋮, décrivez votre contrat période par période (date de début, offre,
puissance souscrite, par exemple 9 kVA puis 12 kVA). Pour que **tous les appareils du foyer**
utilisent le même contrat, ouvrez Paramètres → **Contrat partagé** → *Partager ce contrat* : il est
écrit dans la **variable** du dépôt `CONTRACT_JSON` (ce n'est pas un secret : dates, offre et
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

### Vue foyer : chambres regroupées

Les consommations, profils horaires, températures et le CO₂ par chambre disent beaucoup des
habitudes de chacun. Par défaut, l'application regroupe donc sur tous les écrans les pièces dont le
nom contient « chambre » (ou « bedroom ») en une seule pièce **« Chambres »** : totaux additionnés,
températures et CO₂ moyennés, modules de la station compris ; dans l'analyse IA, leurs noms sont
remplacés par « Chambres ». Le détail s'affiche par un geste volontaire, menu ⋮ → **Afficher le
détail des chambres**, et seulement jusqu'au verrouillage suivant. La case « Vue foyer » du menu
désactive le regroupement sur cet appareil seulement. C'est une protection d'affichage : toute
personne qui connaît la phrase de passe peut voir le détail.

### Soirs « volets fermés »

Onglet Analyse, carte **Volets fermés le soir** : cochez « volets fermés ce soir » (ou notez un autre
soir). Les dates restent sur l'appareil ; exportez-les en CSV pour les garder ou les reprendre sur un
autre appareil (bouton Importer). Dès 7 soirs notés en période de chauffe (environ 4
semaines en alternant), la carte compare le chauffage de nuit (22 h → 7 h, données horaires) des
soirs volets fermés aux autres, chacun ramené à la température extérieure (signature de nuit), avec
l'intervalle d'incertitude à 95 %. C'est la mesure prévue par l'étude
[volets Wiser](docs/etudes/volets-wiser.md) (S-9.0).

### Alertes

Si la collecte nocturne échoue (mot de passe changé, serveur indisponible…), une *issue* GitHub
s'ouvre et GitHub vous prévient par e-mail. Elle se ferme toute seule à la prochaine collecte réussie.

### Alerte froid prolongé (facultative, désactivée par défaut)

Pour un proche âgé vivant seul ou une résidence secondaire : quand une pièce choisie reste **sous un
seuil sur une journée entière** (moyenne journalière de la sonde du radiateur ou d'un module intérieur
de la station), la collecte de la nuit ouvre une *issue* « 🥶 Alerte froid prolongé » (GitHub vous
prévient par e-mail) ; elle se ferme seule au retour au-dessus du seuil.

Réglage : Paramètres → **Alerte froid prolongé** (pièces, seuil, durée de 1 à 3 jours), qui écrit la
**variable** du dépôt `COLD_ALERT_JSON`, par exemple `{"threshold": 14, "days": 1, "rooms": ["1234567890"]}`
(identifiants Intuis ou de modules de la station, dans l'ordre des pseudonymes). L'issue étant
publique, elle ne donne **ni température ni nom de pièce** : seulement « Pièce A », « Pièce B »… dans
l'ordre de la liste ; la correspondance n'est affichée que dans l'application. Le journal public
n'indique que des nombres (pièces suivies, sous le seuil, sans mesure récente). La vue Confort
affiche aussi l'alerte, avec les vrais noms.

> **Ce n'est pas un dispositif de sécurité.** Avec une collecte par nuit, le délai peut atteindre
> **24 h** après la journée froide (davantage si la collecte échoue ou si une sonde ne remonte plus).
> Pour une personne fragile, gardez un autre moyen de contact.

### Mode locataire

Paramètres → **Mode locataire** (réglage propre à l'appareil) : sans le Linky ni le contrat du
titulaire, les coûts utilisent **votre prix moyen au kWh** (menu ⋮ → Prix) ; les cartes Linky, le
comparateur d'offres, la simulation de recharge et le contrat partagé sont masqués avec une phrase
d'explication. Avec la date de début (et de fin) du bail, le **rapport anonymisé** couvre la seule
période du bail, sans comparaison avec l'année d'avant.

### Simulations : voiture électrique et pompe à chaleur

- **Voiture électrique** (onglet Comparer) : énergie rechargée par semaine, heure de début et puissance
  de charge ; coût par offre (Base, heures creuses, Tempo) avec et sans voiture sur 12 mois, et, avec
  la courbe de charge Linky, le nombre de demi-heures où la puissance souscrite serait dépassée.
- **Pompe à chaleur air-air** (onglet Analyse) : à partir de la signature énergétique de la dernière
  saison et de la température extérieure de chaque jour, l'électricité qu'aurait consommée une PAC
  (fourchette de COP saisonnier saisie, ou COP selon la température, valeurs indicatives à vérifier) et
  l'économie en kWh et en euros. C'est une estimation, pas une étude thermique : un conseiller
  [France Rénov'](https://france-renov.gouv.fr/) peut vérifier le projet.

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
station Netatmo 400, Linky 200, Open-Meteo 20. Plafond atteint : la collecte s'arrête proprement
pour cette source, garde ce qui a été récupéré et reprend la nuit suivante (une récupération
d'historique interrompue continue d'elle-même). Pour changer un plafond, ajoutez une **variable**
(onglet *Variables*, pas *Secrets*) `MAX_CALLS_INTUIS`, `MAX_CALLS_NETATMO`, `MAX_CALLS_LINKY` ou
`MAX_CALLS_OPEN_METEO` (un nombre entier).

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
| `python -m collector restore-backup FICHIER [--dry-run]` | Restaure dans `data/` une sauvegarde chiffrée téléchargée depuis l'appli |
| `python -m collector demo` | Régénère les données de démonstration |

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
  etudes/           études « faut-il le faire ? » (volets Wiser, plateforme domotique)
  bmad/             cadrage BMAD : brief, revue 50 personas, PRD, architecture, epics, QA
.github/workflows/  CI, collecte quotidienne, déploiement GitHub Pages
```

## Sécurité

- Identifiants et phrase de passe : uniquement dans les **secrets GitHub**, jamais dans le dépôt.
- Données : AES-256-GCM, clé dérivée par PBKDF2-SHA256 (600 000 itérations). Le sel est public
  (`data/keyinfo.json`), c'est normal.
- Le site ne contacte aucun service tiers et n'envoie rien : il lit les fichiers chiffrés du dépôt.
- Politique de sécurité du contenu (CSP) stricte, dans `web/index.html`, avec **Trusted Types** :
  le navigateur refuse toute chaîne brute affectée à `innerHTML`. Tout le HTML de l'application passe
  par une seule politique nommée (`web/src/trusted.ts`), qui refuse en plus le balisage exécutable
  (`<script>`, gestionnaires `on…=`, `javascript:`). La politique `default` n'accepte que la chaîne vide
  (ECharts vide ses infobulles) et le service worker du site. Le test de bout en bout échoue à la
  moindre violation de la CSP.

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
CI → fusion, étiquettes, jalons, revue 50 personas à chaque version, définition de « fini »). Le travail
à venir est dans les [issues](https://github.com/Opaland/Netatmo/issues), rangées par jalon ; l'historique
des versions dans [`CHANGELOG.md`](CHANGELOG.md).
