# Design system v1.6 — proposition

*Novembre 2026. Fondé sur l'[inventaire](inventaire.md) (S-7.14) et l'[audit d'utilisabilité](audit-ux.md).
Le propriétaire a autorisé une **remise en cause complète** du design actuel : ce document compare
d'abord des systèmes existants (§ 1), en retient une base (§ 2), puis définit les jetons (§ 3), les
composants (§ 4) et les règles d'accessibilité (§ 5). Les [maquettes](maquettes/index.html) appliquent
cette direction ; leur feuille [`maquettes/ds.css`](maquettes/ds.css) est le prototype des jetons.*

## 1. Banc d'essai (benchmark)

Contraintes du projet : PWA **Vite + TypeScript sans framework**, HTML produit par gabarits, **CSP
stricte et Trusted Types** (S-8.5, S-8.9), **budget de taille** en CI (281 kB gzip pour le script
d'entrée ; la feuille actuelle pèse 6,6 kB gzip), **ECharts** pour 11 types de graphiques, interface en
**français**, accessibilité WCAG 2.2 AA (AAA en contraste élevé), mode sombre, contraste élevé,
couleurs forcées, mode simple FALC, texte système à 200 %.

| Critère | **DSFR** (État français) | **GOV.UK Frontend** | **Web Awesome** (ex-Shoelace) | **Open Props** | **Radix Colors** | **Pico CSS** | **Material 3** (Material Web) |
|---|---|---|---|---|---|---|---|
| Nature | design system complet (CSS + JS + gabarits) | design system complet (Sass + JS) | composants Web Components (Lit) + thèmes | jetons CSS seuls (variables) | palettes de couleurs (12 crans) | feuille de style « sans classes » | composants Web Components + jetons |
| Aspect | institutionnel, marque de l'État | institutionnel, très sobre | moderne, soigné, thèmes variés | neutre (on construit dessus) | neutre, couleurs justes | sobre, agréable | Android, arrondi, coloré |
| Facilité d'usage pour un foyer | très bonne (formulaires, textes) | excellente (recherche usagers) | bonne | dépend de nous | dépend de nous | bonne | bonne |
| Accessibilité | conçu pour le RGAA, composants audités | WCAG 2.2 AA, recherche publique | annoncée « built with accessibility in mind » | n/a (jetons) ; à nous | contrastes pensés par cran (texte sur fond) | correcte, contraste par défaut | correcte |
| Mode sombre | oui (`data-fr-scheme`) | **non** (forced-colors seulement) | oui, thème sombre officiel | oui (normalize clair / sombre) | oui, chaque échelle a sa version sombre | oui, automatique | oui |
| Poids | lourd (CSS complet + icônes + police Marianne) | moyen (Sass, ne garder que l'utile) | runtime Lit + chaque composant, Shadow DOM | ≈ 21,6 kB gzip complet, **quelques kB** avec import partiel ou JIT | < 1 kB par échelle | ≈ 10-13 kB gzip | lourd |
| Licence | Etalab 2.0, **usage réservé aux administrations et aux domaines .gouv.fr** ; police Marianne à part | MIT (code), marque de la Couronne exclue | MIT (cœur gratuit), Pro payant | MIT | MIT | MIT (nom et logo exclus) | Apache 2.0 |
| Jetons de thème | oui (couleurs de la marque) | Sass | oui, propriétés CSS | **c'est le produit** | **c'est le produit** | propriétés CSS | oui, propriétés CSS |
| Graphiques ECharts | aucun lien | aucun | aucun | variables lisibles par `getComputedStyle` (comme `cssVar()` aujourd'hui) | idem, palettes catégorielles et séquentielles à composer | aucun | aucun |
| Français | **natif** (textes, règles de rédaction) | anglais (règles de rédaction exemplaires) | anglais, traductions | sans objet | sans objet | sans objet | anglais |
| CSP / Trusted Types | JS propre au DSFR à auditer | JS léger | Shadow DOM, styles adoptés : compatible mais à tester | **aucun JS** | **aucun JS** | aucun JS | Shadow DOM |
| Maintenance (nov. 2026) | active (v1.14 / 1.15) | active | active (successeur de Shoelace, qui est en LTS) | active | active | **archivé : v2.1.1 « dernière version »** | **mode maintenance** annoncé par Google |
| Verdict | **interdit** (pas une administration) ; on s'en inspire pour le contenu et les patrons de formulaires | inspiration (contenu, formulaires, messages d'erreur), pas de mode sombre | possible mais surdimensionné, et remplacerait nos gabarits par des composants à apprendre | **retenu comme socle des échelles** | **retenu pour les couleurs** | écarté (archivé) | écarté (maintenance, look Android) |

Références « tableaux de bord énergie / données » regardées pour les graphiques : la palette validée
de l'actuel `charts.ts` (ordre testé pour les daltoniens), les recommandations d'ECharts sur les
**motifs** (`aria.decal`) et sur les thèmes (`registerTheme`), et les règles d'accessibilité des
graphiques du GOV.UK Design System (texte d'abord, tableau en alternative).

## 2. Recommandation : un système maison léger, sur Open Props + Radix Colors

**Proposition : « système Foyer » = nos propres composants CSS (sans framework, sans Shadow DOM),
construits sur les échelles d'Open Props (espacements, tailles, rayons, ombres, courbes
d'animation) et les palettes de Radix Colors (gris chaud « sand », accent « iris », usages
« orange » et « blue », états « grass », « amber », « tomato »), avec les règles de rédaction et
les patrons de formulaires du DSFR et de GOV.UK comme référence (pas leur code).**

Pourquoi :

1. **Zéro JavaScript ajouté**, donc rien à revoir pour la CSP et les Trusted Types, et un coût de
   quelques kilo-octets : on n'importe que les variables utilisées (import partiel ou
   `postcss-jit-props`), ou on recopie les valeurs dans `tokens.css` en citant la source.
2. **Les échelles résolvent les constats de l'inventaire** (19 tailles de texte, 6 rayons, 30 marges
   uniques) sans réinventer des valeurs.
3. **Radix Colors donne des couleurs par rôle** (fond d'application, fond de composant, bordure,
   texte peu contrasté, texte très contrasté) **en clair et en sombre**, ce qui remplace nos
   4 redéfinitions à la main ; la variante contraste élevé se dérive en prenant les crans 11-12.
4. **Nos composants restent nos gabarits HTML** (`ui.ts`, `seg()`, `table()`…) : la migration se fait
   vue par vue, sans réécrire la logique, et les tests e2e et axe restent valables.
5. **Indépendance** : deux dépendances de **données** (des valeurs), sous licence MIT, remplaçables ;
   pas de bibliothèque de composants qui pourrait passer en maintenance (Pico, Material Web).

Ce qui est écarté et pourquoi : DSFR (réservé aux administrations), Web Awesome (excellente qualité,
mais un runtime Lit, du Shadow DOM à concilier avec Trusted Types et un vocabulaire de composants à
apprendre pour une appli d'une quinzaine de composants), Pico (archivé), Material 3 (maintenance,
identité Android peu adaptée à un tableau de bord sobre), GOV.UK (pas de mode sombre).

## 3. Jetons

Trois niveaux : **primitifs** (valeurs Radix / Open Props), **sémantiques** (rôle : `--surface-card`,
`--text-muted`, `--usage-heating`…), **composants** (rares : `--tab-height`). Seuls les jetons
sémantiques sont utilisés dans les vues. Les valeurs ci-dessous sont celles de Radix Colors (à
contrôler au validateur de contraste lors de S-7.18).

### 3.1 Couleurs d'interface

| Jeton sémantique | Clair | Sombre | Rôle |
|---|---|---|---|
| `--surface-page` | sand 2 `#f9f9f8` | sand 1 `#111110` | fond de page |
| `--surface-card` | blanc `#ffffff` | sand 2 `#191918` | cartes |
| `--surface-sunken` | sand 3 `#f1f0ef` | sand 3 `#222221` | champs, pistes de segments |
| `--border` | sand 6 `#dad9d6` | sand 6 `#3b3a37` | bordures |
| `--text` | sand 12 `#21201c` | sand 12 `#eeeeec` | texte principal |
| `--text-muted` | sand 11 `#63635e` | sand 11 `#b5b3ad` | texte secondaire (≥ 4,5:1 sur cartes) |
| `--accent` | iris 9 `#5b5bd6` | iris 9 `#5b5bd6` | bouton principal, onglet actif |
| `--accent-text` | iris 11 `#5753c6` | iris 11 `#b1a9ff` | liens, texte d'accent |
| `--accent-soft` | iris 3 `#f0f1fe` | iris 3 `#202248` | fond de l'onglet actif, puce sélectionnée |
| `--focus` | iris 8 + anneau 3 px | iris 8 | contour de focus |

**Accent iris (bleu-violet)** à la place de l'orange brûlé : l'orange est réservé au chauffage et le
bleu à l'eau chaude (constat C1 de l'audit) ; l'iris ne se confond avec aucun usage ni état.

### 3.2 Couleurs de données (un sens = une couleur)

| Jeton | Clair (cran 9 / texte cran 11) | Sens réservé |
|---|---|---|
| `--usage-heating` | orange `#f76b15` / `#cc4e00` | **chauffage**, uniquement |
| `--usage-water` | blue `#0090ff` / `#0d74ce` | **eau chaude**, uniquement |
| `--usage-other` | sand 8 `#bcbbb5` | autres usages |
| `--usage-standby` | sand 10 `#82827c` + hachures | veille |
| `--series-measure` | sand 12 (trait) | une mesure isolée (puissance, température mesurée) |
| `--series-reference` | sand 9, pointillé | référence (puissance souscrite, signature, attendu) |
| `--year-0` … `--year-3` | iris 9, iris 7, sand 9, sand 7 | **années** : la plus récente en iris plein, puis éclaircies ; jamais orange ni bleu |
| `--room-1` … `--room-8` | sarcelle, cramoisi, jaune, prune, herbe, brun, cyan, rouge (Radix), **sans** orange, bleu ni iris ; deux pièces à ΔE*ab ≥ 20 entre elles et des usages, dans chaque thème (#399, `tokens.test.ts`) | pièces, une couleur fixe par pièce (`roomColor`) ; un module de la station prend celle de sa pièce (`moduleColor`), l'extérieur `--series-reference` pointillé |
| `--seq-1` … `--seq-5` | rampe d'encre sand 4 → 12 (clair), inversée en sombre (#409 : jamais l'iris de l'accent, réservé aux actions et à la sélection) | calendrier, cartes de chaleur, CO₂ |
| `--state-good` / `--state-warn` / `--state-bad` / `--state-info` | grass 11 `#2a7e3b` · amber 11 `#ab6400` · tomato 11 `#d13415` · iris 11 | baisse / attention / hausse ou erreur / information |

Règles : rouge = « plus de dépense », vert = « moins de dépense » ; pour une **température** on
n'utilise ni rouge ni vert, mais la rampe ou le texte (« +1,2 °C »). Toute série a aussi un motif ou
un libellé direct (inventaire § 7, `decal`).

### 3.3 Typographie (6 crans, 2 graisses)

Police système (inchangée, aucune police web). Base = taille du système (100 %, 16 px par défaut,
au lieu de 93,75 %) pour la persona senior (#22).

| Jeton | Taille | Interligne | Emploi |
|---|---|---|---|
| `--font-xs` | 0,8125 rem (13 px) | 1,4 | badges, axes de graphique (minimum) |
| `--font-sm` | 0,875 rem (14 px) | 1,45 | aides, légendes, libellés de tuiles |
| `--font-md` | 1 rem (16 px) | 1,5 | texte, boutons, champs |
| `--font-lg` | 1,125 rem (18 px) | 1,35 | titres de carte |
| `--font-xl` | 1,375 rem (22 px) | 1,25 | titre de page, verdict |
| `--font-2xl` | 2 rem (32 px) | 1,1 | chiffre clé des tuiles |

Graisses : 400 et 600 (plus de 500 ni 650). Chiffres `tabular-nums` partout où ils sont alignés.
Graphiques : tailles **dérivées de `--font-xs` / `--font-sm`** lues au rendu (`getComputedStyle`),
donc sensibles au texte système. Mode simple : `--font-md` passe à 1,25 rem par redéfinition du jeton.

### 3.4 Espacements, rayons, élévation, mouvement (Open Props)

| Famille | Jetons |
|---|---|
| Espacements (grille de 4 px) | `--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-5` 24 · `--space-6` 32 · `--space-7` 48 |
| Rayons | `--radius-sm` 6 (champs, puces) · `--radius-md` 10 (boutons, tuiles) · `--radius-lg` 16 (cartes, feuilles) · `--radius-full` |
| Élévation | `--shadow-1` (cartes, clair seulement) · `--shadow-3` (menus, feuilles) ; en sombre, une bordure remplace l'ombre |
| Cibles | `--target-min` 44 px (tous les contrôles tactiles) |
| Mouvement | `--ease-out` (Open Props `--ease-out-3`), durées 120 / 200 ms ; **nul** sous `prefers-reduced-motion` |
| Mise en page | `--content-max` 1 100 px ; rupture unique à 760 px (onglets en haut, 2 colonnes pour les pages de cartes indépendantes : Compteur, Air et confort, #408) ; paragraphes limités à 70 ch (~75 caractères, WCAG 1.4.8) |

## 4. Composants

| Composant | Anatomie | Variantes | Remplace (inventaire § 5) |
|---|---|---|---|
| **Barre d'onglets** | 5 boutons icône + libellé, `aria-current="page"`, fond `--accent-soft` sur l'actif ; sur téléphone, libellé de l'actif en graisse normale (il tient dans son onglet à 320 px, #434) | bas (mobile), haut (≥ 760 px) | `.tabs` |
| **En-tête** | titre, **pastille d'état** (point coloré + « Données du 8 nov. »), bouton ⚙ ; en sous-page : flèche retour + titre | page, sous-page | `.top`, menu ⋮ |
| **Carte** | titre (`--font-lg`), sous-titre gris (période · source), contenu, pied « Comment c'est calculé » | standard, **simulation** (bordure pointillée + étiquette « Simulation »), **à activer** (grise, action) | `.card` (défini 2 ×), sous-cartes |
| **Tuile chiffrée** | libellé, chiffre (`--font-2xl`), ligne d'écart (▲▼ + texte « que l'an dernier ») | standard, mise en avant, compacte (grille 2 × 2) | `.kpi` |
| **Verdict** | icône d'état (forme + couleur), phrase, détail ; **seulement** pour le verdict du mois | moins / comme d'habitude / plus | `.verdict` |
| **Alerte** | icône, titre court, texte, action | info, attention, erreur, succès ; repliable ; groupe d'alertes | `.verdict` détourné, `.stale`, `.notice`, `.error`, `.settings-msg`, `.ok/.ko` |
| **Sélecteur de période** | puce « 12 derniers mois ▾ » → feuille avec les libellés du § 4.1 de l'architecture + « Choisir des dates » | — | `select` de période, `.seg` Jour/Sem./Mois/An (passent dans la feuille, #20) |
| **Segment** | 2 à 4 options, `role=radiogroup` | — | `.seg` (bon modèle, gardé) ; **retour à la ligne** au lieu de déborder à 200 % |
| **Puces** | filtres multiples (années), `aria-pressed` | — | `.chip` |
| **Liste** | ligne = titre + sous-titre + valeur à droite + chevron | navigation, réglage (valeur), interrupteur | listes de pièces, de sources, de paramètres |
| **Tableau** | en-têtes fixes, colonne 1 figée, **ombre de défilement** visible | simple, repliable « Voir les valeurs » | `.table-wrap` |
| **Graphique** | titre de carte, résumé en une phrase au-dessus, graphique, légende **directe** (étiquettes en bout de série), tableau en repli | barres, courbes, aires, nuage, calendrier, cascade | `.chart` + hauteurs en ligne |
| **Formulaire** | libellé au-dessus, aide sous le libellé, champ 44 px, erreur sous le champ (texte + icône), bouton principal en bas | texte, nombre avec unité, date (format français), sélection, interrupteur | 4 façons de libeller, `.toggle` / `.check` |
| **Boutons** | principal (accent plein), **secondaire** (contour), tertiaire (texte), destructif | normal, petit | `.primary`, `.link`, bouton natif gris |
| **Feuille** (bottom sheet) / **dialogue** | poignée, titre, contenu, actions ; focus piégé, Échap, retour au déclencheur | feuille (mobile), dialogue centré (bureau) | menu ⋮, panneaux `details` |
| **État vide / à activer** | icône, phrase, action | vide, à activer, hors ligne, erreur | `.empty`, cartes absentes |
| **Pastille de couleur** | carré 12 px + motif | — | `.swatch`, `.share-legend i`, `.tt-key` (3 → 1) |
| **Terme du glossaire** | mot souligné pointillé → info-bulle accessible | tous modes | `.term` (mode simple seulement) |

## 5. Règles d'accessibilité (contrôlées en CI)

1. Contraste : texte ≥ 4,5:1 (≥ 7:1 en `prefers-contrast: more`), éléments graphiques ≥ 3:1, en clair
   **et** en sombre ; axe-core avec `color-contrast` et `color-contrast-enhanced`.
2. Jamais la couleur seule : ▲ ▼ + mot, motifs dans les graphiques, libellés directs.
3. Cibles ≥ 44 px ; texte système à 200 % sans défilement horizontal à 360 px (nouveau test e2e).
4. Chaque graphique : résumé textuel (S-7.2) **visible** au-dessus et tableau en repli.
5. Focus visible 3 px `--focus`, ordre logique, Échap ferme feuilles et dialogues, focus rendu au
   déclencheur ; en ouvrant une sous-page, le focus va sur son titre.
6. `prefers-reduced-motion`, `forced-colors` (mots-clés système), `prefers-contrast` gérés par jetons.
7. Langage : phrases de 20 mots au plus (15 en mode simple), glossaire partout, dates et heures
   locales, sigles expliqués. **Aucune césure à 100 % de texte** (#407, #434) : un mot passe entier
   à la ligne ; la coupe par trait n'est permise qu'en gros texte (dès ~120 %), où un mot peut ne
   plus tenir sur sa ligne (titres, noms de liste, libellés d'interrupteur). Le balayage
   (`web/e2e/sweep.mjs`, « mot-coupe ») le vérifie.
8. **Aucune couleur, taille, marge ou rayon hors jetons** : un test (grep sur `style.css` et les
   gabarits) échoue sur un `#hex`, un `px` de taille de police ou un `style=` hors liste blanche.

## 6. Organisation des fichiers proposée

```
web/src/styles/
  tokens.primitives.css   # valeurs Radix Colors + Open Props retenues (sources citées)
  tokens.css              # jetons sémantiques, clair / sombre / contraste élevé / couleurs forcées
  base.css                # reset léger, typographie, focus
  components/*.css        # un fichier par composant du § 4
web/src/ui/               # gabarits TypeScript des composants (card(), tile(), alert(), sheet()…)
```

ECharts : un thème unique `registerTheme('foyer', …)` construit à partir des jetons à chaque
changement de thème, au lieu des couleurs passées graphique par graphique.

## Sources

- DSFR : dépôt [GouvernementFR/dsfr](https://github.com/GouvernementFR/dsfr) (licence, conditions
  d'utilisation réservées aux administrations, `data-fr-scheme` pour le mode sombre) ;
  [Système de design, info.gouv.fr](https://www.info.gouv.fr/organisation/service-d-information-du-gouvernement-sig/systeme-de-design) ;
  [Légifrance et le DSFR](https://www.info.gouv.fr/actualite/legifrance-et-le-dsfr-comment-faciliter-l-acces-au-droit) (thème clair / sombre).
- GOV.UK Frontend : [alphagov/govuk-frontend](https://github.com/alphagov/govuk-frontend) (MIT,
  documentation sous Crown copyright / OGL).
- Web Awesome : [shoelace-style/webawesome](https://github.com/shoelace-style/webawesome) (MIT, thème
  sombre, Lit) ; [Shoelace](https://shoelace.style/) en maintenance ;
  [comparaison Web Awesome / Shoelace](https://blog.fontawesome.com/how-does-web-awesome-stack-up-against-shoelace/).
- Open Props : [argyleink/open-props](https://github.com/argyleink/open-props) ; taille du paquet
  ([depscope](https://depscope.dev/pkg/npm/open-props)) ; [CSS-Tricks](https://css-tricks.com/tag/design-token/).
- Radix Colors : [documentation (alias, rôles des crans)](https://radix-ui.com/colors/docs/overview/aliasing),
  [Radix Themes, couleurs](https://www.radix-ui.com/themes/docs/theme/color).
- Pico CSS : [picocss/pico](https://github.com/picocss/pico) (dépôt archivé, v2.1.1 « dernière version »),
  [picocss.com](https://picocss.com/).
- Material Web : [annonce du mode maintenance (#5642)](https://github.com/material-components/material-web/discussions/5642),
  [9to5Google](https://9to5google.com/2024/06/25/material-web-components/).
- Interne : [inventaire.md](inventaire.md), [audit-ux.md](audit-ux.md), `web/src/charts.ts`,
  `web/scripts/size-budget.mjs`.

Valeurs de couleurs relevées dans les palettes publiées de Radix Colors ; à recontrôler au
validateur de contraste avant adoption (S-7.18). Lecture des sources : 9 novembre 2026.
