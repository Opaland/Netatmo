# Historique des versions

## v2.2 — novembre 2026 : audit des données (en cours)

Toutes les données reprises et vérifiées : bonnes dates, bonnes valeurs, trous et chevauchements
([feuille de route](docs/bmad/feuille-de-route.md), #532, demande du propriétaire du 12/11/2026), plus
les finitions de la revue de fin de v2.1 (#541) et la préférence « tableaux ouverts » (#546). Revue de
fin de version par les **72 personas**, revue design des écrans nouveaux ou changés et revue de code
par agent : [`docs/bmad/revues/v2.2.md`](docs/bmad/revues/v2.2.md). Le premier rapport sur les vraies
données est un geste du propriétaire ; les seuils marqués « hypothèse » s'y confirment (revue, § 9 et
§ 10).

- **Audit des données** (#532)
  - Dates et chevauchements (#545) : `collector/audit.py`, lancé par le workflow **Diagnostic** (case
    « Bilan qualité et audit des données »), lit toutes les séries datées sans aucun appel d'API ni
    aucune écriture : dates impossibles, même instant écrit deux fois, jour rangé dans le fichier d'une
    autre année ou dans deux fichiers, heure sautée au passage à l'heure d'été, heures décalées, Intuis
    et Linky décalés, jour estimé qui a des heures mesurées, tarifs additionnés, même énergie mesurée
    par deux sources. Le journal public ne montre que des nombres par contrôle et par mois ; le détail
    est un artefact chiffré avec la clé des données (7 jours), ouvert dans État des données → Année par
    année → « Audit détaillé des données », vérifié champ par champ et gardé scellé sur l'appareil.
  - Un jour présent dans deux fichiers d'année n'est plus additionné par l'appli : une seule valeur,
    celle du fichier de son année, pour l'énergie, les tarifs et les températures, comme le bilan
    qualité (#545).
  - Les valeurs (#547) : heures qui ne font pas le jour, radiateurs au-dessus du compteur, énergie
    impossible, unité (mille fois trop petite ou trop grande), valeur figée, pic au-delà du maximum du
    Linky, index du compteur qui recule ; chaque seuil nommé une fois, avec sa raison, « hypothèse »
    quand il reste à confirmer.
  - Les trous (#548) : deux causes de plus (collecte Intuis en échec, collecte arrêtée), qui rendent le
    trou récupérable chez Intuis ; sous chaque trou, « Dans l'appli : … » dit ce qu'en fait l'appli ;
    une propriété à graine fixe prouve qu'un jour reconstitué ne s'ajoute jamais à un jour mesuré.
- **Finitions du plan de la maison** (#541, #544) : une seule règle pour couper un nom (entre
  graphèmes, avec « … ») ; un plan trop grand pour un secret refusé avant tout envoi ; libellés de
  taille à jour ; une pièce non liée nommée « Chambre … » dite « Chambres » en vue foyer ; les mots du
  dessin au moins à la taille du plus petit texte et suivant le 200 % (les lettres des appareils
  deviennent des points quand elles couvriraient les cases voisines), mesurés par le balayage ; la
  liste des appareils repliée dans ⚙ Mon logement (8,4 → 7,8 écrans) ; une phrase quand des pièces ne
  sont liées à aucune pièce Intuis.
- **Préférence « tableaux ouverts »** (#546, #549) : seuls les replis « Voir les valeurs » la suivent ;
  ouvrir « Comment c'est calculé » n'ouvre plus les tableaux des autres écrans. Le repli de délestage du
  Compteur la suit désormais (décision du propriétaire à confirmer, revue § 10, D59).
- **Revue de fin de version** (revue, § 6 et § 12) : un trou n'est plus dit « collecte Intuis en échec,
  récupérable » quand une nuit réussie a redemandé ses jours ; la démo est cohérente avec l'audit (les
  heures font le jour, plus d'heure sautée au printemps : 107 cas → 1) ; l'audit détaillé dit qu'il
  vérifie aussi les valeurs ; README, SECURITY.md, PROJET.md et l'architecture à jour ; captures de
  référence régénérées dans la police de la CI (DejaVu Sans).

## v2.1 — novembre 2026 : maison connectée

Plan de la maison ([feuille de route](docs/bmad/feuille-de-route.md)), plus les finitions de la revue
de fin de v2.0 (#533). Livebox, NAS, CPL et TIC du Linky (#282 à #285) sont rangées au jalon
« Matériel (attend le propriétaire) » : elles dépendent du pont (#25), qui attend le go de S-9.0.
Revue de fin de version par les **72 personas**, revue design des écrans nouveaux ou changés et
revue de code par agent : [`docs/bmad/revues/v2.1.md`](docs/bmad/revues/v2.1.md). Le CO₂ sur le plan
et l'image de fond attendent les décisions du propriétaire (revue, § 10) ; elles ne bloquent pas
l'enchaînement vers la v2.2.

- **Plan de la maison** (#202)
  - Modèle et confidentialité (#537) : pièces en rectangles sur une grille de 50 cm, un plan par
    niveau (rez-de-chaussée et étage, cave facultative), appareils placés et dits (radiateur,
    chauffe-eau, module de la station, prise mesurée, compteur, volet) ; un seul lecteur
    (`parsePlan`, fuzz) ; secret `FLOOR_PLAN_JSON` scellé dans le navigateur, recopié par la collecte
    dans la méta chiffrée, jamais cité dans un journal ; brouillon de l'appareil scellé ; aucune
    adresse.
  - Pièces → « Liste | Plan » (#537) : chaque pièce colorée sur la période par la consommation, la
    température moyenne, les jours sous le seuil de confort ou les heures de fenêtre ouverte ; une
    pièce se touche pour ouvrir sa page ; « Voir les valeurs » donne le plan en tableau ; en vue
    foyer, une chambre dit « Chambres ».
  - Éditeur dans ⚙ Mon logement (#539) : niveaux, pièces, appareils ; glisser au doigt par cases,
    et chaque position et taille aussi dans un champ ; appliqué aussitôt sur l'appareil,
    « Enregistrer pour le foyer » pour tous.
- **Finitions de la revue v2.0** (#533, #536, #538)
  - Assistant : le dépôt reconnu sans tenir compte de la casse, le jeton gardé quand le dépôt est mal
    formé, GitHub relu après un échec, un état inconnu dit « à vérifier », « Aucune étape faite
    sur 6 », le texte du jeton dit une fois.
  - `scripts/depot_pret.py` : seul un 404 dit que Pages n'est pas activé ; une copie de l'appli
    renvoie vers son propre guide (`source-repo.ts`) ; l'avertissement de trace d'un autre site en
    une phrase de tous les jours.
- **Revue de fin de version** : en WebKit à 200 %, ⚙ Mon logement ne défile plus en largeur (#540,
  règle unique des listes) ; un nom saisi dans le plan reste du texte partout, tenu par un test ;
  le plan ajouté à SECURITY.md et au modèle de données de l'architecture ; captures de référence
  régénérées dans la police de la CI (DejaVu Sans) (revue, § 6).

## v2.0 — novembre 2026 : ouverture

Dépôt modèle et guide, assistant de premier lancement, origine dédiée, branche `data` et copie sur
le NAS ([feuille de route](docs/bmad/feuille-de-route.md)), plus les issues ouvertes par la revue de
fin de v1.9. Revue de fin de version par les **72 personas**, revue design des écrans nouveaux ou
changés et revue de code par agent : [`docs/bmad/revues/v2.0.md`](docs/bmad/revues/v2.0.md). Le pont
(#25) attend le go de S-9.0 et la clé IA (#14) la condition de l'ADR-5 ; les gestes et décisions du
propriétaire (revue, § 9 et § 10) ne bloquent pas l'enchaînement vers la v2.1. Close
après sa revue (PR #534, défauts bloquants corrigés).

- **Installer chez un nouveau foyer**
  - Guide pas à pas `docs/INSTALLER.md` (partie de #29, #522) : créer sa copie, vider `data/` du
    foyer d'origine, phrase de passe, les cinq secrets obligatoires, Pages, première collecte,
    téléphone ; `scripts/depot_pret.py` dit en lecture seule ce qui reste à faire (données, dépôt
    distant, secrets et Pages avec `--github`). Cocher « Template repository » reste au propriétaire.
  - Assistant de premier lancement (partie de #40, #528) : ⚙ Sources de données → Premier
    lancement, et l'écran d'un site sans données ; il vérifie avec le jeton ce qui est fait, scelle
    lui-même les secrets Intuis manquants, réactive et lance la première collecte avec tout
    l'historique, et donne le lien GitHub pour la phrase de passe et Pages ; démo fictive sans appel.
    Un dépôt mal tapé ou un jeton sans les bons droits se corrige sans recharger (« Changer de dépôt
    ou de jeton », revue de fin de version).
- **Où vivent les données**
  - Branche `data`, au choix du propriétaire (#23, #523) : variable `DATA_BRANCH`, workflow manuel
    « Branche des données » (même arbre Git, totaux déchiffrés comparés avant l'envoi, jamais forcé,
    jamais en arrière), `python -m collector comparer` ; l'adresse des données dans l'appli ne
    change pas. La garde anti-recul relit tout l'historique de la source (#529, #530). Rien ne
    bascule tout seul.
  - Copie locale sur un NAS Synology (partie de #143, #527) : un conteneur reprend le dépôt public
    chaque nuit, sans jeton ni port entrant, et sert l'appli et les données chiffrées à la maison,
    lisibles si GitHub ne répond plus ; HTTPS par le proxy inversé de DSM. Avec la branche `data`,
    réglage `BRANCHE_DONNEES` (revue de fin de version).
- **Sécurité**
  - Origine `github.io` partagée (partie de #229, #525) : modèle de menace corrigé (le site du compte
    peut prendre la main par un service worker) ; la trace d'un autre site du compte ouvert dans ce
    navigateur est signalée à côté de « Rester connecté » (une détection, pas une protection) ;
    gestes du transfert vers l'organisation écrits dans l'étude.
  - Ouverte en HTTP hors `localhost` (#524, #531) : l'écran de déverrouillage le dit avant toute
    saisie et grise la phrase et la démo, au lieu d'une erreur JavaScript ou d'une « phrase de passe
    incorrecte ».
  - Notes de l'appareil : paramètres lus avant l'ouverture des données (#517, #521).
- **Lisibilité** (constats de la revue v1.9, #518, #526)
  - Effacer une note illisible demande confirmation, avec la variante destructive du design system ;
    repère kWh/m²/an : grille et coefficients sous « Comment c'est calculé » ; phrase du soleil dite
    une fois.
  - « Mon défi » juste en année bissextile (#517, #521).
- **Revue de fin de version** : captures de référence régénérées dans la police de la CI (DejaVu
  Sans) ; la liste des fichiers à renommer au transfert tenue par un test ; textes périmés corrigés
  (SECURITY.md, architecture : ADR-23) (revue, § 6 et § 12).

## v1.9 — novembre 2026 : sécurité et méthode

Argon2id, paliers de taille, ensoleillement, repère kWh/m²/an, objectif à climat égal et rapport
anonyme ([feuille de route](docs/bmad/feuille-de-route.md)), plus les issues ouvertes par la revue de
fin de v1.8. Revue de fin de version par les **72 personas**, revue design des écrans nouveaux ou
changés et revue de code par agent : [`docs/bmad/revues/v1.9.md`](docs/bmad/revues/v1.9.md). Close
après sa revue (PR #519, aucun défaut bloquant) ; les décisions du propriétaire (revue, § 10) ne bloquent pas
l'enchaînement vers la v2.0 (règle de passage, feuille de route).

- **Chiffrement et réglages**
  - Clé dérivée par Argon2id (partie de #139, #509) : `rekey --kdf argon2id` (workflow « Changer la
    phrase de passe », entrée « derivation ») rechiffre à côté, relit chaque fichier, compare les
    totaux de `verify`, garde une copie d'avant (artefact **avant-rekey**) et remet tout en place au
    moindre écart ; Argon2id 64 Mio, 2 passes, 1 voie, mesuré sur un processeur ralenti six fois ;
    bornes communes à la collecte et à l'appli (`collector/kdf.json`) ; Argon2id chargé à la demande
    dans l'appli (hash-wasm, 11 Ko compressés), argon2-cffi dans la collecte, même clé des deux côtés
    (vecteur partagé). Rien ne migre tout seul : la migration des vraies données est un geste du
    propriétaire. Les notes gardées sur l'appareil (factures, travaux, absences…) sont reprises avec
    la nouvelle clé au déverrouillage suivant ; une note illisible n'est jamais écrasée, un bandeau
    le dit et propose de l'effacer.
  - Fichiers chiffrés remplis par paliers de taille (#138, #505) : la taille publiée ne suit plus
    l'activité du foyer (un jour d'absence n'écrit plus un fichier plus petit) ; format inchangé, lu
    avant et après par l'appli et la collecte (vecteur partagé) ; +4,4 % sur `data/`.
  - Contrat partagé et alerte froid prolongé scellés en secrets (#497, #506), comme les réglages du
    foyer de la v1.8 : l'appli n'écrit plus aucune variable du dépôt ; « Migrer en secret » sur les
    cartes Contrat partagé et Alerte froid prolongé ; la collecte lit le secret d'abord et nomme une
    ancienne variable restante sans sa valeur.
  - Diagnostic : l'ancienne variable des radiateurs arrêtés n'est passée qu'au bilan qualité, comme
    le secret (partie de #502, #508).
- **Mesures et méthode**
  - Rapport annuel : « Repère en kWh/m²/an, pas un DPE » (#127, #510) : chauffage (électricité + bois)
    et eau chaude des 12 mois du rapport sur les surfaces saisies, en énergie finale puis en énergie
    primaire (coefficient de l'électricité en vigueur le jour de l'affichage, daté), face aux seuils
    de l'étiquette énergie, « classe X à titre indicatif » seulement quand toutes les pièces
    chauffées ont leur surface ; ce qui sépare ce repère d'un DPE est dit.
  - Page d'une pièce : « Mon défi » (#152, #512) : −5, −10 ou −15 % de kWh par degré-jour face aux
    mêmes jours de l'hiver dernier, une jauge et une phrase d'encouragement ; l'objectif reste sur
    l'appareil, relu par un validateur passé au fuzz.
  - Jours inhabituels : « journée ensoleillée » comme explication possible d'un jour sous l'attendu
    (#117, #507), avec la même médiane du rayonnement que le niveau inférieur (`sun.ts`) ; nom de la
    variable d'Open-Meteo vérifié sur la source réelle (`pytest -m reseau`).
  - Chauffe-eau thermodynamique : les jours relevés à 0 kWh écartés sont dits sous le verdict et dans
    les hypothèses (partie de #502, #508) ; la règle à garder reste une décision.
  - Bois : la règle de répartition (soirs de flambée trouvés, sinon degrés-jours) dite par une seule
    phrase sur tous les écrans ; un stock relevé plus grand que les achats et un relevé antérieur au
    premier achat sont dits ignorés (#501, #511).
- **Lisibilité** (constats de la revue v1.8)
  - Finitions (#499, #513) : colonne des pistes du chauffe-eau en coûts par an, l'économie dite en
    mots ; aide du niveau inférieur avant les pièces ; espacement de « Services tiers contactés… » ;
    « sans compter les heures en hors-gel » ; isolation dite par la grille avant l'unité
    (« Logement bien isolé, à titre indicatif ») ; flambées « où la détection peut juger ».
  - Air et confort : explications de méthode repliées sous « Comment … » (partie de #498, #514) :
    12,8 → 10,9 écrans à 360 px, 33,4 → 25,4 à 200 % ; limite de hauteur tenue par un e2e ; le
    découpage de la page reste une décision.
- **Qualité et contribution**
  - Rapport de compatibilité anonyme (#144, #516) : `python -m collector diagnose --report` (types de
    pièces et de modules, familles de mesure, profondeur d'historique, jamais un identifiant, un nom
    ni une valeur, tenu par le détecteur de fuites) et gabarit d'issue « Compatibilité ».
  - Mutation de `periods.ts` : 86,3 % → 94,2 %, survivants lus ; la configuration de mutation
    exclut d'elle-même les tests qui lisent hors de `web/` (#495, #515).
- **Revue de fin de version** : captures de référence régénérées dans la police de la CI (DejaVu
  Sans) ; textes périmés par la v1.9 corrigés (README, architecture, PRD) (revue, § 6 et § 12).

## v1.8 — novembre 2026 : le bois et les réglages

Le bois partout où l'on juge l'isolation, les réglages du foyer chiffrés, l'ergonomie de ⚙ Mon
logement, les degrés-jours, le stock de bois, les heures creuses datées et le bilan qualité
([feuille de route](docs/bmad/feuille-de-route.md)). Revue de fin de version par les **72 personas**
et revue design des écrans nouveaux ou changés : [`docs/bmad/revues/v1.8.md`](docs/bmad/revues/v1.8.md).
Close après la revue de code par agent (revue, § 12, PR #503) ; les décisions du propriétaire
(revue, § 10) ne bloquent pas l'enchaînement vers la v1.9 (règle de passage, feuille de route).

- **Le bois partout où l'on juge le chauffage**
  - Isolation jugée électricité + bois (#460, #471) : avec un poêle et du bois acheté, « Chauffage
    selon le froid » compte le bois par défaut (bascule « Électricité seule »), « Année par année »
    ajoute le chauffage électricité + bois en kWh, par degré-jour et en euros, et le kWh/m² du
    logement (⚙ Mon logement › Surfaces) compte le bois ; la pièce du poêle dit « chauffée au bois »,
    jamais 0. Verdict « Isolation, à titre indicatif » sous « Chauffage selon le froid » : W/°C et
    kWh/m² par an, grilles indicatives affichées (`web/src/isolation.ts`), jours estimés signalés.
    Une seule règle qui ajoute le bois à l'électricité (`withWood`), suivie par le verdict de
    l'Accueil (#433).
  - Travaux avant / après en électricité + bois (#476, #485), et leur graphique « Chauffage par
    mois » aussi (#488, #491) : un poêle allumé entre les deux périodes ne passe plus pour une
    isolation (démo : −16 % en électricité seule, 0 % électricité + bois).
  - Bois : stock et bois réellement brûlé (#465, #480) : sous ⚙ Mon logement › Poêle à bois,
    « Bois réellement brûlé (facultatif) » note, par saison, les stères brûlés ou le stock restant
    au printemps ; ce qui reste passe à la saison suivante (le plus ancien d'abord). Une seule règle
    de stock (`woodSeasons`), que suit la seule répartition des jours (`woodDaily`). `WOOD_JSON` :
    `burnt` facultatif, mêmes limites dans la collecte et dans l'appli (test d'accord, fuzz).
  - Flambées du poêle (#469, #487) : la collecte lit chaque nuit les soirs où au moins deux pièces
    voisines du poêle se réchauffent radiateur à 0 W, après le coucher du soleil et sans redoux
    (`collector/stove.py`, `meta.stove_fires` chiffré, rien dans le journal) ; Historique ›
    « Flambées du poêle » (calendrier, durée, pièces témoins, « poêle allumé ce soir ? ») ; le bois
    est réparti sur les soirs de flambée dans les jours lisibles. Seuils calibrés sur la démo,
    écrits dans le code avec la façon de les ajuster.
  - Pièce du poêle au-dessus de 22 °C (#468, #493) : sa page dit le bois qu'une baisse à 22 °C
    économiserait sur la saison (7 % par degré, règle de l'ADEME déjà employée par l'appli).
  - Radiateurs retirés (#440, #443) : nouveau motif d'arrêt volontaire ; pour tout motif, plus
    d'alerte de module à partir de la date déclarée (une seule règle, appli et collecte) ; une pièce
    disparue de l'application Intuis garde son historique. « Arrêtée depuis » dit la date déclarée,
    pas le premier jour muet (#461, #474).
- **Réglages du foyer chiffrés et ⚙ Mon logement**
  - Radiateurs arrêtés et bois du poêle scellés en secrets (#459, #472), comme la localisation :
    plus de variable en clair, migration proposée à l'écran, la collecte lit le secret d'abord et
    nomme une ancienne variable restante sans sa valeur. Règle écrite dans PROJET.md § 7.
  - Saisies gardées (#462, #473) : brouillon chiffré de la localisation et des toits qui survit à
    un changement d'onglet, à ⚙ Sources et à un rechargement ; volets du poêle qui restent ouverts,
    rendement appliqué à la sortie du champ ; surfaces sans grille reconstruite ni focus perdu
    (`npm run e2e:logement`, Chromium et WebKit).
  - Erreur du jeton GitHub (#463, #477) : l'appel refusé et la permission qu'il demande sont nommés,
    jamais une valeur ni le dépôt ; le message s'efface à chaque essai, dit l'heure et le numéro de
    l'essai, et propose « Réessayer » (`npm run e2e:jeton`).
  - Lier un module de la station qui suit une pièce (#467, #478) : un module intérieur non lié dont
    la moyenne du jour suit la sonde d'un radiateur est proposé sur la page de la pièce ; « Ne pas
    lier » ne le repropose plus sur cet appareil.
- **Mesures et méthode**
  - Degrés-jours (#464, #475) : base 18 °C, méthode de Météo-France et source (Open-Meteo ou station
    Netatmo) dites sous « Totaux par année », dans le Rapport et le glossaire ; une année incomplète
    est marquée « au moins » et le chauffage par degré-jour ne compte que les jours mesurés ; une
    seule formule dans la collecte ; test réel à Lyon-Bron (`pytest -m reseau`).
  - Heures creuses datées (#441, #444) : chaque jour prend les plages en vigueur ce jour-là, lues dans
    les relevés (un changement compte après 5 jours de chauffe d'accord) ou saisies avec « à compter
    du » ; simulateur solaire, recharge, plannings et bandeau d'horaires suivent.
  - Totaux qui disent ce qu'ils comptent (#466, #482 ; #488, #491) : la tuile du mois de l'Accueil,
    « Hiver contre hiver » et la carte du mois de la vue Proche disent « chauffage et eau chaude »
    (`countedWhat`, une seule source des mots).
  - Niveau inférieur (#452, #479) : carte d'Air et confort qui suit l'énergie des radiateurs des
    pièces choisies à froid égal, les nuits et jours peu ensoleillés (rayonnement collecté chez
    Open-Meteo), avec un repère avant / après daté (joints, rideau…).
  - Simulateur « Un chauffe-eau thermodynamique » (#453, #496) : l'eau chaude réelle des 365 derniers
    jours face à trois pistes (baisser la consigne, tout chauffer en heures creuses datées, un
    thermodynamique), en kWh et en euros, avec le retour sur le surcoût ; toutes les hypothèses
    saisies, seul le COP est proposé (2,5). Champs de simulateur partagés avec le solaire
    (`sim-inputs.ts`).
  - Bilan qualité (avance #336, #456) : une seule règle de classement des jours (réel, estimé,
    suspect, arrêté, manquant) dans l'appli et la collecte, tenue par un vecteur partagé ; pièces
    arrêtées volontairement comptées à part ; causes connues des trous dans État des données.
- **Lisibilité et design system** (constats de la revue v1.7 et suites)
  - Plus de césure à 100 % de texte : onglet actif sans gras sur téléphone, césure des titres et
    des noms de liste seulement en gros texte (#434, #445), vue Proche comprise (#442, #450) ; le
    balayage compte une césure par trait comme un mot coupé.
  - Heures pleines / creuses en deux jetons de tarif (#435, #447) ; plus aucune série hors pièces
    aux couleurs d'une pièce, encres de série du design system (#446, #449).
  - Vue Proche à 200 % balayée en CI : Rapport sans débordement, titre au plancher, légendes de
    graphique qui passent à la ligne, invariant « légende coupée » (#451, #454) ; nom d'axe de la
    signature lisible à 200 %, invariant « titre d'axe coupé » (#457, #490) ; « Ce qui part chez des
    tiers » en cartes, lu sans défilement, invariant « colonne cachée » (#484, #489).
- **Promesses, sécurité, qualité**
  - Ce qui part chez l'IA (#365, #481) : les totaux du mois **et au plus cinq jours inhabituels**,
    pièces sous pseudonyme, dit pareil sur toutes les surfaces et tenu par `tests/test_promesses.py` ;
    troisième angle des revues de fin de version (`docs/revues-agents/revue-promesses.md`).
  - `SECURITY.md` : aucun délai promis, repli sans détail tant que le signalement privé n'est pas
    activé (partie de #364, #492).
  - Plus d'erreur « layerStack » en quittant un graphique en cours de rendu (#439, #448, A13) ;
    test de l'export de recherche sous 5 s sans relever le délai (#483, #486) ; deuxième vague de
    mutation sur `reconstitute.ts`, 76,5 % → 98,0 % (#392, #494).
- **Revue de fin de version** : captures de référence régénérées dans la police de la CI (DejaVu
  Sans) ; titre du simulateur du chauffe-eau thermodynamique qui ne coupe plus « thermodynamique » au
  milieu à 360 px ; sous-titres des listes coupés par un trait en gros texte (« autoconsommation »
  dans Outils à 200 %) ; le balayage regarde aussi les mots de plus de 12 lettres (revue, § 6).

## v1.7 — novembre 2026 : finitions et données de la maison

Version de finitions de la refonte v1.6 et de données de la maison, sans nouvel onglet (cadrage :
recommandation de [`docs/bmad/revues/v1.6.md`](docs/bmad/revues/v1.6.md) § 9, validée par le
propriétaire). Revue de fin de version par les **72 personas** et revue design des écrans nouveaux ou
changés ; détail dans [`docs/bmad/revues/v1.7.md`](docs/bmad/revues/v1.7.md). Close après les quatre décisions
du propriétaire qui ont suivi la revue (#438) et les PR de clôture #455 et #458 (revue, § 11).

- **Lisibilité, suite de la v1.6**
  - Historique en deux questions (« Hiver contre hiver », « Consommation en détail ») et six
    sous-pages avec adresse (`#historique-annees`, `-changements`, `-froid`, `-jours`, `-calendrier`,
    `-station`) ; plus de « DJU », « pente », « signature » ni « suspect » visibles (#386, #420) ;
    une période et « Compté : » sous chaque carte, dates locales, couleurs de l'année dans la
    légende, « An » seulement sur des années entières (#299, #300, #301, #306, #420). L'onglet tient
    en 4 écrans à 360 px, mesuré à 360 × 800 en DejaVu Sans ; la ligne « électricité + bois »
    d'« Hiver contre hiver » est repliée sous son écart, écrit en couleur de texte normale
    (#426, #432, #458 ; décision du propriétaire).
  - Lignes de consigne (« Température demandée ») en `--series-reference`, en tirets, et non plus en
    iris : l'iris est réservé aux actions, sans exception dans `design-usage.test.ts` (#458, décision
    du propriétaire ; la rampe d'encre des cartes de chaleur ne change pas).
  - État des données : une ligne par source en tête (« complet depuis 2022 », « muet depuis
    4 jours »), le détail replié, plus de formulaire dans la page, un seul bilan (13 → 3,3 écrans à
    360 px) (#387, #419).
  - Texte à 200 % : au-delà d'environ 120 %, la barre d'onglets montre les icônes et le libellé de
    l'onglet actif en taille pleine ; espaces insécables entre un nombre et son unité (#389, #419).
  - Pièces et page Pièce : un sélecteur de période partagé (Mois · Saison · 12 mois · Année),
    « Compté : » sur chaque carte, le coût de la pièce sur sa page (#388, #425).
- **Design system et langage** (constats de la revue design v1.6)
  - Petits textes à 13 px au moins, segments et replis à 44 px, un seul style de sélecteur et de
    bouton secondaire, un seul titre de page par écran, pas de césure dans la vue Proche, lignes de
    70 caractères au plus et deux colonnes sur ordinateur, l'iris réservé aux actions (rampe d'encre
    pour les cartes de chaleur) ; chaque règle tenue par le balayage ou un test (#402 à #405, #407 à
    #409, #422).
  - Avertissements de ⚙ Sources en alertes ambre avec un titre court ; « Eau chaude » pour l'usage
    et « Chauffe-eau » pour l'appareil ; pluriels accordés par une seule fonction (appli et
    collecteur) ; moins de termes techniques ; « Compté : » écrit par une seule fonction (#401, #406,
    #427, #429).
- **Incidents et poêle à bois**
  - Coupures de courant et d'Internet marquées ⚡ / 🌐 dans « Consommation en détail », jamais
    jugées « économes » (signature, jours inhabituels, absences), retirées des deux mois d'« Expliquer
    un mois » (#394, #418).
  - Poêle à bois : achats en stères (essence, humidité, prix) dans ⚙ Mon logement, chaleur par des
    hypothèses affichées et modifiables (kWh par stère, rendement), répartie selon le froid ;
    chauffage électricité + bois dans « Ce qui a compté » de l'Accueil, « Hiver contre hiver » et
    « Expliquer un mois » (#366, #421) ; le bois sans les jours de coupure, comme l'électricité
    (#423, #430).
- **Photovoltaïque et heures creuses**
  - Simulateur « Panneaux solaires » (Outils › Simulateurs) : courbe Linky à la demi-heure contre
    un profil PVGIS, 3 / 4,5 / 6 kWc, pilotage du chauffe-eau et de la recharge, batterie 5 et
    10 kWh, hypothèses saisies par le propriétaire (#356, #424).
  - Localisation de la maison et de ses toits, gardée seulement chiffrée, envoyée à PVGIS arrondie
    à environ 1 km (#204, #424).
  - Heures creuses : une seule source pour le simulateur solaire, la recharge du véhicule, les
    plannings et le bandeau d'horaires : lues dans les relevés à la demi-heure, sinon saisies dans
    ⚙ Mon contrat (plusieurs plages, à la minute, chiffrées sur l'appareil), sinon 22 h → 6 h dit
    supposé ; une borne au milieu d'une demi-heure la compte au prorata des minutes (#428, #431).
- **Volets Wiser** (avance #200, en attente des vraies données du NAS) : relevé par un script du
  NAS, journal chiffré envoyé par un workflow, soirs relevés dans l'appli à la place des notes
  (#417).
- **Revue de fin de version** : captures de référence régénérées ; radiateur arrêté à la couleur de
  sa pièce (#436) ; « règle ADR-5 » retirée de ⚙ Sources (#437) ; plus de
  bandeau « Nouvelle version disponible » à la première visite quand le premier service worker prend
  la page avant son événement « installé » (vu en WebKit sur la CI).
- **Verdict de l'Accueil en électricité + bois** (#433, #455, décision du propriétaire, option A) : avec un
  poêle déclaré et des achats de bois, le verdict, sa jauge, la tuile du mois et la vue Proche comparent le chauffage
  électricité + bois à celui attendu (« 27 € d’électricité + bois (160 kWh) … pour 27 € attendus »
  sur la démo, au lieu de « 5 € de moins » en électricité seule) ; le bois de chaque jour vient de la
  même répartition par degrés-jours qu'« Hiver contre hiver » et « Expliquer un mois », compté
  aussi dans les années de référence. Une pièce aux radiateurs retirés compte comme chauffée par le
  poêle quand des achats de bois existent (#440, #455, `stoveHeated`).
- **Reporté** (raison dans chaque issue) : césure à 360 px (#434) et couleurs des heures pleines /
  creuses (#435), en v1.8 ; issues non commencées, sur décision du propriétaire : volets et pince
  (#200, #24, #26, #281) au jalon « Matériel (attend le propriétaire) », plan de la maison (#202) en
  v2.1. Suite : [feuille de route](docs/bmad/feuille-de-route.md).

## v1.6 — novembre 2026 : refonte UX/UI, nouveau design system, écrans reconstruits

Version de refonte : nouvelle navigation, nouveau design system et **tous les écrans reconstruits**
d'après les maquettes validées (`docs/design/maquettes/`), plus les fonctions demandées pendant la
version. Revue de fin de version par **72 personas** (10 nouveaux, #63 à #72) et revue design par
agents ; détail dans [`docs/bmad/revues/v1.6.md`](docs/bmad/revues/v1.6.md).

- **Navigation et design system**
  - Design system maison sur les échelles Open Props et les couleurs Radix : jetons, composants,
    thème des graphiques, contraste élevé, texte à 200 % (#330) ; migration terminée, un test interdit
    toute couleur ou taille hors jetons et les anciennes classes (#317, #411).
  - Cinq onglets (Accueil, Pièces, Historique, Compteur, Outils), centre de paramètres en 8 pages,
    menu ⋮ supprimé (#308, #309, #339) ; une seule période par écran et une ligne « Compté : »
    (#299, #301) ; comparaisons nommées (« −16 % vs nov. 2025 au 8 », #302).
- **Écrans reconstruits**
  - Accueil : verdict en euros sur un seul périmètre, jauge du mois, ce qui a compté, consommation
    et froid (#311, #341, #383, #412). Pièces et page Pièce qui commence par « maintenant » (#313,
    #342, #384). Historique hiver contre hiver, à climat égal (#345). Compteur (#347). Outils et
    État des données avec bilan qualité par source et par année (#314, #318, #344). Premier lancement
    et vue Proche sur le même calcul que l'Accueil (#312, #316, #343, #400).
  - Graphiques lisibles : échelles, points, trous, légendes, résumés textuels, axes sans graduation
    en double, une couleur par pièce partout, barres horizontales lisibles à 200 % (#299–#306, #398,
    #399, #410, #413) ; feuille « Réglages du graphique » (#20, #396).
- **Nouvelles fonctions**
  - « Expliquer un mois » : écart décomposé (météo, consignes, pièces, poêle, autres usages), pièce
    hors ligne ou arrêtée volontairement (poêle) (#337, #346, #354, #369).
  - Mes plannings et les heures creuses ; absences reconstituées par le mode absent (#210, #211, #352).
  - Station : pression et bruit ; vent et pluie dans la signature ; journal des incidents (#220,
    #221, #280, #393).
  - Vraie PWA : nouvelle version en attente avec bandeau « Recharger », Installer, « Recharger
    l'application » sans toucher aux données (#357, #368) ; `SECURITY.md` (#364).
- **Corrections remontées par le propriétaire** : déconnexion au rafraîchissement (verrouillage
  partagé entre onglets, #334) et bouton « Afficher la phrase » (#335, #340) ; module « Cave » liable
  à une chambre, télétravail 5 jours, défilement conservé (#355, #370, #396).
- **Qualité**
  - Tests E2E robustes : fixtures de démo, balayage systématique de chaque page × 4 affichages,
    explorateur de contrôles, invariants (débordement, textes recouverts, mots coupés, focus, saut de
    défilement), smoke test sur les vraies données en assertions seules (0 échec), sonde du site
    publié (#353, #367, #371, #372).
  - Fuzz à graine fixe, mutation (66,8 % → 89,2 %), porte unique `npm run porte`, `AGENTS.md`
    source unique, `docs/APPRENTISSAGES.md`, chiffres de la doc tenus par un test, sources publiques
    réelles (#358 à #363, #395).
- **Reporté** (raison dans chaque issue) : plan de la maison (#202), volets Wiser (#24, #26, #200),
  localisation exacte (#204), pince (#281), coupures dans les graphiques (#394), mutants de la
  reconstitution (#392), constats mineurs de la revue design (#401 à #409), origine dédiée (#229, v2).

## v1.5 — novembre 2026 : revue de code complète et corrections

Version de qualité : **tout le code** relu par quatre agents de revue (collecteur et workflows ; PWA
sécurité et données ; PWA calculs ; PWA vues et performance), 46 constats ouverts en issues
`revue-code` (1 critique, 17 majeurs, 25 mineurs, 3 suggestions), **43 corrigés**, 3 reportés en v1.6
avec leur raison (#229, #257, #258). Aucune nouvelle vue ; seules exceptions, les suites de l'audit des
données côté collecte. Détail dans [`docs/bmad/revues/v1.5.md`](docs/bmad/revues/v1.5.md).

- **Sécurité et vie privée**
  - **Fuite des coordonnées corrigée (critique, #261)** : une erreur HTTP d'Open-Meteo écrivait
    l'URL, donc la latitude et la longitude du logement, dans le journal public de la collecte. Les
    erreurs de toutes les sources passent par une couche d'erreurs sûres (source, chemin, statut,
    catégorie, code validé ; jamais la requête, le corps, un id ni une valeur), et chaque ligne de
    journal, stdout et stderr compris, est expurgée (`collector/redact.py`) ; corps d'erreur des API
    et nom de la maison retirés aussi (#263, #264). Un test de fuite fait échouer toutes les sources
    avec des réponses piégées (#321).
  - Dépendances Python verrouillées avec empreintes (`requirements-lock.txt`, `--require-hashes`),
    secrets donnés à la seule étape qui lance le collecteur, `timeout-minutes` sur la collecte (#265) ;
    artefacts du relevé horaire acceptés seulement de ce dépôt et de ses runs planifiés, enveloppes
    chiffrées refusées si version, KDF ou itérations sortent de l'attendu (#236, #271) ; clés Tempo
    validées avant publication (#274).
  - PWA : garde Trusted Types réécrite en petit analyseur (une quarantaine de contournements refusés,
    texte échappé jamais bloqué, #230, #231) ; exports CSV neutralisés contre les formules (#235) ;
    champs de jeton et de mots de passe non mémorisables par le navigateur (#233) ; appli refusée dans
    un cadre (#237) ; données déchiffrées oubliées au verrouillage (#232) ; stockage local, base et
    caches nommés d'après le dépôt sur l'origine `github.io` partagée, avec le risque restant expliqué
    dans Paramètres et une étude des options (`docs/etudes/origine-dediee.md`, #229 en partie).
  - Cadre juridique complété : Shelly Cloud, import Home Assistant et nouvelles collectes (#228).
- **Exactitude des chiffres**
  - **Vue foyer** (chambres regroupées) devenue un simple regroupement d'affichage, désactivée par
    défaut : tous les calculs tournent sur les pièces brutes, donc kWh, euros, HP/HC, jours perdus,
    jours froids, consigne et alerte froid sont identiques avec ou sans regroupement (#234, #238,
    #239, #241, #242, #243, #248).
  - **Périodes partielles** signalées partout : barres hachurées avec le nombre de jours, jours
    estimés ou perdus pâlis, évolutions N-1 sur la même période, projection et verdict sans première
    année partielle, moyenne mensuelle sur les mois couverts, saison de chauffe en cours affichable
    (#240, #244, #246, #297, #298) ; cumul annuel aligné sur un axe bissextile commun (#245).
  - **Euros qualifiés** : une seule règle de prix pour toute l'appli (#252) ; « hors abonnement » ou
    « abonnement inclus, tout le logement » écrit à côté de chaque coût ; les mêmes 12 mois partout
    sur la Synthèse ; projection au prix moyen de la sélection (#290, #291, #292). Une seule définition
    des jours sous 19 °C (#294) ; résumés pour lecteur d'écran sans totaux absurdes (#295).
- **Robustesse du collecteur** : jeton Netatmo renouvelé enregistré dès la connexion et versionné
  même si la collecte échoue, commit avec reprise sans force (#262) ; unité Linky lue dans la réponse,
  plus d'heuristique Wh / kWh (#266) ; heure répétée du passage à l'heure d'hiver additionnée (#267) ;
  vraie valeur qui remplace une estimation (#269) ; `Retry-After` plafonné et erreurs réseau Intuis
  réessayées sous le plafond d'appels (#270) ; import Home Assistant sans écrasement par un jour
  partiel (#272) ; un seul assistant de cadence pour toutes les sources (#275).
- **Performance et cycle de vie de la PWA** : premier écran mesuré honnêtement (entrée et chunks
  préchargés) et passé de **269 kB à environ 70 kB** gzip (26 % du budget), ECharts chargé à part
  (#227) ; seules les années horaires utiles téléchargées, séries et coûts mémorisés (#251, #256) ;
  chargeur à la demande lié au jeu de données affiché (#247, #255) ; cartes différées jamais
  supprimées en silence, messages clairs au démarrage, un seul déverrouillage à la fois, saisie des
  identifiants conservée en cas d'erreur (#249, #250, #254, #259).
- **Nouvelles données** (collecte seulement, chiffrées, en agrégats ; au plus une ligne dans une carte
  existante) :
  - **pièces au pas de 30 minutes** (énergie HP/HC, température, consigne) avec **4 ans
    d'historique** rattrapés en quelques nuits sous un budget d'appels propre ; profil horaire au pas
    de 30 min et heure de la chute de température dans « Pourquoi cette pièce était froide ? »
    (S-1.26, #224 ; recouvre #217) ;
  - **état des appareils** : radiateur, relais ou chauffe-eau injoignable (`offline_h`, compte dans le
    résumé du job, issue facultative), heures d'anticipation et d'abaissement par pièce, coupures de
    courant et Wi-Fi de la passerelle (#214, #218, #276) ;
  - **piles et signal radio** des modules de la station, journal des **mises à jour de firmware**
    (#215, #216) ;
  - Linky : **heure du pic** de puissance et **index par cadran** recoupés avec la consommation
    (#219, #277) ; contrat et couleur Tempo connus d'Intuis recoupés (#278) ;
  - **pinces Shelly** (EM Gen3, Pro EM) lues canal par canal, avec les rôles « arrivée générale » et
    « chauffe-eau » exclus de la décomposition des autres usages (#279).
- **Tests** : 107 → 228 tests Python, 252 → 389 tests TypeScript ; tests du client Intuis (429, 5xx,
  401, refresh refusé, plafond, #273) ; tests de `app.ts` et `ui.ts` (#253) ; e2e sans aucune attente
  fixe, sur un signal « vue prête », absences vérifiées après le rendu des cartes différées (#260).
- **Préparation de la v1.6** (documents seulement) : audit UX, architecture cible, banc d'essai et
  choix du design system, maquettes revues deux fois, audit des graphiques (`docs/design/`) ; étude
  de tous les appareils de la maison (`docs/etudes/audit-appareils.md`).

**À faire par le propriétaire** :

- **supprimer les journaux des anciennes collectes** où les coordonnées ont pu apparaître (Actions →
  « Collecte quotidienne » → chaque exécution antérieure au correctif → « Delete all logs ») : le
  correctif protège les journaux futurs, pas ceux déjà publiés ;
- variable de dépôt `DEVICE_ALERT` = `true` si une issue doit s'ouvrir quand un module ne répond plus
  (types et dates seulement) ;
- **ressaisir la phrase de passe une fois** sur chaque appareil après la mise à jour : la clé
  « Rester connecté » est rangée sous un nouveau nom propre au dépôt et l'ancienne est oubliée ;
- **décider de l'origine** de l'application (#229) : sous-domaine dédié recommandé ; d'ici là, aucun
  autre site GitHub Pages sur ce compte ;
- lancer le diagnostic « Inventaire » pour vérifier sur le vrai compte les champs nouvellement lus
  (état de connexion, Wi-Fi, contrat Intuis, heure du pic, index Linky), et laisser trois nuits au
  rattrapage des demi-heures (ou une collecte manuelle en `backfill`).

## v1.4 — novembre 2026 : expliquer par pièce, nouvelles sources, simulateurs

- **Fenêtres ouvertes, boost et état des radiateurs (E13)** : l'API Intuis ne garde aucun historique
  de ces états (sonde S-13.1, #162) ; un **relevé horaire** facultatif (`releve-horaire.yml`, une
  requête `homestatus` par heure, chiffrée, gardée 3 jours en artefact, **aucun commit horaire**) est
  agrégé chaque nuit par pièce et par jour (fenêtre ouverte, boost, chauffe, délestage, mode, contacteur)
  au prorata des relevés reçus, avec la couverture affichée. Carte Confort « Fenêtres ouvertes et
  radiateurs », question « Pourquoi cette pièce était froide ? », explication possible des jours
  inhabituels, signature sans les jours d'aération, kWh pendant le boost, absences confirmées par le
  mode de consigne, délestage par pièce face au pic Linky, mode du contacteur du chauffe-eau.
- **Données d'occupation minimisées** (S-13.5) : `presence` jamais lue sauf variable explicite, et
  même alors en heures par jour seulement ; chambres regroupées ; analyse d'impact courte
  (`docs/api-notes.md`, `docs/juridique.md`). L'IA ne reçoit que des totaux mensuels pseudonymisés de
  fenêtres et de boost, chambres en une seule ligne (S-5.10).
- **Prises Shelly** (Shelly Cloud, compteur cumulé réparti par jour) et carte **« Autres usages en
  détail »** : reste Linky découpé en prises mesurées, postes saisis, talon de veille et non attribué.
  Le journal `httpx` est coupé au niveau INFO (il affichait des paramètres d'URL).
- **Home Assistant** : commande `import-ha` (historique REST, CSV, statistiques long terme), agrégats
  chiffrés (`data/ha.enc.json`, schéma publié), carte « Capteurs Home Assistant » avec taux d'accord
  entre un capteur d'ouverture et `open_window`. Étude Home Assistant + Zigbee : **no-go cet hiver**.
- **Coûts et simulateurs** : facture recoupée avec écart expliqué ligne par ligne, recharge d'une
  **voiture électrique** par offre (dépassements de puissance comptés sur la courbe 30 min),
  estimation **pompe à chaleur** à partir de la signature (hypothèses affichées), **mode locataire**
  (prix moyen, cartes Linky masquées, rapport limité au bail).
- **Audit et travaux** : surfaces et marqueurs « travaux » (signature avant / après, kWh/m²),
  **export recherche** anonymisé (dates décalées, pseudonymes, vérifié par le détecteur de fuites).
- **Alerte « froid prolongé »** (variable `COLD_ALERT_JSON`, désactivée par défaut) : issue GitHub
  avec des pseudonymes seulement, fermée au retour ; ce n'est pas un dispositif de sécurité.
- **Famille et accessibilité** : mode simple en **langage clair** (FALC) avec glossaire au toucher,
  **invitation par QR code** (l'adresse seule, jamais la phrase), aide d'installation iPhone / Android,
  Safari iOS : clé effacée par le système expliquée, **WebKit dans la CI**.
- **Station** : clés de modules stables (un module ajouté ne reprend pas l'historique d'un autre) ;
  étude de l'emplacement du module intérieur libre.
- **Audit des données** (`docs/audit-donnees.md`) : inventaire anonyme par source (Intuis, station,
  Linky), passé sur le compte réel ; suites en issues (v1.5 et v1.6).
- **Processus** : revues par agents (code et design) écrites et outillées (`docs/revues-agents/`,
  `scripts/revue_issues.py`, workflow facultatif `revue-agents.yml`), inventaire de l'interface
  (`docs/design/inventaire.md`), revue de fin de version (`docs/bmad/revues/v1.4.md`) et cadrage v1.5.

**À faire par le propriétaire** pour profiter de la v1.4 sur le vrai compte :

- variable de dépôt `ROOM_STATE_HOURLY` = `true` pour lancer le relevé horaire (sans elle, les cartes
  fenêtres, boost et délestage restent vides) ; `ROOM_STATE_PRESENCE` seulement avec l'accord du foyer ;
- secrets `SHELLY_AUTH_KEY` et `SHELLY_SERVER` (ou depuis Paramètres) si des prises Shelly sont posées,
  puis comparer après deux nuits avec l'application Shelly ;
- variable `COLD_ALERT_JSON` (seuil, durée, pièces) si l'alerte froid est voulue, et un essai avec un
  seuil élevé pour voir l'issue s'ouvrir puis se fermer ;
- scanner le QR code d'invitation depuis un téléphone ; vérifier les noms des modes du contacteur.

## v1.3 — novembre 2026 : confort, coûts, robustesse, sécurité

- **Contrat partagé** entre tous les appareils (variable de dépôt `CONTRACT_JSON`, validée par le
  collecteur, rangée dans la méta chiffrée) ; verrouillage après inactivité ; clé mémorisée 30 jours.
- **Vue Confort** : CO₂ nocturne des chambres, humidité de la cave et point de rosée, heures sous
  19 °C (seuil réglable), sonde du radiateur comparée à la station dans la même pièce.
- **Courbe de charge Linky** (30 min) : journée type, talon, pic de 12 mois ; **sauvegarde chiffrée**
  téléchargeable et commande `restore-backup`.
- **Coûts** : budget annuel et projection, empreinte CO₂ (facteur modifiable), effet d'un nouveau
  tarif réglementé, coût d'une journée de télétravail, absences détectées.
- **Analyses** : chauffe-eau en heures creuses, simulateur de consigne (±2 °C), signature sur l'écart
  intérieur − extérieur, soirs « volets fermés » notés à la main.
- **Qualité des données** : jours réels / estimés / perdus par mois, jours perdus reconstitués à part
  (Linky ou signature), jours « suspects », exclus des jours inhabituels.
- **IA** : faits enrichis, pièces pseudonymisées (« Pièce A… »), coût et utilité de chaque analyse,
  questions types sans IA.
- **Exports** : CSV/JSON long documenté (`docs/export-long.md`), rapport annuel anonymisé,
  comparateur d'offres et pic de puissance dans le rapport.
- **Collecteur** : détection des changements de format des API, compteur et plafond d'appels par
  source, champs de `homestatus` listés par le diagnostic (fenêtre ouverte disponible, #162) ;
  issue automatique « Jeton à renouveler ».
- **Sécurité** : Trusted Types imposés par la CSP, attestation de build et empreintes SHA-256
  publiées (`gh attestation verify`).
- **Accessibilité et mobile** : audit axe dans la CI, contraste élevé et taille de texte système,
  balayage pour changer de période ou d'onglet, pièce épinglée, hors-ligne préparé.
- **Vie privée du foyer** : vue foyer qui regroupe les chambres (désactivable par appareil).
- Cadre juridique (`docs/juridique.md`), `CONTRIBUTING.md` et devcontainer, démo complète.
- Revue de fin de version (`docs/bmad/revues/v1.3.md`) et cadrage v1.4 avec 62 personas.

## v1.2 — novembre 2026 : contrat, comparateur, station, paramètres

- Mode projet : règles BMAD (`docs/PROJET.md`), gabarits d'issues et de PR, jalons, une issue par récit.
- Station Netatmo complète : salon, chambre des enfants, cave, extérieur (température, humidité, CO₂).
- Historique de contrat (offre, puissance par période) et fichiers de tarifs extensibles à d'autres
  fournisseurs ; comparateur EDF Base / HP-HC / Tempo jour par jour (couleurs Tempo réelles).
- Puissance maximale appelée (Linky) comparée à la puissance souscrite.
- Études : volets Wiser (no-go passerelle, mesure d'abord) et plateforme domotique ouverte
  (Home Assistant, matériel manquant).
- **Paramètres dans l'application** : saisie des identifiants, chiffrés dans le navigateur puis écrits en
  secrets GitHub ; lancement de la collecte. Jeton GitHub jamais stocké ; CSP stricte.
- Bandeau « données arrêtées » ; résumé de chaque collecte dans GitHub ; Dependabot.
- `rekey` (changer la phrase de passe, workflow dédié) et estimation de robustesse (`strength`).
- Dépendances : ECharts 6.1 (correctif XSS), Vitest 5, actions GitHub à jour.
- Revue 50 personas de la v1.2 (`docs/bmad/revues/v1.2.md`).
- Comparateur : simulation d'une autre puissance souscrite, avec alerte si le pic Linky la dépasse.
- Station : jours au-dessus de 1 000 ppm de CO₂ et de 65 % d'humidité par module.
- « Jours inhabituels » : écarts nets à la signature énergétique (règle déterministe, sans IA).
- Mode simple : verdict et chiffres clés en grands caractères.
- Paramètres : ce qui est public, ce qui part chez des tiers.
- Changement de puissance souscrite déduit du Linky (premier dépassement de l'ancienne puissance),
  ajouté au contrat d'un clic. Linky : lecture du format Enedis 2026.
- État de chaque source (dernier succès, dernier échec) dans Paramètres et le résumé de collecte.
- Accessibilité : résumé textuel de chaque graphique pour les lecteurs d'écran ; écran de chargement.
- Tests visuels automatiques de la démo (Playwright, 3 appareils, 5 vues) dans la CI.

## v1.1 — novembre 2026 : comprendre sa consommation

- Historique complet depuis novembre 2022 : quatre types de mesure selon l'époque, chauffe-eau lu au
  niveau du module, jours perdus par le serveur reconstitués depuis les totaux mensuels (« estimés »).
- Coût au tarif réglementé EDF heures pleines / creuses, jour par jour (open data CRE), abonnement
  inclus ; ou prix personnels.
- Météo (Open-Meteo ou station Netatmo), degrés-jours, comparaison à climat égal, signature énergétique.
- Verdict du mois, projection de fin d'année, calendrier, profils horaires, températures des pièces,
  cascade par pièce, part dans la consommation Linky, rapport annuel imprimable.
- Analyse mensuelle rédigée par Claude, chiffres vérifiés, données envoyées visibles.
- Alerte par issue GitHub si la collecte échoue ; diagnostic anonyme de l'API.
- Cadrage BMAD et revue 50 personas.

## v1.0 — novembre 2026 : première version

- Collecte quotidienne chiffrée (GitHub Actions), PWA sur GitHub Pages, comparaison d'années, filtres
  par pièce et par usage, export CSV, mode démo.
