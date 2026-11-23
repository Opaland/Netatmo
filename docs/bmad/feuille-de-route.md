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
| **v2.7** | Robustesse des tests : la mutation là où elle n'est jamais passée | Lancée par le propriétaire le 13/11/2026 (« 2.4 2.5 2.6 2.7 2.8 2.9 3.0 »), jalon 17, contenu cadré dans [`revues/v2.7-cadrage.md`](revues/v2.7-cadrage.md) : l'estimation d'une pièce hors ligne (#621, `room-offline.ts` 77,6 %) ; la courbe Linky (#622, `curve.ts` 76,0 %) ; le verdict de chaque année et les trous d'État des données (#623, `data-quality.ts` 66,1 %) ; la mutation du collecteur sans dépendance (#624, `audit.py` 60,3 %) ; un texte coupé dans un graphique en lignes HTML vu par le balayage (#625) |
| **v2.8** | Dette de code : une règle, un endroit | Lancée par le propriétaire le 13/11/2026 (« 2.4 2.5 2.6 2.7 2.8 2.9 3.0 »), jalon 18, contenu cadré dans [`revues/v2.8-cadrage.md`](revues/v2.8-cadrage.md) : le code de chiffrement tenu par ses tests (#637, `crypto.ts` 77,6 %) ; « à climat égal », une seule règle au lieu de six (#638) ; « Recharger l'application » rend toujours la main (#639, #615 n° 1 et 2) ; les gardes comptent ce qu'elles écartent (#640, #634 n° 1 à 3, #564 n° 4) ; `collector/__main__.py` découpé (#641) |
| **v2.9** | Documentation et reprise | Lancée par le propriétaire le 13/11/2026 (« 2.4 2.5 2.6 2.7 2.8 2.9 3.0 »), jalon 19, contenu cadré dans [`revues/v2.9-cadrage.md`](revues/v2.9-cadrage.md) : CONTRIBUTING cite les 20 scripts e2e de la CI, tenus d'accord par un test (#652) ; la CI bornée et ses durées relevées par une commande du dépôt (#653, #649 n° 6, #615 n° 4, #634 n° 5) ; le balayage dit pourquoi une ouverture échoue (#654, #648) ; les outils du contributeur disent ce qui est vrai sur son poste (#655, #590 n° 2, #634 n° 4) ; un plan pour découper `audit.py` et `charts.ts`, puis le catalogue d'`audit.py` dans son module (#656) |
| **v3.0** | Consolidation | Lancée par le propriétaire le 13/11/2026 (« 2.4 2.5 2.6 2.7 2.8 2.9 3.0 »), jalon 20, contenu cadré dans [`revues/v3.0-cadrage.md`](revues/v3.0-cadrage.md), **aucune fonction nouvelle** : un total incomplet d'Année par année accordé (#676, #590 n° 3) ; « écart en % » par la seule règle `pctChange` (#677, #649 n° 3) ; la mutation des quatre modules de calcul jamais mutés (#678 : `analysis.ts` 58,2 %, `aggregate.ts` 71,7 %) et de la couverture par source de `data-quality.ts` (#679) ; un seul tableau des décisions D1 à D97 (#680). La revue de code complète, la revue design complète et les mesures de fin sont **sa revue de fin** (cadrage § 2) |
| **Après la v3.0** | Aucune version demandée | Pistes à décider par le propriétaire, sans planification ([cadrage](revues/v3.0-cadrage.md) § 7) : trancher le tableau des décisions puis appliquer ; les preuves humaines d'abord ; le jalon « Matériel » ; une pause |
| **Matériel (attend le propriétaire)** | Jalon sans date | #200, #24, #26, #281, #349, #350 : ils demandent un matériel ou un relevé que seul le propriétaire peut poser |

## Thèmes proposés (le dernier : la v3.0, cadrée le 23/11/2026)

*Écrits au cadrage de la v2.5 (13/11/2026) pour que l'enchaînement demandé par le propriétaire
(« Lance une 2.4 2.5 2.6 2.7 2.8 2.9 3.0 ») ait un fil. **Une proposition, pas un engagement** : chaque
cadrage la relit et peut changer le thème de sa version, et ce que montreront les gestes du
propriétaire (bilan réel, rattrapage, revue v2.4 § 9) passe avant, comme en v2.4. Même règle de choix
que les cadrages v2.3 et v2.5 : au plus cinq stories, aucune décision du propriétaire, aucun matériel ;
chaque thème part d'un chiffre que la revue précédente a mesuré. **Relu au cadrage de la v2.6
(13/11/2026)** : le thème de la v2.6 a tenu (précisé par deux sondes, [cadrage](revues/v2.6-cadrage.md)
§ 1) et sa ligne est passée dans le tableau des versions ; les constats restants de #590 sont rangés
en v2.8 et v2.9. **Relu au cadrage de la v2.7 (16/11/2026)** : le thème de la v2.7 a tenu, mesuré
fichier par fichier ([cadrage](revues/v2.7-cadrage.md) § 2 : trois modules entre 66 et 78 %, l'audit
du collecteur à 60 % par une sonde sans dépendance) ; « entrées non sûres » n'a rien donné de neuf (le
fuzz a suivi les lecteurs ajoutés) et cède la place à une garde aveugle du balayage (#615 n° 3) ; le
message de la garde de taille (#564 n° 4) et les autres constats de #615 passent en v2.8 et v2.9. **Relu au cadrage de la v2.8 (18/11/2026)** : le thème de la v2.8 a tenu, révisé par deux faits ([cadrage](revues/v2.8-cadrage.md) § 2) : `crypto.ts` redescendu à 77,6 % (#633, la seule réserve de la revue v2.7) passe en tête, et les gardes de tests trouvées par la revue de code v2.7 (#634 n° 1 à 3) rejoignent le message de la garde de taille ; sa ligne est passée dans le tableau des versions. Les découpages d'`audit.py` et de `charts.ts`, qui demandent un plan, passent en v2.9 ; `incompleteText` (#590 n° 3) en v3.0. **Relu au cadrage de la v2.9 (19/11/2026)** : le thème de la v2.9 a tenu, révisé par un fait ([cadrage](revues/v2.9-cadrage.md) § 2) : le balayage de la démo publiée qui échoue à l'ouverture sans dire pourquoi (#648) y entre, sans nouvel essai ; « relancer chaque mesure d'une revue » se réduit, mesuré, aux durées de la CI (les autres mesures ont leur commande) ; le job qui fait attendre une PR est `e2e`, plus WebKit. Sa ligne est passée dans le tableau des versions. Les restes de `reloadApp` (#649 n° 2), l'effacement de la sortie d'Argon2id (#649 n° 5), les « écarts en % » à la main (#649 n° 3) et les quatre arrêts du clavier WebKit (#649 n° 7) passent en v3.0. **Relu au cadrage de la v3.0 (23/11/2026)** : le thème a tenu, révisé par trois faits ([cadrage](revues/v3.0-cadrage.md) § 3) : les attentes en minuscule, le double dessin d'une vue (#590 n° 1 et 4) et les noms du plan pendant un glisser (#564 n° 2) étaient **déjà faits** en v2.6 (#601, #603) ; la vague de mutation mesure `analysis.ts` à 58,2 % et `aggregate.ts` à 71,7 %, les deux plus bas du dépôt ; la revue de code complète, la revue design complète et les mesures de fin sont la revue de fin de la v3.0, pas des stories. Sa ligne est passée dans le tableau des versions. La v3.0 étant la dernière version demandée, aucun thème n'est plus proposé ici : ce qui pourrait suivre est au § 7 du cadrage, à décider par le propriétaire.*

| Version | Thème proposé | Raison (mesurée au 13/11/2026, `main` `0b37132`) | Personas visés |
|---|---|---|---|
| **v3.0** | **Consolidation** | Aucune fonction nouvelle : revue de code **complète** (tout le code, pas le diff, comme la v1.5) et revue design **complète** (toutes les vues, mobile et bureau, clair, sombre, contraste élevé, Chromium et WebKit, comme la v1.6) ; chaque constat corrigé ou tracé ; **un seul tableau** des décisions ouvertes (D1 à la dernière), avec leur état et ce qu'elles débloquent, pour que le propriétaire tranche en une fois ; mesures de fin (hauteurs, taille, mutation, balayage) écrites comme référence de la suite ; **ajouté au cadrage de la v2.7** : une vague de mutation sur les modules de calcul encore jamais mutés (`aggregate.ts`, `offpeak.ts`, `wood.ts`, `analysis.ts`) et sur la couverture par source de `data-quality.ts` ; **ajouté au cadrage de la v2.8** : l'accord d'Année par année quand deux usages manquent (`incompleteText`, #590 n° 3), les attentes en minuscule et le double dessin d'une vue (#590 n° 1 et 4), les noms du plan pendant un glisser (#564 n° 2) ; **ajouté au cadrage de la v2.9** : les « écarts en % » écrits à la main (#649 n° 3), les deux restes de `reloadApp` et l'effacement de la sortie d'Argon2id dans la revue de code complète (#649 n° 2 et 5), les quatre arrêts du clavier WebKit lus avec les mesures de fin (#649 n° 7), le découpage de la classe `Audit` et de `charts.ts` une fois D94 tranchée | les 72 |

**Ce qui dépend d'une décision du propriétaire ou d'un matériel**, listé ici sans être planifié (aucune
version ne le prend tant que la condition n'est pas levée) :

- **Décisions** : Air et confort (D29, #498) ; chauffe-eau thermodynamique (D28, #502) ; plan : CO₂ et
  image de fond (D48, D49, #202) ; clé IA (D41, #14) ; « Comparer » et sa maquette (D65, #564 n° 3) ;
  objectif de la garde de taille (D64) ; données : D70 à D75, dont la reprise de la courbe (D71) ;
  réglages en secrets et anciens journaux (D76, D77) ; formes de la v2.5 : courbe, Année par année, captures hors de la police en CI (D78 à D80) ; formes de la v2.6 : tableaux de champs, « Pièces affichées », attente dans un résumé, hauteurs et parcours WebKit (D81 à D85) ; outil de mutation du collecteur, vague suivante, pointe à égalité, ordre de deux trous (D86 à D89) ; degrés-jours de « à climat égal » (D90) ; premier écran + 0,24 kB, code négatif de l'outil de mutation, repli vers un second hôte d'Intuis (D91 à D93) ; forme du découpage d'`audit.py` et de `charts.ts`, rééquilibrage des jobs e2e (D94, D95) ; captures sur macOS, bandeau hors ligne recréé à chaque rendu (D96, D97) ; toutes rassemblées en un tableau par la v3.0 (#680) ; origine dédiée (D39, #229) ; signalement privé
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
