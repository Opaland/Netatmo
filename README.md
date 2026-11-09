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
- la **signature énergétique** du logement (kWh par jour selon la température extérieure) ;
- un **calendrier** de consommation, des **profils horaires**, les **températures** des pièces ;
- la **part du chauffage et du chauffe-eau** dans la consommation totale (compteur **Linky**) ;
- **par pièce** : classement, évolution N-1 → N en cascade, détail mensuel ;
- un **rapport annuel** imprimable (PDF) et l'**export CSV** ;
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
> Détails dans [docs/api-notes.md](docs/api-notes.md) et [docs/etude-marche.md](docs/etude-marche.md).

## Essayer sans compte

L'application contient des **données de démonstration** : ouvrez-la et touchez
« Essayer avec des données de démonstration ».

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
non exportable dans le navigateur (le menu ⋮ → Verrouiller l'efface).

### Le plus simple : l'écran Paramètres

Une fois l'application ouverte (menu ⋮ → **Paramètres et connexions**), vous pouvez saisir vos
identifiants directement : l'application les **chiffre dans votre navigateur** avec la clé publique du
dépôt (le procédé imposé par GitHub) et les enregistre comme secrets, puis peut lancer la collecte.

Il faut pour cela un [jeton GitHub « fine-grained »](https://github.com/settings/personal-access-tokens/new) :
accès au seul dépôt, permissions **Secrets : lecture et écriture** et **Actions : lecture et écriture**,
rien d'autre, expiration courte. Le jeton reste en mémoire le temps de la visite et n'est jamais
enregistré. La phrase de passe des données ne se change pas ici (voir plus bas).

### Changer de phrase de passe

1. Ajoutez le secret `NEW_DATA_PASSPHRASE` (la nouvelle phrase, 5 mots ou plus).
2. Lancez **Actions → Changer la phrase de passe** : tout est rechiffré et la robustesse vérifiée.
3. Remplacez la valeur de `DATA_PASSPHRASE` par la nouvelle phrase, puis supprimez `NEW_DATA_PASSPHRASE`.

En local : `python -m collector strength` estime la robustesse de la phrase actuelle.

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

**Expiration des accès.** Le résumé de chaque collecte affiche la date d'expiration des jetons
quand elle est connue (lue dans le jeton Conso API s'il la contient, sinon estimée à 3 ans après
sa première utilisation, durée à vérifier). 30 jours avant, ou dès qu'un jeton Linky ou Netatmo
est refusé, un avertissement « Renouveler le jeton … » apparaît dans le run GitHub Actions, avec
la marche à suivre. Seule une empreinte courte du jeton est gardée (chiffrée), jamais le jeton.

**Analyse du mois par l'IA (Claude)** :
1. Créez une clé sur [console.anthropic.com](https://console.anthropic.com) (service payant ; une
   analyse mensuelle coûte quelques centimes).
2. Ajoutez le secret `ANTHROPIC_API_KEY`.

Une fois par mois, l'application calcule elle-même tous les chiffres du mois écoulé, et Claude
rédige le commentaire. Chaque nombre du texte est comparé aux chiffres calculés : s'il en invente un,
le texte est réécrit. **Ce qui est envoyé à Anthropic** : des totaux mensuels (kWh, °C, degrés-jours,
pourcentages) et les noms des pièces. Ni adresse, ni coordonnées, ni identifiants, ni données
journalières. La clé reste un secret GitHub : elle n'est jamais dans le site.

**Prix et contrat.** Dans le menu ⋮, décrivez votre contrat période par période (date de début, offre,
puissance souscrite, par exemple 9 kVA puis 12 kVA). Chaque jour est compté avec le prix et
l'abonnement en vigueur ce jour-là (historique officiel publié par la
CRE en [open data](https://www.data.gouv.fr/datasets/historique-des-tarifs-reglementes-de-vente-delectricite-pour-les-consommateurs-residentiels),
mis à jour à chaque déploiement). Pour ajouter un autre fournisseur, il suffit d'un fichier de tarifs
au même format dans `web/public/tarifs/` et d'une ligne dans `web/src/offers.ts`. Le comparateur
(onglet Comparer) recalcule Base, heures creuses et Tempo sur les mêmes jours, avec la couleur Tempo
réelle de chaque jour ([api-couleur-tempo.fr](https://www.api-couleur-tempo.fr)). Avant
l'activation des tarifs dans l'application Intuis (2025), la répartition heures pleines / creuses
n'existe pas : elle est estimée pour chaque pièce à partir de sa répartition mesurée depuis. Vous
pouvez aussi saisir vos propres prix. Ces réglages restent sur votre appareil.

### Alertes

Si la collecte nocturne échoue (mot de passe changé, serveur indisponible…), une *issue* GitHub
s'ouvre et GitHub vous prévient par e-mail. Elle se ferme toute seule à la prochaine collecte réussie.

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
| `python -m collector diagnose [--history]` | Diagnostic anonyme de l'API (modules, types de mesure, profondeur) |
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

## Gestion du projet

Le projet suit la méthode BMAD : voir [`docs/PROJET.md`](docs/PROJET.md) (cycle issue → branche → PR →
CI → fusion, étiquettes, jalons, revue 50 personas à chaque version, définition de « fini »). Le travail
à venir est dans les [issues](https://github.com/Opaland/Netatmo/issues), rangées par jalon ; l'historique
des versions dans [`CHANGELOG.md`](CHANGELOG.md).
