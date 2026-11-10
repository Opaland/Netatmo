# 06 · Stratégie qualité (QA)

## 1. Principes

1. **Un chiffre faux est pire qu'un chiffre absent.** L'application sert à décider : l'exactitude des
   totaux prime sur tout le reste.
2. **Aucun appel réseau réel en CI.** L'API Intuis est non officielle et fragile : on la simule à partir
   de réponses capturées (anonymisées), on ne la sollicite jamais depuis un test.
3. **Les deux langages partagent un format** (enveloppe chiffrée, documents JSON) : chaque format a
   un test croisé Python ↔ TypeScript.
4. **Les vraies données se vérifient à la main**, contre l'application officielle, à intervalle fixe.

## 2. Existant

| Élément | Où | Couvre |
|---|---|---|
| Tests du collecteur, API simulée | `tests/test_collector.py`, `tests/fixtures/` | Analyse des réponses, combinaison des types de mesure, stockage par année |
| Vecteur de chiffrement croisé | `web/src/__fixtures__/python-vector.json` | Une enveloppe produite par Python est déchiffrée par le code TS |
| Tests d'agrégation TS | `web/src/aggregate.test.ts` (Vitest) | Regroupements mois / cumul / saison |
| CI | `.github/workflows/ci.yml` | `ruff`, `pytest`, `npm test`, `npm run build` |
| Diagnostic | `python -m collector diagnose`, workflow `diagnostic.yml` | Méthodes de mesure disponibles, sans donnée en clair |
| Vérification réelle | `python -m collector verify` + appli officielle | Totaux de janvier chauffage identiques à l'application officielle |

## 3. Niveaux de test à ajouter

| Niveau | Outil | Ce qu'on teste | Exemple concret |
|---|---|---|---|
| Unitaire Python | pytest | Coût HP/HC avec grilles datées ; DJU ; régression de signature ; constructeur d'entrée IA ; vérificateur de nombres ; `rekey` | Grille changée le 1er février : janvier au prix 1, février au prix 2 ; abonnement au prorata d'un mois de 28 jours |
| Unitaire TS | Vitest | Mêmes calculs côté appli (coût, DJU, projection, verdict) | Verdict « Élevé » si écart > seuil ; projection = rythme actuel × profil |
| **Parité Python ↔ TS** | Vitest + fixtures générées par pytest | Mêmes entrées → mêmes coûts, DJU, pente de signature (tolérance 1e-6) | Fixture `parity.json` (à créer) générée par pytest et lue par Vitest |
| Crypto croisée | pytest + Vitest | Enveloppe v1 dans les deux sens ; échec propre sur mauvaise phrase ; `rekey` lisible par l'appli | Vecteur TS → Python ajouté au vecteur Python → TS existant |
| API simulée | pytest + `httpx.MockTransport` | Réponses « optimisées » et simples ; `$1`/`$2` ; pièce NMW vide / module rempli ; 429 + `Retry-After` ; réponse vide n'écrase rien ; URL de secours | Réponse vide sur les 35 derniers jours : les valeurs existantes restent |
| Météo / station / Linky simulés | pytest | Open-Meteo archive + prévision ; rotation du jeton Netatmo sauvegardée ; échec station → repli Open-Meteo | Le nouveau jeton est écrit chiffré avant tout autre appel |
| IA simulée | pytest, client Anthropic remplacé par un faux | Pas de secret → étape sautée ; nombre inventé → régénération puis repli ; l'entrée ne contient ni coordonnées ni identifiants | Recherche des clés `lat`, `lon`, `id`, `home` dans l'entrée : aucune |
| Bout en bout | Playwright sur la build + données de démo (phrase « demo ») | Déverrouillage, chaque onglet, hors ligne, impression du rapport | Le service worker sert l'appli réseau coupé |
| Visuel | Playwright `toHaveScreenshot` | Verdict, cascade, calendrier, signature, profils, en clair / sombre, 360 px et 1280 px | Différence > 0,2 % des pixels = échec |
| Accessibilité | `@axe-core/playwright` + revue manuelle | Contraste, noms accessibles, zoom 200 %, résumé des graphiques | Zéro violation « serious » ou « critical » |
| Performance | Playwright, CPU bridé ×4, réseau « Fast 3G » | Premier graphique < 3 s clé mémorisée ; taille du JS | Budget de bundle vérifié en CI |
| Réseau sortant | Playwright, interception des requêtes | Le site ne contacte que sa propre origine (NFR-2) | Toute requête vers un autre hôte = échec |

## 4. Vérification sur données réelles

| Contrôle | Fréquence | Méthode | Seuil |
|---|---|---|---|
| Total mensuel chauffage vs application officielle | Trimestrielle + après tout changement du collecteur | `verify`, puis lecture du même mois dans l'appli officielle | ≤ 1 % |
| Chauffe-eau (module NMW) vs appli officielle | Trimestrielle | Idem, mois en cours de tarif HP/HC | ≤ 1 % |
| Transitions de types de mesure (2023→2024, 2024→2025) | Une fois, puis après un `backfill` | Aucun jour à zéro ni doublé autour des dates de bascule | 0 anomalie |
| Coût HP/HC vs facture | Annuelle | Comparer chauffage + eau chaude à la part correspondante de la facture | Écart expliqué |
| Synthèse IA | Chaque mois pendant 3 mois, puis trimestrielle | Relire chaque nombre contre les graphiques | 0 chiffre faux |
| Jours manquants | Hebdomadaire (automatisable) | Liste des jours sans valeur par pièce | 0 sur les 35 derniers jours |

## 5. Matrice de risques

Probabilité (P) et impact (I) de 1 à 3 ; criticité = P × I.

| Risque | P | I | Crit. | Tests qui le couvrent |
|---|---|---|---|---|
| Changement de l'API ou d'un type de mesure → trous silencieux | 3 | 3 | 9 | API simulée, alerte d'échec, contrôle des jours manquants, diagnostic |
| Coût faux (mauvaise grille, mauvais tarif `$1`/`$2`) | 2 | 3 | 6 | Unitaires coût, parité Py ↔ TS, recoupement facture |
| Chiffre inventé par l'IA | 2 | 3 | 6 | Vérificateur de nombres, IA simulée, relecture mensuelle |
| Données irrécupérables (phrase perdue, `rekey` raté) | 1 | 3 | 3 | Crypto croisée, `rekey` testé sur copie avec `verify` avant / après |
| Fuite de données vers un tiers (site ou entrée IA) | 1 | 3 | 3 | Interception réseau Playwright, test de minimisation de l'entrée IA |
| Jeton Netatmo perdu après rotation | 2 | 2 | 4 | Test « jeton écrit avant usage », procédure de ré-amorçage documentée |
| Régression visuelle ou d'accessibilité | 2 | 2 | 4 | Captures Playwright, axe-core |
| Lenteur sur téléphone modeste | 2 | 2 | 4 | Test de performance bridé, budget de bundle |
| Écriture concurrente pont local / collecte (E9) | 1 | 2 | 2 | Test : chaque producteur ne modifie que ses fichiers |

Ordre d'investissement : criticité ≥ 6 avant toute nouvelle fonctionnalité v1.2.

## 6. Définition de « terminé »

Un récit est **terminé** quand :

| # | Critère |
|---|---|
| 1 | Ses critères G / Q / A sont tous vérifiés par un test automatisé, ou par une vérification manuelle notée dans la PR quand l'automatisation est impossible (données réelles) |
| 2 | `ruff`, `pytest`, `npm test`, `npm run build` passent en CI ; aucun appel réseau réel dans les tests |
| 3 | Tout nouveau format de document a sa fixture partagée et un test de parité Python ↔ TS |
| 4 | Aucun secret, aucune donnée en clair, aucune coordonnée dans le dépôt, les journaux ou le résumé de job |
| 5 | Les données de démonstration couvrent la fonctionnalité (sinon le test Playwright ne peut pas la voir) |
| 6 | Pour l'interface : capture de référence mise à jour, axe-core sans violation sérieuse, lisible à 360 px et à 200 % de zoom, information jamais portée par la seule couleur |
| 7 | Pour un calcul : un exemple chiffré à la main figure dans le test |
| 8 | README ou `docs/` mis à jour si la configuration change (secret, variable, commande) ; ADR ajouté si une décision d'architecture change |
| 9 | Pour une fonctionnalité qui touche aux totaux : vérification sur données réelles faite et notée (§ 4) |

## 7. Tests de mutation (#358)

Stryker (lanceur Vitest) casse le code exprès et regarde si un test s'en aperçoit. **Hors de la CI
bloquante** : lancé à la main (`cd web && npm run mutation`, quelques minutes) ou par le workflow
`Mutation` (`workflow_dispatch`, rapport HTML en artefact 30 jours, score par fichier dans le résumé du
job). Stryker s'installe pour la mesure seulement (`npm i --no-save`) : `package-lock.json` et `npm ci`
ne changent pas. Configuration : `web/stryker.config.json` ; les trois tests qui lisent des fichiers
hors de `web/` (documentation) ne tournent pas dans le bac à sable (`web/vitest.mutation.config.mjs`).
Pas de score minimal imposé : un survivant n'est pas toujours un défaut, il se **lit**.

### Mesures (10/11/2026)

| Fichier | Mutants | Vague 1 | Après les tests ajoutés | Survivants + non couverts restants |
|---|---|---|---|---|
| `money.ts` | 153 | 48,4 % | 94,8 % | 8 |
| `pricing.ts` | 47 | 97,9 % | 97,9 % | 1 |
| `periods.ts` | 237 | 65,8 % | 92,8 % | 17 |
| `invoice.ts` | 290 | 62,9 % | 93,8 % | 18 |
| `reconstitute.ts` | 306 | 72,6 % | 76,5 % | 72 → #392 |
| `crypto.ts` | 58 | 82,8 % | 96,6 % | 2 |
| **Total** | 1 091 | **66,8 %** (223 survivants, 140 non couverts) | **89,2 %** (98 survivants, 20 non couverts) | |

Les tests ajoutés sont dans `web/src/mutation-vague1.test.ts` ; chacun a été vu rouge sur son mutant
(le survivant a disparu à la vague suivante). La vague 1 a aussi trouvé **un vrai défaut** : sans
Linky, une facture qui compte moins de kWh que les radiateurs disait « de plus » (`invoice.ts`, corrigé).

### Survivants lus et laissés, avec leur raison

| Fichier : ligne | Mutant | Classement | Raison |
|---|---|---|---|
| `money.ts:16` | `raw === null`, `raw === ''` retirés | équivalent | `Number(null)` et `Number('')` valent 0, que les deux validateurs refusent (`v > 0`) |
| `money.ts:70` | `projectedKwh !== null` → `true` | équivalent | `null >= ytdKwh` est faux dès que `ytdKwh > 0`, condition déjà exigée |
| `money.ts:97` | `kg < 10` → `kg <= 10` | équivalent | à 10 exactement, 0 ou 1 décimale écrivent tous deux « 10 » |
| `money.ts:111` | `<` → `<=` dans le tri | équivalent | ne change l'ordre que de deux grilles de même date de début |
| `pricing.ts:51` | `'0000-01-01'` → `''` | équivalent | la ligne de prix manuelle est rendue pour tout jour ; sa date n'est jamais lue |
| `periods.ts:14` | `isLeap` (9 mutants) | équivalent | n'est appelé que pour un début au 29 février de l'année d'avant : l'année comparée suit une bissextile et ne l'est jamais |
| `periods.ts:59-60` | `a > from` → `>=`, `b < to` → `<=` | équivalent | à égalité les deux branches donnent la même borne |
| `periods.ts:92-93, 96` | bornes de `yoyWindow` (6 mutants) | équivalent | rattrapés par le contrôle `from > to`, ou la tranche `slice(5)` donne `01-01` dans les deux cas |
| `invoice.ts:27, 31, 35, 37` | contrôles de type de `validInvoice` (8 mutants) | équivalent | `isDay` compare à la chaîne d'origine (`===`) et `Number.isFinite` ne convertit pas : un tableau ou une chaîne ne passent pas |
| `invoice.ts:127, 157` | `subDays--`, `subDays === 0` → `false` | équivalent | seul `subDays === 0` est lu, et sans jour de prix `avgPrice` est déjà nul |
| `invoice.ts:194-200, 227` | `diff > 0` → `>= 0`, `residual >= 0` → `> 0` | équivalent | branches atteintes seulement pour `|diff| ≥ 1` et `|reste| > tolérance ≥ 2 €` : jamais à zéro |
| `invoice.ts:229` | `heatCost !== null` → `true` | équivalent | ne vaut `null` que sans prix moyen, cas déjà sorti en « no-price » |
| `crypto.ts:31` | `typeof iter !== 'number'` retiré | équivalent | `Number.isInteger` refuse déjà tout ce qui n'est pas un nombre |
| `reconstitute.ts` | 72 mutants des heuristiques | **à lire** | deuxième vague : #392 |

## 8. Fuzz à graine fixe des entrées non sûres (#359)

`web/src/fuzz.test.ts` essaie chaque porte d'entrée sur 2 000 valeurs générées (graine fixe,
`mulberry32`), biaisées vers les formes réelles (clés connues, jours valides) et les formes imprévues
(`__proto__`, `constructor`, NaN, 1e308, 5 000 caractères, demi-paire UTF-16, 2026-02-30, types croisés).
L'échec donne la graine et le numéro du cas ; toute la suite tourne en moins d'une seconde.

| Porte | Invariant |
|---|---|
| Préférences relues (`parseColdDraft`, `parseEvInput`, `parseHeatPumpInputs`, `parseHaLinks`, votes, premier lancement, locataire, pièces arrêtées, Shelly, volets, marque « rester connecté », raison du verrouillage) | ne lève jamais ; chaque champ du bon type et borné, ou la valeur par défaut ; `Object.prototype` intact |
| Routes (`parseRoute`) | `null`, ou une route connue (clé propre, pas `constructor`) que `routeKey` redonne à l'identique |
| Invitation (`inviteUrl`) | `null`, ou une adresse `https:` (ou locale) sans identifiants, requête ni autre fragment que `#installer` |
| Cellules CSV (`textCell`) | jamais `= + - @`, tabulation ou retour chariot en tête ; `untextCell` redonne le texte |
| Facture (`validInvoice`) | `null`, ou des montants finis et des jours qui existent |
| Enveloppes (`checkEnvelope`, `loadNote`) | refus par `BadEnvelope`, jamais une autre exception ; une note forgée rend la valeur de repli |

Défauts trouvés le 10/11 et corrigés dans la même PR : route `#parametres-constructor` ou
`#compteur-hasOwnProperty` acceptée (`in` lit la chaîne des prototypes : `Object.hasOwn`) ; demi-paire
UTF-16 dans `#piece-…` qui faisait lever `routeKey` ; raison d'arrêt `__proto__` gardée ; facture du 30
février acceptée (lue comme le 2 mars) ; nombre de jours du brouillon de l'alerte froid repris tel quel
(une chaîne passait) ; `parseColdConfig` qui levait sur un objet avec son propre `toString`. Chaque
invariant a été vu rouge en retirant sa garde (regex `FORMULA` de `csv.ts`, contrôle des jours du
brouillon…).

## 9. Sources publiques réelles (#363)

`tests/test_sources_reelles.py` appelle pour de vrai les sources sans clé et vérifie qu'elles répondent
dans le format que le code lit : une journée d'archive Open-Meteo (variables de `weather.py`, pour un
lieu public, jamais le logement), l'en-tête et les lignes des trois CSV de la CRE (colonnes lues par
`analysis.ts` et `insights.py`), une saison Tempo complète (`scripts/tempo_jours.py`).

- Marqué `reseau` et exclu par défaut : `pytest -q` (et la CI) n'appelle rien ; `pytest -m reseau` ou le
  workflow `Sources publiques` (à la demande) les lance.
- Source injoignable (DNS, délai, 5xx, 429) : test **ignoré** avec la raison ; format changé : **échec**
  en nommant la colonne ou la variable, et le workflow ouvre une issue (fermée au premier passage vert).
- Les contrôles de format sont des fonctions pures, testées hors réseau sur les copies du dépôt
  (`web/public/tarifs/`) : une colonne renommée fait échouer le contrôle en la nommant.
- Journal : noms de colonnes, comptes et codes HTTP seulement.
