# Étude : où poser le module intérieur libre de la station Netatmo

*Statut : terminée, novembre 2026. Récit S-3.10 (#180). Aucun achat si le module est déjà là ;
sinon module intérieur additionnel Netatmo (NIM01), prix à vérifier. Recommandation en fin de
document.*

## Situation

La station Netatmo du foyer a quatre modules : le **module principal** (intérieur, salon), le module
**extérieur**, et deux modules intérieurs additionnels, **chambre des enfants** et **cave**. Une
station accepte **trois** modules intérieurs additionnels au plus : il reste **un emplacement**.
Pièces candidates : **chambre des parents**, **bureau**, **cuisine**.

Ce que l'archive fait d'un module intérieur, dès la collecte suivante, sans réglage côté code :

- relevés **quotidiens** (min / max / moyenne de température, humidité, CO₂) et **horaires** (un an
  d'historique au premier passage, puis les derniers jours) ;
- dans **Confort** : CO₂ de la nuit (22 h → 7 h, chambres d'abord), heures sous le seuil de confort,
  et, si la pièce est **liée** à une pièce Intuis, la **comparaison sonde du radiateur / station**
  (S-3.8, #116) et le confort mesuré par la station plutôt que par le radiateur ;
- dans **Analyse** : la signature intérieur − extérieur (S-3.7) s'appuie sur le module principal ;
  un module de plus ne la change pas.

## Critères

| Critère | Pourquoi il compte | Poids |
|---|---|---|
| **Écart radiateur / réel** | Le radiateur se règle sur sa propre sonde, souvent près d'une source froide ou chaude. Un écart stable de plus de 1,5 °C fausse la consigne et la consommation (S-3.8). Seule une mesure indépendante dans la pièce le révèle | 3 |
| **Part du chauffage** | Plus la pièce consomme, plus une correction de consigne y rapporte (≈ 7 % de chauffage par degré selon l'ADEME, carte « consigne ± 1 °C ») | 3 |
| **CO₂ et sommeil** | Une chambre fermée la nuit est l'endroit où le CO₂ monte le plus (seuils de l'application : 1 000 et 1 400 ppm) ; la chambre des enfants est déjà suivie | 2 |
| **Confort et occupation** | Une pièce occupée longtemps (nuit, télétravail) mérite une mesure fiable | 2 |
| **Qualité de la mesure** | Une pièce à fortes sources parasites (cuisson, four, vapeur) donne des relevés difficiles à interpréter | 1 |

## Classement

| Rang | Pièce | Écart radiateur (3) | Part du chauffage (3) | CO₂ (2) | Occupation (2) | Mesure (1) | Total / 33 |
|---|---|---|---|---|---|---|---|
| **1** | **Chambre des parents** | 2 : à mesurer, aucun point de comparaison aujourd'hui | 2 : pièce chauffée chaque nuit | 3 : deux adultes, porte souvent fermée | 3 : 8 h par nuit | 3 : pièce calme | **2×3 + 2×3 + 3×2 + 3×2 + 3 = 27** |
| 2 | Bureau | 2 | 2 si télétravail régulier, 1 sinon | 2 : une personne, porte fermée le jour | 3 en télétravail, 1 sinon | 3 | **18 à 25** selon le télétravail |
| 3 | Cuisine | 1 : sonde perturbée par la cuisson, l'écart serait bruité | 1 : apports du four et des plaques, souvent peu chauffée | 1 : pics de cuisson, pas de nuit | 2 | 1 | **13** |

Les notes « 2 » et « 1 » de la part du chauffage sont des hypothèses : **vérifiez-les avec vos
données** avant de poser le module (2 minutes) :

1. Onglet **Pièces**, période « 12 mois » : la part de chaque candidate dans le chauffage. Si le
   bureau consomme nettement plus que la chambre des parents (radiateur puissant, mur nord), il
   remonte au premier rang.
2. Onglet **Confort**, carte « Sonde du radiateur et station » : l'écart déjà mesuré au salon et
   dans la chambre des enfants. S'ils sont tous deux stables et faibles (moins de 0,5 °C), le risque
   d'une sonde biaisée ailleurs est plus faible, et le critère CO₂ / occupation départage.
3. Télétravail (carte « Coût d'une journée de télétravail ») : deux jours ou plus par semaine font passer
   le bureau devant.

## Recommandation

**Chambre des parents**, sauf si le bureau sert au télétravail au moins deux jours par semaine
**et** pèse plus lourd dans le chauffage (étape 1 ci-dessus) : alors le bureau. **Pas la cuisine.**

Pose (principes généraux de mesure de la température intérieure) : à hauteur de lit ou de bureau
(1 à 1,5 m), à l'écart du radiateur (au moins 1 m), du soleil direct, d'une fenêtre ou d'une porte
souvent ouvertes, et pas dans une étagère fermée. Portée radio annoncée jusqu'à 100 m sans obstacle
du module principal ; murs et dalles la réduisent.

## Après la pose : la lier dans Confort

1. **Nommez le module** dans l'application Netatmo comme la pièce Intuis (par exemple « Chambre
   parents » des deux côtés) : l'application propose alors d'elle-même la liaison (suggestion par
   ressemblance des noms, marquée « suggéré »). Un nom contenant « chambre » le classe parmi les
   chambres pour le CO₂ de la nuit.
2. Attendez la **collecte de la nuit** : le module apparaît dans l'archive avec son historique horaire
   (depuis sa pose).
3. Onglet **Confort**, carte « Sonde du radiateur et station » : dans la liste de la pièce, choisissez
   le module s'il n'est pas déjà sélectionné. La liaison est gardée **sur cet appareil** ;
   « Revenir aux suggestions » efface les choix manuels.
4. Après **20 jours de chauffe** avec les deux mesures (novembre à mars), l'écart moyen et le conseil
   « sonde à vérifier » (au-delà de 1,5 °C sur 30 jours) s'affichent.

**À vérifier le lendemain de la pose** : que les modules existants gardent leur nom et leur
historique dans Confort (salon, chambre des enfants, cave). Le collecteur numérote aujourd'hui les
modules dans l'ordre où l'API Netatmo les renvoie (`m0`, `m1`…, voir `collector/station.py`) : si le
nouveau module s'intercalait au lieu de s'ajouter à la fin, les séries seraient décalées. Ce risque
est signalé pour correction (clé stable par identifiant de module) avant la pose.

## Sources

- Netatmo, [nombre de modules par station](https://helpcenter.netatmo.com/hc/it/community/posts/20580410057874-How-many-modules-per-weather-station)
  (trois modules intérieurs additionnels au plus) ;
  [fiche Legrand du module intérieur additionnel](https://www.legrand.fr/pro/catalogue/module-interieur-additionnel-intelligent-et-connecte-netatmo-pour-station-meteo-intelligente-aluminium)
  (température, humidité, CO₂ ; portée, piles AAA).
- Seuils et calculs de l'application : README (station Netatmo, Confort), `web/src/comfort.ts`
  (liaison par ressemblance des noms, écart radiateur − station, 20 jours minimum).
