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

| Où | Commande | Rôle |
|---|---|---|
| racine | `ruff check . && ruff format --check .` | lint et format Python |
| racine | `pytest -q` | tests du collecteur (API simulée, **aucun appel réseau**) |
| `web/` | `npx tsc --noEmit` | types TypeScript |
| `web/` | `npm test` | tests Vitest |
| `web/` | `npm run build && npm run size` | build, puis budget de taille du premier écran (entrée + chunks préchargés) |
| `web/` | `npm run e2e` | parcours de la démo dans Chromium (après `npm run build`), captures dans `web/e2e/screenshots/` |

`npm run e2e` lance `vite preview` sur le port 4179 ; s'il est pris, choisissez-en un autre :
`E2E_PORT=4200 npm run e2e`.

Le **budget de taille** (`web/scripts/size-budget.mjs`, 281 kB gzip) compte le chunk d'entrée **et**
tous les chunks que `index.html` précharge (`modulepreload`) ; il échoue au-delà de 80 % du budget
(#227). ECharts est dans son propre chunk, chargé au premier graphique (`charts.ts` → `echarts-lib.ts`) :
n'importez jamais `echarts` ailleurs. Un nouvel écran ou une nouvelle carte se charge à la demande
(`import()` différé), comme `views/linky.ts` ou `legal.ts`.

Les données de démonstration se régénèrent avec `python -m collector demo` (phrase de passe « demo »).

## 3. Cycle d'une contribution

1. **Une issue** d'abord, avec le gabarit adapté (*Récit utilisateur*, *Bug*, *Étude*) : « En tant
   que…, je veux…, afin de… » et des critères Given / When / Then.
2. **Une branche** par sujet : `<prénom>/<sujet>` pour un humain, `claude/<sujet>` pour un agent IA.
   Jamais de commit direct sur `main` (seule la collecte automatique y écrit les données).
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
- **Tests sans réseau** : toute API est simulée (voir `tests/`).
- **IA** : seuls des agrégats mensuels sont envoyés, et l'application montre exactement quoi.
- Une faille de sécurité se signale en privé au mainteneur, jamais dans une issue publique.

## 5. Cadre juridique

Le projet appelle une API **non officielle** (Intuis). Avant de proposer une nouvelle source de
données, lisez [`docs/juridique.md`](docs/juridique.md) et ajoutez-y le service : conditions lues, date
de lecture, risque d'arrêt (et la même entrée dans `web/src/legal.ts`).

## 6. Où trouver quoi

- [`README.md`](README.md) : installation et fonctionnement pour un foyer.
- [`docs/api-notes.md`](docs/api-notes.md) : formats des API, schémas de référence.
- [`docs/bmad/`](docs/bmad/00-index.md) : vision, exigences, architecture, épopées et récits, stratégie de test.
- [Issues](https://github.com/Opaland/Netatmo/issues) rangées par jalon : le travail à faire.
