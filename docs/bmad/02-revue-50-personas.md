# 02 · Revue par 50 personas

*Application évaluée : v1.0 livrée + v1.1 en cours (coût HP/HC, météo/DJU, signature, calendrier,
cascade, verdict, projection, profils horaires, températures, rapport annuel, alerte, synthèse IA).*
Verdict : 👍 l'application répond déjà à son besoin principal, 👎 elle n'y répond pas encore.
La colonne « Besoin » renvoie aux codes de la synthèse (§ 9).

## 1. Foyer et famille

| # | Persona | Besoin principal | Verdict | Proposition concrète |
|---|---|---|---|---|
| 1 | **Cédric**, propriétaire à l'origine du projet | Comprendre pourquoi une année consomme plus (B2) | 👍 | Afficher sur la cascade N-1 → N la part « météo » (DJU) et la part « comportement » |
| 2 | Conjointe, gère le budget du foyer | Un chiffre en euros et un verdict (B1) | 👎 | Écran d'accueil = carte verdict en euros, le reste derrière un bouton « Détails » |
| 3 | Adolescent, chambre la plus chauffée | Savoir si « sa » pièce est en cause (B7) | 👎 | Classement des pièces en € sur le mois, avec l'écart à la moyenne de la pièce |
| 4 | Parent en télétravail, bureau chauffé en journée | Coût du télétravail (B7, B9) | 👎 | Profil horaire du bureau en semaine vs week-end, chiffré en € |
| 5 | Grand-parent hébergé l'hiver | Avoir chaud sans culpabiliser (B10) | 👎 | Afficher température mesurée vs consigne avant les kWh pour sa chambre |
| 6 | Parent qui gère vacances et absences | Vérifier que le mode absence a servi (B9, B11) | 👎 | Marquer les absences sur le calendrier thermique et signaler une conso anormale pendant l'absence |
| 7 | Membre frileux | Confort, pas économie (B10) | 👎 | Indicateur « jours sous 19 °C » par pièce, à côté de la conso |

## 2. Énergie et climat

| # | Persona | Besoin principal | Verdict | Proposition concrète |
|---|---|---|---|---|
| 8 | Analyste énergie | Normalisation DJU, signature (B2) | 👍 | Exposer pente (kWh/DJU) et température de non-chauffage par saison, avec intervalle de confiance |
| 9 | Thermicien / auditeur DPE | Isolation par pièce (B2, B12) | 👎 | Signature par pièce + kWh/m² (surface saisie) dans le rapport annuel |
| 10 | Conseiller France Rénov' | Avant / après travaux (B2, B12) | 👎 | Marqueur « travaux » daté et comparaison de signature avant / après |
| 11 | Militant sobriété | Impact CO₂ (B17) | 👎 | Facteur d'émission éditable (kgCO₂/kWh, valeur par défaut sourcée ADEME, à vérifier) |
| 12 | Ménage qui compare les offres | Choisir HP/HC, Base ou Tempo (B1, B9) | 👎 | Simulateur « même conso, autre tarif » sur les données horaires (Tempo : jours rouges à fournir, à vérifier) |
| 13 | Météorologue amateur, station Netatmo | Utiliser ses propres mesures (B2, B13) | 👍 | Choix de la source : station Netatmo ou Open-Meteo, et écart entre les deux affiché |

## 3. Technophiles et domotique

| # | Persona | Besoin principal | Verdict | Proposition concrète |
|---|---|---|---|---|
| 14 | Utilisateur Home Assistant | Ne pas dupliquer HA (B13) | 👍 | Rester une archive ; exporter un CSV / JSON importable dans les statistiques HA |
| 15 | Passionné Matter / Thread | Piloter volets et lumières (B14) | 👎 | Ne pas le faire ici : installer Home Assistant, garder l'appli en lecture |
| 16 | Propriétaire du Synology | Faire servir le NAS (B13) | 👎 | Conteneur « pont local » en lecture seule, chiffrant comme le collecteur |
| 17 | Utilisateur Hue (3 lampes) | Scènes et automatisations (B14) | 👎 | Hors sujet énergie : l'API locale du pont Hue et HA suffisent ; impact énergie négligeable à afficher |
| 18 | Utilisateur volets Wiser | Volets fermés la nuit = moins de pertes ? (B13) | 👎 | Corréler l'état des volets (lecture seule) avec la conso nocturne ; intégration Wiser **à vérifier** |
| 19 | Bricoleur Node-RED / MQTT | Brancher ses flux (B13) | 👎 | Format d'échange documenté (JSON chiffré) que tout outil local peut produire |
| 20 | Sceptique du cloud | Rien de lisible hors de chez lui (B6) | 👍 | Option « dépôt de données privé » et documentation de ce qui reste public |

## 4. UX et accessibilité

| # | Persona | Besoin principal | Verdict | Proposition concrète |
|---|---|---|---|---|
| 21 | Designer UX mobile | Moins de contrôles empilés (B4) | 👎 | Feuille « Réglages du graphique », glisser entre périodes, squelette de chargement |
| 22 | Senior de 78 ans | Lire sans effort (B4, B1) | 👎 | Respect du zoom système, police ≥ 16 px, mode « simple » = verdict + 3 chiffres |
| 23 | Personne malvoyante, lecteur d'écran | Graphiques accessibles (B4) | 👎 | `aria-label` résumant chaque graphique + tableau de données alternatif (ECharts `aria`) |
| 24 | Personne daltonienne | Distinguer HP / HC, pièces, années (B4) | 👎 | Palette sûre (testée deutéranopie / protanopie), motifs ou libellés directs, jamais la couleur seule |
| 25 | Possesseur d'un Android d'entrée de gamme | Fluidité (B5) | 👎 | Déchiffrement PBKDF2 une fois puis clé gardée ; données horaires chargées à la demande |
| 26 | Utilisateur iPhone (PWA Safari) | Que ça marche comme une appli (B5) | 👍 | Tester l'éviction du stockage par iOS et la reprise après 7 jours sans ouverture (à vérifier) |
| 27 | Résidence secondaire, réseau faible | Consulter hors ligne (B5) | 👍 | Indiquer la date de la dernière mise à jour en clair sur l'accueil |

## 5. Sécurité, vie privée, juridique

| # | Persona | Besoin principal | Verdict | Proposition concrète |
|---|---|---|---|---|
| 28 | Cryptographe / RSSI | Robustesse face à une attaque hors ligne (B6) | 👍 | Indicateur de robustesse, `rekey`, à terme Argon2id si WebCrypto le permet (non natif aujourd'hui) |
| 29 | DPO (RGPD) | Minimisation, données envoyées à l'IA (B6, B15) | 👎 | Registre : quelles données vont à Anthropic, Open-Meteo, Netatmo ; agrégats seulement, pas de nom de pièce si possible |
| 30 | Juriste (CGU Intuis) | Légitimité de l'accès (B3) | 👎 | Lire et citer les CGU (à vérifier), usage personnel, ne jamais publier les identifiants, demande d'accès officiel |
| 31 | Attaquant hypothétique (cambrioleur) | Déduire les absences (B6) | 👍 | Taille de fichier et heure de commit ne trahissent pas l'absence : commit à heure fixe, pas de fichier « présence » |
| 32 | Auditeur chaîne d'approvisionnement | Dépendances sûres (B3) | 👎 | Dependabot, versions figées, pas de CDN tiers au runtime, SRI si besoin |
| 33 | Membre du foyer attaché à sa vie privée | Ne pas être surveillé (B6) | 👎 | Pas de données horaires par chambre visibles par défaut ; principe affiché dans l'appli |

## 6. Développement, maintenance, exploitation

| # | Persona | Besoin principal | Verdict | Proposition concrète |
|---|---|---|---|---|
| 34 | Mainteneur | Être prévenu des pannes (B3) | 👍 | Alerte par issue livrée ; ajouter un contrôle « données de plus de 3 jours » côté appli |
| 35 | Contributeur open source | Démarrer vite (B8) | 👎 | `CONTRIBUTING`, données de démo à jour avec les nouveaux documents (hourly, weather) |
| 36 | Testeur QA | Non-régression visuelle (B3) | 👎 | Playwright sur les données de démo, captures de référence |
| 37 | SRE | Observabilité du job nocturne (B3, B11) | 👎 | Résumé du job (jours collectés, méthode retenue) dans le `GITHUB_STEP_SUMMARY` |
| 38 | Dev front, performance | Bundle et rendu (B5) | 👎 | ECharts importé à la carte, budget de taille en CI |
| 39 | Repreneur futur (bus factor) | Comprendre sans l'auteur (B8, B3) | 👎 | Ce dossier BMAD + ADR à jour ; scripts de vérification documentés |

## 7. Business et diffusion

| # | Persona | Besoin principal | Verdict | Proposition concrète |
|---|---|---|---|---|
| 40 | Installateur chauffagiste | Montrer l'effet d'un réglage (B12, B8) | 👎 | Rapport annuel PDF partageable ; pas de multi-clients avant v2 |
| 41 | Bailleur | Suivre un logement loué (B16, B1) | 👎 | Le consentement du locataire est requis (à vérifier juridiquement) : ne pas viser ce cas |
| 42 | Syndic de copropriété | Agréger plusieurs logements (B16) | 👎 | Hors cible : radiateurs individuels, données personnelles ; ne pas viser |
| 43 | Association de consommateurs / ALEC | Outil reproductible (B8, B12) | 👎 | Dépôt modèle + guide pas à pas, sans support promis |
| 44 | Fournisseur d'énergie | Conseils personnalisés (B1) | 👎 | Aucun partage ; l'outil reste côté consommateur |
| 45 | Chef de produit Intuis / Netatmo | Usage raisonnable de son backend (B3) | 👎 | Débit minimal documenté, User-Agent identifiable, ouverture d'un dialogue pour un accès officiel |

## 8. IA et données

| # | Persona | Besoin principal | Verdict | Proposition concrète |
|---|---|---|---|---|
| 46 | Data scientist | Détecter les anomalies (B11, B2) | 👎 | Règles déterministes d'abord (écart à la signature > 2σ), l'IA n'explique qu'après |
| 47 | Ingénieur LLM | Synthèse fiable (B15) | 👍 | Chiffres pré-calculés en entrée JSON, sortie structurée, vérification automatique des nombres cités |
| 48 | Sceptique de l'IA (coût, utilité) | Ne pas payer pour du texte creux (B15) | 👎 | IA optionnelle, désactivée sans secret ; mesurer si la synthèse est lue avant d'aller plus loin |
| 49 | Utilisateur qui veut « parler à ses données » | Poser des questions libres (B15) | 👎 | Chat avec sa propre clé seulement si la synthèse mensuelle a prouvé son utilité |
| 50 | Éthicien des données | Transparence de l'envoi à un tiers (B6, B15) | 👎 | Bouton « voir exactement ce qui a été envoyé » dans l'appli, à côté de la synthèse |

## 9. Synthèse : les 15 besoins principaux

Score = fréquence (nombre de personas citant le besoin dans la colonne « Besoin », comptée sur les
tableaux ci-dessus) × impact sur le cœur de mission, « comprendre et décider » (1 faible, 3 fort).
Égalité départagée par l'impact.

| Rang | Code | Besoin | Fréq. | Impact | Score | Couverture |
|---|---|---|---|---|---|---|
| 1 | B3 | Fiabilité et légitimité de la collecte (alerte, observabilité, dépendances, CGU) | 7 | 3 | 21 | v1.1 alerte faite ; v1.2 CI, Dependabot |
| 2 | B2 | Normalisation météo, DJU, signature énergétique | 6 | 3 | 18 | v1.1 en cours |
| 3 | B1 | Verdict et coût réel en euros (HP/HC, abonnement) | 5 | 3 | 15 | v1.1 en cours |
| 4 | B4 | Accessibilité et lisibilité (senior, lecteur d'écran, daltonisme, mobile) | 4 | 3 | 12 | v1.2 (E7) |
| 5 | B6 | Confidentialité : phrase de passe, `rekey`, métadonnées, transparence | 6 | 2 | 12 | v1.2 (E8) |
| 6 | B13 | Corrélation domotique **en lecture seule** (station, volets, capteurs) | 5 | 2 | 10 | Station en cours ; reste v1.3 conditionnel (E9) |
| 7 | B15 | Synthèse IA fiable et transparente | 5 | 2 | 10 | v1.1 en cours (mensuelle) |
| 8 | B5 | Performance et hors ligne sur téléphone modeste | 4 | 2 | 8 | v1.2 |
| 9 | B12 | Rapport annuel partageable, avant / après travaux | 4 | 2 | 8 | v1.1 en cours ; marqueur travaux v1.3 |
| 10 | B7 | Identifier la pièce responsable (cascade, classement en €) | 2 | 3 | 6 | v1.1 en cours |
| 11 | B9 | Profils horaires (télétravail, chauffe-eau en HC, simulateur de tarif) | 3 | 2 | 6 | v1.1 en cours ; simulateur v1.3 |
| 12 | B11 | Alertes d'anomalie proactives | 3 | 2 | 6 | v1.2 (règles déterministes) |
| 13 | B10 | Confort : température mesurée vs consigne | 2 | 2 | 4 | v1.1 en cours |
| 14 | B8 | Installation simple, reprise par un tiers | 4 | 1 | 4 | v2 |
| 15 | B16 | Plusieurs logements (bailleur, syndic) | 2 | 1 | 2 | Hors cible |

Non classés : B14 pilotage domotique (2 personas, impact 1), B17 CO₂ (1 persona).

**Biais du panel** : la famille « domotique » compte 7 personas sur 50, ce qui gonfle B13 ; la famille
« foyer » cite surtout des besoins à fort impact (B1, B7, B10) mais dispersés. À fréquence égale,
c'est la famille qui vit avec l'application tous les jours qui doit trancher.

## 10. Besoin mesuré : domotique

| Option | Personas pour | Personas contre / réservés | Lecture |
|---|---|---|---|
| **Pilotage** (volets Wiser, Hue) depuis l'application | 15, 17 (2) | 14, 20 ; réserves d'analyse : 28 (surface d'attaque), 34 (maintenance) | Besoin faible et déjà couvert par Home Assistant, l'appli Hue et l'appli Wiser. Piloter exige un agent local permanent et une surface d'attaque en écriture : **ne pas construire**. |
| **Corrélation en lecture seule** (état des volets, température intérieure, station) | 13, 14, 16, 18, 19 (5) | 20 (sous réserve de chiffrement) | Besoin réel mais secondaire. Seule la question « fermer les volets la nuit réduit-il la conso ? » relie directement la domotique à l'énergie. |
| Hue, CPL, box | 17 | — | Consommation négligeable face au chauffage ; aucune valeur d'analyse. Exclure. |

**Recommandation** : (1) pas de pilotage dans l'application ; (2) si le propriétaire veut piloter,
installer **Home Assistant** (open source) sur le Synology via Container Manager (compatibilité du
modèle **à vérifier**), qui sait parler **Matter** (le standard ouvert, sur Wi-Fi/Ethernet ou
**Thread**), **Zigbee** (via une clé USB, passage USB sous DSM **à vérifier**), l'API locale du pont
**Hue**, et peut-être **Wiser** (intégrations communautaires selon la gamme : **à vérifier**) ;
(3) avant tout pont, **mesurer** : relever à la main l'heure de fermeture des volets pendant 4 semaines
d'hiver et comparer la conso nocturne. Si l'écart dépasse le bruit (signature ± 2σ), construire le pont
en lecture seule (E9). Sinon, s'arrêter là.

## 11. Besoin mesuré : IA

| Fonction IA | Pour | Contre | Valeur réelle | Décision |
|---|---|---|---|---|
| Synthèse mensuelle rédigée (chiffres pré-calculés, texte par l'IA) | 1, 2, 47 | 48, 50 (sous conditions) | Moyenne : traduit les graphiques en phrases pour la famille. Utile si courte et exacte. | **Garder** (v1.1), en mesurer la lecture sur 3 mois |
| Détection d'anomalies par LLM | — | 46, 48 | Faible : des règles statistiques font mieux, moins cher, de façon testable | **Non** : règles déterministes, l'IA peut seulement les commenter |
| Chat libre dans l'appli avec la clé de l'utilisateur | 49 | 29, 48, 50 | Faible à moyenne : séduisant, peu utilisé, risques (clé dans le navigateur, données envoyées) | **Reporter** : conditionné au succès de la synthèse |
| Prévisions par LLM | — | 8, 46 | Nulle : la régression sur la signature + météo prévue suffit | **Non** |

**Ce qui vaut vraiment la peine** : l'IA comme rédactrice d'un résumé dont tous les nombres viennent
du code, avec affichage de ce qui a été envoyé. Le reste (anomalies, prévisions) relève de statistiques
simples, déjà en cours.

## 12. Personas ajoutés

Le panel s'agrandit sans retirer personne (`docs/PROJET.md` § 5). Les personas 51 et 52 ont été
ajoutés par la [revue v1.2](revues/v1.2.md) pour l'écran Paramètres ; les personas 53 à 62 par le
[cadrage v1.4](revues/v1.4-cadrage.md), pour couvrir des regards absents : domotique locale, location,
aidant, électricité, pompe à chaleur, recherche, langage clair, voiture électrique, droit du
numérique, design system. Le verdict porte sur l'application v1.3.

| # | Persona | Famille | Besoin principal | Verdict | Proposition concrète |
|---|---|---|---|---|---|
| 51 | Propriétaire qui reconfigure depuis son téléphone | IA et données | Renouveler un secret sans le site GitHub | 👍 | Liste des secrets avec date, jamais les valeurs (livré, S-8.4) |
| 52 | Attaquant XSS / extension malveillante | IA et données | Une surface d'injection pour voler le jeton | 👍 | CSP stricte puis Trusted Types (livrés, S-8.5, S-8.9) |
| 53 | Intégrateur Home Assistant et Zigbee | Technophiles et domotique | Faire entrer des capteurs locaux (ouverture, prises, sondes) dans l'archive | 👎 | Étude HA + Zigbee (hôte, clé, capteurs utiles), puis import chiffré des statistiques HA |
| 54 | Locataire équipé de radiateurs Intuitiv | Business et diffusion | Suivre son chauffage sans être titulaire du Linky ni du contrat | 👎 | Mode locataire : prix moyen saisi, cartes Linky masquées avec explication, rapport limité à la période du bail |
| 55 | Aidant à distance d'un parent âgé vivant seul | Foyer et famille | Être prévenu si le logement d'un proche reste froid, sans le surveiller | 👎 | Alerte « froid prolongé » par issue GitHub, sur consentement, sans valeur ni nom de pièce |
| 56 | Électricien | Énergie et climat | Relier puissance, délestage et contacteurs pour conseiller le bon calibre | ➖ | Compter les délestages par pièce et les rapprocher du pic Linky ; afficher le mode du contacteur |
| 57 | Candidat à la pompe à chaleur | Énergie et climat | Savoir ce que coûterait le même confort avec une PAC air-air | 👎 | Estimation PAC à partir de la signature et d'un COP saisi, hypothèses affichées |
| 58 | Chercheur en thermique du bâtiment | IA et données | Des séries horaires propres (énergie, températures, ouvertures) pour caler un modèle | ➖ | Relevé horaire des fenêtres ; export de recherche anonymisé |
| 59 | Personne dyslexique ou avec des troubles cognitifs | UX et accessibilité | Comprendre sans décoder du jargon | 👎 | Mode simple écrit en langage clair (FALC) avec glossaire au toucher |
| 60 | Conducteur de voiture électrique | Énergie et climat | Savoir ce que la recharge coûterait selon l'offre et si le compteur tient | 👎 | Simulateur de recharge : kWh par semaine, plage horaire, effet sur l'offre et le pic |
| 61 | Avocate en droit du numérique | Sécurité, vie privée, juridique | Que les données d'occupation soient traitées comme sensibles | 👎 | Minimisation (présence non conservée), regroupement des chambres, analyse d'impact courte |
| 62 | Responsable de design system | UX et accessibilité | Des jetons et des composants communs plutôt que des styles vue par vue | 👎 | Inventaire des composants et jetons en v1.4, base du design system v1.6 |
