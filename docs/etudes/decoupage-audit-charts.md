# Étude : découper `collector/audit.py` et `web/src/charts.ts`

*Statut : proposition, 19/11/2026 (v2.9). Issue #656. Le premier découpage (le catalogue d'`audit.py`)
est fait dans la même PR ; **la forme des suivants appartient au propriétaire** (décisions proposées
en fin de document).*

## Pourquoi

Mesures du cadrage de la v2.9 (`main` `16b570b`, `wc -l` des fichiers suivis hors tests) : les deux
plus gros fichiers du dépôt sont **`collector/audit.py` (1 623 lignes)** et **`web/src/charts.ts`
(1 382)**. Viennent ensuite `collector/demo.py` (1 120), `web/e2e/demo.mjs` (1 096),
`web/e2e/sweep.mjs` (1 028), `web/src/data-quality.ts` (996), `collector/diagnose.py` (940),
`collector/__main__.py` (898, découpé en v2.8 par #641). Un repreneur qui veut changer le texte d'un
contrôle ou un seuil le cherche dans 1 623 lignes dont 915 sont une seule classe.

Deux règles tiennent tout découpage :

- **un déplacement ne change aucun résultat** : tests inchangés (aucun fichier de `tests/` dans le
  diff), sortie identique octet pour octet sur la démo et les fixtures, jamais sur des données réelles ;
- **une règle, un seul endroit** (AGENTS.md §5) : un nom déplacé est réimporté, jamais recopié.

## `collector/audit.py`

| Partie | Lignes (à `16b570b`) | État | Proposition |
|---|---|---|---|
| docstring (les contrôles en prose) | 1-59 | — | reste dans `audit.py` (elle décrit les contrôles de la classe) |
| constantes de rapport (`REPORT_NAME`, `SKIPPED`…) | 76-82 | sans état | restent (lues par `__main__.py` et les sorties) ; `UNIT_RATIO` part avec le catalogue, qui en a besoin |
| **catalogue** : `Check`, `CHECKS`, `Threshold`, `THRESHOLDS`, constantes tirées des seuils (`MIN_DAYS`… `SOURCES_MIN`), `tolerance` | 85-347 (≈ 263) | sans état, sans appel vers le reste | **étape 1, faite** : `collector/audit_catalogue.py` |
| `MAX_SHOWN`, `TWICE_TEXT` | 339-341 | sans état | restent : `MAX_SHOWN` est réglé par un test (`monkeypatch.setattr(au, "MAX_SHOWN", 2)`) que l'étape 1 ne doit pas modifier ; le déplacer casserait ce réglage |
| lecture et formes des clés (`read_docs`, `form_of`, `valid`, `canonical`, `local_exists`, `day_slots`), `Series`, `series_of`, `SERIES_LABEL`, `SERIES_UNIT` | 350-562 | sans état ; `local_exists` est importé par `demo.py` | étape 2 : `collector/audit_series.py` (« ce qu'est une série datée ») ; importe le catalogue ? non : rien du catalogue n'y sert |
| classe `Audit` (tous les contrôles, état partagé : `findings`, `errors`, `_fine_cache`) | 563-1477 (915) | état partagé | étape 3, **à décider** (ci-dessous) |
| aides numériques (`_num`, `_median`, `_nonzero`, `_pearson`, `_name`, `_slot`) | 1478-1524 | sans état | avec l'étape 2 ou 3 |
| sorties (`audit`, `public_lines`, `private_doc`, `write_report`) | 1526-1623 | lisent `Audit` et le catalogue | restent dans `audit.py`, qui devient la façade (point d'entrée de `__main__.py`) |

**Ordre** : 1) catalogue (fait) ; 2) séries et formes des clés ; 3) classe `Audit`, seulement après
décision. Chaque étape : une PR, les tests du collecteur verts sans être modifiés, la sortie comparée
octet pour octet (`public_lines`, `private_doc` en clair sur l'archive synthétique de
`tests/test_audit.py`, `web/src/__fixtures__/audit-report.json` régénéré par `AUDIT_FIXTURE=1`), et
`scripts/mutation_collecteur.py` qui tourne sur le nouveau module.

**Ce qu'importe chaque module proposé.**

- `audit_catalogue.py` : `dataclasses`, `quality` (`CROSS_MARGIN_WH`, `CROSS_RATIO`, `SUSPECT_WH`),
  `sync` (`HOURLY_DAYS_SYNC`, `MONTH_GAP_SHARE`, `MONTH_GAP_WH`). N'importe rien d'`audit.py`.
- `audit_series.py` (proposé) : `re`, `json`, `datetime`, `zoneinfo`, `crypto.decrypt_bytes`. N'importe
  ni le catalogue ni la classe.
- `audit.py` : réimporte les noms des deux, pour que `au.CHECKS`, `au.THRESHOLDS`, `au.MIN_DAYS`,
  `au.CORR_GAIN`, `au.tolerance`, `au.day_slots`… restent lisibles (tests, `demo.py`, `__main__.py`).

**Étape 3, la classe `Audit` : options (décision du propriétaire, D-proposée).**

- **A. Par famille de contrôles, en fonctions** : `audit_dates.py` (`keys`, `across_years`,
  `duplicate_json`, `room30_hours`, `estimated`, `tariffs`), `audit_decalages.py` (`shifts`,
  `_shift_fit`, `hours_vs_linky`, `linky_lag`, `two_sources`), `audit_valeurs.py` (`day_sums`,
  `above_linky`, `impossible`, `units`, `frozen`, `peaks`, `index_back`). Chaque contrôle devient
  `def check(a: Audit) -> None` ; `Audit` garde l'état (`findings`, séries, caches `_fine`,
  `_energy_days`) et `run()`. Lisible par famille (comme la docstring), mais l'état partagé passe en
  paramètre : les caches deviennent publics de fait.
- **B. Mixins** : une classe par famille, `Audit(DatesChecks, ShiftChecks, ValueChecks)`. Le moins de
  changement de code (aucun `self` réécrit), mais l'état reste implicite et réparti entre les
  fichiers : ce que l'on cherche à éviter.
- **C. Ne pas découper la classe** : le catalogue et les séries sortis, `audit.py` tombe vers
  1 150 lignes, la classe reste d'un seul tenant, rangée par familles (ses intertitres
  `# ---- keys` existent déjà).

Proposition : **C maintenant, A si un contrôle nouveau arrive** (le coût de A est la réécriture des
`self.` de 915 lignes, à faire quand on y touche, pas pour elle-même).

**Étape 1, faite (#656) : ce qui a été mesuré.**

- `collector/audit.py` 1 623 → **1 380 lignes** ; `collector/audit_catalogue.py` 278 lignes (les
  lignes 76-77 et 85-338 d'origine, et `tolerance`, déplacées sans retouche ; `MAX_SHOWN` et
  `TWICE_TEXT` restés). Chaque définition une seule fois : `grep -rn "^CHECKS\|^THRESHOLDS\|^def tolerance" collector/`
  ne trouve que `audit_catalogue.py`.
- Les **660 tests** du collecteur verts, **aucun fichier de `tests/` modifié**.
- Sortie **identique octet pour octet** avant et après (81 002 octets) : `public_lines` et `private_doc`
  en clair sur la démo (`web/public/demo`, phrase « demo ») et sur quatre archives synthétiques de
  `tests/test_audit.py` (propre, défectueuse, Linky décalé d'un jour, prise qui mesure le ballon), plus
  le catalogue lui-même (`CHECKS`, `THRESHOLDS`, les constantes, `tolerance` sur sept valeurs). Le
  script de comparaison est dans la PR ; il a été vu voir une différence (un titre de contrôle raccourci :
  11 lignes différentes). `web/src/__fixtures__/audit-report.json` régénéré par `AUDIT_FIXTURE=1` :
  inchangé.
- `python scripts/mutation_collecteur.py collector/audit_catalogue.py tests/test_audit.py` : 19 mutants,
  17 tués, **2 survivants** (89,5 %). L. 259, `round((CROSS_RATIO - 1) * 100)` → `* 101` :
  **équivalent** (10,1 arrondi à 10). L. 270, `part_decalee / 100` → `/ 101` (80 % → 79,2 %) : un vrai
  trou, aucun test ne place un mois juste au seuil ; le même mutant existait dans `audit.py` avant le
  déplacement. Test à ajouter dans une story à part (celle-ci ne touche pas `tests/`).
- Les numéros de ligne d'`audit.py` cités par `docs/bmad/06-qa-strategy.md` (tableau des équivalents de
  #624) sont ceux d'avant le déplacement : retirer 243 pour les lire dans le fichier d'aujourd'hui.

## `web/src/charts.ts`

| Partie | Lignes (à `16b570b`) | Proposition |
|---|---|---|
| chargement d'ECharts, thème, cycle de vie (`loadCharts`, `real`, `run`, `chartOf`, `disposeAll`), notes du balayage (`noteLegend`, `noteAxisNames`) | 1-320 | reste dans `charts.ts` (**seul** importateur d'`echarts-lib`, CONTRIBUTING §2) |
| règles communes : bulle, légende, axes, graduations, `barRows`, `escapeHtml`, `fmtKwh`, `cssVar` | 321-597 | option : `chart-rules.ts` (sans ECharts : types seulement) |
| onze formes (`barChart`, `lineChart`, `hbarChart`, `comboChart`, `scatterChart`, `calendarChart`, `gridHeatmap`, `areaChart`, `waterfallChart`…) | 598-1382 | option : un ou plusieurs modules de formes |

**Premier écran** (mesuré le 19/11/2026 sur `main` `16b570b`). `charts.ts` est dans le chunk d'entrée :
`main.ts` l'importe statiquement (`disposeAll`, `useChartPrefs`), comme `ui.ts`, `components.ts`,
`build.ts`, `plain.ts`, `markdown.ts`, `origin-traces.ts` (souvent pour `escapeHtml` seul). ECharts,
lui, est dans son chunk différé (`echarts-lib.ts`, chargé au premier graphique). `charts.ts` seul,
minifié : **25,20 kB brut, 9,22 kB gzip** (esbuild `--minify`, zlib niveau 9) ; le premier écran entier :
voir la PR (`npm run size`).

Options, et ce que chacune fait :

- **A. Déplacer seulement** (règles communes et formes dans des modules importés statiquement par
  `charts.ts`) : premier écran inchangé à quelques octets près (les mêmes fonctions, dans le même
  chunk) ; ECharts reste importé par `charts.ts` seul ; les formes ne sont pas des importateurs
  d'ECharts tant qu'elles n'importent que des **types** (`import type`) et appellent `run()` de
  `charts.ts`. Aucun test ne tient cette règle aujourd'hui (`grep -rl echarts web/src` : `charts.ts`
  et `echarts-lib.ts` seulement, vérifié le 19/11/2026) : la PR de ce découpage l'ajoute d'abord
  (un test qui lit les sources et refuse `echarts` ou `echarts-lib` ailleurs que dans `charts.ts`).
- **B. Formes chargées à la demande** (`import()` des formes au premier graphique, comme ECharts) :
  le premier écran perd ce que pèsent les formes (une part des 9,22 kB gzip), mais chaque appel de
  forme devient asynchrone (`await barChart(…)`), dans une trentaine d'appelants : un changement de
  comportement (ordre d'affichage, `ready(page)` des e2e), pas un déplacement.
- **C. `escapeHtml`, `cssVar`, `fmtKwh` hors de `charts.ts`** (vers `trusted.ts` ou `glossary.ts`) :
  sept modules importent `charts.ts` pour `escapeHtml` seul ; sans effet sur la taille aujourd'hui
  (`charts.ts` est de toute façon dans l'entrée), mais c'est la condition de B.

Proposition : **C, puis A** (deux déplacements purs, premier écran mesuré avant et après dans la PR,
aucun budget dépassé) ; **B** seulement si le premier écran approche son objectif de 80 % (il est à
46 %), et alors comme une story à part, avec ses e2e.

## Décisions proposées au propriétaire

1. `audit.py`, étape 2 (séries et formes des clés dans `audit_series.py`) : **oui** / non.
2. La classe `Audit` : **C** (ne pas la découper) / A (par familles, en fonctions) / B (mixins).
3. `charts.ts` : **C puis A** (déplacements purs) / B (formes à la demande) / rien.
