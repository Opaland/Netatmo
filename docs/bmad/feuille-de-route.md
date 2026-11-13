# Feuille de route après la v1.7

*Décidée par le propriétaire le 12 novembre 2026, à la clôture de la v1.7
([revue de fin](revues/v1.7.md), § 11). Les jalons GitHub portent le détail ; ce fichier dit l'ordre et
la règle de passage. Les feuilles de route précédentes : [`PROJET.md`](../PROJET.md) § 9 (v1.4 à v1.6)
et [`feuille-de-route.md`](../feuille-de-route.md) (revue à 6 personas, novembre 2026).*

## Versions

| Version | Nature | Contenu |
|---|---|---|
| **v1.8** | Le bois et les réglages | Le bois partout où l'on juge l'isolation ; les réglages chiffrés ; l'ergonomie de ⚙ Mon logement ; les degrés-jours ; le stock de bois ; les heures creuses datées ; le bilan qualité |
| **v1.9** | Sécurité et méthode | Argon2id (#139) ; paliers de taille (#138) ; ensoleillement (#117) ; repère kWh/m² (#127) ; objectif à climat égal (#152) ; rapport anonyme (#144) |
| **v2.0** | Ouverture | Dépôt modèle (#29) ; assistant (#40) ; origine dédiée et transfert vers l'organisation (#229) ; branche `data` (#23) ; copie sur le NAS (#143) ; pont (#25) ; clé IA (#14) |
| **v2.1** | Maison connectée | Plan de la maison (#202) ; Livebox (#282) ; NAS (#283) ; CPL (#284) ; TIC du Linky (#285) |
| **v2.2** | Audit des données | Toutes les données reprises et vérifiées : bonnes dates, bonnes valeurs, trous et chevauchements (#532, demande du propriétaire du 12/11/2026) |
| **v2.3** | Fiabilité et suites des revues | Lancée par le propriétaire le 13/11/2026, contenu cadré dans [`revues/v2.3-cadrage.md`](revues/v2.3-cadrage.md) : marge de l'Historique (#553) et de l'Accueil (#554) sans retirer d'information ; premier écran sous 50 % du budget (#555) ; mesure des hauteurs dans le dépôt (#556) ; suites de la revue v2.2 (#550) |
| **v2.4** | Données manquantes ou mal affichées | Lancée par le propriétaire le 13/11/2026 (« traiter le problème de data manquantes ou mal affichées, vérification complète »), jalon 14, **sans document de cadrage** : son contenu vient du **premier bilan réel**, le journal public du run Diagnostic `43418619021` (« Bilan qualité et audit des données », nombres par contrôle et par mois seulement). Quatre issues en sortent : 59 648 « pics impossibles » (#567) ; 77 jours dont les heures ne font pas le jour (#568) ; les jours manquants encore récupérables et un rattrapage qui n'écrase rien (#569) ; l'affichage face aux trous réels, jamais 0, totaux « incomplet » (#570). Revue de fin : [`revues/v2.4.md`](revues/v2.4.md) |
| **v2.5** | Ce que l'appli dit, exactement | Lancée par le propriétaire le 13/11/2026 (« Lance une 2.4 2.5 2.6 2.7 2.8 2.9 3.0 »), jalon 15, contenu cadré dans [`revues/v2.5-cadrage.md`](revues/v2.5-cadrage.md) : attentes annoncées au lecteur d'écran (#579) ; un seul compte de jours manquants dans Année par année (#580) ; « redemandé » par pièce (#581) ; « ancienne lecture » de la courbe seulement si elle est vraie (#582) ; captures refusées hors de la police de la CI (#583) |
| **v2.6** | Accessibilité et gestes, en WebKit aussi | Lancée par le propriétaire le 13/11/2026 (« 2.4 2.5 2.6 2.7 2.8 2.9 3.0 »), jalon 16, contenu cadré dans [`revues/v2.6-cadrage.md`](revues/v2.6-cadrage.md) : toute attente dite par la règle unique (#593) ; au clavier seul, le focus visible et jamais caché (#594) ; le balayage en WebKit (#595) ; les parcours e2e en WebKit dans la CI (#596) ; le plan pendant un glisser (#597) |
| **v2.7 à v3.0** | Thèmes proposés | Voir ci-dessous : une proposition, revue à chaque cadrage, pas un engagement |
| **Matériel (attend le propriétaire)** | Jalon sans date | #200, #24, #26, #281, #349, #350 : ils demandent un matériel ou un relevé que seul le propriétaire peut poser |

## Thèmes proposés de la v2.7 à la v3.0

*Écrits au cadrage de la v2.5 (13/11/2026) pour que l'enchaînement demandé par le propriétaire
(« Lance une 2.4 2.5 2.6 2.7 2.8 2.9 3.0 ») ait un fil. **Une proposition, pas un engagement** : chaque
cadrage la relit et peut changer le thème de sa version, et ce que montreront les gestes du
propriétaire (bilan réel, rattrapage, revue v2.4 § 9) passe avant, comme en v2.4. Même règle de choix
que les cadrages v2.3 et v2.5 : au plus cinq stories, aucune décision du propriétaire, aucun matériel ;
chaque thème part d'un chiffre que la revue précédente a mesuré. **Relu au cadrage de la v2.6
(13/11/2026)** : le thème de la v2.6 a tenu (précisé par deux sondes, [cadrage](revues/v2.6-cadrage.md)
§ 1) et sa ligne est passée dans le tableau des versions ; les constats restants de #590 sont rangés
en v2.8 et v2.9.*

| Version | Thème proposé | Raison (mesurée au 13/11/2026, `main` `0b37132`) | Personas visés |
|---|---|---|---|
| **v2.7** | **Robustesse des tests : mutation et entrées non sûres** | La mutation (`stryker.config.json`) ne vise que **6 fichiers** depuis le 10/11 (`money`, `pricing`, `periods`, `invoice`, `reconstitute`, `crypto`) : les modules des v2.2 à v2.4 (`data-quality.ts`, 962 lignes ; `room-offline.ts` ; `curve.ts`) n'ont jamais été mutés, et le collecteur (`audit.py`, 1 622 lignes ; `rattrapage.py`) n'a pas d'outil de mutation (en ajouter un est une dépendance : une proposition) ; message de la garde de taille (#564 n° 4) | 36, 70, 34, 46 |
| **v2.8** | **Dette de code : une règle, un endroit** | Les plus gros fichiers : `collector/audit.py` 1 622 lignes, `web/src/charts.ts` 1 382, `collector/__main__.py` 1 234, `collector/demo.py` 1 120, `data-quality.ts` 962, `collector/diagnose.py` 940 ; le cadrage v2.5 a trouvé **quatre recopies** du motif de `lazyView` dans `pages.ts` (#579) : une chasse aux règles jumelles (AGENTS.md § 5) sur tout le dépôt, découpages sans changement de comportement ; l'accord d'Année par année quand deux usages manquent (`incompleteText`, #590 n° 3) | 34, 39, 35 |
| **v2.9** | **Documentation et reprise** | `docs/bmad/00-index.md` ne citait les revues que jusqu'à la v2.1 dans sa liste des dossiers (corrigé par la revue de fin de v2.5) ; CONTRIBUTING ne cite qu'une partie des 20 scripts e2e que la CI lance (revue v2.4 § 6 n° 8) ; un repreneur doit pouvoir relancer chaque mesure d'une revue depuis le dépôt seul ; le conseil de la garde des captures n'aide pas un poste sans DejaVu Sans ni `fc-match` (#590 n° 2) | 39, 35, 34, 51 |
| **v3.0** | **Consolidation** | Aucune fonction nouvelle : revue de code **complète** (tout le code, pas le diff, comme la v1.5) et revue design **complète** (toutes les vues, mobile et bureau, clair, sombre, contraste élevé, Chromium et WebKit, comme la v1.6) ; chaque constat corrigé ou tracé ; **un seul tableau** des décisions ouvertes (D1 à la dernière), avec leur état et ce qu'elles débloquent, pour que le propriétaire tranche en une fois ; mesures de fin (hauteurs, taille, mutation, balayage) écrites comme référence de la suite | les 72 |

**Ce qui dépend d'une décision du propriétaire ou d'un matériel**, listé ici sans être planifié (aucune
version ne le prend tant que la condition n'est pas levée) :

- **Décisions** : Air et confort (D29, #498) ; chauffe-eau thermodynamique (D28, #502) ; plan : CO₂ et
  image de fond (D48, D49, #202) ; clé IA (D41, #14) ; « Comparer » et sa maquette (D65, #564 n° 3) ;
  objectif de la garde de taille (D64) ; données : D70 à D75, dont la reprise de la courbe (D71) ;
  réglages en secrets et anciens journaux (D76, D77) ; formes de la v2.5 : courbe, Année par année, captures hors de la police en CI (D78 à D80) ; origine dédiée (D39, #229) ; signalement privé
  (D11, #364) ; les décisions plus anciennes listées par les revues (D1 à D69).
- **Gestes sur son compte** : bilan, inventaire, rattrapage, second bilan, profondeur d'historique
  (revue v2.4 § 9) ; leurs résultats peuvent ouvrir des issues qui passent avant le thème prévu.
- **Matériel ou pont** : le jalon « Matériel (attend le propriétaire) » (volets #200, #24, #26 ; pont
  #25 ; NAS #143, #283 ; pinces #281, #350 ; tableaux #349 ; Livebox #282 ; CPL #284 ; TIC #285 ;
  modèle et assistant #29, #40 ; Argon2id #139).

## Règle de passage d'une version à la suivante

Demandée par le propriétaire le 12/11/2026.

1. À la fin de chaque version, deux revues sont **obligatoires** :
   - une **revue par personas**, les 72, sur le modèle de [`revues/v1.7.md`](revues/v1.7.md) ;
   - une **revue design** des écrans nouveaux ou changés.

   Le tableau des hauteurs d'écran de la revue et les marges sous les limites se mesurent par
   `npm run e2e:hauteurs` (dans `web/`, après `npm run build`, #556), pas par un script hors dépôt.
2. Leurs **défauts bloquants sont corrigés avant la clôture**.
3. La version suivante **démarre sans attendre une validation explicite** du propriétaire.
4. Le propriétaire reste **décideur** des choix de produit, de design et d'architecture. La revue les
   liste avec leurs pistes ; ils ne bloquent pas l'enchaînement.

Les critères d'une version livrée restent ceux de [`PROJET.md`](../PROJET.md) § 4 et § 6.
