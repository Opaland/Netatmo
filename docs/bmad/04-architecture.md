# 04 · Architecture (Architect)

## 1. Architecture actuelle (v1.5, novembre 2026)

```
 GitHub Actions (cloud)                                    dépôt public Opaland/Netatmo
 ┌─ « Relevé horaire » (option ROOM_STATE_HOURLY, :23 chaque heure) ────────────────────┐
 │  collector snapshot ── 1 homestatus ──► Intuis ; quelques champs gardés, chiffrés     │
 │  (DATA_PASSPHRASE + data/keyinfo.json) ──► artefact Actions 3 jours, jamais committé  │
 └───────────────────────────────────────────────┬───────────────────────────────────────┘
                                                 │ artefacts de CE dépôt et de ses runs planifiés
 ┌─ « Collecte quotidienne » (04:17 UTC, timeout 30 min) ─▼──────────────────────────────┐
 │ pip install --require-hashes -r requirements-lock.txt   (étape SANS secret)          │
 │ collector (Python 3.12), seule étape qui reçoit les secrets :                        │
 │   api.py / sync.py / room30.py ── OAuth « password » ──► Intuis (jour, heure, 30 min) │
 │   roomstate.py / devices.py   ── instantanés + 1 homestatus ──► états, appareils     │
 │   weather.py   ── HTTPS sans clé ──► Open-Meteo        enedis.py ──► Linky (option)   │
 │   station.py   ── refresh tournant ──► Netatmo (option)  shelly.py ──► Shelly (option)│
 │   insights.py  ── agrégats seulement ──► API Claude (option, mensuel)                 │
 │   errors.py (erreurs sûres) + redact.py (journal, stdout, stderr expurgés)            │
 │   storage.py + crypto.py : AES-256-GCM, PBKDF2-SHA256 600 000 it.                     │
 │ scripts/commit-data.sh : commit de data/ si le clair change, push avec reprise        │
 │ « Sauvegarde du jeton Netatmo renouvelé » : même en cas d'échec                       │
 └────────────────────┬─────────────────────────────────────────────────────────────────┘
                      │ data/*.enc.json                ┌─────────────────────────────────┐
                      ▼                                │ GitHub Pages : PWA              │
   Dépôt public (fichiers illisibles) ── deploy ──►    │ Vite + TS, ECharts chargé à part│
                                                       │ WebCrypto : déchiffre localement│
                                                       │ CSP + Trusted Types, noms de    │
                                                       │ stockage propres au dépôt       │
                                                       └─────────────────────────────────┘
 Échec de collecte ──► issue « La collecte quotidienne échoue » (e-mail), fermée au succès.
 Alertes facultatives (jeton à renouveler, froid prolongé, module injoignable) : types, dates et
 pseudonymes seulement.
```

Points clés : aucun serveur, aucune base ; l'enveloppe chiffrée est volontairement simple pour que
WebCrypto la déchiffre : `{"v":1,"kdf":"PBKDF2-SHA256","iter":N,"salt":b64,"iv":b64,"ct":b64}`
(`ct` inclut l'étiquette GCM de 16 octets) ; l'appli refuse une autre version, une autre dérivation ou
moins de 600 000 itérations. Une écriture n'a lieu que si le texte clair change, ce qui évite un commit
par nuit sans nouveauté. Le journal des Actions est **public** : rien de personnel n'y est écrit
(ADR-14).

## 2. Modèle de données chiffré (`data/`)

| Fichier | Contenu (texte clair) | Producteur | Lecture par l'appli |
|---|---|---|---|
| `keyinfo.json` (**clair**) | `{"salt": b64, "iter": 600000}` | collecteur, une fois | Au déverrouillage |
| `meta.enc.json` | `home`, `rooms` (id, nom, catégorie), années disponibles (`years`, `hourly_years`, `room30_years`, `station_hourly_years`…), `first_day`, `last_day`, sources et extras, contrat vu par Intuis, `updated` | collecteur | Toujours, en premier |
| `YYYY.enc.json` | `daily`: `{room: {"YYYY-MM-DD": Wh}}` · `tariffs` · `temps` · `estimated` · `coverage` | collecteur | Toutes les années au chargement |
| `YYYY.hourly.enc.json` | `hourly`: `{room: {"YYYY-MM-DDTHH": Wh}}` | collecteur | À la demande, années utiles seulement |
| `YYYY.room30.enc.json`, `room30.enc.json` | pièces au pas 30 min `[hp, hc, °C, consigne]` par jour local ; progression du rattrapage | `room30.py` (#327) | À la demande |
| `roomstate.enc.json` | heures par pièce et par jour (fenêtre, boost, chauffe, délestage, anticipation, abaissement, hors ligne…) | instantanés horaires fusionnés la nuit | Si présent |
| `devices.enc.json` | modules Intuis (`i0`…) et de la station : joignabilité par nuit, firmware (changements), passerelle (redémarrages, Wi-Fi), couleur Tempo ; ids en empreintes salées (ADR-22) | `devices.py` (#328) | Au démarrage (petit) |
| `weather.enc.json` | `source`, `outdoor`: `{jour: [min, max, moy]}`, `indoor`: `{jour: moy}` | collecteur (Open-Meteo ou station) | Si présent |
| `station.enc.json`, `YYYY.station_h.enc.json` | station Netatmo : modules `m0`…, quotidien, agrégats de nuit, piles ; relevés horaires par année ; ids en empreintes salées (ADR-22) | `station.py` | Au démarrage ; horaire à la demande |
| `netatmo-token.enc.json` | jeton de rafraîchissement Netatmo, renouvelé à chaque usage | collecteur | Jamais |
| `linky.enc.json`, `YYYY.linky30.enc.json` | quotidien, puissance max et son heure, index par cadran ; courbe de charge 30 min | `enedis.py` | Si présent ; courbe à la demande |
| `shelly.enc.json` | prises et pinces `p0`… (canaux `pNcM`), Wh par jour ; ids en empreintes salées (ADR-22) | `shelly.py` | Si présent |
| `ha.enc.json` | agrégats quotidiens importés de Home Assistant | import manuel | Si présent |
| `insights.enc.json` | `generated`, `model`, `period`, `markdown` | job IA (mensuel) | Si présent |
| `local-YYYY.enc.json` (proposé, E9) | voir § 5 | pont local | Si présent |

Règles : toutes les valeurs d'énergie en **Wh** (conversion en kWh dans l'appli) ; jours en **heure
locale** de la maison ; un document optionnel absent (`404`) n'est jamais une erreur (`optional()` dans
`web/src/data.ts`) ; un producteur n'écrit **que ses propres fichiers**, seul le collecteur écrit `meta`.
Aucun identifiant d'appareil (adresse MAC, id dérivé) n'est stocké, même chiffré : seulement des clés
opaques (`m0`, `i0`, `p0`) et des empreintes salées pour les retrouver. Formats détaillés :
[`docs/api-notes.md`](../api-notes.md).

Évolution proposée de `insights.enc.json` (FR-18) :
`{"history": {"YYYY-MM": {"generated", "model", "markdown", "input": {…agrégats envoyés…}, "checks": {"numbers_ok": true}}}}`
pour conserver toutes les synthèses et montrer exactement ce qui a été envoyé.

## 3. Couche IA

### 3.1 Synthèse mensuelle (livrée, `collector/insights.py`)

```
cron mensuel (ou étape du job nocturne le 2 du mois)
  1. déchiffre data/ (DATA_PASSPHRASE)
  2. calcule en Python les faits : kWh et € par pièce et usage, N vs N-1, DJU, kWh/DJU,
     écart à la signature, jours atypiques (règles déterministes), projection de fin d'année
  3. construit un JSON d'entrée compact ──► API Claude (ANTHROPIC_API_KEY, secret Actions)
  4. reçoit un texte court en markdown ; vérifie que chaque nombre cité figure dans les faits
     (tolérance d'arrondi) ; sinon : régénère une fois, puis publie sans texte IA avec un avertissement
  5. chiffre insights.enc.json, commit
```

| Envoyé à l'API | Jamais envoyé |
|---|---|
| Agrégats mensuels par pièce et par usage (kWh, €), comparaison N-1, DJU, température extérieure moyenne, liste des jours atypiques avec leur écart, prix du kWh | Coordonnées, adresse, identifiants de maison / pièce / module, e-mail, jetons, phrase de passe, données horaires brutes, noms de personnes |
| Noms de pièces (« Séjour », « Chambre 2 ») pour un texte lisible ; option de pseudonymisation (« Pièce A ») | Fichiers chiffrés ou clés |

Choix du modèle : un modèle Claude d'entrée ou de milieu de gamme suffit pour reformuler des faits ;
le nom exact du modèle est stocké dans `model`. Coût : un appel par mois de quelques milliers de jetons,
à chiffrer avec la grille en vigueur (**à vérifier** sur la première facture) ; plafond de dépense
configuré dans la console. Sans secret `ANTHROPIC_API_KEY`, l'étape est sautée sans erreur.

### 3.2 Chat dans le navigateur (en évaluation)

| Aspect | Analyse |
|---|---|
| Fonctionnement | L'utilisateur colle **sa propre** clé ; l'appli appelle l'API directement depuis le navigateur (en-tête d'accès navigateur direct exigé par l'API, **à vérifier** au moment de l'implémentation) avec des agrégats déchiffrés localement |
| Risque clé | Clé lisible par tout script de la page (XSS, dépendance compromise) ; si gardée en `localStorage`, elle persiste sur l'appareil |
| Risque vie privée | Rompt NFR-2 « le site ne contacte personne » : il faut ouvrir `connect-src` à l'API et le dire clairement |
| Risque coût | Boucle ou abus = facture ; nécessite une clé dédiée avec plafond |
| Atténuation | Clé en mémoire seulement (perdue à la fermeture) ou chiffrée sous la clé de données ; désactivé par défaut ; affichage du contexte envoyé ; CSP stricte, aucune dépendance tierce chargée à l'exécution |

## 4. Décisions d'architecture (ADR)

Mis à jour à la fin de la v1.5 (persona 39, revue `revues/v1.5.md`). Un ADR remplacé reste dans le
tableau, avec le numéro de celui qui le remplace ; on n'en efface aucun.

### 4.1 Socle

| ADR | Décision | Statut | Alternatives écartées | Compromis |
|---|---|---|---|---|
| ADR-1 | **Zéro serveur** : GitHub Actions (calcul) + Pages (diffusion) | Accepté | VPS, Home Assistant comme socle, Cloudflare Workers | Gratuit et sans maintenance ; en échange, pas d'accès au LAN, et l'origine `github.io` est partagée (ADR-18) |
| ADR-2 | **Chiffrement symétrique par phrase de passe**, un document par année | Accepté | Dépôt privé seul, chiffrement asymétrique | Simple et compatible WebCrypto ; toute la sécurité repose sur la phrase de passe (d'où `rekey` et l'indicateur). Enveloppe contrôlée à la lecture (version, KDF, itérations, #236) ; le nom de fichier n'est pas lié au chiffré (format v2 reporté) |
| ADR-3 | **Horaire séparé** en `YYYY.hourly`, chargé à la demande | Accepté, étendu par ADR-20 | Tout dans `YYYY` | Chargement initial rapide sur téléphone modeste ; un aller-retour de plus pour les profils ; seules les années utiles sont téléchargées (#251) |
| ADR-4 | **IA côté Actions**, clé en secret, sortie chiffrée, **chiffres calculés par le code** | Accepté, livré | IA dans le navigateur ; IA qui calcule elle-même | Pas de clé exposée, texte vérifiable ; le texte n'est rafraîchi qu'une fois par mois ; les données de la v1.5 (demi-heures, appareils) ne sont jamais envoyées |
| ADR-5 | **Chat navigateur reporté** jusqu'à preuve que la synthèse est lue (2 mois sur 3) | Proposé | Le livrer en v1.1 | Évite d'ouvrir le site vers un tiers pour un usage non démontré |
| ADR-6 | **Aucun pilotage** d'équipement depuis l'application | Accepté | Boutons volets / Hue via pont | Pas d'écriture, pas de surface d'attaque ; le propriétaire utilise Home Assistant ou les applis fabricants pour piloter |
| ADR-7 | **Pont local en lecture seule**, s'il est construit : conteneur Python minimal sur le Synology, ou automatisation Home Assistant si HA est déjà installé | Proposé, conditionné à la mesure (02 § 10) | Ouvrir un port du NAS à Internet ; runner GitHub auto-hébergé sur le NAS | Le NAS pousse vers GitHub (sortant uniquement) ; pas de port entrant ; un runner auto-hébergé sur dépôt public exécuterait du code de PR : écarté |
| ADR-8 | **Transport du pont** : `git push` de `data/local-YYYY.enc.json` seulement, jeton GitHub à grain fin limité à ce dépôt (contents: write), un push par jour avant 04:00 UTC | Proposé | API Contents ; branche séparée ; MQTT vers un broker cloud | Écrivain unique par fichier, donc pas de conflit avec la collecte ; les données apparaissent au déploiement nocturne suivant |
| ADR-9 | **Phrase de passe sur le NAS** (secret Docker / variable protégée) pour chiffrer `local-*` | Proposé, risque accepté | Chiffrement hybride (clé publique côté NAS, clé privée dérivée de la phrase dans le navigateur) | Simple et réutilise `collector.crypto` ; un NAS compromis expose toutes les données : le chiffrement hybride reste l'évolution prévue si le pont devient durable |
| ADR-10 | **Météo** : Open-Meteo par défaut, station Netatmo en option, jeton tournant stocké chiffré dans le dépôt | **Remplacé par ADR-11** pour la gestion du jeton (le choix des sources reste valable) | Jeton en secret GitHub (non réinscriptible par le job) | Décrivait la perte du jeton si le commit échouait après rotation : corrigé par #262 |

### 4.2 Collecte et exploitation (v1.5)

| ADR | Décision | Statut | Alternatives écartées | Compromis |
|---|---|---|---|---|
| ADR-11 | **Jeton tournant écrit dès sa réception** : le collecteur chiffre et écrit `netatmo-token.enc.json` sur le disque juste après `oauth2/token` (`Store.flush`), et l'étape « Sauvegarde du jeton Netatmo renouvelé » le versionne même si la collecte ou le commit a échoué. Un jeton collé dans le secret `NETATMO_REFRESH_TOKEN` l'emporte (empreinte du jeton d'amorce) | Accepté (#262), remplace ADR-10 | Jeton en secret réécrit par l'API GitHub (exige un jeton d'admin dans le job) ; écriture à la fin seulement | Un commit de plus les nuits d'échec ; plus jamais de `invalid_grant` dû à un jeton consommé mais perdu |
| ADR-12 | **Commit des données avec reprise** (`scripts/commit-data.sh`) : commit seulement si le clair a changé, push réessayé (fetch, rebase, sinon merge) jusqu'à 5 fois, **jamais forcé** ; conflit sur les données = échec visible | Accepté (#262) | `git push --force` ; branche `data` séparée (v2, S-8.3) | Une PR fusionnée pendant la collecte ne fait plus perdre la nuit ; l'historique `main` garde les commits `data:` |
| ADR-13 | **Plafonds d'appels par source** et un seul assistant de cadence (`collector/http.py`, `budget.py`), `Retry-After` plafonné, erreurs réseau réessayées sous le plafond ; rattrapages (historique Intuis, demi-heures) sous un budget propre repris la nuit suivante | Accepté (#270, #275, #327) | Pas de plafond ; un rattrapage d'une traite | Respect des API non officielles (Intuis) et publiques ; un historique complet peut prendre plusieurs nuits |
| ADR-14 | **Journaux publics sans donnée personnelle**, en deux couches : toute erreur HTTP devient une `SourceError` sûre (source, chemin sans requête, statut, catégorie, code validé ; jamais corps, en-tête, URL complète, id ni valeur) ; puis `redact.py` expurge chaque ligne de journal, stdout, stderr et trace (requêtes d'URL, jetons, e-mails, MAC, ids hexadécimaux, PRM, coordonnées, valeurs connues à l'exécution). Un test de fuite fait échouer toutes les sources avec des réponses piégées | Accepté (#321, après la fuite critique #261) | Journal verbeux en privé (impossible : dépôt public) ; expurgation seule | Diagnostic moins direct (le diagnostic « Inventaire » ne montre que des noms de champs et des compteurs) ; les anciens journaux sont à supprimer à la main |
| ADR-15 | **Chaîne d'installation verrouillée** : `requirements-lock.txt` avec empreintes (`pip install --require-hashes`), installée dans une étape **sans secret** ; les secrets ne sont donnés qu'à l'étape qui lance le collecteur ; `permissions` déclarées par workflow, `timeout-minutes` sur la collecte et le relevé horaire | Accepté (#265) | Versions flottantes ; secrets au niveau du job | Mise à jour des dépendances plus manuelle (régénérer le verrou) ; un paquet compromis à l'installation ne voit aucun secret |
| ADR-16 | **Instantanés horaires chiffrés en artefacts** : le workflow « Relevé horaire » (option `ROOM_STATE_HOURLY`) lit un `homestatus` par heure, garde une liste blanche de champs, chiffre l'instantané avec la clé des données et le dépose en artefact Actions **3 jours** ; il ne committe jamais. La collecte nocturne n'accepte que les artefacts de ce dépôt et de ses runs planifiés, puis les fusionne en **heures par jour** dans `roomstate.enc.json` | Accepté (S-13.2, #271, #276) | Commit horaire ; stockage d'heures fines dans le dépôt ; service externe | Aucun horaire fin dans le dépôt (présences non reconstituables) ; 24 runs par jour ; une heure manquée baisse la couverture, pas les heures estimées |
| ADR-17 | **Pièces au pas de 30 minutes** dans `YYYY.room30.enc.json` (une ligne compacte par jour local), avec la progression du rattrapage dans `room30.enc.json`, sous un budget d'appels propre inclus dans celui d'Intuis | Accepté (S-1.26, #327) | Demi-heures dans `YYYY.hourly` ; tout rattraper en une nuit | 1,5 à 1,8 Mo chiffrés par an chargés à la demande ; 4 ans rattrapés en ~3 nuits |

### 4.3 Application (PWA)

| ADR | Décision | Statut | Alternatives écartées | Compromis |
|---|---|---|---|---|
| ADR-18 | **Stockage du navigateur nommé d'après le dépôt** (`intuis-history@<dépôt>`, caches `energy-data@<dépôt>`), anciens noms oubliés ; données déchiffrées oubliées au verrouillage ; appli refusée dans un cadre ; risque restant de l'origine `github.io` partagée expliqué dans Paramètres | Accepté (#326, #232, #237), **atténuation** de #229 | Origine dédiée (domaine personnel) : recommandée, décision du propriétaire | Pas d'isolation réelle tant que l'origine est partagée ; la phrase est à ressaisir une fois après la migration |
| ADR-19 | **CSP stricte avec Trusted Types** : tout HTML passe par une seule politique (`web/src/trusted.ts`), un petit analyseur qui refuse le balisage exécutable ; politique `default` limitée à la chaîne vide et au service worker ; e2e en échec à la moindre violation | Accepté (S-8.9, #230, #231) | Expressions régulières ; `DOMPurify` (dépendance de plus) | Quelques tournures HTML refusées par prudence ; aucune dépendance ajoutée |
| ADR-20 | **Budget de taille mesuré honnêtement** : premier écran = entrée + chunks préchargés (`web/scripts/size-budget.mjs`, 281 kB gzip, objectif < 80 %) ; ECharts, libsodium et vues secondaires chargés à la demande ; documents lourds (horaire, demi-heures, courbe Linky, station horaire) téléchargés seulement quand une carte les demande | Accepté (#227, #251, #256) | Mesurer l'entrée seule ; tout charger au démarrage | Premier écran passé de 269 kB à ~70 kB (26 %) ; un délai au premier graphique |
| ADR-21 | **Signal « vue prête »** : `#view[data-ready]` posé quand la vue est dessinée **et** que tout travail lancé en arrière-plan (cartes différées, documents à la demande, chunk ECharts) est terminé ; les e2e l'attendent au lieu d'attentes fixes et vérifient les absences après lui | Accepté (#260, #329) | `waitForTimeout` ; attendre le réseau inactif | Un compteur à tenir à jour dans chaque chargeur ; e2e stables sur Chromium et WebKit |

### 4.4 Données des appareils (v1.6)

| ADR | Décision | Statut | Alternatives écartées | Compromis |
|---|---|---|---|---|
| ADR-22 | **Clés d'appareils opaques et stables, sans identifiant stocké** : modules de la station (`m0`…), modules Intuis (`i0`…) et prises Shelly (`p0`…) gardent leur clé à vie ; le document ne contient qu'un sel aléatoire et `sha256("<sel>:<id>")[:16] → clé` (`KeyMap`, `collector/storage.py`). Un module ajouté prend la première clé libre, un module retiré garde la sienne, chaque module de la station reprend depuis son propre dernier jour. Les anciennes tables (`station.ids`, `devices.ids`, champ `id` des prises) sont converties une fois puis supprimées | Accepté (v1.6, reprend la PR #213) | Ids en clair dans le document chiffré (v1.5) ; clés par ordre de l'API (avant #209) ; empreinte sans sel | Une adresse MAC ne fuit plus même si la phrase de passe fuit ; l'empreinte tronquée à 64 bits suffit pour quelques dizaines d'appareils ; l'instantané horaire (artefact chiffré de 3 jours) garde les ids Intuis, nécessaires pour retrouver la pièce |

## 5. Architecture cible côté local (si E9 est validé)

```
 LAN du domicile                                           Internet
 ┌────────────────────────────── Synology (Container Manager) ─┐
 │ Option A : Home Assistant (conteneur)                       │
 │   intégrations : Hue (API locale du pont), Matter, Zigbee,  │
 │   Wiser (à vérifier), Netatmo officielle                    │
 │      │ API REST locale (jeton longue durée)                 │
 │      ▼                                                      │
 │ pont-local (conteneur Python, lecture seule)                │
 │   relève toutes les 15 min ─► SQLite local                  │
 │   1×/jour 03:30 : agrège par jour ─► chiffre (collector.crypto)
 │   ─► git push data/local-YYYY.enc.json ─────────────────────┼──► GitHub (HTTPS sortant)
 └─────────────────────────────────────────────────────────────┘
 Option B (sans HA) : le pont interroge directement le pont Hue (API locale) et, si elle existe,
 l'interface locale Wiser (à vérifier). CPL et box : aucun intérêt énergétique, ignorés.
```

Document proposé `local-YYYY.enc.json` (agrégats quotidiens uniquement, jamais d'événements horodatés
fins, pour ne pas reconstituer les présences) :

```json
{"shutters": {"<id>": {"YYYY-MM-DD": {"closed_night_h": 11.5}}},
 "indoor":   {"<capteur>": {"YYYY-MM-DD": [min, max, moy]}},
 "lights":   {"YYYY-MM-DD": {"on_h": 6.2}}}
```

Usage dans l'appli : régression multiple « conso nocturne ~ DJU + heures de volets fermés », affichée
seulement si l'effet est significatif ; sinon l'appli le dit.

## 6. Points ouverts

| Question | Comment trancher |
|---|---|
| Le modèle de Synology supporte-t-il Container Manager et le passage d'une clé USB Zigbee / Thread ? | Vérifier le modèle exact et la version DSM (**à vérifier**) |
| Les volets Wiser sont-ils accessibles localement (Zigbee via passerelle Wiser, Matter, cloud seul) ? | Identifier la référence de la passerelle ; tester l'intégration HA correspondante (**à vérifier**) |
| Le pont Hue du foyer est-il compatible Matter ? | Vérifier la génération du pont (**à vérifier**) ; l'API locale suffit de toute façon |
| Les CGU Intuis autorisent-elles l'usage de l'API de l'application ? | Lecture des CGU (**à vérifier**) ; demande d'accès officiel |
