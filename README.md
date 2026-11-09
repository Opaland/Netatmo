# Historique énergie — Intuitiv with Netatmo

Archive **sur plusieurs années** la consommation de vos radiateurs **Muller Intuitiv / Intuis**
(Airelec, Noirot, Applimo, Campa) et de votre **chauffe-eau** (Aqua Manager), et l'affiche dans une
application web installable sur **Android et iPhone**.

Ce que l'application mobile ne fait pas, et que celle-ci fait :

- garder **tout l'historique**, sans limite de durée ;
- **comparer les années** : mois par mois, cumul depuis le 1er janvier, saison de chauffe
  (septembre → août), évolution à date ;
- **filtrer par pièce** et séparer **chauffage / chauffe-eau**, ou les additionner ;
- afficher le **coût** (prix du kWh au choix) ;
- **exporter en CSV**.

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
docs/               notes sur l'API, étude de l'existant
.github/workflows/  CI, collecte quotidienne, déploiement GitHub Pages
```

## Sécurité

- Identifiants et phrase de passe : uniquement dans les **secrets GitHub**, jamais dans le dépôt.
- Données : AES-256-GCM, clé dérivée par PBKDF2-SHA256 (600 000 itérations). Le sel est public
  (`data/keyinfo.json`), c'est normal.
- Le site ne contacte aucun service tiers et n'envoie rien : il lit les fichiers chiffrés du dépôt.
