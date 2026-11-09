# 04 · Architecture (Architect)

## 1. Architecture actuelle

```
                    GitHub Actions (cloud, chaque nuit 04:17 UTC)
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ collector (Python 3.12)                                                  │
 │   api.py      ── OAuth « password » ──► app.muller-intuitiv.net (Intuis) │
 │   weather.py  ── HTTPS sans clé    ──► Open-Meteo (archive + prévision)  │
 │   station.py  ── OAuth refresh     ──► api.netatmo.com (station, option) │
 │   enedis.py   ── jeton personnel   ──► Conso API (Linky, option, en cours)│
 │   storage.py + crypto.py : AES-256-GCM, PBKDF2-SHA256 600 000 it.        │
 │   [en cours] synthèse IA mensuelle ──► API Claude (secret)               │
 └───────────────┬──────────────────────────────────────────────────────────┘
                 │ git commit data/*.enc.json (seulement si le contenu change)
                 ▼                                  ┌─────────────────────────┐
         Dépôt public Opaland/Netatmo ── deploy ──►  │ GitHub Pages : PWA       │
         (fichiers illisibles)          (Pages)     │ Vite + TS + ECharts      │
                                                    │ WebCrypto : déchiffre    │
                                                    │ dans le navigateur       │
                                                    └─────────────────────────┘
 Échec de collecte ──► issue GitHub « La collecte quotidienne échoue » (e-mail), fermée au succès.
```

Points clés : aucun serveur, aucune base ; l'enveloppe chiffrée est volontairement simple pour que
WebCrypto la déchiffre : `{"v":1,"kdf":"PBKDF2-SHA256","iter":N,"salt":b64,"iv":b64,"ct":b64}`
(`ct` inclut l'étiquette GCM de 16 octets). Une écriture n'a lieu que si le texte clair change, ce qui
évite un commit par nuit sans nouveauté.

## 2. Modèle de données chiffré (`data/`)

| Fichier | Contenu (texte clair) | Producteur | Lecture par l'appli |
|---|---|---|---|
| `keyinfo.json` (**clair**) | `{"salt": b64, "iter": 600000}` | collecteur, une fois | Au déverrouillage |
| `meta.enc.json` | `home`, `rooms` (id, nom, catégorie), `years`, `hourly_years`, `first_day`, `last_day`, extras disponibles, `updated` | collecteur | Toujours, en premier |
| `YYYY.enc.json` | `daily`: `{room: {"YYYY-MM-DD": Wh}}` · `tariffs`: `{room: {jour: [Wh $0, Wh $1, Wh $2]}}` · `temps`: `{room: {jour: [mesurée °C, consigne °C \| null]}}` | collecteur | Toutes les années au chargement |
| `YYYY.hourly.enc.json` | `hourly`: `{room: {"YYYY-MM-DDTHH": Wh}}` | collecteur | À la demande (profils horaires) |
| `weather.enc.json` | `source`, `outdoor`: `{jour: [min, max, moy]}`, `indoor`: `{jour: moy}` | collecteur (Open-Meteo ou station) | Si présent |
| `netatmo-token.enc.json` | jeton de rafraîchissement Netatmo, renouvelé à chaque usage | collecteur | Jamais |
| `linky.enc.json` (en cours) | `daily`: `{jour: Wh}` foyer entier | collecteur (`enedis.py`) | Si présent |
| `insights.enc.json` (en cours) | `generated`, `model`, `period`, `markdown` | job IA | Si présent |
| `local-YYYY.enc.json` (proposé, E9) | voir § 5 | pont local | Si présent |

Règles : toutes les valeurs d'énergie en **Wh** (conversion en kWh dans l'appli) ; jours en **heure
locale** de la maison ; un document optionnel absent (`404`) n'est jamais une erreur (`optional()` dans
`web/src/data.ts`) ; un producteur n'écrit **que ses propres fichiers**, seul le collecteur écrit `meta`.

Évolution proposée de `insights.enc.json` (FR-18) :
`{"history": {"YYYY-MM": {"generated", "model", "markdown", "input": {…agrégats envoyés…}, "checks": {"numbers_ok": true}}}}`
pour conserver toutes les synthèses et montrer exactement ce qui a été envoyé.

## 3. Couche IA

### 3.1 Synthèse mensuelle (en cours)

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

| ADR | Décision | Statut | Alternatives écartées | Compromis |
|---|---|---|---|---|
| ADR-1 | **Zéro serveur** : GitHub Actions (calcul) + Pages (diffusion) | Accepté | VPS, Home Assistant comme socle, Cloudflare Workers | Gratuit et sans maintenance ; en échange, pas d'accès au LAN et granularité nocturne |
| ADR-2 | **Chiffrement symétrique par phrase de passe**, un document par année | Accepté | Dépôt privé seul, chiffrement asymétrique | Simple et compatible WebCrypto ; toute la sécurité repose sur la phrase de passe (d'où `rekey` et l'indicateur) |
| ADR-3 | **Horaire séparé** en `YYYY.hourly`, chargé à la demande | Accepté | Tout dans `YYYY` | Chargement initial rapide sur téléphone modeste ; un aller-retour de plus pour les profils |
| ADR-4 | **IA côté Actions**, clé en secret, sortie chiffrée, **chiffres calculés par le code** | Accepté (en cours) | IA dans le navigateur ; IA qui calcule elle-même | Pas de clé exposée, texte vérifiable ; le texte n'est rafraîchi qu'une fois par mois |
| ADR-5 | **Chat navigateur reporté** jusqu'à preuve que la synthèse est lue (2 mois sur 3) | Proposé | Le livrer en v1.1 | Évite d'ouvrir le site vers un tiers pour un usage non démontré |
| ADR-6 | **Aucun pilotage** d'équipement depuis l'application | Accepté | Boutons volets / Hue via pont | Pas d'écriture, pas de surface d'attaque ; le propriétaire utilise Home Assistant ou les applis fabricants pour piloter |
| ADR-7 | **Pont local en lecture seule**, s'il est construit : conteneur Python minimal sur le Synology, ou automatisation Home Assistant si HA est déjà installé | Proposé, conditionné à la mesure (02 § 10) | Ouvrir un port du NAS à Internet ; runner GitHub auto-hébergé sur le NAS | Le NAS pousse vers GitHub (sortant uniquement) ; pas de port entrant ; un runner auto-hébergé sur dépôt public exécuterait du code de PR : écarté |
| ADR-8 | **Transport du pont** : `git push` de `data/local-YYYY.enc.json` seulement, jeton GitHub à grain fin limité à ce dépôt (contents: write), un push par jour avant 04:00 UTC | Proposé | API Contents ; branche séparée ; MQTT vers un broker cloud | Écrivain unique par fichier, donc pas de conflit avec la collecte ; les données apparaissent au déploiement nocturne suivant |
| ADR-9 | **Phrase de passe sur le NAS** (secret Docker / variable protégée) pour chiffrer `local-*` | Proposé, risque accepté | Chiffrement hybride (clé publique côté NAS, clé privée dérivée de la phrase dans le navigateur) | Simple et réutilise `collector.crypto` ; un NAS compromis expose toutes les données : le chiffrement hybride reste l'évolution prévue si le pont devient durable |
| ADR-10 | **Météo** : Open-Meteo par défaut, station Netatmo en option, jeton tournant stocké chiffré dans le dépôt | Accepté (en cours) | Jeton en secret GitHub (non réinscriptible par le job) | Pas de manipulation manuelle ; si un commit échoue après rotation, le jeton est perdu : il faut ré-amorcer `NETATMO_REFRESH_TOKEN` (documenter) |

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
