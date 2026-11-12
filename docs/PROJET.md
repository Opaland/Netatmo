# Règles de gestion du projet

Ce projet suit la méthode **BMAD** (Breakthrough Method for Agile AI-Driven Development) : chaque
évolution passe par des rôles (analyste, PM, architecte, PO, Scrum Master, dev, QA), qui produisent des
artefacts dans [`docs/bmad/`](bmad/00-index.md). Ces règles valent pour les humains comme pour les agents IA
qui travaillent sur le dépôt.

## 1. Où vit quoi

| Quoi | Où |
|---|---|
| Vision, besoins, exigences, architecture | `docs/bmad/01` à `04` |
| Épopées et récits (référence) | `docs/bmad/05-epics-stories.md` |
| **Travail à faire / en cours** | [Issues GitHub](https://github.com/Opaland/Netatmo/issues), une par récit, rangées par **jalon** |
| Stratégie de test, définition de « fini » | `docs/bmad/06-qa-strategy.md` |
| Revues multi-personas | `docs/bmad/02-revue-50-personas.md` (initiale) et `docs/bmad/revues/` (une par version) |
| Revues par agents (code, design) : consignes | `docs/revues-agents/` (voir § 10) |
| Inventaire de l'interface (base du design system) | `docs/design/inventaire.md` |
| Études (faut-il le faire ?) | `docs/etudes/` |
| Historique des versions | `CHANGELOG.md` |
| Règles du projet | `docs/PROJET.md` |

## 2. Cycle d'un récit

1. **Issue** créée avec le gabarit *Récit utilisateur* : « En tant que…, je veux…, afin de… », critères
   Given / When / Then, taille (S/M/L), priorité MoSCoW, jalon.
2. **Branche** dédiée (`claude/<sujet>` pour un agent, `<prénom>/<sujet>` pour un humain), jamais de
   commit direct sur `main` (sauf la collecte automatique des données).
3. **Pull request** avec le gabarit, qui référence l'issue (`Closes #n`) ; une PR = un sujet.
4. **CI verte** obligatoire (lint, tests Python et TypeScript, build).
5. **Fusion** en *squash* ; l'issue se ferme ; le `CHANGELOG.md` est mis à jour dans la PR.
6. Une évolution de la collecte se vérifie ensuite **sur les vraies données** (journal de la collecte,
   comparaison avec l'application Intuis) avant d'être considérée comme terminée.

## 3. Étiquettes

| Famille | Étiquettes |
|---|---|
| Type | `récit`, `épopée`, `bug`, `étude`, `dette` |
| Priorité (MoSCoW) | `P: must`, `P: should`, `P: could` |
| Taille | `taille: S` (≤ ½ j), `taille: M` (1-2 j), `taille: L` (> 2 j) |
| Domaine | `collecteur`, `app`, `ia`, `sécurité`, `accessibilité`, `domotique`, `doc` |
| État | `bloqué`, `conditionnel` (dépend d'une étude ou d'une mesure) |
| Revue par agents (§ 10) | `revue-code`, `revue-design` (+ `design`), gravité : `gravité: critique`, `gravité: majeure`, `gravité: mineure`, `gravité: suggestion` |

## 4. Jalons et versions

- Versions **sémantiques** : `vMAJEUR.MINEUR` (la PWA et le collecteur partagent le numéro).
- Un **jalon GitHub par version** (`v1.2`, `v1.3`, `v1.4`, `v1.5`, `v1.6`, `v2`) ; la priorité dans un
  jalon suit MoSCoW. Les issues de personas sont rangées dans le jalon de la prochaine revue.
- Une version est **livrée** quand toutes ses issues `P: must` sont fermées, le `CHANGELOG.md` est à
  jour, la revue multi-personas de la version est écrite et les **deux revues par agents** (code et
  design, § 10) sont faites, sans constat `critique` ouvert.

## 5. Revue multi-personas (obligatoire à chaque version)

- **72 personas** depuis la fin de la v1.6 (50 initiaux, 2 ajoutés en v1.2, 10 en v1.4, 10 en fin de v1.6), répartis en
  familles (foyer, énergie, domotique, UX et accessibilité, sécurité et juridique, dev et exploitation,
  diffusion, IA et données). La liste de référence est dans `docs/bmad/02-revue-50-personas.md`
  (§ 12 et § 13 pour les ajouts) ; on peut en ajouter, jamais en retirer sans le noter.
- À chaque version : un fichier `docs/bmad/revues/vX.Y.md` avec, pour chaque persona, son verdict sur
  la version livrée (👍/👎) et une proposition ; puis la synthèse « besoins × impact ».
- **Chaque persona a son issue** (étiquette `persona` + famille, titre « Persona #N · … ») : elle porte
  son verdict, son besoin et sa proposition. À chaque revue, on y ajoute un commentaire avec le nouveau
  verdict ; on la ferme quand sa proposition est livrée (en citant le récit), on la rouvre s'il en fait
  une nouvelle.
- Chaque proposition retenue devient aussi une **issue de récit** (« S-x.y · … ») liée depuis l'issue
  du persona ; les autres sont notées « non retenu » avec la raison.
- Une revue de **cadrage** a lieu en début de version (`docs/bmad/revues/vX.Y-cadrage.md`) pour remplir
  le backlog ; la revue de **fin de version** (`vX.Y.md`) juge ce qui a été livré.
- Une étude (`docs/etudes/`) **mesure le besoin avant de construire** : si le besoin n'est pas avéré,
  on ne construit pas, et on l'écrit.

## 6. Définition de « fini »

Reprise de `docs/bmad/06-qa-strategy.md` :

- critères d'acceptation de l'issue vérifiés ;
- tests automatisés ajoutés (API simulée, aucun appel réseau en CI) ;
- aucune donnée personnelle en clair dans le dépôt, les journaux ou les PR ;
- capture de l'application (mobile + bureau, clair + sombre) quand l'interface change ;
- README et docs à jour ; `CHANGELOG.md` complété.

Pour une **version** (en plus de chaque récit) : revue de code et revue design par agents faites
(§ 10), chaque constat corrigé ou tracé en issue, aucun constat `critique` ouvert, aucun `majeure`
sans jalon.

## 7. Règles de sécurité et de confidentialité

- Identifiants, jetons, clés : **uniquement** en secrets GitHub (jamais en variables, jamais dans le code).
- Réglages du foyer qui décrivent la maison (localisation et toits, radiateurs arrêtés, achats de bois :
  `HOME_LOCATION_JSON`, `STOPPED_ROOMS_JSON`, `WOOD_JSON`) : **scellés dans le navigateur** avec la clé
  publique du dépôt et gardés en secrets, jamais en variables (#204, #459 ; `HOUSEHOLD_SECRETS` dans
  `web/src/settings.ts`, `tests/test_reglages_foyer.py`).
- Données de consommation : **toujours chiffrées** avant commit (`data/*.enc.json`).
- Journaux publics de GitHub Actions : uniquement des comptes et des codes, jamais de noms, de valeurs
  ou d'identifiants (voir `collector/diagnose.py`).
- IA : seuls des agrégats mensuels sont envoyés ; l'application montre exactement ce qui a été envoyé.

## 8. Rituels (projet personnel, rythme léger)

| Quand | Quoi |
|---|---|
| Chaque nuit | Collecte automatique ; une issue s'ouvre si elle échoue |
| Chaque mois | Lecture de l'analyse IA ; tri des issues (nouveau, priorité, jalon) |
| Chaque version | Revue multi-personas (cadrage et fin), revues par agents (code et design), CHANGELOG, démonstration sur téléphone |
| Chaque hiver | Contrôle des totaux contre l'application Intuis et une facture |

## 9. Feuille de route v1.4 à v1.6

Décidée par le propriétaire en novembre 2026, à la fin de la v1.3. Détail dans
[`feuille-de-route.md`](feuille-de-route.md) et les jalons GitHub.

| Version | Nature | Contenu | Livrée quand |
|---|---|---|---|
| **v1.4** | Fonctions | Cadrage par 62 personas ([`revues/v1.4-cadrage.md`](bmad/revues/v1.4-cadrage.md)), puis développement : fenêtres ouvertes et états des radiateurs (E13), prises Shelly, étude Home Assistant + Zigbee, processus de revue par agents (S-1.16), récits restants | Must fermés, revue de fin v1.4 écrite |
| **v1.5** | Qualité du code | Revue de code **complète** (tout le code, pas seulement le diff) par des agents de revue, selon le processus de S-1.16 ; chaque constat devient une issue du jalon v1.5, puis est corrigé ; **aucune nouvelle vue** (seules exceptions : les suites de l'audit des données côté collecte, voir [`revues/v1.5-cadrage.md`](bmad/revues/v1.5-cadrage.md)) | Aucun constat critique ou majeur ouvert, CI verte |
| **v1.6** | Design | Revue design et UI/UX **complète** par des agents (toutes les vues, mobile et bureau, clair, sombre, contraste élevé), corrections, puis **nouveau design system** (jetons, typographie, espacements, composants partagés) appliqué à toute l'application | axe-core sans violation, aucune couleur ni taille hors jetons, captures de référence régénérées |

Pendant la v1.5 et la v1.6, les revues multi-personas continuent (cadrage et fin de version), mais leurs
propositions de **nouvelles fonctions** vont au jalon suivant (v1.7 ou v2), pas à la version en cours.

## 10. Revues par agents (code et design)

Obligatoires à la **fin de chaque version** (S-1.16), avant la revue multi-personas de fin de version :
elles cherchent les défauts, la revue multi-personas juge l'intérêt. La v1.5 applique la revue de
code à **tout** le code, la v1.6 la revue design à **toute** l'interface.

### Les deux revues

| | Revue de code | Revue design (UX / UI) |
|---|---|---|
| Consigne réutilisable | [`revues-agents/revue-code.md`](revues-agents/revue-code.md) | [`revues-agents/revue-design.md`](revues-agents/revue-design.md) |
| Matériau | `git diff <version précédente>..HEAD` (tout le code en v1.5) | captures de la démo (`npm run e2e` : mobile clair et sombre, bureau, 360 px, contraste élevé, couleurs forcées, mode simple à 200 %), [`design/inventaire.md`](design/inventaire.md), code des vues |
| Grille | justesse ; sécurité (secrets, journaux publics, chiffrement, CSP et Trusted Types, workflows, dépendances) ; tests ; performance et taille ; simplicité | hiérarchie et lisibilité ; cohérence (jetons, composants) ; accessibilité (WCAG 2.2 AA, 7:1 en contraste élevé) ; mobile ; langage clair |
| Étiquettes des issues | `revue-code` + gravité | `revue-design` + `design` + gravité |

### Gravité et suites

| Gravité | Suite |
|---|---|
| `critique` | Corrigé avant de livrer la version |
| `majeure` | Corrigé dans la version, ou issue au jalon suivant avec la raison du report |
| `mineure` | Issue, sans jalon imposé |
| `suggestion` | Issue facultative ; les pistes design vont au design system (v1.6) |

Un constat refusé est fermé « non retenu » avec la raison, comme une proposition de persona.

### Format des constats

L'agent écrit un fichier JSON unique (`revue-constats.json`) décrit dans chaque consigne : pour chaque
constat, `titre`, `gravite`, `categorie`, `fichiers` (`fichier:ligne` ou capture), `constat`,
`proposition`, `verification`. Le script [`scripts/revue_issues.py`](../scripts/revue_issues.py) le
vérifie, l'affiche, puis (avec `--create`) ouvre une issue par constat (« Revue code · … »), avec ses
étiquettes, sans doublon avec une issue ouverte de même titre.

### Procédure locale (par défaut)

1. Ouvrir une session Claude Code (ou un autre agent) dans le dépôt, sur `main` à jour.
2. Revue de code : « Suis `docs/revues-agents/revue-code.md`. Version v1.4, périmètre
   `git diff v1.3..HEAD`. Écris `revue-constats.json`. » Revue design : faire d'abord
   `cd web && npm run build && npm run e2e`, puis « Suis `docs/revues-agents/revue-design.md`… ».
   Une session par revue, pour que la revue design ne soit pas influencée par la lecture du code.
3. `python scripts/revue_issues.py revue-constats.json` (vérifier, relire), puis
   `python scripts/revue_issues.py revue-constats.json --create`. Ne pas committer
   `revue-constats.json`.
4. Trier les issues (jalon, priorité) et noter dans la revue de fin de version le nombre de constats par
   gravité et ce qui reste ouvert.

### Workflow GitHub (facultatif)

[`revue-agents.yml`](../.github/workflows/revue-agents.yml) fait la même chose dans GitHub Actions,
**uniquement à la demande** (`Actions → Revue par agents → Run workflow` : type, base, version, ouvrir
ou non les issues). Il demande un secret `ANTHROPIC_API_KEY` ; sans lui, il s'arrête avec un message et
la procédure locale reste la voie normale. Moindre privilège :

- le job de l'agent n'a que `contents: read`, ne reçoit **que** la clé d'API (aucun secret Intuis,
  Netatmo ni clé des données) et ne peut que lire, lancer `git diff / log / show` et écrire dans sa copie
  de travail : pas d'autre commande, pas de réseau, pas de push ;
- les issues sont ouvertes par un **second job sans modèle ni clé d'API**, par le script fixe, qui
  valide chaque champ et retire les mentions `@` ;
- le dépôt est public : le journal du run l'est aussi ; les consignes interdisent toute donnée
  personnelle dans les constats, et l'agent n'a accès qu'aux données chiffrées.
