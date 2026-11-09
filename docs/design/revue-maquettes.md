# Revue design des maquettes v1.6 (itération 2)

Revue faite sur les 10 écrans au format téléphone (390 px). Références : applications de suivi d'énergie et de chauffage
(fournisseurs, thermostats connectés, comparateurs) et standards web (WCAG 2.2 AA, RGAA 4.1, Material/Apple sur les cibles tactiles).

## Ce qui est bon et reste
- Verdict en euros en tête, « à météo comparable » : c'est la bonne question d'entrée.
- Navigation à 5 onglets + ⚙, page Pièce, « Pourquoi il a fait froid », état des données en un geste.
- Code couleur à sens fixe : orange = chauffage, bleu = eau chaude, iris = action.

## Constats et changements faits

| # | Constat | Changement dans les maquettes |
|---|---|---|
| 1 | Chaque carte avait son propre menu de période (« 12 derniers mois ▾ »). La période n'était pas lisible d'un coup d'œil. | **Un seul sélecteur de période** segmenté (Mois · Saison · 12 mois · Année) en tête de l'Accueil, avec une ligne de portée : « Novembre 2026, du 1er au 8 (8 jours sur 30) · chauffage et eau chaude, hors abonnement ». Les cartes affichent la période, sans menu. |
| 2 | « ▼ 16 % que l'an dernier » : la référence est floue (année entière ? même date ?). | **Comparaison toujours explicite** : « −16 % vs nov. 2025 au 8 », « −20 % vs 2025 à date ». |
| 3 | Le verdict n'avait pas de repère visuel. | **Jauge du mois** : dépensé à date, repère « attendu au 8 », projection hachurée jusqu'à la fin du mois. |
| 4 | La tuile « Fin d'année estimée » isolée sur toute la largeur cassait la grille. | **Carte Budget** avec jauge : dépensé, projection, marge. |
| 5 | « Ce qui a compté » : carrés orange identiques, aucune idée des proportions. | **Barre de part** du total sous chaque ligne. |
| 6 | Graphique de consommation sans le froid, alors que c'est la première explication d'un écart de chauffage. | **Température extérieure en pointillé** sur le graphique (« Consommation et froid ») ; **mois en cours hachuré** (8 jours). |
| 7 | La page Pièce commençait par des cumuls annuels : on ne voyait pas ce qui se passe maintenant. | **Panneau « maintenant »** : température en grand, consigne, mode et jusqu'à quand, fenêtre, humidité/CO₂ ; **planning du jour** sur fond hachuré des heures creuses, avec le trait « maintenant » et le lien « Vérifier mon planning » (#211). |
| 8 | « Hiver contre hiver » tracé de janvier à décembre (année civile) : contradiction avec le titre. | Axe **septembre → août** ; hivers 2025-2026 et 2024-2025 en entier, l'hiver 2026-2027 en cours en pointillé. |
| 9 | « À climat égal » en case à cocher. | **Interrupteur** (`role="switch"`), plus clair pour un réglage qui s'applique tout de suite. |
| 10 | Badge « appareil » ambigu (un radiateur est aussi un appareil). | « **ce téléphone** » / « foyer ». |
| 11 | Référence technique « (#211) » visible dans l'interface. | Remplacée par une description (« heures creuses, gain réel de température »). |
| 12 | Bouton de thème de la maquette dans le flux, qui allongeait chaque écran. | Bouton flottant (outil de maquette uniquement, pas dans l'appli). |

## Recommandations pour le design system (à reporter dans #310)
- **Composants ajoutés** : jauge (réel / attendu / projection), barre de part, panneau « maintenant », bande de planning 24 h, interrupteur, motif hachuré « partiel ».
- **Règle « une période par écran »** : un seul sélecteur, et toute valeur affiche sa portée (période, périmètre, abonnement inclus ou non).
- **Règle « comparaison explicite »** : jamais de pourcentage sans « vs … » ; à date quand la période est en cours.
- **Météo partout où il y a du chauffage** : température extérieure ou degrés-jours en contexte de chaque graphique de chauffage.
- **Cibles tactiles** ≥ 44 px, contraste AA vérifié sur les teintes Radix retenues, textes de graphiques ≥ 11 px.

## Pistes non faites dans cette itération
- Vue « Plan » de la maison (#202) : maquette dédiée à faire.
- Mode paysage / tablette : grille 2 colonnes pour l'Accueil.
- Notifications (froid prolongé, radiateur injoignable) : maquette de la liste d'alertes.
