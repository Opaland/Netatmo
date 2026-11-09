# Architecture cible de l'application (v1.6)

*Proposition issue de l'[audit d'utilisabilité](audit-ux.md), novembre 2026. Rien n'est encore
construit : ce document fixe la cible des récits S-7.16 à S-7.25. Maquettes cliquables :
[`maquettes/index.html`](maquettes/index.html). Composants et jetons : [design-system.md](design-system.md).*

## 1. Principes

1. **Une question par écran.** Chaque onglet répond à une question de l'utilisateur, pas à une
   source de données : « Où en suis-je ? », « Quelle pièce ? », « Par rapport à avant ? »,
   « Que dit mon compteur ? », « Et si… / vérifier / exporter ».
2. **Lire d'un côté, régler de l'autre.** Aucune saisie durable dans une vue de lecture : contrat,
   budget, seuils, surfaces, appareils, sources vont dans ⚙ Paramètres ; les journaux et les factures
   vont dans Outils.
3. **Divulgation progressive.** Niveau 1 : le chiffre et la phrase. Niveau 2 : le graphique. Niveau 3 :
   « Comment c'est calculé », « Voir les valeurs », hypothèses. Une page fait **au plus 3 écrans** de
   téléphone avant ses repliés.
4. **Euros d'abord, kWh ensuite** pour tout ce qui parle de dépense ; °C et ppm pour le confort.
5. **Une seule période active par écran**, affichée en clair, choisie avec un sélecteur commun.
6. **Ce qui manque se voit** : une fonction indisponible (pas de Linky, pas de station) laisse une
   ligne « À activer » avec le lien vers sa fiche source, jamais un vide.

## 2. Plan du site

```
En-tête : [Nom du logement]  [● Données du 8 nov.]  [⚙]
                               └─ État des données (page)

Onglets (bas sur mobile, haut ≥ 760 px)
├── 1. Accueil
│     verdict du mois (€ puis kWh) · 3 tuiles (ce mois, depuis le 1ᵉʳ janvier, fin d'année estimée)
│     · alertes groupées (nouveau tarif, froid, jeton, collecte) · « Ce qui a compté » (3 pièces, €)
│     · graphique Consommation (période commune) · résumé de l'analyse IA → page Analyse du mois
├── 2. Pièces                         [Liste | Plan (#202)]
│     liste triée par coût (€, kWh, °C moyenne, pastille confort)  ;  Chauffe-eau à part (« Appareils »)
│     └── Pièce (sous-page)
│           coût et conso (mois par mois, an dernier) · température mesurée / consigne · heures sous 19 °C
│           · « Pourquoi il a fait froid » · fenêtres, boost, délestage · CO₂ / humidité (module lié)
│           · sonde radiateur ↔ station · surface et kWh/m² · [Comment c'est calculé]
│     └── Chauffe-eau (sous-page) : heures creuses, mode du contacteur, conso
│     └── Air et confort du logement (sous-page) : CO₂ des nuits, humidité, capteurs HA
├── 3. Historique
│     préréglages : [Cette année / l'an dernier] [Hiver / hiver précédent] [Toutes les années]
│     interrupteur « À climat égal » · années comparées · Totaux annuels
│     · Qu'est-ce qui a changé ? (cascade) · Calendrier · Jours inhabituels
│     └── Signature du logement (sous-page) : signature, intérieur − extérieur, avant / après travaux
│     └── Météo (sous-page) : station Netatmo, températures, (#204 localisation, #221 vent, #220 pression)
├── 4. Compteur                        (masqué en mode locataire → remplacé par une ligne dans Outils)
│     Part des usages (chauffage, eau chaude, autres) · Puissance maximale et délestage
│     · Journée type (courbe de charge) · Veille (talon) · Heures pleines / creuses
│     └── Autres usages en détail (sous-page) : prises Shelly, appareils saisis, non attribué
└── 5. Outils
      Simulateurs : Quelle offre ? · Voiture électrique · Pompe à chaleur · Consigne − 1 °C
                    · Télétravail · Plannings et heures creuses (#211)
      Vérifier : Une facture (liste des factures) · État des données (aussi via l'en-tête)
      Journaux : Absences (#210) · Volets (#24, #26, #200) · Travaux
      Analyse du mois (IA) : texte, archive des mois, ce qui a été envoyé
      Rapports et exports : Rapport annuel · Rapport anonymisé · Questions types · CSV · Export long
                            · Export recherche · Sauvegarde chiffrée

⚙ Paramètres (page avec sous-pages, bouton retour)
      Contrat et prix · Mon logement · Sources de données · Objectifs et alertes
      · Affichage et accessibilité · Foyer et partage · Sécurité · À propos
```

### Modèle de navigation

| Niveau | Élément | Mobile | Bureau |
|---|---|---|---|
| 0 | En-tête : nom, **pastille d'état** (vert / orange / rouge + date), ⚙ | fixe en haut, 56 px | fixe en haut |
| 1 | 5 onglets | barre basse, icône + libellé, 64 px | onglets en haut, à droite du nom |
| 2 | Sous-page (Pièce, Signature, Paramètres → Contrat…) | plein écran, **flèche retour** en haut à gauche + titre ; geste retour du système | panneau principal, fil d'Ariane |
| 3 | Feuille (période, réglages du graphique #20, filtres) | **feuille du bas** (bottom sheet) modale, Échap / glisser pour fermer | fenêtre ancrée (popover) |
| — | « Comment c'est calculé » | repli `details` homogène, en pied de carte | idem |

- Chaque sous-page a une **URL** (`#/pieces/salon`, `#/parametres/contrat`) : le bouton retour du
  téléphone et le partage d'un lien fonctionnent ; le dernier onglet est mémorisé.
- **Un seul sélecteur de période** par écran, en tête du contenu, sous forme de puce
  « 12 derniers mois ▾ » qui ouvre la feuille Période (§ 4.1). Les filtres globaux actuels
  (Tout / Chauffage / Chauffe-eau, Pièces 6/6) disparaissent de l'en-tête : l'usage devient un
  segment **dans** le graphique Consommation, la sélection de pièces vit dans l'onglet Pièces.
- Le glissement horizontal entre onglets est conservé ; entre périodes, il passe dans le graphique.

## 3. Où va chaque carte

Légende : **Garder** (même onglet), **Déplacer**, **Fusionner**, **→ Paramètres**, **→ Outils**,
**Supprimer**.

| Carte actuelle (vue) | Décision | Destination |
|---|---|---|
| Verdict du mois (Synthèse) | Garder, en **€ d'abord** | Accueil |
| Bandeau nouveau tarif (Synthèse) | Fusionner dans **Alertes** (composant alerte « info », plus le verdict rouge) | Accueil → alertes |
| 4 tuiles (Synthèse) | Garder 3 (ce mois, depuis le 1ᵉʳ janvier, fin d'année estimée) ; « 12 derniers mois » passe dans Historique | Accueil |
| Budget et empreinte (Synthèse) | Saisie → Paramètres ; l'écart au budget devient une ligne de la tuile « fin d'année » ; le CO₂ une ligne dans Historique → Totaux | ⚙ Objectifs ; Accueil ; Historique |
| Part dans la consommation du logement (Synthèse) | Déplacer | Compteur |
| Puissance maximale appelée (Synthèse) | Déplacer | Compteur |
| Délestage (Synthèse) | Fusionner avec Puissance (logement) et page Pièce (par pièce) ; retirer la copie de Confort | Compteur, Pièce |
| Recouper avec une facture (Synthèse) | Déplacer, factures gardées en liste | Outils → Vérifier |
| Courbe de charge, talon, demi-heure max, un jour (Synthèse) | Déplacer, en 2 cartes (Journée type ; Veille) | Compteur |
| Autres usages en détail (Synthèse) | Déplacer en sous-page ; saisie des postes → Paramètres | Compteur → sous-page ; ⚙ Mon logement → Appareils |
| Consommation (Synthèse) | Garder, **remonter** en 2ᵉ bloc, réglages en feuille (#20) | Accueil |
| Qualité des données (Synthèse) | Déplacer | État des données (pastille d'en-tête) |
| Comparer les années (Comparer) | Garder + préréglages | Historique |
| Totaux annuels (Comparer) | Garder, + CO₂ et coût | Historique |
| Quelle offre EDF ? (Comparer) | Déplacer | Outils → Simulateurs |
| Voiture électrique (Comparer) | Déplacer | Outils → Simulateurs |
| Par pièce (Pièces) | Garder, liste **en €** triée, chauffe-eau à part | Pièces |
| Qu'est-ce qui a changé ? (Pièces) | Déplacer (c'est une comparaison) ; une ligne par pièce dans la page Pièce | Historique ; Pièce |
| Détail mois par mois d'une pièce (Pièces) | Devient la page **Pièce** | Pièces → Pièce |
| Analyse du mois IA (Analyse) | Résumé sur Accueil, page complète + archive | Accueil ; Outils → Analyse du mois |
| Signature énergétique (Analyse) | Déplacer en sous-page | Historique → Signature |
| Signature intérieur − extérieur (Analyse) | Fusionner (onglet de la sous-page) | Historique → Signature |
| Travaux et surfaces (Analyse) | Saisie → Paramètres / Outils ; résultat avant / après → Signature | ⚙ Mon logement ; Outils → Journaux ; Historique → Signature |
| Consigne − 1 °C (Analyse) | Déplacer | Outils → Simulateurs |
| Pompe à chaleur (Analyse) | Déplacer | Outils → Simulateurs |
| Volets fermés le soir (Analyse) | Déplacer | Outils → Journaux |
| Jours inhabituels (Analyse) | Déplacer | Historique |
| Calendrier (Analyse) | Déplacer | Historique |
| Absences probables (Analyse) | Déplacer (fusion avec absences confirmées de Confort, #210) | Outils → Journaux |
| Profil horaire (Analyse) | Fusionner avec Journée type (même question : quand je consomme) | Compteur (ou Pièce pour une pièce) |
| Télétravail (Analyse) | Déplacer | Outils → Simulateurs |
| Heures pleines / creuses (Analyse) | Déplacer | Compteur |
| Chauffe-eau : heures creuses ? (Analyse) | Déplacer | Pièces → Chauffe-eau |
| Station météo Netatmo (Analyse) | Déplacer | Historique → Météo |
| Températures (Analyse) | Fusionner : par pièce dans la page Pièce, extérieur dans Météo | Pièce ; Historique → Météo |
| Confort (intro, Confort) | **Supprimer** (texte en aide de la sous-page) | — |
| CO₂ de la nuit (Confort) | Déplacer : par pièce dans Pièce (module lié), vue d'ensemble en sous-page | Pièce ; Pièces → Air et confort |
| Humidité (Confort) | idem | Pièce ; Air et confort |
| Heures sous 19 °C (Confort) | Liste : pastille dans Pièces ; détail dans Pièce ; seuil → Paramètres | Pièces, Pièce, ⚙ Objectifs |
| Fenêtres ouvertes et radiateurs (Confort) | Éclater : par pièce dans Pièce ; « sans aération » → Signature ; absences → Journaux ; délestage → Compteur | Pièce, Signature, Journaux, Compteur |
| Capteurs Home Assistant (Confort) | État → Sources ; accord fenêtre par pièce → Pièce | ⚙ Sources ; Pièce |
| Sonde du radiateur et station (Confort) | Liaison → Paramètres ; écart → Pièce | ⚙ Mon logement ; Pièce |
| Rapport annuel, anonymisé (menu → page) | Déplacer | Outils → Rapports |
| Questions types (Rapport) | Déplacer ; la question « pièce froide » renvoie à la page Pièce | Outils → Rapports (et recherche future) |
| Prix (menu) | → Paramètres | ⚙ Contrat et prix |
| Vue foyer, détail des chambres (menu) | → Paramètres ; « Afficher le détail » reste un bouton contextuel | ⚙ Foyer et partage |
| Mode simple, pièce épinglée (menu) | → Paramètres + premier lancement | ⚙ Affichage |
| Verrouiller sans activité (menu) | → Paramètres | ⚙ Sécurité |
| Exports CSV / long / recherche, sauvegarde (menu) | Déplacer | Outils → Rapports et exports (sauvegarde aussi dans ⚙ Sécurité) |
| Verrouiller / Quitter la démo (menu) | Garder, dans ⚙ (en bas) et sur l'écran État | ⚙ |
| État des sources (Paramètres) | Déplacer | État des données + ⚙ Sources |
| Mode locataire (Paramètres) | Déplacer | ⚙ Foyer et partage |
| Alerte froid (Paramètres) | Déplacer | ⚙ Objectifs et alertes |
| Secrets 1-2-4, contrat partagé 3 (Paramètres) | Éclater par source (assistant) et par sujet | ⚙ Sources ; ⚙ Contrat et prix |
| Ce qui est public, Cadre juridique, Version (Paramètres) | Regrouper | ⚙ À propos et confidentialité |
| Inviter (Paramètres) | Déplacer | ⚙ Foyer et partage |

Bilan : **47 cartes → 5 onglets de 4 à 6 blocs** + 9 sous-pages ; **aucune carte supprimée sans
remplacement** sauf l'introduction de Confort ; 14 formulaires sortent des vues de lecture.

## 4. Nomenclature unique (glossaire de l'interface)

### 4.1 Périodes

| Nom affiché | Définition | Remplace |
|---|---|---|
| **Ce mois-ci** (« novembre, au 8 ») | 1ᵉʳ du mois → dernier jour collecté | « Novembre 2026 (au 8) » |
| **Depuis le 1ᵉʳ janvier** | année civile en cours, à date | « Depuis le 1er janvier » (écrire 1ᵉʳ) |
| **12 derniers mois** | 365 jours glissants jusqu'au dernier jour collecté | « Sur 12 mois », « sur 12 mois » |
| **30 derniers jours** | fenêtre courte unique (courbe, autres usages, CO₂, fenêtres) | 7 j, 30 nuits, 90 j : **ramener à 30 jours ou 12 mois** sauf justification écrite dans l'aide |
| **Saison de chauffe 2025-2026** | 1ᵉʳ septembre → 31 août (définition des agrégats) ; les jours **chauffés** sont ceux où le chauffage dépasse un seuil, et non « novembre → mars » | « saison » (2 définitions) |
| **L'an dernier** | même période, un an avant | « N-1 », « vs N-1 » |
| **Fin d'année estimée** | projection au 31 décembre | « Fin 2026 estimée » |

Le sélecteur de période propose toujours ces mêmes libellés, dans cet ordre, plus « Choisir des dates ».

### 4.2 Unités et nombres

| Grandeur | Écriture | Règle |
|---|---|---|
| Argent | **32 €**, **1 333 €**, **0,2142 €/kWh** | € arrondi à l'euro sauf prix unitaires ; espace insécable fine avant € |
| Énergie | **170 kWh** ; ≥ 10 000 → **11,1 MWh** seulement dans les totaux pluriannuels | jamais « kwh » |
| Puissance | **10,2 kVA** (compteur) ; **235 W** (appareil) | kVA expliqué dans le glossaire |
| Température | **19,0 °C** ; écart **+1,2 °C** | une décimale |
| CO₂ | **1 400 ppm** ; empreinte **274 kg CO₂e** | « kgCO₂e » → « kg CO₂e » |
| Écart | **−16 %** avec ▼ et texte « que l'an dernier » | signe « − » typographique |
| Estimation | **≈ 6 980 kWh**, mot « environ » en mode simple | |
| Dates | « 8 novembre 2026 », « 8 nov. » dans les axes ; heures locales « 4 h 12 » | jamais ISO ni UTC à l'écran |

### 4.3 Catégories et objets

| Terme | Sens | À ne plus écrire |
|---|---|---|
| **Chauffage** | radiateurs Intuis | |
| **Eau chaude** (usage) / **Chauffe-eau** (appareil) | usage vs appareil | « ballon », « cumulus » |
| **Autres usages** | Linky − chauffage − eau chaude | « reste » |
| **Veille** (en aide : « talon de nuit ») | consommation permanente | « talon » seul |
| **Pièce** | pièce chauffée Intuis ; le chauffe-eau est un **appareil** | chauffe-eau dans la liste des pièces |
| **Chambres** (regroupées) | regroupement de la vue foyer, toujours avec l'icône groupe | |
| **Module** | module de la station Netatmo | « capteur » pour la station |
| **Capteur** | Shelly, Home Assistant | |
| **Compteur** | Linky | « compteur Linky » en sous-titre partout |
| **Délestage** | « radiateur coupé pour ne pas dépasser votre puissance » (glossaire) | |
| **Signature du logement** | kWh par jour selon la température extérieure | « signature énergétique » (garder en aide) |
| **À climat égal** | corrigé des degrés-jours | |
| **Estimé** / **Reconstitué** / **Manquant** | 3 états de la donnée, une seule légende | « perdu chez Intuis » en aide seulement |

### 4.4 Libellés d'interface

- Titres de carte = **nom court** (« Puissance maximale »), la question en sous-titre gris.
- Boutons : verbe à l'infinitif (« Ajouter une facture », « Partager avec le foyer »).
- « Comment c'est calculé » et « Voir les valeurs » : deux seuls libellés de repli.
- Le glossaire (`plain.ts`) est disponible **dans tous les modes** : terme souligné en pointillé,
  définition en info-bulle accessible.

## 5. Centre de paramètres

Chaque page affiche sa **portée** par une étiquette : **Cet appareil** ou **Tout le foyer** (écrit
dans le dépôt, visible sur tous les appareils). Une modification locale d'un réglage partagé affiche
« Modifié sur cet appareil · Partager ».

| Page | Contenu | Portée |
|---|---|---|
| **Contrat et prix** | périodes de contrat (offre, puissance, date), prix du jour, mes propres prix, prix moyen (locataire), partage | foyer (contrat) ; appareil (prix perso) |
| **Mon logement** | pièces : nom affiché, catégorie, surface, module de la station lié, pièce épinglée ; appareils saisis à la main ; travaux (dates) ; plan (#202) ; localisation exacte (#204) | appareil (chiffré) → foyer en v1.7 |
| **Sources de données** | une fiche par source : état, dernière collecte, expiration, **assistant d'activation** (pas à pas du README intégré, jeton GitHub, champs) ; Intuis, météo, station, Linky + courbe, Shelly, Home Assistant, IA, relevé horaire, volets Wiser (#200) | foyer (secrets) |
| **Objectifs et alertes** | budget annuel, seuil de confort (19 °C), seuils CO₂ / humidité, alerte froid prolongé, facteur CO₂ (avancé) | appareil ; alerte froid = foyer |
| **Affichage et accessibilité** | mode (complet / simple), thème (système, clair, sombre), taille du texte, motifs dans les graphiques, réduire les animations | appareil |
| **Foyer et partage** | inviter (QR), vue foyer (chambres regroupées), mode locataire et bail, IA (activer, avis) | appareil / foyer |
| **Sécurité** | verrouillage automatique, rester connecté, sauvegarde chiffrée, changer de phrase (procédure), verrouiller maintenant | appareil |
| **À propos et confidentialité** | ce qui est public, services tiers, cadre juridique, version, démo | — |

En **démo**, les pages s'ouvrent en lecture avec des valeurs d'exemple et un bandeau « Démo : rien
n'est enregistré » (aujourd'hui elles sont désactivées).

## 6. Premier lancement et vue « Proche »

```
Verrou (phrase / démo / installer)
  └─ 1. Bienvenue : « Voici votre consommation d'énergie, chiffrée et privée. » [Continuer]
  └─ 2. Qui utilise ce téléphone ?  ( ) Moi, je gère le logement  ( ) Un proche (vue simple)  ( ) Locataire
  └─ 3. Vos sources : liste cochée (Intuis ✓, météo ✓, station ✓, Linky ○ À activer, Shelly ○…)
        avec « Plus tard » ; chaque « À activer » ouvre la fiche Source
  └─ 4. Votre contrat : partagé détecté ✓ / sinon offre + puissance (2 champs)
  └─ Accueil, avec une bulle unique « Touchez une pièce pour son détail » (une seule fois)
```

- 4 écrans au plus, chacun passable ; repris dans ⚙ → « Revoir la présentation ».
- **Vue Proche** (mode simple) : Accueil simplifié **avec une barre de 3 onglets** (Accueil, Ma pièce,
  Aide) et un bouton visible « Voir plus de détails » qui demande une confirmation, au lieu de
  l'absence actuelle de navigation.

## 7. États communs

| État | Présentation | Exemple de texte |
|---|---|---|
| Chargement | squelette de la carte (déjà là) | — |
| Vide (pas encore de données) | icône + phrase + date attendue | « Les données de la station arriveront après la prochaine collecte (cette nuit). » |
| Indisponible (source non activée) | ligne « À activer » + lien fiche source | « Activez le compteur Linky pour voir la part du chauffage. » |
| Partiel | alerte « attention » dans la carte + lien État des données | « 3 jours estimés ce mois-ci. » |
| Données arrêtées | pastille d'en-tête orange/rouge + alerte sur Accueil | « Dernière collecte il y a 3 jours. Voir pourquoi » |
| Hors ligne | bandeau « info » discret sous l'en-tête | « Hors ligne : données du 8 nov. » |
| Erreur | alerte « erreur » avec action | « La collecte a échoué : mot de passe Intuis refusé. Mettre à jour » |

## 8. Correspondance avec les issues v1.6

| Récit | Sujet |
|---|---|
| S-7.16 | Nouvelle navigation (onglets, en-tête, sous-pages, URL) |
| S-7.17 | Centre de paramètres unifié |
| S-7.18 | Design system : jetons et composants |
| S-7.19 | Refonte de l'Accueil |
| S-7.20 | Premier lancement |
| S-7.21 | Page Pièce (réunit Pièces et Confort) |
| S-7.22 | Espace Outils (simulateurs, vérifier, journaux, rapports) |
| S-7.23 | Nomenclature, périodes et glossaire partout |
| S-7.24 | Vue Proche (mode simple avec navigation) |
| S-7.25 | Reconstruire l'application sur le nouveau design system (migration) |
| S-7.26 | État des données (pastille, complétude, sources) |
| liées | #20 (réglages du graphique = feuille Période), #202 (plan, onglet Pièces), #204 (localisation, ⚙ Mon logement), #200 / #24 / #26 (volets, Journaux), #210 (absences, Journaux), #211 (plannings, Simulateurs), #220 / #221 (Météo) |
