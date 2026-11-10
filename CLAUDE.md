# Historique énergie — guide pour Claude Code

Application PWA (`web/`, Vite + TypeScript) et collecteur Python (`collector/`) de l'historique de
chauffage Intuis / Muller, du chauffe-eau, de la station Netatmo et du compteur Linky. Lire
`README.md`, `CONTRIBUTING.md` et `docs/PROJET.md` avant de reprendre.

## Commandes

```bash
node scripts/porte.mjs            # toute la porte (= ci.yml hors WebKit), avant de pousser
node scripts/porte.mjs --rapide   # lint + types + tests, avant chaque commit (le crochet la lance)
cd web && npm run mutation        # tests de mutation, à la main (docs/bmad/06-qa-strategy.md)
pytest -m reseau                  # sources publiques réelles (Open-Meteo, CRE, Tempo), hors CI
```

## Propre à Claude Code

- Crochets (`.claude/settings.json` → `.claude/hooks/crochet.mjs`) : la porte rapide avant
  chaque `git commit` (commit refusé si elle est rouge) ; l'état de la CI de `main` au démarrage.
- Les copies de travail des agents (`.claude/worktrees/`) et `settings.local.json` ne sont
  pas versionnées.

## Règles communes (Claude, Copilot, Gemini)

Les règles numérotées — citées dans le code comme « AGENTS.md §n » — sont dans `AGENTS.md`
(source unique), importé ici :

@AGENTS.md
