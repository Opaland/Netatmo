# Inventaire de l'interface (composants, couleurs, typographie)

*Récit S-7.14 (#184), novembre 2026, sur la base de `main` après la v1.4 (Trusted Types, accessibilité
en CI, mode simple FALC). Document d'entrée du **design system de la v1.6** : il décrit ce qui
existe, sans rien changer. Chaque valeur est relevée dans le code ; les numéros de ligne renvoient à
[`web/src/style.css`](../../web/src/style.css) au moment de l'inventaire.*

Méthode : lecture de `style.css` (≈ 1 300 lignes, une seule feuille), des gabarits HTML des vues
(`web/src/views/*.ts`, `main.ts`, `ui.ts`, `anon.ts`, `report-sections.ts`) et des options ECharts
(`web/src/charts.ts`). Les comptes (« 15 × ») viennent d'un `grep` sur ces fichiers.

## 1. Captures de référence

Les captures sont produites par le test de bout en bout (`cd web && npm run build && npm run e2e`)
dans `web/e2e/screenshots/`, et publiées par la CI comme artefact **`captures-demo`** de chaque
exécution du job `e2e` (gardé 7 jours). Toutes partent des données de démonstration.

| Contexte | Appareil | Vues capturées (`<contexte>-<vue>.png`) |
|---|---|---|
| `mobile-clair` | iPhone 13, clair | overview, compare, rooms, analyse, comfort, report, report-anonymise, settings, **simple-200** (mode simple, texte système à 200 %) |
| `mobile-sombre` | Pixel 7, sombre | mêmes vues (sans simple-200) |
| `bureau` | 1 280 × 900, clair | mêmes vues |
| `mobile-360` | 360 × 740 (Android d'entrée de gamme) | comfort, report, report-anonymise, settings |
| `contraste-clair` | bureau, `prefers-contrast: more` | overview, compare (audités en 7:1), rooms, analyse, comfort |
| `contraste-sombre` | Pixel 7, sombre + contraste élevé | idem |
| `couleurs-forcees` | bureau, `forced-colors: active` | idem |
| `hors-ligne` | bureau, réseau coupé | analyse (bandeau hors ligne) |

Manques à combler en v1.6 : bureau en sombre, vue Paramètres en contraste élevé, mode simple en
sombre et en contraste élevé.

## 2. Jetons de couleur (propriétés personnalisées CSS)

Une seule famille de jetons, déclarée dans `:root` (l. 1-36) et redéfinie trois fois : sombre
(`prefers-color-scheme: dark`, l. 38-72), contraste élevé clair (l. 1071-1095) et contraste élevé
sombre (l. 1113-1139).

| Jeton | Clair | Sombre | Contraste élevé clair | Contraste élevé sombre | Rôle |
|---|---|---|---|---|---|
| `--surface-0` | `#f4f3f0` | `#111110` | `#ffffff` | `#000000` | fond de page, champs |
| `--surface-1` | `#fcfcfb` | `#1a1a19` | `#ffffff` | `#000000` | cartes, tuiles, bandeaux |
| `--surface-raised` | `#ffffff` | `#242422` | `#ffffff` | `#0d0d0c` | menu, info-bulles |
| `--border` | `#e2e1dc` | `#33332f` | `#5c5b57` | `#a3a29a` | bordures |
| `--grid` | `#ecebe7` | `#2a2a27` | `#b5b3ad` | `#4d4d48` | grilles des graphiques, squelette |
| `--text-primary` | `#0b0b0b` | `#f0efec` | `#000000` | `#ffffff` | texte |
| `--text-secondary` | `#52514e` | `#c3c2b7` | `#262624` | `#e6e5df` | sous-titres, légendes |
| `--text-muted` | `#6b6963` | `#9a998f` | `#3a3936` | `#d2d1c9` | notes (4,9:1 sur `--surface-0`) |
| `--accent` | `#c2410c` | `#f97316` | `#8f2f0a` | `#fdba74` | bouton principal, onglet actif, pièce épinglée |
| `--accent-ink` | `#ffffff` | `#111110` | `#ffffff` | `#000000` | texte sur l'accent |
| `--ghost` | `#c9c7c0` | `#4a4a45` | `#8d8b84` | `#77766f` | « autres usages », reste de jauge |
| `--good` | `#0f7a0f` | `#4cc24c` | `#0a520a` | `#86e086` | baisse, OK |
| `--bad` | `#b42323` | `#f07070` | `#8a1717` | `#ffa3a3` | hausse, alerte, erreur |
| `--cat-heating` | `#eb6834` | `#d95926` | `#c2410c` | `#f6894f` | usage chauffage |
| `--cat-water` | `#2a78d6` | `#3987e5` | `#1c5cab` | `#7ab3f2` | usage chauffe-eau |
| `--series-1` … `--series-8` | bleu `#2a78d6`, orange `#eb6834`, vert `#1baf7a`, jaune `#eda100`, rose `#e87ba4`, vert foncé `#008300`, violet `#6250d6`, rouge `#e34948` | variantes plus sombres (l. 56-63) | variantes 7:1 (l. 1088-1095) | variantes claires (l. 1130-1137) | palette catégorielle (ordre validé pour daltoniens sur paires voisines) |
| `--seq-1` … `--seq-5` | `#cde2fb` → `#0d366b` | `#1f2a3a` → `#cde2fb` (inversée) | **non redéfinie** | **non redéfinie** | rampe séquentielle bleue (calendrier, carte horaire, CO₂) |
| `--radius` | `14px` | — | — | — | rayon des cartes |
| `--shadow` | double ombre douce | `none` | — | — | ombre des cartes |

### Couleurs hors jetons (à résorber en v1.6)

| Où | Valeur | Remarque |
|---|---|---|
| `.verdict-icon` (l. 686) | `color: #fff` | Blanc fixe sur `--text-muted`, `--good` ou `--bad` : 5,5:1 en clair mais **2,9:1, 2,3:1 et 2,9:1 en sombre** (icône décorative `aria-hidden`, donc non signalée par axe ; le sens est aussi dans le titre) |
| Menu et info-bulles (l. 255, 344) | `box-shadow: 0 8px 30px rgb(0 0 0 / 0.15)` | Ombre propre, différente de `--shadow` |
| Impression (l. 804) | `#fff` / `#000` `!important` | Normal pour `@media print`, à garder hors jetons |
| `charts.ts` l. 83 (motifs) | `rgba(255,255,255,0.55)` / `rgba(0,0,0,0.5)` | Encre des motifs en contraste élevé, choisie selon le thème du système et non selon les jetons |
| Styles en ligne (`style="background:…"`, `style="flex:…"`) | 17 occurrences, `analyse.ts`, `compare.ts`, `overview.ts`, `budget.ts`, `rooms.ts`, `main.ts`, `charts.ts` | Pastilles de légende et jauges : la couleur vient bien des jetons (`cssVar`, `var(--…)`), mais la mise en forme est dans le gabarit |
| Hauteurs de graphique en ligne | `height:280px`, `240px`, `190px`, `220px` (`analyse.ts`, `waterheater.ts`, `rooms.ts`) | La hauteur par défaut (`.chart`) n'est pas un jeton |

### Incohérences de sens repérées

- **Bleu et orange ont deux sens.** `ui.ts` réserve `--series-1` (bleu) et `--series-2` (orange) aux
  deux usages (chauffe-eau, chauffage), mais `series(0)` (bleu) sert aussi à « Mesurée »
  (`analyse.ts`), « Logement (Linky) » (`linky.ts`), « Heures pleines / creuses » (`compare.ts`), la
  sonde du radiateur (`comfort.ts`), la signature intérieure (`indoorsig.ts`), « Mesuré »
  (`reconstitution.ts`) ; `series(1)` (orange) sert à « Puissance max atteinte » (`overview.ts`).
  Un lecteur peut croire qu'une courbe bleue parle du chauffe-eau.
- **Rouge = « plus » partout** (`.delta.up`, verdict `high`, cascade « Hausse ») : cohérent pour la
  consommation, ambigu pour une température plus haute ou une économie qui augmente (`setpoint.ts`
  utilise `verdict-low` pour un gain).
- La rampe `--seq-*` n'a **pas de variante contraste élevé**, alors que les autres jetons en ont une.
- `--accent` (orange brûlé) et `--cat-heating` (orange) sont proches : l'onglet actif et la pièce
  épinglée ressemblent à une série « chauffage ».

## 3. Typographie

- **Police** : pile système (`system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`), aucune
  police web ; iPhone : `font: -apple-system-body` pour suivre Dynamic Type (l. 89-96).
- **Base** : `93.75%` de la taille du navigateur (15 px par défaut), interligne 1,45 ; toutes les
  tailles en `rem` suivent le réglage du système (S-7.7).
- **Chiffres** : `font-variant-numeric: tabular-nums` sur `.kpi-value` et les tableaux.

| Taille | Emplois (sélecteurs) |
|---|---|
| 0,7 rem | `.badge`, `.badge-suspect`, onglets à 360 px |
| 0,75 rem | onglets (mobile), `.facts-json` |
| 0,8 rem | `.kpi h3`, `fieldset.prices legend` |
| 0,82 rem | `.hint`, `.kpi-sub`, `.share-legend` |
| **0,85 rem** (15 ×, la plus fréquente) | tableaux, `.chip`, `.seg button`, `.select select`, `.toggle`, `.table-details summary`, `.money-field`, libellés du menu et des formulaires, sous-titre de l'en-tête |
| 0,85 em | `code.hash` |
| 0,88 rem | `.verdict-sub` |
| 0,9 rem | `.period-total`, `.stale`, `.offline`, `.lock-card p`, onglets (bureau) |
| 0,92 rem | `.facts`, listes de l'analyse IA |
| 0,95 rem | `.report h3`, titres de l'analyse IA |
| 1 rem | `body`, `.sub-title`, `.money-h` |
| 1,05 rem | `h2`, `.verdict-title`, `.period-total strong` |
| 1,15 rem | `h1` |
| 1,2 rem | `body.is-simple` (mode simple) |
| 1,3 rem | `.report-title` |
| 1,4 rem | `.verdict-title` en mode simple |
| 1,6 rem | `.kpi-value` |
| 2,2 rem (`min(2.2rem, 13vw)`) | `.kpi-value` en mode simple |

**Constat** : 19 tailles distinctes pour une échelle qui en demande 6 ou 7 ; 0,8 / 0,82 / 0,85 /
0,88 / 0,9 / 0,92 / 0,95 rem sont indiscernables à l'œil. Graisses : 500, 600 (11 ×), 650 (2 ×),
700 ; 650 n'existe pas dans toutes les polices système (rendu en 600 ou 700). Graphiques : 12 px
(info-bulles, légendes), 11 px (étiquettes de fin de courbe), 10 px (calendrier) en pixels fixes,
donc **insensibles au réglage de taille du système**.

## 4. Espacements, rayons, tailles

| Propriété | Valeurs relevées (nombre d'emplois) |
|---|---|
| `gap` | 8 px (11), 4 px (6), 10 px (5), 6 px (4), 12 px (4), 2 px (2), 14 px, `4px 12px`, `4px 16px` |
| `padding` | `10px 12px` (5), `14px 16px` (3, cartes et tuiles), `6px 12px` (3), 10 px (3), `10px 14px` (2), puis 18 autres combinaisons uniques (`7px 30px 7px 12px`, `8px 10px 10px`…) |
| `margin` | `0 0 12px` / `margin-bottom: 12px` (7, espace entre cartes), `8px 0`, `4px 0`, puis 20 combinaisons uniques (`18px 0 6px`, `14px 0 6px`…) |
| `border-radius` | 10 px (13), 12 px (8), 8 px (5), `var(--radius)` = 14 px (4), 6 px (2), 3 px (2), 14 px écrit en dur (1), 20 px, 4 px, 2 px, 999 px (puces), 50 % (icône du verdict) |
| Hauteurs mini des cibles | 38 px (`.toggle`, `.seg`, sélecteurs), 44 px (menu, termes du glossaire), 34 px, 32 px |
| Points de rupture | `max-width: 400px` (onglets resserrés), `min-width: 760px` (onglets en haut, deux colonnes) ; conteneur `max-width: 1100px` |

**Constat** : pas d'échelle d'espacement ; une grille de 4 px (4, 8, 12, 16, 24) couvrirait presque
tout. Six rayons différents pour des éléments de même rang (champ 8 ou 10 px, carte 12 ou 14 px).
Les cibles de 32-34 px sont sous les 44 px recommandés sur mobile (au-dessus du minimum WCAG 2.2 de
24 px).

## 5. Composants

| Composant | Classes | Variantes | Fichiers qui l'utilisent | Remarques |
|---|---|---|---|---|
| **Carte** | `.card`, `.card-head` (titre + `.controls`), `h2 small.muted` (unité) | standard ; `#money-card`, `#curve-card`, `#insight-card` ; carte d'état `.status-list` (Paramètres) | 14 vues (`setpoint`, `analyse`, `settings`, `compare`, `comfort`, `habits`, `quality`, `overview`, `annual-share`, `report`, `rooms`, `budget`, `waterheater`, `anon.ts`) | `.card` défini deux fois (l. 389 et 429) |
| **Tuile chiffrée** | `.kpis` (grille), `.kpi`, `.kpi-value`, `.kpi-sub`, `h3` | `.kpi-detail` (masquée en mode simple quand le budget s'affiche), `.kpi-budget`, `.kpi.pinned` (bordure accent), squelette `.sk-kpi` | `overview.ts`, `report.ts`, `pinned.ts`, `budget.ts`, `anon.ts`, `lock.ts` | |
| **Bandeau verdict** | `.verdict`, `.verdict-icon`, `.verdict-title`, `.verdict-sub` | `.verdict-low` (vert ▼), neutre (=), `.verdict-high` (rouge ▲) | `overview.ts` (verdict et verdict FALC), `budget.ts` (nouveau tarif), `setpoint.ts` (consigne ± 1 °C), `waterheater.ts` (heures creuses), `comfort.ts` (CO₂) | Sert de **composant d'alerte générique** sous un nom de verdict ; `role="status"` ou `aria-live` selon la vue |
| **Bandeaux d'état** | `.stale`, `.offline`, `.notice`, `.error`, `.settings-msg`, `.ok` / `.ko` / `.ko-red` | données arrêtées (bordure `--bad`), hors ligne, information, erreur de déverrouillage, retour de formulaire | `main.ts`, `compare.ts`, `annual-share.ts`, `indoorsig.ts`, `lock.ts`, `prices.ts`, `reconstitution.ts`, `settings.ts`, `habits.ts`, `budget.ts` | Cinq styles pour trois niveaux (info, avertissement, erreur) ; `.stale` réutilisé hors de son sens (avertissements de `compare.ts`, `annual-share.ts`) |
| **Segment** | `.seg` + `button[role=radio][aria-checked]` | 2 à 4 options | `ui.ts` (`seg()`, toutes les vues), `linky.ts` | Un seul gabarit partagé : bon modèle pour le design system |
| **Puces** | `.chips`, `.chip[aria-pressed]` | années à comparer, questions types, avis 👍 / 👎 | `compare.ts`, `questions.ts`, `insight.ts` | |
| **Sélecteur** | `.select` (`label > span.sr-only + select`) | période, année, seuil de confort, module lié | `analyse`, `compare`, `linky`, `comfort`, `questions`, `overview`, `report`, `rooms`, `anon.ts` | |
| **Interrupteur / case** | `.toggle`, `.check` | « Voir les valeurs », climat, mode simple, pièces | `settings`, `compare`, `comfort`, `quality`, `main.ts`, `habits`, `prices`, `lock` | `.toggle` et `.check` font presque la même chose |
| **Boutons** | `.primary` (`.primary.small`), `.link`, boutons d'onglet `.tabs button[aria-current]`, `summary` du menu | principal accent, lien texte, onglet | `settings`, `habits`, `prices`, `report`, `lock`, `anon.ts` ; `.link` dans 10 fichiers | Pas de bouton secondaire |
| **Tableau** | `.table-wrap > table`, `td.num`, `.table-details` (`details` « Voir les valeurs ») | tableau simple, tableau repliable, tableaux du rapport | `ui.ts` (`table()`, `tableToggle()`), `anon.ts`, `report-sections.ts`, `insight`, `habits`, `reconstitution`, `budget`, `setpoint` | `.table-details` sert aussi à « Comment c'est calculé » (même apparence pour deux usages) ; seuls les replis « Voir les valeurs » portent `data-values` et suivent la préférence « tableaux ouverts » (`valuesFold()`, #546) |
| **Graphique** | `.chart[role=img][aria-label]` + phrase de repli (S-7.2) | barres empilées, courbes, barres horizontales, combiné, nuage, calendrier, carte horaire, aires, cascade (`charts.ts`) | 11 fichiers de vue + `anon.ts` | Hauteurs en ligne dans 4 vues |
| **Jauge de répartition** | `.share` (spans `flex`), `.share-legend` (`i` pastille) | usages, part du budget, HP / HC | `overview.ts`, `analyse.ts`, `budget.ts` | Couleurs et proportions en `style` en ligne |
| **Pastille** | `.swatch`, `.share-legend i`, `.tt-key` | carré 10-12 px | `analyse`, `compare`, `rooms`, `main.ts`, `charts.ts` | Trois classes pour la même chose |
| **Badge** | `.badge`, `.badge-suspect` | « démo », état d'une source, jour suspect (pointillé) | `main.ts`, `settings.ts`, `prices.ts`, `analyse.ts` | |
| **Écart** | `.delta.up/.down/.neutral` + ▲ ▼ = (`aria-hidden`) | | `ui.ts` (`delta()`), `analyse`, `overview`, `budget` | |
| **Formulaire** | `.money-field`, `.inline-form`, `.contract-row`, `fieldset.prices`, `.days-pick`, `.absence-add`, `.absence-list` | budget, CO₂, contrat, absences, télétravail | `budget`, `habits`, `prices`, `settings` | Quatre façons de poser un libellé sur un champ |
| **En-tête et navigation** | `.top`, `.title`, `.tabs`, `.menu` / `.menu-panel`, `.filters`, `.rooms-picker` / `.rooms-panel` | onglets en bas sur mobile, en haut au-delà de 760 px | `main.ts` | `.menu-panel` réparti en trois blocs (l. 243, 735, 870) |
| **Verrou** | `.lock`, `.lock-card`, `.skeleton` / `.sk-*` | écran de phrase de passe, chargement | `lock.ts` | |
| **Rapport** | `.report`, `.report-title`, `.facts`, `.facts-json`, `.anon-report`, `.report-section` | rapport annuel, rapport anonymisé, impression | `report.ts`, `report-sections.ts`, `anon.ts`, `annual-share.ts` | `.anon-report` et `.report-section` n'ont aucun style |
| **Analyse IA** | `.insight`, `.insight-vote`, `.insight-usage`, `.md`, `.question-list`, `.question-answer` | | `insight.ts`, `questions.ts` | `.insight-usage` sans style |
| **Glossaire (FALC)** | `.glossary`, `.term[aria-expanded]`, `.term-def` | terme dans une phrase, liste « Les mots à connaître » | `plain.ts`, `overview.ts` | Ajouté par S-7.13 |
| **Divers** | `.hint` (22 fichiers), `.muted` (23 fichiers), `.empty`, `.period-total`, `.sub-title`, `.sr-only` | | | `.pin-room`, `.lock-after`, `.setpoint-slider`, `.tt`, `.sub`, `.quality` sont posées dans le HTML **sans aucune règle CSS** |

## 6. Icônes et symboles

- **Icônes SVG** : 8 tracés en ligne dans `main.ts` (`ICONS` : synthèse, comparer, pièces, confort,
  analyse, rapport, paramètres, menu), trait 2 px, `currentColor`, `aria-hidden`. Pas de jeu
  d'icônes externe.
- **Icônes de l'application** : `web/public/icons/` (`icon.svg`, `maskable.svg`, PNG 192 / 512,
  `apple-touch-icon.png`).
- **Caractères utilisés comme icônes** : ▲ ▼ = (écarts et verdicts, 5 fichiers), ⚠️ (avertissements,
  4 fichiers), ⋮ (désigne le menu dans des textes), ↔ (pièce ↔ module), ✓ (états), 👍 👎 (avis sur
  l'analyse IA), ≈ (valeurs estimées), → (flèches de texte, 17 fichiers). Leur rendu dépend de la
  police du système (⚠️ et 👍 en couleur, les autres en noir).

## 7. Graphiques (ECharts, `charts.ts`)

| Élément | Valeur |
|---|---|
| Palette catégorielle | `series(i)` → `--series-1…8` (modulo 8) |
| Usages | `catColor()` → `--cat-heating`, `--cat-water` |
| Pièces | `roomColor()` : pièces chauffées sur les emplacements 3 à 8, chauffe-eau en `--cat-water`, au-delà de six pièces « Autres pièces » en `--text-muted` |
| Années | `yearColor()` : l'année la plus récente prend `--series-1` |
| Grandeurs | `seqRamp()` → `--seq-1…5` (calendrier, carte horaire, heures de CO₂) |
| Hausse / baisse | `--bad` / `--good` (cascade), total en `--text-secondary` |
| Motifs (contraste élevé, couleurs forcées) | `decal(i)` : rayures, points, hachures ; la série 0 reste unie |
| Texte | info-bulles 12 px, étiquettes 11 px, calendrier 10 px ; police héritée |
| Barres | `barMaxWidth` 28 (barres), 18 (horizontales), 16 (combiné), 36 (cascade) ; coins 4 px en cascade seulement |
| Points et traits | `symbolSize` 8 (courbes), 6 (nuage), 5 (repères) ; traits 2 px, pointillés 1 px |
| Atténuation | jours incertains 0,4 ; nuits incomplètes 0,35 ; nuage 0,55 ; aires 0,85 |

## 8. Pistes pour la v1.6 (non décidées)

1. Échelle typographique de 6 crans (0,8 / 0,9 / 1 / 1,15 / 1,4 / 2 rem) et deux graisses (400, 600).
2. Échelle d'espacement sur 4 px et trois rayons (6, 10, 14 px) en jetons.
3. Composant d'alerte (`info`, `attention`, `erreur`) distinct du verdict, qui remplace `.stale`,
   `.notice`, `.error`, `.settings-msg`, `.ok` / `.ko`.
4. Couleurs de séries « neutres » réservées aux mesures qui ne sont pas un usage (ne plus réutiliser
   le bleu du chauffe-eau ni l'orange du chauffage).
5. Variante contraste élevé de `--seq-*` ; encre de l'icône du verdict et des motifs en jetons.
6. Tailles de texte des graphiques dérivées de la taille du système.
7. Une seule pastille, un seul libellé de champ, une seule case à cocher.
