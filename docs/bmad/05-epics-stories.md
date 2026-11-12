# 05 · Épopées et récits utilisateur (PO / Scrum Master)

Taille : **S** ≤ ½ jour · **M** 1-2 jours · **L** > 2 jours. Priorité MoSCoW : **M**ust, **S**hould,
**C**ould, **W**on't (pour l'instant). Statut : **Fait** · **En cours** · **À faire**. Le suivi vivant est
dans les [issues GitHub](https://github.com/Opaland/Netatmo/issues) (une par récit, voir `docs/PROJET.md`). Critères au format Given / When / Then, abrégés **G / Q / A** (Given, Quand, Alors).

## Vue d'ensemble

| Épopée | Objectif | Version | Statut global |
|---|---|---|---|
| E1 | Collecte fiable et observable | 1.0-1.5 | Fait ; suites de l'audit des données en v1.5 |
| E2 | Coût réel en euros | 1.1 | Fait (tarif réglementé EDF, open data CRE) |
| E3 | Météo, DJU, signature, station Netatmo complète | 1.1-1.2 | Fait / En cours |
| E4 | Visualisations « comprendre » | 1.1 | Fait |
| E5 | Synthèse IA | 1.1-2 | Fait / conditionnel |
| E6 | Rapport annuel | 1.1-1.4 | Fait |
| E7 | Accessibilité, performance, UX famille | 1.2-1.6 | Fait ; budget de taille en v1.5, design system en v1.6 |
| E8 | Sécurité et confidentialité | 1.2-2 | Fait ; branche `data` en v2 |
| E9 | Domotique : volets Wiser (étude), pont local, Home Assistant | 1.2-1.6 | Étude HA + Zigbee faite (no-go cet hiver) ; mesure des volets en v1.6 |
| E10 | Diffusion | 2 | À faire |
| E11 | Confort et santé de l'air (station Netatmo) | 1.3 | Fait |
| E12 | Partage et famille | 1.3-2 | Fait |
| E13 | Fenêtres ouvertes et états des radiateurs (`homestatus`) | 1.4-1.5 | Fait en v1.4 (relevé horaire à activer) ; anticipation et abaissement en v1.5 |

## E1 · Collecte fiable et observable

| ID | Récit | Critères d'acceptation | T | P | Statut |
|---|---|---|---|---|---|
| S-1.1 | En tant que propriétaire, je veux que la collecte combine `sum_energy_elec_heating`, `sum_energy_elec` et `$0/$1/$2`, afin d'avoir un historique continu depuis 2022 | G un jour où deux familles répondent · Q la collecte tourne · A la valeur gardée est la plus grande, jamais la somme | M | M | Fait |
| S-1.2 | En tant que propriétaire, je veux la consommation de l'Aqua Manager, afin de séparer le chauffe-eau | G un module NMW · Q la collecte tourne · A l'énergie vient de `home.modules` et la pièce est classée `water_heater` | S | M | Fait |
| S-1.3 | En tant que mainteneur, je veux une issue GitHub quand la collecte échoue, afin d'être prévenu par e-mail | G une collecte en échec · Q le job se termine · A une seule issue ouverte (commentée aux échecs suivants), fermée à la prochaine réussite | S | M | Fait |
| S-1.4 | En tant que mainteneur, je veux un résumé de job (jours collectés, méthode retenue, fichiers modifiés), afin de diagnostiquer sans relancer | G un job réussi · Q j'ouvre le run · A le `GITHUB_STEP_SUMMARY` liste ces éléments sans aucune donnée en clair | S | S | Fait (v1.2) |
| S-1.5 | En tant que membre du foyer, je veux voir « données de plus de 3 jours », afin de ne pas croire des chiffres périmés | G `last_day` < aujourd'hui − 3 · Q j'ouvre l'appli · A un bandeau texte + icône l'indique | S | S | Fait (v1.2) |
| S-1.7 | En tant que mainteneur, je veux l'état de chaque source (Intuis, Netatmo, Linky, IA) avec sa dernière réussite, afin de voir laquelle est en panne | G une source en échec · Q j'ouvre Paramètres ou le résumé de job · A date du dernier succès par source, sans valeur personnelle | M | S | Fait (v1.2) |
| S-1.8 | En tant que testeur, je veux des données de démo complètes (station, Tempo, contrats), afin de montrer toutes les vues | G le mode démo · Q je parcours l'appli · A chaque vue a des données | S | C | Fait (v1.3) |
| S-1.9 | En tant que mainteneur, je veux des tests Playwright sur la démo (5 vues, clair et sombre), afin d'éviter les régressions visuelles | G une PR · Q la CI tourne · A captures et absence d'erreur console vérifiées | M | S | Fait (v1.2) |
| S-1.6 | En tant que mainteneur, je veux Dependabot et des versions figées, afin d'éviter une casse silencieuse | G une dépendance vulnérable · Q Dependabot tourne · A une PR est ouverte et la CI la valide | S | S | Fait (v1.2) |

## E2 · Coût réel en euros

| ID | Récit | Critères d'acceptation | T | P | Statut |
|---|---|---|---|---|---|
| S-2.1 | En tant que propriétaire, je veux conserver `$1` et `$2` séparément, afin de calculer HP et HC | G une réponse avec `$1`/`$2` · Q la collecte tourne · A `tariffs[room][jour] = [Wh $0, Wh $1, Wh $2]` | M | M | Fait (v1.1) |
| S-2.2 | En tant que gestionnaire du budget, je veux le prix HP/HC et l'abonnement en vigueur chaque jour (tarif réglementé EDF, open data CRE, ou prix saisis), afin d'avoir un coût juste sur plusieurs années | G deux grilles de prix datées · Q j'affiche 2024 et 2025 · A chaque jour utilise la grille en vigueur ; l'abonnement est réparti au prorata | M | M | Fait (v1.1) |
| S-2.3 | En tant que gestionnaire du budget, je veux recouper le coût avec une facture, afin d'avoir confiance | G une facture réelle · Q je compare la période · A l'écart est expliqué (périmètre : chauffage + eau chaude seulement) | S | S | Fait, v1.4 (#11) |

## E3 · Météo, DJU et signature énergétique

| ID | Récit | Critères d'acceptation | T | P | Statut |
|---|---|---|---|---|---|
| S-3.1 | En tant que propriétaire, je veux la température extérieure quotidienne d'Open-Meteo, afin de calculer des DJU sans clé | G les coordonnées de la maison · Q la collecte tourne · A `weather.outdoor[jour] = [min, max, moy]`, les derniers jours complétés par la prévision | M | M | Fait (v1.1) |
| S-3.2 | En tant que météorologue amateur, je veux utiliser ma station Netatmo, afin d'avoir mes propres mesures | G les secrets Netatmo · Q la collecte tourne · A `source` = station, le jeton tourné est sauvegardé chiffré ; sans secret, repli Open-Meteo | M | S | Fait (v1.1) |
| S-3.3 | En tant qu'analyste, je veux les DJU (base 18 °C modifiable) et les kWh/DJU par saison, afin de comparer à climat égal | G deux saisons · Q j'ouvre la comparaison · A kWh/DJU affichés par saison et par pièce | S | M | Fait (v1.1) |
| S-2.7 | En tant que client EDF, je veux simuler une autre puissance souscrite et voir l'offre la moins chère sur 12 mois, afin d'ajuster mon contrat | G le pic Linky et le comparateur · Q je choisis 9 ou 12 kVA · A coût simulé par offre, avec avertissement si la puissance est sous le pic | M | S | Fait (v1.2) |
| S-2.8 | En tant que client, je veux que l'application déduise mes changements de puissance souscrite du Linky, afin de ne pas chercher la date | G la puissance max quotidienne · Q j'ouvre mon contrat · A le premier jour au-dessus de la puissance déclarée est proposé, avec la puissance standard suivante, et s'ajoute d'un clic | S | S | Fait (v1.2) |
| S-2.4 | En tant que client EDF, je veux décrire mon contrat période par période (offre, puissance : 9 puis 12 kVA), afin que chaque jour soit compté au bon tarif | G deux périodes · Q j'affiche le coût · A chaque jour utilise l'offre et la puissance en vigueur ; d'autres fournisseurs s'ajoutent par un fichier de tarifs | M | M | Fait (v1.2) |
| S-2.5 | En tant que client EDF, je veux savoir ce que m'auraient coûté Base, HP/HC et Tempo, afin de choisir la bonne offre | G l'historique et les couleurs Tempo · Q j'ouvre Comparer · A coût par offre et par année, mêmes jours, hypothèses affichées | M | S | Fait (v1.2) |
| S-2.6 | En tant que client, je veux voir ma puissance maximale appelée (Linky), afin de vérifier ma puissance souscrite | G le jeton Linky · Q j'ouvre la synthèse · A pic mensuel vs puissance souscrite, avec un avis | S | S | Fait (v1.2) |
| S-3.6 | En tant que parent, je veux une vue confort (seuils CO₂ et humidité, chambres masquées par défaut), afin de savoir quand aérer | G la station · Q j'ouvre la vue · A jours au-dessus de 1 000 ppm et d'humidité > 65 % signalés par module | M | S | Fait (v1.2) |
| S-3.5 | En tant que propriétaire de la station Netatmo, je veux l'historique de tous ses modules (salon, chambre des enfants, cave, extérieur : température, humidité, CO₂), afin de relier confort intérieur, météo et consommation | G les secrets Netatmo · Q la collecte tourne · A `station.enc.json` contient min / max / moyenne par module et par jour ; l'application affiche les courbes par module | M | S | En cours |
| S-3.4 | En tant que propriétaire, je veux la signature énergétique avec régression, afin de voir l'effet d'un réglage | G ≥ 30 jours de chauffe · Q j'ouvre la vue · A nuage coloré par saison, droite, pente et seuil de non-chauffage affichés | S | M | Fait (v1.1) |

## E4 · Visualisations « comprendre »

| ID | Récit | Critères d'acceptation | T | P | Statut |
|---|---|---|---|---|---|
| S-4.1 | En tant que membre du foyer, je veux une carte verdict en €, afin de savoir si le mois est normal | G ≥ 1 année passée · Q j'ouvre l'appli · A « Normal / Élevé / Bas » en texte + icône + couleur, écart en € vs moyenne des années passées | S | M | Fait (v1.1) |
| S-4.2 | En tant que propriétaire, je veux une cascade N-1 → N par pièce, afin de savoir qui explique l'écart | G deux années · Q j'ouvre la cascade · A la somme des barres = écart total, en kWh et en € | S | M | Fait (v1.1) |
| S-4.3 | En tant que propriétaire, je veux un calendrier thermique, afin de repérer froid et absences | G plusieurs années · Q j'ouvre la vue · A une ligne par année, une case par jour, valeur au toucher | S | S | Fait (v1.1) |
| S-4.4 | En tant que gestionnaire du budget, je veux une projection de fin d'année, afin d'anticiper | G l'année en cours · Q j'ouvre l'accueil · A projection en € avec méthode indiquée (rythme actuel × profil des années passées) | S | M | Fait (v1.1) |
| S-4.5 | En tant que télétravailleur, je veux un profil jour × heure, afin de voir le coût des journées à la maison | G des données `1hour` · Q j'ouvre les profils · A carte 7 × 24 chargée à la demande depuis `YYYY.hourly` | M | S | Fait (v1.1) |
| S-4.6 | En tant que membre frileux, je veux température mesurée et consigne par pièce, afin de juger le confort | G des `temps` · Q je choisis une pièce · A les deux courbes sur la conso ; consigne absente = trou, pas zéro | M | S | Fait (v1.1) |
| S-4.7 | En tant que propriétaire, je veux voir la part chauffage + eau chaude dans le Linky, afin de situer le reste du foyer | G `linky.enc.json` · Q j'ouvre la vue · A part en % par mois ; sans document, la vue est masquée | M | C | Fait (v1.1) |
| S-4.8 | En tant que propriétaire, je veux des alertes d'anomalie déterministes, afin de repérer une dérive | G un jour hors signature > 2σ · Q la collecte tourne · A le jour est marqué dans le calendrier, avec son écart | M | S | Fait (v1.2) |

## E5 · Synthèse IA

| ID | Récit | Critères d'acceptation | T | P | Statut |
|---|---|---|---|---|---|
| S-5.1 | En tant que membre du foyer, je veux une synthèse mensuelle rédigée, afin de comprendre sans lire les graphiques | G `ANTHROPIC_API_KEY` présent · Q le mois se termine · A `insights.enc.json` contient le texte, le modèle et la période ; sans secret, rien n'échoue | M | S | Fait (v1.1) |
| S-5.2 | En tant qu'ingénieur LLM, je veux que chaque nombre cité soit vérifié contre les faits calculés, afin d'éviter les hallucinations | G une réponse citant un nombre absent des faits · Q la vérification tourne · A une régénération, puis publication sans texte IA avec avertissement | S | M | Fait (v1.1) |
| S-5.3 | En tant que DPO, je veux voir exactement ce qui a été envoyé, afin de contrôler la minimisation | G une synthèse · Q je touche « Données envoyées » · A le JSON d'entrée s'affiche ; il ne contient ni coordonnées, ni identifiants, ni horaire | S | M | Fait (v1.1) |
| S-5.4 | En tant qu'utilisateur curieux, je veux poser des questions avec ma propre clé, afin d'explorer librement | G la synthèse lue ≥ 2 mois sur 3 (ADR-5) · Q j'active le chat · A clé en mémoire seulement, contexte affiché, désactivé par défaut | L | C | À faire (conditionnel) |
| S-5.5 | En tant que sceptique, je veux que l'IA ne détecte ni ne prévoie, afin de garder des chiffres testables | — | — | W | Décidé |

## E6 · Rapport annuel

| ID | Récit | Critères d'acceptation | T | P | Statut |
|---|---|---|---|---|---|
| S-6.1 | En tant que propriétaire, je veux un rapport annuel imprimable, afin de garder une trace et le partager | G une année complète · Q j'imprime (A4) · A bilan, faits marquants, comparatif N-1, sans contrôles d'interface, lisible en noir et blanc | M | S | Fait (v1.1) |
| S-6.3 | En tant que propriétaire, je veux le comparateur d'offres et le pic de puissance dans le rapport annuel, afin d'avoir le bilan complet | G une année · Q j'imprime | A les deux sections apparaissent | S | C | Fait (v1.3) |
| S-6.2 | En tant qu'auditeur, je veux saisir surfaces et marqueurs « travaux », afin de comparer avant / après | G un marqueur daté · Q j'ouvre la signature · A deux droites (avant / après) et kWh/m² | M | C | Fait, v1.4 (#15) |

## E7 · Accessibilité, performance, UX famille

| ID | Récit | Critères d'acceptation | T | P | Statut |
|---|---|---|---|---|---|
| S-7.1 | En tant que senior, je veux un mode simple, afin de lire sans effort | G le mode simple · Q j'ouvre l'appli · A verdict + 3 chiffres, police ≥ 16 px, lisible à 200 % de zoom | M | M | Fait (v1.2) |
| S-7.2 | En tant que personne malvoyante, je veux un résumé et un tableau par graphique, afin d'utiliser un lecteur d'écran | G VoiceOver ou TalkBack · Q je parcours un graphique · A un résumé textuel est lu ; un tableau équivalent est accessible | M | M | Fait (v1.2) |
| S-7.3 | En tant que personne daltonienne, je veux une palette sûre et des libellés, afin de distinguer HP/HC et les années | G simulation deutéranopie · Q j'affiche HP/HC · A les séries restent distinguables (motif ou libellé direct) | S | M | Fait (v1.2) |
| S-7.4 | En tant que possesseur d'un téléphone modeste, je veux un chargement < 3 s, afin de ne pas abandonner | G CPU bridé ×4, clé mémorisée · Q j'ouvre l'appli · A premier graphique < 3 s, squelette visible avant | M | S | Fait (v1.2) |
| S-7.5 | En tant que designer, je veux une feuille « Réglages du graphique », afin d'alléger l'écran | G l'écran Consommation sur mobile · Q j'ouvre les réglages · A période, granularité et détail sont dans la feuille | M | C | À faire |

## E8 · Sécurité et confidentialité

| ID | Récit | Critères d'acceptation | T | P | Statut |
|---|---|---|---|---|---|
| S-8.1 | En tant que propriétaire, je veux `rekey`, afin de changer de phrase de passe | G l'ancienne et la nouvelle phrase · Q je lance `python -m collector rekey` · A tous les `*.enc.json` et `keyinfo.json` sont rechiffrés ; `verify` donne les mêmes totaux | S | M | Fait (v1.2) |
| S-8.2 | En tant que RSSI, je veux un indicateur de robustesse, afin d'éviter une phrase faible | G une phrase de 2 mots · Q je la saisis à l'installation · A avertissement explicite (estimation d'entropie) | S | S | Fait (v1.2) |
| S-8.4 | En tant que propriétaire, je veux saisir mes identifiants dans l'application, afin de ne pas manipuler les secrets GitHub à la main | G un jeton GitHub limité (Secrets + Actions) · Q j'enregistre · A chaque valeur est chiffrée dans le navigateur (sealed box, clé publique du dépôt) puis écrite en secret ; le jeton n'est jamais stocké | M | M | Fait (v1.2) |
| S-8.5 | En tant que RSSI, je veux une CSP stricte et libsodium figé, chargé à la demande et testé, afin de limiter le risque d'un jeton dans la page | G la page publiée · Q un script tiers ou inline tente de s'exécuter · A il est bloqué ; seuls le site et api.github.com sont joignables | M | M | Fait (v1.2) |
| S-8.6 | En tant que propriétaire, je veux que les Paramètres refusent `DATA_PASSPHRASE`, afin de ne pas rendre l'archive illisible | G une tentative d'écriture · Q j'enregistre · A refus explicite, renvoi vers `rekey` | S | M | Fait (v1.2) |
| S-8.7 | (réservé) | — | — | — | — |
| S-8.8 | En tant que personne soucieuse de sa vie privée, je veux une page « ce qui est public / ce qui part chez des tiers », afin de décider en connaissance de cause | G la page Paramètres · Q je l'ouvre · A liste des données publiques (chiffrées), des tiers (Intuis, Netatmo, Enedis via Conso API, Open-Meteo, Anthropic, api-couleur-tempo) et de ce qui leur est envoyé | S | S | Fait (v1.2) |
| S-8.3 | En tant que mainteneur, je veux les données dans une branche `data`, afin de garder `main` lisible | G la collecte · Q elle commit · A `main` ne reçoit plus de commits de données ; le déploiement lit la branche `data` | M | C | Livré (#23) : passage par le propriétaire |

## E9 · Pont local en lecture seule (conditionnel)

| ID | Récit | Critères d'acceptation | T | P | Statut |
|---|---|---|---|---|---|
| S-9.0 | En tant que propriétaire, je veux mesurer l'effet des volets avant de construire, afin de ne pas coder pour rien | G 4 semaines d'hiver avec heures de fermeture notées · Q je compare la conso nocturne à la signature · A décision go / no-go écrite dans l'ADR-7 | S | S | À faire |
| S-9.1 | En tant que propriétaire du NAS, je veux un conteneur pont qui pousse `local-YYYY.enc.json`, afin d'archiver volets et capteurs | G le go de S-9.0 · Q le pont tourne 24 h · A un fichier chiffré, agrégats quotidiens seulement, poussé avant 04:00 UTC, sans port entrant | L | C | À faire |
| S-9.2 | En tant que propriétaire, je veux voir l'effet des volets dans la signature, afin de décider de mes habitudes | G ≥ 30 jours de données locales · Q j'ouvre l'analyse · A effet estimé avec incertitude, ou « effet non significatif » | M | C | À faire |
| S-9.4 | En tant que propriétaire, je veux savoir s'il est utile de piloter les volets Wiser selon la température ou la consommation, afin de ne construire que si c'est rentable | G l'étude `docs/etudes/volets-wiser.md` · Q elle est lue · A décision go / no-go argumentée et chiffrée | S | S | Fait : no-go passerelle (`docs/etudes/volets-wiser.md`) |
| S-9.5 | En tant que propriétaire, je veux connaître la part de consommation des volets, afin de savoir si elle compte | G l'étude · Q elle est lue · A ordre de grandeur en kWh/an comparé au chauffage | S | C | Fait : ≈ 35-95 kWh/an, pas de suivi continu |
| S-9.3 | En tant que passionné, je veux piloter volets et Hue depuis l'appli | — | — | W | Décidé (ADR-6) |

## E10 · Diffusion

| ID | Récit | Critères d'acceptation | T | P | Statut |
|---|---|---|---|---|---|
| S-10.1 | En tant que possesseur d'Intuitiv, je veux un dépôt modèle et un guide, afin d'installer seul | G un compte GitHub vierge · Q je suis le guide · A données visibles en < 30 min sans aide | M | C | À faire |
| S-10.3 | En tant que nouvel utilisateur, je veux un assistant de premier lancement dans Paramètres, afin d'installer sans lire le README | G un dépôt vierge · Q je suis l'assistant · A secrets, Pages et première collecte faits depuis l'application | L | C | À faire |
| S-10.2 | En tant qu'utilisateur, je veux l'appli sur les stores, afin de l'installer comme les autres | G la PWA · Q je l'emballe (TWA / Capacitor) · A publication acceptée | L | W | À faire |

## Backlog v1.3 (revue de cadrage, 52 personas)

Les 49 récits proposés par la revue de cadrage sont décrits dans
[`revues/v1.3-cadrage.md`](revues/v1.3-cadrage.md) et suivis en issues GitHub (une par récit, jalon v1.3 ou v2).
S-2.9 (comparateur sur le total Linky) était déjà livré en v1.2 : le comparateur utilise le Linky dès qu'il
est disponible.

## Backlog v1.4 (cadrage, 62 personas)

Les 17 récits nouveaux, avec leurs critères, sont décrits dans
[`revues/v1.4-cadrage.md`](revues/v1.4-cadrage.md) et suivis en issues (jalon v1.4). La v1.3 est jugée
dans [`revues/v1.3.md`](revues/v1.3.md).

### E13 · Fenêtres ouvertes et états des radiateurs

Le diagnostic de #162 a confirmé que `homestatus` expose, **en instantané**, `open_window`, `presence`,
`boost_status`, `therm_setpoint_mode` (pièces) et `radiator_state`, `offload`, `contactor_mode` (modules).

| ID | Récit (abrégé) | T | P | Statut |
|---|---|---|---|---|
| S-13.1 | Chercher un historique déjà servi par `getroommeasure` (étude) | S | M | Fait, v1.4 (#172) |
| S-13.2 | Relevé horaire léger de `homestatus`, agrégé chaque nuit, sans commit horaire | M | M | Fait, v1.4 (#173) |
| S-13.3 | Heures de fenêtre ouverte par pièce et leur effet (pièce froide, jours inhabituels, signature) | M | S | Fait, v1.4 (#174) |
| S-13.4 | Boost et mode de consigne par pièce | S | C | Fait, v1.4 (#175) |
| S-13.5 | Minimiser les données d'occupation (présence jamais conservée) | S | M | Fait, v1.4 (#176) |
| S-13.6 | Délestage et contacteur | S | C | Fait, v1.4 (#177) |

### Autres récits v1.4

| ID | Épopée | Récit (abrégé) | T | P | Issue |
|---|---|---|---|---|---|
| S-1.16 | E1 | Revues par agents (code et design) à chaque version | M | S → M au cadrage | #157 |
| S-1.17 | E1 | Prises Shelly via le Shelly Cloud | M | S | #158 |
| S-1.18 | E1 | Importer des statistiques Home Assistant chiffrées | M | C | #178 |
| S-2.14 | E2 | Simuler la recharge d'une voiture électrique | S | C | #181 |
| S-2.15 | E2 | Estimer le chauffage avec une pompe à chaleur | M | C | #182 |
| S-3.10 | E3 | Étude : emplacement du module intérieur libre de la station | S | C | #180 |
| S-5.10 | E5 | Fenêtres ouvertes et boost dans les faits de l'analyse IA | S | C | #188 |
| S-6.6 | E6 | Export de recherche anonymisé | S | C | #187 |
| S-7.13 | E7 | Mode simple en langage clair (FALC) | S | S | #183 |
| S-7.14 | E7 | Inventaire des composants, couleurs, typographies (entrée de la v1.6) | S | C | #184 |
| S-9.9 | E9 | Étude : Home Assistant et Zigbee au service de l'archive | S | S | #179 |
| S-12.5 | E12 | Alerte « froid prolongé » dans une pièce de vie | M | S | #185 |
| S-12.6 | E12 | Utiliser l'application en locataire | S | C | #186 |

Repris des versions précédentes dans le jalon v1.4 : S-2.3, S-4.12, S-6.2, S-7.9, S-8.3, S-9.0 à S-9.2,
S-12.3. S-7.5 passe en v1.6 (design system).

**Bilan (fin de v1.4)** : tous les récits ci-dessus sont livrés, ainsi que S-2.3, S-4.12, S-6.2, S-7.9,
S-12.3 et S-1.19 (audit des données). S-9.0 et S-9.2 passent en v1.6, S-8.3 et S-9.1 en v2. Revue :
[`revues/v1.4.md`](revues/v1.4.md).

## Backlog v1.5 (qualité du code et suites de l'audit des données)

Détail et ordre dans [`revues/v1.5-cadrage.md`](revues/v1.5-cadrage.md). Les constats de la revue de
code complète sont des issues `revue-code` du jalon v1.5.

| ID | Épopée | Récit (abrégé) | Issue |
|---|---|---|---|
| S-1.26 | E1 | Énergie et températures des pièces au pas 30 min, sur 4 ans | #224 |
| S-1.23 | E1 | Température et consigne horaires des pièces (recouvert par S-1.26) | #217 |
| S-1.20 | E1 | Radiateur ou chauffe-eau qui ne répond plus | #214 |
| S-13.8 | E13 | Heures d'anticipation et d'abaissement par pièce | #218 |
| S-1.21 | E1 | Piles et signal radio des modules de la station | #215 |
| S-1.22 | E1 | Mises à jour de firmware | #216 |
| S-1.25 | E1 | Heure du pic de puissance Linky | #219 |
| — | E7 | Budget de taille honnête | #227 |
| — | E8 | Cadre juridique : Shelly Cloud et Home Assistant | #228 |
