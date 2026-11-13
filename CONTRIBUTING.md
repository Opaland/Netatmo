# Contribuer

Merci de votre intérêt ! Ce guide vise une première pull request **en moins d'une heure**. Le projet
est personnel mais ouvert : corrections, compatibilité avec d'autres installations Intuis et
améliorations de l'application sont les bienvenues.

Les règles complètes (rôles BMAD, étiquettes, jalons, revues multi-personas) sont dans
[`docs/PROJET.md`](docs/PROJET.md). Ce guide en est le raccourci pratique.

## 1. Démarrer en 5 minutes

### Avec le devcontainer (recommandé)

Ouvrez le dépôt dans **VS Code → « Reopen in Container »** ou dans **GitHub Codespaces**.
Le conteneur ([`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json)) installe les mêmes
versions que la CI (Python 3.12, Node 22), les dépendances Python et web, et Chromium pour les tests
de bout en bout. L'application démarre seule sur le port **5173** : touchez « Essayer avec des données
de démonstration ». Aucun compte ni secret n'est nécessaire.

### Sans conteneur

Python 3.12 et Node 22 :

```bash
pip install -e ".[dev]"
cd web && npm ci && npm run dev     # puis « Essayer avec des données de démonstration »
```

## 2. Vérifications (les mêmes qu'en CI)

**Une seule commande les enchaîne** : `node scripts/porte.mjs` (ou `npm run porte` dans `web/`) lance
les étapes de `.github/workflows/ci.yml` dans leur ordre (hors WebKit) et s'arrête à la première rouge
en la nommant ; `--rapide` (lint, types, tests) suffit avant un commit. Le détail :

| Où | Commande | Rôle |
|---|---|---|
| racine | `ruff check . && ruff format --check .` | lint et format Python |
| racine | `pytest -q` | tests du collecteur (API simulée, **aucun appel réseau**) |
| `web/` | `npx tsc --noEmit` | types TypeScript |
| `web/` | `npm test` | tests Vitest |
| `web/` | `npm run build && npm run size` | build, puis budget de taille du premier écran (entrée + chunks préchargés) |
| `web/` | `npm run e2e` | parcours de la démo dans Chromium (après `npm run build`), captures dans `web/e2e/screenshots/` (police de la CI seulement, ci-dessous) |

`npm run e2e` lance `vite preview` sur le port 4179 ; s'il est pris, choisissez-en un autre :
`E2E_PORT=4200 npm run e2e`. Les e2e refusent de démarrer sur un `dist/` plus ancien que les sources
(`web/e2e/dist-a-jour.mjs`) : lancer `npm run build` d'abord.

Les **captures de référence** (`web/e2e/screenshots/`) sont celles d'un runner de la CI, rendues en
DejaVu Sans. Le dossier des captures est écrit une fois, dans `web/e2e/captures.mjs` : sur un poste
où `fc-match sans-serif` ou `fc-match system-ui` ne donne pas DejaVu Sans (ou sans `fc-match`), les
e2e écrivent leurs captures dans `web/e2e/screenshots-poste/` (jamais commité) et le disent (#583,
`docs/APPRENTISSAGES.md` A15, A19). Pour régénérer les références sur un poste Linux :
`FONTCONFIG_FILE="$PWD/e2e/polices-ci.conf"` (dans `web/`, chemin absolu), qui inclut la
configuration du système et écarte Inter ; y écarter aussi la police que préfère le poste. `E2E_OUT`
choisit un autre dossier.

**WebKit** (moteur de Safari, l'iPhone) n'est pas dans la porte locale : le job `e2e-webkit` de la CI
le lance. Sur un poste, `npx playwright install webkit` une fois (Linux : `--with-deps`), puis
`E2E_BROWSER=webkit npm run e2e:<script>`. Le **balayage** (`npm run e2e:sweep`, après les fixtures)
garde dans WebKit les mêmes invariants que dans Chromium (#595, A18), dans la portée réduite de la
CI (`SWEEP_SCOPE=webkit`, écrite dans `web/e2e/sweep.mjs` : la démo à 360 px et à 200 %, `trous-reels`
à 360 px, et l'explorateur de contrôles sur la démo à 360 px, #599, #600) ; `SWEEP_EXPLORE=0` en
retire l'explorateur, `SWEEP_SCOPE=ci` donne la portée Chromium entière.

`npm run e2e:trous` (après `python -m collector fixtures -o web/dist/demo-fixtures`, dans la porte)
ouvre la démo sur `trous-reels`, la forme des trous d'un vrai compte (#570) : jamais 0 pour un trou,
« incomplet », comparaisons sans l'appareil non mesuré.

Les **limites de hauteur** des pages (l'Accueil en 3 écrans d'iPhone 13, l'Historique en 4…) sont
écrites une fois, dans `web/e2e/hauteurs-limites.mjs`, que lisent la garde (`e2e/features.mjs`) et
`npm run e2e:hauteurs` (#556) : ce dernier imprime, en DejaVu Sans, la hauteur de chaque écran du
tableau des revues à 360 px et à 200 %, et pour chaque limite la hauteur, la limite et la marge en
px ; il échoue sur une limite dépassée. Il tourne dans la CI (job e2e, une quinzaine de secondes).
Ajouter ou relever une limite est une décision du propriétaire : à proposer dans la PR.

Hors de la porte, à lancer à la main : `npm run mutation` (dans `web/`, tests de mutation des calculs,
quelques minutes, rapport dans `web/reports/mutation/`) et `pytest -m reseau` (les sources publiques
réelles : Open-Meteo, CRE, Tempo). Lecture des résultats : `docs/bmad/06-qa-strategy.md`.

Dans les tests e2e, pas d'attente fixe (`waitForTimeout`) : attendre `#view[data-ready]` (helper
`ready(page)`), posé par l'appli (`web/src/ready.ts`) quand la vue et ses cartes différées,
documents et graphiques sont arrivés. Une absence (« cette carte ne doit pas s'afficher ») se
vérifie toujours après `ready(page)`. Tout nouveau chargement en arrière-plan d'une vue passe par
`lazyCard`, `datasetDoc` ou `track()` pour être compté.

Le **budget de taille** (`web/scripts/size-budget.mjs`, 281 kB gzip) compte le chunk d'entrée **et**
tous les chunks que `index.html` précharge (`modulepreload`) ; il échoue au-delà de 80 % du budget
(#227). ECharts est dans son propre chunk, chargé au premier graphique (`charts.ts` → `echarts-lib.ts`) :
n'importez jamais `echarts` ailleurs. Un nouvel écran ou une nouvelle carte se charge à la demande
(`import()` différé), comme `views/linky.ts` ou `legal.ts`. Les vues de l'Historique, du Compteur et
des outils (`views/analyse.ts`, `views/compare.ts`) passent par `views/lazy-views.ts` : chargées à la
première page qui les montre, ou plus tôt quand le navigateur est inoccupé après le premier écran ; le
script de taille échoue si l'une d'elles revient dans le premier écran (#555).

Les données de démonstration se régénèrent avec `python -m collector demo` (phrase de passe « demo »).

## 3. Cycle d'une contribution

1. **Une issue** d'abord, avec le gabarit adapté (*Récit utilisateur*, *Bug*, *Étude*) : « En tant
   que…, je veux…, afin de… » et des critères Given / When / Then.
2. **Une branche** par sujet : `<prénom>/<sujet>` pour un humain, `claude/<sujet>` pour un agent IA.
   Jamais de commit direct sur `main` (seule la collecte automatique y écrit les données, ou dans
   la branche `data` quand la variable `DATA_BRANCH` est posée).
3. **Une pull request** qui suit le [gabarit](.github/pull_request_template.md) : `Closes #n`, ce qui a
   été vérifié, captures mobile et bureau (clair et sombre) si l'interface change, README / docs /
   `CHANGELOG.md` à jour. Une PR = un sujet.
4. **CI verte** obligatoire (collecteur, application, e2e).
5. **Fusion en squash** par le mainteneur ; l'issue se ferme.

Les textes de l'application et de la documentation sont **en français** ; le code et ses commentaires
sont en anglais.

## 4. Règles de sécurité et de confidentialité

Non négociables (détails dans [`docs/PROJET.md`](docs/PROJET.md#7-règles-de-sécurité-et-de-confidentialité)) :

- **Aucun identifiant, jeton ou clé** dans le code, les tests, les issues ou les PR : uniquement en
  secrets GitHub. Les identifiants OAuth de l'application Intuis ne doivent jamais entrer dans le dépôt.
- **Aucune donnée personnelle en clair** : les données de consommation sont toujours chiffrées avant
  commit (`data/*.enc.json`). Les tests utilisent des données fictives ; les captures, la démo.
- **Journaux publics** (GitHub Actions) : uniquement des comptes et des codes, jamais de noms de pièces,
  de valeurs ni d'identifiants.
- **Tests sans réseau** : toute API est simulée (voir `tests/`). Seul `tests/test_sources_reelles.py`
  appelle les sources publiques sans clé, marqué `reseau` et exclu par défaut (`pytest -m reseau`).
- **IA** : seuls les totaux du mois et au plus cinq jours inhabituels sont envoyés, pièces et capteurs
  sous pseudonyme, et l'application montre exactement quoi (`tests/test_promesses.py`).
- Une faille de sécurité se signale en privé au mainteneur, jamais dans une issue publique : comment,
  et ce qui est déjà vérifié, dans [`SECURITY.md`](SECURITY.md).

## 5. Cadre juridique

Le projet appelle une API **non officielle** (Intuis). Avant de proposer une nouvelle source de
données, lisez [`docs/juridique.md`](docs/juridique.md) et ajoutez-y le service : conditions lues, date
de lecture, risque d'arrêt (et la même entrée dans `web/src/legal.ts`).

## 6. Où trouver quoi

- [`README.md`](README.md) : installation et fonctionnement pour un foyer.
- [`docs/api-notes.md`](docs/api-notes.md) : formats des API, schémas de référence.
- [`docs/bmad/`](docs/bmad/00-index.md) : vision, exigences, architecture, épopées et récits, stratégie de test.
- [Issues](https://github.com/Opaland/Netatmo/issues) rangées par jalon : le travail à faire.
