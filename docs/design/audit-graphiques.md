# Audit des graphiques et de la présentation des données

*Préparation de la refonte v1.6, novembre 2026, sur `main` après la v1.4 (#226). Ce document regarde
**ce qui est montré et comment** : périodes, dates, valeurs d'un même indicateur d'un écran à
l'autre, filtres, regroupements, choix des graphiques, lisibilité. L'exactitude des calculs dans le
code et l'architecture de l'information font l'objet de deux audits séparés. Aucun code de
l'application n'a été modifié.*

Complète [`inventaire.md`](inventaire.md) (jetons, composants) : l'inventaire décrit les couleurs
disponibles, cet audit décrit l'usage qu'en font les graphiques.

## Méthode

- Démonstration construite et servie localement (`npm run build`, `vite preview`), déverrouillée
  par le bouton « Démo » ; dernière donnée **8 novembre 2026**, audit le 9 novembre 2026.
- Parcours automatisé avec Playwright : bureau 1 280 × 900 et iPhone 13 (390 × 664), facteur 1 ;
  les 6 onglets (Synthèse, Comparer, Pièces, Analyse, Confort, Rapport) ; les 5 périodes × 4
  granularités de la Synthèse ; les 3 modes de Comparer avec et sans « À climat égal » ; filtres
  « Chauffe-eau » et « Salon seul » sur tous les onglets ; vue foyer active et désactivée ; mode
  simple.
- Les valeurs sont **relevées dans l'interface** : textes, tableaux « Voir les valeurs », résumés
  `aria-label` et infobulles (la souris balaie chaque graphique et le texte de l'infobulle est lu).
- Captures (PNG 8 bits, 0,55 Mo au total) dans [`audit/graphiques/`](audit/graphiques/).

Sévérité : **S1** chiffre faux ou contradictoire visible tout de suite ; **S2** chiffre exact mais
trompeur (période, libellé, donnée manquante non signalée) ; **S3** lisibilité, cohérence visuelle,
accessibilité.

## Synthèse des constats

| # | Sév. | Constat | Chiffres relevés | Ticket |
|---|---|---|---|---|
| 1 | S1 | La carte Linky « Sur 12 mois » couvre 373 jours, le graphique principal « 12 mois » 365 : le même mois « nov. 2025 » n'a pas la même valeur sur le même écran | nov. 2025 : **663 kWh** (graphique principal) contre **866 kWh** chauffage + chauffe-eau (carte Linky) ; chauffage sur « 12 mois » : **5 624** contre **5 793 kWh** | v1.5 |
| 2 | S1 | Le prix en € dépend de l'endroit : la projection et les infobulles valorisent au prix moyen de tout le logement, sans filtre ni abonnement | filtre Chauffe-eau : « 12 derniers mois **1 513 kWh = 249 €** », à côté « Fin 2026 estimée **≈ 1 514 kWh ≈ 283 €** » ; barre « 2026 » : infobulle **985 €** pour 5 273 kWh, total de la période **978 €** | v1.5 |
| 3 | S1 | « Coût » de 2026 : trois montants pour la même année selon l'écran, sans dire ce qu'ils couvrent | Synthèse **978 €** (énergie seule) ; Comparer et Rapport **1 221 €** (abonnement inclus) ; comparateur HP/HC **1 819 €** (tout le logement Linky) | v1.5 |
| 4 | S1 | Cumul annuel : décalage d'un jour après février pour les années non bissextiles | 2026 atteint ses **5 273 kWh** au « **7 nov.** » (dernière donnée : 8 nov.) ; 2025 atteint son total **8 129 kWh** au « **30 déc.** » | v1.5 |
| 5 | S1 | « Jours sous 19 °C » : deux définitions et deux périodes sous le même libellé | Salon : **2 j** (Pièces, 2026) contre **143 j** (Confort, hiver 2025-2026) ; Chambres **39 j** contre **143 j** | v1.5 |
| 6 | S1 | Résumés pour lecteur d'écran faux sur les courbes cumulées et les kVA | cumul : « 2024 : total **1 340 281 kWh** » ; saison : « total **55 828 kWh** » ; puissance : « total **195 kVA** » | v1.5 |
| 7 | S1 | Rapport de l'année en cours : moyenne mensuelle divisée par 12 sur 10,3 mois | 2026 : « 1 221 € … **102 € par mois** » (≈ **119 €** sur 312 jours) | v1.5 |
| 8 | S2 | Périodes partielles non signalées : premier et dernier paquet d'une période glissante, mois en cours comparé à des mois complets | 12 mois par an : barres « **2025** » **1 864 kWh** (53 jours) et « 2026 » 5 273 kWh ; Comparer : nov. 2026 **170 kWh** (8 jours) contre **866** et **852 kWh** ; « oct. 2026 » vaut **310 kWh** sur « 30 jours » et **407 kWh** sur « 12 mois » ; Pièces : « 2025 » = **6 265 kWh** (à date) alors que 2025 = 8 129 kWh ailleurs | v1.5 |
| 9 | S2 | Jours perdus chez Intuis visibles seulement en jour et semaine | février 2024 : **18 jours perdus**, barre **485 kWh** (contre 1 162 en 2025) sans marque ; cumul 2024 plat du 12 févr. au 7 mars ; évolution 2025/2024 « **+12 %** » (Rapport) gonflée | v1.5 |
| 10 | S2 | Comparer « Saison de chauffe » ne peut pas montrer la saison en cours | années 2024-2026 cochées → saisons 2023-2024, 2024-2025, 2025-2026 ; **2026-2027 inaccessible** (pas de puce 2027) | v1.5 |
| 11 | S2 | Couleurs : une pièce, une année ou une saison change de couleur d'un écran ou d'un réglage à l'autre | Bureau **violet** (vue foyer) puis **rouge** (détail des chambres) ; saison 2025-2026 **orange** (Analyse) et **bleue** (Comparer) ; 2025 et 2026 en orange et bleu, les couleurs réservées au chauffage et au chauffe-eau | v1.6 |
| 12 | S2 | Cartes qui ignorent les filtres sans le dire | filtre Chauffe-eau : la carte Linky affiche toujours « chauffage 52 % », le bandeau tarif « +39 € par an » reste sur tout le logement | v1.6 |
| 13 | S2 | Deux références côte à côte qui se contredisent en apparence | « Conforme à d'habitude, **−7 %** » (attendu à météo égale) au-dessus de « novembre **−16 %** vs N-1 » | v1.6 |
| 14 | S2 | Signature : deux tableaux, deux valeurs pour la même saison ; saison de 31 jours au même rang que les saisons complètes | 2024-2025 : pente **2,46** / seuil **18,0 °C** (tableau 1) contre **2,44** / **18,3 °C** (tableau 2) ; 2026-2027 en tête avec R² 0,81 sur 31 jours | v1.6 |
| 15 | S3 | Mobile : étiquettes qui se chevauchent ou sont coupées, légendes paginées, tableaux tronqués | axe Pièces « 0 300 600 **9001 2001 500** » ; « Puissance » coupé ; « Salon/Chambres » superposés ; légendes « 1/2 », « 1/3 » | v1.6 |
| 16 | S3 | Graphiques sans résumé textuel, échelles de couleur sans valeurs | barres horizontales, cascade, nuage, calendrier, cartes de chaleur : `aria-label` fixe (« Consommation par pièce ») ; légendes « faible → élevée » sans kWh | v1.6 |
| 17 | S3 | Formats de date hétérogènes | « 1 août 2026 » (au lieu de « 1er »), « Générée le 2026-11-09 », « sem. du 3 nov. 2025 », « 9 nov. 2025 » et « 9 novembre 2025 » dans le même écran | v1.6 |

Les tickets créés sont listés en fin de document (§ 8).

---

## 1. Cohérence des dates et des périodes

### 1.1 Inventaire des périodes affichées

Une même journée de consultation (dernière donnée le 8 novembre 2026) produit **onze fenêtres
différentes**, souvent sous des libellés voisins :

| Écran, carte | Libellé affiché | Fenêtre réelle | Remarque |
|---|---|---|---|
| Synthèse, verdict | « novembre » | 1er → 8 nov. 2026 | partiel, sans « (au 8) » ; mode simple : « Depuis le 1er novembre » |
| Synthèse, tuiles | « Novembre 2026 (au 8) », « Depuis le 1er janvier », « 12 derniers mois », « Fin 2026 estimée » | mois civil partiel, année à date, **9 nov. 2025 → 8 nov. 2026** (365 j), année projetée | correct et explicite |
| Synthèse, graphique principal | « 12 mois » / « 30 jours » / année / « Tout » | 365 j glissants / 30 j / année civile / tout | paquets partiels aux deux bouts (§ 1.2) |
| Synthèse, part Linky | « Sur 12 mois » | **1er nov. 2025 → 8 nov. 2026** (373 j, 13 barres) | constat 1 |
| Synthèse, puissance max | « Sur 12 mois » (texte), « par mois » (graphique) | texte : 12 derniers mois civils ; graphique : **24 mois** (déc. 2024 → nov. 2026) | |
| Synthèse, délestage | « 12 derniers mois » | 365 j | |
| Synthèse, courbe de charge, talon, autres usages | « 30 jours » | 10 oct. → 8 nov. | |
| Comparer, graphique et tableau | « Mois par mois », « Cumul », « Saison de chauffe » | années civiles ; saison **sept. → août** | |
| Comparer, comparateur d'offres | « tarifs réglementés, 1408 jours » | tout l'historique Linky | à côté, le simulateur VE porte sur 12 mois |
| Pièces | « Du 1er janvier au 8 novembre 2026 » | année civile à date | « Températures : novembre à mars » **de l'année civile** (janv.-mars 2026 + nov. 2026, deux hivers mélangés) |
| Analyse, signature | « Saison 2025–2026 » | sept. → août | même nom que Comparer, couleur différente (§ 5) |
| Analyse, profil horaire | « 90 derniers jours » | | |
| Analyse, HP/HC, chauffe-eau | « 12 derniers mois » | HP/HC : 365 j ; graphique chauffe-eau : **13 mois** | |
| Analyse, station | « 12 derniers mois » + tableau « Hiver 2025–2026 » | 365 j ; hiver = **nov. → mars** | |
| Confort | « 30 dernières nuits », « 90 derniers jours », « Hiver 2025–2026 », « saison 2026-2027 » | 22 h → 7 h ; nov. → mars ; sept. → août | « 2026-2027 » écrit avec un tiret court, ailleurs « 2026–2027 » |
| Rapport | année civile, « (au 8 novembre 2026) » | | |

Trois mots désignent trois périodes différentes : **« saison »** (sept. → août), **« hiver »**
(nov. → mars) et **« 12 mois »** (365 ou 373 jours selon la carte). Recommandations en § 7.1.

### 1.2 Paquets partiels

`aggregate()` découpe la période par paquets civils (`bucketKeys`) : le premier et le dernier
paquet d'une période glissante sont incomplets, sans le dire.

- **12 mois, par mois** : 13 barres, « nov. 2025 » = 9 → 30 nov. (663 kWh), « nov. 2026 » = 1 → 8
  nov. (170 kWh) ([01](audit/graphiques/01-synthese-conso-12-mois-mobile.png)).
- **12 mois, par an** : deux barres « 2025 » (1 864 kWh, 53 jours) et « 2026 » (5 273 kWh) : on lit
  une baisse de 65 % d'une année sur l'autre ([03](audit/graphiques/03-synthese-12-mois-par-an.png)).
- **30 jours, par semaine** : « sem. du 5 oct. 2026 » = 27,3 kWh pour 2 jours (10-11 oct.), à côté
  de semaines de 85 à 147 kWh ([04](audit/graphiques/04-synthese-30-jours-par-semaine.png)).
- **30 jours, par mois** : « oct. 2026 » = 310 kWh ; le même libellé vaut 407 kWh en « 12 mois ».
- **Comparer, mois par mois** : nov. 2026 = 170 kWh (8 jours) à côté de 866 et 852 kWh
  ([06](audit/graphiques/06-comparer-mois-par-mois.png)) ; même chose dans le Rapport 2026 et dans
  le détail d'une pièce.
- **Pièces, cascade** : la barre de départ s'appelle « 2025 » et vaut 6 265 kWh (1er janv. → 8
  nov. 2025) ; ailleurs « 2025 » vaut 8 129 kWh.
- **Comparateur d'offres** : « 2026 (312 j) » est bien signalé, mais la barre a la même forme que
  les années pleines ([09](audit/graphiques/09-comparer-offres.png)).

### 1.3 Données manquantes

Le contrôle de qualité recense 4 mois incomplets ([21](audit/graphiques/21-qualite-donnees.png)) :
déc. 2023 (5 jours estimés), **févr. 2024 (18 jours perdus)**, mars 2024 (8), nov. 2024 (14, deux
pièces). Seules les vues jour et semaine pâlissent les barres (`uncertainBuckets`). Partout
ailleurs, rien :

- Comparer mois par mois : févr. 2024 = 485 kWh contre 1 162 en 2025, sans marque.
- Cumul : la courbe 2024 est **plate du 12 févr. au 7 mars** (1 848 kWh), lue comme « rien
  consommé » ([07](audit/graphiques/07-comparer-cumul.png)).
- Totaux annuels : 2024 = 7 252 kWh, « −15 % » ; 2025 « +12 % » ; Rapport 2025 « ▲ +12 % vs
  N-1 » et « Salon +17 % ». Ces écarts tiennent en partie aux 26 jours perdus de 2024.
- Détail d'une pièce (Salon) : févr. 2024 = 139 kWh contre 323 à 340 les autres années.

### 1.4 Calendrier, jour et heure

- **Cumul annuel** : les 366 étiquettes viennent d'une année bissextile, l'indice vient de
  `dayOfYear()` de chaque année. Pour 2025 et 2026, chaque point après le 28 février porte la date
  de la veille (constat 4). 2024 étant bissextile, les courbes comparent aussi le 1er mars 2024 au
  2 mars 2025.
- **Semaines** : lundi ISO (`weekStart`), libellées « sem. du 3 nov. 2025 », sans numéro de semaine.
  C'est lisible ; il faut seulement marquer les semaines partielles.
- **Fuseau** : les jours sont des jours locaux du logement (collecteur). Deux usages de
  `new Date().toISOString()` donnent la date **UTC** : « Rapport généré le … » et la valeur de
  repli de `lastDay()`. Entre minuit et 1 h (2 h en été), ils affichent la veille. Effet mineur.
- **Dernière donnée et aujourd'hui** : l'en-tête dit « Données jusqu'au 8 novembre 2026 », les
  périodes se calent sur ce jour. Mais Confort « Volets fermés ce soir (9 novembre 2026) » et
  l'analyse IA « Générée le 2026-11-09 » utilisent aujourd'hui, sous un autre format.
- **Heures** : « 19:00 » (courbe), « 19 h » (profil), « 0h » (axe), « 22 h → 7 h » (CO₂). Il faut
  choisir une seule écriture.

## 2. Un indicateur, une valeur

### 2.1 Consommation de novembre 2026 et de 2026

| Écran | Libellé | Valeur |
|---|---|---|
| Synthèse, tuile | Novembre 2026 (au 8) | 170 kWh · 32 € · −16 % vs N-1 |
| Synthèse, verdict | novembre | 170 kWh pour 184 attendus, −7 % |
| Mode simple | Depuis le 1er novembre | 170 kWh, « D'habitude : 180 kWh » (184 arrondi à la dizaine), « 16 % de moins que l'an dernier » |
| Comparer, nov. 2026 | nov. | 170 kWh, à côté de mois pleins |
| Synthèse, tuile 2026 | Depuis le 1er janvier 2026 | **5 273 kWh · 978 €** |
| Synthèse, période 2026 | du 1 janvier au 8 novembre 2026 | 5 273 kWh · 978 € |
| Synthèse, barre « 2026 » (12 mois par an) | infobulle | 5 273 kWh · **985 €** |
| Comparer, Totaux annuels | 2026 en cours | 5 273 kWh · **1 221 €** |
| Rapport 2026 | Coût estimé (abonnement inclus) | **1 221 €**, « 102 € par mois » |
| Comparateur, rapport 2026 | Heures pleines / creuses | **1 819 €** (logement entier) |
| Pièces 2026 | somme des pièces | 5 274 kWh (arrondis) |

Les kWh concordent partout. Les euros ont **quatre valeurs** : 978 (`costOf` sans abonnement),
985 (kWh × prix moyen sur 12 mois, `avgPrice`), 1 221 (avec abonnement), 1 819 (périmètre Linky).
Seul le Rapport précise « abonnement inclus ».

### 2.2 Douze mois

| Écran | Chauffage | Chauffe-eau | Total |
|---|---|---|---|
| Synthèse, tuile et graphique « 12 mois » (9 nov. → 8 nov.) | 5 624 | 1 513 | 7 137 |
| Synthèse, carte Linky « Sur 12 mois » (1er nov. → 8 nov.) | **5 793** | **1 549** | 11 098 relevés au compteur |
| Analyse, HP / HC « 12 derniers mois » | — | — | 3 976 + 3 161 = 7 137 ✓ |
| Analyse, chauffe-eau « 12 derniers mois » | — | 1 362 + 151 = 1 513 ✓ (graphique sur 13 mois) | |

### 2.3 Arrondis des résumés

Les résumés accessibles additionnent des valeurs déjà arrondies à l'unité ou au dixième : 2025 =
8 130 kWh dans le résumé de Comparer contre 8 129 dans le tableau ; « Chauffage : total 361 kWh »
pour 360 kWh affichés au-dessus. L'écart est d'1 kWh, mais il se remarque. Il faut sommer les
valeurs brutes et n'arrondir qu'à l'affichage.

### 2.4 Températures et confort

- **« Jours sous 19 °C »** (constat 5) : Pièces compte les jours dont la **moyenne** est sous le
  seuil, de janvier à mars et en novembre **de l'année civile** ; Confort compte les jours avec **au
  moins une heure** sous le seuil, de novembre à mars **d'un hiver**. Même libellé : Salon 2 j contre
  143 j. Avec le détail des chambres, Chambre parentale passe à 98 j (radiateur) contre 39 j
  « station » pour le groupe Chambres : la source change aussi avec la vue foyer.
- **Heures sous 19 °C** : le graphique couvre 30 jours (Salon 264 h), le tableau juste dessous
  l'hiver en cours (Salon 72 h depuis le 1er novembre) ([18](audit/graphiques/18-heures-froides-mobile.png)).
- **Signature** (constat 14) : le tableau de la signature (tous les jours) et celui de la signature
  intérieure (sans les jours perdus ou estimés) donnent pour 2024-2025 2,46 et 2,44 kWh/°C, 18,0 et
  18,3 °C, sur le même onglet ([13](audit/graphiques/13-signature-mobile.png)). Le Rapport reprend
  2,46.

## 3. Filtres

Le filtre global (catégorie Tout / Chauffage / Chauffe-eau, choix des pièces) est appliqué par
`filtered()` puis transmis aux vues.

| Carte | Respecte le filtre | Le dit |
|---|---|---|
| Synthèse : tuiles, graphique principal, total de période | oui | oui (bandeau de filtres au-dessus) |
| Synthèse : verdict | oui | **non**, « Conforme à d'habitude » ne précise pas « chauffe-eau » ou « Salon » |
| Synthèse : projection en €, infobulles en € | kWh oui, **prix non** (`avgPrice` sur tout le logement) | constat 2 |
| Synthèse : bandeau nouveau tarif | non | « Sur votre consommation des 12 derniers mois », donc implicitement tout le logement |
| Synthèse : Linky, puissance, délestage, courbe, talon, autres usages | **non**, par nature (compteur) | **non** : la carte Linky dit toujours « chauffage 52 % » avec le filtre Chauffe-eau |
| Comparer : graphique, Totaux annuels | oui | non |
| Comparer : comparateur d'offres, VE | non (logement) | le périmètre est écrit en bas de carte |
| Pièces | oui | non |
| Analyse : signature, calendrier, profil horaire, anomalies, travaux, consigne, PAC | oui | partiellement (la signature intérieure nomme la pièce) |
| Analyse : HP/HC | oui | non |
| Analyse : chauffe-eau, station, températures | non (par nature) | non |
| Confort, Rapport | non | **bien fait** : le bandeau de filtres est masqué (`body.is-comfort`, `body.is-report`) |

Autres constats :

- Avec « Chauffe-eau », le compteur des pièces affiche toujours « Pièces 6/6 » alors que cinq pièces
  de chauffage sont exclues de fait ([05](audit/graphiques/05-filtre-chauffe-eau-kpi.png)).
- Les filtres sont gardés d'un onglet à l'autre et d'une session à l'autre (`localStorage`). C'est
  cohérent, mais un filtre oublié change silencieusement tous les chiffres. Seul indice : la puce
  active dans le bandeau.
- La vue foyer et le détail des chambres remettent le choix des pièces à zéro (`rooms: null`).
  C'est voulu ; il faudrait le dire.
- « Aucune pièce » affiche « Aucune donnée pour cette sélection. » : l'état vide est correct.

## 4. Regroupements et agrégation

- **Sommes et moyennes** : kWh additionnés, °C, % et ppm moyennés (les résumés distinguent bien
  `°C|ppm|%`). Les kVA et les courbes cumulées, eux, sont **additionnés** dans les résumés
  (constat 6) ; il faut un résumé par type de mesure : maximum pour les kVA, dernière valeur pour
  un cumul.
- **Empilé ou groupé** : le graphique principal empile (correct, parties d'un tout), Comparer et le
  Rapport groupent les années (correct). Le graphique des heures froides groupe deux pièces par jour
  sur 30 jours, soit 60 barres fines sur mobile
  ([18](audit/graphiques/18-heures-froides-mobile.png)) : une ligne par pièce ou une barre par
  semaine se lirait mieux. Les fenêtres ouvertes empilent les pièces : correct.
- **Vue foyer** : les kWh des chambres sont additionnés, les températures moyennées, le CO₂ et les
  heures confinées pris sur la pire chambre. Les totaux sont conservés (Pièces 2026 : Chambres
  1 278 = 697 + 580 + 1 kWh d'arrondi). Mais la vue foyer **déplace les couleurs** (§ 5).
- **Périodes inégales** : Comparer met côte à côte un mois de 8 jours et des mois pleins, et une
  saison de 2 mois et des saisons pleines ; le comparateur, une année de 312 jours et des années
  pleines. Un mois partiel doit se comparer à la même fraction des autres années (barre fantôme ou
  hachure, voir § 7.4).
- **Climat égal** : bien expliqué dans l'aide (« le chauffe-eau n'est pas corrigé »), mais le
  tableau Totaux annuels, juste dessous, reste en brut sans le dire.

## 5. Couleurs

Règle actuelle (`ui.ts`) : chauffage = orange, chauffe-eau = bleu (`--cat-*`), pièces de chauffage =
`--series-3` à `--series-8` **dans l'ordre des pièces actives**, années = `--series-1…` **en partant
de la plus récente**, saisons = idem dans Analyse. Conséquences relevées :

| Élément | Couleur ici | Couleur là | Captures |
|---|---|---|---|
| Bureau | violet (vue foyer) | **rouge** (détail des chambres) | [11](audit/graphiques/11-couleurs-vue-foyer.png), [12](audit/graphiques/12-couleurs-detail-chambres.png) |
| Salle de bain | vert foncé (vue foyer) | violet (détail) | idem |
| Salon / Salle de bain (vue foyer) | vert `#1baf7a` | vert foncé `#008300` | deux verts voisins dans le même empilement |
| Cave (station) | vert foncé | = Salle de bain | [14](audit/graphiques/14-station-mobile.png) |
| Saison 2025-2026 | **orange** (Analyse, signature) | **bleu** (Comparer, saison) | [08](audit/graphiques/08-comparer-saison.png), [13](audit/graphiques/13-signature-mobile.png) |
| Année 2026 / 2025 | bleu / orange | = chauffe-eau / chauffage | [06](audit/graphiques/06-comparer-mois-par-mois.png) |
| Année 2024 | vert | = Salon | |
| Offres Base / HP-HC / Tempo | rose / bleu / vert | = Chambres / chauffe-eau / Salon | [09](audit/graphiques/09-comparer-offres.png) |
| Part HC du chauffe-eau | vert | = Salon, alors que le sujet est le chauffe-eau | [16](audit/graphiques/16-chauffe-eau-hc-mobile.png) |
| Pièces, légende « 2026 » | gris foncé | les barres ont la couleur de chaque pièce | [10](audit/graphiques/10-pieces-mobile.png) |

L'année suivante, toutes les années changeront de couleur : 2026 passera du bleu à l'orange.

## 6. Choix des graphiques et lisibilité

### 6.1 Par graphique

| Graphique | Question posée | Constat | Proposition |
|---|---|---|---|
| Consommation (Synthèse) | Combien et quand ? | bon choix (barres empilées) ; granularité « An » sur 12 glissants, trompeuse | désactiver « An » hors « Tout » ; hachurer les paquets partiels |
| Part Linky | Quelle part du logement ? | barres empilées à 3 couches, lisible ; fenêtre de 373 jours | aligner sur les 12 mois du graphique principal, ou passer en 12 mois civils complets, nommés |
| Puissance max | Ma puissance est-elle adaptée ? | ligne de souscription correcte ; étiquettes de fin coupées sur mobile (« Puissance ») ; 24 mois contre 12 dans le texte | étiquette « 12 kVA souscrits » sur la ligne ; même fenêtre que le texte |
| Comparer, mois par mois | Cette année est-elle meilleure ? | jusqu'à 5 années groupées, 60 barres sur mobile | 2 ou 3 années par défaut ; mois partiel hachuré avec la même fraction de N-1 en fantôme |
| Comparer, cumul | Où en suis-je par rapport aux autres années ? | bon choix ; lignes de légende de 3 px, peu visibles ; plat des jours perdus | légende en traits de 4 px ou étiquettes de fin seules ; trous de données (`null`) plutôt que plat |
| Comparer, saison | Cet hiver par rapport aux autres ? | cumul non annoncé (« kWh » seul) ; étiquettes de fin superposées ([08](audit/graphiques/08-comparer-saison.png)) | titre « cumul depuis septembre » ; saison en cours sélectionnable |
| Offres | Quelle offre aurait coûté le moins ? | barres groupées en € : bon choix ; l'écart (15 € en 2026 sur 1 800 €) est invisible | barre d'écart par rapport à l'offre actuelle |
| Pièces, barres horizontales | Quelle pièce consomme le plus ? | bon choix ; axe illisible sur mobile (« 9001 2001 500 »), tableau coupé à droite | 3 graduations au plus ; colonnes secondaires repliées sur mobile |
| Cascade | Qu'est-ce qui a changé ? | bon choix ; libellé de départ « 2025 » ambigu à date | « 2025 au 8 nov. » |
| Signature (nuage) | Ma maison consomme-t-elle plus par degré ? | bon choix ; saison de 31 jours au même rang ; jours d'été à 0 kWh tracés | droite en pointillé et légende « provisoire » sous 60 jours ; masquer les jours sans chauffe |
| Calendrier | Quels jours ont consommé ? | carte de chaleur sans valeurs (« faible / élevée »), police de 10 px | légende chiffrée (0 – 50 kWh) ; résumé textuel |
| Profil horaire | À quelle heure ? | carte de chaleur + courbes ; étiquettes de fin coupées sur mobile | légende chiffrée ; étiquettes de fin désactivées sous 400 px |
| Chauffe-eau, part HC | Le chauffe-eau est-il bien réglé ? | 13 barres à 90 % : barres peu informatives, axe sans « % » | ligne avec le seuil d'alerte en repère, axe 50-100 % |
| Station | Températures, humidité, CO₂ | 4 courbes journalières bruitées ; Salon et Chambres superposés à 19-20 °C | petits multiples par module ou moyenne hebdomadaire ; étiquettes de fin décalées |
| CO₂ de la nuit | L'air est-il confiné ? | **double axe** (heures 0-9 h et ppm 800-1 150, sans zéro) ([17](audit/graphiques/17-co2-nuit-mobile.png)) : la ligne et les barres se croisent au hasard des échelles | deux graphiques alignés, ou ppm seul avec bandes 1 000 / 1 400 |
| Heures sous le seuil | Quelles pièces ont eu froid ? | 60 barres groupées sur 30 jours | une ligne par pièce, ou une barre par semaine |
| Fenêtres ouvertes | Quand aère-t-on ? | barres empilées : correct ; légende paginée 1/2 sur mobile | légende sur deux lignes |

### 6.2 Mobile

Relevé sur iPhone 13 ([01](audit/graphiques/01-synthese-conso-12-mois-mobile.png) à
[19](audit/graphiques/19-fenetres-mobile.png)) :

- légendes paginées : CO₂ « 1/3 », fenêtres « 1/2 », libellé « Heures > 1 400 pp » coupé ;
- étiquettes de fin coupées ou superposées : puissance, station, profil horaire, saisons ;
- axe des pièces illisible ; tableaux larges (Pièces, Confort, signature, station) coupés sans
  indication de défilement ;
- polices des graphiques en px fixes (10-12 px), insensibles au réglage de taille du système
  (déjà noté dans l'inventaire) ;
- la tuile « Aucune nuit au-dessus de 1 400 ppm » coupe la ligne entre « 1 » et « 400 ».

### 6.3 Accessibilité

- Le résumé textuel automatique (`describe`) est un atout, mais il manque pour `hbarChart`,
  `waterfallChart`, `scatterChart`, `calendarChart` et `gridHeatmap` (libellé fixe : « Consommation
  par pièce », « Signature énergétique », « Calendrier de consommation ») et il est faux pour les
  cumuls et les kVA (constat 6).
- Les motifs de remplissage n'existent qu'en contraste élevé : un daltonien en mode normal doit
  distinguer Salon (vert) et Salle de bain (vert foncé) empilés.
- « Voir les valeurs » existe pour la plupart des graphiques de la Synthèse et de Comparer, mais pas
  pour la carte Linky, la puissance, le calendrier ni les cartes de chaleur.

## 7. Règles de présentation (proposition v1.6)

### 7.1 Périodes standard

| Code | Libellé à afficher | Définition | Usage |
|---|---|---|---|
| `mois` | « novembre 2026 (au 8) » tant que le mois n'est pas fini | mois civil | verdict, tuiles, Comparer |
| `annee` | « 2026 (au 8 nov.) » / « 2025 » | année civile | Comparer, Pièces, Rapport |
| `12m` | « 12 mois (9 nov. 2025 – 8 nov. 2026) » | **365 jours glissants, partout** | tuiles, graphique principal, Linky, HP/HC, chauffe-eau, délestage |
| `30j` | « 30 jours (10 oct. – 8 nov.) » | 30 jours glissants | courbe de charge, autres usages, confort |
| `90j` | « 90 jours (…) » | 90 jours glissants | profil horaire, humidité |
| `saison` | « saison 2025-2026 (sept. – août) » | 1er sept. → 31 août | signature, Comparer saison, PAC, consigne |
| `hiver` | « hiver 2025-2026 (nov. – mars) » | 1er nov. → 31 mars | températures, heures froides, station |

Règles :

1. Chaque carte affiche sa période **avec ses bornes** sous le titre, au même endroit.
2. Une période partielle se termine toujours par « (au 8 nov.) » ; une comparaison N-1 porte sur la
   même fraction (déjà fait pour les tuiles et les Totaux annuels).
3. Plus de « 12 mois » qui commence au 1er d'un mois. Si l'on veut des mois civils, on dit « 12
   derniers mois complets (nov. 2025 – oct. 2026) ».
4. « Saison » et « hiver » ne se mélangent pas : les températures de Pièces passent à l'hiver, plus à
   l'année civile.
5. Le paquet partiel en tête ou en fin de graphique est **hachuré** et son infobulle dit « 22 jours
   sur 30 ».
6. Un paquet contenant un jour estimé ou perdu est marqué **à toutes les granularités** (point sous la
   barre, rupture de la courbe cumulée), avec le nombre de jours dans l'infobulle.

### 7.2 Dates, nombres, unités

| Objet | Format | Exemple |
|---|---|---|
| Jour, texte | jour + mois en toutes lettres + année ; « 1er » | « 1er août 2026 », « 8 novembre 2026 » |
| Jour, axe et infobulle | jour + mois abrégé, année si plusieurs années à l'écran | « 8 nov. », « 8 nov. 2026 » |
| Semaine | « sem. du 3 nov. » ; numéro ISO en infobulle seulement | « sem. du 3 nov. (S45) » |
| Mois | « nov. 2026 » sur un axe, « novembre 2026 » dans le texte | |
| Saison, hiver | « 2025-2026 » avec tiret demi-cadratin, partout | « 2025–2026 » |
| Heure | « 19 h », « 19 h 30 » ; plage « 22 h – 7 h » | (plus de « 19:00 » ni « 0h ») |
| Date de génération | même format que les jours | « Générée le 9 novembre 2026 » |
| Énergie | kWh, 1 décimale sous 100, entier au-delà ; MWh jamais | « 33,4 kWh », « 5 273 kWh » |
| Puissance | kVA (compteur), kW (courbe), W (veille), 1 décimale | « 10,2 kVA », « 235 W » |
| Argent | € entier ; c€ pour un prix unitaire ; **toujours préciser « hors abonnement » ou « abonnement inclus »** | « 978 € hors abonnement » |
| Pourcentage | entier signé, « − » typographique | « −16 % » |
| Températures | °C, 1 décimale | « 19,7 °C » |

Unité de l'axe des ordonnées : toujours dans le titre de la carte (« kWh par mois ») **et** sur
l'axe quand l'unité change (heures, %, ppm).

### 7.3 Couleurs par sens

| Sens | Jeton | Règle |
|---|---|---|
| Chauffage | `--cat-heating` (orange) | réservé : n'est plus utilisé pour une année, une offre ni une puissance |
| Chauffe-eau | `--cat-water` (bleu) | réservé ; la part HC du chauffe-eau est en bleu |
| Autres usages, reste | `--ghost` | inchangé |
| Pièce | une couleur **fixée par pièce**, stockée avec la pièce (ordre de `meta.rooms`, pas des pièces actives ni de la vue foyer) ; « Chambres » a sa propre couleur | Salon et Salle de bain ne doivent pas recevoir deux verts voisins |
| Années | **rampe séquentielle neutre** (gris → encre) : l'année en cours en `--text-primary`, épaisse, les précédentes de plus en plus claires | une année garde la même place relative ; plus de couleurs catégorielles pour le temps |
| Saisons | même règle que les années, **partagée** entre Analyse et Comparer | |
| Mesuré / attendu / consigne | trait plein / pointillé / trait fin `--text-muted` | plus de bleu `series(0)` pour « Mesurée » |
| Seuils, souscription | `--text-muted` en pointillé, étiquette sur la ligne | |
| Offres | neutres, l'offre actuelle en `--accent`, la moins chère soulignée | |
| Hausse / baisse | `--bad` / `--good` uniquement pour une **évolution de consommation ou de coût** | une température plus haute n'est pas « mauvaise » |

### 7.4 Catalogue : quel graphique pour quelle question

| Question | Graphique | À éviter |
|---|---|---|
| Combien sur une période, réparti par usage ou par pièce ? | barres empilées verticales, ≤ 7 séries, « Autres pièces » au-delà | camembert |
| Quelle part ? | barre 100 % horizontale unique (déjà utilisée) | anneau |
| Classement des pièces | barres horizontales triées, valeur en bout de barre, N-1 en fantôme | |
| Ce qui a changé entre deux périodes | cascade avec départ et arrivée nommés et datés | |
| Cette année contre les autres | cumul en lignes (année en cours épaisse, autres en gris) ; mois par mois : 2 ou 3 années groupées | 5 années groupées sur mobile |
| Évolution d'une mesure continue (°C, ppm, %) | ligne, moyenne hebdomadaire au-delà de 90 jours, bandes de seuil | double axe |
| Deux mesures d'unités différentes | deux graphiques alignés sur le même axe des dates | double axe |
| Effet d'une variable (météo) | nuage + droite, une couleur par saison, saison incomplète en pointillé | |
| Motif jour / heure | carte de chaleur **avec légende chiffrée** et résumé textuel | échelle « faible / élevée » sans valeurs |
| Jours d'une année | calendrier avec légende chiffrée et marques des jours estimés | |
| Respect d'un seuil (HC, puissance) | ligne + ligne de seuil, zone au-dessus colorée | barres toutes à 90 % |
| Chiffre clé | tuile : valeur, période avec bornes, comparaison **unique** et nommée | deux références contradictoires côte à côte |

Règles de composition : un graphique répond à une question écrite dans son titre ; une seule
référence de comparaison par carte ; les tuiles disent à quoi elles se comparent (« vs même
période 2025 », « vs attendu à météo égale ») ; « Voir les valeurs » partout ; un résumé textuel
généré pour chaque type de graphique ; sur mobile, ≤ 4 séries avec étiquettes de fin, sinon légende
sur deux lignes sans pagination.

## 8. Tickets ouverts

Doublons vérifiés parmi les tickets ouverts : aucun ne couvre ces constats. #20 (S-7.5, feuille
« Réglages du graphique ») est lié aux §§ 6-7.

**v1.5, `bug`** (valeurs fausses ou contradictoires aujourd'hui) :

- #290 Synthèse : la carte Linky « Sur 12 mois » couvre 373 jours (constat 1).
- #291 Prix en € incohérents : projection et infobulles au prix moyen non filtré (constat 2 ; voir
  aussi #240, #252).
- #292 Libellés de coût : 978 / 1 221 / 1 819 € pour 2026 (constat 3).
- #245 Comparer, cumul : décalage d'un jour après février (constat 4 ; #293, ouvert en parallèle,
  fermé comme doublon).
- #294 « Jours sous 19 °C » et températures de Pièces : définitions et périodes différentes
  (constat 5).
- #295 Résumés accessibles qui additionnent des cumuls et des kVA (constat 6).
- #246 Rapport de l'année en cours : moyenne mensuelle sur 12 mois (constat 7 ; #296 fermé comme
  doublon).
- #297 Périodes partielles et jours perdus non signalés (constats 8 et 9).
- #298 Comparer : la saison de chauffe en cours est inaccessible (constat 10).

**v1.6** (refonte de la présentation) :

- #299 Règles de périodes et de dates (§ 7.1, 7.2, constat 17).
- #300 Couleurs stables par pièce, année, saison et usage (§ 7.3, constat 11).
- #301 Portée des filtres affichée sur chaque carte (§ 3, constat 12).
- #302 Une seule référence de comparaison par tuile et verdict (constat 13).
- #303 Signature énergétique : tableaux unifiés, saison provisoire signalée (constat 14).
- #304 Lisibilité mobile des graphiques (§ 6.2, constat 15).
- #305 Résumés textuels et légendes chiffrées pour tous les types de graphique (§ 6.3, constat 16).
- #306 Catalogue de graphiques : double axe CO₂, heures froides, part HC, granularité « An »
  (§ 6.1, 7.4).
