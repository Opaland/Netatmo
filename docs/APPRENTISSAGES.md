# Apprentissages — les erreurs de méthode déjà commises ici

**À lire en premier**, avant `AGENTS.md`. Ce registre ne liste pas les bugs (ils ont leurs issues)
mais les erreurs de **méthode** : de procédure, d'outil, d'enchaînement, celles qui laissent un
défaut passer une suite verte. Chaque entrée est datée, dit ce qui s'est passé et la conduite à
tenir, en quelques lignes, avec ses références.

Règles du registre (reprises d'ÉtapeForge et de Mousse de Poche) : une erreur nouvelle s'ajoute
**dans la PR qui la corrige** ; on ne supprime pas une entrée, on la marque « absorbée par … »
quand un outil la rend impossible à refaire.

---

### A1 · 09/11/2026 — L'origine `github.io` est partagée par tous les sites du compte (#229, PR #326)

- **Ce qui s'est passé** : `localStorage`, IndexedDB et le cache du service worker sont par
  *origine*, pas par chemin ; une copie de l'appli (fork, démo) publiée sur le même compte
  pouvait lire ou écraser l'état, les notes ou la clé mémorisée de l'autre.
- **Conduite** : tout nom stocké passe par `lsKey` / `namespaceFor` (`web/src/scope.ts`) et tout
  cache porte le nom du dépôt (`vite.config.ts`). Ne jamais supposer qu'un chemin isole : seule
  une origine à soi le fait (`docs/etudes/origine-dediee.md`).

### A2 · 09/11/2026 — Des cartes différées disparaissaient en silence (#249, PR #324)

- **Ce qui s'est passé** : des `import()` terminés par `.catch(() => {})` faisaient disparaître
  une carte sans rien dire, hors ligne comme sur un vrai bug ; aucun test ne pouvait le voir.
- **Conduite** : toute carte ou action à la demande passe par `lazyCard` (`web/src/lazy.ts`) :
  hors ligne, la carte le dit ; sinon un état d'erreur visible et un `console.error`, sur lequel
  les e2e échouent. Jamais de `.catch` muet.

### A3 · 09/11/2026 — Les e2e attendaient un temps fixe au lieu d'un état (#260, PR #329)

- **Ce qui s'est passé** : des `waitForTimeout` et des absences vérifiées trop tôt rendaient des
  tests verts pour une raison qu'on n'avait pas voulue (la carte n'était pas encore là).
- **Conduite** : attendre `#view[data-ready]` (`ready(page)`), posé quand la vue et tout ce
  qu'elle a lancé en arrière-plan sont arrivés (`track`, `lazyCard`, `datasetDoc`) ; une absence
  se vérifie après `ready` (CONTRIBUTING.md §2).

### A4 · 09/11/2026 — Un onglet resté seul déconnectait les autres (#334, PR #340)

- **Ce qui s'est passé** : le verrouillage d'inactivité comptait les gestes de *son* onglet ;
  après 15 min, un onglet oublié effaçait la clé mémorisée — partagée — pendant qu'on travaillait
  dans un autre, qui redemandait la phrase de passe sans un mot. Les tests ne regardaient qu'un
  onglet.
- **Conduite** : ce qui est partagé entre onglets (clé, dernier geste) se teste **à deux
  onglets** (`web/e2e/pwa.mjs`, `features.mjs`) ; un écran de verrouillage dit pourquoi
  (`lockNotice`).

### A5 · 10/11/2026 (depuis le 09/11) — Le service worker forcé laissait des pages sans leurs morceaux (#334, #357, PR #368)

- **Ce qui s'est passé** : pour sortir d'une version restée « en attente » des jours, #334 a forcé
  `skipWaiting` ; la page ouverte exécutait alors son ancien JavaScript sous un nouveau service
  worker dont le précache n'avait plus les anciens morceaux : des cartes différées échouaient.
- **Conduite** : une version attend que l'on touche « Recharger » (décision du propriétaire du
  10/11, `registerType: 'prompt'`, `web/src/pwa.ts`). Tout changement du cycle de vie du service
  worker se teste avec une page restée ouverte pendant la mise à jour (`npm run e2e:pwa`).

### A6 · 10/11/2026 — Ça tenait en local, pas sur le runner : la police de la CI est plus large (#353, PR #367)

- **Ce qui s'est passé** : à 360 px et texte 200 %, le rapport débordait de 4 px sur le runner
  (DejaVu Sans, plus large que la police locale ou qu'Inter), pas en local : « 80 % / 20 % » ne
  pouvait pas passer à la ligne.
- **Conduite** : un test de mise en page à 200 % force la police la plus large (DejaVu Sans,
  `web/e2e/sweep.mjs`, `proche.mjs`) : le pire cas partout. Une marge de quelques pixels en local
  n'est pas une marge.

### A7 · 10/11/2026 — L'Accueil passait à 7 px de la limite sans que rien ne le signale

- **Ce qui s'est passé** (constat transmis par la session de coordination du 10/11, sans issue
  propre) : un écran restait vert tant que son débordement était sous le seuil, à quelques pixels
  près ; la marge n'était mesurée nulle part, et un changement de police ou de texte l'aurait
  franchie (voir A6).
- **Conduite** : quand une mesure frôle sa limite, l'écrire dans la PR avec le chiffre, et
  mesurer dans le pire cas (A6) plutôt que dans le cas courant.

### A8 · 10/11/2026 — Un « salon hors ligne » était un radiateur arrêté pour un poêle (#346, PR #354)

- **Ce qui s'est passé** : la détection « pièce sans relevé depuis 48 h » appelait « hors ligne »
  — avec alerte et estimation — un radiateur coupé volontairement parce que la pièce est chauffée
  par un poêle ; la baisse de consommation était alors présentée comme une panne.
- **Conduite** : avant d'afficher un diagnostic, se demander quelle cause *voulue* produit le même
  signal, et la rendre déclarable (« arrêté volontairement », ⚙ Mon logement). Une donnée de démo
  couvre les deux cas (Cuisine arrêtée pour un poêle, `web/e2e/expliquer.mjs`).

### A9 · 10/11/2026 — 582 tests verts, aucun ne cassait sur une préférence corrompue (#359, #358)

- **Ce qui s'est passé** : les tests d'exemples ne voyaient pas qu'une route
  `#parametres-constructor` était acceptée (`in` lit la chaîne des prototypes), qu'une facture
  du 30 février passait (lue comme le 2 mars), qu'une raison d'arrêt « __proto__ » était gardée,
  ni qu'un texte de facture disait « de plus » pour des kWh en moins. Le fuzz à graine fixe et la
  première vague de mutation les ont trouvés le même jour.
- **Conduite** : un lecteur d'entrée non sûre entre dans `web/src/fuzz.test.ts` avec ses
  invariants ; un calcul qui change un résultat affiché passe par une vague de mutation
  (`npm run mutation`) et ses survivants se lisent (`docs/bmad/06-qa-strategy.md`). Pour une clé
  venue de l'extérieur : `Object.hasOwn`, jamais `in`.

### A10 · 10/11/2026 — Des e2e pouvaient tourner sur un `dist/` périmé (#361)

- **Ce qui s'est passé** : les e2e servent `web/dist/` ; rien ne refusait un build plus ancien
  que les sources, et un `npm run build` oublié faisait tester la version d'avant (raté vécu
  trois fois sur le dépôt frère Sentiers, `CLAUDE.md` §6quater).
- **Conduite** : absorbée par `web/e2e/dist-a-jour.mjs`, chargé **dans** le processus des e2e
  (`node --import`, `startPreview`) — pas dans un crochet lancé avant (AGENTS.md §6).

### A11 · 10/11/2026 — Une fausse horloge dans PATH n'était pas vue par `busybox sh` en CI (#200, PR #417)

- **Ce qui s'est passé** : le test du script NAS des volets remplaçait `date` par un faux placé en
  tête de PATH ; vert en local sous dash et busybox, rouge sur le runner sous busybox, dont le
  shell y exécutait son propre applet `date` : le journal était daté du vrai jour.
- **Conduite** : une dépendance de temps (ou de tout outil) d'un script shell s'injecte par une
  variable que le script lit lui-même (`VOLETS_MAINTENANT`), pas par PATH ; un test qui tourne sous
  plusieurs shells se lit d'abord sur le runner avant d'être cru.

### A12 · 10/11/2026 — Un « Accueil trop long » en WebKit était un bandeau de service worker (PR #438)

- **Ce qui s'est passé** : sur la CI, `e2e-webkit` a vu l'Accueil à 2 676 px et État à 2 727 px
  (+232 px), deux fois de suite, puis vert à la relance ; l'hypothèse « une hauteur qui dépend de
  l'heure » ne tenait pas (mêmes hauteurs à 14 h, 22 h 15 et 23 h 30, en UTC et heure de Paris). La
  capture de l'artefact `captures-webkit` montrait le bandeau « Nouvelle version disponible » à la
  première visite : l'événement « installed » du premier service worker arrivait après
  `clients.claim()`, et la page le prenait pour une nouvelle version.
- **Conduite** : un e2e qui échoue sur la CI seulement se lit d'abord sur sa **capture** (artefact),
  avant toute hypothèse ; l'ordre des événements du service worker ne se suppose pas d'un moteur à
  l'autre (`createUpdater` retient le premier worker, test « claim avant installed » vu rouge).

### A13 · 11/11/2026 — Une erreur intermittente ne se reproduit pas en répétant, mais en tenant sa cause (#439)

- **Ce qui s'est passé** : « Cannot read properties of null (reading 'layerStack') » est apparu une
  fois au balayage de la CI ; 4 balayages, 240 navigations et des changements de thème en local
  n'ont rien donné. La lecture de zrender a montré la seule fenêtre : une tranche de peinture de
  15 ms qui déborde (calque « incrémental », toutes les cases d'une carte de chaleur en ECharts 6.1)
  reprend au `requestAnimationFrame` suivant, que `dispose()` n'annule pas. Une horloge qui avance
  de 20 ms à chaque lecture rend le débordement certain : l'erreur sort à chaque fois.
- **Conduite** : devant une erreur intermittente, lire la bibliothèque jusqu'à la condition de
  temps ou d'ordre qui l'ouvre, puis **forcer cette condition** dans le test (horloge, ordre des
  événements) plutôt que répéter sous charge ; le test doit vérifier sa propre précondition (ici,
  le calque incrémental existe).
