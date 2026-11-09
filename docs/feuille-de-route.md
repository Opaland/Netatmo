# Feuille de route et revue multi-personas

*Novembre 2026, après la mise en service sur une installation réelle : 7 pièces, radiateurs fil pilote,
Aqua Manager, données depuis novembre 2022.*

## 1. Où en est-on

| Fonction | État |
|---|---|
| Collecte quotidienne automatique, historique depuis 2022 | ✅ |
| Chauffage par pièce, chauffe-eau (module NMW), total agrégé | ✅ |
| Comparaison d'années : mois, cumul, saison de chauffe | ✅ |
| Filtres par pièce et par usage, coût au prix unique, export CSV | ✅ |
| PWA installable iOS / Android, hors ligne, données chiffrées | ✅ |
| Diagnostic anonyme de l'API | ✅ |

## 2. Revue multi-personas

Six regards sur l'application telle qu'elle est aujourd'hui.

### 👤 Cédric : propriétaire, à l'origine du projet

> « Je voulais voir plusieurs années et les comparer. C'est fait. Maintenant je veux **comprendre**
> pourquoi une année consomme plus qu'une autre. »

- 👍 Comparaison d'années et filtre par pièce : le besoin de départ est couvert.
- 👎 Impossible de savoir si une baisse vient d'un **hiver plus doux** ou d'un **meilleur réglage**.
- 👎 Le coût est faux depuis le passage en heures pleines / creuses, car un seul prix est appliqué.
- 💡 Corriger par la météo, afficher le coût réel HP/HC, et prévoir où finira l'année.

### 👨‍👩‍👦 Un membre de la famille, pas technophile

> « Je veux juste savoir si ça va, et qui chauffe trop. »

- 👍 L'installation sur l'écran d'accueil et la synthèse en trois chiffres sont lisibles.
- 👎 La phrase de passe est une barrière. « kWh » ne parle pas : les euros parlent.
- 👎 Pas de verdict simple du type « ce mois-ci : normal / élevé ».
- 💡 Ajouter une carte « verdict » en euros et un code couleur avec icône. Afficher par défaut le mois
  en cours comparé à un mois « normal » (moyenne des années passées).

### 📊 Analyste énergie

> « Une comparaison brute d'une année à l'autre ne veut rien dire sans les degrés-jours. »

- 👎 Pas de normalisation climatique (DJU).
- 👎 Pas de données horaires : impossible de voir les profils, comme les relances matinales ou le
  chauffe-eau en heures pleines.
- 👎 Les températures (consigne, mesurée) ne sont pas archivées.
- 💡 Ajouter une **signature énergétique** : kWh par jour selon la température extérieure, avec la
  droite de régression. Sa pente mesure l'isolation, son intersection la température de non-chauffage.
  Ajouter aussi des kWh/DJU par saison et par pièce, et des kWh/m² si la surface est saisie.

### 🎨 Designer UX mobile

- 👍 Navigation par onglets en bas, contrôles segmentés, thème sombre soigné.
- 👎 Trop de contrôles empilés sur la carte « Consommation » sur mobile (période, granularité, détail).
- 👎 Pas d'indication de chargement au premier déchiffrement, qui prend 1 à 2 s sur un vieux téléphone.
- 👎 Le sélecteur de pièces est une liste longue. Le graphique horizontal n'est pas « tapable » partout.
- 💡 Rassembler les réglages dans une feuille « Réglages du graphique » et faire glisser entre les
  périodes. Ajouter un écran de chargement squelette et une vibration au changement de vue.

### 🛠️ Mainteneur

- 👍 Tests sur une API simulée, test croisé du chiffrement, CI verte, diagnostic intégré.
- 👎 Si la collecte échoue (mot de passe changé, API modifiée), **personne n'est prévenu**.
- 👎 Pas de tests de bout en bout du front dans la CI. Dépendances non surveillées.
- 👎 Chaque nuit, un commit de données fait grossir l'historique Git.
- 💡 Ouvrir automatiquement une *issue* GitHub en cas d'échec, ce qui envoie un e-mail. Ajouter
  Playwright en CI et Dependabot. Ranger les données dans une branche `data` dédiée.

### 🔒 Sécurité et vie privée

- 👍 Chiffrement AES-GCM et PBKDF2 600 000 itérations, rien en clair, journaux anonymes.
- 👎 La solidité dépend **entièrement** de la phrase de passe, et rien ne l'évalue.
- 👎 Pas de procédure pour **changer de phrase de passe** : il faudrait rechiffrer.
- 👎 Les métadonnées restent publiques : fréquence des commits, taille des fichiers. Leur risque
  est faible.
- 💡 Ajouter une commande `rekey` (rechiffrement), un indicateur de robustesse dans le README,
  et éventuellement un dépôt de données privé séparé du dépôt public de l'application.

## 3. Feuille de route

Effort : S = une demi-journée, M = 1 à 2 jours, L = plus.

### Version 1.1 : comprendre sa consommation (priorité haute)

| # | Fonction | Pourquoi | Effort |
|---|---|---|---|
| 1 | **Coût réel HP/HC** : conserver `$1`/`$2` séparément, saisir les prix HP, HC et base, plus l'abonnement | Le coût affiché est faux depuis 2025 | M |
| 2 | **Météo et DJU** via Open-Meteo (archive gratuite, sans clé, à partir des coordonnées de la maison) | Comparer les années à climat égal | M |
| 3 | **Signature énergétique** : nuage kWh/jour en fonction de la température extérieure, une couleur par saison, droite de régression | Voir l'effet d'un réglage ou de travaux | S (après 2) |
| 4 | **Projection de fin d'année** et budget annuel | « Où va-t-on finir ? » | S |
| 5 | **Alerte en cas d'échec de collecte** (issue GitHub, donc e-mail) | Ne pas perdre de données en silence | S |

### Version 1.2 : nouvelles visualisations

| # | Visualisation | Ce qu'elle montre | Effort |
|---|---|---|---|
| 6 | **Calendrier thermique** : une case par jour, couleur selon la consommation, une ligne par année | Vagues de froid, absences, week-ends, en un coup d'œil | S |
| 7 | **Cascade N-1 → N par pièce** | Quelle pièce explique la hausse ou la baisse | S |
| 8 | **Petits multiples** : une mini-courbe mensuelle par pièce, sur la même échelle | Comparer les pièces sans superposer 7 courbes | S |
| 9 | **Profils horaires** : collecte `1hour` des 90 derniers jours, carte heure × jour de semaine | Relances du matin, chauffe-eau en heures creuses ou non | M |
| 10 | **Températures** : consigne et mesurée par pièce (à vérifier dans l'API), superposées à la consommation | Pièces mal réglées, fenêtres ouvertes | M |
| 11 | **Carte « verdict »** en euros, avec un code couleur et une icône | Lisible par toute la famille | S |

### Version 1.3 : confort et robustesse

| # | Fonction | Effort |
|---|---|---|
| 12 | Réglages du graphique en feuille, glisser entre les périodes, écran de chargement | M |
| 13 | Surface des pièces et kWh/m² ; nom court et icône par pièce | S |
| 14 | Commande `rekey` (changer de phrase de passe) et indicateur de robustesse | S |
| 15 | Données dans une branche `data` dédiée ; tests Playwright en CI ; Dependabot | M |
| 16 | Rapport annuel imprimable (PDF) : bilan, faits marquants, comparatif | M |

### Version 2 : diffusion

| # | Fonction | Effort |
|---|---|---|
| 17 | **Dépôt modèle** (« Use this template ») et assistant de configuration pas à pas | M |
| 18 | Plusieurs maisons sur un même compte | M |
| 19 | Publication sur les stores : Play Store via TWA, App Store via Capacitor | L |
| 20 | Demande d'accès officiel à Netatmo / Intuis (contact-api@netatmo.com) | — |

### Versions 1.4 à 1.6 (décidées en novembre 2026)

Les versions 1.1 à 1.3 ont livré l'essentiel des tableaux ci-dessus (voir `CHANGELOG.md` et
[`bmad/revues/`](bmad/revues/)). La suite alterne une version de fonctions et deux versions de qualité.

| Version | Thème | Contenu | Jalon |
|---|---|---|---|
| **1.4** ✅ livrée | Expliquer par pièce | Nouveau cadrage par **62 personas** (les 52 existants + 10 nouveaux, une issue chacun) ; historique des **fenêtres ouvertes**, du boost et des états des radiateurs (`homestatus`, #162), avec minimisation des données de présence ; **prises Shelly** (#158) ; étude Home Assistant + Zigbee ; processus de **revue par agents** (#157) ; récits v1.3 restants (facture, surfaces et travaux, Safari, branche `data`, mesure des volets, QR code) ; récits des nouveaux personas (alerte froid, langage clair, VE, PAC, locataire) | [v1.4](https://github.com/Opaland/Netatmo/milestone/4) |
| **1.5** ✅ livrée | Revue de code | **Tout le code** relu par des agents de revue en quatre lots, 46 constats en issues `revue-code` (1 critique, 17 majeurs), 43 corrigés et 3 reportés en v1.6 ; budget de taille honnête (premier écran de 269 à ~70 kB) ; suites de l'audit des données côté collecte (pièces au pas 30 min sur 4 ans, état des appareils, piles, firmware, pic et index Linky, pinces Shelly) ; pas de nouvelle vue | [v1.5](https://github.com/Opaland/Netatmo/milestone/5) |
| **1.6** 🔄 en cours | Design et UI/UX | Audit UX, architecture cible, maquettes et audit des graphiques faits pendant la v1.5 ; **reconstruction sur un nouveau design system** (Open Props + Radix Colors : jetons, typographie, espacements, composants) approuvée par le propriétaire le 9 novembre 2026, **étape 1 (fondations, S-7.18) en cours** ; puis navigation à 5 onglets, centre de paramètres, Accueil, page Pièce, Outils ; constats reportés (#229, #257, #258) | [v1.6](https://github.com/Opaland/Netatmo/milestone/6) |
| **2** | Diffuser | Dépôt modèle, assistant, chat IA conditionnel, Argon2id, copie NAS | [v2](https://github.com/Opaland/Netatmo/milestone/3) |

## 4. Ordre recommandé

1. **#5 Alerte d'échec** : petite tâche qui protège tout le reste.
2. **#1 Coût HP/HC**, puis **#2 Météo**, puis **#3 Signature énergétique** : c'est le cœur de la
   question « pourquoi ».
3. **#6 Calendrier**, **#7 Cascade** et **#11 Verdict** : trois visualisations à fort effet pour peu
   d'effort.
4. Le reste selon l'usage réel au fil de l'hiver.

**Bilan de la v1.4** (novembre 2026) : 17 récits nouveaux et 8 repris livrés, plus l'audit des
données ; jalon fermé ; 46 personas sur 62 en 👍 ([revue de fin](bmad/revues/v1.4.md)). Le relevé
horaire reste à activer par le propriétaire (`ROOM_STATE_HOURLY`).

**Bilan de la v1.5** (novembre 2026) : revue de code complète, 43 constats sur 46 corrigés (dont le
seul critique, une fuite des coordonnées dans les journaux publics), suites de l'audit des données
livrées, jalon fermé ; 40 personas en 👍, 21 en ➖ (version sans nouvelle vue), 1 en 👎
([revue de fin](bmad/revues/v1.5.md)). Restent au propriétaire : supprimer les anciens journaux de
collecte, décider de l'origine (#229), régler `DEVICE_ALERT`.

**v1.6** (en cours) : reconstruction de l'interface sur le nouveau design system, approuvée le
9 novembre 2026 ; d'abord les fondations (jetons et composants, S-7.18, #310), puis le plan de
migration (S-7.25, #317) et les écrans dans l'ordre de `docs/design/architecture-cible.md`.

**Rappel du départ de la v1.4** : d'abord S-1.16 (méthode de revue, prérequis de la v1.5 et de la v1.6) et
S-13.1 (l'API sert-elle déjà un historique de fenêtre ouverte ?), puis S-13.5 avant toute collecte de
données d'occupation, puis S-13.2 et S-13.3. Le détail et les priorités sont dans
[`bmad/revues/v1.4-cadrage.md`](bmad/revues/v1.4-cadrage.md).
