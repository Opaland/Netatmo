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
