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

**`room-offline.ts` (#621, 16/11/2026), jamais muté avant la v2.7.** `npx stryker run --mutate
src/room-offline.ts` (53 à 98 s sur 4 cœurs, selon la charge) : **77,6 % → 95,8 %** (545 mutants dont
27 ignorés ; 111 survivants et 5 non couverts → 22 survivants, tous équivalents, tableau ci-dessous) ;
le fichier entre dans le `mutate` de `stryker.config.json`. Les tests sont dans
`web/src/room-offline.test.ts` (« #621 »), vus rouges par la vague d'après (les 94 mutants qu'ils visent
ont disparu), et à la main pour les deux qui changent un nombre affiché : `gap * share` → `gap / share`
(deux tests rouges) et le tri des épisodes (`<` → `<=`, `>` retiré). Le principal trou : le test
d'`estimateOffline` n'avait qu'une pièce hors ligne par jour (`share` = 1) ; deux pièces hors ligne le
même jour se partagent maintenant l'écart Linky d'un exemple calculé à la main (0,6 et 0,4 de 4 kWh),
bornes de l'année de référence comprises (premier jour compté, veille non), un jour sans relevé
d'aucune pièce ou sans Linky jamais estimé, un mois de référence tout juste suffisant. Aussi : un
épisode de 2 jours exactement, deux pièces suivies seulement, une pièce ignorée, des relevés dans le
désordre, l'ordre des épisodes (jour, puis pièce), une pièce déclarée arrêtée le dernier jour d'un
épisode, les bornes d'`offlineDaysIn` et `runIn`, un épisode sur deux années, les entrées non textuelles
de `parseStopped`, le bois et l'ordre des relevés dans les années de référence d'un verdict.

| `room-offline.ts` : ligne | Mutant | Raison de l'équivalence |
|---|---|---|
| 103 | `!stopped.length` → `false` | sans déclaration, la boucle recopie chaque épisode tel quel |
| 113 | `r.from < st.from` → `<=`, → `true` | à égalité ou après, la partie d'avant compte 0 jour ou moins : jamais gardée (`>= minDays`) |
| 117, 172, 173, 182 (col. 89), 269 | `>` → `>=`, `<` → `<=` | à égalité, les deux branches rendent la même date |
| 137 | `byRoom.size < 2` → `false` | avec une seule pièce suivie, chaque jour de la liste est un des siens : aucun épisode |
| 141, 265, 275, 292 (col. 74), 338 | `<` → `<=` dans un minimum | à égalité, le minimum est le même jour |
| 148 | `d < first` → `<=` | le premier jour est un jour relevé : il ferme un épisode qui n'existe pas encore |
| 156 | `ongoing = to === dernier jour` → `true` | un épisode encore ouvert à la fin de la boucle finit forcément au dernier jour de la liste |
| 262, 292 (col. 99) | `''` → `"Stryker was here!"` | un jour `AAAA-…` est toujours avant une lettre : le minimum est le même |
| 295 | `!out.has(room) \|\| why` → `true` | les fenêtres vont de l'année d'avant vers les plus anciennes : une pièce « ajoutée le … » dans une fenêtre l'est aussi (ou absente) dans les suivantes, jamais « manquante » ensuite |
| 341 | `weather?.get` → `weather.get` | `deg` n'est appelé que si `weather` existe |
| 347 | `d >= start` → `d > start` | le premier jour du premier épisode est un jour hors ligne, déjà écarté (`offDays`) |
| 381 | `n++` → `n--` | seul `n !== 0` est lu |

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

**`data-quality.ts` entre dans la mutation (#623, 16/11/2026).** `npx stryker run --mutate
src/data-quality.ts` : **66,1 % → 80,7 %** (1 851 mutants dont 23 ignorés ; 517 survivants et 103 non
couverts → 293 et 59 ; 470 s → 399 s sur un poste à 4 cœurs partagé, chargé : le cadrage avait mesuré
161 s). La vague vise les quatre fonctions de l'issue : leurs **261** survivants et non couverts
tombent à **5**, tous écrits ci-dessous. Les tests sont dans `web/src/data-quality-mutation.test.ts`,
vus rouges par la vague (les mutants visés ont disparu à la suivante) : `yearVerdicts` (98 %, juste
sous 98 %, 90 %, juste sous 90 % ; une année sans radiateurs ou sans jour attendu ; trois trous au
plus par source, ceux des autres sources à partir de 7 jours, 0 kWh, un trou sur deux années ; année
basse et 5 jours suspects (pas 4) qui font « correcte », jamais une année « à vérifier » ; jours
au-dessus du compteur, valeurs impossibles et jours × pièces au singulier et au pluriel ; pièce
arrêtée à partir de son année ; « perdus chez Intuis » pour les radiateurs et le chauffe-eau seuls,
pas pour un 0 kWh ni une autre source) ; `fineSource` (deux pièces sans relevé sur des périodes
différentes, chacune nommée, une partie sans nom, un trou court épars, seul le trou du dernier jour
« en cours », un même trou dans deux pièces dit une fois « pièces », la coupure qui n'explique que le
relevé horaire, la note du rattrapage au-delà de 30 jours et pour les pièces seulement, les jours
incomplets sous 20 heures et 40 demi-heures, la courbe récupérable jusqu'au premier jour gardé
compris et la note des demi-heures d'avant à partir de 8 jours) ; `lowYears` (médiane de parts non
triées, en nombre impair et pair ; 60 % tout juste non basse ; deux années suffisent ; novembre et
mars comptent, octobre et avril non ; 30 jours au moins ; ni Linky nul ni jour incertain ; médiane
nulle) ; l'ordre des trous (le plus long d'abord, puis le plus ancien). Aucun défaut trouvé, aucune
règle changée. `data-quality.ts` entre dans le `mutate` de `stryker.config.json`.

**Reste pour une vague suivante** (347 survivants et non couverts hors des quatre fonctions, dont 58
textes) : `intuis` 111, `station` 60, `catchUpOf` et les aides des causes 45, `monthStatus`,
`sourceVerdict`, `gapTreatment` 38, `aboveMeter`, `roomDays`, `qualityReport` 37, `linky` 23,
`runs` et `coverParts` 21, `curveRecover` à `seenParts` 9, `tidy` 3.

**La couverture par source (#679, 23/11/2026) : `intuis`, `station`, `linky`.** `npx stryker run --mutate
src/data-quality.ts` (3 processus, 4 min avant, 3 min 37 s après) : **80,7 % → 91,0 %** (1 851 mutants dont 23
ignorés ; 293 survivants et 59 non couverts → 149 et 16). Les trois lecteurs par source, ceux qui disent
pour chaque source les jours attendus, reçus et les trous d'État des données : **194 → 12** survivants et
non couverts (`intuis` 111 → 6, `station` 60 → 5 avec `absentWithin`, `linky` 23 → 1), tous équivalents
(tableau ci-dessous). Les tests sont dans `web/src/data-quality-sources.test.ts` (« #679 »), vus rouges par
la vague d'après (les mutants visés ont disparu ; deux vagues) : chaque trou comparé **en entier** (libellé,
qui, `all`, `ongoing`, `link`, `same`, cause et « Récupérable ? » au mot près), trois jours qui font un trou
et deux épars (toutes les pièces, une pièce, Linky, station, un module), le Linky qui a 80 % des jours (8 sur
10, pas 7), le redémarrage de la passerelle la veille ou le dernier jour (pas l'avant-veille ni le
lendemain), « 1 nuit » de collecte en échec pour les trois sources, une coupure ou un redémarrage qui
gardent leur cause malgré des nuits en échec, le chauffe-eau remis en service à 30 jours de la fin du trou
(pas 31) et jamais pour les radiateurs, injoignable « ce jour-là », un trou à moitié dans celui des
radiateurs (« même trou », pas « le même »), le trou d'une seule pièce qui n'en est pas un, un logement sans
radiateurs, 0 kWh 14 jours (pas 13, jamais un radiateur, rangés, en cours), une pièce hors ligne un jour ou
deux, le module injoignable de **cette** pièce, la phrase de chaque pièce arrêtée et le jour où une pièce
arrêtée n'est « présente » que si une autre pièce des radiateurs l'est (pas le chauffe-eau), les jours
estimés d'une autre source, au singulier et sur deux années ; Linky lu dans le désordre, la limite des
3 ans elle-même encore chez Enedis, la note du dernier relevé à plus de 3 jours ; la station qui ne parle
d'un trou du Linky qu'entre son premier et son dernier jour (lus dans le désordre), une station sans relevé,
un nom ou une liste de modules absents, deux modules muets les mêmes jours, un trou en cours d'un jour, la
pile sous 15 % (pas 15, pas `null`) dans les 10 jours d'avant ou pendant le trou, le signal nul. Aucun
défaut trouvé, aucun calcul changé. Le reste de `data-quality.ts` (`catchUpOf` et les aides des causes,
`monthStatus`, `sourceVerdict`, `gapTreatment`, `aboveMeter`, `roomDays`, `qualityReport`, `runs`,
`coverParts`…) n’était pas visé : 153 survivants et non couverts, à lire dans une vague suivante.

| #679 : `data-quality.ts` : ligne | Mutant | Raison de l'équivalence |
|---|---|---|
| 344 | `r.room !== room` → `true` | la pièce arrêtée n'a pas de relevé les jours où elle est arrêtée : ses propres jours sont déjà dans son ensemble |
| 347, 350 | `rooms.find(…)?.name` → `.name` | `byRoom` ne garde que les pièces de `rooms` (`ids`) : la pièce est toujours trouvée |
| 366 | `'heating'` → `''` ; `?? []` → `["Stryker was here"]` | `intuis(…, '')` lit les radiateurs comme `'heating'` et rend les mêmes trous (seule leur cause diffère, que `heatingLost` ne lit pas) ; un ensemble vide et un ensemble d'une chaîne qui n'est pas un jour sont tous deux vrais et ne contiennent aucun jour |
| 411 | `offlineNow ?? []` → `["Stryker was here"]` | une chaîne n'a pas de `room` : aucun module trouvé, comme sans liste |
| 489 | nom de la partie `'linky'` → `''` | une seule partie : son nom n'est qu'une clé |
| 531, 532, 534 | `<` → `<=`, `>` → `>=` (bornes d'`absentWithin`) | à égalité la même borne ; le premier et le dernier jour de la source sont des jours présents, jamais absents |
| 545 | `b > a` → `>=` | à égalité le même jour |

**Le collecteur, sans dépendance (#624, 16/11/2026) : `collector/audit.py`.** Le collecteur n'avait
aucun outil de mutation ; en adopter un (`mutmut`) serait une dépendance nouvelle, décision **D86** du
propriétaire. En attendant, `scripts/mutation_collecteur.py` (bibliothèque standard seulement : `ast`,
`sys.monitoring`, `subprocess`), **lancé à la main, jamais dans la CI ni la porte** :
`python scripts/mutation_collecteur.py collector/audit.py [tests…] [--fonction f] [--json fichier]`.
Il copie les fichiers **suivis** du dépôt (sans `data/`), plus le module et les tests nommés s'ils ne le sont pas encore (#655 : un fichier non suivi ne sort pas de l'arbre), dans un dossier temporaire, une copie par processus :
l'arbre de travail et les données ne sont jamais écrits. Une première passe de **toute** la suite
note, test par test, les lignes du module exécutées ; chaque mutant ne lance ensuite que les tests qui
exécutent les lignes de son expression (les plus rapides d'abord, arrêt au premier rouge), et tous ceux
qui atteignent le module pour une expression lue à l'import. Cinq opérateurs (ceux de la sonde du
cadrage) : comparaison inversée ou élargie (`<` → `<=`, `<` → `>=`, `==` ↔ `!=`, `in` ↔ `not in`,
`is` ↔ `is not`), `+ −` et `× ÷` échangés, `and` ↔ `or`, `not` retiré, entier + 1 ; chaque mutant est
une retouche du texte à la place de l'opérateur (les numéros de ligne ne bougent pas). Les deux tests
de `test_origine_dediee.py`, rouges sans mutant dans une copie sans `.git`, sont écartés et nommés.
Limite : un test qui n'atteindrait le module que par un sous-processus (`python -m collector …`) n'est
pas vu ; aucun ne le fait pour `audit.py`.

| Mesure (toute la suite, 4 processus) | Mutants | Tués | Survivants + non couverts | Score | Durée |
|---|---|---|---|---|---|
| Sonde du cadrage (trois fichiers de tests) | 695 | 419 | 276 | 60,3 % | 1 945 s |
| Avant, ce script | 780 | 491 | 286 + 3 | **62,9 %** | 1 214 s |
| Après les tests de #624 | 780 | 547 | 230 + 3 | **70,1 %** | 1 049 s |

(Les durées dépendent de la charge : sur la machine partagée par d'autres tâches, la même mesure
avait passé 4 000 s aux deux tiers. La sonde comptait moins de mutants : ni `in`, ni `is`.)

Les fonctions visées par #624, avant → après : `_pearson` 5/12 → 10/12, `_median` 3/8 → **8/8**,
`hours_vs_linky` 43/82 → 68/82, `day_sums` 15/28 → 27/28, `impossible` 25/33 → 30/33 ; chacune ne
garde que des survivants équivalents (tableau ci-dessous). Les tests sont dans `tests/test_audit.py`
(« #624 »), vus rouges par la vague d'après (les mutants qu'ils visent ont disparu ; à la main aussi
pour `day >= recent` → `>` et pour février d'une année commune) : corrélations calculées à la main
(parfaite, nulle, négative, loin de 0, une série constante), médiane paire et impaire ; un mois d'heures
d'Intuis 1 h ou 2 h en avance ou en retard sur le Linky (sens dit, deux corrélations : 1,00 décalée et
celle sans décalage, recalculée par `statistics.correlation`), un mois aligné sans constat ; 6 jours
non jugés et 7 jugés (`MIN_DAYS`), les derniers jours laissés (`_recent`), une semaine en fin de mois qui
lit l'heure du lendemain, février de 28 jours, une heure du Linky manquante (167 paires : non jugé), un
décalage trouvé sans les décalages suivants, un gain de corrélation de 0,1 exactement, les arrondis ; un
jour à la tolérance exactement (non signalé), 0,5 Wh au-delà (signalé), deux fois le jour à sa propre
tolérance et au-delà, un jour de 100 Wh jamais « deux fois », un mois décalé laissé à `decalage-heures`,
le dernier jour comparé et le premier laissé ; une énergie à 0, négative, au plafond, au-dessus, une
chaîne, un jour vide, une date qui n'existe pas, une heure et une demi-heure négatives sans plafond,
les demi-heures par pièce (`room30`) jamais lues comme énergies. Aucun vrai défaut trouvé ; aucun
calcul ni seuil changé.

| `audit.py` : ligne | Mutant | Raison de l'équivalence |
|---|---|---|
| 966 | `not intuis or not meter` → `and` | avec un seul des deux vide, aucune paire n'a ses deux valeurs : aucune corrélation, aucun mois jugé |
| 969, 979 | `k[:10] < recent` → `<=` (l. 969), `[:10]` → `[:11]` (l. 969 et 979) | l. 969 : un mois qui ne commence qu'au jour `recent` n'a aucune heure retenue par l. 979 ; `[:11]` ajoute « T », qui ne change la comparaison qu'à égalité, fausse dans les deux cas |
| 973 | `+ timedelta(days=4)` → `5`, `.replace(day=1)` → `2` | du 28 au jour + 4 ou + 5, toujours le mois suivant ; un jour de plus en fin de frise ne sert à aucune paire (décalage de 2 h au plus) |
| 974 | `first - timedelta(days=1)` → `2` | un jour de plus en tête de frise, même raison |
| 977 | `day_slots(…, 60, …)` → `61` | pas de 61 min : `i // 60` donne les mêmes 24 heures (k + k // 60 pour k < 24) |
| 980 | `MIN_DAYS * 24` → `/` | rattrapé l. 989 : une corrélation demande `MIN_DAYS * 24` paires, jamais plus que d'heures retenues |
| 987 | bornes `0 <= i + lag < len(keys)` (4 mutants) | la frise déborde d'un jour de chaque côté du mois : `i ± lag` (2 h au plus) y est toujours |
| 1007 | `lag > 0` → `>=` | un décalage nul n'est jamais un constat (l. 994) |
| 1104 | `valid(k[:10], …)` → `[:11]` | `valid` ne lit que `key[:10]` pour un jour |
| 1162 | `valid(k[:10], …)` → `[:11]` | même raison |
| 1173 | `x < 0` → `<=`, `0` → `1` | atteint seulement au-dessus du plafond (une valeur de 0 à 1 Wh sous le plafond est sortie l. 1165) |
| 1506 | `x - mx` → `x + mx`, `y - my` → `y + my` | `Σ(x + mx)(y − my) = Σx(y − my) + mx·Σ(y − my)` et `Σ(y − my) = 0` : la même covariance (de même pour l'autre facteur) |

(Numéros de ligne d'avant #656 : le catalogue est sorti dans `collector/audit_catalogue.py`, retirer 243
pour les lire dans `audit.py` d'aujourd'hui. Ses 19 mutants : 17 tués à la PR #661 (89,5 %), **18
après #666** (94,7 % : la l. 270, `part_decalee / 100` → `/ 101`, tenue par
`test_part_decalee_holds_on_both_sides`, 79,4 % et 80,2 % sur 126 jours) ; le survivant restant, l. 259,
est équivalent : tableau ci-dessous et `docs/etudes/decoupage-audit-charts.md`.)

| `audit_catalogue.py` : ligne | Mutant | Raison de l'équivalence |
|---|---|---|
| 259 | `round((CROSS_RATIO - 1) * 100)` → `* 101` (seuil `depassement_linky`) | avec `CROSS_RATIO` = 1,10 (`quality.py`), `round(10,0)` et `round(10,1)` valent tous deux 10 : la valeur affichée au catalogue ne change pas, et le contrôle lui-même lit `CROSS_RATIO` dans `quality.py`, jamais cette valeur (`grep -rn depassement_linky` : le catalogue seul). **Limite** : l'équivalence tient à la valeur de `CROSS_RATIO` ; calculé pour chaque rapport à deux décimales de 1,01 à 1,99, les deux formes donnent le même entier jusqu'à 1,50 (50 et 50,5, arrondi au pair : 50) et se séparent dès 1,51 (51 et 52). Revérifié par la revue de fin de v2.9 |

**Restent à lire** (une vague suivante, hors des fonctions visées par #624) : 213 survivants et
3 non couverts, surtout `_shift_fit` (34, dont 3 non couverts l. 928 : le texte d'un `decalage-heures`
de 1 ou 2 h, qu'aucun test n'atteint, seul le décalage d'un jour l'est), `linky_lag` (20), `_build_fine` (17), `units` (13), `two_sources`
(11), `tariffs` (10), `valid` (9), `room30_hours` (8) ; la liste sort de `--json`.

**Mesure complète de fin de v2.7 (18/11/2026, [revue](revues/v2.7.md) § 6).** `cd web && npm run
mutation`, les neuf fichiers, 6 min 14 s sur 4 cœurs : **87,7 %** (4 012 mutants ; 423 survivants,
72 non couverts). `room-offline.ts` 95,4 % (24 restants : deux de plus que la mesure de #621, l. 341
`weather?.get` et l. 381 `n++`, à lire), `curve.ts` 93,5 %, `data-quality.ts` 80,7 %, `money.ts`
94,8 %, `pricing.ts` 97,9 %, `invoice.ts` 93,8 %, `reconstitute.ts` 98,0 % ; deux **reculs** depuis
leur dernière vague, le fichier ayant changé sans que la mutation repasse : **`crypto.ts` 96,6 % →
77,6 %** (code d'Argon2id, du contexte non sécurisé et de `keyinfo.json` ; #633) et `periods.ts`
94,2 % → 91,6 % (`missingText`, sans test : 8 non couverts). C'est la mesure complète de la revue de fin
de version (cadrage v2.7, § 6) qui les a vus : à refaire à chaque revue de fin, proposé (D87). `audit.py` (`scripts/mutation_collecteur.py`, toute la
suite, 4 processus) : **70,1 %**, 547 tués sur 780, 1 057 s, le même score que la mesure de #632.

**`crypto.ts` et `missingText` tenus (#637, 18/11/2026).** Cause du recul à 77,6 % : `crypto.test.ts`
lisait `collector/kdf.json` (`../../`), donc `vitest.mutation.config.mjs` l'écartait **en entier** du
bac à sable depuis #509 (Argon2id, partie de #139) — tous les tests du chiffrement avec lui, pas seulement l'accord avec la
collecte. Ce test d'accord passe dans son propre fichier (`crypto-kdf.test.ts`, seul écarté) :
`crypto.test.ts` revient dans la mutation. Puis des tests « #637 » : chaque borne vue des deux côtés
(PBKDF2 au minimum et au maximum acceptés, un de moins ou de plus refusé avec son message ; mémoire et
passes d'Argon2id aux bornes, parallélisme 0 et 2 refusés ; une fraction ou une chaîne d'itérations),
`keyinfo.json` sans sel, au sel non textuel, nul, de version 3 ou au `kdf` inconnu, `keyInfoFields` qui
refuse ce que `checkKeyInfo` refuse ; et dans `crypto-key.test.ts`, la dérivation Argon2id remplacée
(`vi.mock`) par des octets fictifs pour voir **le tampon même** : remis à zéro quand l'import réussit et
quand il échoue (clé de 31 octets), clé non exportable, aucune dérivation commencée hors contexte sûr.
`npx stryker run --mutate src/crypto.ts` (51 s avant comme après, 4 cœurs partagés) : **77,6 % → 98,0 %**
(118 tués, 32 survivants, 2 non couverts → 149 tués, 3 survivants, tous équivalents, tableau
ci-dessous ; 11 mutants statiques ignorés par `ignoreStatic`, comptés maintenant que `crypto.test.ts`
charge le module). Vus rouges par la vague d'après (les mutants visés ont disparu), et à la main :
`raw.fill(0)` retiré, `extractable` à `true` et `iter >= MAX_ITERATIONS` font rougir trois tests.
`periods.ts` : `missingText` testé (1, 2, 45 et 0 jour), **91,6 % → 94,4 %** (35 s) : les 13 survivants
et 3 non couverts restants sont ceux déjà lus équivalents par #495 (`isLeap`, bornes de
`bucketMarks` et de `yoyWindow`, `?? []` de `yoyCaveat`), lignes décalées par `missingText`. Aucun défaut
trouvé, aucune borne ni aucun calcul changé.

**Mesure complète de fin de v2.8 (19/11/2026, [revue](revues/v2.8.md) § 6).** `cd web && npm run
mutation`, les neuf fichiers, 6 min 13 s sur 4 cœurs : **88,6 %** (4 012 mutants ; 394 survivants,
62 non couverts). **Aucun fichier ne recule** : `crypto.ts` 98,0 % et `periods.ts` 94,4 % comme les
mesures de #637 ; les sept autres identiques à la fin de v2.7 au dixième (`room-offline.ts` 95,4 %,
`curve.ts` 93,5 %, `data-quality.ts` 80,7 %, `money.ts` 94,8 %, `pricing.ts` 97,9 %, `invoice.ts` 93,8 %,
`reconstitute.ts` 98,0 %). `audit.py` ne change pas en v2.8 : non remesuré (70,1 %, fin de v2.7). Reste
la cause du recul de `crypto.ts` : `vitest.mutation.config.mjs` écarte **en silence** tout fichier de
tests qui contient `../../` (dix aujourd'hui, aucun d'un module muté) ; une garde est proposée (revue
v2.8, § 12 n° 4).

**Fin de v2.9 (23/11/2026, [revue](revues/v2.9.md) § 6).** Aucun des neuf fichiers de
`stryker.config.json` ne change en v2.9 (`curve.ts` : un commentaire) : la mesure complète n'a pas été
refaite (88,6 %, fin de v2.8). Le collecteur : le catalogue de l'audit sorti dans
`collector/audit_catalogue.py` (#661) a ses 19 mutants mesurés à part (**94,7 %** après #666, le
survivant restant équivalent, tableau ci-dessus) ; le reste d'`audit.py` n'est pas remesuré (ses
définitions sont celles de la v2.8 au caractère près). Pour toute preuve « vu rouge » du collecteur :
`PYTHONDONTWRITEBYTECODE=1` dès le départ (`docs/APPRENTISSAGES.md` A23, A24).

**Les quatre modules de calcul jamais mutés (#678, 23/11/2026).** `analysis.ts`, `aggregate.ts`,
`offpeak.ts` et `wood.ts` entrent dans le `mutate` de `stryker.config.json`. `npx stryker run --mutate
src/analysis.ts,src/aggregate.ts,src/offpeak.ts,src/wood.ts` (3 processus, poste à 4 cœurs partagé) :
**72,0 % → 96,5 %** (10 min avant, 6 min 47 s après). Lignes d'`analysis.ts` du tableau : après #677 (`verdict` passe par `pctChange`, trois lignes de plus), remesuré seul : 98,4 %.

| Fichier | Mutants (ignorés) | Avant | Après | Restants (tous lus, tableau ci-dessous) |
|---|---|---|---|---|
| `analysis.ts` | 804 (0) | 58,2 % (264 survivants, 72 non couverts) | **98,5 %** ; 98,4 % après #677 (remesuré seul) | 12 ; 13 après #677 |
| `aggregate.ts` | 368 (0) | 71,7 % (63, 41) | **97,0 %** | 11 |
| `offpeak.ts` | 473 (17 → 0) | 80,9 % (82, 5) | **95,1 %** ; 95,4 % après #684 (remesuré seul) | 23 ; 22 après #684 |
| `wood.ts` | 640 (30 → 0) | 83,8 % (87, 12) | **94,5 %** | 35 |

Les tests sont dans `web/src/analysis-mutation.test.ts`, `aggregate-mutation.test.ts`,
`offpeak-mutation.test.ts` et `wood-mutation.test.ts` (« #678 »), vus rouges par la vague d'après (les
mutants visés ont disparu ; trois vagues). Ce qui manquait : le coût aux colonnes du tarif (une colonne
seule connue, l'autre au prix de base ; un jour dont les colonnes ne font pas le total), `monthlyDju`,
`weekHourGrid` et `dayProfile` (jamais appelés par un test), le r² et l'équilibre de la droite
(consommation constante, pente positive), les jours doux ou sans chauffage hors de l'ajustement et des
anomalies, |résidu| au-delà de 2 σ **et** de 3 kWh (chacun seul ne suffit pas), le verdict (référence
vide, ± 10 % tout juste, références à 5 DJ exactement, pas de froid cette fois), les lecteurs des
fichiers de la CRE et de Tempo (fins de ligne LF, ligne vide en tête, prix unique en première colonne,
lignes incomplètes laissées, rangement par date), le tarif réglementé (jour de fin compris, colonne 1
creuse, colonne 0 au prix plein, bissextile), le comparateur d'offres (jours que les trois offres ne
tarifent pas, Linky sans relevé des radiateurs), la puissance déduite du Linky (jours rangés, pas
standard) ; dans `aggregate.ts`, les filtres, les étiquettes des périodes, `totalsBy`, 1900 et 2100
non bissextiles ; dans `offpeak.ts`, les plages lues sur une fenêtre bornée, une demi-heure à moitié
creuse, la date d'un changement de placement (bornes de 80 %, demi-heure coupée par une borne, ce que
la série et le retour à l'ancien placement apportent à la référence), les périodes toutes datées ; dans
`wood.ts`, la répartition sur les jours (saison complète entière, saison en cours au prorata d'une
saison moyenne, météo commencée en cours de saison, bois gratuit, saison qui ne brûle rien), la pièce
trop chaude (saison de mars et de septembre), les textes au singulier et au pluriel.

**Mutants « statiques ».** Une bonne part des survivants d'avant étaient évalués au chargement du
module (listes des mois, `KVA_STEPS`, `FALLBACK_RANGES`, `SOURCE_TEXT`, les fonctions fléchées de
premier niveau) ou dans le corps d'un `describe` (`parseTrveCsv`, `woodDaily` des tests existants) :
Stryker ne les rejoue qu'avec les tests qui les atteignent pendant leur exécution (comme pour
`curve.ts`, #622). Les tests qui les visent rechargent le module (`vi.resetModules()` puis
`import()`) : les 47 mutants « ignorés » d'`offpeak.ts` et de `wood.ts` sont maintenant mesurés, et
tués sauf les équivalents ci-dessous.

**Un défaut trouvé, corrigé par #684.** Dans `offpeak.ts`, `tri()`, `1 - CLEAR` valait
`0.19999999999999996` : une demi-heure à 20 % tout juste en heures creuses n'était pas « clairement
pleine », alors qu'à 80 % tout juste elle était « clairement creuse » (le mutant `s <= 1 - CLEAR` →
`s < 1 - CLEAR` survivait pour cette raison). La règle écrite de #441 (« at least this share of its
energy went to that column ») tranche la borne : chaque colonne compare maintenant sa propre part à
`CLEAR` (PR de #684, test aux deux côtés de la borne, chiffres de la démo inchangés). Aucun autre défaut ; aucun calcul ni seuil changé.

| #678 : fichier : ligne | Mutant | Raison |
|---|---|---|
| `analysis.ts:34` | `!p.sub` → `false` | un abonnement nul ou absent donne 0 € dans les deux cas (`null × …` vaut 0) |
| `analysis.ts:154` | `r.day < a` → `<=` ; `''` → texte | à égalité le même jour ; une chaîne de départ non vide reste après tout jour `AAAA-…` (un chiffre est avant une lettre), et sans relevé la projection et le verdict rendent `null` dans les deux cas |
| `analysis.ts:175` | `y < year` → `<=` | `y === year` est déjà pris par la branche d'avant |
| `analysis.ts:251` | `p === null` → `false` (ajouté par #677) | `expected` est positif à cet endroit (chaque référence a un total positif) : `pctChange` ne rend jamais `null` ici |
| `analysis.ts:338, 439` | `a.from < b.from` → `<=` (tri des fichiers de la CRE) | ne change que l'ordre de deux lignes de même début, qui diffèrent par la puissance : `trveAt` et `rowAt` filtrent la puissance d'abord |
| `analysis.ts:386` | `p === undefined` → `true` | un cache : le prix du jour est recalculé, le même |
| `analysis.ts:551` | `> 2 * sigma` → `>=`, `> 3` → `>=` | égalité exacte d'un résidu de droite ajustée en virgule flottante, jamais atteinte |
| `analysis.ts:554` | `a.day < b.day` → `<=` (tri des anomalies) | un jour n'a qu'un point (signature par jour) : jamais d'égalité |
| `analysis.ts:583` | filtre `d >= first` retiré ou `true` | les jours d'avant le premier dépassement sont sous la puissance déclarée + tolérance, donc sous le pic : le maximum ne change pas |
| `aggregate.ts:108, wood.ts:123` | `a.day > b.day` (4 mutants chacun : `true`, `false`, `>=`, `<=`) | non tuables sous V8 (le lanceur) : son tri ne lit que le signe négatif du comparateur, et des jours dans le désordre restent bien rangés (testé). Le comparateur d'origine est correct ; un autre moteur pourrait lire le mutant autrement |
| `aggregate.ts:200` | `i === undefined` → `false` | `bucketKeys` donne une clé à chaque jour de `[from, to]` |
| `aggregate.ts:206` | `new Array(n)` → `new Array()` pour `seen` | `seen` n'est lu que par `measuredValues`, en valeur de vérité : `undefined` et `false` s'y valent |
| `aggregate.ts:214` | `seen.get(id)?.[i]` → `seen.get(id)[i]` | `seen` a toujours le groupe que `groups` a |
| `aggregate.ts:277, 283, 286` | `''` → texte, `r.day < first` → `<=`, `breaks ?? []` → `["Stryker was here"]` | comme `analysis.ts:154` ; une chaîne qui n'est pas un jour donne une année `NaN`, qui n'est celle d'aucun relevé |
| `aggregate.ts:320` | `before === null` → `false` | `pctChange(after, null)` rend déjà `null` (`null > 0` est faux) |
| `offpeak.ts:61, 73` | tableau des minutes sans taille, `m <= DAY` | une minute absente vaut `undefined`, lue comme non creuse ; la minute 1440 n'existe pas |
| `offpeak.ts:100` | `v > 0` → `true`, `>= 0` | sans énergie, `0 / 0` donne `NaN`, que `>= 0.5` et `> 0` lisent comme 0 |
| `offpeak.ts:103` | `!n \|\| n === SLOTS` (3 mutants) | sans demi-heure creuse ou sans demi-heure pleine, aucune n'ouvre une plage : la boucle ne rend rien, `null` |
| `offpeak.ts:106, 108, 109` | départ du tour de la journée, `k < SLOTS`, `start - k` | chaque demi-heure est visitée une fois dans tous les cas (la demi-heure de départ, pleine, n'ouvre jamais de plage), puis les plages sont rangées |
| `offpeak.ts:153` | `i <= SLOTS` dans `addTo` | ajoute une 49ᵉ case `NaN`, lue « indécise » : elle ne contredit rien |
| `offpeak.ts:158` | `e > 0` (3 mutants) | sans énergie, `0 / 0` donne `NaN`, ni creux ni plein : `null` dans les deux cas |
| `offpeak.ts:242` | ancre `^` ou `$` retirée (date « à compter du ») | `Date.parse` de la date suivie de `T00:00:00Z` refuse ce que l'ancre laisserait passer |
| `offpeak.ts:264` | `typeof x !== 'object'` → `false` | une chaîne ou un nombre n'a pas de `from` propre : la plage est écartée de même |
| `offpeak.ts:287` | `a === b`, `b === null`, `a < b` → `<=` | les clés d'une `Map` sont uniques ; `'AAAA…' < null` est faux, la même réponse que `b === null` |
| `offpeak.ts:297` | `p.since === null` → `false` | la période sans date est toujours la première (relevés, saisies, repli) : elle est déjà la valeur de départ |
| `offpeak.ts:305` | `some` → `every` | `resolveOffPeak` reçoit des plages ou des périodes, jamais les deux mêlées |
| `wood.ts:90` | `typeof v === 'number'` → `true`, `&&` → `\|\|` | `Number.isFinite` ne convertit pas : une chaîne échoue ; `NaN` et `Infinity` échouent aux bornes |
| `wood.ts:99, 114` | `[]` → `["Stryker was here"]` | une chaîne parcourue donne des lettres, sans saison ni jour : écartées |
| `wood.ts:100, 112, 115, 116, 124` | contrôles `typeof … === 'object'` / `'string'` → `true` | une chaîne, un nombre ou un tableau n'a pas les champs voulus (`Object.hasOwn`), et `realDay` refuse un jour qui n'est pas la chaîne même |
| `wood.ts:104` | `season === null` → `false` | `Number.isInteger(null)` est faux : écartée de même |
| `wood.ts:196` | `!s.purchases.length` → `false` | sans achat, `Math.min()` vaut `Infinity` : la boucle ne tourne pas |
| `wood.ts:222, 229, 232, 423, 427-429` | `> 1e-9` → `>=`, `<= 1e-9` → `<` | égalité exacte à 1e-9 stère, jamais atteinte (des stères saisis au dixième) |
| `wood.ts:245, 261` | `<` → `<=`, `<=` → `<` sur le 31 août | à égalité, la même date ; une saison qui finit le dernier jour connu n'est suivie d'aucune saison en cours, la seule qui lit la saison moyenne |
| `wood.ts:256, 271` (col. 9) | `!last`, `from > last` | une saison qui commence après le dernier jour n'a aucun jour : rien à répartir |
| `wood.ts:271` (col. 39) | `w.eur <= 0` → `true` | du bois brûlé a toujours de la chaleur (rendement ≥ 10 %) : `kwh <= 0` suffit |
| `wood.ts:281, 285` | `denom <= 0`, `sum <= 0` → `false`, `<` | sans degré-jour, tous les poids sont nuls : `if (!x) continue` saute chaque jour |
| `wood.ts:371` | `typeof t === 'number'` → `true` | `Number.isFinite` refuse déjà `null` et `undefined` |
| `wood.ts:413` | `p.species === 'resineux'` → `false`, `'resineux'` → `''` | la branche générale écrit aussi « de résineux » (`SPECIES` en minuscules) |

### Survivants lus et laissés, avec leur raison

| Fichier : ligne | Mutant | Classement | Raison |
|---|---|---|---|
| `money.ts:16` | `raw === null`, `raw === ''` retirés | équivalent | `Number(null)` et `Number('')` valent 0, que les deux validateurs refusent (`v > 0`) |
| `money.ts:70` | `projectedKwh !== null` → `true` | équivalent | `null >= ytdKwh` est faux dès que `ytdKwh > 0`, condition déjà exigée |
| `money.ts:97` | `kg < 10` → `kg <= 10` | équivalent | à 10 exactement, 0 ou 1 décimale écrivent tous deux « 10 » |
| `money.ts:111` | `<` → `<=` dans le tri | équivalent | ne change l'ordre que de deux grilles de même date de début |
| `pricing.ts:51` | `'0000-01-01'` → `''` | équivalent | la ligne de prix manuelle est rendue pour tout jour ; sa date n'est jamais lue |
| `periods.ts:25` | `isLeap` (12 mutants, dont 3 non couverts) | équivalent | n'est appelé que pour un début au 29 février de l'année d'avant : l'année comparée suit une bissextile et ne l'est jamais (toute variante qui rend « non bissextile » pour elle donne le même 1er mars) |
| `periods.ts:78-79` | `a > from` → `>=`, `b < to` → `<=` | équivalent | à égalité les deux branches donnent la même borne |
| `periods.ts:111-112, 115` | bornes de `yoyWindow` (4 mutants) | équivalent | rattrapés par le contrôle `from > to`, ou à égalité la tranche `slice(5)` donne `01-01` et `to` la même borne dans les deux cas |
| `periods.ts:153` | `?? []` → `?? ["Stryker was here"]` | équivalent | sans `cuts`, la chaîne ajoutée n'est pas une date : elle ne tombe jamais entre deux jours `AAAA-MM-JJ` (`d <= t` est faux) |
| `invoice.ts:27, 31, 35, 37` | contrôles de type de `validInvoice` (8 mutants) | équivalent | `isDay` compare à la chaîne d'origine (`===`) et `Number.isFinite` ne convertit pas : un tableau ou une chaîne ne passent pas |
| `invoice.ts:127, 157` | `subDays--`, `subDays === 0` → `false` | équivalent | seul `subDays === 0` est lu, et sans jour de prix `avgPrice` est déjà nul |
| `invoice.ts:194-200, 227` | `diff > 0` → `>= 0`, `residual >= 0` → `> 0` | équivalent | branches atteintes seulement pour `|diff| ≥ 1` et `|reste| > tolérance ≥ 2 €` : jamais à zéro |
| `invoice.ts:229` | `heatCost !== null` → `true` | équivalent | ne vaut `null` que sans prix moyen, cas déjà sorti en « no-price » |
| `crypto.ts:64` | `typeof iter !== 'number'` retiré | équivalent | `Number.isInteger` refuse déjà tout ce qui n'est pas un nombre |
| `crypto.ts:74` | `typeof n === 'number'` → `true` dans `intIn` | équivalent | même raison : `Number.isInteger` refuse déjà une chaîne (`'65536'`, testé) |
| `crypto.ts:95` | `typeof info !== 'object'` → `false` | équivalent | une valeur JSON qui n'est pas un objet (nombre, chaîne, booléen) n'a pas de `salt` textuel : la condition suivante la refuse avec le même message |
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
| `data-quality.ts:467` | `a.from < b.from` → `<=` dans l'ordre des trous | non tranché | ne joue que pour deux trous de même début et même longueur (deux pièces aux causes différentes, que `tidy` ne fond pas) : l'original rend 1 dans les deux sens, le mutant -1, aucun des deux ne définit leur ordre. Le figer (par nom de pièce ?) est un choix d'affichage |
| `data-quality.ts:611` | `rooms = []` → `["Stryker was here"]` | équivalent | une chaîne n'a pas d'`id` : `name()` retombe sur l'identifiant, comme sans pièce |
| `data-quality.ts:625` | `recover` de `linky30` `''` → texte | équivalent | jamais lu : `recoverOf` passe par `curveRecover` pour la courbe |
| `data-quality.ts:720` | `l === undefined` → `false` | équivalent | `!(l > 0)` est vrai pour `undefined` : le jour est écarté quand même |
| `data-quality.ts:728` | `shares.length < 2` → `false` | équivalent | avec une seule année, la médiane des autres (aucune) est `NaN` et `usual > 0` est faux : rien n'est rendu non plus |

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
