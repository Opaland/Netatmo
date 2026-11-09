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

## 4. Jalons et versions

- Versions **sémantiques** : `vMAJEUR.MINEUR` (la PWA et le collecteur partagent le numéro).
- Un **jalon GitHub par version** (`v1.2`, `v1.3`, `v2`) ; la priorité dans un jalon suit MoSCoW.
- Une version est **livrée** quand toutes ses issues `P: must` sont fermées, le `CHANGELOG.md` est à
  jour et la revue multi-personas de la version est écrite.

## 5. Revue multi-personas (obligatoire à chaque version)

- **50 personas**, répartis en familles (foyer, énergie, domotique, UX et accessibilité, sécurité et
  juridique, dev et exploitation, diffusion, IA et données). La liste de référence est dans
  `docs/bmad/02-revue-50-personas.md` ; on peut en ajouter, jamais en retirer sans le noter.
- À chaque version : un fichier `docs/bmad/revues/vX.Y.md` avec, pour chaque persona, son verdict sur
  la version livrée (👍/👎) et une proposition ; puis la synthèse « besoins × impact ».
- Chaque proposition retenue devient une **issue** ; les autres sont notées « non retenu » avec la
  raison.
- Une étude (`docs/etudes/`) **mesure le besoin avant de construire** : si le besoin n'est pas avéré,
  on ne construit pas, et on l'écrit.

## 6. Définition de « fini »

Reprise de `docs/bmad/06-qa-strategy.md` :

- critères d'acceptation de l'issue vérifiés ;
- tests automatisés ajoutés (API simulée, aucun appel réseau en CI) ;
- aucune donnée personnelle en clair dans le dépôt, les journaux ou les PR ;
- capture de l'application (mobile + bureau, clair + sombre) quand l'interface change ;
- README et docs à jour ; `CHANGELOG.md` complété.

## 7. Règles de sécurité et de confidentialité

- Identifiants, jetons, clés : **uniquement** en secrets GitHub (jamais en variables, jamais dans le code).
- Données de consommation : **toujours chiffrées** avant commit (`data/*.enc.json`).
- Journaux publics de GitHub Actions : uniquement des comptes et des codes, jamais de noms, de valeurs
  ou d'identifiants (voir `collector/diagnose.py`).
- IA : seuls des agrégats mensuels sont envoyés ; l'application montre exactement ce qui a été envoyé.

## 8. Rituels (projet personnel, rythme léger)

| Quand | Quoi |
|---|---|
| Chaque nuit | Collecte automatique ; une issue s'ouvre si elle échoue |
| Chaque mois | Lecture de l'analyse IA ; tri des issues (nouveau, priorité, jalon) |
| Chaque version | Revue 50 personas, CHANGELOG, démonstration sur téléphone |
| Chaque hiver | Contrôle des totaux contre l'application Intuis et une facture |
