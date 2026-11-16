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
| `reconstitute.ts` | 306 | 72,6 % | 76,5 % → **98,0 %** (vague 2, #392) | 6 (5 équivalents, 1 non tranché, ci-dessous) |
| `crypto.ts` | 58 | 82,8 % | 96,6 % | 2 |
| **Total** | 1 091 | **66,8 %** (223 survivants, 140 non couverts) | **89,2 %** (98 survivants, 20 non couverts) | |

Les tests ajoutés sont dans `web/src/mutation-vague1.test.ts` ; chacun a été vu rouge sur son mutant
(le survivant a disparu à la vague suivante). La vague 1 a aussi trouvé **un vrai défaut** : sans
Linky, une facture qui compte moins de kWh que les radiateurs disait « de plus » (`invoice.ts`, corrigé).

**Deuxième vague (#392, 12/11/2026) : les heuristiques de `reconstitute.ts`.** Mutation limitée à ce
fichier (`npx stryker run --mutate src/reconstitute.ts`, après l'installation que fait
`npm run mutation` ; 94 à 128 s sur 4 cœurs) : 76,5 % (55 survivants, 17 non couverts) →
**98,0 %** (6 survivants : 5 équivalents, 1 départage non tranché). Les tests sont dans
`web/src/mutation-vague2.test.ts`, vus rouges par la vague d'après (les 66 autres mutants tués) :
médiane (tri numérique, parité), jours avec Linky seuls et `minRef` inclus, jours de chauffage
`> 0,2`, part de la pièce et répartition (`weights > 0`, partage égal), signature gardée seulement si
`slope < 0` (pente nulle comprise), saison la plus proche (avant et après), bornes de la fenêtre, et
pour les jours suspects : `minExpected` inclus, ratio strict, seuil Linky `max(3, ½ écart)` des deux
côtés, jours bas exclus des références les uns des autres.

Mesure complète du même jour (toute la configuration, 123 s) : **93,6 %** sur 1 131 mutants hors
ignorés (57 survivants, 16 non couverts). `periods.ts`, modifié depuis le 10/11 (PR #418 et #429), compte
283 mutants (277 hors ignorés) et passe de 92,8 % à 86,3 % : 38 mutants non tués, surtout l. 144-148
et 25 ; à lire dans une vague suivante.

**`periods.ts` relu (#495, 12/11/2026).** `npx stryker run --mutate src/periods.ts` : **86,3 % → 94,2 %**
(22 survivants et 16 non couverts → 13 survivants et 3 non couverts, tous équivalents, tableau
ci-dessous). Deux tests dans `web/src/periods.test.ts` (« #495 »), vus rouges par la vague (les
22 mutants qu'ils visent ont disparu à la suivante) : les jours de coupure (#394) de part et d'autre
de la fenêtre, premier et dernier jour compris, nommés par cause (`yoyCaveat`, l. 144-148, qu'aucun
test n'appelait avec `cuts`) ; une fenêtre qui commence au 1er janvier quand les données ont commencé
plus d'un an avant, quel que soit leur jour (l. 103). Au passage, `vitest.mutation.config.mjs` trouve
lui-même les tests qui lisent hors de `web/` (`../../`) au lieu de les lister : la liste écrite à
la main avait vieilli (`dju.test.ts`, qui lit `collector/weather.py`, faisait échouer le premier
passage de Stryker).

**`curve.ts` entre dans la mutation (#622, 16/11/2026).** `npx stryker run --mutate src/curve.ts` :
**76,0 % → 93,5 %** (454 mutants, 78 survivants et 31 non couverts, 47 s → 433 mutants, 28 survivants,
0 non couvert, 60 s, poste à 4 cœurs partagé). Les tests sont dans `web/src/curve-mutation.test.ts`,
vus rouges par la vague (les 50 mutants qu'ils visent ont disparu à la suivante) : les 48 demi-heures
de l'axe ; le premier instant d'un jour dont minuit n'existe pas (`localMidnight`, fuseau qui change
d'heure à minuit) et la demi-heure doublée d'un changement d'heure de 30 min ; les demi-heures d'un
seul jour, une courbe incomplète jamais « bonne », le 13/11 déjà « nouvelle lecture », 1 kWh et 40 Wh
écrits ; `lastCurveDay` (jusque-là sans test, appelé par les vues Linky, Voiture électrique, Panneaux
solaires et Répartition) ; le samedi et la fenêtre de la journée type ; la moyenne par jour de
`typicalHourly` (deux jours de valeurs différentes, une pièce hors du choix, un jour sans relevé
compté zéro, un jour après le dernier relevé écarté même rangé dans le désordre, le cache par
fenêtre) ; l'interpolation du centile sur des valeurs non triées, en nombre pair et impair ; l'heure
doublée de l'automne et les bornes de `measuredWatts` ; les bornes du talon et de la pointe, et la
pointe qui garde **la première** demi-heure à égalité (comportement existant, figé : à changer seulement
sur décision). `windowDays` de `curve.ts`, appelé nulle part (`grep -rn windowDays web/src` : seuls
ceux de `lower.ts`, `money.ts` et `works.ts`, des paramètres homonymes), est **retiré** avec son
`addDays` (21 mutants). Aucun défaut trouvé. `curve.ts` entre dans le `mutate` de `stryker.config.json`.

**15 survivants « statiques » sont des faux survivants du lanceur**, pas des trous de test. Ils sont
évalués au chargement du module (`SLOTS`, `HALF_HOUR`, `nextDay`, `dayGapExceeded`, les deux formats
`Intl.NumberFormat`, `energy`, `CURVE_READING_SINCE`). L'analyse de couverture par test les attribue
au **seul** test qui charge `curve.ts` à la demande (`data-years.test.ts`, « Linky curve: the same
rule », par `loadCurve` et un `import()`), et Stryker ne rejoue que celui-là, qui ne lit aucune de ces
valeurs ; les fichiers qui importent `curve.ts` en tête ne sont jamais rejoués pour eux. Appliqués à
la main un par un (copie du mutant dans `curve.ts`, `npx vitest run src/curve*.test.ts`, source
remise), **les 15 font rougir** les tests de la courbe (de 1 à 33 échecs ; `HALF_HOUR` divisé tourne
sans fin). Le score qui compte ces 15 comme tués est **97,0 %** ; les 13 qui restent sont équivalents
(tableau ci-dessous). À retenir pour les fichiers suivants : un survivant marqué `static: true` dans
`reports/mutation/mutation.json` se vérifie à la main avant d'écrire un test.

### Survivants lus et laissés, avec leur raison

| Fichier : ligne | Mutant | Classement | Raison |
|---|---|---|---|
| `money.ts:16` | `raw === null`, `raw === ''` retirés | équivalent | `Number(null)` et `Number('')` valent 0, que les deux validateurs refusent (`v > 0`) |
| `money.ts:70` | `projectedKwh !== null` → `true` | équivalent | `null >= ytdKwh` est faux dès que `ytdKwh > 0`, condition déjà exigée |
| `money.ts:97` | `kg < 10` → `kg <= 10` | équivalent | à 10 exactement, 0 ou 1 décimale écrivent tous deux « 10 » |
| `money.ts:111` | `<` → `<=` dans le tri | équivalent | ne change l'ordre que de deux grilles de même date de début |
| `pricing.ts:51` | `'0000-01-01'` → `''` | équivalent | la ligne de prix manuelle est rendue pour tout jour ; sa date n'est jamais lue |
| `periods.ts:25` | `isLeap` (12 mutants, dont 3 non couverts) | équivalent | n'est appelé que pour un début au 29 février de l'année d'avant : l'année comparée suit une bissextile et ne l'est jamais (toute variante qui rend « non bissextile » pour elle donne le même 1er mars) |
| `periods.ts:69-70` | `a > from` → `>=`, `b < to` → `<=` | équivalent | à égalité les deux branches donnent la même borne |
| `periods.ts:102-103, 106` | bornes de `yoyWindow` (4 mutants) | équivalent | rattrapés par le contrôle `from > to`, ou à égalité la tranche `slice(5)` donne `01-01` et `to` la même borne dans les deux cas |
| `periods.ts:144` | `?? []` → `?? ["Stryker was here"]` | équivalent | sans `cuts`, la chaîne ajoutée n'est pas une date : elle ne tombe jamais entre deux jours `AAAA-MM-JJ` (`d <= t` est faux) |
| `invoice.ts:27, 31, 35, 37` | contrôles de type de `validInvoice` (8 mutants) | équivalent | `isDay` compare à la chaîne d'origine (`===`) et `Number.isFinite` ne convertit pas : un tableau ou une chaîne ne passent pas |
| `invoice.ts:127, 157` | `subDays--`, `subDays === 0` → `false` | équivalent | seul `subDays === 0` est lu, et sans jour de prix `avgPrice` est déjà nul |
| `invoice.ts:194-200, 227` | `diff > 0` → `>= 0`, `residual >= 0` → `> 0` | équivalent | branches atteintes seulement pour `|diff| ≥ 1` et `|reste| > tolérance ≥ 2 €` : jamais à zéro |
| `invoice.ts:229` | `heatCost !== null` → `true` | équivalent | ne vaut `null` que sans prix moyen, cas déjà sorti en « no-price » |
| `crypto.ts:31` | `typeof iter !== 'number'` retiré | équivalent | `Number.isInteger` refuse déjà tout ce qui n'est pas un nombre |
| `reconstitute.ts:24` | `d <= dernier jour` → `<` | équivalent | le dernier jour d'une pièce a toujours un relevé : la boucle le saute (`continue`) dans les deux cas |
| `reconstitute.ts:79` | `[]` → `["Stryker was here"]` | équivalent | le point parasite (une chaîne) est rejeté par `fitSeason` (`t < 15` est faux pour une lettre) |
| `reconstitute.ts:93` | `fits.has(s)` → `false` | équivalent | la boucle de la saison la plus proche retrouve la même saison, seule à l'écart 0 (une saison par année de début) |
| `reconstitute.ts:97` | `gap < best[0]` → `<=` | non tranché | ne change que l'égalité : un jour perdu à égale distance de deux saisons (une avant, une après) prend la première trouvée (`<`) ou la dernière (`<=`). Laquelle est la bonne est une question de modèle, pas de code ; non figée par un test |
| `reconstitute.ts:131` | `k !== 0` → `true` | équivalent | le jour lui-même n'est jamais une référence : perdu (`rebuildLost`) ou bas, donc exclu (`suspectDays`) |
| `reconstitute.ts:267` | `<` → `<=` dans le tri des années | équivalent | une année n'apparaît qu'une fois : jamais d'égalité |
| `curve.ts:13, 14, 76, 106, 140, 141, 143, 153` | 15 mutants statiques (`SLOTS`, `HALF_HOUR`, `nextDay`, `dayGapExceeded`, formats, `energy`, `CURVE_READING_SINCE`) | faux survivant (lanceur) | rejoués par le seul test qui charge `curve.ts` par `import()` ; appliqués à la main, les 15 font rougir `curve*.test.ts` (paragraphe #622 ci-dessus) |
| `curve.ts:21, 31, 85, 97` | cache des formats et des demi-heures par jour (`!f` → `true`, `.set` retiré, `has` → `false`) | équivalent | un cache : sans lui la même valeur est recalculée à chaque appel |
| `curve.ts:60` | `o !== null` → `true` dans `isRecord` | équivalent | `null` passé à `mergeFlatYear` y est lu `o ?? {}` : vide, comme sans la garde |
| `curve.ts:71` | ancre `^` ou `$` retirée de la date d'une marque | équivalent | le jeu des jours marqués ne sert qu'à `has(day)` avec un jour `AAAA-MM-JJ` : une clé plus longue n'y est jamais égale |
| `curve.ts:133` | `dayKwh === undefined` retiré ou `\|\|` → `&&` | équivalent | `Number.isFinite(undefined)` est faux : la seconde condition rend déjà `null` |
| `curve.ts:187, 232, 278` | `k > last`, `day > lastH`, `day > last` → `>=` | équivalent | à égalité la même valeur est réécrite (et les clés d'une `Map` sont uniques) |
| `curve.ts:233` | `!days.has(day)` → `false` dans `typicalHourly` | équivalent | un jour hors de la courbe garde sa ligne dans `perDay`, mais seule la boucle sur `days` la lit |

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
