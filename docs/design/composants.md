# Composants du design system (v1.6, étape 1)

*Fondations livrées pour #310 (jetons et composants), #315 (nomenclature), #319 (200 % et
étiquettes coupées). Choix et sources : [design-system.md](design-system.md) ; règles de la revue
des maquettes : [revue-maquettes.md](revue-maquettes.md).*

**Démonstration vivante** : `cd web && npm run dev`, puis ouvrir `/composants.html`. Cette page
n'est pas une entrée de `vite build` (seul `index.html` l'est) : elle n'est jamais publiée et
n'entre pas dans le budget de taille. `npm run e2e:composants` la passe sous axe en clair, sombre,
contraste élevé clair et sombre, et à 360 px avec le texte à 200 % (cibles ≥ 44 px, aucun
défilement horizontal) ; captures `web/e2e/screenshots/composants-*.png`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `web/src/styles/tokens.primitives.css` | valeurs Radix Colors (clair `-n`, sombre `-dn`) et échelles Open Props ; jamais utilisées dans les vues |
| `web/src/styles/tokens.css` | jetons sémantiques : clair, sombre (`prefers-color-scheme` ou `[data-theme='dark']`, `[data-theme='light']` force le clair), contraste élevé clair et sombre |
| `web/src/style.css` | base, composants, couleurs forcées (`forced-colors`), mode simple, impression |
| `web/src/components.ts` | gabarits des composants (chaînes HTML échappées, à passer par `html` de `trusted.ts`) |
| `web/src/chart-theme.ts` | thème ECharts construit depuis les jetons, enregistré par `charts.ts` dans le module ECharts différé |
| `web/src/glossary.ts` | nomenclature : périodes, catégories, unités, comparaisons, dates et heures |
| `web/src/tokens.test.ts` | contraste de chaque paire texte / fond et des éléments graphiques, dans 7 thèmes |

## Jetons

Seuls les jetons sémantiques sont utilisés dans les vues (`var(--…)` en CSS, `cssVar('--…')` en
TypeScript).

| Famille | Jetons |
|---|---|
| Surfaces | `--surface-page`, `--surface-card`, `--surface-sunken`, `--surface-raised` (menus, infobulles) |
| Lignes | `--border`, `--border-strong` (contour des champs, 3:1), `--grid` (quadrillage des graphiques) |
| Texte | `--text`, `--text-muted` |
| Accent (iris) | `--accent`, `--accent-hover`, `--accent-text` (liens), `--accent-soft`, `--accent-ink`, `--focus` |
| Usages | `--usage-heating` (orange, chauffage seulement), `--usage-water` (bleu, eau chaude seulement), `-text` et `-soft` de chacun, `--usage-other`, `--usage-standby` |
| Séries | `--series-measure` (une mesure), `--series-reference` (souscrit, attendu), `--year-0` … `--year-3` (0 = année ou saison en cours), `--room-1` … `--room-8`, `--seq-1` … `--seq-5` |
| États | `--state-good`, `--state-warn`, `--state-bad`, `--state-info` et leur `-soft` |
| Échelles | `--space-1` … `--space-7` (4 px), `--radius-sm/md/lg/full`, `--font-xs` … `--font-2xl`, `--shadow-1`, `--shadow-3`, `--target-min` (44 px), `--ease-out`, `--duration-1/2`, `--content-max` |

Corrections faites au validateur de contraste (`tokens.test.ts`) par rapport aux valeurs Radix
brutes : chauffage en clair = orange **10** (`#ef5f00`, l'orange 9 fait 2,97:1 sur blanc), attention
et erreur assombries (`#8f5500`, `#b8290d`) pour tenir 4,5:1 sur leur fond pâle, survol de
l'accent sombre `#4b4bc0` (texte blanc à 4,5:1). Sur un fond `-soft`, le texte est `--text`.

Couleurs par sens (#300) : une pièce garde sa couleur, fixée par son rang parmi les pièces chauffées
du logement (ordre des données, avant la vue foyer) ; « Chambres » prend celle de sa première
chambre ; le chauffe-eau porte le bleu de l'eau chaude ; les années et saisons suivent la rampe
iris → gris (`--year-0` = en cours) dans tous les écrans ; orange et bleu ne servent plus à rien
d'autre.

## Composants (`components.ts`)

Tous rendent du HTML où chaque valeur est échappée ; les paramètres « HTML » (`body`, `action`…)
doivent déjà être sûrs. Couleur : un nom de jeton (`'--usage-heating'`) ou une couleur calculée.

| Composant | Fonction | Notes d'accessibilité |
|---|---|---|
| Carte | `card({ title, sub, tag, variant: 'sim' \| 'off', body, how })` | `section` nommée par son titre ; « Comment c'est calculé » repliable |
| Tuile chiffrée | `tile({ label, value, sub })` + `comparison(p, vs)` | comparaison toujours explicite : « ▼ −16 % vs nov. 2025 au 8 » (flèche + texte, jamais la couleur seule) |
| Jauge | `gauge({ label, value, max, expected, projected, color, scale })` | `role="img"` + phrase complète ; repère « attendu », projection hachurée |
| Barre de part | `shareBar(pct, color)` | décorative (`aria-hidden`), la valeur est écrite à côté |
| Liste | `list(rows)`, `listRow({ title, sub, value, color, share, href \| attrs })` | ligne ≥ 56 px ; lien, bouton ou ligne simple |
| Tableau en cartes | `cardTable(head, rows, label)` | une carte par ligne, la première cellule en titre, les autres sous le nom de leur colonne (liste de définitions) ; pour un tableau dont aucune colonne ne doit se cacher derrière un défilement (#484 : ce qui part chez des tiers) ; le bloc porte `data-whole`, que le balayage vérifie (`colonne-cachee`) |
| Segment | `seg(name, value, options, label)` | `role="radiogroup"` ; passe à la ligne au lieu de déborder (#319) |
| Sélecteur de période | `periodBar(segHtml, scope)` | ligne de portée annoncée (`aria-live`) |
| Puce | `chip(label, pressed, attrs, swatch)` | `aria-pressed`, 44 px |
| Interrupteur | `switchField(label, checked, attrs, { sub, swatch })` | case à cocher `role="switch"` : même évènement `change` ; le seul contrôle oui / non de l'application (#317 : remplace `.toggle` et `.check`), détail gris `sub`, pastille `swatch` (une pièce) |
| Choix unique | `radioField(label, checked, attrs)` | bouton radio natif (même évènement `change`), 44 px ; pour un choix exclusif lu dans un formulaire |
| Alerte | `alert('info' \| 'warn' \| 'bad' \| 'good', title, text, action)` | icône + mot ; `role="alert"` pour une erreur, `note` sinon |
| Alerte (contenu riche) | `alertHtml(kind, html, attrs)` | même rendu ; contenu déjà sûr (gras, lien, actions `p.alert-actions`) ; `attrs` donne un `id` ou remplace le rôle (`status` pour un message d'état) ; #317 : remplace `.notice`, `.stale`, `.settings-msg` |
| Message de formulaire | `formMsg(text, attrs)` | zone vivante (`role="alert"`) près du bouton, vide tant qu'aucune action ne l'a remplie (verrouillage, identifiants) |
| États | `stateBlock('empty' \| 'loading' \| 'error' \| 'offline', text, action)` | `role="status"` (ou `alert`), `aria-busy` au chargement ; les cartes différées (`lazy.ts`) gardent leurs messages |
| Attente, ligne d'état (#579) | `waiting(quoi, classe, balise)`, `statusLine(texte, classe, balise)`, `loadingText(quoi)` | `role="status"` : « Chargement… » n'est écrit qu'ici (`attente.test.ts`) ; la zone qui attend porte `aria-busy` quand elle est à nous (`lazyView`) ; même apparence que les lignes `hint muted` qu'elles remplacent |
| Panneau « maintenant » | `nowPanel({ temp, facts })` | liste de définitions |
| Planning 24 h | `scheduleBand({ slots, offPeak, now, label })` | `role="img"` + phrase listant les créneaux ; heures creuses hachurées |
| Légende | `legend([{ label, color, kind: 'swatch' \| 'hatch' \| 'line' }])` | hachure = période partielle, trait pointillé = référence |
| Boutons | classes `btn primary`, `btn secondary`, `btn tertiary` | 44 px, focus 3 px `--focus` |

Toutes les cibles font au moins 44 px (`--target-min`), le focus est un contour de 3 px.

**Garde-fous (#317)** : `web/src/design-usage.test.ts` échoue si une couleur ou une taille de
police écrite en dur (hors jetons `styles/tokens*.css`) apparaît dans une feuille de style ou une
vue — la liste blanche (`ALLOWED`, neuf entrées : taille de base de la page, manifeste, QR code,
couleurs résolues d'ECharts) donne la raison de chacune et échoue si l'une n'est plus utilisée —,
et si une ancienne classe (`notice`, `stale`, `error`, `ok`, `ko`, `toggle`, `check`,
`settings-msg`) revient dans une vue ou une feuille (`.pill.ok` reste l'état « bon » d'une pastille).

## Graphiques

`charts.ts` enregistre un thème ECharts unique (`chart-theme.ts`) dans le module ECharts chargé à
la demande (`echarts-lib.ts`, rien d'ajouté au premier écran). La clé du thème change avec le mode
clair / sombre, le contraste et la taille du texte du système : un graphique créé sous un autre
thème est recréé. Le thème fixe la palette (pièces), les axes, la légende, les infobulles et la
taille des textes (`--font-xs`, au moins 11 px, qui suit le texte du système).

#319 : nombre de graduations adapté à la hauteur ou à la largeur, étiquettes qui se masquent au lieu
de se chevaucher, étiquettes de fin de courbe dans la zone du graphique (marge droite calculée,
légende classique si les noms prendraient plus d'un tiers de la largeur), noms des pièces des barres
horizontales sur plusieurs lignes. Les tableaux défilent dans leur carte avec la première colonne
figée et une ombre qui signale la suite.

## Nomenclature (`glossary.ts`)

| Fonction | Exemple |
|---|---|
| `PERIOD` | « Ce mois-ci », « Depuis le 1er janvier », « 12 derniers mois », « 30 derniers jours », « Saison de chauffe », « L'an dernier », « Fin d'année estimée » |
| `CATEGORY`, `UNIT` | « Eau chaude » (usage) / « Chauffe-eau » (appareil), « Autres usages », « Veille » ; « kg CO₂e » |
| `vsLabel(from, to)` | « vs nov. 2025 au 8 », « vs 2025 à date », « vs les 12 mois précédents » |
| `dayLong`, `dayShort`, `monthLong`, `monthShort` | « 1er août 2026 », « 8 nov. », « novembre 2026 » |
| `hour`, `hourMin`, `hourRange` | « 19 h », « 19 h 30 », « 22 h – 7 h » |
| `seasonLabel` | « 2025–2026 » |
| `localDay`, `localDateTime` | jour et heure **locaux** (plus de date UTC ni ISO à l'écran) |

Remplacements faits dans l'appli : « vs N-1 » → comparaison explicite, « pas de référence N-1 » →
« pas de comparaison avec l'an dernier », « N-1 incomplète » → « an dernier incomplet », « Fin 2026
estimée » → « Fin d'année estimée », dates sans « 1er » → avec, heures « 19h » → « 19 h », heure de
mise à jour « 12:34 UTC » → heure locale, « Générée le 2026-11-09 » → date en toutes lettres,
« kgCO₂e » → « kg CO₂e ». On garde « 1er » (et non « 1ᵉʳ ») : même rendu partout et lu
correctement par les lecteurs d'écran.

## Contraste mesuré (`tokens.test.ts`)

Ratio minimal entre toutes les paires de texte testées (texte et texte secondaire sur les quatre
surfaces, liens, accent, usages, états sur carte, page et fond pâle) :

| Thème | Texte, minimum | Exigence | Éléments graphiques, minimum (exigence 3:1) |
|---|---|---|---|
| Clair (et clair forcé sur système sombre) | 4,51:1 | AA 4,5:1 | 3,26:1 |
| Sombre (système ou `data-theme`) | 5,37:1 | AA 4,5:1 | 3,28:1 |
| Contraste élevé clair | 10,15:1 | AAA 7:1 | 4,77:1 |
| Contraste élevé sombre (système ou `data-theme`) | 11,67:1 | AAA 7:1 | 8,61:1 |

Éléments graphiques : usages, couleurs des pièces, année en cours, mesure, accent, focus, contour
des champs, sur les cartes. Le test affiche ces minimums à chaque exécution
(`npx vitest run src/tokens.test.ts`). En plus, axe (`color-contrast`, et `color-contrast-enhanced`
en contraste élevé) passe sur l'appli et sur la page de démonstration.

## Étape 2 (navigation, #308 #309 #257 #258)

Fait : barre d'onglets et en-tête (pastille d'état, ⚙), sous-pages avec flèche retour et adresse
(`web/src/router.ts`), registre des pages (`web/src/pages.ts`), délégation unique des événements
(`web/src/events.ts`), centre de paramètres à 8 pages avec portée « foyer » / « ce téléphone »,
`fmt1` (glossary.ts) et `downloadBlob` (download.ts) partagés.

## Reste à faire (étape 3)

Barre d'onglets et en-tête de la maquette, feuille (bottom sheet) et dialogue, sélecteur de période
unique par écran avec sa feuille, centre de paramètres, page Pièce : les composants sont prêts, la
navigation ne change pas dans cette étape.
