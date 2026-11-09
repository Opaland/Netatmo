# Audit d'utilisabilité de la PWA (préparation de la v1.6)

*Novembre 2026, sur `main` après la v1.4 (commit `6cd05b2`). Audit réel de l'application construite
(`npm run build`, `vite preview`), **données de démonstration uniquement** (phrase « demo », bouton
« Essayer avec des données de démonstration »), parcourue avec Playwright en iPhone 13 (clair), Pixel 7
(sombre), 360 px avec texte à 200 % et bureau 1 280 × 900. Les captures sont dans
[`audit/captures/`](audit/captures/) (PNG compressés, 1,1 Mo au total).*

Documents liés : [architecture cible](architecture-cible.md) · [design system v1.6](design-system.md) ·
[maquettes](maquettes/index.html) · [inventaire](inventaire.md) (S-7.14) ·
[revue des 62 personas](../bmad/02-revue-50-personas.md).

## 0. En une minute

L'application **répond très bien à la première question** (« ce mois est-il normal ? » : verdict en
haut de la Synthèse, 0 geste) et l'analyse est riche, honnête et accessible (résumés de graphiques,
motifs, mode simple FALC). Mais quatre versions d'ajouts rapides ont produit une **architecture par
accumulation** :

- **47 cartes** réparties dans 5 onglets, 1 menu ⋮ et 2 pages hors navigation ; l'onglet Analyse
  mesure **15 écrans de téléphone** (10 014 px, 16 cartes), la Synthèse **9,8 écrans**, Confort **9,9**.
- **La configuration est éparpillée dans 10 endroits** : contrat dans le menu ⋮, budget et facteur CO₂
  dans la Synthèse, factures et appareils saisis dans la Synthèse, travaux et surfaces dans Analyse,
  seuil de confort dans Confort, alerte froid et mode locataire dans Paramètres, pièce épinglée, vue
  foyer, mode simple et verrouillage dans le menu ⋮…
- **Les simulateurs** (offres, voiture, pompe à chaleur, consigne − 1 °C, télétravail) sont mêlés aux
  constats, sans distinction visuelle entre « ce qui s'est passé » et « et si… ».
- **Le vocabulaire et les fenêtres de temps changent d'une carte à l'autre** (6 fenêtres différentes,
  « N-1 », « saison de chauffe » définie de deux façons, « talon », « délestage », « kVA » sans
  explication hors mode simple).

La v1.6 doit donc d'abord **ranger** (navigation, paramètres, outils), puis **unifier** (vocabulaire,
composants, jetons). L'architecture proposée ramène la tâche la plus longue mesurée de 9 à 3 gestes et
l'onglet le plus long de 15 à 3 écrans.

## 1. Inventaire constaté (structure actuelle)

| Endroit | Contenu (ordre d'affichage, démo) | Longueur mobile |
|---|---|---|
| **En-tête** (toutes vues) | nom du logement + badge démo, « Données jusqu'au… », onglets, menu ⋮ ; puis **filtres globaux** Tout / Chauffage / Chauffe-eau + Pièces 6/6 | — |
| **Synthèse** | verdict du mois · bandeau « nouveau tarif » · 4 tuiles (mois, année, 12 mois, fin d'année estimée) · Budget et empreinte (saisie budget + facteur CO₂) · Part dans le logement (Linky) + Puissance max + Délestage · **Recouper avec une facture** (formulaire) · Courbe de charge + talon + demi-heure max + un jour · Autres usages + **postes saisis** (formulaire) · **Consommation** (graphique principal, tout en bas) · Qualité des données (repliée) | 6 497 px, 9,8 écrans |
| **Comparer** | Comparer les années (mois / cumul / saison, climat égal, puces années) · Totaux annuels · Quelle offre EDF ? · Voiture électrique | 2 897 px, 4,4 écrans |
| **Pièces** | Par pièce (barres + tableau, chauffe-eau compris) · Qu'est-ce qui a changé ? (cascade) · détail d'une pièce (sous les deux cartes) | 1 537 px, 2,3 écrans |
| **Analyse** | Analyse IA · Signature · Signature intérieur − extérieur · **Travaux et surfaces** (formulaire) · Consigne − 1 °C · Pompe à chaleur · **Volets fermés** (journal) · Jours inhabituels · Calendrier · **Absences** (journal) · Profil horaire · **Télétravail** (formulaire) · HP / HC · Chauffe-eau HC · Station météo · Températures | 10 014 px, **15,1 écrans** |
| **Confort** | carte d'intro sans donnée · CO₂ nuit (Chambres, Salon) · Humidité cave · Heures sous 19 °C · Fenêtres ouvertes et radiateurs (+ pourquoi froide, signature sans aération, boost, absences, délestage) · Capteurs HA · Sonde du radiateur et station (liaison pièce ↔ module) | 6 573 px, 9,9 écrans |
| **Menu ⋮** | **formulaire Prix et contrat complet** (2 périodes × 3 champs) · Rapport annuel · Paramètres et connexions · Vue foyer · Détail des chambres · Mode simple · Pièce épinglée · Verrouillage · 4 exports · Sauvegarde · Verrouiller / Quitter la démo | 1 627 px de panneau, 23 contrôles |
| **Rapport** (hors onglets) | Rapport annuel (imprimer, anonymisé) · Questions types | 3 567 px |
| **Paramètres** (hors onglets) | état des 8 sources · Mode locataire · Alerte froid · (démo : « paramètres désactivés ») · 1-2-4 secrets et collecte, 3 contrat partagé · Ce qui est public · Inviter · Version · Cadre juridique | 3 444 px |
| **Mode simple** | verdict FALC · 4 tuiles · « Les mots à connaître » ; **plus d'onglets** | 1 206 px |

## 2. Tâches clés : nombre de gestes, avant / après

Gestes comptés depuis l'ouverture (déverrouillée) : un **toucher** = 1, un **défilement d'un écran** = 1,
une **saisie** = 1. « Après » = architecture cible ([architecture-cible.md](architecture-cible.md)) et
[maquettes](maquettes/index.html).

| # | Tâche | Aujourd'hui | Gestes | Cible | Gestes |
|---|---|---|---|---|---|
| T1 | Combien j'ai consommé / dépensé ce mois, est-ce normal ? | Verdict en tête de Synthèse ; les **euros** sont en petit (« −3 € », « 32 € ») sous des kWh | **0** (mais € secondaires) | Accueil : verdict **en euros** + kWh en second | **0** |
| T2 | Quelle pièce coûte le plus ? | Pièces → barres en **kWh** (pas en €), chauffe-eau mêlé aux pièces, tableau tronqué à droite ([30](audit/captures/30-mobile-pieces.png)) | **1** + calcul mental | Accueil : « Ce qui a compté » (3 pièces en €) ; Pièces : liste triée en € | **0** |
| T3 | Comparer cet hiver au précédent à climat égal | Comparer → Saison de chauffe → case « À climat égal » → décocher 2 années | **4-5** | Historique → préréglage « Hiver contre hiver, à climat égal » | **2** |
| T4 | Pourquoi une pièce était froide ? | Confort → défiler 4 écrans → Fenêtres ouvertes → sous-section ; **ou** ⋮ → Rapport → défiler 5 écrans → Questions types → puce → pièce | **6** à **9** | Pièces → la pièce → bloc « Pourquoi il a fait froid » | **2** |
| T5 | Vérifier ma facture | Synthèse → défiler 3 écrans → formulaire (2 dates, montant, case, bouton) | **4 + 4 saisies** | Outils → Vérifier une facture (factures gardées, liste) | **2 + 4 saisies** (puis 1 pour revoir) |
| T6 | Régler mon contrat / mes prix | ⋮ → formulaire dans le menu (seul) **puis** ⋮ → Paramètres → défiler → « 3. Contrat partagé » → jeton GitHub → partager | **2 + saisies**, puis **5** pour partager | ⚙ → Contrat et prix (une page, bouton « Partager avec le foyer ») | **2 + saisies** |
| T7 | Activer une source (Linky, Shelly, station) | ⋮ → Paramètres → défiler → 1. jeton → 2. identifiants (tous groupes à la suite) → 4. lancer ; marche à suivre seulement dans le README | **6+**, hors appli pour la procédure | ⚙ → Sources → la source → assistant 3 étapes avec la procédure intégrée | **3 + saisies** |
| T8 | Mes données sont-elles à jour / complètes ? | « Données jusqu'au » en en-tête (0) ; complétude : Synthèse → défiler **9 écrans** → « Qualité des données » (repliée) → ouvrir ; sources : ⋮ → Paramètres | **0 / 10 / 2** | Pastille d'état dans l'en-tête → page « État des données » (fraîcheur + complétude + sources) | **0 / 1** |
| T9 | Lire l'analyse IA | Analyse (1re carte) | **1** | Accueil : résumé en 2 lignes → « Lire l'analyse » | **0 / 1** |
| T10 | Partager / inviter | ⋮ → Paramètres → défiler 4 écrans → Inviter | **6** | ⚙ → Foyer et partage → Inviter | **2** |
| T11 | Mode simple pour un proche | ⋮ → case Mode simple ; pièce épinglée : ⋮ → liste ; **pour en sortir** : ⋮ → décocher (aucun onglet visible en mode simple) | **2 + 2** | Premier lancement : « Qui utilise ce téléphone ? » → Simple ; sinon ⚙ → Affichage ; sortie : bouton visible « Voir plus » | **1** |

**Constat transversal** : les tâches T1 et T9 sont bonnes ; toutes les tâches de **configuration**
(T5, T6, T7, T10, T11) et d'**explication** (T4, T8) passent par le menu ⋮ ou par un long défilement.

## 3. Constats classés par impact

Gravité selon [`revue-design.md`](../revues-agents/revue-design.md) : **critique** (bloque une
personne), **majeure** (lecture fausse probable, non-conformité AA, tâche clé très coûteuse),
**mineure**, **suggestion**. Impact = gravité × fréquence de la tâche × nombre de personas touchés.

### A. Architecture de l'information

| # | Constat | Gravité | Preuve | Personas |
|---|---|---|---|---|
| A1 | **Onglets surchargés et sans logique commune.** Analyse empile 16 cartes (15 écrans) qui mélangent constats (signature, calendrier), simulateurs (PAC, consigne, télétravail), journaux à remplir (volets, absences, travaux) et appareils (chauffe-eau, station). Personne ne trouve une carte sans connaître l'ordre. | majeure | [40](audit/captures/40-mobile-analyse-ecran1.png), [121](audit/captures/121-bureau-analyse.png) | #2, #21, #22, #59, #62 |
| A2 | **Le graphique principal « Consommation » est en bas de la Synthèse** (9ᵉ écran), sous Linky, la facture, la courbe de charge et les autres usages. La réponse « comment ça évolue » est la plus enfouie. | majeure | [15](audit/captures/15-mobile-synthese-consommation.png), [11](audit/captures/11-mobile-synthese-ecran2.png) | #1, #2, #22 |
| A3 | **Configuration éparpillée dans 10 endroits** (§ 4) ; le contrat est **un formulaire de 7 champs dans un menu déroulant** ([60](audit/captures/60-mobile-menu.png)), le partage du contrat est ailleurs (Paramètres § 3) ; budget et facteur CO₂ sont des champs **dans la Synthèse** ([16](audit/captures/16-mobile-synthese-budget-co2.png)). | majeure | [60](audit/captures/60-mobile-menu.png), [61](audit/captures/61-mobile-menu-bas.png) | #2, #51, #54, #62 |
| A4 | **Confort et Pièces parlent des mêmes pièces sans lien** : la température d'une pièce est dans Pièces (texte), ses heures sous 19 °C, son CO₂, ses fenêtres et sa sonde dans Confort, sa conso mois par mois dans Pièces (sous les cartes), son délestage dans Synthèse. Il n'existe **pas de page « une pièce »**. | majeure | [30](audit/captures/30-mobile-pieces.png), [50](audit/captures/50-mobile-confort.png), [51](audit/captures/51-mobile-confort-fenetres.png) | #3, #5, #7, #18 |
| A5 | **Menu ⋮ fourre-tout** (23 contrôles, 1 627 px) : prix, rapport, paramètres, confidentialité, accessibilité, sécurité, 4 exports, sauvegarde, verrouillage. Paramètres et Rapport sont des **pages hors navigation** (aucun onglet actif, retour par « Fermer » ou un onglet). | majeure | [60](audit/captures/60-mobile-menu.png), [70](audit/captures/70-mobile-rapport.png), [123](audit/captures/123-bureau-menu.png) | #21, #22, #59 |
| A6 | **Linky occupe la Synthèse** (part des usages, puissance, délestage, courbe de charge, talon, autres usages : 4 écrans) alors que ce sont des analyses du compteur, utiles une fois par mois. | majeure | [12](audit/captures/12-mobile-synthese-linky-puissance-delestage.png), [14](audit/captures/14-mobile-synthese-autres-usages.png) | #2, #22 |
| A7 | **Simulateurs non distingués des constats** : « Quelle offre ? », « voiture électrique », « pompe à chaleur », « consigne − 1 °C », « télétravail » ont la même apparence que les mesures ; ils sont dans trois onglets différents. | mineure | [21](audit/captures/21-mobile-comparer-offres.png), [22](audit/captures/22-mobile-comparer-voiture.png) | #12, #8, #48 |
| A8 | **Filtres globaux à portée floue** : « Tout / Chauffage / Chauffe-eau » et « Pièces 6/6 » s'affichent sur toutes les vues mais n'agissent pas sur les cartes Linky, station, confort, IA ; l'utilisateur ne sait pas ce qui est filtré. | majeure | [10](audit/captures/10-mobile-synthese-ecran1.png) | #1, #21 |
| A9 | **Le détail d'une pièce s'ouvre sous la liste**, hors de l'écran, sans déplacement du focus ni de la vue : le toucher semble ne rien faire. | majeure | [31](audit/captures/31-mobile-pieces-detail.png) | #3, #22, #23 |
| A10 | **Même question à deux endroits** : « pourquoi cette pièce était froide ? » (Confort et Questions types du Rapport), absences (Analyse et Confort), chauffe-eau (Analyse et Pièces), délestage (Synthèse et Confort), signature (Analyse, Confort « sans aération », Travaux). | mineure | — | #1, #62 |

### B. Langage et nomenclature

| # | Constat | Gravité | Preuve |
|---|---|---|---|
| B1 | **Fenêtres de temps hétérogènes** : mois en cours, depuis le 1ᵉʳ janvier, 12 derniers mois, 90 derniers jours (7 ×), 30 derniers jours (5 ×), 30 dernières nuits, 7 derniers jours, « 1 408 jours », saison de chauffe **septembre → août** (agrégats) mais jours chauffés **novembre → mars** (confort, températures). Deux cartes voisines ne parlent pas de la même période. | majeure | [12](audit/captures/12-mobile-synthese-linky-puissance-delestage.png), [14](audit/captures/14-mobile-synthese-autres-usages.png) |
| B2 | **Jargon non expliqué hors mode simple** : « vs N-1 », kVA, kgCO₂e, talon, délestage, degrés-jours, signature, COP, centile, « PRM », « ADR-5 » (Paramètres), heures **UTC** (Paramètres), date ISO « 2026-11-09 » (analyse IA). Le glossaire n'existe qu'en mode simple. | majeure | [80](audit/captures/80-mobile-parametres.png), [40](audit/captures/40-mobile-analyse-ecran1.png) |
| B3 | **Noms d'onglets génériques** : « Analyse » ne dit pas ce qu'on y trouve ; « Synthèse » contient surtout du Linky ; « Comparer » contient des simulateurs. | mineure | — |
| B4 | **Titres de carte en trois formes** : nom (« Calendrier »), question (« Quelle offre EDF aurait coûté le moins ? »), phrase (« Et avec une voiture électrique ? ») ; sous-titres gris qui portent tantôt l'unité, tantôt la période, tantôt la source. | mineure | [21](audit/captures/21-mobile-comparer-offres.png) |
| B5 | **Euros secondaires** : l'utilisateur pense en euros (#2, #3), l'appli montre d'abord des kWh (tuiles, pièces, comparaison) ; les pièces ne sont jamais classées en €. | majeure | [10](audit/captures/10-mobile-synthese-ecran1.png), [30](audit/captures/30-mobile-pieces.png) |
| B6 | « Chauffe-eau » est rangé comme une **pièce** (Pièces, filtre Pièces, pièce épinglée) ; « Chambres » est un regroupement présenté comme une pièce. | mineure | [30](audit/captures/30-mobile-pieces.png) |
| B7 | Numérotation des étapes de Paramètres dans le désordre (1, 2, 4 puis « 3. Contrat partagé » plus bas) ; « 1 prise(s) … non exploitable(s) ». | mineure | [80](audit/captures/80-mobile-parametres.png) |

### C. Cohérence visuelle et composants (complète l'[inventaire](inventaire.md))

| # | Constat | Gravité | Preuve |
|---|---|---|---|
| C1 | **Couleurs à double sens** : années (2026 bleu, 2025 orange) = usages (chauffe-eau bleu, chauffage orange) dans Comparer ; « Veille non attribuée » en bleu chauffe-eau ; « Puissance max » en orange chauffage. Lecture fausse probable. | majeure | [20](audit/captures/20-mobile-comparer.png), [14](audit/captures/14-mobile-synthese-autres-usages.png) |
| C2 | **Verdict utilisé comme alerte générique** (nouveau tarif en rouge ▲ comme une surconsommation ; CO₂ ; humidité) : un bandeau rouge en 2ᵉ position de l'accueil pour une information tarifaire. | majeure | [10](audit/captures/10-mobile-synthese-ecran1.png) |
| C3 | **Pas de bouton secondaire** : « Rapport anonymisé » s'affiche en bouton natif gris, « Fermer » en lien, « Ajouter » en bouton accent pleine largeur. | mineure | [70](audit/captures/70-mobile-rapport.png) |
| C4 | **Une carte peut contenir 3 sous-cartes avec titres de même niveau** (Linky + Puissance + Délestage ; Autres usages + Postes saisis) : on ne voit pas où une carte s'arrête. | mineure | [12](audit/captures/12-mobile-synthese-linky-puissance-delestage.png) |
| C5 | **Formulaires hétérogènes** : champs date au format du navigateur, 4 façons de poser un libellé, cases et interrupteurs mélangés (inventaire § 5). | mineure | [13](audit/captures/13-mobile-synthese-facture.png) |
| C6 | Carte d'introduction **sans donnée** en tête de Confort (« Confort : air, humidité, froid ») qui pousse le contenu. | suggestion | [50](audit/captures/50-mobile-confort.png) |

### D. Accessibilité et mobile

| # | Constat | Gravité | Preuve |
|---|---|---|---|
| D1 | **Texte système à 200 % (360 px)** : le segment Tout / Chauffage / Chauffe-eau déborde (« Chauffe… » coupé, défilement horizontal), le titre et le badge passent sur 3 lignes, le verdict n'a plus que 4 mots par ligne. | majeure (WCAG 1.4.4 / 1.4.10) | [110](audit/captures/110-mobile360-texte200-synthese.png) |
| D2 | **Étiquettes de graphique tronquées** : « Puissance max atteinte / souscrite » coupées à droite ; axe des pièces illisible (« 9001 2001 500 ») ; tableau des pièces coupé (colonne 2025 hors cadre sans indice de défilement). | majeure | [12](audit/captures/12-mobile-synthese-linky-puissance-delestage.png), [30](audit/captures/30-mobile-pieces.png) |
| D3 | **Mode simple sans navigation** : les onglets disparaissent ; pour revenir il faut ouvrir ⋮ et décocher une case : un proche peut rester bloqué ou, à l'inverse, en sortir sans le vouloir. | majeure | [90](audit/captures/90-mobile-mode-simple.png) |
| D4 | **Formulaires longs dans les vues de lecture** (facture, postes, travaux, télétravail, volets) : sur mobile le clavier recouvre la moitié de la carte et la barre d'onglets fixe recouvre le bouton d'envoi. | mineure | [13](audit/captures/13-mobile-synthese-facture.png), [41](audit/captures/41-mobile-analyse-travaux.png) |
| D5 | **Cibles de 32-38 px** (segments, puces, liens « Comment c'est calculé ») sous les 44 px recommandés. | mineure | inventaire § 4 |
| D6 | **Tailles de texte des graphiques en px fixes** (10-12 px) : ne suivent pas le texte système. | mineure | inventaire § 3 |

### E. États, démarrage, confiance

| # | Constat | Gravité | Preuve |
|---|---|---|---|
| E1 | **Pas de parcours de premier lancement** : après la phrase de passe on arrive sur 47 cartes ; rien ne dit quelles sources sont actives, ce qui manque, ni comment activer Linky / station. La procédure d'installation vit dans le README. | majeure | [01](audit/captures/01-mobile-verrou.png) |
| E2 | **La démo désactive les Paramètres** (« Mode démonstration : les paramètres sont désactivés ») : impossible de découvrir la configuration avant de s'engager. | mineure | [80](audit/captures/80-mobile-parametres.png) |
| E3 | **Complétude des données enfouie** : « Qualité des données » repliée au 10ᵉ écran ; l'état des sources est dans Paramètres ; aucune pastille globale. | majeure | [15](audit/captures/15-mobile-synthese-consommation.png) |
| E4 | **Cartes conditionnelles silencieuses** : une carte absente (pas de Linky, pas de station) ne laisse aucune trace ; l'utilisateur ne sait pas que la fonction existe ni comment l'obtenir. | mineure | — |
| E5 | Écran de verrouillage : bonne base (démo, installer), mais pas d'explication de ce qu'est l'appli pour un invité (#2, #55). | suggestion | [01](audit/captures/01-mobile-verrou.png), [02](audit/captures/02-mobile-verrou-erreur.png) |

## 4. Saisies ponctuelles à déplacer vers la configuration

| Réglage | Où aujourd'hui | Où demain (⚙ Paramètres) | Portée |
|---|---|---|---|
| Contrat (offre, puissance, périodes) | menu ⋮ → Prix | Contrat et prix | **partagé** (variable du dépôt) avec écart local signalé |
| Mes propres prix, prix moyen locataire | menu ⋮ → Prix | Contrat et prix | appareil |
| Budget annuel | carte Budget (Synthèse) | Objectifs et alertes | appareil → partagé (v1.7) |
| Facteur CO₂ | carte Budget (Synthèse) | Objectifs et alertes → Avancé | appareil |
| Seuil de confort (19 °C) | Confort (sélecteur) | Objectifs et alertes | appareil |
| Alerte froid prolongé | Paramètres | Objectifs et alertes | **partagé** (variable du dépôt) |
| Surfaces des pièces, marqueurs travaux | Analyse → Travaux | Mon logement → Pièces / Travaux | appareil (chiffré) |
| Liaison pièce ↔ module de la station | Confort → Sonde | Mon logement → Pièces | appareil |
| Postes saisis à la main | Synthèse → Autres usages | Mon logement → Appareils | appareil (chiffré) |
| Factures saisies | Synthèse → Facture | **Outils → Factures** (c'est un document, pas un réglage) | appareil (chiffré) |
| Journal volets, absences, télétravail | Analyse | **Outils → Journaux** | appareil |
| Mode locataire, dates du bail | Paramètres | Foyer et partage | appareil |
| Vue foyer, détail des chambres | menu ⋮ | Foyer et partage (vue foyer) ; détail des chambres = bouton contextuel sur la carte | appareil / session |
| Mode simple, pièce épinglée | menu ⋮ | Affichage et accessibilité | appareil |
| Verrouillage automatique | menu ⋮ | Sécurité | appareil |
| Sources (Intuis, Linky, Shelly, station, IA, relevé horaire, HA) | Paramètres § 1-4 + README | Sources de données (une fiche par source) | partagé (secrets) |
| Exports, sauvegarde | menu ⋮ | Outils → Rapports et exports | — |

## 5. Ce qui marche et qu'il faut garder

- Le **verdict** du mois, ramené à la météo, en tête : la meilleure idée de l'appli.
- Les **résumés textuels** de chaque graphique, « Comment c'est calculé », « Voir les valeurs » :
  transparence exemplaire, à garder mais **repliés** de façon homogène.
- Le **mode simple FALC** (phrases courtes, glossaire touchable), base de la future vue « Proche ».
- Les **motifs** en contraste élevé, le focus visible, Échap qui ferme le menu, l'audit axe en CI.
- Le **badge démo** et le bouton démo sur l'écran de verrouillage.
- Les valeurs par défaut prudentes (chambres regroupées, IA facultative, données chiffrées).

## 6. Recommandations (résumé, détail dans l'architecture cible)

1. **Nouvelle navigation à 5 onglets** : Accueil · Pièces · Historique · Compteur · Outils, avec
   ⚙ Paramètres et pastille d'état dans l'en-tête ; menu ⋮ supprimé (S-7.16).
2. **Centre de paramètres unifié**, une page par sujet, portée « cet appareil / tout le foyer »
   affichée (S-7.17).
3. **Page Pièce** qui réunit conso, coût, température, confort, fenêtres, sonde, délestage (S-7.21).
4. **Accueil réduit à 5 blocs** : verdict en €, 3 tuiles, ce qui a compté, graphique principal,
   résumé IA ; alertes regroupées (S-7.19).
5. **Espace Outils** : simulateurs, vérifications (facture, données), journaux, rapports et
   exports (S-7.22).
6. **Glossaire et périodes normalisés** dans toute l'appli (S-7.23).
7. **Premier lancement** guidé et vue « Proche » (mode simple avec navigation) (S-7.20, S-7.24).
8. **Design system** (jetons, composants) puis **migration vue par vue** (S-7.18, S-7.25).
9. Correctif immédiat des débordements à 200 % et des étiquettes tronquées (S-7.27).

Issues du jalon v1.6 : #308 (S-7.16) à #319 (S-7.27).

## 7. Reproduire l'audit

```bash
cd web && npm ci && npm run build
node node_modules/vite/bin/vite.js preview --port 5911 --strictPort &
# puis un script Playwright : page.click('#demo'), clic sur chaque [data-view], ouverture de .menu summary,
# iPhone 13 (clair), Pixel 7 (sombre), 360 × 740 avec html{font-size:200%}, bureau 1280 × 900, locale fr-FR.
```

Longueurs mesurées avec `document.documentElement.scrollHeight` (iPhone 13, 664 px utiles par écran).
