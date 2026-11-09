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
- Un **jalon GitHub par version** (`v1.2`, `v1.3`, `v1.4`, `v1.5`, `v1.6`, `v2`) ; la priorité dans un
  jalon suit MoSCoW. Les issues de personas sont rangées dans le jalon de la prochaine revue.
- Une version est **livrée** quand toutes ses issues `P: must` sont fermées, le `CHANGELOG.md` est à
  jour et la revue multi-personas de la version est écrite.

## 5. Revue multi-personas (obligatoire à chaque version)

- **62 personas** depuis le cadrage v1.4 (50 initiaux, 2 ajoutés en v1.2, 10 en v1.4), répartis en
  familles (foyer, énergie, domotique, UX et accessibilité, sécurité et juridique, dev et exploitation,
  diffusion, IA et données). La liste de référence est dans `docs/bmad/02-revue-50-personas.md`
  (§ 12 pour les ajouts) ; on peut en ajouter, jamais en retirer sans le noter.
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
| Chaque version | Revue multi-personas (cadrage et fin), CHANGELOG, démonstration sur téléphone |
| Chaque hiver | Contrôle des totaux contre l'application Intuis et une facture |

## 9. Feuille de route v1.4 à v1.6

Décidée par le propriétaire en novembre 2026, à la fin de la v1.3. Détail dans
[`feuille-de-route.md`](feuille-de-route.md) et les jalons GitHub.

| Version | Nature | Contenu | Livrée quand |
|---|---|---|---|
| **v1.4** | Fonctions | Cadrage par 62 personas ([`revues/v1.4-cadrage.md`](bmad/revues/v1.4-cadrage.md)), puis développement : fenêtres ouvertes et états des radiateurs (E13), prises Shelly, étude Home Assistant + Zigbee, processus de revue par agents (S-1.16), récits restants | Must fermés, revue de fin v1.4 écrite |
| **v1.5** | Qualité du code | Revue de code **complète** (tout le code, pas seulement le diff) par des agents de revue, selon le processus de S-1.16 ; chaque constat devient une issue du jalon v1.5, puis est corrigé ; **aucune nouvelle fonction** | Aucun constat critique ou majeur ouvert, CI verte |
| **v1.6** | Design | Revue design et UI/UX **complète** par des agents (toutes les vues, mobile et bureau, clair, sombre, contraste élevé), corrections, puis **nouveau design system** (jetons, typographie, espacements, composants partagés) appliqué à toute l'application | axe-core sans violation, aucune couleur ni taille hors jetons, captures de référence régénérées |

Pendant la v1.5 et la v1.6, les revues multi-personas continuent (cadrage et fin de version), mais leurs
propositions de **nouvelles fonctions** vont au jalon suivant (v1.7 ou v2), pas à la version en cours.
