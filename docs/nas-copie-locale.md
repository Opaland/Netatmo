# Copie locale sur le NAS (S-9.8, #143)

Un conteneur sur le NAS **récupère le dépôt chaque nuit** et **sert l'application avec les données
chiffrées** (`data/*.enc.json`) sur le réseau de la maison. Si GitHub est indisponible, ou si le
compte disparaît, la dernière copie reste là et s'ouvre avec la phrase de passe, comme le site
publié.

- **Sortant seulement** : le NAS va chercher le dépôt public (`git`, HTTPS) et, quand l'application
  change, les paquets de construction (`npm`). Rien n'arrive de l'extérieur : **aucun port à ouvrir
  ou rediriger sur la box**.
- **Aucun secret** : le dépôt est public, aucun jeton n'est demandé (le script refuse une adresse
  qui en porte un). Les données restent chiffrées ; rien n'est déchiffré sur le NAS, seulement dans
  le navigateur, avec la phrase.
- Les fichiers sont dans le dépôt : [`scripts/nas/copie-locale/`](../scripts/nas/copie-locale/)
  (`Dockerfile`, `docker-compose.yml`, `copie-locale.sh`, `serveur.mjs`), testés hors NAS par
  `tests/test_copie_locale.py`.

Ce guide ne présume ni de l'adresse ni du nom de votre NAS : `<nas>` désigne le nom ou l'adresse
qu'il a chez vous (celui que vous tapez pour ouvrir DSM).

## Ce qu'il faut

- un NAS Synology avec **Container Manager** (DSM 7.2 ; paquet « Container Manager » du Centre de
  paquets) ; l'image de base existe pour les processeurs x86-64 et ARM 64 bits ;
- environ **500 Mo** libres pendant une construction (les paquets npm, un peu plus de 300 Mo
  mesurés dans `web/node_modules/`, effacés après), puis environ **150 Mo** : le dépôt sans son
  historique (≈ 70 Mo), chaque construction gardée (≈ 7 Mo) et chaque copie publiée (≈ 17 Mo :
  l'application plus `data/`, qui grossit avec les années), fois `GARDER` (3 par défaut). Mesures
  du 12/11/2026 sur le dépôt d'origine.

## 1. Déposer les fichiers sur le NAS

1. Dans **File Station**, créez un dossier, par exemple `docker/copie-locale`.
2. Depuis GitHub, ouvrez chacun des quatre fichiers de `scripts/nas/copie-locale/` et
   téléchargez-le (bouton « Download raw file »), puis déposez-les dans ce dossier.

## 2. Régler (facultatif)

Dans `docker-compose.yml`, service `synchro` :

| Réglage | Défaut | Quand le changer |
|---|---|---|
| `DEPOT_URL` | le dépôt public d'origine | vous avez votre propre copie (`docs/INSTALLER.md`) : `https://github.com/<vous>/<votre-dépôt>.git` |
| `HEURE` | `08:30` | heure locale de la synchro, après la collecte de la nuit (vers 5 h-6 h) et la publication du site |
| `TZ` | `Europe/Paris` | autre fuseau |
| `GARDER` | `3` | nombre de copies gardées pour revenir en arrière |

Le port `8080` (service `web`) peut changer s'il est déjà pris sur le NAS : `"8081:8080"`.

## 3. Créer le projet

**Container Manager → Projet → Créer** : un nom (`copie-locale`), le **chemin** du dossier de
l'étape 1, et la source « utiliser le docker-compose.yml existant ». Container Manager construit
l'image puis démarre les deux conteneurs :

- `synchro` fait une première synchro tout de suite, puis chaque jour à `HEURE` ; son **journal**
  (Container Manager → Conteneur → `synchro` → Journal) dit « copie publiée : commit …, N fichier(s)
  chiffré(s) », ou pourquoi la nuit a échoué (« dépôt injoignable… », « construction impossible… »)
  en gardant la copie précédente ;
- `web` sert la dernière copie sur le port 8080, en lecture seule.

Les copies vivent dans un volume Docker (`copie`) que Docker crée lui-même : rien à régler en droits
dans File Station.

## 4. HTTPS sur le réseau local (indispensable)

L'application déchiffre les données avec l'API de chiffrement du navigateur (WebCrypto), que les
navigateurs ne donnent qu'aux pages **HTTPS** (ou `localhost`). Ouverte en `http://<nas>:8080`, la
copie s'affiche (écran de la phrase de passe) mais **ne peut pas déchiffrer** : mesuré dans
Chromium sur une adresse du réseau local en HTTP, `isSecureContext` faux et `crypto.subtle`
absent ; sur `http://localhost`, les deux présents et le service worker installé. Depuis #524,
l'écran de la phrase de passe le dit lui-même (« Cette adresse n'est pas sécurisée (HTTP) … »,
avec un lien vers cette page) et ses boutons restent grisés. Il faut donc la servir en HTTPS, par
le proxy inversé de DSM :

1. **Panneau de configuration → Portail de connexion → Avancé → Proxy inversé → Créer**.
2. Source : protocole **HTTPS**, nom d'hôte `<nas>` (le nom ou l'adresse du NAS chez vous), port
   **8443** (ou un autre libre).
3. Destination : protocole **HTTP**, nom d'hôte `localhost`, port **8080**.
4. Le certificat est celui de DSM (Panneau de configuration → Sécurité → Certificat). Avec le
   certificat auto-signé d'origine, le navigateur affiche un avertissement à accepter. **Hypothèse
   à vérifier sur place** : une fois l'avertissement accepté, la lecture des données fonctionne, mais
   le mode hors connexion (service worker) peut être refusé sur un certificat non reconnu. Un
   certificat reconnu (nom de domaine à vous) lève ces doutes ; c'est un choix qui vous revient.

Autre voie, depuis un ordinateur seulement : un tunnel SSH vers le NAS
(`ssh -L 8080:localhost:8080 <compte>@<nas>`, si SSH est activé dans DSM), puis
`http://localhost:8080` dans le navigateur de cet ordinateur (`localhost` compte comme sûr).

**Ne redirigez aucun de ces ports depuis la box** : la copie est faite pour la maison. Le pare-feu de
DSM peut en plus limiter 8080 et 8443 au réseau local.

## 5. Vérifier

1. Ouvrez `https://<nas>:8443/` : l'écran de la phrase de passe s'affiche.
2. Entrez la phrase : les données sont là, à jour de la dernière synchro.
3. ⚙ Paramètres → Version déployée dit « Version locale ou hors ligne » : la copie n'a pas
   d'empreinte publiée (normal, elle est construite sur le NAS, pas par GitHub).

C'est une **autre adresse** que le site publié : la clé mémorisée, les notes de l'appareil
(factures, travaux, absences) et les réglages gardés sur l'appareil ne la suivent pas (le navigateur
les range par adresse). La phrase est demandée une première fois.

## Si GitHub est indisponible

Rien à faire : la synchro échoue (journal « dépôt injoignable ou refusé : la copie précédente reste
servie ») et le service `web` continue de servir la dernière copie. Elle reste lisible avec la
phrase, tant que le navigateur arrive au NAS.

## Revenir à une copie précédente

Les `GARDER` dernières copies restent dans le volume (`/copie/site/versions/<commit>`) ; le lien
`/copie/site/actuelle` désigne celle qui est servie. La synchro suivante le remet sur la dernière.

## Mettre à jour le conteneur lui-même

L'application et les données se mettent à jour seules. Les quatre fichiers du conteneur, eux, sont
copiés dans l'image : quand `scripts/nas/copie-locale/` change dans le dépôt, redéposez-les
(étape 1) puis **Projet → copie-locale → Action → Construire** (ou Arrêter puis Construire).

## Ce qui reste à prouver sur le vrai NAS

Les tests du dépôt font tourner le script (sous `dash` et `busybox sh`, comme sur l'image Alpine)
contre un dépôt fictif local, et le serveur contre une copie fictive. Ils ne remplacent pas le
critère de l'issue : **le conteneur lancé sur le NAS, 24 h passent**, la copie contient les derniers
`*.enc.json` et s'ouvre sur le réseau local ; puis GitHub injoignable (par exemple `DEPOT_URL`
remplacé par `https://github.invalid/x.git` et le projet relancé : le journal dit « dépôt
injoignable »), la copie reste lisible avec la phrase. À faire par le propriétaire.
