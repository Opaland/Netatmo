# 03 · PRD : exigences produit (PM)

## 1. Vision

> **Comprendre sa consommation de chauffage et d'eau chaude sur plusieurs années, en euros, à climat
> égal, sans serveur et sans livrer ses données à personne.**

L'application est une **archive analytique en lecture seule**. Elle ne pilote rien : l'application
Intuis, Home Assistant ou les applications des fabricants le font déjà. Sa valeur est la mémoire longue,
la comparaison et l'explication.

## 2. Personas retenus

| Priorité | Persona (n° revue) | Ce qui le satisfait | Ce qui le perd |
|---|---|---|---|
| P1 | **Cédric**, propriétaire (1) | Cascade N-1 → N séparant météo et comportement ; signature énergétique | Un chiffre qu'il ne peut pas recouper avec l'application officielle |
| P2 | **Conjointe**, budget (2) | Verdict en euros sur l'écran d'accueil, projection de fin d'année | Les kWh, les réglages, la phrase de passe à chaque ouverture |
| P3 | **Senior** hébergé (22), avec exigences de 23 et 24 | Grands caractères, couleurs sûres, mode simple | Graphiques denses, couleur seule pour coder l'information |
| P4 | **Mainteneur** (34), qui est aussi P1 | Alerte d'échec, tests, CI verte, données jamais perdues | Une panne silencieuse ; une dépendance qui casse le build |

Personas explicitement non ciblés : bailleur, syndic, fournisseur d'énergie (41, 42, 44).

## 3. Exigences fonctionnelles

Statut : ✅ livré · 🔄 en cours v1.1 · ⏳ à faire.

| ID | Exigence | Persona | Version | Statut |
|---|---|---|---|---|
| FR-1 | Collecter chaque nuit l'énergie par pièce et par jour, re-télécharger les 35 derniers jours | P4 | 1.0 | ✅ |
| FR-2 | Interroger l'Aqua Manager au niveau du module NMW | P1 | 1.0 | ✅ |
| FR-3 | Combiner les familles de types de mesure (`_heating`, sans suffixe, `$0/$1/$2`) en gardant la plus grande valeur par pièce et par jour | P1 | 1.0 | ✅ |
| FR-4 | Comparer les années : mois, cumul au 1er janvier, saison de chauffe (sept. → août) | P1 | 1.0 | ✅ |
| FR-5 | Filtrer par pièce et par usage (chauffage, chauffe-eau, total) ; export CSV | P1 | 1.0 | ✅ |
| FR-6 | Conserver `$1`/`$2` séparément et calculer le coût réel : prix HP, HC, base, abonnement, avec historique de prix daté | P1, P2 | 1.1 | 🔄 |
| FR-7 | Températures extérieures quotidiennes (Open-Meteo, ou station Netatmo via l'API officielle) et DJU (base 18 °C, éditable) | P1 | 1.1 | 🔄 |
| FR-8 | Signature énergétique : nuage kWh/jour × température extérieure, couleur par saison, régression, pente et seuil de non-chauffage | P1 | 1.1 | 🔄 |
| FR-9 | Calendrier thermique (une case par jour, une ligne par année) | P1, P2 | 1.1 | 🔄 |
| FR-10 | Cascade N-1 → N par pièce, en kWh et en € | P1, P2 | 1.1 | 🔄 |
| FR-11 | Carte verdict en € (normal / élevé / bas vs mois « normal » des années passées), avec icône et texte, pas seulement une couleur | P2, P3 | 1.1 | 🔄 |
| FR-12 | Projection de fin d'année et budget annuel | P2 | 1.1 | 🔄 |
| FR-13 | Profils horaires : carte jour de semaine × heure (données `1hour`, chargées à la demande) | P1 | 1.1 | 🔄 |
| FR-14 | Températures par pièce : mesurée et consigne, superposées à la consommation | P1, P3 | 1.1 | 🔄 |
| FR-15 | Rapport annuel imprimable (bilan, faits marquants, comparatif) | P1, P2 | 1.1 | 🔄 |
| FR-16 | Alerte par issue GitHub en cas d'échec de collecte, fermée au retour à la normale | P4 | 1.1 | ✅ |
| FR-17 | Synthèse mensuelle rédigée par l'IA, chiffrée comme le reste, chiffres calculés par le code | P1, P2 | 1.1 | 🔄 |
| FR-18 | Afficher « ce qui a été envoyé à l'IA » à côté de la synthèse | P1 (50) | 1.1 | ⏳ |
| FR-19 | Mode simple : verdict + 3 chiffres, grands caractères | P2, P3 | 1.2 | ⏳ |
| FR-20 | Résumé textuel et tableau alternatif pour chaque graphique | P3 | 1.2 | ⏳ |
| FR-21 | Commande `rekey` et indicateur de robustesse de la phrase de passe | P4 | 1.2 | ⏳ |
| FR-22 | Avertissement « données de plus de 3 jours » dans l'appli | P4 | 1.2 | ⏳ |
| FR-23 | Alertes d'anomalie déterministes (jour hors signature > 2σ, conso pendant une absence) | P1 | 1.2 | ⏳ |
| FR-24 | Surface des pièces, kWh/m², marqueur daté « travaux » avec signature avant / après | P1 | 1.3 | ⏳ |
| FR-25 | Simulateur de tarif (Base / HP-HC, Tempo à vérifier) sur les données horaires | P2 | 1.3 | ⏳ |
| FR-26 | Données locales en lecture seule (volets, capteurs intérieurs) affichées en corrélation, si E9 validé | P1 | 1.3 | ⏳ conditionnel |
| FR-27 | Chat IA dans l'appli avec la clé de l'utilisateur | P1 | 2 | ⏳ conditionnel |
| FR-28 | Dépôt modèle et assistant de configuration | — | 2 | ⏳ |
| FR-29 | Consommation Linky du foyer entier (via Conso API, optionnelle) pour situer chauffage + eau chaude dans le total | P1 | 1.1 | 🔄 (repéré dans `collector/enedis.py`) |

## 4. Exigences non fonctionnelles

| ID | Catégorie | Exigence | Vérification |
|---|---|---|---|
| NFR-1 | Sécurité | Tout fichier de `data/` hors `keyinfo.json` est chiffré AES-256-GCM, clé PBKDF2-SHA256 600 000 itérations ; aucun secret dans le dépôt ni dans le site | Test croisé Python ↔ TS ; scan de secrets en CI |
| NFR-2 | Vie privée | Le site ne contacte aucun tiers et n'envoie rien ; pas de télémétrie. Seule exception future : chat IA, sur action explicite, avec la clé de l'utilisateur | Revue CSP `connect-src` ; test Playwright interceptant les requêtes |
| NFR-3 | Vie privée IA | Seuls des agrégats (mensuels, par pièce, sans nom de personne) partent vers l'API Claude ; le contenu exact envoyé est archivé chiffré | Test unitaire du constructeur de prompt |
| NFR-4 | Performance | Premier graphique < 3 s sur téléphone d'entrée de gamme (CPU ×4 bridé) une fois la clé mémorisée ; JS initial < 400 Ko gzip (cible, à mesurer) | Playwright + budget de taille en CI |
| NFR-5 | Hors ligne | Consultation complète des données déjà chargées sans réseau ; date de dernière mise à jour visible | Test Playwright mode hors ligne |
| NFR-6 | Accessibilité | RGAA / WCAG 2.1 AA visés : contraste ≥ 4,5:1, zoom 200 % sans perte, information jamais codée par la seule couleur, navigation clavier et lecteur d'écran | axe-core en CI + revue manuelle VoiceOver / TalkBack |
| NFR-7 | Coût | 0 € hors IA ; IA plafonnée par un plafond de dépense dans la console Anthropic ; désactivée si le secret est absent | Facture mensuelle |
| NFR-8 | Robustesse API | ≤ 1 appel/s, respect de `Retry-After`, aucune donnée existante écrasée par une réponse vide | Tests sur API simulée |
| NFR-9 | Exactitude | Total mensuel chauffage = application officielle à 1 % près | Vérification manuelle trimestrielle |
| NFR-10 | Maintenabilité | Python et TS testés en CI ; dépendances suivies (Dependabot) ; décisions tracées en ADR | CI verte obligatoire |

## 5. Hors périmètre

| Sujet | Raison | Alternative |
|---|---|---|
| Pilotage des radiateurs, volets, lampes | Agent local permanent, écriture = risque, déjà couvert ailleurs | Application Intuis, Home Assistant |
| Serveur ou base de données hébergée | Contrainte zéro serveur | GitHub Actions + Pages |
| Multi-logements pour bailleur / syndic | Données personnelles de tiers, consentement | Aucune |
| Télémétrie d'usage | Vie privée | KPI déclaratifs |
| Détection d'anomalies ou prévisions par LLM | Statistiques simples plus fiables et testables | FR-23, FR-12 |

## 6. Plan de versions

| Version | Thème | Contenu | Critère de sortie |
|---|---|---|---|
| **v1.1** | Comprendre | FR-6 à FR-18 | Coût HP/HC recoupé avec une facture ; janvier recoupé avec l'appli officielle ; synthèse IA sans chiffre faux sur le premier mois |
| **v1.2** | Pour toute la famille, sans casse | FR-19 à FR-23 ; Playwright, Dependabot, branche `data` | axe-core sans erreur ; P3 lit le verdict sans aide ; `rekey` testé sur une copie |
| **v1.3** | Approfondir | FR-24, FR-25 ; FR-26 seulement si l'expérience « volets » (02 § 10) montre un effet | Décision go / no-go E9 documentée |
| **v2** | Diffuser | FR-27 si la synthèse est lue ≥ 2 mois sur 3 ; FR-28 ; stores (TWA / Capacitor) | Un second foyer installe seul avec le guide |
